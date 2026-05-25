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

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.85, maxOutputTokens: 600 }
    });
    const result = (response.text || '').trim();
    if (!result) throw new Error('empty response');
    return res.status(200).json({ result });
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
  return `당신은 영업인의 다이어리를 분석해주는 친근한 코치입니다. 옆집디노라고 불립니다.

[이번 주 활동]
- 신규 연락: ${tw.신규연락 || 0}회
- 팔로업: ${tw.팔로업 || 0}회
- 미팅: ${tw.미팅 || 0}회
- 성사: ${tw.성사 || 0}회

[저번 주 활동]
- 신규 연락: ${lw.신규연락 || 0}회
- 팔로업: ${lw.팔로업 || 0}회
- 미팅: ${lw.미팅 || 0}회
- 성사: ${lw.성사 || 0}회

[기타]
- 긴급 팔로업 필요 고객: ${data.urgentCount || 0}명
- 전체 고객: ${data.totalCustomers || 0}명

위 데이터를 한눈에 분석해서 사용자에게 도움이 되는 한 줄 인사이트(HTML 짧은 텍스트, <b> 태그만 허용)를 만들어주세요.

규칙:
- 2~3줄 이내, 100자 이내
- 친근한 반말 X, 친근한 존댓말 ("~예요", "~해보세요")
- 구체적 숫자 인용 OK
- 응원 + 다음 행동 제안
- 이모지 1개 정도

응답은 HTML 텍스트만, 다른 설명/마크다운 금지.`;
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
  return `당신은 옆집디노라는 따뜻한 세일즈 코치입니다. 영업인이 거절을 당한 후 마음을 정리하고 다음 행동을 잡도록 도와주세요.

[상황]
${situation || '(미입력)'}

[내 느낌]
${feeling || '(미입력)'}

[작성 원칙]
- 4~6줄, 200자 이내
- 1줄: 공감 (당연히 그런 마음 들죠 같은 톤)
- 2~3줄: 거절을 다르게 보는 관점 (실패가 아니라 정보다 등)
- 1~2줄: 구체적인 다음 액션 한 가지
- 친근한 존댓말, "~예요" 톤
- 마지막 한 줄에 격려 이모지 (💪 또는 🌟)

규칙:
- 순수 텍스트만, 마크다운/HTML 금지
- 책 인용·이론 나열 금지
- "당신은 강한 사람이에요" 같은 공허한 칭찬 금지 — 구체적이어야 함`;
}
