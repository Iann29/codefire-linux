CREATE TABLE public.synced_projects (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  repo_url text,
  tags text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_members (
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('lead', 'contributor', 'viewer')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE public.synced_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id int,
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority int NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  labels jsonb DEFAULT '[]'::jsonb,
  assigned_to uuid REFERENCES public.users(id),
  created_by uuid NOT NULL REFERENCES public.users(id),
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.synced_task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.synced_tasks(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  mentions uuid[] DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.synced_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.synced_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_synced_tasks_project ON public.synced_tasks(project_id);
CREATE INDEX idx_synced_tasks_assigned ON public.synced_tasks(assigned_to);
CREATE INDEX idx_synced_notes_project ON public.synced_notes(project_id);
CREATE INDEX idx_synced_task_notes_task ON public.synced_task_notes(task_id);
