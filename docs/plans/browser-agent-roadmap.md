# CodeFire Browser Agent Roadmap (V1)

**Status:** COMPLETO (V1)
**Data:** 2026-03-07
**Escopo:** Somente Electron (`electron/src/...`)
**Referencia:** Portar padroes do `amage-ai-browser-agent` (Chrome Extension) para Electron webview context.

## Atualizacao de Progresso (2026-03-07)

### Completo
- Fase 0: Feature flag `agentRuntimeV2` + logging de tool calls + smoke tests (TokenEstimator, ContextCompactor, dom-map, nuclear-click, nuclear-type) + metricas base (AgentMetrics: latencia por tool, error rate, timeouts, run stats).
- Fase 1: Runtime de agente no `main process` + retry engine + XML recovery + enhanced system prompt + remoção completa do loop legado do renderer (~470 linhas removidas, renderer é agora cliente de eventos puro).
- Fase 2: `BrowserBridge` com IPC direto.
- Fase 3: DOM map indexado com tools indexadas.
- Fase 4: Nuclear interaction engine — `browser_nuclear_type` (6 estrategias + auto-detect + verify) + `browser_nuclear_click` (4 estrategias com fallback). Scripts em `electron/src/main/browser/`. Handlers no BrowserView.
- Fase 5: Plan enforcement (`set_plan`, `update_plan`, verificacao, PlanRail UI).
- Fase 6: Context compaction (TokenEstimator + ContextCompactor + LLM summarization + evento `agent:compacted` + indicador visual no chat UI).
- Fase 7: Segurança — domain whitelist/blocklist, DEFAULT_BLOCKED_DOMAINS, validação de URL, UI de Allowed Domains em Settings, confirmação opcional para ações destrutivas (DESTRUCTIVE_BROWSER_TOOLS + requestConfirmation IPC + Allow/Deny UI no chat + toggle browserConfirmDestructive em Settings).
- Provider adapter layer + BYOS OAuth engine (vide `byos-subscriptions.md`).
- BYOS Phase 4 (parcial): dropdown de subscription providers no Settings, SubscriptionProviderPanel com OAuth connect/disconnect.

### Pendente
- (nenhum item pendente — roadmap V1 completo)

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
- [x] Definir metricas base (latencia media de tool browser, taxa de erro por tool, cancelamentos e timeouts) — implementado em `AgentMetrics.ts`.
- [x] Adicionar smoke test de chat agent atual para comparar comportamento.

**Criterios de aceite**

- Flag habilita/desabilita runtime novo sem quebrar chat atual.
- Existe baseline numerico para comparar fases seguintes.

## Fase 1 - Agent Runtime no Main Process

**Meta:** tirar loop do renderer e centralizar orquestracao no `main`.

- [x] Criar `electron/src/main/services/AgentService.ts` com `startRun(conversationId, userMessage, settings)`, `cancelRun(runId)`, limite de tool calls por run e persistencia de mensagens no banco.
- [x] Criar `electron/src/main/ipc/agent-handlers.ts` com `agent:start`, `agent:cancel`, `agent:status` e eventos `agent:stream`, `agent:toolStart`, `agent:toolResult`, `agent:done`, `agent:error`.
- [x] Registrar handlers (feito em `electron/src/main/index.ts` durante init deferido).
- [x] Adaptar `electron/src/renderer/components/Chat/CodeFireChat.tsx` para virar cliente de eventos do runtime, remover loop de tool calling do renderer e manter UI/historico. Removidos ~470 linhas de codigo legado: `AGENT_TOOLS` array, `executeToolCall`, `handleAgentModeLegacy`, `ToolCall` interface, estados `agentRuntimeV2Enabled`/`projectPath`.
- [x] Adicionar retry engine no `chatCompletionWithRetry` (backoff exponencial com jitter para 429/5xx/502/503/504, max 3 tentativas).
- [x] Adicionar XML tool call recovery (`recoverToolCallsFromXML`) — fallback parsing para `<tool_call>`, `<function_call>`, `<tool_use>` XML patterns.
- [x] Enhanced system prompt: `getBrowserContext()` injeta URL + titulo da pagina atual da webview no system prompt a cada iteracao do loop.

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

