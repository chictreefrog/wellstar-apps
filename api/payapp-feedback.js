/**
 * 페이앱 피드백(웹훅) — /api/payapp-feedback
 * 결제 상태 변동 시 페이앱이 application/x-www-form-urlencoded 로 POST.
 * 결제완료(pay_state=4) → 해당 주문을 paid 처리하고 크레딧 자동 적립.
 *
 * ⚠️ 페이앱에는 항상 본문 'SUCCESS' + 200 으로 응답해야 함 (실패해도 SUCCESS — 무한 재시도 방지)
 * ⚠️ 페이앱 관리자페이지에 이 URL을 피드백 URL로 등록해야 함:
 *    https://app.wellstar.life/api/payapp-feedback
 */
module.exports = async function handler(req, res) {
  // 페이앱 연결 테스트 (GET/HEAD)
  if (req.method === 'GET' || req.method === 'HEAD') return res.status(200).send('SUCCESS');
  if (req.method !== 'POST') return res.status(200).send('SUCCESS');

  const SUPABASE_URL    = process.env.DINO_SUPABASE_URL;
  const SUPABASE_KEY    = process.env.DINO_SUPABASE_KEY;
  const PAYAPP_USERID   = process.env.PAYAPP_USERID;
  const PAYAPP_LINK_KEY = process.env.PAYAPP_LINK_KEY;
  const PAYAPP_LINK_VAL = process.env.PAYAPP_LINK_VAL;

  try {
    // 본문 파싱 (Vercel이 객체로 줄 수도, 드물게 문자열일 수도)
    let body = req.body;
    if (typeof body === 'string') body = Object.fromEntries(new URLSearchParams(body));
    body = body || {};

    if (!SUPABASE_URL || !SUPABASE_KEY || !PAYAPP_USERID) return res.status(200).send('SUCCESS');

    // 보안 검증 — 우리 가맹점 키와 일치해야만 처리
    if (body.userid !== PAYAPP_USERID || body.linkkey !== PAYAPP_LINK_KEY || body.linkval !== PAYAPP_LINK_VAL) {
      console.error('[payapp-feedback] auth mismatch');
      return res.status(200).send('SUCCESS');
    }

    const mulNo     = body.mul_no || '';
    const payState  = parseInt(body.pay_state || '0', 10);
    const price     = parseInt(body.price || '0', 10);
    const var1      = body.var1 || '';
    const userIdVar = body.var2 || '';
    const isSalon   = var1.indexOf('salon_') === 0;  // 살롱 고객 대화권 구매
    if (!mulNo) return res.status(200).send('SUCCESS');

    const sbHeaders = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    };

    // ── 결제완료 (state=4) → 적립 ──
    if (payState === 4) {
      // ── 살롱 고객 대화권 구매 (var1=salon_<count>, var2=phone) → 번호에 충전 ──
      if (isSalon) {
        const count = parseInt(var1.split('_')[1], 10) || 0;
        const buyerPhone = userIdVar.replace(/\D/g, '');
        if (count > 0 && buyerPhone.length >= 10) {
          const pRes = await fetch(
            `${SUPABASE_URL}/rest/v1/customer_orders?payapp_order_id=eq.${encodeURIComponent(mulNo)}&status=neq.paid`,
            { method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() }) }
          );
          let upd = []; try { upd = await pRes.json(); } catch {}
          if (Array.isArray(upd) && upd.length > 0) {
            await rpcAddSalon(SUPABASE_URL, sbHeaders, buyerPhone, count);
            console.log(`[payapp-feedback] salon credited phone=${buyerPhone} +${count} (mul_no=${mulNo})`);
          } else {
            const chk = await fetch(`${SUPABASE_URL}/rest/v1/customer_orders?payapp_order_id=eq.${encodeURIComponent(mulNo)}&select=status`, { headers: sbHeaders });
            const rows = await chk.json().catch(() => []);
            const alreadyPaid = Array.isArray(rows) && rows.some(r => r.status === 'paid');
            if (!alreadyPaid && count > 0) {
              await fetch(`${SUPABASE_URL}/rest/v1/customer_orders`, { method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
                body: JSON.stringify({ phone: buyerPhone, payapp_order_id: mulNo, count, price, status: 'paid', paid_at: new Date().toISOString() }) });
              await rpcAddSalon(SUPABASE_URL, sbHeaders, buyerPhone, count);
              console.log(`[payapp-feedback] salon fallback credited phone=${buyerPhone} +${count} (mul_no=${mulNo})`);
            }
          }
        }
        return res.status(200).send('SUCCESS');
      }

      // 멱등 처리: status != paid 인 주문만 paid 로 전환하고, 그 행을 돌려받음
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/credit_orders?payapp_order_id=eq.${encodeURIComponent(mulNo)}&status=neq.paid`,
        {
          method: 'PATCH',
          headers: { ...sbHeaders, Prefer: 'return=representation' },
          body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() }),
        }
      );
      let updated = [];
      try { updated = await patchRes.json(); } catch {}

      if (Array.isArray(updated) && updated.length > 0) {
        const ord = updated[0];
        await rpcAddCredits(SUPABASE_URL, sbHeaders, ord.user_id, ord.amount, mulNo, `충전 ${ord.price}원`);
        console.log(`[payapp-feedback] credited user=${ord.user_id} +${ord.amount} (mul_no=${mulNo})`);
        return res.status(200).send('SUCCESS');
      }

      // 주문 행이 없을 때 폴백: 이미 paid 주문이 없고 var2/price가 있으면 새로 만들고 적립
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/credit_orders?payapp_order_id=eq.${encodeURIComponent(mulNo)}&select=status`,
        { headers: sbHeaders }
      );
      const rows = await chk.json().catch(() => []);
      const alreadyPaid = Array.isArray(rows) && rows.some(r => r.status === 'paid');
      if (!alreadyPaid && userIdVar && price > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/credit_orders`, {
          method: 'POST',
          headers: { ...sbHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: userIdVar, payapp_order_id: mulNo, amount: price, price,
            status: 'paid', paid_at: new Date().toISOString(),
          }),
        });
        await rpcAddCredits(SUPABASE_URL, sbHeaders, userIdVar, price, mulNo, `충전 ${price}원(fallback)`);
        console.log(`[payapp-feedback] fallback credited user=${userIdVar} +${price} (mul_no=${mulNo})`);
      }
      return res.status(200).send('SUCCESS');
    }

    // ── 취소/환불 (8,9,32,64,70,71) → 주문 취소 표시. v1: 자동 차감 안 함(필요 시 수동) ──
    if ([8, 9, 32, 64, 70, 71].includes(payState)) {
      const tbl = isSalon ? 'customer_orders' : 'credit_orders';
      await fetch(
        `${SUPABASE_URL}/rest/v1/${tbl}?payapp_order_id=eq.${encodeURIComponent(mulNo)}`,
        { method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) }
      );
      console.log(`[payapp-feedback] cancelled mul_no=${mulNo} state=${payState}`);
      return res.status(200).send('SUCCESS');
    }

    // ── 그 외(요청접수 state=1, 가상계좌 대기 state=10 등) → 로그만 ──
    console.log(`[payapp-feedback] state=${payState} mul_no=${mulNo} (no-op)`);
    return res.status(200).send('SUCCESS');
  } catch (e) {
    console.error('[payapp-feedback] error', e);
    return res.status(200).send('SUCCESS');
  }
};

async function rpcAddCredits(url, headers, userId, amount, ref, memo) {
  return fetch(`${url}/rest/v1/rpc/add_credits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user: userId, p_amount: amount, p_kind: 'charge', p_ref: ref, p_memo: memo }),
  }).catch(() => {});
}

// 살롱 고객 대화권 충전 (전화번호 기준)
async function rpcAddSalon(url, headers, phone, count) {
  return fetch(`${url}/rest/v1/rpc/add_salon_credits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_phone: phone, p_count: count }),
  }).catch(() => {});
}
