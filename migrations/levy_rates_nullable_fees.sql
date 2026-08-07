-- levy_rates: allow the AGM-approved fee columns to be null, 7 August 2026.
--
-- Why: the three fee columns were NOT NULL, so creating the row for a new
-- financial year — which happens the moment the common property standards are
-- saved for that year — had to put SOMETHING in them, and that something was 0.
-- Zero is not "not yet captured": it is a figure, and the AGM report printed it
-- as R 0,00 in the "New — FY" column, which reads as "the scheme has decided
-- this charge is nil" rather than "nobody has set it yet".
--
-- This bit within an hour of the standards being made editable: saving the
-- FY 2026/2027 standards created a row of zeros and the report started showing
-- R 0,00 for the electricity service and network charges.
--
-- Null now means "not captured", and the report renders those cells blank for
-- completion in Word, which is how every other uncaptured figure behaves.

alter table public.levy_rates
  alter column water_demand_levy drop not null,
  alter column electricity_service_fee drop not null,
  alter column electricity_network_fee drop not null;

-- Correct the row created at 11:50 on 7 August 2026 when the FY 2026/2027
-- common property standards were saved. The standards themselves (20 kL and
-- 300 kWh) were deliberately entered and are kept; only the three fees, which
-- were never entered by anyone, go back to null.
update public.levy_rates
   set water_demand_levy = null,
       electricity_service_fee = null,
       electricity_network_fee = null,
       updated_at = now()
 where financial_year = '2026/2027'
   and coalesce(water_demand_levy, 0) = 0
   and coalesce(electricity_service_fee, 0) = 0
   and coalesce(electricity_network_fee, 0) = 0;
