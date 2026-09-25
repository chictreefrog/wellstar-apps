/**
 * 옆집디노 세일즈앱 — 휴대폰 인증 / 가입 / 비밀번호 재설정
 *
 * 2026-09-26 커뮤니티(wellstar-community api/sms.js)와 같은 방식으로 바꿨다.
 *  1) 인증번호를 서버 메모리가 아니라 Supabase public.phone_otp 에 담는다.
 *     (서버리스는 요청마다 인스턴스가 달라져 메모리 저장이 랜덤하게 새어나간다 — 「맞게 넣었는데 틀리다」의 원인)
 *  2) 인증번호는 해시로만 저장하고, 확인 시도는 5번까지(그 전엔 무제한이라 남의 번호로 번호 맞히기가 가능했다).
 *  3) 문자 남용 막기 — 보내기 전에 DB 함수 sms_guard(같은 접속·같은 번호·하루 전체 한도, 커뮤니티와 공용).
 *
 * 계정 규칙은 그대로 — {번호}@dino.wellstar.life. 같은 번호면 커뮤니티 회원과 같은 계정.
 *
 * 필요한 환경변수 (Vercel):
 *   DINO_SUPABASE_URL, DINO_SUPABASE_KEY(service role)
 *   SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER
 */
const crypto = require('crypto');

const OTP_TTL_MS = 5 * 60 * 1000;      // 인증번호 유효 5분
const VERIFIED_TTL_MS = 10 * 60 * 1000; // 인증 후 비밀번호 설정까지 10분
const RESEND_COOLDOWN_MS = 60 * 1000;   // 재발송 최소 간격 1분
const MAX_ATTEMPTS = 5;

const EMAIL_DOMAIN = '@dino.wellstar.life';

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const clean = (v) => String(v || '').replace(/\D/g, '');
const clientIp = (req) =>
  String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]).trim();

