# Remove MCP Completely Plan

> **Date:** 2026-03-08
> **Status:** Planning (nao implementar ainda)

---

## Goal

Remover MCP por completo do CodeFire:

- runtime;
- UI;
- settings;
- IPC;
- build;
- docs;
- packaging.

Motivacao declarada:

- MCP nao esta sendo usado;
- ele adiciona ruido de contexto e complexidade desnecessaria ao produto atual.

---

## Important Reality Check

MCP hoje nao e um detalhe isolado. Ele esta espalhado em:

- runtime (`MCPServerManager`, polling de conexao, IPC);
- UI (`MCPIndicator`, status bars, headers, hooks);
- settings (`mcpServerAutoStart`);
- build (`vite.config.ts` compila `src/mcp/server.ts`);
- packaging (`electron/mcp-server/`, script `build:mcp`);
- docs e copy de produto.

Entao a remocao precisa ser tratada como um **corte transversal**, nao como limpeza cosmetica.

---

## Scope Inventory

### Runtime e IPC

- `src/main/services/MCPServerManager.ts`
- `src/main/ipc/mcp-handlers.ts`
- `src/main/index.ts`
- `src/main/ipc/index.ts`
- `src/shared/types.ts`

### Renderer

- `src/renderer/hooks/useMCPStatus.ts`
- `src/renderer/components/StatusBar/MCPIndicator.tsx`
- `src/renderer/components/Header/ProjectHeaderBar.tsx`
- `src/renderer/components/StatusBar/AgentStatusBar.tsx`
- `src/renderer/layouts/MainLayout.tsx`
- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/lib/api.ts`
- settings que ainda expõem texto/controle relacionado a MCP

### Build e Packaging

- `src/mcp/server.ts`
- `electron/mcp-server/package.json`
- `vite.config.ts`
- `package.json` (`build:mcp` e qualquer path associado)

### Docs e Copy

- `README.md`
- landing / getting-started / screenshots / hints
- textos que ainda falam "browser MCP tools"

---

## Proposed Strategy

### Phase 1. Congelar a feature e remover pontos visiveis

- tirar indicadores MCP do header e status bar;
- remover `useMCPStatus` dos layouts;
- esconder/remover `mcpServerAutoStart` das settings;
- trocar copy de "browser MCP tools" por "browser agent tools" ou "browser automation tools".

Objetivo:

- o produto deixa de parecer depender de MCP antes mesmo de apagar o backend.

### Phase 2. Remover runtime e IPC

- parar de instanciar `MCPServerManager` no `main/index.ts`;
- remover `registerMCPHandlers`;
- remover `MCPChannel` e API associada;
- limpar listeners `mcp:statusChanged`.

### Phase 3. Remover build e server standalone

- apagar `src/mcp/server.ts`;
- remover o build separado no `vite.config.ts`;
- remover `electron/mcp-server/`;
- remover scripts e docs de distribuicao.

### Phase 4. Limpeza de configuracao e docs

- remover `mcpServerAutoStart` do modelo default;
- decidir se a chave antiga sera ignorada silenciosamente ou migrada para limpeza;
- atualizar README, landing e textos de onboarding.

---

## Coupling Risks

### 1. Copy de browser ainda fala em MCP

Mesmo sem o server, existe texto no app que associa browser automation a MCP. Isso precisa ser limpo para nao deixar narrativa quebrada.

### 2. O app nasceu muito apoiado em "persistent memory via MCP"

README e posicionamento do produto vao mudar. Se isso nao for revisado junto, a remocao tecnica deixa o marketing incoerente.

### 3. Build e release podem quebrar silenciosamente

Se remover o runtime mas esquecer o Vite build extra ou o `mcp-server/`, o release continua empacotando lixo ou falha em etapas especificas.

---

## Recommendation

Fazer essa remocao em branch dedicada, separada das melhorias de browser/chat.

Razao:

- o blast radius e alto;
- fica mais facil testar packaging e docs;
- evita misturar refactor de produto com correcoes taticas.

---

## Validation

1. O app compila sem `src/mcp/server.ts`.
2. Nenhum header/status bar renderiza indicador MCP.
3. Nenhuma settings tab mostra auto-start ou hints de MCP.
4. Nenhum IPC channel `mcp:*` permanece em tipos ou preload.
5. README/landing nao vendem mais a feature.
6. Release build passa sem artifacts de MCP.
