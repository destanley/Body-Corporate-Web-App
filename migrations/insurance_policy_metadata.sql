-- Insurance page: policy-level metadata, 7 August 2026 (session 4).
--
-- Why: the per-unit schedule (insurance_schedule) had nowhere to record the
-- policy it was derived from, so nothing could check the seven allocated
-- amounts still add up to what the insurer actually charges. Rounding seven
-- ways lands a few cents off the policy total by design; a few RAND off means
-- an item on the schedule was missed. Storing the policy total is what makes
-- that difference visible instead of invisible.
--
-- Kept on agm_report_settings rather than a new table: it is already one row
-- per financial year, which is exactly the grain of an annual policy renewal.
-- Additive only — nothing existing is altered.

alter table public.agm_report_settings
  add column if not exists insurance_policy_number text,
  add column if not exists insurance_insurer text,
  -- Free text, not a date: the schedule prints "01 September 2025" and the
  -- broker's format is not ours to depend on. It is displayed, never computed
  -- with — the financial year the row is keyed by is what drives everything.
  add column if not exists insurance_cover_start text,
  add column if not exists insurance_policy_total numeric;

-- ---------------------------------------------------------------------------
-- Seed: FY 2026/2027, from GWK-REN-ELCOR00006 - Renewal(1) ("2026 Renewal.pdf").
-- ---------------------------------------------------------------------------
-- Allocation, per the trustee's rules confirmed 7 August 2026:
--   Premium   = the unit's own item premium, plus an equal share of the R3,600
--               geyser item across the four units whose schedule carries
--               "Geysers - Cover as Defined: Yes" (units 2, 4, 5 and 6 —
--               R900.00 each), folded into premium.
--   Com prop  = R471.68 (item 8: wall, electric fence, paving, gate and motor,
--               2 distribution boxes) / 7 = R67.38.
--   Sasria    = R740.44 / 7 = R105.78.
--   Broker    = R233.91 / 7 = R33.42.
-- Allocated total R24,365.19 against a policy total of R24,365.16 — the R0.03
-- is rounding each unit to the cent, which is how the insurer's own schedule
-- adds up.

with s(no, sum_insured, premium) as (values
  (1, 1854576.00, 2206.95),   -- no geyser cover
  (2, 2756826.00, 4180.62),   -- 3280.62 + 900.00 geyser
  (3, 2464344.00, 2932.57),   -- no geyser cover
  (4, 2160000.00, 3470.40),   -- 2570.40 + 900.00 geyser
  (5, 2038498.00, 3325.81),   -- 2425.81 + 900.00 geyser
  (6, 2466896.00, 3835.61),   -- 2935.61 + 900.00 geyser
  (7, 2493420.00, 2967.17))   -- no geyser cover
insert into public.insurance_schedule
  (financial_year, unit_id, sum_insured, premium, common_property, sasria, broker_fee)
select '2026/2027', u.id, s.sum_insured, s.premium, 67.38, 105.78, 33.42
from s join public.units u on u.unit_number = s.no
on conflict (financial_year, unit_id) do update set
  sum_insured = excluded.sum_insured, premium = excluded.premium,
  common_property = excluded.common_property, sasria = excluded.sasria,
  broker_fee = excluded.broker_fee, updated_at = now();

insert into public.agm_report_settings
  (financial_year, insurance_policy_number, insurance_insurer,
   insurance_cover_start, insurance_policy_total)
values ('2026/2027', 'GWK-REN-ELCOR00006 - Renewal(1)',
        'Renasa Insurance Company Limited', '01 September 2025', 24365.16)
on conflict (financial_year) do update set
  insurance_policy_number = excluded.insurance_policy_number,
  insurance_insurer = excluded.insurance_insurer,
  insurance_cover_start = excluded.insurance_cover_start,
  insurance_policy_total = excluded.insurance_policy_total,
  updated_at = now();

-- Backfill the policy total for FY 2025/2026 so its tie-out renders too. The
-- schedule seeded for that year used R67.39 for common property where the
-- arithmetic gives R67.38, so it ties out R0.10 rather than R0.03 — visible
-- now, which is the point.
update public.agm_report_settings
   set insurance_policy_total = coalesce(insurance_policy_total, 24365.16),
       updated_at = now()
 where financial_year = '2025/2026';
