# El Corazon Body Corporate — Finance Trustee App
**Project summary / working notes**
Last updated: 4 August 2026 (supersedes the 17 July 2026 summary)

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

## Done in this session (4 August 2026)

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
- **Import the August 2026 bank statement** — closes out FY2025/26, supersedes the two manual allocations (Unit 1 R3,865.29, Unit 2 R1,380.63) automatically, and clears the incomplete-year footnote.
- Review and delete the 9 superseded `ops_expenses` rows once satisfied they are genuine duplicates.

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

---

## Working agreements
- Consider long-term effects before changing the **live** DB; when uncertain, ask. Keep credit usage low; prefer the simplest change that works.
- **Never delete live financial records to "clean up" — flag them instead** (see `superseded_reason`). Let Devon decide.
- Read this summary at the start of each new conversation.
- Claude cannot write to the Claude Projects knowledge base — **this file must be copied in manually** to update it. The repo copy at `El-Corazon-Project-Summary.md` is the master.
- Git: the remote occasionally has commits not present locally (multi-machine). **Always `git pull --rebase origin main` before starting new work**, and commit before pulling — rebase refuses to run on a dirty tree. During a rebase, `--ours`/`--theirs` are reversed vs a normal merge.
- **Do not run git commands against `G:\` from the Linux sandbox.** It creates `.git/*.lock` files it has no permission to remove, which then block Devon's own git. If it happens: `del .git\index.lock`, `del .git\HEAD.lock`, `del .git\objects\maintenance.lock`.
