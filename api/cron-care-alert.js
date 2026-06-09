const crypto = require('crypto');

/**
 * Vercel Cron: 매일 KST 10:00 (UTC 01:00) — 안심케어 안부 알림
 * 부모님이 alert_after_days일 이상 체크인이 없으면 자녀(guardian_phone)에게 솔라피 LMS 발송.
 * 한 무응답 구간에 1회만 발송(중복 방지). 다시 체크인 후 또 끊기면 재발송.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'unauthorized' });
  }

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  const SOLAPI_KEY = process.env.SOLAPI_API_KEY;
  const SOLAPI_SECRET = process.env.SOLAPI_API_SECRET;
  const SOLAPI_SENDER = process.env.SOLAPI_SENDER;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'no_supabase' });
  if (!SOLAPI_KEY || !SOLAPI_SECRET || !SOLAPI_SENDER) return res.status(500).json({ error: 'no_solapi' });

  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // 후보: 마지막 활동이 1일보다 오래된 가입자 (행별 임계는 아래 JS에서)
  const cutoff = new Date(Date.now() - 1 * 86400000).toISOString();
  let subs = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/care_subscribers?last_active=lt.${encodeURIComponent(cutoff)}&select=*&limit=1000`,
      { headers: sbHeaders }
    );
    subs = await r.json();
  } catch { return res.status(500).json({ error: 'fetch_failed' }); }
  if (!Array.isArray(subs)) subs = [];

  const now = Date.now();
  let sent = 0;
  for (const s of subs) {
    try {
      const lastActive = s.last_active ? new Date(s.last_active).getTime() : 0;
      if (!lastActive) continue;
      const days = Math.floor((now - lastActive) / 86400000);
      const threshold = s.alert_after_days || 2;
      if (days < threshold) continue;

      // 이번 무응답 구간에 이미 보냈으면 skip
      const lastAlerted = s.last_alerted_at ? new Date(s.last_alerted_at).getTime() : 0;
      if (lastAlerted && lastAlerted >= lastActive) continue;

      let to = String(s.guardian_phone || '').replace(/\D/g, '');
      if (to.length < 10) continue;
      if (to.startsWith('82')) to = '0' + to.substring(2);

      const pn = s.parent_name || '부모님';
      const parentHonor = pn.endsWith('님') ? pn : pn + '님';   // "어머니"→"어머니님", "부모님"→그대로
      const text = `[옆집디노 안심케어]\n${s.guardian_name ? s.guardian_name + '님, ' : ''}${parentHonor}이 ${days}일째 안부 체크인이 없어요.\n한 번 연락해보시겠어요? 🙏`;

      const date = new Date().toISOString();
      const salt = crypto.randomBytes(32).toString('hex');
      const signature = crypto.createHmac('sha256', SOLAPI_SECRET).update(date + salt).digest('hex');
      const authHeader = `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`;

      const smsRes = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ to, from: SOLAPI_SENDER, text, type: 'LMS', subject: '안심케어 안부 알림' }] }),
      });

      if (smsRes.ok) {
        sent++;
        await fetch(`${SUPABASE_URL}/rest/v1/care_subscribers?id=eq.${s.id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ last_alerted_at: new Date().toISOString() }),
        });
        // 영업인 귀속 집계 (ref → inviter_id) — 비용 모니터링/청구용
        let inviterId = null;
        if (s.ref) {
          try {
            const ir = await fetch(`${SUPABASE_URL}/rest/v1/profiles?business_code=eq.${encodeURIComponent(String(s.ref).toUpperCase())}&select=id&limit=1`, { headers: sbHeaders });
            inviterId = (await ir.json())[0]?.id || null;
          } catch {}
        }
        await fetch(`${SUPABASE_URL}/rest/v1/customer_ai_log`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ inviter_id: inviterId, source: 'care_sms', lead_phone: to }),
        }).catch(() => {});
      } else {
        console.error('[cron-care-alert] solapi fail', await smsRes.text());
      }
    } catch (e) {
      console.error('[cron-care-alert] row error', e);
    }
  }

  return res.status(200).json({ ok: true, checked: subs.length, sent });
};
