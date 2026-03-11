// ── PromptCompilerService ────────────────────────────────────────────────────
// Ported faithfully from /home/ian/intent-prompt-mvp/server.js
// Two-phase intent-to-prompt compiler:
//   Phase 1 (clarify): interpret intent, produce confirmation summary in PT
//   Phase 2 (generate): produce one strong final prompt in EN

import type { ProjectContext } from '@shared/models'

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskMode = 'general' | 'coding' | 'debug' | 'refactor' | 'writing'

export interface PromptPayload {
  originalBrief: string
  taskMode: TaskMode
  userCorrections: string
  clarification: ClarificationResult | null
  projectContext?: ProjectContext
}

export interface ClarificationResult {
  understanding: string
  objective: string[]
  context: string[]
  constraints: string[]
  assumptions: string[]
  confirmationPrompt: string
  questions: string[]
}

export interface GenerationResult {
  finalPrompt: string
}

export interface PromptRequest {
  instructions: string
  input: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  general: 'general request',
  coding: 'coding task',
  debug: 'debugging task',
  refactor: 'refactor task',
  writing: 'writing task',
}

// ── Public API ───────────────────────────────────────────────────────────────

export function normalizePromptPayload(body: {
  originalBrief?: string
  taskMode?: string
  userCorrections?: string
  clarification?: unknown
  projectContext?: ProjectContext
}): PromptPayload {
  const originalBrief = cleanString(body.originalBrief)

  return {
    originalBrief,
    taskMode: (cleanString(body.taskMode) as TaskMode) || inferTaskModeFromBrief(originalBrief),
    userCorrections: cleanString(body.userCorrections),
    clarification:
      body.clarification && typeof body.clarification === 'object'
        ? (body.clarification as ClarificationResult)
        : null,
    projectContext: body.projectContext || undefined,
  }
}

function buildProjectContextBlock(ctx: ProjectContext): string {
  const lines: string[] = ['## Project Context']
  lines.push(`- Project: ${ctx.projectName} (${ctx.projectPath})`)

  if (ctx.techStack.length) {
    lines.push(`- Tech Stack: ${ctx.techStack.join(', ')}`)
  }
  if (ctx.gitBranch) {
    lines.push(`- Current Git Branch: ${ctx.gitBranch}`)
  }
  if (ctx.openTasks.length) {
    lines.push('- Open Tasks:')
    for (const t of ctx.openTasks.slice(0, 10)) {
      lines.push(`  - [${t.status}] ${t.title} (${t.priority})`)
    }
  }
  if (ctx.memories.length) {
    lines.push('- Project Memories/Rules:')
    for (const m of ctx.memories.slice(0, 5)) {
      const snippet = m.snippet.length > 200 ? m.snippet.slice(0, 200) + '...' : m.snippet
      lines.push(`  - ${m.name}: "${snippet}"`)
    }
  }

  return lines.join('\n')
}

export function buildClarifyRequest(payload: PromptPayload): PromptRequest {
  const systemLines = [
    'You are an Intent-to-Prompt Compiler.',
    'The user writes in Portuguese or mixed language.',
    'Your current task is Phase 1 only: interpret intent and prepare a confirmation summary in Portuguese.',
    'The user may provide all context, constraints, stack, and goals inside a single freeform block.',
    'Infer the likely task type, relevant context, and missing information from the brief itself.',
    'Return JSON only. No markdown fences.',
    'Never invent facts. Unknown data must be placed in assumptions or questions.',
    'Use this JSON shape exactly:',
    '{',
    '  "understanding": "string",',
    '  "objective": ["string"],',
    '  "context": ["string"],',
    '  "constraints": ["string"],',
    '  "assumptions": ["string"],',
    '  "confirmationPrompt": "string",',
    '  "questions": ["string"]',
    '}',
  ]

  if (payload.projectContext) {
    systemLines.push(
      '',
      buildProjectContextBlock(payload.projectContext),
      '',
      'Use the project context above to better understand the user\'s intent.',
      'Reference the project\'s tech stack, current branch, and open tasks when relevant.',
      'Skip questions that are already answered by the project context (e.g. do not ask about the stack if it is listed above).',
    )
  }

  const system = systemLines.join('\n')
  const user = JSON.stringify(payload, null, 2)

  return { instructions: system, input: user }
}

