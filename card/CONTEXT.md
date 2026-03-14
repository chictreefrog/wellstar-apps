# 나의 AI 명함 — Claude Code 컨텍스트

## 앱 정보
- **URL**: app.wellstar.life/card/
- **저장소**: chictreefrog/wellstar-apps / card/ 폴더
- **대상**: 모든 영업자 (NM, 보험, 부동산 등)
- **목적**: 디지털 명함 제작 + QR 코드 생성 + 공유

## 기능
- 프로필 사진 업로드 (base64 로컬 저장)
- 이름/직함/연락처/소개 입력
- SNS 링크 (인스타/카카오/유튜브/블로그)
- 옆집디노 도구 링크 토글 (사주/플래너/다이어리/퀴즈)
- 6가지 카드 테마 선택
- QR 코드 생성 (vCard 형식) → canvas 저장
- Web Share API로 공유

## localStorage 키
- `namecard_data` — 명함 전체 데이터 (JSON)

## 데이터 구조
```json
{
  "name": "string",
  "title": "string",
  "phone": "string",
  "email": "string",
  "intro": "string",
  "photo": "base64 string",
  "theme": "dark-orange|deep-purple|ocean-blue|forest-green|rose-gold|midnight",
  "sns": { "insta": "", "kakao": "", "youtube": "", "blog": "" },
  "tools": { "saju": false, "planner": false, "diary": false, "quiz": false }
}
```

## 카드 테마 6가지 (순서/이름 변경 금지)
dark-orange / deep-purple / ocean-blue / forest-green / rose-gold / midnight

## QR 코드 라이브러리
cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
vCard 3.0 형식으로 QR 내용 인코딩

## ✅ 완료
- 명함 편집 (편집 탭)
- 카드 미리보기 + 테마 (카드/QR 탭)
- QR 코드 생성 + 저장
- 공유 기능
- 옆집디노 브랜딩 푸터

## ⏳ TODO
- [ ] **카드 이미지 저장**: html2canvas 연동해서 카드 전체를 이미지로 저장 (지금은 QR만 저장 가능)
- [ ] **카드 공유 페이지**: app.wellstar.life/card/view/?data=... 형태로 링크 공유 가능하게
- [ ] **명함 템플릿 추가**: 업종별 기본 직함/소개 템플릿 제공
