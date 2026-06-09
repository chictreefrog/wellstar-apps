/**
 * POST /api/salon-buy  (살롱 — 공개, 로그인 불필요)
 * 디노언니 추가 대화권을 고객이 직접 PayApp으로 결제. 전화번호 기준 충전.
 * Body: { phone, pack: 100 | 300 }
 * 응답: { success, mulNo, count, price, payUrl, message } | { error, message }
 */
const PACKS = { 100: 1000, 300: 2900 };  // 대화 횟수 : 가격(원)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};
  const cleanPhone = String(b.phone || '').replace(/\D/g, '');
  if (cleanPhone.length < 10) return res.status(400).json({ error: 'invalid_phone', message: '번호 정보가 올바르지 않아요.' });
  const count = parseInt(b.pack, 10);
  const price = PACKS[count];
  if (!price) return res.status(400).json({ error: 'invalid_pack', message: '대화권 종류가 올바르지 않아요.' });

  const SUPABASE_URL    = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY    = process.env.DINO_SUPABASE_KEY;
  const PAYAPP_USERID   = process.env.PAYAPP_USERID;
  const PAYAPP_LINK_KEY = process.env.PAYAPP_LINK_KEY;
  const PAYAPP_LINK_VAL = process.env.PAYAPP_LINK_VAL;
  const FEEDBACK_URL = process.env.PAYAPP_FEEDBACK_URL || 'https://app.wellstar.life/api/payapp-feedback';
  const RETURN_URL   = 'https://app.wellstar.life/salon/?paid=1';
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'server_not_configured' });
  if (!PAYAPP_USERID || !PAYAPP_LINK_KEY || !PAYAPP_LINK_VAL) {
    return res.status(500).json({ error: 'payapp_not_configured', message: '결제 설정이 필요해요(관리자).' });
  }

  const goodname = `디노언니 대화 ${count}회`;

  // 1) 페이앱 결제요청 (서버→서버)
  let state, mulNo, payUrl, errMsg;
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
      var1: `salon_${count}`,
      var2: cleanPhone,
      feedbackurl: FEEDBACK_URL,
      returnurl: RETURN_URL,
    });
    const pr = await fetch('https://api.payapp.kr/oapi/apiLoad.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    });
    const rp = new URLSearchParams(await pr.text());
    state  = rp.get('state');
    mulNo  = rp.get('mul_no');
    payUrl = rp.get('payurl') || rp.get('pay_url') || '';
    errMsg = rp.get('errorMessage');
  } catch {
    return res.status(502).json({ error: 'payapp_request_failed', message: '결제 요청 중 오류가 났어요. 잠시 후 다시 시도해주세요.' });
  }
  if (state !== '1' || !mulNo) {
    return res.status(400).json({ error: 'payapp_error', message: errMsg || '결제 요청에 실패했어요.' });
  }

  // 2) 주문 기록 (멱등성 키 = mul_no). 실패해도 웹훅 폴백 있음.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/customer_orders`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ phone: cleanPhone, payapp_order_id: mulNo, count, price, status: 'requested' }),
    });
  } catch {}

  return res.status(200).json({
    success: true, mulNo, count, price, payUrl,
    message: '결제 링크를 보냈어요. 결제를 완료하면 대화권이 자동 충전돼요 💛',
  });
};
