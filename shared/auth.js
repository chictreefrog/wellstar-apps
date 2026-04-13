/**
 * AI 세일즈 시스템 — 공통 인증 UI 모듈
 * 의존성: /shared/supabase.js (먼저 로드)
 *
 * 사용법:
 *   <script src="/shared/supabase.js"></script>
 *   <script src="/shared/auth.js"></script>
 *   DinoAuth.init();
 */

window.DinoAuth = (function() {
  let currentUser = null;
  let currentProfile = null;
  let supabase = null;
  let onAuthChangeCallbacks = [];

  function injectStyles() {
    if (document.getElementById('dino-auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'dino-auth-styles';
    style.textContent = `
      .dino-auth-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity .3s;
      }
      .dino-auth-overlay.show { opacity: 1; }
      .dino-auth-modal {
        background: #1A1A2E; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 20px; padding: 32px 24px; width: 90%; max-width: 380px;
        color: #F5F5F7; font-family: 'Noto Sans KR', -apple-system, sans-serif;
        transform: translateY(20px); transition: transform .3s;
      }
      .dino-auth-overlay.show .dino-auth-modal { transform: translateY(0); }
      .dino-auth-title { font-size: 20px; font-weight: 800; text-align: center; margin-bottom: 4px; }
      .dino-auth-sub { font-size: 13px; color: rgba(255,255,255,0.5); text-align: center; margin-bottom: 24px; line-height: 1.5; }
      .dino-auth-input {
        width: 100%; padding: 14px 16px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
        color: #F5F5F7; font-size: 15px; margin-bottom: 12px; outline: none;
        font-family: inherit;
      }
      .dino-auth-input:focus { border-color: #FF6B35; }
      .dino-auth-input::placeholder { color: rgba(255,255,255,0.3); }
      .dino-auth-btn {
        width: 100%; padding: 14px; border-radius: 12px; border: none;
        background: linear-gradient(135deg, #FF6B35, #FF8F65);
        color: white; font-size: 15px; font-weight: 700; cursor: pointer;
        font-family: inherit; margin-bottom: 8px;
      }
      .dino-auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .dino-auth-btn-ghost {
        width: 100%; padding: 12px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.1); background: transparent;
        color: rgba(255,255,255,0.5); font-size: 13px; cursor: pointer;
        font-family: inherit;
      }
      .dino-auth-error {
        color: #FF453A; font-size: 13px; text-align: center;
        margin-bottom: 12px; min-height: 18px;
      }
      .dino-auth-success {
        color: #30D158; font-size: 13px; text-align: center;
        margin-bottom: 12px; min-height: 18px;
      }
      .dino-auth-divider {
        display: flex; align-items: center; gap: 12px;
        color: rgba(255,255,255,0.3); font-size: 12px; margin: 16px 0;
      }
      .dino-auth-divider::before, .dino-auth-divider::after {
        content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.1);
      }
      .dino-auth-step { display: none; }
      .dino-auth-step.active { display: block; }
    `;
    document.head.appendChild(style);
  }

  function createModal() {
    if (document.getElementById('dino-auth-overlay')) return;
    const div = document.createElement('div');
    div.id = 'dino-auth-overlay';
    div.className = 'dino-auth-overlay';
    div.innerHTML = `
      <div class="dino-auth-modal">
        <!-- Step 1: 이메일 입력 -->
        <div class="dino-auth-step active" id="dino-step-email">
          <div class="dino-auth-title">AI 세일즈 시스템</div>
          <div class="dino-auth-sub">이메일로 간편하게 시작하세요</div>
          <input class="dino-auth-input" id="dino-email" type="email"
            placeholder="이메일 주소" inputmode="email">
          <div class="dino-auth-error" id="dino-error-email"></div>
          <button class="dino-auth-btn" id="dino-btn-send" onclick="DinoAuth._sendMagicLink()">로그인 링크 받기</button>
          <div class="dino-auth-divider">또는</div>
          <button class="dino-auth-btn-ghost" onclick="DinoAuth._closeModal()">나중에 로그인</button>
        </div>
        <!-- Step 2: 이메일 확인 안내 -->
        <div class="dino-auth-step" id="dino-step-check">
          <div class="dino-auth-title">메일함을 확인하세요</div>
          <div class="dino-auth-sub" id="dino-check-sub">이메일로 로그인 링크를 보냈어요.<br>링크를 클릭하면 자동으로 로그인됩니다.</div>
          <div class="dino-auth-success">📩 메일이 도착하지 않으면 스팸함도 확인해주세요</div>
          <button class="dino-auth-btn-ghost" onclick="DinoAuth._goStep('email')">다시 보내기</button>
        </div>
        <!-- Step 3: 프로필 설정 (신규 가입 시) -->
        <div class="dino-auth-step" id="dino-step-profile">
          <div class="dino-auth-title">프로필 설정</div>
          <div class="dino-auth-sub">팀에 합류하려면 초대 코드를 입력하세요</div>
          <input class="dino-auth-input" id="dino-name" type="text" placeholder="이름">
          <input class="dino-auth-input" id="dino-biz-code" type="text" placeholder="사업자번호 / 설계사번호 (선택)">
          <input class="dino-auth-input" id="dino-invite" type="text" placeholder="초대 코드 (선택)" maxlength="6" style="text-transform:uppercase">
          <div class="dino-auth-error" id="dino-error-profile"></div>
          <button class="dino-auth-btn" id="dino-btn-profile" onclick="DinoAuth._saveProfile()">시작하기</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
  }

  function showModal() {
    createModal();
    const overlay = document.getElementById('dino-auth-overlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function closeModal() {
    const overlay = document.getElementById('dino-auth-overlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(() => overlay.style.display = 'none', 300);
  }

  function goStep(step) {
    document.querySelectorAll('.dino-auth-step').forEach(s => s.classList.remove('active'));
    document.getElementById('dino-step-' + step).classList.add('active');
    document.querySelectorAll('.dino-auth-error').forEach(e => e.textContent = '');
  }

  // ═══ 이메일 인증 플로우 ═══
  async function sendMagicLink() {
    const email = document.getElementById('dino-email').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('dino-error-email').textContent = '올바른 이메일을 입력해주세요';
      return;
    }

    const btn = document.getElementById('dino-btn-send');
    btn.disabled = true;
    btn.textContent = '전송 중...';

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + '/main/' }
      });
      if (error) throw error;

      document.getElementById('dino-check-sub').innerHTML =
        `<strong>${email}</strong>으로<br>로그인 링크를 보냈어요.<br>링크를 클릭하면 자동으로 로그인됩니다.`;
      goStep('check');
    } catch (err) {
      document.getElementById('dino-error-email').textContent = err.message || '전송에 실패했어요';
    } finally {
      btn.disabled = false;
      btn.textContent = '로그인 링크 받기';
    }
  }

  // ═══ 프로필 저장 ═══
  async function saveProfile() {
    const name = document.getElementById('dino-name').value.trim();
    if (!name) {
      document.getElementById('dino-error-profile').textContent = '이름을 입력해주세요';
      return;
    }

    const btn = document.getElementById('dino-btn-profile');
    btn.disabled = true;
    btn.textContent = '저장 중...';

    try {
      const bizCode = document.getElementById('dino-biz-code').value.trim();
      const inviteCode = document.getElementById('dino-invite').value.trim().toUpperCase();

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          display_name: name,
          business_code: bizCode || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentUser.id);

      if (profileErr) throw profileErr;

      if (inviteCode) {
        const { data: joinResult } = await supabase.rpc('join_team_by_code', { code: inviteCode });
        if (joinResult?.error) {
          document.getElementById('dino-error-profile').textContent = joinResult.error;
          btn.disabled = false;
          btn.textContent = '시작하기';
          return;
        }
      }

      const { data: updated } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      currentProfile = updated;
      closeModal();
      notifyAuthChange();
    } catch (err) {
      document.getElementById('dino-error-profile').textContent = err.message || '저장에 실패했어요';
    } finally {
      btn.disabled = false;
      btn.textContent = '시작하기';
    }
  }

  // ═══ 세션 관리 ═══
  async function init() {
    injectStyles();

    if (!window.dinoSupabase) {
      await new Promise(resolve => {
        window.addEventListener('dino-supabase-ready', resolve, { once: true });
      });
    }
    supabase = window.dinoSupabase;

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
      currentProfile = profile;

      // New user — show profile setup
      if (profile && !profile.display_name) {
        showModal();
        goStep('profile');
      }
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        currentUser = session.user;
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .single();
        currentProfile = profile;

        if (profile && !profile.display_name) {
          showModal();
          goStep('profile');
        } else {
          closeModal();
        }
        notifyAuthChange();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentProfile = null;
        notifyAuthChange();
      }
    });

    notifyAuthChange();
  }

  function notifyAuthChange() {
    onAuthChangeCallbacks.forEach(cb => {
      try { cb(currentUser, currentProfile); } catch(e) {}
    });
    window.dispatchEvent(new CustomEvent('dino-auth-change', {
      detail: { user: currentUser, profile: currentProfile }
    }));
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    currentProfile = null;
    notifyAuthChange();
  }

  return {
    init,
    getUser: () => currentUser,
    getProfile: () => currentProfile,
    getSupabase: () => supabase,
    isLoggedIn: () => !!currentUser,
    requireLogin: () => { if (!currentUser) showModal(); return !!currentUser; },
    showLogin: showModal,
    logout,
    onAuthChange: (cb) => { onAuthChangeCallbacks.push(cb); },
    _sendMagicLink: sendMagicLink,
    _saveProfile: saveProfile,
    _closeModal: closeModal,
    _goStep: goStep,
  };
})();
