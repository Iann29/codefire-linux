# Design System Map Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** mapear tokens, padrões visuais, componentes, estilos e inconsistências do frontend para dar ao CodeFire uma leitura real do design system do projeto.

---

## Problema

Em projetos web maduros, o design system existe mesmo quando não foi formalizado. Ele está espalhado por:

- CSS variables
- Tailwind config
- classes utilitárias
- componentes base
- temas
- tokens em JS/TS
- ícones, fontes e spacing decisions

Hoje o CodeFire indexa código para busca, mas não consegue responder perguntas como:

- quais são as cores de marca do projeto?
- existem botões duplicados?
- quantas tipografias diferentes estão sendo usadas?
- esse projeto usa CSS variables, Tailwind, CSS Modules ou styled-components?
- quais componentes consomem quais tokens?

---

## O que já existe na codebase

- `src/renderer/views/VisualizerView.tsx`
  - hoje é placeholder e tem espaço ideal para essa visão
- `src/main/services/ContextEngine.ts`
  - já indexa arquivos
- `src/main/services/CodeChunker.ts`
  - já cria chunks pesquisáveis
- `src/main/services/SearchEngine.ts`
  - já dá busca híbrida
- `src/main/services/FileWatcher.ts`
  - base natural para atualização incremental
- `src/renderer/components/Files/CodeViewer.tsx`
  - já permite abrir rapidamente a origem de qualquer item

### Gap estrutural

O índice atual é orientado a chunks, não a entidades visuais.

Para `Design System Map`, isso não basta. É necessário um modelo derivado, próprio, que entenda:

- token
- componente
- fonte de estilo
- relação entre token e componente

---

## Visão da Feature

O `Design System Map` deve produzir uma leitura visual do projeto em quatro frentes:

### 1. Tokens

- cores
- spacing
- radius
- shadow
- typography
- z-index

### 2. Padrões de UI

- botões
- inputs
- cards
- badges
- modais
- headers e footers

### 3. Stack visual

- Tailwind
- CSS Modules
- styled-components
- plain CSS
- theme objects

### 4. Inconsistências

- valores quase iguais
- duplicação de tokens
- classes repetitivas
- componentes visuais paralelos

---

## UX Proposta

Dentro de `VisualizerView`, trocar placeholders por painéis reais:

- `Token Catalog`
- `Component Families`
- `Style Sources`
- `Inconsistencies`

Cada item precisa abrir:

- valor
- origem
- onde aparece
- arquivos relacionados

Exemplo de leitura:

- `Primary Blue`
- valor `#3B82F6`
- definido em `tailwind.config.ts`
- usado em 18 componentes
- tocado em 2 PRs recentes

---

## Estratégia Técnica Recomendada

### Não forçar isso em `codeChunks`

O `codeChunks` atual é excelente para search, mas ruim para representar relações visuais.

Criar uma camada derivada:

- `DesignToken`
- `DesignComponent`
- `DesignSystemSnapshot`

Campos sugeridos:

- `DesignToken { id, projectId, kind, name, value, normalizedValue, namespace, sourceFile, sourceLine, sourceType }`
- `DesignComponent { id, projectId, name, filePath, styleSources, tokenRefs }`
- `DesignSystemSnapshot { projectId, generatedAt, tokenCount, componentCount, frameworks }`

### Extração

Criar analisadores específicos para:

- CSS variables
- Tailwind config
- classes utilitárias frequentes
- componentes React/Vue/Svelte base
- temas JS/TS

### Atualização incremental

Usar `FileWatcher` para recomputar só os artefatos afetados, evitando reindexação total a cada mudança.

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/VisualizerView.tsx`
- novos componentes em `src/renderer/components/Visualizer/*`
- `src/main/services/ContextEngine.ts`
- `src/main/services/FileWatcher.ts`
- novos módulos em `src/main/services/design-system/*`
- `src/main/ipc/search-handlers.ts` ou novos handlers dedicados
- `src/main/database/migrations/index.ts`

---

## Fases de Entrega

### Fase 1

- detectar stack visual principal
- extrair tokens básicos
- catálogo inicial de cores, fontes e spacing

### Fase 2

- relacionar tokens com componentes
- famílias visuais
- inconsistências simples

### Fase 3

- overlay de churn via git
- overlays de PR aberto via GitHub
- snapshots comparáveis ao longo do tempo

---

## Riscos

### Regex noise

Mitigação: usar analisadores específicos por stack em vez de regex genérica sobre tudo.

### Código gerado ou vendor poluir resultados

Mitigação: reaproveitar filtros do indexador e excluir fontes irrelevantes.

### Divergência entre token estático e estilo runtime

Mitigação: tratar V1 como mapa do design system definido no código, não do estilo computado final.

---

## Critérios de Sucesso

- identificar rapidamente stack visual e tokens-chave
- ajudar a localizar inconsistências reais
- servir como referência viva do frontend
- tornar o `Visualizer` finalmente útil

---

## Resultado Esperado

O `Design System Map` deve dar ao CodeFire uma memoria visual do projeto. Em vez de o design system ficar implicito no codigo, ele passa a ser navegavel, pesquisavel e operacional.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/design-system/DesignSystemService.ts` (novo)
- `src/main/ipc/design-system-handlers.ts` (novo)
- `src/renderer/components/Visualizer/DesignSystemPanel.tsx` (novo)
- `src/renderer/views/VisualizerView.tsx` (modificado - sub-tab "Design System")

### Observacoes:
- Fase 1 implementada conforme planejado
- Extracao de tokens (CSS variables, Tailwind config, theme objects)
- Deteccao de style stack
- Identificacao de inconsistencias
- Integracao verificada com TypeScript --noEmit
