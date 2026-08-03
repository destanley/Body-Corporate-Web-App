-- Applied 3 August 2026. Already live on Supabase project ctqyxxlnnrgtyyxubsle;
-- kept here so the repo carries the schema history.
--
-- Problem: a resident can pay more than once in a bank month. The July 2026
-- statement had two Cor 6 credits — one settling June, one settling July.
-- reconcileUnits() used .find() (took the first, discarded the rest) and the
-- statement->payment link was hard-coded to bank period - 1 month.

-- 1. Which STATEMENT month a bank line settles.
alter table public.bank_transactions add column if not exists applied_period date;

update public.bank_transactions
set applied_period = (period - interval '1 month')::date
where category = 'resident_payment' and applied_period is null;

create or replace function public.set_bank_txn_applied_period()
returns trigger language plpgsql as $$
begin
  if new.category = 'resident_payment' and new.applied_period is null then
    new.applied_period := (new.period - interval '1 month')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bank_txn_applied_period on public.bank_transactions;
create trigger trg_bank_txn_applied_period
  before insert or update on public.bank_transactions
  for each row execute function public.set_bank_txn_applied_period();

create index if not exists bank_txn_unit_applied_period_idx
  on public.bank_transactions (matched_unit_id, applied_period)
  where category = 'resident_payment';

-- Cor 6's 31 July payment settles the July statement, not June's.
update public.bank_transactions bt
set applied_period = date '2026-07-01'
from public.units u
where u.id = bt.matched_unit_id and u.cor_reference = 'Cor 6'
  and bt.period = date '2026-07-01' and bt.txn_date = date '2026-07-31'
  and bt.amount = 3215.92 and bt.category = 'resident_payment';

-- 2. Provisional payments recorded before the bank statement exists.
--    Dedup is DERIVED, not stored: a manual entry is ignored whenever a real
--    bank_transaction exists for the same (unit, applied_period).
create table if not exists public.manual_payments (
  id             uuid primary key default gen_random_uuid(),
  unit_id        uuid not null references public.units(id) on delete restrict,
  applied_period date not null,
  amount         numeric(10,2) not null check (amount > 0),
  date_paid      date,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  unique (unit_id, applied_period)
);

create index if not exists manual_payments_applied_period_idx
  on public.manual_payments (applied_period);

alter table public.manual_payments enable row level security;
drop policy if exists manual_payments_trustee_all on public.manual_payments;
create policy manual_payments_trustee_all on public.manual_payments
  for all to authenticated
  using (public.is_trustee()) with check (public.is_trustee());

-- 3. get_unit_statement now matches on applied_period and SUMS all lines.
--    Return shape unchanged ({amount, reviewed} plus a new 'lines' key), so
--    computeStatementRow and the PAID stamp need no edit.
