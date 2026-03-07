# CodeFire BYOS — Bring Your Own Subscription

**Status:** Fases 1-3 implementadas, Fases 4-5 pendentes
**Data:** 2026-03-07
**Escopo:** Somente Electron (`electron/src/...`)
**Dependencia:** Browser Agent Roadmap (Fase 1 — AgentService funcional)

## Objetivo

Permitir que usuarios usem suas assinaturas existentes de IA (Claude Pro/Max, ChatGPT Plus/Pro, Gemini Advanced, Kimi, etc.) como engine do agente CodeFire, sem precisar comprar API keys separadas. Tudo embutido no app — sem dependencia de binarios externos.

## Contexto

### O problema

- Usuarios pagam $20-200/mes por assinaturas (Claude Max, ChatGPT Pro, etc.)
- Essas assinaturas sao restritas aos apps oficiais (claude.ai, chatgpt.com)
- Para usar via API precisa pagar separado (pay-per-token), que e caro
- OpenRouter tambem cobra por token

### A solucao

Implementar um **provider adapter embutido** no main process do Electron que:

- Faz OAuth flow nativo via BrowserWindow (Electron ja e um browser)
- Armazena tokens com seguranca via `safeStorage` do Electron
- Traduz requests do AgentService para o formato nativo de cada provider
- Gerencia token refresh automaticamente
- Suporta streaming, function calling e multimodal

### Arquitetura

```
AgentService.requestCompletion()
  |
  v
ProviderRouter (resolve provider + credenciais)
  |
  ├─ OpenRouterAdapter (API key — modo atual)
  ├─ ClaudeSubscriptionAdapter (OAuth token da assinatura Claude Pro/Max)
  ├─ OpenAISubscriptionAdapter (OAuth token da assinatura ChatGPT Plus/Pro)
  ├─ GeminiSubscriptionAdapter (OAuth token da assinatura Gemini Advanced)
  ├─ KimiSubscriptionAdapter (OAuth token da assinatura Kimi)
  └─ CustomEndpointAdapter (endpoint OpenAI-compatible generico)
  |
  v
Provider API (Anthropic, OpenAI, Google, Moonshot, etc.)
  |
  v
ProviderRouter normaliza response para formato interno
  |
  v
AgentService processa response normalmente
```

### Vantagem sobre proxy externo

- Zero dependencias externas (sem CLIProxyAPI, sem Go binary)
- OAuth flow nativo no Electron (BrowserWindow)
- Tokens protegidos por `safeStorage` (keychain do OS)
- Menos latencia (sem hop extra via localhost)
- Controle total sobre retry, fallback e error handling
- Atualiza com o app, sem gerenciar binario separado

### Referencia

O CLIProxyAPI (Go, 13k+ stars) e os proxies como `claude-code-proxy` validam que o approach funciona. A diferenca e que implementamos direto no Electron em vez de rodar um servidor separado.

Fontes de referencia para os OAuth flows:
- Claude OAuth: mesmo flow do Claude Code CLI (`claude-code-proxy` documenta o flow standalone)
- OpenAI/Codex OAuth: flow do Codex CLI
- Gemini OAuth: flow do Gemini CLI
- Kimi: API compativel com Anthropic, requer header `User-Agent: claude-code/1.0`

## Fase 1 — Provider Adapter Layer [DONE]

**Meta:** abstrair o AgentService do provider especifico. Hoje esta hardcoded pro OpenRouter.

### ProviderRouter

- [x] Criar `electron/src/main/services/providers/ProviderRouter.ts`:
  - `resolveProvider(config)` — retorna o adapter correto baseado na config.
  - `chatCompletion(messages, tools, options)` — interface unificada.
  - `listModels()` — lista modelos disponiveis no provider ativo.
  - `healthCheck()` — verifica se o provider esta acessivel.
  - `setOAuthEngine(engine)` — injeta OAuthEngine para subscription providers.

### Interface base

