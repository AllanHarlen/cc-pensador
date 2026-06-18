---
description: Conduz o Pensador v2 em onze estagios, com exploracao via Code Base Memory, arquitetura, expansao, complexidade, brainstorm geral por dominio, Codex, AGY e artefatos isolados por feature (PRD ou specs OpenSpec). Suporta --modo claude|agy|kiro|codex para delegar o trabalho pesado a uma CLI externa.
argument-hint: "[--modo claude|agy|kiro|codex] [--model <id>] [--effort <nivel>] <demanda em linguagem natural - ex.: 'Crie uma tela de login para os usuarios'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), Bash(openspec:*), AskUserQuestion, Agent, Skill, SlashCommand, mcp__codebase-memory-mcp
---

# /pensador

Inicia o **Pensador v2** para a demanda em `$ARGUMENTS`. O fluxo cobre onze estagios:

1. **INIT** - Demanda, checkpoint v2, `allocateFeatureDir()` e (se OpenSpec detectado) escolha PRD vs Spec.
2. **EXPLORE** - Exploracao do projeto com Code Base Memory (`codebase-memory-mcp`); grava `codebase-memory.md`. Se o servidor nao for detectado, pergunta via `AskUserQuestion` se o usuario quer instalar (Claude executa o instalador e retoma) ou seguir com `Read`/`Glob`/`Grep`.
3. **PRD_BASE** - Geracao do PRD Base pela `Skill_PRD_Base` (ou change set OpenSpec via comandos `openspec-*` no modo Spec).
4. **ARCH** - Analise do projeto (reaproveita o indice do Code Base Memory + `Read`/`Glob`/`Grep`); em greenfield, entrevista o usuario; grava `architecture.md`.
5. **EXPAND** - Ampliacao da demanda com requisitos candidatos.
6. **COMPLEXITY** - `detectComplexity()` com `domainCount`, `hasBackend`, `hasBroadScopeKeywords` e `isGreenfield`; sugere Lite ou Completo.
7. **BRAINSTORM_GERAL** - Orquestracao por dominio: `requirements-clarity`, Codex `effort high` se `hasBackend`, AGY `gemini-3.1-pro-high` se `hasFrontend`; usa `shared-agents/context-pack.md` e `agent.response.md`.
8. **CODEX** - Refinamento tecnico final com `codex:codex-rescue`; nao participa em atividade especifica de front-end (`hasFrontend` sem `hasBackend`).
9. **AGY** - Lacunas finais de produto com `cc-antigravity-plugin:antigravity-agent`.
10. **FINAL** - Consolidacao, artefatos, recap final e handoff.
11. **DONE** - Estado terminal.

`STAGE_ORDER` v2:

```text
INIT -> EXPLORE -> PRD_BASE -> ARCH -> EXPAND -> COMPLEXITY -> BRAINSTORM_GERAL -> CODEX -> AGY -> FINAL -> DONE
```

Os antigos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` nao sao mais estagios autonomos; eles viraram lentes de dominio dentro de `BRAINSTORM_GERAL`.

**Regra central:** todo dialogo com o usuario usa exclusivamente `AskUserQuestion`.

**Modo de execucao (`--modo`):** define qual motor executa o trabalho pesado do fluxo. `claude` (padrao) roda nos tokens do Claude Code; `agy`/`kiro`/`codex` delegam cada unidade de trabalho para a CLI externa via slash command, mantendo o Claude apenas como orquestrador restrito a `AskUserQuestion`. Veja `skills/pensador/references/execution-modes.md`.

| Modo | Slash command | Parametro padrao |
|---|---|---|
| `--modo claude` (padrao) | — | — |
| `--modo agy` | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `--modo kiro` | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `--modo codex` | `/codex:rescue` | `--effort high` |

---

## Comportamento

### Passo 0 - Parsear argumentos

Execute `parseExecutionMode($ARGUMENTS)` (definido em `pensador-engine.mjs`) para separar:

- `mode`: `claude` (padrao), `agy`, `kiro` ou `codex`. Valor desconhecido cai para `claude` com `modeValid = false`.
- `modelOverride` / `effortOverride`: sobrescritas opcionais de `--model` / `--effort`.
- `demanda`: o texto restante.

Se `modeValid = false`, avise via `AskUserQuestion` antes de seguir em `claude`.

### Passo 1 - Preflight

Execute o preflight informando o modo escolhido para verificar disponibilidade dos subagentes e do motor de execucao:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs" --modo <modo>
```

