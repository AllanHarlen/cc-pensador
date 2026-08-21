---
description: Conduz o Pensador v2 em doze estagios, com exploracao via Code Base Memory, pesquisa web/benchmark de mercado, arquitetura, expansao, complexidade, brainstorm geral por dominio, Codex, AGY e artefatos isolados por feature (PRD ou specs OpenSpec). Suporta --modo claude|agy|kiro|codex para delegar o trabalho pesado a uma CLI externa.
argument-hint: "[--modo claude|agy|kiro|codex] [--model <id>] [--effort <nivel>] <demanda em linguagem natural - ex.: 'Crie uma tela de login para os usuarios'>"
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Bash(node:*), Bash(openspec:*), AskUserQuestion, Agent, Skill, SlashCommand, mcp__codebase-memory-mcp
---

# /pensador

Inicia o **Pensador v2** para a demanda em `$ARGUMENTS`. O fluxo cobre doze estagios:

1. **INIT** - Demanda, checkpoint v2, `allocateFeatureDir()` e (se OpenSpec detectado) escolha PRD vs Spec.
2. **EXPLORE** - Exploracao do projeto com Code Base Memory (`codebase-memory-mcp`); grava `codebase-memory.md`. Se o servidor nao for detectado, pergunta via `AskUserQuestion` se o usuario quer instalar (Claude executa o instalador e retoma) ou seguir com `Read`/`Glob`/`Grep`.
3. **RESEARCH** - Pesquisa web em dois tracks. `business`: coleta `sectorContext`, confirma o arquetipo (`detectProductArchetype`), roda `marketResearchQueryPlan` via `WebSearch`/`WebFetch`, levanta o que os concorrentes entregam, classifica por `FEATURE_TIERS` e grava `market-research.md`. `technical`: detecta a stack (`detectTechStack`), fecha lacunas (`inferStackGaps`), roda `techResearchQueryPlan` (versao atual obrigatoria + padroes/arquitetura/convencoes + integracao front/back), classifica adocao (`classifyPatternAdoption`) e grava `tech-research.md`. Os dois alimentam o Prompt System reaproveitado nos estagios seguintes.
4. **PRD_BASE** - Geracao do PRD Base pela `Skill_PRD_Base` (ou change set OpenSpec via comandos `openspec-*` no modo Spec).
5. **ARCH** - Analise do projeto (reaproveita o indice do Code Base Memory + `Read`/`Glob`/`Grep`); em greenfield, entrevista o usuario; executa o **top-up** do track tecnico quando ele ficou `DEFERRED`; grava `architecture.md` com o baseline tecnico pesquisado.
6. **EXPAND** - Ampliacao da demanda com requisitos candidatos.
7. **COMPLEXITY** - `detectComplexity()` com `domainCount`, `hasBackend`, `hasBroadScopeKeywords` e `isGreenfield`; sugere Lite ou Completo.
8. **BRAINSTORM_GERAL** - Orquestracao por dominio com lentes primarias (skills deterministas) + refino: `requirements-clarity` (sempre); `backend-development` primaria + Codex `effort high` (refino) se `hasBackend`; `ui-ux-pro-max` + `frontend-design` primarias + AGY `gemini-3.1-pro-high` (refino) e Open Design (brief de design -> arquivos verbatim) se `hasFrontend`; usa `shared-agents/context-pack.md` e `agent.response.md`.
9. **CODEX** - Refinamento tecnico final com `codex:codex-rescue`; nao participa em atividade especifica de front-end (`hasFrontend` sem `hasBackend`).
10. **AGY** - Lacunas finais de produto com `cc-antigravity-plugin:antigravity-agent`.
11. **FINAL** - Consolidacao, artefatos, recap final e handoff.
12. **DONE** - Estado terminal.

`STAGE_ORDER` v2:

