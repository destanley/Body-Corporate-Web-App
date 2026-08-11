-- agm_report_settings: the "New — FY" column for the three bill-driven utility
-- charges, 11 August 2026.
--
-- Why: section 9 of the AGM report has three rows whose New column could never
-- be filled by anybody —
--
--   Water Demand Levy (per unit / month) excl VAT
--   Electricity Service Charge (complex, excl VAT)
--   Electricity Network Charge (complex, excl VAT)
--
-- The report reads them from levy_rates for the following financial year, but
-- nothing writes to those columns any more: Tariffs & rates dropped the three
-- inputs when the charges moved to the invoice-driven model, and levy_rates
-- rows for a new year are created by saving the common property standards,
-- which leaves the fee columns null (correctly — see
-- levy_rates_nullable_fees.sql, where null was chosen over a misleading 0).
--
-- So the cells were a permanent blank, for exactly the reason sewerage was
-- before agm_report_settings_sewerage_new: next year's figure is a proposal the
-- meeting votes on, not something the council has published or the invoice can
-- supply. Same problem, same shape of fix.
--
-- Note the demand levy in particular is NOT substitutable from the invoice:
-- FY 2025/2026's approved figure is R124.00 against a council charge of
-- R65.08–R107.74. The two electricity fees happen to match the bill; the demand
-- levy does not.
--
-- These live on the row for the year the report COVERS, holding the figure
-- proposed for the year after — the same convention as sewerage_per_unit_new,
-- garden_proposed_rate_per_day and blockwatch_monthly_proposed. Additive only.

alter table public.agm_report_settings
  add column if not exists water_demand_levy_new      numeric,
  add column if not exists electricity_service_fee_new numeric,
  add column if not exists electricity_network_fee_new numeric;