export function buildGenerateRequest(payload: PromptPayload): PromptRequest {
  const systemLines = [
    'You are an Intent-to-Prompt Compiler.',
    'The user already reviewed the task intent.',
    'Your current task is Phase 2 only: generate one strong final prompt in English.',
    'Return JSON only. No markdown fences.',
    'Do not execute the task itself. Generate prompts for another AI to execute.',
    'Use this JSON shape exactly:',
    '{',
    '  "finalPrompt": "string"',
    '}',
    'Generate only one final prompt, not multiple versions.',
    'The final prompt should be detailed, execution-ready, and optimized for the best possible output by another AI.',
    'The final prompt must read like a direct brief to another AI worker.',
    'It must describe the actual task to be done, not the act of rewriting or understanding the user\'s request.',
    "Do not use meta language such as 'Transform the user's rough intent', 'the user wants', 'prompt compiler', or similar phrasing.",
    "Bad output: a prompt about clarifying, organizing, or improving the user's request.",
    'Good output: a prompt that directly tells another AI what to build, debug, refactor, write, or plan, with concrete context, constraints, and deliverables.',
    'If the request is software-related, assume the target AI can inspect a codebase, compare existing implementations, and make changes.',
    'When repo names, product names, file paths, or existing systems are mentioned, include them concretely in the final prompt.',
    'Include the sections Role, Objective, Context, Constraints, Technical Details, Expected Output, Acceptance Criteria, Avoid, and Clarification Rule when they apply.',
  ]

  if (payload.projectContext) {
    systemLines.push(
      '',
      buildProjectContextBlock(payload.projectContext),
      '',
      'Use the project context above to generate a prompt that references the correct tech stack, file paths, and conventions.',
      'Include the project name, path, and current branch in the generated prompt so the target AI has full context.',
      'Align the prompt with open tasks and project rules/memories when relevant.',
    )
  }

  const system = systemLines.join('\n')
  const user = JSON.stringify(payload, null, 2)

  return { instructions: system, input: user }
}

export function sanitizeClarifyResponse(
  parsed: Record<string, unknown>,
  payload: PromptPayload
): ClarificationResult {
  const fallback = buildClarificationFallback(payload)

  return {
    understanding: cleanString(parsed.understanding as string) || fallback.understanding,
    objective: preferList(parsed.objective as string[], fallback.objective),
    context: preferList(parsed.context as string[], fallback.context),
    constraints: preferList(parsed.constraints as string[], fallback.constraints),
    assumptions: preferList(parsed.assumptions as string[], fallback.assumptions),
    confirmationPrompt:
      cleanString(parsed.confirmationPrompt as string) ||
      'Confirma esse entendimento antes de eu gerar o prompt final?',
    questions: preferList(parsed.questions as string[], fallback.questions),
  }
}

export function sanitizeGenerateResponse(
  parsed: Record<string, unknown>,
  payload: PromptPayload
): GenerationResult {
  const fallback = buildGenerationFallback(payload)

  return {
    finalPrompt: cleanString(parsed.finalPrompt as string) || fallback.finalPrompt,
  }
}

