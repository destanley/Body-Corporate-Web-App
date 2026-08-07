-- Mirror of the migrations applied via the Supabase MCP on 6 August 2026
-- (session 3), for the record. Already live — do not re-run against the
-- production project except to rebuild it from scratch.
--
-- Applied as:
--   agm_report_insurance_schedule_and_settings
--   agm_report_settings_sewerage_new
--
-- Why: the AGM report template now carries real figures in the insurance
-- schedule and garden service sections. Neither had a table behind it, so both
-- rendered as blank cells to be typed into Word every September. Additive only.

-- ---------------------------------------------------------------------------
-- agm_report_insurance_schedule_and_settings
-- ---------------------------------------------------------------------------

-- Floor area is a title-deed fact like participation_quota, so it belongs on
-- the unit rather than being re-entered on every year's insurance schedule.
alter table public.units add column if not exists sqm numeric;

-- One row per unit per financial year. Per-annum and per-month totals are
-- derived in the app (premium + common property + sasria + broker, / 12) so a
-- stored total can never drift from its components.
create table if not exists public.insurance_schedule (
  id uuid primary key default gen_random_uuid(),
  financial_year text not null,
  unit_id uuid not null references public.units(id) on delete cascade,
  sum_insured numeric,
  premium numeric,
  common_property numeric,
  sasria numeric,
  broker_fee numeric,
  updated_at timestamptz not null default now(),
  unique (financial_year, unit_id)
);
create index if not exists insurance_schedule_fy_idx on public.insurance_schedule (financial_year);

-- One row per financial year for the figures the AGM approves that have no
-- home in levy_rates or the tariff tables.
create table if not exists public.agm_report_settings (
  financial_year text primary key,
  garden_rate_per_day numeric,
  garden_increase_pct numeric,
  garden_proposed_rate_per_day numeric,
  garden_visits_per_month numeric default 2,
  garden_bonus_amount numeric,
  garden_bonus_due_date date,
  garden_increase_effective_date date,
  blockwatch_monthly_current numeric,
  blockwatch_monthly_proposed numeric,
  services_note_annual_estimate numeric,
  prepared_by text,
  checked_by text,
  updated_at timestamptz not null default now()
);

alter table public.insurance_schedule enable row level security;
alter table public.agm_report_settings enable row level security;

-- Trustee-only, matching every other table in the schema. Residents have no
-- read path to either: the AGM report is a trustee document.
drop policy if exists insurance_schedule_trustee on public.insurance_schedule;
create policy insurance_schedule_trustee on public.insurance_schedule
  for all to authenticated using (public.is_trustee()) with check (public.is_trustee());

drop policy if exists agm_report_settings_trustee on public.agm_report_settings;
create policy agm_report_settings_trustee on public.agm_report_settings
  for all to authenticated using (public.is_trustee()) with check (public.is_trustee());

-- ---------------------------------------------------------------------------
-- agm_report_settings_sewerage_new
-- ---------------------------------------------------------------------------
-- The "New — FY" column for sewerage had no source: council_invoices only
-- carries the rate currently being billed, and next year's tariff isn't known
-- until the council publishes it. It rendered as a permanent blank.
alter table public.agm_report_settings
  add column if not exists sewerage_per_unit_new numeric;

-- ---------------------------------------------------------------------------
-- Seed: FY 2025/2026, taken from the trustee's approved AGM report template.
-- ---------------------------------------------------------------------------
with sq(no, sqm) as (values (1,193),(2,225),(3,225),(4,225),(5,161),(6,198),(7,182))
update public.units u set sqm = sq.sqm from sq where u.unit_number = sq.no;

with s(no, sum_insured, premium) as (values
  (1, 1854576.00, 2206.95),
  (2, 2756826.00, 4180.62),
  (3, 2464344.00, 2932.57),
  (4, 2160000.00, 3470.40),
  (5, 2038498.00, 3325.81),
  (6, 2466896.00, 3835.61),
  (7, 2493420.00, 2967.17))
insert into public.insurance_schedule
  (financial_year, unit_id, sum_insured, premium, common_property, sasria, broker_fee)
select '2025/2026', u.id, s.sum_insured, s.premium, 67.39, 105.78, 33.42
from s join public.units u on u.unit_number = s.no
on conflict (financial_year, unit_id) do update set
  sum_insured = excluded.sum_insured, premium = excluded.premium,
  common_property = excluded.common_property, sasria = excluded.sasria,
  broker_fee = excluded.broker_fee, updated_at = now();

insert into public.agm_report_settings
  (financial_year, garden_rate_per_day, garden_increase_pct, garden_proposed_rate_per_day,
   garden_visits_per_month, garden_bonus_amount, garden_bonus_due_date,
   garden_increase_effective_date, blockwatch_monthly_current, blockwatch_monthly_proposed,
   services_note_annual_estimate, sewerage_per_unit_new, prepared_by, checked_by)
values ('2025/2026', 387.00, 7, 414.00, 2, 828.00, '2026-12-15', '2027-01-01', 150.00, 150.00,
   15584.00, 774.48, 'D Stanley', 'M Hutchinson')
on conflict (financial_year) do nothing;
