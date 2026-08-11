-- Trustee roles, approvals, and role-scoped RLS. 11 August 2026.
--
-- Mirror of migrations applied via the Supabase MCP:
--   trustee_roles
--   approvals_table
--   role_scoped_write_policies
--
-- Why: a second trustee approving the first one's figures is only a control if
-- the approver cannot also edit them. Until now is_trustee() was a flat yes/no
-- and every table carried one FOR ALL policy built on it, so any trustee could
-- write anything and an approval would have been a note rather than a check.
--
-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------
--   finance      — Devon. Everything, as today. It is the DEFAULT, so existing
--                  rows and any trustee added later without a role keep
--                  working rather than silently losing access.
--   approver     — reads everything, writes ONLY approvals.
--   maintenance  — reads everything, writes ONLY the component register, its
--                  inspections, and plan snapshots.
--
-- Read stays open to every trustee on purpose: an approver who cannot see the
-- levy grid cannot meaningfully approve it, and the maintenance trustee needs
-- the financial context around the reserve. The separation being enforced is
-- of *duties*, not of visibility — this is a seven-unit scheme, not a bank.

alter table public.trustees
  add column if not exists role text not null default 'finance';

alter table public.trustees drop constraint if exists trustees_role_check;
alter table public.trustees add constraint trustees_role_check
  check (role in ('finance', 'approver', 'maintenance'));

create or replace function public.trustee_role()
returns text language sql stable security definer set search_path to 'public' as $$
  select t.role from public.trustees t where t.user_id = auth.uid();
$$;

create or replace function public.can_write_finance()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.trustee_role() = 'finance', false);
$$;

-- Finance keeps the right to approve so a single-trustee scheme is not locked
-- out of releasing its own statements.
create or replace function public.can_approve()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.trustee_role() in ('finance', 'approver'), false);
$$;

create or replace function public.can_manage_maintenance()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.trustee_role() in ('finance', 'maintenance'), false);
$$;

grant execute on function public.trustee_role() to authenticated;
grant execute on function public.can_write_finance() to authenticated;
grant execute on function public.can_approve() to authenticated;
grant execute on function public.can_manage_maintenance() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Approvals
-- ---------------------------------------------------------------------------
-- `scope` is deliberately not always a month. The levy grid and the insurance
-- schedule are set once a financial year, and a monthly tick-box against them
-- would be theatre — twelve approvals of one unchanged decision. Readings and
-- statements genuinely are monthly. So scope is text and its meaning comes
-- from the subject:
--
--   levy_breakdown  -> financial year, e.g. '2026/2027'
--   insurance       -> financial year
--   meter_readings  -> statement period,  e.g. '2026-07-01'
--   statements      -> statement period
--
-- Withdrawing an approval deletes the row rather than flagging it, so
-- "approved" is simply the presence of a record — no third state to reason
-- about at the moment statements are released.
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (subject in ('levy_breakdown', 'insurance', 'meter_readings', 'statements')),
  scope text not null,
  approved_by uuid not null references auth.users (id) on delete restrict,
  approved_by_email text,
  approved_at timestamptz not null default now(),
  note text,
  unique (subject, scope)
);

create index if not exists approvals_scope_idx on public.approvals (scope);

alter table public.approvals enable row level security;

drop policy if exists approvals_read on public.approvals;
create policy approvals_read on public.approvals
  for select to authenticated using (public.is_trustee());

drop policy if exists approvals_write on public.approvals;
create policy approvals_write on public.approvals
  for all to authenticated
  using (public.can_approve()) with check (public.can_approve());

