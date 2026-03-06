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
