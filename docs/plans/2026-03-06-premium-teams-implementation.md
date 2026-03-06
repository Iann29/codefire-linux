# Premium Teams Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in premium collaborative features (team sync, activity feed, mentions, presence, docs, reviews) to both Swift and Electron apps, backed by Supabase and Stripe.

**Architecture:** Local-primary with cloud sync. SQLite remains the source of truth. A premium module (feature-flagged, fully isolated) syncs to Supabase when enabled. Stripe handles billing. OSS teams get free access via super admin grants.

**Tech Stack:** Supabase (Auth, Postgres, Realtime, Edge Functions), Stripe (subscriptions, webhooks), TypeScript/React (Electron), Swift/SwiftUI (macOS)

**Design doc:** `docs/plans/2026-03-06-premium-teams-design.md`

---

## Phase Overview

| Phase | Scope | Dependency |
|-------|-------|------------|
| **Phase 1** | Supabase setup, auth, sync engine, basic team UI | None |
| **Phase 2** | Stripe billing, plan enforcement, OSS grants | Phase 1 |
| **Phase 3** | Activity feed, @mentions, notifications, presence | Phase 1 |
| **Phase 4** | Shared sessions, project docs, review requests | Phase 3 |

Each phase is independently deployable and testable.

---

## Phase 1: Foundation (Auth + Sync + Teams)

### Task 1: Supabase Project Setup

**Files:**
- Create: `supabase/migrations/00001_create_identity_tables.sql`
- Create: `supabase/migrations/00002_create_synced_tables.sql`
- Create: `supabase/migrations/00003_create_collaboration_tables.sql`
- Create: `supabase/migrations/00004_create_rls_policies.sql`
- Create: `supabase/config.toml`

**Step 1: Initialize Supabase project**

```bash
npx supabase init
```

This creates the `supabase/` directory at the repo root (shared between Swift and Electron).

**Step 2: Create identity tables migration**

```sql
-- supabase/migrations/00001_create_identity_tables.sql

-- Users (extends Supabase Auth)
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Teams
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES public.users(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'agency')),
  seat_limit int NOT NULL DEFAULT 2,
  project_limit int,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Team members
CREATE TABLE public.team_members (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- Super admins
CREATE TABLE public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Team grants (OSS, contributor, custom)
CREATE TABLE public.team_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  grant_type text NOT NULL CHECK (grant_type IN ('oss_project', 'oss_contributor', 'custom')),
  plan_tier text NOT NULL DEFAULT 'agency' CHECK (plan_tier IN ('starter', 'agency')),
  seat_limit int,
  project_limit int,
  repo_url text,
  granted_by uuid NOT NULL REFERENCES public.users(id),
  note text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Team invites
CREATE TABLE public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

**Step 3: Create synced entity tables migration**

```sql
-- supabase/migrations/00002_create_synced_tables.sql

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

-- Indexes
CREATE INDEX idx_synced_tasks_project ON public.synced_tasks(project_id);
CREATE INDEX idx_synced_tasks_assigned ON public.synced_tasks(assigned_to);
CREATE INDEX idx_synced_notes_project ON public.synced_notes(project_id);
CREATE INDEX idx_synced_task_notes_task ON public.synced_task_notes(task_id);
```

**Step 4: Create collaboration tables migration**

```sql
-- supabase/migrations/00003_create_collaboration_tables.sql

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

-- Indexes
CREATE INDEX idx_activity_project ON public.activity_events(project_id, created_at DESC);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_review_requests_assigned ON public.review_requests(assigned_to, status);
CREATE INDEX idx_session_summaries_project ON public.session_summaries(project_id, shared_at DESC);
CREATE INDEX idx_project_docs_project ON public.project_docs(project_id, sort_order);
```

**Step 5: Create RLS policies migration**

```sql
-- supabase/migrations/00004_create_rls_policies.sql

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

-- Helper: check if user is in a team
CREATE OR REPLACE FUNCTION public.user_team_ids(uid uuid)
RETURNS SETOF uuid AS $$
  SELECT team_id FROM public.team_members WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user has access to a project
CREATE OR REPLACE FUNCTION public.user_project_ids(uid uuid)
RETURNS SETOF uuid AS $$
  SELECT project_id FROM public.project_members WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users: can read teammates, edit own profile
CREATE POLICY "users_read_teammates" ON public.users FOR SELECT USING (
  id = auth.uid() OR id IN (
    SELECT tm.user_id FROM public.team_members tm
    WHERE tm.team_id IN (SELECT public.user_team_ids(auth.uid()))
  )
);
CREATE POLICY "users_update_self" ON public.users FOR UPDATE USING (id = auth.uid());

-- Teams: members can read, owner can update
CREATE POLICY "teams_read" ON public.teams FOR SELECT USING (
  id IN (SELECT public.user_team_ids(auth.uid())) OR public.is_super_admin(auth.uid())
);
CREATE POLICY "teams_insert" ON public.teams FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "teams_update" ON public.teams FOR UPDATE USING (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- Team members: team members can read, owner/admin can manage
CREATE POLICY "team_members_read" ON public.team_members FOR SELECT USING (
  team_id IN (SELECT public.user_team_ids(auth.uid()))
);
CREATE POLICY "team_members_manage" ON public.team_members FOR ALL USING (
  team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);

-- Synced projects: project members only
CREATE POLICY "projects_read" ON public.synced_projects FOR SELECT USING (
  id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "projects_manage" ON public.synced_projects FOR ALL USING (
  id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Synced tasks/notes: project members only
CREATE POLICY "tasks_access" ON public.synced_tasks FOR ALL USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "task_notes_access" ON public.synced_task_notes FOR ALL USING (
  task_id IN (SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_project_ids(auth.uid())))
);
CREATE POLICY "notes_access" ON public.synced_notes FOR ALL USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Activity events: project members can read
CREATE POLICY "activity_read" ON public.activity_events FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);
CREATE POLICY "activity_insert" ON public.activity_events FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid())) AND user_id = auth.uid()
);

