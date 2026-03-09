# Chat Context Conversation Isolation Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** `npm run build`
> **O que foi feito:** O estado operacional do chat/contexto foi isolado por `conversationId` para plano, escopo do plano, verificacao, compaction e usage de run; a UI ativa passou a derivar apenas a fatia da conversa selecionada; mensagens assistant so sao anexadas ao array visivel quando pertencem a conversa ativa; o `Context` tab agora le usage persistido das mensagens da conversa atual em vez de um mapa global do drawer; ao criar/deletar conversa os caches correspondentes sao inicializados/limpos.
> **Objetivo:** fazer a aba `Context` refletir apenas a conversa ativa, sem vazar metricas, compaction ou usage de outros chats.

---

## Problema

Hoje a aba `Context` nao esta isolada por conversa. O usuario troca de chat e a tab continua mostrando numeros e diagnosticos herdados da conversa anterior.

Isso quebra confianca no painel, porque a UI aparenta ser "por thread", mas parte do estado ainda e global ao componente `CodeFireChat`.

---

## Causa Raiz Encontrada

### 1. `messageUsage` e global ao drawer

Em `src/renderer/components/Chat/CodeFireChat.tsx`:

- o estado `messageUsage` e um `Record<number, usage>` global do componente
- ele e alimentado por `agent:done` em `CodeFireChat.tsx:472-481`
- ele tambem e alimentado em `handleContextModeProvider` em `CodeFireChat.tsx:879-882`

Ao trocar `activeConversationId`, as mensagens sao recarregadas, mas o mapa de usage nao e resetado nem segmentado por conversa.

### 2. `ChatContextTab` soma todos os usages do mapa

Em `src/renderer/components/Chat/ChatContextTab.tsx:41-47`, a tab faz:

- `for (const usage of Object.values(messageUsage))`

Ou seja, ela agrega tudo que estiver no store, sem filtrar pelos `message.id` da conversa atual.

### 3. Outros diagnosticos tambem sao "ultimo run global"

Em `CodeFireChat.tsx`:

- `compactionInfo`
- `planSteps`
- `awaitingVerification`
- `lastBrowserAction`

sao estados unicos do drawer, nao indexados por `conversationId`.

Entao, mesmo quando `messages` mudam corretamente por conversa, esses metadados continuam vindo do ultimo run ativo naquele drawer.

---

## Escopo do Plano

Corrigir o isolamento completo do estado do `Context` por conversa:

- usage por mensagem
- compaction por conversa
- plano por conversa
- ultimo browser action por conversa
- raw table coerente com o chat selecionado

---

## Direcao Recomendada

### Opcao recomendada: estado indexado por `conversationId`

Em vez de zerar tudo na troca de chat, transformar os estados operacionais em caches por conversa.

Estruturas sugeridas:

- `messageUsageByConversation: Record<number, Record<number, TokenUsage>>`
- `messageToolsByConversation: Record<number, Record<number, ToolExecution[]>>`
- `compactionByConversation: Record<number, CompactionInfo | null>`
- `planByConversation: Record<number, PlanStep[]>`
- `verificationByConversation: Record<number, { awaitingVerification: boolean; lastBrowserAction: string | null }>`

Depois, derivar um `activeConversationState` no render.

Isso preserva historico ao trocar de chat e elimina vazamento visual.

---

## Implementacao Recomendada

### Fase 1. Isolar `messageUsage`

Arquivos:

- `src/renderer/components/Chat/CodeFireChat.tsx`
- `src/renderer/components/Chat/ChatContextTab.tsx`

Passos:

- substituir `messageUsage` global por estrutura por conversa
- ao receber `agent:done` ou `streamProviderCompletion`, gravar usage em `messageUsageByConversation[conversationId][messageId]`
- passar para `ChatContextTab` apenas o mapa da conversa ativa
- em `ChatContextTab`, somar apenas os usages dos `messages` ativos

### Fase 2. Isolar compaction e plano

Arquivos:

- `src/renderer/components/Chat/CodeFireChat.tsx`

Passos:

- indexar `compactionInfo` por conversa
- indexar `planSteps` por conversa
- indexar `awaitingVerification` e `lastBrowserAction` por conversa
- ao trocar `activeConversationId`, a UI passa a ler apenas a fatia daquele chat

### Fase 3. Garantir reset sem perder historico

Passos:

- quando `handleNewConversation()` cria um chat, inicializar estado vazio para a nova conversa
- quando uma conversa for deletada, limpar os caches indexados daquele `conversationId`
- se o usuario abrir um chat sem nenhum usage salvo, a tab deve mostrar estado vazio/estimado, nunca o do chat anterior

### Fase 4. Persistencia opcional

Se quiser consistencia apos reload:

- persistir usage/compaction no banco por mensagem ou por conversa
- ou recomputar a partir de eventos salvos

Essa parte pode ficar para uma segunda wave, mas o desenho de estado ja deve deixar isso facil.

---

## UX Esperada

Ao trocar de conversa:

- `Messages`
- `User / Asst`
- `Context Usage`
- `Token Breakdown`
- `Compaction`
- `Raw Messages`

devem atualizar imediatamente para os dados da thread selecionada.

Se a conversa nao tiver metricas ainda:

- mostrar `No usage data yet`
- usar fallback estimado apenas nas mensagens daquele chat

---

## Riscos

### 1. Mistura entre `runId` e `conversationId`

Hoje os eventos chegam por `runId`. O estado final precisa sempre ser gravado no `conversationId` certo.

Mitigacao:

- manter um mapa `runId -> conversationId`

### 2. Crescimento de estado no renderer

Se o drawer ficar aberto por muito tempo com muitas conversas, os mapas podem crescer.

Mitigacao:

- limpeza ao deletar conversa
- opcionalmente pruning de conversas nao abertas recentemente

---

## Testes e Validacao

### Fluxos manuais

1. abrir conversa A, mandar 2 mensagens, verificar a aba `Context`
2. abrir conversa B vazia, confirmar que a tab nao herda dados da A
3. mandar mensagem na B, confirmar que a tab reflete so a B
4. voltar para A, confirmar que os numeros da A permanecem corretos
5. deletar B, confirmar limpeza dos caches

### Testes automatizados

- teste de reducer/helper de estado por conversa
- teste de `ChatContextTab` recebendo mapa filtrado
- teste de troca de `activeConversationId` sem vazamento de metadados

---

## Criterio de Sucesso

A aba `Context` deve ser semanticamente "por conversa", nao "por drawer". Trocar de chat precisa trocar 100% do contexto exibido, inclusive usage, compaction e diagnosticos de runtime.
