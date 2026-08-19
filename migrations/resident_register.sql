-- Resident register: owners, their contact details, and dated tenancies.
-- 12 August 2026.
--
-- Mirror of migrations applied via the Supabase MCP:
--   resident_register_tables
--   resident_register_policies_and_rpc
--
-- Why: the scheme has never held a way to reach the people in it. `units` has
-- one `owner_name` and one `email` per unit, and both are doing a different job
-- from the one this register needs.
--
-- ---------------------------------------------------------------------------
-- WHAT units.owner_name IS, AND WHY IT IS NOT TOUCHED
-- ---------------------------------------------------------------------------
-- `units.owner_name` holds "DM & AJ Stanley", "I.A. and L Jacobs", and
-- "Manie Jooste Family Trust". Those are not badly-modelled people lists. They
-- are the BILLING NAME — the label printed on the levy statement, on the
-- remittance advice and in the AGM pack, and for Unit 2 it is a juristic person
-- that has no first name and no surname at all.
--
-- So owner_name stays exactly as it is and nothing that bills or prints
-- changes. This register sits ALONGSIDE it and answers a different question:
-- who do I phone. A unit's owner_name and its list of registered owners are
-- expected to look similar and are allowed to differ; where they do, the
-- register screen says so rather than silently reconciling them, because a
-- trust with two trustees is a real case and not a data error.
--
-- `units.email` is likewise left alone. It is NOT NULL, nothing in the app
-- reads it, and it is one address per unit — it is the levy-statement
-- destination, not a contact list.

-- ---------------------------------------------------------------------------
-- 1. Owners
-- ---------------------------------------------------------------------------
-- Name and surname are separate because the ask was for both, and because
-- sorting and addressing a person need the surname on its own. `is_entity`
-- exists for the trust: for a juristic owner the surname carries the
-- registered name and first_name is null, which is why first_name is nullable
-- and surname is not.
--
-- One cell and one email per person, plus a free `alternate_contact` — a
-- second table for a resident's second phone number is more structure than a
-- seven-unit scheme will ever keep current, and an unkept field is worse than
-- no field.
create table if not exists unit_owners (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  first_name text,
  surname text not null,
  is_entity boolean not null default false,
  cell text,
  email text,
  alternate_contact text,
  is_primary boolean not null default false,
  postal_address text,
  id_number text,
  notes text,
  needs_review boolean not null default false,   -- set by the seed below
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_owners_entity_chk check (not is_entity or first_name is null),
  constraint unit_owners_surname_chk check (length(btrim(surname)) > 0)
);
create index if not exists unit_owners_unit_idx on unit_owners (unit_id, sort_order);

-- At most one primary contact per unit, and only among ACTIVE owners — a
-- partial unique index rather than a trigger, so it cannot be got round by a
-- direct API write. "Primary" is who gets phoned first; it carries no billing
-- meaning, which stays with units.owner_name and units.email.
create unique index if not exists unit_owners_one_primary
  on unit_owners (unit_id) where (is_primary and active);

-- ---------------------------------------------------------------------------
-- 2. Tenancies
-- ---------------------------------------------------------------------------
-- DATED, not a set of fields on the unit. The question that actually gets asked
-- is "who was in Unit 4 last March" — when a water reading spikes, when a levy
-- goes unpaid, when something was damaged. Overwriting the tenant's details on
-- change answers none of those, and loses the previous occupant the moment
-- someone types over them.
--
-- The CURRENT tenancy is the one with no ended_on. Everything else is history
-- and is shown as such.
create table if not exists unit_tenancies (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  first_name text,
  surname text not null,
  cell text,
  email text,
  alternate_contact text,
  occupants integer,
  started_on date not null,
  ended_on date,
  lease_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_tenancies_surname_chk check (length(btrim(surname)) > 0),
  constraint unit_tenancies_dates_chk check (ended_on is null or ended_on >= started_on),
  constraint unit_tenancies_occupants_chk check (occupants is null or occupants > 0)
);
create index if not exists unit_tenancies_unit_idx on unit_tenancies (unit_id, started_on desc);

