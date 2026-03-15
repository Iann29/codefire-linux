# Plano 07: Progress Reporting e Observabilidade

**Data**: 2026-03-14
**Risco Corrigido**: Ausencia de feedback de progresso para o usuario
**Esforco**: Medio (~3h)
**Impacto**: Medio — melhoria significativa de UX durante indexacao

---

## Problema

Atualmente o usuario ve apenas 3 estados: "idle", "indexing", e "ready"/"error". Nao ha:

- Percentual de progresso
- Contagem de arquivos processados / total
- Estimativa de tempo restante
- Fase atual (enumerando, chunking, embedding, etc.)
- Contagem de chunks criados
- Status dos embeddings (quantos gerados, quantos faltam)

Para projetos grandes, o indicador "indexing" pode ficar ativo por minutos sem nenhum feedback adicional, levando o usuario a pensar que o app travou.

### Estado Atual da UI

- `ProjectHeaderBar.tsx:48` mostra um indicador simples baseado em `indexStatus`
- `AgentStatusBar.tsx:40` mostra `indexProgress` (que nunca e populado com dados reais)
- `SettingsTabEngine.tsx` mostra `totalChunks` apenas apos a indexacao terminar

---

## Solucao Proposta

### Sistema de Progress Events

Implementar um sistema de eventos de progresso que flui do `ContextEngine` (ou `IndexWorker` no Plano 04) ate a UI via `webContents.send()`.

### Modelo de Dados

```typescript
interface IndexProgress {
  projectId: string
  phase: 'enumerating' | 'indexing' | 'git-history' | 'embedding' | 'finalizing'
  filesTotal: number
  filesProcessed: number
  filesSkipped: number      // Arquivos unchanged (hash match)
  chunksCreated: number
  embeddingsTotal: number
  embeddingsGenerated: number
  embeddingsFailed: number
  elapsedMs: number
  estimatedRemainingMs?: number
}
```

---

## Implementacao

### Passo 1: Adicionar emissao de progresso ao ContextEngine

**Arquivo**: `electron/src/main/services/ContextEngine.ts`

```typescript
export class ContextEngine {
  // Callback para eventos de progresso
  private progressCallback?: (progress: IndexProgress) => void

  /**
   * Registra callback para receber eventos de progresso.
   */
  onProgress(callback: (progress: IndexProgress) => void): void {
    this.progressCallback = callback
  }

  private emitProgress(progress: IndexProgress): void {
    this.progressCallback?.(progress)
  }

  async indexProject(projectId: string, projectPath: string): Promise<void> {
    const startTime = Date.now()
    
    const progress: IndexProgress = {
      projectId,
      phase: 'enumerating',
      filesTotal: 0,
      filesProcessed: 0,
      filesSkipped: 0,
      chunksCreated: 0,
      embeddingsTotal: 0,
      embeddingsGenerated: 0,
      embeddingsFailed: 0,
      elapsedMs: 0,
    }

    try {
      this.indexDAO.updateState(projectId, { status: 'indexing', lastError: null })

      // Fase 1: Enumerar
      progress.phase = 'enumerating'
      this.emitProgress(progress)
      
      const absolutePaths = enumerateFiles(projectPath)
      progress.filesTotal = absolutePaths.length
      progress.elapsedMs = Date.now() - startTime
      this.emitProgress(progress)

      // Fase 2: Indexar arquivos
      progress.phase = 'indexing'
      const relativePaths = absolutePaths.map((p) => path.relative(projectPath, p))

      for (let i = 0; i < absolutePaths.length; i++) {
        // ... logica existente ...
        
        if (existing && existing.contentHash === contentHash) {
          progress.filesSkipped++
        } else {
          progress.chunksCreated += chunks.length
        }
        
        progress.filesProcessed++
        progress.elapsedMs = Date.now() - startTime
        
        // Emitir a cada 20 arquivos ou no ultimo
        if (progress.filesProcessed % 20 === 0 || i === absolutePaths.length - 1) {
          // Estimativa de tempo restante
          const avgTimePerFile = progress.elapsedMs / progress.filesProcessed
          progress.estimatedRemainingMs = Math.round(
            avgTimePerFile * (progress.filesTotal - progress.filesProcessed)
          )
          this.emitProgress(progress)
        }
      }

      // Fase 3: Git history
      progress.phase = 'git-history'
      this.emitProgress(progress)
      await this.indexGitHistory(projectId, projectPath)

      // Fase 4: Embeddings
      progress.phase = 'embedding'
      const chunksNeedingEmbeddings = this.db
        .prepare('SELECT COUNT(*) as c FROM codeChunks WHERE projectId = ? AND embedding IS NULL')
        .get(projectId) as { c: number }
      
      progress.embeddingsTotal = chunksNeedingEmbeddings.c
      this.emitProgress(progress)
      
      await this.generateEmbeddings(projectId, undefined, (generated, failed) => {
        progress.embeddingsGenerated = generated
        progress.embeddingsFailed = failed
        progress.elapsedMs = Date.now() - startTime
        this.emitProgress(progress)
      })

      // Fase 5: Finalizacao
      progress.phase = 'finalizing'
      progress.elapsedMs = Date.now() - startTime
      progress.estimatedRemainingMs = 0
      this.emitProgress(progress)

      // ... updateState ready ...
    } catch (error) {
      // ... error handling ...
    }
  }
}
```

