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
