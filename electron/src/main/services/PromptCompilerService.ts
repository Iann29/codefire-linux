// ── PromptCompilerService ────────────────────────────────────────────────────
// Ported faithfully from /home/ian/intent-prompt-mvp/server.js
// Two-phase intent-to-prompt compiler:
//   Phase 1 (clarify): interpret intent, produce confirmation summary in PT
//   Phase 2 (generate): produce one strong final prompt in EN

import type { ProjectContext } from '@shared/models'
import type {
  PromptClarificationResult,
  PromptGenerationResult,
  PromptInteractiveQuestion,
  PromptQuestionOption,
  PromptQuestionResponseType,
} from '@shared/promptCompiler'

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskMode = 'general' | 'coding' | 'debug' | 'refactor' | 'writing'

export interface PromptPayload {
  originalBrief: string
  taskMode: TaskMode
  userCorrections: string
  clarification: ClarificationResult | null
  projectContext?: ProjectContext
}

export type ClarificationResult = PromptClarificationResult

export type GenerationResult = PromptGenerationResult

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
    'Assume the user may not know the project stack, libraries, UI framework, architecture, or internal conventions.',
    'Before asking technical follow-up questions, infer as much as possible from the brief, project context, and repository signals that the eventual worker can verify.',
    'When technical details are likely discoverable from the repository or relevant documentation, prefer assumptions for the worker to validate instead of asking the user.',
    'Reserve user questions for product intent, preferences, business context, or ambiguity that cannot be resolved from the brief, project context, repository investigation, or relevant documentation.',
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
    '  "questions": ["string"],',
    '  "interactiveQuestions": [',
    '    {',
    '      "id": "string",',
    '      "label": "string",',
    '      "helperText": "string",',
    '      "responseType": "single | multi | text",',
    '      "options": [{ "id": "string", "label": "string", "description": "string" }],',
    '      "allowsOther": true,',
    '      "otherPlaceholder": "string",',
    '      "inputPlaceholder": "string",',
    '      "required": true',
    '    }',
    '  ]',
    '}',
    'For interactiveQuestions:',
    '- Generate 0 to 4 questions only when they materially improve the final prompt.',
    '- Choose the responseType that best fits each question.',
    '- Use single when one answer should be chosen, multi when multiple answers may apply, and text when custom wording is better.',
    '- When responseType is single or multi, provide 2 to 6 concise, context-aware options.',
    '- Do not include an explicit Other option inside options. The UI will add it automatically. Set allowsOther to true for every question.',
    '- Use helperText to explain why the question matters.',
    '- Use inputPlaceholder for text questions and for the custom Other path when a hint would help.',
    '- Keep questions grounded in the brief and project context instead of generic discovery forms.',
    '- Do not ask what stack, library, framework, UI system, or architecture the project uses when that is discoverable from repository evidence or project context.',
    '- Prefer product, preference, business-rule, or unresolved-ambiguity questions over technical stack discovery.',
    '- The plain questions array must mirror the interactive question labels for backward compatibility.',
  ]

  if (payload.projectContext) {
    systemLines.push(
      '',
      buildProjectContextBlock(payload.projectContext),
      '',
      'Use the project context above to better understand the user\'s intent.',
      'Reference the project\'s tech stack, current branch, and open tasks when relevant.',
      'Skip questions that are already answered by the project context or are normally discoverable from the repository and relevant docs (e.g. do not ask about the stack if it is listed above or can be inferred there).',
    )
  }

  const system = systemLines.join('\n')
  const user = JSON.stringify(payload, null, 2)

  return { instructions: system, input: user }
}

