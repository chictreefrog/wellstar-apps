# 수입 시뮬레이터 — Claude Code 컨텍스트

## 앱 정보
- **URL**: app.wellstar.life/simulator/
- **저장소**: chictreefrog/wellstar-apps / simulator/ 폴더
- **대상**: 영업자 (NM, 보험, 방문판매, 기타)
- **목적**: 활동량 → 수입 계산 + 목표 수입 → AI 역산 플랜

## 탭 구조
1. **수입 계산 탭** — 슬라이더로 활동량 입력 → 예상 수입 계산
2. **목표 플래너 탭** — 목표 금액 설정 → AI 역산 플랜 생성

## 업종 4가지 (변경 금지)
- nm: 네트워크마케팅 (PV 기준 수당 계산)
- insurance: 보험 영업 (초회/유지 수수료)
- direct: 방문판매 (마진율 기반)
- custom: 직접 입력

## AI 역산 플랜 API
- Endpoint: blogtool.wellstar.life/api/income-plan (⏳ 미구현)
- 실패 시 로컬 폴백 자동 실행 (generateLocalPlan 함수)
- Request: { targetAmount, industry, industryName }
- Response: { plan: [{ icon, title, content }] }

## AI 다이어리 연동
- localStorage 'diary_goals' 키에 income_target, industry, income_plan 저장
- 다이어리 앱과 같은 브라우저에서 열면 자동 연동

## ✅ 완료
- 4개 업종 수입 계산 (슬라이더)
- 목표 금액 역산 플래너 (로컬 폴백 포함)
- 달성 타임라인 시각화
- AI 다이어리 연동 (localStorage)
- 옆집디노 브랜딩

## ⏳ TODO
- [ ] **income-plan API**: blogtool에 api/income-plan.ts 추가 → Gemini로 더 정교한 플랜 생성
- [ ] **업종별 수당 커스터마이징**: 사용자가 수당 구조 직접 설정 저장
- [ ] **히스토리**: 계산 결과 저장 및 비교
- [ ] **앱 허브 랜딩 업데이트**: simulator 카드 추가
