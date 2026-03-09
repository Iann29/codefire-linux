import { describe, expect, it } from 'vitest'
import { detectBrowserIntent } from '../../main/services/agentBrowserIntent'

describe('detectBrowserIntent', () => {
  it('detects explicit browser/navigation requests', () => {
    expect(detectBrowserIntent('Open the site in the browser and test the login form')).toBe(true)
    expect(detectBrowserIntent('Navega na pagina e tira um screenshot')).toBe(true)
  })

  it('ignores code-only requests', () => {
    expect(detectBrowserIntent('Analise este arquivo TypeScript e sugira refactors')).toBe(false)
    expect(detectBrowserIntent('Compare duas implementacoes de reducer')).toBe(false)
  })
})
