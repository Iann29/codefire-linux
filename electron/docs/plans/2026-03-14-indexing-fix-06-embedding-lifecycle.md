# Plano 06: Lifecycle de Embeddings

**Data**: 2026-03-14
**Risco Corrigido**: #7 — Invalidacao de embeddings em massa
**Confianca na Causa**: MEDIA
**Esforco**: Pequeno (~1-2h)
**Impacto**: Medio — previne re-embeddings desnecessarios e rate limiting

---

## Problema

Quando o usuario troca o modelo de embedding (ex: `text-embedding-3-small` -> `text-embedding-3-large`), o `ContextEngine.generateEmbeddings()` detecta a mudanca e faz:

```sql
UPDATE codeChunks SET embedding = NULL WHERE projectId = ? AND embedding IS NOT NULL
```

Isso invalida **todos os embeddings do projeto de uma vez**, forcando re-embedding completo. Para um projeto com 5,000 chunks em batches de 50:

- 100 chamadas de API
- Cada chamada com 50 textos
- Rate limit do EmbeddingClient: retry unico, 1s delay
- Se muitos batches falharem por rate limit, chunks ficam sem embedding

Localizado em: `ContextEngine.ts:386-393`

### Problemas Especificos

1. **Tudo-ou-nada**: A invalidacao e atomica — todos os embeddings sao NULLados antes de qualquer re-embedding
2. **Sem backoff progressivo**: Apenas 1 retry com 1s de delay. Provedores como OpenRouter tipicamente pedem delays de 5-60s
3. **Sem persistencia de progresso**: Se o app crashar durante re-embedding, os chunks ja NULLados perdem seus embeddings antigos
4. **Sem prioridade**: Chunks mais acessados nao sao priorizados na re-embedding

---

## Solucao Proposta

### Estrategia: Invalidacao Incremental + Backoff Robusto

Em vez de NULLar tudo de uma vez, marcar embeddings como "stale" e substitui-los incrementalmente. Adicionar backoff exponencial nas chamadas de API.

---

## Implementacao

### Passo 1: Adicionar coluna `embeddingModel` aos chunks

**Arquivo**: `electron/src/main/database/migrations/index.ts`

Nova migration que adiciona `embeddingModel` a cada chunk individual (em vez de depender apenas do `indexState.embeddingModel` global):

```typescript
{
  version: XX,
  name: 'vXX_addEmbeddingModelToChunks',
  up: (db) => {
    db.exec(`
      ALTER TABLE codeChunks ADD COLUMN embeddingModel TEXT;
      
      -- Backfill: marcar chunks existentes com o modelo do indexState
      UPDATE codeChunks 
      SET embeddingModel = (
        SELECT embeddingModel FROM indexState 
        WHERE indexState.projectId = codeChunks.projectId
      )
      WHERE embedding IS NOT NULL;
    `)
  },
}
```

### Passo 2: Substituir invalidacao em massa por filtragem inteligente

**Arquivo**: `electron/src/main/services/ContextEngine.ts`

