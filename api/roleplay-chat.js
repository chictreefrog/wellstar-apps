const { GoogleGenAI } = require('@google/genai');

/**
 * POST /api/roleplay-chat
 * 롤플레이 메시지 보내고 AI 고객 응답 받기
 *
 * Body: { session_id?, persona_id, persona_name, custom_context, level, history, message }
 * Header: Authorization: Bearer <access_token>
 *
 * 세션 관리:
 * - session_id 없으면 새 세션 시작 + 일일 한도 체크 (게스트 1 / 회원 5)
 * - 있으면 기존 세션 이어서, history는 클라가 보내고 서버는 messages 업데이트
 *
 * 응답: { reply, session_id, turn_count, remaining }
 */

const NM_PERSONAS = {
  friend: { name: '친한 지인', system: `당신은 영업인의 오래된 친구(30대)입니다. 영업 권유에 '친해서 부담스럽다, 부탁받기 싫다'는 반응. 진심으로 영업인을 걱정하지만 본인은 안 함. NM에 대한 어렴풋한 부정 인식이 있어요. 영업인이 강압적이면 더 닫히고, 친구로서 진심 어린 접근에 살짝 흔들립니다.` },
  conservative: { name: '보수적인 어른', system: `당신은 50대 이상 보수적인 분입니다. NM=다단계=사기라는 인식이 강합니다. '다단계 아니야?' '신문에서 봤는데...' 같이 의심으로 시작. 절대 빨리 안 풀림. 진정성과 시간으로만 조금씩 마음을 열어요. 한 번에 안 넘어갑니다.` },
  busy_office: { name: '바쁜 직장인', system: `당신은 30대 직장인입니다. 항상 바쁘고 피곤합니다. '관심 없어요' '바빠요' 같은 짧은 답이 기본. 사이드잡엔 부정적 인식이 있지만, 속으론 수입 늘리는 데 관심 있음(절대 먼저 말 안 함). 영업인이 시간 가치를 인정해주면 잠시 듣습니다.` },
  mom_budget: { name: '육아맘', system: `당신은 30~40대 육아맘입니다. 가계 빠듯해서 '지금 이런 데 쓸 돈 없다'가 1순위 거절. 아이가 우선. 본인 시간·수입에 갈망 있지만 표현 안 함. 건강은 챙기고 싶어함. 영업인이 아이·가족 가치를 진심으로 이해해주면 마음 조금 열립니다.` },
  student: { name: '학생/취준생', system: `당신은 20대 초중반 학생/취준생입니다. 돈도 시간도 없다 주장. NM 부정 인식 강함(인터넷 후기). 다만 미래 불안과 수입 욕구는 강합니다(숨김). 또래의 실제 사례나 작은 시작점을 제시하면 호기심 생김.` },
  self_employed: { name: '자영업 사장', system: `당신은 40~50대 자영업 사장입니다. 본업 위기감 커요. '내 가게 살리기도 벅차'가 첫 거절. 손님 수 줄고 매출 압박. 새 수익원에 속으론 관심 있음(인정 안 함). 영업인이 사장님의 현실을 이해하는 톤으로 다가오면 짧게 들어줍니다.` },
  health_curious: { name: '건강 관심층', system: `당신은 40대로 건강·운동·영양제에 관심 많아요. NM 제품 자체엔 호기심. 다만 '왜 굳이 너희 제품?' 가치 검증을 강하게 요구. 비교 분석을 좋아하고 가격 부담을 솔직히 표현. 데이터·근거가 있으면 흔들립니다.` },
  ex_nm: { name: 'NM 경험자', system: `당신은 30~40대로 과거 1~2년 NM 시도하다 실패한 경험이 있습니다. 트라우마. '그거 안 돼' '다 똑같다'가 첫 반응. 다만 '왜 내가 실패했지?'라는 무의식 질문은 살아있음. 차별점·시스템 차이를 명확히 보여주면 흔들립니다.` }
};

