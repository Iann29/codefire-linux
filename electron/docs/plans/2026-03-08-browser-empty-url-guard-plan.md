# Browser Empty URL Guard Plan

> **Date:** 2026-03-08
> **Status:** Planning (nao implementar ainda)

---

## Goal

Resolver o bug em que:

- o usuario entra na aba Browser;
- nao digita nada;
- aperta Enter;
- a UI fica presa carregando `https://` indefinidamente.

---

## Current Diagnosis

O problema nasce da combinacao de dois pontos:

### 1. O toolbar fabrica uma URL invalida

Em `BrowserToolbar.tsx`:

- `inputUrl.trim()` pode virar string vazia;
- o codigo prefixa `https://`;
- o resultado e a string invalida `https://`.

### 2. O `BrowserView` assume que toda navegacao vai se resolver por evento

Em `BrowserView.tsx`:

- `handleNavigate()` ja seta `isLoading = true`;
- o loading so volta para `false` quando algum evento do webview dispara;
- nao ha validacao previa com `new URL(...)`;
- nao ha `try/catch` cobrindo `loadURL(...)`;
- nao ha timeout de seguranca para esse caminho.

---

## Proposed Solution

### 1. Criar uma pipeline unica de normalizacao de endereco

Extrair uma funcao utilitaria com regras explicitas:

- string vazia => `noop`
- `http://` ou `https://` validos => `url`
- texto com espacos => `search`
- dominio simples (`example.com`) => `url`
- protocolo sem host (`https://`) => `invalid`

Essa funcao deve ser usada pelo toolbar e pelo `BrowserView`, para nao haver duas logicas diferentes.

### 2. Tratar vazio como no-op, nao como navegacao

Ao pressionar Enter com input vazio:

- nao navegar;
- nao criar webview;
- nao setar `isLoading = true`;
- opcionalmente mostrar hint discreto no input.

### 3. Tratar invalido como erro local de UI

Se o parser detectar entrada invalida:

- manter o browser no estado anterior;
- mostrar erro inline curto, por exemplo "Enter a full URL or search term";
- nunca deixar o tab entrar em loading infinito.

### 4. Blindar o `loadURL`

Mesmo com validacao:

- envolver `loadURL(...)` em `try/catch`;
- se der erro sincrono ou promise rejection, resetar `isLoading`;
- adicionar fallback de timeout para navegacoes que nao emitirem evento de sucesso/falha.

### 5. Cobrir mais eventos de falha

Revisar o webview para ouvir tambem eventos de falha provisoria e de navegacao abortada, em vez de depender so de `did-fail-load`.

---

## Files Likely Affected

- `src/renderer/components/Browser/BrowserToolbar.tsx`
- `src/renderer/views/BrowserView.tsx`
- opcional: novo utilitario, por exemplo `src/renderer/components/Browser/address-input.ts`
- testes de browser renderer

---

## Implementation Steps

1. Extrair `normalizeBrowserAddressInput(raw)`.
2. Ajustar o toolbar para nao produzir `https://` sozinho.
3. Ajustar `BrowserView.handleNavigate()` para usar o normalizador.
4. Adicionar erro inline e reset de loading.
5. Adicionar timeout defensivo e mais eventos de falha.
6. Cobrir com testes unitarios do normalizador.

---

## Recommended Behavior Matrix

- `""` => no-op
- `"   "` => no-op
- `"https://"` => invalid
- `"http://"` => invalid
- `"example.com"` => `https://example.com`
- `"openai.com/docs"` => `https://openai.com/docs`
- `"how to use playwright"` => busca

---

## Risks

- se a heuristica de busca for agressiva demais, pode transformar URL valida em search;
- se for conservadora demais, o usuario perde conveniencia;
- se o loading state continuar espalhado entre toolbar e view, o bug pode reaparecer.

---

## Validation

1. Testar Enter com input vazio.
2. Testar Enter com `https://`.
3. Testar Enter com dominio simples.
4. Testar Enter com frase de busca.
5. Confirmar que nenhum desses casos deixa o tab preso em spinner.
