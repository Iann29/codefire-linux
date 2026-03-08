# Rename CodeFire to Pinyino Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros
> **O que foi feito:** Rename completo de user-facing text de CodeFire → Pinyino em: package.json (name, productName, appId, description), todos os layouts (window titles, brand text, logo alt), App.tsx, OnboardingWizard, Sidebar, Settings, Chat system prompts, ChatDrawer, AgentService, TrayManager, OpenRouterAdapter, OAuthEngine, ImageGenerationService, DeepLinkModal, TerminalPanel error msg. Landing pages (4 HTML). CLAUDE.md. Preservados: identifiers internos, CSS classes, protocol handlers, DB paths, nomes de componentes.
> **Objetivo:** renomear o produto de `CodeFire` para `Pinyino` em identidade visual, código, build, docs, recursos, package metadata, links e superfícies de usuário.

---

## Problema

Renomear o app não é só trocar texto visível.

Hoje `CodeFire` aparece em:

- UI renderer
- package metadata
- appId e protocolo
- docs e README
- landing pages
- scripts
- nomes de arquivos
- paths de config/DB
- possíveis nomes de recursos e assets

Se isso for feito de forma parcial, o produto fica incoerente e arriscado.

---

## Objetivo Funcional

Depois da migração:

- o usuário vê `Pinyino` em toda a UI
- o pacote/build usa identidade nova
- docs e repositório ficam coerentes
- paths e protocolos antigos são tratados conscientemente

---

## Escopo a Cobrir

### Produto e UI

- textos visíveis
- títulos de janela
- onboarding
- status messages
- landing

### Build e distribuição

- `electron/package.json`
- `productName`
- `appId`
- protocolo customizado
- nomes de artefatos

### Repositório e docs

- README
- CONTRIBUTING
- SECURITY
- CLAUDE.md
- links GitHub/site

### Paths locais

- config file
- database path
- userData dir
- assets com nome antigo

---

## Ponto Crítico: Compatibilidade

Não decidir isso cedo é pedir dor depois.

Perguntas obrigatórias:

1. vamos manter compatibilidade com caminhos antigos de config/DB?
2. o protocolo `codefire://` muda junto?
3. o nome do repositório muda ao mesmo tempo?
4. a marca antiga precisa de alias temporário?

### Recomendação

Fazer migração com compatibilidade temporária:

- ler paths antigos
- migrar para novos paths
- manter fallback por algumas versões

---

## Estratégia Recomendada

### Fase 1: Inventário completo

Usar busca ampla para mapear:

- `CodeFire`
- `codefire`
- `com.codefire`
- `codefire-app`

Classificar por:

- UI
- build
- docs
- protocol/path
- infra/landing

### Fase 2: Rename de produto

- textos e branding
- package metadata
- resources

### Fase 3: Migração de storage e protocolo

- config
- db
- deep links
- compatibilidade

### Fase 4: rename de repo/assets

- readme badges
- links
- screenshots e logos

---

## Arquivos Prováveis de Implementação

- `electron/package.json`
- `electron/src/main/services/ConfigStore.ts`
- `electron/src/main/index.ts`
- `electron/src/renderer/**/*`
- `electron/src/shared/theme.ts`
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CLAUDE.md`
- `landing/*`
- scripts e recursos com nome antigo

---

## Riscos

- quebrar leitura da config atual do usuário
- quebrar protocol handlers existentes
- deixar textos antigos espalhados pelo produto

### Mitigação

- inventário antes de editar
- migration path explícito
- checklist de surfaces públicas

---

## Critério de Sucesso

O rename precisa ficar total, coerente e sem quebrar a instalação/local state de quem já usa o app.