export function buildGenerateRequest(payload: PromptPayload): PromptRequest {
  const wantsDirectPrompt =
    isPromptDeliverableRequest(payload) && !isPromptArtifactImplementationRequest(payload)
  const isPromptArtifactTask = isPromptArtifactImplementationRequest(payload)
  const directPromptLanguage = inferPromptDeliverableLanguage(payload)
  const systemLines = [
    'You are an Intent-to-Prompt Compiler.',
    'The user already reviewed the task intent.',
    wantsDirectPrompt
      ? 'Your current task is Phase 2 only: generate the final deliverable prompt itself, ready to paste into the target agent.'
      : 'Your current task is Phase 2 only: generate one strong final prompt in English.',
    'Return JSON only. No markdown fences.',
    wantsDirectPrompt
      ? 'This is a prompt-authoring or agent-instruction task. The finalPrompt field must contain the actual final prompt/instruction block itself.'
      : 'Do not execute the task itself. Generate prompts for another AI to execute.',
    'Use this JSON shape exactly:',
    '{',
    '  "finalPrompt": "string"',
    '}',
    'Generate only one final prompt, not multiple versions.',
    'The final prompt should be detailed, execution-ready, and optimized for the best possible output by another AI.',
    wantsDirectPrompt
      ? 'The final prompt must be the exact instructions that the end worker should receive, with no extra wrapper around it.'
      : 'The final prompt must read like a direct brief to another AI worker.',
    'Treat userCorrections as the latest authoritative answers from the clarification flow. They override earlier assumptions or open questions.',
    'It must describe the actual task to be done, not the act of rewriting or understanding the user\'s request.',
    "Do not use meta language such as 'Transform the user's rough intent', 'the user wants', 'prompt compiler', or similar phrasing.",
    "Bad output: a prompt about clarifying, organizing, or improving the user's request.",
    'Good output: a prompt that directly tells another AI what to build, debug, refactor, write, or plan, with concrete context, constraints, and deliverables.',
    'If the request is software-related, assume the target AI can inspect a codebase, compare existing implementations, and make changes.',
    'When the request is software-related, make repository investigation the default technical discovery path: codebase first, documentation second, user questions last.',
    'When the request is software-related, assume the user may not know the project stack, libraries, UI framework, architecture, or internal conventions.',
    'When the request is software-related, the final prompt should tell the worker to inspect relevant manifests, lockfiles, build or framework config, app entrypoints, component structure, routing, API clients, styles, tests, and docs when those sources matter.',
    'When the request is software-related, the final prompt should reserve user questions for product intent, preferences, business context, or ambiguity that remains unresolved after repository and documentation research.',
    'Do not generate prompts that ask the user which technology the project uses when the repository can answer it.',
    'When repo names, product names, file paths, or existing systems are mentioned, include them concretely in the final prompt.',
    'Include the sections Role, Objective, Context, Constraints, Technical Details, Expected Output, Acceptance Criteria, Avoid, and Clarification Rule when they apply.',
  ]

  if (wantsDirectPrompt) {
    systemLines.push(
      `The deliverable language should be ${directPromptLanguage}.`,
      'Flatten one nesting level. Do not output a prompt that asks another AI to create, improve, rewrite, or design the prompt you are supposed to deliver.',
      "Bad output: 'Create a prompt that tells an agent to inspect the repository first.'",
      "Good output: the actual final instructions beginning directly with what the target agent must do.",
      'Do not force Role/Objective/Context headings if a direct instruction block is more natural and immediately usable.'
    )
  }

  if (isPromptArtifactTask) {
    systemLines.push(
      'The user is not asking for prompt engineering in the abstract. They want a coding agent to update prompt or instruction artifacts that live inside the repository.',
      'Treat this as a normal repository implementation task focused on prompt-related files, templates, config, or system-instruction artifacts.',
      'Do not frame the final prompt as "write a prompt about" or "create a prompt that" when the real task is to inspect the repo and modify the relevant files directly.',
      'The final prompt should tell the worker agent to inspect the codebase, locate the current prompt/instruction artifact, consult relevant documentation if repository evidence is incomplete, edit it in place, validate the change, and report the touched files.'
    )
  }

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
  const sanitizedInteractiveQuestions = sanitizeInteractiveQuestions(
    parsed.interactiveQuestions,
    payload,
    parsed.questions,
    fallback.interactiveQuestions
  )
  const interactiveQuestions = applyTechnicalDiscoveryQuestionPolicy(
    sanitizedInteractiveQuestions,
    fallback.interactiveQuestions,
    payload
  )
  const questionLabels = applyTechnicalDiscoveryLabelPolicy(
    [...cleanList(parsed.questions), ...interactiveQuestions.map((question) => question.label)],
    fallback.questions,
    payload
  )

  return {
    understanding: cleanString(parsed.understanding as string) || fallback.understanding,
    objective: preferList(parsed.objective as string[], fallback.objective),
    context: preferList(parsed.context as string[], fallback.context),
    constraints: preferList(parsed.constraints as string[], fallback.constraints),
    assumptions: preferList(parsed.assumptions as string[], fallback.assumptions),
    confirmationPrompt:
      cleanString(parsed.confirmationPrompt as string) ||
      'Confirma esse entendimento antes de eu gerar o prompt final?',
    questions: questionLabels.length ? questionLabels : fallback.questions,
    interactiveQuestions,
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
      'Se houver impacto em codigo, o sistema deve priorizar seguranca contra regressao, investigar a codebase antes de pedir detalhes tecnicos e consultar documentacao relevante quando necessario.'
    )
  }

  const questions: string[] = []

  if (!looksLikeSelfContainedBrief(payload.originalBrief)) {
    questions.push(
      'Qual e o contexto maior dessa tarefa? Projeto existente, ideia nova, produto interno ou outro?'
    )
  }

  if (!hasConstraintSignals(payload.originalBrief)) {
    questions.push(
      'Existe alguma restricao importante de escopo, estilo, prazo ou comportamento que o prompt final precisa preservar?'
    )
  }

  const interactiveQuestions = buildInteractiveQuestionsFromLegacy(questions, payload)

  return {
    understanding: `Entendi que voce quer transformar um pedido ainda informal em um prompt final muito mais claro, estruturado e executavel para uma ${modeLabel}.`,
    objective: [
      `Capturar a intencao real por tras do briefing: "${payload.originalBrief.trim()}"`,
      'Explicitar contexto, restricoes e criterio de sucesso antes de gerar o prompt final.',
    ],
    context,
    constraints: ['Preservar a intencao original do usuario sem inventar detalhes.'],
    assumptions,
    confirmationPrompt: 'Confirma esse entendimento ou quer corrigir algum ponto antes de gerar o prompt final?',
    questions: interactiveQuestions.length ? interactiveQuestions.map((question) => question.label) : questions,
    interactiveQuestions,
  }
}

