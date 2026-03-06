CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.session_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  session_slug text,
  model text,
  git_branch text,
  summary text NOT NULL,
  files_changed jsonb DEFAULT '[]'::jsonb,
  duration_mins int,
  started_at timestamptz,
  ended_at timestamptz,
  shared_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.users(id),
  last_edited_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.synced_tasks(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'dismissed')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_project ON public.activity_events(project_id, created_at DESC);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_review_requests_assigned ON public.review_requests(assigned_to, status);
CREATE INDEX idx_session_summaries_project ON public.session_summaries(project_id, shared_at DESC);
CREATE INDEX idx_project_docs_project ON public.project_docs(project_id, sort_order);
