-- levy_item_definitions: the levy grid's line items, per financial year.
-- 11 August 2026.
--
-- Why: the nine levy lines were a hardcoded array in App.jsx (`LEVY_ITEMS`),
-- so adding or removing one meant a code change and a deploy. The trustee
-- needs to do it from the app.
--
-- Storage already supported it — levy_manual_entries is keyed by
-- (unit_id, financial_year, item_label) and get_unit_statement aggregates
-- whatever labels exist. The array was the only thing fixing the list, and it
-- was doing real damage beyond being inflexible: two places total the levy by
-- iterating it (App.jsx statement builder and useAllocation), so any row in
-- levy_manual_entries whose label wasn't in the array was SILENTLY DROPPED
-- from the unit's total. A line item added directly in the database would
-- have billed nothing and said nothing.
--
-- Keyed by financial year, like levy_rates and levy_manual_entries. That is
-- what makes "the change applies going forward" true by construction: last
-- year's rows are a different set of rows, so a statement reprinted for a past
-- FY rebuilds on that year's item list and cannot be reshaped by this year's
-- decision. A new FY with no rows carries the previous year's list forward as
-- a starting point, exactly as the grid and the common property standards do,
-- and writes nothing until the trustee saves.
--
-- active vs deleting the row: removing a line hides it from the grid, the
-- statements and the billing total, but the row and its captured amounts stay.
-- The AGM pack reports on a year that has closed and must still show what was
-- actually levied in it, so the figures cannot be thrown away — and a removal
-- made in error is undone by re-adding, with the history intact.
--
-- system_key is null for a trustee-created line and set for the nine the app
-- knows how to calculate. Code that needs a specific line — the "fill grid"
-- suggestions, and the Common Property Water figure the water projection reads
-- — resolves it through this column rather than matching on display text, so
-- the label is free to change and a missing line degrades to "no suggestion"
-- instead of a wrong number.

create table if not exists public.levy_item_definitions (
  id uuid primary key default gen_random_uuid(),
  financial_year text not null,
  label text not null,
  system_key text,
  sort_order numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (financial_year, label)
);

create index if not exists levy_item_definitions_fy_idx
  on public.levy_item_definitions (financial_year);

-- One system_key at most per year. Two lines both claiming to be the common
-- property water line would make the water projection's lookup ambiguous.
create unique index if not exists levy_item_definitions_fy_system_key_idx
  on public.levy_item_definitions (financial_year, system_key)
  where system_key is not null;

alter table public.levy_item_definitions enable row level security;

-- Trustee-only for writes and the grid. Residents reach their own levy lines
-- through get_unit_statement, which is security definer and returns the labels
-- with the amounts, so they need no direct read path here.
drop policy if exists levy_item_definitions_trustee on public.levy_item_definitions;
create policy levy_item_definitions_trustee on public.levy_item_definitions
  for all to authenticated using (public.is_trustee()) with check (public.is_trustee());

-- ---------------------------------------------------------------------------
-- Seed: the nine built-ins, in statement order, for every financial year that
-- already has captured figures. Order is the array's order, not alphabetical —
-- it is the order the lines have always printed in on statements and in the
-- AGM pack, and changing it would change every document.
-- ---------------------------------------------------------------------------
insert into public.levy_item_definitions (financial_year, label, system_key, sort_order)
select fy.financial_year, d.label, d.system_key, d.sort_order
from (select distinct financial_year from public.levy_manual_entries) fy
cross join (values
  ('Insurance',                    'insurance',                    1),
  ('Blockwatch',                   'blockwatch',                   2),
  ('Garden Service',               'garden_service',               3),
  ('Common Property Water',        'common_property_water',        4),
  ('Water Demand Levy',            'water_demand_levy',            5),
  ('Sewerage',                     'sewerage',                     6),
  ('Common Property Electricity',  'common_property_electricity',  7),
  ('Electricity Service Charge',   'electricity_service_charge',   8),
  ('Electricity Network Charge',   'electricity_network_charge',   9)
) as d(label, system_key, sort_order)
on conflict (financial_year, label) do nothing;

-- ---------------------------------------------------------------------------
-- levy_manual_entries_item_label_from_definitions
-- ---------------------------------------------------------------------------
-- The nine labels were frozen in a CHECK constraint here as well, which would
-- have rejected every trustee-created line — found by test, not by reading.
-- Replaced with a foreign key onto the definitions table: still constrained,
-- but to the list the trustee maintains rather than one baked into the schema.
--
-- ON UPDATE CASCADE so renaming a line carries its captured figures with it
-- instead of orphaning them. Deliberately no ON DELETE CASCADE — a definition
-- is deactivated, never deleted, and RESTRICT means an accidental hard delete
-- fails loudly rather than silently taking a year of levies with it.
--
-- Consequence for the app: writeLevyItemDefsForActiveFY has to upsert. A
-- delete-then-insert would be rejected by RESTRICT the moment any figures had
-- been captured for the year, which is always, after the first save.
alter table public.levy_manual_entries
  drop constraint if exists levy_manual_entries_item_label_check;

alter table public.levy_manual_entries
  drop constraint if exists levy_manual_entries_item_label_fkey;

alter table public.levy_manual_entries
  add constraint levy_manual_entries_item_label_fkey
  foreign key (financial_year, item_label)
  references public.levy_item_definitions (financial_year, label)
  on update cascade on delete restrict;

-- ---------------------------------------------------------------------------
-- get_unit_statement_respects_levy_item_definitions
-- ---------------------------------------------------------------------------
-- Applied via the Supabase MCP; the function body is not repeated here. Two
-- changes, both necessary once a line can be removed:
--
--   1. levyItems excludes rows whose definition is inactive. The aggregate was
--      unfiltered, so keeping a removed line's figures for the AGM pack would
--      have carried on billing the resident for it.
--   2. A new levyItemOrder key returns the active labels in order. The client
--      held that list in source (LEVY_ITEMS), which the resident portal never
--      replaces from the database — so any line not in the source default was
--      dropped from the resident's total in silence.
