# Reserve fund — implementation plan

Drafted 11 August 2026 for the September AGM. Figures exclude VAT unless marked.
Sources: `reserve_fund_entries`, `assets`, `budget_lines`, `budget_meta` in
Supabase, and the FY 2026/2027 budget as captured.

> **Not legal advice.** The reading of Regulation 2 below should be confirmed
> with the scheme's accountant before the meeting votes on it. Where the wording
> is capable of more than one reading this document says so.

---

## 1. What the law requires

| Provision | Requirement |
|---|---|
| **STSMA s3(1)(b)** | Establish and maintain a reserve fund **reasonably sufficient** to cover the cost of future maintenance, repair and replacement of common property. |
| **Regulation 2** | A tiered **minimum** annual contribution — see below. |
| **PMR 22** | A written maintenance, repair and replacement plan over at least ten years, approved at each AGM. |
| **PMR 26(1)(b)** | **Separate books of account and separate bank accounts** for the administrative and reserve funds. |
| **PMR 21** | Reserve funds may be invested, but only in secure investments. |

### Regulation 2, in full

The test is against the reserve balance **at the end of the previous financial
year**, measured against that year's **actual** contributions to the
administrative fund:

| Reserve at prior year end | Minimum contribution for the year being budgeted |
|---|---|
| **< 25%** of prior year's admin contributions | **15% of the budgeted** admin contribution |
| 25% – 100% | at least the amount **budgeted to be spent from the administrative fund on repairs and maintenance to the common property** that year |
| ≥ 100% | no minimum |

Two different bases, and conflating them is the easy mistake: the **threshold**
test uses last year's *actual* contributions; the **15%** is of next year's
*budgeted* contributions.

---

## 2. Where El Corazon actually stands

| | |
|---|---:|
| Reserve fund balance | **R 0.00** |
| Reserve ledger entries | **0** |
| Components on the asset register | 24 |
| …of those with a replacement cost | **0** |
| Condition inspections recorded | 0 |
| Approved plan snapshots | 0 |
| Cash held at 1 August 2026 | R 210,844.15 |
| FY 2026/2027 budgeted owner contributions | R 266,789.56 |
| FY 2026/2027 reserve line already in the budget | R 40,592.60 |

**The reserve fund does not exist.** It is budgeted for and reported on, but no
money has ever been designated to it and the ledger is empty. Because the
balance at the end of FY 2025/2026 was nil, **tier 1 applies and the FY 2026/2027
contribution is not optional**.

### The 15% basis — contested, and the earlier note was too confident

Regulation 2 says 15% of "the total budgeted contribution to the administrative
fund", and does not define the phrase. **Section 3(1)(f) does**: the body
corporate raises the amounts it determines "by levying contributions on the
owners **in proportion to the quotas of their respective sections**".

El Corazon's metered water and electricity are **not** raised on participation
quota — they are raised on each unit's own meter reading. On a strict reading of
s3(1)(f) they are a recovery of a cost incurred on an owner's behalf, not a
contribution, and the basis is **the levy grid alone**.

Against that: the body corporate pays the whole council bill out of the
administrative fund — s3(1)(a)(ii) names electricity and water expressly — and
the money recovered from owners funds that expenditure. On that reading every
rand owners pay is a contribution to the administrative fund.

**Both readings are arguable and this document does not resolve it.** What it
does instead is recommend a figure that is compliant under either — see §3.

Note that the levy grid **already contains** the fixed utility charges (sewerage,
water demand levy, common-property water and electricity). Only the *metered*
consumption sits outside it, so the gap between the two readings is narrower than
it first appears.

| | FY 2026/2027 |
|---|---:|
| Levy grid | R 150,015.96 |
| Metered water recovered | R 22,417.03 |
| Metered electricity recovered | R 94,356.57 |
| **Total contributions** | **R 266,789.56** |
| **× 15% on the broad reading** | **R 40,018.43** |
| × 15% on the levy-only reading (R 150,015.96) | R 22,502.39 |

