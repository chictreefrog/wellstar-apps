const { GoogleGenAI } = require('@google/genai');
const credits = require('./_credits');

/**
 * AI 콘텐츠 생성기 백엔드
 *
 * 인증: Authorization 헤더의 Supabase 액세스 토큰 검증
 * 사용 제한:
 *   - role='guest' → 1일 1건
 *   - 그 외 (partner/leader/admin/member 등) → 1일 5건
 *   - "1일"은 KST 자정 기준 캘린더 일자
 * 실패 시: 프론트엔드에 폴백(CONTENT_DB)이 있어 정적 결과 반환됨
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { channel, type, tone, keyword } = req.body || {};
  if (!channel || !type || !tone) {
    return res.status(400).json({ error: 'missing_params' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'server_not_configured' });
  }

  // 1. 토큰으로 사용자 확인
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'invalid_token' });
    const u = await userRes.json();
    userId = u?.id;
  } catch (e) {
    return res.status(401).json({ error: 'auth_failed' });
  }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  // 2. 프로필 role 조회 (안전 — 항상 존재하는 컬럼만)
  let role = 'guest';
  let companyId = null;
  let persona = null;
  try {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (profileRes.ok) {
      const rows = await profileRes.json();
      if (rows[0]?.role) role = rows[0].role;
    }
  } catch {}
  // 회사/페르소나 (personas.sql 적용 전이면 컬럼이 없을 수 있어 별도로 — 실패해도 role/생성에 영향 없음)
  try {
    const pr = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=company_id,persona`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (pr.ok) {
      const rows = await pr.json();
      companyId = rows[0]?.company_id || null;
      persona = rows[0]?.persona || null;
    }
  } catch {}

  // 3. 일일 한도 결정 (회원 1일 3건 — 확정 2026-06-09)
  const quota = role === 'guest' ? 1 : 3;

  // 4. KST 캘린더 자정 이후 사용량 조회
  const kstMidnightUTC = kstTodayMidnight();
  let todayUsed = 0;
  try {
    const usageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/content_usage?user_id=eq.${userId}&created_at=gte.${encodeURIComponent(kstMidnightUTC.toISOString())}&select=id`,
      {
        method: 'HEAD',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'count=exact',
          Range: '0-0'
        }
      }
    );
    const cr = usageRes.headers.get('content-range') || '';
    const m = cr.match(/\/(\d+)$/);
    if (m) todayUsed = parseInt(m[1], 10);
  } catch {}

  let payWithCredit = false;
  if (todayUsed >= quota) {
    // 무료 한도 소진
    if (role === 'guest') {
      return res.status(429).json({
        error: 'rate_limit', used: todayUsed, limit: quota, role,
        message: `오늘 무료 콘텐츠 ${quota}건을 다 썼어요. 팀에 합류하면 하루 3건까지 가능해요!`
      });
    }
    const bal = await credits.getBalance(SUPABASE_URL, SUPABASE_KEY, userId);
    if (bal < credits.COST.content) {
      return credits.needCreditResponse(res, 'content', bal, {
        used: todayUsed, limit: quota, role,
        message: `오늘 무료 콘텐츠 ${quota}건을 다 썼어요. 충전하면 1건당 ${credits.COST.content}크레딧으로 더 만들 수 있어요.`
      });
    }
    payWithCredit = true;
  }

  // 5. 내 사업 정보(회사 카탈로그 + 페르소나) 로드 → 프롬프트 주입
  const bizContext = await loadBizContext(SUPABASE_URL, SUPABASE_KEY, companyId, persona);

  // 6. Gemini로 콘텐츠 생성
  const prompt = buildPrompt(channel, type, tone, keyword, bizContext);
  let content;
  try {
    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
        // 2.5 Flash의 thinking이 토큰을 먹어 비용↑/잘림 유발 → 정해진 JSON 생성엔 추론 불필요하므로 끔
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    const text = (response.text || '').trim();
    // JSON 응답 파싱 (코드블록 제거)
    const jsonStr = text.replace(/^```json\n?/i, '').replace(/```\s*$/i, '').trim();
    content = JSON.parse(jsonStr);
  } catch (err) {
    return res.status(503).json({
      error: 'ai_unavailable',
      message: 'AI 콘텐츠 생성에 실패했어요. 잠시 후 다시 시도해주세요.',
      detail: String(err?.message || err).slice(0, 200)
    });
  }

  if (!content?.caption || !content?.hook || !content?.hashtags) {
    return res.status(503).json({
      error: 'ai_format',
      message: 'AI 응답 형식 오류. 다시 시도해주세요.'
    });
  }

  // 6. 사용량 기록 (응답 블로킹 안 함)
  fetch(`${SUPABASE_URL}/rest/v1/content_usage`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      user_id: userId,
      channel: String(channel).slice(0, 40),
      type: String(type).slice(0, 40),
      tone: String(tone).slice(0, 40),
      keyword: keyword ? String(keyword).slice(0, 120) : null
    })
  }).catch(() => {});

  // 무료 한도 초과분 크레딧 차감 (생성 성공 후)
  let creditBalance = null;
  if (payWithCredit) {
    const sp = await credits.spend(SUPABASE_URL, SUPABASE_KEY, userId, 'content', null);
    if (sp.ok) creditBalance = sp.balance;
  }

  return res.status(200).json({
    caption: content.caption,
    hook: content.hook,
    hashtags: content.hashtags,
    used: todayUsed + 1,
    limit: quota,
    remaining: quota - todayUsed - 1,
    role,
    credit_used: payWithCredit ? credits.COST.content : 0,
    credit_balance: creditBalance
  });
};

// KST 자정 UTC 시각 계산
function kstTodayMidnight() {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  kstNow.setUTCHours(0, 0, 0, 0);
  return new Date(kstNow.getTime() - 9 * 3600 * 1000);
}

// Gemini 프롬프트 구성
function buildPrompt(channel, type, tone, keyword, biz) {
  const TYPES = {
    daily: '일상/브이로그 — 가벼운 하루 이야기, 소소한 발견',
    review: '제품 후기 — 직접 사용한 솔직한 후기, 변화 체감 위주',
    tip: '영업 팁 — 실전 영업 노하우, 실수 줄이는 방법',
    story: '성공 스토리 — 본인의 성과나 성장 이야기',
    motivation: '동기부여 — 응원, 격려, 마인드셋',
    recruit: '사업 소개 — 비즈니스 파트너 모집, 함께 성장 제안'
  };
  const TONES = {
    friendly: '친근하게 — 친한 선배가 카톡으로 말하듯, 반말은 X',
    professional: '전문적으로 — 신뢰감, 근거/구체 수치 인용',
    emotional: '감성적으로 — 공감, 진심, 따뜻한 어조',
    witty: '재치있게 — 유머, ㅋㅋ, 살짝 과장된 표현'
  };
  const CHANNELS = {
    instagram: '인스타그램 — 8~12줄 분량, 이모지 풍부, 마지막 줄에 댓글/DM 유도 한 줄',
    threads: `스레드(Threads, Meta) — 다음 알고리즘 원칙을 반드시 지킬 것:
- 분량: 280자 이내, 짧을수록 좋음 (Threads 피드에서 끝까지 읽히게)
- 첫 줄이 가장 중요: 피드에 첫 줄만 보이고 나머지는 '더 보기'에 가려짐 → 첫 줄에서 호기심·공감을 강하게 유발
- 솔직한 1인칭 톤, 진짜 친구가 한 말 같은 느낌
- 말투: 반말·혼잣말체 우선 ('~했어', '~하더라', '~인 듯', '~인 사람?'). 존댓말 X. (비속어·과한 신조어는 피하기) — 스레드에선 아래 '톤'의 존댓말 규칙보다 이 반말체를 우선 적용
- 광고티/판매티 절대 X (Threads는 광고티 나면 노출 급락)
- 외부 링크 노출 자제 (외부 유출 콘텐츠에 노출 페널티)
- 마지막에 질문이나 의견 요청으로 댓글 유도 (대화형 알고리즘이 보상)
- 이모지 1~2개만, 인스타처럼 많이 X
- 해시태그 0~1개 (Threads는 해시태그 효과 약함)
- '~인 사람?', '나만 그래?' 같은 공감 유도 표현 활용 추천`,
    x: 'X (트위터) — 2~3줄, 매우 짧게(140자 내외), 첫 줄에서 후킹, 이모지 0~1개',
    facebook: '페이스북 — 5~8줄, 텍스트 위주, 적당한 이모지'
  };
  const HASHTAG_RULES = {
    instagram: '관련 한국어 해시태그 10개',
    threads: '해시태그 1개만 (또는 정말 필요 없으면 빈 문자열로)',
    x: '관련 해시태그 1~2개',
    facebook: '관련 해시태그 5개'
  };

  const bizBlock = (biz && biz.text) ? biz.text : '';
  const bizRules = (biz && biz.hasInfo)
    ? `\n7. 위 '내 사업 정보'의 회사명·제품명은 고유명사다. 절대 다른 단어로 바꾸거나 교정하지 말 것 (예: '웰런스'를 '웰니스'로 바꾸지 말 것).\n8. 특정 AI 도구/시스템이 아니라, 위 '내 사업 정보'의 회사·제품·사업을 알리는 콘텐츠를 쓸 것.`
    : '';
  return `당신은 네트워크 마케팅 영업인의 한국어 SNS 콘텐츠 작가입니다. 이 영업인이 자신의 SNS에 올릴 '진짜 본인 이야기' 같은 게시물을 만들어주세요.
${bizBlock}
[조건]
- 채널: ${CHANNELS[channel] || channel}
- 콘텐츠 유형: ${TYPES[type] || type}
- 톤: ${TONES[tone] || tone}
- 주제/키워드: ${keyword || '(주제 자유)'}

[작성 원칙]
1. 영업 티 나지 않게 자연스럽게 — 진짜 사람이 쓴 것 같은 톤
2. 키워드를 본문 속에 자연스럽게 녹여낼 것 (억지로 끼워넣지 않기)
3. 키워드가 제품/효능이면 그에 어울리는 구체적 변화를 묘사 (예: "피로개선" → "오후에 늘어지지 않게 됐어요")
4. 채널 특성에 맞는 길이와 형식 엄수
5. 마크다운(##, **, ---) 절대 사용 금지 — 일반 텍스트만
6. "구매하세요", "지금 신청" 같은 직접적 판매 문구 피할 것${bizRules}

[출력 형식 — 반드시 다음 JSON 한 가지만, 다른 텍스트 금지]
{
  "caption": "본문 (줄바꿈은 \\n)",
  "hook": "본문의 첫 줄을 SNS 미리보기에 맞게 다듬은 한 줄 후킹 문장",
  "hashtags": "해시태그: ${HASHTAG_RULES[channel]} (한 줄에 '#태그 #태그' 형식)"
}`;
}

// 회사 카탈로그 + 페르소나 → 프롬프트용 컨텍스트 블록 생성
function _sbAuth(key) { return { apikey: key, Authorization: `Bearer ${key}` }; }
async function loadBizContext(url, key, companyId, persona) {
  const out = { hasInfo: false, text: '' };
  let company = null, products = [];
  if (companyId) {
    try {
      const [cRes, pRes] = await Promise.all([
        fetch(`${url}/rest/v1/companies?id=eq.${companyId}&select=name,brand_tone,notes`, { headers: _sbAuth(key) }),
        fetch(`${url}/rest/v1/company_products?company_id=eq.${companyId}&select=name,category,benefits,cautions`, { headers: _sbAuth(key) }),
      ]);
      company = (await cRes.json())[0] || null;
      products = (await pRes.json()) || [];
    } catch {}
  }
  const p = persona || {};
  // 사용자가 고른 주 판매상품으로 필터 (persona.products = 제품명 배열)
  let focus = products;
  if (Array.isArray(p.products) && p.products.length && products.length) {
    const set = new Set(p.products);
    const f = products.filter(x => set.has(x.name));
    if (f.length) focus = f;
  }
  const lines = [];
  if (company?.name) lines.push(`- 회사/브랜드: ${company.name}${company.brand_tone ? ` (${company.brand_tone})` : ''}`);
  focus.slice(0, 4).forEach(pr => {
    lines.push(`- 제품: ${pr.name}${pr.category ? ` (${pr.category})` : ''}${pr.benefits ? ` — 핵심: ${pr.benefits}` : ''}`);
  });
  if (p.target) lines.push(`- 타깃 고객: ${p.target}`);
  const who = [p.age_band, p.gender].filter(Boolean).join(' ');
  const whoLine = [who, p.region ? `${p.region} 활동` : '', p.sales_stage].filter(Boolean).join(' · ');
  if (whoLine) lines.push(`- 작성자: ${whoLine}`);
  if (p.purpose) lines.push(`- 콘텐츠 목적: ${p.purpose}`);
  if (p.motivation) lines.push(`- 계기/한마디: ${p.motivation}`);
  const cautions = [company?.notes, ...focus.map(x => x.cautions)].filter(Boolean).join(' / ');
  if (cautions) lines.push(`- ⚠️ 피해야 할 표현(쓰지 말 것): ${cautions}`);
  if (lines.length) {
    out.hasInfo = true;
    out.text = `\n[내 사업 정보 — 이걸 바탕으로 진짜 내 이야기처럼 작성]\n${lines.join('\n')}\n`;
  }
  return out;
}
