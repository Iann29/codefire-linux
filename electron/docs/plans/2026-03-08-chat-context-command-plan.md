# Chat `/context` Command Plan

> **Date:** 2026-03-08
> **Status:** Planning (nao implementar ainda)

---

## Goal

Fazer o chat mode entender `/context` como comando local, e nao como prompt para o modelo.

Ao rodar `/context`, o usuario deve ver algo como:

- contexto estimado ja usado;
- limite estimado da janela de contexto do modelo selecionado;
- quantas mensagens entraram no recorte atual;
- se houve compaction;
- provider e model ativos.

---

## Current Diagnosis

- O input de `CodeFireChat.tsx` trata Enter como envio bruto.
- Nao existe parser de slash commands.
- `CodeFireChat` ja possui alguns dados de runtime:
  - `chatMode`
  - `chatModel`
  - `compactionInfo`
  - `messageUsage`
- O projeto ja tem `TokenEstimator.ts`, mas ele so e usado no fluxo de compaction do agent.
- Nao existe hoje metadata centralizada de "context window size" por modelo.

Resultado:

- `/context` vira uma mensagem normal;
- o usuario nao ganha visibilidade do proprio estado do chat;
- o chat continua opaco em runs longos.

---

## Proposed Solution

### 1. Introduzir uma camada de slash commands

Criar um parser pequeno no renderer, antes do envio para a conversa.

Regras:

- se o texto comeca com `/`, tentar resolver comando local;
- se o comando existe, executar localmente e nao enviar ao modelo;
- se nao existe, mostrar erro curto no proprio chat, sem chamar provider.

### 2. Comecar com um comando so: `/context`

O comando `/context` deve abrir ou renderizar uma resposta local com:

- model selecionado;
- provider selecionado;
- quantidade de mensagens consideradas no contexto atual;
- tokens estimados do contexto atual;
- limite estimado da janela de contexto;
- percentual aproximado usado;
- estado de compaction, se houver.

### 3. Criar uma fonte de verdade para metadata de modelo

Hoje o app nao tem tabela clara de context window.

Implementacao recomendada:

- criar um registry simples de modelos suportados com `contextWindowTokens`;
- usar esse registry para os modelos conhecidos do seletor de chat;
- quando o modelo nao estiver mapeado, exibir "unknown" e manter apenas a estimativa de tokens usados.

### 4. Reusar `TokenEstimator`

Para nao inventar uma segunda heuristica:

- mover ou expor o estimador para um handler reutilizavel;
- calcular os tokens aproximados do contexto que seria enviado hoje;
- incluir system prompt, mensagens recentes e contexto RAG no calculo.

### 5. Escolher a UX da resposta

Recomendacao:

- renderizar como um card local no chat, estilo "system tool result";
- nao persistir no banco como mensagem de assistente;
- nao poluir o historico de conversa com metacomandos locais.

---

## Files Likely Affected

- `src/renderer/components/Chat/CodeFireChat.tsx`
- novo parser/hook, por exemplo:
  - `src/renderer/components/Chat/chat-commands.ts`
- `src/main/services/TokenEstimator.ts`
- possivelmente novo IPC:
  - `chat:getContextStats`
  - ou `agent:estimateContext`
- `src/renderer/lib/api.ts`
- `src/shared/types.ts`

---

## Product Recommendation

Implementar em duas etapas:

### V1

- `/context` sozinho;
- valores estimados;
- sem autocomplete.

### V2

- `/help`
- `/clear`
- `/model`
- autocomplete visual ao digitar `/`

---

## Risks

- metadata de context window pode ficar desatualizada;
- se a estimativa ignorar system prompt/RAG, o numero perde credibilidade;
- persistir slash command como mensagem normal vai confundir o historico.

Mitigacao:

- sempre rotular como "estimate";
- usar um registry local simples e auditavel;
- manter resposta do comando fora da conversa persistida.

---

## Validation

1. Digitar `/context` em context mode.
2. Confirmar que nada e enviado ao provider.
3. Verificar exibicao de model/provider/tokens/percentual.
4. Repetir em agent mode.
5. Testar com e sem `compactionInfo`.
