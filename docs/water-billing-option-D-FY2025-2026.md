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
> **Superseded in part, 11 August 2026 — read §3 before relying on anything below.**
> The original §3(a) claimed the scheme's fixed monthly band widths were a defect
> because CoJ pro-rates its own by days. **That was wrong**, and the model built
> on it distorted the per-unit split. Sections 3 to 7 have been rewritten.
> Sections 1 and 2 — the invoice reconstruction and the 2026-02 discrepancy —
> are unaffected and still stand.
>
> **This analysis is no longer part of the AGM report.** Section 10, "Water —
> charged by CoJ vs billed to owners", has been **removed from the generator**:
> it is a one-off decision for the 2026 meeting, not a permanent annual section.
> It is carried instead by the standalone pack,
> `El-Corazon-Water-Billing-AGM-2026.pdf`.

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
aggregate. What is *not* right is the ceiling, and the fact that the allowance is
handed out per unit rather than pooled — see §3.

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

## 3. Where the over-recovery comes from — corrected

Across the twelve months the seven units were billed **R17,327.53** for metered
water. CoJ charged **R14,165.50**. That is **+22.3%**, and on top of it the levy
carries a common-property water provision raising a further **R5,921.52** a year.

### (a) The original claim was wrong: fixed monthly band widths are correct

The first version of this paper said the app was defective for applying a fixed
6 / 4 / 5 kL ladder regardless of period length, because CoJ pro-rates every
step by days. **That inference does not hold.** CoJ pro-rates *because its
reading periods are irregular* — 24 to 36 days, never a calendar month. The
scheme's periods are always calendar months, so the unmodified monthly widths
are already the right ones. Over a year the two agree:

| | Free allowance per unit per year |
|---|---:|
| CoJ, pro-rated across 365 days | 71.95 kL |
| Calendar month × 12 | 72.00 kL |

A 0.05 kL difference is not a defect. **Billing calendar months on
calendar-month allowances is correct**, and the original option D — which
applied CoJ's day-scaled widths to calendar-month unit readings — was mixing two
incompatible period bases and distorting the per-unit split. It has been
rebuilt. The revised per-unit figures move by under R35 a year, so the
conclusion survives; the method does not.

### (b) Units are pushed into bands the complex never entered — stands

CoJ reached step 3 (R31.15) in eleven months and step 2 (R29.84) in the twelfth.
It never once reached step 4. Yet Unit 3 at 17.52 kL is billed R43.67/kL on its
top slice, and Unit 6 at 34.32 kL in December reaches R66.01/kL. Those rates were
never paid by anyone. **This is the largest single source of over-recovery, and
it falls on the heaviest users, not the lightest.**

### (c) The free allowance is pooled by CoJ and discarded by the scheme — new

This was missed first time round and is the reason a reconciliation factor is
needed at all. CoJ gives the complex **504 kL free a year** (6 kL × 7 units × 12)
and applies it to the *complex total*. The units only claimed **404.5 kL** of it —
Units 2, 4 and 7 never come close to their 6 kL. CoJ let the remaining **99.5 kL**
absorb the heavier households' consumption. Billing each unit on its own ladder
throws that 99.5 kL away.

### (d) The common-property provision is 2.9× actual — stands

CoJ metered 973 kL over the year; the units metered 889.74 kL. Common property
plus losses is therefore **83.26 kL/year — 6.94 kL a month**, against a provision
of 20 kL.

---

## 4. The operational constraint that determines the design

**Levy statements go out on the 1st of every month for the month just ended.**

That single fact rules out any method that prices off the council invoice,
because on the 1st the invoice for that period has not arrived — and for
2026-02 it never did. It also rules out a monthly reconciliation factor:
modelled month by month the factor swings between **0.448 and 1.887, a 4.2×
spread**, because CoJ's reading window is offset from the calendar month by
roughly six weeks and drifts. Testing a 1- and 2-period lag narrows it only to
3.9× and 3.1×; the dates never align, so no lag fixes it.

| | The scheme | CoJ |
|---|---|---|
| Reading date | Last day of each calendar month | Drifts — 24 to 36 day periods |
| Period length | Always a calendar month | Never a calendar month |
| Available when? | Immediately | Weeks later, sometimes not at all |

Whatever is adopted must therefore produce **a rate the trustee can apply on the
1st with nothing but the meter readings**, while still honouring the council's
arithmetic *over the year*.

