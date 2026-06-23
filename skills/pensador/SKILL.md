---
name: pensador
description: Orquestra o protocolo v2 do Pensador em onze estagios, transformando uma demanda em linguagem natural em PRD (ou specs OpenSpec) e artefatos isolados por feature. Inclui exploracao via Code Base Memory, analise de arquitetura, expansao, complexidade, brainstorm geral paralelo por dominio, refinamento Codex, AGY e consolidacao final. Toda pergunta ao usuario passa exclusivamente por AskUserQuestion.
---

# Skill: Pensador

Esta skill orquestra o fluxo **Pensador v2**. O fluxo gera um PRD base, analisa a arquitetura do projeto, expande requisitos, estima complexidade, coordena um brainstorm geral por dominio, refina tecnicamente com Codex, fecha lacunas de produto com AGY e entrega os artefatos finais em um diretorio isolado por feature.

O protocolo v2 substitui os estagios autonomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` por um unico estagio **BRAINSTORM_GERAL**, que usa skills e agentes como lentes de dominio em paralelo quando aplicavel.

---

## Referencias de apoio

| Arquivo | Proposito |
|---|---|
| `skills/prd/SKILL.md` | Skill_PRD_Base: `Strict_PRD_Schema`, entrevista de descoberta e padroes de qualidade do PRD |
| `scripts/pensador-engine.mjs` | Especificacao deterministica de referencia do fluxo, gates, mapeamentos e artefatos |
| `skills/pensador/references/stages.md` | Comportamento detalhado de cada estagio e gates de avanco |
| `skills/pensador/references/feature-isolation.md` | Isolamento por feature, `allocateFeatureDir()`, checkpoints e contrato `shared-agents/` |
| `skills/pensador/references/skill-stack.md` | Skills como lentes de dominio do BRAINSTORM_GERAL |
| `skills/pensador/references/agent-stack.md` | Roteamento Codex/AGY/Kiro e contrato `shared-agents/` |
| `skills/pensador/references/execution-modes.md` | Modos de execucao `--modo` (claude/agy/kiro/codex) e contrato de delegacao |
| `skills/pensador/references/codebase-memory.md` | Code Base Memory (MCP) obrigatorio: exploracao do projeto antes do PRD/Spec |
| `skills/pensador/references/open-design.md` | Open Design (MCP/CLI) opcional: brief de design e geracao de `design-system.md` quando ha front-end |
| `scripts/od-fetch-system.mjs` | Script I/O que executa `openDesignFetchPlan()` no FINAL: copia os artefatos verbatim do system (tokens.css, components.html, preview/, …) para `packages/ui/design-systems/<id>/` |
| `skills/pensador/references/openspec.md` | OpenSpec opcional: escolha PRD vs Spec no INIT e montagem de specs |
| `skills/pensador/references/handoff-contract.md` | Contrato de handoff Pensador→Orchestrador→Executor: `handoff.json`, raizes ocultas e correlacao por slug |
| `skills/pensador/references/askuserquestion-protocol.md` | Canal unico de dialogo, previews, recap final e handoff |
| `skills/pensador/assets/prd-template.md` | Template do artefato `prd.md` |
| `skills/pensador/assets/userhistory-template.md` | Template do artefato `userhistory.md` |
| `skills/pensador/assets/comunication_json-template.md` | Template do artefato `comunication_json.md` quando ha back-end |

---

## Ordem canonica v2

A sequencia e fixa e nunca reordenada:

```text
INIT → EXPLORE → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

`STAGE_ORDER` v2:

```js
[
  'INIT',
  'EXPLORE',
  'PRD_BASE',
  'ARCH',
  'EXPAND',
  'COMPLEXITY',
  'BRAINSTORM_GERAL',
  'CODEX',
  'AGY',
  'FINAL',
  'DONE',
]
```

`CHECKPOINT_VERSION = 2`. O `StageState` persistido deve incluir `featurePath`, apontando para o diretorio isolado da feature alocado por `allocateFeatureDir()`.

---

## Isolamento por atualizacao

Antes de gerar qualquer artefato persistente do fluxo, chame conceitualmente `allocateFeatureDir()`:

