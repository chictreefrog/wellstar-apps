/**
 * AI 세일즈 시스템 — 공통 테마 토글 버튼
 * 모든 앱에서 <script src="/shared/theme-toggle.js"></script>로 로드
 * 우측 상단에 🌙/☀️ 토글 버튼 자동 생성
 */
(function() {
  if (document.getElementById('dino-theme-toggle')) return;

  // 저장된 테마 복원
  const saved = localStorage.getItem('dino_global_theme');
  if (saved === 'light') {
    document.body.classList.add('light-theme');
  }

  // 라이트 테마 기본 CSS (앱에 없으면 이걸 사용)
  if (!document.querySelector('style[data-theme-fallback]')) {
    const fallback = document.createElement('style');
    fallback.setAttribute('data-theme-fallback', '1');
    fallback.textContent = `
      body.light-theme {
        --bg: #F5F5FA !important;
        --bg2: #FFFFFF !important;
        --card: rgba(255,255,255,0.9) !important;
        --text: #1A1A2E !important;
        --text2: #555577 !important;
        --text3: #8888AA !important;
        --border: rgba(0,0,0,0.08) !important;
        background: #F5F5FA !important;
        color: #1A1A2E !important;
      }
      body.light-theme .dino-nav {
        background: rgba(245,245,250,0.95) !important;
        border-top-color: rgba(0,0,0,0.08) !important;
      }
      body.light-theme .dino-nav a { color: rgba(0,0,0,0.35) !important; }
      body.light-theme .dino-nav a.active { color: #FF6B35 !important; }
    `;
    document.head.appendChild(fallback);
  }

  // 토글 버튼 생성
  const btn = document.createElement('button');
  btn.id = 'dino-theme-toggle';
  btn.textContent = document.body.classList.contains('light-theme') ? '🌙' : '☀️';
  btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9980;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);backdrop-filter:blur(10px);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;';

  btn.onclick = function() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('dino_global_theme', isLight ? 'light' : 'dark');
    btn.textContent = isLight ? '🌙' : '☀️';
    btn.style.background = isLight ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.3)';
    btn.style.borderColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';

    // theme-color meta 업데이트
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isLight ? '#F5F5FA' : '#0a0a14';
  };

  // 라이트 모드 초기 스타일
  if (document.body.classList.contains('light-theme')) {
    btn.style.background = 'rgba(255,255,255,0.8)';
    btn.style.borderColor = 'rgba(0,0,0,0.1)';
  }

  document.body.appendChild(btn);
})();
