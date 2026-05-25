/**
 * POST /api/notify-announcement
 * 공지사항 작성 후 같은 팀 멤버들에게 푸시
 *
 * Body: { team_id, title, content }
 * Header: Authorization: Bearer <access_token>
 * (작성자 본인은 알림 대상에서 제외)
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { team_id, title, content } = req.body || {};
  if (!team_id) return res.status(400).json({ error: 'team_id required' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  // 작성자 확인
  let authorId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    const u = await r.json();
    authorId = u?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 같은 팀 멤버 ID 조회 (본인 제외)
  const membersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?team_id=eq.${team_id}&is_active=eq.true&select=id`,
    { headers: sbHeaders }
  );
  const members = await membersRes.json();
  const targetIds = (members || []).map(m => m.id).filter(id => id !== authorId);

  if (targetIds.length === 0) return res.status(200).json({ ok: true, sent: 0 });

  const { sendPushToUsers } = require('./_push-send');
  const result = await sendPushToUsers(targetIds, {
    title: `📢 새 공지: ${(title || '').slice(0, 30)}`,
    body: (content || '').slice(0, 80),
    url: '/team/?tab=announce'
  }, 'announcement');

  return res.status(200).json({ ok: true, ...result });
};