- [x] Criar `electron/src/main/services/providers/BaseProvider.ts`:
  - `ProviderAdapter`, `ChatCompletionRequest/Response`, `ModelInfo`, `ProviderHealth`

### OpenRouter adapter (migrar logica atual)

- [x] Criar `electron/src/main/services/providers/OpenRouterAdapter.ts`:
  - Extrair logica de `AgentService.requestCompletion` para este adapter.
  - Manter compatibilidade total com o fluxo atual.
  - Auth: API key (como hoje).

### Custom Endpoint adapter

- [x] Criar `electron/src/main/services/providers/CustomEndpointAdapter.ts`:
  - Compativel com qualquer endpoint OpenAI-compatible.
  - Auth: API key + base URL configuravel.
  - Descoberta de modelos via `GET /v1/models`.
  - Funciona com CLIProxyAPI, LiteLLM, Ollama, LM Studio, etc.

### Refactor do AgentService

- [x] Refatorar `AgentService` para usar `ProviderRouter` em vez de fetch direto.
- [x] Manter mesma interface externa (IPC channels nao mudam).
- [x] Adicionar campo `provider` no config (`openrouter` | `claude-subscription` | `openai-subscription` | `gemini-subscription` | `kimi-subscription` | `custom`).
- [x] `setProviderRouter(router)` — permite injetar router compartilhado com OAuthEngine.

**Criterios de aceite**

- [x] AgentService funciona identico ao atual com OpenRouter (sem regressao).
- [x] Custom endpoint funciona com qualquer servidor OpenAI-compatible.
- [x] Novo provider pode ser adicionado implementando `ProviderAdapter`.

## Fase 2 — OAuth Engine + Token Storage [DONE]

**Meta:** Implementar o motor de OAuth que permite autenticar com assinaturas existentes.

### OAuth Flow Manager

- [x] Criar `electron/src/main/services/providers/OAuthEngine.ts`:
  - `startOAuthFlow(providerId)` — abre BrowserWindow + servidor HTTP local (porta 19485).
  - Captura callback via servidor HTTP em vez de webRequest (mais confiavel).
  - `exchangeCodeForTokens(code, codeVerifier)` — troca code por tokens via PKCE.
  - `refreshToken(providerId)` — renova access_token expirado.
  - `getValidToken(providerId)` — retorna token valido, refreshing se necessario.
  - `revokeTokens(providerId)` — remove tokens do storage.
  - `fetchProfile(config, token)` — busca email/nome da conta apos auth.

### Token Storage seguro

- [x] Criar `electron/src/main/services/providers/TokenStore.ts`:
  - `safeStorage.encryptString()` / `decryptString()` do Electron.
  - Persistencia em `~/.config/CodeFire/tokens.enc.json` com permissao `0o600`.
  - Schema: `{ accessToken, refreshToken, expiresAt, scope, accountEmail, accountName, providerId, createdAt }`.
  - Auto-refresh: buffer de 5min antes de expirar.
  - Cache em memoria + fallback base64 quando safeStorage indisponivel.

### OAuth configs por provider

- [x] Criar `electron/src/main/services/providers/oauth-configs.ts`:
  - Claude: PKCE OAuth via `console.anthropic.com`, client_id extraido do Claude Code CLI.
  - OpenAI: Auth0 PKCE via `auth.openai.com`, client_id extraido do Codex CLI.
  - Gemini: Google OAuth 2.0 via `accounts.google.com`, client_id extraido do Gemini CLI.
  - Kimi: API key (sem OAuth), endpoint `api.kimi.com/coding/v1`.
  - Registries: `OAUTH_PROVIDERS`, `ALL_SUBSCRIPTION_PROVIDERS`.

### BrowserWindow para OAuth

- [x] Janela dedicada 520x720, sem toolbar, autoHideMenuBar.
- [x] Servidor HTTP local na porta 19485 para callback.
- [x] Pagina de callback HTML estilizada (sucesso/erro), auto-close em 2s.
- [x] Timeout de 5min.
- [x] Suporte PKCE (code_challenge S256).

