# Contextual Browser Screenshot Spec

> **Date:** 2026-03-10
> **Status:** OPEN
> **Owner:** Browser + Project Intelligence

## Summary

Adicionar um modo de screenshot no Browser que não gera apenas a imagem da página, mas uma evidência contextual composta por:

- screenshot da página
- URL/path atual
- rota da aplicação e arquivo da codebase que atende essa rota
- componentes mais prováveis daquela página
- arquivos backend relacionados, com nível de confiança

O objetivo é transformar um screenshot em um artefato útil tanto para o usuário quanto para o agente, sem exigir que o modelo redescubra manualmente a estrutura da página.

## Product Decision

O Browser passa a ter dois modos de captura:

- `Context Shot` como ação principal do botão de câmera
- `Raw Shot` como fallback no menu secundário

`Context Shot` deve:

1. capturar a página atual
2. resolver contexto de rota/componentes/backend
3. compor uma imagem anotada
4. anexar a imagem no chat composer
5. preservar metadados estruturados para uso posterior do agente

## Goals

- Tornar screenshots autoexplicativos dentro do app.
- Ligar runtime evidence com codebase truth.
- Reduzir prompts do tipo "qual arquivo renderiza isso?" depois de um screenshot.
- Reaproveitar a infraestrutura já existente de route discovery, component graph e reference graph.

## Non-Goals

- Fazer inferência perfeita de "todo backend usado na página".
- Construir AST parser novo neste MVP.
- Alterar o comportamento de `Capture Issue`.
- Resolver mapping profundo de dataflow entre todos os hooks, serviços e requests.

## User Experience

Ao clicar em `Context Shot`, o usuário vê um estado curto de loading no botão. Em seguida:

- o chat abre automaticamente
- o attachment já entra como imagem
- a imagem final contém a screenshot + um rail contextual

Layout recomendado da imagem composta:

- screenshot original à esquerda
- rail fixo à direita com largura entre `280px` e `340px`
- fallback para rail inferior quando a viewport capturada for estreita

Conteúdo visível no rail:

- `Page`: pathname + host
- `Route`: rota detectada + arquivo da rota
- `Components`: até 8 componentes visíveis, com `+N more`
- `Backend`: até 6 arquivos/targets visíveis, com badge de confiança

## Confidence Model

Cada item contextual precisa de `confidence`.

- `confirmed`: evidência direta
- `inferred`: inferência por proximidade estrutural
- `none`: sem match utilizável

Exemplos:

- rota estática com match exato: `confirmed`
- rota dinâmica `[id]` que casa com o pathname atual: `confirmed`
- componente importado/renderizado diretamente pelo arquivo da rota: `confirmed`
- backend vindo de request observada em runtime e mapeada para `/api/...`: `confirmed`
- arquivo backend sugerido por heurística de import path ou convenção: `inferred`

## Architecture

### Renderer responsibilities

- capturar a imagem bruta via `webview.capturePage()`
- coletar runtime evidence da aba atual
- pedir ao main process o contexto semântico da página
- compor a imagem anotada em `canvas`
- anexar a imagem e os metadados ao chat composer

### Main responsibilities

- resolver a rota atual a partir de `pageUrl`
- mapear arquivo de rota
- extrair componentes relacionados ao arquivo da rota
- inferir superfície backend usando graph + runtime evidence
- devolver um objeto estruturado e serializável

## Proposed Contract

Novo canal IPC:

```ts
type BrowserChannel = 'browser:clearSession' | 'browser:resolvePageContext'
```

Entrada:

```ts
interface ResolvePageContextInput {
  projectPath: string
  pageUrl: string
  pageTitle?: string | null
  runtimeRequests?: Array<{
    url: string
    method?: string
    type?: string
  }>
}
```

Saída:

```ts
interface PageContextEvidence {
  capturedAt: string
  pageUrl: string
  pageTitle: string | null
  route: {
    pathname: string
    matchedPath: string | null
    filePath: string | null
    routeType: 'static' | 'dynamic' | 'api' | 'catch-all' | 'unknown' | null
    framework: string | null
    confidence: 'confirmed' | 'inferred' | 'none'
  }
  components: Array<{
    name: string
    filePath: string
    relation: 'route-export' | 'direct-import' | 'direct-render' | 'one-hop-render'
    confidence: 'confirmed' | 'inferred'
  }>
  backend: Array<{
    label: string
    filePath: string | null
    kind: 'api-route' | 'server-action' | 'supabase-function' | 'network-endpoint'
    relation: 'observed-request' | 'direct-import' | 'route-companion' | 'convention-match'
    confidence: 'confirmed' | 'inferred'
  }>
}
```

## Route Resolution

Criar um resolvedor novo em vez de acoplar isso ao UI.

Arquivo sugerido:

- `electron/src/main/services/browser/ContextualScreenshotService.ts`

Fluxo:

1. usar `new URL(pageUrl).pathname`
2. chamar `RouteDiscoveryService.analyzeProject(projectPath)`
3. rankear candidates:
   - match estático exato primeiro
   - match dinâmico depois
   - catch-all por último
