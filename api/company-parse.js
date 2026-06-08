const { GoogleGenAI } = require('@google/genai');

/**
 * POST /api/company-parse  (관리자 전용)
 * 회사 홈페이지/제품 링크를 읽어 브랜드·제품 정보를 구조화해 돌려줌.
 * 저장은 안 함 — 관리자가 화면에서 검토·수정 후 직접 저장(companies/company_products).
 *
 * Header: Authorization: Bearer <admin access token>
 * Body:   { url }
 * 응답:   { company_name, brand_tone, products:[{name,category,benefits,cautions}] }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'invalid_url', message: '올바른 링크(http/https)를 입력해주세요.' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  // 1. 사용자 확인 + admin 권한 체크
  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await r.json())?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await pr.json();
    if (rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: '관리자만 사용할 수 있어요.' });
  } catch { return res.status(403).json({ error: 'forbidden' }); }

  // 2. 페이지 가져오기 → 텍스트만 추출
  let pageText = '';
  try {
    const pageRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DinoBot/1.0)' } });
    const html = await pageRes.text();
    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  } catch {
    return res.status(502).json({ error: 'fetch_failed', message: '링크를 읽지 못했어요. 주소를 확인해주세요.' });
  }
  if (pageText.length < 50) {
    return res.status(422).json({ error: 'too_little_content', message: '페이지에서 내용을 찾지 못했어요. 제품 소개 페이지 링크를 넣어보세요.' });
  }

  // 3. Gemini로 구조화
  const prompt = `다음은 회사 홈페이지에서 추출한 텍스트입니다. 이 회사의 브랜드/제품 정보를 아래 JSON으로만 정리하세요. 확실하지 않은 값은 빈 문자열/빈 배열로 두세요. 추측해서 지어내지 마세요.

[출력 JSON]
{
  "company_name": "회사/브랜드명",
  "brand_tone": "브랜드 말투·이미지 한 줄 (예: 신뢰감 있는 건강 전문)",
  "products": [
    { "name": "제품명(고유명사 그대로)", "category": "카테고리(예: 체중관리 보충제)", "benefits": "핵심 효능 2~3개 쉼표로", "cautions": "과장/의료 단정 등 피해야 할 표현(없으면 빈칸)" }
  ]
}

[텍스트]
"""${pageText}"""`;

  try {
    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 1200, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
    });
    const text = (response.text || '').trim().replace(/^```json\n?/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(text);
    return res.status(200).json({
      company_name: data.company_name || '',
      brand_tone: data.brand_tone || '',
      products: Array.isArray(data.products) ? data.products.slice(0, 20) : []
    });
  } catch (err) {
    return res.status(503).json({ error: 'ai_unavailable', message: 'AI 정리에 실패했어요. 잠시 후 다시 시도해주세요.', detail: String(err?.message || err).slice(0, 200) });
  }
};