The budget currently carries **R 40,592.60**, which is 15% of *total budgeted
expenditure* — the proxy `reserveFundFloor()` uses today. It is wrong on both counts — expenditure is
not what the regulation names, and it is drawn from the wrong year — and needs
correcting whichever reading of "contribution" is adopted.

---

## 3. Funding — recommendation

**The scheme does not need new money. It needs existing money designated.**

El Corazon holds R 210,844.15 in cash against annual expenditure of
R 270,617.34 — a little under a full year of costs sitting undesignated. That
balance is the accumulated result of years of collecting more than was spent,
including the water margin identified separately. Calling part of it a reserve
fund changes its label, not the bank balance.

### There is a threshold worth aiming past — and a drafting gap to avoid

FY 2026/2027's minimum is fixed by a nil opening balance and cannot be avoided.
But the **closing** balance sets which tier applies in FY 2027/2028.

**Mind the gap at exactly 25%.** Paragraph (a) catches a reserve of *less than*
25%; paragraph (c) catches *more than* 25% but less than 100%. A reserve sitting
at precisely 25% falls in neither. Land above the line, not on it.

| | Designate | As % of contributions, broad / levy-only | FY 2027/2028 minimum | Admin cash left | Months of cover |
|---|---:|---:|---|---:|---:|
| **A** Bare minimum, broad reading | R 40,018.43 | 15.0% / 26.7% | tier 1 on the broad reading — another ~R 40,000 | R 170,825.72 | 7.6 |
| **B** Clear 25% both ways *(recommended)* | **R 70,000.00** | 26.2% / 46.7% | **tier 2 either way — the year's budgeted R&M, currently R 8,000** | R 140,844.15 | 6.2 |
| **C** Clear 100% | R 266,789.56 | 100% | no minimum ever | **negative** | — |

Option C is arithmetically unavailable: it exceeds the cash held.

**Recommend R 70,000** — a round number chosen because it is compliant under
*both* readings of "contribution" and clears the 25% line with margin on each.
That removes the need to settle the legal question before the meeting can act,
and since the money comes from cash the scheme already holds, the conservative
choice costs owners nothing.

*The 25% test in FY 2027/2028 runs against FY 2026/2027's **actual**
contributions, not the budget. R 70,000 clears 25% of budget on either reading;
if actual contributions overshoot, top the designation up before year end.*

### What owners pay

**Nothing.** Under every option above the contribution is a transfer between two
funds of the same body corporate. This is the one point most likely to be
misunderstood at the meeting, and section 13 of the AGM report already makes it:
the reserve contribution is a designation, not an outflow, and the cash stays in
the account either way.

> **A caveat worth putting to the accountant:** moving accumulated administrative
> surplus into the reserve fund is a transfer between funds, and the safer course
> is to have the meeting resolve on it explicitly rather than treat it as a
> trustee decision.

---

## 4. The floor is not the target

Regulation 2 sets a **minimum**. Section 3(1)(b) sets the actual standard —
"reasonably sufficient" for future maintenance, repair and replacement. Those are
different tests, and only the second one protects the scheme from a special levy.

**Nobody currently knows what sufficient looks like here**, because all 24
components are registered without a replacement cost. Until they are costed the
PMR 22 plan cannot produce an annual provision, and R 40,018.43 is a number
chosen by regulation rather than by the roof.

Costing the register is therefore not an optional refinement — it is the only
work in this plan that answers the question the reserve fund exists to answer.

---

## 5. Implementation

### Phase 1 — before the AGM (trustee work, no code)

1. **Cost the 24 components.** Replacement cost, expected life, install date or
   age, present condition. Quotes where available; a defensible estimate with a
   stated basis where not. Captured on the **Maintenance plan** page.
2. **Decide the designation** — R 66,697.39 on the recommendation above.
3. **Confirm the 15% basis** with the accountant.
4. **Arrange the separate bank account** required by PMR 26(1)(b).

### Phase 2 — app changes

