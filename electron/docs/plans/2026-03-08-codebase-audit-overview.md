# Codebase Audit & Plan Index

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO ✓ — Todos os 9 planos implementados em 2026-03-08

---

## Context

Auditoria focada no app Electron em `electron/`, com enfase nos fluxos de browser embutido, chat mode, abertura de projetos, MCP e carregamento de memoria local do Claude.

---

## Architecture Snapshot

- O projeto tem uma separacao boa entre `src/main/`, `src/preload/` e `src/renderer/`.
- O preload e fino e typed, e o renderer conversa com o main via `window.api.invoke/on/send`.
- O registro de IPC esta razoavelmente organizado por dominio em `src/main/ipc/`.
- O renderer usa componentes e views pequenos, mas varios fluxos importantes ainda dependem de `useState` local em componentes grandes.

---

## O Que Esta Bom

1. A separacao main/preload/renderer esta mais madura que a media de apps Electron pequenos.
2. O `WindowManager`, os DAOs e os handlers por dominio deixam o backend do app relativamente legivel.
3. Existe uma base de testes real em `src/__tests__/`, inclusive para janelas, terminal e browser agent.
4. O layout com `react-resizable-panels` ja entrega uma base boa para evoluir o workspace.

---

## Achados Criticos

### 1. Browser e tratado como servico, mas implementado como estado efemero de view

- O browser vive dentro de `BrowserView.tsx`.
- Tabs, webviews, listeners e console state existem so enquanto a aba `Browser` esta montada.
- Ao mesmo tempo, `AgentService` e `BrowserBridge` assumem que existe um runtime de browser disponivel para automacao.

Impacto:
- bugs de lifecycle;
- automacao quebrando quando a view nao esta ativa;
- dificuldade para limpar estado, cookies e tabs de forma deterministica.

### 2. Navegacao de projeto esta hardcoded no modelo multi-window

- O fluxo atual foi desenhado deliberadamente como "main window + uma janela por projeto".
- Isso explica por que abrir projeto nao reutiliza a janela atual.
- O roteamento real depende de `?projectId=` na URL, nao de um router interno de workspace.

Impacto:
- experiencia fragmentada;
- custo alto para trocar para single-window;
- acoplamento forte entre UI e `WindowManager`.

### 3. Memoria e sessoes usam fontes de verdade diferentes

- Sessoes usam `project.claudeProject`.
- Memoria local usa um encoding derivado de `project.path`.
- `ProjectDiscovery` ja reconhece que a codificacao do Claude e ambigua, mas `memory-handlers.ts` usa uma regra simplificada.

Impacto:
- memoria "sumindo";
- mismatch entre o que o usuario ve em `Rules`/`Memory` e o que realmente existe em `~/.claude/projects/...`.

### 4. Chat mode ainda nao tem uma camada de comandos e telemetria

- `CodeFireChat.tsx` concentra envio, streaming, tool state, dropdowns, pending UI e renderizacao.
- Slash commands nao existem.
- Telemetria de contexto ainda e parcial: token usage por resposta ja existe, mas contexto atual e janela maxima nao.

Impacto:
- UX fraca para runs longos;
- dificil explicar `/context`;
- alta chance de regressao ao continuar empilhando features no mesmo componente.

### 5. MCP nao esta modularizado como feature opcional

- MCP aparece em runtime, IPC, tipos, hooks, status bars, settings, docs, build e packaging.
- Remover MCP nao e "apagar um arquivo"; e um corte transversal no produto.

Impacto:
- alto blast radius;
- risco de deixar strings, settings e build dead paths se a remocao for parcial.

### 6. O layout do workspace ainda e estatico demais para casos de uso diferentes

- `ProjectLayout` inicia sempre com `content=60%` e `terminal/chat=40%`.
- O browser ainda escala um viewport fixo `1920x1080` dentro do painel.

Impacto:
- a view Browser parece menor do que deveria;
- a UX nao muda conforme a aba ativa.

---

## Ordem Recomendada

1. Corrigir validacao de URL vazia/invalida no browser.
2. Adicionar reset/limpeza de sessao do browser.
3. Tornar o reset do browser ao sair da aba um comportamento explicito.
4. Ajustar o preset de layout da aba Browser.
5. Corrigir a fonte de verdade de memoria local e o que `Rules` deve exibir.
6. Melhorar pending UI do chat.
7. Implementar slash commands do chat, começando por `/context`.
8. Refatorar abertura de projeto para reutilizar a janela atual.
9. Remover MCP apenas em branch dedicada, por ser o item de maior blast radius.

---

## Index

- `2026-03-08-browser-clear-session-plan.md`
- `2026-03-08-browser-reset-on-tab-switch-plan.md`
- `2026-03-08-browser-empty-url-guard-plan.md`
- `2026-03-08-browser-layout-preset-plan.md`
- `2026-03-08-remove-mcp-plan.md`
- `2026-03-08-chat-context-command-plan.md`
- `2026-03-08-open-project-in-current-window-plan.md`
- `2026-03-08-project-memory-rules-alignment-plan.md`
- `2026-03-08-chat-pending-ui-plan.md`
