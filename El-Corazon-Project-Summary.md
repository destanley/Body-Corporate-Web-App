# El Corazon Body Corporate — Finance Trustee App
**Project summary / working notes**
Last updated: 11 August 2026, session 18 (supersedes the 11 August 2026 session 17 summary)

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

## Done on 11 August 2026, session 18 — the water review leaves the AGM report

### The water charged-vs-billed section is out of the generator

Session 12 made "Water — charged by CoJ vs billed to owners" a permanent section of the AGM
report on the reasoning that a one-off markdown file would be invisible at every meeting after
this one. **The trustee has decided it is genuinely a one-off**: the meeting takes the decision
once, and after that the section is a standing reminder of a question already answered. It is
removed.

- **Deleted:** the `W` landscape section block, its entry in the docx section list, and
  `fetchWaterReconciliation()` (~160 lines) with its `Promise.all` slot in the AGM builder.
- **Renumbered:** service notes 11→10, levy split 12→11, PMR 22 plan 13→12, budget 14→13, plus
  the three prose cross-references that named those numbers.
- **Carried by** `docs/El-Corazon-Water-Billing-AGM-2026.pdf` instead — a five-page standalone
  pack for the 2026 meeting, ending in six numbered resolutions.

**No billing code was touched.** The August 2026 minimum-charge rule (session 5) is still what
the app bills on; everything below is a proposal for the meeting, not shipped behaviour.

### The option-D analysis was partly wrong, and is corrected

`docs/water-billing-option-D-FY2025-2026.md` claimed the app's fixed 6/4/5 kL monthly band
widths were a defect because CoJ pro-rates its own steps by days. **That inference does not
hold.** CoJ pro-rates *because its reading periods are irregular* — 24 to 36 days, never a
calendar month. Ours are always calendar months, so the unmodified monthly widths are already
correct: over a year the two free allowances differ by **0.05 kL per unit** (71.95 vs 72.00).

The original option D applied CoJ's day-scaled widths to calendar-month unit readings, mixing
two incompatible period bases. Rebuilt on calendar months the per-unit figures move by under
R35 a year, so the conclusion held, but the method did not. §§3–7 of that document are rewritten;
§§1–2 (the invoice reconstruction and the 2026-02 discrepancy) are unaffected.

### What forced the redesign: statements go out on the 1st

Levy statements are issued on the 1st for the month just ended. On that date the council invoice
for the period **has not arrived** — and for 2026-02 it never did. That rules out pricing off the
invoice, and it rules out a monthly reconciliation factor: modelled monthly the factor swings
**0.448 to 1.887, a 4.2× spread**, because CoJ's reading window is offset ~6 weeks and drifts.
A 1- and 2-period lag narrows it only to 3.9× and 3.1×.

Option D therefore became **a rate card fixed once a year**: CoJ's step rates, capped at the
highest step the complex itself is billed at, multiplied by a factor set at the AGM and trued up
the following year. On FY2025/2026 the factor is **0.9543**, giving free / **R28.48** / **R29.73**
per kL. The trustee needs nothing but the meter readings to bill on the 1st.

### A third defect, missed the first time

CoJ gives the complex **504 kL free a year** (6 kL × 7 units × 12) and applies it to the *complex
total*. The units claimed only **404.5 kL** — Units 2, 4 and 7 never come near their 6 kL — and
CoJ let the remaining **99.5 kL** absorb the heavier households' usage. Per-unit laddering throws
that away. **This is what the reconciliation factor exists to hand back**, and it is why the
factor sits below 1.

**Unchanged and still outstanding:** the R9,083.55/year margin (R108.14/unit/month), the
2026-02 invoice discrepancy (R1,216.06 recorded against R940.34 reconstructed), the 20 kL
common-property provision at 2.9× actual use, and Unit 2's −5.43 kL December reading.

---

## Done on 11 August 2026, session 17 — landing pages, a password page, and less chrome

### Each user gets a landing page

`trustees.landing_page`, set from a dropdown on User management that offers **only the pages that user can actually see**, so you can't pick a screen they'd be bounced off. `my_trustee_profile()` returns it and the app opens there at sign-in.

**It is stored as a hint, not an instruction.** No foreign key or check constraint: the page keys live in `NAV_PAGES` in the app, not the database, so a constraint would need migrating every time a screen is added or renamed. The price is that the column can name a page the user has since lost — after a role change or a page-list edit — so `resolveLandingPage()` honours it only if it's among their visible pages and otherwise falls back to their first one. **Landing someone on a blank screen because of a stale preference is worse than ignoring the preference.** Where a stored choice has been stranded, the User management row says so rather than leaving a dropdown that quietly does nothing.

Applied **once per sign-in**, guarded by a ref. Without that guard the effect would drag you back to your landing page every time the profile is re-read — which User management does after each edit — so a finance trustee landing on the Dashboard couldn't stay on User management long enough to make a second change.

### Password management is its own page

Moved off the bottom of Config. It's now the single `alwaysOn` page — nobody can be denied it, because a user who can't reach their own password has to ask the finance trustee to set it for them, which is the thing the screen exists to prevent.

**Consequence worth noting:** Config was `alwaysOn` *because* it carried the password card. With that gone, **Config is now an ordinary page the finance trustee can grant or withhold.** A non-finance trustee who still has it sees only the "maintained by the finance trustee" note.

### Removed
- **The trustee/resident view switch** in the top bar. Residents don't reach the app that way — they arrive on a per-unit token link (`?unit=<token>`), which is the real resident experience and the one worth testing. `ResidentPortal` is untouched and still renders there.
- **The period selector** on User management and Password management, via a `noPeriod` flag on `NAV_PAGES`. The month is dropped from the header on those pages too. A user list under "August 2026" invites the reader to think the list is somehow scoped to August.

### Also fixed
Unticking every page and saving looked like it removed someone's pages but silently restored the role defaults — an empty list and a missing list both read as "use the defaults" everywhere. It now refuses and points at "Back to role defaults", which is the button that actually means that.

### Verified
`esbuild` parse clean. The landing-page and nav logic was tested by **slicing the real `NAV_PAGES` / `visibleNavPages` / `resolveLandingPage` source out of `App.jsx` and importing it** — testing the shipped code rather than a copy that could drift. 20 assertions, all passing, including every fallback:

| Case | Result |
|---|---|
| no preference, each of the three roles | Dashboard |
| maintenance → Maintenance plan | honoured |
| maintenance → Bank recon (can't see it) | falls back to Dashboard |
| approver → User management (finance-only) | falls back to Dashboard |
| a page key that no longer exists | falls back to Dashboard |
| custom page list, preference outside it | falls back to first in list |
| exactly one `alwaysOn` page | Password management |

Checked against the live rows too: Ivana's stored list is `{maintenance, config}`, so she sees Maintenance plan, Config and Password management, and lands on Maintenance plan — including if her landing page were set to something she can't see.

> **`npm run build` still has to be run locally.**

---

## Done on 11 August 2026, session 16 — user management

### Approval cadences: already correct, now legible

Devon asked for levy breakdown and insurance to be approved once per FY and only the statement preview monthly. **The scoping already worked that way** — `approvalScopeFor()` resolves the two annual subjects to the financial year and the two monthly ones to the period — so nothing needed changing. Meter readings stays a monthly sign-off, confirmed.

What did need fixing was that you couldn't *tell*. A tick-box on a screen with a month selector above it reads as monthly unless it says otherwise, and the annual ones cover all twelve months. So:

- the annual checkboxes now say **"Approving covers every month of FY …; it is not asked again next month"**;
- the release banner splits outstanding items into what's owed **for the year** (done once, then clears) and what's owed **for this month**.

### User management

New finance-only screen. Register and remove users, reset passwords, set roles, and choose which screens each person sees.

**Creating and deleting auth users cannot be done from the browser.** They need the admin API and therefore the service role key, which bypasses every RLS policy in the schema and must never be shipped to a client. So there is now an Edge Function, `manage-trustees` (`supabase/functions/manage-trustees/index.ts`, deployed with `verify_jwt = true`), holding that key.

**Authorisation is inside the function, not at the call site.** The client hiding the page from non-finance trustees is a convenience; the function resolving the caller from their own JWT and looking them up in `trustees` is the control. A caller cannot assert who they are.

Two guards in it worth knowing about:

- **Creating rolls back.** If the `trustees` insert fails after the auth user is made, the auth user is deleted. Otherwise you get a login that reaches the app and then fails every policy — which looks like a bug, not a half-finished creation.
- **The last finance trustee cannot be deleted**, and nobody can delete themselves. Otherwise the scheme ends up with no one who can manage users or write a levy figure, and no way back in through the app.

**Password resets are split on purpose.** The email link goes through `resetPasswordForEmail` **client-side** — no admin rights needed, and the password only ever exists between Supabase and the user. That's the default. Setting a temporary password goes through the function, for when email isn't practical.

### Page permissions — and what they are not

`trustees.allowed_pages text[]`, with `NULL` meaning "use this role's defaults". Two reasons that default matters:

- a trustee added without a list behaves as the role-based nav did, rather than seeing an empty menu;
- **a screen added to the app later appears automatically for everyone on the defaults.** An explicit list is a snapshot and won't contain a page that didn't exist when it was saved. The screen says so where the list is edited.

`NAV_PAGES` is now a single module-level list feeding both the side nav and the management screen. Two lists would drift, and a page missing from the management list is a page nobody can grant.

Two entries are not the page list's to decide: **Config is always shown** (it carries the user's own password, so removing it would lock someone out of it) and **User management is finance-only** whatever is ticked.

> **This governs the side nav only. It is not a security boundary.** Read access is open to every trustee by policy, so hiding a page does not stop the data behind it being fetched through the API. What someone can *write* is decided by their role in RLS. Recorded plainly because a page list that looks like permissions invites being trusted as permissions.

### Verified
`esbuild` parse clean. Role resolution, page fallback and write permission tested against the **three real accounts**, each impersonated as `authenticated` with a real `auth.uid()` — 15 assertions, all correct:

