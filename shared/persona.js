/**
 * 내 사업 프로필(페르소나) 모달 — 재사용 모듈
 * <script src="/shared/persona.js"></script> (supabase.js, auth.js 이후)
 * 사용: DinoPersona.open(onDone) / await DinoPersona.isSet()
 * 저장 위치: profiles.company_id + profiles.persona(jsonb)
 */
window.DinoPersona = (function () {
  let sb = null, companies = [], productsByCompany = {}, current = { company_id: null, persona: {} }, _onDone = null;
  const AGE = ['20대', '30대', '40대', '50대', '60대+'];
  const GENDER = ['여', '남', '비공개'];
  const PURPOSE = ['제품 알리기', '파트너 모집', '둘 다'];
  const STAGE = ['이제 시작', '6개월~2년', '베테랑'];
  const TARGET = ['다이어트·체중관리', '건강·면역', '시니어 건강', '부업·N잡 관심', '주부·맘', '직장인', '피부·뷰티'];
  const MOTIV = ['건강 회복 경험', '경제적 자유', '시간 자유', '새로운 도전'];

  async function _sb() {
    if (window.dinoSupabase) return window.dinoSupabase;
    await new Promise(r => window.addEventListener('dino-supabase-ready', r, { once: true }));
    return window.dinoSupabase;
  }

  function injectStyles() {
    if (document.getElementById('dino-persona-styles')) return;
    const s = document.createElement('style'); s.id = 'dino-persona-styles';
    s.textContent = `
    .dp-ov{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:none;align-items:flex-end;justify-content:center}
    .dp-ov.show{display:flex}
    .dp-modal{background:#1A1A2E;color:#F5F5F7;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:22px 18px 30px;font-family:'Noto Sans KR',sans-serif}
    .dp-title{font-size:18px;font-weight:800;margin-bottom:2px}
    .dp-sub{font-size:12.5px;color:rgba(255,255,255,.5);margin-bottom:8px}
    .dp-label{font-size:13px;font-weight:700;margin:15px 2px 7px}
    .dp-chips{display:flex;flex-wrap:wrap;gap:7px}
    .dp-chip{padding:8px 13px;border-radius:999px;border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#F5F5F7;font-size:13px;cursor:pointer}
    .dp-chip.on{border-color:#FF6B35;background:linear-gradient(135deg,rgba(255,107,53,.22),rgba(191,90,242,.12))}
    .dp-input,.dp-sel{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#F5F5F7;font-size:14px;outline:none;font-family:inherit}
    .dp-btn{width:100%;padding:15px;border-radius:12px;border:none;background:linear-gradient(135deg,#FF6B35,#FF8F65);color:#fff;font-size:15px;font-weight:800;cursor:pointer;margin-top:20px;font-family:inherit}
    .dp-btn:disabled{opacity:.5}
    .dp-x{float:right;background:none;border:none;color:rgba(255,255,255,.5);font-size:24px;line-height:1;cursor:pointer}`;
    document.head.appendChild(s);
  }

  function chipGroup(items, selected, multi) {
    return items.map(v => `<div class="dp-chip ${(multi ? (selected || []).includes(v) : selected === v) ? 'on' : ''}" data-v="${v}">${v}</div>`).join('');
  }
  function bindChips(id, multi, cb) {
    const box = document.getElementById(id); if (!box) return;
    box.addEventListener('click', e => {
      const c = e.target.closest('.dp-chip'); if (!c) return;
      if (multi) c.classList.toggle('on');
      else { box.querySelectorAll('.dp-chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
      if (cb) cb(c.dataset.v);
    });
  }
  function selChip(id) { const c = document.querySelector('#' + id + ' .dp-chip.on'); return c ? c.dataset.v : ''; }
  function selChips(id) { return [...document.querySelectorAll('#' + id + ' .dp-chip.on')].map(c => c.dataset.v); }
  function setChip(id, val) { if (!val) return; const c = document.querySelector('#' + id + ' .dp-chip[data-v="' + val + '"]'); if (c) c.classList.add('on'); }

  function buildModal() {
    if (document.getElementById('dp-ov')) return;
    injectStyles();
    const d = document.createElement('div'); d.id = 'dp-ov'; d.className = 'dp-ov';
    d.innerHTML = `<div class="dp-modal">
      <button class="dp-x" onclick="DinoPersona.close()">×</button>
      <div class="dp-title">💼 내 사업 프로필</div>
      <div class="dp-sub">한 번만 설정하면 콘텐츠가 내 회사·제품·타깃에 맞춰 나와요 (약 30초)</div>
      <div class="dp-label">소속 회사</div>
      <select class="dp-sel" id="dp-company"></select>
      <div class="dp-label">주 판매 상품 <span style="color:rgba(255,255,255,.4);font-weight:400">(여러 개 가능)</span></div>
      <div class="dp-chips" id="dp-products"><span style="color:rgba(255,255,255,.4);font-size:12px">회사를 먼저 선택하세요</span></div>
      <div class="dp-label">내 연령대</div><div class="dp-chips" id="dp-age">${chipGroup(AGE, null)}</div>
      <div class="dp-label">성별</div><div class="dp-chips" id="dp-gender">${chipGroup(GENDER, null)}</div>
      <div class="dp-label">주 활동 지역</div><input class="dp-input" id="dp-region" placeholder="예: 부산 / 온라인">
      <div class="dp-label">주 타깃 고객</div><div class="dp-chips" id="dp-target">${chipGroup(TARGET, null)}</div>
      <input class="dp-input" id="dp-target-input" style="margin-top:7px" placeholder="직접 입력도 가능 (예: 30~40대 다이어트 고민 직장맘)">
      <div class="dp-label">콘텐츠 주 목적</div><div class="dp-chips" id="dp-purpose">${chipGroup(PURPOSE, null)}</div>
      <div class="dp-label">영업 단계</div><div class="dp-chips" id="dp-stage">${chipGroup(STAGE, null)}</div>
      <div class="dp-label">나의 계기 한마디 <span style="color:rgba(255,255,255,.4);font-weight:400">(선택)</span></div>
      <div class="dp-chips" id="dp-motiv">${chipGroup(MOTIV, null)}</div>
      <input class="dp-input" id="dp-motiv-input" style="margin-top:7px" placeholder="직접 입력 (예: 출산 후 14kg 감량 경험)">
      <button class="dp-btn" id="dp-save" onclick="DinoPersona._save()">저장하고 시작하기</button>
    </div>`;
    document.body.appendChild(d);
    bindChips('dp-age'); bindChips('dp-gender'); bindChips('dp-purpose'); bindChips('dp-stage');
    bindChips('dp-target', false, v => { document.getElementById('dp-target-input').value = v; });
    bindChips('dp-motiv', false, v => { document.getElementById('dp-motiv-input').value = v; });
    document.getElementById('dp-company').onchange = e => renderProducts(e.target.value);
  }

  function renderProducts(companyId) {
    const box = document.getElementById('dp-products');
    const list = productsByCompany[companyId] || [];
    if (!list.length) { box.innerHTML = '<span style="color:rgba(255,255,255,.4);font-size:12px">등록된 제품이 없어요 (관리자 등록 후 표시)</span>'; return; }
    box.innerHTML = chipGroup(list.map(p => p.name), current.persona.products || [], true);
    bindChips('dp-products', true);
  }

  async function loadCatalog() {
    const { data: comps } = await sb.from('companies').select('id,name').order('name');
    companies = comps || [];
    const { data: prods } = await sb.from('company_products').select('id,name,company_id');
    productsByCompany = {};
    (prods || []).forEach(p => { (productsByCompany[p.company_id] = productsByCompany[p.company_id] || []).push(p); });
    const sel = document.getElementById('dp-company');
    sel.innerHTML = '<option value="">— 회사 선택 —</option>' + companies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  function applyCurrent() {
    const p = current.persona || {};
    if (current.company_id) { document.getElementById('dp-company').value = current.company_id; renderProducts(current.company_id); }
    setChip('dp-age', p.age_band); setChip('dp-gender', p.gender); setChip('dp-purpose', p.purpose); setChip('dp-stage', p.sales_stage);
    if (p.region) document.getElementById('dp-region').value = p.region;
    if (p.target) document.getElementById('dp-target-input').value = p.target;
    if (p.motivation) document.getElementById('dp-motiv-input').value = p.motivation;
  }

  async function open(onDone) {
    _onDone = onDone || null;
    sb = await _sb();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { if (window.DinoAuth) DinoAuth.showLogin(); return; }
    buildModal();
    await loadCatalog();
    const { data: prof } = await sb.from('profiles').select('company_id,persona').eq('id', session.user.id).single();
    current = { company_id: prof?.company_id || null, persona: prof?.persona || {} };
    applyCurrent();
    document.getElementById('dp-ov').classList.add('show');
  }
  function close() { const o = document.getElementById('dp-ov'); if (o) o.classList.remove('show'); }

  async function _save() {
    const company_id = document.getElementById('dp-company').value || null;
    const persona = {
      products: selChips('dp-products'),
      age_band: selChip('dp-age'),
      gender: selChip('dp-gender'),
      region: document.getElementById('dp-region').value.trim(),
      target: document.getElementById('dp-target-input').value.trim(),
      purpose: selChip('dp-purpose'),
      sales_stage: selChip('dp-stage'),
      motivation: document.getElementById('dp-motiv-input').value.trim(),
    };
    const btn = document.getElementById('dp-save'); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const { data: { session } } = await sb.auth.getSession();
      const { error } = await sb.from('profiles').update({ company_id, persona }).eq('id', session.user.id);
      if (error) { btn.disabled = false; btn.textContent = '저장 실패 — 다시'; return; }
      close();
      if (_onDone) _onDone({ company_id, persona });
    } catch (e) { btn.disabled = false; btn.textContent = '저장하고 시작하기'; }
  }

  async function isSet() {
    sb = await _sb();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    const { data: prof } = await sb.from('profiles').select('company_id,persona').eq('id', session.user.id).single();
    return !!(prof && prof.company_id && prof.persona && Object.keys(prof.persona).length);
  }

  return { open, close, isSet, _save };
})();
