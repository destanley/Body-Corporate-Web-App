-- Ownership changes (pro-rata statements on transfer), 7 August 2026.
--
-- When a unit sells mid-month both owners need a statement for that month, and
-- the app could only ever hold one statement per unit per period. The split was
-- being done by hand outside the system.
--
-- Two different rules apply, and conflating them is the usual mistake:
--   * Metered water and electricity are NOT pro-rated. A reading is taken on
--     the changeover date and each owner is billed their actual consumption.
--     That is the whole point of taking the reading.
--   * The fixed levy lines ARE pro-rated, by days of the month.
--
-- One row per unit per statement month. The row's existence is what makes the
-- statement screen render two statements instead of one, so removing it puts
-- the month back to normal.

create table if not exists public.ownership_changes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  -- First of the statement month, matching monthly_usage.period.
  period date not null,
  -- The last day the OUTGOING owner is liable for, inclusive. 2026-08-06 means
  -- the seller carries 1-6 August (6 days) and the buyer 7-31 August (25).
  changeover_date date not null,
  -- Meter readings taken on the changeover date. Closing for the outgoing
  -- owner, opening for the incoming one — one number, so the two statements
  -- cannot disagree about where one ends and the other begins.
  water_reading numeric,
  electricity_reading numeric,
  outgoing_owner text,
  incoming_owner text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, period)
);

create index if not exists ownership_changes_period_idx on public.ownership_changes (period);

alter table public.ownership_changes enable row level security;

-- Trustee-only, matching every other table in the schema.
drop policy if exists ownership_changes_trustee on public.ownership_changes;
create policy ownership_changes_trustee on public.ownership_changes
  for all to authenticated using (public.is_trustee()) with check (public.is_trustee());

-- ---------------------------------------------------------------------------
-- Seed: Unit 4, August 2026. Sold with transfer on 6 August 2026.
-- ---------------------------------------------------------------------------
-- Readings taken on the changeover date: water 5165 kL, electricity 134763.3 kWh.
-- Against a 31 July opening of 5164.56 / 134744.00 that gives the outgoing
-- owner 0.44 kL and 19.3 kWh.
insert into public.ownership_changes
  (unit_id, period, changeover_date, water_reading, electricity_reading, note)
select u.id, '2026-08-01', '2026-08-06', 5165, 134763.3,
       'Transfer on 6 August 2026. Readings taken on the day.'
from public.units u where u.unit_number = 4
on conflict (unit_id, period) do update set
  changeover_date = excluded.changeover_date,
  water_reading = excluded.water_reading,
  electricity_reading = excluded.electricity_reading,
  note = excluded.note,
  updated_at = now();
