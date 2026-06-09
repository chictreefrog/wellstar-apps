-- 고객 리드(살롱/케어)에 팀·영업인 귀속 컬럼 추가 (앱 리드 탭 필터용)
alter table public.customer_leads  add column if not exists team_id uuid;
alter table public.care_subscribers add column if not exists inviter_id uuid;
alter table public.care_subscribers add column if not exists team_id uuid;
create index if not exists idx_customer_leads_team    on public.customer_leads(team_id);
create index if not exists idx_care_subscribers_team    on public.care_subscribers(team_id);
create index if not exists idx_care_subscribers_inviter on public.care_subscribers(inviter_id);
