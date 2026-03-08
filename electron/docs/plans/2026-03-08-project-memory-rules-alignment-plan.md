# Project Memory And Rules Alignment Plan

> **Date:** 2026-03-08
> **Status:** Planning (nao implementar ainda)

---

## Goal

Mostrar corretamente a memoria local do projeto e alinhar `Rules` e `Memory` com a realidade do Claude Code.

No caso citado, o usuario espera ver algo como:

- `~/.claude/projects/<claudeProject>/memory/MEMORY.md`

de forma clara e confiavel dentro do app.

---

## Current Diagnosis

### 1. `Rules` nunca vai mostrar esse arquivo hoje

`RulesView` e `rules-handlers.ts` so trabalham com tres arquivos:

- `~/.claude/CLAUDE.md`
- `<projectPath>/CLAUDE.md`
- `<projectPath>/.claude/CLAUDE.md`

Entao olhar a aba `Rules` esperando achar `.../memory/MEMORY.md` nunca vai funcionar no desenho atual.

### 2. `Memory` usa uma fonte de verdade fragil

`memory-handlers.ts` deriva o diretorio assim:

- pega `projectPath`;
- faz um encode simplificado trocando `/` por `-`;
- monta `~/.claude/projects/<encoded>/memory`.

Isso ignora que o projeto ja possui um identificador mais canonico:

- `project.claudeProject`

E tambem ignora que `ProjectDiscovery.ts` ja reconhece a ambiguidade dessa codificacao.

### 3. O usuario enxerga duas features separadas para a mesma camada conceitual

Para o usuario, tudo isso e "contexto do agente":

- rules / instruction files;
- memoria local do Claude;
- eventualmente outros arquivos de contexto.

Hoje o app fragmenta essa experiencia entre `Rules` e `Memory`.

---

## Proposed Solution

### 1. Usar `claudeProject` como fonte primaria para memoria

Mudar o contrato dos handlers de memoria para receberem:

- `projectId`, ou
- o objeto de projeto inteiro,

em vez de depender so de `projectPath`.

Resolucao recomendada:

1. se `project.claudeProject` existir, usar `~/.claude/projects/<claudeProject>/memory`;
2. se nao existir, usar fallback legado;
3. registrar erro claro quando o path nao puder ser resolvido.

### 2. Parar de confundir "sem memoria" com "lookup errado"

Hoje, se o diretorio nao existe, o retorno vira lista vazia.

Isso deveria distinguir:

- projeto sem memoria;
- projeto com `claudeProject` ausente;
- projeto com path nao resolvido;
- erro de IO.

### 3. Melhorar a UX da aba `Rules`

Opcoes:

1. manter `Rules` e adicionar uma secao explicita de "Claude Memory";
2. fundir `Rules` e `Memory` numa aba maior de "Context".

Recomendacao pragmatica:

- manter as duas abas por enquanto;
- em `Rules`, adicionar um card ou secao clara apontando para a memoria do projeto;
- mostrar o path real;
- permitir abrir rapido o `MEMORY.md` correspondente.

### 4. Mostrar caminhos reais no editor

Hoje o editor de `Rules` mostra basicamente `CLAUDE.md`.

Melhoria:

- mostrar o path completo ou truncado de forma util;
- deixar claro o que e global, project, local e Claude memory;
- parar de esconder o arquivo real atras de labels genericas.

### 5. Considerar refresh / watch

Esses arquivos podem mudar fora do app.

Recomendacao:

- ao menos adicionar `Refresh`;
- idealmente observar mudancas externas nos arquivos de rules/memory.

---

## Files Likely Affected

- `src/main/ipc/memory-handlers.ts`
- `src/main/ipc/rules-handlers.ts`
- `src/main/services/ProjectDiscovery.ts`
- `src/renderer/views/MemoryView.tsx`
- `src/renderer/views/RulesView.tsx`
- `src/renderer/components/Rules/*`
- `src/renderer/components/Memory/*`
- `src/renderer/layouts/ProjectLayout.tsx`
- `src/shared/models.ts`

---

## Implementation Steps

1. Trocar o contrato de memoria para usar `projectId`/`claudeProject`.
2. Criar um resolver compartilhado de diretorio Claude do projeto.
3. Diferenciar erros de lookup de lista realmente vazia.
4. Melhorar `RulesView` para mostrar corretamente a memoria do projeto.
5. Exibir caminhos reais na UI.
6. Adicionar refresh e, se necessario, file watch.

---

## Recommendation

Nao tentar resolver isso so com cosmetica de UI.

O problema real e de **source of truth**:

- sessions olham para um lugar;
- memory olha para outro;
- a UI apenas revela essa inconsistência.

Primeiro corrigir a resolucao do projeto Claude, depois ajustar a UX.

---

## Risks

- se mudar o contrato sem fallback, projetos antigos podem perder memoria temporariamente;
- se misturar `Rules` e `Memory` demais de uma vez, a UI pode ficar confusa;
- se continuar usando `projectPath` como base principal, o bug volta em casos de symlink/path alternativo.

---

## Validation

1. Selecionar um projeto com `claudeProject` conhecido.
2. Confirmar que `MEMORY.md` e encontrado em `~/.claude/projects/<claudeProject>/memory`.
3. Validar leitura, edicao e refresh.
4. Confirmar que a aba `Rules` explica corretamente onde a memoria do projeto vive.
