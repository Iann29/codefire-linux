# Agent Browser Plan Gating Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** `npm run build`; `npx vitest run src/__tests__/services/agent-browser-intent.test.ts`
> **O que foi feito:** O `AgentService` agora trata `set_plan` como artefato especifico de browser: o prompt base instrui a nao chamar plano em fluxos de codigo/git/notas, a heuristica de browser intent marca runs candidatos, `set_plan` retorna erro sem poluir a UI quando o run ainda nao exige browser, e o `planScope` passou a ser emitido junto dos eventos para a UI renderizar apenas planos de browser. O enforcement antes do primeiro browser action e a verificacao obrigatoria entre acoes foram mantidos.
> **Objetivo:** fazer `set_plan` virar uma exigencia especifica de fluxos de browser, nao um comportamento generico que o agente chama antes de qualquer trabalho.

---

## Problema

O agente esta chamando `set_plan` cedo demais, inclusive quando ainda nao entrou no browser.

Na pratica, isso polui a UX do chat:

- cria plano sem necessidade
- transmite falsa sensacao de que todo run precisa de browser checklist
- enfraquece o valor do `set_plan`, que deveria sinalizar uma execucao guiada de browser/testing

---

## Causa Raiz Encontrada

### 1. O system prompt generaliza demais

Em `src/main/services/AgentService.ts:1237-1239`:

- `Before using browser tools, call set_plan with 3-8 concrete steps.`
- `After each meaningful browser action, verify and then call update_plan.`

Embora o texto fale de browser tools, ele fica no prompt base do run inteiro e o modelo ve `set_plan` sempre disponivel.

### 2. A tool existe sempre

Em `src/main/services/AgentService.ts:84-126`, `set_plan` e sempre exposta em `AGENT_TOOLS`.

### 3. Nao ha gating semantico

No `executeToolCall`, o enforcement atual so impede browser tool sem plano:

- `AgentService.ts:1308-1312`

Mas nao impede o modelo de chamar `set_plan` antes da hora.

---

## Escopo do Plano

Restringir o uso de `set_plan` para cenarios realmente orientados a browser:

- navegacao
- validacao visual
- interacao de formulario
- diagnostico DOM
- reproducao de bug no browser

---

## Direcao Recomendada

### Regra de produto

`set_plan` deve ser:

- opcional para runs gerais
- recomendado quando o usuario pediu teste/navegacao
- obrigatorio somente antes da primeira browser action efetiva

---

## Implementacao Recomendada

### Fase 1. Reescrever o prompt do agent

Arquivo:

- `src/main/services/AgentService.ts`

Trocar a instrucao atual por algo mais preciso, por exemplo:

- "Do not call `set_plan` unless you are about to use browser tools."
- "For code reading, search, notes, tasks, or git work, skip `set_plan` unless the user explicitly asked for a plan."
- "Call `set_plan` immediately before the first browser action, not earlier."

### Fase 2. Adicionar hint dinamico por run

Criar uma heuristica simples baseada na mensagem do usuario:

- browser intent
- test intent
- visual regression
- screenshot
- form validation
- "abre o site", "testa", "navega", etc.

Se houver browser intent:

- anexar prompt complementar exigindo `set_plan` antes de browser actions

Se nao houver:

- omitir essa instrucao especifica

### Fase 3. Gating no backend para `set_plan`

Arquivo:

- `src/main/services/AgentService.ts`

Adicionar regra para evitar plano prematuro:

- manter flag no run, ex.: `browserPlanRequired` e `browserPlanActivated`
- `set_plan` so vira "esperado" quando:
  - o modelo sinaliza intencao de usar browser
  - ou tenta chamar uma browser tool

Opcao conservadora:

- deixar `set_plan` callable sempre
- mas, se o run ainda nao demonstrou browser intent, devolver warning sem popular a UI

Opcao recomendada:

- separar `set_plan` em `set_browser_plan`

Isso reduz ambiguidade de uma vez.

### Fase 4. Melhorar o contrato de runtime

Adicionar metadados no run:

- `browserIntentDetected`
- `browserActionCount`
- `planScope: 'browser' | 'general'`

A UI pode mostrar o plano so quando `planScope === 'browser'`.

---

## Opcao Estrutural Melhor

### Renomear a tool

Trocar:

- `set_plan`
- `update_plan`

por:

- `set_browser_plan`
- `update_browser_plan`

Vantagens:

- nome obriga semantica correta
- reduz chamadas espurias
- a UI fica autoexplicativa

Se houver necessidade futura de plano geral, criar outra tool depois:

- `set_task_plan`

---

## UX Esperada

### O que deve acontecer

- run de leitura de codigo: sem plano automatico
- run de git/tasks/notes: sem plano automatico
- run de browser: plano aparece apenas quando o agente vai realmente interagir com o browser

### O que nao deve acontecer

- abrir conversa, pedir analise de arquitetura, e o agente criar plano de browser
- chamar `set_plan` antes de qualquer `browser_*`

---

## Testes e Validacao

1. pedir "analise este arquivo" e verificar que nenhum plano aparece
2. pedir "compare duas implementacoes" e verificar que nenhum plano aparece
3. pedir "abra o browser e teste o login" e verificar:
   - plano criado
   - apenas antes da primeira browser tool
4. tentar executar browser tool sem plano e confirmar enforcement
5. verificar que `update_plan` continua funcionando apos validacoes no browser

---

## Criterio de Sucesso

O plano do agent deve deixar de ser ruido generico e voltar a ser um artefato especializado de browser workflows.
