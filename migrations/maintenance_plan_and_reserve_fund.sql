-- Asset register, condition log and reserve fund ledger — the basis of the
-- PMR 22 ten-year maintenance, repair and replacement plan.
-- Applied via the Supabase MCP on 8 August 2026.
--
-- Design decisions taken with the trustee before building:
--
--  * The reserve fund is NOTIONAL — book entries against the single FNB
--    account. There is no separate reserve bank account and none is planned,
--    so the ledger carries no account linkage.
--  * Condition is a DATED LOG, many rows per component, never a field on the
--    asset. A deterioration trend across years is what justifies moving a
--    replacement date forward, and PMR 22 plans are re-approved annually.
--  * The plan itself is COMPUTED from the register every time so it cannot go
--    stale; each AGM's approved version is frozen into
--    maintenance_plan_snapshots, because compliance rests on what the meeting
--    actually adopted, not on what the register says today.

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category text not null,
  location text,
  quantity numeric,
  installed_on date,
  expected_life_years integer,
  replacement_cost numeric,
  cost_basis text,
  status text not null default 'not_assessed',
  active boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_status_chk check (status in ('not_assessed','assessed','scheduled','replaced','retired')),
  constraint assets_life_chk check (expected_life_years is null or expected_life_years > 0),
  constraint assets_cost_chk check (replacement_cost is null or replacement_cost >= 0)
);

create table if not exists asset_inspections (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  inspected_on date not null,
  condition text not null,
  inspector text,
  notes text,
  revised_remaining_life_years integer,
  created_at timestamptz not null default now(),
  constraint inspections_condition_chk check (condition in ('good','fair','poor','failed')),
  constraint inspections_life_chk check (revised_remaining_life_years is null or revised_remaining_life_years >= 0),
  constraint inspections_unique unique (asset_id, inspected_on)
);
create index if not exists asset_inspections_asset_idx on asset_inspections (asset_id, inspected_on desc);

create table if not exists reserve_fund_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  financial_year text,
  entry_type text not null,
  amount numeric not null,
  asset_id uuid references assets(id) on delete set null,
  description text,
  created_at timestamptz not null default now(),
  constraint reserve_type_chk check (entry_type in ('opening','contribution','drawdown','interest','adjustment')),
  constraint reserve_amount_chk check (amount <> 0)
);
create index if not exists reserve_fund_entries_date_idx on reserve_fund_entries (entry_date);

create table if not exists maintenance_plan_snapshots (
  id uuid primary key default gen_random_uuid(),
  financial_year text not null unique,
  approved_on date,
  approved_by text,
  inflation_pct numeric,
  reserve_opening numeric,
  annual_contribution numeric,
  plan jsonb not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table assets enable row level security;
alter table asset_inspections enable row level security;
alter table reserve_fund_entries enable row level security;
alter table maintenance_plan_snapshots enable row level security;

create policy assets_trustee on assets for all using (public.is_trustee()) with check (public.is_trustee());
create policy asset_inspections_trustee on asset_inspections for all using (public.is_trustee()) with check (public.is_trustee());
create policy reserve_fund_entries_trustee on reserve_fund_entries for all using (public.is_trustee()) with check (public.is_trustee());
create policy maintenance_plan_snapshots_trustee on maintenance_plan_snapshots for all using (public.is_trustee()) with check (public.is_trustee());

-- 27 component NAMES seeded as a walk-the-property checklist. Every age, life
-- and cost deliberately left null: those come from the survey, and a seeded
-- guess would be indistinguishable from real data six months from now.
