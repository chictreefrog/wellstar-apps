-- ════════════════════════════════════════════════════════════════
-- 고객 리드(살롱 등) + 고객 AI/문자 사용 집계(영업인 귀속·청구용)
-- 프로젝트 xmlcczczizqenrdsmnmi — SQL Editor에 붙여넣고 Run
-- ════════════════════════════════════════════════════════════════

-- 고객 리드 (살롱 게이트로 수집, 로그인 계정 아님)
create table if not exists public.customer_leads (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null,
  source         text not null default 'salon',  -- salon | care ...
  name           text,
  age_band       text,
  ref            text,                            -- 공유한 영업인 코드(business_code)
  inviter_id     uuid,                            -- 귀속 영업인 profile id
  ai_used_date   date,                            -- 디노언니 일일 한도용
  ai_used_count  int  not null default 0,
  created_at     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  unique (phone, source)
);
create index if not exists idx_customer_leads_inviter on public.customer_leads(inviter_id);

-- 고객 AI/문자 사용 로그 (영업인별 비용 집계 → 모니터링/청구)
create table if not exists public.customer_ai_log (
  id          uuid primary key default gen_random_uuid(),
  inviter_id  uuid,                 -- 비용 귀속 영업인 (없으면 옆집디노 부담)
  source      text not null,        -- salon_ai | care_sms
  lead_phone  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_customer_ai_log_inviter on public.customer_ai_log(inviter_id, created_at desc);

-- RLS: 서버(service_role)만 (클라이언트 직접 접근 차단)
alter table public.customer_leads  enable row level security;
alter table public.customer_ai_log enable row level security;
