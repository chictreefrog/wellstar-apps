/* ============================================================
 * 웰런스 수입 시뮬레이터 — 계산 엔진
 * 웰런스 공식 보상 구조(2024) 기반
 *
 * 브라우저: window.WellanceEngine 로 사용
 * Node.js : require('./engine.js') 로 사용 (검증 스크립트 verify.js)
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

/* ── 직급 정의 (낮은 직급 → 높은 직급 순서) ─────────────────────
 * qv         : 소실적 자격 (최근 4주 누적 QV)
 * teamRate   : ② 팀수당 지급율
 * weeklyCap  : ② 팀수당 주극점(주간 상한)
 * match      : ③-A 팀커미션 세대별 매칭율 [1G,2G,3G,4G,5G]
 * rankUp     : ④ 랭크업 보너스 지급액
 * rankUpExtra: ④ 재성취 추가 지급액 (크라운 이상)
 * rankUpInstant: ④ 즉시 전액 지급 여부 (false면 50% 즉시 / 50% 13주 후)
 * maintain   : ⑤ 직급유지 주급액
 * ──────────────────────────────────────────────────────────── */
var RANKS = [
  { id: 'bronze',       name: '브론즈',         qv: 1500000,    teamRate: 0.15, weeklyCap: 500000,    match: [0.20,0.20,0,   0,   0],    rankUp: 200000,    rankUpExtra: 0,         rankUpInstant: true,  maintain: 25000 },
  { id: 'silver',       name: '실버',           qv: 3000000,    teamRate: 0.15, weeklyCap: 1000000,   match: [0.20,0.20,0,   0,   0],    rankUp: 500000,    rankUpExtra: 0,         rankUpInstant: true,  maintain: 50000 },
  { id: 'gold',         name: '골드',           qv: 6000000,    teamRate: 0.15, weeklyCap: 1500000,   match: [0.20,0.20,0.10,0,   0],    rankUp: 1000000,   rankUpExtra: 0,         rankUpInstant: true,  maintain: 125000 },
  { id: 'platinum',     name: '플래티넘',       qv: 12000000,   teamRate: 0.15, weeklyCap: 2000000,   match: [0.20,0.20,0.10,0.10,0],    rankUp: 2000000,   rankUpExtra: 0,         rankUpInstant: true,  maintain: 250000 },
  { id: 'emerald',      name: '에메랄드',       qv: 25000000,   teamRate: 0.15, weeklyCap: 5000000,   match: [0.20,0.20,0.10,0.10,0],    rankUp: 5000000,   rankUpExtra: 0,         rankUpInstant: false, maintain: 500000 },
  { id: 'diamond',      name: '다이아몬드',     qv: 50000000,   teamRate: 0.15, weeklyCap: 10000000,  match: [0.20,0.20,0.10,0.10,0.10], rankUp: 10000000,  rankUpExtra: 0,         rankUpInstant: false, maintain: 1000000 },
  { id: 'royaldiamond', name: '로얄다이아몬드', qv: 100000000,  teamRate: 0.13, weeklyCap: 20000000,  match: [0.15,0.15,0.10,0.10,0.10], rankUp: 20000000,  rankUpExtra: 0,         rankUpInstant: false, maintain: 2000000 },
  { id: 'crown',        name: '크라운',         qv: 200000000,  teamRate: 0.13, weeklyCap: 20000000,  match: [0.15,0.15,0.10,0.10,0.10], rankUp: 40000000,  rankUpExtra: 20000000,  rankUpInstant: false, maintain: 3750000 },
  { id: 'royalcrown',   name: '로얄크라운',     qv: 500000000,  teamRate: 0.11, weeklyCap: 20000000,  match: [0.10,0.10,0.10,0.10,0.10], rankUp: 100000000, rankUpExtra: 50000000,  rankUpInstant: false, maintain: 6250000 },
  { id: 'imperial',     name: '임페리얼',       qv: 1000000000, teamRate: 0.11, weeklyCap: 20000000,  match: [0.10,0.10,0.10,0.10,0.10], rankUp: 200000000, rankUpExtra: 100000000, rankUpInstant: false, maintain: 10000000 }
];

