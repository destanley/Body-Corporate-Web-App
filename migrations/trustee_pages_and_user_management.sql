-- Per-user page visibility and the profile lookup behind it. 11 August 2026.
--
-- Mirror of the migration applied via the Supabase MCP:
--   trustees_allowed_pages
--
-- Paired with the `manage-trustees` Edge Function (source in
-- supabase/functions/manage-trustees/index.ts), which holds the service role
-- key so the browser never does.

-- NULL means "use this role's defaults", and it is the default. Two reasons,
-- both of which bite in practice:
--
--   * a trustee added without a page list behaves exactly as the role-based
--     nav did, rather than seeing an empty menu;
--   * a screen ADDED to the app later appears automatically for everyone on
--     the defaults. An explicit list is a snapshot and will not contain a page
--     that did not exist when it was saved — the User management screen says
--     so where the list is edited.
alter table public.trustees
  add column if not exists allowed_pages text[];

-- So the list reads as people rather than as email addresses.
alter table public.trustees
  add column if not exists display_name text;

-- THIS GOVERNS THE SIDE NAV ONLY. It is not a security boundary: read access
-- is open to every trustee by policy, so hiding a page does not stop the data
-- behind it being fetched through the API. What someone can WRITE is decided
-- by their role in RLS and nothing here changes that.
--
-- Written down because a page list that looks like permissions invites being
-- trusted as permissions.

-- One round trip for role + pages + name, and security definer so a user can
-- always read their own row and load their own nav.
create or replace function public.my_trustee_profile()
returns table (role text, allowed_pages text[], display_name text)
language sql stable security definer set search_path to 'public' as $$
  select t.role, t.allowed_pages, t.display_name
  from public.trustees t
  where t.user_id = auth.uid();
$$;

grant execute on function public.my_trustee_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Landing page (migration: trustee_landing_page)
-- ---------------------------------------------------------------------------
-- Which screen a trustee opens on at sign-in.
--
-- Deliberately plain text with no foreign key or check constraint against the
-- page list. The page keys live in the app (NAV_PAGES), not the database, so a
-- constraint here would need migrating every time a screen is added or renamed,
-- and a rename would fail the migration against existing rows.
--
-- The cost of that choice is that this column can name a page the user cannot
-- see, or one that no longer exists — after a role change, a page-list edit, or
-- a screen being removed. So THE APP TREATS THIS AS A HINT, not an instruction:
-- resolveLandingPage() honours it only if it is among the pages that user can
-- actually see, and otherwise falls back to their first visible page. Landing
-- someone on a blank screen because of a stale preference would be worse than
-- ignoring the preference.
--
-- NULL means "no preference" and is the default.
alter table public.trustees
  add column if not exists landing_page text;

-- Adding a column to the return type changes the row type, so this had to be
-- dropped and recreated rather than replaced (`create or replace` errors with
-- "cannot change return type of existing function").
drop function if exists public.my_trustee_profile();

create function public.my_trustee_profile()
returns table (role text, allowed_pages text[], display_name text, landing_page text)
language sql stable security definer set search_path to 'public' as $$
  select t.role, t.allowed_pages, t.display_name, t.landing_page
  from public.trustees t
  where t.user_id = auth.uid();
$$;

grant execute on function public.my_trustee_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Edge Function: manage-trustees
-- ---------------------------------------------------------------------------
-- Deployed with verify_jwt = true. Actions: create, delete, set_password.
--
-- Authorisation is done INSIDE the function, not by the caller. The client
-- hiding the User management page from non-finance trustees is a convenience;
-- the function resolving the caller from their own JWT and looking them up in
-- `trustees` is the control. A caller cannot assert who they are.
--
-- Two guards worth knowing about:
--   * creating a user rolls back the auth user if the trustees insert fails,
--     so there is never a login that reaches the app and then fails every
--     policy — which looks like a bug rather than a half-finished creation;
--   * the last finance trustee cannot be deleted, and nobody can delete
--     themselves. Otherwise the scheme ends up with no one who can manage
--     users or write a levy figure, and no way back in through the app.
--
-- Password resets are deliberately split: the email link is sent CLIENT-side
-- via resetPasswordForEmail (no admin rights needed, and the password only
-- ever exists between Supabase and the user), while setting a temporary one
-- goes through the function. The email route is the default.
