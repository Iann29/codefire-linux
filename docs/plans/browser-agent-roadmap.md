# CodeFire Browser Agent Roadmap (V1)

**Status:** Em andamento
**Data:** 2026-03-07
**Escopo:** Somente Electron (`electron/src/...`)
**Referencia:** Portar padroes do `amage-ai-browser-agent` (Chrome Extension) para Electron webview context.

## Atualizacao de Progresso (2026-03-07)

- Implementado runtime de agente no `main process` com IPC (`agent:start`, `agent:cancel`, `agent:status`).
- Implementado `BrowserBridge` com IPC direto (`browser:execute` / `browser:result:<requestId>`).
- BrowserView atualizado para executar comandos no caminho novo (mantendo compatibilidade com legado).
- `CodeFireChat` integrado ao runtime novo, com cancelamento de run e fallback para runtime legado.
- Plan enforcement base implementado (`set_plan`, `update_plan`, bloqueio sem plano, exigencia de verificacao apos acao de browser).
- UI inicial de plano implementada no chat (`PlanRail`).
- Feature flag `agentRuntimeV2` implementada em config + Settings.
- Settings do Agent V2 expandidos (max tool calls, temperature, plan enforcement, context compaction) e conectados ao runtime.
- Tools indexadas adicionais implementadas: `browser_select_element`, `browser_hover_element`, `browser_scroll_to_element`.

## Objetivo

Transformar o browser do CodeFire em um agente confiavel para tarefas reais na web, com:

- loop de agente no `main process`;
- browser tools por IPC direto (sem polling no banco);
- interacao por indice de elemento (`dom map`);
- typing/click robustos para apps modernas (nuclear engine portado do amage);
- controle de plano (plan enforcement);
- compaction de contexto para conversas longas (portado do amage);
- toolkit avancado de tabs, wait, extracao e input.

## Baseline Atual

- O loop de tool calling roda no renderer em `electron/src/renderer/components/Chat/CodeFireChat.tsx`.
- Comandos de browser passam por `chat:browserCommand` em `electron/src/main/ipc/chat-handlers.ts`.
- A execucao de browser depende de polling na tabela `browserCommands` via `electron/src/main/services/BrowserCommandExecutor.ts`.
- O renderer executa comandos em `electron/src/renderer/views/BrowserView.tsx` via canal `browser:commandRequest`.

## Principios

- Manter separacao `main/preload/renderer`.
- Fazer migracao gradual com feature flag.
- Priorizar latencia, previsibilidade e recuperacao de erro.
- Medir antes/depois para evitar regressao silenciosa.
- Portar do amage sempre que possivel em vez de reimplementar do zero.

## Fase 0 - Fundacao e Guardrails

**Meta:** preparar observabilidade e rollout seguro antes da migracao pesada.

- [x] Criar flag `agentRuntimeV2` em settings/config.
- [x] Logar tempo de cada tool call (`start`, `end`, `durationMs`, `status`).
- [ ] Definir metricas base (latencia media de tool browser, taxa de erro por tool, cancelamentos e timeouts).
- [ ] Adicionar smoke test de chat agent atual para comparar comportamento.

**Criterios de aceite**

- Flag habilita/desabilita runtime novo sem quebrar chat atual.
- Existe baseline numerico para comparar fases seguintes.

## Fase 1 - Agent Runtime no Main Process

**Meta:** tirar loop do renderer e centralizar orquestracao no `main`.

- [x] Criar `electron/src/main/services/AgentService.ts` com `startRun(conversationId, userMessage, settings)`, `cancelRun(runId)`, limite de tool calls por run e persistencia de mensagens no banco.
- [x] Criar `electron/src/main/ipc/agent-handlers.ts` com `agent:start`, `agent:cancel`, `agent:status` e eventos `agent:stream`, `agent:toolStart`, `agent:toolResult`, `agent:done`, `agent:error`.
- [x] Registrar handlers (feito em `electron/src/main/index.ts` durante init deferido).
- [ ] Adaptar `electron/src/renderer/components/Chat/CodeFireChat.tsx` para virar cliente de eventos do runtime, remover loop de tool calling do renderer e manter UI/historico (parcial: cliente de eventos pronto, fallback legado ainda existe).
- [ ] Adicionar retry engine no `requestCompletion` (backoff exponencial com jitter para 429/5xx, portado de `amage/ai/retry-engine.ts`).
- [ ] Adicionar XML tool call recovery (fallback parsing quando modelo retorna tool calls em XML em vez de structured output).
- [ ] Enhanced system prompt: injetar URL atual da webview + contexto de navegacao no system prompt a cada iteracao do loop.

