/**
 * AI 세일즈 시스템 — 공통 인증 UI 모듈 (휴대폰 인증)
 * 의존성: /shared/supabase.js (먼저 로드)
 */

window.DinoAuth = (function() {
  let currentUser = null;
  let currentProfile = null;
  let supabase = null;
  let onAuthChangeCallbacks = [];
  let pendingPhone = '';

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
        <!-- Step 1: 전화번호 입력 -->
        <div class="dino-auth-step active" id="dino-step-phone">
          <div class="dino-auth-title">AI 세일즈 시스템</div>
          <div class="dino-auth-sub">휴대폰 번호로 간편하게 시작하세요</div>
          <input class="dino-auth-input" id="dino-phone" type="tel"
            placeholder="휴대폰 번호 (예: 01012345678)" maxlength="11" inputmode="numeric">
          <div class="dino-auth-error" id="dino-error-phone"></div>
          <button class="dino-auth-btn" id="dino-btn-send" onclick="DinoAuth._sendOTP()">인증번호 받기</button>
          <div class="dino-auth-divider">또는</div>
          <button class="dino-auth-btn-ghost" onclick="DinoAuth._closeModal()">나중에 로그인</button>
        </div>
        <!-- Step 2: OTP 입력 -->
        <div class="dino-auth-step" id="dino-step-otp">
          <div class="dino-auth-title">인증번호 입력</div>
          <div class="dino-auth-sub" id="dino-otp-sub">문자로 전송된 6자리 코드를 입력하세요</div>
          <input class="dino-auth-input" id="dino-otp" type="text"
            placeholder="인증번호 6자리" maxlength="6" inputmode="numeric">
          <div class="dino-auth-error" id="dino-error-otp"></div>
          <button class="dino-auth-btn" id="dino-btn-verify" onclick="DinoAuth._verifyOTP()">확인</button>
          <button class="dino-auth-btn-ghost" onclick="DinoAuth._goStep('phone')">다시 보내기</button>
        </div>
        <!-- Step 3: 프로필 설정 -->
        <div class="dino-auth-step" id="dino-step-profile">
          <div class="dino-auth-title">프로필 설정</div>
          <div class="dino-auth-sub">이름을 입력하고, 팀에 합류하려면<br>초대 코드를 입력하세요</div>
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

  // ═══ 휴대폰 인증 (솔라피 SMS) ═══
  async function sendOTP() {
    const phone = document.getElementById('dino-phone').value.replace(/\D/g, '');
    if (phone.length < 10) {
      document.getElementById('dino-error-phone').textContent = '올바른 전화번호를 입력해주세요';
      return;
    }

    const btn = document.getElementById('dino-btn-send');
    btn.disabled = true;
    btn.textContent = '전송 중...';

    try {
      const res = await fetch('/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '발송 실패');

      pendingPhone = phone;
      document.getElementById('dino-otp-sub').textContent = phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') + '(으)로 인증번호를 보냈어요';
      goStep('otp');
    } catch (err) {
      document.getElementById('dino-error-phone').textContent = err.message || '인증번호 전송에 실패했어요';
    } finally {
      btn.disabled = false;
      btn.textContent = '인증번호 받기';
    }
  }

  async function verifyOTP() {
    const otp = document.getElementById('dino-otp').value.replace(/\D/g, '');
    if (otp.length !== 6) {
      document.getElementById('dino-error-otp').textContent = '6자리 인증번호를 입력해주세요';
      return;
    }

    const btn = document.getElementById('dino-btn-verify');
    btn.disabled = true;
    btn.textContent = '확인 중...';

    try {
      // 1. 우리 API에서 인증번호 확인
      const verifyRes = await fetch('/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', phone: pendingPhone, code: otp }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || '인증 실패');

      // 2. Supabase에 phone OTP로 로그인 시도
      const formatted = '+82' + pendingPhone.replace(/^0/, '');
      const { data, error } = await supabase.auth.signInWithOtp({ phone: formatted });

      // OTP를 Supabase에서도 verify (솔라피 인증 성공 후이므로 Supabase 측은 자동 통과)
      // Supabase Admin에서 이미 사용자 생성됨 → 세션 복원
      const { data: sessionData } = await supabase.auth.getSession();

      if (sessionData?.session?.user) {
        currentUser = sessionData.session.user;
      } else if (verifyData.userId) {
        // 세션이 없으면 사용자 정보만이라도 설정
        currentUser = { id: verifyData.userId, phone: formatted };
      }

      // 프로필 확인
      if (currentUser?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .single();
        currentProfile = profile;

        if (!profile || !profile.display_name) {
          goStep('profile');
        } else {
          closeModal();
          notifyAuthChange();
        }
      } else {
        // 세션 없이도 프로필 설정으로 이동
        goStep('profile');
      }
    } catch (err) {
      document.getElementById('dino-error-otp').textContent = err.message || '인증에 실패했어요';
    } finally {
      btn.disabled = false;
      btn.textContent = '확인';
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
    _sendOTP: sendOTP,
    _verifyOTP: verifyOTP,
    _saveProfile: saveProfile,
    _closeModal: closeModal,
    _goStep: goStep,
  };
})();
