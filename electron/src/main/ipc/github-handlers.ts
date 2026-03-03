import { ipcMain } from 'electron'
import { GitHubService } from '../services/GitHubService'

/**
 * Register IPC handlers for GitHub API operations.
 *
 * All handlers delegate to the GitHubService, which queries the GitHub
 * GraphQL and REST APIs for pull requests, issues, commits, and workflow runs.
 */
export function registerGitHubHandlers(githubService: GitHubService) {
  ipcMain.handle('github:setToken', (_event, token: string) => {
    if (!token || typeof token !== 'string') {
      throw new Error('token is required and must be a string')
    }
    githubService.setToken(token)
  })

  ipcMain.handle('github:getRepoInfo', (_event, projectPath: string) => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required and must be a string')
    }
    return githubService.getRepoInfo(projectPath)
  })

  ipcMain.handle(
    'github:listPRs',
    (
      _event,
      owner: string,
      repo: string,
      options?: { state?: 'OPEN' | 'CLOSED' | 'MERGED'; limit?: number }
    ) => {
      if (!owner || typeof owner !== 'string') {
        throw new Error('owner is required and must be a string')
      }
      if (!repo || typeof repo !== 'string') {
        throw new Error('repo is required and must be a string')
      }
      return githubService.listPullRequests(owner, repo, options)
    }
  )

  ipcMain.handle(
    'github:getPR',
    (_event, owner: string, repo: string, number: number) => {
      if (!owner || typeof owner !== 'string') {
        throw new Error('owner is required and must be a string')
      }
      if (!repo || typeof repo !== 'string') {
        throw new Error('repo is required and must be a string')
      }
      if (typeof number !== 'number' || number <= 0) {
        throw new Error('number is required and must be a positive integer')
      }
      return githubService.getPullRequest(owner, repo, number)
    }
  )

  ipcMain.handle(
    'github:listWorkflows',
    (
      _event,
      owner: string,
      repo: string,
      options?: { limit?: number }
    ) => {
      if (!owner || typeof owner !== 'string') {
        throw new Error('owner is required and must be a string')
      }
      if (!repo || typeof repo !== 'string') {
        throw new Error('repo is required and must be a string')
      }
      return githubService.listWorkflowRuns(owner, repo, options)
    }
  )

  ipcMain.handle(
    'github:listIssues',
    (
      _event,
      owner: string,
      repo: string,
      options?: {
        state?: 'OPEN' | 'CLOSED'
        limit?: number
        labels?: string[]
      }
    ) => {
      if (!owner || typeof owner !== 'string') {
        throw new Error('owner is required and must be a string')
      }
      if (!repo || typeof repo !== 'string') {
        throw new Error('repo is required and must be a string')
      }
      return githubService.listIssues(owner, repo, options)
    }
  )

  ipcMain.handle(
    'github:listCommits',
    (
      _event,
      owner: string,
      repo: string,
      options?: { branch?: string; limit?: number }
    ) => {
      if (!owner || typeof owner !== 'string') {
        throw new Error('owner is required and must be a string')
      }
      if (!repo || typeof repo !== 'string') {
        throw new Error('repo is required and must be a string')
      }
      return githubService.listCommits(owner, repo, options)
    }
  )
}