**Criterios de aceite**

- Recarregar renderer nao mata run em andamento.
- Cancelamento interrompe stream e tools em andamento.
- Historico de mensagens permanece consistente.
- Retry automatico em erros transientes (429, 5xx) sem travar o run.

## Fase 2 - Browser Bridge via IPC Direto

**Meta:** remover dependencia de `browserCommands` polling para execucao online.

- [x] Criar `electron/src/main/services/BrowserBridge.ts` com request/response por `requestId`.
- [x] Definir novos canais `browser:execute` e `browser:result:<requestId>`.
- [x] Atualizar `electron/src/renderer/views/BrowserView.tsx` para escutar `browser:execute` e responder resultado.
- [x] Integrar browser tools do `AgentService` ao `BrowserBridge`.
- [x] Manter fallback temporario para caminho antigo com flag.
- [x] Remover uso de `chat:browserCommand` no fluxo novo.

**Criterios de aceite**

- Latencia tool->resultado cai para alvo < 50ms (sem navegacao pesada).
- Timeout e erro de webview indisponivel retornam mensagem clara.

## Fase 3 - DOM Map Indexado

**Meta:** substituir seletores frageis por mapeamento de elementos indexados.

- [ ] Extrair logica de DOM crawling para `electron/src/main/browser/dom-map.ts` (atualmente inline no BrowserView).
- [x] Criar tool `browser_dom_map` no `AgentService`.
- [x] Criar tools indexadas: `browser_click_element(index)`, `browser_type_element(index, text)`, `browser_select_element(index, value)`, `browser_hover_element(index)`, `browser_scroll_to_element(index)` e `browser_get_element_info(index)`.
- [x] Limitar snapshot para controle de tokens (max 500 elementos, texto truncado e somente elementos visiveis/interativos).

**Criterios de aceite**

- Agente consegue completar fluxo de formulario sem usar CSS selector manual.
- Quando o DOM muda, erro orienta recrawl (`browser_dom_map`) de forma explicita.

## Fase 4 - Nuclear Interaction Engine (portar do amage)

**Meta:** melhorar confiabilidade em apps com editores complexos. Portar `amage/tools/nuclear-interaction-engine.ts` adaptando de `chrome.scripting.executeScript` para `webContents.executeJavaScript` do Electron.

### nuclearType

- [ ] Portar `NUCLEAR_TYPE_SCRIPT` para `electron/src/main/browser/nuclear-type.ts`.
- [ ] Adaptar execucao: Chrome `chrome.scripting.executeScript` -> Electron `webContents.executeJavaScript`.
- [ ] Manter as 6 estrategias de typing com auto-detect:
  - `keyboard` (keydown -> beforeinput -> input -> keyup, char-by-char com delay human-like)
  - `execCommand` (insertText — Draft.js, Quill, CKEditor)
  - `inputEvent` (InputEvent com insertText — Lexical, ProseMirror)
  - `clipboard` (paste simulado — fallback universal)
  - `nativeSetter` (React nativeInputValueSetter — `<input>`/`<textarea>`)
  - `direct` (DOM manipulation — ultimo recurso)
- [ ] Portar `detectEditorFramework` (Draft.js, Lexical, ProseMirror, Slate, Tiptap, Quill, CKEditor, Monaco, CodeMirror).
- [ ] Portar `findEditableChild` (deep discovery do elemento editavel real dentro de containers complexos).
- [ ] Portar `activateEditor` (click + focus + FocusEvent + PointerEvent + caret placement).
- [ ] Portar `clearContent` (select all + execCommand delete + fallback nativeSetter).
- [ ] Portar `verifyTextInserted` (match exato -> normalizado -> parcial 60% com cleanup de zero-width chars).
- [ ] Expor opcoes: `clearFirst`, `pressEnter`, `charDelay`, `strategy` (`auto` por padrao).