-- Session summaries: project members
CREATE POLICY "session_summaries_access" ON public.session_summaries FOR ALL USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Project docs: project members
CREATE POLICY "project_docs_access" ON public.project_docs FOR ALL USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Review requests: project members
CREATE POLICY "review_requests_access" ON public.review_requests FOR ALL USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
);

-- Notifications: own only
CREATE POLICY "notifications_own" ON public.notifications FOR ALL USING (user_id = auth.uid());

-- Team invites: team admins can manage, anyone can read their own
CREATE POLICY "invites_read_own" ON public.team_invites FOR SELECT USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  OR team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);
CREATE POLICY "invites_manage" ON public.team_invites FOR ALL USING (
  team_id IN (
    SELECT tm.team_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
  )
);

-- Team grants: super admins only
CREATE POLICY "grants_read" ON public.team_grants FOR SELECT USING (
  public.is_super_admin(auth.uid()) OR team_id IN (SELECT public.user_team_ids(auth.uid()))
);
CREATE POLICY "grants_manage" ON public.team_grants FOR ALL USING (public.is_super_admin(auth.uid()));

-- Super admins: super admins can read
CREATE POLICY "super_admins_read" ON public.super_admins FOR SELECT USING (public.is_super_admin(auth.uid()));
```

**Step 6: Run migrations against Supabase**

```bash
npx supabase db push
```

**Step 7: Commit**

```bash
git add supabase/
git commit -m "feat(premium): add Supabase schema with identity, sync, and collaboration tables"
```

---

### Task 2: Premium Config and Feature Flag (Electron)

**Files:**
- Modify: `electron/src/shared/models.ts` (add premium config fields)
- Modify: `electron/src/main/services/ConfigStore.ts` (add defaults)
- Modify: `electron/src/shared/types.ts` (add premium IPC channels)
- Create: `electron/src/shared/premium-models.ts`

**Step 1: Create premium models**

```typescript
// electron/src/shared/premium-models.ts

export interface PremiumUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

export interface Team {
  id: string
  name: string
  slug: string
  ownerId: string
  plan: 'starter' | 'agency'
  seatLimit: number
  projectLimit: number | null
  createdAt: string
}

export interface TeamMember {
  teamId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
  user?: PremiumUser
}

export interface TeamInvite {
  id: string
  teamId: string
  email: string
  role: 'admin' | 'member'
  status: 'pending' | 'accepted' | 'expired'
  createdAt: string
  expiresAt: string
}

export interface TeamGrant {
  id: string
  teamId: string
  grantType: 'oss_project' | 'oss_contributor' | 'custom'
  planTier: 'starter' | 'agency'
  seatLimit: number | null
  projectLimit: number | null
  repoUrl: string | null
  note: string | null
  expiresAt: string | null
  createdAt: string
}

export interface SyncState {
  entityType: 'task' | 'note' | 'project'
  localId: string
  remoteId: string | null
  lastSyncedAt: string | null
  dirty: boolean
}

export interface Notification {
  id: string
  userId: string
  projectId: string | null
  type: 'mention' | 'assignment' | 'review_request' | 'review_resolved'
  title: string
  body: string | null
  entityType: string
  entityId: string
  isRead: boolean
  createdAt: string
}

export interface ActivityEvent {
  id: string
  projectId: string
  userId: string
  eventType: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
  createdAt: string
  user?: PremiumUser
}

export interface SessionSummary {
  id: string
  projectId: string
  userId: string
  sessionSlug: string | null
  model: string | null
  gitBranch: string | null
  summary: string
  filesChanged: string[]
  durationMins: number | null
  startedAt: string | null
  endedAt: string | null
  sharedAt: string
  user?: PremiumUser
}

export interface ProjectDoc {
  id: string
  projectId: string
  title: string
  content: string
  sortOrder: number
  createdBy: string
  lastEditedBy: string | null
  createdAt: string
  updatedAt: string
  createdByUser?: PremiumUser
  lastEditedByUser?: PremiumUser
}

export interface ReviewRequest {
  id: string
  projectId: string
  taskId: string
  requestedBy: string
  assignedTo: string
  status: 'pending' | 'approved' | 'changes_requested' | 'dismissed'
  comment: string | null
  createdAt: string
  resolvedAt: string | null
  requestedByUser?: PremiumUser
  assignedToUser?: PremiumUser
}

export interface PresenceState {
  userId: string
  displayName: string
  activeFile: string | null
  gitBranch: string | null
  onlineAt: string
  status: 'active' | 'idle' | 'offline'
}

export type PremiumStatus = {
  enabled: boolean
  authenticated: boolean
  user: PremiumUser | null
  team: Team | null
  grant: TeamGrant | null
  subscriptionActive: boolean
  syncEnabled: boolean
}
```

**Step 2: Add premium fields to AppConfig**

Add to `AppConfig` in `electron/src/shared/models.ts`:

```typescript
  // Premium (Team Sync)
  premiumEnabled: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  autoShareSessions: boolean
