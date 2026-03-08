# Page Audit Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** criar uma auditoria de página dentro do browser do CodeFire para detectar problemas práticos de SEO, acessibilidade, conteúdo, console e performance leve.

---

## Problema

Hoje o CodeFire já permite abrir uma página, ver console, observar parte da rede e tirar screenshot. Isso ajuda em inspeção manual, mas ainda obriga o usuário a “olhar tudo no olho”.

Para desenvolvimento de sites, isso é lento e inconsistente:

- título e meta description passam batidos
- imagem sem `alt` não vira ação
- heading mal estruturada não aparece com clareza
- console warning fica escondido no painel
- favicon, canonical, OG e `lang` acabam esquecidos
- nenhum desses achados vira relatório ou task estruturada

O app precisa de um “auditor pragmático”, voltado para problemas recorrentes de landing pages, páginas institucionais, blogs, e-commerces e formulários.

---

## O que já existe na codebase

- `src/renderer/views/BrowserView.tsx`
  - controla `webview`
  - já captura screenshot
  - já injeta JS para snapshot e DOM mapping
- `src/renderer/components/Browser/DevToolsPanel.tsx`
  - já coleta console
  - já observa recursos de rede com `PerformanceObserver`
  - já consegue puxar árvore DOM
- `src/renderer/components/Browser/CaptureIssueSheet.tsx`
  - já converte evidência do browser em task
- `src/main/database/migrations/index.ts`
  - já existe tabela `browserScreenshots`

Conclusão: a V1 não precisa reinventar o browser. Precisa empacotar sinais já disponíveis e complementar com uma camada de análise dedicada.

---

## Visão da Feature

O `Page Audit` será um botão ou painel dentro da aba Browser com três modos:

1. `Audit Current Page`
2. `Audit Current Page + Screenshot`
3. `Audit and Create Tasks`

O resultado deve ser um relatório claro, por categorias:

- `SEO`
- `Accessibility Lite`
- `Content Structure`
- `Runtime / Console`
- `Performance Lite`
- `Asset Integrity`

Cada finding deve ter:

- severidade: `blocker`, `warning`, `info`
- título curto
- explicação objetiva
- evidência
- seletor ou elemento relacionado quando aplicável
- ação sugerida
- botão para criar task

---

## Escopo Recomendado da V1

### SEO

- ausência de `<title>`
- título curto demais ou excessivamente longo
- ausência de meta description
- ausência de canonical
- ausência de `lang` em `<html>`
- ausência de `meta[property="og:title"]`
- ausência de `meta[property="og:description"]`
- ausência de `meta[property="og:image"]`
- ausência de favicon

### Accessibility Lite

- imagens sem `alt`
- botões sem texto, `aria-label` ou conteúdo inteligível
- links com texto genérico como “clique aqui”
- inputs sem `label`, `aria-label` ou `placeholder` minimamente útil
- heading pulando hierarquia de forma gritante

### Content Structure

- múltiplos `h1`
- ausência de `h1`
- headings fora de ordem
- blocos com texto grande dentro de elementos clicáveis
- links quebrados internamente detectáveis no DOM

### Runtime / Console

- `console.error`
- warnings importantes
- recursos que falharam no carregamento
- erros JS visíveis no browser

### Performance Lite

- quantidade total de recursos
- recursos mais lentos
- imagens muito grandes
- scripts e folhas muito pesadas em primeira carga

### Asset Integrity

- imagens quebradas
- scripts com erro de fetch
- folhas de estilo com falha

---

## Escopo que deve ficar fora da V1

- scoring estilo Lighthouse
- WCAG completo
- Core Web Vitals oficiais
- análise de contraste perfeita
- screenshot OCR
- crawling em múltiplas páginas
- auditoria de schema.org completa

A V1 deve ser extremamente confiável, não gigantesca.

---

## UX Proposta

### Entrada

No Browser, adicionar um botão `Audit`.

Ao clicar:

- abre um drawer lateral ou painel inferior
- mostra botão `Run Audit`
- permite escolher escopo
- exibe estado `Running`, `Completed`, `Failed`

### Saída

Painel com:

- resumo geral
- categorias com contadores
- findings expansíveis
- botão `Create Task`
- botão `Capture Screenshot`
- botão `Create All Warnings as Tasks`