### nuclearClick

- [ ] Portar `NUCLEAR_CLICK_SCRIPT` para `electron/src/main/browser/nuclear-click.ts`.
- [ ] Manter as 5 estrategias de click:
  - Full pointer+mouse event chain com coordenadas
  - Native `el.click()`
  - `elementFromPoint` (pega o elemento real atras de overlays/portals)
  - Dispatch em coordenadas no target real
  - Ancestor interativo mais proximo
- [ ] Portar log de tentativas (`attempts` array com method + success).

### Integracao

- [ ] Registrar tools `browser_nuclear_type` e `browser_nuclear_click` no `AgentService`.
- [ ] Fazer tools indexadas existentes (`browser_click_element`, `browser_type_element`) usarem nuclear engine como fallback automatico quando a estrategia simples falhar.

**Criterios de aceite**

- Taxa de sucesso de typing > 90% em editores ricos (Draft.js, Lexical, ProseMirror, contenteditable generico).
- Taxa de sucesso de click > 90% em elementos com overlays, React portals e listeners sinteticos.
- Fallback automatico entre estrategias ocorre sem travar o run.
- `verifyTextInserted` confirma sucesso apos cada typing.

## Fase 5 - Plan Enforcement

**Meta:** impedir execucao desorganizada de browser actions.

- [x] Adicionar estado de plano no `AgentService` (`currentPlan`, `awaitingVerification`, `lastBrowserAction`).
- [x] Criar tools `set_plan({ steps })` e `update_plan({ stepIndex, status })`.
- [x] Aplicar enforcer no prompt: sem plano ativo bloquear browser action e exigir `set_plan`; apos action exigir verificacao antes de avancar.
- [x] Criar UI de plano no chat com `electron/src/renderer/components/Chat/PlanRail.tsx` (novo) e integrar ao `CodeFireChat.tsx`.

**Criterios de aceite**

- Toda run com browser tools inicia com plano explicito.
- Usuario ve progresso de steps em tempo real.

## Fase 6 - Context Compaction (portar do amage)

**Meta:** suportar conversas longas sem estourar janela de contexto. Portar `amage/ai/compaction.ts` adaptando para o `AgentService`.

### Token Estimation

- [ ] Portar `estimateTokens` para `electron/src/main/services/TokenEstimator.ts`:
  - Texto: `length / 4`
  - Imagens: 1200 tokens por imagem
  - Tool calls: `JSON.stringify(toolCalls).length / 4`
  - Thinking: `thinking.length / 4`
- [ ] Portar `estimateContextTokens` com suporte a usage real do ultimo assistant (usa `totalTokens` do response quando disponivel, estima trailing).

### Compaction Logic

- [ ] Portar `shouldCompact` para `electron/src/main/services/ContextCompactor.ts`:
  - Settings: `reserveTokens: 16384`, `keepRecentTokens: 20000` (defaults do amage).
  - Trigger: `contextTokens > contextLimit - reserveTokens`.
- [ ] Portar `findCutPoint` com binary search + suffix sums:
  - Nunca cortar no meio de tool result (`isValidCutPoint`).
  - Preservar `keepRecentTokens` do final.
- [ ] Portar `serializeConversation` para preparar mensagens para summarization.

### Summarization via LLM

- [ ] Portar `SUMMARIZATION_PROMPT` (formato estruturado: Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context).
- [ ] Portar `UPDATE_SUMMARIZATION_PROMPT` para compaction incremental (preserva info anterior + adiciona nova).
- [ ] Implementar chamada LLM de summarization no `AgentService` (request extra ao OpenRouter com modelo leve, ex: `anthropic/claude-haiku`).
- [ ] Portar `buildCompactionSummaryMessage` e `applyCompaction` (monta system message com summary + mensagens preservadas).

### Integracao

- [ ] Chamar compaction no loop do `AgentService` apos cada iteracao (checar antes de cada `requestCompletion`).
- [ ] Emitir evento `agent:compacted` para UI com summary, trimmedCount, preservedCount e contextUsage.
- [ ] Ajustar limites por modelo (com fallback padrao sensato).
- [ ] Adicionar indicador de compaction na UI do chat.

