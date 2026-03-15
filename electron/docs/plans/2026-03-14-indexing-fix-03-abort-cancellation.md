# Plano 03: Abort e Cancellation para Indexacao

**Data**: 2026-03-14
**Risco Corrigido**: #5 — Sem cancellation/abort support
**Confianca na Causa**: MEDIA
**Esforco**: Pequeno (~2h)
**Impacto**: Medio — previne vazamento de operacoes e prepara para worker thread

---

## Problema

`ContextEngine.indexProject()` e um metodo async de longa duracao que nao suporta cancelamento. Uma vez iniciado, roda ate o fim — mesmo que:

- O usuario feche a janela do projeto
- O usuario navegue para outro projeto
- O usuario clique "Clear Index"
- O app esteja sendo fechado
- Uma nova indexacao seja requisitada para o mesmo projeto

O resultado e consumo desnecessario de CPU, I/O, e API quota para embeddings.

### Evidencia

Nao ha nenhuma referencia a `AbortController`, `AbortSignal`, ou `cancel` em `ContextEngine.ts`. O `AgentService.ts` ja usa `AbortController` extensivamente (linhas 79, 331, 358-362), mostrando que o pattern ja e conhecido no codebase.

---

## Solucao Proposta

Adicionar `AbortSignal` a todos os metodos de longa duracao do `ContextEngine`. O signal e verificado em pontos estrategicos do pipeline:

1. Antes de processar cada arquivo (loop principal)
2. Antes de cada batch de embeddings
3. Antes de `indexGitHistory()`
4. Na espera do mutex do Plano 02

### Pontos de Cancelamento

```
indexProject()
  ├─ [CHECK ABORT] antes do loop de arquivos
  ├─ loop:
  │    ├─ [CHECK ABORT] a cada arquivo
  │    ├─ readFileSync
  │    ├─ hash
  │    ├─ chunk
  │    └─ insert
  ├─ deleteStaleFiles
  ├─ [CHECK ABORT] antes de git history
  ├─ indexGitHistory
  ├─ [CHECK ABORT] antes de embeddings
  └─ generateEmbeddings
       └─ loop de batches:
            └─ [CHECK ABORT] a cada batch
```

---

## Implementacao

### Passo 1: Adicionar AbortController ao ContextEngine

**Arquivo**: `electron/src/main/services/ContextEngine.ts`

```typescript
export class ContextEngine {
  private db: Database.Database
  private chunkDAO: ChunkDAO
  private indexDAO: IndexDAO
  private embeddingClient: EmbeddingClient | null
  private activeOperations = new Map<string, Promise<void>>()
  
  // NOVO: AbortControllers por projeto
  private abortControllers = new Map<string, AbortController>()

  /**
   * Cancela a operacao de indexacao ativa para um projeto.
   */
  cancelIndexing(projectId: string): void {
    const controller = this.abortControllers.get(projectId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(projectId)
      console.log(`[ContextEngine] Cancelled indexing for project ${projectId}`)
    }
  }

  /**
   * Cancela todas as operacoes de indexacao ativas.
   */
  cancelAll(): void {
    for (const [projectId, controller] of this.abortControllers) {
      controller.abort()
      console.log(`[ContextEngine] Cancelled indexing for project ${projectId}`)
    }
    this.abortControllers.clear()
  }

  /**
   * Helper: verifica se o signal foi abortado e lanca erro.
   */
  private checkAbort(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('Indexing cancelled', 'AbortError')
    }
  }

  async indexProject(projectId: string, projectPath: string): Promise<void> {
    // Cancelar operacao anterior se existir
    this.cancelIndexing(projectId)
    
    const controller = new AbortController()
    this.abortControllers.set(projectId, controller)
    const { signal } = controller
    
    return this.withProjectLock(projectId, async () => {
      try {
        this.indexDAO.updateState(projectId, {
          status: 'indexing',
          lastError: null,
        })

        this.checkAbort(signal) // <-- CHECK

        const absolutePaths = enumerateFiles(projectPath)
        const relativePaths = absolutePaths.map((p) =>
          path.relative(projectPath, p)
        )

        for (let i = 0; i < absolutePaths.length; i++) {
          this.checkAbort(signal) // <-- CHECK a cada arquivo
          
          // ... logica existente de processamento de arquivo ...
        }

        this.indexDAO.deleteStaleFiles(projectId, relativePaths)

        this.checkAbort(signal) // <-- CHECK antes de git
        await this.indexGitHistory(projectId, projectPath)

        this.checkAbort(signal) // <-- CHECK antes de embeddings
        await this.generateEmbeddings(projectId, signal)

        const totalChunks = this.chunkDAO.countByProject(projectId)
        this.indexDAO.updateState(projectId, {
          status: 'ready',
          lastFullIndexAt: new Date().toISOString(),
          totalChunks,
          lastError: null,
          embeddingModel: this.embeddingClient?.getModel() ?? null,
        })
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Cancelamento nao e erro — restaurar estado
          this.indexDAO.updateState(projectId, {
            status: 'idle',
            lastError: null,
          })
          console.log(`[ContextEngine] Indexing cancelled for ${projectId}`)
          return
        }
        
        const message = error instanceof Error ? error.message : String(error)
        this.indexDAO.updateState(projectId, {
          status: 'error',
          lastError: message,
        })
        throw error
      } finally {
        this.abortControllers.delete(projectId)
      }
    })
  }

  // Modificar generateEmbeddings para aceitar signal:
  private async generateEmbeddings(
    projectId: string,
    signal?: AbortSignal
  ): Promise<void> {
    // ... codigo existente ...
    
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      if (signal?.aborted) return // <-- CHECK a cada batch
      
      // ... codigo existente do batch ...
    }
  }
}
```

