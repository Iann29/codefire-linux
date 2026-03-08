# Responsive Lab Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** transformar o browser do CodeFire em um laboratório de breakpoints e dispositivos, com presets, captura comparativa e inspeção rápida de layout.

---

## Problema

Hoje o browser do CodeFire renderiza o `webview` em um viewport fixo de `1920x1080`, escalado para caber no painel.

Isso é ótimo para consistência visual, mas ruim para QA de sites:

- não dá para testar mobile de verdade
- não dá para alternar rapidamente entre breakpoints
- não existe captura lado a lado
- validar hero, menu, footer, modal e formulário em múltiplas larguras ainda é trabalho manual

Para quem desenvolve sites todos os dias, isso limita muito o valor do browser embutido.

---

## O que já existe na codebase

- `src/renderer/views/BrowserView.tsx`
  - viewport sintético já existe
  - escala do `webview` já é calculada dinamicamente
  - screenshot já existe
- `src/renderer/components/Browser/BrowserToolbar.tsx`
  - lugar natural para presets e controles
- `src/renderer/hooks/useBrowserTabs.ts`
  - base para guardar estado por aba

Conclusão: a base do Responsive Lab já está embutida no browser. Falta torná-la parametrizável.

---

## Visão da Feature

O `Responsive Lab` deve permitir:

1. alternar o viewport da aba atual entre presets
2. abrir um modo de comparação rápida entre múltiplos breakpoints
3. capturar screenshots padronizadas por dispositivo
4. anexar essas capturas a tasks ou relatórios

Presets sugeridos:

- `iPhone SE`
- `iPhone 15`
- `Android Medium`
- `iPad`
- `Laptop`
- `Desktop`
- `Desktop Wide`
- `Custom`

---

## UX Proposta

### Modo básico

No toolbar do browser:

- dropdown `Viewport`
- chips rápidos com presets principais
- indicador atual `390 x 844`
- toggle `Portrait / Landscape`

Ao trocar o preset:

- o site é re-renderizado no novo viewport
- a URL atual permanece
- o usuário pode navegar normalmente

### Modo compare

Botão `Compare`.

Ao clicar:

- abre um painel com 2 a 4 snapshots
- cada snapshot representa um preset
- usuário pode capturar a mesma rota em todos os tamanhos
- fica fácil detectar overflow, cortes, menu quebrado, CTA fora da dobra, footer vazando

### Modo capture

Botão `Capture Breakpoints`.

O sistema:

- roda a página nos presets selecionados
- espera estabilizar
- captura imagens
- salva ou oferece exportar

---

## Escopo Recomendado da V1

- presets estáticos
- troca de viewport na aba atual
- modo compare por captura, não por múltiplos webviews ao vivo
- screenshots por breakpoint
- associação das capturas ao projeto

---

## Escopo que deve ficar fora da V1

- 4 webviews ao vivo em sincronia
- emulação completa de device pixel ratio, touch e user-agent
- throttling de rede e CPU
- gravação simultânea multi-breakpoint

Esses itens são caros e instáveis. O primeiro valor vem de presets confiáveis e comparação simples.

---

## Arquitetura Recomendada

### Refator principal

Extrair as constantes de viewport do `BrowserView.tsx`.

Hoje existe:

- `VIEWPORT_W = 1920`
- `VIEWPORT_H = 1080`

Isso precisa virar estado por aba ou por sessão:

- `viewport.width`
- `viewport.height`
- `viewport.label`
- `viewport.orientation`

### Modelo sugerido

Cada aba do browser deve carregar:

- `url`
- `title`
- `isLoading`
- `viewportPresetId`
- `viewportWidth`
- `viewportHeight`

### Captura

Reaproveitar `capturePage()` do `webview`.

Fluxo recomendado:

1. ajustar viewport
2. aguardar `did-stop-loading`
3. aguardar settle adicional
4. capturar screenshot
5. salvar metadados

### Persistência

Duas opções:

1. ampliar `browserScreenshots` com colunas de viewport
2. criar tabela específica `responsiveCaptures`

Recomendação: criar tabela nova quando houver compare mode persistido, para não misturar screenshot solta com snapshot de laboratório.

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/BrowserToolbar.tsx`
- `src/renderer/hooks/useBrowserTabs.ts`
- `src/shared/models.ts`
- `src/main/database/migrations/index.ts`
- novos utilitários em `src/renderer/components/Browser/viewportPresets.ts`

---

## Fases de Entrega

### Fase 1

- presets
- troca de viewport
- persistência do preset por aba
- captura simples por breakpoint

### Fase 2

- compare mode com grid de capturas
- seleção de 2 a 4 breakpoints
- salvar conjunto de capturas

### Fase 3

- integração com `Visual Regression Baselines`
- integração com `Page Audit`
- templates de laboratório por tipo de site

---

## Riscos

### Quebra de estabilidade do browser

Risco: mexer no `webview` de forma apressada e introduzir bugs de navegação.

Mitigação: tratar viewport como metadado da aba e manter o mesmo ciclo de vida já existente.

### Falsa sensação de emulação real

Risco: vender “emulação de device” quando na prática é apenas viewport.

Mitigação: nomear corretamente a feature e guardar device emulation completa para uma fase posterior.

### Capturas inconsistentes

Risco: páginas com animação, carregamento tardio ou sticky headers produzirem comparações inúteis.

Mitigação: usar delays previsíveis, opcionalmente desativar animações e permitir recaptura.

---

## Critérios de Sucesso

- alternar rapidamente entre desktop, tablet e mobile
- visualizar a mesma rota em múltiplos breakpoints com baixa fricção
- gerar capturas consistentes e reaproveitáveis
- servir de base para comparação visual futura

---

## Resultado Esperado

O `Responsive Lab` deve transformar o browser embutido em uma ferramenta útil de QA de layout. Não precisa ser um device emulator perfeito; precisa acelerar o teste real de páginas responsivas dentro do fluxo diário do projeto.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/renderer/components/Browser/viewportPresets.ts` (novo)
- `src/renderer/hooks/useBrowserTabs.ts` (modificado)
- `src/renderer/components/Browser/BrowserToolbar.tsx` (modificado)
- `src/renderer/views/BrowserView.tsx` (modificado)

### Observacoes:
- Fase 1 implementada conforme planejado
- 7 device presets implementados (iPhone SE, iPhone 15, Android Medium, iPad, Laptop, Desktop, Desktop Wide)
- Dropdown de viewport no BrowserToolbar
- Toggle portrait/landscape
- Escala dinamica do viewport no BrowserView
- Integracao verificada com TypeScript --noEmit