var QUALIFY_QV = 48000;        // 자격 유지 기준 QV/CV (오토십 81,600원 → 48,000)

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

/* ── 직급 자동 판정 ──────────────────────────────────────────
 * 기본 자격: 본인 + 좌/우 직추 파트너 모두 액티브
 * 직급: 최근 4주 누적 소실적 QV = min(좌QV, 우QV) 기준,
 *       높은 직급부터 내려오며 첫 충족 직급 채택 (greedy)
 * ──────────────────────────────────────────────────────────── */
function determineRank(state) {
  var s = state || {};
  if (!s.selfActive || !s.leftRecruitActive || !s.rightRecruitActive) {
    return 'unqualified';
  }
  var smallQV = Math.min(num(s.cumLeftQV), num(s.cumRightQV));
  for (var i = RANKS.length - 1; i >= 0; i--) {
    if (smallQV >= RANKS[i].qv) return RANKS[i].id;
  }
  return 'unqualified';
}

/* ── ① 팩 추천 커미션 (구매수당) ──────────────────────────────
 * 직접 추천한 신규 사업자의 팩 결제액 × 15%
 * ──────────────────────────────────────────────────────────── */
function calcPackCommission(state) {
  var s = state || {};
  return num(s.newFastPack)  * PACKS.fast.price  * 0.15
       + num(s.newBasicPack) * PACKS.basic.price * 0.15;
}

/* ── ② 후원수당 (팀커미션, 바이너리) ──────────────────────────
 * 좌/우 라인 중 소실적(작은 쪽) 주간 CV × 직급별 지급율
 * 직급별 주극점(주간 상한) 적용
 * ──────────────────────────────────────────────────────────── */
function calcTeamCommission(state, rankId) {
  var r = getRank(rankId);
  if (!r) return 0;
  var s = state || {};
  var smallCV = Math.min(num(s.weeklyLeftCV), num(s.weeklyRightCV));
  var commission = smallCV * r.teamRate;
  return Math.min(commission, r.weeklyCap);
}

/* ── ③ 추천매칭 커미션 ───────────────────────────────────────
 * 팀커미션 매칭: 세대별(1G~5G) 다운라인 팀수당 × 직급별 매칭율.
 *
 * ※ 추천매칭은 원래 '팀커미션 매칭'과 '구매실적 매칭' 중 큰 금액을
 *   지급하나, 구매실적(팩·단품 구매)은 금액을 특정할 수 없어
 *   본 시뮬레이터는 팀커미션 매칭만 계산한다.
 *   (결과 화면에 구매실적 매칭 관련 안내문구로 보완)
 * ──────────────────────────────────────────────────────────── */
function calcMatchCommission(state, rankId) {
  var r = getRank(rankId);
  if (!r) return { total: 0, teamMatch: 0 };
  var s = state || {};
  var genTC = s.generationTeamCommission || [];
  var teamMatch = 0;
  for (var g = 0; g < 5; g++) {
    teamMatch += num(genTC[g]) * (r.match[g] || 0);
  }
  return { total: teamMatch, teamMatch: teamMatch };
}

/* ── ④ 랭크 업 커미션 (직급달성 보너스, 최초 1회) ──────────────
 * 직전 직급보다 상승했을 때만 지급.
 * 플래티넘 이하: 즉시 전액. 에메랄드 이상: 50% 즉시 / 50% 13주 후.
 * ──────────────────────────────────────────────────────────── */
function calcRankUpBonus(rankId, previousRank) {
  var r = getRank(rankId);
  if (!r) return { total: 0, thisWeek: 0, deferred: 0, instant: true };
  var newIdx = rankIndex(rankId);
  var prevIdx = (previousRank && previousRank !== 'unqualified') ? rankIndex(previousRank) : -1;
  if (newIdx <= prevIdx) {
    return { total: 0, thisWeek: 0, deferred: 0, instant: true };
  }
  var total = r.rankUp;
  if (r.rankUpInstant) {
    return { total: total, thisWeek: total, deferred: 0, instant: true };
  }
  var half = total * 0.5;
  return { total: total, thisWeek: half, deferred: half, instant: false };
}