```

**Step 3: Add defaults to ConfigStore**

Add to `APP_CONFIG_DEFAULTS` in `electron/src/main/services/ConfigStore.ts`:

```typescript
  // Premium
  premiumEnabled: false,
  supabaseUrl: '',
  supabaseAnonKey: '',
  autoShareSessions: false,
```

**Step 4: Add premium IPC channels to types.ts**

Add to `electron/src/shared/types.ts`:

```typescript
export type PremiumChannel =
  | 'premium:getStatus'
  | 'premium:signUp'
  | 'premium:signIn'
  | 'premium:signOut'
  | 'premium:createTeam'
  | 'premium:getTeam'
  | 'premium:listMembers'
  | 'premium:inviteMember'
  | 'premium:removeMember'
  | 'premium:updateMemberRole'
  | 'premium:listInvites'
  | 'premium:cancelInvite'
  | 'premium:acceptInvite'
  | 'premium:syncProject'
  | 'premium:unsyncProject'
  | 'premium:listSyncedProjects'
  | 'premium:getNotifications'
  | 'premium:markNotificationRead'
  | 'premium:markAllNotificationsRead'
  | 'premium:getActivityFeed'
  | 'premium:listSessionSummaries'
  | 'premium:shareSessionSummary'
  | 'premium:listProjectDocs'
  | 'premium:getProjectDoc'
  | 'premium:createProjectDoc'
  | 'premium:updateProjectDoc'
  | 'premium:deleteProjectDoc'
  | 'premium:requestReview'
  | 'premium:resolveReview'
  | 'premium:listReviewRequests'
  | 'premium:getPresence'
  | 'premium:getBillingPortalUrl'
  | 'premium:createCheckoutSession'
  // Super admin
  | 'premium:admin:searchUsers'
  | 'premium:admin:grantTeam'
  | 'premium:admin:revokeGrant'
  | 'premium:admin:listGrants'
```

Add `PremiumChannel` to the `IpcChannel` union type.

**Step 5: Commit**

```bash
git add electron/src/shared/ electron/src/main/services/ConfigStore.ts
git commit -m "feat(premium): add premium models, config flags, and IPC channel types"
```

---

### Task 3: Supabase Client Service (Electron)

**Files:**
- Create: `electron/src/main/services/premium/SupabaseClient.ts`
- Create: `electron/src/main/services/premium/AuthService.ts`
- Create: `electron/src/main/services/premium/TeamService.ts`

**Step 1: Install Supabase client**

```bash
cd electron && npm install @supabase/supabase-js
```

**Step 2: Create SupabaseClient singleton**

```typescript
// electron/src/main/services/premium/SupabaseClient.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readConfig, writeConfig } from '../ConfigStore'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let client: SupabaseClient | null = null

const TOKEN_FILE = 'supabase-session.json'

function getTokenPath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILE)
}

function loadPersistedSession(): { access_token: string; refresh_token: string } | null {
  try {
    const data = fs.readFileSync(getTokenPath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

function persistSession(session: { access_token: string; refresh_token: string } | null): void {
  if (session) {
    fs.writeFileSync(getTokenPath(), JSON.stringify(session), 'utf-8')
  } else {
    try { fs.unlinkSync(getTokenPath()) } catch { /* ignore */ }
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client

  const config = readConfig()
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null

  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false, // We handle persistence manually
    },
  })

  // Restore session from disk
  const saved = loadPersistedSession()
  if (saved) {
    client.auth.setSession(saved)
  }

  // Persist session changes
  client.auth.onAuthStateChange((_event, session) => {
    if (session) {
      persistSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    } else {
      persistSession(null)
    }
  })

  return client
}

export function resetSupabaseClient(): void {
  client = null
  persistSession(null)
}
```

**Step 3: Create AuthService**

```typescript
// electron/src/main/services/premium/AuthService.ts

import { getSupabaseClient, resetSupabaseClient } from './SupabaseClient'
import type { PremiumUser, PremiumStatus } from '@shared/premium-models'

export class AuthService {
  async signUp(email: string, password: string, displayName: string): Promise<PremiumUser> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    if (error) throw new Error(error.message)
    if (!data.user) throw new Error('Sign up failed')

    return {
      id: data.user.id,
      email: data.user.email!,
      displayName,
      avatarUrl: null,
    }
  }

  async signIn(email: string, password: string): Promise<PremiumUser> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)

    const { data: profile } = await client.from('users').select('*').eq('id', data.user.id).single()

    return {
      id: data.user.id,
      email: data.user.email!,
      displayName: profile?.display_name || email.split('@')[0],
      avatarUrl: profile?.avatar_url || null,
    }
  }

  async signOut(): Promise<void> {
    const client = getSupabaseClient()
    if (client) {
      await client.auth.signOut()
    }
    resetSupabaseClient()
  }

  async getStatus(): Promise<PremiumStatus> {
    const client = getSupabaseClient()
    if (!client) {
      return { enabled: false, authenticated: false, user: null, team: null, grant: null, subscriptionActive: false, syncEnabled: false }
    }

    const { data: { user } } = await client.auth.getUser()
    if (!user) {
      return { enabled: true, authenticated: false, user: null, team: null, grant: null, subscriptionActive: false, syncEnabled: false }
    }

    // Get user profile
    const { data: profile } = await client.from('users').select('*').eq('id', user.id).single()

    // Get team membership
    const { data: membership } = await client.from('team_members')
      .select('team_id, role, teams(*)')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    const team = membership?.teams as unknown as { id: string; name: string; slug: string; owner_id: string; plan: string; seat_limit: number; project_limit: number | null } | null

    // Check for active grant
    let grant = null
    if (team) {
      const { data: grantData } = await client.from('team_grants')
        .select('*')
        .eq('team_id', team.id)
        .or('expires_at.is.null,expires_at.gt.now()')
        .limit(1)
        .single()
      grant = grantData
    }

    const subscriptionActive = !!grant || !!(team && (team as any).stripe_subscription_id)

    return {
      enabled: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email!,
        displayName: profile?.display_name || user.email!.split('@')[0],
        avatarUrl: profile?.avatar_url || null,
      },
      team: team ? {
        id: team.id,
        name: team.name,
        slug: team.slug,
        ownerId: team.owner_id,
        plan: team.plan as 'starter' | 'agency',
        seatLimit: team.seat_limit,
        projectLimit: team.project_limit,
        createdAt: '',
      } : null,
      grant,
      subscriptionActive,
      syncEnabled: subscriptionActive,
    }
  }
}
```

**Step 4: Create TeamService**

```typescript
// electron/src/main/services/premium/TeamService.ts

