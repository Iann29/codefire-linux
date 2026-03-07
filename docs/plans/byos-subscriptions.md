# CodeFire BYOS — Bring Your Own Subscription

**Status:** Planejado
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

## Fase 1 — Provider Adapter Layer

**Meta:** abstrair o AgentService do provider especifico. Hoje esta hardcoded pro OpenRouter.

### ProviderRouter

- [ ] Criar `electron/src/main/services/providers/ProviderRouter.ts`:
  - `resolveProvider(config)` — retorna o adapter correto baseado na config.
  - `chatCompletion(messages, tools, options)` — interface unificada.
  - `listModels()` — lista modelos disponiveis no provider ativo.
  - `healthCheck()` — verifica se o provider esta acessivel.

### Interface base

- [ ] Criar `electron/src/main/services/providers/BaseProvider.ts`:
  ```typescript
  interface ProviderAdapter {
    id: string
    name: string
    chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
    listModels(): Promise<ModelInfo[]>
    healthCheck(): Promise<ProviderHealth>
    supportsStreaming: boolean
    supportsToolCalling: boolean
    supportsMultimodal: boolean
  }
  ```

### OpenRouter adapter (migrar logica atual)

- [ ] Criar `electron/src/main/services/providers/OpenRouterAdapter.ts`:
  - Extrair logica de `AgentService.requestCompletion` para este adapter.
  - Manter compatibilidade total com o fluxo atual.
  - Auth: API key (como hoje).

### Custom Endpoint adapter

- [ ] Criar `electron/src/main/services/providers/CustomEndpointAdapter.ts`:
  - Compativel com qualquer endpoint OpenAI-compatible.
  - Auth: API key + base URL configuravel.
  - Descoberta de modelos via `GET /v1/models`.
  - Funciona com CLIProxyAPI, LiteLLM, Ollama, LM Studio, etc.

### Refactor do AgentService

- [ ] Refatorar `AgentService.requestCompletion` para usar `ProviderRouter` em vez de fetch direto.
- [ ] Manter mesma interface externa (IPC channels nao mudam).
- [ ] Adicionar campo `provider` no config (`openrouter` | `claude-subscription` | `openai-subscription` | `gemini-subscription` | `kimi-subscription` | `custom`).

**Criterios de aceite**

- AgentService funciona identico ao atual com OpenRouter (sem regressao).
- Custom endpoint funciona com qualquer servidor OpenAI-compatible.
- Novo provider pode ser adicionado implementando `ProviderAdapter`.

## Fase 2 — OAuth Engine + Token Storage

**Meta:** Implementar o motor de OAuth que permite autenticar com assinaturas existentes.

### OAuth Flow Manager

- [ ] Criar `electron/src/main/services/providers/OAuthEngine.ts`:
  - `startOAuthFlow(providerId)` — abre BrowserWindow com URL de autorizacao.
  - `handleCallback(callbackUrl)` — extrai authorization code do redirect.
  - `exchangeCodeForTokens(code)` — troca code por access_token + refresh_token.
  - `refreshAccessToken(refreshToken)` — renova access_token expirado.
  - `revokeTokens(providerId)` — revoga tokens do provider.

### Token Storage seguro

- [ ] Criar `electron/src/main/services/providers/TokenStore.ts`:
  - Usar `safeStorage.encryptString()` / `decryptString()` do Electron.
  - Persistir tokens encriptados em `~/.config/CodeFire/tokens.enc`.
  - Schema por provider: `{ accessToken, refreshToken, expiresAt, scope, accountInfo }`.
  - Auto-refresh: renovar token quando `expiresAt - now < 5min`.

### OAuth configs por provider

- [ ] Definir configs OAuth em `electron/src/main/services/providers/oauth-configs.ts`:
  ```typescript
  const OAUTH_CONFIGS = {
    'claude-subscription': {
      authUrl: 'https://claude.ai/oauth/authorize',
      tokenUrl: 'https://claude.ai/oauth/token',
      clientId: '...', // mesmo client_id do Claude Code CLI
      scopes: ['...'],
      apiBaseUrl: 'https://api.anthropic.com',
    },
    'openai-subscription': {
      authUrl: 'https://auth0.openai.com/authorize',
      tokenUrl: 'https://auth0.openai.com/oauth/token',
      clientId: '...', // mesmo client_id do Codex CLI
      scopes: ['...'],
      apiBaseUrl: 'https://api.openai.com',
    },
    'gemini-subscription': {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: '...', // mesmo client_id do Gemini CLI
      scopes: ['...'],
      apiBaseUrl: 'https://generativelanguage.googleapis.com',
    },
    'kimi-subscription': {
      // Kimi usa API key compativel com Anthropic
      // Sem OAuth — usa API key direta
      apiBaseUrl: 'https://api.kimi.com/coding',
      userAgent: 'claude-code/1.0',
    },
  }
  ```
- [ ] Pesquisar e documentar os client_ids e scopes corretos de cada provider (extrair dos CLIs oficiais: Claude Code, Codex, Gemini CLI).

### BrowserWindow para OAuth

- [ ] Criar janela de OAuth dedicada:
  - Tamanho fixo (~500x700), sem toolbar.
  - Navegar para `authUrl` com params (client_id, redirect_uri, scope, state, code_challenge).
  - Interceptar redirect via `webRequest.onBeforeRequest` ou `will-navigate`.
  - Extrair authorization code do redirect URL.
  - Fechar janela automaticamente apos sucesso.
  - Timeout de 5min se usuario nao completar o flow.

### IPC

