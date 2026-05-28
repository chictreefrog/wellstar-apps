# 옆집디노 안심케어 — CONTEXT

## 한 줄 요약
부모님이 매일 **약 복용을 체크인** → 그 행동이 **안부 신호**가 됨 → 며칠간 신호가 끊기면 **자녀에게 문자**.
콜드(미구매) 고객 진입용 리드마그넷. 자녀가 부모님께 설치 → 매일 사용 → 향후 무료 홍채검사로 전환.

## 위치 / 배포
- 저장소: `chictreefrog/wellstar-apps`
- 경로: `care/index.html` + `care/manifest.json` + `care/sw.js`
- 배포 URL: `app.wellstar.life/care/` (Vercel 자동배포)
- 패턴: 플래너와 동일한 바닐라 HTML 단일 파일. 외부 의존성은 Pretendard 폰트 CDN뿐.

---

## ✅ 완료 (프론트엔드 v2)
- 시니어 친화 UI: 큰 글씨/큰 버튼/고대비, 글자크기 3단계, 다크/라이트 테마
- **자녀 온보딩**: 부모님 호칭, 자녀 이름·전화번호, 안부 끊김 기준(2/3/4일)
- **약 등록/편집**: 약 이름 + 복용 시간 (의료 조언 아님 — 알람·기록 도구임을 명시)
- **부모님 매일 화면**: 오늘의 약 카드 + "먹었어요" 체크 + 완료 상태 + 보조 습관(물/산책/기분)
- **안심 배너**: 오늘 안부 신호 전달 여부 + 마지막 안부 시각 표시
- **안부 문자 미리보기**(설정): 자녀에게 갈 문자 템플릿 미리보기 (UX 확인용)
- localStorage 저장. 키 = 향후 Supabase 컬럼명과 일치하도록 설계:
  - `care_profile` { parent_name, guardian_name, guardian_phone, alert_after_days, theme, font_scale }
  - `care_meds` [{ id, name, time, created_at }]
  - `care_daily_log` { 'YYYY-MM-DD': { taken:[medId], habits:[] } }
  - `care_last_active_at` (ISO) ← **안부 신호의 핵심값**
  - `care_notif_fired_today` { 'YYYY-MM-DD::medId': timestamp } — 알림 중복 방지