### Passo 2: Broadcast de progresso via webContents

**Arquivo**: `electron/src/main/index.ts`

```typescript
// Apos criar contextEngine:
contextEngine.onProgress((progress) => {
  // Broadcast para todas as janelas
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('search:indexProgress', progress)
  }
})
```

### Passo 3: Adicionar tipo de canal IPC

**Arquivo**: `electron/src/shared/types.ts`

```typescript
export type SearchChannel =
  | 'search:query'
  | 'search:reindex'
  | 'search:getIndexState'
  | 'search:clearIndex'
  | 'search:cancelIndex'
  | 'search:indexProgress'  // NOVO — evento de progresso (main -> renderer)
  | 'embedding:test'
```

### Passo 4: Interface no shared models

**Arquivo**: `electron/src/shared/models.ts`

```typescript
export interface IndexProgress {
  projectId: string
  phase: 'enumerating' | 'indexing' | 'git-history' | 'embedding' | 'finalizing'
  filesTotal: number
  filesProcessed: number
  filesSkipped: number
  chunksCreated: number
  embeddingsTotal: number
  embeddingsGenerated: number
  embeddingsFailed: number
  elapsedMs: number
  estimatedRemainingMs?: number
}
```

### Passo 5: Listener no renderer

**Arquivo**: `electron/src/renderer/lib/api.ts`

```typescript
search: {
  // ... existentes ...
  onIndexProgress: (callback: (progress: IndexProgress) => void) =>
    window.api.on('search:indexProgress', callback),
}
```

### Passo 6: Atualizar ProjectLayout para exibir progresso

**Arquivo**: `electron/src/renderer/layouts/ProjectLayout.tsx`

```typescript
const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)

useEffect(() => {
  const cleanup = api.search.onIndexProgress((progress) => {
    if (progress.projectId === projectId) {
      setIndexProgress(progress)
      if (progress.phase === 'finalizing') {
        setIndexStatus('ready')
      }
    }
  })
  return cleanup
}, [projectId])
```

### Passo 7: Componente de progresso visual

**Arquivo**: `electron/src/renderer/components/Header/ProjectHeaderBar.tsx`

Substituir indicador binario por barra de progresso com detalhes:

```tsx
function IndexProgressBar({ progress }: { progress: IndexProgress }) {
  const percent = progress.filesTotal > 0
    ? Math.round((progress.filesProcessed / progress.filesTotal) * 100)
    : 0
  
  const phaseLabel = {
    enumerating: 'Scanning files...',
    indexing: `Indexing ${progress.filesProcessed}/${progress.filesTotal}`,
    'git-history': 'Processing git history...',
    embedding: `Embedding ${progress.embeddingsGenerated}/${progress.embeddingsTotal}`,
    finalizing: 'Finalizing...',
  }[progress.phase]
  
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <div className="w-24 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span>{phaseLabel}</span>
      {progress.filesSkipped > 0 && (
        <span className="text-neutral-500">
          ({progress.filesSkipped} unchanged)
        </span>
      )}
    </div>
  )
}
```

---

## Arquivos Modificados/Criados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/main/services/ContextEngine.ts` | `onProgress()`, `emitProgress()`, tracking de progresso |
| `electron/src/main/index.ts` | Broadcast via webContents.send |
| `electron/src/shared/types.ts` | Novo canal `search:indexProgress` |
| `electron/src/shared/models.ts` | Interface `IndexProgress` |
| `electron/src/renderer/lib/api.ts` | `onIndexProgress` listener |
| `electron/src/renderer/layouts/ProjectLayout.tsx` | State de progresso, listener |
| `electron/src/renderer/components/Header/ProjectHeaderBar.tsx` | Componente `IndexProgressBar` |

## Testes

1. **Teste unitario**: `emitProgress()` chama callback com dados corretos
2. **Teste unitario**: Progresso incrementa corretamente a cada arquivo
3. **Teste unitario**: `estimatedRemainingMs` e calculado proporcionalmente
4. **Teste unitario**: Fase muda corretamente em cada etapa
5. **Teste manual**: Verificar barra de progresso durante indexacao de projeto real
6. **Teste manual**: Verificar que contagem de "unchanged" e precisa

## Riscos da Implementacao

- **Risco baixo**: Broadcast a cada 20 arquivos pode gerar muito IPC em projetos enormes. O throttling de 20 arquivos e suficiente.
- **Risco baixo**: `estimatedRemainingMs` pode ser impreciso se a velocidade variar muito (ex: arquivos grandes vs pequenos).

## Versao

Bump: minor (nova feature de UX)
