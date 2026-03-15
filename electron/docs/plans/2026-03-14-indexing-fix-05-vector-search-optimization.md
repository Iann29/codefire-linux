# Plano 05: Otimizacao da Busca Vetorial

**Data**: 2026-03-14
**Riscos Corrigidos**: #2 — Brute-force vector search loads all embeddings into RAM, #6 — Memory bloat in hybrid search
**Confianca na Causa**: ALTA
**Esforco**: Medio (~3-4h)
**Impacto**: Alto — reduz uso de memoria e latencia de busca significativamente

---

## Problema

### Problema A: Busca vetorial carrega tudo em RAM

Cada busca executa `ChunkDAO.getChunksWithEmbeddings(projectId)` que faz:

```sql
SELECT * FROM codeChunks WHERE projectId = ? AND embedding IS NOT NULL
```

Isso carrega **todos os chunks com embedding** do projeto inteiro para a memoria do processo. Para um projeto com 5,000 chunks e embeddings de 1536 dimensoes:

- 5,000 x Float32Array(1536) = 5,000 x 6,144 bytes = **~30 MB de embeddings**
- Mais todo o `content` text de cada chunk (varios MB adicionais)
- Isso acontece **em cada query** — sem cache entre queries

Localizado em: `ChunkDAO.ts:107-114`, chamado por `hybrid-search.ts:51-52`

### Problema B: Carga duplicada na merge phase

Alem do problema A, a merge phase em `hybrid-search.ts:73` carrega TODOS os chunks novamente:

```typescript
const allChunks = this.chunkDAO.listByProject(projectId)
const chunkMap = new Map(allChunks.map((c) => [c.id, c]))
```

Isso e redundante — os chunks ja foram retornados pelo FTS e pelo vector search. A carga duplicada dobra o pico de memoria.

### Problema C: Busca brute-force nao escala

A funcao `vectorSearch()` em `vector-search.ts:40-51` calcula cosine similarity contra **todos** os chunks:

```typescript
const scores = chunks.map((chunk) => ({
  id: chunk.id,
  score: cosineSimilarity(queryEmbedding, blobToFloat32Array(chunk.embedding)),
}))
```

Para 5,000 chunks x 1536 dimensoes: 5,000 x 1,536 multiplicacoes + somas. Isso e O(n) em cada query.

---

## Solucao Proposta

### Estrategia em 3 Camadas

1. **Curto prazo**: Eliminar cargas duplicadas e reduzir dados transferidos
2. **Medio prazo**: Implementar cache de embeddings em memoria com invalidacao
3. **Longo prazo**: Considerar indice vetorial aproximado (ANN) se o brute-force nao escalar

---

## Implementacao

### Passo 1: Eliminar carga duplicada na merge phase

**Arquivo**: `electron/src/main/database/search/hybrid-search.ts`

O merge nao precisa carregar todos os chunks — ele ja tem os dados dos resultados do FTS e vector search.

```typescript
// ANTES (hybrid-search.ts:72-74):
const allChunks = this.chunkDAO.listByProject(projectId)
const chunkMap = new Map(allChunks.map((c) => [c.id, c]))

// DEPOIS — usar apenas os chunks retornados pelo FTS e vector search:
search(
  projectId: string,
  query: string,
  queryEmbedding: Float32Array | null,
  limit: number = 10
): { results: SearchResult[]; processedQuery: ProcessedQuery } {
  const processed = preprocessQuery(query)

  // 1. FTS — retorna chunks completos
  const ftsResults = this.chunkDAO.searchFTS(projectId, query, limit * 2)
  const keywordScores = new Map<string, number>()
  const chunkMap = new Map<string, CodeChunk>()
  
  if (ftsResults.length > 0) {
    const maxRank = Math.max(...ftsResults.map((r) => r.rank))
    for (const result of ftsResults) {
      keywordScores.set(result.id, maxRank > 0 ? result.rank / maxRank : 0)
      chunkMap.set(result.id, result) // Reutilizar dados do FTS
    }
  }

  // 2. Vector search
  const semanticScores = new Map<string, number>()
  if (queryEmbedding) {
    const vectorResults = this.vectorSearchOptimized(
      projectId, queryEmbedding, limit * 2
    )
    for (const result of vectorResults) {
      semanticScores.set(result.id, result.score)
      if (!chunkMap.has(result.id)) {
        chunkMap.set(result.id, result.chunk) // Guardar chunk do vector search
      }
    }
  }

  // 3. Merge — usar chunkMap construido acima (sem SELECT * adicional)
  const allChunkIds = new Set([
    ...keywordScores.keys(),
    ...semanticScores.keys(),
  ])
  
  const merged: SearchResult[] = []
  for (const chunkId of allChunkIds) {
    const chunk = chunkMap.get(chunkId)
    if (!chunk) continue
    // ... resto do merge ...
  }
  
  // ... sort, consolidate, return ...
}
```

