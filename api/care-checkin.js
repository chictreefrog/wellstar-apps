/**
 * POST /api/care-checkin  (안심케어 — 공개 엔드포인트, 로그인 불필요)
 * 부모님이 체크인할 때(또는 자녀가 세팅할 때) 호출 → 서버에 last_active 기록.
 * Body: { guardian_phone, guardian_name?, parent_name?, alert_after_days?, ref?, last_active? }
 * guardian_phone(자녀 연락처) 기준 upsert.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};
  const phone = String(b.guardian_phone || '').replace(/\D/g, '');
  if (phone.length < 10) return res.status(400).json({ error: 'invalid_phone' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  const row = {
    guardian_phone: phone,
    last_active: b.last_active || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (b.guardian_name) row.guardian_name = String(b.guardian_name).slice(0, 40);
  if (b.parent_name) row.parent_name = String(b.parent_name).slice(0, 40);
  if (b.ref) row.ref = String(b.ref).slice(0, 40);
  const days = parseInt(b.alert_after_days, 10);
  if (days >= 1 && days <= 14) row.alert_after_days = days;

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/care_subscribers?on_conflict=guardian_phone`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ error: 'db_error', detail: t.slice(0, 200) });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
};
