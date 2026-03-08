# Agent Mode Attachments Support Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Adicionado parâmetro attachments a handleAgentModeMain(), propagado via api.agent.start() → agent-handlers.ts → AgentService.ts. AgentStartInput e ActiveRun agora incluem attachments. executeRun() injeta imagens como conteúdo multimodal (formato image_url com data URL) na última mensagem do usuário no histórico enviado ao modelo.
> **Objetivo:** fazer com que anexos visuais e arquivos enviados no Chat Mode cheguem de fato ao runtime do agente, e não apenas ao contexto mode.

---

## Problema

Hoje o composer aceita attachments, mas somente os caminhos de `handleContextMode` e `handleContextModeProvider` tentam montar payload multimodal.

Em `agent` mode:

- o draft aceita screenshot/imagem
- o usuário vê preview no composer
- mas `handleAgentModeMain()` envia apenas `userMessage: string`
- o agente nunca recebe os anexos

Isso é perigoso porque a UI sugere suporte real onde ainda não existe.

---

## Objetivo Funcional

Quando o usuário estiver em `Agent` mode e anexar uma imagem:

- o runtime do agente deve receber esse anexo
- o modelo escolhido deve saber que há artefato visual
- tools e reasoning devem poder agir sobre isso

Se o modelo/provider não suportar visão:

- o app deve avisar claramente
- ou oferecer fallback controlado

---

## Estratégia Recomendada

### 1. Estender o payload de `api.agent.start`

Adicionar algo como:

- `attachments`
- `contextRefs`

Isso precisa propagar do renderer até o `AgentService`.

### 2. Definir contrato de attachment no agente

O runtime precisa saber:

- tipo: imagem, arquivo, texto
- origem
- tamanho
- path ou data source

Evitar depender só de `dataUrl` em memória.

### 3. Adaptar o system prompt e o loop do agente

O agente precisa receber instrução clara de que existem anexos.

Exemplo lógico:

- “The user attached 1 image: screenshot-...”
- “You may reason over the attached image if the selected model supports vision.”

### 4. Política de fallback

Se provider/model não suportarem visão:

- bloquear envio em agent mode
- ou transformar em contexto textual limitado

Recomendação:

- bloquear com mensagem explícita na V1

---

## Arquitetura Recomendada

### Renderer

- `CodeFireChat` passa `attachments` para `api.agent.start`

### IPC / API

- ampliar tipos e handlers do agente

### Main / AgentService

- armazenar attachments no contexto do run ativo
- incorporá-los ao request do provider
- suportar inspeção futura por tool ou visão direta do modelo

### Shared

- criar tipos formais reutilizáveis:
  - `ChatAttachment`
  - `AgentRunAttachment`

---

## Arquivos Prováveis de Implementação

- `src/renderer/components/Chat/CodeFireChat.tsx`
- `src/renderer/lib/api.ts`
- `src/shared/models.ts`
- `src/shared/types.ts`
- `src/main/ipc/agent-handlers.ts`
- `src/main/services/AgentService.ts`
- `src/main/services/providers/*`

---

## Plano de Execução

### Fase 1

- ampliar contrato de `agent.start`
- transportar attachments até o main
- exibir erro se modelo não suportar visão

### Fase 2

- injetar attachments em providers compatíveis
- registrar attachments no run state

### Fase 3

- suportar arquivos não-imagem
- suportar referências estruturadas de arquivo/trecho

---

## Testes Necessários

- agent mode com screenshot em modelo com visão
- agent mode com screenshot em modelo sem visão
- mistura de texto + imagem
- attachments múltiplos
- cancel/continue sem perder contexto do attachment

---

## Critério de Sucesso

Nenhum attachment deve parecer suportado em agent mode sem de fato ser entregue ao runtime do agente.
