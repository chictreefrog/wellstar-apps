const crypto = require('crypto');

// 인증번호 임시 저장 (5분 유효)
const otpStore = {};
// SMS 인증 완료된 번호 (10분 유효 — 비밀번호 설정 시간)
const verifiedStore = {};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, phone, code, password } = req.body || {};
  const SUPABASE_URL = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.DINO_SUPABASE_KEY;

  // ═══ 1. 인증번호 발송 ═══
  if (action === 'send') {
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: '올바른 전화번호를 입력해주세요' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore[cleanPhone] = { otp, expires: Date.now() + 5 * 60 * 1000 };

    const SOLAPI_KEY = process.env.SOLAPI_API_KEY;
    const SOLAPI_SECRET = process.env.SOLAPI_API_SECRET;
    const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

    if (!SOLAPI_KEY || !SOLAPI_SECRET || !SOLAPI_SENDER) {
      return res.status(500).json({ error: 'SMS 설정이 필요합니다' });
    }

    try {
      const date = new Date().toISOString();
      const salt = crypto.randomBytes(32).toString('hex');
      const signature = crypto.createHmac('sha256', SOLAPI_SECRET).update(date + salt).digest('hex');
      const authHeader = `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`;

      let to = cleanPhone;
      if (to.startsWith('82')) to = '0' + to.substring(2);

      const smsRes = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ to, from: SOLAPI_SENDER, text: `[옆집디노] 인증번호: ${otp}\n5분 내에 입력해주세요.`, type: 'SMS' }],
        }),
      });

      if (!smsRes.ok) {
        return res.status(500).json({ error: '문자 발송에 실패했어요' });
      }

      return res.status(200).json({ success: true });
    } catch {
      return res.status(500).json({ error: '문자 발송 중 오류가 발생했어요' });
    }
  }

  // ═══ 2. 인증번호 확인 ═══
  if (action === 'verify') {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const stored = otpStore[cleanPhone];

    if (!stored) return res.status(400).json({ error: '인증번호를 먼저 요청해주세요' });
    if (Date.now() > stored.expires) { delete otpStore[cleanPhone]; return res.status(400).json({ error: '인증번호가 만료됐어요' }); }
    if (stored.otp !== code) return res.status(400).json({ error: '인증번호가 일치하지 않아요' });

    delete otpStore[cleanPhone];
    verifiedStore[cleanPhone] = { expires: Date.now() + 10 * 60 * 1000 };

    return res.status(200).json({ success: true, verified: true });
  }

  // ═══ 3. 회원가입 (SMS 인증 후) ═══
  if (action === 'signup') {
    const cleanPhone = (phone || '').replace(/\D/g, '');

    if (!verifiedStore[cleanPhone] || Date.now() > verifiedStore[cleanPhone].expires) {
      return res.status(400).json({ error: '먼저 휴대폰 인증을 해주세요' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' });
    }

    const fakeEmail = cleanPhone + '@dino.wellstar.life';

    try {
      // Supabase Admin으로 사용자 생성
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: fakeEmail,
          password,
          email_confirm: true,
          phone: '+82' + cleanPhone.replace(/^0/, ''),
          phone_confirm: true,
          user_metadata: { phone: cleanPhone, role: 'guest' },
        }),
      });

      const createData = await createRes.json();

      if (!createRes.ok) {
        if (createData.msg?.includes('already') || createData.message?.includes('already')) {
          return res.status(400).json({ error: '이미 가입된 번호예요. 로그인해주세요.' });
        }
        return res.status(500).json({ error: createData.msg || createData.message || '가입에 실패했어요' });
      }

      delete verifiedStore[cleanPhone];
      return res.status(200).json({ success: true, userId: createData.id });
    } catch {
      return res.status(500).json({ error: '가입 처리 중 오류가 발생했어요' });
    }
  }

  // ═══ 4. 비밀번호 재설정 (SMS 인증 후) ═══
  if (action === 'reset-password') {
    const cleanPhone = (phone || '').replace(/\D/g, '');

    if (!verifiedStore[cleanPhone] || Date.now() > verifiedStore[cleanPhone].expires) {
      return res.status(400).json({ error: '먼저 휴대폰 인증을 해주세요' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' });
    }

    const fakeEmail = cleanPhone + '@dino.wellstar.life';

    try {
      // 기존 사용자 찾기
      const searchRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
      });
      const searchData = await searchRes.json();
      const user = searchData.users?.find(u => u.email === fakeEmail);

      if (!user) {
        return res.status(400).json({ error: '가입된 계정을 찾을 수 없어요' });
      }

      // 비밀번호 업데이트
      const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!updateRes.ok) {
        return res.status(500).json({ error: '비밀번호 변경에 실패했어요' });
      }

      delete verifiedStore[cleanPhone];
      return res.status(200).json({ success: true });
    } catch {
      return res.status(500).json({ error: '비밀번호 재설정 중 오류가 발생했어요' });
    }
  }

  return res.status(400).json({ error: 'action은 send, verify, signup, reset-password 중 하나여야 합니다' });
};