export function buildClarificationFallback(payload: PromptPayload): ClarificationResult {
  const modeLabel = MODE_LABELS[payload.taskMode] || MODE_LABELS.general
  const context = [
    `Modo inferido: ${modeLabel}`,
    `Briefing original: "${payload.originalBrief.trim()}"`,
  ].filter(Boolean)

  // Inject project context into fallback
  if (payload.projectContext) {
    const pc = payload.projectContext
    context.push(`Projeto: ${pc.projectName} (${pc.projectPath})`)
    if (pc.techStack.length) {
      context.push(`Stack detectada: ${pc.techStack.join(', ')}`)
    }
    if (pc.gitBranch) {
      context.push(`Branch atual: ${pc.gitBranch}`)
    }
    if (pc.openTasks.length) {
      context.push(`Tasks abertas: ${pc.openTasks.map((t) => t.title).join('; ')}`)
    }
  }

  const assumptions = [
    'Se algum detalhe tecnico nao foi informado, ele deve ser tratado como suposicao e nao como fato.',
    'O prompt final precisa manter a intencao original do usuario, mas com escopo, contexto e entregavel mais claros.',
    'O formato final deve ser o mais forte possivel por padrao, sem depender de o usuario preencher um campo separado para isso.',
  ]

  if (
    payload.taskMode === 'coding' ||
    payload.taskMode === 'refactor' ||
    payload.taskMode === 'debug'
  ) {
    assumptions.push(
      'Se houver impacto em codigo, o sistema deve priorizar seguranca contra regressao e pedir detalhes ausentes quando necessario.'
    )
  }

  const questions: string[] = []

  if (!looksLikeSelfContainedBrief(payload.originalBrief)) {
    questions.push(
      'Qual e o contexto maior dessa tarefa? Projeto existente, ideia nova, produto interno ou outro?'
    )
  }

  if (
    (payload.taskMode === 'coding' ||
      payload.taskMode === 'refactor' ||
      payload.taskMode === 'debug') &&
    !hasTechnicalSignals(payload.originalBrief)
  ) {
    questions.push('Qual stack ou tecnologias devo assumir para gerar um prompt tecnico melhor?')
  }

  if (!hasConstraintSignals(payload.originalBrief)) {
    questions.push(
      'Existe alguma restricao importante de escopo, estilo, prazo ou comportamento que o prompt final precisa preservar?'
    )
  }

  return {
    understanding: `Entendi que voce quer transformar um pedido ainda informal em um prompt final muito mais claro, estruturado e executavel para uma ${modeLabel}.`,
    objective: [
      `Capturar a intencao real por tras do briefing: "${payload.originalBrief.trim()}"`,
      'Explicitar contexto, restricoes e criterio de sucesso antes de gerar o prompt em ingles.',
    ],
    context,
    constraints: ['Preservar a intencao original do usuario sem inventar detalhes.'],
    assumptions,
    confirmationPrompt:
      'Confirma esse entendimento ou quer corrigir algum ponto antes de gerar o prompt final em ingles?',
    questions,
  }
}

export function buildGenerationFallback(payload: PromptPayload): GenerationResult {
  const clarification = payload.clarification || buildClarificationFallback(payload)
  const role = inferRole(payload.taskMode)
  const referencedPaths = extractReferencedPaths(
    [payload.originalBrief, payload.userCorrections].filter(Boolean).join('\n')
  )
  const derivedContext = cleanList(clarification.context)

  // Build project context items for fallback
  const projectContextItems: string[] = []
  if (payload.projectContext) {
    const pc = payload.projectContext
    projectContextItems.push(`Project: ${pc.projectName} (${pc.projectPath})`)
    if (pc.techStack.length) {
      projectContextItems.push(`Tech stack: ${pc.techStack.join(', ')}`)
    }
    if (pc.gitBranch) {
      projectContextItems.push(`Current branch: ${pc.gitBranch}`)
    }
    if (pc.openTasks.length) {
      projectContextItems.push(
        `Open tasks: ${pc.openTasks.map((t) => `[${t.status}] ${t.title}`).join('; ')}`
      )
    }
    if (pc.memories.length) {
      for (const m of pc.memories.slice(0, 3)) {
        const snippet = m.snippet.length > 150 ? m.snippet.slice(0, 150) + '...' : m.snippet
        projectContextItems.push(`Project memory (${m.name}): ${snippet}`)
      }
    }
  }

  const contextItems = uniqueList(
    [
      ...projectContextItems,
      ...derivedContext,
      referencedPaths.length ? `Referenced paths: ${referencedPaths.join(', ')}` : null,
      payload.userCorrections &&
        `User corrections and confirmations: ${payload.userCorrections}`,
    ].filter(Boolean) as string[]
  )

  const constraintItems = uniqueList(
    [
      ...cleanList(clarification.constraints),
      ...extractInlineConstraints(payload.originalBrief),
      ...extractInlineConstraints(payload.userCorrections),
    ].filter(Boolean)
  )

  const technicalDetails = uniqueList(
    [
      payload.taskMode && `Task mode: ${payload.taskMode}`,
      ...inferExecutionGuidance(payload.taskMode, payload.originalBrief, referencedPaths),
      ...cleanList(clarification.assumptions).map((item) => `Assumption to validate: ${item}`),
    ].filter(Boolean) as string[]
  )

  const expectedOutput = inferExpectedOutput(payload.taskMode)
  const acceptanceCriteria = inferAcceptanceCriteria(payload.taskMode, constraintItems)
  const avoid = inferAvoidList(payload.taskMode)
  const directObjective = buildDirectObjective(payload)

  const finalPrompt = [
    `Role\n${role}`,
    `Objective\n${directObjective}`,
    `Context\n${toBulletBlock(contextItems)}`,
    `Constraints\n${toBulletBlock(constraintItems)}`,
    `Technical Details\n${toBulletBlock(technicalDetails)}`,
    `Expected Output\n${toBulletBlock(expectedOutput)}`,
    `Acceptance Criteria\n${toBulletBlock(acceptanceCriteria)}`,
    `Avoid\n${toBulletBlock(avoid)}`,
    'Clarification Rule\nIf a critical detail is missing, ask concise clarification questions before acting. Do not invent concrete facts.',
  ].join('\n\n')

  return { finalPrompt }
}

