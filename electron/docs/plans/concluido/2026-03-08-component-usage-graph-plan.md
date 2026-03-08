# Component Usage Graph Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** construir um grafo navegável de componentes, imports, renderização e rotas para entender impacto, reuso e pontos críticos do frontend.

---

## Problema

Hoje o CodeFire encontra texto e arquivos, mas ainda não responde bem perguntas estruturais:

- onde esse componente é usado?
- quais rotas dependem dele?
- quais arquivos de estilo o afetam?
- quais outros componentes ele renderiza?
- se eu mudar isso, o que pode quebrar?

Esse tipo de visibilidade é fundamental para refactor, manutenção de sites, onboarding e auditoria visual.

---

## O que já existe na codebase

- `src/renderer/views/VisualizerView.tsx`
  - local ideal para visualização do grafo
- `src/main/services/ContextEngine.ts`
  - base para indexação
- `src/main/services/CodeChunker.ts`
  - extração genérica de símbolos
- `src/main/services/SearchEngine.ts`
  - busca textual e híbrida
- `src/main/services/FileWatcher.ts`
  - atualização incremental
- `src/renderer/components/Files/FileTree.tsx`
  - navegação para origem
- `src/renderer/components/Files/CodeViewer.tsx`
  - inspeção e edição

### Gap estrutural

O índice atual não resolve:

- import/export graph
- barrel exports
- render graph
- alias resolution
- relação componente -> rota

Para isso, é necessário um extrator semântico dedicado.

---

## Visão da Feature

O `Component Usage Graph` deve permitir:

- selecionar um componente
- ver quem importa
- ver quem ele importa
- ver quais componentes ele renderiza
- ver em quais rotas aparece
- ver seus estilos relacionados
- ver indicadores de churn e risco

Essa feature complementa o `Design System Map`: uma mostra a linguagem visual; a outra mostra a topologia do frontend.

---

## UX Proposta

Dentro de `VisualizerView`, adicionar uma experiência em dois níveis:

### Lista / busca

- buscar componente por nome
- filtrar por pasta, rota ou framework

### Grafo + painel lateral

No centro:

- nós e arestas

Na lateral:

- arquivo origem
- exports
- props relevantes
- arquivos que usam
- rotas ligadas
- estilos ligados
- commits recentes

### Ações

- abrir arquivo
- abrir rota relacionada
- abrir diff recente
- gerar task

---

## Estratégia Técnica Recomendada

### AST first

Essa feature não deve nascer em cima de regex solta.

Para TS/JS, usar parsing AST para extrair:

- importações
- exportações
- declaração de componente
- JSX render tree básica
- dynamic imports
- aliases quando possível

### Modelo sugerido

- `ComponentNode { id, projectId, name, filePath, exportName, framework, isDefaultExport, propsShape }`
- `ComponentEdge { id, projectId, fromNodeId, toNodeId, relation, sourceFile, sourceLine }`
- `ComponentUsageStats { nodeId, incomingCount, outgoingCount, routeCount, recentCommitCount }`

Relações úteis:

- `imports`
- `re-exports`
- `renders`
- `routes-to`
- `styles-with`

### Atualização incremental

Usar `FileWatcher` e recomputar nós e arestas afetados por arquivo.

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/VisualizerView.tsx`
- novos componentes em `src/renderer/components/Visualizer/*`
- `src/main/services/ContextEngine.ts`
- `src/main/services/FileWatcher.ts`
- novos módulos em `src/main/services/component-graph/*`
- `src/main/services/GitService.ts`
- `src/main/database/migrations/index.ts`

---

## Integrações Naturais

- `GitService` para churn, risco e arquivos mais tocados
- `GitHubService` para overlay de PRs e mudanças abertas
- `Route Map + Crawl` para ligar componente às rotas reais
- `Design System Map` para exibir tokens e estilos relacionados

---

## Fases de Entrega

### Fase 1

- grafo de import/export para TS/JS
- busca por componente
- painel lateral com usos diretos

### Fase 2

- render graph básico
- ligação com rotas
- stats de impacto

### Fase 3

- overlays de git e GitHub
- melhor suporte a aliases e barrel exports
- suporte gradual a stacks além de React/TS

---

## Riscos

### Confundir helper com componente

Mitigação: heurísticas explícitas e AST para JSX/TSX.

### Monorepo explodir escala do grafo

Mitigação: filtros por pasta, app, pacote e profundidade.

### Resolução imperfeita de barrel exports e dynamic imports

Mitigação: marcar arestas ambíguas e nunca fingir certeza onde não existe.

---

## Critérios de Sucesso

- localizar rapidamente todos os usos de um componente
- entender impacto de mudança sem abrir dezenas de arquivos
- apoiar refactor e debugging de frontend
- enriquecer o `Visualizer` com valor estrutural real

---

## Resultado Esperado

O `Component Usage Graph` deve fazer o CodeFire “entender” o frontend como sistema, nao apenas como colecao de arquivos. Isso aumenta muito a confianca para mudar codigo visual sem operar no escuro.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/component-graph/ComponentGraphService.ts` (novo)
- `src/main/ipc/component-graph-handlers.ts` (novo)
- `src/renderer/components/Visualizer/ComponentGraphPanel.tsx` (novo)
- `src/renderer/views/VisualizerView.tsx` (modificado - sub-tab “Components”)

### Observacoes:
- Fase 1 implementada conforme planejado
- Deteccao de declaracoes de componentes
- Extracao de arestas de import
- Deteccao de arestas de render JSX
- Calculo de import/render counts
- Integracao verificada com TypeScript --noEmit
