/**
 * Vercel Cron: 매일 KST 19:00 (UTC 10:00) — 챌린지 미션 리마인드
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'unauthorized' });
  }

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'no_supabase' });

  const profsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?is_active=eq.true&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const profs = await profsRes.json();
  const userIds = (profs || []).map(p => p.id);
  if (userIds.length === 0) return res.status(200).json({ ok: true, sent: 0 });

  const { sendPushToUsers } = require('./_push-send');
  const result = await sendPushToUsers(userIds, {
    title: '🏆 오늘 챌린지 어떠셨어요?',
    body: '오늘의 미션을 기록해두면 영업 근육이 자라요 💪',
    url: '/challenge/'
  }, 'challenge');

  return res.status(200).json({ ok: true, target: userIds.length, ...result });
};