### IPC

- [x] `provider:startOAuth` — inicia OAuth flow para um provider.
- [x] `provider:listAccounts` — lista contas conectadas com status.
- [x] `provider:removeAccount` — desconecta e revoga tokens.
- [x] `provider:healthCheck` — status do provider ativo (ja existia da Fase 1).
- [x] `provider:listModels` — modelos do provider ativo (ja existia da Fase 1).

**Criterios de aceite**

- [x] OAuth flow abre BrowserWindow nativo (sem browser externo).
- [x] Tokens armazenados encriptados via `safeStorage`.
- [x] Token refresh automatico via `getValidToken()`.
- [x] Revogar tokens limpa storage e cache.

## Fase 3 — Subscription Adapters [DONE]

**Meta:** Implementar os adapters que traduzem requests do AgentService para cada provider usando OAuth tokens.

### Claude Subscription Adapter

- [x] Criar `electron/src/main/services/providers/ClaudeSubscriptionAdapter.ts`:
  - Endpoint: `https://api.anthropic.com/v1/messages` com OAuth token.
  - Auth header: `Authorization: Bearer ${oauthAccessToken}`.
  - Usa `openaiToAnthropic()` / `anthropicToOpenai()` para traducao de formatos.
  - Modelos: Sonnet 4, Haiku 4, Opus 4.

### OpenAI Subscription Adapter

- [x] Criar `electron/src/main/services/providers/OpenAISubscriptionAdapter.ts`:
  - Endpoint: `https://api.openai.com/v1/chat/completions` com OAuth token.
  - Request format: OpenAI nativo (zero traducao).
  - `listModels()` busca modelos reais via `GET /v1/models` e filtra chat models.
  - Modelos default: GPT-5.4, GPT-4.1, o3, o4-mini.

### Gemini Subscription Adapter

- [x] Criar `electron/src/main/services/providers/GeminiSubscriptionAdapter.ts`:
  - Endpoint: `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`.
  - Usa `openaiToGemini()` / `geminiToOpenai()` para traducao de formatos.
  - `listModels()` busca modelos reais via API e filtra por `generateContent`.
  - Modelos default: Gemini 2.5 Pro, 2.0 Flash, 2.5 Flash.

### Kimi Adapter

- [x] Criar `electron/src/main/services/providers/KimiAdapter.ts`:
  - Endpoint: `https://api.kimi.com/coding/v1/messages`.
  - Usa `openaiToAnthropic()` / `anthropicToOpenai()` (compativel Anthropic).
  - Headers: `x-api-key`, `User-Agent: claude-code/1.0`, `anthropic-version`.
  - Auth: API key (sem OAuth).

### Traducao de formatos

- [x] Criar `electron/src/main/services/providers/format-translators.ts`:
  - `openaiToAnthropic(request)` — system prompt separado, messages alternados, tool_calls → tool_use blocks, tool results → user tool_result blocks.
  - `anthropicToOpenai(response)` — text + tool_use blocks → choices[0].message com content + tool_calls.
  - `openaiToGemini(request)` — system → systemInstruction, messages → contents com parts, tool_calls → functionCall, tool results → functionResponse.
  - `geminiToOpenai(response)` — candidates → choices, functionCall → tool_calls, text → content.
  - `stripProviderPrefix(model)` — remove prefixo `provider/` para APIs nativas.
  - Merge de mensagens consecutivas (requisito Anthropic/Gemini).

### Wiring no ProviderRouter

- [x] Todos os 4 subscription providers conectados no `resolveProvider()` switch.
- [x] `AgentService.setProviderRouter(router)` recebe router compartilhado com OAuthEngine.
- [x] Inicializacao em `index.ts`: `agentService.setProviderRouter(providerRouter)`.

**Criterios de aceite**

- [x] Claude adapter traduz OpenAI ↔ Anthropic Messages API com tool calling.
- [x] OpenAI adapter usa formato nativo (zero traducao).
- [x] Gemini adapter traduz OpenAI ↔ Gemini GenerativeLanguage com functionCall.
- [x] Kimi adapter usa formato Anthropic com API key + User-Agent.
- [x] Build compila sem erros com todos os adapters.