### ✅ 완료 — PWA + 알림 (2026-05-29 추가)
- **PWA 풀 셋업**:
  - `manifest.json` (start_url, theme #2E7D5B, 192/512 icons)
  - `sw.js` — network-first + auto-update (visibilitychange) + controllerchange reload
  - `apple-mobile-web-app-capable` 메타 + `apple-touch-icon`
  - vercel.json: `/care` 라우팅 + sw.js/manifest 헤더
- **홈 화면 추가 기능**:
  - 설정 → "📲 홈 화면에 추가" 항목
  - Android: `beforeinstallprompt` 캐치해서 원클릭 `prompt()`
  - iOS: 안내 alert (공유 → 홈 화면에 추가 단계 표시)
  - 이미 설치된 경우 자동 감지하여 "✅ 추가됨" 표시
- **약 복용 알림**:
  - 설정 → "🔔 약 시간 알림" 토글로 권한 요청
  - 1분마다 `meds[].time`과 현재 시간 비교 (±1분 허용)
  - 일치 시 → SW의 `postMessage('SHOW_MED_NOTIFICATION')` → `showNotification`
    (앱 닫혀있어도 SW가 표시)
  - 이미 체크한 약은 알림 안 보냄 + 같은 약 하루 1번만 (중복 방지)
  - 알림 클릭 → 안심케어 앱 포커스 또는 열기
  - 백그라운드 → 포그라운드 전환 시 즉시 재검사 (놓친 알림 보강)
- **Web Push 핸들러 사전 준비** (sw.js `push` 이벤트):
  - 서버 cron이 향후 약 시간에 Web Push 보내면 즉시 알림 표시
  - VAPID + 구독 등록은 백엔드 단계에서 (TODO 5 백엔드)

---

## ⏳ TODO (백엔드 — 여기가 핵심)

### 0. 중요한 설계 원칙
**"며칠간 무응답" 감지는 절대 휴대폰에서 못 함.** PWA/웹은 백그라운드 실행이 막혀 있음(특히 iOS).
→ 휴대폰은 체크인할 때마다 `last_active`만 서버에 기록.
→ **서버(스케줄러)가 매일 "기준일 초과한 사람?"을 검사** → 초과 시 문자 발송.
이게 유일하게 신뢰할 수 있는 구조. (코드 내 `syncCheckin()` 함수가 연동 지점, 주석 ★표시)

또한 이 도구는 **응급 구조 서비스가 아님**. "안부 확인"으로만 포지셔닝.
119 연결/생명 보장 같은 표현 금지(책임 문제). 문자 문구도 "연락드려 보세요" 수준 유지.

### 1. Supabase 테이블 (dino-sales 프로젝트)
```sql
care_users (
  id uuid pk, parent_name text, guardian_name text, guardian_phone text,
  alert_after_days int default 3, last_active_at timestamptz,
  alerted_at timestamptz,            -- 마지막 문자 발송 시각(중복발송 방지)
  team text,                         -- ?team= 분기용 (Phase 2)
  created_at timestamptz default now()
)
care_meds ( id uuid pk, user_id uuid fk, name text, time text, created_at timestamptz )
care_checkins ( id uuid pk, user_id uuid fk, kind text, at timestamptz )  -- kind: med/water/walk/mood
```

### 2. 체크인 기록 API
`api/care-checkin` (POST) — 프론트의 `syncCheckin()`에서 호출
- body: `{ phone, last_active }`
- 동작: care_users.last_active_at 갱신 + (선택) care_checkins insert
- ⚠️ CORS: `app.wellstar.life`에서 호출 → 인라인 명시적 헤더 필수

### 3. 안부 끊김 감지 + 문자 발송 (스케줄러)
- **Vercel Cron** 또는 **Supabase Scheduled Function** 으로 매일 1회 실행
- 로직: `now - last_active_at >= alert_after_days` 이고 `alerted_at`이 최근이 아닌 사용자 조회
  → 자녀 번호로 SMS 발송 → `alerted_at` 갱신(중복 방지). 다시 체크인 들어오면 알림 리셋.
- 문자 문구:
  `[옆집디노 안심케어] {parent_name}님이 {N}일째 약 확인이 없어요. 한번 연락드려 보는 게 좋겠어요. 🦕`

### 4. 문자(SMS) 발송 — Resend 아님!
- **Resend는 이메일 전용.** 문자는 한국 SMS 업체 필요.
- 솔라피(Solapi) / 알리고 / NHN Cloud 중 택1. v1은 순수 SMS로 시작.
- 환경변수: `SMS_API_KEY`, `SMS_SENDER`(발신번호) Vercel에 등록.
- 향후 최적화: 카카오 알림톡 + 실패 시 SMS 대체발송.

### 5. ~~약 복용 알림~~ — ✅ 프론트 v2에서 완료
- localStorage + setInterval + SW notification 조합으로 구현됨
- Web Push로 확장하려면: VAPID 키 + `/api/care-push-subscribe` + cron으로 발송 추가
- 참고: 같은 저장소 `shared/push.js` + `api/push-send` 패턴 그대로 복제 가능

### 6. ~~PWA 만들기~~ — ✅ 완료
- `care/manifest.json` + `care/sw.js` 추가됨
- 홈 화면 추가 기능 + 자동 업데이트 + 알림 전부 작동

---

## 전환 흐름 (참고)
콜드 고객 → 자녀가 부모님께 설치 → 매일 약 체크인(=안부) → 주간 컨디션 신호
→ **무료 홍채검사 예약**(비영업 CTA) → 구매 → *그 후 영양제 알람/재구매 카운트다운 층 활성화*.
- 미구매자 화면에는 제품·영업 언급 금지. 시니어 친화·따뜻함 유지.
- 홍채검사/제품 연결은 "주간 컨디션 요약"(이메일, Resend) 단계에서 부드럽게.

## 다음에 얹을 것 (별도 작업)
- Supabase 백엔드 + Vercel cron + SMS (TODO 1~4)
- Web Push 풀 셋업 (현재는 로컬 알림 only — 앱 닫혀있고 PWA도 종료된 상태에선 알림 없음)
- 주간 컨디션 요약 이메일(Resend) → 홍채검사 소프트 연결
- 구매 후 영양제 알람 + 재구매 D-day 카운트다운
- `?team=` 분기(파트너별 브랜딩/연락처) — Phase 2