import { getSupabaseClient } from './SupabaseClient'
import type { Team, TeamMember, TeamInvite } from '@shared/premium-models'

export class TeamService {
  async createTeam(name: string, slug: string): Promise<Team> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await client.from('teams').insert({
      name,
      slug,
      owner_id: user.id,
    }).select().single()

    if (error) throw new Error(error.message)

    // Add creator as owner member
    await client.from('team_members').insert({
      team_id: data.id,
      user_id: user.id,
      role: 'owner',
    })

    return {
      id: data.id,
      name: data.name,
      slug: data.slug,
      ownerId: data.owner_id,
      plan: data.plan,
      seatLimit: data.seat_limit,
      projectLimit: data.project_limit,
      createdAt: data.created_at,
    }
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data, error } = await client.from('team_members')
      .select('*, users(*)')
      .eq('team_id', teamId)

    if (error) throw new Error(error.message)

    return (data || []).map((m: any) => ({
      teamId: m.team_id,
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      user: m.users ? {
        id: m.users.id,
        email: m.users.email,
        displayName: m.users.display_name,
        avatarUrl: m.users.avatar_url,
      } : undefined,
    }))
  }

  async inviteMember(teamId: string, email: string, role: 'admin' | 'member'): Promise<TeamInvite> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await client.from('team_invites').insert({
      team_id: teamId,
      email,
      role,
      invited_by: user.id,
    }).select().single()

    if (error) throw new Error(error.message)

    return {
      id: data.id,
      teamId: data.team_id,
      email: data.email,
      role: data.role,
      status: data.status,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
    }
  }

  async acceptInvite(token: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: invite, error } = await client.from('team_invites')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (error || !invite) throw new Error('Invalid or expired invite')

    // Add user to team
    await client.from('team_members').insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: invite.role,
    })

    // Mark invite as accepted
    await client.from('team_invites').update({ status: 'accepted' }).eq('id', invite.id)
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { error } = await client.from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId)

    if (error) throw new Error(error.message)
  }

  async syncProject(teamId: string, projectId: string, name: string, repoUrl?: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    const { data: { user } } = await client.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Create synced project
    await client.from('synced_projects').upsert({
      id: projectId,
      team_id: teamId,
      name,
      repo_url: repoUrl || null,
      created_by: user.id,
    })

    // Add creator as project lead
    await client.from('project_members').upsert({
      project_id: projectId,
      user_id: user.id,
      role: 'lead',
    })
  }

  async unsyncProject(projectId: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase not configured')

    await client.from('synced_projects').delete().eq('id', projectId)
  }
}
```

**Step 5: Commit**

```bash
git add electron/src/main/services/premium/
git commit -m "feat(premium): add Supabase client, auth, and team services"
```

---

### Task 4: Sync Engine (Electron)

**Files:**
- Create: `electron/src/main/services/premium/SyncEngine.ts`
- Modify: `electron/src/main/database/migrations/index.ts` (add sync_state table)

**Step 1: Add sync_state migration**

Add as migration 21 in `electron/src/main/database/migrations/index.ts`:

```typescript
  // Migration 21: Sync state tracking for premium sync
  {
    version: 21,
    name: 'v20_createSyncState',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS syncState (
          entityType TEXT NOT NULL,
          localId TEXT NOT NULL,
          remoteId TEXT,
          lastSyncedAt DATETIME,
          dirty INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entityType, localId)
        );

        -- Triggers to mark tasks dirty on local changes
        CREATE TRIGGER IF NOT EXISTS sync_task_dirty_insert
        AFTER INSERT ON taskItems
        WHEN (SELECT COUNT(*) FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)) > 0
        BEGIN
          UPDATE syncState SET dirty = 1 WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT);
        END;

        CREATE TRIGGER IF NOT EXISTS sync_task_dirty_update
        AFTER UPDATE ON taskItems BEGIN
          INSERT OR REPLACE INTO syncState (entityType, localId, remoteId, lastSyncedAt, dirty)
          VALUES ('task', CAST(NEW.id AS TEXT),
            (SELECT remoteId FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
            (SELECT lastSyncedAt FROM syncState WHERE entityType='task' AND localId=CAST(NEW.id AS TEXT)),
            1);
        END;

        -- Triggers to mark notes dirty on local changes
        CREATE TRIGGER IF NOT EXISTS sync_note_dirty_update
        AFTER UPDATE ON notes BEGIN
          INSERT OR REPLACE INTO syncState (entityType, localId, remoteId, lastSyncedAt, dirty)
          VALUES ('note', CAST(NEW.id AS TEXT),
            (SELECT remoteId FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
            (SELECT lastSyncedAt FROM syncState WHERE entityType='note' AND localId=CAST(NEW.id AS TEXT)),
            1);
        END;
      `)
    },
  },
```

**Step 2: Create SyncEngine**

```typescript
// electron/src/main/services/premium/SyncEngine.ts

import type Database from 'better-sqlite3'
import { getSupabaseClient } from './SupabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface DirtyRecord {
  entityType: string
  localId: string
  remoteId: string | null
}

export class SyncEngine {
  private db: Database.Database
  private pushInterval: ReturnType<typeof setInterval> | null = null
  private channels: Map<string, RealtimeChannel> = new Map()
  private running = false

  constructor(db: Database.Database) {
    this.db = db
  }

  start(): void {
    if (this.running) return
    this.running = true

    // Push dirty records every 5 seconds
    this.pushInterval = setInterval(() => this.pushDirty(), 5000)

    console.log('[SyncEngine] Started')
  }

  stop(): void {
    this.running = false
    if (this.pushInterval) {
      clearInterval(this.pushInterval)
      this.pushInterval = null
    }
    // Unsubscribe from all channels
    for (const channel of this.channels.values()) {
      channel.unsubscribe()
    }
    this.channels.clear()
    console.log('[SyncEngine] Stopped')
  }

  /** Subscribe to real-time changes for a synced project */
  subscribeToProject(projectId: string): void {
    const client = getSupabaseClient()
    if (!client) return

    const channelKey = `project:${projectId}`
    if (this.channels.has(channelKey)) return

    const channel = client.channel(channelKey)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'synced_tasks',
        filter: `project_id=eq.${projectId}`,
      }, (payload) => this.handleRemoteChange('task', payload))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'synced_notes',
        filter: `project_id=eq.${projectId}`,
      }, (payload) => this.handleRemoteChange('note', payload))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'synced_task_notes',
      }, (payload) => this.handleRemoteChange('task_note', payload))
      .subscribe()

    this.channels.set(channelKey, channel)
    console.log(`[SyncEngine] Subscribed to project ${projectId}`)
  }

  unsubscribeFromProject(projectId: string): void {
    const channelKey = `project:${projectId}`
    const channel = this.channels.get(channelKey)
    if (channel) {
      channel.unsubscribe()
      this.channels.delete(channelKey)
    }
  }

  /** Register a local entity for sync tracking */
  trackEntity(entityType: string, localId: string, remoteId?: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO syncState (entityType, localId, remoteId, lastSyncedAt, dirty)
      VALUES (?, ?, ?, datetime('now'), 1)
    `).run(entityType, localId, remoteId || null)
  }

  /** Mark a local entity as needing sync */
  markDirty(entityType: string, localId: string): void {
    this.db.prepare(`
      UPDATE syncState SET dirty = 1 WHERE entityType = ? AND localId = ?
    `).run(entityType, localId)
  }

  private async pushDirty(): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return

    const { data: { user } } = await client.auth.getUser()
    if (!user) return

    const dirtyRecords = this.db.prepare(`
      SELECT entityType, localId, remoteId FROM syncState WHERE dirty = 1
    `).all() as DirtyRecord[]

    if (dirtyRecords.length === 0) return

    for (const record of dirtyRecords) {
      try {
        await this.pushRecord(client, user.id, record)
        this.db.prepare(`
          UPDATE syncState SET dirty = 0, lastSyncedAt = datetime('now')
          WHERE entityType = ? AND localId = ?
        `).run(record.entityType, record.localId)
      } catch (err) {
        console.error(`[SyncEngine] Failed to push ${record.entityType}:${record.localId}:`, err)
      }
    }
  }

  private async pushRecord(client: any, userId: string, record: DirtyRecord): Promise<void> {
    if (record.entityType === 'task') {
      const task = this.db.prepare('SELECT * FROM taskItems WHERE id = ?').get(record.localId) as any
      if (!task) return

      // Get the project's remote ID
      const projectSync = this.db.prepare(
        'SELECT remoteId FROM syncState WHERE entityType = ? AND localId = ?'
      ).get('project', task.projectId) as { remoteId: string } | undefined

      if (!projectSync?.remoteId) return

      const payload = {
        id: record.remoteId || undefined,
        local_id: task.id,
        project_id: projectSync.remoteId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        labels: task.labels ? JSON.parse(task.labels) : [],
        created_by: userId,
        source: task.source,
        completed_at: task.completedAt,
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await client.from('synced_tasks').upsert(payload).select().single()
      if (error) throw error

      // Store the remote ID
      if (!record.remoteId) {
        this.db.prepare(
          'UPDATE syncState SET remoteId = ? WHERE entityType = ? AND localId = ?'
        ).run(data.id, record.entityType, record.localId)
      }
    } else if (record.entityType === 'note') {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(record.localId) as any
      if (!note) return

      const projectSync = this.db.prepare(
        'SELECT remoteId FROM syncState WHERE entityType = ? AND localId = ?'
      ).get('project', note.projectId) as { remoteId: string } | undefined

      if (!projectSync?.remoteId) return

      const payload = {
        id: record.remoteId || undefined,
        project_id: projectSync.remoteId,
        title: note.title,
        content: note.content,
        pinned: !!note.pinned,
        created_by: userId,
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await client.from('synced_notes').upsert(payload).select().single()
      if (error) throw error

      if (!record.remoteId) {
        this.db.prepare(
          'UPDATE syncState SET remoteId = ? WHERE entityType = ? AND localId = ?'
        ).run(data.id, record.entityType, record.localId)
      }
    }
  }

  private handleRemoteChange(entityType: string, payload: any): void {
    const { eventType, new: newRecord, old: oldRecord } = payload

    if (entityType === 'task') {
      this.applyRemoteTaskChange(eventType, newRecord, oldRecord)
    } else if (entityType === 'note') {
      this.applyRemoteNoteChange(eventType, newRecord, oldRecord)
    }
  }

  private applyRemoteTaskChange(eventType: string, newRecord: any, _oldRecord: any): void {
    if (!newRecord) return

    // Check if we have a local mapping
    const mapping = this.db.prepare(
      'SELECT localId, dirty FROM syncState WHERE entityType = ? AND remoteId = ?'
    ).get('task', newRecord.id) as { localId: string; dirty: number } | undefined

    // If local is dirty, skip (local wins until next push resolves conflict)
    if (mapping?.dirty) return

    if (eventType === 'INSERT' && !mapping) {
      // New task from teammate — insert locally
      const result = this.db.prepare(`
        INSERT INTO taskItems (projectId, title, description, status, priority, labels, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        this.getLocalProjectId(newRecord.project_id) || newRecord.project_id,
        newRecord.title,
        newRecord.description,
        newRecord.status,
        newRecord.priority,
        JSON.stringify(newRecord.labels || []),
        newRecord.source || 'manual'
      )

      // Track in sync state
      this.db.prepare(`
        INSERT INTO syncState (entityType, localId, remoteId, lastSyncedAt, dirty)
        VALUES ('task', ?, ?, datetime('now'), 0)
      `).run(String(result.lastInsertRowid), newRecord.id)

    } else if ((eventType === 'UPDATE') && mapping) {
      // Update existing local task
      this.db.prepare(`
        UPDATE taskItems SET title = ?, description = ?, status = ?, priority = ?, labels = ?, completedAt = ?
        WHERE id = ?
      `).run(
        newRecord.title,
        newRecord.description,
        newRecord.status,
        newRecord.priority,
        JSON.stringify(newRecord.labels || []),
        newRecord.completed_at,
        mapping.localId
      )

      // Mark as synced (not dirty)
      this.db.prepare(
        'UPDATE syncState SET lastSyncedAt = datetime(\'now\'), dirty = 0 WHERE entityType = ? AND localId = ?'
      ).run('task', mapping.localId)

    } else if (eventType === 'DELETE' && mapping) {
      this.db.prepare('DELETE FROM taskItems WHERE id = ?').run(mapping.localId)
      this.db.prepare('DELETE FROM syncState WHERE entityType = ? AND localId = ?').run('task', mapping.localId)
    }
  }

  private applyRemoteNoteChange(eventType: string, newRecord: any, _oldRecord: any): void {
    if (!newRecord) return

    const mapping = this.db.prepare(
      'SELECT localId, dirty FROM syncState WHERE entityType = ? AND remoteId = ?'
    ).get('note', newRecord.id) as { localId: string; dirty: number } | undefined

    if (mapping?.dirty) return

    if (eventType === 'INSERT' && !mapping) {
      const result = this.db.prepare(`
        INSERT INTO notes (projectId, title, content, pinned, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        this.getLocalProjectId(newRecord.project_id) || newRecord.project_id,
        newRecord.title,
        newRecord.content,
        newRecord.pinned ? 1 : 0
      )

      this.db.prepare(`
        INSERT INTO syncState (entityType, localId, remoteId, lastSyncedAt, dirty)
        VALUES ('note', ?, ?, datetime('now'), 0)
      `).run(String(result.lastInsertRowid), newRecord.id)

    } else if (eventType === 'UPDATE' && mapping) {
      this.db.prepare(`
        UPDATE notes SET title = ?, content = ?, pinned = ?, updatedAt = datetime('now')
        WHERE id = ?
      `).run(newRecord.title, newRecord.content, newRecord.pinned ? 1 : 0, mapping.localId)

      this.db.prepare(
        'UPDATE syncState SET lastSyncedAt = datetime(\'now\'), dirty = 0 WHERE entityType = ? AND localId = ?'
      ).run('note', mapping.localId)

    } else if (eventType === 'DELETE' && mapping) {
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(mapping.localId)
      this.db.prepare('DELETE FROM syncState WHERE entityType = ? AND localId = ?').run('note', mapping.localId)
    }
  }

  private getLocalProjectId(remoteProjectId: string): string | null {
    const row = this.db.prepare(
      'SELECT localId FROM syncState WHERE entityType = ? AND remoteId = ?'
    ).get('project', remoteProjectId) as { localId: string } | undefined
    return row?.localId || null
  }
}
```

**Step 3: Commit**

```bash
git add electron/src/main/services/premium/SyncEngine.ts electron/src/main/database/migrations/index.ts
git commit -m "feat(premium): add sync engine with push/pull and real-time subscriptions"
```

---

### Task 5: Premium IPC Handlers (Electron)

**Files:**
- Create: `electron/src/main/ipc/premium-handlers.ts`
- Modify: `electron/src/main/ipc/index.ts` (register premium handlers)
- Modify: `electron/src/main/index.ts` (initialize premium services)

**Step 1: Create premium IPC handlers**

```typescript
// electron/src/main/ipc/premium-handlers.ts

import { ipcMain } from 'electron'
import type { AuthService } from '../services/premium/AuthService'
import type { TeamService } from '../services/premium/TeamService'
import type { SyncEngine } from '../services/premium/SyncEngine'

export function registerPremiumHandlers(
  authService: AuthService,
  teamService: TeamService,
  syncEngine: SyncEngine
) {
  // Auth
  ipcMain.handle('premium:getStatus', () => authService.getStatus())
  ipcMain.handle('premium:signUp', (_e, email: string, password: string, displayName: string) =>
    authService.signUp(email, password, displayName))
  ipcMain.handle('premium:signIn', (_e, email: string, password: string) =>
    authService.signIn(email, password))
  ipcMain.handle('premium:signOut', () => authService.signOut())

  // Team management
  ipcMain.handle('premium:createTeam', (_e, name: string, slug: string) =>
    teamService.createTeam(name, slug))
  ipcMain.handle('premium:getTeam', () => authService.getStatus().then(s => s.team))
  ipcMain.handle('premium:listMembers', (_e, teamId: string) =>
    teamService.listMembers(teamId))
  ipcMain.handle('premium:inviteMember', (_e, teamId: string, email: string, role: 'admin' | 'member') =>
    teamService.inviteMember(teamId, email, role))
  ipcMain.handle('premium:removeMember', (_e, teamId: string, userId: string) =>
    teamService.removeMember(teamId, userId))
  ipcMain.handle('premium:acceptInvite', (_e, token: string) =>
    teamService.acceptInvite(token))

  // Project sync
  ipcMain.handle('premium:syncProject', (_e, teamId: string, projectId: string, name: string, repoUrl?: string) => {
    syncEngine.trackEntity('project', projectId, projectId)
    return teamService.syncProject(teamId, projectId, name, repoUrl)
  })
  ipcMain.handle('premium:unsyncProject', (_e, projectId: string) => {
    syncEngine.unsubscribeFromProject(projectId)
    return teamService.unsyncProject(projectId)
  })
}
```

**Step 2: Register in ipc/index.ts**

Add import and conditional registration:

```typescript
import { registerPremiumHandlers } from './premium-handlers'
import type { AuthService } from '../services/premium/AuthService'
import type { TeamService } from '../services/premium/TeamService'
import type { SyncEngine } from '../services/premium/SyncEngine'
```

Add to `registerAllHandlers` parameters and body:

```typescript
  authService?: AuthService,
  teamService?: TeamService,
  syncEngine?: SyncEngine
```

```typescript
  if (authService && teamService && syncEngine) {
    registerPremiumHandlers(authService, teamService, syncEngine)
  }
```

**Step 3: Initialize premium services in index.ts**

Add to `initDeferredServices()` in `electron/src/main/index.ts`:

```typescript
  // Premium services (only if configured)
  if (config.premiumEnabled && config.supabaseUrl && config.supabaseAnonKey) {
    try {
      const { AuthService } = require('./services/premium/AuthService')
      const { TeamService } = require('./services/premium/TeamService')
      const { SyncEngine } = require('./services/premium/SyncEngine')
      const authSvc = new AuthService()
      const teamSvc = new TeamService()
      const syncEng = new SyncEngine(db)
      registerPremiumHandlers(authSvc, teamSvc, syncEng)
      syncEng.start()
    } catch (err) {
      console.warn('[Main] Premium services unavailable:', err)
    }
  }
```

**Step 4: Commit**

```bash
git add electron/src/main/ipc/premium-handlers.ts electron/src/main/ipc/index.ts electron/src/main/index.ts
git commit -m "feat(premium): add premium IPC handlers and service initialization"
```

---

### Task 6: Settings UI — Team Tab (Electron)

**Files:**
- Create: `electron/src/renderer/components/Settings/SettingsTabTeam.tsx`
- Modify: `electron/src/renderer/components/Settings/SettingsModal.tsx` (add Team tab)
- Create: `electron/src/renderer/hooks/usePremium.ts`

**Step 1: Create usePremium hook**

```typescript
// electron/src/renderer/hooks/usePremium.ts

import { useState, useEffect, useCallback } from 'react'
import type { PremiumStatus, TeamMember, TeamInvite } from '@shared/premium-models'

export function usePremium() {
  const [status, setStatus] = useState<PremiumStatus | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.invoke('premium:getStatus') as PremiumStatus
      setStatus(s)
      if (s.team) {
        const m = await window.api.invoke('premium:listMembers', s.team.id) as TeamMember[]
        setMembers(m)
      }
    } catch {
      setStatus({ enabled: false, authenticated: false, user: null, team: null, grant: null, subscriptionActive: false, syncEnabled: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const signUp = async (email: string, password: string, displayName: string) => {
    await window.api.invoke('premium:signUp', email, password, displayName)
    await refresh()
  }

  const signIn = async (email: string, password: string) => {
    await window.api.invoke('premium:signIn', email, password)
    await refresh()
  }

  const signOut = async () => {
    await window.api.invoke('premium:signOut')
    await refresh()
  }

  const createTeam = async (name: string, slug: string) => {
    await window.api.invoke('premium:createTeam', name, slug)
    await refresh()
  }

  const inviteMember = async (email: string, role: 'admin' | 'member') => {
    if (!status?.team) return
    await window.api.invoke('premium:inviteMember', status.team.id, email, role)
    await refresh()
  }

  const removeMember = async (userId: string) => {
    if (!status?.team) return
    await window.api.invoke('premium:removeMember', status.team.id, userId)
    await refresh()
  }

  return {
    status, members, invites, loading,
    signUp, signIn, signOut, createTeam, inviteMember, removeMember, refresh,
  }
}
```

**Step 2: Create SettingsTabTeam component**

This is a substantial UI component. Create `electron/src/renderer/components/Settings/SettingsTabTeam.tsx` with:

- **Not configured state:** Description + "Set Up Team" button
- **Auth form:** Sign up / sign in toggle with email, password, display name fields
- **Team creation:** Team name + slug input
- **Team dashboard:** Member list, invite form, plan display, synced projects toggles

The exact implementation will be determined during the build phase — this task outlines the component structure and states.

**Step 3: Add Team tab to SettingsModal**

In `electron/src/renderer/components/Settings/SettingsModal.tsx`, add 'Team' to the tab list and render `<SettingsTabTeam />` when selected.

**Step 4: Commit**

```bash
git add electron/src/renderer/components/Settings/SettingsTabTeam.tsx electron/src/renderer/hooks/usePremium.ts electron/src/renderer/components/Settings/SettingsModal.tsx
git commit -m "feat(premium): add Team settings tab with auth, team management, and project sync UI"
```

---

## Phase 2: Billing (Stripe)

### Task 7: Stripe Edge Functions
- Create: `supabase/functions/stripe-webhook/index.ts` — Handle checkout.session.completed, invoice.paid/failed, subscription.updated/deleted
- Create: `supabase/functions/create-checkout/index.ts` — Generate Stripe checkout URL for plan selection
- Create: `supabase/functions/billing-portal/index.ts` — Generate Stripe billing portal URL

### Task 8: Billing UI
- Add "Manage Billing" button to SettingsTabTeam
- Add plan selection during team creation (Starter vs Agency)
- Add seat management UI (add/remove seats)
- Add subscription status display (active, past_due, canceled)
- Add "Upgrade to Agency" prompt when hitting Starter limits

### Task 9: OSS Grant Admin
- Create super admin panel (visible only to super admins)
- Search users by email
- Grant/revoke team access with grant type, plan tier, and notes
- List all active grants

---

## Phase 3: Collaboration (Activity, Mentions, Presence)

### Task 10: Activity Feed
- Create: `electron/src/renderer/views/ActivityView.tsx`
- Create: `electron/src/renderer/hooks/useActivityFeed.ts`
- Add Supabase trigger to auto-generate activity_events on synced table changes
- Add Activity tab to project layout (synced projects only)

### Task 11: @Mentions and Notifications
- Create: `electron/src/renderer/components/NotificationBell.tsx`
- Create: `electron/src/renderer/hooks/useNotifications.ts`
- Create: `supabase/functions/handle-mention/index.ts` — Edge function triggered on task_note insert with mentions
- Add mention autocomplete to task note input (search team members by name)
- Add notification badge to app header

### Task 12: Presence
- Create: `electron/src/renderer/hooks/usePresence.ts`
- Add presence avatars to project header
- Broadcast current user state (active file, branch) on project open
- Show online/idle/offline status per teammate

---

## Phase 4: Shared Sessions, Docs, Reviews

### Task 13: Shared Session Summaries
- Add "Share with team?" prompt on session end
- Create: `electron/src/renderer/components/Sessions/SharedSummaryCard.tsx`
- Add shared summaries to activity feed
- Add per-project "auto share sessions" setting

### Task 14: Project Docs (Wiki)
- Create: `electron/src/renderer/views/DocsView.tsx`
- Create: `electron/src/renderer/components/Docs/DocEditor.tsx`
- Create: `electron/src/renderer/components/Docs/DocSidebar.tsx`
- Add Docs tab to project layout (synced projects only)
- Implement lock-based editing (show "X is editing" indicator)

### Task 15: Review Requests
- Add "Request Review" button to task detail when status is "done"
- Create: `electron/src/renderer/components/Kanban/ReviewRequestBadge.tsx`
- Add review actions (approve, request changes, dismiss)
- Generate activity events and notifications on review actions

### Task 16: Swift Parity
- Port all premium features to Swift/SwiftUI
- Services: `swift/Sources/CodeFire/Services/Premium/` (AuthService, TeamService, SyncEngine)
- Views: SettingsTabTeam, ActivityView, DocsView, NotificationBell, PresenceIndicator
- Use Supabase Swift SDK (`supabase-swift`)
- Share the same Supabase project and database

---

## Testing Strategy

Each task should include tests:

- **Supabase:** RLS policy tests via `supabase test db`
- **Sync engine:** Unit tests with mocked Supabase client (verify push/pull/conflict logic)
- **Services:** Unit tests for AuthService, TeamService (mocked Supabase responses)
- **IPC handlers:** Integration tests verifying channel registration and data flow
- **UI components:** React Testing Library tests for SettingsTabTeam states
- **Edge functions:** Deno tests for Stripe webhook handling

Test files follow existing pattern: `electron/src/__tests__/premium/`

---

## Commit Strategy

Each task ends with a commit. Suggested branch: `feature/premium-teams`

Phase 1 commits:
1. `feat(premium): add Supabase schema with identity, sync, and collaboration tables`
2. `feat(premium): add premium models, config flags, and IPC channel types`
3. `feat(premium): add Supabase client, auth, and team services`
4. `feat(premium): add sync engine with push/pull and real-time subscriptions`
5. `feat(premium): add premium IPC handlers and service initialization`
6. `feat(premium): add Team settings tab with auth, team management, and project sync UI`