## Fase 4 — UI de Contas e Onboarding

**Meta:** Experiencia de usuario fluida para conectar assinaturas.

### Settings > Providers

- [ ] Redesenhar secao "Engine" em Settings para suportar multiplos providers:
  - Lista de providers com cards:
    - Logo do provider.
    - Status: conectado/desconectado/expirado/erro.
    - Modelo ativo.
    - Tier da assinatura (Pro/Max/Plus quando detectavel).
    - Botao "Connect" / "Disconnect".
  - Provider ativo selecionavel (qual usar no agente).
  - Fallback configuravel (ex: se Claude falhar, usar OpenRouter).

### Connected Accounts

- [ ] Mostrar info da conta apos OAuth:
  - Email/nome da conta.
  - Tier da assinatura.
  - Ultimo uso / status do token.
- [ ] Notificacao quando token expira e nao consegue renovar.
- [ ] Botao "Re-authenticate" para refazer OAuth flow.

### Onboarding / Wizard

- [ ] Tela de primeiro uso ou quando nenhum provider esta configurado:
  - "Choose how to connect to AI":
    - "Use your subscription" → lista providers com botao Connect (OAuth flow).
    - "Use API key" → campo de API key do OpenRouter (modo atual).
    - "Use custom endpoint" → URL + key (Ollama, LM Studio, etc.).
- [ ] Indicador visual no chat quando usando subscription vs API key.

### Model Selector

- [ ] Dropdown de modelo no chat que mostra so modelos disponiveis no provider ativo.
- [ ] Agrupado por provider quando multiplos estao conectados.
- [ ] Indicador de capability (suporta tools, vision, streaming).

**Criterios de aceite**

- Usuario conecta assinatura em 2 cliques (botao Connect → OAuth → pronto).
- Status de conexao sempre visivel.
- Troca de provider/modelo e imediata.

## Fase 5 — Multi-Account, Routing e Resiliencia

**Meta:** Suportar multiplas contas e roteamento inteligente entre providers.

### Multi-Account

- [ ] Suportar multiplas contas do mesmo provider (ex: 2 contas Claude Max).
- [ ] Round-robin entre contas para distribuir rate limits.
- [ ] UI para gerenciar multiplas contas por provider.

### Provider Routing

- [ ] Fallback automatico: se provider primario retornar 429/5xx, tentar proximo.
- [ ] Configuracao de preferencia por modelo:
  - "Para Opus use Claude Max"
  - "Para modelos rapidos use OpenRouter"
  - "Para modelos locais use Ollama"
- [ ] Model aliases: `best` → Opus (Claude Max), `fast` → Haiku (Claude Max), `cheap` → GPT-4o-mini (OpenRouter).

### Rate Limit Awareness

- [ ] Detectar rate limit headers dos providers (Retry-After, x-ratelimit-*).
- [ ] Mostrar rate limit usage na UI quando disponivel.
- [ ] Auto-switch para proximo provider/conta quando rate limited.
- [ ] Cooldown timer visivel: "Claude Max rate limited — switching to OpenRouter (back in ~2min)".

### Resiliencia

- [ ] Retry com backoff para erros transientes (429, 5xx, network errors).
- [ ] Circuit breaker: se provider falhar N vezes consecutivas, desabilitar temporariamente.
- [ ] Logging estruturado: provider usado, latencia, tokens, erros (para debug).

**Criterios de aceite**

- Multiplas contas funcionam com round-robin transparente.
- Fallback entre providers e automatico e visivel na UI.
- Rate limiting nao trava o agente — faz switch automatico.

## Impacto no AgentService [IMPLEMENTADO]

Refactor aplicado em `AgentService.ts`:

