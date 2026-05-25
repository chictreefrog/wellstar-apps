const webpush = require('web-push');

/**
 * 내부 푸시 발송 헬퍼 (다른 api 파일에서 require해서 사용)
 *
 * sendPushToUsers(userIds, payload, kind?)
 *   - userIds: uuid[]
 *   - payload: { title, body, url?, icon?, badge?, tag? }
 *   - kind: 'referral'|'announcement'|'followup'|'challenge'|'insight'
 *           해당 종류 알림이 사용자 설정에서 켜져있을 때만 발송
 */

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT || 'mailto:info@wellstar.life';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(sub, pub, priv);
  vapidConfigured = true;
  return true;
}

async function sendPushToUsers(userIds, payload, kind = null) {
  if (!Array.isArray(userIds) || userIds.length === 0) return { sent: 0, errors: 0 };
  if (!ensureVapid()) return { sent: 0, errors: 0, reason: 'vapid_not_configured' };

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return { sent: 0, errors: 0, reason: 'no_supabase' };

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 대상 사용자들의 구독 조회
  const inList = userIds.map(id => `"${id}"`).join(',');
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=in.(${inList})&select=user_id,endpoint,keys_p256dh,keys_auth,enabled_kinds`,
    { headers: sbHeaders }
  );
  if (!subsRes.ok) return { sent: 0, errors: 0, reason: 'sub_query_failed' };
  const subs = await subsRes.json();

  const notification = JSON.stringify({
    title: payload.title || '옆집디노',
    body: payload.body || '',
    url: payload.url || '/main/',
    icon: payload.icon || '/main/icon-192.png',
    badge: payload.badge || '/main/icon-192.png',
    tag: payload.tag || kind || 'dino-default'
  });

  let sent = 0;
  let errors = 0;
  const deadEndpoints = [];

  for (const s of subs || []) {
    // kind 필터: 사용자가 해당 종류 알림을 꺼뒀으면 skip
    if (kind && s.enabled_kinds && s.enabled_kinds[kind] === false) continue;

    const subscription = {
      endpoint: s.endpoint,
      keys: { p256dh: s.keys_p256dh, auth: s.keys_auth }
    };
    try {
      await webpush.sendNotification(subscription, notification);
      sent++;
    } catch (err) {
      errors++;
      // 410 Gone / 404 Not Found = 구독 만료
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadEndpoints.push(s.endpoint);
      }
    }
  }

  // 죽은 구독 정리
  if (deadEndpoints.length > 0) {
    const filterParts = deadEndpoints.map(e => `endpoint.eq.${encodeURIComponent(e)}`).join(',');
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?or=(${filterParts})`,
      { method: 'DELETE', headers: { ...sbHeaders, Prefer: 'return=minimal' } }
    ).catch(() => {});
  }

  return { sent, errors, dead_cleaned: deadEndpoints.length };
}

module.exports = { sendPushToUsers };
