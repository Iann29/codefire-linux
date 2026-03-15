# Plano 04: Worker Thread para Indexacao

**Data**: 2026-03-14
**Risco Corrigido**: #1 — Synchronous filesystem I/O on main process
**Confianca na Causa**: ALTA
**Esforco**: Grande (~6-8h)
**Impacto**: Critico — elimina a causa raiz de UI freezes

---

## Problema

Todo o pipeline de indexacao roda no **processo main do Electron** com chamadas de I/O sincronas:

| Operacao | Funcao | Tipo |
|----------|--------|------|
| Listar diretorios | `fs.readdirSync()` | Sincrono, bloqueante |
| Verificar tamanho | `fs.statSync()` | Sincrono, bloqueante |
| Ler arquivos | `fs.readFileSync()` | Sincrono, bloqueante |
| Hash SHA256 | `createHash().update().digest()` | Sincrono, CPU-bound |
| Chunking regex | `chunkFile()` | Sincrono, CPU-bound |
| DB writes | `better-sqlite3` prepared stmts | Sincrono, I/O-bound |

O processo main do Electron compartilha o event loop com IPC handling, window management, e tray management. Qualquer operacao sincrona longa bloqueia **tudo**.

Para um projeto com 1,000 arquivos:
- ~1,000 chamadas `statSync` + `readFileSync` + `hashContent`
- Centenas de `INSERT` no SQLite
- Resultado: UI congelada por segundos

---

## Solucao Proposta

Mover o pipeline de indexacao para um **Node.js Worker Thread** (`worker_threads`). O main process envia comandos e recebe resultados via `MessagePort`.

### Arquitetura Proposta

```
Main Process                          Worker Thread
============                          =============
                                      
ContextEngine (coordinator)           IndexWorker (executor)
  │                                     │
  ├── postMessage('index', {           ├── enumerateFiles() [sync OK no worker]
  │     projectId, projectPath })      ├── readFileSync() [sync OK no worker]
  │                                    ├── hashContent() [sync OK no worker]
  ├── onMessage('progress', {...})     ├── chunkFile() [sync OK no worker]
  │                                    ├── db.prepare().run() [sync OK no worker]
  ├── onMessage('needEmbeddings',      ├── postMessage('needEmbeddings', chunks)
  │     chunks)                        │
  │     └── EmbeddingClient ─┐         │
  │         (async fetch)    │         ├── onMessage('embeddings', results)
  │                          │         │     └── updateEmbedding() [no worker]
  ├── onMessage('complete',  │         │
  │     { totalChunks })     └────────>├── postMessage('complete')
  │                                    │
  └── onMessage('error', msg)          └── postMessage('error', msg)
```

### Por que Worker Thread e nao child_process?

1. **Shared memory**: Worker threads podem compartilhar `SharedArrayBuffer` para embeddings
2. **Menor overhead**: Sem fork de processo, sem serialization de modulos
3. **better-sqlite3 compatible**: O SQLite e thread-safe em WAL mode; cada thread abre sua propria conexao
4. **Precedente no Electron**: Amplamente usado para CPU-bound work

### Por que nao mover embeddings para o worker?

As chamadas de embedding sao **async** (`fetch`) e nao bloqueiam o main process. Mante-las no main process simplifica o design — o worker faz o trabalho pesado (I/O sincrono) e o main process faz as chamadas de rede.

---

## Implementacao

### Passo 1: Criar o IndexWorker

**Novo arquivo**: `electron/src/main/services/IndexWorker.ts`

