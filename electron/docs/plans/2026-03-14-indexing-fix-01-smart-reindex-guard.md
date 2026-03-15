# Plano 01: Smart Reindex Guard

**Data**: 2026-03-14
**Risco Corrigido**: #3 — Full reindex triggered on every project open
**Confianca na Causa**: ALTA
**Esforco**: Pequeno (~1h)
**Impacto**: Alto — elimina a causa mais frequente de lentidao perceptivel

---

## Problema

`ProjectLayout.tsx:102` chama `handleRequestIndex()` **incondicionalmente** no `useEffect` de montagem do componente. Isso significa que **toda vez que o usuario abre um projeto**, o sistema executa um reindex completo — mesmo que o projeto tenha sido indexado 5 segundos atras e nada tenha mudado.

O reindex completo inclui:
- `enumerateFiles()` com `readdirSync` recursivo (bloqueante)
- `readFileSync` + SHA256 de cada arquivo (bloqueante)
- `deleteStaleFiles()` que carrega todos os indexed files
- `indexGitHistory()` que executa `git log`
- `generateEmbeddings()` que pode fazer dezenas de API calls

Mesmo com o skip de arquivos unchanged (via hash), as etapas de enumeracao e hashing ja sao caras.

### Codigo Atual

```typescript
// ProjectLayout.tsx:82-115
useEffect(() => {
  let cancelled = false
  async function init() {
    try {
      const proj = await api.projects.get(projectId)
      if (cancelled) return
      if (!proj) { setError(`Project not found: ${projectId}`); return }
      setProject(proj)
      // Always trigger indexing when a project is opened  <-- PROBLEMA
      handleRequestIndex()
    } catch (err) { /* ... */ }
  }
  init()
  return () => { cancelled = true }
}, [projectId, handleRequestIndex])
```

---

## Solucao Proposta

Implementar um **guard inteligente** que verifica se a reindexacao e necessaria antes de executa-la. A decisao deve considerar:

1. **Tempo desde o ultimo index** — se foi indexado ha menos de X minutos, nao reindexar
2. **Status atual** — se ja esta indexando, nao iniciar outra
3. **FileWatcher ativo** — se o watcher esta rodando, mudancas incrementais ja estao sendo capturadas

### Estrategia

```
Ao abrir projeto:
  1. Buscar indexState via search:getIndexState
  2. SE status == 'indexing' → nao fazer nada (ja esta rodando)
  3. SE status == 'ready' E lastFullIndexAt < 5 min atras → nao reindexar
  4. SE status == 'idle' OU 'error' OU lastFullIndexAt > 5 min → reindexar
  5. Sempre iniciar FileWatcher (se nao estiver ativo)
```

---

## Implementacao

### Passo 1: Modificar `ProjectLayout.tsx`

**Arquivo**: `electron/src/renderer/layouts/ProjectLayout.tsx`

Substituir a chamada incondicional por uma verificacao:

```typescript
// Substituir handleRequestIndex() (linha 102) por:
const shouldReindex = async () => {
  const state = await api.search.getIndexState(projectId).catch(() => null)
  
  // Ja indexando — nao duplicar
  if (state?.status === 'indexing') {
    setIndexStatus('indexing')
    return false
  }
  
  // Indexado recentemente (< 5 min) — pular
  if (state?.status === 'ready' && state.lastFullIndexAt) {
    const lastIndex = new Date(state.lastFullIndexAt).getTime()
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    if (lastIndex > fiveMinAgo) {
      setIndexStatus('ready')
      return false
    }
  }
  
  return true
}

// No useEffect init():
const needsReindex = await shouldReindex()
if (needsReindex && !cancelled) {
  handleRequestIndex()
}
```

### Passo 2: Expor status do FileWatcher via IPC (opcional, melhoria extra)

**Arquivo**: `electron/src/main/ipc/search-handlers.ts`

Adicionar canal para verificar se o watcher esta ativo:

```typescript
ipcMain.handle('search:isWatching', async (_event, projectId: string) => {
  return fileWatcher.isWatching(projectId)
})
```

### Passo 3: Iniciar FileWatcher junto com o projeto

**Arquivo**: `electron/src/main/ipc/search-handlers.ts` ou `project-handlers.ts`

Garantir que o FileWatcher e iniciado quando um projeto e aberto, independente do reindex:

```typescript
// No handler search:reindex, ou num handler separado:
ipcMain.handle('search:ensureWatcher', async (_event, projectId: string) => {
  const project = projectDAO.getById(projectId)
  if (project && !fileWatcher.isWatching(projectId)) {
    fileWatcher.watch(projectId, project.path)
  }
})
```

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `electron/src/renderer/layouts/ProjectLayout.tsx` | Guard condicional antes de reindexar |
| `electron/src/main/ipc/search-handlers.ts` | (opcional) Novo canal `search:isWatching` |
| `electron/src/shared/types.ts` | (opcional) Adicionar novo canal ao tipo |

## Testes

1. **Teste manual**: Abrir um projeto, fechar, reabrir imediatamente — nao deve reindexar
2. **Teste manual**: Abrir um projeto pela primeira vez — deve reindexar
3. **Teste manual**: Abrir um projeto que foi indexado ha >5 min — deve reindexar
4. **Teste manual**: Abrir um projeto que ja esta indexando — deve mostrar status "indexing" sem iniciar novo
5. **Teste unitario**: Testar logica `shouldReindex()` com diferentes estados de IndexState

## Riscos da Implementacao

- **Risco baixo**: Se o threshold de 5 min for muito alto, o usuario pode ver dados desatualizados. Mitiga-se com o FileWatcher que ja captura mudancas incrementais.
- **Risco baixo**: Se o `lastFullIndexAt` nao estiver populado (projetos antigos), o guard sempre permitira reindex — comportamento correto.

## Versao

Bump: `1.27.4` -> `1.27.5` (patch — bug fix de performance)
