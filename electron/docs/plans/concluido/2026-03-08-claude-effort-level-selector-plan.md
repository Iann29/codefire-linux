# Claude Effort Level Selector Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** `npm run build`
> **O que foi feito:** O app agora persiste `chatEffortLevel` na config, exibe seletor em `Settings > Engine`, mostra controle rapido no `ChatHeader` para Claude suportado e propaga `effortLevel` por `api.chat.*` e `api.agent.start`; o adapter Anthropic/Claude envia `output_config.effort` para `low`, `medium` e `high`; a aba `Context` passou a mostrar o effort efetivo salvo para a conversa/run. O controle rapido fica visivel apenas para modelos Claude com suporte habilitado na UI.
> **Objetivo:** adicionar selecao de effort para modelos Claude subscription no Chat Mode e em Settings, alinhada com a documentacao oficial.

---

## Referencia Oficial

Com base na documentacao oficial consultada em 2026-03-08:

- Claude Code documenta `low`, `medium` e `high`
- isso aparece via `/model`, `effortLevel` e `CLAUDE_CODE_EFFORT_LEVEL`
- a API geral da Anthropic tambem documenta `max`, mas como opcao de effort da API, nao como nivel basico do Claude Code

Para o uso de voces, que esta acoplado ao provider `claude-subscription`, a recomendacao e:

- V1: `low`, `medium`, `high`
- `max` fica para uma segunda fase opcional e apenas onde o modelo suportar

---

## Problema

Hoje o app permite escolher:

- provider
- model

mas nao permite escolher effort/thinking profile para Claude.

Isso cria um gap importante:

- o usuario nao controla custo/latencia/raciocinio
- o comportamento do modelo parece opaco
- o app fica abaixo do proprio Claude Code em controle operacional

---

## Causa Raiz Encontrada

### 1. O config ainda nao modela effort

Em `src/shared/models.ts:325-356`, `AppConfig` nao possui campo de effort.

### 2. A UI do chat so seleciona modelo

Em `src/renderer/components/Chat/ChatHeader.tsx`, existe seletor de modelo, mas nao de effort.

### 3. A camada de provider nao transporta effort

Em `src/main/services/providers/BaseProvider.ts`, `ChatCompletionRequest` nao possui campo de effort.

### 4. O adapter Claude nao injeta nenhum parametro Anthropic de thinking/effort

Em `src/main/services/providers/ClaudeSubscriptionAdapter.ts`:

- `openaiToAnthropic(request)` monta o payload
- mas nao existe campo de effort no request interno

---

## Escopo do Plano

Adicionar support end-to-end para effort nos modelos Claude subscription:

- config
- settings
- header do chat
- request interno
- adapter Claude
- UI de contexto/diagnostico

---

## Direcao Recomendada

### V1

Implementar:

- `low`
- `medium`
- `high`

Somente para:

- `claude-subscription`

### V2 opcional

Avaliar `max`:

- apenas se a stack usada por voces realmente aceitar isso nesse fluxo de subscription
- apenas para modelos suportados

---

## Implementacao Recomendada

### Fase 1. Modelagem de config

Arquivos:

- `src/shared/models.ts`
- `src/main/services/ConfigStore.ts`

Adicionar:

- `chatEffortLevel?: 'low' | 'medium' | 'high' | 'default'`

Recomendacao:

- usar `default` como fallback persistido

### Fase 2. UI em Settings

Arquivo:

- `src/renderer/components/Settings/SettingsTabEngine.tsx`

Adicionar um bloco:

- `Claude Effort`
- descricao curta explicando tradeoff:
  - low = mais rapido/barato
  - medium = equilibrio
  - high = mais raciocinio/custo/latencia

Exibir apenas quando o provider ativo for:

- `claude-subscription`

### Fase 3. UI rapida no Chat Header

Arquivo:

- `src/renderer/components/Chat/ChatHeader.tsx`

Adicionar um chip/dropdown compacto ao lado do modelo:

- `L`
- `M`
- `H`

ou label textual curta:

- `Low`
- `Medium`
- `High`

Esse seletor deve:

- aparecer apenas em modelos Claude subscription
- persistir em `api.settings.set({ chatEffortLevel: ... })`

### Fase 4. Propagar effort para o request

Arquivos:

- `src/main/services/providers/BaseProvider.ts`
- `src/main/services/AgentService.ts`
- `src/renderer/components/Chat/CodeFireChat.tsx`

Adicionar em `ChatCompletionRequest`:

- `effortLevel?: 'low' | 'medium' | 'high'`

`CodeFireChat` e `AgentService` devem passar esse valor ao router/provider.

### Fase 5. Mapear para payload Anthropic

Arquivos:

- `src/main/services/providers/format-translators.ts`
- `src/main/services/providers/ClaudeSubscriptionAdapter.ts`

O translator `openaiToAnthropic(...)` precisa aceitar e mapear effort para o campo correto do payload Anthropic usado por voces.

Importante:

- validar na documentacao e no comportamento real do endpoint `/v1/messages`
- nao assumir suporte sem teste real do provider/token flow de subscription

### Fase 6. Expor effort na UI de contexto

Arquivo:

- `src/renderer/components/Chat/ChatContextTab.tsx`

Mostrar:

- provider
- model
- effort atual

Assim o usuario ve claramente o perfil de raciocinio em uso.

---

## UX Recomendada

### Settings

Campo persistente:

- `Claude effort`

### Header do chat

Controle rapido por thread/sessao:

- chip pequeno
- valor atual visivel

### Context tab

Diagnostico:

- `Effort: high`

---

## Compatibilidade e Regras

### Quando mostrar

- mostrar apenas para provider/modelo Claude subscription

### Quando esconder

- OpenRouter generico
- OpenAI subscription
- Gemini subscription
- modelos sem nocao equivalente de effort

### Fallback

Se effort nao for suportado pelo provider/modelo:

- nao enviar o campo
- mostrar UI desabilitada ou oculta

---

## Testes e Validacao

1. selecionar `low`, enviar prompt e confirmar request com effort correto
2. repetir para `medium` e `high`
3. trocar provider para outro nao-Claude e confirmar que o seletor some
4. reiniciar o app e confirmar persistencia do setting
5. validar manualmente latencia/qualidade percebida entre niveis

---

## Criterio de Sucesso

O usuario precisa conseguir controlar effort dos modelos Claude de forma explicita, persistente e coerente com a documentacao oficial, sem introduzir UI enganosa para providers que nao suportam o mesmo contrato.
