# Chat Attachment Persistence Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Criada tabela chatMessageAttachments (migration v23) com FK cascade para chatMessages. Interface ChatMessageAttachment adicionada em models.ts. ChatMessage estendido com campo opcional attachments. Handler chat:sendMessage agora persiste attachments. Handler chat:listMessages enriquece mensagens com attachments do DB. Thumbnails de attachments renderizados no ChatBubble. api.ts atualizado para passar attachments.
> **Objetivo:** tornar attachments do Chat Mode duráveis e reabríveis, em vez de mantê-los apenas em state efêmero do renderer.

---

## Problema

Hoje os attachments vivem só em `draftAttachments` no React.

Limitações atuais:

- não são persistidos na mensagem
- se a view recarregar, tudo some
- a conversa salva continua só texto
- o histórico não mostra que houve imagem/anexo
- follow-ups futuros perdem contexto visual original

Isso reduz muito o valor do chat como memória de trabalho.

---

## Objetivo Funcional

Depois da mudança:

- uma mensagem pode ter texto + attachments
- o histórico mostra que houve imagem ou arquivo
- ao reabrir a conversa, o usuário ainda vê os anexos
- o app pode reutilizar esses artefatos em tasks, notes, review e agent runs

---

## Estratégia Recomendada

### 1. Formalizar mensagem multipart

Hoje `chatMessages` guarda apenas `content TEXT`.

Opções:

- expandir `chatMessages` com JSON de partes
- criar tabelas auxiliares de attachments por mensagem

Recomendação:

- manter `content` como texto principal
- criar tabela `chatMessageAttachments`

Isso minimiza ruptura com código existente.

### 2. Persistir arquivo em disco

Para imagens e arquivos, salvar em diretório controlado do app:

- por projeto
- por conversa
- com cleanup policy

Nunca depender só de `dataUrl` no banco.

### 3. Renderer deve ler histórico enriquecido

`api.chat.listMessages` precisa retornar:

- mensagem
- attachments associados

Isso provavelmente exige novo shape de retorno ou enrichment pós-query.

---

## Modelo Recomendado

### Tabela `chatMessageAttachments`

Campos sugeridos:

- `id`
- `messageId`
- `kind`
- `name`
- `mimeType`
- `filePath`
- `source`
- `createdAt`

### Tipo enriquecido no shared

- `ChatMessageAttachment`
- `ChatMessageWithAttachments`

---

## Arquivos Prováveis de Implementação

- `src/shared/models.ts`
- `src/main/database/migrations/index.ts`
- `src/main/ipc/chat-handlers.ts`
- novo `src/main/database/dao/ChatAttachmentDAO.ts`
- `src/renderer/lib/api.ts`
- `src/renderer/components/Chat/CodeFireChat.tsx`
- possíveis subcomponentes de bubble com preview

---

## Plano de Execução

### Fase 1

- persistir attachments enviados
- enriquecer carregamento de mensagens
- mostrar preview no histórico

### Fase 2

- permitir download/open/show in explorer
- permitir reusar attachment em nova mensagem ou task

### Fase 3

- cleanup policy
- compressão ou deduplicação onde fizer sentido

---

## Testes Necessários

- enviar imagem, recarregar app e reabrir conversa
- mensagens mistas texto + imagem
- attachments múltiplos
- histórico antigo sem attachments continuar compatível

---

## Critério de Sucesso

Uma conversa com screenshot ou arquivo deve continuar semanticamente completa depois de reload, mudança de aba ou reabertura do app.
