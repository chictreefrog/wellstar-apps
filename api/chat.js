const { GoogleGenAI } = require('@google/genai');

module.exports = async function handler(req, res) {
  // 인라인 명시적 CORS 헤더 (cors.js import 사용 안 함 — 기존 교훈)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, scenario, history } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  const FILE_STORE = process.env.GEMINI_FILE_STORE; // e.g. "fileSearchStores/xxx"
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const systemPrompt = buildSystemPrompt(scenario);

  // Build conversation history
  const contents = [];
  if (history && history.length > 0) {
    history.slice(-16).forEach(m => {
      contents.push({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      });
    });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  // ==================== 3단계 폴백 로직 ====================
  let reply = '';
  let citations = [];
  let wikiHits = [];

  // [1단계] Supabase 위키에서 관련 지식 카드 검색
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      wikiHits = await searchWiki(SUPABASE_URL, SUPABASE_KEY, message, scenario);
    } catch (err) {
      // Wiki search failed, continuing without wiki context
    }
  }

  // 위키 지식을 시스템 프롬프트에 추가
  let enrichedPrompt = systemPrompt;
  if (wikiHits.length > 0) {
    enrichedPrompt += '\n\n## 관련 지식 카드 (위키에서 검색됨 — approved 상태만)\n';
    wikiHits.forEach(w => {
      enrichedPrompt += `\n### ${w.formula_id}: ${w.title}\n`;
      if (w.summary) enrichedPrompt += `요약: ${w.summary}\n`;
      if (w.secret_key) enrichedPrompt += `심리 열쇠: ${w.secret_key}\n`;
      if (w.dialog_good) enrichedPrompt += `✅ 성공 대화: ${w.dialog_good}\n`;
      if (w.dialog_bad) enrichedPrompt += `❌ 실패 대화: ${w.dialog_bad}\n`;
      if (w.core_sentence) enrichedPrompt += `핵심 문장: ${w.core_sentence}\n`;
    });
  }

  // [2단계] Gemini File Search (RAG) — 책 원본 검색
  try {
    const tools = [];
    if (FILE_STORE) {
      tools.push({
        fileSearch: {
          fileSearchStoreNames: [FILE_STORE],
          topK: 5
        }
      });
    }

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: enrichedPrompt,
        tools: tools.length > 0 ? tools : undefined,
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1500,
      }
    });

    reply = response.text || '';

    // citations 추출 (retrievedContext 필드명 사용)
    const grounding = response.candidates?.[0]?.groundingMetadata;
    if (grounding?.groundingChunks) {
      citations = grounding.groundingChunks
        .filter(c => c.retrievedContext)
        .map(c => ({
          source: c.retrievedContext?.title || '',
          text: c.retrievedContext?.text?.substring(0, 100) || '',
        }));
    }

  } catch (err) {
    // Gemini API error — attempt fallback

    // [3단계 폴백] File Search 실패 → 시스템 프롬프트만으로 답변
    if (err.message?.includes('503') || err.message?.includes('429')) {
      // 재시도 1회
      try {
        await new Promise(r => setTimeout(r, 2000));
        const retryRes = await client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents,
          config: {
            systemInstruction: enrichedPrompt,
            temperature: 0.8,
            maxOutputTokens: 1500,
          }
        });
        reply = retryRes.text || '';
      } catch (retryErr) {
        // Retry also failed, returning error message to user
        reply = '죄송합니다. 잠시 서버가 바쁩니다. 잠시 후 다시 시도해주세요. 🙏';
        return res.status(200).json({ reply, citations: [], quickReplies: getQuickReplies(scenario, message) });
      }
    } else {
      reply = '답변을 생성하지 못했어요. 다시 한번 말씀해주세요. 🙏';
      return res.status(200).json({ reply, citations: [], quickReplies: getQuickReplies(scenario, message) });
    }
  }

  // [4단계] 위키 축적 — AI 답변에서 새 지식 추출 (비동기, 응답 블로킹 안 함)
  if (SUPABASE_URL && SUPABASE_KEY && reply && citations.length > 0) {
    extractAndSaveToWiki(client, SUPABASE_URL, SUPABASE_KEY, message, reply, scenario, citations)
      .catch(() => {});
  }

  // 위키 지식 카드 usage_count 증가 (비동기)
  if (wikiHits.length > 0 && SUPABASE_URL && SUPABASE_KEY) {
    incrementUsageCount(SUPABASE_URL, SUPABASE_KEY, wikiHits.map(w => w.id))
      .catch(() => {});
  }

  return res.status(200).json({
    reply,
    citations,
    quickReplies: getQuickReplies(scenario, message)
  });
}

