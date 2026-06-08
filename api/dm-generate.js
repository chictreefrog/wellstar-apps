const { GoogleGenAI } = require('@google/genai');
const credits = require('./_credits');

/**
 * POST /api/dm-generate
 * 1:1 DM/문자 멘트를 AI로 생성 (목적·톤·채널·페르소나 반영)
 * Header: Authorization: Bearer <access token>
 * Body:   { purpose(라벨), tone(라벨), channel(kakao|instagram|sms), context }
 * 응답:   { message, alt, used, limit, role, credit_used, credit_balance }
 *
 * 무료: 회원 1일 20건 / 게스트 1일 3건 → 초과 시 크레딧(건당 30) 차감
 */
const CHANNEL_GUIDE = {
  kakao: '카카오톡 — 2~4문장, 친근한 대화체, 이모지 1~2개 OK, 너무 길지 않게',
  instagram: '인스타그램 DM — 1~2문장으로 아주 짧고 캐주얼하게, 이모지 1개 정도, 가볍게 말 걸듯',
  sms: '문자(SMS) — 1~2문장, 담백하고 정중하게, 이모지·ㅋㅋ/ㅎㅎ 없이, 군더더기 없이',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { purpose, tone, channel, context } = req.body || {};
  if (!purpose || !tone) return res.status(400).json({ error: 'missing_params' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  // 1. 사용자
  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await r.json())?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  // 2. role (안전 조회)
  let role = 'guest', companyId = null, persona = null;
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (pr.ok) { const rows = await pr.json(); if (rows[0]?.role) role = rows[0].role; }
  } catch {}
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=company_id,persona`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (pr.ok) { const rows = await pr.json(); companyId = rows[0]?.company_id || null; persona = rows[0]?.persona || null; }
  } catch {}

  // 3. 일일 한도 (회원 20 / 게스트 3)
  const quota = role === 'guest' ? 3 : 20;
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000); kstNow.setUTCHours(0, 0, 0, 0);
  const sinceISO = new Date(kstNow.getTime() - 9 * 3600 * 1000).toISOString();
  let used = 0;
  try {
    const c = await fetch(`${SUPABASE_URL}/rest/v1/content_usage?user_id=eq.${userId}&channel=eq.dm&created_at=gte.${encodeURIComponent(sinceISO)}&select=id`,
      { method: 'HEAD', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact', Range: '0-0' } });
    const m = (c.headers.get('content-range') || '').match(/\/(\d+)$/); if (m) used = parseInt(m[1], 10);
  } catch {}

  let payWithCredit = false;
  if (used >= quota) {
    if (role === 'guest') {
      return res.status(429).json({ error: 'rate_limit', used, limit: quota, role, message: `체험기간 메시지 ${quota}건을 다 썼어요. 팀에 합류하면 더 쓸 수 있어요!` });
    }
    const bal = await credits.getBalance(SUPABASE_URL, SUPABASE_KEY, userId);
    if (bal < credits.COST.dm) {
      return credits.needCreditResponse(res, 'dm', bal, { used, limit: quota, role, message: `오늘 무료 메시지 ${quota}건을 다 썼어요. 충전하면 1건당 ${credits.COST.dm}크레딧으로 계속 쓸 수 있어요.` });
    }
    payWithCredit = true;
  }

  // 4. 내 사업 정보
  const biz = await loadBizContext(SUPABASE_URL, SUPABASE_KEY, companyId, persona);
  const bizRules = biz.hasInfo
    ? `\n5. '내 사업 정보'의 회사명·제품명은 고유명사이므로 절대 바꾸지 말 것 (예: '웰런스'를 '웰니스'로 X).\n6. 목적이 제품 소개·사업 초대면 위 내 회사/제품을 자연스럽게 녹일 것.`
    : '';

  const prompt = `당신은 네트워크 마케팅 영업인을 돕는 메시지 작가입니다. 상대에게 보낼 1:1 메시지(DM/문자)를 작성하세요.
${biz.text}
[조건]
- 목적: ${purpose}
- 톤: ${tone}
- 채널: ${CHANNEL_GUIDE[channel] || channel || '일반'}
- 상황/관심 주제: ${context || '(특정 주제 없음 — 일반적으로)'}

[작성 원칙]
1. 진짜 사람이 보낸 것 같은 자연스러운 메시지. 광고·판매 티 절대 X.
2. 부담 없이, 상대를 배려하는 말투. 강요·과장 금지.
3. 채널 특성(길이·이모지)에 맞출 것.
4. 마크다운·해시태그 금지. 복사해서 바로 보낼 수 있는 메시지 그대로.${bizRules}

[출력 형식 — 반드시 다음 JSON만]
{ "message": "메인 메시지", "alt": "톤·표현을 살짝 바꾼 다른 버전" }`;

  let out;
  try {
    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.9, maxOutputTokens: 500, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
    });
    const text = (response.text || '').trim().replace(/^```json\n?/i, '').replace(/```\s*$/i, '').trim();
    out = JSON.parse(text);
  } catch (err) {
    return res.status(503).json({ error: 'ai_unavailable', message: 'AI 메시지 생성에 실패했어요.', detail: String(err?.message || err).slice(0, 200) });
  }
  if (!out?.message) return res.status(503).json({ error: 'ai_format', message: 'AI 응답 형식 오류.' });

  // 사용량 기록
  fetch(`${SUPABASE_URL}/rest/v1/content_usage`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, channel: 'dm', type: String(purpose).slice(0, 40), tone: String(tone).slice(0, 40), keyword: (context || '').slice(0, 50) })
  }).catch(() => {});

  // 크레딧 차감
  let creditBalance = null;
  if (payWithCredit) { const sp = await credits.spend(SUPABASE_URL, SUPABASE_KEY, userId, 'dm', null); if (sp.ok) creditBalance = sp.balance; }

  return res.status(200).json({
    message: out.message, alt: out.alt || '',
    used: used + 1, limit: quota, role,
    credit_used: payWithCredit ? credits.COST.dm : 0, credit_balance: creditBalance
  });
};

// 회사 카탈로그 + 페르소나 → 컨텍스트 블록
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
  let focus = products;
  if (Array.isArray(p.products) && p.products.length && products.length) {
    const set = new Set(p.products); const f = products.filter(x => set.has(x.name)); if (f.length) focus = f;
  }
  const lines = [];
  if (company?.name) lines.push(`- 회사/브랜드: ${company.name}${company.brand_tone ? ` (${company.brand_tone})` : ''}`);
  focus.slice(0, 3).forEach(pr => lines.push(`- 제품: ${pr.name}${pr.category ? ` (${pr.category})` : ''}${pr.benefits ? ` — 핵심: ${pr.benefits}` : ''}`));
  if (p.target) lines.push(`- 타깃 고객: ${p.target}`);
  if (p.purpose) lines.push(`- 사업 목적: ${p.purpose}`);
  if (p.motivation) lines.push(`- 계기/한마디: ${p.motivation}`);
  const cautions = [company?.notes, ...focus.map(x => x.cautions)].filter(Boolean).join(' / ');
  if (cautions) lines.push(`- ⚠️ 피해야 할 표현: ${cautions}`);
  if (lines.length) { out.hasInfo = true; out.text = `\n[내 사업 정보 — 메시지에 자연스럽게 반영]\n${lines.join('\n')}\n`; }
  return out;
}