```text
.pensador/<slug-da-demanda>-vN/
  .pensador-progress.json
  codebase-memory.md
  architecture.md
  shared-agents/
    context-pack.md
    codex.response.md
    agy.response.md
    requirements-clarity.response.md
    agent.response.md
  prd.md
  userhistory.md
  comunication_json.md
  design-system.md
```

> No modo Spec (OpenSpec), `prd.md` e substituido por `proposal.md`, `specs.md`, `design.md` e `tasks.md`. `codebase-memory.md` e o snapshot da exploracao do Code Base Memory feita no INIT. `design-system.md` (DESIGN.md gerado via Open Design) so e gravado no modo PRD quando a demanda tem front-end (`hasFrontend`).

Regras:

- `<slug>` e o slug curto da demanda recebida na execucao do Pensador (minusculas, sem acentos, nao alfanumericos colapsados em hifen); fallback `atualizacao` quando o nome ficar vazio.
- `-vN` e a versao local daquela demanda: primeira execucao usa `-v1`; se ja existir pasta para o mesmo slug, use a proxima versao disponivel (`-v2`, `-v3`, ...).
- Exemplo: `/pensador desenvolva uma pagina de clientes` deve gerar algo como `.pensador/pagina-clientes-v1/`.
- `featurePath` e gravado no `StageState` e usado por todos os estagios seguintes.
- Checkpoints v2 ficam em `<featurePath>/.pensador-progress.json`; artefatos finais ficam diretamente em `<featurePath>/`.
- Checkpoints v1 em `pensador-output/.pensador-progress.json` sao incompativeis com v2; ofereca recomecar em v2 via `AskUserQuestion`, sem tentar desserializar como estado v2.
- Consulte `references/feature-isolation.md` para retomada, contrato `shared-agents/` e nota de `.gitignore`.

---

## Canal unico de dialogo

Toda pergunta apresentada ao usuario durante o fluxo usa exclusivamente `AskUserQuestion`.

Isso inclui demanda ausente, retomada de checkpoint, entrevista greenfield em ARCH, requisitos candidatos em EXPAND, decisao Lite/Completo em COMPLEXITY, perguntas vindas do BRAINSTORM_GERAL, Codex, AGY, fallback, confirmacao de back-end, sobrescrita de artefatos, recap final e handoff.

O idioma padrao e PT-BR. Cada pergunta deve oferecer uma opcao recomendada quando houver uma recomendacao defensavel, incluir previews quando a decisao afetar artefatos e registrar autoria/origem da pergunta.

---

## Modos de execucao (`--modo`)

O modo de execucao define **qual motor executa o trabalho pesado** do fluxo (redigir o PRD base, expandir requisitos, sintetizar analises e gerar artefatos). E ortogonal a delegacao por estagio (Codex/AGY/skills como lentes de dominio).

- `--modo claude` (padrao, ou ausente): o Claude Code faz o trabalho e gasta os proprios tokens.
- `--modo agy` | `--modo kiro` | `--modo codex`: o Claude Code vira um orquestrador fino e **delega** cada unidade de trabalho para a CLI externa via slash command, fazendo o custo recair sobre a quota daquele motor. Barateia a geracao dos artefatos.

| Modo | Slash command | Parametro padrao |
|---|---|---|
| `claude` | — | — |
| `agy` | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `kiro` | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `codex` | `/codex:rescue` | `--effort high` |

Regras centrais:

- **Invariante preservada:** em qualquer modo, todo dialogo com o usuario continua passando exclusivamente por `AskUserQuestion`. O motor externo nunca conversa com o usuario; ele so produz rascunhos/analises que o Pensador relê e consolida.
- Parsing: `parseExecutionMode($ARGUMENTS)` extrai `--modo`, `--model` e `--effort` e devolve o restante como `demanda`. `--modo` desconhecido cai para `claude` com aviso via `AskUserQuestion`.
- Preflight: rode `preflight.mjs --modo <modo>`; se o motor escolhido estiver indisponivel, pergunte via `AskUserQuestion` se deve cair para `--modo claude` ou abortar.
- Decisoes que exigem o usuario nunca sao delegadas: viram perguntas `AskUserQuestion` feitas pelo proprio Pensador.
- O modo de execucao e independente das lentes de dominio: mesmo em `--modo kiro`, os estagios `CODEX` e `AGY` continuam usando `codex:codex-rescue` e `cc-antigravity-plugin:antigravity-agent` como lentes (salvo fallback).

