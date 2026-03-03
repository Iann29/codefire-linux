import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PullRequest {
  number: number
  title: string
  state: string
  author: string
  createdAt: string
  updatedAt: string
  url: string
  additions: number
  deletions: number
  reviewDecision: string | null
  isDraft: boolean
  headRefName: string
  baseRefName: string
}

export interface WorkflowRun {
  id: string
  name: string
  status: string
  conclusion: string | null
  branch: string
  createdAt: string
  url: string
}

export interface Issue {
  number: number
  title: string
  state: string
  author: string
  createdAt: string
  updatedAt: string
  url: string
  labels: string[]
}

export interface Commit {
  sha: string
  message: string
  author: string
  date: string
  url: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'
const GITHUB_REST_URL = 'https://api.github.com'
const API_TIMEOUT_MS = 15_000
const GIT_TIMEOUT_MS = 10_000

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Queries the GitHub GraphQL and REST APIs for pull requests, issues,
 * commits, and workflow runs related to a project's repository.
 *
 * Uses Node.js built-in `fetch` for HTTP requests and `child_process.execFile`
 * for git remote detection.
 */
export class GitHubService {
  private token: string | null = null

  // ─── Token management ──────────────────────────────────────────────────

  setToken(token: string): void {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('GitHub token must be a non-empty string')
    }
    this.token = token.trim()
  }

  hasToken(): boolean {
    return this.token !== null
  }

  // ─── Repository detection ──────────────────────────────────────────────