export function extractJson(rawContent: string): Record<string, unknown> {
  const fencedMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1]?.trim() || rawContent.trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')

  if (start === -1 || end === -1) {
    throw new Error('The model response did not contain valid JSON.')
  }

  return JSON.parse(candidate.slice(start, end + 1))
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function inferTaskModeFromBrief(brief: string): TaskMode {
  const text = cleanString(brief).toLowerCase()

  if (!text) return 'general'

  if (/(\/home\/|\/users\/|\/tmp\/|\.tsx\b|\.ts\b|\.jsx\b|\.js\b|\.css\b|\.json\b)/.test(text))
    return 'coding'

  if (/(bug|erro|debug|depurar|falha|quebra|crash|issue|investigar)/.test(text)) return 'debug'

  if (/(refator|refactor|reorganizar|cleanup|limpar|reestruturar)/.test(text)) return 'refactor'

  if (
    /(react|next|typescript|javascript|node|api|backend|frontend|componente|codigo|codebase|repo|aba|tab|pagina|page|rota|route|interface|ui|screen|tela|dashboard|painel)/.test(
      text
    )
  )
    return 'coding'

  if (
    /(texto|copy|escrever|apresentacao|pitch|email|artigo|post|writing|investidor)/.test(text)
  )
    return 'writing'

  return 'general'
}

function inferRole(taskMode: string): string {
  if (taskMode === 'coding')
    return 'You are a senior software engineer working inside an existing product codebase.'
  if (taskMode === 'debug')
    return 'You are a senior engineer performing disciplined debugging inside an existing system.'
  if (taskMode === 'refactor')
    return 'You are a senior software engineer focused on safe refactoring in an existing codebase.'
  if (taskMode === 'writing') return 'You are an expert writer and editor.'
  return 'You are a precise, high-agency AI assistant.'
}

function buildDirectObjective(payload: PromptPayload): string {
  const brief = payload.originalBrief.trim()

  if (payload.taskMode === 'coding' || payload.taskMode === 'refactor')
    return `Complete this software implementation task in the relevant codebase or product: ${brief}`
  if (payload.taskMode === 'debug')
    return `Investigate and resolve the following problem in a disciplined way: ${brief}`
  if (payload.taskMode === 'writing')
    return `Produce the requested writing deliverable based on this brief: ${brief}`
  return `Carry out the following request directly and concretely: ${brief}`
}

function inferExecutionGuidance(
  taskMode: string,
  brief: string,
  referencedPaths: string[]
): string[] {
  const text = cleanString(brief).toLowerCase()
  const items: string[] = []

  if (taskMode === 'coding' || taskMode === 'refactor' || taskMode === 'debug') {
    items.push('Inspect the existing codebase and relevant files before proposing changes.')
    items.push(
      "Keep the solution aligned with the product's existing architecture, naming, routing, and UI patterns."
    )
  }

  if (referencedPaths.length) {
    items.push(
      'Use the referenced path(s) as concrete sources of context and reusable implementation patterns.'
    )
  }

  if (/(mesmo sistema|same system|reutil|reuse|igual ao|baseado no)/i.test(text)) {
    items.push(
      'Reuse the existing system, prompts, flows, and implementation patterns when that is safer than rebuilding from scratch.'
    )
  }

  if (/(modelo|modelos|llm|ia|ai)/i.test(text)) {
    items.push(
      'If model selection is part of the task, design it so the options are explicit, maintainable, and easy to extend.'
    )
  }

  if (/(aba|tab|pagina|page|rota|route|tela|screen|painel|dashboard|ui|interface)/i.test(text)) {
    items.push(
      'Integrate the feature cleanly into the existing navigation and UI structure rather than bolting on an isolated screen.'
    )
  }

  return items
}

