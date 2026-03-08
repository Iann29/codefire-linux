# Form Tester Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** permitir validar formulários reais dentro do browser do CodeFire com cenários explícitos, preenchimento controlado, observação de request e geração de evidência.

---

## Problema

Formulários são uma das áreas mais críticas de qualquer site:

- login
- contato
- newsletter
- checkout
- cadastro
- recuperação de senha

Hoje o CodeFire já tem automação robusta de clique e digitação, mas ainda falta um modelo de teste de formulário. Sem isso:

- cada validação precisa ser refeita manualmente
- os mesmos bugs reaparecem
- não existe cenário salvo
- requests de submit não são observadas com precisão suficiente

---

## O que já existe na codebase

- `src/renderer/views/BrowserView.tsx`
  - já possui `browser_dom_map`
  - já possui estratégias de clique e digitação bem agressivas
  - já captura screenshot
- `src/renderer/components/Browser/DevToolsPanel.tsx`
  - já coleta console
  - já exibe network leve
- `src/renderer/components/Browser/CaptureIssueSheet.tsx`
  - já fecha o loop de evidência -> task
- `src/main/services/AgentService.ts`
  - já expõe ferramentas de browser para agentes

Conclusão: a automação do “dedo” já existe. O que falta é a automação do “cenário”.

---

## Princípio-chave

Não tentar “testar todo formulário automaticamente” na V1.

Isso geraria:

- ruído
- flaky tests
- submits errados
- problemas com CAPTCHA, widgets e flows complexos

A solução correta é um `scenario runner` explícito.

---

## Visão da Feature

O `Form Tester` deve permitir criar cenários com:

- página alvo
- formulário alvo
- campos e valores
- estratégia de submit
- expectativa de sucesso ou erro
- sinais observáveis

Exemplos:

- `Submit empty contact form`
- `Submit invalid email on newsletter`
- `Login with demo account`
- `Checkout should block invalid ZIP`

---

## UX Proposta

### Criar cenário

No Browser, clicar `Test Form`.

O sistema ajuda o usuário a:

- selecionar o formulário
- mapear campos
- escolher dados de teste
- definir o que é sucesso

### Executar cenário

Durante a execução, mostrar:

- passo atual
- campo preenchido
- botão clicado
- request observada
- resposta visual
- erros capturados

### Resultado

Ao final:

- `Passed`
- `Failed`
- `Needs review`

Com evidências:

- screenshot
- console
- request relevante
- mensagem de erro ou sucesso visível

---

## Escopo Recomendado da V1

- seleção manual do formulário
- mapeamento explícito de campos
- biblioteca básica de dados fake
- submit controlado
- verificação de mensagem de sucesso ou erro
- screenshot final
- criação de task quando falhar

---

## Arquitetura Recomendada

### Runner de cenários

Criar:

- `src/shared/form-tester/types.ts`
- `src/renderer/form-tester/scenarioRunner.ts`
- `src/renderer/form-tester/dataGenerators.ts`
- `src/renderer/form-tester/assertions.ts`

### Telemetria de rede

O `PerformanceObserver` atual não basta para assertions confiáveis.

Melhor caminho:

- V1: instrumentar `fetch` e `XMLHttpRequest` dentro do `webview` para capturar chamadas de submit
- V2: avaliar hooks de rede em nível mais baixo para maior precisão

### Modelo de cenário

Exemplo lógico:

- `id`
- `projectId`
- `name`
- `pageUrl`
- `formSelector`
- `stepsJson`
- `assertionsJson`
- `createdAt`

### Modelo de execução

- `scenarioId`
- `startedAt`
- `endedAt`
- `status`
- `logJson`
- `screenshotPath`
- `networkJson`

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/*`
- novos módulos em `src/renderer/form-tester/*`
- novos tipos em `src/shared/*`
- novos IPC handlers se houver persistência
- `src/main/database/migrations/index.ts`

---

## Fases de Entrega

### Fase 1

- cenário manual salvo
- preenchimento explícito
- submit
- screenshot
- console + mensagem visual

### Fase 2

- captura de request relevante
- biblioteca melhor de assertions
- reexecução rápida de cenários

### Fase 3

- integração com `Route Map + Crawl`
- suites por projeto
- execução em lote

---

## Riscos

### Widgets ricos e editores especiais

Mitigação: apoiar-se nas estratégias já robustas do browser e admitir cenários que exijam ajuste manual.

### Submit real disparar efeitos indesejados

Mitigação: recomendar ambientes de preview/staging e permitir modo “dry run” quando possível.

### Falsa confiança na rede

Mitigação: separar claramente “request observada” de “request inferida”.

---

## Critérios de Sucesso

- salvar cenários úteis sem excesso de configuração
- executar teste de formulário de forma repetível
- capturar falhas com evidência suficiente
- ser útil para contato, newsletter, login e fluxos simples logo na V1

---

## Resultado Esperado

O `Form Tester` deve transformar um ponto clássico de dor em um fluxo repetível. Em vez de “testa aí rapidinho”, o projeto passa a ter cenários salvos, evidencia e historico minimo para os formularios mais importantes.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/renderer/form-tester/types.ts` (novo)
- `src/renderer/form-tester/FormTesterPanel.tsx` (novo)
- `src/renderer/views/BrowserView.tsx` (modificado - integracao no footer)

### Observacoes:
- Fase 1 implementada conforme planejado
- Deteccao de formularios via webview JS
- Auto-fill com dados fake
- Criacao e execucao de cenarios
- Resultados de teste com output de console
- Integracao verificada com TypeScript --noEmit
