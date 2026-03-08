# Launch Guard Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** criar um checklist operacional de lançamento que combine sinais de código, browser, ambiente, git e CI para dizer se um site está pronto para ir ao ar.

---

## Problema

Toda entrega de site passa pelo mesmo ritual manual:

- verificar env
- checar preview
- ver console
- testar rotas principais
- garantir favicon, metadata e robots
- olhar workflows
- validar branch e árvore git

Isso costuma ser repetitivo, disperso e suscetível a esquecimento.

O CodeFire tem quase todas as peças desse quebra-cabeça, mas ainda não as compõe em um “gate” pragmático de release.

---

## O que já existe na codebase

- `src/renderer/views/BrowserView.tsx`
  - página aberta para checagens runtime
- `src/renderer/components/Browser/DevToolsPanel.tsx`
  - console e network leve
- `src/renderer/components/Browser/CaptureIssueSheet.tsx`
  - criação de evidência
- `src/renderer/views/ServicesView.tsx`
  - serviços e env
- `src/renderer/components/Git/GitHubSection.tsx`
  - PRs, workflows, issues
- `src/main/services/GitService.ts`
  - branch local e estado do repo
- `src/main/services/GitHubService.ts`
  - workflows e PRs

### Ponto crítico

O browser atual ajuda, mas a telemetria de rede ainda não é robusta o bastante para ser o único fundamento de um gate de lançamento.

Portanto, o `Launch Guard` deve nascer como checklist pragmático, não como “gate infalível”.

---

## Visão da Feature

O `Launch Guard` deve ser um orquestrador de checks.

Categorias iniciais:

- `Git`
- `CI`
- `Env`
- `Routes`
- `Browser Runtime`
- `SEO & Metadata`
- `Assets`
- `Project-Specific Rules`

Exemplos:

- árvore git limpa
- branch correta
- workflows principais ok
- env obrigatório presente
- rota inicial acessível
- console sem erro crítico
- `title` e `meta description` presentes
- favicon e canonical presentes
- produção configurada

---

## UX Proposta

### Entrada

Botão `Launch Guard` em algum destes lugares:

- Browser
- Services
- view própria de release

Recomendação:

- V1 em `ServicesView` ou `BrowserView`
- V2 em painel próprio, se crescer

### Saída

Checklist com:

- status `pass`, `warn`, `fail`, `skipped`
- contadores gerais
- evidência por item
- remediação

### Ações

- abrir preview
- abrir arquivo
- abrir task
- rodar audit detalhado
- rerun checks

---

## Estratégia Recomendada

### Checklist configurável por projeto

Sem perfil por projeto, a feature tende a virar ruído genérico.

Criar a noção de `LaunchProfile`:

- domínio esperado
- serviços obrigatórios
- rotas obrigatórias
- checks obrigatórios
- ambiente alvo

### Modelo sugerido

- `LaunchCheck { id, category, status, title, evidence, filePath, url, remediation }`
- `LaunchProfile { projectId, targetEnvironment, expectedDomain, requiredChecks, requiredServices, requiredRoutes }`
- `LaunchReport { projectId, generatedAt, branch, previewUrl, checks, passCount, warnCount, failCount }`

### Composição de subsistemas

O `Launch Guard` deve consumir outros módulos, não reimplementar tudo:

- `Page Audit`
- `Env Doctor`
- `Route Map + Crawl`
- `Preview Environments Hub`
- `GitService`
- `GitHubService`

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/ServicesView.tsx`
- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/DevToolsPanel.tsx`
- `src/renderer/components/Git/GitHubSection.tsx`
- `src/main/services/GitService.ts`
- `src/main/services/GitHubService.ts`
- novos módulos em `src/main/services/launch-guard/*`
- `src/main/database/migrations/index.ts`

---

## Fases de Entrega

### Fase 1

- checklist manualmente disparado
- git, CI, env e browser runtime básico
- relatório simples

### Fase 2

- launch profiles
- integração com `Page Audit` e `Env Doctor`
- rotas obrigatórias

### Fase 3

- integração com previews
- comparação com produção
- relatórios históricos

---

## Riscos

### Virar checklist genérico e inútil

Mitigação: perfis por projeto e categorias configuráveis.

### Confiar demais na telemetria atual do browser

Mitigação: tratar checks runtime como sinal importante, mas não como verdade absoluta até a camada de rede ser fortalecida.

### Escopo orquestrador gigante

Mitigação: cada check deve ser módulo pequeno e independente.

---

## Critérios de Sucesso

- reduzir esquecimentos antes de deploy
- transformar validações dispersas em checklist executável
- gerar evidência clara para o que falhou
- servir tanto para sites simples quanto para projetos um pouco mais complexos

---

## Resultado Esperado

O `Launch Guard` deve ser o fechamento natural do fluxo do CodeFire: branch, preview, auditoria, env e release no mesmo lugar. Nao como burocracia, mas como mecanismo de confianca antes de publicar.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/launch-guard/LaunchGuardService.ts` (novo)
- `src/main/ipc/launch-guard-handlers.ts` (novo)
- `src/renderer/components/Services/LaunchGuardPanel.tsx` (novo)
- `src/renderer/views/ServicesView.tsx` (modificado - integracao)

### Observacoes:
- Fase 1 implementada conforme planejado
- Orquestrador de checklist consumindo git status, env doctor, routes discovery
- Categorias: git, env, routes, seo
- Integracao verificada com TypeScript --noEmit
