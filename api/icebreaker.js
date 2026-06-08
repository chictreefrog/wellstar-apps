const { GoogleGenAI } = require('@google/genai');
const credits = require('./_credits');

/**
 * POST /api/icebreaker
 * 고객/지인을 만났을 때 어색함을 푸는 '첫 멘트(아이스브레이커)' 3개를 AI로 생성.
 * 절대 영업·판매 멘트가 아니라 순수하게 관계를 여는 가벼운 첫 마디.
 *
 * Body: { situation(라벨), context }
 * 무료: 회원 1일 5건 / 게스트 1일 2건 → 초과 시 크레딧(건당 20) 차감
 * 응답: { openers:[3], used, limit, role, credit_used, credit_balance }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { situation, context } = req.body || {};
  if (!situation) return res.status(400).json({ error: 'missing_params' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await r.json())?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  let role = 'guest', persona = null;
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (pr.ok) { const rows = await pr.json(); if (rows[0]?.role) role = rows[0].role; }
  } catch {}
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=persona`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (pr.ok) { const rows = await pr.json(); persona = rows[0]?.persona || null; }
  } catch {}

  // 일일 한도
  const quota = role === 'guest' ? 2 : 5;
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000); kstNow.setUTCHours(0, 0, 0, 0);
  const sinceISO = new Date(kstNow.getTime() - 9 * 3600 * 1000).toISOString();
  let used = 0;
  try {
    const c = await fetch(`${SUPABASE_URL}/rest/v1/content_usage?user_id=eq.${userId}&channel=eq.icebreaker&created_at=gte.${encodeURIComponent(sinceISO)}&select=id`,
      { method: 'HEAD', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact', Range: '0-0' } });
    const m = (c.headers.get('content-range') || '').match(/\/(\d+)$/); if (m) used = parseInt(m[1], 10);
  } catch {}

  let payWithCredit = false;
  if (used >= quota) {
    if (role === 'guest') return res.status(429).json({ error: 'rate_limit', used, limit: quota, role, message: `체험기간 ${quota}건을 다 썼어요. 팀에 합류하면 더 쓸 수 있어요!` });
    const bal = await credits.getBalance(SUPABASE_URL, SUPABASE_KEY, userId);
    if (bal < credits.COST.icebreaker) return credits.needCreditResponse(res, 'icebreaker', bal, { used, limit: quota, role, message: `오늘 무료 ${quota}건을 다 썼어요. 충전하면 1건당 ${credits.COST.icebreaker}크레딧으로 계속 쓸 수 있어요.` });
    payWithCredit = true;
  }

  // 가벼운 개인 컨텍스트 (영업/제품 X — 타깃·나이·지역만 참고)
  const p = persona || {};
  const who = [p.age_band, p.region ? `${p.region} 활동` : ''].filter(Boolean).join(' · ');
  const ctxLines = [];
  if (p.target) ctxLines.push(`- 주로 만나는 사람: ${p.target}`);
  if (who) ctxLines.push(`- 나: ${who}`);
  const refBlock = ctxLines.length ? `\n[참고 — 내 상황 (멘트 분위기 참고용)]\n${ctxLines.join('\n')}\n` : '';

  const prompt = `당신은 영업인이 사람을 처음 만났을 때 어색함을 푸는 '첫 멘트(아이스브레이커)'를 만들어주는 도우미입니다.
${refBlock}
[상황] ${situation}
[추가 상황/관심사] ${context || '(없음)'}

[원칙 — 꼭 지키세요]
1. 절대 영업·판매·제품·사업 얘기를 넣지 마세요. 순수하게 관계를 여는 가볍고 따뜻한 첫 마디만.
2. 자연스럽고 진심 어린 한국어. 부담 없이, 편하게.
3. 상대가 쉽게 답할 수 있는 멘트 (가벼운 질문·공감·관찰).
4. 각 멘트는 1~2문장으로 짧게. 서로 다른 느낌으로 3개.
5. 마크다운·이모지 남발 금지 (이모지는 0~1개).

[출력 형식 — 반드시 다음 JSON만]
{ "openers": ["첫 멘트1", "첫 멘트2", "첫 멘트3"] }`;

  let out;
  try {
    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.95, maxOutputTokens: 500, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
    });
    const text = (response.text || '').trim().replace(/^```json\n?/i, '').replace(/```\s*$/i, '').trim();
    out = JSON.parse(text);
  } catch (err) {
    return res.status(503).json({ error: 'ai_unavailable', message: 'AI 생성에 실패했어요. 잠시 후 다시 시도해주세요.', detail: String(err?.message || err).slice(0, 200) });
  }
  if (!out?.openers || !Array.isArray(out.openers) || !out.openers.length) return res.status(503).json({ error: 'ai_format', message: 'AI 응답 형식 오류.' });

  fetch(`${SUPABASE_URL}/rest/v1/content_usage`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, channel: 'icebreaker', type: String(situation).slice(0, 40), keyword: (context || '').slice(0, 50) })
  }).catch(() => {});

  let creditBalance = null;
  if (payWithCredit) { const sp = await credits.spend(SUPABASE_URL, SUPABASE_KEY, userId, 'icebreaker', null); if (sp.ok) creditBalance = sp.balance; }

  return res.status(200).json({ openers: out.openers.slice(0, 3), used: used + 1, limit: quota, role, credit_used: payWithCredit ? credits.COST.icebreaker : 0, credit_balance: creditBalance });
};
