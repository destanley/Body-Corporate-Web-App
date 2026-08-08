# Water — FY 2026/2027 projection and the common-property provision

Prepared 8 August 2026 for the September AGM. All figures **exclude VAT** unless
marked otherwise, because that is the basis the council invoice and the metered
water lines are both stored on. Sources: `water_tariff_bands`,
`levy_manual_entries`, `council_invoices`, `monthly_usage` and `levy_rates` in
Supabase, plus the twelve FY 2025/2026 CoJ invoices verified by OCR.

---

## 1. Two corrections to the option-D analysis

Both change the numbers, so they come first.

### (a) The levy grid is VAT-inclusive

`levy_manual_entries` for FY 2025/2026 holds **R81.07 per unit per month** for
Common Property Water — R567.49 across the seven units, **R6,809.88 a year**.
The option-D document used R5,921.52, being 20 kL priced on the tariff table.
R493.46 × 1.15 = R567.48, so the grid figure is the same number **with VAT on it**.

The convention holds across the grid: sewerage is captured at R890.66 per unit
against a council charge of R774.48 (× 1.15 = R890.65), and the water demand levy
at R123.90 against R107.74 (× 1.15 = R123.90). Both are exact VAT-inclusive
pass-throughs.

This mattered: AGM report §9 was comparing VAT-inclusive recovery against a
VAT-exclusive council charge and overstating the margin by **R888.25**. Fixed —
the section now de-VATs the provision and prints both figures so the adjustment
is visible.

### (b) The option-D "current rule" column was the *new* rule, not what was billed

Option-D §4 shows FY 2025/2026 metered water at **R17,327.53**. That prices every
month on the flat-minimum rule adopted 7 August 2026. The statements actually
sent for FY 2025/2026 all predate it (`WATER_MINIMUM_CHARGE_FROM = "2026-08"`)
and used the superseded merged-band rule, which bills sub-6 kL months harder.

Actual metered water billed for FY 2025/2026 was **R18,238.88** — R911.35 more.
The difference sits entirely on the three light users:

| | U1 | U2 | U3 | U4 | U5 | U6 | U7 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Option-D "current rule" | 3,517.84 | 353.01 | 5,541.74 | 764.95 | 1,702.02 | 5,099.45 | 348.53 | 17,327.53 |
| **Actually billed** | 3,517.84 | **524.29** | 5,541.74 | **1,258.82** | 1,702.03 | 5,099.47 | **594.69** | **18,238.88** |

So the real FY 2025/2026 margin is larger than option D reported.

---

## 2. FY 2025/2026 — actual

| | Excl VAT |
|---|---:|
| CoJ charged for water consumption (as stored) | R 14,441.22 |
| — corrected for the 2026-02 capture error | R 14,165.50 |
| Metered water billed to units | R 18,238.88 |
| Common-property provision recovered (R6,809.88 incl VAT) | R 5,921.63 |
| **Total recovered from owners** | **R 24,160.51** |
| **Margin, against the stored charge** | **R 9,719.29  (+67.3%)** |
| **Margin, against the corrected charge** | **R 9,995.01  (+70.6%)** |
| Per unit, per month | R 115.71 – R 118.99 |

Volume: CoJ metered **973 kL**, the seven unit meters account for **889.74 kL**.
Common property and losses are therefore **83.26 kL a year — 6.94 kL a month**,
against a provision of **20 kL**. The provision is **2.9× actual**.

---

## 3. FY 2026/2027 — projection

**Assumption: consumption repeats FY 2025/2026 month for month, per unit.** That
is the only honest basis available — there is no trend to extrapolate from a
single year, and unit-level water use is driven by occupancy, not by price. Where
this is wrong it is most likely wrong on Unit 6, whose December 2025 spike of
34.32 kL looks like an event rather than a habit.

Two things move: the tariff and the billing rule.

- **Tariff, effective 1 August 2026:** +12.50% on every band the complex reaches
  (>6-10 R29.84 → R33.57; >10-15 R31.15 → R35.04; >15-20 R43.67 → R49.13). The
  >40-50 band rose 16.10% but nothing in this complex has ever reached it.
- **Billing rule, from the August 2026 statement:** flat minimum of R33.57 at or
  under 6 kL, table above it. This *reduces* what light users pay.