### Fluxo ideal

1. usuário abre preview do site
2. clica em `Audit`
3. vê problemas priorizados
4. transforma achados em tasks
5. opcionalmente salva o relatório

Esse fluxo casa perfeitamente com a proposta do CodeFire.

---

## Arquitetura Recomendada

### Separação de responsabilidades

Não colocar a lógica toda dentro de `BrowserView.tsx`.

Criar:

- `src/shared/browser-audit/types.ts`
- `src/renderer/browser-audit/collectors/domCollector.ts`
- `src/renderer/browser-audit/collectors/runtimeCollector.ts`
- `src/renderer/browser-audit/rules/*`
- `src/renderer/browser-audit/runPageAudit.ts`

### Coleta

O `webview` já permite `executeJavaScript`. Isso pode ser usado para extrair:

- `document.title`
- meta tags
- headings
- imagens
- links
- forms
- atributos de acessibilidade
- recursos carregados via `performance.getEntriesByType('resource')`

Além disso, o estado de console já existe no renderer e pode ser incorporado ao relatório.

### Avaliação

Transformar sinais brutos em findings via regras puras:

- `checkTitle`
- `checkMetaDescription`
- `checkOgTags`
- `checkHeadingStructure`
- `checkImageAlts`
- `checkButtonLabels`
- `checkConsoleErrors`
- `checkBrokenAssets`

### Persistência

V1 pode funcionar sem persistência obrigatória.

V1.1 ou V2 pode adicionar:

- tabela `pageAudits`
- tabela `pageAuditFindings`

Campos recomendados:

- `projectId`
- `pageUrl`
- `pageTitle`
- `summaryJson`
- `createdAt`
- `findingJson`
- `severity`
- `category`

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/BrowserToolbar.tsx`
- `src/renderer/components/Browser/DevToolsPanel.tsx`
- `src/renderer/components/Browser/CaptureIssueSheet.tsx`
- novos módulos em `src/renderer/browser-audit/*`
- novos tipos em `src/shared/*`
- migração nova em `src/main/database/migrations/index.ts` se houver persistência

---

## Fases de Entrega

### Fase 1

- botão `Audit`
- coleta DOM básica
- análise SEO e acessibilidade leve
- console errors e warnings
- painel de findings
- criação manual de tasks

### Fase 2

- save report
- screenshots anexadas
- batch create tasks
- filtros por severidade e categoria

### Fase 3

- audit history por URL
- integração com `Launch Guard`
- comparação entre auditorias

---

## Riscos

### BrowserView inflado

Risco: adicionar mais um bloco gigante dentro de `BrowserView.tsx`.

Mitigação: criar camada separada de auditoria desde o primeiro commit.

### Network incompleto

Risco: achar que o `PerformanceObserver` atual é suficiente para tudo.

Mitigação: usar network apenas como sinal leve na V1 e planejar telemetria mais robusta depois.

### Falso positivo demais

Risco: auditoria gerar muito ruído e perder credibilidade.

Mitigação: começar só com regras simples e objetivas, com pouca heurística ambígua.

---

## Critérios de Sucesso

- rodar auditoria da página atual em poucos segundos
- detectar automaticamente problemas comuns de landing page e blog
- permitir criação de tasks com evidência sem sair do browser
- não travar o `webview`
- manter findings claros e confiáveis

---

## Resultado Esperado

O `Page Audit` deve virar o equivalente a uma checagem instantânea de sanidade do site. Não para substituir ferramentas especializadas pesadas, mas para resolver 80% do trabalho diário de QA web sem sair do CodeFire.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/renderer/browser-audit/types.ts` (novo)
- `src/renderer/browser-audit/runPageAudit.ts` (novo)
- `src/renderer/browser-audit/AuditPanel.tsx` (novo)
- `src/renderer/views/BrowserView.tsx` (modificado - integracao no footer)

### Observacoes:
- Fase 1 implementada conforme planejado
- Engine de auditoria browser-side que executa JS no webview
- Coleta de dados DOM e execucao de regras de analise
- Categorias: accessibility, SEO, performance, best practices
- Integracao verificada com TypeScript --noEmit
