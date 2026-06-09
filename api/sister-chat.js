const { GoogleGenAI } = require('@google/genai');

/**
 * POST /api/sister-chat
 * "디노 언니" — 언니들의 살롱(salon)의 AI 1:1 채팅. 앱의 영혼.
 *
 * Body: { message, history:[{role:'user'|'sister', text}], name, ageBand }
 * Resp: { reply }
 *
 * - 모델: Gemini 2.5 Flash (레포 표준). 503/빈응답 시 1회 재시도 → 따뜻한 폴백.
 * - CORS: 인라인 명시 헤더 (cors.js import 금지 — 기존 교훈).
 * - ★ 조용한 안전망: 서버에서 진짜 위기 신호를 감지하면, 디노 언니가
 *   그 사람에게만 따뜻하게 기댈 곳을 안내한다. 방법·수단은 절대 다루지 않음.
 *   앱 전체엔 노출하지 않고, 1:1 대화 안에서 그 한 명을 위해서만 작동.
 */

module.exports = async function handler(req, res) {
  // 인라인 명시적 CORS 헤더 (cors.js import 사용 안 함 — 사주 교훈)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { message, history, name, ageBand, phone } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message 필요' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    // 키가 없어도 사용자에겐 따뜻하게
    return res.status(200).json({ reply: warmFallback(false, name) });
  }

  // ═══ 살롱 고객 일일 한도(디노언니 3회/일) + 영업인 귀속 집계 ═══
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const SALON_DAILY = 3;
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  let leadRow = null, usedToday = 0, paidBalance = 0, payMode = 'free';
  if (cleanPhone.length >= 10 && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const lr = await fetch(`${SUPABASE_URL}/rest/v1/customer_leads?phone=eq.${cleanPhone}&source=eq.salon&select=*&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      leadRow = (await lr.json())[0] || null;
    } catch {}
    usedToday = (leadRow && leadRow.ai_used_date === kstToday) ? (leadRow.ai_used_count || 0) : 0;
    paidBalance = leadRow ? (leadRow.paid_balance || 0) : 0;
    if (usedToday >= SALON_DAILY) {
      if (paidBalance > 0) {
        payMode = 'paid';                        // 무료 소진 → 구매한 대화권으로 계속
      } else {
        const who = (name && String(name).trim()) ? `${String(name).trim()} 언니, ` : '';
        return res.status(200).json({
          reply: `${who}오늘 무료 3번 이야기를 다 나눴어요 💛\n더 이야기하고 싶으면, 디노 언니와 더 함께할 대화권을 더할 수 있어요. 아래에서 골라봐요 🌿`,
          limit: true, remaining: 0, dailyLimit: SALON_DAILY, needPurchase: true
        });
      }
    }
  }
  // 오늘의 마지막 "무료" 한 번이고 구매분도 없으면, 디노언니가 자연스럽게 마무리 인사
  const isLastTurn = payMode === 'free' && cleanPhone.length >= 10 && usedToday === SALON_DAILY - 1 && paidBalance <= 0;

  // ★ 조용한 안전망 — 진짜 위기 신호 감지 (idiomatic "죽겠다"는 제외)
  const crisis = detectCrisis(message);

  const systemPrompt = buildSisterPrompt(name, ageBand, crisis);
  const sysInstruction = isLastTurn
    ? systemPrompt + `\n\n[오늘의 마무리]\n이번이 오늘 나누는 마지막 이야기예요. 평소처럼 충분히 공감해 준 뒤, 끝에 "오늘은 여기까지, 내일 또 만나요" 같은 따뜻한 마무리 인사를 자연스럽게 덧붙여요. 갑자기 끊는 느낌 없이 다정하게 마쳐요.`
    : systemPrompt;

  // history → Gemini contents ({role,text} 스펙)
  const contents = [];
  if (Array.isArray(history)) {
    history.slice(-16).forEach(m => {
      const text = (m && (m.text ?? m.content)) || '';
      if (!text) return;
      contents.push({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: String(text) }]
      });
    });
  }
  contents.push({ role: 'user', parts: [{ text: String(message) }] });

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  async function generateOnce() {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: sysInstruction,
        temperature: 0.85,
        topP: 0.9,
        maxOutputTokens: 1024,
        // 2.5 Flash의 thinking이 토큰을 다 먹어 응답이 잘리는 것 방지(특히 안전망 케이스).
        // 짧고 다정한 대화엔 추론이 필요 없으므로 thinking 끔.
        thinkingConfig: { thinkingBudget: 0 },
      }
    });
    const text = (response.text || '').trim();
    const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
    return { text, finishReason };
  }

  try {
    let attempt = 0, last = null;
    while (attempt < 2) {
      attempt++;
      last = await generateOnce();
      if (last.text && (last.finishReason === 'STOP' || last.finishReason === 'UNKNOWN')) {
        let remaining = null, paidRemaining = (cleanPhone.length >= 10) ? paidBalance : null;
        if (payMode === 'paid') {
          paidRemaining = await decSalonPaid(SUPABASE_URL, SUPABASE_KEY, cleanPhone, leadRow);
          remaining = 0;
        } else {
          await bumpSalonUsage(SUPABASE_URL, SUPABASE_KEY, cleanPhone, leadRow, kstToday);
          if (cleanPhone.length >= 10) remaining = Math.max(0, SALON_DAILY - (usedToday + 1));
        }
        return res.status(200).json({ reply: last.text, remaining, dailyLimit: SALON_DAILY, paidRemaining });
      }
      console.warn(`sister-chat attempt ${attempt} finishReason=${last.finishReason} len=${last.text.length}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
    }
    // 재시도해도 실패 → 따뜻한 폴백 (안전망 케이스면 기댈 곳 포함)
    return res.status(200).json({ reply: warmFallback(crisis, name) });
  } catch (err) {
    console.error('sister-chat error:', String(err?.message || err).slice(0, 200));
    return res.status(200).json({ reply: warmFallback(crisis, name) });
  }
};

