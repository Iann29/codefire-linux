import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreviewEnvironment {
  id: string
  provider: string | null
  branch: string | null
  prNumber: number | null
  prTitle: string | null
  previewUrl: string | null
  productionUrl: string | null
  status: 'active' | 'unknown' | 'manual'
  source: 'config' | 'github' | 'manual'
  commitSha: string | null
  updatedAt: number
}

export interface PreviewDiscoveryResult {
  provider: string | null
  currentBranch: string | null
  environments: PreviewEnvironment[]
  productionUrl: string | null
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Discovers deployment providers and preview environments from project
 * config files, git branch info, and GitHub PRs.
 *
 * V1 is pragmatic and honest: it detects providers, infers production
 * URLs when possible, and creates environment entries from branch/PR
 * info without attempting real API calls to providers.
 */
export class PreviewDiscoveryService {
  /**
   * Discover preview environments for a project.
   */
  discoverEnvironments(
    projectPath: string,
    gitInfo?: { branch: string; isClean: boolean },
    githubInfo?: {
      owner: string
      repo: string
      prs: Array<{
        number: number
        title: string
        head_branch: string
        state: string
      }>
    }
  ): PreviewDiscoveryResult {
    const provider = this.detectProvider(projectPath)
    const productionUrl = this.inferProductionUrl(projectPath, provider)
    const environments: PreviewEnvironment[] = []
    const now = Date.now()

    // ── Production environment ────────────────────────────────────────────
    if (productionUrl) {
      environments.push({
        id: 'production',
        provider,
        branch: 'main',
        prNumber: null,
        prTitle: null,
        previewUrl: null,
        productionUrl,
        status: 'unknown',
        source: 'config',
        commitSha: null,
        updatedAt: now,
      })
    }

    // ── Current branch environment ───────────────────────────────────────
    if (gitInfo?.branch && gitInfo.branch !== 'main' && gitInfo.branch !== 'master') {
      const inferredUrl = this.inferPreviewUrl(projectPath, provider, gitInfo.branch)
      environments.push({
        id: `branch-${gitInfo.branch}`,
        provider,
        branch: gitInfo.branch,
        prNumber: null,
        prTitle: null,
        previewUrl: inferredUrl,
        productionUrl: null,
        status: inferredUrl ? 'unknown' : 'unknown',
        source: 'config',
        commitSha: null,
        updatedAt: now,
      })
    }

    // ── PR environments ──────────────────────────────────────────────────
    if (githubInfo?.prs) {
      for (const pr of githubInfo.prs) {
        if (pr.state !== 'OPEN') continue

        // Skip if we already created an entry for this branch
        const alreadyExists = environments.some(
          (env) => env.branch === pr.head_branch && env.id !== 'production'
        )

        const inferredUrl = this.inferPreviewUrl(projectPath, provider, pr.head_branch)

        if (alreadyExists) {
          // Enrich the existing branch entry with PR info
          const existing = environments.find(
            (env) => env.branch === pr.head_branch && env.id !== 'production'
          )
          if (existing) {
            existing.prNumber = pr.number
            existing.prTitle = pr.title
            existing.source = 'github'
            if (!existing.previewUrl && inferredUrl) {
              existing.previewUrl = inferredUrl
            }
          }
        } else {
          environments.push({
            id: `pr-${pr.number}`,
            provider,
            branch: pr.head_branch,
            prNumber: pr.number,
            prTitle: pr.title,
            previewUrl: inferredUrl,
            productionUrl: null,
            status: inferredUrl ? 'unknown' : 'unknown',
            source: 'github',
            commitSha: null,
            updatedAt: now,
          })
        }
      }
    }

    return {
      provider,
      currentBranch: gitInfo?.branch ?? null,
      environments,
      productionUrl,
    }
  }

  // ─── Provider Detection ──────────────────────────────────────────────────

