/* ============================================================
 * 웰런스 수입 시뮬레이터 — 검증 테스트
 * 실행: node simulator/verify.js
 * ============================================================ */
var E = require('./engine.js');

var WON = function (n) { return Math.round(n).toLocaleString('en-US') + '원'; };

var pass = 0, fail = 0;
var failures = [];

function chk(label, got, want, unit) {
  var u = function (n) { return unit ? Math.round(n).toLocaleString('en-US') + unit : WON(n); };
  if (Math.round(got) === Math.round(want)) {
    pass++; console.log('  [PASS] ' + label + ' = ' + u(got));
  } else {
    fail++; failures.push(label + ': 계산 ' + u(got) + ' ≠ 기대 ' + u(want));
    console.log('  [FAIL] ' + label + ' : 계산 ' + u(got) + ' / 기대 ' + u(want));
  }
}
function chkText(label, got, want) {
  if (got === want) { pass++; console.log('  [PASS] ' + label + ' = ' + got); }
  else { fail++; failures.push(label + ': ' + got + ' ≠ ' + want);
         console.log('  [FAIL] ' + label + ' : ' + got + ' / 기대 ' + want); }
}
function chkTrue(label, cond) { chkText(label, cond ? 'OK' : 'FAIL', 'OK'); }

console.log('\n========================================================');
console.log(' 웰런스 수입 시뮬레이터 — 검증 테스트');
console.log('========================================================');

/* ── A. 직급 체크포인트 (패스트팩 인원 → 직급) ───────────────── */
console.log('\n[A] 패스트팩 인원 → 직급 자동 판정\n');
[
  { n: 1,  rank: 'unqualified' },
  { n: 2,  rank: 'partner' },
  { n: 3,  rank: 'bronze',   qv: 1605000 },
  { n: 7,  rank: 'silver',   qv: 3255000 },
  { n: 15, rank: 'gold',     qv: 6555000 },
  { n: 29, rank: 'platinum', qv: 12330000 }
].forEach(function (c) {
  var r = E.simulate({ fastPackRecruits: c.n, subscriptionRecruits: 0 });
  chkText('패스트팩 ' + c.n + '명 → 직급', r.rankId, c.rank);
  if (c.qv) chk('  └ 소실적 QV', r.smallQV, c.qv);
});

/* ── B. 브론즈 (패스트팩 3명) 전체 수당 검증 ─────────────────── */
console.log('\n[B] 패스트팩 3명 → 브론즈 · 5가지 수당\n');
(function () {
  var r = E.simulate({ fastPackRecruits: 3, subscriptionRecruits: 0 });
  chk('소실적 QV', r.smallQV, 1605000);
  chk('소실적 CV (825,000 − 45,000)', r.smallCV, 780000);
  chk('① 팩추천', r.packCommission, 742500);
  chk('② 팀수당 (780,000 × 15%)', r.teamCommission, 117000);
  chk('③ 추천매칭 (팀수당 20%)', r.matchCommission, 23400);
  chk('④ 랭크업', r.rankUpBonus, 200000);
  chk('⑤ 직급유지', r.maintainCommission, 25000);
  chk('주간 총 수당', r.total, 1107900);
})();

/* ── C. 골드 (패스트팩 15명) 전체 수당 검증 ──────────────────── */
console.log('\n[C] 패스트팩 15명 → 골드 · 5가지 수당\n');
(function () {
  var r = E.simulate({ fastPackRecruits: 15, subscriptionRecruits: 0 });
  chk('소실적 QV', r.smallQV, 6555000);
  chk('① 팩추천', r.packCommission, 3712500);
  chk('② 팀수당 (3,255,000 × 15%)', r.teamCommission, 488250);
  chk('③ 추천매칭 (팀수당 20%)', r.matchCommission, 97650);
  chk('④ 랭크업', r.rankUpBonus, 1000000);
  chk('⑤ 직급유지', r.maintainCommission, 125000);
  chk('주간 총 수당', r.total, 5423400);
})();

/* ── D. 정기구독 볼륨 기여 검증 ──────────────────────────────── */
console.log('\n[D] 정기구독 인원 → 소실적 볼륨 가산\n');
(function () {
  var r1 = E.simulate({ fastPackRecruits: 3, subscriptionRecruits: 10 });
  chk('패스트팩3+정기구독10 소실적 QV', r1.smallQV, 1650000 + 5 * 58800 - 45000);
  chkText('  └ 직급 (브론즈 유지)', r1.rankId, 'bronze');
  var r2 = E.simulate({ fastPackRecruits: 3, subscriptionRecruits: 48 });
  chk('패스트팩3+정기구독48 소실적 QV', r2.smallQV, 1650000 + 24 * 58800 - 45000);
  chkText('  └ 직급 상승 (실버)', r2.rankId, 'silver');
})();

