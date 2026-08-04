# El Corazon Body Corporate — Finance Trustee App
**Project summary / working notes**
Last updated: 4 August 2026, session 2 (supersedes the 17 July 2026 summary)

> Devon is the finance trustee for **El Corazon**, a 7-unit residential body corporate in OntdekkersPark (1709), South Africa. This app manages monthly levy statements, water & electricity billing, bank reconciliation, resident remittance advices, expense tracking and the annual income & expenditure statement. Devon builds and deploys it directly.

---

## Infrastructure (current)

- **Repo:** `https://github.com/destanley/Body-Corporate-Web-App` (branch `main`)
- **Local working folder:** `G:\Claude Playground\CoWork\el-corazon-web`
- **Live app file:** `src/App.jsx` — the file `main.jsx` imports and the only one that renders. Single-file app, ~4,500 lines. (The old `src/ElCorazonWebApp_5.jsx` duplicate is **deleted**; don't reintroduce it.)
- **Build tooling:** Vite 7 + `@vitejs/plugin-react` 4.7 (React 18). Pinned to Vite 7 deliberately — Vite 8/Rolldown caused a `jsx` peer-dependency failure. Supabase config comes from env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`).
- **Hosting:** Cloudflare Pages (free), auto-deploys on push to `main`. Build command `npm run build`, output dir `dist`, framework preset "None". SPA routing via `public/_redirects` and `vercel.json`.
- **Supabase project:** `ctqyxxlnnrgtyyxubsle` (org `liciwrkhrrsserpzjjzn`, eu-west-1, Postgres 17, "El Corazon").
- **Edge function:** `gmail-import` writes `email_imports` using the service role (bypasses RLS).
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

Dashboard · Meter readings · Levy breakdown (AGM) · Additional charges · Body corp expenses · Invoice allocation · Bank reconciliation · Statement preview · **Financial dashboard** · Tariffs & rates · Rate history · **Config**

---

## Rate versioning model (reworked 4 Aug 2026, session 2 — read before touching Tariffs & rates)

Water rates are stored one row per band per `effective_from` in `water_tariff_bands`. There are two *different* views of that history and conflating them was the bug fixed this session:

- **Billing view** — `waterBands` in App state. Period-scoped: the newest set with `effective_from ≤` the selected statement month. This is what statements are calculated on and must never be disturbed by editing.
- **Editing view** — the Tariffs & rates page. Anchored on **today**, not the viewed month, and works off the full history (`waterBandHistory`, keyed by effective date, built from the bands fetch already being made — no extra query).

Sets currently in the DB: **1 Jul 2024**, **1 Jul 2025**, **1 Aug 2026** (the 2026 set is ~12.5% up on 2025, except `>40-50` at +16.10%).

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
- **Delete the stale git lock** `.git\objects\maintenance.lock` (dated 4 Aug 09:18) — `del .git\objects\maintenance.lock`. The sandbox cannot remove it.

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
- Annual report generator (due each September) — the Financial dashboard now covers the income & expenditure statement and prints to PDF. Still to confirm STSMA audit / independent-review sign-off with the scheme's accountant, and whether a balance sheet is required.
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
- Claude cannot write to the Claude Projects knowledge base — **this file must be copied in manually** to update it. The repo copy at `El-Corazon-Project-Summary.md` is the master.
- Git: the remote occasionally has commits not present locally (multi-machine). **Always `git pull --rebase origin main` before starting new work**, and commit before pulling — rebase refuses to run on a dirty tree. During a rebase, `--ours`/`--theirs` are reversed vs a normal merge.
- **Do not run git commands against `G:\` from the Linux sandbox** — not even read-only ones like `git status` or `git diff`. It creates `.git/*.lock` files it has no permission to remove, which then block Devon's own git. If it happens: `del .git\index.lock`, `del .git\HEAD.lock`, `del .git\objects\maintenance.lock`.
- **Line endings are a false alarm from the sandbox.** Devon's Git has `core.autocrlf=true`: the repo stores LF, Windows checks out CRLF. The Linux sandbox doesn't apply `autocrlf`, so cleanly-checked-out files (`package.json`, `package-lock.json`, `src/App.jsx`) look "modified" there when they are not. **Never advise `git restore` on that evidence** — confirm with `git status` on Windows first.
- **Verify frontend changes with esbuild, not `npm run build`.** The sandbox can't run the project's Vite build (the `rollup` native binary in `node_modules` is the Windows one). This works and catches syntax/reference errors:
  `npx --yes esbuild@0.25.0 <path>/src/App.jsx --loader:.jsx=jsx --bundle --external:react --outfile=/tmp/out.js`
