// manage-trustees — admin actions the browser cannot perform.
//
// Creating, deleting and password-setting all need the Supabase admin API,
// which needs the SERVICE ROLE key. That key must never reach the browser: it
// bypasses every RLS policy in the schema. So it lives here, and the browser
// asks this function instead.
//
// AUTHORISATION IS DONE HERE, NOT BY THE CALLER. The client hiding the User
// management page from non-finance trustees is a convenience; this check is
// the control. Every request is resolved back to a user via their own JWT and
// then looked up in `trustees` — a caller cannot assert who they are.
//
// verify_jwt is on, so an unauthenticated request never reaches this code.
//
// Deploy: supabase functions deploy manage-trustees
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// by the platform — there is no secret to configure.)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const VALID_ROLES = ["finance", "approver", "maintenance"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);

  // Who is calling: resolved from their own token, never from the body.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in." }, 401);
  const caller = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Only a finance trustee may manage users.
  const { data: callerRow, error: roleErr } = await admin
    .from("trustees").select("role").eq("user_id", caller.id).maybeSingle();
  if (roleErr) return json({ error: roleErr.message }, 500);
  if (!callerRow || callerRow.role !== "finance") {
    return json({ error: "Only the finance trustee can manage users." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body." }, 400); }
  const action = String(body.action || "");

  try {
    // ---------------- create ----------------
    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = String(body.role || "approver");
      const displayName = body.display_name ? String(body.display_name).trim() : null;
      const allowedPages = Array.isArray(body.allowed_pages) ? body.allowed_pages as string[] : null;

      if (!email) return json({ error: "An email address is required." }, 400);
      if (!VALID_ROLES.includes(role)) return json({ error: `Unknown role "${role}".` }, 400);
      if (password && password.length < 8) {
        return json({ error: "A password must be at least 8 characters." }, 400);
      }

      // With a password the account works immediately; without one they are
      // invited and set their own, which is the better default.
      let newUserId: string;
      if (password) {
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (error) return json({ error: error.message }, 400);
        newUserId = data.user!.id;
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
        if (error) return json({ error: error.message }, 400);
        newUserId = data.user!.id;
      }

      const { error: insErr } = await admin.from("trustees").insert({
        user_id: newUserId, email, role,
        display_name: displayName, allowed_pages: allowedPages,
      });
      if (insErr) {
        // Do not leave an auth user with no trustees row — it would be a login
        // that reaches the app and then fails every policy, which looks like a
        // bug rather than a half-finished creation.
        await admin.auth.admin.deleteUser(newUserId);
        return json({ error: insErr.message }, 400);
      }
      return json({ ok: true, user_id: newUserId, invited: !password });
    }

    // ---------------- delete ----------------
    if (action === "delete") {
      const userId = String(body.user_id || "");
      if (!userId) return json({ error: "user_id is required." }, 400);
      if (userId === caller.id) {
        return json({ error: "You cannot remove your own login." }, 400);
      }

      // Never remove the last finance trustee — the scheme would have nobody
      // who can manage users, or write a levy figure, and no way back in
      // through the app.
      const { data: target } = await admin
        .from("trustees").select("role").eq("user_id", userId).maybeSingle();
      if (target?.role === "finance") {
        const { count } = await admin
          .from("trustees").select("user_id", { count: "exact", head: true }).eq("role", "finance");
        if ((count ?? 0) <= 1) {
          return json({ error: "That is the only finance trustee — promote someone else first." }, 400);
        }
      }

      await admin.from("trustees").delete().eq("user_id", userId);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ---------------- set_password ----------------
    if (action === "set_password") {
      const userId = String(body.user_id || "");
      const password = String(body.password || "");
      if (!userId) return json({ error: "user_id is required." }, 400);
      if (password.length < 8) return json({ error: "Use at least 8 characters." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}".` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Unexpected error." }, 500);
  }
});
