/**
 * POST /api/push-test
 * 본인에게 테스트 알림 발송 (디버깅 / 사용자가 알림 잘 오는지 확인용)
 *
 * Header: Authorization: Bearer <access_token>
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

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    const u = await r.json();
    userId = u?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }

  const { sendPushToUsers } = require('./_push-send');
  const result = await sendPushToUsers([userId], {
    title: '🦕 옆집디노 테스트 알림',
    body: '알림이 잘 도착했어요! 영업 성공을 응원합니다 💪',
    url: '/main/'
  });

  return res.status(200).json({ ok: true, ...result });
};
