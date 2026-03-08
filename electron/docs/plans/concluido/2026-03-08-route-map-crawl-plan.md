# Route Map + Crawl Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** descobrir rotas reais do projeto a partir do código e validar, via browser, quais páginas existem, carregam bem e merecem atenção.

---

## Problema

Em projetos de site e app web, boa parte do tempo se perde em perguntas básicas:

- quais rotas esse projeto realmente tem?
- quais são públicas e quais dependem de autenticação?
- quais estão esquecidas?
- quais quebram?
- quais não têm título ou metadados?

Hoje o CodeFire indexa código, mas ainda não constrói uma visão de rotas. Isso limita bastante o valor da análise do projeto.

---

## O que já existe na codebase

- `src/main/services/ContextEngine.ts`
  - indexa arquivos do projeto
- `src/main/services/SearchEngine.ts`
  - permite busca sobre o índice
- `src/main/services/CodeChunker.ts`
  - já segmenta conteúdo em chunks úteis
- `src/renderer/components/Files/FileTree.tsx`
  - já mostra árvore de arquivos
- `src/renderer/components/Files/CodeViewer.tsx`
  - já permite inspeção de arquivos
- `src/renderer/views/BrowserView.tsx`
  - já permite validação real da rota aberta

Conclusão: o app já sabe “ler” o projeto e já sabe “abrir” o resultado. Falta amarrar as duas pontas.

---

## Visão da Feature

O `Route Map + Crawl` deve produzir dois resultados complementares:

### Route Map

Inventário estático do que o projeto provavelmente expõe como rota.

### Crawl

Validação runtime dessas rotas:

- carrega ou não
- status aparente
- título da página
- presence de `h1`
- console errors
- metadados mínimos

---

## Estratégia Recomendada

### Não tentar uma abstração universal

Cada framework expõe rotas de forma diferente. A solução correta é criar adapters:

- `Next.js App Router`
- `Next.js Pages Router`
- `React Router`
- `Astro`
- `Vite SPA simples`

Projetos não suportados devem ser explicitamente marcados como `Unsupported` em vez de gerar resultados ruins.

---

## UX Proposta

### Descoberta

Nova tela ou subpainel com:

- framework detectado
- lista de rotas inferidas
- origem da inferência
- tipo de rota: `static`, `dynamic`, `api`, `private`, `unknown`

### Crawl

O usuário seleciona:

- `crawl all`
- `crawl selected`
- `crawl public only`

Resultado por rota:

- URL
- status
- título
- `h1`
- console error count
- load outcome
- observações

### Ações

- abrir rota no Browser
- criar task
- exportar relatório

---

## Heurísticas de Descoberta

### Next.js App Router

- `app/page.tsx`
- `app/**/page.tsx`
- `generateStaticParams`
- rotas dinâmicas via `[slug]`

### Next.js Pages Router

- `pages/index.tsx`
- `pages/**/*.tsx`
- exclusão de `_app`, `_document`, `_error`, `api/*`

### React Router

- busca de `createBrowserRouter`, `Routes`, `Route`, `useRoutes`
- extração de `path=`

### Astro

- `src/pages/**/*.astro`
- `src/pages/**/*.md`

### SPA simples

- fallback para raiz `/`
- detecção de links navegáveis no DOM depois de subir a app

---

## Arquitetura Recomendada

### Camada de descoberta

Criar:

- `src/main/services/routes/frameworkDetectors/*`
- `src/main/services/routes/routeExtractors/*`
- `src/shared/routes/types.ts`

### Camada de crawl

Reaproveitar o browser para:

1. navegar
2. esperar carregamento
3. coletar sinais básicos
4. registrar sucesso ou falha

### Persistência recomendada

Criar:

- `routeMapRuns`
- `routeEntries`
- `routeCrawlRuns`
- `routeCrawlResults`

Isso permitirá histórico e comparação entre execuções.

---

## Arquivos Prováveis de Implementação

- `src/main/services/ContextEngine.ts`
- `src/main/services/SearchEngine.ts`
- novos módulos em `src/main/services/routes/*`
- novos handlers em `src/main/ipc/*`
- `src/renderer/views/VisualizerView.tsx` ou nova view específica
- `src/renderer/views/BrowserView.tsx`
- `src/main/database/migrations/index.ts`

---

## Fases de Entrega

### Fase 1

- detectar framework
- extrair rotas de Next.js e React Router
- listar rotas inferidas

### Fase 2

- crawl da rota via browser
- status por rota
- título, `h1`, console e metadados básicos

### Fase 3

- suporte a mais frameworks
- agrupamento por segmento
- integração com `Page Audit` e `Launch Guard`

---

## Riscos

### Falsa precisão em rotas dinâmicas

Mitigação: marcar rotas dinâmicas como templates e pedir parâmetros quando necessário.

### Crawl confundir autenticação com erro

Mitigação: classificar resultados como `redirected`, `auth-gated`, `error`, `ok`.

### Indexação genérica insuficiente

Mitigação: introduzir adapters específicos em vez de tentar resolver tudo com regex solta.

---

## Critérios de Sucesso

- gerar inventário de rotas confiável para frameworks suportados
- permitir abrir rapidamente qualquer rota descoberta
- identificar rotas quebradas ou mal configuradas
- servir de base para QA em lote

---

## Resultado Esperado

O `Route Map + Crawl` deve dar ao CodeFire uma noção concreta da superfície do projeto. Em vez de navegar “no escuro”, o usuário passa a enxergar quais páginas existem, quais importam e quais merecem correção imediata.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/routes/RouteDiscoveryService.ts` (novo)
- `src/main/ipc/route-handlers.ts` (novo)
- `src/renderer/components/Visualizer/RouteMapPanel.tsx` (novo)
- `src/renderer/views/VisualizerView.tsx` (modificado - integracao)

### Observacoes:
- Fase 1 implementada conforme planejado
- Deteccao de framework (Next.js App/Pages, React Router, Astro, Vite SPA)
- Extracao de rotas por framework
- Listagem de rotas inferidas com tipo e origem
- Integracao verificada com TypeScript --noEmit
