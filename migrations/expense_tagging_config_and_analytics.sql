-- ============================================================
-- Expense tagging, Config module and Analytics dashboard
-- Applied to project ctqyxxlnnrgtyyxubsle on 4 August 2026.
-- Kept here for the record — these are already live.
--
-- Model: bank_transactions is the cash-basis source of truth for anything that
-- moved through the account. Approved resident deductions cover Body Corp
-- expenses a resident paid personally. ops_expenses covers whatever is in
-- neither, and rows duplicating the other two are flagged, not deleted.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tagging columns + non-destructive duplicate flagging
-- ------------------------------------------------------------
alter table public.additional_charges add column if not exists expense_category text;
alter table public.ops_expenses      add column if not exists superseded_reason text;

comment on column public.ops_expenses.superseded_reason is
  'Non-null when this row duplicates a bank_transactions line or an approved resident deduction. Excluded from analytics totals; kept for audit.';

-- Legacy hard-coded labels -> the expense_categories vocabulary.
update public.ops_expenses set category = 'Garden Service' where category = 'Garden Service (actual cost)';
update public.ops_expenses set category = 'BlockWatch'     where category in ('Blockwatch (actual cost)', 'Blockwatch');
update public.ops_expenses set category = 'CSOS'           where category = 'CSOS Levy';

-- Rows duplicating a bank debit (same date and amount).
update public.ops_expenses o
   set superseded_reason = 'Duplicate of a bank statement line'
 where o.superseded_reason is null
   and exists (
     select 1 from public.bank_transactions b
      where b.direction = 'debit' and b.txn_date = o.expense_date and b.amount = o.amount
   );

-- Rows duplicating an approved resident deduction in the same month.
update public.ops_expenses o
   set superseded_reason = 'Duplicate of an approved resident deduction'
 where o.superseded_reason is null
   and exists (
     select 1
       from public.remittance_advices r, lateral jsonb_array_elements(r.deductions) e
      where r.deduction_approved
        and jsonb_typeof(r.deductions) = 'array'
        and date_trunc('month', o.expense_date)::date = r.period
        and (e->>'amount')::numeric = o.amount
   );

-- ------------------------------------------------------------
-- 2. Rename cascade — now covers additional_charges too
-- ------------------------------------------------------------
create or replace function public.rename_expense_category(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update bank_transactions  set expense_category = new_name where expense_category = old_name;
  update ops_expenses       set category         = new_name where category         = old_name;
  update additional_charges set expense_category = new_name where expense_category = old_name;
  update remittance_advices ra set deductions = (
    select jsonb_agg(case when elem->>'expenseCategory' = old_name
                          then jsonb_set(elem, '{expenseCategory}', to_jsonb(new_name))
                          else elem end)
    from jsonb_array_elements(ra.deductions) elem
  ) where jsonb_typeof(ra.deductions) = 'array'
      and exists (select 1 from jsonb_array_elements(ra.deductions) e where e->>'expenseCategory' = old_name);
  update expense_categories set name = new_name where name = old_name;
end; $function$;

revoke execute on function public.rename_expense_category(text, text) from public, anon;
grant  execute on function public.rename_expense_category(text, text) to authenticated;

-- ------------------------------------------------------------
-- 3. Usage count + guarded delete (Config module)
-- ------------------------------------------------------------
create or replace function public.expense_category_usage()
returns table (name text, usage_count bigint)
language sql
security definer
set search_path to 'public'
as $$
  with used as (
    select expense_category as n from bank_transactions   where expense_category is not null
    union all
    select category                from ops_expenses       where category is not null
    union all
    select expense_category        from additional_charges where expense_category is not null
    union all
    select e->>'expenseCategory'
      from remittance_advices r, lateral jsonb_array_elements(r.deductions) e
     where jsonb_typeof(r.deductions) = 'array' and e->>'expenseCategory' is not null
  )
  select c.name, count(u.n)
    from expense_categories c
    left join used u on u.n = c.name
   group by c.name;
$$;

create or replace function public.delete_expense_category(cat_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare n bigint;
begin
  select usage_count into n from public.expense_category_usage() u where u.name = cat_name;
  if coalesce(n, 0) > 0 then
    raise exception 'Cannot delete "%" — % record(s) still use it. Deactivate it instead.', cat_name, n;
  end if;
  delete from expense_categories where name = cat_name;
end; $$;

revoke execute on function public.expense_category_usage()      from public, anon;
revoke execute on function public.delete_expense_category(text) from public, anon;
grant  execute on function public.expense_category_usage()      to authenticated;
grant  execute on function public.delete_expense_category(text) to authenticated;

-- ------------------------------------------------------------
-- 4. Category list readable by residents (deduction tagging)
--    expense_categories is trustee-only under RLS; category names are not
--    sensitive, so expose ONLY active names. No ids, no write path.
-- ------------------------------------------------------------
create or replace function public.get_expense_categories()
returns table (name text, sort_order integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.name, c.sort_order
    from expense_categories c
   where c.active
   order by c.sort_order, c.name;
$$;

grant execute on function public.get_expense_categories() to anon, authenticated;
