/**
 * AI 세일즈 시스템 — 인증 모듈
 * 가입: 번호 → SMS 인증 → 비밀번호 설정 → 프로필
 * 로그인: 번호 + 비밀번호 (SMS 불필요)
 * 비번 분실: 번호 → SMS 재인증 → 비밀번호 재설정
 */

window.DinoAuth = (function() {
  let currentUser = null;
  let currentProfile = null;
  let supabase = null;
  let onAuthChangeCallbacks = [];
  let pendingPhone = '';
  let authMode = ''; // 'signup' | 'reset'

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
      .dino-auth-link {
        color: #FF8F65; font-size: 13px; cursor: pointer; text-align: center;
        display: block; margin-top: 8px; background: none; border: none;
        font-family: inherit; text-decoration: underline;
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

        <!-- Step 1: 로그인 (번호 + 비밀번호) -->
        <div class="dino-auth-step active" id="dino-step-login">
          <div class="dino-auth-title">AI 세일즈 시스템</div>
          <div class="dino-auth-sub">로그인하세요</div>
          <input class="dino-auth-input" id="dino-login-phone" type="tel"
            placeholder="휴대폰 번호" maxlength="11" inputmode="numeric">
          <input class="dino-auth-input" id="dino-login-pw" type="password"
            placeholder="비밀번호">
          <div class="dino-auth-error" id="dino-error-login"></div>
          <button class="dino-auth-btn" id="dino-btn-login" onclick="DinoAuth._login()">로그인</button>
          <div class="dino-auth-divider">또는</div>
          <button class="dino-auth-btn-ghost" onclick="DinoAuth._goStep('phone')">회원가입</button>
          <button class="dino-auth-link" onclick="DinoAuth._startReset()">비밀번호를 잊었어요</button>
          <button class="dino-auth-link" style="color:rgba(255,255,255,0.3);margin-top:12px" onclick="DinoAuth._closeModal()">나중에 로그인</button>
        </div>

        <!-- Step 2: 회원가입 - 번호 입력 (SMS 인증) -->
        <div class="dino-auth-step" id="dino-step-phone">
          <div class="dino-auth-title" id="dino-phone-title">회원가입</div>
          <div class="dino-auth-sub" id="dino-phone-sub">휴대폰 번호로 본인 인증을 해주세요</div>
          <input class="dino-auth-input" id="dino-phone" type="tel"
            placeholder="휴대폰 번호 (예: 01012345678)" maxlength="11" inputmode="numeric">
          <div class="dino-auth-error" id="dino-error-phone"></div>
          <button class="dino-auth-btn" id="dino-btn-send" onclick="DinoAuth._sendOTP()">인증번호 받기</button>
          <button class="dino-auth-link" onclick="DinoAuth._goStep('login')">이미 계정이 있어요</button>
        </div>

        <!-- Step 3: OTP 입력 -->
        <div class="dino-auth-step" id="dino-step-otp">
          <div class="dino-auth-title">인증번호 입력</div>
          <div class="dino-auth-sub" id="dino-otp-sub">문자로 전송된 6자리 코드를 입력하세요</div>
          <input class="dino-auth-input" id="dino-otp" type="text"
            placeholder="인증번호 6자리" maxlength="6" inputmode="numeric">
          <div class="dino-auth-error" id="dino-error-otp"></div>
          <button class="dino-auth-btn" id="dino-btn-verify" onclick="DinoAuth._verifyOTP()">확인</button>
          <button class="dino-auth-link" onclick="DinoAuth._goStep('phone')">다시 보내기</button>
        </div>

        <!-- Step 4: 비밀번호 설정 -->
        <div class="dino-auth-step" id="dino-step-password">
          <div class="dino-auth-title" id="dino-pw-title">비밀번호 설정</div>
          <div class="dino-auth-sub">로그인에 사용할 비밀번호를 설정하세요</div>
          <input class="dino-auth-input" id="dino-pw1" type="password" placeholder="비밀번호 (6자 이상)">
          <input class="dino-auth-input" id="dino-pw2" type="password" placeholder="비밀번호 확인">
          <div class="dino-auth-error" id="dino-error-pw"></div>
          <button class="dino-auth-btn" id="dino-btn-pw" onclick="DinoAuth._setPassword()">설정 완료</button>
        </div>

        <!-- Step 5: 프로필 설정 (신규 가입 시) -->
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

  // ═══ 로그인 (번호 + 비밀번호) ═══
  async function login() {
    const phone = document.getElementById('dino-login-phone').value.replace(/\D/g, '');
    const pw = document.getElementById('dino-login-pw').value;

    if (phone.length < 10) {
      document.getElementById('dino-error-login').textContent = '올바른 전화번호를 입력해주세요';
      return;
    }
    if (!pw) {
      document.getElementById('dino-error-login').textContent = '비밀번호를 입력해주세요';
      return;
    }

    const btn = document.getElementById('dino-btn-login');
    btn.disabled = true;
    btn.textContent = '로그인 중...';

    try {
      // 전화번호를 이메일 형식으로 변환 (Supabase email auth 활용)
      const fakeEmail = phone + '@dino.wellstar.life';
      const { data, error } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: pw,
      });
      if (error) throw error;

      currentUser = data.user;
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
      currentProfile = profile;

      closeModal();
      notifyAuthChange();
    } catch (err) {
      document.getElementById('dino-error-login').textContent =
        err.message === 'Invalid login credentials'
          ? '전화번호 또는 비밀번호가 일치하지 않아요'
          : (err.message || '로그인에 실패했어요');
    } finally {
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  }

  // ═══ 회원가입 - SMS 인증 ═══
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
      document.getElementById('dino-otp-sub').textContent =
        phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') + '(으)로 인증번호를 보냈어요';
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
      const res = await fetch('/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', phone: pendingPhone, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '인증 실패');

      // SMS 인증 성공 → 비밀번호 설정 단계로
      if (authMode === 'reset') {
        document.getElementById('dino-pw-title').textContent = '새 비밀번호 설정';
      } else {
        document.getElementById('dino-pw-title').textContent = '비밀번호 설정';
      }
      goStep('password');
    } catch (err) {
      document.getElementById('dino-error-otp').textContent = err.message || '인증에 실패했어요';
    } finally {
      btn.disabled = false;
      btn.textContent = '확인';
    }
  }

  // ═══ 비밀번호 설정 ═══
  async function setPassword() {
    const pw1 = document.getElementById('dino-pw1').value;
    const pw2 = document.getElementById('dino-pw2').value;

    if (pw1.length < 6) {
      document.getElementById('dino-error-pw').textContent = '비밀번호는 6자 이상이어야 해요';
      return;
    }
    if (pw1 !== pw2) {
      document.getElementById('dino-error-pw').textContent = '비밀번호가 일치하지 않아요';
      return;
    }

    const btn = document.getElementById('dino-btn-pw');
    btn.disabled = true;
    btn.textContent = '처리 중...';

    try {
      const fakeEmail = pendingPhone + '@dino.wellstar.life';

      if (authMode === 'reset') {
        // 비밀번호 재설정: 서버에서 처리
        const res = await fetch('/api/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset-password', phone: pendingPhone, password: pw1 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '재설정 실패');

        // 새 비밀번호로 로그인
        const { data: loginData, error } = await supabase.auth.signInWithPassword({
          email: fakeEmail, password: pw1,
        });
        if (error) throw error;

        currentUser = loginData.user;
        const { data: profile } = await supabase
          .from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = profile;

        closeModal();
        notifyAuthChange();
      } else {
        // 신규 가입: 서버에서 계정 생성
        const res = await fetch('/api/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'signup', phone: pendingPhone, password: pw1 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '가입 실패');

        // 생성된 계정으로 로그인
        const { data: loginData, error } = await supabase.auth.signInWithPassword({
          email: fakeEmail, password: pw1,
        });
        if (error) throw error;

        currentUser = loginData.user;
        const { data: profile } = await supabase
          .from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = profile;

        if (!profile || !profile.display_name) {
          goStep('profile');
        } else {
          closeModal();
          notifyAuthChange();
        }
      }
    } catch (err) {
      document.getElementById('dino-error-pw').textContent = err.message || '처리에 실패했어요';
    } finally {
      btn.disabled = false;
      btn.textContent = '설정 완료';
    }
  }

  // ═══ 비밀번호 분실 ═══
  function startReset() {
    authMode = 'reset';
    document.getElementById('dino-phone-title').textContent = '비밀번호 재설정';
    document.getElementById('dino-phone-sub').textContent = '가입한 휴대폰 번호로 본인 인증을 해주세요';
    goStep('phone');
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
          phone: pendingPhone,
          business_code: bizCode || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentUser.id);

      if (profileErr) throw profileErr;

      if (inviteCode) {
        try {
          const { data: joinResult } = await supabase.rpc('join_team_by_code', { code: inviteCode });
          if (joinResult?.error) {
            document.getElementById('dino-error-profile').textContent = joinResult.error;
            // 에러가 나도 프로필은 이미 저장됨 — 초대코드만 실패
            // 버튼은 계속 사용 가능하게 유지
          }
        } catch {
          // 초대코드 실패해도 가입은 진행
        }
      }

      const { data: updated } = await supabase
        .from('profiles').select('*').eq('id', currentUser.id).single();
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
        .from('profiles').select('*').eq('id', currentUser.id).single();
      currentProfile = profile;
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        currentUser = session.user;
        const { data: profile } = await supabase
          .from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = profile;
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
    _login: login,
    _sendOTP: sendOTP,
    _verifyOTP: verifyOTP,
    _setPassword: setPassword,
    _saveProfile: saveProfile,
    _startReset: startReset,
    _closeModal: closeModal,
    _goStep: (step) => { authMode = step === 'phone' ? 'signup' : authMode; goStep(step); },
  };
})();