```typescript
// AgentService.executeRun() — IMPLEMENTADO
const provider = this.providerRouter.resolveProvider(config, { apiKey: input.apiKey })
const response = await provider.chatCompletion({
  model, temperature, messages: loopMessages,
  tools: AGENT_TOOLS, signal: run.abortController.signal,
})
// response ja vem normalizado — tool_calls, content, usage
```

- `setProviderRouter(router)` permite injetar router compartilhado (com OAuthEngine).
- `providerRouter` nao e mais `readonly` — pode ser substituido apos construcao.
- O resto do loop (tool execution, plan enforcement, context compaction) nao mudou.

## Estrutura de arquivos [TODOS IMPLEMENTADOS]

```
electron/src/main/services/providers/
  BaseProvider.ts              — interfaces: ProviderAdapter, ChatCompletionRequest/Response, ModelInfo, ProviderHealth
  ProviderRouter.ts            — resolve provider por config, cache, setOAuthEngine()
  OAuthEngine.ts               — OAuth flows via BrowserWindow + HTTP callback server
  TokenStore.ts                — storage seguro de tokens (safeStorage + arquivo .enc.json)
  oauth-configs.ts             — configs OAuth por provider (URLs, client_ids, scopes, registries)
  format-translators.ts        — openaiToAnthropic, anthropicToOpenai, openaiToGemini, geminiToOpenai
  OpenRouterAdapter.ts         — API key OpenRouter (modo original)
  CustomEndpointAdapter.ts     — endpoint generico OpenAI-compatible (Ollama, LM Studio, etc.)
  ClaudeSubscriptionAdapter.ts — assinatura Claude via OAuth + Anthropic Messages API
  OpenAISubscriptionAdapter.ts — assinatura ChatGPT via OAuth + OpenAI Chat Completions API
  GeminiSubscriptionAdapter.ts — assinatura Gemini via OAuth + Generative Language API
  KimiAdapter.ts               — API key Kimi + Anthropic-compatible API
```

## Ordem Recomendada

1. ~~**Fase 1** (provider adapter layer)~~ — DONE
2. ~~**Fase 2** (OAuth engine + token storage)~~ — DONE
3. ~~**Fase 3** (subscription adapters)~~ — DONE
4. **Fase 4** (UI de contas) — experiencia de usuario polida. PROXIMO.
5. **Fase 5** (multi-account + routing) — power users e resiliencia.

## Riscos e Mitigacoes

- Risco: Providers bloqueiam OAuth tokens usados fora dos CLIs oficiais.
  - Mitigacao: usar mesmos client_ids e user-agents dos CLIs oficiais (Claude Code, Codex, Gemini CLI). Manter OpenRouter como fallback sempre disponivel.
- Risco: OAuth flows mudam sem aviso.
  - Mitigacao: monitorar repos dos CLIs oficiais. Isolar configs OAuth em arquivo separado para update rapido.
- Risco: Token refresh falha silenciosamente.
  - Mitigacao: health check periodico + notificacao na UI + re-auth automatico.
- Risco: Rate limits da assinatura sao mais restritivos que API.
  - Mitigacao: multi-account round-robin + fallback para OpenRouter + cooldown visivel.
- Risco: Diferenca de API format entre providers (Anthropic != OpenAI != Gemini).
  - Mitigacao: format-translators dedicados com testes unitarios por provider.
- Risco: Streaming format diferente entre providers.
  - Mitigacao: cada adapter normaliza seu SSE format para o formato interno antes de retornar.

## Referencia

- CLIProxyAPI: `github.com/router-for-me/CLIProxyAPI` (13k+ stars, referencia de OAuth flows)
- claude-code-proxy: `github.com/horselock/claude-code-proxy` (standalone OAuth para Claude)
- codex-claude-proxy: `github.com/Ayush-Kotlin-Dev/codex-claude-proxy` (traducao Anthropic <-> OpenAI)
- Parchi: `github.com/0xSero/parchi` (extensao que usa CLIProxyAPI)
- Amage: `amage-ai-browser-agent` (referencia de multi-provider com profiles, sdk-client.ts)
