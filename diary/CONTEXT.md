# 영업 다이어리 (Sales Diary) — Claude Code 컨텍스트

## 앱 정보
- **URL**: app.wellstar.life/diary/
- **저장소**: chictreefrog/wellstar-apps / diary/ 폴더
- **대상 사용자**: NM(네트워크마케팅) 영업자 전용
- **목적**: 고객 관리(칸반) + 일일 활동 트래커 + 팔로업 알림 + 주간 리뷰
- **기획서**: 영업다이어리-기획서-v1.1.docx (프로젝트 Knowledge에 있음)

## 브랜드 정보
- 브랜드명: 옆집디노 / wellstar.life
- 플래너 앱(app.wellstar.life/planner/)과 같은 시리즈
- 다크 테마 고정 (라이트 모드 없음)

## 현재 Phase
- **Phase 1 (현재)**: localStorage 저장. API 서버 없음. 순수 프론트엔드.
- **Phase 2 예정**: Supabase 연동 (인증 + 리더/파트너 역할 구분)
- **Phase 3 예정**: 리더 대시보드 + 결제 연동

## localStorage 키 목록 (⚠️ 변경 금지 — Supabase 전환 시 그대로 사용)
| 키 | 내용 |
|---|---|
| `diary_customers` | 고객 배열 (JSON) |
| `diary_activities` | 일일 활동 기록 배열 (JSON) |
| `diary_goals` | 주간 목표 객체 (JSON) |
| `diary_journal` | 거절 회복 저널 배열 (JSON) |
| `diary_act_{YYYY-MM-DD}` | 당일 활동 카운터 (임시, 저장 시 diary_activities로 이동) |
| `diary_act_memo_{YYYY-MM-DD}` | 당일 메모 |

## 고객 데이터 구조
```json
{
  "id": "string (genId)",
  "name": "string",
  "phone": "string",
  "birthday": "YYYY-MM-DD",
  "stage": "잠재|접촉|미팅|성사|휴면",
  "followUp": "YYYY-MM-DD",
  "note": "string",
  "memos": [{ "date": "YYYY-MM-DD", "text": "string" }],
  "createdAt": "ISO string"
}
```

## 고객 단계 5개 (⚠️ 순서/이름 변경 금지)
잠재 → 접촉 → 미팅 → 성사 → 휴면

## 활동 항목 7개 (⚠️ 순서/이름 변경 금지)
신규연락 / 팔로업 / 미팅 / 성사 / SNS / 샘플제공 / 제품배송

## 탭 구조 (⚠️ 변경 금지)
홈 / 고객(칸반) / 활동 / 리뷰

## 컬러 시스템 (CSS 변수)
```css
--bg: #0F0F1E        /* 최하단 배경 */
--bg2: #1A1A2E       /* 헤더, 탭바 */
--bg3: #252545       /* 입력 배경, 버튼 */
--card: #1E1E35      /* 카드 배경 */
--accent: #FF6B35    /* 주 강조색, 버튼 */
--red: #E74C3C       /* 긴급 팔로업 */
--yellow: #F39C12    /* 오늘 팔로업 */
--green: #27AE60     /* 성사 */
--blue: #3498DB      /* 접촉 단계 */
--gray: #636E72      /* 휴면 */
```

## 단계별 컬러 매핑
| 단계 | 텍스트 색 | 배경 |
|---|---|---|
| 잠재 | #B2BEC3 | rgba(99,110,114,0.25) |
| 접촉 | #74B9FF | rgba(52,152,219,0.25) |
| 미팅 | #FDCB6E | rgba(243,156,18,0.25) |
| 성사 | #55EFC4 | rgba(39,174,96,0.25) |
| 휴면 | #636E72 | rgba(99,110,114,0.15) |

## 파일 구조
```
wellstar-apps/
  diary/
    index.html      ← 앱 전체 (단일 파일, 약 600줄)
    sw.js           ← 서비스워커 (캐시)
    manifest.json   ← PWA 설정
    CONTEXT.md      ← 이 파일
```

## 자주 하는 수정 작업
- **활동 항목 추가**: `ACTIVITY_ITEMS` 배열에 추가 (index.html JS 섹션)
- **고객 단계 추가**: `stages` 배열 + CSS `.col-XXX`, `.stage-XXX` 추가
- **홈 화면 카드 추가**: `renderHome()` 함수 내부
- **새 모달 추가**: 기존 모달 패턴 복사 (`modal-overlay > modal` 구조)

## 연관 앱
- **5분법칙 플래너**: app.wellstar.life/planner/ (동일 저장소 planner/ 폴더)
- **허브 랜딩**: app.wellstar.life (index.html)

## Phase 2 Supabase 전환 시 참고
- localStorage 키명 = Supabase 테이블 컬럼명으로 설계됨
- users 테이블: id, email, role(leader/partner/free), leader_id
- customers 테이블: id, user_id, name, phone, birthday, stage, follow_up_date, note
- activities 테이블: id, user_id, date, 신규연락, 팔로업, 미팅, 성사, SNS, 샘플제공, 제품배송
- journal 테이블: id, user_id, date, customer, situation, feeling, next_action

## 작업 시 주의사항
1. localStorage 키명 절대 변경 금지
2. 탭 4개 구조 유지 (홈/고객/활동/리뷰)
3. 단일 HTML 파일 원칙 (별도 CSS/JS 파일 만들지 말 것)
4. 한국어 UI 유지
5. 다크 테마 고정
