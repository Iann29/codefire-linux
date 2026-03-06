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

    await client.from('team_members').insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: invite.role,
    })

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

    await client.from('synced_projects').upsert({
      id: projectId,
      team_id: teamId,
      name,
      repo_url: repoUrl || null,
      created_by: user.id,
    })

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