// ==================== WIKI SEARCH ====================
async function searchWiki(supabaseUrl, supabaseKey, query, scenario) {
  // 키워드 추출 (간단한 한국어 키워드 분리)
  const keywords = query.replace(/[?!.,。？！]/g, '').split(/\s+/).filter(w => w.length >= 2);

  // 카테고리 매핑
  const categoryMap = { mindset: 'mindset', rapport: 'rapport', objection: 'objection', closing: 'closing', team: 'team' };
  const category = categoryMap[scenario];

  // approved 상태만 검색 + 효과 점수 높은 순
  let url = `${supabaseUrl}/rest/v1/wiki_knowledge?status=eq.approved&order=effectiveness_score.desc,usage_count.desc&limit=3`;
  if (category) {
    url += `&category=eq.${category}`;
  }

  const res = await fetch(url, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    }
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data || [];
}

// ==================== WIKI SAVE (자동 축적 — draft 상태) ====================
async function extractAndSaveToWiki(client, supabaseUrl, supabaseKey, userMessage, aiReply, scenario, citations) {
  // AI에게 지식 카드 추출 요청
  const extractPrompt = `다음 세일즈 코칭 대화에서 구조화된 지식 카드를 추출하세요.
반드시 아래 JSON 형식으로만 응답하세요. 추출할 새로운 지식이 없으면 null을 반환하세요.

사용자 질문: ${userMessage}
AI 답변: ${aiReply.substring(0, 500)}

JSON 형식:
{
  "formula_id": "공식_XXX 또는 null (번호를 모르면 null)",
  "part": "1부~7부 중 해당하는 부 또는 null",
  "category": "mindset|rapport|objection|closing|team 중 하나",
  "title": "지식 카드 제목 (10자 이내)",
  "summary": "핵심 요약 (50자 이내)",
  "secret_key": "심리 원리 (30자 이내) 또는 null",
  "dialog_good": "✅ 성공 대화 예시 또는 null",
  "dialog_bad": "❌ 실패 대화 예시 또는 null",
  "core_sentence": "핵심 한 문장 또는 null",
  "tags": ["키워드1", "키워드2"]
}`;

  try {
    const extractRes = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: extractPrompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 500 }
    });

    const text = (extractRes.text || '').trim();
    if (text === 'null' || !text.startsWith('{')) return;

    // JSON 파싱 (마크다운 코드블록 제거)
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const card = JSON.parse(jsonStr);

    if (!card || !card.title) return;

    // Supabase에 draft 상태로 저장
    const saveRes = await fetch(`${supabaseUrl}/rest/v1/wiki_knowledge`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        formula_id: card.formula_id || null,
        part: card.part || null,
        category: card.category || scenario || 'general',
        title: card.title,
        summary: card.summary || null,
        secret_key: card.secret_key || null,
        dialog_good: card.dialog_good || null,
        dialog_bad: card.dialog_bad || null,
        core_sentence: card.core_sentence || null,
        tags: card.tags || [],
        action_steps: [],
        related_formulas: [],
        status: 'draft', // AI 자동 저장 = draft, 승인 후 approved
      })
    });

    if (!saveRes.ok) {
      // Wiki save HTTP error — non-blocking, skip
    }
  } catch (err) {
    // Wiki extraction/save error — non-blocking, skip
  }
}

// ==================== USAGE COUNT ====================
async function incrementUsageCount(supabaseUrl, supabaseKey, ids) {
  for (const id of ids) {
    await fetch(`${supabaseUrl}/rest/v1/rpc/increment_usage`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ row_id: id })
    }).catch(() => {});
  }
}