### Passo 2: Busca vetorial otimizada — carregar apenas embeddings

**Arquivo**: `electron/src/main/database/dao/ChunkDAO.ts`

Criar query que retorna apenas `id` e `embedding`, sem o `content` (que nao e usado no calculo de cosine):

```typescript
/**
 * Get chunk IDs and embeddings only (for vector search).
 * Does NOT load content — saves significant memory.
 */
getEmbeddingsOnly(
  projectId: string
): Array<{ id: string; embedding: Buffer }> {
  return this.db
    .prepare(
      'SELECT id, embedding FROM codeChunks WHERE projectId = ? AND embedding IS NOT NULL'
    )
    .all(projectId) as Array<{ id: string; embedding: Buffer }>
}

/**
 * Get multiple chunks by IDs (for resolving vector search results).
 */
getByIds(ids: string[]): CodeChunk[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  return this.db
    .prepare(`SELECT * FROM codeChunks WHERE id IN (${placeholders})`)
    .all(...ids) as CodeChunk[]
}
```

### Passo 3: Vector search retorna chunks completos apenas para top N

**Arquivo**: `electron/src/main/database/search/hybrid-search.ts`

```typescript
/**
 * Optimized vector search: load only embeddings for similarity,
 * then load full chunks only for the top results.
 */
private vectorSearchOptimized(
  projectId: string,
  queryEmbedding: Float32Array,
  topN: number
): Array<{ id: string; score: number; chunk: CodeChunk }> {
  // Step 1: Load only id + embedding (sem content)
  const embeddingsOnly = this.chunkDAO.getEmbeddingsOnly(projectId)
  if (embeddingsOnly.length === 0) return []
  
  // Step 2: Brute-force cosine similarity
  const scores = embeddingsOnly.map((item) => ({
    id: item.id,
    score: cosineSimilarity(queryEmbedding, blobToFloat32Array(item.embedding)),
  }))
  scores.sort((a, b) => b.score - a.score)
  const topResults = scores.slice(0, topN)
  
  // Step 3: Load full chunk data only for top results
  const topIds = topResults.map((r) => r.id)
  const fullChunks = this.chunkDAO.getByIds(topIds)
  const chunkMap = new Map(fullChunks.map((c) => [c.id, c]))
  
  return topResults
    .filter((r) => chunkMap.has(r.id))
    .map((r) => ({
      id: r.id,
      score: r.score,
      chunk: chunkMap.get(r.id)!,
    }))
}
```

### Passo 4: Cache de embeddings em memoria (medio prazo)

**Novo arquivo ou adicao a**: `electron/src/main/database/search/embedding-cache.ts`

Para evitar recarregar embeddings do SQLite a cada query, manter um cache em memoria:

```typescript
/**
 * In-memory cache of project embeddings for vector search.
 * Invalidated when chunks are inserted/deleted/updated.
 */
export class EmbeddingCache {
  private cache = new Map<string, {
    embeddings: Array<{ id: string; embedding: Float32Array }>
    timestamp: number
  }>()
  
  private maxAgeMs = 60_000 // 1 minuto
  
  get(projectId: string): Array<{ id: string; embedding: Float32Array }> | null {
    const entry = this.cache.get(projectId)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.maxAgeMs) {
      this.cache.delete(projectId)
      return null
    }
    return entry.embeddings
  }
  
  set(projectId: string, embeddings: Array<{ id: string; embedding: Float32Array }>): void {
    this.cache.set(projectId, {
      embeddings,
      timestamp: Date.now(),
    })
  }
  
  invalidate(projectId: string): void {
    this.cache.delete(projectId)
  }
  
  invalidateAll(): void {
    this.cache.clear()
  }
}
```

