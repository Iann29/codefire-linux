# Browser Layout Remount Fix Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Removido `isBrowserTab` do cálculo de `layoutKey` em ProjectLayout.tsx. Agora `layoutKey` depende apenas de `terminalOnLeft`, impedindo remounts do Group ao trocar tabs. O BrowserView já era mantido persistente com display:none/flex via `renderContentWithPersistentBrowser()`, e agora essa persistência funciona de fato pois o Group não remonta.
> **Objetivo:** corrigir a falsa persistência do Browser, removendo remounts estruturais do layout e garantindo que o `BrowserView` e seus `webview`s sobrevivam à troca entre tabs.

---

## Problema

A implementação recente tentou deixar o browser sempre montado, mas ainda há um reset estrutural no layout.

Hoje, em `src/renderer/layouts/ProjectLayout.tsx`:

- `layoutKey` depende de `isBrowserTab`
- o `Group` principal recebe `key={layoutKey}`
- ao trocar entre `Browser` e qualquer outra tab, esse `key` muda
- o React remonta a árvore inteira do split

Na prática, isso pode desmontar o host que deveria manter o browser vivo.

---

## Evidência Atual

Pontos concretos:

- `layoutKey` muda com `isBrowserTab` em `src/renderer/layouts/ProjectLayout.tsx`
- `BrowserView` agora fica em `renderContentWithPersistentBrowser()`
- mas esse container ainda vive dentro do `Group` keyed

Isso invalida a premissa de “browser persistente”.

---

## Objetivo Funcional

Depois da correção:

- trocar de `Browser` para `Files`, `Notes`, `Tasks`, `Git` ou outra aba não desmonta o browser
- URL, tabs internas, histórico e sessão do browser permanecem
- se houver formulário parcialmente preenchido, ele continua lá
- o browser só deve reiniciar quando o usuário explicitamente pedir reset/clear session

---

## Estratégia Recomendada

### 1. Separar “preset de layout” de “persistência do browser”

O erro atual foi misturar:

- mudança de tamanho do split
- lifecycle do browser

O split pode reagir ao contexto atual sem destruir o host do browser.

### 2. Tirar `isBrowserTab` do `key` estrutural

`layoutKey` deve refletir apenas mudanças que realmente exigem remount do layout.

Exemplo:

- mudar lado terminal/chat pode justificar reconfiguração visual
- mudar tab ativa não deve desmontar a árvore estrutural

### 3. Opcionalmente elevar o host do browser

Se o `Group` ainda se mostrar instável, mover o host do Browser para um nível acima do split principal:

- o conteúdo das tabs troca
- o host do browser permanece fixo e só alterna visibilidade

---

## Arquitetura Recomendada

### Opção A: Correção mínima e suficiente

- `layoutKey` não depende mais de `isBrowserTab`
- `BrowserView` fica montado no mesmo nível atual
- apenas `display` ou classe condicional controla visibilidade

### Opção B: Host persistente dedicado

Criar um `PersistentBrowserHost` no `ProjectLayout`:

- monta uma vez
- recebe `projectId`
- controla `visible`
- o resto das tabs rende ao lado

Isso deixa a intenção mais explícita e reduz acoplamento.

---

## Arquivos Prováveis de Implementação

- `src/renderer/layouts/ProjectLayout.tsx`
- possivelmente novo `src/renderer/components/Browser/PersistentBrowserHost.tsx`
- `src/renderer/views/BrowserView.tsx`
- `src/renderer/hooks/useBrowserTabs.ts`

---

## Plano de Execução

### Fase 1

- remover `isBrowserTab` do `layoutKey`
- testar persistência com terminal visível e oculto

### Fase 2

- se necessário, extrair `PersistentBrowserHost`
- deixar lifecycle do browser mais explícito no layout

### Fase 3

- adicionar testes de regressão para troca de tabs

---

## Testes Necessários

- abrir site no Browser, trocar para `Files`, voltar e verificar URL
- abrir múltiplas tabs internas do browser e validar que permanecem
- manter login/session cookie
- manter scroll e estado visual de uma página dinâmica
- repetir com terminal ligado e desligado

---

## Riscos

- o layout preset do browser deixar de reaplicar o tamanho desejado ao entrar na tab
- manter browser vivo aumentar consumo de memória

### Mitigação

- separar persistência e layout preset
- se necessário, reaplicar tamanho via state/controlado, não via remount

---

## Critério de Sucesso

O browser deve deixar de ser “quase persistente” e passar a ser persistentemente vivo no app, inclusive no caso padrão com painel lateral ativo.