  /**
   * Detect the GitHub owner and repo from the git remote of a local project.
   *
   * Parses both HTTPS and SSH remote URL formats:
   *   - https://github.com/owner/repo.git
   *   - git@github.com:owner/repo.git
   *
   * Returns null if the remote cannot be parsed or the directory is not a
   * git repository.
   */
  async getRepoInfo(
    projectPath: string
  ): Promise<{ owner: string; repo: string } | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', projectPath, 'remote', 'get-url', 'origin'],
        { timeout: GIT_TIMEOUT_MS }
      )
      return this.parseRemoteUrl(stdout.trim())
    } catch {
      return null
    }
  }

  /**
   * Parse a GitHub remote URL into owner/repo.
   */
  private parseRemoteUrl(
    url: string
  ): { owner: string; repo: string } | null {
    // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
    const httpsMatch = url.match(
      /https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/
    )
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] }
    }

    // SSH: git@github.com:owner/repo.git or git@github.com:owner/repo
    const sshMatch = url.match(
      /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/
    )
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] }
    }

    return null
  }

  // ─── Pull Requests ─────────────────────────────────────────────────────

  /**
   * List pull requests for a repository using the GitHub GraphQL API.
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: 'OPEN' | 'CLOSED' | 'MERGED'
      limit?: number
    }
  ): Promise<PullRequest[]> {
    const limit = options?.limit ?? 20
    const states = options?.state ? [options.state] : undefined

    const query = `
      query($owner: String!, $repo: String!, $first: Int!, $states: [PullRequestState!]) {
        repository(owner: $owner, name: $repo) {
          pullRequests(first: $first, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              title
              state
              author { login }
              createdAt
              updatedAt
              url
              additions
              deletions
              reviewDecision
              isDraft
              headRefName
              baseRefName
            }
          }
        }
      }
    `

    const data = await this.graphql(query, {
      owner,
      repo,
      first: limit,
      states,
    })

    const nodes = data.repository?.pullRequests?.nodes ?? []
    return nodes.map(
      (pr: {
        number: number
        title: string
        state: string
        author: { login: string } | null
        createdAt: string
        updatedAt: string
        url: string
        additions: number
        deletions: number
        reviewDecision: string | null
        isDraft: boolean
        headRefName: string
        baseRefName: string
      }): PullRequest => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.author?.login ?? 'unknown',
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        url: pr.url,
        additions: pr.additions,
        deletions: pr.deletions,
        reviewDecision: pr.reviewDecision,
        isDraft: pr.isDraft,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
      })
    )
  }

  /**
   * Get a single pull request by number.
   */
  async getPullRequest(
    owner: string,
    repo: string,
    number: number
  ): Promise<PullRequest | null> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            number
            title
            state
            author { login }
            createdAt
            updatedAt
            url
            additions
            deletions
            reviewDecision
            isDraft
            headRefName
            baseRefName
          }
        }
      }
    `

    const data = await this.graphql(query, { owner, repo, number })

    const pr = data.repository?.pullRequest
    if (!pr) return null

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.author?.login ?? 'unknown',
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      url: pr.url,
      additions: pr.additions,
      deletions: pr.deletions,
      reviewDecision: pr.reviewDecision,
      isDraft: pr.isDraft,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
    }
  }

  // ─── Workflow Runs ─────────────────────────────────────────────────────

  /**
   * List recent workflow runs using the GitHub REST API (Actions).
   */
  async listWorkflowRuns(
    owner: string,
    repo: string,
    options?: { limit?: number }
  ): Promise<WorkflowRun[]> {
    const limit = options?.limit ?? 10

    const data = await this.rest(
      `/repos/${owner}/${repo}/actions/runs?per_page=${limit}`
    )

    const runs = data.workflow_runs ?? []
    return runs.map(
      (run: {
        id: number
        name: string
        status: string
        conclusion: string | null
        head_branch: string
        created_at: string
        html_url: string
      }): WorkflowRun => ({
        id: String(run.id),
        name: run.name,
        status: run.status.toUpperCase(),
        conclusion: run.conclusion ? run.conclusion.toUpperCase() : null,
        branch: run.head_branch,
        createdAt: run.created_at,
        url: run.html_url,
      })
    )
  }

  // ─── Issues ────────────────────────────────────────────────────────────

  /**
   * List issues for a repository using the GitHub GraphQL API.
   */
  async listIssues(
    owner: string,
    repo: string,
    options?: {
      state?: 'OPEN' | 'CLOSED'
      limit?: number
      labels?: string[]
    }
  ): Promise<Issue[]> {
    const limit = options?.limit ?? 20
    const states = options?.state ? [options.state] : undefined
    const labels = options?.labels?.length ? options.labels : undefined

    const query = `
      query($owner: String!, $repo: String!, $first: Int!, $states: [IssueState!], $labels: [String!]) {
        repository(owner: $owner, name: $repo) {
          issues(first: $first, states: $states, labels: $labels, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              title
              state
              author { login }
              createdAt
              updatedAt
              url
              labels(first: 20) {
                nodes { name }
              }
            }
          }
        }
      }
    `

    const data = await this.graphql(query, {
      owner,
      repo,
      first: limit,
      states,
      labels,
    })

    const nodes = data.repository?.issues?.nodes ?? []
    return nodes.map(
      (issue: {
        number: number
        title: string
        state: string
        author: { login: string } | null
        createdAt: string
        updatedAt: string
        url: string
        labels: { nodes: { name: string }[] }
      }): Issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.author?.login ?? 'unknown',
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        url: issue.url,
        labels: issue.labels.nodes.map((l) => l.name),
      })
    )
  }

  // ─── Commits ───────────────────────────────────────────────────────────

  /**
   * List recent commits for a repository using the GitHub GraphQL API.
   */
  async listCommits(
    owner: string,
    repo: string,
    options?: {
      branch?: string
      limit?: number
    }
  ): Promise<Commit[]> {
    const limit = options?.limit ?? 20
    const branch = options?.branch ?? 'HEAD'

    const query = `
      query($owner: String!, $repo: String!, $branch: String!, $first: Int!) {
        repository(owner: $owner, name: $repo) {
          ref(qualifiedName: $branch) {
            target {
              ... on Commit {
                history(first: $first) {
                  nodes {
                    oid
                    messageHeadline
                    author {
                      name
                      date
                    }
                    url
                  }
                }
              }
            }
          }
        }
      }
    `

    const data = await this.graphql(query, { owner, repo, branch, first: limit })

    const nodes = data.repository?.ref?.target?.history?.nodes ?? []
    return nodes.map(
      (commit: {
        oid: string
        messageHeadline: string
        author: { name: string; date: string }
        url: string
      }): Commit => ({
        sha: commit.oid,
        message: commit.messageHeadline,
        author: commit.author.name,
        date: commit.author.date,
        url: commit.url,
      })
    )
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────

  /**
   * Ensure we have a token before making API calls.
   */
  private requireToken(): string {
    if (!this.token) {
      throw new Error(
        'GitHub token not configured. Call setToken() before making API requests.'
      )
    }
    return this.token
  }

  /**
   * Execute a GraphQL query against the GitHub API.
   *
   * Returns the `data` field of the response body. The caller is
   * responsible for navigating the response shape, which varies per query.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async graphql(
    query: string,
    variables: Record<string, unknown>
  ): Promise<any> {
    const token = this.requireToken()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

    try {
      const response = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'CodeFire-Electron',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })

      if (!response.ok) {
        await this.handleHttpError(response)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await response.json()) as {
        data?: any
        errors?: { message: string }[]
      }

      if (json.errors?.length) {
        throw new Error(
          `GitHub GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`
        )
      }

      return json.data ?? {}
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `GitHub API request timed out after ${API_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Execute a REST request against the GitHub API.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async rest(path: string): Promise<any> {
    const token = this.requireToken()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

    try {
      const response = await fetch(`${GITHUB_REST_URL}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'CodeFire-Electron',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        await this.handleHttpError(response)
      }

      return await response.json()
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `GitHub API request timed out after ${API_TIMEOUT_MS}ms`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Parse and throw a descriptive error from a non-OK HTTP response.
   */
  private async handleHttpError(response: Response): Promise<never> {
    let message = ''
    try {
      const body = (await response.json()) as { message?: string }
      message = body.message ?? ''
    } catch {
      // Response body could not be parsed as JSON
    }

    const status = response.status
    const detail = message ? `: ${message}` : ''

    switch (status) {
      case 401:
        throw new Error(
          `GitHub authentication failed (401)${detail}. Check your token.`
        )
      case 403:
        throw new Error(
          `GitHub access forbidden (403)${detail}. You may be rate limited or lack permissions.`
        )
      case 404:
        throw new Error(
          `GitHub resource not found (404)${detail}. Check the owner/repo name.`
        )
      default:
        throw new Error(`GitHub API error (${status})${detail}`)
    }
  }
}
