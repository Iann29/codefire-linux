# Chat Attachments, Browser Screenshot Routing, and File Mentions Plan

> **Date:** 2026-03-08
> **Status:** PROPOSTO
> **Objetivo:** transformar o Chat Mode em um composer multimodal de verdade, com screenshot do browser enviada direto para o chat, suporte a imagens/arquivos e `@` menções de arquivos da codebase.

---

## Problema

Hoje o fluxo de contexto para o Chat Mode é pobre demais para desenvolvimento real:

- o botão de screenshot do browser abre uma nova janela via `window.open`, em vez de alimentar o chat
- o chat aceita apenas texto em um `textarea`
- não existe suporte nativo para anexar imagem, arquivo ou evidência
- não existe `@` menção de arquivos da codebase como em Codex ou Claude Code
- `ChatMessage` hoje é apenas `content: string`

Isso limita muito o valor do Chat Mode para:

- pedir análise de screenshot
- mandar evidência visual de bug
- mandar arquivo de log ou export
- referenciar componentes, páginas e configs explicitamente

---

## O que já existe na codebase

- `src/renderer/components/Browser/BrowserToolbar.tsx`
  - já dispara `onScreenshot`
- `src/renderer/views/BrowserView.tsx`
  - `handleScreenshot()` hoje só faz `window.open` com `img.toDataURL()`
- `src/renderer/components/Chat/CodeFireChat.tsx`
  - composer atual é só `textarea`
  - já conhece modelos com capability `vision`
  - já tem streaming, provider routing e contexto via RAG
- `src/shared/models.ts`
  - `ChatMessage` ainda só guarda texto
- `src/main/ipc/chat-handlers.ts`
  - caminho de persistência do chat ainda é textual
- `src/main/services/SearchEngine.ts`
  - base natural para busca de arquivos e sugestões de menção
- `src/renderer/views/FilesView.tsx` e `FileTree`
  - já existe navegação de arquivos no projeto

### Leitura estrutural

O app já tem boa infra de chat, mas ainda não tem um modelo de entrada rica. O gargalo não é só UI; é modelo de mensagem, persistência e adaptação por provider.

---

## Visão da Feature

Essa evolução deve entregar quatro capacidades que se reforçam:

### 1. Screenshot -> Chat

Ao clicar no botão de screenshot no Browser:

- se o Chat Mode estiver aberto, a imagem entra direto no composer
- se o chat estiver fechado, ele pode ser aberto automaticamente com a evidência pré-anexada
- opcionalmente já preencher contexto como URL e título da página

### 2. Attachments no Chat

O composer deve aceitar:

- imagens
- arquivos de texto
- PDFs
- logs
- arquivos arbitrários, com política clara do que pode ser enviado ao modelo

### 3. `@` File Mentions

Ao digitar `@`, o chat deve sugerir arquivos da codebase aberta:

- componentes
- configs
- páginas
- `.env.example`
- markdowns

### 4. Context refs estruturadas

Menções e anexos não devem ser apenas texto colado. Devem virar contexto estruturado no pipeline de envio.

---

## UX Proposta

### Composer novo

Substituir o input “texto puro” por um composer com:

- textarea principal
- botão de anexar
- área de chips de attachments
- sugestões de `@` menção
- suporte a drag and drop
- suporte a paste de imagem

### Screenshot do Browser

Novo fluxo do botão da câmera:

1. capturar imagem
2. criar attachment no composer do chat
3. adicionar metadados úteis:
   - URL
   - title
   - timestamp
   - opcionalmente console warnings

### Menções

Ao digitar `@`:

- busca incremental sobre arquivos do projeto
- enter seleciona
- chip aparece no composer

Ao enviar:

- o modelo recebe snippet ou conteúdo do arquivo conforme regra de tamanho

---

## Estratégia Técnica Recomendada

### Separar composer de mensagem persistida

Criar um estado explícito de composer:

- `draftText`
- `draftAttachments`
- `draftContextRefs`

Isso não deve ficar misturado diretamente com `ChatMessage`.

### Modelo sugerido

Adicionar tipos como:

- `ChatAttachment { id, kind, name, mimeType, filePath, size, previewPath, source }`
- `ChatContextRef { id, type, label, filePath, lineStart, lineEnd, source }`
- `ChatMessagePart { type, text?, attachmentId?, contextRefId? }`

Persistência futura recomendada:

- ampliar `chatMessages`
- criar `chatMessageAttachments`
- criar `chatMessageContextRefs`

### Screenshot routing

Em vez de `window.open`, o Browser deve publicar um evento interno ou usar store compartilhada:

- `chat:queueAttachment`
- ou estado global em contexto/store

Recomendação:

- usar store compartilhada de UI para composer
- evitar dependência frágil em eventos globais soltos

### Armazenamento de attachment

Não manter só `dataUrl` em memória.

Salvar attachment temporário em disco, em pasta dedicada, para:

- reabrir draft
- persistir mensagem enviada
- anexar a tasks depois

### Provider adaptation

Esse ponto é crítico:

- OpenRouter tem caminho multimodal
- providers de assinatura podem ter diferenças de payload
- alguns modelos não têm `vision`

O composer deve validar capability antes do envio e escolher uma destas estratégias:

- enviar imagem nativamente
- avisar incompatibilidade
- sugerir mudança de modelo

### Menções de arquivo

Reaproveitar `SearchEngine` e/ou árvore de arquivos para sugerir arquivos.

Na hora do envio:

- para arquivo curto, incluir conteúdo relevante
- para arquivo grande, incluir snippet + path
- para menção ambígua, pedir confirmação

---

## Arquivos Prováveis de Implementação

- `src/renderer/components/Chat/CodeFireChat.tsx`
- novos componentes em `src/renderer/components/Chat/*`
- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/BrowserToolbar.tsx`
- `src/main/ipc/chat-handlers.ts`
- `src/main/services/providers/*`
- `src/main/services/SearchEngine.ts`
- `src/shared/models.ts`
- `src/main/database/migrations/index.ts`

---

## Fases de Entrega

### Fase 1

- screenshot do browser enviada para o composer do chat
- attachments locais básicos
- preview visual no composer
- validação de capability `vision`

### Fase 2

- `@` menções de arquivo com autocomplete
- resolução de snippet/path no envio
- drag and drop e paste de imagem

### Fase 3

- persistência formal de attachments/context refs
- histórico reabrível
- menções mais ricas de símbolo, não só arquivo

---

## Riscos

### Divergência entre providers

Mitigação: criar camada de payload multimodal por provider, não colocar lógica ad hoc no componente React.

### Contexto explodir com arquivos longos

Mitigação: menções precisam de budget, truncamento e preview do que vai realmente para o modelo.

### Attachment efêmero demais

Mitigação: salvar em storage temporário controlado, com lifecycle claro.

### UX quebrada quando chat está fechado

Mitigação: política explícita.

Sugestão:

- se o chat estiver fechado, abrir o painel automaticamente ao enviar screenshot

---

## Critérios de Sucesso

- screenshot do browser vai para o chat sem abrir janela inútil
- usuário consegue anexar imagem e arquivo de forma natural
- `@` menção de arquivos funciona rápido e com baixo ruído
- o Chat Mode passa a aceitar contexto real de desenvolvimento, não apenas texto livre

---

## Resultado Esperado

Esse plano transforma o Chat Mode de caixa de texto em estação de trabalho contextual. O ganho não é cosmético; ele muda a qualidade do contexto que a IA recebe e, portanto, a qualidade da ajuda que ela consegue dar.