Detalhes completos, parsing, fallback e contrato de delegacao em `references/execution-modes.md`. Mapeamento deterministico em `pensador-engine.mjs` (`EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`).

---

## Gate de avanco

O Pensador nunca avanca para o proximo estagio enquanto existir pergunta sem desfecho registrado no estagio atual.

- `canAdvance(state)` e verdadeiro se e somente se nao ha perguntas pendentes no `currentStage`.
- Pergunta respondida ou explicitamente diferida pelo usuario satisfaz o gate.
- Um dominio nao aplicavel em `BRAINSTORM_GERAL` registra fallback por dominio ou zero perguntas justificadas, mas o estagio ainda e visitado.
- Ao fechar o gate de cada estagio, grave checkpoint v2 em `<featurePath>/.pensador-progress.json`.

---

## Visao geral dos estagios

```text
INIT
  Resolve modo de execucao (--modo), verifica demanda, checkpoint v2 e aloca featurePath.
  Se OpenSpec for detectado, pergunta PRD vs Spec (artifactMode).

EXPLORE
  Explora o projeto com Code Base Memory (index_repository, get_architecture,
  search_graph, trace_path) e grava <featurePath>/codebase-memory.md.
  Fallback para Read/Glob/Grep se indisponivel.

PRD_BASE
  Modo PRD: gera PRD Base pelo Strict_PRD_Schema. Modo Spec: escala os comandos
  openspec-* para montar o change set. Sem perguntas; avanco automatico.

ARCH
  Analisa projeto existente via Code Base Memory (indice criado no EXPLORE) e Read/Glob/Grep.
  Em greenfield, entrevista o usuario. Grava <featurePath>/architecture.md.

EXPAND
  Amplia requisitos candidatos do proprio Pensador.

COMPLEXITY
  Executa detectComplexity() com sinais domainCount, hasBackend,
  hasBroadScopeKeywords e isGreenfield. Sugere modo Lite ou Completo.

BRAINSTORM_GERAL
  Orquestra em paralelo requirements-clarity, Codex high se hasBackend e AGY
  gemini-3.1-pro-high se hasFrontend. Quando hasFrontend, parseia o brief de
  design para o Open Design (gera design-system.md no FINAL). Usa
  context-pack.md e agent.response.md. Aplica fallback por dominio.

CODEX
  Refinamento tecnico final com Codex usando effort high.
  Nao participa quando a atividade e especifica de front-end (hasFrontend e nao hasBackend).

AGY
  Lacunas remanescentes de produto com AGY usando gemini-3.1-pro-high.

FINAL
  Consolida, confirma back-end, gera artefatos (incl. design-system.md quando
  hasFrontend) e apresenta recap final/handoff.

DONE
  Estado terminal.
```

---

## INIT

1. Execute `parseExecutionMode($ARGUMENTS)` para separar `--modo` (claude/agy/kiro/codex), `--model`/`--effort` e a `demanda`. Registre o modo de execucao no estado. Se `--modo` for desconhecido, avise via `AskUserQuestion` e use `claude`.
2. Verifique se ha checkpoints v2 em `.pensador/<slug-da-demanda>-vN/.pensador-progress.json`.
3. Se houver checkpoint v2 valido, pergunte via `AskUserQuestion` se o usuario quer retomar do estagio salvo ou iniciar nova atualizacao. A opcao recomendada deve ser retomar quando o checkpoint estiver consistente.
4. Se houver apenas checkpoint v1 em `pensador-output/.pensador-progress.json`, trate como incompativel. Pergunte se deve iniciar um fluxo v2 novo, deixando claro que o checkpoint antigo nao sera reutilizado.
5. Se iniciar novo fluxo, derive um nome curto da atualizacao a partir da demanda, gere o slug base (`slugify()`) e execute `allocateFeatureDir()` com esse nome; grave `featurePath = ".pensador/<slug-da-demanda>-vN"` no estado. Use o fallback `atualizacao-v1` quando o nome ficar vazio e incremente `N` se ja houver pasta para o mesmo slug.
6. Se a demanda estiver ausente ou vazia, solicite-a via `AskUserQuestion`.
7. **OpenSpec (opcional).** Se o preflight reportar `integrations.openspec.available = true`, pergunte via `AskUserQuestion` se o usuario quer gerar um **PRD** (padrao) ou uma **Spec** estruturada (OpenSpec). Registre a escolha em `artifactMode` (`prd` ou `spec`) com `withArtifactMode(state, escolha)`. Se o OpenSpec nao for detectado, mantenha `artifactMode = 'prd'` sem perguntar. Detalhes em `references/openspec.md`.
8. Com demanda presente, modo de execucao resolvido, `artifactMode` definido e `featurePath` definido, avance para `EXPLORE`.