// ═══ 살롱 일일 사용 증가 + 영업인 집계 로그 ═══
async function bumpSalonUsage(url, key, phone, leadRow, today) {
  if (!url || !key || !phone || phone.length < 10) return;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const newCount = ((leadRow && leadRow.ai_used_date === today) ? (leadRow.ai_used_count || 0) : 0) + 1;
  try {
    await fetch(`${url}/rest/v1/customer_leads?phone=eq.${phone}&source=eq.salon`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ ai_used_date: today, ai_used_count: newCount, last_seen: new Date().toISOString() })
    });
    await fetch(`${url}/rest/v1/customer_ai_log`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ inviter_id: leadRow ? leadRow.inviter_id : null, source: 'salon_ai', lead_phone: phone })
    });
  } catch {}
}

// ═══ 구매한 대화권 1회 차감 (무료 소진 후) ═══
async function decSalonPaid(url, key, phone, leadRow) {
  const cur = (leadRow && leadRow.paid_balance) || 0;
  const newPaid = Math.max(0, cur - 1);
  if (!url || !key || !phone || phone.length < 10) return newPaid;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    await fetch(`${url}/rest/v1/customer_leads?phone=eq.${phone}&source=eq.salon`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ paid_balance: newPaid, last_seen: new Date().toISOString() })
    });
    await fetch(`${url}/rest/v1/customer_ai_log`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ inviter_id: leadRow ? leadRow.inviter_id : null, source: 'salon_ai_paid', lead_phone: phone })
    });
  } catch {}
  return newPaid;
}

// ═══ 위기 신호 감지 ═══
// 진짜 위기 표현만 매칭. 관용구("피곤해 죽겠다", "배고파 죽겠어")는 의도적으로 제외.
function detectCrisis(message) {
  const t = String(message).replace(/\s/g, '');
  const patterns = [
    '죽고싶', '죽고파', '죽어버리', '죽었으면', '죽는게나아', '죽는게낫',
    '자살', '자해', '목숨을끊', '목숨끊', '목매', '뛰어내리',
    '사라지고싶', '없어지고싶', '살기싫', '살고싶지않', '살아갈이유',
    '끝내고싶', '끝내버리', '다끝내', '세상을떠나'
  ];
  return patterns.some(p => t.includes(p));
}

