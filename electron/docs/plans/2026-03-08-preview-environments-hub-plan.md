# Preview Environments Hub Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** consolidar branch, PR, provider de deploy, preview URL, produção e checks em uma visão única para acelerar validação de sites e apps web.

---

## Problema

No fluxo real de desenvolvimento web, preview é o centro de validação. O problema é que as informações ficam espalhadas:

- branch local no git
- PR no GitHub
- workflow em CI
- preview URL no Vercel, Netlify ou comentário de PR
- produção em outro lugar

Hoje o CodeFire já mostra parte desse cenário, mas de forma fragmentada:

- `ServicesView` detecta provedores
- `GitHubSection` mostra PRs e workflows
- o Browser abre qualquer URL

Falta uma superfície única que responda:

- “qual preview dessa branch?”
- “esse PR já tem deploy?”
- “qual ambiente eu deveria abrir agora?”
- “como ir de branch para preview em um clique?”

---

## O que já existe na codebase

- `src/renderer/views/ServicesView.tsx`
  - já mostra serviços detectados
- `src/main/ipc/service-handlers.ts`
  - detecta Vercel, Netlify, Firebase, Supabase, AWS, Docker e outros sinais
- `src/main/services/GitHubService.ts`
  - já resolve repo
  - já lista PRs, issues, workflows e commits
- `src/renderer/components/Git/GitHubSection.tsx`
  - já exibe PRs e CI
- `src/main/services/GitService.ts`
  - base natural para branch local e estado do repositório
- `src/renderer/views/BrowserView.tsx`
  - já pode abrir o preview imediatamente

### Gap estrutural atual

Ainda não existe:

- integração com deployments do GitHub
- integração com APIs de Vercel ou Netlify
- resolução confiável de preview URL por branch/PR

Ou seja: a feature tem ótimo valor de produto, mas também é uma das que mais exigem backend novo.

---

## Visão da Feature

O `Preview Environments Hub` deve ser a central de ambientes do projeto.

Para cada ambiente detectado, mostrar:

- provider
- branch
- PR relacionado
- preview URL
- production URL
- status do deploy
- status dos checks
- data da última atualização

Além disso, permitir:

- abrir preview no Browser
- abrir produção
- comparar preview com produção
- copiar URL
- fixar ambiente principal do projeto

---

## UX Proposta

### Entrada principal

Existem dois lugares naturais:

1. nova seção dentro de `ServicesView`
2. nova view própria de `Environments`

Recomendação:

- V1 em `ServicesView`
- V2 como visão própria, se a complexidade crescer

### Estrutura visual

Lista de cards por ambiente:

- `Production`
- `Preview for current branch`
- `Previews linked to open PRs`
- `Recent previews`

Cada card deve ter:

- label do provider
- branch
- PR `#`
- badge de status
- URL
- botões `Open`, `Copy`, `Audit`, `Compare`

### Caso sem descoberta confiável

Se o sistema não conseguir resolver a preview URL, mostrar isso explicitamente:

- `Provider detected, preview URL not resolved yet`

e oferecer:

- `Paste preview URL manually`
- `Pin as production URL`

Isso evita prometer automação que ainda não existe.

---

## Estratégia Recomendada por Fases

### V1: Discovery pragmático

Sem depender de APIs novas ainda:

- detectar provider provável
- detectar branch local
- detectar PRs e workflows abertos
- permitir registrar manualmente preview URL e production URL
- associar branch/PR à URL salva

Essa V1 já entrega valor real.

### V1.5: Enriquecimento via GitHub

Ampliar `GitHubService` para buscar:

- check-runs
- commit statuses
- deployments
- comentários de PR ou metadata onde preview URLs apareçam

### V2: Integrações de provider

Criar camada dedicada para:

- Vercel
- Netlify
- Firebase Hosting

Essa é a etapa que transforma o hub em descoberta automática forte.

---

## Arquitetura Recomendada

### Camada de descoberta

Criar:

- `src/main/services/previews/PreviewDiscoveryService.ts`
- `src/main/services/previews/providerResolvers/*`
- `src/shared/previews/types.ts`

### Fontes de verdade

Prioridade sugerida:

1. configuração salva pelo usuário
2. provider API
3. GitHub deployment metadata
4. arquivos locais como `.vercel/project.json` e `.netlify/state.json`
5. heurísticas fracas

### Persistência recomendada

Criar:

- `previewProviderBindings`
- `previewEnvironments`
- `previewDiscoveryResults`

Campos úteis:

- `projectId`
- `provider`
- `branch`
- `prNumber`
- `previewUrl`
- `productionUrl`
- `status`
- `commitSha`
- `source`
- `updatedAt`

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/ServicesView.tsx`
- `src/renderer/components/Services/*`
- `src/renderer/components/Git/GitHubSection.tsx`
- `src/main/services/GitHubService.ts`
- `src/main/services/GitService.ts`
- `src/main/ipc/service-handlers.ts`
- novos módulos em `src/main/services/previews/*`
- `src/main/database/migrations/index.ts`

---

## Integrações Naturais

- abrir preview no `BrowserView`
- rodar `Page Audit` diretamente no ambiente
- executar `Launch Guard` no preview escolhido
- comparar preview e produção via `Visual Regression Baselines`

---

## Riscos

### Resolver preview errado

Mitigação: sempre exibir fonte e nível de confiança da descoberta.

### Arquivos locais não representarem verdade do deploy

Mitigação: tratar `.vercel/project.json` e `.netlify/state.json` como pistas, não verdade absoluta.

### Escopo backend alto

Mitigação: V1 manual e honesta, V2 automatizada com integrações reais.

---

## Critérios de Sucesso

- usuário encontra e abre o preview certo rapidamente
- existe visão clara de produção vs preview
- branch, PR e ambiente ficam conectados
- feature agrega valor mesmo antes das integrações completas de provider

---

## Resultado Esperado

O `Preview Environments Hub` deve virar a porta de entrada operacional do projeto: abrir o ambiente certo, no momento certo, com contexto suficiente para validar e decidir.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/PreviewDiscoveryService.ts` (novo)
- `src/main/ipc/preview-handlers.ts` (novo)
- `src/renderer/components/Services/PreviewEnvironmentsPanel.tsx` (novo)
- `src/renderer/views/ServicesView.tsx` (modificado - integracao)

### Observacoes:
- Fase 1 implementada conforme planejado
- Descoberta de preview environments a partir de config files, git branches e GitHub PRs
- Resolucao de provider provavel
- Integracao verificada com TypeScript --noEmit
