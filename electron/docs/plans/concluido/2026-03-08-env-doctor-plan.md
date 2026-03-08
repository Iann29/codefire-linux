# Env Doctor Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** detectar drift, ausência, sobra, uso incorreto e risco de exposição de variáveis de ambiente no projeto, sem vazar segredos na indexação ou no storage.

---

## Problema

Boa parte dos bugs de preview, build e produção nasce em variáveis de ambiente:

- chave faltando
- chave com nome errado
- variável declarada mas nunca usada
- variável usada mas não declarada
- segredo exposto em client bundle
- `.env.example` desatualizado
- precedência errada entre `.env`, `.env.local`, `.env.production`

Hoje o CodeFire já detecta e lê arquivos `.env`, mas ainda não faz diagnóstico. Falta uma visão que diga:

- o que existe
- o que falta
- o que está sobrando
- o que está perigoso

---

## O que já existe na codebase

- `src/renderer/views/ServicesView.tsx`
  - já mostra arquivos de ambiente
- `src/renderer/components/Services/EnvFilePanel.tsx`
  - já visualiza variáveis
- `src/main/ipc/service-handlers.ts`
  - já detecta `.env`, `.env.*`, `.env.example`, `.env.template`, `.env.sample`
  - já parseia variáveis e comentários
- `src/main/services/ContextEngine.ts`
  - base para escanear código
- `src/main/services/SearchEngine.ts`
  - útil para encontrar usos no source

### Ponto importante

Os dados já passam pelo renderer e isso é aceitável para visualização manual. Mas o `Env Doctor` não pode sair persistindo valores brutos em banco nem indexando segredos em estruturas pesquisáveis.

---

## Visão da Feature

O `Env Doctor` deve gerar um relatório com categorias como:

- `Missing`
- `Unused`
- `Undocumented`
- `Mismatch`
- `Suspicious Client Exposure`
- `Precedence Risk`
- `Nested App Drift`

Exemplos práticos:

- `NEXT_PUBLIC_API_URL` usada no código, mas ausente em `.env.example`
- `SUPABASE_SERVICE_ROLE_KEY` encontrada em código cliente
- `VITE_APP_URL` presente em `.env.production`, mas ausente em `.env.local`
- `OPENAI_API_KEY` declarada mas nunca referenciada

---

## UX Proposta

Dentro de `ServicesView`, adicionar uma seção `Env Doctor`.

Ao rodar:

- resumo geral
- score de saúde
- lista de issues
- agrupamento por severidade
- agrupamento por variável

Cada finding deve mostrar:

- chave
- tipo do problema
- arquivos envolvidos
- contexto mínimo
- remediação sugerida

### Ações

- abrir arquivo `.env`
- abrir arquivo de uso
- copiar chave
- criar task

---

## Estratégia Técnica Recomendada

### Fase de leitura

Reaproveitar o que `service-handlers.ts` já faz para:

- enumerar arquivos
- parsear chaves
- entender templates

### Fase de uso

Adicionar extração de referências no código para:

- `process.env.*`
- `import.meta.env.*`
- `env.*`
- convenções de framework como `NEXT_PUBLIC_`, `VITE_`, `NUXT_PUBLIC_`

### Fase de diagnóstico

Gerar entidades lógicas como:

- `EnvVariableDefinition { key, filePath, environment, hasValue, maskedValue, comment, defaultValue }`
- `EnvVariableUsage { key, filePath, line, syntax, runtimeScope }`
- `EnvDoctorIssue { severity, code, key, title, evidence, remediation }`
- `EnvDoctorReport { projectId, generatedAt, servicesDetected, issues, score }`

### Recomendação importante

Fazer a análise como leitura sob demanda no início, não como indexação contínua de segredos.

Se depois virar pesado demais, criar camada persistida com dados mascarados.

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/ServicesView.tsx`
- `src/renderer/components/Services/EnvFilePanel.tsx`
- `src/renderer/components/Services/*`
- `src/main/ipc/service-handlers.ts`
- `src/main/services/SearchEngine.ts`
- `src/main/services/ContextEngine.ts`
- novos módulos em `src/main/services/env-doctor/*`
- `src/main/database/migrations/index.ts` se houver persistência

---

## Regras de Diagnóstico Recomendadas

### Missing

- usada no código, ausente em todos os arquivos relevantes

### Undocumented

- existe em `.env.local` ou `.env.production`, mas não em `.env.example`

### Unused

- declarada e sem referência aparente

### Dangerous Exposure

- segredo sensível em código de client bundle

### Conflicting Definitions

- mesma chave com valores ou intenções conflitantes entre ambientes

### Nested Project Drift

- arquivos `.env` em apps/pacotes internos divergindo do root

---

## Fases de Entrega

### Fase 1

- missing
- unused
- undocumented
- leitura segura e mascarada

### Fase 2

- análise por framework
- risco de exposição client/server
- nested apps

### Fase 3

- score mais refinado
- integração com `Launch Guard`
- histórico por projeto

---

## Riscos

### Vazar segredo no storage

Mitigação: nunca persistir valor bruto; sempre mascarar e preferir computação efêmera.

### Falsos positivos por busca ingênua

Mitigação: extração direcionada por sintaxe e por framework.

### Regras de precedência serem complexas

Mitigação: suportar primeiro frameworks mais comuns e documentar o escopo.

---

## Critérios de Sucesso

- detectar problemas reais de env com baixo ruído
- evitar persistência indevida de segredos
- ajudar a corrigir drift entre preview, local e produção
- integrar naturalmente à visão de serviços do projeto

---

## Resultado Esperado

O `Env Doctor` deve virar o diagnóstico rápido que evita horas perdidas em bug “fantasma” de configuração. Menos adivinhação, mais clareza operacional sobre o ambiente do projeto.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/main/services/EnvDoctorService.ts` (novo)
- `src/main/ipc/env-doctor-handlers.ts` (novo)
- `src/renderer/components/Services/EnvDoctorPanel.tsx` (novo)
- `src/renderer/views/ServicesView.tsx` (modificado - integracao)

### Observacoes:
- Fase 1 implementada conforme planejado
- Scan de arquivos env + codigo fonte
- Cross-reference para missing/unused/undocumented
- Health score gerado automaticamente
- Integracao verificada com TypeScript --noEmit
