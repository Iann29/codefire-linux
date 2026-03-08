# Browser Screenshot to Chat Delivery Fix Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Criado `chatComposerStore.ts` como store compartilhado de pub/sub para attachments. BrowserView agora usa `chatComposerStore.addAttachment()` ao invés de eventos DOM efêmeros. ProjectLayout se inscreve no store e abre terminal+chat quando há request. CodeFireChat consome attachments pendentes no mount e via subscription, resolvendo o problema de perda quando chat estava fechado.
> **Objetivo:** garantir que o screenshot do Browser chegue ao Chat Mode de forma confiável, mesmo quando o chat estiver fechado ou o painel lateral estiver oculto.

---

## Problema

Hoje o Browser dispara:

- `codefire:chat-attachment`
- depois `codefire:open-chat`

Mas o listener do attachment está dentro de `CodeFireChat`, que só monta quando `showChat` já está ativo. Se o chat estiver fechado, o evento é perdido.

Além disso, se o painel lateral inteiro estiver oculto (`showTerminal = false`), abrir só o chat não basta: a coluna inteira continua invisível.

---

## Efeito Prático

O usuário clica em screenshot e espera:

- ver a imagem no composer
- ver o chat abrir pronto para mandar a análise

Hoje pode acontecer:

- o chat abrir vazio
- nada abrir visualmente
- a imagem simplesmente sumir

Isso torna a feature pouco confiável.

---

## Estratégia Recomendada

### 1. Parar de depender de evento efêmero para o attachment

O attachment precisa entrar em uma store ou fila persistente de UI:

- `pendingChatAttachments`
- escopo por janela/projeto

O Browser escreve nessa store.
O Chat consome essa store ao montar ou ao ficar visível.

### 2. Abrir o painel certo de forma completa

O evento “open chat” deve ser substituído por intenção estruturada:

- `ensureChatVisible`

Essa ação precisa:

- `setShowTerminal(true)` se a coluna lateral estiver escondida
- `setShowChat(true)` para montar o composer
- opcionalmente focar o chat

### 3. Encadear screenshot + composer state

O fluxo correto é:

1. capturar screenshot
2. salvar attachment em store
3. abrir painel lateral se necessário
4. abrir chat
5. focus no composer

---

## Arquitetura Recomendada

### Camada de UI state compartilhado

Criar algo como:

- `src/renderer/stores/chatComposerStore.ts`

Estado sugerido:

- `draftText`
- `draftAttachments`
- `isRequestedOpen`
- `sourceProjectId`

### Browser

`BrowserView` não deve falar com `CodeFireChat` por evento cego. Deve publicar intenção no store.

### ProjectLayout

Responsável por observar a intenção:

- abrir coluna lateral
- abrir chat

### CodeFireChat

Responsável por:

- ler attachments pendentes
- renderizar previews
- limpar fila após ingestão

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/BrowserView.tsx`
- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/components/Chat/CodeFireChat.tsx`
- novo `src/renderer/stores/chatComposerStore.ts`

---

## Plano de Execução

### Fase 1

- introduzir fila/store de attachments
- substituir evento efêmero
- garantir `showTerminal` + `showChat`

### Fase 2

- focar automaticamente o composer
- opcionalmente preencher prompt padrão com URL/título

### Fase 3

- permitir roteamento de outros artefatos do browser para o chat

---

## Testes Necessários

- screenshot com chat já aberto
- screenshot com chat fechado e terminal visível
- screenshot com terminal inteiro escondido
- screenshot múltipla em sequência
- troca de projeto com attachment pendente

---

## Critério de Sucesso

Sempre que o usuário clicar na câmera do browser, a imagem deve aparecer no composer visível do chat, sem depender do timing de montagem do componente.
