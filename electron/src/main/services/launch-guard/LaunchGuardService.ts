import * as fs from 'fs'
import * as path from 'path'

export interface LaunchCheck {
  id: string
  category: 'git' | 'env' | 'routes' | 'seo' | 'browser' | 'ci'
  status: 'pass' | 'warn' | 'fail' | 'skipped'
  title: string
  evidence: string
  remediation: string
}

export interface LaunchReport {
  generatedAt: number
  branch: string | null
  totalChecks: number
  passCount: number
  warnCount: number
  failCount: number
  skipCount: number
  checks: LaunchCheck[]
  score: number
}

export interface LaunchGuardInputs {
  gitStatus?: {
    branch: string
    isClean: boolean
    files: Array<{ status: string; path: string }>
  }
  envDoctorResult?: {
    score: number
    issues: Array<{
      severity: string
      code: string
      key: string
      title: string
    }>
  }
  routeResult?: {
    routes: Array<{ path: string; type: string }>
  }
  projectPath: string
}

export class LaunchGuardService {
  generateReport(inputs: LaunchGuardInputs): LaunchReport {
    const checks: LaunchCheck[] = []

    this.runGitChecks(inputs, checks)
    this.runEnvChecks(inputs, checks)
    this.runRouteChecks(inputs, checks)
    this.runSeoChecks(inputs, checks)

    const passCount = checks.filter((c) => c.status === 'pass').length
    const warnCount = checks.filter((c) => c.status === 'warn').length
    const failCount = checks.filter((c) => c.status === 'fail').length
    const skipCount = checks.filter((c) => c.status === 'skipped').length

    const gradedChecks = checks.filter((c) => c.status !== 'skipped')
    let score = 100
    if (gradedChecks.length > 0) {
      const points = gradedChecks.reduce((sum, c) => {
        if (c.status === 'pass') return sum + 100
        if (c.status === 'warn') return sum + 60
        return sum
      }, 0)
      score = Math.round(points / gradedChecks.length)
    }

    return {
      generatedAt: Date.now(),
      branch: inputs.gitStatus?.branch ?? null,
      totalChecks: checks.length,
      passCount,
      warnCount,
      failCount,
      skipCount,
      checks,
      score,
    }
  }

  private runGitChecks(inputs: LaunchGuardInputs, checks: LaunchCheck[]): void {
    if (!inputs.gitStatus) {
      checks.push({
        id: 'git-status',
        category: 'git',
        status: 'skipped',
        title: 'Git status unavailable',
        evidence: 'Could not retrieve git status information',
        remediation: 'Ensure the project is a git repository',
      })
      return
    }

    const { branch, isClean, files } = inputs.gitStatus

    // Check: on main/master branch
    const isMainBranch = ['main', 'master'].includes(branch)
    checks.push({
      id: 'git-branch',
      category: 'git',
      status: isMainBranch ? 'pass' : 'warn',
      title: isMainBranch
        ? `On production branch (${branch})`
        : `Not on production branch (${branch})`,
      evidence: `Current branch: ${branch}`,
      remediation: isMainBranch
        ? ''
        : 'Consider merging to main/master before deploying to production',
    })

    // Check: clean working tree
    checks.push({
      id: 'git-clean',
      category: 'git',
      status: isClean ? 'pass' : 'fail',
      title: isClean ? 'Working tree is clean' : 'Working tree has uncommitted changes',
      evidence: isClean
        ? 'No uncommitted changes detected'
        : `${files.length} file(s) with uncommitted changes`,
      remediation: isClean ? '' : 'Commit or stash all changes before deploying',
    })

    // Check: no untracked files
    const untrackedFiles = files.filter((f) => f.status === '??' || f.status === 'untracked')
    if (untrackedFiles.length > 0) {
      checks.push({
        id: 'git-untracked',
        category: 'git',
        status: 'warn',
        title: `${untrackedFiles.length} untracked file(s) found`,
        evidence: untrackedFiles
          .slice(0, 5)
          .map((f) => f.path)
          .join(', ') + (untrackedFiles.length > 5 ? '...' : ''),
        remediation: 'Add untracked files to .gitignore or commit them',
      })
    } else if (!isClean) {
      checks.push({
        id: 'git-untracked',
        category: 'git',
        status: 'pass',
        title: 'No untracked files',
        evidence: 'All files are tracked by git',
        remediation: '',
      })
    }
  }

