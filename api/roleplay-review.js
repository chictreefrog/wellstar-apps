const { GoogleGenAI } = require('@google/genai');

/**
 * POST /api/roleplay-review
 * 끝난 롤플레이 대화에 대한 옆집디노 코치의 회고 생성
 *
 * Body: { session_id }
 * Header: Authorization: Bearer <access_token>
 *
 * 응답: { review: { good, improve, summary, next_step } }
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await r.json())?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }

  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

  // 회고 한도 (확정 2026-05-29)
  // - 회원: 1일 1회
  // - 게스트: 체험기간 7일 누적 3회
  let role = 'guest';
  let guestStartedAt = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role,guest_started_at`, { headers: sbHeaders });
    const rows = await r.json();
    if (rows[0]?.role) role = rows[0].role;
    if (rows[0]?.guest_started_at) guestStartedAt = rows[0].guest_started_at;
  } catch {}
  const isGuest = role === 'guest';
  const reviewQuota = isGuest ? 3 : 1;
  const quotaWindowLabel = isGuest ? '체험기간' : '오늘';

  // 세션 조회 (본인 세션인지 확인)
  const sessRes = await fetch(
    `${SUPABASE_URL}/rest/v1/roleplay_sessions?id=eq.${session_id}&user_id=eq.${userId}&select=*`,
    { headers: sbHeaders }
  );
  const sessions = await sessRes.json();
  if (!sessions || !sessions[0]) return res.status(404).json({ error: 'session_not_found' });
  const sess = sessions[0];

  // 이 세션에 이미 회고가 있으면 한도 차감 없이 재반환 가능. 새 회고 생성이면 한도 체크.
  const isNewReview = !sess.review || !sess.review.summary;
  if (isNewReview) {
    // 카운트 윈도우: 게스트는 가입일 이후, 회원은 KST 자정 이후
    let sinceISO;
    if (isGuest) {
      sinceISO = guestStartedAt
        ? new Date(guestStartedAt).toISOString()
        : new Date(Date.now() - 7 * 86400000).toISOString();
    } else {
      const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
      kstNow.setUTCHours(0, 0, 0, 0);
      sinceISO = new Date(kstNow.getTime() - 9 * 3600 * 1000).toISOString();
    }
    let usedReviews = 0;
    try {
      const cntRes = await fetch(
        `${SUPABASE_URL}/rest/v1/roleplay_sessions?user_id=eq.${userId}&completed=eq.true&updated_at=gte.${encodeURIComponent(sinceISO)}&select=id`,
        { method: 'HEAD', headers: { ...sbHeaders, Prefer: 'count=exact', Range: '0-0' } }
      );
      const cr = cntRes.headers.get('content-range') || '';
      const m = cr.match(/\/(\d+)$/);
      if (m) usedReviews = parseInt(m[1], 10);
    } catch {}
    if (usedReviews >= reviewQuota) {
      const msg = isGuest
        ? `체험기간 회고 ${reviewQuota}회를 모두 사용했어요. 팀에 합류하면 매일 1회 사용 가능해요!`
        : `${quotaWindowLabel} 회고 한도(${reviewQuota}회)에 도달했어요. 사용권을 구매하거나 내일 다시 시도해주세요.`;
      return res.status(429).json({
        error: 'rate_limit',
        message: msg,
        used: usedReviews,
        limit: reviewQuota
      });
    }
  }

  // 대화 텍스트 구성
  const messages = sess.messages || [];
  if (messages.length === 0) return res.status(400).json({ error: 'empty_session' });

  const dialog = messages.map(m =>
    `${m.role === 'user' ? '👤 영업인' : '🤖 고객'}: ${m.content}`
  ).join('\n');

  const prompt = `당신은 옆집디노라는 NM 영업 코치입니다. 방금 끝난 영업 롤플레이를 보고 영업인에게 따뜻하고 구체적인 회고를 해주세요.

[페르소나]
${sess.persona_name} (${sess.persona_id})
[난이도] ${sess.level}
[추가 정보] ${sess.custom_context || '없음'}

[대화 내용]
${dialog}

[작성 원칙]
- 잘한 점, 개선점은 대화 속 구체적인 한마디를 인용해서 짚어주기
- NM 영업의 본질(관계 → 신뢰 → 가치 → 권유) 기준
- "당신은 강해요" 같은 공허한 칭찬 X, 구체적 행동·표현 칭찬
- 개선점은 비난 X, "이렇게 해보면 더 좋겠어요" 톤
- next_step은 다음 롤플레이에서 시도할 작은 행동 한 가지

[출력 형식 — 반드시 다음 JSON, 다른 설명 금지]
{
  "good": "잘한 점 (구체적 행동 인용, 2~3줄)",
  "improve": "개선점 (구체적 인용 + 더 좋은 방법 제안, 2~3줄)",
  "summary": "핵심 한 줄 — 이번 대화에서 가장 중요한 교훈",
  "next_step": "다음에 시도할 작은 행동 한 가지"
}`;

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  // JSON 4필드(각 2~3줄) → 한국어 약 900자 → 토큰 1800~2400 필요
  // 여유롭게 4096로 상향 (이전 1500은 잘림 빈발)
  const MAX_TOKENS = 4096;

  // 시도 1: responseMimeType=application/json (Gemini가 JSON 구조 보장)
  // 시도 2: mimeType 없이 + 정규식 JSON 추출 (fallback)
  async function generateAttempt(useMimeType) {
    const cfg = useMimeType
      ? { temperature: 0.7, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' }
      : { temperature: 0.5, maxOutputTokens: MAX_TOKENS };
    const textPrompt = useMimeType ? prompt : (prompt + '\n\n반드시 위 JSON 형식으로만 응답하세요.');
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: textPrompt }] }],
      config: cfg
    });
    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
    return { text, finishReason };
  }

  function tryParseJson(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/^```json\n?/i, '').replace(/```\s*$/i, '').trim();
    // 1차: 그대로 파싱
    try { return JSON.parse(cleaned); } catch {}
    // 2차: { ... } 영역 추출 후 파싱
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }

  let review = null;
  let lastError = null;
  let lastFinishReason = 'UNKNOWN';

  for (const useMimeType of [true, false]) {
    try {
      const { text, finishReason } = await generateAttempt(useMimeType);
      lastFinishReason = finishReason;
      console.log(`[roleplay-review] mimeType=${useMimeType} finishReason=${finishReason} len=${text.length}`);

      // MAX_TOKENS로 잘렸으면 JSON이 깨질 확률 매우 높음 → 다음 시도로
      if (finishReason === 'MAX_TOKENS') {
        lastError = new Error('truncated_at_max_tokens');
        continue;
      }

      const parsed = tryParseJson(text);
      if (parsed && parsed.good && parsed.improve && parsed.summary) {
        review = parsed;
        break;
      }
      lastError = new Error('parse_or_format_failed');
    } catch (err) {
      console.error('[roleplay-review] attempt error:', err);
      lastError = err;
    }
  }

  if (!review) {
    return res.status(503).json({
      error: lastFinishReason === 'MAX_TOKENS' ? 'ai_truncated' : 'ai_unavailable',
      detail: String(lastError?.message || lastError || 'unknown').slice(0, 200),
      finishReason: lastFinishReason
    });
  }

  // DB 업데이트
  await fetch(`${SUPABASE_URL}/rest/v1/roleplay_sessions?id=eq.${session_id}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      review,
      completed: true,
      updated_at: new Date().toISOString()
    })
  }).catch(() => {});

  return res.status(200).json({ review });
};
