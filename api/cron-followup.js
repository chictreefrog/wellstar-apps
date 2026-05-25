/**
 * Vercel Cron: 매일 KST 09:00 (UTC 00:00) — 팔로업 알림
 * 모든 활성 사용자에게 일반 알림 발송 (오늘 팔로업 확인 유도)
 * → enabled_kinds.followup === false 인 사용자는 자동 제외
 */

module.exports = async function handler(req, res) {
  // Vercel Cron은 GET 호출
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  // Vercel Cron Secret 검증 (보안)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'no_supabase' });

  // 모든 활성 사용자 ID 조회 (게스트 제외, 사업자만)
  const profsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?is_active=eq.true&role=in.(partner,leader,admin)&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const profs = await profsRes.json();
  const userIds = (profs || []).map(p => p.id);

  if (userIds.length === 0) return res.status(200).json({ ok: true, sent: 0 });

  const { sendPushToUsers } = require('./_push-send');
  const result = await sendPushToUsers(userIds, {
    title: '📋 오늘의 팔로업',
    body: '오늘 연락할 고객 확인하셨나요? 다이어리에서 체크해보세요!',
    url: '/diary/'
  }, 'followup');

  return res.status(200).json({ ok: true, target: userIds.length, ...result });
};