```typescript
// Este arquivo roda dentro de um Worker Thread
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Importar funcoes puras (nao dependem de estado)
// Nota: CodeChunker e funcoes puras, podem ser importadas diretamente
import { chunkFile, chunkGitHistory, detectLanguage } from './CodeChunker'

// Skip rules (copiar do ContextEngine ou extrair para modulo compartilhado)
import { SKIP_DIRECTORIES, SKIP_EXTENSIONS, MAX_FILE_SIZE } from './indexing-constants'

// Tipos de mensagem
interface IndexCommand {
  type: 'indexProject'
  projectId: string
  projectPath: string
}

interface IndexFileCommand {
  type: 'indexFiles'
  projectId: string
  projectPath: string
  relativePaths: string[]
}

type WorkerCommand = IndexCommand | IndexFileCommand | { type: 'cancel' }

// Abrir conexao propria ao SQLite (cada worker thread precisa da sua)
const dbPath = workerData.dbPath as string
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

// Prepared statements (pre-compilar para performance)
const getFileByPath = db.prepare(
  'SELECT * FROM indexedFiles WHERE projectId = ? AND relativePath = ?'
)
const upsertFile = db.prepare(/* ... */)
const insertChunk = db.prepare(/* ... */)
const deleteChunksByFile = db.prepare('DELETE FROM codeChunks WHERE fileId = ?')
// ... etc

let cancelled = false

parentPort!.on('message', async (command: WorkerCommand) => {
  if (command.type === 'cancel') {
    cancelled = true
    return
  }
  
  if (command.type === 'indexProject') {
    cancelled = false
    try {
      await indexProject(command.projectId, command.projectPath)
    } catch (err) {
      if (!cancelled) {
        parentPort!.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
})

async function indexProject(projectId: string, projectPath: string) {
  // Notificar inicio
  parentPort!.postMessage({ type: 'started', projectId })
  
  // Enumerar (sync — OK no worker)
  const absolutePaths = enumerateFiles(projectPath)
  const relativePaths = absolutePaths.map(p => path.relative(projectPath, p))
  
  parentPort!.postMessage({
    type: 'progress',
    projectId,
    phase: 'enumerate',
    total: absolutePaths.length,
    processed: 0,
  })
  
  // Processar arquivos
  let processed = 0
  let chunksCreated = 0
  
  for (let i = 0; i < absolutePaths.length; i++) {
    if (cancelled) {
      parentPort!.postMessage({ type: 'cancelled', projectId })
      return
    }
    
    const absPath = absolutePaths[i]
    const relPath = relativePaths[i]
    
    let content: string
    try {
      content = fs.readFileSync(absPath, 'utf-8')
    } catch { continue }
    
    const contentHash = createHash('sha256').update(content).digest('hex')
    const existing = getFileByPath.get(projectId, relPath) as any
    
    if (existing && existing.contentHash === contentHash) {
      processed++
      continue
    }
    
    if (existing) {
      deleteChunksByFile.run(existing.id)
    }
    
    const language = detectLanguage(relPath)
    const chunks = chunkFile(content, language)
    
    // Upsert + insert chunks (dentro de transaction para performance)
    const fileId = existing?.id ?? randomUUID()
    // ... upsert e insert ...
    
    chunksCreated += chunks.length
    processed++
    
    // Reportar progress a cada 50 arquivos
    if (processed % 50 === 0) {
      parentPort!.postMessage({
        type: 'progress',
        projectId,
        phase: 'indexing',
        total: absolutePaths.length,
        processed,
        chunksCreated,
      })
    }
  }
  
  // Delete stale files
  // ... logica existente ...
  
  // Git history
  if (!cancelled) {
    await indexGitHistory(projectId, projectPath)
  }
  
  // Solicitar embeddings ao main process
  const chunksNeedingEmbeddings = db.prepare(
    'SELECT id, content FROM codeChunks WHERE projectId = ? AND embedding IS NULL'
  ).all(projectId)
  
  if (chunksNeedingEmbeddings.length > 0 && !cancelled) {
    parentPort!.postMessage({
      type: 'needEmbeddings',
      projectId,
      chunks: chunksNeedingEmbeddings,
    })
    // Esperar resposta do main process com os embeddings
    // (via promise que resolve no handler de 'embeddings')
  }
  
  // Contar total
  const totalChunks = db.prepare(
    'SELECT COUNT(*) as count FROM codeChunks WHERE projectId = ?'
  ).get(projectId) as { count: number }
  
  parentPort!.postMessage({
    type: 'complete',
    projectId,
    totalChunks: totalChunks.count,
  })
}
```

### Passo 2: Refatorar ContextEngine como coordenador

**Arquivo**: `electron/src/main/services/ContextEngine.ts`

O ContextEngine se torna um coordenador fino que:
1. Gerencia o Worker Thread
2. Recebe mensagens de progress
3. Faz chamadas de embedding (async no main process)
4. Atualiza `indexState` no DB
5. Emite eventos para a UI via IPC/webContents

