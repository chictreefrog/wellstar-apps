/**
 * AI 세일즈 시스템 — 공통 크레딧 모듈
 * <script src="/shared/credits.js"></script> 로 로드 (shared/supabase.js 이후)
 *
 * 1단계 제공: 잔액 조회, 포맷, 충전 페이지 이동
 * 2단계 예정: 각 도구에서 무료 한도 소진 후 차감/안내에 사용
 */
window.DinoCredits = (function () {
  // 도구별 차감 단가 (1 크레딧 = 1원) — 2단계 연결 시 참조
  const COST = {
    chatbot: 10,    // 1답변
    roleplay: 100,  // 1세션
    content: 50,    // 1건
    review: 50,     // 회고 1건
  };

  async function _sb() {
    if (window.dinoSupabase) return window.dinoSupabase;
    await new Promise((r) => window.addEventListener('dino-supabase-ready', r, { once: true }));
    return window.dinoSupabase;
  }

  // 현재 로그인 사용자의 잔액(원/크레딧). 미로그인 시 null.
  async function getBalance() {
    const sb = await _sb();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data } = await sb.from('profiles').select('credit_balance').eq('id', session.user.id).single();
    return data ? (data.credit_balance || 0) : 0;
  }

  function format(n) {
    return (n || 0).toLocaleString('ko-KR');
  }

  // 충전 페이지로 이동 (돌아올 경로를 ?from= 으로 전달)
  function goCharge(fromPath) {
    const from = fromPath || (location.pathname + location.search);
    location.href = '/charge?from=' + encodeURIComponent(from);
  }

  return { COST, getBalance, format, goCharge };
})();
