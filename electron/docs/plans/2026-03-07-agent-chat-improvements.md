# Agent & Chat Improvements Plan

> **Date:** 2026-03-07
> **Status:** CONCLUÍDO ✓
>
> **Implementado em:** 2026-03-08
> - #1 Continue button: IPC `agent:continue`, limites 30/100, botão Continue funcional
> - #2 Streaming: já existia para subscription providers (verificado)
> - #3 Erros amigáveis: todos os catch blocks agora usam `formatChatError`
> - #4 Premium UI removida: 19 arquivos deletados, 5 editados
> - #5 Model fix: context mode agora usa modelo do dropdown, não do config
> - #6 Token usage: já implementado e funcionando (verificado)
> - Verificado: `tsc --noEmit` passa limpo

---

## Context

O chat com Claude subscription via setup-token está funcionando. O agent mode consegue navegar no browser, executar planos com tool calling, e interagir com sites reais. Porém existem pontos de melhoria claros.

---

## Problem 1: Tool Call Limit Muito Baixo

**Sintoma:** Agent para no meio da execução com "I reached the maximum number of tool calls."

**Causa:** `DEFAULT_MAX_ITERATIONS = 10`, `MAX_MAX_ITERATIONS = 30`, configurável em Settings (default 30). Para browser automation complexa (login → navegar → preencher forms → verificar), 30 tool calls não é suficiente.

**Arquivo:** `src/main/services/AgentService.ts:72-73,983`

**Opções:**
1. Aumentar `MAX_MAX_ITERATIONS` para 60-100
2. Adicionar "Continue" button — quando atinge o limite, mostrar botão no chat para continuar de onde parou (manter contexto, resetar contador)
3. Auto-continue — se o plano tem steps pendentes, automaticamente continuar (com safeguard de max 3 continuations)

**Recomendação:** Opção 2 (Continue button) + aumentar default para 60.

---

## Problem 2: Sem Streaming para Subscription Providers no Context Mode

**Sintoma:** Ao usar Claude subscription no context mode, aparece "Thinking..." e depois a resposta inteira de uma vez. OpenRouter tem streaming normal.

**Causa:** `chat:providerCompletion` IPC handler faz request non-streaming e retorna a resposta completa. A Anthropic Messages API suporta `stream: true` com SSE.

**Arquivos:**
- `src/main/ipc/chat-handlers.ts` (handler)
- `src/renderer/components/Chat/CodeFireChat.tsx` (handleContextModeProvider)
- `src/main/services/providers/ClaudeSubscriptionAdapter.ts`

**Solução:**
1. Novo IPC handler `chat:streamProviderCompletion` que:
   - Main process faz request com `stream: true` à API
   - Parseia SSE chunks (`event: content_block_delta`)
   - Envia chunks via `webContents.send('chat:streamChunk', text)` para renderer
   - Retorna content completo no final
2. Renderer escuta `chat:streamChunk` e atualiza `streamedContent` em tempo real
3. Fallback: se streaming falhar, usar current non-streaming path

**Complexidade:** Média — precisa parsear SSE da Anthropic Messages API (formato diferente do OpenRouter).

---

## Problem 3: Remover Premium Paywall

**Sintoma:** Usuário pediu para remover features premium/admin. Stubs estão no lugar mas UI pode ainda mostrar referências a premium.

**Causa:** Premium features (teams, billing, sync) requerem Supabase. Stubs retornam dados vazios. Mas componentes de UI podem renderizar seções de premium condicionalmente.

**Arquivos:**
- `src/renderer/` — procurar por referências a premium, billing, subscription checks
- `src/main/index.ts` — stubs já no lugar

**Solução:** Auditar renderer components e remover/esconder qualquer UI que referencie premium como feature paga. Manter os stubs no main process.

---

## Problem 4: Mensagem de Erro Pouco Amigável no Chat

**Sintoma:** Quando dá erro, aparece "Error: Error invoking remote method 'chat:providerCompletion': ProviderHttpError: Claude API error: {...json...}"

**Causa:** O erro bruto do IPC é mostrado direto no chat sem formatação.

**Arquivo:** `src/renderer/components/Chat/CodeFireChat.tsx` (handleContextModeProvider catch)

**Solução:** Parsear erros comuns e mostrar mensagens amigáveis:
- `authentication_error` → "Token inválido. Gere um novo com `claude setup-token`."
- `rate_limit_error` → "Rate limit atingido. Aguarde X segundos."
- `invalid_request_error` → "Erro na requisição: {message}"
- Network errors → "Sem conexão com a API."

---

## Problem 5: Context Mode Não Usa Provider Correto para Chat Model

**Sintoma:** Se o usuário seleciona "Claude Opus 4.6 SUB" no seletor de modelo do chat, mas o chatModel default no Settings é `google/gemini-3.1-pro-preview`, o context mode pode usar o modelo errado.

**Causa:** O modelo selecionado no chat dropdown (`chatModel` state) vs o modelo salvo no config (`config.chatModel`) podem ser diferentes. O context mode usa `config.chatModel`.

**Solução:** Passar o modelo selecionado no chat dropdown como parâmetro para a request, não o default do config.

---

## Problem 6: Token Usage Não Visível no UI

**Sintoma:** Os logs mostram `tokens: 203in/157out` mas o UI não exibe uso de tokens.

**Causa:** O `chat:providerCompletion` retorna `usage` mas o renderer ignora.

**Solução:** Mostrar badge discreto com token count ao lado de cada mensagem do assistant. Útil para o usuário saber quanto está consumindo da subscription.

---

## Priority Order

| # | Melhoria | Impacto | Esforço |
|---|----------|---------|---------|
| 1 | Continue button (tool call limit) | Alto | Médio |
| 2 | Streaming subscription context mode | Alto | Médio |
| 3 | Error messages amigáveis | Médio | Baixo |
| 4 | Remover premium paywall UI | Médio | Baixo |
| 5 | Modelo correto no context mode | Médio | Baixo |
| 6 | Token usage display | Baixo | Baixo |
