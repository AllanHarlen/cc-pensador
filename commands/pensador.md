---
description: Conduz o Pensador v2 em doze estagios — exploracao do codebase, pesquisa de mercado e tecnica, arquitetura, complexidade e brainstorm por dominio — ate um PRD completo ou um change set OpenSpec, isolado por feature. Suporta --mode claude|agy|kiro|codex para delegar o trabalho pesado a uma CLI externa.
argument-hint: "help | preflight | status | resume [slug] | config | [--mode claude|agy|kiro|codex] [--model <id>] [--effort <nivel>] <demanda>"
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Bash(node:*), Bash(openspec:*), AskUserQuestion, Agent, Skill, SlashCommand, mcp__codebase-memory-mcp
---

# /pensador

Transforma uma demanda em linguagem natural num **PRD completo** (ou change set OpenSpec) pronto para implementacao, passando por exploracao do codebase, pesquisa de mercado e tecnica, arquitetura e brainstorm por dominio. O entregavel alimenta o `/orquestrador` via `handoff.json`.

**Regra central:** todo dialogo com o usuario usa exclusivamente `AskUserQuestion`.

## Sinopse

```text
/pensador <demanda>                 conduz os doze estagios ate o PRD/Spec
/pensador help                      esta ajuda
/pensador preflight                 valida subagentes, motor e integracoes
/pensador status                    estagio atual dos checkpoints em .pensador/
/pensador resume [slug]             retoma o checkpoint (sem slug, o mais recente)
/pensador config                    mostra motor resolvido e integracoes (read-only)

flags (antes da demanda, em qualquer ordem):
  --mode <claude|agy|kiro|codex>    motor que executa o trabalho pesado
  --model <id>                      sobrescreve o modelo do motor
  --effort <nivel>                  sobrescreve o esforco do motor
```

## Subcomandos reservados

Interceptam o argumento: se `$ARGUMENTS` comeca com um destes, a demanda **nao** e ingerida.

| Subcomando | O que faz | Executa |
|---|---|---|
| `help` | imprime a Sinopse acima e encerra | nada |
| `preflight` | valida subagentes, motor de execucao e integracoes | `scripts/preflight.mjs --mode <modo>` |
| `status` | lista os checkpoints em `.pensador/` com estagio atual, `artifactMode` e modo de execucao | le `.pensador/<slug>-vN/.pensador-progress.json` |
| `resume [slug]` | retoma o checkpoint direto, sem perguntar "novo ou retomar" | le o checkpoint e salta para o estagio gravado |
| `config` | mostra o motor/modelo/esforco resolvidos e o bloco `integrations` do preflight | `resolveExecutionMode()` + `scripts/preflight.mjs` |

> `config` aqui e **read-only**: o Pensador nao persiste configuracao propria. Quem grava a stack de agentes do projeto e `/orquestrador project-config`, em `.orchestrator/project-config.md`.

## Flags

| Flag | Valores | Default | Alias legado |
|---|---|---|---|
| `--mode <motor>` | `claude`, `agy`, `kiro`, `codex` | `claude` | `--modo` |
| `--model <id>` | id de modelo aceito pelo motor | default do motor (tabela abaixo) | — |
| `--effort <nivel>` | `low`, `medium`, `high`, `xhigh` | default do motor (tabela abaixo) | — |

O alias `--modo` continua aceito em silencio e produz exatamente o mesmo efeito. Valor de modo desconhecido cai para `claude` com `modeValid = false`.

**Modo de execucao (`--mode`):** define qual motor executa o trabalho pesado do fluxo. `claude` roda nos tokens do Claude Code; `agy`/`kiro`/`codex` delegam cada unidade de trabalho para a CLI externa via slash command, mantendo o Claude apenas como orquestrador restrito a `AskUserQuestion`. Veja `skills/pensador/references/execution-modes.md`.

| Modo | Slash command | Parametro padrao |
|---|---|---|
| `--mode claude` (padrao) | — | — |
| `--mode agy` | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `--mode kiro` | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `--mode codex` | `/codex:rescue` | `--effort high` |

## Os doze estagios

