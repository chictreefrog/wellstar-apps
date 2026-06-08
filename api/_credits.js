/**
 * 서버 공용 크레딧 헬퍼 (service_role 전용)
 * 무료 한도 소진 후 도구에서 크레딧을 차감할 때 사용.
 * 1 크레딧 = 1원.
 */

// 도구별 차감 단가 (확정 2026-06-09)
const COST = { chatbot: 10, roleplay: 100, content: 50, review: 50, dm: 20 };

// 현재 잔액 조회 (실패 시 0)
async function getBalance(url, key, userId) {
  try {
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=credit_balance`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await r.json();
    return rows && rows[0] ? (rows[0].credit_balance || 0) : 0;
  } catch {
    return 0;
  }
}

// 원자적 차감. 성공 {ok:true, balance, charged}, 잔액부족/실패 {ok:false}
async function spend(url, key, userId, tool, ref) {
  const amount = COST[tool] || 0;
  if (amount <= 0) return { ok: true, balance: null, charged: 0 };
  try {
    const r = await fetch(`${url}/rest/v1/rpc/spend_credits`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: userId, p_amount: amount, p_tool: tool, p_ref: ref || null }),
    });
    const bal = await r.json(); // 정수 (잔액부족이면 -1)
    if (typeof bal === 'number' && bal >= 0) return { ok: true, balance: bal, charged: amount };
    return { ok: false, balance: null, charged: 0 };
  } catch {
    return { ok: false, balance: null, charged: 0 };
  }
}

// 무료 한도 초과 + 잔액 부족 → 충전 안내 응답
// (기존 프론트가 429 rate_limit 핸들러로 message를 띄우므로 status 429 유지 + need_credit 플래그 추가)
function needCreditResponse(res, tool, balance, extra) {
  return res.status(429).json(Object.assign({
    error: 'rate_limit',
    need_credit: true,
    tool,
    cost: COST[tool],
    balance,
    charge_url: '/charge',
  }, extra || {}));
}

module.exports = { COST, getBalance, spend, needCreditResponse };
