---
description: Conduz o Pensador v2 em dez estagios, com arquitetura, expansao, complexidade, brainstorm geral por dominio, Codex, AGY e artefatos isolados por feature. Suporta --modo claude|agy|kiro|codex para delegar o trabalho pesado a uma CLI externa.
argument-hint: "[--modo claude|agy|kiro|codex] [--model <id>] [--effort <nivel>] <demanda em linguagem natural - ex.: 'Crie uma tela de login para os usuarios'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, Skill, SlashCommand
---

# /pensador

Inicia o **Pensador v2** para a demanda em `$ARGUMENTS`. O fluxo cobre dez estagios:

1. **INIT** - Demanda, checkpoint v2 e `allocateFeatureDir()`.
2. **PRD_BASE** - Geracao do PRD Base pela `Skill_PRD_Base`.
3. **ARCH** - Analise do projeto via `Read`/`Glob`/`Grep`; em greenfield, entrevista o usuario; grava `architecture.md`.
4. **EXPAND** - Ampliacao da demanda com requisitos candidatos.
5. **COMPLEXITY** - `detectComplexity()` com `domainCount`, `hasBackend`, `hasBroadScopeKeywords` e `isGreenfield`; sugere Lite ou Completo.
6. **BRAINSTORM_GERAL** - Orquestracao por dominio: `requirements-clarity`, Codex `effort high` se `hasBackend`, AGY `gemini-3.1-pro-high` se `hasFrontend`; usa `shared-agents/context-pack.md` e `agent.response.md`.
7. **CODEX** - Refinamento tecnico final com `codex:codex-rescue`; nao participa em atividade especifica de front-end (`hasFrontend` sem `hasBackend`).
8. **AGY** - Lacunas finais de produto com `cc-antigravity-plugin:antigravity-agent`.
9. **FINAL** - Consolidacao, artefatos, recap final e handoff.
10. **DONE** - Estado terminal.

`STAGE_ORDER` v2:

```text
INIT -> PRD_BASE -> ARCH -> EXPAND -> COMPLEXITY -> BRAINSTORM_GERAL -> CODEX -> AGY -> FINAL -> DONE
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
  handoff.json
  architecture.md
  shared-agents/
  prd.md
  userhistory.md
  comunication_json.md
```

No estagio FINAL, grave tambem o manifesto de handoff `handoff.json` na raiz de `<featurePath>/`, conforme `skills/pensador/references/handoff-contract.md`. Ele e a ancora de descoberta que o `/cc-orchestrador-subagents:orchestrador` usa para ingerir o PRD/Spec. Liste em `artifacts[]` cada arquivo final gerado com seu `role` (`prd`, `userhistory`, `architecture`, `communication-contract`, `codebase-memory`, `shared-agents`) e marque `status: "DONE"` apenas quando todos os gates fecharem.

### Passo 5 - Reportar ao usuario

Ao concluir FINAL, informe:

- Caminho de `prd.md`.
- Caminho de `userhistory.md`.
- Caminho de `comunication_json.md`, se houver back-end confirmado.
- Caminho de `architecture.md`.
- Caminho de `shared-agents/agent.response.md`.
- Caminho de `handoff.json` (manifesto de handoff para o Orchestrador).
- Recap final e handoff: informe que o proximo passo e `/cc-orchestrador-subagents:orchestrador implemente o plano destacado`, que ira ingerir `handoff.json`.

---

## Arquivos de referencia

| Arquivo | Proposito |
|---|---|
| `skills/pensador/SKILL.md` | Skill principal do Pensador v2 |
| `skills/prd/SKILL.md` | Skill_PRD_Base: schema e entrevista de descoberta |
| `skills/pensador/references/stages.md` | Definicao detalhada dos dez estagios |
| `skills/pensador/references/feature-isolation.md` | Isolamento `.pensador/<slug-da-demanda>-vN/`, `allocateFeatureDir()`, checkpoint e `shared-agents/` |
| `skills/pensador/references/skill-stack.md` | Skills como lentes de dominio do BRAINSTORM_GERAL |
| `skills/pensador/references/agent-stack.md` | Codex/AGY/Kiro, roteamento por dominio, motores de execucao e contrato `shared-agents/` |
| `skills/pensador/references/execution-modes.md` | Modos de execucao `--modo` (claude/agy/kiro/codex), parsing, preflight e contrato de delegacao |
| `skills/pensador/references/handoff-contract.md` | Contrato de handoff Pensador→Orchestrador→Executor: `handoff.json`, raizes `.pensador/.orchestration/.executor`, correlacao por slug |
| `skills/pensador/references/askuserquestion-protocol.md` | AskUserQuestion, opcoes recomendadas, previews, recap final e handoff |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex, AGY, Kiro e do motor de execucao escolhido |
| `scripts/pensador-engine.mjs` | Especificacao deterministica de referencia, nao importada em runtime pela skill |

---

## Quando invocado sem argumento

Se `$ARGUMENTS` estiver vazio, solicite a demanda via `AskUserQuestion`. Nunca inicie `PRD_BASE` sem demanda presente e nao vazia.
