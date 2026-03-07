-- 1. Ensure nick@gridnpixel.com exists in public.users and is super admin
-- (Backfill again, targeting ALL missing users)
INSERT INTO public.users (id, email, display_name, avatar_url)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'display_name', ''),
  raw_user_meta_data->>'avatar_url'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.users)
ON CONFLICT (id) DO NOTHING;

-- 2. Make nick@gridnpixel.com a super admin
INSERT INTO public.super_admins (user_id)
SELECT u.id FROM public.users u WHERE u.email = 'nick@gridnpixel.com'
ON CONFLICT DO NOTHING;

-- 3. Fix teams_insert policy - any authenticated user can create a team
-- The current policy (owner_id = auth.uid()) should work, but let's replace
-- it to be more explicit and also allow super admins
DROP POLICY IF EXISTS "teams_insert" ON public.teams;
CREATE POLICY "teams_insert" ON public.teams FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (owner_id = auth.uid() OR public.is_super_admin(auth.uid()))
  );

-- 4. Also fix team_members_insert - the owner needs to add themselves
-- Current policy requires existing membership with owner/admin role OR user_id = auth.uid()
-- The self-insert path (user_id = auth.uid()) should work for the owner adding themselves
DROP POLICY IF EXISTS "team_members_insert" ON public.team_members;
CREATE POLICY "team_members_insert" ON public.team_members FOR INSERT
  WITH CHECK (
    -- User can add themselves to any team they own or are admin of
    team_id IN (
      SELECT tm.team_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
    )
    -- OR user can add themselves (for initial team creation)
    OR user_id = auth.uid()
  );

-- 5. Allow users to read their own profile (needed for account display)
DROP POLICY IF EXISTS "users_read_self" ON public.users;
CREATE POLICY "users_read_self" ON public.users FOR SELECT
  USING (id = auth.uid());
