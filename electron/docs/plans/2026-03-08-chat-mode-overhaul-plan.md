# Chat Mode Overhaul Plan

> **Date:** 2026-03-08
> **Status:** PROPOSTO
> **Objetivo:** elevar o Chat Mode de caixa de conversa básica para cockpit de execução, contexto, inspeção e controle de IA dentro do produto.

---

## Problema

O Chat Mode atual já responde, faz streaming e roda agente, mas ainda transmite pouca informação operacional.

Faltam elementos importantes:

- contexto ativo do projeto e da página
- attachments persistentes
- menções de arquivo
- status mais rico do run
- clareza de qual provider/modelo está em uso
- indicadores de quanto contexto já foi consumido
- histórico mais forte por conversa
- ações rápidas sobre saída do agente

Visualmente e funcionalmente, ele ainda está abaixo do papel central que poderia assumir.

---

## Estado Atual

`CodeFireChat.tsx` hoje já concentra:

- context mode
- agent mode
- streaming
- plano
- tools em execução
- model selector
- conversas
- rate limit banners

Isso é poderoso, mas também revela um problema:

- o componente está grande demais
- UI, composer, runtime events e orchestration estão no mesmo lugar

---

## Direção de Produto

O Chat Mode deve virar uma estação completa com quatro zonas claras:

### 1. Composer rico

- texto
- attachments
- `@` mentions
- slash commands
- chips de contexto

### 2. Runtime HUD

- modelo/provider ativo
- token/context usage
- run timer
- estado de tool calls
- fallback/rate limit state

### 3. Message surface melhor

- blocos com attachments
- tool outputs mais legíveis
- cards de evidência do browser
- ações rápidas fortes

### 4. Context inspector

- quais arquivos/rotas/contextos foram injetados
- quanto da janela está ocupada
- o que foi compactado

---

## Melhorias Recomendadas

### Composer

- attachments e `@mentions`
- drag and drop
- prompt templates rápidos
- enviar com contexto explícito da página atual

### Mensagens

- previews de anexos
- agrupamento de tool calls por etapa
- cards de “browser action”
- badges de modelo/usage por resposta

### Agent mode

- timeline mais clara do plano
- step atual destacado
- confirmação destrutiva melhor
- estado de pausa/continuação

### Context mode

- inspector de RAG
- mostrar quais chunks/arquivos entraram
- `/context` mais rico

### Conversas

- renomear
- pin
- filtro por tipo
- busca interna

---

## Refator Técnico Recomendado

Separar `CodeFireChat.tsx` em módulos:

- `ChatComposer`
- `ChatConversationHeader`
- `ChatRuntimeHUD`
- `ChatMessageList`
- `ChatAttachmentTray`
- `ChatContextInspector`
- hooks dedicados para send/run/runtime

Isso reduz risco de regressão e facilita evolução contínua.

---

## Arquivos Prováveis de Implementação

- `src/renderer/components/Chat/CodeFireChat.tsx`
- novos componentes em `src/renderer/components/Chat/*`
- `src/renderer/lib/api.ts`
- `src/shared/models.ts`
- `src/main/services/AgentService.ts`
- `src/main/ipc/chat-handlers.ts`

---

## Plano de Execução

### Fase 1

- composer rico
- attachments e mentions
- HUD básico

### Fase 2

- context inspector
- melhor surface para tool calls e browser evidence
- melhorias de conversa e histórico

### Fase 3

- presets de prompt
- controles avançados por modo
- modo painel dedicado ou fullscreen

---

## Riscos

- componente central virar ainda mais monolítico
- excesso de informação visual poluir a experiência

### Mitigação

- modularização desde o início
- hierarchy visual clara
- progressive disclosure

---

## Critério de Sucesso

O Chat Mode precisa parecer e funcionar como centro de comando real do app, não como um textarea com streaming.