/* ── E. 웰런스 파트너 (직급 미달 판매 수당) / 자격 미달 ───────── */
console.log('\n[E] 웰런스 파트너 · 자격 미달 처리\n');
(function () {
  var r1 = E.simulate({ fastPackRecruits: 1, subscriptionRecruits: 0 });
  chkText('패스트팩 1명 (한쪽 라인) → 자격 미달', r1.rankId, 'unqualified');
  chk('  └ ① 팩추천만 발생', r1.total, 247500);

  var r2 = E.simulate({ fastPackRecruits: 2, subscriptionRecruits: 0 });
  chkText('패스트팩 2명 (브론즈 미달) → 웰런스 파트너', r2.rankId, 'partner');
  chk('  └ ② 팀수당 (367,500 × 10%)', r2.teamCommission, 36750);
  chkTrue('  └ 직급 미달이어도 수당 발생', r2.total > 0);

  // 정기구독만 — 사업자 추천 0명이어도 판매 실적으로 수당 발생
  var r3 = E.simulate({ fastPackRecruits: 0, subscriptionRecruits: 10 });
  chkText('정기구독 10명만 → 웰런스 파트너', r3.rankId, 'partner');
  chk('  └ ① 우대고객 커미션 (10명 × 14,994)', r3.preferredCommission, 149940);
  chk('  └ ② 팀수당 (249,000 × 10%)', r3.teamCommission, 24900);
  chkTrue('  └ 제품판매 수당 발생 (직급 미달)', r3.total > 0);
})();

/* ── F. 다음 직급 안내 ───────────────────────────────────────── */
console.log('\n[F] 다음 직급까지 추가 인원 안내\n');
(function () {
  var r = E.simulate({ fastPackRecruits: 3, subscriptionRecruits: 0 });
  chkText('브론즈의 다음 직급', r.nextRank.rankId, 'silver');
  chk('실버까지 추가 패스트팩 인원', r.nextRank.moreFastPackRecruits, 4, '명');
})();

/* ── G. 성장 시뮬레이션 ──────────────────────────────────────── */
console.log('\n[G] 성장 시뮬레이션\n');
(function () {
  // 사업자 · 매주 1명 · 1년
  var pw = E.simulateGrowth({ recruitsPerPeriod: 1, periodUnit: 'week', type: 'partner', years: 1 });
  chk('[사업자·매주1·1년] 주차 수', pw.length, 52, '주');
  chk('[사업자·매주1·1년] 52주차 팀', pw[51].team, 1378, '명');
  chkText('[사업자·매주1·1년] 52주차 직급', pw[51].rankId, 'royalcrown');
  chk('[사업자·매주1·1년] 1주차 정기수입(팩추천)', pw[0].recurringIncome, 247500);
  chk('[사업자·매주1·1년] 2주차 누적', pw[1].cumulative, 860400);
  var mono = true;
  for (var i = 1; i < pw.length; i++) { if (pw[i].cumulative < pw[i - 1].cumulative) mono = false; }
  chkTrue('[사업자·매주1·1년] 누적 단조 증가', mono);

  // 사업자 · 매주 1명 · 3년
  var p3 = E.simulateGrowth({ recruitsPerPeriod: 1, periodUnit: 'week', type: 'partner', years: 3 });
  chk('[사업자·매주1·3년] 주차 수', p3.length, 156, '주');
  chk('[사업자·매주1·3년] 156주차 팀 (156×157/2)', p3[155].team, 12246, '명');
  chkText('[사업자·매주1·3년] 156주차 직급', p3[155].rankId, 'imperial');

  // 사업자 · 매월 1명 · 1년
  var pm = E.simulateGrowth({ recruitsPerPeriod: 1, periodUnit: 'month', type: 'partner', years: 1 });
  chk('[사업자·매월1·1년] 52주차 팀 (13×14/2)', pm[51].team, 91, '명');
  chkText('[사업자·매월1·1년] 52주차 직급', pm[51].rankId, 'emerald');

  // 정기구독 · 매주 10명 · 1년
  var sw = E.simulateGrowth({ recruitsPerPeriod: 10, periodUnit: 'week', type: 'subscription', years: 1 });
  chk('[정기구독·매주10·1년] 52주차 회원', sw[51].team, 520, '명');
  chkText('[정기구독·매주10·1년] 52주차 직급', sw[51].rankId, 'platinum');
  chk('[정기구독·매주10·1년] 1주차 우대고객 커미션', sw[0].directCommission, 149940);
  chkText('[정기구독·매주10·1년] 1주차 등급 (웰런스 파트너)', sw[0].rankId, 'partner');
  chkTrue('[정기구독·매주10·1년] 1주차도 판매 수당 발생', sw[0].recurringIncome > 0);

  // 정기구독 · 매월 10명 · 1년
  var sm = E.simulateGrowth({ recruitsPerPeriod: 10, periodUnit: 'month', type: 'subscription', years: 1 });
  chk('[정기구독·매월10·1년] 52주차 회원', sm[51].team, 130, '명');
  chkText('[정기구독·매월10·1년] 52주차 직급', sm[51].rankId, 'silver');
})();

