-- Maintenance plan approval, and the removal lock it creates. 12 August 2026.
--
-- Mirror of migrations applied via the Supabase MCP:
--   maintenance_plan_approval_subject
--   assets_removal_lock_when_plan_approved
--   assets_removal_lock_rule_simplified
--
-- Why: the component register is completed by walking the property and typing
-- the results into a spreadsheet, which is then uploaded — and on upload THE
-- FILE IS THE SOURCE OF TRUTH, so a row missing from the sheet removes the
-- component. That is right exactly once, while the register is being built for
-- the first time. Once the meeting has approved the plan, the ten-year schedule
-- and the statutory provision rest on a specific set of components, and one
-- going missing from a spreadsheet must not quietly take a provision with it.
--
-- So: approved -> components can be ADDED, never removed.

-- ---------------------------------------------------------------------------
-- 1. 'maintenance_plan' becomes an approval subject
-- ---------------------------------------------------------------------------
-- Scope is the financial year, like levy_breakdown and insurance: a plan is
-- adopted for a year, not for a month.
--
-- It deliberately does NOT gate statement release. The app keeps that
-- distinction in STATEMENT_GATE_SUBJECTS; recorded here because the table gives
-- no hint of it, and someone reading only the schema would reasonably assume
-- every subject blocks statements. Holding every owner's levy statement on a
-- property survey would be the wrong trade entirely.

alter table public.approvals drop constraint if exists approvals_subject_check;
alter table public.approvals add constraint approvals_subject_check
  check (subject in ('levy_breakdown', 'insurance', 'meter_readings',
                     'statements', 'maintenance_plan'));

-- ---------------------------------------------------------------------------
-- 2. The removal lock
-- ---------------------------------------------------------------------------
-- In the database, not in the UI. The maintenance trustee has write access to
-- assets by policy and could otherwise deactivate a component straight through
-- the API; the button on the register only mirrors this rule so it can explain
-- itself before it is pressed. If the two ever disagree, this wins.

-- THE RULE IS "ANY YEAR APPROVED", AND THAT IS DELIBERATE.
--
-- The first attempt derived today's financial year in SQL and locked only on an
-- approval for that year. It looked more precise and was worse: the app's
-- FY_ACTIVE follows the SELECTED STATEMENT MONTH, and CURRENT_PERIOD is bumped
-- by hand each month, so on 12 August 2026 the app was still on 2025/2026 while
-- SQL said 2026/2027. The lock would have been enforced for a year nobody was
-- working in — the grid refusing a removal the database would have allowed
-- straight through the API.
--
-- So both sides now ask the same question, and it is one neither can get wrong:
-- does ANY maintenance_plan approval row exist? Withdrawing an approval deletes
-- its row — which is how every approval in this schema already works, "approved
-- is simply the presence of a record" — so the unlock path is the same tick-box
-- that locked it. Zero drift between App.jsx and this file, at the cost of a
-- rule that is blunter than it looks precise.
create or replace function public.maintenance_plan_is_approved()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.approvals where subject = 'maintenance_plan');
$$;

-- Named in the error so the message says which meeting's decision is in the way.
create or replace function public.maintenance_plan_approved_years()
returns text language sql stable security definer set search_path to 'public' as $$
  select string_agg(scope, ', ' order by scope)
  from public.approvals where subject = 'maintenance_plan';
$$;

create or replace function public.assets_block_removal_when_plan_approved()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.maintenance_plan_is_approved() then
    raise exception
      'The maintenance plan is approved (FY %), so "%" cannot be removed from the register. Components can be added; to remove one, the approving trustee must first withdraw the approval.',
      public.maintenance_plan_approved_years(), old.name
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Both routes out of the register are covered. Deletion is the obvious one;
-- deactivation is the one the spreadsheet import actually uses, and a guard
-- that only watched DELETE would have been decorative.
drop trigger if exists assets_block_delete_when_plan_approved on public.assets;
create trigger assets_block_delete_when_plan_approved
  before delete on public.assets
  for each row execute function public.assets_block_removal_when_plan_approved();

drop trigger if exists assets_block_deactivate_when_plan_approved on public.assets;
create trigger assets_block_deactivate_when_plan_approved
  before update on public.assets
  for each row when (old.active and not new.active)
  execute function public.assets_block_removal_when_plan_approved();

-- Note on what is NOT locked: an approved plan still allows a component's
-- figures to be edited. The lock is on the SET of components the plan is built
-- from, because that is what an upload can silently change. Correcting a
-- replacement cost after the meeting is ordinary maintenance of the register
-- and is visible in the plan the next time it is read.
