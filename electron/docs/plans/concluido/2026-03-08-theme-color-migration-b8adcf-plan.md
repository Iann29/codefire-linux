# Theme Color Migration to #b8adcf Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Implementado em:** 2026-03-08
> **Verificado:** TypeScript compila sem erros, testes passam
> **O que foi feito:** Tokens centrais atualizados em theme.ts e globals.css (#f97316→#b8adcf, #ea580c→#9d8fb1). Referências hardcoded em TerminalPanel.tsx e TerminalTab.tsx corrigidas. Smoke test atualizado. 4 landing pages migradas (config Tailwind + gradientes). Os 59 arquivos com classes codefire-orange herdam automaticamente via CSS variable. Classes orange-* Tailwind (semânticas/warning) mantidas como estão.
> **Objetivo:** substituir o laranja do produto pela nova cor-base `#b8adcf`, com sistema coerente de tokens, estados hover/active e revisão visual completa.

---

## Problema

Hoje a cor laranja está espalhada em várias camadas:

- `COLORS.orange` em `src/shared/theme.ts`
- tokens Tailwind em `src/renderer/styles/globals.css`
- utilitários `text-codefire-orange`, `bg-codefire-orange`, `border-codefire-orange`
- usos diretos de `orange-500`, `orange-400`, `#f97316`, `#ea580c`
- gradientes e assets de marketing

Trocar apenas a cor principal sem revisar os usos derivados gera UI quebrada ou inconsistente.

---

## Objetivo Funcional

Depois da migração:

- a identidade cromática do produto deixa de ser laranja
- `#b8adcf` vira token principal do accent
- hover, active, borders e feedback states ficam coerentes
- não sobram laranjas “fantasma” em componentes ou marketing

---

## Estratégia Recomendada

### 1. Trocar token, não sair apagando classe no braço

Mapear os tokens centrais:

- `--color-codefire-orange`
- `--color-codefire-orange-hover`
- `COLORS.orange`
- `COLORS.orangeHover`

Definir novos valores:

- accent base: `#b8adcf`
- accent hover: derivado consistente

### 2. Separar accent de warning

Hoje parte do laranja também comunica warning.

Na migração:

- accent do produto muda para `#b8adcf`
- warning continua em paleta semântica própria

Isso evita confundir cor de marca com estado de alerta.

### 3. Fazer inventário completo

Buscar por:

- `codefire-orange`
- `orange-`
- `#f97316`
- `#ea580c`

Classificar:

- tokens globais
- componentes app
- marketing/landing
- testes snapshot/smoke

---

## Arquitetura Recomendada

### Tokens centrais

Atualizar:

- `src/shared/theme.ts`
- `src/renderer/styles/globals.css`

### Refator semântica

Onde a cor laranja estava sendo usada como `warning`, migrar para tokens corretos de warning.

Onde estava sendo usada como `brand accent`, migrar para `#b8adcf`.

### QA visual

Usar:

- screenshots comparativas
- revisão manual dos fluxos principais
- eventual baseline visual

---

## Arquivos Prováveis de Implementação

- `src/shared/theme.ts`
- `src/renderer/styles/globals.css`
- `src/renderer/**/*`
- `landing/*`
- `README` e assets se houver imagens com glow/branding antigo
- `src/__tests__/smoke.test.ts`

---

## Plano de Execução

### Fase 1

- atualizar tokens globais
- substituir usos diretos mais óbvios

### Fase 2

- revisar componentes com semântica incorreta
- separar accent x warning

### Fase 3

- revisar landing/marketing/assets
- ajustar screenshots e docs

---

## Testes Necessários

- tabs ativas
- botões primários
- focos de input
- badges e status bars
- chat, browser, terminal, settings
- landing page e onboarding

---

## Riscos

- componentes ficarem com contraste ruim
- warning e brand accent virarem a mesma linguagem visual
- classes `orange-*` sobreviverem em pontos isolados

### Mitigação

- revisão por semântica, não só por string replace
- checklist visual das telas principais

---

## Critério de Sucesso

A nova paleta precisa parecer intencional, consistente e completa, sem resíduos visuais do laranja antigo.