function sb(path, init = {}) {
  const url = process.env.DINO_SUPABASE_URL;
  const key = process.env.DINO_SUPABASE_KEY;
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

// 문자 남용 막기 — 'ok' 가 아니면 그 문장을 그대로 보여 준다. DB가 대답을 못 하면 보내지 않는다.
async function smsGuard(req, phone) {
  try {
    const r = await sb('/rest/v1/rpc/sms_guard', {
      method: 'POST',
      body: JSON.stringify({ p_app: 'app', p_ip: clientIp(req), p_phone: phone }),
    });
    if (!r.ok) return '잠시 후 다시 시도해주세요';
    return await r.json();
  } catch {
    return '잠시 후 다시 시도해주세요';
  }
}

async function readOtp(phone) {
  const res = await sb(`/rest/v1/phone_otp?phone=eq.${encodeURIComponent(phone)}&select=*`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

function writeOtp(row) {
  // phone 이 primary key — upsert 로 덮어쓴다
  return sb('/rest/v1/phone_otp', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
}

function patchOtp(phone, patch) {
  return sb(`/rest/v1/phone_otp?phone=eq.${encodeURIComponent(phone)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

function deleteOtp(phone) {
  return sb(`/rest/v1/phone_otp?phone=eq.${encodeURIComponent(phone)}`, { method: 'DELETE' });
}

async function sendSms(to, text) {
  const KEY = process.env.SOLAPI_API_KEY;
  const SECRET = process.env.SOLAPI_API_SECRET;
  const SENDER = process.env.SOLAPI_SENDER;
  if (!KEY || !SECRET || !SENDER) throw new Error('SMS 설정이 필요합니다');

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', SECRET).update(date + salt).digest('hex');

  let num = to;
  if (num.startsWith('82')) num = '0' + num.substring(2);

  const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ to: num, from: SENDER, text, type: 'SMS' }] }),
  });

  if (!res.ok) throw new Error('문자 발송에 실패했어요');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.DINO_SUPABASE_URL || !process.env.DINO_SUPABASE_KEY) {
    return res.status(500).json({ error: '서버 설정이 필요합니다 (Supabase)' });
  }

  const { action, phone, code, password } = req.body || {};
  const p = clean(phone);

  // ═══ 1. 인증번호 발송 ═══
  if (action === 'send') {
    if (p.length < 10) return res.status(400).json({ error: '올바른 전화번호를 입력해주세요' });

    const prev = await readOtp(p);
    if (prev && Date.now() - new Date(prev.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: '조금 뒤에 다시 시도해주세요' });
    }

    const guard = await smsGuard(req, p);
    if (guard !== 'ok') return res.status(429).json({ error: guard });

    const otp = String(Math.floor(100000 + Math.random() * 900000));

    try {
      await sendSms(p, `[옆집디노] 인증번호: ${otp}\n5분 내에 입력해주세요.`);
    } catch (err) {
      return res.status(500).json({ error: err.message || '문자 발송에 실패했어요' });
    }

    const saved = await writeOtp({
      phone: p,
      code_hash: hash(otp),
      verified: false,
      attempts: 0,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      created_at: new Date().toISOString(),
    });
    if (!saved.ok) return res.status(500).json({ error: '인증번호 저장에 실패했어요' });

    return res.status(200).json({ success: true });
  }

  // ═══ 2. 인증번호 확인 ═══
  if (action === 'verify') {
    const row = await readOtp(p);
    if (!row) return res.status(400).json({ error: '인증번호를 먼저 요청해주세요' });

    if (Date.now() > new Date(row.expires_at).getTime()) {
      await deleteOtp(p);
      return res.status(400).json({ error: '인증번호가 만료됐어요' });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await deleteOtp(p);
      return res.status(429).json({ error: '시도 횟수를 넘었어요. 인증번호를 다시 받아주세요' });
    }
    if (row.code_hash !== hash(clean(code))) {
      await patchOtp(p, { attempts: row.attempts + 1 });
      return res.status(400).json({ error: '인증번호가 일치하지 않아요' });
    }

    await patchOtp(p, {
      verified: true,
      expires_at: new Date(Date.now() + VERIFIED_TTL_MS).toISOString(),
    });
    return res.status(200).json({ success: true, verified: true });
  }

  // ═══ 인증 상태 확인 (가입 / 재설정 공통) ═══
  async function requireVerified() {
    const row = await readOtp(p);
    if (!row || !row.verified) return '먼저 휴대폰 인증을 해주세요';
    if (Date.now() > new Date(row.expires_at).getTime()) {
      await deleteOtp(p);
      return '인증 시간이 지났어요. 다시 인증해주세요';
    }
    return null;
  }

  // ═══ 3. 회원가입 (SMS 인증 후) ═══
  if (action === 'signup') {
    const notVerified = await requireVerified();
    if (notVerified) return res.status(400).json({ error: notVerified });
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' });
    }

    try {
      const createRes = await sb('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: p + EMAIL_DOMAIN,
          password,
          email_confirm: true,
          phone: '+82' + p.replace(/^0/, ''),
          phone_confirm: true,
          user_metadata: { phone: p, role: 'guest' },
        }),
      });
      const data = await createRes.json();

      if (!createRes.ok) {
        const msg = data.msg || data.message || '';
        if (/already|registered|exists/i.test(msg)) {
          return res.status(400).json({ error: '이미 가입된 번호예요. 로그인해주세요.' });
        }
        return res.status(500).json({ error: msg || '가입에 실패했어요' });
      }

      await deleteOtp(p);
      return res.status(200).json({ success: true, userId: data.id });
    } catch {
      return res.status(500).json({ error: '가입 처리 중 오류가 발생했어요' });
    }
  }

  // ═══ 4. 비밀번호 재설정 (SMS 인증 후) ═══
  if (action === 'reset-password') {
    const notVerified = await requireVerified();
    if (notVerified) return res.status(400).json({ error: notVerified });
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' });
    }

    const email = p + EMAIL_DOMAIN;

    try {
      // 전체 사용자 첫 페이지에서 찾으면 회원이 늘 때 밀려난다 — 이메일로 직접 건다.
      const searchRes = await sb(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=10`);
      const searchData = await searchRes.json();
      const user = (searchData.users || []).find((u) => u.email === email);
      if (!user) return res.status(400).json({ error: '가입된 계정을 찾을 수 없어요' });

      const updateRes = await sb(`/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      if (!updateRes.ok) return res.status(500).json({ error: '비밀번호 변경에 실패했어요' });

      await deleteOtp(p);
      return res.status(200).json({ success: true });
    } catch {
      return res.status(500).json({ error: '비밀번호 재설정 중 오류가 발생했어요' });
    }
  }

  return res.status(400).json({ error: 'action은 send, verify, signup, reset-password 중 하나여야 합니다' });
};
