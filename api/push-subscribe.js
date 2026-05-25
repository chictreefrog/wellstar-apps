/**
 * POST /api/push-subscribe — 푸시 구독 등록/갱신
 *   Body: { endpoint, keys: { p256dh, auth }, kinds?: {...} }
 *   Header: Authorization: Bearer <access_token>
 *
 * DELETE /api/push-subscribe — 푸시 구독 해제
 *   Body: { endpoint }
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'server_not_configured' });
  }

  // 토큰 → user_id
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'invalid_token' });
    const u = await userRes.json();
    userId = u?.id;
  } catch {
    return res.status(401).json({ error: 'auth_failed' });
  }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&endpoint=eq.${encodeURIComponent(endpoint)}`,
      { method: 'DELETE', headers: { ...sbHeaders, Prefer: 'return=minimal' } }
    );
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { endpoint, keys, kinds, user_agent } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'invalid_subscription' });
  }

  // upsert (user_id + endpoint 유일)
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=user_id,endpoint`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      endpoint,
      keys_p256dh: keys.p256dh,
      keys_auth: keys.auth,
      user_agent: user_agent || null,
      enabled_kinds: kinds || undefined,
      updated_at: new Date().toISOString()
    })
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    console.error('push-subscribe upsert error:', err);
    return res.status(500).json({ error: 'save_failed' });
  }

  return res.status(200).json({ ok: true });
};
