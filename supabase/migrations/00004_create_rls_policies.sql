-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_task_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION public.user_team_ids(uid uuid)
RETURNS SETOF uuid AS $$
  SELECT team_id FROM public.team_members WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.user_project_ids(uid uuid)
RETURNS SETOF uuid AS $$
  SELECT project_id FROM public.project_members WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users policies
CREATE POLICY "users_read_teammates" ON public.users FOR SELECT USING (
  id = auth.uid() OR id IN (
    SELECT tm.user_id FROM public.team_members tm
    WHERE tm.team_id IN (SELECT public.user_team_ids(auth.uid()))
  )
);
CREATE POLICY "users_update_self" ON public.users FOR UPDATE USING (id = auth.uid());

-- Teams policies
CREATE POLICY "teams_read" ON public.teams FOR SELECT USING (
  id IN (SELECT public.user_team_ids(auth.uid())) OR public.is_super_admin(auth.uid())
);
CREATE POLICY "teams_insert" ON public.teams FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "teams_update" ON public.teams FOR UPDATE USING (
  owner_id = auth.uid() OR public.is_super_admin(auth.uid())
);

-- Team members policies
CREATE POLICY "team_members_read" ON public.team_members FOR SELECT USING (
  team_id IN (SELECT public.user_team_ids(auth.uid()))
);
CREATE POLICY "team_members_insert" ON public.team_members FOR INSERT WITH CHECK (
  team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  ) OR user_id = auth.uid()
);
CREATE POLICY "team_members_delete" ON public.team_members FOR DELETE USING (
  team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);

-- Synced projects policies
CREATE POLICY "projects_read" ON public.synced_projects FOR SELECT USING (
  id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "projects_insert" ON public.synced_projects FOR INSERT WITH CHECK (
  team_id IN (SELECT public.user_team_ids(auth.uid()))
);
CREATE POLICY "projects_update" ON public.synced_projects FOR UPDATE USING (
  id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "projects_delete" ON public.synced_projects FOR DELETE USING (
  id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Project members policies
CREATE POLICY "project_members_read" ON public.project_members FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "project_members_manage" ON public.project_members FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "project_members_delete" ON public.project_members FOR DELETE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Synced tasks policies
CREATE POLICY "tasks_select" ON public.synced_tasks FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "tasks_insert" ON public.synced_tasks FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "tasks_update" ON public.synced_tasks FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "tasks_delete" ON public.synced_tasks FOR DELETE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Task notes policies
CREATE POLICY "task_notes_select" ON public.synced_task_notes FOR SELECT USING (
  task_id IN (SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_project_ids(auth.uid())))
);
CREATE POLICY "task_notes_insert" ON public.synced_task_notes FOR INSERT WITH CHECK (
  task_id IN (SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_project_ids(auth.uid())))
);

-- Synced notes policies
CREATE POLICY "notes_select" ON public.synced_notes FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "notes_insert" ON public.synced_notes FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "notes_update" ON public.synced_notes FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "notes_delete" ON public.synced_notes FOR DELETE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Activity events policies
CREATE POLICY "activity_read" ON public.activity_events FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "activity_insert" ON public.activity_events FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid())) AND user_id = auth.uid()
);

-- Session summaries policies
CREATE POLICY "session_summaries_select" ON public.session_summaries FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "session_summaries_insert" ON public.session_summaries FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid())) AND user_id = auth.uid()
);

-- Project docs policies
CREATE POLICY "project_docs_select" ON public.project_docs FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "project_docs_insert" ON public.project_docs FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "project_docs_update" ON public.project_docs FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "project_docs_delete" ON public.project_docs FOR DELETE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Review requests policies
CREATE POLICY "review_requests_select" ON public.review_requests FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "review_requests_insert" ON public.review_requests FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "review_requests_update" ON public.review_requests FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Notifications policies
CREATE POLICY "notifications_own" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (user_id = auth.uid());

-- Team invites policies
CREATE POLICY "invites_read_own" ON public.team_invites FOR SELECT USING (
  email = (SELECT email FROM public.users WHERE id = auth.uid())
  OR team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);
CREATE POLICY "invites_insert" ON public.team_invites FOR INSERT WITH CHECK (
  team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);
CREATE POLICY "invites_update" ON public.team_invites FOR UPDATE USING (
  team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);

-- Team grants policies
CREATE POLICY "grants_read" ON public.team_grants FOR SELECT USING (
  public.is_super_admin(auth.uid()) OR team_id IN (SELECT public.user_team_ids(auth.uid()))
);
CREATE POLICY "grants_insert" ON public.team_grants FOR INSERT WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "grants_update" ON public.team_grants FOR UPDATE USING (public.is_super_admin(auth.uid()));
CREATE POLICY "grants_delete" ON public.team_grants FOR DELETE USING (public.is_super_admin(auth.uid()));

-- Super admins policies
CREATE POLICY "super_admins_read" ON public.super_admins FOR SELECT USING (public.is_super_admin(auth.uid()));
