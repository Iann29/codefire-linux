-- Clean up orphaned teams from failed create attempts
DELETE FROM public.teams
WHERE id NOT IN (SELECT DISTINCT team_id FROM public.team_members);