function inferExpectedOutput(taskMode: string): string[] {
  const items = [
    'A complete response in English that is clear, structured, and directly actionable.',
    'Use the strongest practical structure and level of detail for this task by default.',
  ]

  if (taskMode === 'coding' || taskMode === 'refactor') {
    items.push(
      'Inspect the relevant codebase, identify the touched areas, and describe the implementation in a way another AI can execute safely.'
    )
    items.push(
      'Include implementation guidance, file impact, regression concerns, and validation steps.'
    )
  }

  if (taskMode === 'debug') {
    items.push(
      'Include likely causes, debugging steps, evidence to collect, and a plan to confirm the fix.'
    )
  }

  if (taskMode === 'writing') {
    items.push(
      'Include tone, target audience, structure, and any style constraints that can be inferred.'
    )
  }

  return items
}

function inferAcceptanceCriteria(taskMode: string, constraintItems: string[]): string[] {
  const items = [
    "The final answer must preserve the user's original intention while removing ambiguity.",
  ]

  if (constraintItems.length) {
    items.push('The final answer must visibly respect the provided constraints.')
  }

  if (taskMode === 'coding' || taskMode === 'refactor') {
    items.push(
      'The task should be scoped in a way that minimizes regressions and makes verification explicit.'
    )
    items.push(
      'The prompt should read like a real implementation brief for a coding agent, not like a meta prompt about prompt writing.'
    )
  }

  if (taskMode === 'debug') {
    items.push(
      'The answer should distinguish confirmed facts, assumptions, and next debugging actions.'
    )
  }

  return items
}

function inferAvoidList(taskMode: string): string[] {
  const items = [
    'Do not invent missing facts.',
    'Do not answer with vague generic advice if the request can be made specific.',
    'Do not silently ignore user constraints.',
    'Do not turn the prompt into meta commentary about interpreting or improving the request.',
  ]

  if (taskMode === 'coding' || taskMode === 'refactor' || taskMode === 'debug') {
    items.push(
      'Do not propose risky code changes without surfacing regressions, file impact, or missing context.'
    )
  }

  return items
}

// ── String utilities ─────────────────────────────────────────────────────────

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => cleanString(String(item))).filter(Boolean)
}

function uniqueList(items: string[]): string[] {
  return [...new Set(cleanList(items))]
}

function preferList(candidate: unknown, fallback: string[]): string[] {
  const cleaned = uniqueList(candidate as string[])
  return cleaned.length ? cleaned : uniqueList(fallback)
}

function toBulletBlock(items: string[]): string {
  const cleanItems = uniqueList(items)
  return cleanItems.length ? cleanItems.map((item) => `- ${item}`).join('\n') : '- Not specified'
}

function extractInlineConstraints(text: string): string[] {
  return cleanString(text)
    .split(/[\n.;]+/)
    .map((item) => item.trim())
    .filter((item) =>
      /(sem |nao |não |preserv|manter|evitar|without|must|deve|precisa)/i.test(item)
    )
}

function extractReferencedPaths(text: string): string[] {
  const matches = cleanString(text).match(/(?:\/[\w.-]+)+/g) || []
  return [...new Set(matches)]
}

function looksLikeSelfContainedBrief(text: string): boolean {
  const normalized = cleanString(text)
  return normalized.length >= 120 || /\n/.test(normalized)
}

function hasTechnicalSignals(text: string): boolean {
  return /(\/home\/|\.tsx\b|\.ts\b|\.jsx\b|\.js\b|react|next|typescript|javascript|node|python|java|go|tailwind|api|backend|frontend|sql|css|html|repo|codebase|aba|tab|pagina|page|rota|route|interface|ui|screen|tela|dashboard|painel)/i.test(
    cleanString(text)
  )
}

function hasConstraintSignals(text: string): boolean {
  return /(sem |nao |não |preserv|manter|evitar|sem quebrar|without|must|deve|precisa)/i.test(
    cleanString(text)
  )
}