// ==================== SYSTEM PROMPT ====================
function buildSystemPrompt(scenario) {
  const base = `당신은 "옆집디노 AI 세일즈 코치"입니다.
"30초 만에 YES" (옆집디노 저) 101가지 마음 대화법을 기반으로 세일즈 코칭을 합니다.

## 핵심 규칙
1. **반드시 책 내용(File Search 결과)을 근거로 답변하세요**
2. 책에 없는 내용을 지어내지 마세요 (할루시네이션 금지)
3. 근거가 부족하면 "이 부분은 책에서 더 자세히 다루고 있어요"라고 안내하세요

## 코칭 프레임워크 ("30초 만에 YES" 공식 구조)
1. **SITUATION**: 사용자의 상황을 정확히 짚어줍니다
2. **SECRET KEY**: 왜 효과적인지 심리 원리를 설명합니다
3. **대화 비교**: ❌ 실패하는 말 vs ✅ 성공하는 말
4. **ACTION PLAN**: 구체적인 1, 2, 3단계 행동 제시
5. **핵심 문장**: 한 문장으로 요약

## 7부 성장 단계
1-2부. 마음 다지기 (기초공사) — 거절에 흔들리지 않는 마음의 방패
3부. 관계 열기 (현관문 두드리기) — 경계심을 허물고 귀 기울이게 만드는 기술
4부. 거절 넘기 (장애물 치우기) — 거절을 기회로 바꾸는 실전 대응
5부. 계약 성사 (함께 미래 약속하기) — 상대가 먼저 손 내밀게 하는 마무리
6-7부. 함께 성장하기 (멋진 마을 건설하기) — 파트너를 키우는 시스템

## 대화 규칙
- 한국어, 따뜻하고 공감적 (코치이자 선배)
- 감정 먼저 인정 → 원리 설명 → ❌/✅ 대화 예시 → 액션플랜
- 300-500자 정도 (모바일에서 읽기 좋게)
- 이모지 적절히, 특정 회사/제품명 언급 안 함
- 마지막에 격려 한마디`;

  const scenarioPrompts = {
    general: '',
    mindset: '\n\n## 현재 시나리오: 🛡️ 마음 다지기 (1-2부)\n집중: 거절 후 멘탈 회복, 자존감, 동기부여, 두려움 극복',
    rapport: '\n\n## 현재 시나리오: 🚪 관계 열기 (3부)\n집중: 첫 접근, 경계심 허물기, 자연스러운 대화 시작, SNS 접근',
    objection: '\n\n## 현재 시나리오: 🧹 거절 대응 (4부)\n집중: "비싸다", "다단계야?", "생각해볼게", "관심 없어" 등 실전 대응',
    closing: '\n\n## 현재 시나리오: 🤝 클로징 (5부)\n집중: 자연스러운 계약 유도, 결정 도움, 이중 선택법, 타이밍 포착',
    team: '\n\n## 현재 시나리오: 🌱 팀 빌딩 (6-7부)\n집중: 파트너 모집, 신규 온보딩, 팀원 동기부여, 리더십'
  };

  return base + (scenarioPrompts[scenario] || '');
}

// ==================== QUICK REPLIES ====================
function getQuickReplies(scenario, message) {
  const msg = message.toLowerCase();

  if (msg.includes('거절') || msg.includes('비싸') || msg.includes('다단계')) {
    return ['거절 후 다시 연락해도 될까?', '이 말 다음에 뭐라고 해?', '실전 연습해보고 싶어'];
  }
  if (msg.includes('자신감') || msg.includes('두려') || msg.includes('포기')) {
    return ['매일 루틴 알려줘', '거절 극복 방법 더 알려줘', '성공 사례 들려줘'];
  }
  if (msg.includes('처음') || msg.includes('시작') || msg.includes('접근')) {
    return ['SNS로 먼저 접근하려면?', '대화 주제 추천해줘', '자연스럽게 제안하는 법'];
  }
  if (msg.includes('계약') || msg.includes('마무리') || msg.includes('결정')) {
    return ['결정 못하는 고객 대응', '클로징 타이밍은?', '마지막 한마디 예시'];
  }

  const defaults = {
    general: ['거절이 두려워요', '첫 미팅 팁', '오늘의 동기부여'],
    mindset: ['매일 루틴 추천', '멘탈 회복법', '성공 마인드셋'],
    rapport: ['자연스러운 대화법', 'SNS 접근법', '경계심 허무는 법'],
    objection: ['"비싸요" 대응', '"생각해볼게" 대응', '"관심 없어" 대응'],
    closing: ['클로징 타이밍', '이중 선택법', '결정 못하는 고객'],
    team: ['파트너 모집 팁', '팀원 동기부여', '리더십 코칭']
  };

  return defaults[scenario] || defaults.general;
}