**Gate:** demanda presente e nao vazia, modo de execucao resolvido (e motor confirmado disponivel ou fallback para `claude` registrado), `artifactMode` definido (`prd` por padrao; `spec` so quando OpenSpec foi escolhido), `featurePath` definido, checkpoint v2 retomado ou decisao de novo fluxo registrada.

---

## EXPLORE

**Objetivo:** explorar o projeto existente com o **Code Base Memory** (obrigatorio) antes de gerar o PRD/Spec, para entender com precisao a estrutura sobre a qual a feature/fix vai atuar.

1. Confira `integrations.codebaseMemory.available` do preflight.
2. Disponivel: rode a sequencia de ferramentas do MCP `codebase-memory-mcp` na ordem `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (acrescente `detect_changes` quando for um fix sobre codigo existente).
3. Grave o resumo em `<featurePath>/codebase-memory.md`: panorama de arquitetura, simbolos e arquivos afetados, cadeias de chamada relevantes, raio de impacto (em fixes) e lacunas/incertezas.
4. Indisponivel (`available = false`): pergunte via `AskUserQuestion` se o usuario deseja **instalar o servidor agora** (opcao recomendada) ou seguir sem ele:
   - **Opcao A — Instalar:** execute o instalador da plataforma (`install.sh` no Linux/macOS; `install.ps1` no Windows via PowerShell) usando `Bash`, aguarde conclusao, oriente o usuario a reconectar o MCP (ou reiniciar o agente) e retome o EXPLORE com o servidor disponivel. Veja os comandos exatos em `references/codebase-memory.md`.
   - **Opcao B — Seguir sem:** explore com `Read`/`Glob`/`Grep` e registre a decisao no `codebase-memory.md`.
5. Greenfield (sem base relevante): registre que nao ha codigo a indexar e avance.

Este e um estagio sem perguntas de produto: ele e visitado, produz o snapshot (ou registra fallback) e avanca. Detalhes em `references/codebase-memory.md`.

**Gate:** `<featurePath>/codebase-memory.md` gravado (com a exploracao do Code Base Memory ou o fallback registrado).

---

## PRD_BASE

**Objetivo:** produzir o artefato base a partir da demanda — `PRD_Base` no modo PRD ou a **montagem de specs estruturadas** no modo Spec (OpenSpec). A escolha vem de `artifactMode`, definido no INIT.

### Modo PRD (`artifactMode = 'prd'`, padrao)

1. Carregue `skills/prd/SKILL.md`.
2. Aplique a entrevista de descoberta sobre a demanda, usando o `<featurePath>/codebase-memory.md` como contexto.
3. Preencha cada secao inferivel; se nao inferivel, marque exatamente `"TBD"`.

### Modo Spec (`artifactMode = 'spec'`, OpenSpec)

Quando o usuario escolheu Spec no INIT, este estagio **substitui o PRD base** acionando os comandos `openspec-*` (nunca escrevendo os arquivos manualmente):

1. Confirme que os comandos `openspec-*` estao disponiveis. Se nao estiverem, pergunte via `AskUserQuestion` se deve cair para o modo PRD ou abortar — nao monte a estrutura manualmente nem siga como Claude direto.
2. Crie e monte o change set: `/openspec-new-change <nome>` seguido de `/openspec-ff-change <nome>` (gera `proposal.md`, `design.md`, `tasks.md` e `specs/` de uma vez) em `openspec/changes/<nome>/`. Use `openspecChangeName(featurePath)` como `<nome>`.
3. Alimente os comandos com a demanda e o `<featurePath>/codebase-memory.md`; o que nao for inferivel fica como `"TBD"`.
4. Todas as etapas seguintes (`ARCH`, `EXPAND`, `COMPLEXITY`, `BRAINSTORM_GERAL`, `CODEX`, `AGY`, `FINAL`) passam a raciocinar sobre a **spec** em vez do PRD, refinando os artefatos do change set.

O prefixo legado `/opsx:*` esta descontinuado. Detalhes do fluxo e do handoff em `references/openspec.md`.

**Gate:** no modo PRD, todas as secoes do PRD Base preenchidas ou `"TBD"`; no modo Spec, change set OpenSpec criado pelos comandos `openspec-*` (ou fallback para PRD/abortar registrado). Sem perguntas ao usuario alem do fallback.

---

## ARCH

**Objetivo:** entender a arquitetura antes de expandir requisitos.

Projeto existente:

- Reaproveite o indice do Code Base Memory criado no EXPLORE: `get_architecture` para o panorama, `search_graph`/`trace_path` para mapear os simbolos e fluxos afetados pela demanda, e `detect_changes` quando for um fix.
- Complemente com `Read`, `Glob` e `Grep` para detalhes que o grafo nao cobrir (config, padroes locais, persistencia, UI).
- Nao execute alteracoes no codigo.
- Registre achados, incertezas e sinais `hasBackend`, `hasFrontend`, `isGreenfield = false`.
- **Derive `uiPackageDir`** quando `hasFrontend`: inspecione se o repo e um monorepo (`pnpm-workspace.yaml`, `packages/` ou `apps/` presentes) ou um app unico. Use `resolveUiPackageDir({ isMonorepo, framework })` do engine como base (`packages/ui` para monorepo; `src/styles` para app unico Next.js/Vite/Remix). Se ambiguo, pergunte via `AskUserQuestion` onde gravar os arquivos do design system. Grave a resposta em `state.uiPackageDir` — o FINAL usa esse valor ao rodar `od-fetch-system.mjs`.

Greenfield:

- Quando nao houver base de codigo relevante, marque `isGreenfield = true`.
- Entreviste o usuario via `AskUserQuestion` sobre stack desejada, canais de entrega, persistencia, integracoes e restricoes tecnicas.

Saida obrigatoria:

- Grave `<featurePath>/architecture.md`.
- Inclua resumo da arquitetura, dominios detectados, decisoes conhecidas, lacunas tecnicas e sinais para `detectComplexity()`.

**Gate:** `architecture.md` gravado e perguntas greenfield respondidas ou diferidas.

---

## EXPAND

**Objetivo:** ampliar a demanda com requisitos candidatos nao previstos no enunciado.

1. Revise o `PRD_Base`, `architecture.md`, secoes `"TBD"`, funcionalidades implicitas, fluxos alternativos, integracoes, seguranca, erros, desempenho, acessibilidade, persistencia e mobile.
2. Converta candidatos importantes em perguntas com `origin = 'pensador'`, `stage = 'EXPAND'`.
3. Apresente via `AskUserQuestion`, agrupando apenas perguntas relacionadas de mesma origem e estagio.

**Gate:** todas as perguntas de EXPAND respondidas ou diferidas.

---

## COMPLEXITY

**Objetivo:** sugerir a profundidade do fluxo antes do BRAINSTORM_GERAL.

Execute `detectComplexity()` com estes sinais:

- `domainCount`: numero de dominios funcionais/tecnicos distintos detectados.
- `hasBackend`: verdadeiro quando ha API, dados, auth, integracoes, jobs, contratos ou servidor.
- `hasBroadScopeKeywords`: verdadeiro quando a demanda indica escopo amplo, plataforma, multiusuario, automacao complexa, dashboard amplo, pagamentos, compliance ou multiplas areas.
- `isGreenfield`: verdadeiro quando ARCH nao encontrou base existente relevante.

Sugestao:

- **Lite**: escopo pequeno, poucos dominios, sem back-end relevante ou baixo risco.
- **Completo**: backend, multiplos dominios, greenfield amplo, integracoes, riscos de produto ou termos amplos.

Pergunte via `AskUserQuestion` se o usuario aceita a sugestao. Inclua opcao recomendada, preview do impacto e profundidade por dominio.

**Gate:** modo `Lite` ou `Completo` escolhido e registrado.

---

## BRAINSTORM_GERAL

**Objetivo:** substituir CLARITY/BACKEND/UIUX/FRONTEND por uma orquestracao unica de lentes e agentes.

Entradas:

- Demanda.
- `PRD_Base`.
- `<featurePath>/architecture.md`.
- Respostas consolidadas de EXPAND.
- Modo Lite/Completo.

Antes de delegar, grave `<featurePath>/shared-agents/context-pack.md` com contexto suficiente para todos os participantes.

Roteamento padrao:

- `requirements-clarity`: sempre aplicavel como lente de clareza.
- Codex com effort `high`: adicional no BRAINSTORM_GERAL quando `hasBackend = true`.
- AGY com modelo `gemini-3.1-pro-high`: adicional no BRAINSTORM_GERAL quando `hasFrontend = true`.
- **Open Design (lente de design, quando `hasFrontend = true`):** alem das perguntas de UX, o Pensador parseia o **brief de design** via `AskUserQuestion` (tom visual, marca/referencias, paleta, tipografia, estados de componente, responsividade, acessibilidade, microcopy — `openDesignBriefPlan()`). Cada resposta tem um destino estruturado no Open Design (`openDesignBriefRouting()`): `selection` (escolhe/importa o system), `input` (conteudo/componentes), `parameter` (estilizacao: hue/spacing/opacity), `constraint` (gate WCAG — enforced no review do modo Spec; documentado em PRD mode). Apos coletar o brief, **liste os candidates** via `od design-systems list --json` (ou `GET /api/design-systems`) e apresente os top-3 matches ao usuario via `AskUserQuestion` com preview do `visualTone` de cada um (inclua o system recomendado como primeira opcao). Somente apos confirmacao do usuario **grave os id(s) validados em `state.designSystems` (array de strings)** — ids nao confirmados causam exit 5 no FINAL. `buildArtifactList` le esse campo para emitir os artefatos `design-system-files` no handoff; sem ele o role `design-system-files` nao e gerado e o Orquestrador nao acha os arquivos verbatim. **Se `brandReferences` citar uma marca/repo real**, rode `od design-systems import-github <url>` (async: aguarde confirmacao do daemon antes de gravar o slug em `state.designSystems`). O download e a consolidacao acontecem no FINAL. Se o Open Design nao for detectado, ofereca instalacao via `AskUserQuestion` (igual ao Code Base Memory) ou caia para um `design-system.md` inline. Veja `references/open-design.md`.

Contrato:

- Cada participante grava resposta em `shared-agents/*.response.md`.
- `shared-agents/agent.response.md` consolida pontos recebidos, autoria, dominio, severidade e perguntas candidatas.
- O Pensador deduplica perguntas ja respondidas, agrupa por dominio e apresenta via `AskUserQuestion`.
- Fallback e por dominio: se uma lente/agente falhar, pergunte se deve seguir sem aquele dominio, retentar ou registrar lacunas como `"TBD"`.

**Gate:** `agent.response.md` produzido ou fallback registrado para dominios indisponiveis; todas as perguntas do BRAINSTORM_GERAL respondidas ou diferidas.

---

## CODEX

**Objetivo:** refinamento tecnico final apos o BRAINSTORM_GERAL.

Subagente: `codex:codex-rescue`.

Parametro efetivo: `effort high`, comunicado no corpo do prompt.

**Participacao do Codex:** o Codex nao participa quando a atividade e especifica de front-end, ou seja, `hasFrontend = true` e `hasBackend = false` (`codexParticipates(state) = false`). Nesse caso o estagio ainda e visitado, mas nao delega ao Codex: registra zero perguntas, sem fallback, e avanca automaticamente. O mesmo criterio ja vale no BRAINSTORM_GERAL, onde o dominio de backend so aciona o Codex quando `hasBackend = true`. Quando `hasBackend = true` (back-end ou fullstack), o Codex roda normalmente.

Entrada minima:

```text
Analise os requisitos abaixo e identifique lacunas tecnicas, funcionalidades nao previstas,
inconsistencias ou riscos. Use effort: high. Retorne uma lista de pontos em aberto.

Demanda: <demanda>
PRD Base: <PRD_Base>
Arquitetura: <architecture.md>
Requisitos consolidados: <EXPAND + BRAINSTORM_GERAL>
```

Para cada ponto relevante, crie pergunta com `origin = 'codex'`, `stage = 'CODEX'` e apresente via `AskUserQuestion`.

**Gate:** atividade especifica de front-end registra zero perguntas e avanca; caso contrario, todas as perguntas de CODEX, incluindo fallback, respondidas ou diferidas.

---

## AGY

**Objetivo:** varredura final de produto.

Subagente: `cc-antigravity-plugin:antigravity-agent`.

Modelo: `gemini-3.1-pro-high`, comunicado no corpo do prompt.

Entrada minima:

```text
Levante lacunas remanescentes, cenarios de uso nao cobertos e riscos de produto.
Use model: gemini-3.1-pro-high. Retorne perguntas abertas para o usuario.

Demanda: <demanda>
PRD Base: <PRD_Base>
Arquitetura: <architecture.md>
Requisitos consolidados: <EXPAND + BRAINSTORM_GERAL + CODEX>
```

Para cada pergunta relevante, use `origin = 'agy'`, `stage = 'AGY'` e `AskUserQuestion`.

**Gate:** todas as perguntas de AGY, incluindo fallback, respondidas ou diferidas.

---

## FINAL

**Objetivo:** consolidar e gerar artefatos.

1. Aplique `withConsolidated(state)`.
2. Confirme com o usuario via `AskUserQuestion` se ha back-end/API/contrato de comunicacao. Mostre a heuristica como sugestao e deixe a resposta do usuario prevalecer.
3. Planeje artefatos conforme `artifactMode`:
   - Modo PRD: `prd.md` e `userhistory.md` sempre; `comunication_json.md` quando ha back-end; `design-system.md` quando ha front-end (`hasFrontend`), todos em `<featurePath>/`.
   - Modo Spec (OpenSpec): o change set em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`); `userhistory.md` e `comunication_json.md` nao se aplicam. **Excecao — Open Design continua valendo quando `hasFrontend`:** nao gera `design-system.md` standalone, mas roda do mesmo jeito (arquivos verbatim no repo + decisoes no `design.md` + capability `specs/ui-design-system/`). Ver passo 5.
   - Em **ambos** os modos, quando `hasFrontend`, os arquivos verbatim do Open Design vao para `packages/ui/design-systems/<id>/` (passo 5).
4. Antes de sobrescrever artefatos existentes, confirme via `AskUserQuestion`.
5. Gere os artefatos:
   - **Design system (Open Design), quando `hasFrontend` — nos DOIS modos):** o Open Design e um **pipeline de arquivos**, nao prosa. NUNCA puxe so o `DESIGN.md` para re-escrever. Para cada system escolhido no BRAINSTORM_GERAL, **baixe e persista os arquivos verbatim** rodando:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/od-fetch-system.mjs" --id <id>[,<id>] --repo <repoRoot> --ui-dir <packages/ui> [--token $OD_API_TOKEN]
     ```

     Isso grava `tokens.css` (fonte de verdade), `components.html`, `USAGE.md`, `DESIGN.md`, `preview/` em `<ui-dir>/design-systems/<id>/` (ver `openDesignFetchPlan()`). Se o script sair com erro (sem clone e sem REST), avise via `AskUserQuestion` e so entao caia para um `design-system.md` inline. Depois derive o `tokens.css` do projeto por composicao rastreavel dos systems (nunca um objeto JS a mao) e faca o `theme.ts` ler `var(--*)`.
   - **Modo PRD:** o `design-system.md` vira **documento de decisoes** (selecao do system, merge, overrides justificados) que **referencia** os arquivos verbatim — nao duplica tokens. Os demais artefatos saem dos templates.
   - **Modo Spec:** dobre o design no change set (`openDesignDeliveryFor('spec', <nome>)`): decisoes na secao *Decisions* do `design.md`; requisitos de UI na capability delta-spec `specs/ui-design-system/spec.md` (requisitos `SHALL` + cenarios `#### Scenario:`). Os arquivos verbatim continuam indo para `packages/ui/design-systems/<id>/`. Finalize o change set e rode `/openspec-verify-change <nome>` (e `/openspec-sync-specs <nome>` se introduziu/ajustou specs).
   - Detalhes e regra inviolavel ("never invent new tokens") em `references/open-design.md`.
   - **Handoff:** registre no `handoff.json` o(s) `<id>` concreto(s) escolhido(s) e o diretorio verbatim como role `design-system-files` (`packages/ui/design-systems/<id>/`, uma entrada por id) — alem do role `design-system` (o `design-system.md`). Isso e o que `buildArtifactList` emite quando `state.designSystems` esta preenchido; sem isso o consumidor (orquestrador) teria de parsear a prosa para achar os arquivos. Ver `references/handoff-contract.md`.
6. Apresente recap final: decisoes principais, perguntas diferidas, dominios cobertos, caminhos gerados e proximos passos de handoff. No modo Spec, oriente o handoff com `/openspec-apply-change`, `/openspec-sync-specs` e `/openspec-archive-change` (este ultimo move pastas: so apos confirmacao do usuario).

**Gate:** artefatos aplicaveis gerados, `handoff.json` gravado, caminhos reportados e recap/handoff apresentados.

---

## DONE

Estado terminal. O fluxo esta encerrado.

---

## Resumo dos gates

| Estagio | Gate de avanco |
|---|---|
| `INIT` | Demanda presente, modo de execucao resolvido, `artifactMode` definido, `featurePath` definido e retomada/novo fluxo decididos |
| `EXPLORE` | `codebase-memory.md` gravado (exploracao do Code Base Memory ou fallback registrado) |
| `PRD_BASE` | Modo PRD: PRD Base completo; modo Spec: change set OpenSpec criado pelos comandos `openspec-*` (ou fallback registrado) |
| `ARCH` | `architecture.md` gravado e perguntas greenfield fechadas |
| `EXPAND` | Todas as perguntas respondidas ou diferidas |
| `COMPLEXITY` | Modo Lite/Completo escolhido |
| `BRAINSTORM_GERAL` | `agent.response.md` ou fallback por dominio; perguntas fechadas |
| `CODEX` | Front-end especifico: zero perguntas e avanco; caso contrario, todas respondidas ou diferidas |
| `AGY` | Todas as perguntas respondidas ou diferidas |
| `FINAL` | Artefatos gerados, caminhos reportados e recap/handoff entregues |
| `DONE` | Terminal |

## Delegacao v2

| Estagio | Tipo | Alvo | Condicao | Saida |
|---|---|---|---|---|
| `BRAINSTORM_GERAL` | skill | `requirements-clarity` | sempre | `shared-agents/requirements-clarity.response.md` |
| `BRAINSTORM_GERAL` | subagente | `codex:codex-rescue` | `hasBackend` | `shared-agents/codex.response.md` |
| `BRAINSTORM_GERAL` | subagente | `cc-antigravity-plugin:antigravity-agent` | `hasFrontend` | `shared-agents/agy.response.md` |
| `BRAINSTORM_GERAL`/`FINAL` | MCP/CLI | Open Design (`od`) | `hasFrontend` | `design-system.md` (brief parseado; fallback inline) |
| `CODEX` | subagente | `codex:codex-rescue` | nao especifico de front-end (`hasBackend` ou nao `hasFrontend`) | perguntas tecnicas finais |
| `AGY` | subagente | `cc-antigravity-plugin:antigravity-agent` | sempre | perguntas de produto finais |