const LEVEL_GUIDE = {
  soft: '소프트 모드: 약간의 거부감만 표시. 영업인의 진정성 있는 접근에 비교적 빨리 호응. 흔들림 자주 표현.',
  normal: '일반 모드: 보통의 거부감. 영업인이 잘 설득하면 반응. 자연스러운 실전 수준.',
  hard: '어려움 모드: 강한 거부감. 짧고 단호한 답. 진심·가치 증명이 충분해야만 살짝 흔들림.'
};

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
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'server_not_configured' });
  }

  // 1. 사용자 인증
  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    const u = await r.json();
    userId = u?.id;
  } catch { return res.status(401).json({ error: 'auth_failed' }); }

  const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  const { session_id, persona_id, custom_context, level, history, message, mode } = req.body || {};
  const sessionMode = (mode === 'reverse') ? 'reverse' : 'normal';
  const isReverseFirstTurn = sessionMode === 'reverse' && (!history || history.length === 0) && !message;
  if (!message && !isReverseFirstTurn) return res.status(400).json({ error: 'message required' });
  if (!persona_id) return res.status(400).json({ error: 'persona_id required' });

  // 2. role 확인 → 일일 한도
  let role = 'guest';
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, { headers: sbHeaders });
    const rows = await r.json();
    if (rows[0]?.role) role = rows[0].role;
  } catch {}
  // 무료 한도: 회원 3회/일 (1회 = 최대 10턴 = 사용자 답변 10번)
  const dailyQuota = role === 'guest' ? 1 : 3;

  // 3. 새 세션이면 일일 한도 체크 + 생성
  let sessionId = session_id;
  let turnCount = (history || []).length / 2; // user+model 페어

  if (!sessionId) {
    // KST 자정 이후 새로 시작한 세션 수
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    kstNow.setUTCHours(0, 0, 0, 0);
    const kstMidnight = new Date(kstNow.getTime() - 9 * 3600 * 1000);

    let todayCount = 0;
    try {
      const cntRes = await fetch(
        `${SUPABASE_URL}/rest/v1/roleplay_sessions?user_id=eq.${userId}&created_at=gte.${encodeURIComponent(kstMidnight.toISOString())}&select=id`,
        { method: 'HEAD', headers: { ...sbHeaders, Prefer: 'count=exact', Range: '0-0' } }
      );
      const cr = cntRes.headers.get('content-range') || '';
      const m = cr.match(/\/(\d+)$/);
      if (m) todayCount = parseInt(m[1], 10);
    } catch {}

    if (todayCount >= dailyQuota) {
      const msg = role === 'guest'
        ? `오늘 무료 사용 한도(${dailyQuota}회)에 도달했어요. 팀 합류 시 하루 ${dailyQuota * 3}회 + 사용권 구매로 더 가능!`
        : `오늘 사용 한도(${dailyQuota}회 · 1회 = 최대 10턴 대화)에 도달했어요. 사용권을 구매하거나 내일 다시 시도해주세요.`;
      return res.status(429).json({ error: 'rate_limit', used: todayCount, limit: dailyQuota, role, message: msg });
    }

    // 새 세션 생성
    const personaName = NM_PERSONAS[persona_id]?.name || (persona_id === 'custom' ? '자유 시나리오' : persona_id);
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/roleplay_sessions`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        persona_id,
        persona_name: personaName,
        custom_context: custom_context || null,
        level: level || 'normal',
        mode: sessionMode,
        messages: [],
        turn_count: 0
      })
    });
    if (!insertRes.ok) return res.status(500).json({ error: 'session_create_failed' });
    const newRow = (await insertRes.json())[0];
    sessionId = newRow.id;
    turnCount = 0;
  }

  // 4. Gemini 시스템 프롬프트 구성 (mode별로 다름)
  const personaCfg = NM_PERSONAS[persona_id];
  const personaSystem = personaCfg ? personaCfg.system : '당신은 일반 한국 성인입니다.';
  const levelGuide = LEVEL_GUIDE[level] || LEVEL_GUIDE.normal;
  const extraContext = custom_context ? `\n\n[추가 정보]\n${custom_context}` : '';

  let systemPrompt;
  if (sessionMode === 'reverse') {
    // reverse: AI=영업인, 사용자=고객 (페르소나 연기)
    systemPrompt = `당신은 옆집디노 NM 세일즈 베테랑입니다. 사용자는 아래 페르소나의 고객을 연기하고 있고, 당신은 그 고객을 자연스럽고 진정성 있게 설득하는 NM 영업인 역할을 합니다.

[고객 페르소나 — 사용자가 연기 중]
${personaSystem}
${extraContext}

[고객의 거절 강도]
${levelGuide}

[영업인 역할 원칙]
1. 첫 메시지는 자연스러운 인사·접근 — 영업 티 나지 않게, 따뜻한 한 마디로 시작.
2. 답변은 1~3문장으로 짧게. 실제 카톡·대화처럼.
3. 고객의 거절·회피를 먼저 인정하고 공감 → 그 다음 다른 관점·가치 제시.
4. 한 번에 다 팔지 말 것 — 관계 → 신뢰 → 가치 → 권유 순서.
5. 강압·과장 절대 금지. NM의 윤리적 접근만.
6. 구체적 비유·사례·경험담 활용 (예: "저도 처음엔 그랬어요").
7. 고객이 마음을 닫으면 더 밀지 말고 한 발 물러서기 ("부담드린 거면 죄송해요").
8. 마크다운 금지. 일반 텍스트만.`;
  } else {
    // normal: AI=고객, 사용자=영업인 (기존)
    systemPrompt = `당신은 옆집디노 NM 영업인이 다가오는 상황의 '고객 역할'입니다. 영업 코치가 아니라 진짜 고객처럼 답변하세요.

[페르소나]
${personaSystem}
${extraContext}

[난이도]
${levelGuide}

[역할 원칙 — 반드시 지키세요]
1. 답변은 한국어 1~3문장으로 짧게. 실제 카톡·만남 대화처럼 자연스럽게.
2. 거절·회피 톤이 기본. 영업인 말에 따라 흔들림 정도를 표현.
3. 영업인이 강압적이거나 빠르게 팔려고 하면 더 닫힘.
4. 영업인이 공감·질문·관계로 다가오면 살짝 열림.
5. 자신의 본명·세부 정보는 처음엔 안 알려줌. 신뢰 쌓이면 조금씩.
6. 절대 영업인 모드로 변하지 말 것 — 끝까지 고객 페르소나 유지.
7. 마크다운(#, **, ---) 금지, 일반 대화 텍스트만.
8. 영업인이 "지금 어땠어요?" 같은 메타 질문하면 "지금 대화 중이에요" 같이 캐릭터 유지.`;
  }

  // 5. Gemini 호출
  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const contents = [];
  (history || []).forEach(m => {
    contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] });
  });
  if (isReverseFirstTurn) {
    // reverse 모드 첫 턴: 시드 user 신호로 AI(영업인) 첫 인사 생성
    contents.push({ role: 'user', parts: [{ text: '[시작 신호 — 영업인 입장에서 자연스러운 첫 인사·접근을 한국어로 해주세요. 1~2문장으로 짧고 따뜻하게. 사용자에겐 이 신호가 보이지 않습니다.]' }] });
  } else {
    contents.push({ role: 'user', parts: [{ text: message }] });
  }

  // maxOutputTokens 400 → 800 (한국어 자연 답변 약 200~300자에 여유)
  // finishReason 체크 + 1회 재시도 (다이어리/회고 패턴 적용)
  let reply = '';
  async function callGemini(maxTokens) {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: { systemInstruction: systemPrompt, temperature: 0.9, maxOutputTokens: maxTokens }
    });
    const text = (response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
    return { text, finishReason };
  }

  try {
    let result = await callGemini(800);
    console.log(`[roleplay-chat] turn ${turnCount} finishReason=${result.finishReason} len=${result.text.length}`);

    // MAX_TOKENS로 잘렸으면 더 큰 토큰으로 1회 재시도
    if (result.finishReason === 'MAX_TOKENS') {
      console.warn('[roleplay-chat] MAX_TOKENS hit, retrying with 1500');
      result = await callGemini(1500);
    }

    reply = result.text;
    if (!reply) throw new Error('empty_response');

    // 그래도 잘렸으면 에러 (사용자에게 명확히 알림)
    if (result.finishReason === 'MAX_TOKENS') {
      return res.status(503).json({
        error: 'ai_truncated',
        message: '답변이 너무 길어 끊겼어요. 다시 한 번 시도해주세요.',
        partial: reply
      });
    }
  } catch (err) {
    console.error('roleplay gemini error:', err);
    return res.status(503).json({ error: 'ai_unavailable', message: 'AI 응답 실패. 잠시 후 다시 시도해주세요.' });
  }

  // 6. 세션 메시지 업데이트
  // reverse 첫 턴은 시드 user 메시지를 저장하지 않음 (AI 인사만 저장)
  const newMessages = isReverseFirstTurn
    ? (history || []).concat([{ role: 'model', content: reply, ts: Date.now() }])
    : (history || []).concat([
        { role: 'user', content: message, ts: Date.now() },
        { role: 'model', content: reply, ts: Date.now() }
      ]);
  // turn_count = 사용자가 보낸 메시지 수 (실제 대응 횟수)
  turnCount = newMessages.filter(m => m.role === 'user').length;

  await fetch(`${SUPABASE_URL}/rest/v1/roleplay_sessions?id=eq.${sessionId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      messages: newMessages,
      turn_count: turnCount,
      updated_at: new Date().toISOString()
    })
  }).catch(() => {});

  return res.status(200).json({
    reply,
    session_id: sessionId,
    turn_count: turnCount,
    role,
    limit: dailyQuota
  });
};