-- ---------------------------------------------------------------------------
-- 3. Role-scoped write policies on every other table
-- ---------------------------------------------------------------------------
-- Permissive policies are OR'd, so the read policy grants SELECT to every
-- trustee while INSERT/UPDATE/DELETE fall to the write policy alone.
--
-- Written as a loop rather than 28 hand-written pairs so that no table can be
-- silently missed — a missed table would keep its old flat policy and stay
-- writable by everyone, which is the exact failure this migration exists to
-- prevent. It also drops whatever the old policy happened to be called; the
-- names were not applied consistently as the schema grew (trustee_all,
-- assets_trustee, manual_payments_trustee_all, …).
do $$
declare
  t record;
  writer text;
  maintenance_tables text[] := array['assets', 'asset_inspections', 'maintenance_plan_snapshots'];
  old_policy text;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('approvals')
  loop
    if t.relname = any(maintenance_tables) then
      writer := 'public.can_manage_maintenance()';
    else
      writer := 'public.can_write_finance()';
    end if;

    for old_policy in
      select p.polname from pg_policy p
      where p.polrelid = format('public.%I', t.relname)::regclass
        and p.polname not in (t.relname || '_read', t.relname || '_write')
    loop
      execute format('drop policy if exists %I on public.%I', old_policy, t.relname);
    end loop;

    execute format('drop policy if exists %I on public.%I', t.relname || '_read', t.relname);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_trustee())',
      t.relname || '_read', t.relname);

    execute format('drop policy if exists %I on public.%I', t.relname || '_write', t.relname);
    execute format(
      'create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
      t.relname || '_write', t.relname, writer, writer);
  end loop;
end $$;

-- Resulting split, verified after applying:
--   can_write_finance()       25 tables
--   can_manage_maintenance()   3 tables (assets, asset_inspections,
--                                        maintenance_plan_snapshots)
--   can_approve()              1 table  (approvals)
--
-- ---------------------------------------------------------------------------
-- 4. A register component cannot be deleted once anything is captured
-- ---------------------------------------------------------------------------
-- Applied as: assets_delete_guard
--
-- Enforced by trigger, not by the UI. The maintenance trustee has write access
-- to assets by policy and could otherwise delete a component through the API,
-- taking its inspection history with it — asset_inspections cascades on
-- delete, so the loss would be silent and total.
--
-- "Captured against it" means any of: an inspection recorded, a reserve fund
-- entry tagged to it, or an assessment (a replacement cost or an expected
-- life). The last matters because an assessed component carries a provision in
-- the ten-year plan, so removing it changes the statutory annual figure. A
-- component added by mistake and never touched has none of the three and
-- deletes cleanly, which is the case the rule has to leave open.
create or replace function public.assets_block_delete_when_captured()
returns trigger language plpgsql as $$
declare
  n_inspections int;
  n_reserve int;
begin
  select count(*) into n_inspections from public.asset_inspections where asset_id = old.id;
  select count(*) into n_reserve from public.reserve_fund_entries where asset_id = old.id;

  if n_inspections > 0 or n_reserve > 0
     or old.replacement_cost is not null or old.expected_life_years is not null then
    raise exception using
      errcode = 'restrict_violation',
      message = format(
        'Component "%s" cannot be removed: %s inspection(s), %s reserve entry(ies), cost %s, life %s. Deactivate it instead.',
        old.name, n_inspections, n_reserve,
        coalesce(old.replacement_cost::text, 'not set'),
        coalesce(old.expected_life_years::text, 'not set'));
  end if;

  return old;
end $$;

drop trigger if exists assets_block_delete_when_captured on public.assets;
create trigger assets_block_delete_when_captured
  before delete on public.assets
  for each row execute function public.assets_block_delete_when_captured();

-- ---------------------------------------------------------------------------
-- 5. Adding the two trustees — MANUAL STEP
-- ---------------------------------------------------------------------------
-- Auth users cannot be created from SQL. In the Supabase dashboard, under
-- Authentication → Users, invite or create each login, then run:
--
--   insert into public.trustees (user_id, email, role)
--   values ('<uuid from the dashboard>', '<their email>', 'approver');
--
--   insert into public.trustees (user_id, email, role)
--   values ('<uuid from the dashboard>', '<their email>', 'maintenance');
--
-- They set their own password from the app once signed in (Config → Your
-- login), or via the password-reset email if you invite rather than set one.
