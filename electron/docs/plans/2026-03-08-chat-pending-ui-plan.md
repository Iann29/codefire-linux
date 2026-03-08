# Chat Pending UI Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO ✓
>
> **Implementado em:** 2026-03-08
> - Criado `AgentRunStatus.tsx` com fases derivadas (thinking/streaming/running_tool/awaiting/error)
> - Timer de tempo decorrido, dots animados, ícones por fase
> - Integrado no `CodeFireChat.tsx` substituindo spinner genérico
> - Verificado: `tsc --noEmit` passa limpo

---

## Goal

Melhorar a UI do chat enquanto agentes estao pensando, usando tools ou esperando confirmacao.

Problema atual reportado:

- o botao so vira um quadrado vermelho;
- o feedback visual e pobre para runs longos;
- falta "vida" na interface.

---

## Current Diagnosis

`CodeFireChat.tsx` ja recebe bastante estado:

- `sending`
- `streaming`
- `toolExecutions`
- `planSteps`
- `confirmAction`
- `showContinue`
- `compactionInfo`

Mas a UI atual traduz isso de forma minima:

- spinner simples "Agent thinking..."
- lista textual de tools
- botao de cancel vermelho

O estado existe; o problema principal e de apresentacao e composicao.

---

## Proposed Solution

### 1. Extrair um componente de runtime status

Criar um componente dedicado, algo como:

- `AgentRunStatusCard`

Responsabilidades:

- mostrar fase atual do run;
- mostrar tempo decorrido;
- mostrar tool ativa;
- mostrar se esta esperando confirmacao;
- animar o estado sem poluir a mensagem final.

### 2. Trocar booleans por uma fase de runtime mais clara

Em vez de depender de combinacao informal de booleans, derivar algo como:

- `idle`
- `thinking`
- `streaming`
- `running_tools`
- `awaiting_confirmation`
- `completed`
- `cancelled`
- `errored`

Isso simplifica a renderizacao e reduz glitches de UI.

### 3. Melhorar a animacao

Sugestao visual:

- orb/pulse sutil no header do chat;
- dots animados quando pensando;
- chip da tool ativa com spinner;
- transicoes suaves entre thinking -> tool -> streaming;
- botao Stop com estado visual mais rico que apenas quadrado vermelho.

### 4. Mostrar progresso util, nao enfeite vazio

Boas informacoes para exibir:

- elapsed time;
- nome da tool atual;
- quantidade de tools ja concluidas;
- se ha confirmacao pendente;
- status do plano (`PlanRail`) de forma integrada.

### 5. Respeitar acessibilidade

- animacoes suaves;
- `prefers-reduced-motion`;
- nada de efeito chamativo demais no dark theme do app.

---

## Files Likely Affected

- `src/renderer/components/Chat/CodeFireChat.tsx`
- novo componente em `src/renderer/components/Chat/`
- `src/renderer/styles/globals.css`
- possivelmente `PlanRail.tsx`

---

## Implementation Steps

1. Extrair um pequeno view-model de runtime no chat.
2. Criar componente visual dedicado para pending state.
3. Adicionar animacoes CSS utilitarias no global.
4. Integrar `toolExecutions`, `confirmAction`, `streaming` e `planSteps`.
5. Refinar o botao Stop/cancel.
6. Revisar comportamento em erro e cancelamento.

---

## Recommended UI States

- Thinking:
  - dots animados + label curta
- Tool running:
  - chip com nome da tool + contador
- Awaiting confirmation:
  - destaque amarelo mais claro e action row visivel
- Streaming:
  - feedback de resposta em progresso sem redundancia visual
- Complete:
  - card some de forma discreta ou colapsa

---

## Risks

- animacao demais pode virar ruido;
- manter toda a logica no `CodeFireChat.tsx` vai piorar a manutencao;
- se o estado derivado ficar errado, a UI pode mostrar fase incoerente.

Mitigacao:

- extrair componente e view-model;
- tratar a melhoria como refactor de apresentacao com testes simples de renderizacao.

---

## Validation

1. Rodar uma conversa em context mode.
2. Rodar uma conversa em agent mode com varias tools.
3. Testar um run com confirmacao pendente.
4. Testar cancelamento.
5. Testar erro de provider.
6. Confirmar que a UI fica mais informativa sem aumentar ruído visual.
