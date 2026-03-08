# Claude Session Connection Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Criado ClaudeSessionConnectionService.ts com métodos findActiveSession(), getClaudeProjectDir(), listRecentSessions(), buildResumeCommand(). Adicionados handlers IPC sessions:findActive e sessions:listRecent. api.ts estendido com findActive() e listRecent(). SessionDetail.tsx mostra indicador verde "Active" quando sessão é a ativa. SessionsView.tsx mostra banner "Active Session" com polling a cada 10s.
> **Objetivo:** investigar e implementar uma conexão operacional com sessões Claude existentes, indo além da observação passiva de JSONL e do simples comando `claude --resume`.

---

## Estado Atual

Hoje o app já conhece sessões Claude de três formas:

- metadados persistidos via `sessions` e `SessionDAO`
- leitura do diretório `~/.claude/projects/<claudeProject>` em `sessions:getLiveState`
- observação passiva da sessão ativa via `LiveSessionWatcher`

Além disso, `SessionDetail` já oferece “Resume”, mas ele apenas escreve `claude --resume <id>` no terminal ativo.

Ou seja:

- há visibilidade
- há retomada indireta
- não há conexão rica com a sessão em execução

---

## Problema

Hoje o produto não consegue responder com firmeza:

- qual sessão Claude está realmente ativa para este projeto?
- consigo anexar ou abrir uma sessão específica dentro do app?
- consigo retomar uma sessão sem depender do terminal “ativo” e do foco correto?
- consigo ligar chat mode, tasks, files e browser à mesma sessão?

---

## Objetivo do Plano

Investigar e definir uma arquitetura para:

- detectar sessões por projeto com confiança melhor
- conectar uma sessão específica ao app
- retomar ou anexar a sessão pelo fluxo correto
- exibir status e ações sem depender de heurística frágil

---

## Linhas de Investigação

### 1. Modelo de descoberta atual

Arquivos relevantes:

- `src/main/services/LiveSessionWatcher.ts`
- `src/main/ipc/session-handlers.ts`
- `src/main/database/dao/SessionDAO.ts`
- `src/renderer/views/SessionsView.tsx`
- `src/renderer/components/Sessions/SessionDetail.tsx`

Pontos a validar:

- a pasta `project.claudeProject` é sempre confiável?
- a sessão mais recente no diretório corresponde à sessão “ativa”?
- a heurística “mtime dos últimos 5 minutos” é robusta?

### 2. Fluxo de resume

Hoje `SessionDetail` envia `claude --resume <id>` para o terminal ativo.

Investigar:

- qual CLI de fato suporta `--resume`
- se existe comando para anexar em modo não interativo
- se existe output estruturado para confirmar que a sessão conectou

### 3. Possível camada de integração mais forte

Investigar se Claude Code expõe:

- protocolo local
- arquivos de lock/metadata de sessão
- estado estruturado além do JSONL
- possibilidade de retomar sessão em PTY dedicada controlada pelo app

### 4. Convergência com o terminal

Se o app passar a ter uma view própria de terminal, faz sentido que uma sessão Claude possa ser:

- aberta em uma tab de terminal dedicada
- identificada como “attached session”
- ligada ao projeto atual

---

## Estratégia Recomendada

### Fase 1: Discovery audit

- mapear o contrato real dos arquivos em `~/.claude/projects`
- validar o comportamento do `claude --resume`
- testar cenários com múltiplas sessões e múltiplos projetos

### Fase 2: Session binding

Criar uma camada explícita:

- `ClaudeSessionConnectionService`

Responsabilidades:

- localizar sessão candidata
- validar se está ativa
- abrir ou retomar em PTY controlada
- emitir estado para o renderer

### Fase 3: UI operacional

- mostrar conexão da sessão no `SessionsView`
- botão `Attach`, `Resume`, `Open in Terminal`
- vínculo com tasks/notes/chat quando fizer sentido

---

## Arquivos Prováveis de Implementação

- `src/main/services/LiveSessionWatcher.ts`
- `src/main/ipc/session-handlers.ts`
- `src/main/database/dao/SessionDAO.ts`
- novo `src/main/services/ClaudeSessionConnectionService.ts`
- `src/renderer/views/SessionsView.tsx`
- `src/renderer/components/Sessions/SessionDetail.tsx`
- terminal view futura

---

## Riscos

- depender de comportamento interno do Claude Code não documentado
- heurísticas de diretório serem insuficientes em projetos com várias sessões recentes
- “resume” mandar output interativo difícil de observar

### Mitigação

- tratar a primeira fase como investigação séria, com matriz de cenários reais
- não prometer “live attach” antes de validar o contrato externo

---

## Critério de Sucesso

O app deve sair do estado de “sei que existem sessões” para “sei qual sessão está ligada a este projeto e consigo retomá-la com fluxo confiável”.