```text
INIT → EXPLORE → RESEARCH → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

| Estagio | O que produz |
|---|---|
| `INIT` | Demanda, checkpoint v2, `allocateFeatureDir()` e (se OpenSpec detectado) escolha PRD vs Spec |
| `EXPLORE` | Exploracao do projeto via `codebase-memory-mcp` → `codebase-memory.md` |
| `RESEARCH` | Dois tracks: `business` (mercado, arquetipo, tiers) → `market-research.md`; `technical` (stack, versao atual, padroes) → `tech-research.md` |
| `PRD_BASE` | PRD Base pela `Skill_PRD_Base` (ou change set OpenSpec no modo Spec) |
| `ARCH` | Analise do projeto, entrevista em greenfield, top-up do track tecnico → `architecture.md` |
| `EXPAND` | Ampliacao da demanda com requisitos candidatos |
| `COMPLEXITY` | `detectComplexity()` sugere Lite ou Completo |
| `BRAINSTORM_GERAL` | Orquestracao por dominio com lentes primarias + refino (Codex, AGY, Open Design) |
| `CODEX` | Refinamento tecnico final com `codex:codex-rescue` |
| `AGY` | Lacunas finais de produto com `cc-antigravity-plugin:antigravity-agent` |
| `FINAL` | Consolidacao, artefatos, recap final e handoff |
| `DONE` | Estado terminal |

Os antigos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` nao sao mais estagios autonomos; viraram lentes de dominio dentro de `BRAINSTORM_GERAL`. Definicao detalhada em `skills/pensador/references/stages.md`.

---

## Fluxo

### Passo 0 - Parsear argumentos

Execute `parseExecutionMode($ARGUMENTS)` (definido em `pensador-engine.mjs`) para separar:

- `mode`: `claude` (padrao), `agy`, `kiro` ou `codex`. Aceita `--mode` e o alias legado `--modo`, nas formas `--mode agy` e `--mode=agy`. Valor desconhecido cai para `claude` com `modeValid = false`.
- `modelOverride` / `effortOverride`: sobrescritas opcionais de `--model` / `--effort`.
- `demanda`: o texto restante.

Se `modeValid = false`, avise via `AskUserQuestion` antes de seguir em `claude`.

### Passo 1 - Preflight

Execute o preflight informando o modo escolhido para verificar disponibilidade dos subagentes e do motor de execucao:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs" --mode <modo>
```

Parse o JSON retornado e registre o status:

- `status: "ok"` - subagentes e motor disponiveis.
- `status: "partial"` - prossiga e aplique fallback nos dominios/estagios afetados; se o motor do `--mode` estiver indisponivel (`executionMode.available = false`), pergunte via `AskUserQuestion` se deve cair para `--mode claude` ou abortar.
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
- Se houver checkpoint valido, pergunte via `AskUserQuestion` se deve retomar ou iniciar nova atualizacao. (No subcomando `resume`, retome direto, sem perguntar.)
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

- Grave o Prompt System (`buildResearchPromptSystem()`), que passa a ser injetado em todos os prompts seguintes — inclusive nos delegados em `--mode agy|kiro|codex`. Injete apenas o grupo pertinente (`PROMPT_SYSTEM_SECTION_GROUPS.business` / `.technical`).
- Conformidade obrigatoria: cite a URL de todo achado, no maximo 30 palavras consecutivas por fonte, parafraseie e nunca copie assets/textos/codigo de terceiros.

### Passo 4 - Executar os estagios

Siga a ordem definida em `skills/pensador/SKILL.md` e `skills/pensador/references/stages.md`.

Quando o modo de execucao for `agy`, `kiro` ou `codex`, **delegue o trabalho pesado de cada estagio** ao motor via `SlashCommand`, usando a invocacao construida por `buildDelegationInvocation()`:

```text
/cc-antigravity-plugin:antigravity --model claude-4.6-opus-thinking "<PromptSystem>"
/cc-kiro-plugin:kiro --model claude-opus-4.8 --effort high "<PromptSystem>"
/codex:rescue --effort high "<PromptSystem>"
```

O Claude apenas orquestra: le os rascunhos do motor, consolida no estado/artefatos e faz toda decisao que exige o usuario via `AskUserQuestion`. Em `--mode claude`, redija inline. Detalhes em `skills/pensador/references/execution-modes.md`.

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

No estagio FINAL, grave tambem o manifesto de handoff `handoff.json` na raiz de `<featurePath>/`, conforme `skills/pensador/references/handoff-contract.md`. Ele e a ancora de descoberta que o `/cc-orchestrador-subagents:orquestrador` usa para ingerir o PRD/Spec. Liste em `artifacts[]` cada arquivo final gerado com seu `role` (`prd`, `userhistory`, `architecture`, `api-contract`, `communication-contract`, `design-system`, `design-system-files`, `codebase-memory`, `shared-agents`) e marque `status: "DONE"` apenas quando todos os gates fecharem.

### Passo 5 - Reportar ao usuario

Ao concluir FINAL, informe:

- Caminho de `prd.md` (modo PRD) ou do change set `openspec/changes/<nome>/` (modo Spec).
- Caminho de `userhistory.md` (modo PRD).
- Caminho do contrato maquina-legivel (`openapi.yaml`/`schema.graphql`/`service.proto`/`asyncapi.yaml`) e de `communication.md` (visao derivada), se houver back-end confirmado (modo PRD).
- Caminho dos arquivos do design system, se houver front-end (modo PRD): quando o Open Design foi usado, `design-systems/<id>/` (arquivos verbatim, incl. `DESIGN.md`); no fallback (sem Open Design), o `design-system.md` inline.
- Caminho de `codebase-memory.md`, `market-research.md`, `tech-research.md` e `architecture.md`.
- Caminho de `shared-agents/agent.response.md`.
- Caminho de `handoff.json` (manifesto de handoff para o Orquestrador).
- Recap final e handoff. No modo Spec, oriente `openspec validate <nome> --strict --json`, `/opsx:apply`, `/opsx:sync` e `openspec archive <nome> --json --yes`.
- Proximo passo: `/cc-orchestrador-subagents:orquestrador implemente o plano destacado`, que ira ingerir `handoff.json`.

---

## Modos

### Modo help

Imprima a Sinopse, a tabela de Subcomandos reservados e a tabela de Flags. Nao rode script nenhum e encerre.

### Modo preflight

Rode apenas `node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs" --mode <modo>`, apresente `status`, motor de execucao e o bloco `integrations`, e encerre. Nao carregue a skill, nao crie `featurePath` e nao ingira demanda.

