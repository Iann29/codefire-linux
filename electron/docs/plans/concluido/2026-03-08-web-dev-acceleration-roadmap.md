# Web Development Acceleration Roadmap

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** transformar o CodeFire de um workspace com chat, browser e automações em um cockpit de desenvolvimento web orientado a preview, QA, deploy e feedback.

---

## Visão

Hoje o CodeFire já tem peças valiosas, mas ainda soltas:

- um browser embutido em `src/renderer/views/BrowserView.tsx`
- console, network básico e elements em `src/renderer/components/Browser/DevToolsPanel.tsx`
- criação de tasks com evidência em `src/renderer/components/Browser/CaptureIssueSheet.tsx`
- detecção de serviços e `.env` em `src/renderer/views/ServicesView.tsx` e `src/main/ipc/service-handlers.ts`
- sinais de GitHub em `src/renderer/components/Git/GitHubSection.tsx` e `src/main/services/GitHubService.ts`
- indexação de código via `ContextEngine`, `SearchEngine` e `CodeChunker`
- artefatos de imagem e gravação já persistidos em banco

O salto de produto não está em adicionar abas aleatórias. Está em construir workflows completos de desenvolvimento de sites:

1. descobrir rotas, previews e contexto do projeto
2. abrir o site dentro do próprio app
3. auditar layout, SEO, acessibilidade, env e deploy
4. comparar com baseline visual
5. transformar problemas em tasks com evidência
6. consolidar feedback de cliente, QA e IA no mesmo loop

---

## Diagnóstico da Base Atual

### O que já existe e deve ser reaproveitado

- `BrowserView.tsx` já cria e controla `webview`, captura screenshot e injeta comandos de automação.
- `DevToolsPanel.tsx` já agrega console, observação rudimentar de rede e árvore DOM.
- `CaptureIssueSheet.tsx` já fecha o ciclo de “achar problema -> criar task”.
- `service-handlers.ts` já detecta Vercel, Netlify, Firebase, Supabase, Docker, Prisma, Drizzle e arquivos `.env`.
- `GitHubService.ts` já resolve `owner/repo`, lista PRs, workflows, issues e commits.
- o banco já tem tabelas úteis como `browserScreenshots`, `recordings`, `generatedImages`, `indexedFiles` e `codeChunks`.
- `VisualizerView.tsx` está praticamente vazio, o que é ótimo: existe espaço real para virar uma central de inteligência do projeto.

### Gargalos atuais

- `BrowserView.tsx` concentra responsabilidades demais e já está virando ponto de acoplamento.
- a captura de network hoje é heurística, via `PerformanceObserver` despejado no console, o que é insuficiente para auditorias sérias.
- não existe camada dedicada para auditoria, comparação visual, crawling, forms ou análise de design system.
- a indexação de código é genérica; ainda não entende componentes, rotas ou variáveis de ambiente com semântica de framework.
- não existe visão orquestrada de branch -> PR -> preview -> checks -> lançamento.

---

## Princípios de Produto

### 1. Workflow acima de feature

Cada nova entrega precisa encaixar no loop:

`descobrir -> abrir -> analisar -> capturar evidência -> gerar ação`

### 2. Resultado acionável acima de “insight bonito”

Toda auditoria forte precisa produzir pelo menos um destes outputs:

- task pronta
- screenshot
- diff
- checklist
- link direto para arquivo, rota ou preview

### 3. Reuso do browser e da indexação

As novas capacidades devem se apoiar na infraestrutura existente, não competir com ela.

### 4. Persistência de artefatos

Tudo o que gera valor recorrente deve poder ser salvo:

- baseline visual
- resultado de crawl
- relatório de env
- checklist de launch
- gravação e review

### 5. Fases pequenas, sem tentar virar Lighthouse completo na V1

O risco principal é scope explosion. Cada plano abaixo está dividido para permitir releases incrementais.

---

## Portfólio de Iniciativas

### Track 1: QA e Browser Intelligence

- `Page Audit`
- `Responsive Lab`
- `Visual Regression Baselines`
- `Form Tester`

### Track 2: Descoberta e Inteligência do Projeto

- `Route Map + Crawl`
- `Design System Map`
- `Component Usage Graph`
- `Env Doctor`

### Track 3: Preview, Release e Operação

- `Preview Environments Hub`
- `Launch Guard`