  /**
   * Detect the deployment provider by checking for known config files.
   */
  private detectProvider(projectPath: string): string | null {
    // Vercel
    if (
      existsSync(join(projectPath, '.vercel', 'project.json')) ||
      existsSync(join(projectPath, 'vercel.json'))
    ) {
      return 'vercel'
    }

    // Netlify
    if (
      existsSync(join(projectPath, '.netlify', 'state.json')) ||
      existsSync(join(projectPath, 'netlify.toml'))
    ) {
      return 'netlify'
    }

    // Firebase
    if (existsSync(join(projectPath, 'firebase.json'))) {
      return 'firebase'
    }

    return null
  }

  // ─── Production URL Inference ────────────────────────────────────────────

  /**
   * Try to infer the production URL from project config files.
   */
  private inferProductionUrl(
    projectPath: string,
    provider: string | null
  ): string | null {
    if (!provider) return null

    try {
      switch (provider) {
        case 'vercel':
          return this.inferVercelProductionUrl(projectPath)
        case 'netlify':
          return this.inferNetlifyProductionUrl(projectPath)
        case 'firebase':
          return this.inferFirebaseProductionUrl(projectPath)
        default:
          return null
      }
    } catch {
      return null
    }
  }

  /**
   * Read .vercel/project.json for projectId or name.
   * Infer URL as https://{name}.vercel.app
   */
  private inferVercelProductionUrl(projectPath: string): string | null {
    const projectJsonPath = join(projectPath, '.vercel', 'project.json')
    if (!existsSync(projectJsonPath)) return null

    try {
      const raw = readFileSync(projectJsonPath, 'utf-8')
      const parsed = JSON.parse(raw) as { projectId?: string; orgId?: string }
      // Vercel project.json only has projectId, not the project name
      // We can't reliably infer the URL from just the ID
      if (parsed.projectId) {
        return null // Would need Vercel API to resolve name
      }
    } catch {
      // Ignore parse errors
    }

    // Check vercel.json for a name property (uncommon but possible)
    const vercelJsonPath = join(projectPath, 'vercel.json')
    if (existsSync(vercelJsonPath)) {
      try {
        const raw = readFileSync(vercelJsonPath, 'utf-8')
        const parsed = JSON.parse(raw) as { name?: string }
        if (parsed.name) {
          return `https://${parsed.name}.vercel.app`
        }
      } catch {
        // Ignore
      }
    }

    return null
  }

  /**
   * Read .netlify/state.json for siteId or netlify.toml for site name.
   */
  private inferNetlifyProductionUrl(projectPath: string): string | null {
    // Try netlify.toml for [build] publish or name
    const tomlPath = join(projectPath, 'netlify.toml')
    if (existsSync(tomlPath)) {
      try {
        const content = readFileSync(tomlPath, 'utf-8')
        // Very basic TOML parsing for name = "..."
        const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m)
        if (nameMatch) {
          return `https://${nameMatch[1]}.netlify.app`
        }
      } catch {
        // Ignore
      }
    }

    return null
  }

  /**
   * Read .firebaserc for the default project name.
   */
  private inferFirebaseProductionUrl(projectPath: string): string | null {
    const firebasercPath = join(projectPath, '.firebaserc')
    if (!existsSync(firebasercPath)) return null

    try {
      const raw = readFileSync(firebasercPath, 'utf-8')
      const parsed = JSON.parse(raw) as {
        projects?: { default?: string }
      }
      const defaultProject = parsed.projects?.default
      if (defaultProject) {
        return `https://${defaultProject}.web.app`
      }
    } catch {
      // Ignore parse errors
    }

    return null
  }

  // ─── Preview URL Inference ───────────────────────────────────────────────

  /**
   * Attempt to infer a preview URL for a specific branch.
   * This is a best-effort heuristic -- real URLs require provider APIs.
   */
  private inferPreviewUrl(
    _projectPath: string,
    provider: string | null,
    _branch: string
  ): string | null {
    // V1: We can't reliably infer preview URLs without provider API access.
    // Vercel, Netlify, and Firebase all generate unique URLs per deployment
    // that aren't predictable from the branch name alone.
    //
    // Future versions can integrate with provider APIs to fetch actual URLs.
    if (!provider) return null

    return null
  }
}
