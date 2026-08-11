-- Applied to the live project 11 August 2026 via the Supabase MCP; mirrored
-- here for the record.
--
-- agm_report_settings is re-keyed: financial_year now means "the year these
-- figures APPLY TO", not "the year the report covers".
--
-- The old model kept a figure and its proposed successor side by side on one
-- row — garden_rate_per_day next to garden_proposed_rate_per_day, and four
-- *_new columns holding the year after's charges. That is why every FY 2026/2027
-- proposal was logged against 2025/2026, and it left no way to say "this is now
-- the approved rate" other than by editing a column called "new".
--
-- Under the new key, "current" and "proposed" are the same column on different
-- rows. What distinguishes a proposal from an approved rate is no longer the
-- column name but figures_approved_on, and whether it has been applied.
--
-- Report metadata (prepared_by, checked_by, services_note_annual_estimate) and
-- the insurance columns stay on the year the report COVERS. They describe the
-- document, not a rate.
--
-- ORDER MATTERS: values are moved while the old column names still exist, and
-- only then are the columns renamed and the paired ones dropped.

-- 1. Make sure the destination row exists before anything is moved into it.
insert into public.agm_report_settings (financial_year)
select '2026/2027'
where not exists (select 1 from public.agm_report_settings where financial_year = '2026/2027');

-- 2. Move every forward-looking figure from the covering year to the year it
--    applies to.
update public.agm_report_settings dst
   set garden_rate_per_day            = coalesce(dst.garden_rate_per_day, src.garden_proposed_rate_per_day),
       garden_increase_pct            = coalesce(dst.garden_increase_pct, src.garden_increase_pct),
       garden_bonus_amount            = coalesce(dst.garden_bonus_amount, src.garden_bonus_amount),
       garden_bonus_due_date          = coalesce(dst.garden_bonus_due_date, src.garden_bonus_due_date),
       garden_increase_effective_date = coalesce(dst.garden_increase_effective_date, src.garden_increase_effective_date),
       blockwatch_monthly_current     = coalesce(dst.blockwatch_monthly_current, src.blockwatch_monthly_proposed),
       sewerage_per_unit_new          = coalesce(dst.sewerage_per_unit_new, src.sewerage_per_unit_new),
       water_demand_levy_new          = coalesce(dst.water_demand_levy_new, src.water_demand_levy_new),
       electricity_service_fee_new    = coalesce(dst.electricity_service_fee_new, src.electricity_service_fee_new),
       electricity_network_fee_new    = coalesce(dst.electricity_network_fee_new, src.electricity_network_fee_new),
       water_reconciliation_factor    = coalesce(dst.water_reconciliation_factor, src.water_reconciliation_factor),
       reserve_contribution_basis     = coalesce(dst.reserve_contribution_basis, src.reserve_contribution_basis),
       reserve_proposed_designation   = coalesce(dst.reserve_proposed_designation, src.reserve_proposed_designation),
       updated_at = now()
  from public.agm_report_settings src
 where src.financial_year = '2025/2026'
   and dst.financial_year = '2026/2027';

-- 3. Clear the moved figures off the covering year. The four charge columns are
--    left null there deliberately: the Current column for those reads the
--    council invoice or levy_rates, never this table.
update public.agm_report_settings
   set garden_increase_pct = null,
       garden_bonus_amount = null,
       garden_bonus_due_date = null,
       garden_increase_effective_date = null,
       sewerage_per_unit_new = null,
       water_demand_levy_new = null,
       electricity_service_fee_new = null,
       electricity_network_fee_new = null,
       water_reconciliation_factor = null,
       reserve_contribution_basis = null,
       reserve_proposed_designation = null,
       updated_at = now()
 where financial_year = '2025/2026';

-- 4. Rename what is now one figure per year, and drop the paired columns whose
--    values have been moved to their own row.
alter table public.agm_report_settings rename column sewerage_per_unit_new       to sewerage_per_unit;
alter table public.agm_report_settings rename column water_demand_levy_new       to water_demand_levy;
alter table public.agm_report_settings rename column electricity_service_fee_new to electricity_service_fee;
alter table public.agm_report_settings rename column electricity_network_fee_new to electricity_network_fee;
alter table public.agm_report_settings rename column blockwatch_monthly_current  to blockwatch_monthly;

alter table public.agm_report_settings drop column garden_proposed_rate_per_day;
alter table public.agm_report_settings drop column blockwatch_monthly_proposed;

-- 5. Approval and application state. A figure sitting in this table is a
--    proposal until the meeting approves it; applying it is what writes it to
--    the tables the app actually bills and reports on.
alter table public.agm_report_settings
  add column if not exists figures_approved_on date,
  add column if not exists figures_approved_by text,
  add column if not exists figures_applied_at timestamptz;

comment on table public.agm_report_settings is
  'One row per financial year, holding the figures that APPLY TO that year. A row is a set of proposals until figures_approved_on is set; applying it writes the figures through to levy_rates and the reserve ledger.';

-- 6. An immutable log of what each application actually wrote. The settings row
--    says "applied"; this says what, when, by whom, and what was skipped —
--    which is the part anyone asks about a year later.
create table if not exists public.agm_figure_applications (
  id uuid primary key default gen_random_uuid(),
  financial_year text not null,
  applied_at timestamptz not null default now(),
  applied_by text,
  result jsonb not null
);
create index if not exists agm_figure_applications_fy_idx
  on public.agm_figure_applications (financial_year, applied_at desc);

alter table public.agm_figure_applications enable row level security;

drop policy if exists agm_figure_applications_read  on public.agm_figure_applications;
drop policy if exists agm_figure_applications_write on public.agm_figure_applications;

create policy agm_figure_applications_read on public.agm_figure_applications
  for select using (public.is_trustee());
create policy agm_figure_applications_write on public.agm_figure_applications
  for all using (public.can_write_finance()) with check (public.can_write_finance());
