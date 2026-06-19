-- Public API V1 · Batch 7 — Commercial plans + plan assignments.
-- Billing visibility only. No payment rails, no invoices, no /v1/usage,
-- no client/internal monitoring dashboards, no docs/OpenAPI, no support
-- intake, no webhook changes, no write API, no POI/WaD/compliance/
-- verification/payment decisions.

create table if not exists public.api_commercial_plans (
  id uuid primary key default gen_random_uuid(),
  plan_name text not null,
  description text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  monthly_fee numeric(18,2) not null default 0 check (monthly_fee >= 0),
  included_lookup_allowance integer not null default 0 check (included_lookup_allowance >= 0),
  overage_price_per_successful_lookup numeric(18,4) not null default 0 check (overage_price_per_successful_lookup >= 0),
  manual_review_fee numeric(18,2) not null default 0 check (manual_review_fee >= 0),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly')),
  overage_allowed boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.api_commercial_plans to authenticated;
grant all on public.api_commercial_plans to service_role;
alter table public.api_commercial_plans enable row level security;
create policy "platform_admin manages commercial plans" on public.api_commercial_plans for all to authenticated
  using (public.has_role(auth.uid(), 'platform_admin'::app_role))
  with check (public.has_role(auth.uid(), 'platform_admin'::app_role));
create policy "api_admin auditor read commercial plans" on public.api_commercial_plans for select to authenticated
  using (
    public.has_role(auth.uid(), 'platform_admin'::app_role)
    or public.has_role(auth.uid(), 'api_admin'::app_role)
    or public.has_role(auth.uid(), 'auditor'::app_role)
  );
-- Globally unique plan name keeps audit and lookup unambiguous.
create unique index if not exists uq_api_commercial_plans_name on public.api_commercial_plans(lower(plan_name));

create table if not exists public.api_client_plan_assignments (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid not null references public.api_clients(id) on delete cascade,
  api_commercial_plan_id uuid not null references public.api_commercial_plans(id) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.api_client_plan_assignments to authenticated;
grant all on public.api_client_plan_assignments to service_role;
alter table public.api_client_plan_assignments enable row level security;
create policy "platform_admin manages plan assignments" on public.api_client_plan_assignments for all to authenticated
  using (public.has_role(auth.uid(), 'platform_admin'::app_role))
  with check (public.has_role(auth.uid(), 'platform_admin'::app_role));
create policy "api_admin auditor read plan assignments" on public.api_client_plan_assignments for select to authenticated
  using (
    public.has_role(auth.uid(), 'platform_admin'::app_role)
    or public.has_role(auth.uid(), 'api_admin'::app_role)
    or public.has_role(auth.uid(), 'auditor'::app_role)
  );

-- Only one active plan assignment per api_client at any time (partial unique index).
create unique index if not exists uq_api_client_plan_assignments_one_active
  on public.api_client_plan_assignments(api_client_id) where active;

create index if not exists idx_api_client_plan_assignments_client on public.api_client_plan_assignments(api_client_id, active);
create index if not exists idx_api_client_plan_assignments_plan on public.api_client_plan_assignments(api_commercial_plan_id);

create or replace function public.update_updated_at_column_api_v1_b7()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_api_commercial_plans_updated_at on public.api_commercial_plans;
create trigger trg_api_commercial_plans_updated_at before update on public.api_commercial_plans
  for each row execute function public.update_updated_at_column_api_v1_b7();
drop trigger if exists trg_api_client_plan_assignments_updated_at on public.api_client_plan_assignments;
create trigger trg_api_client_plan_assignments_updated_at before update on public.api_client_plan_assignments
  for each row execute function public.update_updated_at_column_api_v1_b7();
