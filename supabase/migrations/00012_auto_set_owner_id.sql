-- Auto-set owner_id from the authenticated user on team creation.
-- This eliminates the need for clients to send owner_id.
ALTER TABLE public.teams ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- Update teams_insert policy to just require authentication
DROP POLICY IF EXISTS "teams_insert" ON public.teams;
CREATE POLICY "teams_insert" ON public.teams FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());
