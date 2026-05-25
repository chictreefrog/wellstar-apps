/**
 * POST /api/set-inviter
 * 게스트 가입 후 추천인 정보(invited_by) 설정
 *
 * Header: Authorization: Bearer <access_token>
 * Body:   { ref: '사업자번호 또는 id-prefix' }
 *
 * 처리:
 * - 토큰 → 본인 user_id
 * - ref → 추천인 profile.id 검색 (business_code 우선, 없으면 id prefix)
 * - 본인 profile에 invited_by가 비어있으면 추천인 ID 저장
 * - 이미 invited_by가 있으면 덮어쓰지 않음 (게스트 → 사업자 전환 시 기존 추천 유지)
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { ref } = req.body || {};
  if (!ref || typeof ref !== 'string') {
    return res.status(400).json({ error: 'ref required' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'server_not_configured' });
  }

  // 1. 토큰으로 본인 user_id 확인
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'invalid_token' });
    const u = await userRes.json();
    userId = u?.id;
  } catch (e) {
    return res.status(401).json({ error: 'auth_failed' });
  }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  const cleanRef = ref.trim().toUpperCase();
  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 2. ref → 추천인 profile 찾기
  let inviterId = null;

  // 2a. business_code 매치
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?business_code=eq.${encodeURIComponent(cleanRef)}&select=id&limit=1`,
      { headers: sbHeaders }
    );
    const rows = await r.json();
    if (rows?.[0]) inviterId = rows[0].id;
  } catch {}

  // 2b. id prefix 매치 (8자리 대문자)
  if (!inviterId) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id`, { headers: sbHeaders });
      const all = await r.json();
      const match = (all || []).find(p =>
        p.id.replace(/-/g, '').slice(0, 8).toUpperCase() === cleanRef
      );
      if (match) inviterId = match.id;
    } catch {}
  }

  if (!inviterId) {
    return res.status(404).json({ error: 'inviter_not_found' });
  }

  if (inviterId === userId) {
    return res.status(400).json({ error: 'self_invite_not_allowed' });
  }

  // 3. 본인 profile의 현재 invited_by 확인
  try {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=invited_by`,
      { headers: sbHeaders }
    );
    const myProfile = await checkRes.json();
    if (myProfile?.[0]?.invited_by) {
      return res.status(200).json({ ok: true, already_set: true });
    }
  } catch {}

  // 4. invited_by 저장
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      invited_by: inviterId,
      updated_at: new Date().toISOString()
    })
  });

  if (!patchRes.ok) {
    const err = await patchRes.text();
    console.error('set-inviter patch error:', err);
    return res.status(500).json({ error: 'save_failed' });
  }

  // 추천인에게 푸시 알림 (비동기, 응답 블로킹 안 함)
  try {
    const meRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=display_name`,
      { headers: sbHeaders }
    );
    const me = (await meRes.json())[0];
    const name = me?.display_name || '신규 회원';
    const { sendPushToUsers } = require('./_push-send');
    sendPushToUsers([inviterId], {
      title: '🎉 새 회원이 가입했어요!',
      body: `${name}님이 당신의 추천으로 가입했어요`,
      url: '/team/?tab=invite'
    }, 'referral').catch(() => {});
  } catch {}

  return res.status(200).json({ ok: true, inviter_id: inviterId });
};