### Track 4: Conteúdo e Feedback

- `Content Studio`
- `Client Review Mode`

### Track 5: Platform Enablers

- `Chat Attachments + File Mentions`
- `Browser Tab Persistence Investigation`

---

## Ordem Recomendada

### Onda 1: Entregar valor imediato para sites

1. `Page Audit` — IMPLEMENTADO
2. `Responsive Lab` — IMPLEMENTADO
3. `Route Map + Crawl` — IMPLEMENTADO
4. `Preview Environments Hub` — IMPLEMENTADO

Essas quatro features ja criam um loop poderoso para branch, preview, pagina e QA manual.

### Onda 2: Fechar confiabilidade visual e release

5. `Form Tester` — IMPLEMENTADO
6. `Visual Regression Baselines` — IMPLEMENTADO
7. `Env Doctor` — IMPLEMENTADO
8. `Launch Guard` — IMPLEMENTADO

Aqui o CodeFire deixa de ser so observador e passa a validar regressao e prontidao de deploy.

### Onda 3: Virar ferramenta de entendimento e producao

9. `Design System Map` — IMPLEMENTADO
10. `Component Usage Graph` — IMPLEMENTADO
11. `Content Studio` — IMPLEMENTADO
12. `Client Review Mode` — IMPLEMENTADO
13. `Chat Attachments + File Mentions`
14. `Browser Tab Persistence Investigation`

Essa onda aumenta alavancagem para design, manutencao, onboarding e revisao com cliente.

---

## Dependências Entre Planos

- `Launch Guard` depende de outputs de `Page Audit`, `Route Map + Crawl`, `Preview Environments Hub` e `Env Doctor`.
- `Visual Regression Baselines` depende de estabilizar viewport em `Responsive Lab`.
- `Form Tester` depende de melhorar a telemetria de rede do browser.
- `Component Usage Graph` depende de evolução da indexação e da extração semântica de componentes.
- `Content Studio` funciona desde cedo, mas fica mais forte se consumir achados de `Page Audit` e `Design System Map`.
- `Client Review Mode` ganha muito valor quando consegue anexar achados do browser e tasks automáticas.
- `Chat Attachments + File Mentions` amplia drasticamente a qualidade do contexto que chega ao Chat Mode e se conecta diretamente com Browser, Files e QA.
- `Browser Tab Persistence Investigation` é um enabler técnico importante para qualquer workflow sério de preview e auditoria contínua.

---

## Refactors Estruturais Recomendados

Antes ou junto das primeiras features, é recomendável preparar três fundações:

### 1. Browser Intelligence Layer

Extrair de `BrowserView.tsx` toda lógica de coleta, inspeção e automação para módulos dedicados, por exemplo:

- `src/renderer/browser/runtime/*`
- `src/renderer/browser/audits/*`
- `src/shared/browser/*`

### 2. Artifact Storage Layer

Padronizar como o app salva e consulta:

- screenshots
- baselines
- relatórios
- sessões de review
- resultados de crawl

### 3. Analyzer Layer para código

Criar uma camada de análise semântica por framework acima de `ContextEngine` e `CodeChunker`, em vez de sobrecarregar a busca genérica.

---

## Métricas de Sucesso

O roadmap deve ser avaliado por métricas de uso real, não por quantidade de abas novas.

- tempo para validar um preview novo
- quantidade de issues/tasks geradas com evidência suficiente
- tempo para detectar regressão visual ou de env
- cobertura de rotas auditadas por projeto
- número de feedbacks de cliente transformados em ações concretas
- redução de retrabalho manual em QA e deploy

---

## Resultado Esperado

Se os planos abaixo forem executados com disciplina, o CodeFire passa a ocupar um espaço raro:

- editor e chat para tocar o desenvolvimento
- browser de QA e automação real
- central de preview e release
- sistema de revisão com cliente
- motor de inteligência do próprio projeto

Em outras palavras: menos ferramenta espalhada, mais fluxo de producao web dentro do mesmo app.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Resumo:
- 12 de 14 iniciativas implementadas (Fase 1 de cada plano)
- Ondas 1, 2 e 3 concluidas (exceto Chat Attachments e Browser Tab Persistence)
- Todos os planos individuais marcados como IMPLEMENTADO
- Integracao verificada com TypeScript --noEmit