Parse o JSON retornado e registre o status:

- `status: "ok"` - subagentes e motor disponiveis.
- `status: "partial"` - prossiga e aplique fallback nos dominios/estagios afetados; se o motor do `--modo` estiver indisponivel (`executionMode.available = false`), pergunte via `AskUserQuestion` se deve cair para `--modo claude` ou abortar.
- `status: "unavailable"` - informe a indisponibilidade e use fallback em CODEX/AGY e no motor de execucao quando necessario.

Leia tambem o bloco `integrations`:

- `integrations.codebaseMemory` (obrigatorio): disponibilidade do MCP `codebase-memory-mcp` para a exploracao pre-PRD/Spec.
- `integrations.openspec` (opcional): se detectado, o INIT deve oferecer PRD vs Spec.

Se o preflight falhar, nao aborte. Trate como `partial`.

### Passo 2 - Carregar Pensador

```text
Skill(skill="cc-pensador:pensador")
```

A skill define gates, checkpoint v2, isolamento por atualizacao, delegacao e fallback.

### Passo 3 - INIT

- Use o `mode` e a `demanda` ja parseados no Passo 0; registre o modo de execucao no estado.
- Verifique checkpoints v2 em `.pensador/<slug-da-demanda>-vN/.pensador-progress.json`.
- Se houver checkpoint valido, pergunte via `AskUserQuestion` se deve retomar ou iniciar nova atualizacao.
- Se houver checkpoint v1 em `pensador-output/.pensador-progress.json`, trate como incompativel e recomende iniciar v2 novo.
- Para novo fluxo, use `allocateFeatureDir()` e registre `featurePath`.
- Se a demanda estiver vazia, solicite-a via `AskUserQuestion`.
- **OpenSpec (opcional):** se `integrations.openspec.available = true`, pergunte via `AskUserQuestion` se o usuario quer **PRD** (padrao) ou **Spec** (OpenSpec); registre `artifactMode` com `withArtifactMode()`. Veja `skills/pensador/references/openspec.md`.

### Passo 3.1 - EXPLORE

- **Code Base Memory (obrigatorio):** antes do `PRD_BASE`/Spec, explore o projeto via MCP `codebase-memory-mcp` (`index_repository → get_architecture → get_graph_schema → search_graph → trace_path`, mais `detect_changes` em fixes) e grave `<featurePath>/codebase-memory.md`. Indisponivel: pergunte via `AskUserQuestion` se deve instalar ou cair para `Read`/`Glob`/`Grep`. Veja `skills/pensador/references/codebase-memory.md`.

### Passo 4 - Executar os estagios

Siga a ordem v2 definida em `skills/pensador/SKILL.md` e `skills/pensador/references/stages.md`.

Quando o modo de execucao for `agy`, `kiro` ou `codex`, **delegue o trabalho pesado de cada estagio** ao motor via `SlashCommand`, usando o invocacao construida por `buildDelegationInvocation()`:

```text
/cc-antigravity-plugin:antigravity --model claude-4.6-opus-thinking "<PromptSystem>"
/cc-kiro-plugin:kiro --model claude-opus-4.8 --effort high "<PromptSystem>"
/codex:rescue --effort high "<PromptSystem>"
```

O Claude apenas orquestra: le os rascunhos do motor, consolida no estado/artefatos e faz toda decisao que exige o usuario via `AskUserQuestion`. Em `--modo claude`, redija inline. Detalhes em `skills/pensador/references/execution-modes.md`.

