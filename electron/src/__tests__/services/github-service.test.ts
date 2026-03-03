import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ─── Mock child_process.execFile ─────────────────────────────────────────────

const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: { ...actual, execFile: mockExecFile },
    execFile: mockExecFile,
  }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    default: { ...actual, execFile: mockExecFile },
    execFile: mockExecFile,
  }
})

// ─── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

import { GitHubService } from '../../main/services/GitHubService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Make mockExecFile resolve with stdout/stderr.
 */
function mockGitOutput(stdout: string, stderr = '') {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      callback: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout, stderr })
    }
  )
}

/**
 * Make mockExecFile reject with an error.
 */
function mockGitError(message: string) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      callback: (err: unknown) => void
    ) => {
      callback(new Error(message))
    }
  )
}

/**
 * Mock a successful fetch response with JSON data.
 */
function mockFetchOk(data: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })
}

/**
 * Mock a failing fetch response with an HTTP status error.
 */
function mockFetchError(status: number, message = '') {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GitHubService', () => {
  let github: GitHubService

  beforeEach(() => {
    github = new GitHubService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Token management ──────────────────────────────────────────────────

  describe('token management', () => {
    it('has no token by default', () => {
      expect(github.hasToken()).toBe(false)
    })

    it('sets and reports token', () => {
      github.setToken('ghp_test123')
      expect(github.hasToken()).toBe(true)
    })

    it('throws on empty token', () => {
      expect(() => github.setToken('')).toThrow('non-empty string')
    })
  })

  // ─── Repository detection ──────────────────────────────────────────────

  describe('getRepoInfo', () => {
    it('parses HTTPS remote URL correctly', async () => {
      mockGitOutput('https://github.com/octocat/Hello-World.git\n')

      const result = await github.getRepoInfo('/tmp/project')

      expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' })
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['-C', '/tmp/project', 'remote', 'get-url', 'origin'],
        expect.objectContaining({ timeout: 10_000 }),
        expect.any(Function)
      )
    })

    it('parses HTTPS remote URL without .git suffix', async () => {
      mockGitOutput('https://github.com/owner/repo\n')

      const result = await github.getRepoInfo('/tmp/project')

      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('parses SSH remote URL correctly', async () => {
      mockGitOutput('git@github.com:octocat/Hello-World.git\n')

      const result = await github.getRepoInfo('/tmp/project')

      expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' })
    })

    it('parses SSH remote URL without .git suffix', async () => {
      mockGitOutput('git@github.com:owner/repo\n')

      const result = await github.getRepoInfo('/tmp/project')

      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('returns null for non-GitHub remotes', async () => {
      mockGitOutput('https://gitlab.com/owner/repo.git\n')

      const result = await github.getRepoInfo('/tmp/project')

      expect(result).toBeNull()
    })

    it('returns null when git command fails (missing remote)', async () => {
      mockGitError('fatal: No such remote \'origin\'')

      const result = await github.getRepoInfo('/tmp/project')

      expect(result).toBeNull()
    })

    it('returns null when not a git repo', async () => {
      mockGitError('fatal: not a git repository')

      const result = await github.getRepoInfo('/tmp/not-a-repo')

      expect(result).toBeNull()
    })
  })

  // ─── Pull Requests ─────────────────────────────────────────────────────

  describe('listPullRequests', () => {
    beforeEach(() => {
      github.setToken('ghp_test123')
    })

    it('sends correct GraphQL query and maps response', async () => {
      mockFetchOk({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                {
                  number: 42,
                  title: 'Add feature X',
                  state: 'OPEN',
                  author: { login: 'octocat' },
                  createdAt: '2024-01-01T00:00:00Z',
                  updatedAt: '2024-01-02T00:00:00Z',
                  url: 'https://github.com/owner/repo/pull/42',
                  additions: 100,
                  deletions: 20,
                  reviewDecision: 'APPROVED',
                  isDraft: false,
                  headRefName: 'feature-x',
                  baseRefName: 'main',
                },
              ],
            },
          },
        },
      })

      const result = await github.listPullRequests('owner', 'repo')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        number: 42,
        title: 'Add feature X',
        state: 'OPEN',
        author: 'octocat',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        url: 'https://github.com/owner/repo/pull/42',
        additions: 100,
        deletions: 20,
        reviewDecision: 'APPROVED',
        isDraft: false,
        headRefName: 'feature-x',
        baseRefName: 'main',
      })

      // Verify the GraphQL request
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer ghp_test123',
          }),
        })
      )

      // Verify the query body includes correct variables
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.owner).toBe('owner')
      expect(callBody.variables.repo).toBe('repo')
      expect(callBody.variables.first).toBe(20) // default limit
    })

    it('passes state filter when specified', async () => {
      mockFetchOk({
        data: { repository: { pullRequests: { nodes: [] } } },
      })

      await github.listPullRequests('owner', 'repo', { state: 'CLOSED' })

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.states).toEqual(['CLOSED'])
    })

    it('uses custom limit when specified', async () => {
      mockFetchOk({
        data: { repository: { pullRequests: { nodes: [] } } },
      })

      await github.listPullRequests('owner', 'repo', { limit: 5 })

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.first).toBe(5)
    })

    it('handles null author gracefully', async () => {
      mockFetchOk({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                {
                  number: 1,
                  title: 'Ghost PR',
                  state: 'OPEN',
                  author: null,
                  createdAt: '2024-01-01T00:00:00Z',
                  updatedAt: '2024-01-01T00:00:00Z',
                  url: 'https://github.com/owner/repo/pull/1',
                  additions: 0,
                  deletions: 0,
                  reviewDecision: null,
                  isDraft: false,
                  headRefName: 'ghost-branch',
                  baseRefName: 'main',
                },
              ],
            },
          },
        },
      })

      const result = await github.listPullRequests('owner', 'repo')
      expect(result[0].author).toBe('unknown')
    })
  })

  // ─── Single Pull Request ───────────────────────────────────────────────

  describe('getPullRequest', () => {
    beforeEach(() => {
      github.setToken('ghp_test123')
    })

    it('fetches single PR by number', async () => {
      mockFetchOk({
        data: {
          repository: {
            pullRequest: {
              number: 42,
              title: 'Feature PR',
              state: 'OPEN',
              author: { login: 'dev' },
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-02T00:00:00Z',
              url: 'https://github.com/owner/repo/pull/42',
              additions: 50,
              deletions: 10,
              reviewDecision: 'CHANGES_REQUESTED',
              isDraft: true,
              headRefName: 'feature',
              baseRefName: 'main',
            },
          },
        },
      })

      const result = await github.getPullRequest('owner', 'repo', 42)

      expect(result).not.toBeNull()
      expect(result!.number).toBe(42)
      expect(result!.isDraft).toBe(true)
      expect(result!.reviewDecision).toBe('CHANGES_REQUESTED')

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.number).toBe(42)
    })

    it('returns null when PR not found', async () => {
      mockFetchOk({
        data: {
          repository: {
            pullRequest: null,
          },
        },
      })

      const result = await github.getPullRequest('owner', 'repo', 9999)

      expect(result).toBeNull()
    })
  })

  // ─── Workflow Runs ─────────────────────────────────────────────────────

  describe('listWorkflowRuns', () => {
    beforeEach(() => {
      github.setToken('ghp_test123')
    })

    it('fetches workflow runs from REST API', async () => {
      mockFetchOk({
        workflow_runs: [
          {
            id: 12345,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            head_branch: 'main',
            created_at: '2024-01-01T00:00:00Z',
            html_url: 'https://github.com/owner/repo/actions/runs/12345',
          },
          {
            id: 12346,
            name: 'Deploy',
            status: 'in_progress',
            conclusion: null,
            head_branch: 'feature',
            created_at: '2024-01-02T00:00:00Z',
            html_url: 'https://github.com/owner/repo/actions/runs/12346',
          },
        ],
      })

      const result = await github.listWorkflowRuns('owner', 'repo')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        id: '12345',
        name: 'CI',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        branch: 'main',
        createdAt: '2024-01-01T00:00:00Z',
        url: 'https://github.com/owner/repo/actions/runs/12345',
      })
      expect(result[1].conclusion).toBeNull()
      expect(result[1].status).toBe('IN_PROGRESS')

      // Verify REST API URL
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/actions/runs?per_page=10',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/vnd.github+json',
          }),
        })
      )
    })

    it('uses custom limit', async () => {
      mockFetchOk({ workflow_runs: [] })

      await github.listWorkflowRuns('owner', 'repo', { limit: 5 })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/actions/runs?per_page=5',
        expect.any(Object)
      )
    })
  })

  // ─── Issues ────────────────────────────────────────────────────────────

  describe('listIssues', () => {
    beforeEach(() => {
      github.setToken('ghp_test123')
    })

    it('fetches issues with GraphQL', async () => {
      mockFetchOk({
        data: {
          repository: {
            issues: {
              nodes: [
                {
                  number: 10,
                  title: 'Bug report',
                  state: 'OPEN',
                  author: { login: 'reporter' },
                  createdAt: '2024-01-01T00:00:00Z',
                  updatedAt: '2024-01-03T00:00:00Z',
                  url: 'https://github.com/owner/repo/issues/10',
                  labels: {
                    nodes: [{ name: 'bug' }, { name: 'critical' }],
                  },
                },
              ],
            },
          },
        },
      })

      const result = await github.listIssues('owner', 'repo')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        number: 10,
        title: 'Bug report',
        state: 'OPEN',
        author: 'reporter',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
        url: 'https://github.com/owner/repo/issues/10',
        labels: ['bug', 'critical'],
      })
    })

    it('passes label filters', async () => {
      mockFetchOk({
        data: { repository: { issues: { nodes: [] } } },
      })

      await github.listIssues('owner', 'repo', {
        labels: ['bug', 'p1'],
        state: 'OPEN',
      })

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.labels).toEqual(['bug', 'p1'])
      expect(callBody.variables.states).toEqual(['OPEN'])
    })

    it('omits labels variable when none specified', async () => {
      mockFetchOk({
        data: { repository: { issues: { nodes: [] } } },
      })

      await github.listIssues('owner', 'repo')

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.labels).toBeUndefined()
    })
  })

  // ─── Commits ───────────────────────────────────────────────────────────

  describe('listCommits', () => {
    beforeEach(() => {
      github.setToken('ghp_test123')
    })

    it('fetches commits with GraphQL', async () => {
      mockFetchOk({
        data: {
          repository: {
            ref: {
              target: {
                history: {
                  nodes: [
                    {
                      oid: 'abc123def456',
                      messageHeadline: 'feat: add feature',
                      author: {
                        name: 'John Doe',
                        date: '2024-01-01T00:00:00Z',
                      },
                      url: 'https://github.com/owner/repo/commit/abc123def456',
                    },
                  ],
                },
              },
            },
          },
        },
      })

      const result = await github.listCommits('owner', 'repo')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        sha: 'abc123def456',
        message: 'feat: add feature',
        author: 'John Doe',
        date: '2024-01-01T00:00:00Z',
        url: 'https://github.com/owner/repo/commit/abc123def456',
      })
    })

    it('uses specific branch when provided', async () => {
      mockFetchOk({
        data: {
          repository: { ref: { target: { history: { nodes: [] } } } },
        },
      })

      await github.listCommits('owner', 'repo', { branch: 'develop' })

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.branch).toBe('develop')
    })

    it('defaults to HEAD branch', async () => {
      mockFetchOk({
        data: {
          repository: { ref: { target: { history: { nodes: [] } } } },
        },
      })

      await github.listCommits('owner', 'repo')

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.variables.branch).toBe('HEAD')
    })

    it('returns empty array when ref not found', async () => {
      mockFetchOk({
        data: {
          repository: { ref: null },
        },
      })

      const result = await github.listCommits('owner', 'repo', {
        branch: 'nonexistent',
      })

      expect(result).toEqual([])
    })
  })

  // ─── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws when no token set', async () => {
      await expect(
        github.listPullRequests('owner', 'repo')
      ).rejects.toThrow('GitHub token not configured')
    })

    it('throws descriptive error on 401', async () => {
      github.setToken('ghp_bad_token')
      mockFetchError(401, 'Bad credentials')

      await expect(
        github.listPullRequests('owner', 'repo')
      ).rejects.toThrow('GitHub authentication failed (401): Bad credentials')
    })

    it('throws descriptive error on 403 (rate limit)', async () => {
      github.setToken('ghp_test123')
      mockFetchError(403, 'API rate limit exceeded')

      await expect(
        github.listPullRequests('owner', 'repo')
      ).rejects.toThrow('GitHub access forbidden (403): API rate limit exceeded')
    })

    it('throws descriptive error on 404', async () => {
      github.setToken('ghp_test123')
      mockFetchError(404, 'Not Found')

      await expect(
        github.listWorkflowRuns('owner', 'nonexistent')
      ).rejects.toThrow('GitHub resource not found (404): Not Found')
    })

    it('throws generic error for other HTTP statuses', async () => {
      github.setToken('ghp_test123')
      mockFetchError(500, 'Internal Server Error')

      await expect(
        github.listIssues('owner', 'repo')
      ).rejects.toThrow('GitHub API error (500): Internal Server Error')
    })

    it('throws on GraphQL errors', async () => {
      github.setToken('ghp_test123')
      mockFetchOk({
        data: null,
        errors: [{ message: 'Could not resolve repository' }],
      })

      await expect(
        github.listPullRequests('owner', 'repo')
      ).rejects.toThrow('GitHub GraphQL error: Could not resolve repository')
    })

    it('throws timeout error when fetch times out', async () => {
      github.setToken('ghp_test123')
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      mockFetch.mockRejectedValue(abortError)

      await expect(
        github.listPullRequests('owner', 'repo')
      ).rejects.toThrow('GitHub API request timed out')
    })
  })
})
