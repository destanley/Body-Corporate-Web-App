# Runbook — `gmail-import` stopped importing

**Symptom:** utility bills and/or FNB statements stop appearing in the app. The
Invoice allocation page shows the "No council bills captured" notice month after
month, or Bank reconciliation has no transactions for a month that has clearly
been and gone.

**The trap:** `cron.job_run_details` will say **`succeeded`** the whole time.
pg_cron only reports that the HTTP request was *queued* — it never sees the
function's response. Never trust it on its own. Always check
`net._http_response`.

Last known incident: **6 August 2026** — `invalid_grant`, imports silently dead
since 14 July 2026.

---

## 1. Confirm it's actually broken (2 minutes)

Run in the Supabase SQL editor:

```sql
-- What the function actually returned. Anything other than 200 is a failure.
select id, status_code, content, created
from net._http_response
order by created desc
limit 5;
```

```sql
-- When did anything last import successfully?
select kind, status, period, subject, error, created_at
from public.email_imports
order by created_at desc
limit 10;
```

```sql
-- Is the schedule itself still alive?
select jobid, jobname, schedule, active from cron.job;
-- expect: 1 | gmail-import-daily | 0 4 * * * | true
```

If `cron.job` is missing the row or `active = false`, skip to **§5**.
If it's there and `net._http_response` shows an error, read the error below.

---

## 2. Match the error to a cause

| Error in `net._http_response.content` | Cause | Fix |
|---|---|---|
| `Gmail token error: {"error":"invalid_grant"...}` | Refresh token dead or revoked | §3 |
| `unauthorized` / status 401 | `x-cron-secret` no longer matches `CRON_SECRET` | §4 |
| `Gmail GET /messages -> 403` | Gmail API disabled, or the scope was reduced | §3, step 1 & 4 |
| `ok: true, processed: 0` | Working fine — no *unlabelled* matching emails. See §6 | §6 |
| status 546 / timeout | Function ran out of memory/time on a big PDF | Re-run manually; if repeatable, reduce `maxResults` |
| No rows in `net._http_response` at all | pg_net didn't fire | §5 |

### Why `invalid_grant` keeps happening

Google kills a refresh token when any of these is true:

1. **The OAuth consent screen is in "Testing" status** — refresh tokens expire
   after **7 days**, every time. This is the most likely cause and the one worth
   fixing permanently (§3, step 1).
2. The Google account password changed.
3. Access was revoked at <https://myaccount.google.com/permissions>.
4. The token went unused for 6 months.

---

## 3. Re-mint the Gmail refresh token

### Step 1 — Kill the 7-day expiry (do this once, permanently)

<https://console.cloud.google.com> → the project holding the El Corazon OAuth
client → **APIs & Services → OAuth consent screen**.

- Check **Publishing status**.
- If it says **Testing** → click **PUBLISH APP** → confirm "In production".
- You will *not* need Google verification. Unverified apps work in production
  for a small number of users; you'll just see a scary "Google hasn't verified
  this app" screen at consent — click **Advanced → Go to (unsafe)**.
- Once in production, refresh tokens stop expiring on a timer.

While you're here: **APIs & Services → Enabled APIs** — confirm **Gmail API**
is enabled.

### Step 2 — Get the client credentials

**APIs & Services → Credentials →** the OAuth 2.0 Client ID (type: Web
application). Copy the **Client ID** and **Client secret**. These must match the
`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` secrets on the edge function — if you
ever create a *new* client, you must update all three secrets together.

### Step 3 — Allow the OAuth Playground as a redirect target

In that same OAuth client, under **Authorised redirect URIs**, add:

```
https://developers.google.com/oauthplayground
```

Save. (Leave it there — it costs nothing and you'll need it next time.)

### Step 4 — Mint the token

1. Go to <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top right) → tick **Use your own OAuth
   credentials** → paste the Client ID and Client secret.
3. In the left panel, under **Input your own scopes**, enter exactly:

   ```
   https://www.googleapis.com/auth/gmail.modify
   ```

   `gmail.modify` is the minimum that covers everything the function does:
   list/read messages, download attachments, list/create labels, and apply the
   `Imported` / `Needs review` labels. Do not use `gmail.readonly` — labelling
   will fail and every email will be reprocessed forever.
4. **Authorize APIs** → sign in as **devon.stanl@gmail.com** → accept the
   unverified-app warning → **Allow**.
5. Step 2 in the Playground → **Exchange authorization code for tokens**.
6. Copy the **Refresh token** (starts `1//`). This is the only time it's shown.

### Step 5 — Store it

Supabase Dashboard → project **El Corazon** (`ctqyxxlnnrgtyyxubsle`) →
**Edge Functions → Secrets** (also reachable at Project Settings → Edge
Functions). Edit `GMAIL_REFRESH_TOKEN`, paste, save.

**No redeploy needed** — secrets are read at invocation time.

