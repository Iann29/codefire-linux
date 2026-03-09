# File Tools Audit And Expansion Plan

> **Date:** 2026-03-08
> **Status:** CONCLUÍDO
> **Atualizado em:** 2026-03-08
> **Verificado:** revisão arquitetural e especificação detalhada, sem implementação nesta etapa
> **O que foi feito:** o plano foi reescrito como especificação de produto e arquitetura para uma wave state of the art de tools de workspace/codebase, partindo da implementação real do `AgentService`, dos serviços já existentes no main process e dos gaps observados na qualidade operacional do agente.
> **Objetivo:** transformar o toolkit atual de arquivos e codebase do agent em uma superfície state of the art, segura, eficiente em tokens e realmente comparável ao nível operacional de Claude Code/Codex.

---

## Resumo Executivo

O problema não é apenas "faltam mais tools".

O problema real é que a superfície atual ainda é:

- rasa demais para exploração séria de codebase
- insegura demais no trato de paths
- pouco eficiente em tokens
- excessivamente acoplada ao `AgentService`
- pobre em semântica, obrigando o modelo a simular inteligência com chamadas brutas demais

State of the art aqui não significa expor vinte primitives soltas.

Significa desenhar um sistema de tools em camadas:

1. **workspace primitives** confiáveis
2. **retrieval tools** orientadas a contexto e economia de tokens
3. **semantic/code-intel tools** que reaproveitam a infra já existente do app
4. **editing tools** com segurança, precondição e diffs
5. **tool outputs** com contrato consistente e amigável para LLM

Se isso for bem feito, o agente deixa de "tatear o disco" e passa a navegar a codebase com intenção.

---

## Estado Atual Real da Codebase

Hoje a definição central das tools continua concentrada em:

- `src/main/services/AgentService.ts`

Os tools de workspace/codebase realmente expostos hoje são:

- `search_code`
- `read_file`
- `list_files`
- `git_status`
- `git_log`
- `git_diff`
- mais o conjunto de browser tools e ferramentas auxiliares de tasks/notes/sessions

### O que existe de bom hoje

#### `search_code`

Implementado no `AgentService`, apoiado pelo `SearchEngine`.

Pontos fortes:

- já usa index semântico
- devolve arquivo, símbolo, trecho e score
- é a melhor porta de entrada atual para descoberta de código

Limites:

- muito pouco configurável
- depende do índice estar pronto
- não cobre bem path exact, config files, assets e casos fora do pipeline de indexação
- ainda não oferece visão de símbolo, referências ou arquivos relacionados

#### `read_file`

Hoje faz essencialmente:

- recebe `path`
- lê o arquivo inteiro
- corta em `8_000` chars

Limites:

- sem leitura por faixa de linhas
- sem paginação
- sem metadados
- sem noção de stale file
- sem classificação texto/binário
- sem output estruturado
- sem escopo forte por projeto

#### `list_files`

Hoje faz essencialmente:

- recebe `path`
- lista entradas do diretório
- retorna nome, path, diretório e size

Limites:

- sem depth
- sem filtros
- sem glob
- sem ordenação útil
- sem paginação
- sem resumo hierárquico
- sem escopo forte por projeto

---

## Diagnóstico Central

### 1. A superfície é de filesystem bruto, não de workspace inteligente

Ela obriga o modelo a fazer loops desnecessários:

- listar diretório
- abrir arquivo inteiro
- tentar adivinhar onde está o trecho relevante
- repetir o processo até acertar

Isso aumenta:

- número de tool calls
- latência
- custo
- chance de erro

### 2. O contrato de path ainda está fraco

O prompt instrui o agent a usar `projectPath`, mas as tools em si ainda aceitam path arbitrário. Isso não é segurança real; é só uma instrução textual.

### 3. Faltam tools intermediárias

Entre "descobrir" e "ler" faltam ferramentas críticas:

- glob
- grep textual
- árvore resumida
- metadata de arquivo
- leitura por linhas
- leitura em lote
- related files
- recent/changed files