// ═══ 디노 언니 페르소나 (시스템 프롬프트) ═══
function buildSisterPrompt(name, ageBand, crisis) {
  const who = (name && String(name).trim()) ? String(name).trim() : '';
  const ageLine = ageBand
    ? `\n- 상대는 ${ageBand}대예요. 그 또래가 공감할 만한 결로 이야기해요(설교/일반론 금지).`
    : '';

  const base = `당신은 "디노 언니"예요. 30~50대 여성을 위한 따뜻한 셀프케어 앱 "언니들의 살롱"의 옆집 언니 같은 친구예요.

[말투]
- 다정하고 밝은 "옆집 언니". 비난·진단·설교는 절대 하지 않아요.
- 반말이 아니라 친근한 "~해요/~예요" 말투. 짧고 다정하게(보통 2~4문장).
- 먼저 마음을 알아주고("그랬구나, 많이 ~했겠어요"), 그다음에 작은 다음 한 걸음을 부드럽게 건네요.
- 충고는 가볍게 한 스푼만. 답을 강요하지 않아요.
- 이모지는 0~1개만 자연스럽게. 마크다운(**, ##, - 목록) 쓰지 말고 자연스러운 문장으로.

[톤]
- 밝고 희망적이에요. 무겁고 부정적인 단어(예: "자살" 같은 말)를 먼저 꺼내지 않아요.
- "당신만 그런 게 아니에요" 같은 연결감을 줘요. 평범한 하루를 보내는 여성에게 위로와 작은 희망을 건네요.
- 의료·심리 진단이나 치료를 하지 않아요. 꼭 필요할 때만 "전문가와 한번 이야기해보는 것도 좋아요" 정도로 아주 부드럽게 권해요.${ageLine}`;

  const nameLine = who
    ? `\n\n[상대 호칭]\n- 상대를 "${who} 언니"라고 자연스럽게 불러줘요(매 문장마다는 아니고 가끔).`
    : `\n\n[상대 호칭]\n- 자연스러울 때 "언니"라고 다정하게 불러요.`;

  if (!crisis) {
    return base + nameLine + `\n\n[금지]\n- 길고 장황한 답, 이론 나열, 번호 매기기, 영어 제목.\n- "힘내세요" 같은 공허한 말 대신, 상대가 한 말을 짚어주며 진짜로 알아주기.`;
  }

  // ★ 안전망 모드 — 그 한 명에게만, 따뜻하고 차분하게
  return base + nameLine + `

[지금 이 순간 — 아주 중요]
상대가 많이 힘들어 보여요. 무엇보다 먼저, 따뜻하고 차분하게 곁에 있어 줘요.
- 상대의 마음을 깊이 알아주고, 혼자가 아니라는 걸 부드럽게 전해요.
- 절대 놀라거나 다그치거나 진단하지 말고, 어떤 방법·수단도 언급하지 말아요.
- 그리고 아주 자연스럽고 다정하게, 24시간 편하게 기댈 수 있는 곳이 있다고 알려줘요:
  · 자살예방 상담전화 ☎ 109 (24시간, 누구나)
  · 정신건강 상담전화 ☎ 1577-0199
- "혼자 견디지 않아도 돼요. 언니는 여기 있을게요" 같은 마음을 꼭 담아요.
- 차분하고 짧게(4~6문장). 밝은 척 과장하지 말고, 진심으로 곁에 있어 주는 느낌으로.`;
}

// ═══ 따뜻한 폴백 (AI 실패 시) ═══
function warmFallback(crisis, name) {
  const who = (name && String(name).trim()) ? `${String(name).trim()} 언니, ` : '';
  if (crisis) {
    return `${who}지금 많이 힘들죠. 혼자 견디지 않아도 돼요. 언니는 여기 있어요.\n` +
      `언제든 편하게 이야기 나눌 수 있는 곳도 있어요 — 자살예방 상담전화 ☎109(24시간), 마음이 무거울 땐 ☎1577-0199. ` +
      `잠깐 숨 한 번 크게 쉬어요. 우리 천천히 같이 가요. 💛`;
  }
  return `${who}지금 잠깐 언니가 답을 못 찾고 있어요. 조금만 있다가 다시 이야기해줄래요? ` +
    `그동안 물 한 잔 마시고 어깨 한번 펴봐요. 금방 다시 올게요 🌿`;
}
