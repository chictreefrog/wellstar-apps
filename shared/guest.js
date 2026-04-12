/**
 * AI 세일즈 시스템 — 게스트 체험 관리 모듈
 * 의존성: /shared/supabase.js, /shared/auth.js (먼저 로드)
 *
 * 사용법:
 *   <script src="/shared/supabase.js"></script>
 *   <script src="/shared/auth.js"></script>
 *   <script src="/shared/guest.js"></script>
 *
 *   // 앱 로드 시
 *   DinoAuth.init();
 *   DinoAuth.onAuthChange((user, profile) => {
 *     DinoGuest.check(profile); // 게스트면 자동으로 만료 체크
 *   });
 */

window.DinoGuest = (function() {
  const TRIAL_DAYS = 7; // 체험 기간 (쉽게 변경 가능)

  function injectStyles() {
    if (document.getElementById('dino-guest-styles')) return;
    const style = document.createElement('style');
    style.id = 'dino-guest-styles';
    style.textContent = `
      .dino-trial-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 9998;
        background: linear-gradient(90deg, #FF6B35, #FF8F65);
        color: white; text-align: center; padding: 8px 16px;
        font-size: 13px; font-weight: 600;
        font-family: 'Noto Sans KR', -apple-system, sans-serif;
      }
      .dino-trial-banner a { color: white; text-decoration: underline; margin-left: 8px; }
      .dino-expired-overlay {
        position: fixed; inset: 0; z-index: 99998;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(10px);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Noto Sans KR', -apple-system, sans-serif;
      }
      .dino-expired-modal {
        background: #1A1A2E; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 20px; padding: 36px 24px; width: 90%; max-width: 380px;
        color: #F5F5F7; text-align: center;
      }
      .dino-expired-icon { font-size: 56px; margin-bottom: 12px; }
      .dino-expired-title { font-size: 20px; font-weight: 900; margin-bottom: 8px; }
      .dino-expired-desc { font-size: 14px; color: rgba(255,255,255,0.6); line-height: 1.6; margin-bottom: 24px; }
      .dino-expired-btn {
        display: block; width: 100%; padding: 14px; border-radius: 12px; border: none;
        font-size: 15px; font-weight: 700; cursor: pointer; margin-bottom: 10px;
        font-family: inherit;
      }
      .dino-expired-btn-primary { background: linear-gradient(135deg, #FF6B35, #FF8F65); color: white; }
      .dino-expired-btn-sub { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
    `;
    document.head.appendChild(style);
  }

  function getDaysLeft(profile) {
    if (!profile || !profile.guest_started_at) return TRIAL_DAYS;
    const started = new Date(profile.guest_started_at);
    const now = new Date();
    const elapsed = Math.floor((now - started) / (1000 * 60 * 60 * 24));
    return Math.max(0, TRIAL_DAYS - elapsed);
  }

  function isExpired(profile) {
    return profile && profile.role === 'guest' && getDaysLeft(profile) <= 0;
  }

  function isGuest(profile) {
    return profile && profile.role === 'guest';
  }

  function showTrialBanner(daysLeft) {
    if (document.getElementById('dino-trial-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'dino-trial-banner';
    banner.className = 'dino-trial-banner';
    banner.innerHTML = daysLeft <= 1
      ? `체험 기간이 오늘 종료돼요! <a href="/team/">팀 합류하기</a>`
      : `체험 기간 ${daysLeft}일 남음 <a href="/team/">팀 합류하기</a>`;
    document.body.prepend(banner);
    document.body.style.paddingTop = '36px';
  }

  function showExpiredOverlay() {
    if (document.getElementById('dino-expired-overlay')) return;
    const div = document.createElement('div');
    div.id = 'dino-expired-overlay';
    div.className = 'dino-expired-overlay';
    div.innerHTML = `
      <div class="dino-expired-modal">
        <div class="dino-expired-icon">⏰</div>
        <div class="dino-expired-title">체험 기간이 종료됐어요</div>
        <div class="dino-expired-desc">
          ${TRIAL_DAYS}일간의 무료 체험이 끝났어요.<br>
          팀에 합류하면 모든 기능을<br>계속 무료로 사용할 수 있어요!
        </div>
        <button class="dino-expired-btn dino-expired-btn-primary"
          onclick="location.href='/team/'">팀에 합류하기 (무료)</button>
        <button class="dino-expired-btn dino-expired-btn-sub"
          onclick="location.href='/main/'">개인 구독 알아보기</button>
      </div>
    `;
    document.body.appendChild(div);
  }

  function check(profile) {
    if (!profile) return;
    if (profile.role !== 'guest') return; // 파트너/리더/admin은 패스

    injectStyles();

    if (isExpired(profile)) {
      showExpiredOverlay();
    } else {
      const daysLeft = getDaysLeft(profile);
      if (daysLeft <= 3) {
        showTrialBanner(daysLeft);
      }
    }
  }

  return {
    check,
    isGuest,
    isExpired,
    getDaysLeft,
    TRIAL_DAYS
  };
})();