4. retornar `matchedPath` + `filePath`

Regra de matching necessária:

- `[id]` -> um segmento
- `[...slug]` -> um ou mais segmentos
- `[[...slug]]` -> zero ou mais segmentos

## Component Resolution

Fonte principal: `ComponentGraphService`.

Estratégia:

1. incluir o componente exportado pelo próprio `route.filePath`, quando existir
2. incluir edges `imports` e `renders` originadas do arquivo da rota
3. incluir um hop adicional opcional a partir dos componentes diretamente renderizados
4. deduplicar por `filePath + name`
5. ordenar por:
   - relação mais próxima da rota
   - `renderCount`
   - `importCount`

Limite recomendado:

- até 20 componentes no payload
- até 8 componentes visíveis na composição da imagem

## Backend Resolution

MVP deve priorizar evidência forte.

Ordem de coleta:

1. `runtimeRequests` same-origin com prefixo `/api/`
2. mapping de `/functions/v1/:name` para `supabase/functions/:name/index.ts`
3. imports diretos do route file ou de componentes de primeiro hop para arquivos com `'use server'`
4. companions convencionais como `route.ts` no mesmo segmento, marcados como `inferred`

Importante:

- não chamar tudo de backend "da página" sem confidence
- quando não houver evidência forte, mostrar pouco e marcar como `inferred`

## Runtime Evidence

O Browser já tem captura parcial de network via console observer, mas hoje isso depende do DevTools panel.

Para o MVP, o BrowserView deve manter uma coleta leve por aba:

- `performance.getEntriesByType('resource')` na captura
- filtro para requests HTTP relevantes
- deduplicação por URL

Futuro desejável:

- monkeypatch de `fetch` e `XMLHttpRequest` injetado no page load para melhorar a confiança

## Attachment Model

Hoje `ChatAttachment` só guarda imagem crua. Para a feature ficar realmente útil ao agente, precisamos persistir contexto.

Mudanças propostas:

- adicionar `metadata?: Record<string, unknown>` em `ChatAttachment`
- adicionar `metadataJson` em `chatMessageAttachments`

Se isso ficar pesado para o primeiro corte, o fallback aceitável é:

- compor a informação visualmente na imagem
- deixar a persistência estruturada para a fase seguinte

## Renderer Composition

Criar utilitário novo:

- `electron/src/renderer/components/Browser/composeContextualScreenshot.ts`

Responsabilidades:

- carregar screenshot base em `Image`
- calcular layout final
- desenhar rail contextual
- renderizar badges de confiança
- truncar listas longas com `+N more`

A composição deve usar tema consistente com o Browser atual e manter legibilidade em escala reduzida.

## Files Expected To Change

- `electron/src/renderer/layouts/ProjectLayout.tsx`
- `electron/src/renderer/views/BrowserView.tsx`
- `electron/src/renderer/components/Browser/BrowserToolbar.tsx`
- `electron/src/renderer/lib/api.ts`
- `electron/src/shared/models.ts`
- `electron/src/shared/types.ts`
- `electron/src/main/ipc/browser-handlers.ts`
- `electron/src/main/ipc/index.ts`
- `electron/src/main/services/routes/RouteDiscoveryService.ts`

Arquivos novos prováveis:

- `electron/src/main/services/browser/ContextualScreenshotService.ts`
- `electron/src/renderer/components/Browser/composeContextualScreenshot.ts`
- `electron/src/__tests__/services/contextual-screenshot-service.test.ts`

## Implementation Phases

### Phase 1

- `browser:resolvePageContext`
- matching de rota
- componentes de primeiro hop
- backend por requests `/api/*` e Supabase Functions
- composição visual da imagem

### Phase 2

- persistência de `metadataJson` em attachments
- extração de server actions via import graph
- um hop adicional de componentes
- atalho para o agente consumir contexto estruturado sem OCR

## Acceptance Criteria

- Um clique no botão principal gera `Context Shot` e anexa no chat.
- A imagem final mostra pathname e arquivo da rota quando houver match.
- A feature não quebra em projetos sem framework suportado; cai para contexto parcial.
- Requests `/api/*` observados na página aparecem como backend relacionado quando o arquivo existe.
- O payload estruturado diferencia `confirmed` de `inferred`.
- Primeira captura pode ser mais lenta, mas capturas subsequentes devem reaproveitar caches existentes.

## Main Risks

- `ComponentGraphService` atual é heurístico e pode perder componentes não convencionais.
- route matching para frameworks além de Next pode exigir regras adicionais.
- composição visual excessiva pode poluir a screenshot se não houver limite e truncamento.
- sem persistência estruturada, o agente depende mais de OCR do que do ideal.

## Recommendation

Começar pelo Phase 1 com foco em Next.js e Vite/React, porque a base atual já favorece esse caminho. O maior ganho vem de unir screenshot + route file + components + runtime `/api` evidence em um único attachment confiável.
