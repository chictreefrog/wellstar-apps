/**
 * AI 세일즈 시스템 — 공통 하단 네비게이션
 * 다이어리, 플래너(자체 네비 보유)를 제외한 앱에서 사용
 *
 * <script src="/shared/nav.js"></script>
 */
(function() {
  if (document.getElementById('dino-global-nav')) return;

  const current = location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
  const items = [
    { icon: '🏠', label: '홈', href: '/main/' },
    { icon: '🤖', label: '코치', href: '/chatbot/' },
    { icon: '📒', label: '다이어리', href: '/diary/' },
    { icon: '🧰', label: '도구', href: '/main/', tab: 'tools' },
  ];

  const style = document.createElement('style');
  style.textContent = `
    .dino-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(10,10,20,0.95);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,0.08);display:flex;padding-bottom:env(safe-area-inset-bottom,0);z-index:9990}
    .dino-nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 0;text-decoration:none;color:rgba(255,255,255,0.35);font-size:10px;font-family:'Noto Sans KR',-apple-system,sans-serif}
    .dino-nav a .dn-icon{font-size:20px}
    .dino-nav a.active{color:#FF6B35}
  `;
  document.head.appendChild(style);

  const nav = document.createElement('nav');
  nav.id = 'dino-global-nav';
  nav.className = 'dino-nav';
  nav.innerHTML = items.map(item => {
    const isActive = current === item.href.replace(/\/$/, '');
    const href = item.tab ? `${item.href}#tab=${item.tab}` : item.href;
    return `<a href="${href}" class="${isActive ? 'active' : ''}"><span class="dn-icon">${item.icon}</span><span>${item.label}</span></a>`;
  }).join('');
  document.body.appendChild(nav);

  // 본문 하단 패딩 추가 (네비에 가리지 않도록)
  document.body.style.paddingBottom = 'calc(64px + env(safe-area-inset-bottom, 0px))';
})();
