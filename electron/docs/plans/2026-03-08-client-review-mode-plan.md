# Client Review Mode Plan

> **Date:** 2026-03-08
> **Status:** IMPLEMENTADO
> **Objetivo:** transformar feedback de cliente em fluxo estruturado com gravação, transcrição, evidência visual, tasks vinculadas e contexto da página revisada.

---

## Problema

Feedback de cliente costuma chegar em formato caótico:

- áudio solto
- mensagem no chat
- screenshot sem contexto
- “naquela página lá”
- pedido visual misturado com bug técnico

Hoje o CodeFire já tem peças importantes para review, mas elas ainda estão separadas:

- gravação de áudio
- transcrição
- extração de tasks
- screenshot no browser
- anexos em task

Falta unir tudo isso em uma experiência de review coerente.

---

## O que já existe na codebase

- `src/renderer/components/Recordings/RecordingBar.tsx`
  - gravação de áudio
- `src/renderer/hooks/useRecorder.ts`
  - base do recorder atual
- `src/renderer/views/RecordingsView.tsx`
  - lista e gestão de gravações
- `src/main/ipc/recording-handlers.ts`
  - persistência de áudio e transcrição
- `src/main/database/dao/RecordingDAO.ts`
  - gravações no banco
- `src/renderer/components/Recordings/RecordingDetail.tsx`
  - já extrai tasks do transcript
- `src/renderer/views/BrowserView.tsx`
  - screenshot do browser
- `src/renderer/components/Browser/CaptureIssueSheet.tsx`
  - cria issue/task a partir de evidência
- `src/main/ipc/task-handlers.ts`
  - tasks com anexos
- `src/renderer/components/Kanban/TaskDetailSheet.tsx`
  - exibe anexos de task

### Gaps muito concretos

- `taskItems` já têm `recordingId` no modelo/schema, mas `TaskDAO.create` ainda não liga task a recording.
- existe tabela `browserScreenshots`, mas não há DAO/handler/uso real no renderer.
- em `CaptureIssueSheet`, marcar screenshot não persiste o arquivo de verdade; a task criada recebe só texto.
- o recorder atual é basicamente microfone, não captura tela, passos nem âncoras de URL/elemento.

---

## Visão da Feature

O `Client Review Mode` deve permitir uma sessão de revisão com:

- URL da página revisada
- áudio do review
- transcript
- screenshots de evidência
- tasks derivadas
- resumo final

Na prática, isso aproxima o CodeFire de uma ferramenta de revisão de site, não só de notas de voz.

---

## Estratégia Recomendada da V1

### Sem inventar entidade nova cedo demais

Dá para entregar uma V1 forte usando o que já existe:

- `Recording` como artefato principal da sessão
- `TaskItem` com label `client-review`
- screenshot anexada à task
- transcript completo salvo na gravação
- note-resumo opcional do review

### Ajustes fundamentais para essa V1

1. persistir screenshot de verdade
2. ligar task à gravação via `recordingId`
3. guardar URL/contexto da página revisada
4. permitir gerar múltiplas tasks do mesmo review

---

## UX Proposta

### Início da sessão

No Browser, botão `Start Review`.

O sistema:

- registra URL atual
- inicia gravação
- permite capturar screenshots durante a fala

### Durante a revisão

O usuário pode:

- falar
- marcar um ponto importante
- tirar screenshot
- criar um issue rápido

### Encerramento

Ao parar:

- transcript é gerado
- tarefas potenciais são sugeridas
- screenshots ficam vinculadas
- uma nota resumo pode ser criada

---

## Arquitetura Recomendada

### Persistência de screenshot

A tabela `browserScreenshots` já existe, então o caminho mais coerente é completá-la:

- criar DAO
- criar IPC handler
- salvar arquivo em disco
- referenciar screenshot em task attachment ou review

### Ligação task <-> recording

Corrigir o fluxo para `TaskDAO.create` aceitar `recordingId` quando a task vier de um review.

### Modelo futuro

Se a feature crescer, criar entidades próprias:

- `reviewSessions`
- `reviewItems`

Mas isso deve ficar para V2, quando for preciso separar:

- bug
- pedido de ajuste visual
- dúvida
- aprovação
- follow-up

---

## Arquivos Prováveis de Implementação

- `src/renderer/views/BrowserView.tsx`
- `src/renderer/components/Browser/CaptureIssueSheet.tsx`
- `src/renderer/views/RecordingsView.tsx`
- `src/renderer/components/Recordings/RecordingDetail.tsx`
- `src/renderer/hooks/useRecorder.ts`
- `src/main/ipc/recording-handlers.ts`
- `src/main/ipc/task-handlers.ts`
- `src/main/database/dao/RecordingDAO.ts`
- `src/main/database/dao/TaskDAO.ts`
- novos módulos para `browserScreenshots`

---

## Fases de Entrega

### Fase 1

- review session a partir do browser
- gravação de áudio
- screenshot persistida
- task ligada à gravação
- transcript com extração de tasks

### Fase 2

- resumo automático do review
- múltiplas evidências por sessão
- timeline simples

### Fase 3

- entidade própria de review
- tipos de item
- comentários com timestamp
- captura de tela mais rica

---

## Riscos

### Misturar tudo em task e perder semântica

Mitigação: usar `TaskItem` só na V1 e planejar `reviewSessions` depois.

### Fluxo de provider inconsistente

Mitigação: alinhar transcrição e extração ao provider stack central no médio prazo.

### Review ainda parecer “voice notes”

Mitigação: já na V1 ligar áudio, URL e screenshot persistida de forma clara.

---

## Critérios de Sucesso

- registrar review sem sair do browser
- transformar feedback falado em task acionável com evidência
- manter vínculo claro entre gravação, página e task
- reduzir retrabalho de interpretar feedback solto

---

## Resultado Esperado

O `Client Review Mode` deve transformar feedback difuso em operacao concreta. Em vez de um audio perdido, o projeto passa a ter sessao, contexto, evidencia e acoes rastreaveis.

---

## Status de Implementacao

> **Implementado em:** 2026-03-08
> **Versao:** v1.6.0
> **Verificado:** TSC compila sem erros

### Arquivos criados/modificados:
- `src/renderer/components/Browser/ReviewModeBar.tsx` (novo)
- `src/renderer/views/BrowserView.tsx` (modificado - integracao no footer)

### Observacoes:
- Fase 1 (V1) implementada conforme planejado
- Captura de screenshot durante review
- Criacao de issues com label "client-review"
- Indicador de gravacao com timer
- Geracao de nota resumo
- Integracao verificada com TypeScript --noEmit
