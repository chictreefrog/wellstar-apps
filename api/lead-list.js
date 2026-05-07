/**
 * GET /api/lead-list?team_id=xxx&ref_code=yyy
 * 특정 ref_code(또는 팀 전체)의 리드 목록 반환
 * 서버키로 RLS 우회
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase 설정 필요' });
  }

  const { team_id, ref_code } = req.query;
  if (!team_id) return res.status(400).json({ error: 'team_id 필요' });

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    let url = `${SUPABASE_URL}/rest/v1/leads?team_id=eq.${encodeURIComponent(team_id)}&source=eq.saju&select=email,quiz_result,created_at&order=created_at.desc&limit=100`;
    if (ref_code) {
      url += `&quiz_result->>ref_code=eq.${encodeURIComponent(ref_code)}`;
    }

    const leadsRes = await fetch(url, { headers });
    const leads = await leadsRes.json();

    const list = (leads || []).map(l => ({
      email: l.email,
      name: l.quiz_result?.name || null,
      birth_date: l.quiz_result?.birth_date || null,
      ref_code: l.quiz_result?.ref_code || null,
      saju_type: l.quiz_result?.saju_result?.result_type || null,
      day_master: l.quiz_result?.saju_result?.day_master || null,
      created_at: l.created_at,
    }));

    return res.status(200).json({ leads: list, total: list.length });
  } catch (err) {
    console.error('lead-list error:', err);
    return res.status(500).json({ error: '조회 실패' });
  }
};
