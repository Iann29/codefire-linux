-- Delete orphaned teams (teams with no members, from failed create attempts)
DELETE FROM public.teams
WHERE id NOT IN (SELECT DISTINCT team_id FROM public.team_members);
