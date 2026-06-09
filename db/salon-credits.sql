-- ════════════════════════════════════════════════════════════════
-- 살롱 디노언니 "추가 대화권" — 고객이 직접 PayApp 결제 (전화번호 기준)
-- 프로젝트 xmlcczczizqenrdsmnmi — SQL Editor에 붙여넣고 Run
-- 매일 무료 3회 외에, 구매한 횟수(paid_balance)를 소진하며 더 대화
-- ════════════════════════════════════════════════════════════════

-- 고객 리드에 "구매한 잔여 대화 횟수" 컬럼
alter table public.customer_leads add column if not exists paid_balance int not null default 0;

-- 고객 결제 주문 (멱등성 키 = payapp_order_id)
create table if not exists public.customer_orders (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null,
  payapp_order_id text unique,
  count           int  not null,           -- 충전 대화 횟수 (100, 300)
  price           int  not null,           -- 결제 금액
  status          text not null default 'requested',  -- requested | paid | cancelled
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create index if not exists idx_customer_orders_phone on public.customer_orders(phone);
alter table public.customer_orders enable row level security;  -- service_role 전용 (정책 없음)

-- 원자적 적립: 해당 번호의 살롱 리드에 대화 횟수 추가
create or replace function public.add_salon_credits(p_phone text, p_count int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.customer_leads
     set paid_balance = coalesce(paid_balance, 0) + p_count,
         last_seen    = now()
   where phone = p_phone and source = 'salon';
$$;