### Modo status

Liste os diretorios `.pensador/<slug>-vN/` com checkpoint valido, mostrando por entrada: slug, versao, `stage` atual, `artifactMode` (`prd`/`spec`) e modo de execucao gravado. Read-only: nao retome, nao crie e nao arquive nada. Sem checkpoint, diga que nao ha fluxo em andamento.

### Modo resume

Com `slug`, retome aquele checkpoint; sem `slug`, o mais recente. Diferente do INIT normal, **nao** pergunte "retomar ou iniciar nova atualizacao" — a escolha ja foi feita ao digitar `resume`. Rode o preflight, carregue a skill e salte direto para o `stage` gravado. Checkpoint v1 (`pensador-output/.pensador-progress.json`) e incompativel: informe e recomende iniciar um fluxo v2 novo.

### Modo config

Read-only. Mostre o motor resolvido por `resolveExecutionMode()` (modo, slash command, `model`/`effort` efetivos e a origem de cada um: `override`, `default` ou `none`) e o bloco `integrations` do preflight. Se o usuario quiser mudar a stack de agentes **do projeto**, aponte `/orquestrador project-config` — o Pensador nao grava configuracao.

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
| `skills/pensador/references/execution-modes.md` | Modos de execucao `--mode` (claude/agy/kiro/codex), parsing, preflight e contrato de delegacao |
| `skills/pensador/references/codebase-memory.md` | Code Base Memory (MCP) obrigatorio: exploracao do projeto antes do PRD/Spec |
| `skills/pensador/references/web-research.md` | RESEARCH, track de negocio: arquetipos, plano de consultas, tiers de funcionalidade e Prompt System |
| `skills/pensador/references/tech-research.md` | RESEARCH, track tecnico: deteccao de stack, lacunas, versao atual, padroes/arquitetura/convencoes e anti-padroes |
| `skills/pensador/references/open-design.md` | Open Design (MCP/CLI) opcional: brief de design e geracao de `design-system.md` quando ha front-end |
| `skills/pensador/references/openspec.md` | OpenSpec opcional: escolha PRD vs Spec no INIT e montagem de specs |
| `skills/pensador/references/handoff-contract.md` | Contrato de handoff Pensador→Orquestrador→Executor: `handoff.json`, raizes `.pensador/.orchestration/.executor`, correlacao por slug |
| `skills/pensador/references/askuserquestion-protocol.md` | AskUserQuestion, opcoes recomendadas, previews, recap final e handoff |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex, AGY, Kiro, motor de execucao, Code Base Memory, OpenSpec e Open Design |
| `scripts/install-open-design.ps1` / `scripts/install-open-design.sh` | Instalador opcional do Open Design via Docker (verifica git+docker, sobe o daemon, conecta o MCP), oferecido via `AskUserQuestion` quando ha front-end |
| `scripts/od-mcp-config.mjs` | Helper que busca `/api/mcp/install-info` do daemon e faz merge da entrada `mcpServers.<nome>` no `.mcp.json` (usado pelo instalador no modo Docker, sem `od` no host) |
| `scripts/pensador-engine.mjs` | Especificacao deterministica de referencia, nao importada em runtime pela skill |

---

## Quando invocado sem argumento

Se `$ARGUMENTS` estiver vazio, solicite a demanda via `AskUserQuestion`. Nunca inicie `PRD_BASE` sem demanda presente e nao vazia.
