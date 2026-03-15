# Plano 02: Controle de Concorrencia + Fila de Indexacao

**Data**: 2026-03-14
**Risco Corrigido**: #4 — Zero controle de concorrencia / overlapping index runs
**Confianca na Causa**: ALTA
**Esforco**: Medio (~3-4h)
**Impacto**: Alto — previne corrupcao de dados e erros de DB

---

## Problema

Nao existe nenhum mecanismo que impeca multiplas operacoes de indexacao simultaneas no mesmo projeto. Cenarios reais onde isso ocorre:

1. **Open + FileWatcher**: Usuario abre projeto (trigger reindex). Enquanto indexa, salva um arquivo. FileWatcher dispara `indexFile()` que chama `generateEmbeddings()` para todo o projeto.
2. **Open + Manual**: Usuario abre projeto (auto-reindex), e antes de terminar clica "Reindex" em Settings.
3. **Open + Open**: Usuario fecha e reabre a janela do projeto rapidamente.

### Consequencias

- INSERT/DELETE concorrentes em `codeChunks` → chunks duplicados ou orfaos
- FTS5 triggers rodam em ambas as transacoes → indice FTS inconsistente
- `indexState.status` pisca entre 'indexing' e 'ready' de forma imprevisivel
- SQLite `busy_timeout` (5s) pode expirar → erro "database is locked"
- `deleteStaleFiles()` de uma operacao pode deletar arquivos que a outra esta processando

### Infraestrutura Existente (Nao Utilizada)

A tabela `indexRequests` ja existe na migration 16, e `IndexDAO` ja tem metodos:
- `createRequest(projectId, projectPath)` → insere request pendente
- `getPendingRequest()` → busca proxima request
- `markProcessing(id)` → marca como em processamento
- `markCompleted(id)` → marca como concluida

**Nenhum desses metodos e chamado por nenhum codigo do app.**

---

## Solucao Proposta

### Parte A: Mutex por projeto no ContextEngine

Adicionar um `Map<string, Promise<void>>` ao `ContextEngine` que rastreia operacoes em andamento por projeto. Qualquer nova operacao espera a anterior terminar ou e descartada.

### Parte B: Ativar a fila `indexRequests`

Usar a tabela existente como fila real. O `search:reindex` IPC handler cria um request. Um loop no main process consome requests sequencialmente.

### Parte C: Coalescing de FileWatcher events

Em vez de chamar `indexFile()` para cada arquivo individual (que dispara `generateEmbeddings()` a cada vez), acumular mudancas e fazer um batch update.

---

## Implementacao

### Passo 1: Adicionar mutex por projeto ao ContextEngine

**Arquivo**: `electron/src/main/services/ContextEngine.ts`

```typescript
export class ContextEngine {
  private db: Database.Database
  private chunkDAO: ChunkDAO
  private indexDAO: IndexDAO
  private embeddingClient: EmbeddingClient | null
  
  // NOVO: Mutex por projeto — rastreia operacao em andamento
  private activeOperations = new Map<string, Promise<void>>()

  /**
   * Executa uma operacao de indexacao com mutex por projeto.
   * Se ja houver uma operacao em andamento para o mesmo projeto,
   * espera ela terminar antes de iniciar.
   */
  private async withProjectLock<T>(
    projectId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    // Esperar operacao anterior terminar (se existir)
    const existing = this.activeOperations.get(projectId)
    if (existing) {
      await existing.catch(() => {}) // Ignorar erros da anterior
    }
    
    let resolve: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    this.activeOperations.set(projectId, promise)
    
    try {
      return await operation()
    } finally {
      resolve!()
      // Limpar apenas se ainda somos a operacao ativa
      if (this.activeOperations.get(projectId) === promise) {
        this.activeOperations.delete(projectId)
      }
    }
  }

  /**
   * Verifica se ha uma operacao de indexacao ativa para o projeto.
   */
  isIndexing(projectId: string): boolean {
    return this.activeOperations.has(projectId)
  }

  // Modificar indexProject para usar o lock:
  async indexProject(projectId: string, projectPath: string): Promise<void> {
    return this.withProjectLock(projectId, async () => {
      // ... codigo existente do indexProject ...
    })
  }

  // Modificar indexFile para usar o lock:
  async indexFile(
    projectId: string,
    projectPath: string,
    relativePath: string
  ): Promise<void> {
    return this.withProjectLock(projectId, async () => {
      // ... codigo existente do indexFile ...
    })
  }
}
```

### Passo 2: Batch de FileWatcher em vez de per-file indexing

