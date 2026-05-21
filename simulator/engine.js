/* ============================================================
 * 웰런스 수입 시뮬레이터 — 계산 엔진
 * 웰런스 공식 보상 구조(2026) 기반
 *
 * [입력 단순화 모델]
 * 예비 사업자가 라인별 QV/CV를 직접 입력할 수 없으므로,
 * 입력은 "패스트팩 추천 인원 / 정기구독 인원" 두 가지만 받고
 * 좌·우 균형 배치를 가정해 QV·CV·팀수당·직급을 자동 산출한다.
 *
 * 브라우저: window.WellanceEngine / Node: require('./engine.js')
 * ============================================================ */
(function (global) {
'use strict';

/* ── 제품 / 팩 가격표 ──────────────────────────────────────── */
var PRODUCTS = [
  { name: '메타부스트 제니스',   member: 117600, contract: 99960, qv: 58800, cv: 58800 },
  { name: '메타브레인 PS',       member: 117600, contract: 99960, qv: 58800, cv: 58800 },
  { name: '글로우 인핸서',       member: 48000,  contract: 40800, qv: 24000, cv: 24000 },
  { name: '글로우 세럼',         member: 48000,  contract: 40800, qv: 24000, cv: 24000 },
  { name: '코어셀 너리싱 크림',  member: 63000,  contract: 53550, qv: 31500, cv: 31500 },
  { name: '톤업 선밀크',         member: 34000,  contract: 28900, qv: 17000, cv: 17000 },
  { name: '컴포팅 젤 클린저',    member: 26500,  contract: 22525, qv: 13250, cv: 13250 }
];

var PACKS = {
  // 패스트팩(165팩): 평생 1회만 구매 가능
  fast:  { id: 'fast',  name: '패스트팩 (165팩)', price: 1650000, qv: 825000, cv: 412500, oncePerLifetime: true },
  basic: { id: 'basic', name: '베이직팩',         price: 415000,  qv: 207500, cv: 103750 }
};

/* 정기구독 기준 — 건기식 제품(메타부스트 제니스), 12개월 약정가(15% 할인) */
var SUBSCRIPTION = {
  name: '건기식 정기구독',
  baseProduct: '메타부스트 제니스',
  memberPrice: 117600,
  contractPrice: 99960,   // 12개월 약정 시 15% 할인가
  qv: 58800,
  cv: 58800
};

var PACK_COMMISSION_RATE = 0.15;  // ① 팩 추천 커미션율
var PREFERRED_RATE = 0.15;        // ① 우대고객 커미션율 (정기구독 판매)
var LEADER_RETENTION = 45000;     // 리더 4주 유지금액 — 다운라인으로 이월되어 소실적에서 차감

/* ── 직급 정의 (낮은 직급 → 높은 직급 순서) ─────────────────────
 * ※ 금액은 웰런스 공식 보상 구조 기준. 2026년 개정분은 확인 후 갱신 필요.
 * qv         : 소실적 자격 QV (직급 판정 기준)
 * teamRate   : ② 팀수당 지급율
 * weeklyCap  : ② 팀수당 주극점(주간 상한)
 * match[0]   : ③ 추천매칭(1세대) 매칭율 — 단순화 모델에서 사용
 * rankUp     : ④ 랭크업 보너스 지급액
 * rankUpInstant: ④ 즉시 전액 지급 여부 (false면 50% 즉시 / 50% 13주 후)
 * maintain   : ⑤ 직급유지 주급액
 * ──────────────────────────────────────────────────────────── */
var RANKS = [
  { id: 'bronze',       name: '브론즈',         qv: 1500000,    teamRate: 0.15, weeklyCap: 500000,    match: [0.20,0.20,0,   0,   0],    rankUp: 200000,    rankUpInstant: true,  maintain: 25000 },
  { id: 'silver',       name: '실버',           qv: 3000000,    teamRate: 0.15, weeklyCap: 1000000,   match: [0.20,0.20,0,   0,   0],    rankUp: 500000,    rankUpInstant: true,  maintain: 50000 },
  { id: 'gold',         name: '골드',           qv: 6000000,    teamRate: 0.15, weeklyCap: 1500000,   match: [0.20,0.20,0.10,0,   0],    rankUp: 1000000,   rankUpInstant: true,  maintain: 125000 },
  { id: 'platinum',     name: '플래티넘',       qv: 12000000,   teamRate: 0.15, weeklyCap: 2000000,   match: [0.20,0.20,0.10,0.10,0],    rankUp: 2000000,   rankUpInstant: true,  maintain: 250000 },
  { id: 'emerald',      name: '에메랄드',       qv: 25000000,   teamRate: 0.15, weeklyCap: 5000000,   match: [0.20,0.20,0.10,0.10,0],    rankUp: 5000000,   rankUpInstant: false, maintain: 500000 },
  { id: 'diamond',      name: '다이아몬드',     qv: 50000000,   teamRate: 0.15, weeklyCap: 10000000,  match: [0.20,0.20,0.10,0.10,0.10], rankUp: 10000000,  rankUpInstant: false, maintain: 1000000 },
  { id: 'royaldiamond', name: '로얄다이아몬드', qv: 100000000,  teamRate: 0.13, weeklyCap: 20000000,  match: [0.15,0.15,0.10,0.10,0.10], rankUp: 20000000,  rankUpInstant: false, maintain: 2000000 },
  { id: 'crown',        name: '크라운',         qv: 200000000,  teamRate: 0.13, weeklyCap: 20000000,  match: [0.15,0.15,0.10,0.10,0.10], rankUp: 40000000,  rankUpInstant: false, maintain: 3750000 },
  { id: 'royalcrown',   name: '로얄크라운',     qv: 500000000,  teamRate: 0.11, weeklyCap: 20000000,  match: [0.10,0.10,0.10,0.10,0.10], rankUp: 100000000, rankUpInstant: false, maintain: 6250000 },
  { id: 'imperial',     name: '임페리얼',       qv: 1000000000, teamRate: 0.11, weeklyCap: 20000000,  match: [0.10,0.10,0.10,0.10,0.10], rankUp: 200000000, rankUpInstant: false, maintain: 10000000 }
];

/* 브론즈 미만 — 직급 미달이어도 활동(판매) 시 팀수당을 받는 구간 */
var PARTNER_TIER = {
  id: 'partner', name: '웰런스 파트너', qv: 0,
  teamRate: 0.10, weeklyCap: 500000, match: [0.20,0.20,0,0,0],
  rankUp: 0, rankUpInstant: true, maintain: 0
};

/* ── 유틸 ──────────────────────────────────────────────────── */
function getRank(id) {
  for (var i = 0; i < RANKS.length; i++) { if (RANKS[i].id === id) return RANKS[i]; }
  return null;
}
function rankIndex(id) {
  for (var i = 0; i < RANKS.length; i++) { if (RANKS[i].id === id) return i; }
  return -1;
}
function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
function intInput(v) { return Math.max(0, Math.round(num(v))); }

/* ── 직급 자동 판정 — 소실적 QV 기준 (높은 직급부터 greedy) ──── */
function determineRank(smallQV) {
  var q = num(smallQV);
  for (var i = RANKS.length - 1; i >= 0; i--) {
    if (q >= RANKS[i].qv) return RANKS[i].id;
  }
  return 'unqualified';
}

/* ── 다음 직급 진척도 ───────────────────────────────────────── */
function nextRankInfo(rankId, smallQV) {
  var idx = rankIndex(rankId);                 // unqualified·partner → -1
  var nextIdx = idx + 1;
  if (nextIdx >= RANKS.length) return null;    // 최고 직급
  var next = RANKS[nextIdx];
  var q = num(smallQV);
  var morePacks = Math.max(0, Math.ceil((next.qv - q) / PACKS.fast.qv));
  var base = idx >= 0 ? RANKS[idx].qv : 0;
  var span = next.qv - base;
  var percent = span > 0 ? Math.min(100, Math.max(0, Math.round((q - base) / span * 100))) : 0;
  return {
    rankId: next.id,
    rankName: next.name,
    displayName: next.name + ' 엘리트',
    requiredQV: next.qv,
    moreFastPackRecruits: morePacks * 2,
    percent: percent
  };
}

/* ── 메인: 추천 인원 → 5가지 수당 통합 계산 ──────────────────
 * input = { fastPackRecruits, subscriptionRecruits }
 * ──────────────────────────────────────────────────────────── */
function simulate(input) {
  var s = input || {};
  var N = intInput(s.fastPackRecruits);          // 패스트팩 추천 인원
  var M = intInput(s.subscriptionRecruits);      // 정기구독 인원

  // 본인 팩 포함(N+1팩)을 좌·우로 균형 배치 → 소실적(작은 라인) 기준.
  // 리더 4주 유지금액은 다운라인으로 이월되어 소실적에서 차감된다.
  var legFastPacks = Math.floor((N + 1) / 2);
  var legSub  = Math.floor(M / 2);
  var smallQV = Math.max(0, legFastPacks * PACKS.fast.qv + legSub * SUBSCRIPTION.qv - LEADER_RETENTION);
  var smallCV = Math.max(0, legFastPacks * PACKS.fast.cv + legSub * SUBSCRIPTION.cv - LEADER_RETENTION);

  // ① 팩 추천 커미션 — 패스트팩 신규 결제액의 15%
  // ① 우대고객 커미션 — 정기구독 판매액(약정가)의 15%  (둘 다 직급과 무관하게 발생)
  var packCommission = N * PACKS.fast.price * PACK_COMMISSION_RATE;
  var preferredCommission = M * SUBSCRIPTION.contractPrice * PREFERRED_RATE;
  var directCommission = packCommission + preferredCommission;

  // 좌·우 라인 구축 여부 — 좌·우 각 1명 이상 (추천+정기구독 합계 2명 이상)
  var bothLegs = (N + M) >= 2;

  if (!bothLegs) {
    return {
      qualified: false,
      rankId: 'unqualified', rankName: '자격 미달', displayName: '자격 미달',
      fastPackRecruits: N, subscriptionRecruits: M,
      smallQV: smallQV, smallCV: smallCV,
      packCommission: packCommission, preferredCommission: preferredCommission,
      directCommission: directCommission,
      teamCommission: 0, matchCommission: 0, matchRate: 0,
      rankUpBonus: 0, rankUpInstant: true, maintainCommission: 0,
      total: directCommission,
      nextRank: nextRankInfo('unqualified', smallQV),
      reason: '좌·우 라인 각각에 최소 1명이 필요합니다. (2명 이상 추천)'
    };
  }

  // 직급 판정 — 브론즈 미만이면 '웰런스 파트너' 구간 (판매 시 팀수당 발생)
  var rankId = determineRank(smallQV);
  var rank, isPartnerTier = false;
  if (rankId === 'unqualified') {
    rank = PARTNER_TIER; rankId = 'partner'; isPartnerTier = true;
  } else {
    rank = getRank(rankId);
  }

  // ② 후원수당(팀커미션) — 소실적 CV × 직급별 지급율 (주극점 상한 적용)
  var rawTeamCommission = smallCV * rank.teamRate;
  var teamCommission = Math.min(rawTeamCommission, rank.weeklyCap);
  // ③ 추천매칭 커미션 — 팀커미션 × 직급별 매칭율 (주극점 상한 적용 전 기준)
  var matchCommission = rawTeamCommission * rank.match[0];
  // ④ 랭크업 보너스 — 해당 직급 최초 달성 시 (웰런스 파트너는 0)
  var rankUpBonus = rank.rankUp;
  // ⑤ 직급유지(랭크 퀄리파이) — 직급별 주급액 (웰런스 파트너는 0)
  var maintainCommission = rank.maintain;

  var total = directCommission + teamCommission + matchCommission + rankUpBonus + maintainCommission;

  return {
    qualified: true,
    rankId: rankId, rankName: rank.name,
    displayName: isPartnerTier ? rank.name : rank.name + ' 엘리트',
    fastPackRecruits: N, subscriptionRecruits: M,
    smallQV: smallQV, smallCV: smallCV,
    packCommission: packCommission,
    preferredCommission: preferredCommission,
    directCommission: directCommission,
    teamCommission: teamCommission,
    matchCommission: matchCommission,
    matchRate: rank.match[0],
    rankUpBonus: rankUpBonus,
    rankUpInstant: rank.rankUpInstant !== false,
    maintainCommission: maintainCommission,
    total: total,
    nextRank: nextRankInfo(rankId, smallQV)
  };
}

/* ── 성장 시뮬레이션 — 1~3년 추이 ───────────────────────────────
 * opts = { recruitsPerPeriod, periodUnit:'week'|'month',
 *          type:'partner'|'subscription', years:1|2|3 }
 *
 * - periodUnit 'week'  : 매주 추천 (추천 주기 1주)
 *   periodUnit 'month' : 매월 추천 (추천 주기 4주)
 * - type 'partner'      : 패스트팩 사업자 추천 — 팀원이 1명씩 복제(삼각수 증가)
 *   type 'subscription' : 정기구독 회원 모집 — 복제 없이 내가 직접 모집(선형 증가)
 *
 * 각 주 행:
 *   recurringIncome : 그 주 정기 수당 (① + ② + ③ + ⑤)
 *   rankUpBonus     : 그 주 직급달성 보너스 (④, 1회성)
 *   cumulative      : 누적 수입 (정기 수당 + 보너스 전부 포함)
 * ──────────────────────────────────────────────────────────── */
function simulateGrowth(opts) {
  opts = opts || {};
  var N = Math.max(1, intInput(opts.recruitsPerPeriod || 1));
  var unit = opts.periodUnit === 'month' ? 'month' : 'week';
  var type = opts.type === 'subscription' ? 'subscription' : 'partner';
  var years = Math.min(3, Math.max(1, intInput(opts.years || 1)));
  var stepWeeks = (unit === 'month') ? 4 : 1;
  var weeks = 52 * years;
  var rows = [];
  var cumulative = 0;
  var prevRankIdx = -1;

  for (var w = 1; w <= weeks; w++) {
    var p = Math.ceil(w / stepWeeks);                 // 현재 몇 번째 추천 주기인가
    var team = (type === 'partner')
      ? N * p * (p + 1) / 2                           // 사업자: 복제(삼각수)
      : N * p;                                        // 정기구독: 선형
    var myDirect = ((w - 1) % stepWeeks === 0) ? N : 0;  // 이번 주 내가 직접 추천한 인원

    var s = (type === 'partner')
      ? simulate({ fastPackRecruits: team, subscriptionRecruits: 0 })
      : simulate({ fastPackRecruits: 0, subscriptionRecruits: team });

    // 이번 주 내 직추 커미션 — 사업자: 팩 추천 / 정기구독: 우대고객
    var directCommission = (type === 'partner')
      ? myDirect * PACKS.fast.price * PACK_COMMISSION_RATE
      : myDirect * SUBSCRIPTION.contractPrice * PREFERRED_RATE;

    var curIdx = rankIndex(s.rankId);                 // 'partner'·'unqualified' → -1
    var rankUp = 0;
    if (s.qualified && curIdx > prevRankIdx) {
      for (var ri = prevRankIdx + 1; ri <= curIdx; ri++) rankUp += RANKS[ri].rankUp;
      prevRankIdx = curIdx;
    }

    var recurringIncome = directCommission + s.teamCommission + s.matchCommission + s.maintainCommission;
    cumulative += recurringIncome + rankUp;

    rows.push({
      week: w,
      month: Math.ceil(w * 12 / 52),
      team: team,
      rankId: s.rankId, rankName: s.rankName, displayName: s.displayName,
      directCommission: directCommission,
      teamCommission: s.teamCommission,
      matchCommission: s.matchCommission,
      maintainCommission: s.maintainCommission,
      recurringIncome: recurringIncome,
      rankUpBonus: rankUp,
      weekIncome: recurringIncome + rankUp,   // 정기 수당 + 그 주 직급달성보너스
      cumulative: cumulative
    });
  }
  return rows;
}

/* ── export ─────────────────────────────────────────────────── */
var WellanceEngine = {
  PRODUCTS: PRODUCTS,
  PACKS: PACKS,
  SUBSCRIPTION: SUBSCRIPTION,
  RANKS: RANKS,
  PARTNER_TIER: PARTNER_TIER,
  PACK_COMMISSION_RATE: PACK_COMMISSION_RATE,
  LEADER_RETENTION: LEADER_RETENTION,
  getRank: getRank,
  rankIndex: rankIndex,
  determineRank: determineRank,
  nextRankInfo: nextRankInfo,
  simulate: simulate,
  simulateGrowth: simulateGrowth
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WellanceEngine;
} else {
  global.WellanceEngine = WellanceEngine;
}

})(typeof window !== 'undefined' ? window : globalThis);
