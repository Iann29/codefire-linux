# Open Project In Current Window Plan

> **Date:** 2026-03-08
> **Status:** Planning (nao implementar ainda)

---

## Goal

Ao abrir um projeto, reutilizar a janela atual do CodeFire em vez de criar outra `BrowserWindow`.

Objetivo pratico:

- sair do fluxo multi-window como comportamento padrao;
- manter a navegacao dentro do app mais parecida com um workspace unico.

---

## Current Diagnosis

Hoje o comportamento nao e um bug isolado; e o design atual:

- `api.windows.openProject(projectId)` e chamado em varios entry points do renderer;
- isso cai em `window:openProject`;
- o handler chama `WindowManager.createProjectWindow(projectId)`;
- `WindowManager` foi desenhado explicitamente para:
  - uma janela principal;
  - uma janela por projeto;
  - reuse apenas por `projectId`.

No renderer:

- `App.tsx` decide entre `MainLayout` e `ProjectLayout` olhando `?projectId=...`.

Ou seja:

- o modo projeto hoje e outra janela;
- nao existe roteamento interno real para "trocar de projeto nesta mesma janela".

---

## Target Architecture

Migrar para um modelo em que:

- a janela atual troca de contexto;
- o renderer possui um estado de navegacao/workspace;
- `WindowManager` deixa de ser a forma padrao de navegar entre projetos.

---

## Proposed Strategy

### Phase 1. Criar navegacao interna de projeto

Adicionar um fluxo renderer-side para:

- abrir `ProjectLayout` na mesma janela;
- voltar para `MainLayout`;
- trocar de um projeto para outro sem recriar a janela.

Implementacao possivel:

- manter `projectId` em estado/router interno;
- opcionalmente sincronizar isso com `history.pushState` ou hash/query, mas sem depender de nova `BrowserWindow`.

### Phase 2. Trocar os call sites do renderer

Atualizar todos os lugares que hoje chamam `api.windows.openProject(projectId)` para usar algo como:

- `navigateToProject(projectId)`

Entry points principais:

- `ProjectDropdown`
- `Sidebar`
- `ProjectTaskSummary`
- qualquer CTA semelhante em views futuras

### Phase 3. Rebaixar o multi-window para opcional

Se ainda fizer sentido manter multi-window:

- deixar isso atras de botao secundario, atalho ou menu contextual;
- nao como comportamento padrao.

### Phase 4. Simplificar `WindowManager`

Depois que a navegacao principal estiver pronta:

- reduzir responsabilidade de `ProjectWindow`;
- avaliar se ainda vale manter `ProjectWindow.ts` e o map por projeto;
- remover complexidade de state persistence por janela, se ela deixar de ser necessaria.

---

## Files Likely Affected

- `src/renderer/App.tsx`
- `src/renderer/layouts/MainLayout.tsx`
- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/components/Header/ProjectDropdown.tsx`
- `src/renderer/components/Home/ProjectTaskSummary.tsx`
- `src/renderer/components/Sidebar/*`
- `src/renderer/lib/api.ts`
- `src/main/ipc/window-handlers.ts`
- `src/main/windows/WindowManager.ts`
- `src/main/windows/ProjectWindow.ts`

---

## Hidden Work You Must Account For

Trocar de projeto na mesma janela mexe em mais do que layout:

- terminais precisam ser encerrados e recriados para o novo `projectPath`;
- chat precisa recarregar conversas do novo projeto;
- index status e briefing precisam trocar de contexto;
- browser embutido precisa resetar para o novo projeto;
- qualquer estado local em views precisa ser descartado corretamente.

Se isso nao for tratado, o resultado vira vazamento de contexto entre projetos.

---

## Recommendation

Implementar primeiro o "single-window by default" sem tentar preservar estado entre projetos.

Ao navegar para outro projeto:

- desmontar o workspace anterior;
- reconstruir tudo com o novo `projectId`;
- priorizar correteza antes de tentar transicoes elegantes.

---

## Risks

- alto impacto estrutural;
- grande chance de vazamento de estado entre projetos;
- terminal/browser/chat podem ficar apontando para projeto antigo se a troca nao for centralizada.

---

## Validation

1. Abrir um projeto a partir de `All Projects`.
2. Confirmar que nenhuma nova janela foi criada.
3. Abrir outro projeto a partir do dropdown.
4. Confirmar que a mesma janela trocou de contexto.
5. Verificar terminal, chat, browser, index status e memos no novo projeto.
