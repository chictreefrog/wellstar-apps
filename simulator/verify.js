/* ============================================================
 * 웰런스 수입 시뮬레이터 — 검증 테스트 (요청서 SECTION 09)
 * 실행: node simulator/verify.js
 *
 * 웰런스 공식 STEP1~4 기준 4개 검증 케이스.
 * ③ 추천매칭은 '팀커미션 매칭' 방식으로 구현 (구매실적 매칭은 미산정).
 * ============================================================ */
var E = require('./engine.js');

var WON = function (n) { return Math.round(n).toLocaleString('en-US') + '원'; };

/* ── PART A · STEP1~4 검증 (직급 · ① · ② · ④ · ⑤) ────────────
 * CV는 누적값으로 입력하고, 팀수당용 주간 CV는 직전 케이스와의 차이로 산출.
 * ③ 추천매칭은 다운라인 세대별 팀수당 입력에 따라 결정되므로
 *   결정적(deterministic) 검증 대상에서 제외하고 PART B 에서 별도 검증.
 * ──────────────────────────────────────────────────────────── */
var CASES = [
  {
    id: 'TC-1', title: '브론즈 엘리트 도달',
    cumLeftQV: 1650000, cumRightQV: 1605000,
    cumLeftCV: 825000,  cumRightCV: 780000,
    newFastPack: 3, previousRank: 'unqualified', maintainWeek: 0,
    expect: { rankId: 'bronze', packCommission: 742500, teamCommission: 117000, rankUpBonus: 200000, maintainCommission: 0 }
  },
  {
    id: 'TC-2', title: '실버 엘리트 도달',
    cumLeftQV: 3300000, cumRightQV: 3255000,
    cumLeftCV: 1650000, cumRightCV: 1605000,
    newFastPack: 0, previousRank: 'bronze', maintainWeek: 1,
    expect: { rankId: 'silver', packCommission: 0, teamCommission: 123750, rankUpBonus: 500000, maintainCommission: 0 }
  },
  {
    id: 'TC-3', title: '골드 엘리트 도달',
    cumLeftQV: 6600000, cumRightQV: 6555000,
    cumLeftCV: 3300000, cumRightCV: 3255000,
    newFastPack: 0, previousRank: 'silver', maintainWeek: 2,
    expect: { rankId: 'gold', packCommission: 0, teamCommission: 247500, rankUpBonus: 1000000, maintainCommission: 0 }
  },
  {
    id: 'TC-4', title: '플래티넘 엘리트 도달',
    cumLeftQV: 12375000, cumRightQV: 12330000,
    cumLeftCV: 6187500,  cumRightCV: 6142500,
    newFastPack: 0, previousRank: 'gold', maintainWeek: 3,
    expect: { rankId: 'platinum', packCommission: 0, teamCommission: 433125, rankUpBonus: 2000000, maintainCommission: 0 }
  }
];

var pass = 0, fail = 0;
var failures = [];

console.log('\n========================================================');
console.log(' 웰런스 수입 시뮬레이터 — 검증 테스트 (SECTION 09)');
console.log('========================================================');
console.log('\n[PART A] STEP1~4 — 직급 · ① · ② · ④ · ⑤ 검증\n');

var prevCumCV = { left: 0, right: 0 };