- [x] Extrair logica de DOM crawling para `electron/src/main/browser/dom-map.ts` — `buildDomMapScript()` gera script auto-contido injetavel via `executeJavaScript`.
- [x] Criar tool `browser_dom_map` no `AgentService`.
- [x] Criar tools indexadas: `browser_click_element(index)`, `browser_type_element(index, text)`, `browser_select_element(index, value)`, `browser_hover_element(index)`, `browser_scroll_to_element(index)` e `browser_get_element_info(index)`.
- [x] Limitar snapshot para controle de tokens (max 500 elementos, texto truncado e somente elementos visiveis/interativos).

**Criterios de aceite**

- Agente consegue completar fluxo de formulario sem usar CSS selector manual.
- Quando o DOM muda, erro orienta recrawl (`browser_dom_map`) de forma explicita.

## Fase 4 - Nuclear Interaction Engine (portar do amage) [DONE]

**Meta:** melhorar confiabilidade em apps com editores complexos. Portar `amage/tools/nuclear-interaction-engine.ts` adaptando de `chrome.scripting.executeScript` para `webContents.executeJavaScript` do Electron.

### nuclearType

- [x] Portar `NUCLEAR_TYPE_SCRIPT` para `electron/src/main/browser/nuclear-type.ts`.
- [x] Adaptar execucao: Chrome `chrome.scripting.executeScript` -> Electron `webContents.executeJavaScript`.
- [x] Manter as 6 estrategias de typing com auto-detect:
  - `keyboard` (keydown -> beforeinput -> input -> keyup, char-by-char com delay human-like)
  - `execCommand` (insertText — Draft.js, Quill, CKEditor)
  - `inputEvent` (InputEvent com insertText — Lexical, ProseMirror)
  - `clipboard` (paste simulado — fallback universal)
  - `nativeSetter` (React nativeInputValueSetter — `<input>`/`<textarea>`)
  - `direct` (DOM manipulation — ultimo recurso)
- [x] Portar `detectEditorFramework` (Draft.js, Lexical, ProseMirror, Slate, Tiptap, Quill, CKEditor, Monaco, CodeMirror).
- [x] Portar `findEditableChild` (deep discovery do elemento editavel real dentro de containers complexos).
- [x] Portar `activateEditor` (click + focus + FocusEvent + PointerEvent + caret placement).
- [x] Portar `clearContent` (select all + execCommand delete + fallback nativeSetter).
- [x] Portar `verifyTextInserted` (match exato -> normalizado -> parcial 60% com cleanup de zero-width chars).
- [x] Expor opcoes: `clearFirst`, `pressEnter`, `charDelay`, `strategy` (`auto` por padrao).

### nuclearClick

- [x] Portar `NUCLEAR_CLICK_SCRIPT` para `electron/src/main/browser/nuclear-click.ts`.
- [x] Manter as 5 estrategias de click:
  - Full pointer+mouse event chain com coordenadas
  - Native `el.click()`
  - `elementFromPoint` (pega o elemento real atras de overlays/portals)
  - Dispatch em coordenadas no target real
  - Ancestor interativo mais proximo
- [x] Portar log de tentativas (`attempts` array com method + success).

### Integracao

- [x] Registrar tools `browser_nuclear_type` e `browser_nuclear_click` no `AgentService`.
- [x] Handlers no `BrowserView.tsx` com scripts inline injetados via `executeJavaScript`.

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

## Fase 6 - Context Compaction (portar do amage) [DONE]

**Meta:** suportar conversas longas sem estourar janela de contexto. Portar `amage/ai/compaction.ts` adaptando para o `AgentService`.

### Token Estimation

- [x] Portar `estimateTokens` para `electron/src/main/services/TokenEstimator.ts`:
  - `estimateTokens(text)`: `length / 4`
  - `estimateMessageTokens(msg)`: text + images (1200/img) + tool_calls + overhead
  - `estimateContextTokens(messages)`: soma de todos os messages

### Compaction Logic

- [x] Criar `electron/src/main/services/ContextCompactor.ts`:
  - `shouldCompact(messages, config)`: trigger quando `tokens > limit - reserve` (defaults: limit=128k, reserve=16k).
  - `findCutPoint(messages, config)`: binary search com suffix sums, nunca corta tool results, preserva keepRecentTokens (20k).
  - `serializeForSummary(messages)`: serializa com role labels, trunca content longo, formata tool calls/results.

### Summarization via LLM

