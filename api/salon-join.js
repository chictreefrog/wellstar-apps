/**
 * POST /api/salon-join  (살롱 — 공개, 로그인 불필요)
 * 디노언니 첫 사용 전 휴대폰(+이름·연령대) 수집 → 리드 저장 + 영업인(ref) 귀속.
 * Body: { phone, name?, age_band?, ref?, source? }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};
  const phone = String(b.phone || '').replace(/\D/g, '');
  if (phone.length < 10) return res.status(400).json({ error: 'invalid_phone' });
  const source = (b.source === 'care') ? 'care' : 'salon';

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });
  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

  // ref(business_code/id-prefix) → 영업인 profile id
  let inviterId = null;
  const cleanRef = b.ref ? String(b.ref).trim().toUpperCase() : '';
  if (cleanRef) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?business_code=eq.${encodeURIComponent(cleanRef)}&select=id&limit=1`, { headers: sbHeaders });
      const rows = await r.json();
      if (rows?.[0]) inviterId = rows[0].id;
    } catch {}
    if (!inviterId) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id`, { headers: sbHeaders });
        const all = await r.json();
        const m = (all || []).find(p => p.id.replace(/-/g, '').slice(0, 8).toUpperCase() === cleanRef);
        if (m) inviterId = m.id;
      } catch {}
    }
  }

  const row = {
    phone, source,
    last_seen: new Date().toISOString(),
  };
  if (b.name) row.name = String(b.name).slice(0, 40);
  if (b.age_band) row.age_band = String(b.age_band).slice(0, 20);
  if (cleanRef) row.ref = cleanRef;
  if (inviterId) row.inviter_id = inviterId;

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/customer_leads?on_conflict=phone,source`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) { const t = await r.text(); return res.status(500).json({ error: 'db_error', detail: t.slice(0, 200) }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
};