```typescript
private async generateEmbeddings(
  projectId: string,
  signal?: AbortSignal
): Promise<void> {
  if (!this.embeddingClient?.hasApiKey()) return

  const currentModel = this.embeddingClient.getModel()

  // ANTES: NULLava todos os embeddings de modelo diferente
  // DEPOIS: Simplesmente busca chunks que precisam de (re-)embedding
  
  // Chunks sem embedding OU com modelo diferente
  const chunks = this.db
    .prepare(
      `SELECT id, content FROM codeChunks 
       WHERE projectId = ? 
       AND (embedding IS NULL OR embeddingModel IS NULL OR embeddingModel != ?)`
    )
    .all(projectId, currentModel) as { id: string; content: string }[]

  if (chunks.length === 0) {
    this.indexDAO.updateState(projectId, { embeddingModel: currentModel })
    return
  }

  // Log se ha re-embedding por mudanca de modelo
  const staleCount = this.db
    .prepare(
      `SELECT COUNT(*) as c FROM codeChunks 
       WHERE projectId = ? AND embedding IS NOT NULL AND embeddingModel != ?`
    )
    .get(projectId, currentModel) as { c: number }
  
  if (staleCount.c > 0) {
    console.log(
      `[ContextEngine] Model changed: ${staleCount.c} chunks need re-embedding with ${currentModel}`
    )
  }

  // Gerar em batches com backoff robusto
  let successCount = 0
  let failCount = 0
  let consecutiveFailures = 0

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    if (signal?.aborted) return
    
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)
    try {
      const embeddings = await this.embeddingClient.getEmbeddings(
        batch.map((c) => c.content),
        'document'
      )
      
      // Atualizar embedding E modelo por chunk
      const updateStmt = this.db.prepare(
        'UPDATE codeChunks SET embedding = ?, embeddingModel = ? WHERE id = ?'
      )
      for (let j = 0; j < batch.length; j++) {
        updateStmt.run(
          float32ArrayToBlob(embeddings[j]),
          currentModel,
          batch[j].id
        )
      }
      
      successCount += batch.length
      consecutiveFailures = 0 // Reset
    } catch (err) {
      failCount += batch.length
      consecutiveFailures++
      
      console.error(
        `[ContextEngine] Embedding batch failed (${consecutiveFailures} consecutive):`,
        err
      )
      
      // Backoff exponencial: parar apos 3 falhas consecutivas
      if (consecutiveFailures >= 3) {
        console.warn(
          `[ContextEngine] Stopping embeddings after ${consecutiveFailures} consecutive failures. ` +
          `${successCount} succeeded, ${failCount + (chunks.length - i - batch.length)} remaining.`
        )
        break
      }
      
      // Delay exponencial entre retries
      const delayMs = Math.min(1000 * Math.pow(2, consecutiveFailures), 30_000)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  this.indexDAO.updateState(projectId, { embeddingModel: currentModel })

  if (failCount > 0) {
    console.warn(
      `[ContextEngine] Embedding: ${successCount} ok, ${failCount} failed. ` +
      `Failed chunks retain old embeddings and will be updated on next run.`
    )
  }
}
```

### Passo 3: Melhorar retry no EmbeddingClient

**Arquivo**: `electron/src/main/services/EmbeddingClient.ts`

Adicionar backoff exponencial e respeitar `Retry-After` header:

```typescript
private async callOpenRouterAPI(
  input: string[],
  retryCount = 0
): Promise<Float32Array[]> {
  // ... fetch ...
  
  if (!response.ok) {
    if (response.status === 429 && retryCount < 3) {
      // Respeitar Retry-After header se presente
      const retryAfter = response.headers.get('retry-after')
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * Math.pow(2, retryCount), 30_000)
      
      console.log(`[EmbeddingClient] Rate limited, retrying in ${delayMs}ms (attempt ${retryCount + 1}/3)`)
      await this.delay(delayMs)
      return this.callOpenRouterAPI(input, retryCount + 1)
    }
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
  }
  // ...
}
```

Mesma mudanca para `callGeminiAPI`.

---

## Beneficios

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Troca de modelo | Perde todos os embeddings imediatamente | Mantem embeddings antigos ate substituir |
| Falha de API | Chunks ficam sem embedding | Chunks mantem embedding do modelo anterior |
| Rate limiting | 1 retry, 1s delay | 3 retries, backoff exponencial, Retry-After |
| Crash durante re-embedding | Embeddings ja NULLados, perdidos | Embeddings antigos preservados |
| Progresso parcial | Tudo ou nada | Incremental — cada batch atualiza individualmente |

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/main/database/migrations/index.ts` | Nova migration: coluna `embeddingModel` em codeChunks |
| `electron/src/main/services/ContextEngine.ts` | Invalidacao incremental, backoff exponencial |
| `electron/src/main/services/EmbeddingClient.ts` | 3 retries com backoff, Retry-After header |

## Testes

1. **Teste unitario**: Chunks com modelo antigo sao re-embedded, nao NULLados
2. **Teste unitario**: Chunks sem embedding sao embedded normalmente
3. **Teste unitario**: 3 falhas consecutivas param o loop de embedding
4. **Teste unitario**: Backoff exponencial respeita delays corretos
5. **Teste unitario**: Retry-After header e respeitado
6. **Teste manual**: Trocar modelo e verificar que busca continua funcionando (com embeddings antigos)
7. **Teste manual**: Verificar que re-embedding acontece gradualmente

## Riscos da Implementacao

- **Risco baixo**: Embeddings de modelos diferentes num mesmo projeto podem produzir resultados de busca incoerentes. Mitiga-se porque a re-embedding e rapida para projetos pequenos, e o impacto e temporario.
- **Risco baixo**: A nova coluna `embeddingModel` adiciona ~20 bytes por chunk. Negligivel.

## Versao

Bump: patch
