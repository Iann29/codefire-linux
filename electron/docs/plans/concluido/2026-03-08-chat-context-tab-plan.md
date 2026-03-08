# Chat Context Tab Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Criado ChatContextTab.tsx com: Session Summary (provider, model, context limit, messages, cost), Context Usage bar visual (verde/amarelo/vermelho), Token Breakdown com barras proporcionais, Compaction Diagnostics, Raw Messages table scrollável. Integrado ao CodeFireChat via subtab toggle (Chat | Context). Reutilizadas funções getContextWindowSize e estimateTokens de chatCommands.ts.
> **Objetivo:** adicionar uma aba `Context` dentro do Chat Mode para expor, em tempo real, o estado de contexto da conversa e da sessão, com métricas, breakdown, mensagens cruas e sinais de compaction.

---

## Referência de Produto

A referência mostrada na imagem aponta para uma experiência de contexto rica, com elementos como:

- nome da sessão
- provider
- model
- context limit
- usage %
- messages
- total tokens
- input/output/reasoning/cache
- custo
- última atividade
- breakdown visual do contexto
- lista de raw messages

Esse é exatamente o tipo de superfície que falta hoje no Chat Mode do CodeFire.

---

## Problema

Hoje o Chat Mode tem sinais soltos, mas não uma visão consolidada de contexto.

O que já existe está espalhado:

- `/context` mostra uma leitura simplificada
- `messageUsage` guarda usage por mensagem de assistant
- `compactionInfo` mostra quando houve resumo/compactação
- `SessionsView` e `SessionDetail` já exibem tokens, custo e metadados de sessão
- `LiveSessionState` já traz `latestContextTokens`, `contextUsagePercent`, `toolCounts`, `recentActivity` e outras métricas

O problema é que nada disso está organizado como uma aba operacional dentro do Chat Mode.

---

## O que já existe na codebase

### No Chat Mode

- `src/renderer/components/Chat/CodeFireChat.tsx`
  - `messageUsage`
  - `compactionInfo`
  - `/context`
  - model/provider ativos

### Em sessões

- `src/shared/models.ts`
  - `LiveSessionState`
- `src/main/ipc/session-handlers.ts`
  - `sessions:getLiveState`
- `src/main/services/SessionParser.ts`
  - calcula:
    - `latestContextTokens`
    - `contextUsagePercent`
    - `messageCount`
    - `userMessageCount`
    - `toolUseCount`
    - `toolCounts`
    - `estimatedCost`
    - `recentActivity`
- `src/renderer/components/Sessions/SessionDetail.tsx`
  - já exibe:
    - model
    - duration
    - branch
    - messages
    - tool uses
    - token breakdown
    - total cost
- `src/renderer/components/Dashboard/LiveSessionView.tsx`
  - já usa `contextUsagePercent` e `latestContextTokens`

Conclusão: a maior parte da base de dados já existe. Falta produto, composição e UI.

---

## Visão da Feature

A aba `Context` deve viver dentro do Chat Mode como uma visão lateral ou subtab, mostrando o estado do contexto que a IA está usando ou prestes a usar.

Essa aba precisa responder:

- quanto da janela de contexto já está ocupado?
- por quem esse contexto está sendo consumido?
- quais mensagens mais pesam?
- houve compaction?
- qual sessão está ativa?
- quais mensagens entraram como raw history?
- qual é o limite do modelo atual?

---

## UX Proposta

### Localização

Três opções:

1. subtab no cabeçalho do Chat Mode
2. painel lateral expansível do chat
3. drawer contextual

Recomendação:

- V1 como subtab simples: `Chat | Context`

### Layout inspirado na referência

#### Bloco 1: Session Summary

- `Session`
- `Provider`
- `Model`
- `Context Limit`
- `Usage`
- `Messages`
- `Total Tokens`
- `User Messages`
- `Assistant Messages`
- `Tool Calls`
- `Last Activity`

#### Bloco 2: Token Breakdown

- input
- output
- cache read
- cache write
- reasoning
- compaction delta

#### Bloco 3: Context Breakdown

Barra visual com percentuais por origem:

- assistant text
- tool calls
- user messages
- system/context scaffolding
- other

#### Bloco 4: Raw Messages

Tabela compacta com:

- role
- id ou label
- timestamp
- chars/tokens estimados
- origem

