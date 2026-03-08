# Visual Regression Baselines Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** permitir salvar baselines visuais por rota e viewport, comparar com o estado atual e destacar regressões de layout de forma objetiva.

---

## Problema

Grande parte dos bugs de site não aparece no console:

- espaçamento quebrado
- hero desalinhado
- CTA sumindo
- imagem errada
- menu com wrap indevido
- footer vazando

Hoje o CodeFire já faz screenshot, mas isso ainda é manual e sem memória histórica. Falta um sistema que permita responder:

- “isso mudou?”
- “quebrou mesmo ou só parece diferente?”
- “em qual breakpoint?”

---

## O que já existe na codebase

- `src/renderer/views/BrowserView.tsx`
  - captura screenshot
- `src/main/database/migrations/index.ts`
  - tabela `browserScreenshots`
- `src/renderer/views/ImagesView.tsx`
  - padrão de UI para histórico de artefatos visuais
- `src/main/ipc/image-handlers.ts`
  - referência de persistência de imagem por projeto

Conclusão: existe infraestrutura para capturar e guardar imagens, mas não para tratá-las como baseline comparável.

---

## Visão da Feature

O usuário poderá:

1. salvar a página atual como baseline
2. escolher rota + viewport + label do baseline
3. capturar o estado atual e comparar
4. ver diff com overlay ou heatmap
5. aprovar nova baseline ou abrir task

Essa feature é muito forte para:

- landing pages
- homepages
- páginas de produto
- dashboards com layout relativamente estável
- QA antes de deploy

---

## Fluxos de Uso

### Criar baseline

1. abrir rota no browser
2. escolher viewport
3. clicar `Save Baseline`
4. informar nome opcional
5. salvar screenshot e metadados

### Comparar com baseline

1. abrir mesma rota
2. clicar `Compare`
3. selecionar baseline correspondente
4. gerar diff
5. analisar regiões alteradas

### Atualizar baseline

1. comparar
2. se a mudança for intencional, clicar `Approve as New Baseline`

---

## Pré-requisitos Técnicos

Para diffs visuais serem úteis, o sistema precisa reduzir ruído.

### Normalização mínima

- viewport fixo por comparação
- aguardar carregamento completo
- aguardar settle adicional
- opcional de desativar animações via CSS injetado
- opcional de esconder cursores, vídeos ou relógios dinâmicos

Sem isso, o diff vira ruído e a feature perde credibilidade.

---

## Arquitetura Recomendada

### Pipeline de captura

1. navegador navega ou recarrega página
2. aguarda `did-stop-loading`
3. roda script de estabilização
4. captura imagem
5. salva artefato e metadados

### Pipeline de comparação

1. carregar baseline
2. capturar imagem atual
3. rodar diff pixel a pixel
4. gerar:
   - percentual de mudança
   - imagem diff
   - bounding boxes de regiões mais alteradas
5. apresentar no UI

### Biblioteca de diff

Avaliar `pixelmatch` ou similar para V1.

Requisitos:

- simples
- rápida
- previsível
- fácil de serializar resultado

### Persistência recomendada

Criar duas tabelas:

- `visualBaselines`
- `visualComparisons`

Campos sugeridos para `visualBaselines`:

- `id`
- `projectId`
- `routeKey`
- `pageUrl`
- `viewportWidth`
- `viewportHeight`
- `label`
- `imagePath`
- `createdAt`
- `createdBy`

Campos sugeridos para `visualComparisons`:

- `id`
- `projectId`
- `baselineId`
- `currentImagePath`
- `diffImagePath`
- `diffPercent`
- `status`
- `createdAt`

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/*`
- novos módulos em `src/renderer/visual-regression/*`
- novos IPC handlers em `src/main/ipc/*`
- novos serviços em `src/main/services/*`
- `src/main/database/migrations/index.ts`

---

## UX Proposta

### Dentro do Browser

- botão `Save Baseline`
- botão `Compare`
- drawer com:
  - baseline selecionado
  - screenshot atual
  - diff
  - percentual de mudança
  - ações `Create Task`, `Approve`, `Discard`

### Visualização

Três modos de inspeção:

- `Before`
- `After`
- `Diff`

Opcionalmente um quarto:

- `Swipe Compare`

---

## Fases de Entrega

### Fase 1

- salvar baseline
- comparar página atual com baseline
- mostrar diff percentual e imagem diff

### Fase 2

- múltiplas baselines por rota
- filtros por viewport
- integração com tasks e screenshots

### Fase 3

- execução em lote por conjunto de rotas
- integração direta com `Responsive Lab`
- integração com `Launch Guard`

---

## Riscos

### Diffs ruidosos

Mitigação: estabilização de captura e regras claras de viewport.

### Baselines demais, sem governança

Mitigação: rotas nomeadas, labels, histórico e política simples de substituição.

### Misturar com ImagesView

Mitigação: não reutilizar a feature de imagens geradas por IA como se fosse baseline de browser. O modelo mental é outro.

---

## Critérios de Sucesso

- baseline fácil de criar
- comparação confiável para páginas estáveis
- capacidade real de detectar regressão antes de deploy
- diff visual útil e não barulhento

---

## Resultado Esperado

O `Visual Regression Baselines` deve ser o mecanismo que transforma screenshot em memória operacional. A página deixa de ser vista só no presente e passa a ter um “antes” para comparação objetiva.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/ipc/visual-baseline-handlers.ts` (novo)
- `src/main/database/dao/VisualBaselineDAO.ts` (novo)
- `src/renderer/components/Browser/VisualBaselinePanel.tsx` (novo)
- `src/main/database/migrations/index.ts` (modificado - migration v22)
- `src/renderer/views/BrowserView.tsx` (modificado - integracao no footer)

### Observacoes:
- Fase 1 implementada conforme planejado
- Save/compare de baselines visuais com diff pixel-level
- VisualBaselineDAO para persistencia
- Migration v22 para tabela de baselines
- Integracao verificada com TypeScript --noEmit
