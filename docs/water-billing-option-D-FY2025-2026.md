# Water billing — option D modelled across FY 2025/2026

Analysis date: 7 August 2026. Sources: the 10-page merged CoJ water invoice PDF
(billing periods 2025/08 – 2026/06), the separately supplied 2026/07 invoice,
`monthly_usage` and `council_invoices` in Supabase.

> **Verified independently by OCR, 8 August 2026.** The merged PDF and the June
> 2026 PDF are scans with no text layer, so they were rasterised at 200 dpi and
> read with tesseract. Every reading period, meter reading, step ladder and
> consumption charge in §1 below matches. Two notes: the separately supplied
> `COJ Water Utility June 2026.pdf` is a **duplicate of page 10** of the merged
> PDF (2026/06, 25 days, 66 kL, R951.19), not a thirteenth bill; and **2026-02
> is genuinely absent** from the supplied PDFs — page 7 jumps 2026/01 → 2026/03 —
> so the R275.72 discrepancy in §2 remains unverified against a physical invoice.
>
> **This analysis is now part of the AGM report.** Section 9,
> "Water — charged by CoJ vs billed to owners", rebuilds the charged-vs-billed
> comparison from `council_invoices`, `monthly_usage`, `statement_overrides` and
> the levy grid every time the report is generated. It is a permanent section of
> the template, not a one-off. This document remains the *reasoning*; the report
> carries the *numbers*.

---

## 1. How CoJ actually bills this complex — confirmed, not inferred

The July 2026 invoice states it explicitly:

```
Category of Water: Consumption - Multiple Dwelling
(Reading period = 2026/05/17 to 2026/06/18 = 33 days)
Charges for 78.000 KL are based on a sliding scale for a 33 day period
  Step 1  45.536 KL @ R 0.0000
  Step 2  30.357 KL @ R 29.840
  Step 3   2.107 KL @ R 31.150        = R971.48
```

The step widths are the domestic block tariff, **per dwelling**, pro-rated by
days in the reading period:

```
step width (kL) = monthly band width  ÷  (365.25 / 12)  ×  days  ×  7 dwellings
```

- Step 1 (free): `6 ÷ 30.4375 × 33 × 7 = 45.536` ✓
- Step 2 (R29.84): `4 ÷ 30.4375 × 33 × 7 = 30.357` ✓

**This settles the question the code has been guessing at: the complex genuinely
does receive 7 × 6 kL free.** Billing each unit with its own free 6 kL is right in
aggregate. What is *not* right is the band widths and the ceiling — see §3.

### Verification against every bill in the FY

| Billing period | Days | kL | Reconstructed | Invoice | Top step reached |
|---|---:|---:|---:|---:|---|
| 2025-08 | 30 | 85 | R 1,262.95 | R 1,262.95 | 3 (split rate) |
| 2025-09 | 30 | 88 | R 1,415.55 | R 1,415.56 | 3 |
| 2025-10 | 28 | 93 | R 1,659.68 | R 1,659.67 | 3 |
| 2025-11 | 32 | 92 | R 1,451.78 | R 1,451.78 | 3 |
| 2025-12 | 35 | 86 | R 1,132.31 | R 1,132.30 | 3 |
| 2026-01 | 26 | 76 | R 1,218.51 | R 1,218.50 | 3 |
| **2026-02** | **33** | **77** | **R 940.34** | **R 1,216.06** | 3 — **mismatch** |
| 2026-03 | 36 | 102 | R 1,586.52 | R 1,586.51 | 3 |
| 2026-04 | 24 | 55 | R 652.99 | R 652.99 | **2** |
| 2026-05 | 32 | 75 | R 922.23 | R 922.23 | 3 |
| 2026-06 | 25 | 66 | R 951.19 | R 951.19 | 3 |
| 2026-07 | 33 | 78 | R 971.49 | R 971.48 | 3 |

Eleven of twelve reconstruct to the cent.

**2025-08 straddles the 1 July 2025 tariff increase** and the invoice prints two
step ladders — 11 days on the 2024/2025 rates and 19 on 2025/2026. Reconstructing
it requires the old `>6-10` rate to be **R26.20**, not the R28.20 held in
`WATER_BANDS_DEFAULT.rate2024`. `rate2024` is not used in billing (only
`rate2025` is), so nothing is mis-billed, but the seed value looks wrong.

---

## 2. Data error found: council_invoices 2026-02

`council_invoices` stores **R1,216.06** for billing period 2026-02. The invoice
arithmetic gives **R940.34** — overstated by **R275.72**.

This is the only bill missing from the supplied PDF, and every input is pinned by
the neighbouring invoices:

- meter readings: 2026-01 ends `24,766.000`, 2026-03 starts `24,843.000` → 77 kL, matching the stored kL
- reading period: 2026-01 ends 2025/12/17, 2026-03 starts 2026/01/20 → 18 Dec – 19 Jan = 33 days
- `6 ÷ 30.4375 × 33 × 7 = 45.536` free · `4 ÷ … = 30.357 @ R29.84` · remainder `1.107 @ R31.15`
- `30.357 × 29.84 + 1.107 × 31.15 = R940.34`

**Recommend correcting `bulk_water_rand` for 2026-02 to R940.34** after checking
the physical invoice. It feeds the AGM report and the financial dashboard.