- [x] `buildSummarizationPrompt(serialized)`: formato estruturado Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context.
- [x] Suporte a compaction incremental (UPDATE prompt quando ja existe summary anterior).
- [x] Chamada LLM de summarization no loop do AgentService (usa mesmo provider/model, temperature 0.3).
- [x] `applyCompaction(messages, summary, cutPoint)`: system msg + summary user/assistant + mensagens preservadas.

### Integracao

- [x] Compaction integrada no loop do `AgentService.executeRun()` — apos cada batch de tool results.
- [x] Evento `agent:compacted` emitido com trimmedCount, preservedCount, contextUsage {before, after, limit}.
- [x] Feature flag via `run.contextCompaction` (config `agentContextCompaction`).
- [x] Adicionar indicador de compaction na UI do chat (pendente para Fase UI).

**Criterios de aceite**

- [x] Runs longas continuam executando sem erro de contexto.
- [x] Summary preserva objetivo, progresso e proximos passos.
- [x] Compaction e transparente via evento `agent:compacted`.

## Fase 7 - Toolkit Avancado e Hardening (portar do amage) [DONE — exceto testes e2e]

**Meta:** fechar gaps de produtividade e seguranca. Portar tools do `amage/tools/browser-tools.ts`.

### Tab Management

- [x] `browser_open_tab(url)` — com limite de session tabs (MAX_SESSION_TABS=5).
- [x] `browser_close_tab(tabId)`.
- [x] `browser_switch_tab(tabId)`.
- [x] `browser_list_tabs` — lista tabs abertos com titulo e URL.

### Wait Tools

- [x] `browser_wait_element(selector, options)` — polling 150ms, timeout 5s, states: `attached`/`detached`/`visible`/`hidden`.
- [x] `browser_wait_navigation(strategy)` — strategies: `load`/`networkidle`/`urlchange`, timeout 10s.

### Extraction Tools

- [x] `browser_extract_table(selector)` — retorna JSON com headers/rows (max 200 rows).
- [x] `browser_get_content(mode)` — modes: `text`/`html`/`title`/`url`/`links`/`meta`.
- [x] `browser_evaluate_js(expression)` — ja existia como `browser_eval`.

### Input Tools

- [x] `browser_press_key(key, modifiers)` — teclas especiais + modifiers (Control, Shift, Alt, Meta).
- [x] `browser_fill_form(fields)` — preenche multiplos campos usando nativeSetter + events. Suporta input/textarea/contenteditable.
- [x] `browser_drag_and_drop(sourceIndex, targetIndex)` — simula drag via DragEvent chain (dragstart → dragenter → dragover → drop → dragend).

### Seguranca

- [x] Whitelist/allowlist de dominio por projeto.
- [x] Bloqueio de dominios sensiveis por default.
- [x] Confirmacao opcional para acoes destrutivas (`DESTRUCTIVE_BROWSER_TOOLS`, `requestConfirmation()` IPC, Allow/Deny UI, toggle `browserConfirmDestructive` em Settings).

### Testes

- [x] Testes automatizados de regressao para fluxo completo de browser agent (64 testes em `browser-agent-e2e.test.ts`: AgentMetrics, domain security, ContextCompactor integration, constantes).

**Criterios de aceite**

- [x] Toolkit cobre navegacao, interacao, espera e extracao.
- [x] Tabs funcionam com limite de sessao (previne runaway).
- [x] Existe suite minima de regressao para fluxo end-to-end (86 testes: 22 smoke + 64 e2e).

## Ordem Recomendada

1. ~~Fase 0 (flag + logging + smoke tests + metricas base)~~ — DONE
2. ~~Fase 1 (runtime main process + retry + XML recovery + remoção loop legado)~~ — DONE
3. ~~Fase 2 (BrowserBridge IPC direto)~~ — DONE
4. ~~Fase 3 (DOM map indexado)~~ — DONE
5. ~~Fase 4 (nuclear engine — portar do amage)~~ — DONE
6. ~~Fase 5 (plan enforcement)~~ — DONE
7. ~~Fase 6 (context compaction + indicador UI)~~ — DONE
8. ~~Fase 7 (toolkit avançado + segurança + confirmação destrutiva)~~ — DONE (exceto testes e2e)
9. ~~Fase 7: testes automatizados de regressão e2e~~ — DONE (86 testes)

**ROADMAP V1 COMPLETO.** Todas as fases implementadas e testadas.

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