```typescript
import { Worker } from 'worker_threads'

export class ContextEngine {
  private worker: Worker | null = null
  private embeddingClient: EmbeddingClient | null
  private indexDAO: IndexDAO
  private dbPath: string
  
  // Callback para notificar UI
  onProgress?: (projectId: string, progress: IndexProgress) => void

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        path.join(__dirname, 'IndexWorker.js'),
        { workerData: { dbPath: this.dbPath } }
      )
      
      this.worker.on('message', (msg) => this.handleWorkerMessage(msg))
      this.worker.on('error', (err) => {
        console.error('[ContextEngine] Worker error:', err)
        this.worker = null
      })
      this.worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[ContextEngine] Worker exited with code ${code}`)
        }
        this.worker = null
      })
    }
    return this.worker
  }

  async indexProject(projectId: string, projectPath: string): Promise<void> {
    this.cancelIndexing(projectId)
    
    this.indexDAO.updateState(projectId, {
      status: 'indexing',
      lastError: null,
    })
    
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker()
      
      // Guardar resolve/reject para o handler de mensagens
      this.pendingOperations.set(projectId, { resolve, reject })
      
      worker.postMessage({
        type: 'indexProject',
        projectId,
        projectPath,
      })
    })
  }

  private async handleWorkerMessage(msg: any) {
    switch (msg.type) {
      case 'progress':
        this.onProgress?.(msg.projectId, msg)
        break
        
      case 'needEmbeddings':
        await this.handleEmbeddingRequest(msg.projectId, msg.chunks)
        break
        
      case 'complete':
        this.indexDAO.updateState(msg.projectId, {
          status: 'ready',
          lastFullIndexAt: new Date().toISOString(),
          totalChunks: msg.totalChunks,
          lastError: null,
          embeddingModel: this.embeddingClient?.getModel() ?? null,
        })
        this.pendingOperations.get(msg.projectId)?.resolve()
        this.pendingOperations.delete(msg.projectId)
        break
        
      case 'error':
        this.indexDAO.updateState(msg.projectId, {
          status: 'error',
          lastError: msg.error,
        })
        this.pendingOperations.get(msg.projectId)?.reject(new Error(msg.error))
        this.pendingOperations.delete(msg.projectId)
        break
    }
  }

  cancelIndexing(projectId: string): void {
    this.worker?.postMessage({ type: 'cancel' })
  }
}
```

### Passo 3: Extrair constantes compartilhadas

**Novo arquivo**: `electron/src/main/services/indexing-constants.ts`

Extrair `SKIP_DIRECTORIES`, `SKIP_EXTENSIONS`, `MAX_FILE_SIZE`, e `enumerateFiles()` para um modulo compartilhado entre o ContextEngine e o IndexWorker.

### Passo 4: Configurar Vite para o worker

**Arquivo**: `electron/vite.config.ts`

Garantir que o worker thread seja compilado e bundled corretamente:

```typescript
// O worker precisa ser um arquivo separado, nao bundled inline
// Adicionar como entry point ou usar import.meta.url pattern
```

### Passo 5: Lidar com better-sqlite3 no worker

**Atencao especial**: `better-sqlite3` e um modulo nativo. Cada Worker Thread precisa de sua propria conexao ao SQLite (nao pode compartilhar a do main process). O WAL mode do SQLite ja suporta acesso concorrente read/write entre conexoes.

```typescript
// No worker:
const db = new Database(workerData.dbPath)
db.pragma('journal_mode = WAL')  // Essencial para concorrencia
db.pragma('busy_timeout = 5000')
```

---

## Arquivos Modificados/Criados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/main/services/IndexWorker.ts` | **NOVO** — Worker thread para indexacao |
| `electron/src/main/services/indexing-constants.ts` | **NOVO** — Constantes e helpers compartilhados |
| `electron/src/main/services/ContextEngine.ts` | Refatorar para coordenador + worker management |
| `electron/vite.config.ts` | Configurar compilacao do worker |
| `electron/tsconfig.node.json` | Garantir que worker_threads types estao incluidos |

## Testes

1. **Teste unitario**: Worker processa arquivos e reporta progress
2. **Teste unitario**: Worker para ao receber 'cancel'
3. **Teste unitario**: Worker abre conexao SQLite propria
4. **Teste unitario**: Falha no worker nao crasha o main process
5. **Teste integracao**: Indexar projeto real, verificar que UI nao congela
6. **Teste manual**: Abrir projeto grande, verificar que menus e IPC continuam responsivos
7. **Teste manual**: Cancelar indexacao, verificar que worker para

## Riscos da Implementacao

- **Risco alto**: `better-sqlite3` como modulo nativo pode ter problemas de loading no Worker Thread. Requer testes com o build empacotado (asar + asarUnpack).
- **Risco medio**: Serialization de mensagens entre threads tem custo. Para listas grandes de chunks, considerar `SharedArrayBuffer`.
- **Risco medio**: O Vite precisa bundlar o worker como arquivo separado, nao inline. A config do `vite-plugin-electron` pode precisar ajustes.
- **Risco baixo**: Duas conexoes SQLite em WAL mode podem competir por write access. O `busy_timeout` de 5s mitiga isso.

## Alternativa: Async I/O sem Worker Thread

Se o risco do Worker Thread for considerado muito alto, uma alternativa intermediaria e:

1. Substituir `readdirSync` por `fs.promises.readdir`
2. Substituir `readFileSync` por `fs.promises.readFile`
3. Substituir `statSync` por `fs.promises.stat`
4. Adicionar `await` + yielding a cada N arquivos

Isso **nao** resolve o problema com `better-sqlite3` (que e sincrono por design), mas resolve o I/O de filesystem. E uma mudanca menor e de menor risco.

```typescript
// Alternativa mais simples:
async function enumerateFilesAsync(dirPath: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  
  for (const entry of entries) {
    if (entry.isDirectory() && !shouldSkipDir(entry.name)) {
      results.push(...await enumerateFilesAsync(path.join(dirPath, entry.name)))
    } else if (entry.isFile()) {
      const fullPath = path.join(dirPath, entry.name)
      if (!shouldSkipFile(fullPath)) {
        const stat = await fs.promises.stat(fullPath)
        if (stat.size <= MAX_FILE_SIZE) {
          results.push(fullPath)
        }
      }
    }
  }
  return results
}
```

## Versao

Bump: minor (mudanca arquitetural significativa)