---

## 3. Where the over-recovery actually comes from

Across the twelve months the seven units were billed **R17,327.53** for metered
water. CoJ charged **R14,165.50**. That is **+22.3%**, and on top of it the levy
carries a common-property water provision raising a further **R5,921.52** a year.

The minimum charge is *not* the main cause. The money is in two structural gaps:

**(a) Band widths are not pro-rated.** The app applies a fixed 6 / 4 / 5 kL
ladder to every unit regardless of how many days the period ran. CoJ pro-rates
every step. A 36-day period gives each dwelling 7.10 kL free, a 24-day period
4.73 kL.

**(b) Units are pushed into bands the complex never entered.** CoJ reached step 3
(R31.15) in eleven months and step 2 (R29.84) in the twelfth. It never once
reached step 4. Yet Unit 3 at 17.52 kL is billed R43.67/kL on its top slice, and
Unit 6 at 34.32 kL in December reaches R66.01/kL. Those rates were never paid.

That is why the heavy users, not the light ones, carry most of the over-recovery.

**(c) The common-property provision is 2.9× actual.** CoJ metered 973 kL over the
year; the units metered 889.74 kL. Common property plus losses is therefore
**83.26 kL/year — 6.94 kL a month**, against a provision of 20 kL.

---

## 4. Option D

For each month:

1. Build each unit's ladder using CoJ's **pro-rated** step widths for that
   period's day count.
2. **Cap it at the highest step CoJ actually reached** — never charge a resident a
   marginal rate the complex did not pay.
3. Sum, and gross the total to the invoice's actual consumption charge.

Recovery is exact by construction, and no minimum charge exists, so the
"pay less by using more" inversion cannot arise.

### Result — FY 2025/2026, per unit

| Unit | kL/year | Current rule | Option D | Change | |
|---|---:|---:|---:|---:|---:|
| U1 | 183.04 | R 3,517.84 | R 3,248.26 | −R 269.58 | −8% |
| U2 | 23.57 | R 353.01 | R 14.91 | −R 338.10 | −96% |
| U3 | 226.16 | R 5,541.74 | R 4,530.69 | −R 1,011.05 | −18% |
| U4 | 83.99 | R 764.95 | R 551.90 | −R 213.05 | −28% |
| U5 | 128.53 | R 1,702.02 | R 1,636.81 | −R 65.21 | −4% |
| U6 | 212.52 | R 5,099.45 | R 4,126.03 | −R 973.42 | −19% |
| U7 | 31.93 | R 348.53 | R 56.91 | −R 291.62 | −84% |
| **Total** | **889.74** | **R 17,327.53** | **R 14,165.50** | **−R 3,162.03** | **−18%** |

Figures use the **annual** gross-up factor of **0.9570** — see §5.

Units 2, 4 and 7 fall close to zero in most months because CoJ genuinely charged
nothing for their water: it fell inside the free step. They continue to pay
**R882.22 a month** in fixed water charges (sewer R774.48 + demand levy R107.74),
so a R0.00 consumption line does not mean free water.

---

## 5. Use an annual gross-up factor, not a monthly one

Modelled monthly, the factor swings between **0.448 and 1.887 — a 4.2× spread**.
A resident's effective rate per kL would quadruple month to month for reasons
entirely outside their control.

The cause is a timing mismatch: CoJ's "2026/07" invoice reads 17 May – 18 June,
while the app's 2026-07 unit readings cover July. Testing a 1- and 2-period lag
narrows the spread only to 3.9× and 3.1× — it does not fix it, because the CoJ
reading dates drift (24 to 36 days) and never align to a calendar month.

Over a full year the mismatch washes out. **A single factor set annually at the
AGM and trued up the following year** is stable, predictable, printable on a
statement, and still recovers exactly. FY 2025/2026 would have been **0.9570**.

---

## 6. What this costs the body corp

| | Per year |
|---|---:|
| Currently collected — metered water | R 17,327.53 |
| Currently collected — common-property provision | R 5,921.52 |
| **Total collected for water consumption** | **R 23,249.05** |
| CoJ actually charged for consumption | R 14,165.50 |
| **Margin** | **R 9,083.55** |

That is **R108.14 per unit per month**. Under option D the common-property
provision must be **removed** — the gross-up already recovers common-property
water inside the invoice total — so adopting it in full means the body corp
either raises levies by about R108 a unit a month or runs a smaller budget.

This is a trustee and AGM decision, not a bug. The margin is not misappropriated;
it is funding the scheme. But it is currently an undisclosed markup on water,
weighted towards the heaviest users, and option D makes it explicit.

---

## 7. Open items before this could be implemented

- **Confirm the 2026-02 invoice figure** and correct `council_invoices`.
- **Decide how common-property water is shared.** The gross-up spreads it in
  proportion to consumption. Splitting it equally seven ways is arguably fairer —
  a leaking common-property pipe is not the heavy user's fault.
- **Unit 2's December 2025 reading is −5.43 kL** — a meter rollback or capture
  error. Clamped to 0 in this model. It needs fixing at source.
- **Decide the levy consequence** of removing the R5,921.52 provision.
- The reading-period mismatch remains even under an annual factor; it means any
  single month's statement is approximate and only the year ties out exactly.