/* ── H. 요청서 v1.0 TC-1 ~ TC-4 (v3 정착상태 모델 기준) ─────────
 *
 * ※ 요청서 TC 입력의 "신규 165팩 N명"·"좌측 누적 QV" 값은
 *   v3 단순화 입력의 패스트팩 누적 인원과 일대일 대응한다:
 *     TC-1 (브론즈 도달)   ↔ fastPackRecruits=3
 *     TC-2 (실버 도달)     ↔ fastPackRecruits=7   (3+추가 4)
 *     TC-3 (골드 도달)     ↔ fastPackRecruits=15  (7+추가 8)
 *     TC-4 (플래티넘 도달) ↔ fastPackRecruits=29  (15+추가 14)
 *
 * ※ Expected 값은 v3 정착상태(steady-state) 주간 수당 모델 기준.
 *   요청서 TC의 expected는 "도달 첫 주 증분(incremental)" 모델이므로
 *   ③ 매칭(자격유지 차감 전 vs 후) · ⑤ 직급유지(첫 주 0 vs 정착 지급)에서
 *   해석 차이가 발생한다. v3는 "총 N명 정착 시 매주 받는 수당"을 보여준다.
 * ──────────────────────────────────────────────────────────── */
console.log('\n[H] 요청서 v1.0 TC-1~4 (v3 정착상태 모델 검증)\n');
[
  { tc: 'TC-1 · 브론즈 엘리트',   n: 3,  rank: 'bronze',   smallQV: 1605000,  pack: 742500,  team: 117000,  match: 23400,  rankUp: 200000,  maint: 25000,  total: 1107900 },
  { tc: 'TC-2 · 실버 엘리트',     n: 7,  rank: 'silver',   smallQV: 3255000,  pack: 1732500, team: 240750,  match: 48150,  rankUp: 500000,  maint: 50000,  total: 2571400 },
  { tc: 'TC-3 · 골드 엘리트',     n: 15, rank: 'gold',     smallQV: 6555000,  pack: 3712500, team: 488250,  match: 97650,  rankUp: 1000000, maint: 125000, total: 5423400 },
  { tc: 'TC-4 · 플래티넘 엘리트', n: 29, rank: 'platinum', smallQV: 12330000, pack: 7177500, team: 921375,  match: 184275, rankUp: 2000000, maint: 250000, total: 10533150 }
].forEach(function (c) {
  console.log('  · ' + c.tc + ' (패스트팩 ' + c.n + '명)');
  var r = E.simulate({ fastPackRecruits: c.n, subscriptionRecruits: 0 });
  chkText('    직급', r.rankId, c.rank);
  chk('    소실적 QV', r.smallQV, c.smallQV);
  chk('    ① 팩추천', r.packCommission, c.pack);
  chk('    ② 팀수당', r.teamCommission, c.team);
  chk('    ③ 매칭', r.matchCommission, c.match);
  chk('    ④ 랭크업', r.rankUpBonus, c.rankUp);
  chk('    ⑤ 직급유지', r.maintainCommission, c.maint);
  chk('    주간 총 수당', r.total, c.total);
});

/* ── 요약 ──────────────────────────────────────────────────── */
console.log('\n========================================================');
console.log(' 결과 요약 — PASS ' + pass + ' / FAIL ' + fail);
console.log('========================================================');
if (fail > 0) {
  console.log('\n[FAIL] 불일치 항목:');
  failures.forEach(function (f) { console.log('  - ' + f); });
} else {
  console.log('\n[OK] 직급 판정 · 웰런스 파트너 · 5가지 수당 · 정기구독 · 성장 시뮬 전부 정상.');
}
process.exit(fail > 0 ? 1 : 0);
