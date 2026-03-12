import { describe, expect, it } from 'vitest'

import { buildAgentSystemPrompt } from '../../main/services/AgentService'

describe('buildAgentSystemPrompt', () => {
  it('prioritizes repository and documentation discovery before user technical questions', () => {
    const prompt = buildAgentSystemPrompt({
      projectName: 'CodeFire',
      planEnforcement: true,
      projectPath: '/tmp/codefire-app',
    })

    expect(prompt).toContain('Assume the user may not know the project stack, libraries, UI framework, architecture, or internal conventions.')
    expect(prompt).toContain('Before asking technical questions, investigate the repository first.')
    expect(prompt).toContain('Treat the codebase as the primary source of truth for stack, dependencies, architecture, conventions, and implementation details.')
    expect(prompt).toContain('consult relevant project or official documentation next')
    expect(prompt).toContain(
      'Do not ask which stack, library, framework, UI system, or architecture the project uses when the repository can reveal it.'
    )
  })
})