### Passo 2: Expor cancelamento via IPC

**Arquivo**: `electron/src/main/ipc/search-handlers.ts`

```typescript
ipcMain.handle('search:cancelIndex', async (_event, projectId: string) => {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('projectId is required')
  }
  contextEngine.cancelIndexing(projectId)
  return { success: true }
})
```

### Passo 3: Cancelar no app shutdown

**Arquivo**: `electron/src/main/index.ts`

```typescript
app.on('before-quit', () => {
  isQuitting = true
  try { if (contextEngine) contextEngine.cancelAll() } catch (e) { /* ... */ }
  try { if (fileWatcher) fileWatcher.unwatchAll() } catch (e) { /* ... */ }
  // ... resto do cleanup ...
})
```

### Passo 4: Cancelar ao fechar janela de projeto

**Arquivo**: `electron/src/main/windows/WindowManager.ts` ou handler de projeto

Quando uma janela de projeto e fechada, cancelar a indexacao desse projeto:

```typescript
// No handler de close da janela de projeto:
contextEngine.cancelIndexing(projectId)
fileWatcher.unwatch(projectId)
```

### Passo 5: Adicionar ao tipo IPC

**Arquivo**: `electron/src/shared/types.ts`

```typescript
export type SearchChannel =
  | 'search:query'
  | 'search:reindex'
  | 'search:getIndexState'
  | 'search:clearIndex'
  | 'search:cancelIndex'  // NOVO
  | 'embedding:test'
```

### Passo 6: Adicionar ao API do renderer

**Arquivo**: `electron/src/renderer/lib/api.ts`

```typescript
search: {
  // ... existentes ...
  cancelIndex: (projectId: string) => invoke('search:cancelIndex', projectId),
}
```

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/main/services/ContextEngine.ts` | AbortController, `cancelIndexing()`, `cancelAll()`, `checkAbort()` |
| `electron/src/main/ipc/search-handlers.ts` | Novo handler `search:cancelIndex` |
| `electron/src/main/index.ts` | `cancelAll()` no before-quit |
| `electron/src/shared/types.ts` | Novo canal `search:cancelIndex` |
| `electron/src/renderer/lib/api.ts` | Novo metodo `cancelIndex()` |

## Testes

1. **Teste unitario**: `cancelIndexing()` aborta operacao em andamento
2. **Teste unitario**: `checkAbort()` lanca `AbortError` corretamente
3. **Teste unitario**: Cancelamento durante embedding batch para o loop
4. **Teste unitario**: Cancelamento restaura estado para 'idle' (nao 'error')
5. **Teste manual**: Abrir projeto, fechar rapidamente — indexacao deve parar
6. **Teste manual**: Clicar "Clear Index" durante indexacao — deve cancelar primeiro

## Riscos da Implementacao

- **Risco baixo**: `checkAbort()` a cada arquivo adiciona overhead minimo (verificacao de boolean)
- **Risco baixo**: Cancelamento durante escrita no DB pode deixar chunks parciais. Mitiga-se porque o proximo reindex limpa tudo via hash comparison.

## Versao

Bump: patch