### 4. Falta separação entre retrieval e editing

No desenho atual, nem a leitura está madura o suficiente, e a escrita ainda nem foi formalizada com precondições, hashes e diffs.

### 5. O `AgentService` está concentrando demais

Hoje ele faz tudo ao mesmo tempo:

- define schema de tool
- decide prompt
- executa tool
- aplica política de segurança
- orquestra runs
- emite eventos

Essa arquitetura não escala bem para uma wave séria de novas tools.

---

## Tese de Produto

O objetivo não deve ser "ter mais tools".

O objetivo deve ser:

- **menos tool calls para chegar no arquivo certo**
- **menos bytes lidos para entender o ponto certo**
- **mais respostas estruturadas e estáveis**
- **menos necessidade de o modelo improvisar workflow**
- **mais semântica por chamada**

Uma boa tool state of the art responde "o que o agente realmente quer saber", não apenas "como um terminal genérico faria isso".

---

## Princípios de Design

### 1. Relative-path first

As tools devem preferir caminhos relativos ao root do projeto.

O modelo não deveria precisar trafegar paths absolutos gigantes na maioria dos casos.

### 2. Scoped by default

Toda tool de workspace deve operar dentro do projeto ativo por padrão.

Saída do projeto deve ser bloqueada, ou explicitamente marcada como exceção segura.

### 3. Structured outputs sempre

Nada de resposta "solta" quando a ferramenta pode devolver JSON tipado com:

- `data`
- `meta`
- `truncated`
- `cursor`
- `hints`

### 4. Budget-aware

As tools devem ajudar o modelo a gastar menos tokens:

- snippets curtos
- ranges
- paginação
- summaries
- leitura em lote

### 5. Deterministic and diff-friendly

Saídas devem ser estáveis o suficiente para:

- comparação entre chamadas
- patch generation
- stale detection

### 6. Layered semantics

Nem tudo precisa ser um `read_file`.

Algumas perguntas do agente são sobre:

- símbolos
- imports
- estrutura de componentes
- arquivos relacionados
- mudanças recentes

Essas perguntas merecem tools próprias.

### 7. Safety before power

Edit tools só entram com:

- escopo forte
- precondição por hash
- preview de diff
- política clara para destructive actions

---

## Arquitetura Alvo

### Extração do bloco de tools do `AgentService`

Recomendação:

- manter o `AgentService` como orquestrador de runs
- extrair o ecossistema de tools para uma camada própria

Estrutura sugerida:

- `src/main/services/tools/ToolRegistry.ts`
- `src/main/services/tools/ToolExecutionContext.ts`
- `src/main/services/tools/ToolResult.ts`
- `src/main/services/tools/pathPolicy.ts`
- `src/main/services/tools/files/FileToolService.ts`
- `src/main/services/tools/codeintel/CodeIntelToolService.ts`
- `src/main/services/tools/git/GitToolService.ts`

### Contexto de execução sugerido

Cada tool deve receber um contexto explícito:

- `projectId`
- `projectPath`
- `cwd`
- `conversationId`
- `indexReady`
- `userIntentHints`

### Envelope padrão de resposta

