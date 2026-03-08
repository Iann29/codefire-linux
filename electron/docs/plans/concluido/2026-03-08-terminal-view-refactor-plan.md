# Terminal View Refactor Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Terminal movido de painel lateral para tab dedicada na TabBar. Criado TerminalView.tsx como wrapper. Layout simplificado - removido split resizável entre conteúdo e terminal. Chat desacoplado do terminal, agora funciona como drawer overlay (400px, lado direito). Botão no header mudou de Terminal para Chat. Drag-and-drop de painéis removido. react-resizable-panels removido do layout principal.
> **Objetivo:** remover o terminal como painel lateral estrutural e transformá-lo em uma view/tab de primeira classe, com múltiplos terminais, layout interno e persistência real entre trocas de aba.

---

## Problema

Hoje o terminal domina a arquitetura do `ProjectLayout`:

- existe split fixo entre conteúdo e `TerminalPanel`
- o terminal não é uma tab do produto
- `showTerminal` influencia layout inteiro
- o chat fica acoplado ao terminal

Isso torna várias coisas mais difíceis:

- persistir melhor o terminal
- simplificar o layout
- abrir uma tela dedicada de terminais
- desacoplar Chat Mode do painel lateral

---

## Estado Atual

Arquivos centrais:

- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/components/Terminal/TerminalPanel.tsx`
- `src/renderer/components/Terminal/TerminalTab.tsx`
- `src/shared/types.ts`
- `terminal:*` IPC no main

Hoje:

- `TerminalPanel` cria e mata PTYs no próprio lifecycle
- ao desmontar, tenta matar todas as sessões
- isso conflita com a ideia de persistência longa

---

## Objetivo Funcional

Depois da refatoração:

- `Terminal` vira uma tab visível no `TabBar`
- o terminal pode abrir quantas tabs internas o usuário quiser
- sair de `Terminal` não mata as PTYs
- voltar para `Terminal` mostra o estado ainda vivo
- chat deixa de depender do painel lateral

---

## Estratégia Recomendada

### 1. Mover terminal para view dedicada

Adicionar `Terminal` em `TabBar`.

Criar:

- `src/renderer/views/TerminalView.tsx`

Essa view hospeda o gerenciador de terminais.

### 2. Extrair estado e lifecycle

O lifecycle da PTY não deve depender do mount do painel React.

Criar store/controlador de terminais:

- tabs abertas
- tab ativa
- metadados de PTY

O renderer pode desmontar a view e, ao remontar, religar à store.

### 3. Desacoplar Chat Mode

O chat precisa ter posição própria no produto.

Alternativas:

- chat continua como drawer/painel global independente
- chat também vira tab dedicada no futuro

O importante é parar de amarrá-lo ao `TerminalPanel`.

---

## Arquitetura Recomendada

### Terminal manager de renderer

Criar algo como:

- `useTerminalWorkspaceStore`

Estado sugerido:

- `tabs`
- `activeTabId`
- `layoutMode`
- `splitConfig`

### PTY lifecycle

O main já mantém as PTYs. O renderer deve apenas:

- criar
- anexar listeners
- escrever
- redimensionar
- matar sob ação explícita

### Persistência opcional

Depois da V1:

- salvar tabs e layout no config ou storage local por projeto

---

## Arquivos Prováveis de Implementação

- `src/renderer/layouts/ProjectLayout.tsx`
- `src/renderer/components/TabBar/TabBar.tsx`
- novo `src/renderer/views/TerminalView.tsx`
- `src/renderer/components/Terminal/TerminalPanel.tsx`
- `src/renderer/components/Terminal/TerminalTab.tsx`
- `src/shared/models.ts` se houver persistência de workspace

---

## Plano de Execução

### Fase 1

- adicionar tab `Terminal`
- renderizar view dedicada usando o panel atual como base
- remover split lateral estrutural do layout

### Fase 2

- extrair store de workspace do terminal
- preservar tabs/PTYS ao trocar de view

### Fase 3

- layout interno avançado
- persistência por projeto
- integração melhor com sessions/Claude

---

## Riscos

- desmontar `TerminalPanel` ainda matar PTYs
- regressão de UX para quem usa terminal + chat simultâneos

### Mitigação

- desacoplar cleanup do mount/unmount
- planejar uma superfície global para chat

---

## Critério de Sucesso

O terminal deixa de ser “parte do esqueleto do layout” e vira um workspace independente, persistente e previsível.
