# Chat Token Usage Accuracy Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** `npm run build`; `npx vitest run src/__tests__/shared/chat-usage.test.ts src/__tests__/services/agent-browser-intent.test.ts`
> **O que foi feito:** Persistido usage estruturado por mensagem (`responseUsage`, `runUsage`, provider/model/effort/capturedAt) em `chatMessages`; `AgentService` agora agrega usage por run, emite `agent:usage` e salva snapshot completo no assistant final; a aba `Context` passou a separar `Current Context Estimate`, `Last Provider Call`, `This Run` e `This Conversation`, usando dados exatos quando existem e estimativa apenas onde nao existe usage do provider; a soma da conversa agora usa a conversa ativa apenas. A verificacao automatizada de migrations ficou bloqueada por incompatibilidade ABI do `better-sqlite3` no ambiente de teste.
> **Objetivo:** tornar a contagem de tokens do Chat Mode tecnicamente coerente com o que os providers realmente consomem, diferenciando estimativa local, usage por resposta e contexto efetivo por iteracao.

---

## Problema

A aba `Context` hoje exibe numeros que parecem "precisos", mas na pratica misturam:

- uso real retornado pelo provider
- estimativa local de caracteres
- acumulado parcial de mensagens
- ausencia de dados de iteracoes anteriores

Isso gera discrepancias grandes com os logs do backend, por exemplo:

- `33067in/80out`
- `33380in/85out`
- `33704in/81out`
- `33798in/82out`

enquanto a UI mostra apenas algo como `7,436 input` e `1,217 output`.

---

## Causa Raiz Encontrada

### 1. A UI soma apenas `messageUsage` local

Em `src/renderer/components/Chat/ChatContextTab.tsx:41-47`, o painel soma `prompt_tokens` e `completion_tokens` do mapa `messageUsage`.

### 2. `messageUsage` so e salvo em alguns pontos

Em `src/renderer/components/Chat/CodeFireChat.tsx`:

- `agent:done` salva usage so da mensagem final em `CodeFireChat.tsx:472-481`
- `handleContextModeProvider` salva usage so da resposta final em `CodeFireChat.tsx:879-882`

Nao existe um ledger por chamada do provider, por iteracao de tool use, ou por resposta intermediaria.

### 3. Agent mode e iterativo

Em `src/main/services/AgentService.ts:906-981`, cada loop do agent chama `chatCompletionWithRetry(...)` novamente.

O log em `ProviderRouter` mostra usage por chamada inteira:

- `src/main/services/providers/ProviderRouter.ts:626-645`

Esses numeros representam o prompt completo daquela iteracao, nao apenas os tokens da mensagem final persistida no chat.

### 4. O modelo de dados nao persiste usage de forma estruturada

Hoje `ChatMessage` nao tem campos persistidos de usage em `src/shared/models.ts`.

Logo:

- a UI depende de estado volatil
- nao ha reidratacao fiel apos reload
- nao ha como reconstruir custo/contexto por conversa com fidelidade

---

## Escopo do Plano

Padronizar o produto em tres metricas diferentes:

1. `Response Usage`
   Uso retornado pela resposta associada a uma mensagem

2. `Run Usage`
   Soma de todas as chamadas do provider dentro de um run do agent

3. `Current Context Footprint`
   Estimativa do tamanho do contexto atualmente montado para a proxima chamada

Sem separar isso, a UI continuara comparando bananas com laranjas.

---

## Direcao Recomendada

### Regra de produto

A aba `Context` deve parar de vender um unico numero como se fosse "o total real". Ela precisa mostrar:

- `Current context estimate`
- `Last provider call usage`
- `Run total usage`
- `Conversation accumulated usage`

cada um com label claro.

---

## Implementacao Recomendada

### Fase 1. Introduzir modelo explicito de usage

Criar tipos compartilhados em:

- `src/shared/models.ts`
- opcionalmente `src/shared/types.ts`

Tipos sugeridos:

- `MessageUsage`
- `RunUsage`
- `ConversationUsageSnapshot`
- `ContextFootprint`

Campos uteis:

- `promptTokens`
- `completionTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `reasoningTokens`
- `source: 'provider' | 'estimated'`
- `scope: 'message' | 'run' | 'conversation' | 'context_estimate'`

### Fase 2. Capturar usage por chamada real do provider

Arquivos:

- `src/main/services/AgentService.ts`
- `src/main/services/providers/ProviderRouter.ts`

Passos:

- cada chamada a `chatCompletionWithRetry` precisa emitir usage estruturado por `runId`
- somar esse usage dentro do run atual
- expor um evento novo, por exemplo `agent:usage`
- guardar:
  - uso da ultima chamada
  - uso acumulado do run

### Fase 3. Persistir usage relevante

Arquivos:

- `src/main/ipc/chat-handlers.ts`
- camada de banco de chat
- `src/shared/models.ts`

Passos:

- persistir usage por mensagem assistant quando houver
- persistir snapshot resumido por conversa ou run
- ao reabrir o chat, reidratar os dados reais em vez de depender do state em memoria

### Fase 4. Corrigir a semantica da aba `Context`

Arquivo:

- `src/renderer/components/Chat/ChatContextTab.tsx`

Passos:

- trocar `estimatedTotalTokens` por secoes separadas
- exibir:
  - `Current Context Estimate`
  - `Last Call Usage`
  - `Run Total`
  - `Conversation Total`
- marcar visualmente o que e `Exact` vs `Estimated`

### Fase 5. Alinhar com sessao Claude quando existir

O app ja tem parser de sessao em:

- `src/main/services/SessionParser.ts`

Se houver conexao com sessao Claude real, usar:

- `latestContextTokens`
- `contextUsagePercent`
- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `cacheCreationTokens`

como fonte primaria para a aba de contexto daquela sessao.

---

## UX Recomendada

### Bloco 1. Current Context

- estimativa do contexto que entraria na proxima chamada
- percentual da janela do modelo

### Bloco 2. Last Provider Call

- `33,798 in / 82 out`
- provider
- modelo
- horario da chamada

### Bloco 3. This Run

- soma de todas as iteracoes do run atual
- numero de tool loops

### Bloco 4. This Conversation

- soma persistida da conversa inteira

### Bloco 5. Confidence

- `Exact provider usage`
- `Estimated from local text`

---

## Riscos

### 1. Duplicar contagem

Se somar `usage` por mensagem e tambem `usage` por run sem separar escopo, a UI vai inflar numeros.

Mitigacao:

- toda metrica precisa declarar `scope`

### 2. Misturar prompt total da iteracao com contexto atual

O log do provider e da chamada completa. O "contexto atual" e outra coisa.

Mitigacao:

- nomenclatura rigorosa na UI

---

## Testes e Validacao

1. rodar uma conversa simples em context mode e comparar UI vs `response.usage`
2. rodar agent mode com multiplas chamadas e comparar:
   - soma do run
   - ultimo call usage
   - logs do `ProviderRouter`
3. recarregar a app e confirmar reidratacao correta
4. alternar conversas e garantir que os snapshots permanecem corretos

---

## Criterio de Sucesso

O usuario precisa conseguir olhar a aba `Context` e entender, sem ambiguidade:

- quanto contexto esta em uso agora
- quanto custou/consumiu a ultima chamada
- quanto o run inteiro consumiu
- quanto a conversa acumulou

sem discrepancias grosseiras contra os logs do backend.
