# Browser Clear Session Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO ✓
>
> **Implementado em:** 2026-03-08
> - Handler `browser:clearSession` no main process (limpa cookies, cache, storage)
> - Botão "Clear Session" no BrowserToolbar com ícone Trash2
> - `handleClearSession` no BrowserView: limpa sessão, remove webviews, reseta tabs
> - `resetTabs()` no hook useBrowserTabs
> - Tool `browser_reset_session` no AgentService para automação
> - Verificado: `tsc --noEmit` passa limpo

---

## Goal

Adicionar:

1. um botao visivel no browser para limpar cookies, cache e storage;
2. uma tool para agentes abrirem uma sessao realmente limpa antes de testar login, onboarding, checkout e cenarios stateful.

---

## Current Diagnosis

- Os webviews usam um partition fixo: `persist:browser` em `src/renderer/views/BrowserView.tsx`.
- Hoje nao existe nenhum handler dedicado para limpar essa sessao.
- Como o partition e persistente, sair e voltar da aba Browser nao garante sessao limpa.
- O agente consegue automatizar o browser, mas nao consegue forcar um "clean room state" sem fechar o app inteiro.

---

## Architectural Decision

Fazer a limpeza no **main process**, nao no renderer.

Motivos:

- o estado de cookies/cache pertence ao `session` do Electron, nao ao React;
- a mesma limpeza precisa servir para UI e para agent tool;
- centralizar isso no main evita duplicar logica em `BrowserView`.

---

## Proposed Solution

### 1. Criar uma API de reset de sessao do browser

Adicionar um handler novo no main, algo como:

- `browser:clearSession`

Responsabilidades:

- resolver o partition `persist:browser`;
- executar `clearStorageData(...)` para cookies, localStorage, indexedDB, service workers, cache storage e afins;
- executar `clearCache()`;
- opcionalmente limpar auth cache, se suportado pela versao atual do Electron;
- emitir um evento renderer-side confirmando que a sessao foi limpa.

### 2. Adicionar um botao no toolbar do Browser

Em `BrowserToolbar.tsx`:

- incluir um botao discreto de "Reset Session" / "Clear Session";
- pedir confirmacao antes da limpeza;
- apos sucesso, navegar a aba atual para `about:blank` e resetar tabs/loading state.

### 3. Adicionar uma tool para agent mode

No `AgentService.ts`:

- registrar uma tool nova, algo como `browser_reset_session`;
- implementar a execucao direto no main, sem depender do `BrowserBridge`;
- retornar um payload claro: quantos stores foram limpos, se o cache foi limpo e se houve reload/reset visual.

### 4. Resetar a UI do Browser depois da limpeza

No renderer:

- ouvir um evento tipo `browser:sessionCleared`;
- destruir webviews vivos;
- limpar `tabs`, `activeTabId`, `canGoBack`, `canGoForward`, console entries e qualquer loading state pendente;
- voltar para uma unica tab `about:blank`.

---

## Files Likely Affected

- `src/main/ipc/`:
  - novo handler de browser session, ou extensao de um handler existente
- `src/shared/types.ts`
- `src/renderer/lib/api.ts`
- `src/renderer/components/Browser/BrowserToolbar.tsx`
- `src/renderer/views/BrowserView.tsx`
- `src/main/services/AgentService.ts`

Opcional:

- criar um helper proprio, por exemplo `src/main/services/BrowserSessionService.ts`, para nao espalhar `session.fromPartition(...)`.

---

## Important Product Choice

O partition atual e **global ao app inteiro** (`persist:browser`), nao por projeto.

Isso significa:

- limpar a sessao vai afetar todos os projetos/janelas do CodeFire;
- isso pode ser desejado para teste;
- mas nao e o mesmo que isolamento por projeto.

Recomendacao:

- manter a primeira versao global, porque e simples e resolve o problema;
- documentar no tooltip e na tool que a limpeza afeta todo o browser embutido;
- deixar como follow-up um particionamento por projeto (`persist:browser:<projectId>`), se isso virar prioridade.

---

## Implementation Steps

1. Introduzir API de limpeza no main process.
2. Expor a API no preload/types/api.
3. Adicionar botao e fluxo de confirmacao no toolbar.
4. Adicionar evento de "session cleared" para o renderer resetar a view.
5. Adicionar tool no `AgentService`.
6. Cobrir com testes de unidade e smoke.

---

## Risks

- limpar storage sem resetar tabs deixa UI inconsistente;
- limpar um partition global pode surpreender se houver mais de uma janela aberta;
- se a tool fizer limpeza sem confirmacao, o agente pode apagar uma sessao ativa do usuario sem querer.

Mitigacao:

- reset visual obrigatorio apos limpeza;
- confirmacao no botao de UI;
- para agent mode, respeitar a mesma politica de acao destrutiva do browser.

---

## Validation

1. Abrir um site com login, autenticar e confirmar que cookies existem.
2. Acionar o botao de limpeza.
3. Reabrir o mesmo site e verificar que o login sumiu.
4. Rodar a mesma sequencia via agent tool.
5. Testar com duas janelas de projeto abertas para confirmar o comportamento global.