| # | Change | Why |
|---|---|---|
| 2.1 | **Correct the 15% basis.** `reserveFundFloor()` takes `adminBudget: report.totalExpense` — prior-year *expenditure*. It must take **budgeted owner contributions for the year ahead**, read from `budget_lines` where `section='income'`, excluding interest. | The current figure is a proxy for something the regulation names precisely, and it is drawn from the wrong year. |
| 2.2 | **Implement all three tiers.** `reserveFundFloor()` returns a floor only when below 25%; above it, it returns `null`, which reads as "no obligation" when tier 2 in fact requires the budgeted reserve spend. | The scheme is about to cross into tier 2. The function would go quiet exactly when it starts mattering. |
| 2.3 | **Show the tier and the distance to the next one** on the Reserve fund ledger: balance, the 25% and 100% thresholds, and what the next year's minimum becomes at the current balance. | Makes the threshold effect in section 3 visible every month rather than once a year in a document. |
| 2.4 | **Flag the separate-account gap.** A standing note on the Reserve fund page and in the AGM report: entries are notional against the single FNB account, and PMR 26(1)(b) requires a separate one. | Trustee's decision, 11 August 2026: track notionally now, be explicit about the gap rather than silent. |
| 2.5 | **Record the opening designation** as a `contribution` entry dated the day the meeting approves it, described as a transfer from accumulated administrative surplus. | The ledger should say where the money came from; a bare opening balance invites the question at the next AGM. |
| 2.6 | **Report the basis in the AGM pack** — which figure the 15% was taken of, and that it is a floor rather than a sufficiency assessment. | Both were assumptions a reader currently has to reverse-engineer. |

### Phase 3 — make it sufficient

1. Replacement costs populate → `fetchMaintenancePlan` produces a real
   `annualProvision` per component and in total.
2. **Compare that against the statutory floor. The higher of the two governs**
   — the regulation's minimum does not discharge s3(1)(b).
3. Snapshot the plan the meeting adopts. PMR 22 compliance rests on what was
   approved, not on what the register says afterwards.
4. Reassess at each AGM.

---

## 6. Risks and open questions

| Risk | Note |
|---|---|
| **The 15% basis is unresolved** | Levy-only R 22,502.39; all contributions R 40,018.43. s3(1)(f) defines contributions as PQ-based, which points to levy-only; s3(1)(a)(ii) puts the council bill in the administrative fund, which points the other way. **The R 70,000 recommendation sidesteps it** — but the app still has to pick a basis for the figure it reports, so the accountant should settle it. |
| **Exactly 25% is in a drafting gap** | Reg 2(a) is "less than 25%", 2(c) is "more than 25%". A balance of precisely 25% is caught by neither. Never land on the line. |
| **Transferring surplus between funds** | Likely requires a members' resolution rather than a trustee decision. Put it on the agenda explicitly. |
| **No separate bank account** | A live non-compliance with PMR 26(1)(b) for as long as it persists. The app will state it rather than mask it. |
| **The floor may be well short of sufficient** | Unknowable until the register is costed. A seven-unit scheme with an uncosted roof has no idea whether R 40,000 a year is generous or negligent. |
| **Designating cash reduces operating headroom** | From 9.3 months of cover to 6.4 under option B. Comfortable, but it is a real reduction and should be stated to the meeting. |
| **Reserve funds must be invested securely (PMR 21)** | Once a separate account exists, decide whether the balance sits in a call account or a fixed deposit. Out of scope here. |

---

## 7. Suggested resolutions

1. That the body corporate establish a reserve fund in terms of s3(1)(b) of the
   STSMA with effect from 1 September 2026.
2. That R 70,000.00 be transferred from accumulated administrative funds to the
   reserve fund, exceeding the minimum prescribed by Regulation 2 for
   FY 2026/2027 on any reading of "contribution to the administrative fund", and
   placing the fund above 25% of annual contributions at year end.
3. That the reserve fund contribution for FY 2026/2027 be recorded as a
   designation of existing funds and **not** recovered by an increase in levies.
4. That the trustees open a separate bank account for the reserve fund as
   required by PMR 26(1)(b), and report to the next AGM on having done so.
5. That the trustees complete replacement costings for all 24 registered
   components and present a PMR 22 maintenance, repair and replacement plan for
   approval at the next annual general meeting.
