-- ════════════════════════════════════════════════════════════════
-- 안심케어 안부 알림 — care_subscribers (프로젝트: xmlcczczizqenrdsmnmi)
-- SQL Editor(dino-sales)에 붙여넣고 Run
-- 부모님이 N일째 체크인이 없으면 cron이 자녀(guardian_phone)에게 솔라피 문자 발송
-- ════════════════════════════════════════════════════════════════
create table if not exists public.care_subscribers (
  id               uuid primary key default gen_random_uuid(),
  guardian_phone   text unique not null,    -- 자녀(보호자) 연락처 = 식별 키, 문자 받을 번호
  guardian_name    text,
  parent_name      text,
  alert_after_days int  not null default 2, -- 며칠 무응답 시 알림
  ref              text,                    -- 공유한 영업인 코드(business_code)
  last_active      timestamptz,             -- 부모님 마지막 체크인(=안부 신호)
  last_alerted_at  timestamptz,             -- 마지막 문자 발송 시각(중복 방지)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_care_last_active on public.care_subscribers(last_active);

-- RLS: 클라이언트 직접 접근 차단 (서버 service_role만 — care-checkin/cron이 처리)
alter table public.care_subscribers enable row level security;
-- (정책 없음 = 일반/anon 접근 불가, service_role은 RLS 우회)
