# Content Studio Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** transformar o CodeFire em um workspace editorial para páginas web, unindo contexto da rota, copy, assets visuais, SEO pack e tarefas de conteúdo em artefatos duráveis.

---

## Problema

Hoje é fácil usar um chat para “pedir um texto”, mas isso não resolve o trabalho de conteúdo de um site.

O fluxo real envolve:

- entender a página atual
- comparar copy existente
- gerar variações
- escrever SEO pack
- planejar FAQ e CTA
- gerar ou revisar imagem OG
- salvar isso de forma encontrável e versionável

Sem isso, o app corre o risco de virar apenas “chat com copy”.

---

## O que já existe na codebase

- `src/renderer/views/ImagesView.tsx`
  - já gera imagens por projeto
  - já mantém histórico
- `src/main/ipc/image-handlers.ts`
  - persistência de imagens
- `src/main/database/dao/ImageDAO.ts`
  - artefatos de imagem por projeto
- `src/renderer/components/Images/ImageViewer.tsx`
  - já tem fluxo de variação, embora a linhagem ainda não esteja bem usada
- `src/main/database/migrations/index.ts`
  - schema já prevê `parentImageId`
- `src/main/database/dao/NoteDAO.ts`
  - já persiste notes em markdown
- `src/renderer/components/Notes/NoteEditor.tsx`
  - já suporta edição e preview
- `src/renderer/components/Chat/CodeFireChat.tsx`
  - já exporta conversa para note e task
- `src/main/services/SearchEngine.ts`
  - já permite buscar contexto existente
- `src/main/services/ContextEngine.ts`
  - já conhece o projeto

### Gaps relevantes

- `ImageGenerationService` mantém `conversationHistory` global e isso pode contaminar gerações entre projetos/ativos.
- imagens usam fluxo de chave/provider diferente do chat, o que tende a criar inconsistência operacional.
- `Note` ainda não modela rota, canal, variante, aprovação nem vínculo formal com imagem.

---

## Visão da Feature

O `Content Studio` deve gerar e organizar pacotes de conteúdo por página.

Pacotes possíveis:

- `Landing Copy Pack`
- `SEO Pack`
- `CTA Variants`
- `FAQ Pack`
- `OG / Social Pack`
- `Service Page Draft`

Cada pacote deve poder ligar:

- rota
- texto
- assets visuais
- fonte de contexto
- status de revisão
- tasks relacionadas

---

## UX Proposta

### Entrada

O usuário abre uma rota no Browser ou seleciona um arquivo/página do projeto e clica `Create Content Pack`.

Escolhe o tipo:

- `Rewrite page copy`
- `Generate SEO pack`
- `Create CTA variants`
- `Build FAQ`
- `Create OG concept`

### Geração

O sistema usa:

- DOM da página atual
- notas existentes
- copy já presente no projeto
- contexto do codebase
- imagens relacionadas

### Saída

Salvar como artefato durável, não só como conversa:

- note estruturada
- imagens associadas
- tasks editoriais opcionais

---

## Estratégia Recomendada da V1

### Sem migration inicial obrigatória

É possível entregar valor usando estruturas existentes:

- imagens finais em `generatedImages`
- copy em `notes`
- tarefas em `taskItems`

### Convenção sugerida para notes

Salvar markdown com frontmatter simples:

- `kind`
- `route`
- `status`
- `linkedImageIds`
- `sourceConversationId`

Isso já dá persistência útil sem criar modelo novo imediatamente.

### Quando virar entidade própria

Se a feature crescer, criar:

- `contentPackages`
- `contentArtifacts`

com campos formais de:

- rota
- owner
- status
- variante A/B
- canal
- relação com imagem e chat

---

## Arquitetura Recomendada

### Coleta de contexto

Criar pipeline que combine:

- DOM da rota atual
- notas do projeto
- conteúdo do codebase
- imagens ligadas ao projeto

### Geração

Usar provider stack consistente com o resto do app.

Evitar fluxos paralelos e desconectados para texto e imagem.

### Persistência

V1:

- `notes`
- `generatedImages`
- `taskItems`

V2:

- entidades editoriais próprias

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/ImagesView.tsx`
- `src/renderer/components/Images/ImageViewer.tsx`
- `src/renderer/components/Notes/NoteEditor.tsx`
- `src/renderer/components/Chat/CodeFireChat.tsx`
- `src/main/services/ImageGenerationService.ts`
- `src/main/services/SearchEngine.ts`
- `src/main/services/ContextEngine.ts`
- novos módulos em `src/main/services/content-studio/*`
- `src/main/database/migrations/index.ts` se houver entidades próprias

---

## Fases de Entrega

### Fase 1

- geração de packs baseados em rota
- save em note estruturada
- vínculo com imagens já existentes
- tasks editoriais rápidas

### Fase 2

- templates por tipo de página
- variantes A/B
- melhor linhagem de imagem
- melhor vínculo note <-> image <-> conversation

### Fase 3

- entidade própria de conteúdo
- status editorial
- aprovação e histórico mais formal

---

## Riscos

### Virar só “chat com copy”

Mitigação: toda saída importante deve virar artefato persistido, não apenas resposta na conversa.

### Contaminação entre gerações

Mitigação: corrigir o escopo do `conversationHistory` de imagens por projeto ou por asset.

### Provider UX inconsistente

Mitigação: alinhar chaves, providers e observabilidade com o stack central do app.

---

## Critérios de Sucesso

- gerar material de conteúdo útil a partir da página real
- salvar esse material de forma encontrável e reutilizável
- conectar copy, SEO e asset visual no mesmo fluxo
- evitar perda de contexto entre chat, note e imagem

---

## Resultado Esperado

O `Content Studio` deve ser o lugar onde o conteudo do site deixa de ser uma conversa efemera e passa a virar ativo operacional do projeto: revisavel, ligado a rota certa e combinavel com assets visuais.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/content-studio/ContentStudioService.ts` (novo)
- `src/main/ipc/content-studio-handlers.ts` (novo)
- `src/renderer/components/Browser/ContentStudioSheet.tsx` (novo)
- `src/renderer/views/BrowserView.tsx` (modificado - integracao no footer)

### Observacoes:
- Fase 1 (V1) implementada conforme planejado
- Geracao de content packs (SEO, copy, CTA, FAQ, OG concept)
- Templates em markdown baseados em contexto da pagina
- Integracao verificada com TypeScript --noEmit
