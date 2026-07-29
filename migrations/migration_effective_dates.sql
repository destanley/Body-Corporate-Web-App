-- ============================================================
-- Migration: Move water_tariff_bands to effective_from dates
-- (electricity_rates already has effective_from — no schema change needed)
--
-- Municipal rates change every July regardless of the body corp's
-- Aug–Jul financial year. Effective dates decouple rate storage
-- from any FY calendar — each period loads the most recent rate
-- set whose effective_from ≤ the period date.
-- ============================================================

-- 1. Add effective_from column (nullable initially so we can backfill)
ALTER TABLE water_tariff_bands ADD COLUMN IF NOT EXISTS effective_from date;

-- 2. Backfill from the existing financial_year values.
--    "2024/2025" = municipal rates from 1 July 2024
--    "2025/2026" = municipal rates from 1 July 2025
UPDATE water_tariff_bands
SET effective_from = (split_part(financial_year, '/', 1)::int || '-07-01')::date
WHERE effective_from IS NULL;

-- 3. Make it NOT NULL now that all rows have a value
ALTER TABLE water_tariff_bands ALTER COLUMN effective_from SET NOT NULL;

-- 4. Add the new unique constraint (rate lookup key going forward)
ALTER TABLE water_tariff_bands
  ADD CONSTRAINT water_tariff_bands_effective_band
  UNIQUE (effective_from, band_label);

-- 5. Relax the NOT NULL on financial_year — the app no longer uses it
--    as the lookup key; new rows will store null.
ALTER TABLE water_tariff_bands ALTER COLUMN financial_year DROP NOT NULL;

-- Keep the old (financial_year, band_label) constraint intact — no
-- need to drop it; existing rows still satisfy it and removing it
-- mid-flight risks issues. The app will stop querying by financial_year
-- for rate lookups but the column stays for reference.

-- NOTE: electricity_rates already has effective_from and does not need
-- a schema change — only the app query changes. But relax its
-- financial_year NOT NULL since new rows won't carry an FY label.
ALTER TABLE electricity_rates ALTER COLUMN financial_year DROP NOT NULL;
