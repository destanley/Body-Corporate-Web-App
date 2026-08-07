# El Corazon Body Corporate — Finance Trustee App
**Project summary / working notes**
Last updated: 7 August 2026, session 4 (supersedes the 6 August 2026 session 3 summary)

> Devon is the finance trustee for **El Corazon**, a 7-unit residential body corporate in OntdekkersPark (1709), South Africa. This app manages monthly levy statements, water & electricity billing, bank reconciliation, resident remittance advices, expense tracking and the annual income & expenditure statement. Devon builds and deploys it directly.

---

## Infrastructure (current)

- **Repo:** `https://github.com/destanley/Body-Corporate-Web-App` (branch `main`)
- **Local working folder:** `G:\Claude Playground\CoWork\el-corazon-web`
- **Live app file:** `src/App.jsx` — the file `main.jsx` imports and the only one that renders. Single-file app, ~6,200 lines. (The old `src/ElCorazonWebApp_5.jsx` duplicate is **deleted**; don't reintroduce it.)
- **Runtime CDN libraries** (never bundled, loaded on first use): supabase-js, pdf.js for bank-statement parsing, and **`docx@8.5.0` for the AGM report**. Adding one is preferred to growing the bundle.
- **Build tooling:** Vite 7 + `@vitejs/plugin-react` 4.7 (React 18). Pinned to Vite 7 deliberately — Vite 8/Rolldown caused a `jsx` peer-dependency failure. Supabase config comes from env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`).
- **Hosting:** Cloudflare Pages (free), auto-deploys on push to `main`. Build command `npm run build`, output dir `dist`, framework preset "None". SPA routing via `public/_redirects` and `vercel.json`.
- **Supabase project:** `ctqyxxlnnrgtyyxubsle` (org `liciwrkhrrsserpzjjzn`, eu-west-1, Postgres 17, "El Corazon").
- **Edge function:** `gmail-import` writes `email_imports` using the service role (bypasses RLS). Runs daily at 04:00 UTC via pg_cron (`gmail-import-daily`, jobid 1). **Its source is not in this repo** — it lives only in Supabase. See `docs/RUNBOOK-gmail-import.md` when imports stop.
- **SQL applied via the Supabase MCP** takes effect immediately with no redeploy. Frontend changes need commit + push + a Cloudflare build. **A stale `dist/` or a cached `index.html` is the usual reason a change "didn't work" — rebuild and hard-refresh before debugging code.**
- Migrations are mirrored into `migrations/*.sql` for the record after being applied.

---

## Architecture: auth & access model

- **Trustee** logs in via Supabase Auth → `authenticated` role. Access is gated by a `trustees` allowlist table and the `is_trustee()` helper; all 16 table policies use `USING(public.is_trustee())`, so a stray auth user gets nothing until explicitly added. Only auth user today: `devon.stanl@gmail.com` (`9938660a-f2bb-47d8-9eb2-8b017a6f4a00`).
  - To add a trustee: create their Auth login, then `insert into public.trustees (user_id, email) values ('<uid>', '<email>');`
- **Residents** never log in. Each unit has a `units.access_token` (uuid); a resident opens `?unit=<token>` and reads/writes only their own unit through SECURITY DEFINER RPCs: `get_unit_by_token`, `get_unit_periods`, `get_unit_statement`, `submit_remittance`, plus `get_expense_categories` (added 4 Aug — active category **names only**, no ids, no write path).

---

## Reconciliation model

- `reconcileUnits()` in `App.jsx` is the single source of truth. A unit+period is **settled** when a matched `resident_payment` bank line is within R0.05 (`RECON_TOLERANCE`) of the expected amount (statement total less any **approved** deduction), or the trustee marked that line "reviewed".
- **`bank_transactions.applied_period`** is the statement month a payment settles. A trigger defaults it to `period - 1 month` (levies for month M are paid on the M+1 statement); the trustee can retarget it to `period - 2`, `period - 1` or `period` from the Reconciliation page when a resident pays early, late, or twice in one bank month. **Only one row in the DB is currently retargeted** — Cor 6's 31 July 2026 payment, which settles the July statement rather than June.
- **`manual_payments`** are trustee-recorded payments entered before the bank statement lands (needed when the AGM falls first). Deduplication is **derived, not stored**: any manual entry is ignored the moment a real bank line exists for the same unit and `applied_period`. Both `reconcileUnits()` and the analytics module apply this same rule.

---

## Expense model (established 4 August 2026 — read this before touching analytics)

Three ledgers can hold an expense. The rule is **one expense, one ledger**:

1. **`bank_transactions`** — the cash-basis source of truth for anything that moved through the account. Debits carry `expense_category`.
2. **Approved resident deductions** (`remittance_advices.deductions` jsonb) — Body Corp expenses a resident paid personally and deducted from their levy. Each item is `{amount, comment, expenseCategory}`.
3. **`ops_expenses`** — only for expenses in *neither* of the above.

`ops_expenses.superseded_reason` (nullable text) flags a row that duplicates one of the other two. Flagged rows are kept for audit, greyed out in the UI, and excluded from every total. **All 9 existing `ops_expenses` rows are currently flagged** (6 duplicated bank lines, 3 duplicated July 2026 resident deductions), so `ops_expenses` contributes R0.00 today. Devon may delete them once reviewed — nothing was deleted automatically.

**Attribution basis (deliberately mixed):**
- **Owner Contributions** → the **statement month they settle** (`applied_period`), so a month column can be read against what that month billed.
- **Everything else** (interest, bank charges, council payments, insurance, ops expenses) → **transaction date**. These have no statement month.
- **Approved deductions** → the statement `period` they were claimed against.

Consequence: the last month of a financial year always looks uncollected until the following month's bank statement is imported. The dashboard detects this and footnotes it.

---

## Trustee screens (SideNav order)

Dashboard · Meter readings · Levy breakdown (AGM) · **Insurance** · Additional charges · Body corp expenses · Invoice allocation · Bank reconciliation · Statement preview · **Financial dashboard** · Tariffs & rates · Rate history · **Config**

---

## Rate versioning model (reworked 4 Aug 2026, session 2 — read before touching Tariffs & rates)

Water rates are stored one row per band per `effective_from` in `water_tariff_bands`. There are two *different* views of that history and conflating them was the bug fixed this session:

- **Billing view** — `waterBands` in App state. Period-scoped: the newest set with `effective_from ≤` the selected statement month. This is what statements are calculated on and must never be disturbed by editing.
- **Editing view** — the Tariffs & rates page. Anchored on **today**, not the viewed month, and works off the full history (`waterBandHistory`, keyed by effective date, built from the bands fetch already being made — no extra query).

Sets currently in the DB: **1 Jul 2024**, **1 Jul 2025**, **1 Aug 2026** (the 2026 set is ~12.5% up on 2025, except `>40-50` at +16.10%).

---

## Done on 7 August 2026, session 4

### Insurance page (new SideNav item, between Levy breakdown and Additional charges)
The insurance schedule arrives once a year as a PDF from the broker and has to become a per-unit number that bills every month. That was a manual re-key into Config. It is now `InsurancePage` in `src/App.jsx`: upload the schedule, check a preview, save.

- **Upload → review → confirm.** `parseInsuranceSchedulePdf` reads the GWK Welvaart / Renasa "Schedule of Insurance" client-side via the pdf.js already loaded for bank statements — no backend, nothing uploaded anywhere. **Nothing is written until the trustee confirms the preview**, and confirming only fills the editable grid; saving is still a separate explicit action. A parser that mis-reads the schedule must not be able to overwrite a year silently.
- **Unit mapping** is off the item header (`Item 1 - Unit 1 in extent 193 square meters …`). Items that aren't a unit are split by description into the geyser item and common property. Any unit with no matching item is listed in the preview and left untouched rather than zeroed.
- **Geyser cover is read from each item's own `Geysers - Cover as Defined: Yes/No` extension flag**, not from the free text on the geyser item. The flag is structured; the description ("4 X Geysers @ R15000 (Units 2,4,5 and 6 only)") is not.

### The allocation (trustee-confirmed, 7 August 2026)
Reproduces exactly how FY 2025/2026 was built by hand — verified against that seed, premium for premium.

| Component | Rule |
|---|---|
| Premium | The unit's own item premium **plus** an equal share of the geyser item across only the units flagged for geyser cover. **Folded into premium**, not a new column — keeps the report at nine columns and keeps last year's figures reconcilable. |
| Com prop | Common-property item premium ÷ 7, equally. |
| Sasria | Policy Sasria total ÷ 7, equally. |
| Broker | Broker fee ÷ 7, equally. (It is exactly 1% of the section premium.) |
| Per annum / per month | Derived, never stored — premium + the three charges, then ÷ 12. |

- **Rounding is shown, not absorbed.** Each per-unit figure rounds to the cent, which is how the insurer's own schedule adds up; seven of those rarely land exactly on the policy total. The `TieOut` component prints allocated vs policy total and the difference — styled calm under R1 ("expected, rounding"), amber at R1 or more ("that is more than rounding: check every item was captured"). Absorbing the remainder into one unit was considered and rejected: it hides a missed item.
- Alternatives considered and declined: splitting common property / Sasria / broker by participation quota or pro-rata to premium, and spreading the geyser item over all seven units. All would have changed every FY 2025/2026 figure.

### FY 2026/2027 loaded from `2026 Renewal.pdf`
Policy `GWK-REN-ELCOR00006 - Renewal(1)`, Renasa, cover from 1 September. Section premium R23,390.81 · common property (item 8) R471.68 · geysers (item 9) R3,600.00 across units 2, 4, 5, 6 at R900.00 each · Sasria R740.44 · broker R233.91 · **policy total R24,365.16**. Allocated R24,365.19 — **+R0.03, rounding**.

Per unit, per month: 1 R201.13 · 2 R365.60 · 3 R261.60 · 4 R306.42 · 5 R294.37 · 6 R336.85 · 7 R264.48 (**R2,030.45/month total**).

> **Unresolved:** the renewal's unit premiums are *identical* to FY 2025/2026 and it still prints "Cover Starts From 01 September 2025" despite being printed 6 August 2026 and marked Renewal(1). Filed against FY 2026/2027 on Devon's instruction. **Worth querying with GWK before the AGM** — a renewal with no movement at all in seven unit premiums is unusual.

### Insurance levy line now feeds from the schedule
`LEVY_ITEMS` "Insurance" was `null` in `computeSuggestedLevyItems` and typed in by hand. `LevySetup` now loads `insurance_schedule` for the grid's financial year itself and applies **per annum ÷ 12 per unit** — it is the one levy line that differs per unit, so it can't come from the flat suggestions object. It pre-fills via "Fill grid with calculated values" and **stays editable**, consistent with the 12 July 2026 rule that nothing in that grid is locked. With no schedule captured the strip says so and points at the Insurance page; the cell keeps whatever is in it.

### The insurance grid moved off Config rather than being duplicated
Two editable grids over one table is how the two drift apart. `AgmReportSettings` keeps the garden, Blockwatch, sewerage and sign-off fields; `INS_FIELDS` and the grid now live only on the Insurance page. AGM report section 5 is unchanged and still reads the same table.

### Migration `insurance_policy_metadata.sql`
Additive. Four columns on `agm_report_settings` (already one row per FY, which is the grain of an annual renewal): `insurance_policy_number`, `insurance_insurer`, `insurance_cover_start` (**text** — the broker's date format is not ours to depend on; displayed, never computed with), `insurance_policy_total`. Without a stored policy total there is nothing to tie the seven allocations back to. Seeds FY 2026/2027 and backfills the FY 2025/2026 policy total.

> The FY 2025/2026 seed used **R67.39** common property where the arithmetic gives **R67.38** (R471.68 ÷ 7 = R67.3829). It now ties out at R0.10 rather than R0.03 — visible, which is the point. Left as-is: that year's report is signed off.

### Section numbering
The trustee's template calls the insurance schedule section 4; the generator prints it as **5** because maintenance expenses was inserted at 4 in session 3. Confirmed 7 August 2026 to **leave the code as the source of truth** — page and report both say 5.

### Verified
- `esbuild` bundle clean (the Windows-built `rollup` native binary can't run under WSL/Linux — use esbuild to syntax-check there, or `npm run build` on Windows).
- Parser run against the real `2026 Renewal.pdf`: all 9 items, both sub-totals, policy number, insurer, cover start and total sum insured extracted correctly.
- Derived premiums match the FY 2025/2026 seed exactly: 2206.95 / 4180.62 / 2932.57 / 3470.40 / 3325.81 / 3835.61 / 2967.17.
- No stale references left in `AgmReportSettings` after the grid was removed.
- **Not yet run against the live database, and the migration has not been applied.**

---

## Done on 6 August 2026, session 3

### AGM report generator rebuilt against the trustee's updated .docx template

The trustee supplied an updated `ElCorazon-AGM-Report-FY2025-2026.docx` and asked the generator to produce that document instead of its own layout, plus the dashboard's usage trend charts under Tariffs.

**Structure now matches the template section for section:**

| # | Section | Change |
|---|---|---|
| 1 | I&E year on year | unchanged |
| 2 | I&E month to month | unchanged |
| 3 | Miscellaneous expenses | unchanged |
| 4 | **Maintenance expenses** | **new** — same table over `Repairs & Maintenance` |
| 5 | Insurance schedule | was blank cells, now DB-fed |
| 6 | Blockwatch | was 5 |
| 7 | Garden service | was 6; four rows became seven |
| 8 | **Tariffs** | water (was 7) and electricity (was 8) merged under one heading, with **8.4 Usage trends** as a landscape subsection |
| 9 | Service notes | + the "recommended these services stay with the body corporate" note |
| 10 | Levy split | unchanged |

Column headings are now `Current — FY x` / **`New — FY y`** (was "Proposed"). The footer is `Prepared YYYY/MM/DD · <prepared_by>; Checked by <checked_by>`, both from the DB.

Eight page sections now, alternating: 2, 5, 8.4 and 10 are landscape.

### Sections 3 and 4 share one builder
`itemisedFor(category)` in `fetchAgmExtras` replaced the hand-written Miscellaneous itemisation; sections 3 and 4 call one `itemisedSection()` helper. Both still cover **all three expenditure sources** (ops expenses, bank debits, approved resident deductions) and both still take their total from the report's own line in section 1, footnoting any gap rather than printing a total the rows don't support.

### Two new tables (migration `agm_report_insurance_schedule_and_settings`, + `agm_report_settings_sewerage_new`)
Mirrored in `migrations/agm_report_insurance_and_settings.sql`. Additive; nothing existing altered.

- **`units.sqm`** — floor area is a title-deed fact like `participation_quota`, so it sits on the unit rather than being re-keyed on each year's schedule.
- **`insurance_schedule`** — one row per unit per FY: `sum_insured`, `premium`, `common_property`, `sasria`, `broker_fee`. **Per annum and per month are derived, never stored** (premium + the three charges, then / 12), so a total can't drift from its components. Column totals sum the *rounded* per-unit figures — that is how the insurer's own schedule adds up.
- **`agm_report_settings`** — one row per FY: garden rate/day, increase %, proposed rate/day, visits/month, bonus + due date, increase effective date, blockwatch current/proposed, the services-note estimate, `sewerage_per_unit_new`, and `prepared_by`/`checked_by`.
- Both RLS-enabled, trustee-only via `is_trustee()`. Seeded with the template's FY2025/2026 figures, so the report reproduces it out of the box.
- **Projected annual garden cost is not stored** — it is proposed rate × visits/month × 12, so it can't fall out of step with the rate.
- `sewerage_per_unit_new` exists because the New column had **no source at all**: `council_invoices` only carries the rate being billed now, and next year's isn't published yet. It was a permanent blank.

### Config screen: "AGM report figures" card
New `AgmReportSettings` component under the categories card. FY selector (current body-corp FY plus the three before it), the insurance grid with live derived per-annum/per-month, and the settings fields. *(Session 4: the insurance grid moved off this card to the Insurance page — see below. The garden/Blockwatch/sewerage/sign-off fields stay here.)* Text inputs with `inputMode="decimal"` and a comma-tolerant parser — **not `type="number"`**, for the reasons already recorded under session 2 (en-ZA renders `33.57` as `33,57` and strips trailing zeros). A blank field still renders that report row as an empty cell to complete in Word, which is how the whole section used to work.

### Usage trend charts embedded as PNGs (§8.4)
- `TrendChart`'s JSX was replaced by **`buildTrendChartSvg()`, a pure SVG-string builder**, with the component now a thin wrapper around it. The report rasterises the same string, so **a chart in the document cannot drift from the chart on screen**. `usageTrendSeries()` likewise defines the three series once for both.
- `buildTrendChartSvgWithLegend()` bakes the legend into the SVG — a docx image carries nothing with it, unlike the screen where the HTML legend sits alongside.
- Fonts are named with generic fallbacks on **every** text node: inline SVG picks up the page's webfonts, but an SVG loaded into an `Image` for rasterising has no access to them and falls back to serif.
- `svgToPngBytes()` draws through an offscreen canvas at 2x and **returns null rather than throwing** — older Safari taints a canvas an SVG has been drawn into. The section then prints a line pointing at the dashboard and the document is still produced. Same for a failed usage fetch, which is caught in `generateAgmReport` rather than failing the export.
- Usage is fetched in `generateAgmReport`'s `Promise.all`, **not read off the rendered charts**, so the report doesn't depend on the trends card having finished loading.

### Verified
`vite build` clean. The generator was then bundled with esbuild and run in Node against the template's own FY2025/2026 figures, and the output diffed cell by cell against the uploaded .docx. Every table matches except:

- **Template arithmetic:** Unit 3 per annum reads `R 3 139,15`; 2 932,57 + 67,39 + 105,78 + 33,42 = **3 139,16**. The schedule total is a cent out for the same reason.
- **Template typos:** `R 12 107.89`, `R2 160 000.00` and `R 697.73` use a decimal point where every other figure uses a comma.
- **Deliberate:** `Proposed salary for FY 2026/2027` rather than the template's hardcoded `FY27`; em dashes throughout rather than the template's mix of hyphen and en dash; the stray trailing `-` on the garden actual-cost label dropped.

A genuine R0.00 levy line now prints `R 0,00`; an empty cell is reserved for a figure never captured, which says something different.

---

## Done on 6 August 2026, session 2

### 1. Invoice allocation module reworked
Frontend only — no DB changes. All three were trustee-requested.

- **"Confirm allocation & generate statements" moved to Meter readings**, sitting beside "Save readings" (which drops to secondary styling). Readings are the last input before statements can be produced, so the action belongs at the end of that page. **The button is still a no-op stub** — it has no `onClick` and never did. Wiring it up is outstanding.
- **The per-unit allocation table and both explanatory paragraphs were removed** from the Allocation page. It is now the heading plus the two bulk council-invoice cards. Per-unit figures live on Levy breakdown and Statement preview.
- **Bulk water and bulk electricity now default to 0,00 when no bill has been captured for the month.** This was a real data-integrity bug, not cosmetics: `loadAppData` fell back to the hard-coded `COUNCIL_INVOICE` seed (66 kL / R951.19 / 2 374 kWh / R6 114.24 — actual **June 2026** figures) whenever `council_invoices` had no row for the selected period. Last month's numbers therefore presented as this month's with nothing on screen saying so.

**How it works now:** new `COUNCIL_INVOICE_NO_BILL` constant zeroes only the four bulk fields; `loadAppData` returns `councilInvoiceMissing: !inv` alongside it. That flag is threaded into `UtilityBills` and `Allocation` as `billMissing`, and it:
- renders an amber "no council bills captured for <month>" notice on both;
- suppresses the common-property provision check, which would otherwise read a nonsense negative gap against a zero bulk figure;
- clears itself the moment bill figures are saved (a row then exists).

The bill-driven per-unit inputs (Water Demand Levy, Sewer, Electricity Service/Network) deliberately still carry forward — they barely move month to month and only feed the AGM levy suggestions, so zeroing them would break the levy grid for no benefit.

### 2. Gmail import outage found and documented
**The daily import has been dead since 14 July 2026.** `cron.job_run_details` reported `succeeded` every single day throughout, because pg_cron only sees that the HTTP request was *queued* — it never sees the response. The actual response in `net._http_response`:

```
500  {"ok":false,"error":"Gmail token error: {"error":"invalid_grant","error_description":"Bad Request"}"}
```

The Gmail OAuth refresh token is dead. **Leading hypothesis: the Google OAuth consent screen is still in "Testing" status**, where Google expires refresh tokens after 7 days unconditionally. The edge function was created 14 July and the last successful import was 14 July — the dates fit. Publishing the consent screen to "In production" removes the timer permanently (no Google verification needed for a personal-scale app; you accept an "unverified app" warning at consent instead).

Consequence for the app: no council bills and no bank statements have imported for August. Which is precisely the condition the zero-default above now surfaces honestly instead of hiding behind June's figures.

**`docs/RUNBOOK-gmail-import.md`** was written to cover this end to end: diagnosis queries, an error-to-cause table, the full re-mint procedure, how to test without waiting for 04:00, how to force a retry of a stuck email, and a monthly health check. **Read it before debugging this again — the "cron says succeeded" trap will otherwise cost an hour every time.**

Reference facts worth having to hand: secrets are `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` / `CRON_SECRET` on the edge function; the cron's shared secret is the Vault entry `gmail_import_cron_secret`; the required scope is `gmail.modify` (**not** `readonly` — the function applies `Imported` / `Needs review` labels, and without them every email reprocesses forever); watched accounts are CoJ water `300993014`, CoJ electricity `220022810`, FNB `61123184551`.

---

## Done on 6 August 2026, session 1

Both pieces live on the **Financial dashboard** (`tab === "analytics"`). No DB changes were made this session — read-only additions.

### 1. Usage trend charts (commit `d9806d9`)
Two hand-rolled SVG line charts at the foot of the dashboard, inside `.print-area`, driven by the page's existing financial-year selector. No chart library.

- Three series each (electricity kWh, water kL): **CoJ bulk meter**, **all units combined**, and a dotted **units + common-property provision** line.
- The dotted line is deliberately *units plus the flat provision* (20 kL / 300 kWh from `levy_rates`), **not** "bulk minus meters". The derived gap goes negative in several months because council invoice periods don't align with reading months; that discrepancy already has a home on the Utility bills provision check.
- Read the dotted line against the bulk line: below it means consumption nobody was billed for, above it means the complex billed more than the council metered.
- `niceAxis()` sizes the gridline step first and rounds the maximum up to a multiple of it. Rounding the maximum to a round number instead (the obvious approach) squashed the lines into the bottom third — 2,975 became a 5,000 axis.
- Null-safe paths: a month with no data lifts the pen rather than drawing through zero.

**Finding worth acting on:** across FY 2025/2026 the allocated line sits *above* the bulk line in most months — **2,442 kWh and 151 kL more allocated than the council metered**, about R6,300 of electricity at R2.58. Worst months Apr 2026 (−926 kWh, −41 kL) and Dec 2025 (−849 kWh). Some is the known timing mismatch, but twelve months should largely wash out and this doesn't. Candidates: the flat provision being added on top of consumption the unit meters already capture, or under-captured bulk figures on `council_invoices`. **Worth resolving before the September report** — over-recovery is queryable at the AGM.

### 2. AGM annual report generator (commit `cd333e8` + follow-ups)
A **Generate AGM report** button beside Print / PDF produces an editable `.docx` for the selected FY.

- **Recovered from git history, not written from scratch.** A docx generator existed at commit `f790331` (16 July) and was removed before `67e2b87` (29 July). `git log --all -S"<string>"` found it. **Check history before rebuilding anything on this project.**
- Ten sections per the trustee's spec: (1) I&E year-on-year, (2) I&E month-to-month, (3) miscellaneous expenses, (4) insurance schedule, (5) Blockwatch, (6) garden service, (7) water tariffs, (8) electricity tariffs, (9) service notes, (10) levy split.
- **Six page sections alternating portrait/landscape** so no rand value ever wraps: sections 2, 4 and 10 are landscape; the rest portrait. Section 2 and 10 additionally render at 8pt with tight cell margins. Section 2 drops the `R` prefix on month columns (14 columns don't otherwise fit) and says so.
- **Every rand value uses non-breaking spaces** — en-ZA formats as `R 1 234,56`, and `nb()` converts each space to ` `.
- Sections 1, 2, 3 and 6 read the **dashboard's own `report` object**, passed straight in — no recomputation, so the document cannot disagree with the screen. Sections 3, 5, 7, 8 and 10 read the DB directly via `fetchAgmExtras`.
- `loadFyReport(fy, categories)` was extracted from the Analytics effect to module scope so the comparative prior year can be loaded without duplicating the fetch. Dashboard behaviour is unchanged.
- **Section 3 itemises all three expense sources** — `ops_expenses`, bank debits, *and approved resident deductions*. The first version omitted deductions and showed one row of R6,999.00 against a Miscellaneous line of R8,052.43. Each claim line carries its own `comment`; the claim-level `deduction_comment` is a concatenation of them all and must not be used per item.
- Fields with no table behind them (insurance schedule detail, garden salary/increase/bonus, Blockwatch proposed fee) render as **blank editable cells**, by decision — the report is meant to be completed in Word.

**Tariff lookups differ by table on purpose:** `water_tariff_bands` has a populated `financial_year` and is keyed on it. `electricity_rates` does **not** — the FY2026/2027 rate (R2.81, effective 2026-07-01) was captured with a **null `financial_year`**, so it is resolved by newest `effective_from ≤` the FY start. Backfilling that row to `2026/2027` would be tidier.

---

## Done in session 2 (4 August 2026)

### 1. Tariffs & rates rebuilt
**Bug:** updating the rates for 1 Aug 2026 still showed 1 Jul 2024 as "previous". Cause — both columns were resolved once at load from the *selected statement period* (July 2026 → active 1 Jul 2025, previous 1 Jul 2024), and typing a new effective date only changed the date field; nothing re-resolved which sets were shown.

- The **"Effective from" input is gone**. The page now shows **Previous · Current · Next** columns derived from today's date, plus a "Later" column for any set beyond next. On 4 Aug: previous = 1 Jul 2025, current = 1 Aug 2026, next = empty.
- **"+ Add new rates"** asks for the effective date (rejects a date that already has a set, or one not in the future), then opens a column pre-filled by carrying the current set forward, marked "unsaved".
- **Current and future sets are editable; superseded sets are read-only** — a stray keystroke can't re-price statements already issued.
- The water card holds **its own draft state** and never writes into app-wide `waterBands`. Saving writes to the DB and bumps `dataVersion`, which re-runs the loader so every screen picks the change up without a refresh.
- `saveTariffsToDb` now takes `waterSets: [{ effectiveFrom, bands }]` (was a single set + date) and writes **only the sets actually touched** — untouched history is never rewritten.
- Increase % compares the two right-most columns, so it always describes the newest change.

### 2. Table layout & number formatting (Tariffs & rates + Meter readings)
- Both tables: `table-layout: fixed` + an explicit `<colgroup>` for equal column widths, one shared cell style for uniform row height, everything centred, wrapped in a horizontal-scroll container. Auto-sizing was the reason earlier alignment fixes didn't take.
- **`<input type="number">` was the formatting culprit**: the browser renders its value through the en-ZA locale, so a rate showed as `33,57` beside a read-only `33.57`, and trailing zeros were stripped (`100,4`). Both tables now use `type="text"` + `inputMode="decimal"` with a shared two-decimal formatter applied on blur. Don't reintroduce `type="number"` for money or meter values.
- Meter readings additionally now parses a comma decimal. `parseFloat("1234,5")` previously returned `1234` — a comma-typed reading would have silently under-billed usage.
- A genuine R0.00 band now displays `0.00`; `—` is reserved for a band absent from that rate set.

### 3. Period rollover & new-FY levy carry-forward
- `fetchAvailablePeriods` only offered months that already had `monthly_usage` rows, plus the hard-coded `CURRENT_PERIOD`. August 2026 was therefore unreachable, so `FY_ACTIVE` could never become 2026/2027 and **FY27 levies could not be set up at all**. It now always prepends the month after the newest with data. The app still opens on July 2026 — only the selector changed.
- `levy_rates` and `levy_manual_entries` are fetched for `FY_ACTIVE` **and** `FY_PREVIOUS` in one `.in()` query (no extra round trip). An FY with no saved rows pre-fills from last year's grid with an amber "not set up yet" banner, instead of silently falling back to the source-code `LEVY_BREAKDOWN_DEFAULT`, which is years stale. `commonPropertyElectricityKwh` falls back the same way.
- The Levy breakdown heading now names the year it is editing ("Levy breakdown — FY 2026/2027"). Saving triggers a reload so the banner clears.

---

## Done in session 1 (4 August 2026)

### 1. Config module (`tab === "config"`)
Trustee-managed CRUD over `expense_categories`: add, rename, reorder (↑/↓, renumbers 1..n), retire/reactivate, delete. Shows a live "records using it" count per category.
- **Rename goes through the `rename_expense_category(old, new)` RPC**, never a plain UPDATE — it cascades to `bank_transactions.expense_category`, `ops_expenses.category`, `additional_charges.expense_category` and the `remittance_advices.deductions` jsonb in one transaction. A plain update would orphan historic records.
- **Delete is guarded** by `delete_expense_category(name)`, which raises if anything still references the category. Retire is the correct action for a supplier no longer used — it hides the category from new dropdowns while past records stay tagged and reported.

### 2. Expense tagging at four entry points
All fed by one shared component, `ExpenseCategorySelect`, backed by a module-level cached fetch (`loadExpenseCategoryNames`, invalidated by `invalidateExpenseCategoryCache()` after Config edits):
- **Bank reconciliation** — dropdown on every debit line, plus an "N untagged expenses" counter. This is the primary tagging point.
- **Body corp expenses** — the hard-coded `OPS_EXPENSE_CATEGORIES` array is **gone**; rows are retaggable inline.
- **Resident deduction claims** — residents can tag each line when submitting; the trustee can retag from the deduction panel on Bank reconciliation (residents often don't, or pick wrong).
- **Additional charges** — optional "cost recovery for…" tag. Memo only; never netted off expenditure.

A dropdown keeps a value that has since been retired, so historic records never silently revert to untagged.

### 3. Financial dashboard (`tab === "analytics"`)
Income & expenditure statement for the body corp FY (Aug–Jul), self-fetching, with a year selector that **defaults to the newest FY with data** rather than the calendar-current FY (on 4 August the new FY is four days old and would render empty).
- Income rows: Owner Contributions, Interest Earned, Other Credits. Expense rows: one per **active** category (dynamic — adding a category adds a line), plus an **Unclassified** row so nothing is ever dropped. Then Surplus/Deficit.
- "Show monthly breakdown" toggles 12 month columns (classic annual-report layout). Print/PDF via the existing `.print-area` / `.no-print` CSS.
- Owner Contributions are **grossed up by approved deductions** on purpose: a resident owing R5,000 who pays R4,326 cash after paying the gardener R674 directly has still contributed R5,000. Booking only the cash while also booking the expense would understate the surplus twice.
- Bank fetch is widened 3 months either side of the FY (`applied_period` can trail the bank month by up to 2), and out-of-window values are dropped during bucketing.
- **Dynamic footnotes** ("Notes to the statement") with superscript markers on affected rows. Generated from the figures, so they appear, renumber and vanish on their own: deductions component; manual allocations itemised by unit and month; per-line cost recoveries; untagged expenditure; and an incomplete-year caveat on the Surplus row. A static "Basis of preparation" block sits below them.

### 4. Migrations applied (mirrored in `migrations/expense_tagging_config_and_analytics.sql`)
- `expense_tagging_columns_and_ops_supersede` — `additional_charges.expense_category`, `ops_expenses.superseded_reason`, legacy label normalisation, duplicate flagging, `rename_expense_category` extended to cover `additional_charges`.
- `expense_category_usage_and_guarded_delete` — `expense_category_usage()`, `delete_expense_category(text)`.
- `get_expense_categories_readable_by_residents` — anon-callable, active names only.

### 5. Position at close of session
Devon tagged every outstanding debit and deduction, so **Unclassified is R0.00**. FY 2025/2026 as at 4 Aug 2026:

| | |
|---|---|
| Owner Contributions | 227,470.06 *(bank 206,685.12 + manual 5,245.92 + deductions 15,539.02)* |
| Interest Earned | 10,670.85 |
| Other Credits | 0.00 |
| **Total income** | **238,140.91** |
| **Total expenditure** | **249,964.30** |
| **Deficit** | **(11,823.39)** |

The deficit is a **data-completeness artefact, not a real loss**: five units' July 2026 levies land on the August 2026 bank statement, which isn't imported yet. Importing it should swing this back to a surplus. The dashboard footnotes this on the Surplus row until the statement arrives.

---

## Carried over from 3 August 2026 (commit `85907bf`)
Reconciliation moved onto `applied_period`; `manual_payments` table and UI added. Both are load-bearing for the analytics module above.

---

## Outstanding / next steps

**Immediate**
- **Enter the FY 2026/2027 levies.** Select **August 2026** in the period selector, open Levy breakdown, apply the AGM increases over the carried-forward FY2025/26 figures, save. `levy_rates` and `levy_manual_entries` currently hold **2025/2026 only** — nothing exists for FY27 yet.
- **Import the August 2026 bank statement** — closes out FY2025/26, supersedes the two manual allocations (Unit 1 R3,865.29, Unit 2 R1,380.63) automatically, and clears the incomplete-year footnote.
- Review and delete the 9 superseded `ops_expenses` rows once satisfied they are genuine duplicates.
- **Fix the Gmail import** — it has imported nothing since 14 July. Follow `docs/RUNBOOK-gmail-import.md` §3: publish the OAuth consent screen to production, re-mint the refresh token via the OAuth Playground with scope `gmail.modify`, update `GMAIL_REFRESH_TOKEN`, then test with the manual `net.http_post` in §5. Until this is done, August bills and bank statements will not arrive.
- **The July 2026 FNB statement is stuck at `needs_review`** and will *not* retry on its own — it is already labelled in Gmail. Forcing it needs both the Gmail label removed and the `email_imports` row deleted (runbook §6).
- **Mirror the `gmail-import` edge function source into the repo** (`supabase/functions/gmail-import/index.ts`). It currently exists only in Supabase; losing the project loses the function.
- **Delete the stale git lock** `.git\objects\maintenance.lock` — `del .git\objects\maintenance.lock`. The sandbox cannot remove it. (Recreated 6 Aug: the working agreement below was breached — a `git fetch` was run from the sandbox before that rule was read. See "Read this summary at the start of each new conversation".)

**Deployment & ops**
- **Two Supabase dashboard toggles still pending** (can't be done via SQL):
  1. **Disable public sign-ups** (Authentication → Providers) — this is what makes the trustee allowlist airtight.
  2. **Enable leaked-password protection** (HaveIBeenPwned) — optional, free.
- `/api/notify-remittance` (remittance email via Resend) is a **stub** and 404s on static hosting until a serverless function is added. Email notifications are not live.
- Advisor warnings remaining are known and acceptable: the token RPCs and `get_expense_categories` are intentionally anon-callable; `pg_net` in `public`. **Zero advisor errors.**

**Billing logic (still unverified — carried over)**
- `deriveIndividualWaterBands()` — confirm it implements the **6kL minimum-charge threshold** rule (usage >6kL uses the real scale incl. the free first 6kL; usage ≤6kL bills every kL at the first paid rate). Earlier notes flagged it may still use the old "merge free band for everyone" logic.
- Electricity rate convention: seed is R2.5755 (municipal) vs app default R2.58 (rounded). Confirm the canonical production value.

**Product**
- **Reconcile the usage over-allocation** (see 6 Aug, item 1): 2,442 kWh and 151 kL more allocated than metered across FY2025/26. Decide whether it's the flat provision double-counting or under-captured bulk figures, before the September report.
- Annual report generator — **built 6 Aug** (editable .docx, ten sections). Still to confirm STSMA audit / independent-review sign-off with the scheme's accountant, and whether a balance sheet is required.
- **Capture FY2026/2027 rates so the AGM report's "proposed" columns fill themselves.** Present: water bands (all 8). Missing: a `levy_rates` row for 2026/2027 (common-property provisions, water demand levy, electricity service and network charges) and a `levy_manual_entries` grid — section 10 carries this year's figures forward and labels itself as doing so.
- Backfill `electricity_rates.financial_year = '2026/2027'` on the R2.81 row (currently null; resolved by `effective_from` instead).
- **Wire up "Confirm allocation & generate statements."** It has been a no-op stub since it was written; moving it to Meter readings hasn't changed that. Decide what it should actually do — most likely persist the computed statement rows for the period so a statement can't drift after it's issued.
- **Add monitoring for the Gmail import** so a silent failure surfaces in days, not weeks. Runbook §7 has the two queries; a scheduled task on the 10th of each month would do it.
- Real owner names in `units` (pending the public-GitHub-exposure decision).
- Deduction-approval edge cases (proof never produced; claimed amount ≠ actual invoice).
- The incomplete-year footnote hard-codes the word "July". Correct for an Aug–Jul FY; would need updating if that convention ever changes.

**Known rough edges from session 2 (deliberate, not bugs)**
- `CURRENT_PERIOD` is still hard-coded `"2026-07-01"`, so the app opens on July even though August is now selectable. Deriving it from today's date was considered and deferred — it would make the app open on an empty month before readings are captured.
- The **1 Aug 2026 water rates exist but bill nothing until the selected period reaches August 2026.** Same for the FY27 levies once entered.
- The carried-forward levy grid is unsaved app state: switching period away and back before saving discards the edits. A confirm-on-leave guard was offered and not built.

---

## Working agreements
- Consider long-term effects before changing the **live** DB; when uncertain, ask. Keep credit usage low; prefer the simplest change that works.
- **Never delete live financial records to "clean up" — flag them instead** (see `superseded_reason`). Let Devon decide.
- Read this summary at the start of each new conversation.
- **The Claude Project knowledge base holds a badly stale copy of `App.jsx`** — 3,520 lines against the real 6,200, missing `applied_period`, manual payments, expense categories, the financial dashboard and the Aug–Jul FY helpers. **Never read or patch it.** The only source of truth is `G:\Claude Playground\CoWork\el-corazon-web\src\App.jsx`. (6 Aug: three changes were built against the cached copy and had to be redone.)
- **The `G:\` mount takes a few seconds to appear at session start.** If the first directory listing doesn't show `el-corazon-web`, wait and list again — do **not** fall back to the Project knowledge copy, which is what caused the above.
- Claude cannot write to the Claude Projects knowledge base — **this file must be copied in manually** to update it. The repo copy at `El-Corazon-Project-Summary.md` is the master.
- Git: the remote occasionally has commits not present locally (multi-machine). **Always `git pull --rebase origin main` before starting new work**, and commit before pulling — rebase refuses to run on a dirty tree. During a rebase, `--ours`/`--theirs` are reversed vs a normal merge.
- **Do not run git commands against `G:\` from the Linux sandbox** — not even read-only ones like `git status` or `git diff`. It creates `.git/*.lock` files it has no permission to remove, which then block Devon's own git. If it happens: `del .git\index.lock`, `del .git\HEAD.lock`, `del .git\objects\maintenance.lock`.
- **Line endings are a false alarm from the sandbox.** Devon's Git has `core.autocrlf=true`: the repo stores LF, Windows checks out CRLF. The Linux sandbox doesn't apply `autocrlf`, so cleanly-checked-out files (`package.json`, `package-lock.json`, `src/App.jsx`) look "modified" there when they are not. **Never advise `git restore` on that evidence** — confirm with `git status` on Windows first.
- **Verify frontend changes with esbuild, not `npm run build`.** The sandbox can't run the project's Vite build (the `rollup` native binary in `node_modules` is the Windows one). This works and catches syntax/reference errors:
  `npx --yes esbuild@0.25.0 <path>/src/App.jsx --loader:.jsx=jsx --bundle --external:react --outfile=/tmp/out.js`
- **Test document generators headlessly before handing over a sample.** The AGM exporter was verified by extracting the real function from `App.jsx` with `new Function(...)`, injecting stubs for `window.docx`/`document`/`URL`, running it, then unzipping the `.docx` and parsing `word/document.xml` — checking heading order, page-section orientation, table dimensions and that no text run contains a breakable space between digits. **Parse the XML properly; a regex over `<w:t>` breaks on self-closing empty cells and silently swallowed three headings.**
- **Label sample output loudly when the figures are fabricated.** A layout sample generated from placeholder numbers was handed over with the caveat buried, and Devon reasonably read it as real data that disagreed with the dashboard. Say it first, not last.
- **Search git history before building anything that sounds like it might already exist** — `git log --all --oneline -S"<distinctive string>" -- <path>`. The AGM generator had been written once already and deleted.
- **`raw.githubusercontent.com` serves stale cached copies** and truncates large files. It showed a three-week-old `App.jsx` containing code no commit on `main` had. Read the working tree instead.