/* ── ⑤ 랭크 퀄리파이 커미션 (직급유지 보너스) ─────────────────
 * 최초 직급 성취 후 4주 간격으로 직급유지 주급 지급.
 * maintainWeek = 최초 직급 성취 후 경과 주차(성취 주 = 0).
 * ──────────────────────────────────────────────────────────── */
function calcMaintainCommission(rankId, maintainWeek) {
  var r = getRank(rankId);
  if (!r) return 0;
  var w = num(maintainWeek);
  if (w > 0 && w % 4 === 0) return r.maintain;
  return 0;
}

/* ── 다음 직급 진척도 ───────────────────────────────────────── */
function nextRankInfo(rankId, cumLeftQV, cumRightQV) {
  var idx = rankIndex(rankId);
  var nextIdx = idx + 1;
  if (nextIdx >= RANKS.length) return null; // 최고 직급
  var next = RANKS[nextIdx];
  var smallQV = Math.min(num(cumLeftQV), num(cumRightQV));
  var current = (idx >= 0) ? RANKS[idx].qv : 0;
  var span = next.qv - current;
  var progressed = Math.max(0, smallQV - current);
  var percent = span > 0 ? Math.min(100, Math.round(progressed / span * 100)) : 0;
  return {
    rankId: next.id,
    rankName: next.name,
    displayName: next.name + ' 엘리트',
    requiredQV: next.qv,
    percent: percent,
    needLeftQV:  Math.max(0, next.qv - num(cumLeftQV)),
    needRightQV: Math.max(0, next.qv - num(cumRightQV))
  };
}

/* ── 메인: 5가지 수당 통합 계산 ────────────────────────────── */
function simulate(state) {
  var s = state || {};
  var rankId = determineRank(s);

  if (rankId === 'unqualified') {
    return {
      qualified: false,
      rankId: 'unqualified',
      rankName: '자격 미달',
      displayName: '자격 미달',
      packCommission: 0,
      teamCommission: 0,
      matchCommission: 0,
      rankUpBonus: 0,
      rankUpTotal: 0,
      rankUpDeferred: 0,
      rankUpInstant: true,
      maintainCommission: 0,
      total: 0,
      nextRank: null,
      reason: '본인 또는 좌/우 직추 파트너의 액티브 자격이 미충족되어 모든 수당이 0원입니다.'
    };
  }

  var rank = getRank(rankId);
  var pack     = calcPackCommission(s);
  var team     = calcTeamCommission(s, rankId);
  var match    = calcMatchCommission(s, rankId);
  var rankUp   = calcRankUpBonus(rankId, s.previousRank);
  var maintain = calcMaintainCommission(rankId, s.maintainWeek);

  var total = pack + team + match.total + rankUp.thisWeek + maintain;

  return {
    qualified: true,
    rankId: rankId,
    rankName: rank.name,
    displayName: rank.name + ' 엘리트',
    packCommission: pack,
    teamCommission: team,
    matchCommission: match.total,
    rankUpBonus: rankUp.thisWeek,          // 이번 주 실수령
    rankUpTotal: rankUp.total,             // 총 보너스액
    rankUpDeferred: rankUp.deferred,       // 13주 후 지급분
    rankUpInstant: rankUp.instant,
    maintainCommission: maintain,
    total: total,
    nextRank: nextRankInfo(rankId, s.cumLeftQV, s.cumRightQV)
  };
}

/* ── export ─────────────────────────────────────────────────── */
var WellanceEngine = {
  PRODUCTS: PRODUCTS,
  PACKS: PACKS,
  RANKS: RANKS,
  QUALIFY_QV: QUALIFY_QV,
  getRank: getRank,
  rankIndex: rankIndex,
  determineRank: determineRank,
  calcPackCommission: calcPackCommission,
  calcTeamCommission: calcTeamCommission,
  calcMatchCommission: calcMatchCommission,
  calcRankUpBonus: calcRankUpBonus,
  calcMaintainCommission: calcMaintainCommission,
  nextRankInfo: nextRankInfo,
  simulate: simulate
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WellanceEngine;
} else {
  global.WellanceEngine = WellanceEngine;
}

})(typeof window !== 'undefined' ? window : globalThis);
