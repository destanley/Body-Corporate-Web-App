-- ============================================================
-- Migration: water rate-card reconciliation factor
-- Applied via the Supabase MCP, 11 August 2026.
--
-- The factor the AGM approves for the year ahead. Multiply CoJ's published
-- step rates by it to get the rate card owners are billed on:
--     card rate = CoJ step rate x factor
--
-- Worked out once a year from data already captured:
--   numerator   - the twelve council consumption charges, ex VAT
--                 (council_invoices.bulk_water_rand)
--   denominator - the same twelve months of unit readings priced on CoJ's
--                 NOMINAL step rates, capped at the highest step any invoice
--                 reached that year
-- FY 2025/2026: 14 165.50 / 14 844.40 = 0.9543
--
-- Lives on agm_report_settings rather than a new table because it is set at
-- the AGM, alongside the other figures that meeting approves, and the Config
-- page already edits this row. NOT effective-dated - trustee's decision. Safe
-- only while nothing bills on it; see the note in App.jsx AGM_FIELDS.
-- ============================================================

alter table agm_report_settings
  add column if not exists water_reconciliation_factor numeric;

comment on column agm_report_settings.water_reconciliation_factor is
  'Water rate-card reconciliation factor approved at the AGM for the year AHEAD. Multiply CoJ step rates by this to get the card. Not effective-dated - see App.jsx AGM_FIELDS.';
