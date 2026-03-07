-- =============================================================================
-- Fix ALL RLS policies to avoid infinite recursion.
--
-- The root cause: policies on team_members that query team_members inline
-- trigger the SELECT policy, which queries team_members again → infinite loop.
--
-- Fix: Use SECURITY DEFINER helper functions which bypass RLS.
-- =============================================================================

-- Helper: check if user is owner/admin of a team (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_team_admin(uid uuid, tid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = uid AND team_id = tid AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── teams ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "teams_read" ON public.teams;
CREATE POLICY "teams_read" ON public.teams FOR SELECT USING (
  id IN (SELECT public.user_team_ids(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

DROP POLICY IF EXISTS "teams_insert" ON public.teams;
CREATE POLICY "teams_insert" ON public.teams FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

DROP POLICY IF EXISTS "teams_update" ON public.teams;
CREATE POLICY "teams_update" ON public.teams FOR UPDATE USING (
  owner_id = auth.uid() OR public.is_super_admin(auth.uid())
);

-- ─── team_members ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "team_members_read" ON public.team_members;
CREATE POLICY "team_members_read" ON public.team_members FOR SELECT USING (
  team_id IN (SELECT public.user_team_ids(auth.uid()))
);

DROP POLICY IF EXISTS "team_members_insert" ON public.team_members;
CREATE POLICY "team_members_insert" ON public.team_members FOR INSERT
  WITH CHECK (
    -- Admins/owners can add members (uses SECURITY DEFINER to avoid recursion)
    public.is_team_admin(auth.uid(), team_id)
    -- OR user can add themselves (for initial team creation / invite acceptance)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "team_members_delete" ON public.team_members;
CREATE POLICY "team_members_delete" ON public.team_members FOR DELETE USING (
  public.is_team_admin(auth.uid(), team_id)
);

-- ─── team_invites ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "invites_read_own" ON public.team_invites;
CREATE POLICY "invites_read_own" ON public.team_invites FOR SELECT USING (
  email = (SELECT email FROM public.users WHERE id = auth.uid())
  OR public.is_team_admin(auth.uid(), team_id)
);

DROP POLICY IF EXISTS "invites_insert" ON public.team_invites;
CREATE POLICY "invites_insert" ON public.team_invites FOR INSERT
  WITH CHECK (public.is_team_admin(auth.uid(), team_id));

DROP POLICY IF EXISTS "invites_update" ON public.team_invites;
CREATE POLICY "invites_update" ON public.team_invites FOR UPDATE USING (
  public.is_team_admin(auth.uid(), team_id)
);

-- ─── users ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users_read_teammates" ON public.users;
DROP POLICY IF EXISTS "users_read_self" ON public.users;
CREATE POLICY "users_read" ON public.users FOR SELECT USING (
  id = auth.uid()
  OR id IN (
    SELECT tm.user_id FROM public.team_members tm
    WHERE tm.team_id IN (SELECT public.user_team_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "users_update_self" ON public.users;
CREATE POLICY "users_update_self" ON public.users FOR UPDATE USING (id = auth.uid());

-- ─── notifications (fix open insert) ─────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
