import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ContextualScreenshotService } from '../../main/services/browser/ContextualScreenshotService'

describe('ContextualScreenshotService', () => {
  let projectRoot: string
  let service: ContextualScreenshotService

  beforeEach(() => {
    projectRoot = path.join(
      os.tmpdir(),
      `ctx-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    service = new ContextualScreenshotService()
  })

  afterEach(() => {
    try {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  function setupNextjsApp(routes: Record<string, string> = {}) {
    fs.mkdirSync(path.join(projectRoot, 'src', 'app'), { recursive: true })
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15.0.0', react: '19.0.0' },
      })
    )

    // Default: create a home page
    const defaultRoutes: Record<string, string> = {
      'src/app/page.tsx': 'export default function Home() { return <div>Home</div> }',
      ...routes,
    }

    for (const [filePath, content] of Object.entries(defaultRoutes)) {
      const fullPath = path.join(projectRoot, filePath)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, content)
    }
  }

  describe('route resolution', () => {
    it('matches a static route exactly', () => {
      setupNextjsApp({
        'src/app/page.tsx': 'export default function Home() { return <div/> }',
        'src/app/about/page.tsx': 'export default function About() { return <div/> }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/about',
      })

      expect(result.route.pathname).toBe('/about')
      expect(result.route.matchedPath).toBe('/about')
      expect(result.route.filePath).toBe('src/app/about/page.tsx')
      expect(result.route.framework).toBe('nextjs-app')
      expect(result.route.confidence).toBe('confirmed')
    })

    it('matches a dynamic route', () => {
      setupNextjsApp({
        'src/app/page.tsx': 'export default function Home() { return <div/> }',
        'src/app/blog/[slug]/page.tsx': 'export default function BlogPost() { return <div/> }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/blog/my-post',
      })

      expect(result.route.pathname).toBe('/blog/my-post')
      expect(result.route.matchedPath).toBe('/blog/[slug]')
      expect(result.route.filePath).toBe('src/app/blog/[slug]/page.tsx')
      expect(result.route.confidence).toBe('confirmed')
    })

    it('matches a catch-all route', () => {
      setupNextjsApp({
        'src/app/page.tsx': 'export default function Home() { return <div/> }',
        'src/app/docs/[...slug]/page.tsx': 'export default function Docs() { return <div/> }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/docs/getting-started/installation',
      })

      expect(result.route.pathname).toBe('/docs/getting-started/installation')
      expect(result.route.matchedPath).toBe('/docs/[...slug]')
      expect(result.route.filePath).toBe('src/app/docs/[...slug]/page.tsx')
    })

    it('prefers static route over dynamic when both match', () => {
      setupNextjsApp({
        'src/app/page.tsx': 'export default function Home() { return <div/> }',
        'src/app/about/page.tsx': 'export default function About() { return <div/> }',
        'src/app/[slug]/page.tsx': 'export default function Dynamic() { return <div/> }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/about',
      })

      expect(result.route.matchedPath).toBe('/about')
      expect(result.route.routeType).toBe('static')
    })

    it('returns none confidence when no route matches', () => {
      setupNextjsApp()

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/nonexistent',
      })

      expect(result.route.matchedPath).toBeNull()
      expect(result.route.confidence).toBe('none')
    })

    it('handles route groups by stripping them', () => {
      setupNextjsApp({
        'src/app/(marketing)/pricing/page.tsx': 'export default function Pricing() { return <div/> }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/pricing',
      })

      expect(result.route.matchedPath).toBe('/pricing')
      expect(result.route.filePath).toBe('src/app/(marketing)/pricing/page.tsx')
    })
  })

  describe('component resolution', () => {
    it('finds components imported by the route file', () => {
      setupNextjsApp({
        'src/app/page.tsx': `
import Header from '../components/Header'
import Footer from '../components/Footer'
export default function Home() { return <div><Header /><Footer /></div> }`,
        'src/components/Header.tsx': 'export default function Header() { return <header/> }',
        'src/components/Footer.tsx': 'export default function Footer() { return <footer/> }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/',
      })

      expect(result.components.length).toBeGreaterThanOrEqual(1)
      const names = result.components.map(c => c.name)
      expect(names).toContain('Home')
    })

    it('returns empty components when no route matches', () => {
      setupNextjsApp()

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/nonexistent',
      })

      expect(result.components).toEqual([])
    })
  })

  describe('backend resolution', () => {
    it('resolves /api/ runtime requests to route files', () => {
      setupNextjsApp({
        'src/app/page.tsx': 'export default function Home() { return <div/> }',
        'src/app/api/users/route.ts': 'export async function GET() { return Response.json([]) }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/',
        runtimeRequests: [
          { url: 'http://localhost:3000/api/users', method: 'GET' },
        ],
      })

      expect(result.backend.length).toBe(1)
      expect(result.backend[0].kind).toBe('api-route')
      expect(result.backend[0].relation).toBe('observed-request')
      expect(result.backend[0].filePath).toBe('src/app/api/users/route.ts')
      expect(result.backend[0].confidence).toBe('confirmed')
    })

    it('resolves Supabase function requests', () => {
      setupNextjsApp()
      // Create supabase function
      const funcDir = path.join(projectRoot, 'supabase', 'functions', 'hello')
      fs.mkdirSync(funcDir, { recursive: true })
      fs.writeFileSync(path.join(funcDir, 'index.ts'), 'export default () => {}')

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/',
        runtimeRequests: [
          { url: 'https://myproject.supabase.co/functions/v1/hello', method: 'POST' },
        ],
      })

      expect(result.backend.length).toBe(1)
      expect(result.backend[0].kind).toBe('supabase-function')
      expect(result.backend[0].filePath).toBe('supabase/functions/hello/index.ts')
      expect(result.backend[0].confidence).toBe('confirmed')
    })

    it('marks api requests as inferred when file does not exist', () => {
      setupNextjsApp()

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/',
        runtimeRequests: [
          { url: 'http://localhost:3000/api/unknown', method: 'GET' },
        ],
      })

      expect(result.backend.length).toBe(1)
      expect(result.backend[0].confidence).toBe('inferred')
      expect(result.backend[0].filePath).toBeNull()
    })

    it('detects route companion files', () => {
      setupNextjsApp({
        'src/app/dashboard/page.tsx': 'export default function Dashboard() { return <div/> }',
        'src/app/dashboard/route.ts': 'export async function POST() { return Response.json({}) }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/dashboard',
      })

      // Should find route.ts as a companion
      const companion = result.backend.find(b => b.relation === 'route-companion')
      expect(companion).toBeDefined()
      expect(companion?.confidence).toBe('inferred')
    })
  })

  describe('overall evidence', () => {
    it('produces complete evidence for a well-structured project', () => {
      setupNextjsApp({
        'src/app/page.tsx': `
import Hero from '../components/Hero'
export default function Home() { return <Hero /> }`,
        'src/components/Hero.tsx': 'export default function Hero() { return <section/> }',
        'src/app/api/data/route.ts': 'export async function GET() { return Response.json({}) }',
      })

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/',
        pageTitle: 'My App',
        runtimeRequests: [
          { url: 'http://localhost:3000/api/data', method: 'GET' },
        ],
      })

      expect(result.capturedAt).toBeDefined()
      expect(result.pageUrl).toBe('http://localhost:3000/')
      expect(result.pageTitle).toBe('My App')
      expect(result.route.pathname).toBe('/')
      expect(result.route.matchedPath).toBe('/')
      expect(result.route.framework).toBe('nextjs-app')
      expect(result.components.length).toBeGreaterThanOrEqual(1)
      expect(result.backend.length).toBe(1)
    })

    it('handles projects without a recognized framework gracefully', () => {
      fs.mkdirSync(projectRoot, { recursive: true })
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ dependencies: {} })
      )

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'http://localhost:3000/anything',
      })

      expect(result.route.confidence).toBe('none')
      expect(result.components).toEqual([])
      expect(result.backend).toEqual([])
    })

    it('handles invalid URLs gracefully', () => {
      // No home page route, so fallback to / won't match anything
      fs.mkdirSync(path.join(projectRoot, 'src', 'app', 'about'), { recursive: true })
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ dependencies: { next: '15.0.0' } })
      )
      fs.writeFileSync(
        path.join(projectRoot, 'src', 'app', 'about', 'page.tsx'),
        'export default function About() { return <div/> }'
      )

      const result = service.resolvePageContext({
        projectPath: projectRoot,
        pageUrl: 'not-a-url',
      })

      expect(result.route.pathname).toBe('/')
      expect(result.route.confidence).toBe('none')
    })
  })
})
