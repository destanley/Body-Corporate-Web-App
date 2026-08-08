-- Editable budget. Applied via the Supabase MCP on 8 August 2026.
--
-- Section 14 of the AGM report PRINTS these rows and never recomputes them.
-- That is deliberate and it is the opposite of sections 3, 10 and 13, which are
-- computed live: those report facts, and a fact should always be current. A
-- budget is a decision, and a decision has to be pinned — what is tabled at the
-- meeting must be what the trustees agreed, not what a formula happened to
-- produce at the moment the document was generated.

create table if not exists budget_lines (
  id uuid primary key default gen_random_uuid(),
  financial_year text not null,
  section text not null,
  label text not null,
  amount numeric not null default 0,
  basis text,
  sort_order integer not null default 0,
  is_assumption boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_section_chk check (section in ('income','expenditure','reserve')),
  constraint budget_line_unique unique (financial_year, section, label)
);
create index if not exists budget_lines_fy_idx on budget_lines (financial_year, section, sort_order);

create table if not exists budget_meta (
  financial_year text primary key,
  opening_cash numeric,
  approved_on date,
  approved_by text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table budget_lines enable row level security;
alter table budget_meta enable row level security;
create policy budget_lines_trustee on budget_lines for all using (public.is_trustee()) with check (public.is_trustee());
create policy budget_meta_trustee on budget_meta for all using (public.is_trustee()) with check (public.is_trustee());

-- FY2026/2027 seeded from docs/budget-FY2026-2027.md: 4 income lines, 10
-- expenditure lines, 1 reserve line. Six carry is_assumption = true and every
-- line carries a basis, because a budget line without a stated basis is a
-- number nobody can challenge or defend.