Then go to **§5** and test.

---

## 4. If the error is `unauthorized` (401)

The function compares the request's `x-cron-secret` header against its own
`CRON_SECRET` env var. The cron job pulls the header value from Vault:

```sql
select name, description, updated_at from vault.secrets;
-- expect: gmail_import_cron_secret | x-cron-secret for gmail-import
```

They've drifted apart. Pick one value and set it in both places:

- Edge function secret **`CRON_SECRET`** (Supabase Dashboard → Edge Functions → Secrets)
- Vault secret **`gmail_import_cron_secret`**:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'gmail_import_cron_secret'),
  '<the-same-value>'
);
```

---

## 5. Test without waiting for 04:00

Run the cron job's own body by hand:

```sql
select net.http_post(
  url := 'https://ctqyxxlnnrgtyyxubsle.supabase.co/functions/v1/gmail-import',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                      where name = 'gmail_import_cron_secret')
  )
);
```

Wait ~10 seconds, then:

```sql
select status_code, content, created
from net._http_response
order by created desc
limit 1;
```

**Good:** `200` and `{"ok": true, "processed": N, "summary": [...]}`.
**Bad:** back to §2.

If the schedule itself is gone or disabled:

```sql
-- re-enable
update cron.job set active = true where jobname = 'gmail-import-daily';

-- or recreate from scratch
select cron.schedule('gmail-import-daily', '0 4 * * *', $$
  select net.http_post(
    url := 'https://ctqyxxlnnrgtyyxubsle.supabase.co/functions/v1/gmail-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'gmail_import_cron_secret')
    )
  )
$$);
```

---

## 6. `ok: true, processed: 0` — nothing to do, or a stuck email?

The function only picks up messages matching this Gmail search:

```
has:attachment
(subject:"City of Johannesburg Account: 300993014"     <- water
 OR subject:"City of Johannesburg Account: 220022810"  <- electricity
 OR (subject:"FNB Statement" subject:61123184551))
-label:Imported -label:"Needs review"
```

So `processed: 0` means one of:

- **Nothing new arrived.** Normal for most days — bills are monthly.
- **The email is already labelled** `Imported` or `Needs review` in Gmail. The
  function deliberately never retries these.
- **The subject line changed.** CoJ or FNB reworded it, or the account number
  moved. Search Gmail manually with the query above; if the bill is there but
  the query misses it, the `classify()` function and the Gmail query string
  inside the edge function need updating together.

### Forcing a retry of one stuck email

Both of these are needed — the function dedupes on `gmail_message_id` *and*
skips labelled mail:

1. In Gmail, remove the `Needs review` (or `Imported`) label from the message.
2. Delete the tracking row:

```sql
-- find it
select id, gmail_message_id, kind, period, status, error
from public.email_imports
order by created_at desc;

-- then
delete from public.email_imports where gmail_message_id = '<id>';
```

Also note two safety guards that will make a retry *look* like it failed:

- **Council invoices** are only written when every expected figure parsed. A
  partial parse lands as `needs_review` with the raw text kept — capture the
  figures by hand under **Utility bills** instead.
- **FNB statements** are skipped entirely if `bank_transactions` already has any
  row for that period, and rejected if the parsed transaction count doesn't
  match the count declared on the statement.

---

## 7. Catch it earlier next time

The failure is silent by design — nobody notices until a month's data is
missing. Run this monthly (or wire it to an alert):

```sql
-- Anything that isn't a 200 in the last 30 days
select status_code, count(*), max(created) as last_seen
from net._http_response
where created > now() - interval '30 days'
group by status_code
order by status_code;
```

```sql
-- Has anything imported this month?
select count(*) filter (where status = 'imported') as imported_this_month
from public.email_imports
where created_at >= date_trunc('month', now());
```

A reasonable rule of thumb: **by the 10th of any month, the previous month
should have a `council_invoices` row and a full set of `bank_transactions`.**
If it doesn't, start at §1.

---

## Reference — where everything lives

| Thing | Location |
|---|---|
| Edge function | Supabase → Edge Functions → `gmail-import` (verify_jwt off) |
| Function source | **Not in this repo** — lives only in Supabase. Pull it with the Supabase MCP / CLI before editing. |
| Function secrets | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `CRON_SECRET` |
| Cron schedule | `cron.job` jobid 1, `gmail-import-daily`, `0 4 * * *` (04:00 UTC = 06:00 SAST) |
| Cron shared secret | Vault secret `gmail_import_cron_secret` |
| Import audit trail | `public.email_imports` |
| Function responses | `net._http_response` (**the only place errors are visible**) |
| Gmail labels used | `Imported`, `Needs review` (auto-created if absent) |
| Accounts watched | CoJ water `300993014`, CoJ electricity `220022810`, FNB `61123184551` |
| Google account | devon.stanl@gmail.com |
