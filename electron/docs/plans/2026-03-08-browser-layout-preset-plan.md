# Browser Layout Preset Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO ✓
>
> **Implementado em:** 2026-03-08
> - Browser ativo: split 78/22 (content/terminal-chat)
> - Outras abas: split 60/40 (padrão mantido)
> - `layoutKey` muda ao trocar para/de Browser, remontando panels com novos defaults
> - Verificado: `tsc --noEmit` passa limpo

---

## Goal

Fazer a aba Browser abrir com mais area util por padrao, aproximando a experiencia de "quase full screen" mesmo com terminal/chat ativos.

O objetivo principal nao e esconder funcionalidades, e sim:

- deixar a coluna da direita menor no primeiro load;
- priorizar a area do site;
- reduzir a sensacao de que o browser esta espremido.

---

## Current Diagnosis

Dois fatores deixam o browser menor do que deveria:

### 1. O split principal nasce em `60 / 40`

Em `ProjectLayout.tsx`:

- `content` comeca em `60%`;
- `terminal-chat` comeca em `40%`;
- quando o chat esta aberto, esse `40%` ainda e subdividido em `50 / 50`.

Na pratica, o browser começa pequeno demais para uma aba que naturalmente pede prioridade visual.

### 2. O browser interno usa viewport fixo `1920x1080`

Em `BrowserView.tsx`:

- o webview nao ocupa o container livremente;
- ele e desenhado num viewport fixo e escalado com `transform: scale(...)`.

Mesmo abrindo mais espaco no split, ainda pode sobrar area morta dependendo da proporcao.

---

## Proposed Solution

### Phase 1. Ajustar o preset de layout da aba Browser

Adicionar logica no `ProjectLayout` para, ao ativar `Browser`:

- usar um preset mais favoravel ao conteudo, por exemplo `78 / 22`;
- se o usuario ainda nao redimensionou manualmente naquela sessao;
- preservar o resize manual depois do primeiro ajuste.

### Phase 2. Opcional: preset especifico quando chat esta aberto

Se `showChat === true`:

- manter a coluna direita estreita;
- dentro dela, considerar um split vertical menos agressivo que `50 / 50`, algo como `55 / 45`.

O ponto principal aqui continua sendo a largura total da coluna direita, nao tanto a divisao interna.

### Phase 3. Follow-up visual no BrowserView

Se, depois do preset novo, o browser ainda parecer "encaixotado":

- adicionar um modo `fit-to-panel`;
- ou revisar o viewport fixo `1920x1080`.

Isso deve ser tratado como follow-up separado se o preset sozinho nao bastar.

---

## Files Likely Affected

- `src/renderer/layouts/ProjectLayout.tsx`
- possivelmente `src/renderer/views/BrowserView.tsx`

Opcional:

- persistencia de layout por aba/projeto, se quiser memorizar tamanhos.

---

## Implementation Strategy

### Short Term

- aplicar preset automatico quando `activeTab` virar `Browser`;
- nao aplicar de novo depois que o usuario redimensionar manualmente.

### Medium Term

- suportar presets por tipo de view:
  - browser-first
  - coding-first
  - review-first

Isso evita continuar hardcoding tudo num unico `60 / 40`.

---

## Product Recommendation

Recomendacao pragmatica para a primeira versao:

- Browser ativo + terminal visivel => `78 / 22`
- Browser ativo + terminal escondido => `100 / 0`
- outras abas => manter comportamento atual

Assim a mudanca fica pequena, reversivel e alinhada com o pedido.

---

## Risks

- redimensionar sempre que entra na aba pode irritar usuarios que ja ajustaram manualmente;
- mexer no split sem tratar o viewport fixo pode resolver so metade da percepcao;
- presets por aba sem persistencia podem parecer "nervosos".

Mitigacao:

- aplicar preset so na primeira entrada ou ate o primeiro drag manual.

---

## Validation

1. Abrir projeto com terminal e chat visiveis.
2. Entrar na aba Browser.
3. Confirmar que o painel do site recebe mais largura imediatamente.
4. Redimensionar manualmente.
5. Trocar de aba e voltar.
6. Confirmar que o resize manual foi respeitado.