**Criterios de aceite**

- Runs longas continuam executando sem erro de contexto.
- Summary preserva objetivo, progresso e proximos passos.
- Compaction e transparente: usuario ve quando acontece e o que foi resumido.

## Fase 7 - Toolkit Avancado e Hardening (portar do amage)

**Meta:** fechar gaps de produtividade e seguranca. Portar tools do `amage/tools/browser-tools.ts`.

### Tab Management

- [ ] `browser_open_tab(url)` — com limite de session tabs (MAX_SESSION_TABS=5 do amage).
- [ ] `browser_close_tab(tabId)`.
- [ ] `browser_switch_tab(tabId)`.
- [ ] `browser_list_tabs` — lista tabs abertos com titulo e URL.

### Wait Tools

- [ ] `browser_wait_element(selector, options)` — polling 150ms, timeout 5s, states: `attached`/`detached`/`visible`/`hidden`.
- [ ] `browser_wait_navigation(strategy)` — strategies: `load`/`networkidle`/`urlchange`, timeout 10s.

### Extraction Tools

- [ ] `browser_extract_table(selector)` — retorna JSON com headers/rows.
- [ ] `browser_get_content(mode)` — modes: `text`/`html`/`title`/`url`/`links`/`meta`.
- [ ] `browser_evaluate_js(expression)` — executa expressao JS e retorna resultado.

### Input Tools

- [ ] `browser_press_key(key, modifiers)` — teclas especiais (Enter, Tab, Escape, arrows, Ctrl+A, etc).
- [ ] `browser_fill_form(fields)` — preenche multiplos campos de formulario de uma vez.
- [ ] `browser_drag_and_drop(sourceIndex, targetIndex)`.

### Seguranca

- [ ] Whitelist/allowlist de dominio por projeto.
- [ ] Bloqueio de dominios sensiveis por default.
- [ ] Confirmacao opcional para acoes destrutivas.

### Testes

- [ ] Testes automatizados de regressao para fluxo completo de browser agent.

**Criterios de aceite**

- Toolkit cobre navegacao, interacao, espera e extracao.
- Tabs funcionam com limite de sessao (previne runaway).
- Existe suite minima de regressao para fluxo end-to-end.

## Ordem Recomendada

1. Fase 0 (metricas pendentes) e Fase 1 (remover loop legado + retry engine).
2. Fase 3 (extrair dom-map.ts).
3. Fase 4 (nuclear engine — portar do amage).
4. Fase 6 (context compaction — portar do amage).
5. Fase 7 (toolkit avancado — portar do amage).
6. Fase 0 smoke tests + Fase 7 testes de regressao.

Fases 2 e 5 ja estao completas.

## Riscos e Mitigacoes

- Risco: quebra de compatibilidade com chat atual.
- Mitigacao: feature flag + rollout gradual.
- Risco: eventos IPC sem resposta (webview morta).
- Mitigacao: timeout por tool + erro estruturado + retry controlado.
- Risco: custo de tokens subir com snapshots.
- Mitigacao: `browser_dom_map` compacto + compaction.
- Risco: falso positivo de sucesso em typing/click.
- Mitigacao: verificacao pos-acao (`verifyTextInserted`) e fallback de estrategia.
- Risco: erros transientes da API (429, rate limit, 5xx).
- Mitigacao: retry engine com backoff exponencial + jitter.
- Risco: modelo retorna tool calls em formato inesperado (XML).
- Mitigacao: XML tool call recovery como fallback de parsing.
- Risco: diferenca de API entre Chrome Extension e Electron webview.
- Mitigacao: adaptar `chrome.scripting.executeScript` -> `webContents.executeJavaScript` com testes isolados por engine.

## Definition of Done (V1)

- Runtime do agente roda no `main process`.
- Browser tools usam IPC direto, sem polling para caminho principal.
- Agente opera por DOM indexado com click/type robustos (nuclear engine).
- Plan enforcement e context compaction ativos.
- Toolkit avancado cobre tabs, wait, extracao e input.
- Retry engine e XML recovery protegem contra falhas transientes.
- Metricas e testes de regressao comprovam estabilidade basica.
