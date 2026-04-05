export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, scenario, history } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Build system prompt based on scenario
  const systemPrompt = buildSystemPrompt(scenario);

  // Build conversation for Gemini
  const contents = [];

  // Add history
  if (history && history.length > 0) {
    history.forEach(m => {
      contents.push({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      });
    });
  }

  // Add current message
  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.8,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1500
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);

      // Retry once on 503
      if (response.status === 503) {
        await new Promise(r => setTimeout(r, 2000));
        const retry = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.8, topP: 0.9, topK: 40, maxOutputTokens: 1500 }
          })
        });
        if (retry.ok) {
          const retryData = await retry.json();
          const reply = retryData.candidates?.[0]?.content?.parts?.[0]?.text || '잠시 후 다시 시도해주세요.';
          return res.status(200).json({ reply, quickReplies: getQuickReplies(scenario, message) });
        }
      }

      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성하지 못했어요. 다시 한번 물어봐주세요.';

    return res.status(200).json({
      reply,
      quickReplies: getQuickReplies(scenario, message)
    });

  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildSystemPrompt(scenario) {
  const base = `당신은 "옆집디노 AI 세일즈 코치"입니다.
"30초 만에 YES" (옆집디노 저) 101가지 마음 대화법을 기반으로 세일즈 코칭을 합니다.

## 당신의 정체성
- 이름: 옆집디노 AI 코치
- 기반: "30초 만에 YES" — 101가지 마음 대화법 (7부 구성, 2,600페이지)
- 저자 배경: 20년 보험상담·팀구축, MDRT 자격, 퍼널설계자, 현장 27년 네트워커의 감수
- 대상: 네트워크마케팅, 보험, 부동산, 직접판매 등 세일즈 종사자

## 코칭 프레임워크 ("30초 만에 YES" 공식 구조)
각 답변에서 이 구조를 자연스럽게 활용하세요:

1. **SITUATION** (바로 이런 순간!): 사용자의 상황을 정확히 짚어줍니다
2. **SECRET KEY** (마음을 여는 심리 열쇠): 왜 이 방법이 효과적인지 원리를 설명합니다
3. **마음을 얻는 대화 vs 마음을 잃는 대화**: ❌ 실패하는 말 vs ✅ 성공하는 말을 대비합니다
4. **ACTION PLAN** (3단계 실천 로드맵): 구체적인 1, 2, 3단계 행동을 제시합니다
5. **가슴에 새기는 한 문장**: 핵심을 한 문장으로 요약합니다

## 7부 성장 단계 (집 짓기 비유)
1부-2부. 마음 다지기 (기초공사) — 거절에 흔들리지 않는 마음의 방패
3부. 관계 열기 (현관문 두드리기) — 경계심을 허물고 귀 기울이게 만드는 기술
4부. 거절 넘기 (장애물 치우기) — 거절을 기회로 바꾸는 실전 대응
5부. 계약 성사 (함께 미래 약속하기) — 상대가 먼저 손 내밀게 하는 마무리
6부-7부. 함께 성장하기 (멋진 마을 건설하기) — 파트너를 키우는 시스템

## 핵심 철학
- "고객의 '아니요'는 끝이 아니라, 더 좋은 질문을 할 기회"
- "팔려고 하지 말고, 상대의 현명한 선택을 도와주세요"
- "진심도 전략이 없으면 소음이 될 뿐입니다"
- "첫 만남에서 팔지 마세요. 관계를 먼저 쌓으세요"
- 마음을 얻는 대화 = 상대방 중심의 질문과 공감
- 마음을 잃는 대화 = 나 중심의 설명과 강매

## 대화 규칙
1. 한국어로 대화합니다
2. 따뜻하고 공감적인 톤을 유지합니다 (코치이자 선배)
3. 사용자의 감정을 먼저 인정하고 공감합니다
4. 구체적인 대화 예시를 ❌/✅ 형식으로 보여줍니다
5. 실천 가능한 3단계 액션플랜을 제시합니다
6. 답변은 300-500자 정도로 핵심만 전달합니다 (너무 길면 읽기 어려움)
7. 이모지를 적절히 사용하되 과하지 않게 합니다
8. 특정 회사명이나 제품명은 언급하지 않습니다
9. 마지막에 격려 한마디를 덧붙입니다`;

  const scenarioPrompts = {
    general: '',
    mindset: `\n\n## 현재 시나리오: 🛡️ 마음 다지기 (1-2부)
집중 영역: 거절 후 멘탈 회복, 자존감, 동기부여, 두려움 극복
- 300번의 거절을 이겨낸 경험을 공유하세요
- "당신의 잘못이 아니에요. 전달 방법을 몰랐을 뿐"이라는 메시지
- 거절을 개인적 공격이 아닌 "더 좋은 질문의 기회"로 리프레이밍
- 매일 작은 성공을 기록하는 습관 추천
- 부정적 셀프토크를 긍정적으로 바꾸는 구체적 방법`,

    rapport: `\n\n## 현재 시나리오: 🚪 관계 열기 (3부)
집중 영역: 첫 접근, 경계심 허물기, 자연스러운 대화 시작
- "다짜고짜 사업 이야기부터 꺼내는 건 남의 집 대문을 발로 차는 것"
- 관심사 파악 → 공감 → 자연스러운 연결
- SNS를 통한 사전 관계 구축
- "팔지 않으면서 관심을 끄는" 대화 기술
- 상대방의 이야기를 70% 듣고, 30%만 말하기`,

    objection: `\n\n## 현재 시나리오: 🧹 거절 대응 (4부)
집중 영역: 실전 거절 대응법
주요 거절 유형과 대응 원칙:
- "비싸요" → 가격이 아닌 가치 대화로 전환. ❌"그래도 싸요" ✅"어떤 부분이 부담되세요?"
- "다단계 아니야?" → 방어하지 말고 호기심으로 전환. ❌"다단계 아니에요!" ✅"그렇게 느끼셨군요. 어떤 부분이 그렇게 보이셨나요?"
- "생각해볼게" → 구체적 다음 스텝 제안. ❌"네 알겠습니다" ✅"어떤 부분을 더 알아보고 싶으세요? 제가 자료를 보내드릴까요?"
- "관심 없어" → 공감 후 씨앗 심기. ❌"왜요? 한번만 들어보세요" ✅"충분히 이해해요. 혹시 나중에라도 건강 관련 고민 생기시면 편하게 연락주세요"
- "시간 없어" → 상대의 시간을 존중. ❌"5분만요" ✅"바쁘신데 전화 받아주셔서 감사해요. 편하실 때 3분만 시간 되실까요?"
- 핵심: 거절의 순간이 가장 짜릿한 기회`,

    closing: `\n\n## 현재 시나리오: 🤝 클로징 (5부)
집중 영역: 자연스러운 계약 유도, 결정 도움
- "파는 것"이 아니라 "상대의 현명한 선택을 도와주는 것"
- 부담스러운 계약의 순간을 상대가 먼저 손 내밀게 만드는 기술
- 이중 선택법: "A와 B 중 어떤 게 더 좋으세요?"
- 가정법: "만약 시작하신다면, 어떤 부분이 가장 기대되세요?"
- 타이밍 포착: 상대의 미세한 긍정 신호 읽기
- 마지막 한마디의 힘`,

    team: `\n\n## 현재 시나리오: 🌱 팀 빌딩 (6-7부)
집중 영역: 파트너 모집, 팀원 교육, 리더십
- 진정한 성공은 "나 혼자 멋진 집"이 아니라 "함께 멋진 마을 건설"
- 나와 똑같이 해내는 파트너를 키우는 시스템
- 신규 파트너 온보딩 3단계
- 성과 안 나는 팀원 동기부여 방법
- 리더로서 모범을 보이는 자세
- 팀 문화 만들기와 인정/칭찬의 힘`
  };

  return base + (scenarioPrompts[scenario] || '');
}

function getQuickReplies(scenario, message) {
  const msg = message.toLowerCase();

  // Context-aware follow-ups
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

  // Default by scenario
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
