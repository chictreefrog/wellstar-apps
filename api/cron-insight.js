/**
 * Vercel Cron: 매일 KST 08:00 (UTC 23:00 전날) — AI 인사이트
 */

const INSIGHTS = [
  '"고객의 아니요는 끝이 아니라, 더 좋은 질문을 할 기회예요." — 30초 만에 YES',
  '"오늘 3명에게 연락하면, 1주일 후 1명이 고객이 됩니다." — 세일즈 법칙',
  '"거절을 두려워하지 마세요. 거절은 성공까지의 거리를 줄여줍니다." — 옆집디노',
  '"꾸준함이 재능을 이깁니다. 매일 조금씩, 그게 비밀이에요." — 성공하는 영업인의 습관',
  '"첫 만남에서 팔지 마세요. 관계를 먼저 쌓으세요." — 신뢰 기반 세일즈',
  '"팔로업은 귀찮은 게 아니라, 고객을 향한 관심의 표현이에요." — 옆집디노',
  '"말을 줄이고 질문을 늘리세요. 고객은 답하면서 스스로 설득됩니다." — 30초 만에 YES',
  '"완벽한 타이밍은 없어요. 지금 연락하는 사람이 이깁니다." — 세일즈 법칙',
  '"하루 한 명에게 진심을 전하면, 1년 뒤 365개의 인연이 남습니다."',
  '"오늘의 거절은 내일의 노하우가 됩니다."'
];

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

  const msg = INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)];
  const { sendPushToUsers } = require('./_push-send');
  const result = await sendPushToUsers(userIds, {
    title: '💡 Today\'s AI 인사이트',
    body: msg,
    url: '/main/'
  }, 'insight');

  return res.status(200).json({ ok: true, target: userIds.length, ...result });
};
