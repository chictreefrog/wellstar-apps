/**
 * POST /api/payapp-create
 * 크레딧 충전 결제요청 (페이앱) → 카카오톡으로 결제 링크 발송
 *
 * Header: Authorization: Bearer <supabase access token>
 * Body:   { package_price: 5000|10000|30000|50000, phone: "010..." }
 * 응답:   { success, mulNo, credits, message } | { error, message }
 *
 * 1 크레딧 = 1원 (credits = package_price)
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { package_price, phone } = req.body || {};
  const ALLOWED = [5000, 10000, 30000, 50000];
  const price = parseInt(package_price, 10);
  if (!ALLOWED.includes(price)) {
    return res.status(400).json({ error: 'invalid_package', message: '충전 금액이 올바르지 않아요.' });
  }
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ error: 'invalid_phone', message: '올바른 휴대폰 번호를 입력해주세요.' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'unauthenticated', message: '로그인이 필요해요.' });

  const SUPABASE_URL    = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY    = process.env.DINO_SUPABASE_KEY;
  const PAYAPP_USERID   = process.env.PAYAPP_USERID;
  const PAYAPP_LINK_KEY = process.env.PAYAPP_LINK_KEY;
  const PAYAPP_LINK_VAL = process.env.PAYAPP_LINK_VAL;
  const FEEDBACK_URL = process.env.PAYAPP_FEEDBACK_URL || 'https://app.wellstar.life/api/payapp-feedback';
  const RETURN_URL   = process.env.PAYAPP_RETURN_URL   || 'https://app.wellstar.life/charge?paid=1';

  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });
  if (!PAYAPP_USERID || !PAYAPP_LINK_KEY || !PAYAPP_LINK_VAL) {
    return res.status(500).json({ error: 'payapp_not_configured', message: '결제 설정이 필요해요(관리자 환경변수).' });
  }

  // 1) 토큰으로 사용자 확인
  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) return res.status(401).json({ error: 'invalid_token', message: '로그인이 만료됐어요. 다시 로그인해주세요.' });
    userId = (await r.json())?.id;
  } catch {
    return res.status(401).json({ error: 'auth_failed' });
  }
  if (!userId) return res.status(401).json({ error: 'invalid_user' });

  const credits = price; // 1원 = 1크레딧
  const goodname = `옆집디노 크레딧 ${price.toLocaleString('ko-KR')}원`;

  // 2) 페이앱 결제요청 (서버→서버) — 성공 시 카톡으로 결제 링크가 발송됨
  let state, mulNo, errMsg;
  try {
    const params = new URLSearchParams({
      cmd: 'payrequest',
      userid: PAYAPP_USERID,
      linkkey: PAYAPP_LINK_KEY,
      linkval: PAYAPP_LINK_VAL,
      goodname,
      price: String(price),
      recvphone: cleanPhone,
      smsuse: 'y',
      var1: `credit_${price}`,
      var2: userId,
      feedbackurl: FEEDBACK_URL,
      returnurl: RETURN_URL,
    });
    const pr = await fetch('https://api.payapp.kr/oapi/apiLoad.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    });
    const text = await pr.text();
    const rp = new URLSearchParams(text);
    state  = rp.get('state');
    mulNo  = rp.get('mul_no');
    errMsg = rp.get('errorMessage');
  } catch {
    return res.status(502).json({ error: 'payapp_request_failed', message: '결제 요청 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.' });
  }

  if (state !== '1' || !mulNo) {
    return res.status(400).json({ error: 'payapp_error', message: errMsg || '결제 요청에 실패했어요.' });
  }

  // 3) 주문 기록 (멱등성 키 = mul_no). 실패해도 웹훅 폴백(var2/price)이 있어 결제는 진행됨.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/credit_orders`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        payapp_order_id: mulNo,
        amount: credits,
        price,
        status: 'requested',
        recvphone: cleanPhone,
      }),
    });
  } catch {}

  return res.status(200).json({
    success: true,
    mulNo,
    credits,
    message: '카카오톡으로 결제 링크를 보냈어요. 카톡에서 결제를 완료하면 크레딧이 자동 충전돼요.',
  });
};