Artefatos e estado devem ficar sob:

```text
.pensador/<slug-da-demanda>-vN/
  .pensador-progress.json
  codebase-memory.md
  handoff.json
  architecture.md
  shared-agents/
  prd.md
  userhistory.md
  comunication_json.md
```

> No modo Spec (OpenSpec), o entregavel e o change set em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`), criado pelos comandos `openspec-*`; `prd.md`, `userhistory.md` e `comunication_json.md` nao se aplicam.

No estagio FINAL, grave tambem o manifesto de handoff `handoff.json` na raiz de `<featurePath>/`, conforme `skills/pensador/references/handoff-contract.md`. Ele e a ancora de descoberta que o `/cc-orchestrador-subagents:orchestrador` usa para ingerir o PRD/Spec. Liste em `artifacts[]` cada arquivo final gerado com seu `role` (`prd`, `userhistory`, `architecture`, `communication-contract`, `codebase-memory`, `shared-agents`) e marque `status: "DONE"` apenas quando todos os gates fecharem.

### Passo 5 - Reportar ao usuario

Ao concluir FINAL, informe:

- Caminho de `prd.md` (modo PRD) ou do change set `openspec/changes/<nome>/` (modo Spec).
- Caminho de `userhistory.md` (modo PRD).
- Caminho de `comunication_json.md`, se houver back-end confirmado (modo PRD).
- Caminho de `codebase-memory.md` e `architecture.md`.
- Caminho de `shared-agents/agent.response.md`.
- Recap final e handoff. No modo Spec, oriente `/openspec-verify-change`, `/openspec-apply-change`, `/openspec-sync-specs` e `/openspec-archive-change`.
- Caminho de `handoff.json` (manifesto de handoff para o Orchestrador).
- Recap final e handoff: informe que o proximo passo e `/cc-orchestrador-subagents:orchestrador implemente o plano destacado`, que ira ingerir `handoff.json`.

---

## Arquivos de referencia

| Arquivo | Proposito |
|---|---|
| `skills/pensador/SKILL.md` | Skill principal do Pensador v2 |
| `skills/prd/SKILL.md` | Skill_PRD_Base: schema e entrevista de descoberta |
| `skills/pensador/references/stages.md` | Definicao detalhada dos onze estagios |
| `skills/pensador/references/feature-isolation.md` | Isolamento `.pensador/<slug-da-demanda>-vN/`, `allocateFeatureDir()`, checkpoint e `shared-agents/` |
| `skills/pensador/references/skill-stack.md` | Skills como lentes de dominio do BRAINSTORM_GERAL |
| `skills/pensador/references/agent-stack.md` | Codex/AGY/Kiro, roteamento por dominio, motores de execucao e contrato `shared-agents/` |
| `skills/pensador/references/execution-modes.md` | Modos de execucao `--modo` (claude/agy/kiro/codex), parsing, preflight e contrato de delegacao |
| `skills/pensador/references/codebase-memory.md` | Code Base Memory (MCP) obrigatorio: exploracao do projeto antes do PRD/Spec |
| `skills/pensador/references/openspec.md` | OpenSpec opcional: escolha PRD vs Spec no INIT e montagem de specs |
| `skills/pensador/references/handoff-contract.md` | Contrato de handoff Pensador→Orchestrador→Executor: `handoff.json`, raizes `.pensador/.orchestration/.executor`, correlacao por slug |
| `skills/pensador/references/askuserquestion-protocol.md` | AskUserQuestion, opcoes recomendadas, previews, recap final e handoff |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex, AGY, Kiro, motor de execucao, Code Base Memory e OpenSpec |
| `scripts/pensador-engine.mjs` | Especificacao deterministica de referencia, nao importada em runtime pela skill |

---

## Quando invocado sem argumento

Se `$ARGUMENTS` estiver vazio, solicite a demanda via `AskUserQuestion`. Nunca inicie `PRD_BASE` sem demanda presente e nao vazia.
