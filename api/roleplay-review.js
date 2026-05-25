const { GoogleGenAI } = require('@google/genai');

/**
 * POST /api/roleplay-review
 * 끝난 롤플레이 대화에 대한 옆집디노 코치의 회고 생성
 *
 * Body: { session_id }
 * Header: Authorization: Bearer <access_token>
 *
 * 응답: { review: { good, improve, summary, next_step } }
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });

  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await r.json())?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }

  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

  // 세션 조회 (본인 세션인지 확인)
  const sessRes = await fetch(
    `${SUPABASE_URL}/rest/v1/roleplay_sessions?id=eq.${session_id}&user_id=eq.${userId}&select=*`,
    { headers: sbHeaders }
  );
  const sessions = await sessRes.json();
  if (!sessions || !sessions[0]) return res.status(404).json({ error: 'session_not_found' });
  const sess = sessions[0];

  // 대화 텍스트 구성
  const messages = sess.messages || [];
  if (messages.length === 0) return res.status(400).json({ error: 'empty_session' });

  const dialog = messages.map(m =>
    `${m.role === 'user' ? '👤 영업인' : '🤖 고객'}: ${m.content}`
  ).join('\n');

  const prompt = `당신은 옆집디노라는 NM 영업 코치입니다. 방금 끝난 영업 롤플레이를 보고 영업인에게 따뜻하고 구체적인 회고를 해주세요.

[페르소나]
${sess.persona_name} (${sess.persona_id})
[난이도] ${sess.level}
[추가 정보] ${sess.custom_context || '없음'}

[대화 내용]
${dialog}

[작성 원칙]
- 잘한 점, 개선점은 대화 속 구체적인 한마디를 인용해서 짚어주기
- NM 영업의 본질(관계 → 신뢰 → 가치 → 권유) 기준
- "당신은 강해요" 같은 공허한 칭찬 X, 구체적 행동·표현 칭찬
- 개선점은 비난 X, "이렇게 해보면 더 좋겠어요" 톤
- next_step은 다음 롤플레이에서 시도할 작은 행동 한 가지

[출력 형식 — 반드시 다음 JSON, 다른 설명 금지]
{
  "good": "잘한 점 (구체적 행동 인용, 2~3줄)",
  "improve": "개선점 (구체적 인용 + 더 좋은 방법 제안, 2~3줄)",
  "summary": "핵심 한 줄 — 이번 대화에서 가장 중요한 교훈",
  "next_step": "다음에 시도할 작은 행동 한 가지"
}`;

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let review;
  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: 'application/json' }
    });
    const text = (response.text || '').trim().replace(/^```json\n?/i, '').replace(/```\s*$/i, '').trim();
    review = JSON.parse(text);
  } catch (err) {
    console.error('roleplay-review error:', err);
    return res.status(503).json({ error: 'ai_unavailable' });
  }

  if (!review?.good || !review?.improve || !review?.summary) {
    return res.status(503).json({ error: 'ai_format' });
  }

  // DB 업데이트
  await fetch(`${SUPABASE_URL}/rest/v1/roleplay_sessions?id=eq.${session_id}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      review,
      completed: true,
      updated_at: new Date().toISOString()
    })
  }).catch(() => {});

  return res.status(200).json({ review });
};