Todas as tools novas devem convergir para algo como:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "projectRoot": "src/..",
    "path": "src/app/page.tsx",
    "resolvedPath": "/abs/path",
    "truncated": false,
    "cursor": null,
    "checksum": "sha256:..."
  },
  "hints": {
    "suggestedNextTools": ["read_file_range", "find_symbol"]
  }
}
```

O modelo não precisa usar sempre `hints`, mas eles ajudam a reduzir thrash quando a resposta for truncada ou incompleta.

---

## Políticas de Segurança

### Path policy obrigatória

Criar um helper central:

- `resolveProjectScopedPath(inputPath, projectPath, options?)`

Responsabilidades:

- normalizar `..`
- resolver relativo ao projeto
- bloquear fuga de escopo
- classificar caminho como:
  - dentro do projeto
  - fora do projeto mas permitido
  - bloqueado

### Regras recomendadas

- leitura fora do projeto: bloqueada por padrão
- escrita fora do projeto: proibida
- symlink traversal: explicitamente tratado
- hidden files: opt-in
- binários: não abrir como texto

### Edit tools com precondição

Toda escrita futura deve exigir:

- hash/checksum da versão lida
- ou `expected_mtime`

Se o arquivo mudou, a tool falha com erro claro de stale state.

---

## Taxonomia State Of The Art de Tools

### Camada 1. Workspace Navigation

Essas são as primitives essenciais para o agente se localizar sem desperdiçar tokens.

#### 1. `list_files`

Evoluir o contrato atual para incluir:

- `path`
- `depth`
- `files_only`
- `dirs_only`
- `include_hidden`
- `extensions`
- `limit`
- `sort`
- `cursor`

Resposta ideal:

- lista paginada
- path relativo
- tipo
- size
- modifiedAt
- próxima página quando houver

#### 2. `get_directory_tree`

Nova tool para visão hierárquica compacta.

Parâmetros:

- `path`
- `depth`
- `include_hidden`
- `max_nodes`

Uso:

- entender estrutura de módulo
- descobrir app router, componentes, configs
- reduzir múltiplas chamadas de `list_files`

#### 3. `glob_files`

Nova tool para matching por padrão.

Parâmetros:

- `pattern`
- `base_path`
- `include_hidden`
- `limit`

Uso:

- `**/*.tsx`
- `**/page.tsx`
- `**/{tailwind,postcss,vite,next}.config.*`

#### 4. `get_file_info`

Nova tool para metadata sem abrir conteúdo.

Parâmetros:

- `path`

Resposta:

- existe?
- texto ou binário?
- tamanho
- extensão
- mtime
- checksum curto
- line count

---

### Camada 2. Content Retrieval

Essas tools respondem "o que tem aqui?" de forma econômica.

#### 5. `read_file`

Manter o nome por compatibilidade, mas evoluir o contrato.

Parâmetros:

- `path`
- `max_chars`
- `include_line_numbers`
- `mode`

`mode` pode começar simples:

- `full`
- `head`
- `tail`

#### 6. `read_file_range`

Nova tool focada em precisão.

Parâmetros:

- `path`
- `start_line`
- `end_line`
- `include_line_numbers`
- `context_before`
- `context_after`

Essa tool deveria virar a forma preferida de leitura depois da descoberta inicial.

#### 7. `read_many_files`

Nova tool de batch.

Parâmetros:

- `paths`
- `max_chars_per_file`
- `include_line_numbers`

Uso:

- abrir vários arquivos pequenos de config
- comparar implementações
- ler imports/exports de múltiplos módulos

#### 8. `grep_files`

Nova tool textual, independente do índice.

Parâmetros:

- `query`
- `is_regex`
- `base_path`
- `extensions`
- `case_sensitive`
- `context_lines`
- `limit`

Uso:

- string literal
- env vars
- CSS classes
- nomes de rota
- textos e labels

---

### Camada 3. Semantic Code Intelligence

Aqui começa o diferencial real.

Em vez de só ler arquivos, o agente passa a perguntar pela estrutura do código.

#### 9. `search_code`

Manter, mas fortalecer.

Melhorias:

- `query`
- `limit`
- `path_prefix`
- `chunk_types`
- `symbols_only`

Saída:

- relative path
- symbol
- chunk type
- lines
- snippet
- score

#### 10. `find_symbol`

Nova tool construída sobre índice/chunks.

Parâmetros:

- `symbol`
- `kind?`
- `path_prefix?`

Uso:

- achar função
- achar componente
- achar classe
- achar hook

#### 11. `find_related_files`

Nova tool heurística para reduzir chamadas burras.

Fontes possíveis:

- imports/exports
- mesmo diretório
- convenções de framework
- search hits
- component graph

Uso:

- "ache arquivos ligados a este componente"
- "qual o css, teste, loader, schema e route desse módulo?"

#### 12. `list_changed_files`

Nova tool orientada a fluxo real de engenharia.

Backends:

- `GitService`

Uso:

- descobrir o que mudou na branch
- limitar leitura ao delta relevante

Parâmetros:

- `scope`: `working_tree | staged | branch_diff`
- `limit`

---

### Camada 4. Safe Editing

Essas tools entram só depois de a camada de leitura estar madura.

#### 13. `write_file`

Uso controlado:

- criar arquivo novo
- reescrever arquivo pequeno

Campos obrigatórios:

- `path`
- `content`
- `create_if_missing`
- `expected_checksum?`

#### 14. `apply_file_patch`

Essa é a tool mais importante da camada de edição.

Ela deve receber algo parecido com:

- `path`
- `patch`
- `expected_checksum`

Por quê:

- reduz risco de overwrite cego
- combina com workflow de diffs
- força o agente a operar incrementalmente

#### 15. `move_path`

Uso:

- renomear arquivo
- mover arquivo

Campos:

- `from`
- `to`
- `expected_checksum?`

### Não recomendar na primeira wave

- `delete_path`
- edição arbitrária fora do projeto
- patch binário

---

## Bridges Para Serviços Já Existentes

Aqui está a grande oportunidade: o app já tem serviços que podem virar tools especializadas, sem reinventar tudo.

### Serviços já existentes que devem virar tools depois da base

- `src/main/services/SearchEngine.ts`
- `src/main/services/component-graph/ComponentGraphService.ts`
- `src/main/services/routes/RouteDiscoveryService.ts`
- `src/main/services/design-system/DesignSystemService.ts`
- `src/main/services/EnvDoctorService.ts`
- `src/main/services/launch-guard/LaunchGuardService.ts`

### Ferramentas derivadas de alto valor

#### `component_usage`

Baseado em `ComponentGraphService`.

Pergunta respondida:

- "onde esse componente é usado?"

#### `discover_routes`

Baseado em `RouteDiscoveryService`.

Pergunta respondida:

- "quais rotas esse projeto expõe?"

#### `inspect_design_system`

Baseado em `DesignSystemService`.

Pergunta respondida:

- "quais tokens/cores/spacing/fontes existem?"

#### `env_doctor`

Baseado em `EnvDoctorService`.

Pergunta respondida:

- "quais variáveis/configs estão faltando ou divergentes?"

Essas não são "file tools puras", mas são a evolução natural de um toolkit state of the art.

---

## Contratos Recomendados de Saída

### Para tools de leitura

Sempre devolver:

- path relativo
- path resolvido
- checksum
- truncation
- range de linhas quando aplicável

### Para tools de busca

Sempre devolver:

- score
- path relativo
- snippet curto
- localização precisa

### Para tools de escrita

Sempre devolver:

- `applied: true|false`
- diff summary
- checksum antigo
- checksum novo
- erro claro em caso de stale file

---

## Estratégia de Economia de Tokens

Uma tool state of the art não entrega o máximo de bytes; ela entrega o máximo de utilidade por token.

### Regras recomendadas

- `list_files` e `get_directory_tree` paginados
- `read_file` nunca usar como megadump bruto por padrão
- preferir `read_file_range` após descoberta inicial
- `read_many_files` para small files
- `grep_files` com snippets curtos e contexto limitado
- `search_code` com ranking agressivo e recorte curto

### Heurísticas boas

- configs pequenas podem ser lidas em lote
- arquivos grandes devem retornar:
  - head
  - tail
  - line count
  - "use read_file_range for precise sections"

---

## Tool Selection Policy Para o Modelo

O desenho das tools precisa vir acompanhado de instruções boas para o agent.

### Policy recomendada

- use `search_code` para descobrir temas e símbolos
- use `glob_files` para padrões de nome/localização
- use `get_directory_tree` para entender estrutura
- use `read_file_range` para aprofundar
- use `read_many_files` quando comparar pequenos arquivos
- use `grep_files` para string literal/config/label
- evite `read_file` full repetido em arquivos grandes

Isso reduz chamadas aleatórias e melhora consistência.

---

## Plano de Execução

### Fase 0. Fundamento arquitetural

- extrair registry de tools do `AgentService`
- criar `ToolExecutionContext`
- criar `ToolResult` envelope padrão
- criar `pathPolicy.ts`

### Fase 1. Core read-only state of the art

- melhorar `list_files`
- melhorar `read_file`
- adicionar `read_file_range`
- adicionar `glob_files`
- adicionar `grep_files`
- adicionar `get_file_info`
- adicionar `get_directory_tree`
- adicionar `read_many_files`

Essa é a fase mais importante.

### Fase 2. Semantic intelligence

- fortalecer `search_code`
- adicionar `find_symbol`
- adicionar `find_related_files`
- adicionar `list_changed_files`

### Fase 3. Safe editing

- `write_file`
- `apply_file_patch`
- `move_path`

Com:

- checksum
- escopo
- diff summary

### Fase 4. Specialized bridge tools

- `component_usage`
- `discover_routes`
- `inspect_design_system`
- `env_doctor`

---

## Métricas de Qualidade

Se a wave for boa, estes números devem melhorar:

- menos tool calls por tarefa
- menos `read_file` full desnecessário
- menos tokens gastos em exploração
- menor tempo até o primeiro arquivo relevante
- menor taxa de erro por path inválido
- maior taxa de sucesso em tarefas reais de entendimento/refactor

### Métricas recomendadas

- `avg_tool_calls_per_task`
- `avg_read_bytes_per_task`
- `avg_prompt_tokens_before_first_relevant_edit`
- `path_escape_block_count`
- `search_to_read_conversion_rate`
- `batch_read_adoption_rate`

---

## Testes Necessários

### Unit tests

- normalização de paths
- bloqueio de escape do projeto
- paginação
- truncation
- stale checksum handling

### Integration tests

- agent encontra componente certo com menos chamadas
- agent lê trecho específico com `read_file_range`
- agent descobre configs com `glob_files`
- agent acha string literal com `grep_files`
- agent usa `read_many_files` para small configs

### Golden tests de output

As respostas das tools devem ter formato estável.

Isso é importante para não degradar o comportamento do modelo quando o backend mudar.

### Eval real de agente

Rodar cenários concretos:

- "ache onde o login valida senha"
- "descubra as rotas do app"
- "encontre todos os componentes que usam esse token"
- "compare duas implementações"
- "prepare patch seguro em um arquivo já lido"

---

## Riscos

### 1. Expor tools demais e confundir o modelo

Mitigação:

- lançar em camadas
- descrições excelentes
- policy clara no prompt

### 2. Duplicar capacidades

Exemplo:

- `search_code` vs `grep_files`

Mitigação:

- papéis diferentes e bem descritos
- `search_code` para busca semântica/indexada
- `grep_files` para busca literal/regex

### 3. Explodir tokens com saídas longas

Mitigação:

- cursores
- limites
- snippets curtos
- ranges

### 4. Segurança insuficiente em edição

Mitigação:

- checksum obrigatório
- escopo obrigatório
- destructive ops fora da primeira wave

---

## Não Objetivos da Primeira Wave

- shell arbitrário disfarçado de file tool
- deletar paths
- editar fora do projeto
- manipular arquivos binários complexos
- substituir serviços especializados por leitura crua de arquivo

---

## Definição de Sucesso

O plano estará realmente bem sucedido quando o agente conseguir:

- localizar o arquivo certo mais rápido
- ler menos e entender mais
- operar com paths seguros por padrão
- usar ferramentas semânticas em vez de martelar `read_file`
- preparar mudanças com segurança de concorrência

Em outras palavras:

o toolkit de workspace precisa evoluir de "filesystem bruto com prompt esperto" para "camada de tools opinativa, segura e otimizada para agentes".

Esse é o nível correto para o Pinyino.