| | Excl VAT |
|---|---:|
| CoJ charge projected | R 15,935.33 |
| Metered water billed to units | R 19,493.07 |
| Common-property provision as captured (R7,660.80 incl VAT) | R 6,661.57 |
| **Total recovered from owners** | **R 26,154.64** |
| **Margin** | **R 10,219.31  (+64.1%)** |
| Per unit, per month | R 121.66 |

### Per unit — metered water only

| Unit | FY 2025/2026 actual | FY 2026/2027 projected | Change |
|---|---:|---:|---:|
| U1 | R 3,517.84 | R 3,957.39 | +R 439.55 |
| U2 | R 524.29 | R 397.13 | −R 127.16 |
| U3 | R 5,541.74 | R 6,234.32 | +R 692.58 |
| U4 | R 1,258.82 | R 860.54 | −R 398.28 |
| U5 | R 1,702.03 | R 1,914.75 | +R 212.72 |
| U6 | R 5,099.47 | R 5,736.84 | +R 637.37 |
| U7 | R 594.69 | R 392.10 | −R 202.59 |
| **Total** | **R 18,238.88** | **R 19,493.07** | **+R 1,254.19 (+6.9%)** |

Metered billing rises only 6.9% against a 12.5% tariff increase, and three units
pay *less* in cash terms. The rule change is why: dropping the merged band hands
back more to U2, U4 and U7 than the tariff takes from them.

---

## 4. What removing the provision would do

**It would not create a water shortfall.** Metered billing alone recovers
R19,493.07 against a projected CoJ charge of R15,935.33 — a **R3,557.74 surplus**
before the provision is counted at all. The provision is margin on top of margin.

That surplus is structural and was diagnosed in option-D §3: the app applies a
fixed 6 / 4 / 5 kL ladder while CoJ pro-rates every step by days in the reading
period, and units get pushed into bands the complex never entered. U3 at 17.52 kL
pays R49.13 on its top slice; CoJ never charged the complex above R35.04.

### Options

| | CP levy line | Owner pays | Body corp income | Water surplus |
|---|---:|---:|---:|---:|
| **1. Keep as captured — 20 kL** | R 91.20 /unit/mo | — | baseline | R 10,219.31 |
| **2. Remove entirely** | R 0.00 | −R 91.20 /mo | −R 7,660.80 /yr | R 3,557.74 |
| **3. Provision at actual 6.94 kL, own free 6 kL** | R 5.18 /unit/mo | −R 86.02 /mo | −R 7,225.33 /yr | R 3,936.41 |
| **4. Provision at actual 6.94 kL, marginal rate R35.04** | R 39.95 /unit/mo | −R 51.25 /mo | −R 4,304.95 /yr | R 6,475.87 |

Option 3 gives common property its own free 6 kL, which is hard to defend — the
free allowance is granted per dwelling and the units already consume it. **Option 4
is the more principled version of the same idea:** charge the measured
common-property draw at the rate the complex actually pays at the margin.

### The budget consequence, stated plainly

Removing the line takes **R7,660.80 a year** out of levy income — **5.1%** of the
R150,015.96 the FY 2026/2027 grid raises. Each owner pays **R91.20 a month less,
R1,094.40 a year less**.

The body corporate then either runs a smaller budget or recovers it elsewhere.
It is not a water decision; the water is already covered. It is a decision about
whether the scheme is funded by an undisclosed markup on water — weighted towards
the heaviest users, who have no way of seeing it — or by a levy line that says
what it is.

---

## 5. What to check before relying on these figures

- **The 2026-02 invoice.** `council_invoices` holds R1,216.06; the invoice
  arithmetic gives R940.34, and it is the one bill missing from the scanned set.
  R275.72 of the FY 2025/2026 margin turns on it.
- **Unit 2's December 2025 reading is −5.43 kL.** Clamped to 0 throughout. It is
  a meter rollback or a capture error and needs fixing at source; it understates
  U2's year.
- **`levy_rates.water_demand_levy` is null for FY 2026/2027.** The grid carries
  R123.90 per unit, but the rate table has no approved figure, so AGM report §8
  will show the New column blank on that line.
- **The projection assumes flat consumption.** A 10% swing in complex-wide use
  moves the CoJ charge roughly R1,600 and the metered recovery roughly R2,300 —
  the margin widens as consumption rises, because the band mismatch compounds.
