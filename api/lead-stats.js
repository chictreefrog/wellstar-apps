/**
 * GET /api/lead-stats?team_id=xxx
 * 팀의 리드 통계 반환 (saju source 기준)
 * 서버키를 사용하여 RLS 우회
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase 설정이 필요합니다' });
  }

  const { team_id, ref_code } = req.query;
  if (!team_id) {
    return res.status(400).json({ error: 'team_id 필요' });
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // 해당 팀의 모든 saju 리드 조회
    const url = `${SUPABASE_URL}/rest/v1/leads?team_id=eq.${encodeURIComponent(team_id)}&source=eq.saju&select=quiz_result`;
    const leadsRes = await fetch(url, { headers });
    const leads = await leadsRes.json();

    // ref_code 별 카운트 집계
    const countMap = {};
    (leads || []).forEach(l => {
      const r = l.quiz_result?.ref_code;
      if (r) countMap[r] = (countMap[r] || 0) + 1;
    });

    // 특정 ref_code 개인 카운트도 포함
    const myCount = ref_code ? (countMap[ref_code] || 0) : null;

    return res.status(200).json({
      countMap,        // { "36928892": 3, "79302382": 1, ... }
      total: (leads || []).length,
      myCount,         // 특정 ref_code의 카운트 (파트너 개인 뷰용)
    });
  } catch (err) {
    console.error('lead-stats error:', err);
    return res.status(500).json({ error: '조회 실패' });
  }
};
