module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, birth_date, ref_code, saju_result } = req.body || {};
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

  // ref_code로 파트너 찾기 → team_id 조회
  let partnerId = null;
  let teamId = null;

  if (ref_code) {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?business_code=eq.${encodeURIComponent(ref_code)}&select=id,team_id&limit=1`,
      { headers }
    );
    const profiles = await profileRes.json();
    if (profiles?.[0]) {
      partnerId = profiles[0].id;
      teamId = profiles[0].team_id;
    }

    // business_code로 못 찾으면 id prefix로 시도 (ref_code가 id 기반인 경우)
    if (!partnerId) {
      const profileRes2 = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=id,team_id`,
        { headers }
      );
      const allProfiles = await profileRes2.json();
      const match = (allProfiles || []).find(p =>
        p.id.replace(/-/g, '').slice(0, 8).toUpperCase() === ref_code.toUpperCase()
      );
      if (match) {
        partnerId = match.id;
        teamId = match.team_id;
      }
    }
  }

  // leads 테이블에 저장
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: 'saju',
      email,
      team_id: teamId || null,
      quiz_result: {
        ref_code: ref_code || null,
        partner_id: partnerId || null,
        name: name || null,
        birth_date: birth_date || null,
        saju_result: saju_result || null,
      },
    }),
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    console.error('Supabase insert error:', err);
    return res.status(500).json({ error: '저장 실패' });
  }

  return res.status(200).json({ ok: true, partner_id: partnerId, team_id: teamId });
};
