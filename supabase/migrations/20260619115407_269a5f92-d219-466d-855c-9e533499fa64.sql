create table if not exists public.api_usage_overrides (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid not null references public.api_clients(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  override_limit integer not null check (override_limit >= 0),
  reason text not null,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.api_usage_overrides to authenticated;
grant all on public.api_usage_overrides to service_role;
alter table public.api_usage_overrides enable row level security;
create policy "platform_admin manages usage overrides" on public.api_usage_overrides for all to authenticated
  using (public.has_role(auth.uid(), 'platform_admin'::app_role))
  with check (public.has_role(auth.uid(), 'platform_admin'::app_role));
create policy "api_admin auditor read usage overrides" on public.api_usage_overrides for select to authenticated
  using (public.has_role(auth.uid(), 'platform_admin'::app_role) or public.has_role(auth.uid(), 'api_admin'::app_role) or public.has_role(auth.uid(), 'auditor'::app_role));
create index if not exists idx_api_usage_overrides_lookup on public.api_usage_overrides(api_client_id, environment, active, expires_at);

create table if not exists public.api_usage_notifications_state (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid not null references public.api_clients(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  period_start date not null,
  threshold smallint not null check (threshold in (80, 100, 120)),
  notified_at timestamptz not null default now(),
  unique (api_client_id, environment, period_start, threshold)
);
grant select on public.api_usage_notifications_state to authenticated;
grant all on public.api_usage_notifications_state to service_role;
alter table public.api_usage_notifications_state enable row level security;
create policy "platform_admin api_admin auditor read usage notif state" on public.api_usage_notifications_state for select to authenticated
  using (public.has_role(auth.uid(), 'platform_admin'::app_role) or public.has_role(auth.uid(), 'api_admin'::app_role) or public.has_role(auth.uid(), 'auditor'::app_role));

create table if not exists public.api_active_requests (
  request_id text primary key,
  api_key_id uuid not null,
  api_client_id uuid,
  environment text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 seconds')
);
grant select on public.api_active_requests to authenticated;
grant all on public.api_active_requests to service_role;
alter table public.api_active_requests enable row level security;
create policy "platform_admin reads active requests" on public.api_active_requests for select to authenticated
  using (public.has_role(auth.uid(), 'platform_admin'::app_role));
create index if not exists idx_api_active_requests_key_exp on public.api_active_requests(api_key_id, expires_at);

create index if not exists idx_api_request_logs_v1_usage on public.api_request_logs(api_key_id, environment, created_at) where error_code is null;