- [ ] `provider:startOAuth` — inicia OAuth flow para um provider.
- [ ] `provider:listAccounts` — lista contas conectadas com status.
- [ ] `provider:removeAccount` — desconecta e revoga tokens.
- [ ] `provider:healthCheck` — status de todos os providers.
- [ ] `provider:listModels` — modelos disponiveis no provider ativo.

**Criterios de aceite**

- OAuth flow funciona dentro do Electron (BrowserWindow) sem browser externo.
- Tokens sao armazenados encriptados via `safeStorage`.
- Token refresh automatico antes de expirar.
- Revogar tokens limpa tudo do storage.

## Fase 3 — Subscription Adapters

**Meta:** Implementar os adapters que traduzem requests do AgentService para cada provider usando OAuth tokens.

### Claude Subscription Adapter

- [ ] Criar `electron/src/main/services/providers/ClaudeSubscriptionAdapter.ts`:
  - Endpoint: `https://api.anthropic.com/v1/messages` (mesmo da API, mas com OAuth token).
  - Auth header: `Authorization: Bearer ${oauthAccessToken}`.
  - Request format: Anthropic Messages API (nao OpenAI format).
  - Traduzir: OpenAI tool_calls <-> Anthropic tool_use blocks.
  - Traduzir: OpenAI messages format <-> Anthropic messages format.
  - Streaming: SSE com Anthropic event types (`message_start`, `content_block_delta`, etc.).
  - Modelos disponiveis baseados no tier (Pro: Sonnet/Haiku, Max: Opus/Sonnet/Haiku).

### OpenAI Subscription Adapter

- [ ] Criar `electron/src/main/services/providers/OpenAISubscriptionAdapter.ts`:
  - Endpoint: `https://api.openai.com/v1/chat/completions`.
  - Auth header: `Authorization: Bearer ${oauthAccessToken}`.
  - Request format: ja e OpenAI nativo (minima traducao).
  - Streaming: SSE padrao OpenAI.
  - Modelos: GPT-4o, o1, o3, etc. baseados no tier.

### Gemini Subscription Adapter

- [ ] Criar `electron/src/main/services/providers/GeminiSubscriptionAdapter.ts`:
  - Endpoint: Generative Language API ou Gemini API.
  - Auth: OAuth token do Google.
  - Traduzir: OpenAI format <-> Gemini format (contents, parts, functionCall).
  - Streaming: SSE com Gemini event format.
  - Modelos: Gemini 2.5 Pro, 2.0 Flash, etc.

### Kimi Adapter

- [ ] Criar `electron/src/main/services/providers/KimiAdapter.ts`:
  - Endpoint: `https://api.kimi.com/coding/v1/messages`.
  - Compativel com Anthropic Messages API.
  - Header obrigatorio: `User-Agent: claude-code/1.0`.
  - Auth: API key (sem OAuth — Kimi usa API key direto).

### Traducao de formatos

- [ ] Criar `electron/src/main/services/providers/format-translators.ts`:
  - `openaiToAnthropic(messages, tools)` — converte request OpenAI para Anthropic.
  - `anthropicToOpenai(response)` — converte response Anthropic para OpenAI.
  - `openaiToGemini(messages, tools)` — converte request OpenAI para Gemini.
  - `geminiToOpenai(response)` — converte response Gemini para OpenAI.
  - Suportar: text, tool_calls/tool_use, multimodal (images), streaming deltas.

**Criterios de aceite**

- Agente funciona com assinatura Claude Pro/Max (streaming + tool calling).
- Agente funciona com assinatura ChatGPT Plus/Pro.
- Agente funciona com assinatura Gemini Advanced.
- Agente funciona com API key Kimi.
- Tool calling funciona em todos os providers.

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

## Impacto no AgentService

### Antes (hardcoded OpenRouter)

```typescript
// AgentService.requestCompletion — ATUAL
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages, tools, temperature }),
})
```

### Depois (provider adapter)

```typescript
// AgentService.requestCompletion — NOVO
const provider = this.providerRouter.resolveProvider(config)
const response = await provider.chatCompletion({
  model, messages, tools, temperature, signal,
})
// response ja vem normalizado para formato interno
```

Mudanca cirurgica: substituir o `fetch` direto por `providerRouter.chatCompletion()`. O resto do loop (tool execution, plan enforcement, context compaction) nao muda.

## Estrutura de arquivos

```
electron/src/main/services/providers/
  ProviderRouter.ts          — resolve provider, routing, fallback
  BaseProvider.ts            — interface ProviderAdapter
  OAuthEngine.ts             — OAuth flows via BrowserWindow
  TokenStore.ts              — storage seguro de tokens (safeStorage)
  oauth-configs.ts           — configs OAuth por provider (URLs, client_ids, scopes)
  format-translators.ts      — traducao OpenAI <-> Anthropic <-> Gemini
  OpenRouterAdapter.ts       — modo atual (API key)
  ClaudeSubscriptionAdapter.ts  — assinatura Claude via OAuth
  OpenAISubscriptionAdapter.ts  — assinatura ChatGPT via OAuth
  GeminiSubscriptionAdapter.ts  — assinatura Gemini via OAuth
  KimiAdapter.ts             — API key Kimi (sem OAuth)
  CustomEndpointAdapter.ts   — endpoint generico OpenAI-compatible
```

## Ordem Recomendada

1. **Fase 1** (provider adapter layer) — refactor minimo, desacopla AgentService do OpenRouter, adiciona custom endpoint.
2. **Fase 2** (OAuth engine + token storage) — infraestrutura de auth.
3. **Fase 3** (subscription adapters) — conecta com assinaturas reais.
4. **Fase 4** (UI de contas) — experiencia de usuario polida.
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