```text
INIT -> EXPLORE -> RESEARCH -> PRD_BASE -> ARCH -> EXPAND -> COMPLEXITY -> BRAINSTORM_GERAL -> CODEX -> AGY -> FINAL -> DONE
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
- `integrations.webResearch` (obrigatorio, descritivo): contrato do estagio RESEARCH nos dois tracks — ferramentas (`WebSearch`/`WebFetch`), orcamento de consultas de negocio e tecnico, tiers de fonte, regras de conformidade e fallback. `probeable: false` porque sao ferramentas nativas do Claude Code, cuja disponibilidade so se observa em runtime.
- `integrations.openspec` (opcional): se detectado, o INIT deve oferecer PRD vs Spec.
- `integrations.openDesign` (opcional, condicional a front-end): se a demanda tiver front-end e o Open Design (`od`) nao for detectado, ofereca instalacao via `AskUserQuestion` rodando o script `scripts/install-open-design.ps1` (Windows) ou `scripts/install-open-design.sh` (macOS/Linux), que sobe o Open Design via Docker e conecta o MCP; ou caia para `design-system.md` inline. Com o Open Design no ar, puxe o DESIGN.md via `od design-systems list/show` (ou pela API do daemon, no modo Docker). Veja `skills/pensador/references/open-design.md`.

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

### Passo 3.2 - RESEARCH (dois tracks)

**Track `business` — mercado (obrigatorio quando a demanda tem superficie de produto):**

- Colete `sectorContext` via `AskUserQuestion`, confirme o arquetipo sugerido por `detectProductArchetype()`, decida profundidade com `researchRelevance()` e execute `marketResearchQueryPlan()` com `WebSearch` (+ `WebFetch` nos resultados que valem leitura profunda, respeitando `WEB_RESEARCH.budget`).
- Classifique cada funcionalidade com `classifyFeatureTier()` e transforme as `table-stakes` ausentes da demanda em perguntas `origin = 'web-research'` via `AskUserQuestion`.
- Grave `<featurePath>/market-research.md`. Veja `skills/pensador/references/web-research.md`.

**Track `technical` — stack (obrigatorio quando ha stack detectada, greenfield ou impacto de arquitetura):**

- Detecte a stack com `detectTechStack(demanda + codebase-memory.md)` e feche as lacunas com `inferStackGaps()` **antes** de pesquisar: "back-end com C#" nao diz ASP.NET Core, "tela de login" nao diz a abordagem de auth. Cada lacuna vira `AskUserQuestion` com candidatos.
- Decida com `techResearchRelevance()`. Sem stack detectavel, marque `status: DEFERRED` — o ARCH resolve a stack e roda o top-up.
- Execute `techResearchQueryPlan()`: `version-currency` obrigatoria primeiro (a fase que neutraliza o corte de treinamento), depois `stack-patterns` em round-robin, depois os cross-cutting reservados (`integration-contract`, `auth-flow`, `project-conventions`).
- Classifique cada padrao com `classifyPatternAdoption()`. So `current` (e `experimental` consciente) vira decisao de PRD; `deprecated` vai para anti-padroes com o substituto.
- Fontes: `official-docs` > `release-notes` > `reputable-guide` > `community` (`requiresOfficialSource: true`).
- Grave `<featurePath>/tech-research.md`. Veja `skills/pensador/references/tech-research.md`.

**Comum aos dois:**

- Grave o Prompt System (`buildResearchPromptSystem()`), que passa a ser injetado em todos os prompts seguintes — inclusive nos delegados em `--modo agy|kiro|codex`. Injete apenas o grupo pertinente (`PROMPT_SYSTEM_SECTION_GROUPS.business` / `.technical`).
- Conformidade obrigatoria: cite a URL de todo achado, no maximo 30 palavras consecutivas por fonte, parafraseie e nunca copie assets/textos/codigo de terceiros.

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
  market-research.md
  tech-research.md
  handoff.json
  architecture.md
  shared-agents/
  prd.md
  userhistory.md
  openapi.yaml
  communication.md
  design-system.md
```