CASES.forEach(function (tc) {
  var state = {
    selfActive: true, leftRecruitActive: true, rightRecruitActive: true,
    cumLeftQV: tc.cumLeftQV, cumRightQV: tc.cumRightQV,
    weeklyLeftCV:  tc.cumLeftCV  - prevCumCV.left,
    weeklyRightCV: tc.cumRightCV - prevCumCV.right,
    newFastPack: tc.newFastPack, newBasicPack: 0,
    generationTeamCommission: [0, 0, 0, 0, 0],
    previousRank: tc.previousRank, maintainWeek: tc.maintainWeek
  };
  prevCumCV = { left: tc.cumLeftCV, right: tc.cumRightCV };

  var r = E.simulate(state);
  var lines = [];

  function check(label, key) {
    var got = r[key], want = tc.expect[key];
    if (Math.round(got) === Math.round(want)) {
      pass++; lines.push('  [PASS] ' + label + ' = ' + WON(got));
    } else {
      fail++; failures.push(tc.id + ' ' + label + ': ' + WON(got) + ' ≠ ' + WON(want));
      lines.push('  [FAIL] ' + label + ' : 계산 ' + WON(got) + ' / 기대 ' + WON(want));
    }
  }

  console.log(tc.id + ' · ' + tc.title
    + '  (주간 소실적 CV ' + WON(Math.min(state.weeklyLeftCV, state.weeklyRightCV)) + ')');

  if (r.rankId === tc.expect.rankId) { pass++; lines.push('  [PASS] 직급 = ' + r.rankId); }
  else { fail++; failures.push(tc.id + ' 직급: ' + r.rankId + ' ≠ ' + tc.expect.rankId);
         lines.push('  [FAIL] 직급 : ' + r.rankId + ' / 기대 ' + tc.expect.rankId); }

  check('① 팩추천',  'packCommission');
  check('② 팀수당',  'teamCommission');
  check('④ 랭크업',  'rankUpBonus');
  check('⑤ 직급유지','maintainCommission');
  lines.push('  ( ③ 추천매칭 = 팀커미션 매칭 — 세대별 팀수당 입력값에 따라 산출. PART B 참조 )');
  console.log(lines.join('\n') + '\n');
});

/* ── PART B · ③ 추천매칭(팀커미션 매칭) 공식 검증 ─────────────
 * ③ = Σ( 세대별(1G~5G) 다운라인 팀수당 × 직급별 매칭율 )
 * ──────────────────────────────────────────────────────────── */
console.log('[PART B] ③ 추천매칭(팀커미션 매칭) 공식 검증\n');

var MATCH_CASES = [
  { rankId: 'gold',     gen: [460875, 0, 0, 0, 0],          expect: 92175,  note: 'STEP3 ③값(92,175원) 재현 — 1G 팀수당 460,875원' },
  { rankId: 'platinum', gen: [1086750, 0, 0, 0, 0],         expect: 217350, note: 'STEP4 ③값(217,350원) 재현 — 1G 팀수당 1,086,750원' },
  { rankId: 'gold',     gen: [300000, 300000, 300000, 0, 0],expect: 150000, note: '골드 1G·2G(20%)·3G(10%) 혼합' },
  { rankId: 'imperial', gen: [1000000, 0, 0, 0, 0],         expect: 100000, note: '임페리얼 1G 매칭율 10%' }
];

MATCH_CASES.forEach(function (mc) {
  var m = E.calcMatchCommission({ generationTeamCommission: mc.gen }, mc.rankId);
  if (Math.round(m.total) === Math.round(mc.expect)) {
    pass++; console.log('  [PASS] ' + mc.note + ' → ' + WON(m.total));
  } else {
    fail++; failures.push('MATCH ' + mc.note + ': ' + WON(m.total) + ' ≠ ' + WON(mc.expect));
    console.log('  [FAIL] ' + mc.note + ' : 계산 ' + WON(m.total) + ' / 기대 ' + WON(mc.expect));
  }
});

/* ── 요약 ──────────────────────────────────────────────────── */
console.log('\n========================================================');
console.log(' 결과 요약 — PASS ' + pass + ' / FAIL ' + fail);
console.log('========================================================');

if (fail > 0) {
  console.log('\n[FAIL] 일치하지 않는 항목:');
  failures.forEach(function (f) { console.log('  - ' + f); });
} else {
  console.log('\n[OK] 직급 판정 · ① · ② · ④ · ⑤ 및 ③ 팀커미션 매칭 공식 전부 일치.');
  console.log('     ③ 추천매칭은 세대별 팀수당 입력에 따라 산출되며,');
  console.log('     구매실적 매칭이 더 클 경우 실제 지급액은 더 커질 수 있습니다.');
}

process.exit(fail > 0 ? 1 : 0);