  private runEnvChecks(inputs: LaunchGuardInputs, checks: LaunchCheck[]): void {
    if (!inputs.envDoctorResult) {
      checks.push({
        id: 'env-status',
        category: 'env',
        status: 'skipped',
        title: 'Env Doctor not run',
        evidence: 'Environment analysis was not performed',
        remediation: 'Run Env Doctor first to include environment checks',
      })
      return
    }

    const { score, issues } = inputs.envDoctorResult

    // Overall env health
    const envStatus = score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail'
    checks.push({
      id: 'env-health',
      category: 'env',
      status: envStatus,
      title: `Environment health score: ${score}/100`,
      evidence: `${issues.length} issue(s) detected`,
      remediation:
        envStatus === 'pass'
          ? ''
          : 'Review and resolve environment variable issues in Env Doctor',
    })

    // Missing env vars
    const missingVars = issues.filter((i) => i.code === 'missing')
    if (missingVars.length > 0) {
      checks.push({
        id: 'env-missing',
        category: 'env',
        status: 'fail',
        title: `${missingVars.length} missing environment variable(s)`,
        evidence: missingVars
          .slice(0, 5)
          .map((i) => i.key)
          .join(', ') + (missingVars.length > 5 ? '...' : ''),
        remediation: 'Define all required environment variables before deploying',
      })
    }

    // Unused env vars
    const unusedVars = issues.filter((i) => i.code === 'unused')
    if (unusedVars.length > 0) {
      checks.push({
        id: 'env-unused',
        category: 'env',
        status: 'warn',
        title: `${unusedVars.length} unused environment variable(s)`,
        evidence: unusedVars
          .slice(0, 5)
          .map((i) => i.key)
          .join(', ') + (unusedVars.length > 5 ? '...' : ''),
        remediation: 'Remove unused variables to keep configuration clean',
      })
    }
  }

  private runRouteChecks(inputs: LaunchGuardInputs, checks: LaunchCheck[]): void {
    if (!inputs.routeResult) {
      checks.push({
        id: 'routes-status',
        category: 'routes',
        status: 'skipped',
        title: 'Route discovery not run',
        evidence: 'Route information was not provided',
        remediation: 'Run route discovery first to include route checks',
      })
      return
    }

    const { routes } = inputs.routeResult

    // Check: at least one route exists
    checks.push({
      id: 'routes-exist',
      category: 'routes',
      status: routes.length > 0 ? 'pass' : 'fail',
      title:
        routes.length > 0
          ? `${routes.length} route(s) discovered`
          : 'No routes found',
      evidence:
        routes.length > 0
          ? `Found ${routes.length} route(s)`
          : 'No routes could be discovered in the project',
      remediation:
        routes.length > 0 ? '' : 'Ensure the project has at least one accessible route',
    })

    // Check: index route present
    if (routes.length > 0) {
      const hasIndex = routes.some(
        (r) => r.path === '/' || r.path === '/index' || r.path === ''
      )
      checks.push({
        id: 'routes-index',
        category: 'routes',
        status: hasIndex ? 'pass' : 'warn',
        title: hasIndex ? 'Index route (/) is defined' : 'No index route (/) found',
        evidence: hasIndex
          ? 'Root path "/" is mapped to a page'
          : 'Could not find a route mapped to "/"',
        remediation: hasIndex
          ? ''
          : 'Consider adding an index route for the root path',
      })
    }
  }

  private runSeoChecks(inputs: LaunchGuardInputs, checks: LaunchCheck[]): void {
    const { projectPath } = inputs

    // Common public/static directories where SEO files live
    const publicDirs = ['public', 'static', 'src/assets', '.']

    // Check: robots.txt
    const robotsExists = this.fileExistsInDirs(projectPath, publicDirs, 'robots.txt')
    checks.push({
      id: 'seo-robots',
      category: 'seo',
      status: robotsExists ? 'pass' : 'warn',
      title: robotsExists ? 'robots.txt found' : 'robots.txt not found',
      evidence: robotsExists
        ? 'robots.txt exists in the project'
        : 'No robots.txt found in common public directories',
      remediation: robotsExists
        ? ''
        : 'Add a robots.txt file to control search engine crawling',
    })

    // Check: sitemap.xml
    const sitemapExists = this.fileExistsInDirs(projectPath, publicDirs, 'sitemap.xml')
    checks.push({
      id: 'seo-sitemap',
      category: 'seo',
      status: sitemapExists ? 'pass' : 'warn',
      title: sitemapExists ? 'sitemap.xml found' : 'sitemap.xml not found',
      evidence: sitemapExists
        ? 'sitemap.xml exists in the project'
        : 'No sitemap.xml found in common public directories',
      remediation: sitemapExists
        ? ''
        : 'Add a sitemap.xml to help search engines index your site',
    })

    // Check: favicon
    const faviconPatterns = ['favicon.ico', 'favicon.svg', 'favicon.png']
    const faviconExists = faviconPatterns.some((f) =>
      this.fileExistsInDirs(projectPath, publicDirs, f)
    )
    checks.push({
      id: 'seo-favicon',
      category: 'seo',
      status: faviconExists ? 'pass' : 'warn',
      title: faviconExists ? 'Favicon found' : 'No favicon found',
      evidence: faviconExists
        ? 'A favicon file exists in the project'
        : 'No favicon.ico, favicon.svg, or favicon.png found',
      remediation: faviconExists
        ? ''
        : 'Add a favicon to improve site identity in browser tabs and bookmarks',
    })
  }

  private fileExistsInDirs(
    projectPath: string,
    dirs: string[],
    fileName: string
  ): boolean {
    return dirs.some((dir) => {
      try {
        const filePath = path.join(projectPath, dir, fileName)
        return fs.existsSync(filePath)
      } catch {
        return false
      }
    })
  }
}