export function buildGenerationFallback(payload: PromptPayload): GenerationResult {
  const clarification = payload.clarification || buildClarificationFallback(payload)

  if (isPromptDeliverableRequest(payload) && !isPromptArtifactImplementationRequest(payload)) {
    return {
      finalPrompt: buildDirectPromptDeliverableFallback(payload, clarification),
    }
  }

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
    'Clarification Rule\nIf a critical detail is missing, inspect the relevant codebase first and consult project or official documentation next. Ask concise clarification questions only for product decisions, preferences, business context, or ambiguities that remain unresolved after that research. Do not invent concrete facts.',
  ].join('\n\n')

  return { finalPrompt }
}

function buildDirectPromptDeliverableFallback(
  payload: PromptPayload,
  clarification: ClarificationResult
): string {
  const language = inferPromptDeliverableLanguage(payload)
  const project = payload.projectContext
  const correctionBullets = extractCorrectionBullets(payload.userCorrections)
  const contextBullets = uniqueList([...cleanList(clarification.context), ...correctionBullets])
  const constraintBullets = uniqueList([
    ...cleanList(clarification.constraints),
    ...extractInlineConstraints(payload.originalBrief),
    ...extractInlineConstraints(payload.userCorrections),
  ])
  const avoidQuestions = shouldStronglyAvoidQuestions(payload)
  const languageIsPortuguese = language === 'Portuguese (Brazil)'

  const lines: string[] = []

  if (languageIsPortuguese) {
    if (project) {
      lines.push(
        `Voce esta trabalhando no projeto ${project.projectName} em ${project.projectPath}${project.gitBranch ? ` na branch ${project.gitBranch}` : ''}.`
      )
    } else {
      lines.push('Voce vai executar esta tarefa com base no contexto confirmado abaixo.')
    }

    lines.push('')
    lines.push('Siga estas instrucoes:')

    const directives = [
      'Entregue diretamente o prompt ou bloco de instrucoes final, pronto para uso, sem explicar como ele foi construido.',
      'Transforme o pedido em instrucoes operacionais para o agente final, e nao em um prompt que pede para outro modelo escrever esse prompt.',
      'Assuma que o usuario pode nao saber stack, bibliotecas, framework de UI, arquitetura ou convencoes internas do projeto.',
      project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
        ? 'Antes de assumir detalhes tecnicos, inspecione a codebase, os arquivos relevantes e as implementacoes existentes.'
        : 'Antes de assumir detalhes, use primeiro o contexto confirmado neste briefing e preserve a intencao original do usuario.',
      project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
        ? 'Use o repositorio como fonte principal de verdade para stack, arquitetura, bibliotecas, convencoes, fluxos e restricoes tecnicas.'
        : 'Nao invente fatos que nao estejam sustentados pelo contexto fornecido.',
      project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
        ? 'Investigue manifestos, lockfiles, configs de build ou framework, entrypoints, estrutura de componentes, rotas, clientes de API, estilos, testes e docs do projeto quando isso ajudar a resolver a tarefa.'
        : 'Apoie-se no contexto confirmado e em sinais concretos do pedido antes de preencher lacunas.',
      'Trate as respostas confirmadas pelo usuario como instrucoes prioritarias.',
      project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
        ? 'Quando a analise local nao bastar, pesquise documentacao oficial e fontes confiaveis antes de depender do usuario.'
        : 'Quando faltar contexto essencial, preserve a melhor interpretacao possivel sem perder a direcao pedida pelo usuario.',
      avoidQuestions
        ? 'Nao faca perguntas de descoberta tecnica ao usuario quando isso puder ser resolvido pela analise do repositorio, pelo contexto ja confirmado ou por pesquisa objetiva. So considere perguntar algo se restar uma decisao de produto, preferencia ou ambiguidade genuinamente irresolvida.'
        : 'Reserve perguntas ao usuario para decisoes de produto, preferencias, contexto de negocio ou ambiguidades que permanecam irresolvidas apos analisar repositorio e documentacao.',
    ]

    for (const item of uniqueList(directives)) {
      lines.push(`- ${item}`)
    }

    if (contextBullets.length) {
      lines.push('')
      lines.push('Contexto confirmado:')
      for (const item of contextBullets) {
        lines.push(`- ${item}`)
      }
    }

    if (constraintBullets.length) {
      lines.push('')
      lines.push('Restricoes obrigatorias:')
      for (const item of constraintBullets) {
        lines.push(`- ${item}`)
      }
    }

    if (project?.memories.length) {
      lines.push('')
      lines.push('Regras e memorias do projeto que devem ser respeitadas:')
      for (const memory of project.memories.slice(0, 3)) {
        const snippet = memory.snippet.length > 160 ? memory.snippet.slice(0, 160) + '...' : memory.snippet
        lines.push(`- ${memory.name}: ${snippet}`)
      }
    }

    lines.push('')
    lines.push(
      avoidQuestions
        ? 'Se ainda restar alguma ambiguidade, resolva primeiro pelo melhor caminho baseado em evidencia antes de considerar qualquer pergunta ao usuario.'
        : 'Se ainda restar alguma ambiguidade critica, valide apenas o ponto de produto, preferencia ou contexto que nao deu para resolver pela codebase e pela documentacao.'
    )

    return lines.join('\n')
  }

  if (project) {
    lines.push(
      `You are working in project ${project.projectName} at ${project.projectPath}${project.gitBranch ? ` on branch ${project.gitBranch}` : ''}.`
    )
  } else {
    lines.push('Execute this task using the confirmed context below.')
  }

  lines.push('')
  lines.push('Follow these instructions:')

  const directives = [
    'Deliver the final prompt or instruction block itself, ready to use, without explaining how it was created.',
    'Flatten the nesting level and write the actual instructions for the end worker instead of asking another model to write them.',
    'Assume the user may not know the project stack, libraries, UI framework, architecture, or internal conventions.',
    project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
      ? 'Inspect the codebase, relevant files, and existing implementations before assuming technical details.'
      : 'Use the confirmed context first and preserve the user\'s original intent.',
    project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
      ? 'Use the repository as the main source of truth for stack, architecture, libraries, conventions, flows, and constraints.'
      : 'Do not invent unsupported facts.',
    project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
      ? 'Investigate manifests, lockfiles, build or framework config, entrypoints, component structure, routing, API clients, styles, tests, and project docs when those sources help answer the task.'
      : 'Rely on the confirmed context and concrete signals from the brief before filling any gaps.',
    'Treat the user\'s confirmed answers as authoritative instructions.',
    project || payload.taskMode === 'coding' || payload.taskMode === 'refactor' || payload.taskMode === 'debug'
      ? 'If repository evidence is not enough, research official documentation and reliable sources before depending on the user.'
      : 'If essential context is still missing, preserve the strongest reasonable interpretation without drifting away from the requested outcome.',
    avoidQuestions
      ? 'Do not ask the user technical discovery questions when the answer can be inferred from the repository, the confirmed context, or focused research. Only consider asking if a product decision, preference, or genuine ambiguity remains unresolved.'
      : 'Reserve user questions for product decisions, preferences, business context, or ambiguities that remain unresolved after repository and documentation research.',
  ]

  for (const item of uniqueList(directives)) {
    lines.push(`- ${item}`)
  }

  if (contextBullets.length) {
    lines.push('')
    lines.push('Confirmed context:')
    for (const item of contextBullets) {
      lines.push(`- ${item}`)
    }
  }

  if (constraintBullets.length) {
    lines.push('')
    lines.push('Mandatory constraints:')
    for (const item of constraintBullets) {
      lines.push(`- ${item}`)
    }
  }

  lines.push('')
  lines.push(
    avoidQuestions
      ? 'If any ambiguity remains, resolve it through the strongest evidence-based path before considering a user question.'
      : 'If a critical ambiguity remains, validate only the product, preference, or business-context gap that could not be resolved from the codebase and documentation before acting.'
  )

  return lines.join('\n')
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

function isPromptDeliverableRequest(payload: PromptPayload): boolean {
  const text = collectPayloadText(payload)

  return [
    /(?:criar|escrever|redigir|ajustar|melhorar|atualizar|refinar|definir|montar|gerar|produzir|reescrever).{0,40}(?:prompt base|base prompt|prompt inicial|prompt do agente|system prompt|mensagem de sistema|instru(?:coes|ções) do agente|orienta(?:cao|ção) inicial|template de prompt|politica do agente|policy prompt|prompt de sistema)/i,
    /(?:prompt base|base prompt|prompt inicial|prompt do agente|system prompt|mensagem de sistema|instru(?:coes|ções) do agente|orienta(?:cao|ção) inicial|template de prompt|politica do agente|policy prompt|prompt de sistema).{0,40}(?:criar|escrever|redigir|ajustar|melhorar|atualizar|refinar|definir|montar|gerar|produzir|reescrever)/i,
    /prompt\s*\/\s*orienta(?:cao|ção)\s+inicial/i,
    /(?:prompt|instru(?:coes|ções)|orienta(?:cao|ção)).{0,24}(?:do agente|da ia|do assistant|do claude|do codex|do gemini)/i,
  ].some((pattern) => pattern.test(text))
}

function isPromptArtifactImplementationRequest(payload: PromptPayload): boolean {
  const text = collectPayloadText(payload)

  if (!isPromptDeliverableRequest(payload)) {
    return false
  }

  return [
    /(?:editar|alterar|atualizar|ajustar|reescrever|aplicar|mudar|modificar|revisar|refatorar).{0,40}(?:arquivo|arquivos|repo|repositorio|repositório|codebase|codigo|código|template|templates|config|configuracao|configuração|artifact|artefato)/i,
    /(?:arquivo|arquivos|repo|repositorio|repositório|codebase|codigo|código|template|templates|config|configuracao|configuração|artifact|artefato).{0,40}(?:editar|alterar|atualizar|ajustar|reescrever|aplicar|mudar|modificar|revisar|refatorar)/i,
    /(?:localizar|encontrar|procurar|inspecionar).{0,40}(?:prompt|instru(?:coes|ções)|template|artefato|arquivo)/i,
    /(?:branch|caminho|path|memory\.md|version bump|electron\/package\.json|arquivos foram alterados|files were changed)/i,
  ].some((pattern) => pattern.test(text))
}

function inferPromptDeliverableLanguage(payload: PromptPayload): 'Portuguese (Brazil)' | 'English' {
  const text = collectPayloadText(payload)

  if (/(portugues|português|pt-br|pt br|brazilian portuguese|portuguese brazil)/i.test(text)) {
    return 'Portuguese (Brazil)'
  }

  if (/(english|ingles|inglês|in english)/i.test(text)) {
    return 'English'
  }

  return looksLikePortuguese(text) ? 'Portuguese (Brazil)' : 'English'
}

function shouldStronglyAvoidQuestions(payload: PromptPayload): boolean {
  const text = collectPayloadText(payload)

  return /(nao pergunte|não pergunte|sem perguntas|nao fazer perguntas|não fazer perguntas|evite perguntas|nenhuma pergunta|do not ask|avoid asking|without asking)/i.test(
    text
  )
}

function extractCorrectionBullets(text: string): string[] {
  return cleanString(text)
    .split('\n')
    .map((item) => item.replace(/^-\s*/, '').trim())
    .filter((item) => item && !/^respostas guiadas confirmadas pelo usuario:?$/i.test(item))
}

function collectPayloadText(payload: PromptPayload): string {
  return [
    payload.originalBrief,
    payload.userCorrections,
    payload.clarification?.understanding,
    ...(payload.clarification?.objective || []),
    ...(payload.clarification?.context || []),
    ...(payload.clarification?.constraints || []),
  ]
    .filter(Boolean)
    .join('\n')
}

function applyTechnicalDiscoveryQuestionPolicy(
  questions: PromptInteractiveQuestion[],
  fallbackQuestions: PromptInteractiveQuestion[],
  payload: PromptPayload
): PromptInteractiveQuestion[] {
  const filterQuestions = (items: PromptInteractiveQuestion[]) =>
    items.filter((question) => !shouldSuppressTechnicalDiscoveryQuestion(question.label, payload))

  const filtered = filterQuestions(questions)
  if (filtered.length) return filtered.slice(0, 4)

  return filterQuestions(fallbackQuestions).slice(0, 4)
}

function applyTechnicalDiscoveryLabelPolicy(
  labels: string[],
  fallbackLabels: string[],
  payload: PromptPayload
): string[] {
  const filterLabels = (items: string[]) =>
    uniqueList(items).filter((label) => !shouldSuppressTechnicalDiscoveryQuestion(label, payload))

  const filtered = filterLabels(labels)
  if (filtered.length) return filtered

  return filterLabels(fallbackLabels)
}

function shouldSuppressTechnicalDiscoveryQuestion(label: string, payload: PromptPayload): boolean {
  if (!shouldPreferRepositoryDiscovery(payload)) return false

  return /(stack|tecnolog|technology|framework|frameworks|linguagem|language|biblioteca|bibliotecas|library|libraries|arquitetura|architecture|ui\b|design system|sistema de design|frontend|backend|css framework)/i.test(
    cleanString(label)
  )
}

function shouldPreferRepositoryDiscovery(payload: PromptPayload): boolean {
  if (payload.projectContext) return true

  return /(repo|repositorio|repositório|codebase|monorepo|arquivo|arquivos|path|caminho|branch|projeto existente|existing project|existing product|existing system|sistema existente)/i.test(
    collectPayloadText(payload)
  )
}

function looksLikePortuguese(text: string): boolean {
  return /(voce|você|quero|preciso|para|projeto|tarefa|codigo|código|agente|melhorar|ajustar|sem |com |nao |não )/i.test(
    text
  )
}

function sanitizeInteractiveQuestions(
  value: unknown,
  payload: PromptPayload,
  legacyQuestions: unknown,
  fallbackQuestions: PromptInteractiveQuestion[]
): PromptInteractiveQuestion[] {
  const normalized = Array.isArray(value)
    ? value
        .map((question, index) => normalizeInteractiveQuestion(question, index, payload))
        .filter((question): question is PromptInteractiveQuestion => question !== null)
    : []

  if (normalized.length) {
    return normalized.slice(0, 4)
  }

  const fromLegacy = buildInteractiveQuestionsFromLegacy(cleanList(legacyQuestions), payload)
  if (fromLegacy.length) {
    return fromLegacy.slice(0, 4)
  }

  return fallbackQuestions.slice(0, 4)
}

function normalizeInteractiveQuestion(
  value: unknown,
  index: number,
  payload: PromptPayload
): PromptInteractiveQuestion | null {
  if (!value || typeof value !== 'object') return null

  const question = value as Record<string, unknown>
  const label =
    cleanString(question.label) ||
    cleanString(question.title) ||
    cleanString(question.question) ||
    cleanString(question.prompt)

  if (!label) return null

  const initialOptions = sanitizeQuestionOptions(question.options)
  const responseType = inferQuestionResponseType(question.responseType, initialOptions, label)
  const inferredOptions =
    responseType === 'text' || initialOptions.length
      ? initialOptions
      : inferOptionsFromQuestion(label, payload, responseType)
  const normalizedType =
    responseType !== 'text' && inferredOptions.length === 0 ? 'text' : responseType

  return {
    id: cleanId(cleanString(question.id)) || buildQuestionId(label, index),
    label,
    helperText: cleanString(question.helperText) || inferHelperText(label, normalizedType),
    responseType: normalizedType,
    options: normalizedType === 'text' ? [] : inferredOptions,
    allowsOther: true,
    otherPlaceholder:
      cleanString(question.otherPlaceholder) || inferOtherPlaceholder(label, normalizedType),
    inputPlaceholder:
      cleanString(question.inputPlaceholder) || inferInputPlaceholder(label, normalizedType),
    required: typeof question.required === 'boolean' ? question.required : true,
  }
}

function sanitizeQuestionOptions(value: unknown): PromptQuestionOption[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const options: PromptQuestionOption[] = []

  for (const [index, item] of value.entries()) {
    const option = normalizeQuestionOption(item, index)
    if (!option) continue

    const key = option.id || option.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push(option)
  }

  return options.slice(0, 6)
}

function normalizeQuestionOption(value: unknown, index: number): PromptQuestionOption | null {
  if (typeof value === 'string') {
    const label = cleanString(value)
    return label
      ? {
          id: cleanId(label) || `option-${index + 1}`,
          label,
        }
      : null
  }

  if (!value || typeof value !== 'object') return null

  const option = value as Record<string, unknown>
  const label =
    cleanString(option.label) ||
    cleanString(option.title) ||
    cleanString(option.value) ||
    cleanString(option.name)

  if (!label) return null

  return {
    id: cleanId(cleanString(option.id)) || cleanId(label) || `option-${index + 1}`,
    label,
    description:
      cleanString(option.description) || cleanString(option.helperText) || cleanString(option.note),
  }
}

function buildInteractiveQuestionsFromLegacy(
  questions: string[],
  payload: PromptPayload
): PromptInteractiveQuestion[] {
  return uniqueList(questions)
    .slice(0, 4)
    .map((label, index) => {
      const responseType = inferQuestionResponseType('', [], label)
      const options =
        responseType === 'text' ? [] : inferOptionsFromQuestion(label, payload, responseType)
      const normalizedType = responseType !== 'text' && options.length === 0 ? 'text' : responseType

      return {
        id: buildQuestionId(label, index),
        label,
        helperText: inferHelperText(label, normalizedType),
        responseType: normalizedType,
        options: normalizedType === 'text' ? [] : options,
        allowsOther: true,
        otherPlaceholder: inferOtherPlaceholder(label, normalizedType),
        inputPlaceholder: inferInputPlaceholder(label, normalizedType),
        required: true,
      }
    })
}

function inferQuestionResponseType(
  candidate: unknown,
  options: PromptQuestionOption[],
  label: string
): PromptQuestionResponseType {
  const normalized = cleanString(candidate).toLowerCase()
  if (normalized === 'single' || normalized === 'multi' || normalized === 'text') {
    if (normalized === 'text') return normalized
    return options.length ? normalized : inferQuestionResponseType('', options, label)
  }

  if (!options.length) {
    if (/(restri|escopo|prioridade|criterio|preserv|comportamento|resultado|entreg)/i.test(label)) {
      return 'multi'
    }

    if (/(qual|em que|contexto maior|tipo de iniciativa|tipo de projeto|ambiente)/i.test(label)) {
      return 'single'
    }

    if (/(stack|tecnolog|framework|linguagem)/i.test(label)) {
      return 'multi'
    }

    return 'text'
  }

  if (/(quais|mais de uma|marque|selecione|restri|criterio|prioridade)/i.test(label)) {
    return 'multi'
  }

  return 'single'
}

function inferOptionsFromQuestion(
  label: string,
  payload: PromptPayload,
  responseType: PromptQuestionResponseType
): PromptQuestionOption[] {
  if (responseType === 'text') return []

  if (/(contexto maior|tipo de iniciativa|tipo de projeto|ambiente)/i.test(label)) {
    return [
      makeOption('existing-product', 'Produto existente', 'Ha um sistema ou fluxo real para respeitar.'),
      makeOption('new-feature', 'Nova funcionalidade', 'Evolucao de algo que ja existe.'),
      makeOption('internal-tool', 'Ferramenta interna', 'Uso interno, menos foco comercial.'),
      makeOption('exploration', 'Exploracao', 'Ainda estou validando direcao e escopo.'),
    ]
  }

  if (/(stack|tecnolog|framework|linguagem)/i.test(label)) {
    const stackOptions = payload.projectContext?.techStack.length
      ? payload.projectContext.techStack.map((tech) => makeOption(tech, tech))
      : [
          makeOption('react', 'React'),
          makeOption('nextjs', 'Next.js'),
          makeOption('typescript', 'TypeScript'),
          makeOption('node', 'Node.js'),
          makeOption('python', 'Python'),
        ]

    return stackOptions.slice(0, 6)
  }

  if (/(restri|preserv|comportamento|escopo|criterio|prioridade)/i.test(label)) {
    return [
      makeOption('preserve-layout', 'Manter layout', 'Nao mexer no visual principal.'),
      makeOption('preserve-behavior', 'Preservar comportamento', 'Evitar mudancas funcionais.'),
      makeOption('limit-scope', 'Escopo contido', 'Resolver sem abrir frentes paralelas.'),
      makeOption('avoid-dependencies', 'Sem novas dependencias', 'Preferir a stack atual.'),
      makeOption('explicit-validation', 'Validacao clara', 'Incluir testes ou verificacoes objetivas.'),
    ]
  }

  if (/(entreg|saida|formato)/i.test(label)) {
    return [
      makeOption('implementation', 'Implementacao pronta'),
      makeOption('plan', 'Plano detalhado'),
      makeOption('diagnosis', 'Diagnostico guiado'),
      makeOption('checklist', 'Checklist executavel'),
    ]
  }

  return []
}

function inferHelperText(label: string, responseType: PromptQuestionResponseType): string {
  if (responseType === 'multi') {
    return 'Marque o que realmente precisa entrar no prompt final. Pode combinar opcoes.'
  }

  if (responseType === 'single') {
    return 'Escolha o caminho que melhor representa essa lacuna do briefing.'
  }

  if (/(stack|tecnolog|framework|linguagem)/i.test(label)) {
    return 'Se tiver algo especifico em mente, escreva do jeito mais concreto possivel.'
  }

  return 'Responda com o contexto minimo que deixaria o prompt final mais confiavel.'
}

function inferOtherPlaceholder(label: string, responseType: PromptQuestionResponseType): string {
  if (responseType === 'multi') {
    return `Algo fora da lista sobre "${label}"`
  }

  return `Escreva uma resposta customizada para "${label}"`
}

function inferInputPlaceholder(label: string, responseType: PromptQuestionResponseType): string {
  if (responseType === 'text') {
    return `Responda aqui: ${label}`
  }

  if (/(stack|tecnolog|framework|linguagem)/i.test(label)) {
    return 'Ex.: Next.js 15, TypeScript, Electron, API Node...'
  }

  return responseType === 'multi'
    ? 'Descreva algo importante que nao entrou nas opcoes.'
    : 'Escreva a resposta que faz mais sentido para este caso.'
}

function buildQuestionId(label: string, index: number): string {
  return cleanId(label) || `question-${index + 1}`
}

function cleanId(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function makeOption(id: string, label: string, description?: string): PromptQuestionOption {
  return {
    id: cleanId(id) || cleanId(label) || 'option',
    label,
    description,
  }
}

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
      'Assume the user may not know the stack, libraries, UI framework, architecture, or internal conventions, so discover them from the repository first.'
    )
    items.push(
      'Inspect manifests, lockfiles, build or framework config, entrypoints, routing, components, API clients, styles, tests, and docs whenever they help answer the implementation question.'
    )
    items.push(
      'If repository evidence is incomplete, consult relevant project or official documentation before escalating unresolved technical ambiguity to the user.'
    )
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

function hasConstraintSignals(text: string): boolean {
  return /(sem |nao |não |preserv|manter|evitar|sem quebrar|without|must|deve|precisa)/i.test(
    cleanString(text)
  )
}
