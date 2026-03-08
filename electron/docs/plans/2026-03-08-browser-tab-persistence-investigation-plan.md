# Browser Tab Persistence Investigation Plan

> **Date:** 2026-03-08
> **Status:** PROPOSTO
> **Objetivo:** investigar de forma precisa por que o browser ainda morre ao trocar de aba e definir a correção estrutural para manter estado, `webview` e sessão vivos entre trocas de tab.

---

## Sintoma Atual

O comportamento desejado era:

- sair de `Browser`
- ir para `Files`, `Notes`, `Tasks` ou outra aba
- voltar para `Browser`
- encontrar a página ainda aberta, com estado preservado

O comportamento real continua sendo:

- ao sair da aba `Browser`, a view fecha
- ao voltar, o browser já não está mais vivo como deveria

---

## Diagnóstico Inicial Já Confirmado

O problema não está só no `BrowserView`. Está no layout.

Em `src/renderer/layouts/ProjectLayout.tsx` existem dois fatores que, juntos, já explicam boa parte do bug:

### 1. Remount forçado

Há lógica explícita de remount:

- comentário `Plan 3: Browser Reset On Tab Switch`
- estado `browserKey`
- ao sair da aba `Browser`, o código incrementa a key

Isso garante que, ao voltar, um novo `BrowserView` será montado.

### 2. Render condicional

O `renderActiveView()` só renderiza:

- `{tab === 'Browser' && <BrowserView key={browserKey} ... />}`

Ou seja:

- quando `activeTab` deixa de ser `Browser`, o React desmonta o componente
- como `BrowserView` contém `useBrowserTabs`, `webviewRefs`, console state e o próprio `webview` DOM, todo esse estado morre junto

Conclusão direta:

Mesmo sem o `browserKey`, a renderização condicional já desmontaria o browser.

---

## O que precisa ser investigado

O objetivo agora não é “adivinhar um patch”, e sim provar qual arquitetura sustenta persistência real.

### Perguntas centrais

1. basta manter o `BrowserView` montado e escondido?
2. `webview` continua estável se a view ficar invisível?
3. o estado do browser deve viver no `ProjectLayout` ou em store própria?
4. existe custo alto de memória/CPU ao manter browser vivo em background?
5. quais partes precisam persistir mesmo se houver remount eventual?

---

## Hipóteses Técnicas

### Hipótese A: Hidden mount resolve

Manter `BrowserView` sempre montado e apenas esconder visualmente quando outra aba estiver ativa.

Prós:

- solução mais rápida de validar
- preserva estado local atual

Contras:

- pode manter `webview` consumindo recurso demais
- pode conflitar com lazy loading e layout

### Hipótese B: Estado sobe, view pode remountar

Extrair:

- tabs do browser
- active URL
- history/meta
- console state

para um store de nível `ProjectLayout`, e deixar `BrowserView` apenas como superfície.

Prós:

- maior resiliência

Contras:

- o `webview` em si ainda precisa de host persistente
- complexidade maior

### Hipótese C: Host persistente do browser

Criar um host do `webview` fora da árvore da aba ativa, mantendo o browser vivo independentemente da tab visível.

Prós:

- solução estrutural correta

Contras:

- exige refactor maior

---

## Passos de Investigação Recomendados

### Etapa 1: Instrumentação

Adicionar logs temporários ou dev instrumentation para registrar:

- mount/unmount de `BrowserView`
- mount/unmount do host do `webview`
- mudanças de `activeTab`
- criação e destruição de entradas em `webviewRefs`

### Etapa 2: Prova mínima

Remover temporariamente:

- bump de `browserKey`

e trocar renderização condicional por mount persistente escondido.

Objetivo:

- verificar se só isso já preserva sessão, página e DOM state

### Etapa 3: Teste de comportamento

Validar:

- página continua aberta
- scroll permanece
- formulário continua preenchido
- sessão de login permanece
- console state não zera
- navegação back/forward continua

### Etapa 4: Medição

Observar:

- consumo de memória
- comportamento com várias tabs internas do browser
- impacto ao alternar rapidamente entre abas do app

### Etapa 5: Decisão estrutural

Escolher entre:

- hidden mount simples
- host persistente dedicado
- store + host persistente

---

## Arquitetura Recomendada após Investigação

### Direção mais provável

A correção mais consistente tende a ser:

1. remover remount forçado por `browserKey`
2. manter o host do browser montado fora do fluxo condicional da aba
3. usar visibilidade/layout para mostrar ou ocultar o browser
4. depois, se necessário, mover parte do estado do browser para store própria

### Por que essa direção faz sentido

Hoje o `BrowserView` é stateful demais para viver em um render condicional. O `webview` não é um componente barato como uma lista comum; ele precisa de lifecycle mais estável.

---

## Arquivos Prováveis de Investigação e Correção

- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/views/BrowserView.tsx`
- `src/renderer/hooks/useBrowserTabs.ts`
- possivelmente novos módulos em `src/renderer/browser/*` para store ou host persistente

---

## Critérios de Sucesso

- trocar de `Browser` para qualquer outra aba e voltar sem perder a página
- preservar tabs internas do browser
- preservar sessão e estado da página
- evitar recriação desnecessária de `webview`
- manter consumo aceitável de recursos

---

## Riscos

### Corrigir só o sintoma e não a arquitetura

Mitigação: não parar em “tirar o key”; investigar também o render condicional e o host do `webview`.

### Browser vivo demais consumir recursos

Mitigação: medir custo real e, se preciso, pausar certos observers quando a aba não estiver visível.

### Estado parcialmente persistido

Mitigação: testar explicitamente URL, tabs, scroll, form state e sessão, não apenas “a página parece aberta”.

---

## Resultado Esperado

Esse plano deve levar a uma correção de verdade, não a mais um ajuste superficial. O browser precisa deixar de ser uma view descartável e passar a ser uma superfície persistente do projeto dentro do CodeFire.
