/**
 * GET /api/my-leads  (로그인 필요 — 영업인 본인의 고객 리드 조회)
 * 살롱(customer_leads source=salon) + 케어(care_subscribers)를 합쳐서 돌려줌.
 *  - admin    : 전체
 *  - leader   : 자기 팀(team_id) 전체
 *  - 그 외(파트너): 본인이 데려온 것(inviter_id = 나)
 * RLS상 두 테이블은 service_role 전용이라 반드시 서버에서 조회.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const accessToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });
  const svc = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // 1) 토큰 → 사용자
  let userId;
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` } });
    if (!ur.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await ur.json())?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  // 2) 프로필 role/team_id
  let role = 'partner', teamId = null;
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role,team_id`, { headers: svc });
    if (pr.ok) { const rows = await pr.json(); if (rows[0]) { role = rows[0].role || role; teamId = rows[0].team_id || null; } }
  } catch {}

  // 3) 필터 결정
  let filter;
  if (role === 'admin') filter = '';
  else if (role === 'leader' && teamId) filter = `team_id=eq.${teamId}&`;
  else filter = `inviter_id=eq.${userId}&`;

  // 4) 살롱 리드
  const out = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/customer_leads?${filter}source=eq.salon&select=name,phone,age_band,ref,created_at,last_seen,ai_used_count&order=created_at.desc&limit=500`, { headers: svc });
    if (r.ok) {
      for (const x of (await r.json()) || []) {
        out.push({ source: 'salon', name: x.name || '', phone: x.phone || '', age_band: x.age_band || '', created_at: x.created_at || x.last_seen || null, last_seen: x.last_seen || null });
      }
    }
  } catch {}

  // 5) 케어 가입자 (자녀=guardian이 리드)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/care_subscribers?${filter}select=guardian_name,guardian_phone,parent_name,created_at,last_active&order=created_at.desc&limit=500`, { headers: svc });
    if (r.ok) {
      for (const x of (await r.json()) || []) {
        out.push({ source: 'care', name: x.guardian_name || '', phone: x.guardian_phone || '', parent_name: x.parent_name || '', created_at: x.created_at || null, last_seen: x.last_active || null });
      }
    }
  } catch {}

  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const counts = { salon: out.filter(l => l.source === 'salon').length, care: out.filter(l => l.source === 'care').length };
  return res.status(200).json({ ok: true, role, leads: out, counts, total: out.length });
};