> `openapi.yaml` e o exemplo REST do **contrato maquina-legivel** (fonte da verdade); conforme `state.apiStyle` pode ser `schema.graphql`, `service.proto` ou `asyncapi.yaml`. O `communication.md` e a visao legivel derivada dele.
> No modo Spec (OpenSpec), o entregavel e o change set em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`), criado pelos comandos `openspec-*`; `prd.md`, `userhistory.md`, contrato maquina-legivel standalone, `communication.md` e `design-system.md` nao se aplicam.

No estagio FINAL, grave tambem o manifesto de handoff `handoff.json` na raiz de `<featurePath>/`, conforme `skills/pensador/references/handoff-contract.md`. Ele e a ancora de descoberta que o `/cc-orchestrador-subagents:orchestrador` usa para ingerir o PRD/Spec. Liste em `artifacts[]` cada arquivo final gerado com seu `role` (`prd`, `userhistory`, `architecture`, `api-contract`, `communication-contract`, `design-system`, `design-system-files`, `codebase-memory`, `shared-agents`) e marque `status: "DONE"` apenas quando todos os gates fecharem.

### Passo 5 - Reportar ao usuario

Ao concluir FINAL, informe:

- Caminho de `prd.md` (modo PRD) ou do change set `openspec/changes/<nome>/` (modo Spec).
- Caminho de `userhistory.md` (modo PRD).
- Caminho do contrato maquina-legivel (`openapi.yaml`/`schema.graphql`/`service.proto`/`asyncapi.yaml`) e de `communication.md` (visao derivada), se houver back-end confirmado (modo PRD).
- Caminho dos arquivos do design system, se houver front-end (modo PRD): quando o Open Design foi usado, `design-systems/<id>/` (arquivos verbatim, incl. `DESIGN.md`); no fallback (sem Open Design), o `design-system.md` inline.
- Caminho de `codebase-memory.md`, `market-research.md`, `tech-research.md` e `architecture.md`.
- Caminho de `shared-agents/agent.response.md`.
- Recap final e handoff. No modo Spec, oriente `openspec validate <nome> --strict --json`, `/opsx:apply`, `/opsx:sync` e `openspec archive <nome> --json --yes`.
- Caminho de `handoff.json` (manifesto de handoff para o Orchestrador).
- Recap final e handoff: informe que o proximo passo e `/cc-orchestrador-subagents:orchestrador implemente o plano destacado`, que ira ingerir `handoff.json`.

---

## Arquivos de referencia

| Arquivo | Proposito |
|---|---|
| `skills/pensador/SKILL.md` | Skill principal do Pensador v2 |
| `skills/prd/SKILL.md` | Skill_PRD_Base: schema e entrevista de descoberta |
| `skills/pensador/references/stages.md` | Definicao detalhada dos doze estagios |
| `skills/pensador/references/feature-isolation.md` | Isolamento `.pensador/<slug-da-demanda>-vN/`, `allocateFeatureDir()`, checkpoint e `shared-agents/` |
| `skills/pensador/references/skill-stack.md` | Skills como lentes de dominio do BRAINSTORM_GERAL |
| `skills/pensador/references/agent-stack.md` | Codex/AGY/Kiro, roteamento por dominio, motores de execucao e contrato `shared-agents/` |
| `skills/pensador/references/execution-modes.md` | Modos de execucao `--modo` (claude/agy/kiro/codex), parsing, preflight e contrato de delegacao |
| `skills/pensador/references/codebase-memory.md` | Code Base Memory (MCP) obrigatorio: exploracao do projeto antes do PRD/Spec |
| `skills/pensador/references/web-research.md` | RESEARCH, track de negocio: arquetipos, plano de consultas, tiers de funcionalidade e Prompt System |
| `skills/pensador/references/tech-research.md` | RESEARCH, track tecnico: deteccao de stack, lacunas, versao atual, padroes/arquitetura/convencoes e anti-padroes |
| `skills/pensador/references/open-design.md` | Open Design (MCP/CLI) opcional: brief de design e geracao de `design-system.md` quando ha front-end |
| `skills/pensador/references/openspec.md` | OpenSpec opcional: escolha PRD vs Spec no INIT e montagem de specs |
| `skills/pensador/references/handoff-contract.md` | Contrato de handoff Pensador→Orchestrador→Executor: `handoff.json`, raizes `.pensador/.orchestration/.executor`, correlacao por slug |
| `skills/pensador/references/askuserquestion-protocol.md` | AskUserQuestion, opcoes recomendadas, previews, recap final e handoff |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex, AGY, Kiro, motor de execucao, Code Base Memory, OpenSpec e Open Design |
| `scripts/install-open-design.ps1` / `scripts/install-open-design.sh` | Instalador opcional do Open Design via Docker (verifica git+docker, sobe o daemon, conecta o MCP), oferecido via `AskUserQuestion` quando ha front-end |
| `scripts/od-mcp-config.mjs` | Helper que busca `/api/mcp/install-info` do daemon e faz merge da entrada `mcpServers.<nome>` no `.mcp.json` (usado pelo instalador no modo Docker, sem `od` no host) |
| `scripts/pensador-engine.mjs` | Especificacao deterministica de referencia, nao importada em runtime pela skill |

---

## Quando invocado sem argumento

Se `$ARGUMENTS` estiver vazio, solicite a demanda via `AskUserQuestion`. Nunca inicie `PRD_BASE` sem demanda presente e nao vazia.
