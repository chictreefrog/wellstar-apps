const { GoogleGenAI } = require('@google/genai');

/**
 * POST /api/diary-ai
 * 다이어리 AI 기능 백엔드 (Gemini 2.5 Flash)
 *
 * Body: { type: 'insight' | 'message' | 'coaching', ...payload }
 *
 * - insight:  this/last week 활동 분석 → 격려·전략 한 줄
 * - message:  고객 정보 → 자연스러운 팔로업 메시지
 * - coaching: 거절 상황·느낌 → 마음 정리·다음 액션 코칭
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { type } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type 필요' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  let prompt;
  switch (type) {
    case 'insight': prompt = buildInsightPrompt(req.body.analysisData); break;
    case 'message': prompt = buildMessagePrompt(req.body.customer); break;
    case 'coaching': prompt = buildCoachingPrompt(req.body.situation, req.body.feeling); break;
    default: return res.status(400).json({ error: 'unknown type' });
  }

  // type별 토큰 한도 차등 — 한국어 1자 ≈ 1.5~3 토큰
  // insight: 100자 → ~300토큰 여유롭게 1024
  // message: 80자 → ~250토큰 여유롭게 1024
  // coaching: 450자 → ~1000토큰 안전하게 4096
  const TOKEN_LIMIT = { insight: 1024, message: 1024, coaching: 4096 };
  const maxOutputTokens = TOKEN_LIMIT[type] || 2048;

  // 최대 2회 재시도 — 잘림(MAX_TOKENS) 또는 빈 응답 시
  async function generateOnce() {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.85, maxOutputTokens }
    });
    const text = (response.text || '').trim();
    // finishReason 확인 — Gemini SDK는 candidates[0].finishReason 으로 노출
    const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
    return { text, finishReason };
  }

  try {
    let attempt = 0, last = null;
    while (attempt < 2) {
      attempt++;
      last = await generateOnce();
      // 정상 완료된 응답이면 즉시 반환
      if (last.text && (last.finishReason === 'STOP' || last.finishReason === 'UNKNOWN')) {
        return res.status(200).json({ result: last.text });
      }
      // MAX_TOKENS 또는 빈 응답이면 재시도
      console.warn(`diary-ai [${type}] attempt ${attempt} finishReason=${last.finishReason} len=${last.text.length}`);
    }
    // 재시도해도 잘림 → 503 (프론트가 에러 처리하도록)
    return res.status(503).json({
      error: 'ai_truncated',
      detail: `finishReason=${last?.finishReason || 'unknown'}, len=${last?.text?.length || 0}`,
      partial: last?.text || ''
    });
  } catch (err) {
    console.error('diary-ai error:', err);
    return res.status(503).json({ error: 'ai_unavailable', detail: String(err?.message || err).slice(0, 200) });
  }
};

// ═══ 프롬프트 ═══

function buildInsightPrompt(d) {
  const data = d || {};
  const tw = data.thisWeek || {};
  const lw = data.lastWeek || {};
  const ev = data.lastEvent;

  const EVENT_TYPE_KO = {
    customer_added: '신규 고객 등록',
    customer_updated: '고객 정보 수정',
    stage_changed: '고객 단계 변경',
    memo_added: '상담 메모 추가',
    activity: '활동 카운트 증가',
    journal: '거절 회복 저널 작성'
  };

  let eventBlock = '';
  if (ev) {
    const typeLabel = EVENT_TYPE_KO[ev.type] || ev.type;
    eventBlock = `

[방금 일어난 일 — 이걸 중심으로 인사이트 만들어주세요]
- 종류: ${typeLabel}
- ${ev.customerName ? '고객: ' + ev.customerName + ' / ' : ''}내용: ${ev.detail || ''}
- 시점: ${ev.relative || '방금'}`;
  }

  const focusLine = ev
    ? `→ "${ev.customerName ? ev.customerName + '님에게 ' : ''}방금 일어난 일"과 관련해 1~2문장으로 맞춤 인사이트를 만들어주세요. 다음에 무엇을 하면 좋을지 구체적 행동까지 짧게.`
    : `→ 활동 데이터를 보고 격려 + 다음 행동 제안 한 줄.`;

  return `당신은 영업인의 다이어리를 분석해주는 친근한 코치입니다. 옆집디노라고 불립니다.

[이번 주 활동]
- 신규 연락: ${tw.신규연락 || 0}회 / 팔로업: ${tw.팔로업 || 0}회 / 미팅: ${tw.미팅 || 0}회 / 성사: ${tw.성사 || 0}회

[저번 주 활동]
- 신규 연락: ${lw.신규연락 || 0}회 / 팔로업: ${lw.팔로업 || 0}회 / 미팅: ${lw.미팅 || 0}회 / 성사: ${lw.성사 || 0}회

[기타]
- 긴급 팔로업: ${data.urgentCount || 0}명 / 전체 고객: ${data.totalCustomers || 0}명${eventBlock}

[지침]
${focusLine}

[작성 규칙]
- 2~3줄 이내, 약 100자
- 친근한 존댓말 ("~예요", "~해보세요")
- 구체적 이름·숫자 인용 OK (예: "<b>김거절님</b>이 거절하셨네요")
- 이모지 1개
- HTML 짧은 텍스트, <b> 태그만 허용 — 마크다운/기타 태그 금지

응답은 인사이트 본문만, 다른 설명 절대 추가하지 마세요.`;
}

function buildMessagePrompt(c) {
  const customer = c || {};
  const memos = (customer.memos || []).map(m => m.text || m).filter(Boolean).join(' / ') || '없음';
  return `당신은 옆집디노라는 친근한 세일즈 코치입니다. 영업인이 고객에게 보낼 자연스러운 카톡 팔로업 메시지를 작성해주세요.

[고객 정보]
- 이름: ${customer.name || '고객'}
- 단계: ${customer.stage || '관심'}
- 메모: ${customer.note || '없음'}
- 최근 대화 메모: ${memos}
- 다음 팔로업 예정일: ${customer.followUp || '미정'}

[작성 원칙]
- 50~80자 분량
- 영업 티 절대 X, 진짜 친한 사람이 보낸 듯한 자연스러움
- 고객 이름 자연스럽게 호명 ("${customer.name || '○○'}님~")
- 단계에 맞는 톤 (관심: 부담 없이 / 미팅: 약속 확인 / 거절: 안부)
- 마지막에 가벼운 질문 또는 가능한 시간 제안

규칙:
- 한 메시지(줄바꿈 1~2개 가능)
- 이모지 1~2개
- 마크다운/HTML 태그 금지, 순수 텍스트만`;
}

function buildCoachingPrompt(situation, feeling) {
  return `당신은 옆집디노라는 따뜻한 세일즈 코치입니다. 영업인이 방금 거절을 당하고 다이어리에 기록한 상황·느낌을 보고, 진심으로 위로하고 다음 행동을 정리해주세요.

[거절 상황]
${situation || '(상황 미입력)'}

[그때 내 느낌]
${feeling || '(느낌 미입력)'}

[작성 원칙 — 반드시 4단락으로]

1단락 [깊은 공감 — 3~4줄]
- "~~ 그 상황 정말 속상하셨겠어요" 같이 구체적 공감
- 사용자가 적은 느낌을 그대로 다시 짚어주며 인정
- "당연한 감정이에요" 같은 일반론은 피하기, 구체적인 상황에 묶어서

2단락 [다른 관점 — 4~5줄]
- 이 거절이 왜 실패가 아니라 정보인지, 또는 다른 의미가 있는지
- 영업 현장의 비유나 짧은 일화 활용 가능 (10번 거절 중 1번 성공의 법칙 등)
- 상황에 맞는 진짜 이유 분석 (예: '이미 지인이 있다' → 신뢰의 깊이가 다른 거지 당신이 부족한 게 아님)

3단락 [구체적인 다음 행동 — 3~4줄]
- 사용자가 '다음에는 이렇게'에 적은 것을 보강해주거나, 더 구체적으로 다듬어주기
- "내가 필요한 이유 어필" → "구체적으로 어떤 가치를 줄 수 있는지 한 줄로 정리해두기" 같이
- 오늘 당장 또는 다음 미팅에서 실행 가능한 작은 한 가지

4단락 [짧은 응원 — 1~2줄]
- 진심 어린 응원 한 마디
- 마지막에 💪 또는 🌟 이모지

[톤 가이드]
- 친근한 존댓말, "~예요" "~해요"
- 친한 선배가 카톡으로 응원해주듯 자연스럽게
- 한 문장이 너무 길면 줄바꿈
- 총 분량 300~450자 (너무 짧으면 위로 안 됨)

[금지]
- 마크다운(#, **, ---) 절대 사용 X
- "당신은 강해요" 같은 공허한 칭찬
- 책 인용, 이론 나열
- 한 줄짜리 짧은 답변 — 진짜로 마음 정리되게 충분히 써주세요`;
}