#### Bloco 5: Diagnostics

- compaction ligada?
- quantas mensagens foram resumidas?
- houve fallback?
- há attachments?
- arquivos/chunks injetados pelo RAG

---

## Estratégia Técnica Recomendada

### 1. Não depender só de `LiveSessionState`

`LiveSessionState` já ajuda muito, mas a aba precisa combinar duas naturezas de dado:

- dados da sessão Claude real, quando existirem
- dados do Chat Mode local do app

Portanto, a aba deve montar um `ContextSnapshot` unificado.

### 2. Criar um agregador de contexto no renderer

Criar algo como:

- `buildChatContextSnapshot()`

Entradas:

- `messages`
- `messageUsage`
- `compactionInfo`
- `chatModel`
- `aiProvider`
- `liveSessionState`

Saída:

- `ContextSnapshot`

### 3. Definir tipos próprios

Tipos sugeridos:

- `ContextSnapshot`
- `ContextBreakdownItem`
- `RawContextMessage`
- `ContextDiagnostics`

### 4. Separar “exato” de “estimado”

Nem todo provider devolve todos os números.

Então a UI deve marcar claramente:

- `exact`
- `estimated`

Exemplo:

- tokens de `messageUsage` podem ser exatos para certas respostas
- histórico anterior pode precisar de estimativa

---

## Modelo de Dados Sugerido

### `ContextSnapshot`

Campos úteis:

- `sessionLabel`
- `provider`
- `model`
- `contextLimit`
- `usedTokens`
- `usagePercent`
- `messageCount`
- `userMessageCount`
- `assistantMessageCount`
- `toolCallCount`
- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `reasoningTokens`
- `estimatedCost`
- `lastActivity`
- `breakdown`
- `rawMessages`
- `diagnostics`

### `RawContextMessage`

- `id`
- `role`
- `createdAt`
- `chars`
- `estimatedTokens`
- `source`
- `includedInContext`

---

## Fontes de Verdade

### Dados já disponíveis

- `CodeFireChat` local state
- `sessions:getLiveState`
- `getContextWindowSize(chatModel)`
- `estimateTokens()`
- `messageUsage`
- `compactionInfo`

### Dados a enriquecer depois

- reasoning tokens por provider
- attachments e file mentions
- RAG chunks realmente incluídos
- tool call token attribution mais precisa

---

## Arquivos Prováveis de Implementação

- `src/renderer/components/Chat/CodeFireChat.tsx`
- novos componentes em `src/renderer/components/Chat/*`
  - `ChatContextTab.tsx`
  - `ChatContextBreakdown.tsx`
  - `ChatRawMessagesTable.tsx`
- `src/renderer/components/Chat/chatCommands.ts`
- `src/renderer/lib/api.ts`
- `src/shared/models.ts`
- `src/main/ipc/session-handlers.ts`
- `src/main/services/SessionParser.ts`

---

## Fases de Entrega

### Fase 1

- subtab `Context`
- model, provider, context limit, usage %, messages
- raw messages com estimativa
- compaction summary

### Fase 2

- integração com `sessions:getLiveState`
- cost e tokens mais detalhados
- breakdown visual por categoria
- recent activity

### Fase 3

- incluir attachments, file mentions e chunks RAG
- export de snapshot
- diff entre antes/depois da compaction

---

## Riscos

### Mostrar número “bonito”, mas enganoso

Mitigação:

- rotular o que é estimado
- exibir fonte do dado

### Misturar sessão Claude com conversa do app

Mitigação:

- deixar explícito quando a aba estiver em:
  - `Local Chat Context`
  - `Live Claude Session Context`
  - `Blended`

### Sobrecarregar o Chat Mode

Mitigação:

- progressive disclosure
- subtab separada

---

## Critérios de Sucesso

- o usuário entende claramente o estado de contexto atual
- `/context` deixa de ser o único mecanismo de inspeção
- Chat Mode ganha transparência operacional comparável à referência
- a aba ajuda de verdade a diagnosticar compaction, overload e custo

---

## Resultado Esperado

A aba `Context` deve transformar o Chat Mode em algo muito mais confiável e profissional. Em vez de “conversar no escuro”, o usuário passa a enxergar a sessão, o budget de contexto, o breakdown e a matéria-prima real que está sendo enviada para a IA.
