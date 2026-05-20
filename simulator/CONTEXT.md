# 웰런스 수입 시뮬레이터 — Claude Code 컨텍스트

## 앱 정보
- **URL**: app.wellstar.life/simulator/
- **저장소**: chictreefrog/wellstar-apps / simulator/ 폴더
- **대상**: 웰런스 사업자회원(WP) 전용
- **목적**: 활동량 → 5가지 수당 + 직급 자동판정 + 예상 수입 계산
- **기준**: 웰런스 공식 보상 구조(2024)

## 개편 이력
- v1 (legacy): 4업종 범용 시뮬레이터 → `legacy-simulator.html` 로 보존
- v2 (현재): 웰런스 전용 정밀 시뮬레이터로 전면 개편 (요청서 v1.0)

## 파일 구조
- `index.html` — 모드A(단발 계산) UI
- `engine.js` — 계산 엔진 (브라우저 `window.WellanceEngine` / Node `require`)
- `verify.js` — 검증 테스트 (요청서 SECTION 09 4건). 실행: `node simulator/verify.js`
- `legacy-simulator.html` — 구 4업종 시뮬레이터 (Phase 2 재확장 참고용)

## 계산 엔진 (engine.js)
5가지 수당:
- ① 팩추천 커미션 = 신규 직추 팩 결제액 × 15%
- ② 후원수당(팀커미션) = 소실적 주간 CV × 직급별 지급율, 주극점 상한
- ③ 추천매칭 = 팀커미션 매칭 (세대별 1G~5G 다운라인 팀수당 × 직급별 매칭율)
  - 구매실적 매칭은 구매(팩/단품) 금액을 특정할 수 없어 미산정 — 결과 화면 안내문구로 보완
- ④ 랭크업 보너스 = 직급 상승 시 최초 1회
- ⑤ 직급유지(랭크 퀄리파이) = 4주 간격 주급

직급 판정: 최근 4주 누적 소실적 QV = min(좌QV, 우QV) 기준, 10단계 greedy 판정.

## feature flag
- `index.html` 의 `SHOW_INDUSTRY_SELECTOR = false` — Phase 2 영업인 일반용 재확장 토글

## 검증 상태 (verify.js — PASS 24 / FAIL 0)
- PART A: TC-1~4 직급·①·②·④·⑤ 전 항목 일치 ✅
- PART B: ③ 팀커미션 매칭 공식 검증 — STEP3·4 ③값(92,175/217,350원) 재현 확인 ✅
- ③ 추천매칭은 세대별 팀수당 입력에 따라 산출 (입력 의존)

## ⏳ TODO (Phase 2)
- [ ] 모드B — 주당 N명 모집 52주 시뮬레이션 + 주차별 그래프
- [ ] 브론즈 초기 4주 다운라인 볼륨 내림(유지금액 차감 후 1회 롤다운) 반영
- [ ] PDF 다운로드 / 마일스톤 카드
- [ ] 모집 깔때기 연동 (CTA, 리드마그넷)