O cache deve ser invalidado quando:
- `ChunkDAO.insert()` e chamado
- `ChunkDAO.deleteByFile()` ou `deleteByProject()` e chamado
- `ChunkDAO.updateEmbedding()` e chamado
- `ContextEngine.indexProject()` inicia

### Passo 5: Eliminar listByProject na path resolution

**Arquivo**: `electron/src/main/services/SearchEngine.ts`

Em vez de carregar todos os indexed files para resolver paths, fazer lookup individual:

```typescript
// ANTES (SearchEngine.ts:84-87):
const indexedFiles = this.indexDAO.listByProject(projectId)
const filePathMap = new Map(indexedFiles.map((f) => [f.id, f.relativePath]))

// DEPOIS — lookup batch otimizado:
// Coletar fileIds unicos dos resultados
const fileIds = [...new Set(results.map((r) => r.fileId))]
const filePathMap = this.indexDAO.getPathsByIds(fileIds)
```

**Arquivo**: `electron/src/main/database/dao/IndexDAO.ts`

```typescript
/**
 * Get relative paths for a batch of file IDs.
 */
getPathsByIds(ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(', ')
  const rows = this.db
    .prepare(`SELECT id, relativePath FROM indexedFiles WHERE id IN (${placeholders})`)
    .all(...ids) as { id: string; relativePath: string }[]
  return new Map(rows.map((r) => [r.id, r.relativePath]))
}
```

---

## Estimativa de Reducao de Memoria

Para um projeto com 5,000 chunks (1536 dim embeddings):

| Operacao | Antes | Depois |
|----------|-------|--------|
| Vector search: dados carregados | ~45 MB (embeddings + content) | ~30 MB (embeddings only) |
| Merge: dados carregados | ~30 MB (todos os chunks novamente) | ~100 KB (apenas top 20) |
| Path resolution | ~500 KB (todos os indexed files) | ~2 KB (apenas IDs relevantes) |
| **Total por query** | **~75 MB** | **~30 MB** |

Com o cache de embeddings (Passo 4), queries subsequentes usam apenas ~100 KB (cache hit), caindo para **~0 MB** de alocacao extra.

---

## Arquivos Modificados/Criados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/main/database/dao/ChunkDAO.ts` | `getEmbeddingsOnly()`, `getByIds()` |
| `electron/src/main/database/dao/IndexDAO.ts` | `getPathsByIds()` |
| `electron/src/main/database/search/hybrid-search.ts` | Eliminar `listByProject()`, usar chunks do FTS/vector |
| `electron/src/main/database/search/embedding-cache.ts` | **NOVO** — Cache de embeddings em memoria |
| `electron/src/main/services/SearchEngine.ts` | Usar `getPathsByIds()` em vez de `listByProject()` |

## Testes

1. **Teste unitario**: `getEmbeddingsOnly()` retorna apenas id + embedding
2. **Teste unitario**: `getByIds()` retorna chunks corretos para IDs dados
3. **Teste unitario**: `getPathsByIds()` retorna Map correto
4. **Teste unitario**: EmbeddingCache — invalidacao, TTL, get/set
5. **Teste unitario**: HybridSearchEngine produz mesmos resultados com otimizacao
6. **Teste de performance**: Comparar latencia antes/depois em projeto com 1000+ chunks
7. **Teste manual**: Verificar que resultados de busca sao identicos apos otimizacao

## Riscos da Implementacao

- **Risco baixo**: A eliminacao do `listByProject()` pode causar regressao se algum campo do chunk nao estiver sendo carregado. Mitigar com testes de igualdade de resultados.
- **Risco baixo**: O cache de embeddings pode servir dados stale se a invalidacao falhar. O TTL de 1 minuto limita o impacto.
- **Risco medio**: `getByIds()` com muitos IDs pode gerar queries SQL muito longas. Limitar a batches de 100.

## Versao

Bump: minor (melhoria significativa de performance)
