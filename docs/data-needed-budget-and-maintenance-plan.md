# What's needed for a FY 2026/2027 budget and a 10-year maintenance plan

Prepared 8 August 2026. Assessed against what is actually in Supabase today, not
against what the app could hold.

**Short answer.** The budget is roughly **95% buildable now** — the three
items that could not be derived have all been answered, leaving four trustee
decisions and the two data-quality fixes. The 10-year maintenance plan is
**close to 0% buildable**: the database has no asset register, no condition data
and no reserve fund, so essentially all of it has to come from you or from a survey.

---

## Part A — FY 2026/2027 budget

### What I already have

| | Detail |
|---|---|
| A complete year of actuals | Aug 2025 – Jul 2026: 139 bank transactions, **0 untagged debits**. R238,065.78 in, R234,425.28 out |
| Expense detail by category | CoJ Electricity R106,036.53 · CoJ Water R90,939.04 · Insurance R24,309.71 · Miscellaneous R6,999.00 · Repairs & Maintenance R4,116.75 · Fire extinguishers R1,466.25 · Bank charges R558.00 |
| FY 2026/2027 levy grid | Captured in full — R12,501.33/month, **R150,015.96/year** |
| FY 2026/2027 water tariff | Captured, +12.50% on every band the complex reaches |
| FY 2026/2027 electricity rate | R2.81/kWh from 1 July 2026, up from R2.58 (**+8.91%**) |
| FY 2026/2027 insurance | Captured — R24,365.40/year, R2,030.45/month |
| Council fixed charges | Sewerage R774.48/unit, demand levy R107.74/unit, off the July 2026 invoice |
| Water cost projection | Done — see `water-projection-FY2026-2027.md` |

### What I need from you

**Cannot be derived from anything in the system:**

1. ~~**Opening cash at 1 August 2026.**~~ **RESOLVED AND CONFIRMED 8 August 2026.**
   All twelve digital statements supplied and parsed. **Closing balance at
   31 July 2026 is R210,844.15**, read off FNB statement 280 — it confirms the
   earlier derived figure exactly. Every one of the 139 transactions now carries
   its running balance and reconciles with zero drift. Nothing further needed.
2. ~~**Arrears at 31 July 2026.**~~ **RESOLVED — none.** Confirmed by Devon.
   The budget can assume full collection, which is unusual and worth stating in
   the AGM pack rather than leaving implicit.
3. ~~**Does a reserve fund exist?**~~ **RESOLVED — no, there is none.** This is
   the finding, not the absence of one. It engages the PMR 22 floor in full;
   see the end of Part B.

**Trustee decisions not yet captured** (`agm_report_settings` for 2026/2027 is
empty apart from garden visits per month):

4. **Garden service** — rate per day, the increase %, the year-end bonus and its
   due date. FY 2025/2026 proposed R414.00/day (up 7% from R387.00) and a R828.00
   bonus. Confirm or replace.
5. **Blockwatch** — monthly fee for 2026/2027. Currently R150.00, proposed
   unchanged.
6. **CSOS levy** — currently R376.41/quarter. Has it moved for 2026/2027?
7. **Any planned one-off spend in 2026/2027** — a repaint, a gate motor, a
   sewer job. FY 2025/2026 R&M was only R4,116.75 across two jobs, so a single
   project would dominate the budget and I have no way to know about it.

**Data quality, already flagged but still open:**

8. **The 2026-02 water invoice.** R1,216.06 stored against R940.34 by the
   invoice's own arithmetic. R275.72.
9. **Unit 2's December 2025 reading is −5.43 kL.** A rollback or a capture error.

### The real constraint: one year of history

There is exactly **one** financial year in the system. That is enough to budget a
recurring cost and useless for spotting a cyclical one. Anything on a two, three
or five-year cycle — a repaint, a roof inspection, a pump — is invisible, and the
budget will silently assume it does not exist.

**The highest-value thing you could give me is the prior two or three years of
annual financial statements.** Even as PDFs. It converts the budget from
"last year plus a percentage" into something with a trend behind it, and it
doubles as the "past contributions" input the reserve fund formula needs.

---

## Part B — 10-year maintenance, repair and replacement plan

This is a statutory requirement, not a nice-to-have. **Prescribed Management
Rule 22** under the Sectional Titles Schemes Management Act requires every body
corporate to prepare a written maintenance, repair and replacement plan covering
major capital items over at least ten years, and to have it approved at each AGM
on a rolling basis — year 1 falls away, a new year 10 is added.

### What the database holds today