**Arquivo**: `electron/src/main/index.ts`

Substituir o loop per-file por um batch reindex:

```typescript
// ANTES (index.ts:87-98):
fileWatcher.onFilesChanged = (projectId, changedPaths) => {
  const project = projectDAO.getById(projectId)
  if (!project) return
  for (const absPath of changedPaths) {
    const relativePath = path.relative(project.path, absPath)
    contextEngine.indexFile(projectId, project.path, relativePath).catch(...)
  }
}

// DEPOIS:
fileWatcher.onFilesChanged = (projectId, changedPaths) => {
  const project = projectDAO.getById(projectId)
  if (!project) return
  
  // Se ja esta indexando, pular — o full reindex captura tudo
  if (contextEngine.isIndexing(projectId)) {
    console.log(`[FileWatcher] Skipping — full index already running for ${projectId}`)
    return
  }
  
  // Para poucas mudancas, indexar individual. Para muitas, reindexar tudo.
  if (changedPaths.length <= 5) {
    contextEngine.indexFiles(projectId, project.path, changedPaths).catch((err) => {
      console.error(`[FileWatcher] Batch re-index failed:`, err)
    })
  } else {
    console.log(`[FileWatcher] ${changedPaths.length} files changed — triggering full reindex`)
    contextEngine.indexProject(projectId, project.path).catch((err) => {
      console.error(`[FileWatcher] Full re-index failed:`, err)
    })
  }
}
```

### Passo 3: Adicionar `indexFiles()` batch ao ContextEngine

**Arquivo**: `electron/src/main/services/ContextEngine.ts`

```typescript
/**
 * Index multiple files in a single locked operation.
 * Generates embeddings only once at the end.
 */
async indexFiles(
  projectId: string,
  projectPath: string,
  absolutePaths: string[]
): Promise<void> {
  return this.withProjectLock(projectId, async () => {
    for (const absPath of absolutePaths) {
      const relativePath = path.relative(projectPath, absPath)
      // Reutilizar logica de indexFile, mas SEM generateEmbeddings individual
      await this.indexFileSingle(projectId, projectPath, relativePath)
    }
    
    // Gerar embeddings uma unica vez para todos os novos chunks
    await this.generateEmbeddings(projectId)
    
    // Atualizar contagem
    const totalChunks = this.chunkDAO.countByProject(projectId)
    this.indexDAO.updateState(projectId, { totalChunks })
  })
}

/**
 * Index a single file without embedding generation (internal use).
 */
private async indexFileSingle(
  projectId: string,
  projectPath: string,
  relativePath: string
): Promise<void> {
  // Mesma logica do indexFile atual, sem a chamada a generateEmbeddings()
  // e sem updateState() individual
}
```

### Passo 4: Guard no IPC handler

**Arquivo**: `electron/src/main/ipc/search-handlers.ts`

```typescript
ipcMain.handle('search:reindex', async (_event, projectId: string) => {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('projectId is required')
  }
  
  // NOVO: Verificar se ja esta indexando
  if (contextEngine.isIndexing(projectId)) {
    return { success: true, skipped: true, reason: 'already indexing' }
  }
  
  const project = projectDAO.getById(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  
  await contextEngine.indexProject(projectId, project.path)
  return { success: true }
})
```

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/main/services/ContextEngine.ts` | Mutex via `withProjectLock()`, `isIndexing()`, `indexFiles()` batch |
| `electron/src/main/index.ts` | FileWatcher callback com batch e skip-if-indexing |
| `electron/src/main/ipc/search-handlers.ts` | Guard `isIndexing()` no handler `search:reindex` |

## Testes

1. **Teste unitario**: `withProjectLock` — verificar que operacoes sequenciais nao se sobrepoe
2. **Teste unitario**: `withProjectLock` — verificar que operacoes em projetos diferentes rodam em paralelo
3. **Teste unitario**: `isIndexing()` retorna true durante operacao e false apos
4. **Teste manual**: Abrir projeto e clicar "Reindex" durante indexacao — deve ser ignorado
5. **Teste manual**: Salvar 10 arquivos rapidamente — deve fazer um unico batch
6. **Teste de stress**: Abrir/fechar projeto rapidamente 5x — nao deve gerar erros de DB

## Riscos da Implementacao

- **Risco medio**: O mutex sequencial pode causar espera se uma operacao demora muito. Mitiga-se com o Plano 03 (abort).
- **Risco baixo**: O threshold de 5 arquivos para batch vs full reindex pode precisar de ajuste.

## Versao

Bump: patch (se implementado sozinho) ou minor (se combinado com Plano 01)
