/**
 * AI 세일즈 시스템 — 로그인 게이트
 * 코어 도구(챗봇, 다이어리, 플래너, 시뮬레이터, 명함, 팀)에서 사용
 * 로그인하지 않으면 앱 내용을 가리고 로그인 유도
 *
 * <script src="/shared/supabase.js"></script>
 * <script src="/shared/auth.js"></script>
 * <script src="/shared/login-gate.js"></script>
 */
(function() {
  function show() {
    if (document.getElementById('dino-login-gate')) return;
    const div = document.createElement('div');
    div.id = 'dino-login-gate';
    div.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(10,10,20,0.97);display:flex;align-items:center;justify-content:center;font-family:"Noto Sans KR",-apple-system,sans-serif';
    div.innerHTML = `
      <div style="text-align:center;padding:40px 24px;max-width:360px">
        <div style="font-size:56px;margin-bottom:16px">🔐</div>
        <div style="font-size:20px;font-weight:800;color:#F5F5F7;margin-bottom:8px">로그인이 필요해요</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6;margin-bottom:24px">
          이 도구는 로그인 후 사용할 수 있어요.<br>
          무료 체험도 가능합니다!
        </div>
        <button onclick="DinoAuth.showLogin()" style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#FF6B35,#FF8F65);color:white;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px">로그인 / 회원가입</button>
        <a href="/main/" style="display:block;padding:12px;color:rgba(255,255,255,0.4);font-size:13px;text-decoration:none">홈으로 돌아가기</a>
      </div>
    `;
    document.body.appendChild(div);
  }

  function hide() {
    const el = document.getElementById('dino-login-gate');
    if (el) el.remove();
  }

  // Wait for auth to initialize, then check
  window.addEventListener('dino-auth-change', (e) => {
    if (e.detail.user) hide();
  });

  // Check after DinoAuth.init()
  const checkInterval = setInterval(() => {
    if (typeof DinoAuth !== 'undefined') {
      clearInterval(checkInterval);
      // Give auth time to restore session
      setTimeout(() => {
        if (!DinoAuth.isLoggedIn()) show();
      }, 1500);
    }
  }, 100);
})();
