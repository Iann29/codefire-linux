# Indexing System Fix Plans — Overview

**Data**: 2026-03-14
**Escopo**: Correcao completa do sistema de indexacao do Pinyino
**Status**: Planejamento

---

## Contexto

O sistema de indexacao do Pinyino apresenta problemas de lentidao e crash. A analise tecnica completa identificou **7 riscos criticos** no pipeline de indexacao, desde o trigger ate o consumo dos dados indexados.

## Planos de Correcao

Cada plano e independente e pode ser implementado separadamente, mas a ordem sugerida maximiza impacto e minimiza risco.

### Ordem de Implementacao Sugerida

| Ordem | Plano | Arquivo | Impacto | Risco | Esforco |
|-------|-------|---------|---------|-------|---------|
| 1 | Smart Reindex Guard | `01-smart-reindex-guard.md` | Alto | Baixo | Pequeno |
| 2 | Controle de Concorrencia + Fila | `02-concurrency-control.md` | Alto | Medio | Medio |
| 3 | Abort/Cancellation | `03-abort-cancellation.md` | Medio | Baixo | Pequeno |
| 4 | Worker Thread para Indexacao | `04-worker-thread-indexing.md` | Critico | Alto | Grande |
| 5 | Otimizacao de Busca Vetorial | `05-vector-search-optimization.md` | Alto | Medio | Medio |
| 6 | Lifecycle de Embeddings | `06-embedding-lifecycle.md` | Medio | Baixo | Pequeno |
| 7 | Progress Reporting | `07-progress-reporting.md` | Medio | Baixo | Medio |

### Logica da Ordem

1. **Smart Reindex Guard** primeiro porque e a correcao mais simples com maior impacto imediato — elimina reindexacoes desnecessarias.
2. **Concurrency Control** segundo porque sem ele, todas as outras correcoes ficam frageis — races continuarao existindo.
3. **Abort/Cancellation** terceiro porque e pre-requisito leve para o worker thread e ja resolve vazamentos de operacoes.
4. **Worker Thread** quarto — e a maior mudanca arquitetural, mas com os guards e concurrency ja no lugar, o risco de regressao e menor.
5. **Busca Vetorial** quinto — otimiza o read path que e o principal gargalo pos-indexacao.
6. **Embedding Lifecycle** sexto — refinamento do pipeline de embeddings.
7. **Progress Reporting** por ultimo — melhoria de UX que depende da infra correta.

### Arquivos Centrais Afetados

```
electron/src/main/services/ContextEngine.ts          — Planos 1, 2, 3, 4, 6, 7
electron/src/main/services/FileWatcher.ts             — Plano 2
electron/src/main/services/EmbeddingClient.ts         — Plano 6
electron/src/main/services/SearchEngine.ts            — Plano 5
electron/src/main/database/dao/ChunkDAO.ts            — Plano 5
electron/src/main/database/dao/IndexDAO.ts            — Planos 1, 2, 7
electron/src/main/database/search/hybrid-search.ts    — Plano 5
electron/src/main/database/search/vector-search.ts    — Plano 5
electron/src/main/ipc/search-handlers.ts              — Planos 2, 3, 7
electron/src/main/index.ts                            — Planos 2, 4
electron/src/renderer/layouts/ProjectLayout.tsx        — Planos 1, 7
electron/src/shared/types.ts                          — Plano 7
electron/src/shared/models.ts                         — Plano 7
```

### Regra de Versionamento

Conforme CLAUDE.md, cada mudanca no codigo DEVE bumpar a versao em `electron/package.json`. A sugestao e:

- Planos 1-3 (guards e concurrency): **1.28.0** (minor — melhoria significativa de estabilidade)
- Plano 4 (worker thread): **1.29.0** (minor — mudanca arquitetural)
- Planos 5-6 (otimizacoes): **1.30.0** (minor — melhoria de performance)
- Plano 7 (progress): **1.31.0** (minor — nova feature de UX)
