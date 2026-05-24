/**
 * POST /api/track-lead
 * 범용 리드 캡처 엔드포인트 — 모든 리드마그넷에서 호출
 *
 * Body: { source, email, ref_code, name?, extra? }
 * source: 'saju' | 'branding-coach' | 'quiz' | 'success-test' | 'health-check'
 *
 * 처리: ref_code로 파트너/팀 찾기 → leads 테이블에 저장
 * (source별 별도 엔드포인트 만들 필요 없이 이 하나로 통일)
 */

const ALLOWED_SOURCES = ['saju', 'branding-coach', 'quiz', 'success-test', 'health-check'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { source, email, ref_code, name, extra } = req.body || {};

  if (!source || !ALLOWED_SOURCES.includes(source)) {
    return res.status(400).json({ error: 'invalid source' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '올바른 이메일이 필요합니다' });
  }

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase 설정이 필요합니다' });
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };

  let partnerId = null;
  let teamId = null;

  if (ref_code) {
    // 1차: business_code 매치
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?business_code=eq.${encodeURIComponent(ref_code)}&select=id,team_id&limit=1`,
      { headers }
    );
    const profiles = await profileRes.json().catch(() => []);
    if (profiles?.[0]) {
      partnerId = profiles[0].id;
      teamId = profiles[0].team_id;
    }

    // 2차: id prefix 매치 (ref_code가 id 기반일 때)
    if (!partnerId) {
      const profileRes2 = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=id,team_id`,
        { headers }
      );
      const allProfiles = await profileRes2.json().catch(() => []);
      const match = (allProfiles || []).find(p =>
        p.id.replace(/-/g, '').slice(0, 8).toUpperCase() === ref_code.toUpperCase()
      );
      if (match) {
        partnerId = match.id;
        teamId = match.team_id;
      }
    }
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source,
      email,
      team_id: teamId || null,
      quiz_result: {
        ref_code: ref_code || null,
        partner_id: partnerId || null,
        name: name || null,
        extra: extra || null,
      },
    }),
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.error('track-lead insert error:', errText);
    return res.status(500).json({ error: '저장 실패' });
  }

  return res.status(200).json({ ok: true, partner_id: partnerId, team_id: teamId });
};