| | devon (finance) | margi (approver) | ivana (maintenance) |
|---|---|---|---|
| `my_trustee_profile()` role | finance ✓ | approver ✓ | maintenance ✓ |
| `allowed_pages` | null → role defaults ✓ | null → role defaults ✓ | null → role defaults ✓ |
| may manage users (the function's own check) | allowed ✓ | **denied** ✓ | **denied** ✓ |
| read trustee list | yes ✓ | yes ✓ | yes ✓ |
| write trustee list | allowed ✓ | **denied** ✓ | **denied** ✓ |

The first attempt at this test returned nothing and looked like a pass — the loop read `trustees` *after* switching to `authenticated`, so RLS returned no rows and the body never ran. Worth remembering: **a permissions test that finds nothing to test is not a passing test.** Fixed by reading the list as owner first.

> **`npm run build` still has to be run locally** — the sandbox can't, `node_modules` carries the Windows rollup binary.

### Signing out was ending everyone's session

Devon spotted that signing out appeared to log out other people too. It did, and the cause is a default worth knowing about:

> **`supabase.auth.signOut()` defaults to `scope: "global"`** — it destroys *every* refresh token that user holds, on every device and browser, not just the current one. ([docs](https://supabase.com/docs/guides/auth/signout))

So one trustee signing off on the clubhouse PC also dropped themselves on their phone — and while everyone was sharing the one login, it dropped each other. Now `{ scope: "local" }`, which ends this session and leaves the rest alone. That is what a Sign out button is normally taken to mean.

The global behaviour is still worth having, but as something chosen on purpose, so **Config → Your login** gained **"Sign out everywhere else"** (`scope: "others"` — keeps the current session, so it can't lock you out by accident). Also noted there, because it isn't obvious: **changing your password does not end sessions already open elsewhere.** If you're changing it because someone may have had the old one, the password change alone doesn't shut them out.

**One case this does not fix, and cannot.** Two *different* people signed into the same browser profile at once is not possible — supabase-js keeps the session in `localStorage`, which is shared by every tab of that origin, so the profile holds one session and signing out in any tab ends it in all of them. Per-tab sessions (`sessionStorage`) would trade that for logging in again in every new tab and losing the session on restart, which is a bad deal for a scheme where people check things occasionally. **Separate people need separate browser profiles, separate browsers, or separate machines** — which is the normal arrangement now that everyone has their own login.

### Note
Devon created both logins in the Supabase dashboard before this session ran, so the manual step from session 15 is done: `margi.hutchinson@gmail.com` is the approver and `ivanajacobs55@gmail.com` maintenance. Further users can now be added from the app.

---

## Done on 11 August 2026, session 15 — the levy figure, the reserve fund, and three trustees

### 1. "Levies collected" included bank interest

`leviesCollected` summed **every** income row — Owner Contributions, Interest Earned *and* Other Credits — and fed that straight into `reserveFundFloor()` as the PMR 22 base. Interest is not a levy. For FY 2025/2026 the bank paid about **R10,670.85**, all of it inflating the 25% reserve threshold the meeting is held to.

- Now reads the **Owner Contributions row only**, found via a new `INCOME_OWNER_CONTRIBUTIONS` constant rather than a label matched by hand — matching by hand in one more place is how it came to be summed with interest to begin with. Anything that is not an owner contribution is excluded *by construction*, so a new income row added later cannot quietly rejoin the calculation.
- **Only one consumer**, so the fix propagates completely: `reserveFundFloor()` → section 13's statutory-minimum table → the per-unit-per-month figure. Checked; there is no second path.
- The report line is relabelled **"Owner contributions collected in FY …"**. The old label was sitting over a number that was not what it said.
- `docs/budget-FY2026-2027.md` carries a correction note. **The conclusion is unchanged** — the reserve holds R0.00, so the floor bites either way — but the threshold and therefore the shortfall come *down*. Regenerate the pack before quoting figures.

### 2. Reserve fund split onto the Financial dashboard

New `ReserveFund` component: ledger, balance, entry capture. The Maintenance page keeps the register and the ten-year plan and now shows only a pointer plus the balance, because the annual contribution is computed *net* of it and would be unreadable without it.

It reads its balance through `fetchMaintenancePlan` rather than summing the ledger itself, so the number on the dashboard and the number the plan is netted against are the same number arrived at once. AGM section 13 still reports plan and reserve together — PMR 22 ties them together, so splitting the section would separate the floor from the plan that justifies it.

### 3. Three trustees, enforced in the database

`is_trustee()` was a flat yes/no and every table carried one `FOR ALL` policy built on it. **A second person approving the first person's figures is only a control if the approver cannot also edit them**, so the roles are enforced by RLS, not by hiding buttons.

| Role | Writes |
|---|---|
| `finance` (Devon) | everything, as today — and it is the column **default**, so no existing or future trustee is locked out by omission |
| `approver` | `approvals` only |
| `maintenance` | `assets`, `asset_inspections`, `maintenance_plan_snapshots` only |

Read stays open to every trustee on purpose: an approver who cannot see the levy grid cannot meaningfully approve it. The separation is of **duties**, not visibility — this is a seven-unit scheme, not a bank.

The 28 flat policies were rewritten as read + role-scoped-write pairs **by a loop, not by hand** — a table missed by hand would keep its old flat policy and stay writable by everyone, which is the exact failure the change exists to prevent. It also drops whatever the old policy happened to be called; the names had drifted (`trustee_all`, `assets_trustee`, `manual_payments_trustee_all`). Result: 25 tables on `can_write_finance()`, 3 on `can_manage_maintenance()`, 1 on `can_approve()`.

**Approvals.** `subject` × `scope`, where scope is deliberately *not* always a month: the levy grid and insurance schedule are set once a financial year and a monthly tick-box against them would be theatre — twelve approvals of one unchanged decision. Readings and statements genuinely are monthly. Withdrawing deletes the row, so "approved" is simply the presence of a record and there is no third state to reason about at the moment statements are released.

One `ApprovalCheckbox` on all four screens, so they cannot drift apart in wording or behaviour.

**The gate.** Statement generation, printing and sending are disabled until all four are in, with a banner naming what is outstanding. Two decisions worth recording:

- It **re-reads approvals from the database**, not from the four screens' state — the approving trustee may be signing off in another browser, and a gate computed from this tab's stale state is not a gate.
- It **fails closed**. An approvals table that cannot be read is not evidence that everything was approved.

Buttons are disabled rather than hidden, so the trustee sees the action exists and why it is unavailable instead of wondering where it went.

**Register add/remove.** Adding is a form under the register; a new component starts unassessed and carries no provision. Removal is blocked once anything is captured — an inspection, a tagged reserve entry, a replacement cost, or an expected life. The last matters because an assessed component is carrying a provision, so removing it changes the statutory figure.

**Guarded by a BEFORE DELETE trigger, not by the UI.** The maintenance trustee has write access to `assets` by policy and could otherwise delete through the API — and `asset_inspections` cascades, so the loss would be silent and total. The UI mirrors the rule only so the button can explain itself before it is pressed; if the two ever disagree, the database wins and its message is what the user sees.

**Passwords.** `YourLogin` on Config, using `auth.updateUser`. Deliberately not a trustee-management screen: nobody sets anybody else's password, so there is no path for one trustee to take over another's approval rights. SideNav filters by role, and Config falls back to just this card for the two new roles rather than showing a category editor every write would be refused from.

### Verified
`esbuild` parse clean. Role policies tested by creating two throwaway auth users and running each attempt as `authenticated` with a real `auth.uid()` — the way they actually run, not as the service role:

| Actor | Attempt | Result |
|---|---|---|
| approver | write approvals | allowed ✓ |
| approver | read levy figures | allowed ✓ |
| approver | edit levy figures | **denied** ✓ |
| approver | edit insurance | **denied** ✓ |
| approver | add reserve entry | **denied** ✓ |
| maintenance | edit register | allowed ✓ |
| maintenance | approve statements | **denied** ✓ |
| maintenance | edit levy figures | **denied** ✓ |

Delete guard tested both ways: an untouched component deletes cleanly, one with a replacement cost raises `restrict_violation`. All test users, trustees rows, approvals and assets removed afterwards — back to 1 trustee, 0 approvals, 27 assets.

> **`npm run build` still has to be run locally.** The sandbox can't — `node_modules` carries the Windows rollup binary.

### Outstanding — manual step
Auth users cannot be created from SQL. In the Supabase dashboard under **Authentication → Users**, create or invite the two logins, then insert them into `trustees` with role `'approver'` and `'maintenance'` (statement at the foot of `migrations/trustee_roles_and_approvals.sql`). They set their own password from Config → Your login, or via the reset email if invited. **Until they exist, nothing changes for Devon** — `finance` is the default and keeps full access.

---

## Done on 11 August 2026, session 14 — levy line items are trustee-editable

Devon asked to be able to add and remove a levy line from the Levy breakdown grid, carried through the rest of the app, with previous data left intact and the change applied going forward.

### What was actually in the way
Storage was never the problem. `levy_manual_entries` is keyed `(unit_id, financial_year, item_label)` and `get_unit_statement` aggregated whatever labels existed. **Three** things pinned the list to nine:

1. `LEVY_ITEMS`, a hardcoded array in `App.jsx`, read in 12 places.
2. A **CHECK constraint** on `levy_manual_entries.item_label` restricting it to those nine strings. Found by the end-to-end test, not by reading the code — nothing in the app referenced it.
3. `computeSuggestedLevyItems`, the water projection and the fill-grid action all matching lines by their **display text**.

And the array was doing damage well beyond being inflexible. Two places total the levy by iterating it (`App.jsx` resident-statement builder, and `useAllocation`), so **any row whose label wasn't in the array was silently dropped from the unit's total**. A line added directly in the database would have billed nothing and said nothing about it.

### The model
`levy_item_definitions`, one row per line per financial year: `label`, `system_key`, `sort_order`, `active`. Keyed by FY like `levy_rates` and `levy_manual_entries`, which is what makes *"applies going forward"* true by construction rather than by convention — a past year is a different set of rows, so a statement reprinted for it rebuilds on that year's list and cannot be reshaped by a decision taken later. A new FY with no rows carries the previous year's forward as a starting point (dropping its removed lines — they were removed going forward, and this is forward) and writes nothing until saved.

- **`LEVY_ITEMS` is now a mutable module binding**, swapped after load exactly like `UNITS`, with `LEVY_ITEM_DEFS` alongside it holding the full list including removed lines. All 12 call sites kept working untouched, which is why this stayed a small change.
- **`system_key` is what code matches on** when it needs a specific line — never the label, which the trustee owns. `levyLabelForSystemKey()` resolves it and returns null when the line is gone, so callers have to handle absence. The suggestions map is now keyed by system key, and the water reconciliation's `Common Property Water` lookup goes through it instead of an `.eq("item_label", …)` that would have quietly returned zero the day the label was edited.
- **The CHECK constraint became a foreign key** onto `(financial_year, label)`, `on update cascade on delete restrict`. Still constrained, but to the list the trustee maintains. Cascade means a future rename carries the figures with it; RESTRICT means an accidental hard delete fails loudly instead of taking a year of levies with it.

### Removal keeps the data — and that needed guarding twice
Devon's instruction was to keep the line and its figures, because the AGM pack reports on what was actually levied in the year. Two places would have got that wrong:

- **`saveLevyBreakdownToDb` deleted every row for the FY** before reinserting. That would have destroyed a removed line's figures on the next save of any cell — quietly, and a month later. The delete is now scoped to the labels being rewritten.
- **`get_unit_statement` aggregated every row for the FY**, so keeping the figures would have kept *billing residents* for a line the body corporate had stopped charging. The RPC now excludes rows whose definition is inactive.

Section 12 of the AGM pack shows active lines **plus any line removed during that year that still has figures against it**, with a note saying it was withdrawn mid-year and isn't charged going forward. Dropping it the moment it stopped being billed would have made the table disagree with the statements the owners were sent.

### The resident portal was reading the wrong list entirely
It never loads the trustee app's data, so `LEVY_ITEMS` there was always the source-code default. The RPC now returns `levyItemOrder` with the amounts, and the client totals over the keys it was actually given. Statements render `r.levyLines` — the list the row was totalled over — so the lines shown can't disagree with the total printed under them.

### UI
Per-row `×` with a confirmation that names the monthly amount at stake, and an add box below the table. Both **save the grid first**, because a definition change triggers a reload that would otherwise discard unsaved cells. Re-adding a removed line restores it with its figures rather than creating a duplicate. The last line can't be removed. Removed lines are listed under the grid with a note on how to restore them.

### Verified
`esbuild` parse clean. End-to-end test run against a throwaway FY `9999/0000` — copy the real grid, add a custom line, remove a built-in, then run the app's own scoped save:

| Assertion | Result |
|---|---|
| Removed line's rows kept | 7 (all units) |
| New custom line's rows created | 7 |
| FY 2026/2027 rows untouched | 63 |
| FY 2025/2026 rows untouched | 63 |
| FY 2025/2026 active items | 9 |
| RPC: rows held vs rows billed | 10 vs 9 |
| RPC: `levyItemOrder` | correct order, removed line absent |

Test data deleted afterwards; back to 126 entries and 18 definitions. The build itself can't run in the sandbox (`node_modules` carries the Windows rollup binary) — **run `npm run build` locally before committing**.

### Worth knowing
- A line the trustee invents has no `system_key`, so **"Fill grid with calculated values" leaves it exactly as typed** rather than zeroing it. There is no rule the app could compute for it.
- Removing a line changes what is billed for the **whole current FY**, including months already issued in that year — that is the FY-scoped model Devon chose, and it is how levy *amounts* have always behaved. Month-level versioning would mean re-keying `levy_manual_entries` from FY to period.

---

## Done on 11 August 2026, session 13 — the AGM "New" column for the bill-driven charges

### The gap
Section 9 of the AGM report has three rows whose **New — FY** cell could never be filled by anybody:

- Water Demand Levy (per unit / month) excl VAT
- Electricity Service Charge (complex, excl VAT)
- Electricity Network Charge (complex, excl VAT)

They read `levy_rates` for the *following* financial year, and **nothing writes to those columns any more**. Tariffs & rates dropped the three inputs when the charges moved to the invoice-driven model (session 5); a `levy_rates` row for a new year is created as a side effect of saving the common property standards, which correctly leaves the fee columns **null** (see `levy_rates_nullable_fees.sql` — null was deliberately chosen over a misleading `R 0,00`).

So the null wasn't "you forgot to type it", it was a **dead end**: no field existed anywhere in the app to capture an AGM figure for these three. Confirmed against live data — `levy_rates` FY 2026/2027 is null on all three, FY 2025/2026 has R124.00 / R278.98 / R1,125.75.

The Current column never showed the gap because `feeCell()` falls back to the uploaded council invoice with a source footnote. The New column has no fallback, because there is nothing to fall back *to* — the council hasn't published next year's tariff and the invoice only carries what is being billed now.

### The fix — same shape as `sewerage_per_unit_new`
This is the identical problem sewerage had in session 3, so it gets the identical answer rather than a second mechanism.

- **Migration `agm_report_settings_utility_new_rates`** (mirrored in `migrations/agm_report_settings_utility_new_rates.sql`) adds `water_demand_levy_new`, `electricity_service_fee_new`, `electricity_network_fee_new` to `agm_report_settings`. Additive only; nothing altered.
- **Three fields on Config → AGM report figures.** The card is driven entirely off `AGM_FIELDS`, so they are three list entries — no new form code.
- **`newCell(approved, proposed)`** in the report builder: an AGM-approved figure in next year's `levy_rates` still wins, the Config proposal is the fallback, blank if neither. Sewerage now routes through the same helper instead of its own inline expression.
- Stored on the row for the year the report **covers**, holding the figure proposed for the year after — the existing convention shared by `sewerage_per_unit_new`, `garden_proposed_rate_per_day` and `blockwatch_monthly_proposed`.

### Why not restore the inputs on Tariffs & rates
That was the alternative. It re-opens the invoice-vs-AGM ambiguity the session 5 refactor removed: the invoice is the single source for what is actually being charged, and a second editable copy of the same charge invites the two to disagree. Keeping the proposals on Config says what they are — figures the meeting votes on, not something the council tells you.

> Still not interchangeable with the invoice, which is why the fallback is a *proposal* and not the bill: FY 2025/2026's approved `water_demand_levy` is **R124.00** against a council charge of R65.08–R107.74.

### The closing hint now names the right page
It previously sent the reader to Tariffs & rates for every blank in the New column. There are two different gaps with two different homes, so it now reports them separately — common property provisions → Tariffs & rates, the four bill-driven charges → Config — and only fires when a cell is **actually** blank, tracked by `newGap`.

### Verified
`esbuild` parse clean (the sandbox can't run `vite build` — `node_modules` carries the Windows rollup binary). Migration applied to the live project and confirmed. **Left null deliberately**: no approved FY 2026/2027 figures exist to seed, so the cells stay blank until Devon captures them on Config.

---

## Done on 8 August 2026, session 12 — the budget, as a module and a report section

### `docs/budget-FY2026-2027.md` — the projected budget, built at last

Devon asked where it was, and the honest answer was that it did not exist: I had
called the budget "95% buildable" without building it. Now built from the FY
2025/2026 actuals, the captured FY 2026/2027 tariffs and the water projection.

| | FY 2026/2027 |
|---|---:|
| Income | R 276,926.87 |
| Administrative expenditure | R 270,617.34 |
| **Operating surplus** | **R 6,309.53** |
| Statutory reserve contribution | R 40,592.60 |
| **After the reserve** | **−R 34,283.07** |

**The budget balances on operations and fails on the reserve.** The way through
costs nobody anything: the scheme holds R210,844.15 with no stated purpose, so
designating R60,000 as the opening reserve clears the 25% threshold and the 15%
floor stops applying. No levy increase, no cash movement — the reserve is
notional. Flagged for CSOS or attorney confirmation, since PMR 22 speaks of a
*budgeted contribution* and whether a designation of accumulated surplus
qualifies is a legal question, not one I can answer.

> **Worth saying at the meeting: only 18% of the water bill is water.** Sewerage
> alone is R59,146.57 against R14,441.22 of consumption — a flat per-dwelling
> charge nothing the scheme does can reduce. Owners reliably assume the water
> bill is about usage.

Owners pay **+10.0%** billed-to-billed, against council tariffs up 8.9–12.5%.

### Migration `budget_lines_and_meta.sql` (applied) + new Budget module

`budget_lines` (one row per line, with `basis` and `is_assumption`) and
`budget_meta` (opening cash, approval record). Both RLS-protected. FY 2026/2027
seeded with all 15 lines from the document — 6 flagged as assumptions, and
**every line carries a basis**, because a budget line without one is a number
nobody can challenge or defend.

The Budget module makes every value editable: label, amount, basis and the
estimate flag, plus add and remove lines. **Totals move as you type** — a budget
you have to save before you can see the effect of is a budget nobody iterates on.

### AGM report — section 14, Budget

> **The design decision worth remembering.** Section 14 **prints what is stored
> and never recomputes**. That is the opposite of sections 3, 10 and 13, which
> are computed live. Those report *facts*, and a fact should always be current.
> A budget is a *decision*, and a decision has to be pinned: what is tabled at
> the meeting must be what the trustees agreed, not what a formula produced at
> the moment the document was generated.

The section covers income, expenditure, the result, cash, and names the
assumption lines as the ones most worth challenging. It reports the budget for
the year **ahead** (`nextFY(fy)`) since the report reviews one year and asks the
meeting to approve the next. The signature line moved here — everything before
this reports what happened; this is the only section that asks for approval, so
it closes the document.

**The reserve contribution is excluded from the cash projection on purpose.** It
is a designation of existing funds, not a payment out, so the cash stays in the
account either way. Showing it as an outflow would understate the closing balance
by R40,592.60.

### Verified

`no-undef` clean, bundle clean. Round-trip checked in the database: stored rows
total R276,926.87 income, R270,617.34 expenditure, R40,592.60 reserve, operating
R6,309.53, after-reserve −R34,283.07, closing cash R217,153.68 — every figure
matching the document, 6 assumption lines, and **0 lines without a basis**.

---

## Done on 8 August 2026, session 11 — PMR 22 schema, and two new AGM sections

### Migration `maintenance_plan_and_reserve_fund.sql` (applied)

Four tables, with the design decisions taken with Devon before building:

| Table | Holds |
|---|---|
| `assets` | Component register — the basis of the ten-year plan |
| `asset_inspections` | **Dated** condition history, many rows per component |
| `reserve_fund_entries` | Notional reserve ledger |
| `maintenance_plan_snapshots` | The plan **as approved** at an AGM, frozen |

Three choices worth remembering:

1. **The reserve fund is notional, permanently.** Book entries against the single
   FNB account — there is no separate reserve bank account and none is planned, so
   the ledger carries no account linkage at all.
2. **Condition is a dated log, never a field on the asset.** A deterioration trend
   across years is what justifies moving a replacement date forward, and PMR 22
   plans are re-approved annually. `revised_remaining_life_years` on an inspection
   overrides the age-derived figure — an inspector's judgement beats a table.
3. **The plan is computed live; approved versions are snapshotted.** It cannot go
   stale, and there is still a record of what the meeting adopted — which is what
   compliance actually rests on.

All four are RLS-protected behind `is_trustee()`, consistent with the other 16 tables.

### 27 components seeded as a checklist — with no invented figures

Every age, life and cost is deliberately **null**. Those come from walking the
property, and a seeded guess would be indistinguishable from real data in six
months. Three components carry notes from what the expense record already proves
(the Sep 2025 lighting work, the four insured geysers, the annual extinguisher
service) — those narrow the age question without pretending to answer it.

### AGM report — section 3, Bank account

Sections 1 and 2 are the accrual view; this is the cash counterpart, and the only
part of the report a member can check against a document the bank sent. Position,
month-by-month table, and **verification** — each month either ties to its own
statement or it is named as not doing so.

Includes **months of cash cover** (closing balance ÷ average monthly spend), which
nobody calculates and which is the difference between a balance that looks healthy
and one that is. At R210,844.15 against R234,425.28 of annual spend that is about
**10.8 months** — and the report says plainly that a balance that size usually means
a scheme accumulating without a stated purpose, which is what section 13 addresses.

### AGM report — section 13, Maintenance plan and reserve fund (PMR 22)

Register coverage first, deliberately: **a plan built on 3 of 27 components is not
a plan**, and the section says so before it shows a single rand. Then the reserve
position, the statutory floor, the annual contribution, the ten-year schedule and
the component detail.

> **The number the meeting has to face.** Levies collected FY 2025/2026 were
> R238,065.78, so the 25% reserve threshold is **R59,516.45**. The reserve fund
> holds **R0.00**, so the floor bites: the coming year's budgeted reserve
> contribution must be **at least 15% of the budgeted administrative contribution
> — R35,163.79, about R418.62 per unit per month.** That is regulation, not a
> proposal, and it applies whether or not the register has been completed.

Sections renumbered to make room: 3→4 Misc, 4→5 Maintenance, 5→6 Insurance,
6→7 Blockwatch, 7→8 Garden, 8→9 Tariffs, 9→10 Water, 10→11 Service notes,
11→12 Levy split. The signature line moved to the end of the new section 13.

### New "Maintenance plan" module

Editable register (install date, expected life, replacement cost, cost basis), an
inspection form per component, and the reserve ledger. Capturing a cost **and** a
life flips a component from `not_assessed` to `assessed` automatically — the two
fields that let it carry a provision are exactly the two that define assessment.

### `TODAY_ISO` hoisted to module scope

It was a local const inside the tariff editor; the register and inspection form
both need it. A second definition of "what is today" is how two screens end up
disagreeing about the date.

### Verified

`no-undef` clean (run per the session 10 agreement), bundle clean. PMR 22 maths
tested against the real position and against a worked three-component example:
provisions sum correctly (450000/12 + 180000/3 + 28000/5 = R103,100), an
apportioned reserve sums back to exactly the balance held, `remaining = 0` divides
by `max(1, n)` rather than producing Infinity, a reserve exceeding replacement cost
floors the provision at 0, and unassessed components are excluded rather than
counted as zero.

---

## Done on 8 August 2026, session 10 — "DB offline — mock data" fixed

**My bug, introduced in session 7.** Removing the Tenant recon upload handler deleted
the `bankStatementStatus` state, but the **data-load effect still called
`setBankStatementStatus`**:

```js
if (data.bankStatementMeta) {
  setBankStatementMeta(data.bankStatementMeta);
  setBankStatementStatus("done");   // <- deleted state; ReferenceError
}
```

That throws inside the `.then()`, **before `setUnitsSource("database")` on the next
line**. The effect's own `.catch()` swallows it and runs `setUnitsSource("error")`,
so the whole app silently fell back to mock data. Everything downstream — every
screen, every figure — was mock. Fixed by dropping both calls; Bank recon owns
import status now, and this screen only needs the metadata it displays.

> **The lesson, and it is the important part.** Vite and esbuild bundled this
> without complaint — a call to a deleted `const` is a syntactically valid
> identifier reference and only fails at runtime. **A clean build proves nothing
> about deleted bindings.** What catches it is `no-undef`.
>
> **Run this after any refactor that deletes state, props or helpers:**
> ```
> npx eslint src/App.jsx --rule '{"no-undef":"error"}' --no-inline-config
> ```
> It found this in one pass and confirmed there were no other orphans from the
> session 7 refactor. Bundling clean is necessary, not sufficient.

Also worth noting: **a swallowed error in a `.catch()` that degrades to a fallback
is the worst failure mode** — the app looked like it was working. The catch on the
data-load effect logs to console (`Could not load app data from Supabase`), so the
browser console names the real error immediately; check it before assuming the
database or the network is at fault.

---

## Done on 8 August 2026, session 9 — digital statements, and a parser bug they exposed

Devon gave access to `C:\Users\devon\OneDrive\El Corazon Body Corp\Bank Statements`.
All twelve FY 2025/2026 statements are there as **digital PDFs with a real text
layer** (269–278 plus June and July 2026), one per month subfolder. These parse
properly, unlike the scanned copies.

### The parser dropped FNB's monthly service fee on 10 of 12 statements

Running the app's own `BANK_LINE_RE` over the twelve real files found **ten
unparsed lines** — one per statement, always the month-end service fee:

```
"31 Aug                    69.00            187,172.24 Cr"
```

**FNB leaves the description column empty on that line.** `(.+?)` requires at
least one character, so the line failed the match and `parseBankStatementLines`
dropped it — by design, since it drops anything that doesn't match. Every one of
those ten statements came out short by exactly the fee: R69, R114, R24, R69, R24,
R24, R24, R24, R24, R69 — **R465 across the year**.

Fixed by making the description group optional: `(?:(.*?)\s+)?`. A blank
description is then labelled from the statement's own Bank Charges box, which
states the month's service fee — so where the amount agrees the line becomes
"Service Fees" rather than staying anonymous. Anything else blank stays
`(no description on statement)` and falls to needs-review, which is honest.

After the fix: **12 of 12 statements parse with zero dropped lines and R0.00
drift.**

### Turnover added as a second, independent check

`parseStatementHeader` now also reads "Turnover for Statement Period" — the bank's
own count and total of credits and debits. The balance walk proves the running
balances are internally consistent; **turnover proves the right number of lines
were read**. A statement can pass one and fail the other, which is exactly what
happened above: the walk would have caught the missing fee, but turnover names it
as a count problem immediately.

Zero-rand lines are excluded from the count, because FNB prints its interest-rate
notice as a dated line with an amount of 0.00 and does not count it in turnover.
Three statements carry one.

### All 139 rows now carry a running balance — and the walk found a date error

Backfilled from the digital PDFs by **UPDATE matched on (period, date, amount,
direction)**, not delete-and-reinsert, so tagging survived. Confirmed after:
**0 untagged debits, 127 reviewed flags, 85 unit matches, and the Cor 6
applied-period retargeting all preserved.**

> **One row would not match, and it was a real error.** The E Van Noord payment of
> R2,427.33 was stored on **5 May 2026**; FNB statement 278 prints it on **6 May**.
> The walk flagged it with a drift of exactly R2,427.33. Corrected, with the reason
> recorded in `review_note`, and `applied_period` pinned explicitly so the
> correction could not move which month the payment settles.

**Final state: 12 statements, 0 rows missing a balance, 0 walk breaks across every
period, all balances `balance_source = 'printed'`.**

### The closing balance is now read, not derived

| | |
|---|---:|
| Opening 31 July 2025 | R 207,203.65 |
| **Closing 31 July 2026** | **R 210,844.15** |

Last session this was rolled forward from transactions and flagged as needing
confirmation. **It is now read off statement 280 and confirms the derived figure
exactly.** The FY 2026/2027 budget has its opening cash.

---

## Done on 8 August 2026, session 8 — the scanned statements

### The full-year bank audit: **every stored line ties to the bank's own figures**

Devon supplied `El Corazon Bank Statements.pdf` — ten FNB statements (269–278,
Aug 2025 – May 2026). Another Canon scan with no text layer, so OCR'd at 300 dpi.
Three independent checks, all passed:

1. **The balance chain holds.** Every statement's printed opening equals the
   previous statement's printed closing, unbroken across all ten. A single
   misread digit anywhere would break it — so the OCR is self-validating.
2. **Each statement's own arithmetic holds.** Printed opening + printed credit
   turnover − printed debit turnover = printed closing, on all ten.
3. **The stored transactions match the printed turnover exactly** — transaction
   counts *and* rand totals, on all ten. The original import dropped nothing.

> **The one discrepancy was OCR, not data.** March 2026 read R18,379.38 credits
> against R18,379.39 stored, and the debit total was illegible. The stored pair
> reconciles the printed opening to the printed closing exactly
> (199,849.28 + 18,379.39 − 15,649.64 = 202,579.03), so the database is right and
> the scan was a cent out. Worth remembering: **on a blurry scan, trust the
> figure that reconciles, not the figure that was read.**

### Balances backfilled — all 12 statements now reconcile to R0.00

Ten carry `balance_source = 'printed'`. June and July 2026 were not in the PDF, so
their opening chains off May's printed closing and their closing is rolled forward
from stored transactions — marked `'derived'`, and they need their own PDFs to
confirm.

| | |
|---|---:|
| 31 May 2026 closing, **printed** | **R 209,079.38** |
| 30 June 2026 closing, derived | R 212,399.88 |
| **31 July 2026 closing, derived** | **R 210,844.15** |

**That last figure is the opening cash the FY 2026/2027 budget needed.** It is
derived, not read — confirm it against the June and July statements before the
budget is signed.

### The parser now reads the printed Statement Balances box

The real format, previously unavailable:

```
Tax Invoice/Statement Number : 278
Money On Call : 61123184551
Statement Period : 30 April 2026 to 31 May 2026
Opening Balance   206,930.38 Cr
Closing Balance   209,079.38 Cr
```

`parseStatementHeader()` reads opening, closing, period, statement number and
account number. **The printed pair now wins over the derived pair** — and where the
two disagree the preview says so, because that gap is exactly the size of what the
parser missed. Deriving from the running-balance column remains the fallback, since
it works on any layout while these patterns only work on this one.

### Overdrawn balances now parse

`BANK_LINE_RE` gained a `Dr` branch on the balance column and stores it negative.
Flagged last session as a known limitation: such a line failed the match and was
silently dropped. Also fixed in the header box.

### Verified

Parse and bundle clean. Tested against the real May 2026 statement (stmt 278):
header box read correctly on all five fields, all 13 transaction lines parsed,
credits R20,723.49 and debits R18,574.49 both matching the printed turnover, and
opening + credits − debits landing on the printed closing with **R0.00 drift**.

> **The cross-check caught an error in my own test data.** My first transcription
> had one credit R10 low. The walk failed at line 1 — *expected R210,212.46, the
> statement prints R210,222.46, out by R10* — which is precisely the behaviour the
> whole design is for: one wrong digit, named at the exact line, rather than an
> unexplained total at the bottom.

Overdrawn cases confirmed: a `Dr` transaction line parses to −3,000.00 where it
previously did not parse at all; `Closing Balance 1,234.56 Dr` reads as −1,234.56.

### Still open — *both resolved in session 9 above*

- ~~The app cannot parse these scans.~~ Digital PDFs supplied; all twelve parse.
- ~~Confirm the June and July 2026 closing balances.~~ Both now read off their
  statements and agreeing with the derived figures exactly.

---

## Done on 8 August 2026, session 7

### "Bank reconciliation" renamed **Tenant recon**; new **Bank recon** module owns importing

Nav order is now `… Invoice allocation · Tenant recon · Bank recon · Statement preview …`.
All in-app copy that pointed at "the Bank reconciliation page" was repointed — five
strings including two inside the AGM report's own hint text.

**Bank recon** imports a statement and recreates it line for line: opening balance,
every transaction with the running balance the bank printed against it, closing
balance. **Tenant recon keeps the matching, tagging and reviewing UI but no longer
imports** — its upload card is now a button through to Bank recon.

> **Why one import path.** Two parsers writing `bank_transactions` is how the two
> drift apart, and a fix to one silently leaves the other wrong. Same reasoning that
> moved the insurance grid off Config in session 5. `saveBankStatementToDb` and the
> `handleBankStatementUpload` handler in `App` are **deleted**; everything goes
> through `saveBankStatementForPeriod(period, fileName, txns, balances)`.

### The parser was already capturing the running balance and throwing it away

`BANK_LINE_RE` has always matched the running-balance column as group 5. The
destructure in `parseBankStatementLines` skipped it with a bare comma. That one
character is the difference between an import you can verify and one you cannot.

Now kept as `balanceAfter`, plus `lineNo` for statement order (not the same as date
order once two movements share a day). `deriveStatementBalances()` turns those into
an envelope, and the check that matters is **not** opening-plus-net-equals-closing —
it is walking the ledger and asserting each printed balance follows from the one
above it plus that line's movement. **A dropped line breaks the walk at exactly that
line and the UI names it.** The naive total-only test would just report a number.
The walk resyncs to the printed balance after each break so one bad line doesn't
cascade into every line below it.

### Opening/closing are DERIVED, and say so

There is no sample FNB statement in the repo to write a header regex against, so
closing = the last line's printed balance and opening = the first line's printed
balance reversed by its own movement. Both are the bank's own figures, neither is
read off the header, and `bank_statement_documents.balance_source` records
`derived` / `printed` / `entered` / `unavailable` so a later reader is never misled.

### `statementDateToIso` took the year from whatever period was selected

Fine when only the current statement could be imported. **Bank recon can import any
month**, so it now takes a `forPeriod` argument. It also handles the December
statement carrying an early-January line — month rolls back to 01 while the
statement's month is 12, so the line belongs to the *following* year. Corrected in
both directions.

### Migration `bank_recon_statement_balances.sql` (applied)

`bank_statement_documents` + `opening_balance`, `closing_balance`, `balance_source`,
`statement_from`, `statement_to`, `account_number`.
`bank_transactions` + `balance_after`, `line_no`.

Backfilled: `line_no` set on all 139 existing rows by date-then-created order; all
12 stored documents marked `balance_source = 'unavailable'`.

> **The 12 existing statements cannot be verified** — they were imported before the
> balance column was kept, so there is nothing to check against. Bank recon shows
> them "Cannot be verified" with a prompt to re-import. Re-importing each PDF is the
> only fix, and it is worth doing before the AGM: it is what produces the closing
> bank balance the budget needs.

### Known limitation: an overdrawn balance will not parse

`BANK_LINE_RE` allows an optional `Cr` on the balance but has no branch for `Dr`.
A line printing an overdrawn balance is **silently skipped** — it fails the match and
`parseBankStatementLines` drops non-matching lines by design. The account has never
been overdrawn so nothing is wrong today, and the balance walk would now catch it if
it happened. Worth fixing when a real statement is to hand.

### Verified

Parse and bundle clean. Logic harness against a synthetic FNB-format statement:
4 lines parsed, opening R5,000.00 and closing R3,812.88 derived correctly, drift
R0.00, accrued fee captured. **Dropping the third line makes the walk fail at line 3
with a drift of exactly the missing R1,577.17.** No-balance input reports
`unavailable`. Year rollover correct in all four directions (02 Jan on a Dec-2025
statement → 2026-01-02; 29 Dec on a Jan-2026 statement → 2025-12-29).

> Devon confirmed 8 August 2026: **no arrears at 31 July 2026** and **no reserve fund
> exists**. The reserve fund answer engages the PMR 22 floor — see
> `docs/data-needed-budget-and-maintenance-plan.md`.

---

## Done on 8 August 2026, session 6

### The levy grid is VAT-INCLUSIVE — and §9 was comparing it against VAT-exclusive council charges

Found while modelling the FY 2026/2027 projection, and it is the kind of thing that
would have gone unnoticed for years. `levy_manual_entries` holds Common Property Water
at **R81.07/unit/month** for FY 2025/2026 — R567.49 across seven units. The option-D
document used R5,921.52/year, being 20 kL on the tariff table. **R493.46 × 1.15 =
R567.48**: same number with VAT on it.

The convention holds across the whole grid — sewerage captured at R890.66 against a
council charge of R774.48 (×1.15 = R890.65), water demand levy at R123.90 against
R107.74 (×1.15 = R123.90). Both exact VAT-inclusive pass-throughs.

`bulk_water_rand` and `individualWaterCost` are both **exclusive**. So §9 as first
written compared an inclusive recovery against an exclusive charge and **overstated
the margin by R888.25 a year**. `fetchWaterReconciliation` now de-VATs the provision
(`cpMonthly = cpMonthlyIncVat / (1 + vatRate)`) and returns both; the section prints
the exclusive figure in the comparison and names the inclusive one in a note, so the
adjustment is visible rather than silent.

> **Convention worth remembering:** anything from the levy grid is VAT-inclusive;
> anything from `council_invoices` or the water/electricity cost functions is
> VAT-exclusive. Never add one to the other without saying which basis you are on.

### Option-D's "current rule" column was the NEW rule, not what was actually billed

Option-D §4 shows FY 2025/2026 metered water at **R17,327.53**. That prices every month
on the flat-minimum rule adopted in session 5. Every FY 2025/2026 statement predates it
(`WATER_MINIMUM_CHARGE_FROM = "2026-08"`, and the FY runs Aug 2025 – Jul 2026), so they
all used the superseded merged-band rule, which bills sub-6 kL months harder.

**Actual metered water billed was R18,238.88** — R911.35 more, all of it on U2 (R524.29
not R353.01), U4 (R1,258.82 not R764.95) and U7 (R594.69 not R348.53). The real margin
is bigger than option D reported. §9 prints the actual figure because it prices each
month on the rule in force that month.

### `docs/water-projection-FY2026-2027.md` — new

Answers what removing the common-property provision would do, and projects next year.
Headline: **metered billing alone over-recovers.** Projected FY 2026/2027 metered water
is R19,493.07 against a projected CoJ charge of R15,935.33 — **R3,557.74 of surplus
before the provision is counted at all**. Removing the provision takes R7,660.80/year
(5.1% of levy grid income, R91.20/unit/month) out of the budget but creates **no water
shortfall**. It is a funding decision, not a water one.

Also in there: the FY 2026/2027 tariff is **+12.50%** on every band the complex reaches,
yet metered billing rises only **6.9%** and U2, U4 and U7 pay *less* in cash — the rule
change hands back more to light users than the tariff takes.

### FY 2026/2027 levy grid IS captured (corrects an outstanding item)

`levy_manual_entries` has a full 2026/2027 grid (R12,501.33/month, R150,015.96/year) and
`levy_rates` has a 2026/2027 row. **Still missing: `levy_rates.water_demand_levy` is null**
for 2026/2027, so AGM report §8 will show that one New cell blank even though the grid
carries R123.90/unit.

### AGM report §9 — "Water: charged by CoJ vs billed to owners" *(REMOVED session 18 — see below)*

The AGM report had no place where the meeting could see what the scheme recovers on water
against what the council actually charged for it. The option-D analysis
(`docs/water-billing-option-D-FY2025-2026.md`) found a **R9,083.55/year margin** — R108.14 per
unit per month — but it lived in a one-off markdown file, so it would have been invisible at
every AGM after this one. It is now **section 9 of the generated report and rebuilds itself
from captured data every year**. Sections renumbered: service notes 9→**10**, levy split 10→**11**.

**What it prints.** A landscape month-by-month grid (CoJ kL · CoJ charged · units kL · metered
water billed · common-property provision · total billed · difference), then three blocks:

| Block | Answers |
|---|---|
| Summary | What CoJ charged, what owners were billed, the margin in rand, % and per unit per month |
| Common property water — provision vs actual | Bulk kL less unit kL = the real common-property draw, against the kL provision billed. FY 2025/2026: **6.94 kL actual vs 20 kL provided — 2.9×** |
| Fixed water lines (memo) | Sewerage and water demand levy per unit, annualised — pass-throughs, deliberately **outside** the margin |

**Three decisions taken with Devon before building** (all confirmed):

1. **Consumption only** in the headline. Sewerage and the demand levy are flat per-dwelling
   amounts billed on at cost, so they reconcile by construction; mixing them in would dilute
   the only number the trustees need. They appear as a memo block instead.
2. **The common-property provision counts as "billed"**, on its own row inside the total.
   Both rows are money collected from owners for water. Folding them into one figure would
   have hidden that most of the margin sits in the provision, not in the metered lines.
3. **A month missing either side is printed, shaded, flagged, and excluded from the totals.**
   Omitting it is exactly what let the 2026-02 capture error sit unnoticed. The total row
   says "N of 12 months" and a note names the missing periods.

**`fetchWaterReconciliation(fy)`** (beside `fetchUsageTrend`) is the whole data layer — seven
parallel queries, no per-month round trips. Two things it does deliberately:

- **A captured `statement_overrides.water_due` wins over the computed figure**, so the section
  agrees with the statements that were actually sent rather than with what the current rule
  would produce today. A note says how many months carry one.
- **Prices each month on the band set in force that month**, via a new `waterBandsAsOf(rows, date)`
  helper — the same effective-date resolution the statement screen uses. A year straddling a
  tariff increase prices correctly on both sides of it. Falls back to `WATER_BANDS_DEFAULT`
  when `water_tariff_bands` is empty.

Failure is scoped like the usage charts: `fetchWaterReconciliation` is `.catch()`-ed to `null`
in `generateAgmReport`, so a broken section 9 costs section 9 and not the document.

### All twelve FY 2025/2026 CoJ water invoices verified by OCR

The merged 10-page PDF and the June 2026 PDF are **scans with no text layer** — `pdftotext`
returns nothing. Rasterised at 200 dpi and OCR'd (tesseract) to confirm the option-D
reconstruction independently. Every reading period, meter reading, step ladder and consumption
charge matches the doc. Two findings worth keeping:

- **`COJ Water Utility June 2026.pdf` is a duplicate** of page 10 of the merged PDF — same
  2026/06 billing period, 25-day reading period, 66 kL, R951.19. Not a thirteenth bill.
- **2026-02 is genuinely absent from the supplied PDFs.** Page 7 jumps 2026/01 → 2026/03.
  The R275.72 overstatement in `council_invoices` (**R1,216.06 stored vs R940.34 by the
  invoice's own arithmetic**) is therefore still unverified against a physical invoice.

> **Do this before the AGM:** the stored figures total **R14,441.22** for the year; corrected
> they total **R14,165.50**. Section 9 will print whichever is in the table. Get the physical
> 2026-02 invoice, correct `bulk_water_rand`, and regenerate.

### Verified

Parse and bundle clean via esbuild (`npx vite build` can't run in the Linux sandbox — the
Windows-installed `node_modules` has no Linux rollup binary; **build on Windows before
pushing**). Logic harness over the real OCR'd invoice data confirms: 12-month totals
(R14,441.22 stored / R14,165.50 corrected / 973 kL bulk), the 20 kL provision at R493.46/month
= R5,921.52/year, `waterBandsAsOf` resolving 2025-08 → R29.84 and 2025-06 → R28.20 and empty →
8 default bands, `individualWaterCost` holding the legacy merged band for July 2026 (R149.20 on
5 kL) and the flat minimum from August 2026 (R29.84), and excluded months dropping out of both
sides of the margin.

---

## Done on 7 August 2026, session 5

### Water: flat minimum charge below 6kL (trustee rule change, effective the August 2026 statement)

**The rule, in full.** An individual unit's water is now billed:

| Consumption | Charge |
|---|---|
| 0 – 6 kL | a **flat minimum charge** — R33.57 on the 1 Aug 2026 rates. 5 kL costs R33.57, not 5 × R33.57. **0 kL also costs R33.57**: it is a charge for holding the connection, not for the water. |
| over 6 kL | the configured tariff table, free first 6kL intact. Nothing else — no floor, no minimum. |
| common property (the kL standard) | **unchanged** — always the real municipal scale, free tier included, because that is genuinely how CoJ bills the bulk meter. |

**The minimum charge is derived, not stored.** It is one kL at the **first paid band's rate** — the `>6-10` band, R33.57 from 1 Aug 2026 and R29.84 on the 2025/2026 set. This was a deliberate choice over adding a column: the figure re-prices itself when each July's rates are captured, and there is no second place to forget to update. *If CoJ ever publishes a minimum that diverges from the `>6-10` rate, this must become an effective-dated column on `water_tariff_bands` plus a field on Tariffs & rates — not a constant.* No migration was needed for this change; the schema is untouched.

**The two rules meet at a step, and that is accepted — don't "fix" it.** A unit on 6.5 kL pays 0.5 × R33.57 = **R16.79**, *less* than a unit on 5 kL paying R33.57, because crossing 6 kL earns the whole free tier. Usage between 6 kL and 7 kL therefore costs less than the minimum. Flooring the table at the minimum charge was offered and **declined by the trustee on 7 August 2026**: over 6 kL bills the tariff table and nothing else. The step is far smaller than the one it replaces (the old rule fell from ≈R201.42 at 6 kL to R16.79 at 6.5 kL), but it is still a step. A note to this effect sits on the constant in `App.jsx`.

| kL | was (July 2026 rule) | now (August 2026 rule) |
|---:|---:|---:|
| 0 | R 0.00 | **R 33.57** |
| 3 | R 100.71 | **R 33.57** |
| 5 | R 167.85 | **R 33.57** |
| 5.99 | R 201.08 | **R 33.57** |
| 6 | R 201.42 | **R 33.57** |
| 6.5 | R 16.79 | R 16.79 |
| 7 and above | table | table (unchanged) |

*(The "was" column is the old rule priced on the new 1 Aug 2026 bands, so the two columns are comparable. Above 6 kL the two rules were already identical.)*

### One helper, three screens — the drift is now impossible

The two-rule calculation was written out **three separate times**: `computeStatementRow` (the resident's own statement view), `useAllocation` (the trustee dashboard) and `splitStatementForChangeover`. Three copies of a billing rule is how a resident's statement and the trustee's dashboard come to disagree. All three now call a single **`individualWaterCost(kl, bands, period)`**, alongside `waterFreeBandLimit()` and `waterMinimumCharge()`. Nothing else computes an individual unit's water.

- **`useAllocation` now takes `period`** (`selectedPeriod`, threaded from the top bar) as a trailing argument and a memo dependency. It is **not** used to pick rates — `waterBands` already arrives period-scoped — only to decide which *rule* applies.
- **Statements before August 2026 are untouched.** `WATER_MINIMUM_CHARGE_FROM = "2026-08"`; anything earlier runs the superseded calculation so an already-issued statement reprints to the cent. `deriveIndividualWaterBands()` survives **only** to serve that legacy branch — its docblock now says so, and nothing else should call it.
- **A missing period bills on the current rule**, deliberately: an oversight that under-charges a historic reprint is recoverable; one that over-charges a live statement by 4× is not.

### Ownership changeover: the month's water is costed once, then split

Costing each half of a transfer month independently — which is what it did — **double-charged the minimum**: two owners each under 6 kL paid R33.57 apiece, R67.14 for a month a single owner would have been charged R33.57 for. The same objection applied further up the scale, where each half got its own free first 6 kL.

`splitStatementForChangeover` now costs the **whole month once** via `individualWaterCost`, then divides it **in proportion to each owner's actual consumption**, with the incoming owner taking the remainder — the same convention every levy line already uses, so the two halves reconcile to the full month exactly. Consumption, not days, is the divisor: the reading is taken on the changeover date precisely so nobody is billed for water someone else ran. Days are the fallback only when neither owner used anything, which still leaves the minimum to split.

Electricity is unchanged — still actual consumption per half at a flat rate, never pro-rated.

**Verified** (esbuild clean, plus the engine functions extracted and run headless against the real 1 Aug 2026 bands):

| Case | Result |
|---|---|
| 0 / 3 / 5 / 5.99 / 6 kL | R33.57 each — flat, as specified |
| 6.5 / 7 / 7.13 / 8 / 12 / 20 / 25 kL | table applies, identical to before, unfloored |
| Transfer 15 Aug, 3 kL out / 2 kL in | R20.14 + R13.43 = **R33.57**, one minimum, reconciles |
| Transfer, 0 kL both halves | R16.24 + R17.33 = **R33.57**, split by days |
| Transfer, 14 kL out / 10 kL in | R482.28 + R344.49 = **R826.77** = the whole month |
| Pre-August periods | legacy figures unchanged |
| Common property water | untouched on every path |

**Note:** `CURRENT_PERIOD` is still hard-coded `"2026-07-01"`, so **the app opens on July and shows the old figures**. Switch the period selector to August 2026 to see the new rule bill.

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

### Sasria parsing bug — two rounds to fix, and the lesson is the testing
The first import allocated **R0.00 Sasria**. The first fix didn't work either, and *why* is the part worth keeping.

**Round 1 (wrong diagnosis).** I tested the parser against `pdfplumber`'s text extraction, not pdf.js. They reconstruct lines differently, so my tests passed while the browser failed. Two real bugs were found and fixed — a null overwriting a good value, and `SASRIA Commission: R88.85` on the disclosure pages being summed in as a premium — but neither was *the* bug.

**Round 2 (actual cause).** Running the app's own `extractPdfLines` over the real pdf.js output shows the Sasria sub-total row reconstructs as **three lines, with the annual amount orphaned ABOVE its own label**:

```
"SASRIA Fire - Domestic R740.44"
"R740.44"                   <- the sub-total's annual premium column
"Sasria Sub-Total R0.00"    <- label plus the pro-rata column only
```

So the label row parses to a **confident, wrong R0.00** — not a null. Every null-guard added in round 1 was therefore useless, and no warning fired. Everything else (all 9 items, geyser flags, broker, cover, policy total, policy number, insurer) parsed correctly off the real output; Sasria was the only casualty.

**The fix, in priority order:** Sasria detail rows (one unambiguous amount each) → **the residual `policy total − section premium − broker fee`** → the sub-total row last. Where what was read off the page disagrees with what the policy total implies, **the policy total wins and the disagreement is shown as a note.** The summary is arithmetic — section premium + fees + Sasria = total annual payment — so the residual is the authority, and an allocation that doesn't tie to what the body corporate actually pays is wrong by definition.

**Two invariants now checked on every import**, because a null-check cannot catch a plausible-but-wrong number:
- section premium + broker + Sasria **=** total annual payment
- the sum of the individual items **=** the section premium

Either failing puts a red block above the preview naming the problem in rands.

### Section 6 Blockwatch reported R 0.00 against R 1,800.00 actually paid
"Total paid in FY 2025/2026 (recorded)" was reading **`ops_expenses` only**:

```js
const bwRows = (ops.data || []).filter((e) => /blockwatch/i.test(e.category || ""));
```

There is not one Blockwatch row in `ops_expenses`, and not one in `bank_transactions`. **All twelve payments are approved levy deductions** — the unit that carries Blockwatch pays it personally every month and recovers it against proof of payment, so it never touches the Body Corp bank account. Confirmed against the live database: 12 items, 12 distinct months, R1,800.00, implying R150.00/month.

An expenditure line has **three** sources — operating expenses, bank debits, approved deductions — and this one counted a third of them. Garden service (section 7) never had the bug because it reads `report.expenseRows`, which aggregates all three; Blockwatch was hand-rolled.

**Fix.** `itemisedFor(category)` was generalised to `itemisedBy(match, label)`, so sections 3, 4 and the Blockwatch total now share one code path instead of Blockwatch keeping a private one that could drift. Matching is case-insensitive because the category reads `BlockWatch` while the operating-expense log has used `Blockwatch (actual cost)`. The displayed total is taken from the **section 1 BlockWatch line** (same as garden), so section 6 cannot contradict the dashboard; `blockwatch.actualTotal` is the same arithmetic over the same three sources and drives the implied monthly fee.

`monthCount` now counts **distinct statement months**, not items — a month where Blockwatch shares a claim with something else (March and July 2026 both do) is still one month, and two entries in one month must not halve the implied monthly fee.

**Two new checks in section 6:** if the section 1 line and the itemisation disagree, the report says so; and if fewer than 12 months carry a Blockwatch entry it names how many are missing, since a silently short year is exactly what went unnoticed here.

> **Worth auditing:** any other figure derived from a single source. The three-source rule applies to every expenditure line, and Blockwatch was the one place it was forgotten.

### Config: AGM figures button wording, and what the year selector means
The card read **"Save AGM figures for FY 2025/2026"**, which implies everything on it belongs to that year. It doesn't — and that is worth having written down, because it prompted a request to re-point the whole card at FY 2026/2027, which would have blanked this year's report.

**The convention (unchanged, confirmed 7 August 2026):** the `agm_report_settings` row for FY X holds **X's current figures and X+1's proposed ones**. Section 7 takes "Current Rate Per Day" and "Proposed salary for FY 2026/2027" from the same row, and the report reads settings for the year it is generated for. The September 2026 AGM reports on **FY 2025/2026**, so both sets stay on the 2025/2026 row.

- Button is now simply **"Save AGM figures"** — no year, since naming one is what misleads.
- The card now states that the year selector is the **year the report covers**, not the year every figure applies to, and spells out that *current* fields are that year's while *proposed* and *new* fields are for the year after.

> The alternative — keying every figure to the year it applies to, with the report reading Current from one row and New from the next — is cleaner as a data model and was offered. It was declined: it changes the report, makes the `proposed`/`new` columns redundant, and needs the existing figures migrated. Worth revisiting only if the current convention keeps causing this confusion.

### Policy details vanished on refresh — the migration was never applied
The insurance upload saved the per-unit grid but the policy number, insurer, cover start and policy total came back blank after a reload.

**Cause: `insurance_policy_metadata.sql` was written but never run.** It was handed over as "additive and not yet applied", and then two later migrations *were* applied directly via the Supabase MCP — so the set of applied migrations quietly diverged from the set of written ones. The four `agm_report_settings` columns did not exist, the settings upsert failed on unknown columns, and the schedule rows — written first, in a separate statement — were already committed.

That is why it looked like a partial save: the grid persisted, the policy details did not.

- **Migration applied.** The four columns now exist; FY 2026/2027 carries policy `GWK-REN-ELCOR00006 - Renewal(1)`, Renasa, cover from 01 September, total R24,365.16, and FY 2025/2026's policy total is backfilled.
- The uploaded FY 2026/2027 grid was **already correct** — Sasria at R105.78 per unit, premiums matching the schedule — confirming the parser fix held.
- **The save now names which half survived** rather than reporting a bare failure, and says outright when the message looks like a missing column.

> **Process rule: apply a migration in the same session it is written, or say plainly that it is outstanding.** "Not yet applied" in a handover note is not a mechanism — nothing tracks it, and the next session has no way to know. Every migration in `migrations/` is now applied.

### Ownership changes: pro-rata statements when a unit transfers mid-month
Unit 4 sold with transfer on 6 August 2026 and both owners needed an August statement. The app could only ever hold **one statement per unit per period**, so the split had no home.

**Two rules, and conflating them is the mistake to avoid:**
- **Metered water and electricity are NOT pro-rated.** A reading is taken on the changeover date and each owner is billed their actual consumption. Pro-rating metered usage by days would charge a seller for water the buyer ran.
- **The fixed levy lines ARE pro-rated**, by days of the month.

**New table `ownership_changes`** (migration `ownership_changes.sql`, applied): one row per unit per statement month — changeover date, the readings taken that day, optional owner names and a note. `changeover_date` is the last day the **outgoing** owner is liable for, *inclusive*: 2026-08-06 means 6 days out of 31. **The row's existence is what makes the statement screen render two statements instead of one**, so removing it puts the month straight back to normal — safe to experiment with.

**`splitStatementForChangeover`** builds two statement rows from one. Each levy line is apportioned individually and **the incoming owner receives the remainder rather than its own rounded share**, so every line — and therefore the total — reconciles to the full month exactly. The water calculation reuses the engine's two-rule logic (free first tier above the free-band limit, merged individual bands below it) rather than a second copy that could drift. A whole-month `statement_overrides` entry is deliberately **not** carried onto either half — it describes a month that is no longer being billed as one — and the override card is hidden while a month is split.

**On the statement screen:** a capture card under the preview, and when a change exists the page renders both statements, each headed with its date range, day count and owner. **Each half prints on its own** — printing both to one page would send each owner the other's statement.

**Unit 4, August 2026 — outgoing owner, 1–6 Aug (6/31 days):**

| Line | | |
|---|---|---|
| Water | 0.44 kL (5164.56 → 5165) | R14.77 |
| Electricity | 19.3 kWh (134744.00 → 134763.3) | R54.23 |
| VAT @ 15% | | R10.35 |
| Levy — 6/31 | | R348.83 |
| **Total** | | **R428.18** |

Incoming owner takes **R1,453.43** of levy plus consumption measured from 5165 / 134763.3 against the 31 August reading.

> The levy share is **R348.83, not the R348.82** quoted in conversation before the code existed. Apportioning the R1,802.26 total once gives 348.82; apportioning each of the nine lines and summing gives 348.83. **Per line is correct** — it is what makes every individual line reconcile — so the total is R428.18.

**Verified:** all nine levy lines reconcile to the full month exactly, water and electricity consumption sum back to the full month's, and the outgoing figures match the hand calculation.

> **Ad-hoc charges stay with the outgoing owner**, on the reasoning that they were raised against the unit before transfer. Unit 4 had none in August so nothing was at stake, but a charge that actually belongs to the incoming owner has to be moved on the Additional charges page. Worth revisiting if that turns out to be the common case.

### Electricity service and network charges reported R 0,00 — two causes
Reported as R 0,00 for FY 2026/2027 despite the August 2026 council bill being uploaded. `council_invoices` had it correctly (service **R304.12**, network **R1,227.18**); the report was reading somewhere else entirely.

**Cause 1 — zeros written by the standards save (introduced and fixed the same day).** `levy_rates`' three fee columns were `NOT NULL`, so creating a row for a new FY — which now happens the moment the common property standards are saved for that year — had to put *something* in them, and that was `0`. Zero is not "not captured": the report printed **R 0,00**, which reads as *the scheme charges nothing* rather than *nobody has set this yet*. This was flagged as a known wart when the standards were made editable and it bit **within the hour**.
- Migration `levy_rates_nullable_fees.sql` drops `NOT NULL` on `water_demand_levy`, `electricity_service_fee`, `electricity_network_fee`, and the insert now writes **null**. The FY 2026/2027 row created at 11:50 was corrected — fees back to null, the 20 kL / 300 kWh standards kept, because those were deliberately entered.
- **Rule: a side effect that creates a row must not invent values for columns the user never filled in.** Null is the honest answer and renders as a blank cell for completion in Word.

**Cause 2 — those two rows never read the uploaded bill (pre-existing).** They read `levy_rates` only, so they would have stayed blank however many bills were uploaded. The demand levy row directly above them has always had a council-invoice fallback; these two were simply missed. They now use the same fallback, and the report **footnotes which figures came off the invoice rather than an AGM-approved rate**, so a bill-derived number is never mistaken for an approved one.

> Not interchangeable in general: FY 2025/2026's approved `water_demand_levy` is **R124.00** against a council charge of R65.08–R107.74. The electricity fees happen to match the invoice; the demand levy does not. Hence the footnote rather than a silent substitution.

**Verified against live data:** an FY 2026/2027 report now renders R304.12 and R1,227.18 from the August 2026 invoice, with the source footnote. FY 2025/2026 is untouched — it has approved figures (R278.98 / R1,125.75) which still win.

### Tariffs & rates: each section saves on its own
One button wrote all four sections at once, so correcting a VAT rate also committed a half-finished water rate set. Now each card has its own Save.

- **`saveTariffsToDb` split into four writers** — `saveWaterBandsToDb`, `saveElectricityRateToDb`, `saveVatRateToDb`, `saveCommonPropertyStandardsToDb` — each touching only its own table. A failure in one can no longer leave another half-written. The combined function is gone; so is the single button at the bottom of the page.
- Each card carries **its own status** (idle / saving / saved / error) via a shared `SectionSave` control, rather than one flag lighting up all four.

**The non-obvious part: electricity, VAT and the standards are now local drafts.** A save calls `onSaved()`, which reloads app data — and with four independent buttons that reload would have **silently reverted whatever was typed into the other three cards**. So those three sections now hold their edits locally and only push to the app once their own section saves. A draft follows the app while it is clean; the moment it differs it is unsaved work and a reload leaves it alone.

This also fixes something that was arguably wrong before: typing a VAT or electricity rate used to change what the dashboard billed on **immediately, before saving**. It no longer does — which is precisely the reasoning already recorded on the water card ("editing a future rate set here must not silently re-price the statements behind it"). All four sections now behave the same way.

> Consequence worth knowing: an unsaved rate no longer previews on other screens. The common-property cost preview inside the card does use the drafts, so what that section will cost is still visible before committing.

**Verified:** esbuild clean; no references left to `saveTariffsToDb`; the parent setters are called only on a successful save or on data load, never from an input's `onChange`.

### Common property standards made editable and FY-scoped
The **water** standard was a hard-coded `COMMON_PROPERTY_WATER_KL = 20` used in seven places, labelled on screen as *"fixed, not configurable"*. `levy_rates.common_property_water_kl` already existed, with a default of 20 — **the column was dead**: nothing read it or wrote it except the AGM report and the usage-trend chart, both of which fell back to the constant. Changing the standard meant a code change and a deploy.

- **Both standards now read and write `levy_rates`, keyed by financial year.** The constant is renamed `COMMON_PROPERTY_WATER_KL_DEFAULT` and is only the fallback used before the table loads or if the fetch fails — matching how `COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT` already worked.
- **The water standard is now an editable input** on Tariffs & rates, beside the electricity one. The value threads through `computeSuggestedLevyItems`, `useAllocation` and the dashboard's over-allocation verdicts exactly as the electricity standard already did, so nothing reads a different number from anything else.
- **The financial year is on screen.** The card names the FY it is editing and states that it follows the period selector in the top bar. There is no separate FY dropdown, deliberately: the rest of that page (water bands, electricity rate) is **date**-scoped via `effective_from`, and two different time controls on one screen is how they get confused. Editing in July 2026 edits FY 2025/2026; switch the period to August 2026 and you are editing FY 2026/2027.
- **A year with no row carries forward and says so**, in the same amber notice the levy grid uses — last year's figures as a starting point, nothing saved against the new year, last year untouched. Saving writes a fresh row.

**Verified:** esbuild clean; no bare-constant references left; the exact `INSERT` the app performs for a not-yet-set-up FY was dry-run against the live table (satisfies the `NOT NULL` columns) and the test row removed. `levy_rates` still holds exactly one row, FY 2025/2026, 20 kL / 300 kWh.

> **Pre-existing wart, unchanged but now easier to hit:** saving standards for a financial year that has no row inserts `water_demand_levy`, `electricity_service_fee` and `electricity_network_fee` as **0**, so section 8's "New — FY" column prints R 0,00 for those rather than staying blank. It behaved this way before (the electricity standard already created the row); setting the water standard for a new year just makes it more likely. Worth making those columns nullable so an uncaptured figure reads as blank.

### Source audit of the whole report (prompted by the Blockwatch bug)
Every figure in the report was traced to the tables it reads. **Sections 1, 2, 3, 4 and 7 were already correct** (all three sources); 5, 10 and the tariff bands are single-source by design. Three further problems found, all now fixed.

**Section 8 — the "Current" column showed next year's rate.** `council_invoices` was fetched `order by period desc limit 1`, so the Current column carried **the last month of the year, not the year's rate**. Sewerage rose from R697.73 to R774.48 in July 2026 — the final month — so the report showed **R774.48 current against R774.48 new** and told the meeting the tariff was unchanged when it had just risen 11%. Now takes the rate the FY **opened** on, and where a council tariff moved mid-year the report names the old rate, the new rate and the month it moved, so the increase already charged is stated before the meeting is asked to approve the next one. The note is suppressed for the demand-levy row, which prefers the `levy_rates` figure (what the scheme bills a unit, R124.00) over the council charge — different numbers, not comparable.

**Section 9 — the service notes asserted where a cost was recorded, and were wrong twice.** "Fire extinguisher servicing … recorded in the operating-expense log" is a **bank debit** (R1,466.25); "CSOS … tracked in the operating-expense log" is mostly **levy deductions** (R712.20). Same wrong assumption that produced the Blockwatch bug. The notes no longer claim a source — a cost can reach the report from any of three — and each now derives its recorded cost from **its own line in section 1**, so CSOS and fire extinguisher finally show a figure at all (previously only garden and Blockwatch did).

**CSOS R376.41 — investigated, not a duplicate.** An `ops_expenses` row (2026-06-02, empty notes, no supersede reason) matched a CSOS deduction of the identical amount (Jan 2026, "Oct–Dec 2025"). CSOS is quarterly and the amounts repeat, so it was ambiguous from the data alone. **Confirmed by the trustee as a genuine separate quarter**; the row's `notes` now say so explicitly, with the date of the decision, so the next audit doesn't re-open it. Had it been a duplicate, section 1 CSOS would have been overstated by R376.41.

> **Noted, not actioned:** the FY 2025/2026 insurance bank debit is **R24,309.71** against a schedule total of R24,365.16 — a R55.45 gap, most likely a mid-year adjustment. It will read as a variance between section 1 and section 5.

**The rule this audit establishes:** an expenditure figure has **three** sources — `ops_expenses`, `bank_transactions`, approved `remittance_advices` deductions. Anything that reads fewer is a bug waiting to be found. Prefer taking a total from `report.expenseRows`, which aggregates all three, over recomputing it.

### Lesson: test the parser against pdf.js, not a stand-in
`pdfplumber` (or any other extractor) is **not** a valid proxy for `extractPdfLines`. pdf.js groups text on a *rounded* y-position, so a table row splits in ways no other tool reproduces — and right-aligned columns can land on a line *before* their label. To test parser changes properly:

```
npm i pdfjs-dist@3.11.174        # matches the CDN version the app loads
```
then run the app's `extractPdfLines` verbatim over the PDF and feed those lines to the parser. Anything else gives false confidence, as it did here.

### Regression tests for the parser
Seven cases, all passing, run against **the real pdf.js reconstruction** of `2026 Renewal.pdf`: real pdf.js output (the case that actually failed) · pdfplumber output · no Sasria detail rows (residual) · no Sasria rows at all (residual) · sub-total row intact · **detail row deliberately wrong — policy total must win and a note must appear** · no policy total *and* no detail (genuinely unknown — must warn, not silently zero). Worth re-running against next year's schedule before trusting it; the harness is in the session transcript, not the repo.

### Verified
- `esbuild` bundle clean (the Windows-built `rollup` native binary can't run under WSL/Linux — use esbuild to syntax-check there, or `npm run build` on Windows).
- Parser run against the **real pdf.js output** of `2026 Renewal.pdf`: all 9 items, all three policy-level figures (section premium R23,390.81, Sasria R740.44, broker R233.91), policy total R24,365.16, policy number, insurer, cover start and total sum insured extracted correctly. Sasria allocates R105.78/unit and the schedule ties out at +R0.03.
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
- `sewerage_per_unit_new` exists because the New column had **no source at all**: `council_invoices` only carries the rate being billed now, and next year's isn't published yet. It was a permanent blank. *(Session 13: the water demand levy and the two electricity charges turned out to have the same problem and now sit here too — `water_demand_levy_new`, `electricity_service_fee_new`, `electricity_network_fee_new`.)*

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

**Billing logic**
- ~~`deriveIndividualWaterBands()` — confirm the 6kL threshold rule.~~ **Closed session 5.** It was implementing the rule correctly; that rule has now been *replaced* by the flat minimum charge, and the function is retained only for pre-August 2026 reprints. See session 5 above.
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

- **After any refactor that deletes state, props or helpers, run `no-undef`.**
  `npx eslint src/App.jsx --rule '{"no-undef":"error"}' --no-inline-config`.
  Vite bundles a reference to a deleted binding without complaint; it only fails
  at runtime, and if it fails inside the data-load `.then()` the app degrades
  silently to mock data. See session 10.
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