---

## 5. Option D, rebuilt: a published rate card

1. Take CoJ's published step rates.
2. **Cap the ladder at the highest step the complex itself is billed at** — no
   unit is ever charged a marginal rate the scheme does not pay. Step 3 last year.
3. Multiply by a **reconciliation factor set once a year**, so the scheme
   recovers what it pays and the pooled free allowance is handed back.
4. Bill calendar-month consumption on the resulting card. No pro-rating, no
   invoice dependency, no minimum charge — so the inversion cannot arise.

On FY 2025/2026 the factor is **0.9543** and the card would have read:

| Consumption in the month | Charge |
|---|---:|
| First 6 kL | free |
| Next 4 kL (6 – 10 kL) | **R 28.48** per kL |
| Above 10 kL | **R 29.73** per kL |

Worked examples: 3 kL → R0.00 · 5 kL → R0.00 · 8 kL → R56.95 · 12 kL → R173.35 ·
18 kL → R351.70 · 25 kL → R559.78.

### Result — FY 2025/2026, per unit

| Unit | kL/year | Current rule | Option D | Change | |
|---|---:|---:|---:|---:|---:|
| U1 | 183.04 | R 3,517.84 | R 3,240.70 | −R 277.13 | −8% |
| U2 | 23.57 | R 353.01 | R 23.63 | −R 329.37 | −93% |
| U3 | 226.16 | R 5,541.74 | R 4,522.46 | −R 1,019.28 | −18% |
| U4 | 83.99 | R 764.95 | R 587.59 | −R 177.36 | −23% |
| U5 | 128.53 | R 1,702.02 | R 1,624.18 | −R 77.84 | −5% |
| U6 | 212.52 | R 5,099.45 | R 4,119.09 | −R 980.36 | −19% |
| U7 | 31.93 | R 348.53 | R 47.84 | −R 300.69 | −86% |
| **Total** | **889.74** | **R 17,327.53** | **R 14,165.50** | **−R 3,162.03** | **−18%** |

Units 2, 4 and 7 fall close to nil because CoJ genuinely charged nothing for
their water — it fell inside the free step. They continue to pay **R882.22 a
month** in fixed water charges (sewer R774.48 + demand levy R107.74), so a R0.00
consumption line does not mean free water.

### How it runs

| When | What happens |
|---|---|
| At the AGM, once a year | The meeting sets the card: CoJ's newly published step rates × the factor. Three numbers, minuted. |
| 1st of every month | Statements go out for the month just ended, priced off the card and the meter readings alone. |
| When each invoice arrives | Captured as now, for the accounts and next year's factor. It changes no statement already issued. |
| At the year end | Twelve invoices against twelve months billed; the difference sets the following year's factor. |

The factor is set from a full prior year, so it is stable. Were it wrong by as
much as 5%, the year-end correction would be about **R8.43 per unit per month**.

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
provision must be **removed** — the factor already recovers common-property water
inside the invoice total — so adopting it in full means the body corp either
raises levies by about R108 a unit a month or runs a smaller budget.

This is a trustee and AGM decision, not a bug. The margin is not misappropriated;
it is funding the scheme. But it is currently an undisclosed markup on water,
weighted towards the heaviest users, and option D makes it explicit.

Held revenue-neutral, option D is a redistribution rather than a saving: it costs
the five lighter households **R10 to R31 a month** and returns **R44 to R47 a
month** to Units 3 and 6, the two that were most overcharged.

---

## 7. Open items

- **Confirm the 2026-02 invoice figure** and correct `council_invoices`
  (R1,216.06 recorded against R940.34 reconstructed).
- **Unit 2's December 2025 reading is −5.43 kL** — a meter rollback or capture
  error. Clamped to nil in this model. It needs fixing at source.
- **Decide how common-property water is shared.** The factor spreads it in
  proportion to consumption. Splitting it equally seven ways is arguably fairer —
  a leaking common-property pipe is not the heavy user's fault.
- **Decide the levy consequence** of removing the R5,921.52 provision.
- **Nothing in the app implements this yet.** The August 2026 minimum-charge rule
  is what is live; option D is a proposal for the meeting.
- The reading-period offset persists under an annual factor. It is constant and
  does not accumulate, but any single month's statement is approximate and only
  the year ties out exactly.
