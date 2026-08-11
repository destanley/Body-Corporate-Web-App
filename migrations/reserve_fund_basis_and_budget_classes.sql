-- Applied to the live project 11 August 2026 via the Supabase MCP; mirrored
-- here for the record. Additive only — nothing existing was altered or dropped.
--
-- Reserve fund, AGM section 12.
--
-- Two things the report cannot derive and must be told:
--   * which reading of "contribution to the administrative fund" the scheme has
--     adopted (Regulation 2 does not define it; s3(1)(f) and s3(1)(a)(ii) pull
--     in opposite directions), and
--   * the designation the meeting is being asked to approve, which is a
--     decision and not a figure any table can produce.
-- Same shape and same home as sewerage_per_unit_new: stored on the row for the
-- year the report COVERS, holding what is proposed for the year after.
alter table public.agm_report_settings
  add column if not exists reserve_contribution_basis text,
  add column if not exists reserve_proposed_designation numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agm_report_settings_reserve_basis_chk') then
    alter table public.agm_report_settings
      add constraint agm_report_settings_reserve_basis_chk
      check (reserve_contribution_basis in ('all_contributions','levy_only'));
  end if;
end $$;

-- Which budget income lines are contributions, and on which reading. Matching
-- income rows by label in the report is what put bank interest inside the
-- reserve threshold once already; the classification belongs on the row.
alter table public.budget_lines
  add column if not exists contribution_class text,
  add column if not exists is_common_property_rm boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_contribution_class_chk') then
    alter table public.budget_lines
      add constraint budget_lines_contribution_class_chk
      check (contribution_class in ('levy','metered_recovery','non_contribution'));
  end if;
end $$;

comment on column public.budget_lines.contribution_class is
  'Income rows only. levy = raised on participation quota, in every reading of "contribution". metered_recovery = billed on a meter, a contribution only on the broad reading. non_contribution = never a contribution (interest).';
comment on column public.budget_lines.is_common_property_rm is
  'Expenditure rows only. Marks repairs and maintenance to common property budgeted out of the administrative fund — the Regulation 2 tier 2 minimum.';

-- One-off backfill of the four FY 2026/2027 income rows and the R&M line.
-- Matching by label is acceptable HERE, once, against a known set of rows; it
-- is not acceptable in the report, which is why the class is now a column.
update public.budget_lines
   set contribution_class = case
     when label ilike '%levy grid%'   then 'levy'
     when label ilike '%metered%'     then 'metered_recovery'
     when label ilike '%interest%'    then 'non_contribution'
   end
 where section = 'income' and contribution_class is null;

update public.budget_lines
   set is_common_property_rm = true
 where section = 'expenditure' and label ilike '%repairs%maintenance%';

-- Option A2: report the floor on all budgeted owner contributions, and put
-- R 70 000.00 to the meeting as the opening designation.
update public.agm_report_settings
   set reserve_contribution_basis = 'all_contributions',
       reserve_proposed_designation = 70000.00,
       updated_at = now()
 where financial_year = '2025/2026';