-- One OPEN tenancy per unit. A second open row would make "is this unit let,
-- and to whom" ambiguous, and that is the whole question the table exists to
-- answer. Closing a tenancy is what makes room for the next one, which is also
-- what forces the end date to be recorded rather than skipped.
create unique index if not exists unit_tenancies_one_open
  on unit_tenancies (unit_id) where (ended_on is null);

-- Overlapping CLOSED tenancies are deliberately NOT blocked. An exclusion
-- constraint would need btree_gist, and a week's overlap while one tenant moves
-- out and the next moves in is a real thing that happens. The screen flags an
-- overlap; it does not refuse it.

-- ---------------------------------------------------------------------------
-- 3. RLS — all trustees read, finance writes
-- ---------------------------------------------------------------------------
-- The same shape as the 25 tables session 15 put on can_write_finance(). Read
-- stays open to every trustee on purpose: the maintenance trustee has to be
-- able to phone a resident about a geyser without being able to rewrite the
-- register, and the approver should be able to see who they are approving
-- figures for. Separation of DUTIES, not of visibility — as everywhere else.
alter table unit_owners enable row level security;
alter table unit_tenancies enable row level security;

drop policy if exists unit_owners_read on unit_owners;
drop policy if exists unit_owners_write on unit_owners;
create policy unit_owners_read on unit_owners for select using (public.is_trustee());
create policy unit_owners_write on unit_owners for all
  using (public.can_write_finance()) with check (public.can_write_finance());

drop policy if exists unit_tenancies_read on unit_tenancies;
drop policy if exists unit_tenancies_write on unit_tenancies;
create policy unit_tenancies_read on unit_tenancies for select using (public.is_trustee());
create policy unit_tenancies_write on unit_tenancies for all
  using (public.can_write_finance()) with check (public.can_write_finance());

-- ---------------------------------------------------------------------------
-- 4. The resident's own view, through the existing token
-- ---------------------------------------------------------------------------
-- READ ONLY, deliberately. `submit_remittance` stays the only thing the anon
-- role can write. A contact register that anyone holding a leaked unit link can
-- rewrite is worth less than one only the trustee changes — and the address
-- levy notices go to is exactly what an attacker would want to change.
--
-- Scoped to the one unit the token resolves to, like every other token RPC.
-- id_number and postal_address are NOT returned: the resident already knows
-- them, and a share-style link should carry the least it can.
create or replace function public.get_unit_contacts(p_token uuid)
returns table (
  kind text, first_name text, surname text, is_entity boolean,
  cell text, email text, alternate_contact text, is_primary boolean,
  started_on date, occupants integer
)
language sql stable security definer set search_path to 'public' as $$
  select 'owner'::text, o.first_name, o.surname, o.is_entity,
         o.cell, o.email, o.alternate_contact, o.is_primary,
         null::date, null::integer
  from public.unit_owners o
  join public.units u on u.id = o.unit_id
  where u.access_token = p_token and o.active
  union all
  select 'tenant'::text, t.first_name, t.surname, false,
         t.cell, t.email, t.alternate_contact, false,
         t.started_on, t.occupants
  from public.unit_tenancies t
  join public.units u on u.id = t.unit_id
  where u.access_token = p_token and t.ended_on is null
  order by 1 desc, 8 desc nulls last, 3;
$$;

revoke all on function public.get_unit_contacts(uuid) from public;
grant execute on function public.get_unit_contacts(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seed the owners from what is already known
-- ---------------------------------------------------------------------------
-- units.owner_name and units.email are the only owner facts the scheme holds,
-- so each unit starts with ONE owner row carrying them, marked primary. The
-- names are NOT split into first name and surname by parsing — "DM & AJ
-- Stanley" is two people and "I.A. and L Jacobs" is two more, and a parser that
-- guessed would produce records indistinguishable from real ones in six months.
-- The whole string goes in `surname` with `needs_review` set, and the screen
-- lists every unit still carrying one until Devon has split them by hand.
--
-- This is the session-11 rule applied again: seed the checklist, invent nothing.
insert into unit_owners (unit_id, surname, email, is_primary, needs_review, sort_order, notes)
select u.id, u.owner_name, u.email, true, true, 0,
       'Seeded from units.owner_name on 12 August 2026. Split into first name and surname, and add the second owner where there is one.'
from public.units u
where not exists (select 1 from unit_owners o where o.unit_id = u.id);
