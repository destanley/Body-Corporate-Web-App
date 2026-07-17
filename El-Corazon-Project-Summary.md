# El Corazon Body Corporate — Finance Trustee App
**Project summary / working notes**
Last updated: 17 July 2026 (supersedes the 12 July 2026 summary)

> Devon is the finance trustee for **El Corazon**, a 7-unit residential body corporate in OntdekkersPark (1709), South Africa. This app manages monthly levy statements, water & electricity billing, bank reconciliation, and resident remittance advices. Devon builds and deploys it directly.

---

## Infrastructure (current)

- **Repo:** `https://github.com/destanley/Body-Corporate-Web-App` (branch `main`)
- **Local working folder:** `G:\Claude Playground\CoWork\el-corazon-web`
- **Live app file:** `src/App.jsx` — this is the file `main.jsx` imports and the one that renders. (The old `src/ElCorazonWebApp_5.jsx` duplicate has been **deleted**; don't reintroduce it.)
- **Build tooling:** Vite 7 + `@vitejs/plugin-react` 4.7 (React 18). Pinned to Vite 7 deliberately — Vite 8/Rolldown caused a `jsx` peer-dependency failure. Supabase config comes from env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`); the publishable key is no longer hard-coded in source.
- **Hosting:** Cloudflare Pages (free, unlimited bandwidth), auto-deploys on push to `main`.
  - Build command `npm run build`, output dir `dist`, framework preset "None".
  - Env vars set in the Pages project: `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`.
  - SPA routing handled by `public/_redirects` and `vercel.json`.
- **Supabase project:** `ctqyxxlnnrgtyyxubsle` (org `liciwrkhrrsserpzjjzn`, eu-west-1, Postgres 17, "El Corazon").
- **Edge function:** `gmail-import` writes `email_imports` using the service role (bypasses RLS).
- **Frontend ↔ DB:** supabase-js from CDN; trustee uses an authenticated session; residents use a per-unit capability token (`?unit=<token>`) via SECURITY DEFINER RPCs.

---

## Architecture: auth & access model (IMPORTANT — the old notes were wrong)

The prior summary claimed "RLS disabled, no auth, front-end-only prototype." **That is out of date.** The live database already implements a two-tier model:

- **Trustee** logs in via Supabase Auth (email/password) → `authenticated` role → full access. Only auth user today: `devon.stanl@gmail.com` (`9938660a-f2bb-47d8-9eb2-8b017a6f4a00`).
- **Residents** never log in. Each unit has a `units.access_token` (uuid). A resident opens `?unit=<token>` and reads/writes **only their own unit** through token-scoped SECURITY DEFINER functions: `get_unit_by_token`, `get_unit_periods`, `get_unit_statement`, `submit_remittance`. These were reviewed and are correctly isolated (no cross-unit leakage).

### Reconciliation model (needed to understand the PAID stamp)
- `reconcileUnits()` in `App.jsx` is the single source of truth. A unit+period is **settled/reconciled** when a matched `resident_payment` bank line is within R0.05 (`RECON_TOLERANCE`) of the expected amount (statement total minus any **approved** deduction), **or** the trustee marked that line "reviewed".
- A statement for month **M** is paid on the **M+1** bank statement, so matched `bank_transactions.period` = statement period + 1 month (`ACTIVE_PAYMENT_PERIOD`).

---

## Done in this session (17 July 2026)

### 1. Security hardening (Auth + RLS) — applied to the live DB
Migrations applied (Supabase):
- `close_rls_gaps_email_imports_expense_categories` — enabled RLS + trustee-only policy on `email_imports` and `expense_categories` (both were fully exposed to the anon key).
- `restrict_rename_expense_category_to_authenticated` — revoked `EXECUTE` on `rename_expense_category` from `public`/`anon` (was anon-callable); now trustee-only.
- `trustee_allowlist_hardening` — added a `trustees` allowlist table (seeded with Devon), an `is_trustee()` helper, and rewrote **all 16** table policies from `USING(true)` to `USING(public.is_trustee())`. So a stray/self-registered auth user now gets **nothing** until explicitly added to `trustees`.
- Verified: 0 tables left open; the two critical RLS advisor errors cleared.
- **To add another trustee later:** create their Auth login, then
  `insert into public.trustees (user_id, email) values ('<uid>', '<email>');`

### 2. Deployment (Task A)
- Wrapped the single-file prototype in a proper Vite project; moved Supabase config to env vars; set up Cloudflare Pages.
- Resolved a chain of deploy issues: localhost-only → needs hosting; Vite 8 `jsx` warning → pinned Vite 7; `ERESOLVE` peer conflict → Vite 7 + plugin-react 4.7; wrong framework preset/output dir → None + `dist`; env var name `SUPABASE_KEY` → `VITE_SUPABASE_KEY` (Vite only exposes `VITE_`-prefixed vars).

### 3. Mobile-responsive resident pages
- Added a resident-scoped mobile stylesheet (`@media max-width:640px`, gated by a `resident-scope` class) so the trustee UI is untouched.
- Wide statement table now scrolls inside its card (`scroll-x`); header/input rows wrap (`wrap-sm`); inputs are 16px (no iOS auto-zoom); banking details go single-column (`bank-grid`); primary actions are full-width ≥44px (`resident-actions`); reduced padding.

### 4. "PAID" stamp on reconciled resident statements
- Migration `get_unit_statement_add_matched_payment` — the RPC now also returns `payment` `{amount, reviewed}` for the matched line on the payment month (M+1). Backward-compatible.
- `computeStatementRow()` derives `reconciled` mirroring `reconcileUnits()` exactly; `StatementPaper` renders an angled **green outline** (ledger-green #2F5D50) double-ruled "PAID · <MONTH YEAR> · RECONCILED" stamp when `reconciled`, using `mix-blend: multiply`; carries through to the printed PDF. Shows only for reconciled unit+period.

---

## Outstanding / next steps

**Deployment & ops**
- Confirm the latest Cloudflare deploy is green after the Vite 7 fix and the mobile + PAID-stamp commits are pushed. (DB migrations are already live; frontend changes require commit + push.)
- **Two Supabase dashboard toggles still pending** (can't be done via SQL):
  1. **Disable public sign-ups** (Authentication → Providers) — this is what makes the trustee allowlist airtight.
  2. **Enable leaked-password protection** (HaveIBeenPwned) — optional, free.
- `/api/notify-remittance` (remittance email via Resend) is a **stub** and will 404 on static hosting until a serverless function (Cloudflare Pages Functions or a Vercel API route) is added. Email notifications are not live.
- Minor advisor warnings remain and are acceptable/known: the token RPCs are intentionally anon-callable; `pg_net` extension in `public`.

**Billing logic (carried over — verify current state in `App.jsx`)**
- `deriveIndividualWaterBands()` — confirm it implements the **6kL minimum-charge threshold** rule (usage >6kL uses the real scale incl. free first 6kL; usage ≤6kL bills every kL at the first paid rate). Earlier notes flagged it still used the old "merge free band for everyone" logic — verify/fix.
- Electricity rate convention: seed is R2.5755 (municipal) vs app default R2.58 (rounded). Confirm the canonical production value.

**Product**
- Annual report generator (due each September) — not built; confirm STSMA audit/independent-review sign-off with the scheme's accountant.
- Real owner names in `units` (pending the public-GitHub-exposure decision).
- Deduction-approval edge cases (proof never produced; claimed amount ≠ actual invoice).

---

## Working agreements
- Consider long-term effects before changing the **live** DB; when uncertain, ask. Keep credit usage low; prefer the simplest change that works.
- Read this summary at the start of each new conversation.
- Claude cannot write to the Claude Projects knowledge base directly — this file must be copied in manually to update it.
- Git: the remote has occasionally had commits not present locally (multi-machine/session). **Always `git pull --rebase origin main` before starting new work.** During a rebase, conflict `--ours`/`--theirs` are reversed vs a normal merge — resolve carefully (or ask).
