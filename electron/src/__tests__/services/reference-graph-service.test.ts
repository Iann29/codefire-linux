import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ReferenceGraphService } from '../../main/services/tools/codebase/ReferenceGraphService'

describe('ReferenceGraphService', () => {
  let projectRoot: string
  let service: ReferenceGraphService

  beforeEach(() => {
    projectRoot = path.join(
      os.tmpdir(),
      `reference-graph-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true })
    fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), { recursive: true })
    service = new ReferenceGraphService()
  })

  afterEach(() => {
    try {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('resolves extensionless imports to the real source file on disk', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Button.tsx'),
      'export function Button() { return null }',
      'utf8',
    )
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'pages', 'Home.tsx'),
      "import { Button } from '../components/Button'\nexport function Home() { return <Button /> }",
      'utf8',
    )

    const importers = await service.findImporters(projectRoot, {
      path: 'src/components/Button.tsx',
    })

    expect(importers).toEqual([
      expect.objectContaining({
        file: 'src/pages/Home.tsx',
        confidence: 'graph',
      }),
    ])
  })

  it('keeps style imports pointing at the real CSS file instead of fabricating .ts paths', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Button.tsx'),
      "import styles from './Button.module.css'\nexport function Button() { return <button className={styles.root} /> }",
      'utf8',
    )
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Button.module.css'),
      '.root { color: red; }',
      'utf8',
    )

    const companions = await service.findStyleCompanions(projectRoot, {
      path: 'src/components/Button.tsx',
    })

    expect(companions).toContainEqual({
      file: 'src/components/Button.module.css',
      kind: 'module-css',
      confidence: 'graph',
    })
  })

  it('rebuilds after explicit invalidation when files change', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Button.tsx'),
      'export function Button() { return null }',
      'utf8',
    )
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'pages', 'Home.tsx'),
      "import { Button } from '../components/Button'\nexport function Home() { return <Button /> }",
      'utf8',
    )

    await service.findImporters(projectRoot, {
      path: 'src/components/Button.tsx',
    })

    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Card.tsx'),
      'export function Card() { return null }',
      'utf8',
    )
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'pages', 'Home.tsx'),
      "import { Card } from '../components/Card'\nexport function Home() { return <Card /> }",
      'utf8',
    )

    service.invalidate(projectRoot)

    const importers = await service.findImporters(projectRoot, {
      path: 'src/components/Card.tsx',
    })

    expect(importers).toEqual([
      expect.objectContaining({
        file: 'src/pages/Home.tsx',
      }),
    ])
  })
})
