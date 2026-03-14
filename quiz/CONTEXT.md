# 영업 스타일 진단 퀴즈 — Claude Code 컨텍스트

## 앱 정보
- **URL**: app.wellstar.life/quiz/
- **저장소**: chictreefrog/wellstar-apps / quiz/ 폴더
- **대상**: 모든 영업자 (NM, 보험, 부동산, 방문판매, 1인사업자 등)
- **목적**: 영업 스타일 진단 + 리드 수집 + 도구 추천 연결

## 8가지 타입 (순서/이름 변경 금지)
| 키 | 이름 | 이모지 | 색상 |
|---|---|---|---|
| A | 불꽃 개척자 | 🔥 | #FF6B35 |
| B | 공감 파도 | 🌊 | #74B9FF |
| C | 천생 리더 | 🦁 | #FDCB6E |
| D | 전략형 설계사 | 💡 | #A29BFE |
| E | 신뢰 농부 | 🌱 | #55EFC4 |
| F | 디지털 인플루언서 | 📱 | #FD79A8 |
| G | 집중형 스나이퍼 | 🎯 | #E17055 |
| H | 스토리텔러 | ✨ | #FFD700 |

## 문항 구조
- 10문항, 각 4지선다
- 각 선택지는 타입 키(A~H)에 +1점
- 최고 점수 타입이 결과로 표시

## 리드 수집
- 결과 화면에서 이메일 입력 → 상세 리포트 발송
- API: blogtool.wellstar.life/api/quiz-report (⏳ 미구현)
- Resend API + FluentCRM 태그 (다이어리, 사주와 동일 패턴)

## 화면 구조
1. 인트로 (screen-intro)
2. 퀴즈 (screen-quiz) — 문항 1개씩 표시
3. 로딩 (screen-loading) — 2.2초
4. 결과 (screen-result) — 타입/강점/점수분포/이메일/도구추천

## 연결된 도구 (추천 섹션)
- 5분법칙 플래너: app.wellstar.life/planner/
- AI 다이어리: app.wellstar.life/diary/
- 사주 성공진단: wellstar.life/saju/

## ✅ 완료
- 전체 퀴즈 앱 (인트로/퀴즈/로딩/결과)
- 8타입 × 강점/설명/도구추천
- 점수 분포 바 애니메이션
- 결과 공유 기능 (Web Share API)

## ⏳ TODO
- [ ] **quiz-report API 구현**: blogtool에 api/quiz-report.ts 추가 → 이메일 상세 리포트 발송 (사주 패턴 참고)
- [ ] **앱 허브 랜딩 업데이트**: app.wellstar.life index.html에 퀴즈 카드 추가
- [ ] **공유 카드 이미지**: 결과를 1080x1080 이미지로 저장 기능
