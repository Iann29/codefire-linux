# Browser Reset On Tab Switch Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO ✓
>
> **Implementado em:** 2026-03-08
> - `browserKey` incrementa ao sair da aba Browser, forçando remount limpo
> - `prevTab` tracking para detectar transição Browser → outra aba
> - BrowserView recebe `key={browserKey}` para reset determinístico
> - Verificado: `tsc --noEmit` passa limpo

---

## Goal

Quando o usuario sair da aba `Browser` para `Files`, `Notes`, `Tasks` ou qualquer outra:

- o browser deve morrer de forma explicita;
- o estado visual deve ser resetado;
- ao voltar para `Browser`, a view deve abrir limpa, sem tabs antigas nem loading pendente.

Importante:

- este plano trata **reset de runtime/UI**;
- limpeza de cookies/cache continua sendo responsabilidade do plano separado de clear session.

---

## Current Diagnosis

- `ProjectLayout.tsx` renderiza `BrowserView` apenas quando `activeTab === 'Browser'`.
- Na pratica, sair da aba desmonta a view.
- Isso ja mata o estado React local (`useBrowserTabs`, refs, listeners), mas de forma incidental, nao como contrato.
- O partition persistente `persist:browser` continua vivo e pode preservar sessao.
- O `BrowserBridge` e o `AgentService` continuam modelados como se um browser pudesse estar disponivel para automacao.

Resultado:

- parte do estado morre, parte nao;
- o comportamento atual parece "quase reset", mas nao e deterministico;
- debugging fica confuso.

---

## Proposed Solution

### 1. Tornar o reset um comportamento explicito

Em vez de depender do unmount como efeito colateral:

- detectar a transicao `Browser -> outra aba` no `ProjectLayout`;
- disparar uma rotina de reset dedicada;
- remountar `BrowserView` com uma `key` nova ao retornar.

### 2. Adicionar cleanup real no `BrowserView`

No unmount/reset:

- remover todos os `<webview>` criados manualmente;
- limpar `webviewRefs`;
- zerar `canGoBack`, `canGoForward`, `consoleEntries`, `captureScreenshot`, `showConsole`;
- restaurar a estrutura de tabs para uma unica tab `about:blank`.

### 3. Definir como o agent mode deve reagir

Se a aba Browser foi resetada e nao esta ativa, o sistema precisa decidir uma regra clara:

Opcoes:

1. falhar com erro claro: "Browser tab is not active";
2. auto-abrir a aba Browser antes de executar automacao;
3. manter um runtime invisivel fora da view.

Recomendacao:

- **nao** manter runtime invisivel;
- responder com erro claro na primeira iteracao;
- se o produto quiser automacao sem aba aberta, isso merece um design separado.

---

## Why This Needs A Real Plan

Hoje o comportamento ja parece "morrer ao sair da aba", mas isso acontece pelos motivos errados:

- o estado some porque a view desmonta;
- nao existe contrato de cleanup;
- nao existe reset visual garantido;
- nao existe integracao clara com browser automation.

Isso e exatamente o tipo de detalhe que gera bugs intermitentes depois.

---

## Files Likely Affected

- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/views/BrowserView.tsx`
- `src/renderer/hooks/useBrowserTabs.ts`
- possivelmente `src/main/services/BrowserBridge.ts`
- possivelmente `src/main/services/AgentService.ts`

---

## Implementation Steps

1. Adicionar detecao de troca de aba no `ProjectLayout`.
2. Introduzir um `browserInstanceKey` ou `browserResetVersion` controlado pelo layout.
3. Implementar cleanup explicito no `BrowserView`.
4. Padronizar o estado inicial do browser ao remountar.
5. Melhorar a mensagem de erro do `BrowserBridge` / `AgentService` quando nao houver runtime ativo.
6. Cobrir com teste de mount/unmount e smoke manual.

---

## Risks

- resetar agressivamente demais pode frustrar quem espera preservacao visual;
- resetar a view sem limpar refs/webviews pode deixar vazamento silencioso;
- mexer nesse lifecycle sem revisar automacao pode quebrar agent mode.

---

## Validation

1. Abrir duas tabs internas no Browser.
2. Navegar para um site stateful.
3. Trocar para `Files`.
4. Voltar para `Browser`.
5. Confirmar que:
   - a UI voltou para uma tab limpa;
   - nao existe spinner preso;
   - browser automation responde com comportamento coerente.
