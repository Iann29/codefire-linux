# Settings Prompts Tab Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Adicionada aba "Prompts" ao SettingsModal com 5 prompts editáveis (Agent System, Context Mode, Summarization, Task Extraction, Task Description). Criado componente TextArea em SettingsField.tsx. Campos vazios usam prompt padrão. Botão reset por prompt. Indicador visual customized/default. Campos adicionados ao AppConfig e ConfigStore.
> **Objetivo:** adicionar uma aba `Prompts` em Settings para inspecionar, editar e salvar os principais system prompts e templates usados pelo Chat Mode e serviços relacionados.

---

## Problema

Hoje vários prompts relevantes estão hardcoded e espalhados:

- contexto base em `CodeFireChat.tsx`
- prompt do agente em `AgentService.ts`
- prompts de sumarização e extração em `SessionDetail.tsx`
- prompts de compaction em `ContextCompactor`
- prompts de features novas como content, review, audit etc.

Isso cria três problemas:

- pouca transparência
- pouca capacidade de ajuste fino
- muita tendência a drift e duplicação

---

## Estado Atual

`SettingsModal` hoje tem tabs fixas:

- General
- Terminal
- Engine
- Gmail
- Browser
- Briefing

Não existe nenhuma UI para prompts, e `AppConfig` não tem estrutura para overrides de prompt.

---

## Objetivo Funcional

Criar uma aba `Prompts` que permita:

- ver prompts ativos por domínio
- editar com segurança
- restaurar defaults
- salvar overrides
- saber onde cada prompt é usado

Domínios iniciais sugeridos:

- `Chat Context Mode`
- `Agent System Prompt`
- `Session Summary`
- `Session Task Extraction`
- `Context Compaction`

---

## Estratégia Recomendada

### 1. Criar registry de prompts

Em vez de continuar espalhando strings, criar um registro central:

- `promptId`
- `title`
- `defaultText`
- `description`
- `scope`
- `supportsVariables`

### 2. Separar default de override

Defaults ficam em código.
Overrides ficam no config do usuário.

Estrutura sugerida em `AppConfig`:

- `promptOverrides: Record<string, string>`

### 3. Resolver prompt sempre via helper

Nenhum fluxo deve ler string hardcoded direto após a migração.

Criar algo como:

- `getPrompt(promptId, config)`

---

## UI Proposta

Nova tab em `SettingsModal`:

- lista lateral de prompts
- editor principal
- descrição do uso
- placeholders suportados
- botões `Reset`, `Save`, `Copy Default`

Itens úteis:

- badge `default` ou `customized`
- diff leve entre default e override

---

## Arquivos Prováveis de Implementação

- `src/renderer/components/Settings/SettingsModal.tsx`
- novo `src/renderer/components/Settings/SettingsTabPrompts.tsx`
- `src/shared/models.ts`
- `src/main/services/ConfigStore.ts`
- novo `src/shared/prompts/*`
- `src/renderer/components/Chat/CodeFireChat.tsx`
- `src/main/services/AgentService.ts`
- `src/main/services/ContextCompactor.ts`
- `src/renderer/components/Sessions/SessionDetail.tsx`

---

## Plano de Execução

### Fase 1

- criar registry de prompts principais
- adicionar tab de settings
- salvar overrides no config

### Fase 2

- migrar consumidores principais para `getPrompt()`
- reset por prompt
- estado visual `default/custom`

### Fase 3

- validação de placeholders
- export/import de prompt pack

---

## Riscos

- editar prompt quebrar runtime sensível do agente
- placeholders inválidos criarem instruções incoerentes

### Mitigação

- primeira versão apenas para prompts selecionados
- preview e validação mínima
- botão `restore default` sempre visível

---

## Critério de Sucesso

Os prompts centrais do produto deixam de ser strings invisíveis e passam a ser uma camada configurável, auditável e controlada.