Nothing usable. There is no asset register, no component condition, no
installation dates, no replacement costings and no reserve fund.

What I can infer is thin: seven units, 1,409 m² of unit area on a 3,964 m² stand,
total sum insured **R16,234,560**, four geysers insured separately (units 2, 4, 5
and 6 at R900 each), and two lighting jobs in September 2025 — a light pole at
unit 5 (R659.90) and common area lights (R2,765.85).

### What the plan needs, per component

For each major common-property item, four things:

| Field | Why |
|---|---|
| **Age or installation date** | Drives where it sits in the cycle |
| **Present condition** | Good / fair / poor — moves the replacement date off the theoretical one |
| **Expected useful life** | The denominator in the statutory formula |
| **Estimated replacement cost** | The numerator |

PMR 22(2) then sets the annual contribution as
**(estimated cost − past contributions) ÷ expected remaining life**, summed across
components.

### The component list to walk the property with

Nothing here is exotic — it is the standard schedule for a small walk-up complex.
Mark each present / not present, then fill in the four fields:

**Structure and envelope** — roof covering · roof structure and trusses ·
gutters, downpipes and fascias · external wall paint · waterproofing and flashings ·
windows and external doors · balconies or stoeps

**Site and boundary** — boundary walls or palisade · electric fence or topping ·
main gate and gate motor · pedestrian gate · driveway and paving · stormwater
drainage · retaining walls

**Services** — water reticulation and isolating valves · sewer reticulation and
manholes · bulk electrical supply and distribution board · common area lighting
*(partly renewed Sep 2025)* · intercom · geysers *(4 known — confirm the other 3)* ·
irrigation

**Amenity and compliance** — refuse area and bins · signage and unit numbering ·
fire extinguishers *(serviced annually, R1,466.25)* · fire hose reels if any ·
letterboxes · parking bays and carports

### The three things I need beyond the register

1. **Reserve fund opening balance at 1 August 2026**, and the total contributed
   into it historically. Both feed the formula directly.
2. **Age of the buildings** — year of construction, and the date of the last
   major repaint and last roof work. Age alone gets a defensible first-pass plan
   even where condition data is missing.
3. **Any professional condition report** already done — a valuer's replacement-cost
   assessment, an engineer's report, a roof inspection. If the insurer's
   R16,234,560 sum insured came off a replacement-cost valuation, that document is
   worth a great deal here.

### One thing to be ready for

PMR 22 carries a floor. **If the reserve fund at the end of the last financial
year is below 25% of total levies collected that year, the budgeted reserve
contribution for the coming year must be at least 15% of the budgeted
administrative fund contribution.**

For El Corazon, 25% of last year's collections is roughly **R59,500**. If the
reserve fund is below that — and if there is no reserve fund at all, it is — then
the 15% floor engages. On an administrative budget in the region of R250,000 that
is about **R37,500 a year, roughly R446 per unit per month**.

That is a material number and the meeting should not meet it for the first time
on the night. It is also the strongest practical argument for dealing with the
water margin deliberately: **R10,219 of the surplus this year is already coming
out of owners' pockets** through the provision and the band mismatch, and
redirecting it to the reserve fund would fund about a quarter of that floor
without anyone paying a rand more.

---

## Suggested order of work

1. Answer the three cannot-be-derived items — cash, arrears, reserve fund. One
   email.
2. Confirm the four trustee decisions so `agm_report_settings` for 2026/2027 fills.
3. Send prior-year AFS if they exist.
4. Walk the property once with the component list and record age and condition.
   Costings can be estimated from published rates for a first pass and refined later.

Steps 1–3 get a defensible FY 2026/2027 budget. Step 4 is the only one that
needs time on site, and a first-pass plan built from age and condition is both
compliant and far better than not having one.

---

**Sources for the statutory position:**
[Mirfin — 10-Year Maintenance, Repair and Replacement Plans: what you need to know](https://mirfin.co.za/blog/10-year-maintenance-plans-for-sectional-title-schemes-what-you-need-to-know/) ·
[Property Wheel — The ins-and-outs of ten-year maintenance plans](https://propertywheel.co.za/2021/05/the-ins-and-outs-of-ten-year-maintenance-plans-in-sectional-title-schemes/) ·
[Sectional Title Solutions — A guide to 10-year maintenance plans](https://www.stsolutions.co.za/securing-your-investment-a-guide-to-10-year-maintenance-plans-for-sectional-title-schemes/) ·
[Sectional Title Centre — "10 Year" maintenance plan](https://www.sectionaltitlecentre.co.za/10-year-maintenance-plan-lexis-digest/)
