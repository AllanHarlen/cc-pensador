---
name: pensador
description: Orquestra o protocolo v2 do Pensador em doze estagios, transformando uma demanda em linguagem natural em PRD (ou specs OpenSpec) e artefatos isolados por feature. Inclui exploracao via Code Base Memory, pesquisa web/benchmark de mercado, analise de arquitetura, expansao, complexidade, brainstorm geral paralelo por dominio, refinamento Codex, AGY e consolidacao final. Toda pergunta ao usuario passa exclusivamente por AskUserQuestion.
---

# Skill: Pensador

Esta skill orquestra o fluxo **Pensador v2**. O fluxo explora a base de codigo, pesquisa o mercado da categoria de produto, gera um PRD base, analisa a arquitetura do projeto, expande requisitos, estima complexidade, coordena um brainstorm geral por dominio, refina tecnicamente com Codex, fecha lacunas de produto com AGY e entrega os artefatos finais em um diretorio isolado por feature.

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
| `skills/pensador/references/execution-modes.md` | Modos de execucao `--mode` (claude/agy/kiro/codex) e contrato de delegacao |
| `skills/pensador/references/codebase-memory.md` | Code Base Memory (MCP) obrigatorio: exploracao do projeto antes do PRD/Spec |
| `skills/pensador/references/web-research.md` | RESEARCH, track de negocio: arquetipos de produto, plano de consultas, classificacao de funcionalidades e o Prompt System reaproveitavel |
| `skills/pensador/references/tech-research.md` | RESEARCH, track tecnico: deteccao de stack, lacunas, versao atual, padroes de arquitetura/design, convencoes e anti-padroes vigentes |
| `skills/pensador/references/open-design.md` | Open Design (MCP/CLI) opcional: brief de design e persistencia verbatim dos arquivos do system (`design-system.md` so no fallback, quando ha front-end e o Open Design nao e usado) |
| `skills/pensador/references/imagery.md` | Pipeline de imagery/iconografia: `sectorContext` (Pensador) ate `IMAGE_SUGGESTIONS` do `antigravity-coder` (Orquestrador) |
| `scripts/od-fetch-system.mjs` | Script I/O que executa `openDesignFetchPlan()` no FINAL: copia os artefatos verbatim do system (manifest-driven quando o system traz `manifest.json`; `tokens.css`, `components.html`, `preview/`, … caso contrario) para `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`) — `packages/ui/design-systems/<id>/` e so o alvo de materializacao que o Orquestrador/Executor usa depois |
| `skills/pensador/references/openspec.md` | OpenSpec opcional: escolha PRD vs Spec no INIT e montagem de specs |
| `skills/pensador/references/handoff-contract.md` | Contrato de handoff Pensador→Orchestrador→Executor: `handoff.json`, raizes ocultas e correlacao por slug |
| `skills/pensador/references/askuserquestion-protocol.md` | Canal unico de dialogo, previews, recap final e handoff |
| `skills/pensador/assets/prd-template.md` | Template do artefato `prd.md` |
| `skills/pensador/assets/userhistory-template.md` | Template do artefato `userhistory.md` |
| `skills/pensador/assets/communication-template.md` | Template da visao legivel `communication.md` (derivada do contrato maquina-legivel `openapi.yaml`/`schema.graphql`/`service.proto`/`asyncapi.yaml`, fonte da verdade sob SDD) quando ha back-end |

---

## Ordem canonica v2

A sequencia e fixa e nunca reordenada:

```text
INIT → EXPLORE → RESEARCH → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

`STAGE_ORDER` v2:

```js
[
  'INIT',
  'EXPLORE',
  'RESEARCH',
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
  market-research.md
  tech-research.md
  architecture.md
  project-baseline.json
  requirements.json           # somente modo PRD (role requirements-index)
  shared-agents/
    context-pack.md
    backend-development.response.md
    ui-ux-pro-max.response.md
    frontend-design.response.md
    codex.response.md
    agy.response.md
    requirements-clarity.response.md
    agent.response.md
  prd.md
  userhistory.md
  openapi.yaml               # contrato maquina-legivel (fonte da verdade) — ou schema.graphql / service.proto / asyncapi.yaml
  communication.md       # visao legivel derivada do contrato maquina-legivel
  design-system.md
  design-systems/<id>/          # arquivos verbatim do Open Design (tokens.css, DESIGN.md, components.html, preview/, …)
```

> No modo Spec (OpenSpec), `prd.md` e substituido por `proposal.md`, `specs.md`, `design.md` e `tasks.md`. `market-research.md` e `tech-research.md` sao os snapshots dos dois tracks do RESEARCH (arquivos de trabalho, fora de `buildArtifactList` — nao viajam no handoff). `codebase-memory.md`, `architecture.md` e `project-baseline.json`, ao contrario, **sao artefatos do handoff** (roles `codebase-memory`, `architecture`, `project-baseline` — sempre emitidos em FINAL/DONE, nos dois `artifactMode`, independente de `hasBackend`/`hasFrontend`): carregam a exploracao real do projeto (dominios, mapa de codigo, baseline do contrato de API existente, convencoes a preservar) e um resumo estruturado (`isGreenfield`/`techStack`/`apiStyle`/`uiPackageDir`) que o Orchestrador/Executor consomem em vez de re-derivar — essencial em brownfield. `requirements.json` (role `requirements-index`) e emitido **somente no modo PRD** — a materia-prima do gate de cobertura RF/CA do Orquestrador, extraida deterministicamente das tabelas `RF-XX`/`CA-XX` do `prd.md`. `design-system.md` so e gravado no modo PRD quando ha front-end **e o Open Design NAO foi usado** (fallback inline) — quando um system e selecionado, o `DESIGN.md` verbatim em `design-systems/<id>/` e o documento de design. Os arquivos verbatim do Open Design ficam em `design-systems/<id>/` dentro da pasta da feature (nos dois modos, quando `hasFrontend`); o Executor os materializa depois em `packages/ui`/`src/styles`.

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

Isso inclui demanda ausente, retomada de checkpoint, setor/arquetipo e escopo de funcionalidades em RESEARCH, entrevista greenfield em ARCH, requisitos candidatos em EXPAND, decisao Lite/Completo em COMPLEXITY, perguntas vindas do BRAINSTORM_GERAL, Codex, AGY, fallback, confirmacao de back-end, sobrescrita de artefatos, recap final e handoff.

O idioma padrao e PT-BR. Cada pergunta deve oferecer uma opcao recomendada quando houver uma recomendacao defensavel, incluir previews quando a decisao afetar artefatos e registrar autoria/origem da pergunta.

---

## Modos de execucao (`--mode`)

O modo de execucao define **qual motor executa o trabalho pesado** do fluxo (redigir o PRD base, expandir requisitos, sintetizar analises e gerar artefatos). E ortogonal a delegacao por estagio (Codex/AGY/skills como lentes de dominio).

- `--mode claude` (padrao, ou ausente): o Claude Code faz o trabalho e gasta os proprios tokens.
- `--mode agy` | `--mode kiro` | `--mode codex`: o Claude Code vira um orquestrador fino e **delega** cada unidade de trabalho para a CLI externa via slash command, fazendo o custo recair sobre a quota daquele motor. Barateia a geracao dos artefatos.

| Modo | Slash command | Parametro padrao |
|---|---|---|
| `claude` | — | — |
| `agy` | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `kiro` | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `codex` | `/codex:rescue` | `--effort high` |

Regras centrais:

- **Invariante preservada:** em qualquer modo, todo dialogo com o usuario continua passando exclusivamente por `AskUserQuestion`. O motor externo nunca conversa com o usuario; ele so produz rascunhos/analises que o Pensador relê e consolida.
- Parsing: `parseExecutionMode($ARGUMENTS)` extrai `--mode`, `--model` e `--effort` e devolve o restante como `demanda`. `--mode` desconhecido cai para `claude` com aviso via `AskUserQuestion`.
- Preflight: rode `preflight.mjs --mode <modo>`; se o motor escolhido estiver indisponivel, pergunte via `AskUserQuestion` se deve cair para `--mode claude` ou abortar.
- Decisoes que exigem o usuario nunca sao delegadas: viram perguntas `AskUserQuestion` feitas pelo proprio Pensador.
- O modo de execucao e independente das lentes de dominio: mesmo em `--mode kiro`, os estagios `CODEX` e `AGY` continuam usando `codex:codex-rescue` e `cc-antigravity-plugin:antigravity-agent` como lentes (salvo fallback).

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
  Resolve modo de execucao (--mode), verifica demanda, checkpoint v2 e aloca featurePath.
  Se OpenSpec for detectado, pergunta PRD vs Spec (artifactMode).

EXPLORE
  Explora o projeto com Code Base Memory (index_repository, get_architecture,
  search_graph, trace_path) e grava <featurePath>/codebase-memory.md. Descobre
  contrato de API existente (contractDiscoveryGlobs) como baseline em brownfield.
  Fallback para Read/Glob/Grep se indisponivel.

RESEARCH
  Olha para FORA, em dois tracks.
  business:  coleta sectorContext, confirma o arquetipo (detectProductArchetype),
             roda marketResearchQueryPlan via WebSearch/WebFetch, levanta o que os
             concorrentes entregam, classifica por FEATURE_TIERS e grava
             <featurePath>/market-research.md.
  technical: detecta a stack (detectTechStack), fecha lacunas (inferStackGaps),
             roda techResearchQueryPlan (version-currency obrigatoria + padroes em
             round-robin + cross-cutting reservado), classifica adocao
             (classifyPatternAdoption) e grava <featurePath>/tech-research.md.
  Os dois alimentam o Prompt System reaproveitavel (grupos business/technical)
  injetado em todos os prompts seguintes.

PRD_BASE
  Modo PRD: gera PRD Base pelo Strict_PRD_Schema. Modo Spec: escala o comando
  /opsx:propose para montar o change set. Sem perguntas; avanco automatico.

ARCH
  Analisa projeto existente via Code Base Memory (indice criado no EXPLORE) e Read/Glob/Grep.
  Detecta state.apiStyle (rest/graphql/grpc/events) quando hasBackend.
  Em greenfield, entrevista o usuario. Grava <featurePath>/architecture.md.

EXPAND
  Amplia requisitos candidatos do proprio Pensador. Aplica o gate de breaking
  change (classifyContractChange) quando a feature toca contrato existente.

COMPLEXITY
  Executa detectComplexity() com sinais domainCount, hasBackend,
  hasBroadScopeKeywords e isGreenfield. Sugere modo Lite ou Completo.

BRAINSTORM_GERAL
  Orquestra em paralelo as lentes primarias requirements-clarity, backend-development
  (se hasBackend) e ui-ux-pro-max + frontend-design (se hasFrontend), com Codex high e
  AGY gemini-3.1-pro-high como refino. Quando hasFrontend, parseia o brief de
  design para o Open Design (materializa o system verbatim no FINAL). Usa
  context-pack.md e agent.response.md. Aplica fallback por dominio.

CODEX
  Refinamento tecnico final com Codex usando effort high.
  Nao participa quando a atividade e especifica de front-end (hasFrontend e nao hasBackend).

AGY
  Lacunas remanescentes de produto com AGY usando gemini-3.1-pro-high.

FINAL
  Consolida, confirma back-end, gera artefatos (incl. contrato maquina-legivel
  openapi.yaml/schema.graphql/… quando hasBackend, e design-system.md quando
  hasFrontend) e apresenta recap final/handoff.

DONE
  Estado terminal.
```

---

## INIT

1. Execute `parseExecutionMode($ARGUMENTS)` para separar `--mode` (claude/agy/kiro/codex), `--model`/`--effort` e a `demanda`. Registre o modo de execucao no estado. Se `--mode` for desconhecido, avise via `AskUserQuestion` e use `claude`.
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
2. Disponivel: chame `index_status` primeiro (gate obrigatorio). Sem indice para este projeto, pergunte via `AskUserQuestion` se deve indexar agora — nunca dispare `index_repository` por conta propria. Confirmado (ou indice ja existente e fresco), rode `get_architecture → get_graph_schema → search_graph → trace_path` (acrescente `detect_changes` quando for um fix sobre codigo existente). Cada consulta tem orcamento de 30s; erro ou timeout cai para `Read`/`Glob`/`Grep` naquele ponto, e duas falhas seguidas do servidor tratam o Code Base Memory como ausente pelo resto da exploracao. Lacuna de cobertura (grafo silencioso para um arquivo que existe) exige leitura direta do arquivo antes de afirmar ausencia de simbolo ou referencia. Detalhes completos em `references/codebase-memory.md`.
3. Grave o resumo em `<featurePath>/codebase-memory.md`: panorama de arquitetura, simbolos e arquivos afetados, cadeias de chamada relevantes, raio de impacto (em fixes) e lacunas/incertezas — resultado de grafo e sempre corroborado por leitura de arquivo antes de virar afirmacao definitiva. **Em brownfield, descubra o contrato de API existente** via `contractDiscoveryGlobs()` (`**/openapi*.{yaml,yml,json}`, `**/*.graphql`, `**/*.proto`, `**/asyncapi*.{yaml,yml}`, `**/schema.prisma`) e registre o caminho e o estilo como baseline — a nova feature deve **estender** esse contrato, nao redescreve-lo.
4. Indisponivel (`available = false`): pergunte via `AskUserQuestion` se o usuario deseja **instalar o servidor agora** (opcao recomendada) ou seguir sem ele:
   - **Opcao A — Instalar:** execute o instalador da plataforma (`install.sh` no Linux/macOS; `install.ps1` no Windows via PowerShell) usando `Bash`, aguarde conclusao, oriente o usuario a reconectar o MCP (ou reiniciar o agente) e retome o EXPLORE com o servidor disponivel. Veja os comandos exatos em `references/codebase-memory.md`.
   - **Opcao B — Seguir sem:** explore com `Read`/`Glob`/`Grep` e registre a decisao no `codebase-memory.md`.
5. Greenfield (sem base relevante): registre que nao ha codigo a indexar e avance.

Este e um estagio sem perguntas de produto: ele e visitado, produz o snapshot (ou registra fallback) e avanca. Detalhes em `references/codebase-memory.md`.

**Gate:** `<featurePath>/codebase-memory.md` gravado (com a exploracao do Code Base Memory ou o fallback registrado).

---

## RESEARCH

**Objetivo:** olhar para **fora** antes de escrever o PRD/Spec. O `EXPLORE` entende o codigo que existe; o `RESEARCH` entende o mercado em que o produto vai competir **e** como a stack escolhida e construida hoje.

O estagio tem **dois tracks**, que rodam no mesmo estagio e alimentam o mesmo Prompt System:

| Track | Pergunta | Descritor | Snapshot | Referencia |
|---|---|---|---|---|
| **`business`** | O que essa **categoria de produto** entrega? | `WEB_RESEARCH` | `market-research.md` | `references/web-research.md` |
| **`technical`** | Como essa **stack** e construida **hoje**? | `TECH_RESEARCH` | `tech-research.md` | `references/tech-research.md` |

---

### Track 1 — negocio/mercado

A demanda que chega quase sempre e uma categoria com milhares de implementacoes publicadas (site comercial, landing page de prestador de servico, SaaS, CRM, e-commerce, sistema de gestao). Esse conjunto de funcionalidades e conhecimento publico: escrever o PRD sem le-lo significa re-derivar do zero o que o mercado ja resolveu.

1. **Colete `sectorContext` primeiro** (setor/industria: "oficina automotiva de carro/moto", "clinica odontologica", "escritorio de contabilidade"). Pergunte via `AskUserQuestion` quando nao for inferivel — sem isso a pesquisa retorna generalidades. Grave em `state.sectorContext` e **reaproveite** no brief do Open Design (nao pergunte duas vezes).
2. **Confirme o arquetipo** com `detectProductArchetype(demanda + sectorContext)` e apresente a sugestao via `AskUserQuestion` (recomendada primeiro). Grave em `state.productArchetype`. Cada arquetipo de `PRODUCT_ARCHETYPES` ja traz `baselineFeatures` — o table-stakes conhecido **antes** de qualquer busca; a pesquisa confirma e estende.
3. **Decida relevancia e profundidade** com `researchRelevance({ isInternalOnly, archetype, hasBroadScopeKeywords, isGreenfield })`. So demandas sem superficie de produto (refactor interno, build/CI, bump de dependencia) sao `relevant: false` — e mesmo assim o estagio e visitado e registra o motivo.
4. **Execute o plano** de `marketResearchQueryPlan({ demanda, archetype, sectorContext, region, depth })` com `WebSearch`, e `WebFetch` apenas nos resultados que valem leitura profunda. Respeite o teto de `WEB_RESEARCH.budget` (4 consultas em `lite`, 8 em `completo`; 3-5 concorrentes). Pesquisa e um estagio, nao uma varredura da internet.
5. **Qualifique as fontes** (`official` > `comparison` > `community`). Uma feature so vira `table-stakes` com pelo menos 2 fontes independentes.
6. **Respeite a conformidade de conteudo** (`WEB_RESEARCH.compliance`): cite a URL de todo achado, nunca reproduza mais de 30 palavras consecutivas, parafraseie, e **jamais** copie logos, imagens, textos de marca ou codigo de concorrente. O produto do estagio e analise, nao copia.
7. **Classifique** cada funcionalidade com `classifyFeatureTier()` em `table-stakes`, `differentiator`, `anti-feature` ou `out-of-scope`. Decisao explicita do usuario sempre vence o sinal de mercado.
8. **Pergunte o que a pesquisa nao resolve:** toda `table-stakes` que nao estava na demanda vira pergunta `origin = 'web-research'`, `stage = 'RESEARCH'` via `AskUserQuestion`, agrupada, com recomendacao e opcao de recusa (que a transforma em `anti-feature` documentada). Essas respostas entram em `REQUIREMENT_STAGES` e sao consolidadas no FINAL.
9. **Grave o snapshot** em `<featurePath>/market-research.md` (`marketResearchSnapshotPath()`) e o estado com `withMarketResearch(state, research)`.

Protocolo completo, arquetipos, plano de consultas e anti-padroes em `references/web-research.md`.

---

### Track 2 — tecnico (stack, arquitetura, padroes, convencoes)

**Por que existe:** o conhecimento do modelo sobre um ecossistema em movimento esta congelado no corte de treinamento, e o modo de falha e **silencioso**. Pedindo "tela de login com React + TypeScript e back-end em C#", um modelo pode produzir com confianca um PRD ancorado em padroes que a documentacao oficial ja substituiu — estrutura de pastas de um major anterior, busca de dados no padrao antigo, JWT feito a mao onde o framework ja entrega identidade suportada. O PRD vira a especificacao de construir o aplicativo de ontem, e o Orquestrador/Executor implementam fielmente a decisao vencida.

**Regra:** para toda tecnologia sensivel a versao, a versao estavel atual e a abordagem recomendada atual sao **pesquisadas, nunca lembradas**.

1. **Detecte a stack** com `detectTechStack(demanda + codebase-memory.md)`. O casamento e por fronteira de palavra (`c#`, `.net` e `go` sao detectaveis sem os falsos positivos de "algo"/"google"/"abc#"). Em brownfield a stack vem do codigo, nao de nova pergunta. Grave em `state.techStack`. Tecnologia fora do registro nao e descartada: `resolveTechEntry()` devolve entrada generica e ela entra no plano.
2. **Feche as lacunas antes de pesquisar** com `inferStackGaps(detected, demanda)`. "Back-end com C#" nao diz ASP.NET Core; "tela de login" nao diz a abordagem de auth. Cada lacuna (`backend-framework-missing`, `auth-approach-missing`, `database-missing`) vira `AskUserQuestion` com candidatos concretos. **Nao adivinhe.**
3. **Decida relevancia/profundidade/diferimento** com `techResearchRelevance()`. Quando nenhuma stack e detectavel, o track fica `DEFERRED`: nao ha o que pesquisar ainda, porque a stack so e resolvida no ARCH — que executa o **top-up** com as mesmas funcoes de plano.
4. **Execute o plano** de `techResearchQueryPlan()`, em tres fases: (1) `version-currency` obrigatoria por tecnologia sensivel a versao — vem primeiro porque toda resposta posterior so tem sentido em relacao ao major atual; (2) `stack-patterns` em **round-robin** entre tecnologias; (3) cross-cutting (`integration-contract`, `auth-flow`, `project-conventions`) com **vagas reservadas**. O truncamento so consome a fase 2.
5. **Qualifique as fontes** com `TECH_RESEARCH.sourceTiers`: `official-docs` > `release-notes` > `reputable-guide` > `community`. Inversao proposital em relacao ao track de negocio — para mercado o fornecedor e enviesado, para framework o fornecedor **e** a autoridade. `requiresOfficialSource: true`.
6. **Cubra as 10 dimensoes** de `TECH_RESEARCH_DIMENSIONS`, para a pesquisa nao parar em "qual e a versao atual".
7. **Classifique a adocao** de cada padrao com `classifyPatternAdoption()`: `current` (doc oficial + evidencia recente) pode virar decisao do PRD; `experimental` so se escolhido consciente e registrado como risco; `legacy` exige justificativa; `deprecated` vai para `technicalAntiPatterns`, com o substituto documentado.
8. **Grave** `<featurePath>/tech-research.md` (`techResearchSnapshotPath()`) e o estado com `withTechResearch(state, research)`.

O track tecnico alimenta as secoes de **engenharia** do PRD (§7 RNF, §10 modelo de dados, §11 contratos, §12 seguranca, §15 arquitetura), o `architecture.md`, as lentes de back-end/front-end, o CODEX e o handoff (`TECH_RESEARCH.consumers`).

Protocolo completo, registro de tecnologias, angulos por categoria e anti-padroes em `references/tech-research.md`.

---

### Prompt System (o reaproveitamento dos dois tracks)

`buildResearchPromptSystem()` empacota o contexto pesquisado nas secoes de `PROMPT_SYSTEM_SECTIONS`, agrupadas em `PROMPT_SYSTEM_SECTION_GROUPS`:

- **`business`:** `businessContext`, `productArchetype`, `marketBaseline`, `competitorFeatures`, `differentiators`, `antiFeatures`, `domainVocabulary`, `complianceNotes`
- **`technical`:** `techStack`, `architectureBaseline`, `designPatterns`, `codingConventions`, `securityBaseline`, `testingBaseline`, `technicalAntiPatterns`
- **compartilhado:** `openQuestions`

Esse bloco e injetado **verbatim** nos consumidores de `WEB_RESEARCH.promptSystemConsumers` e `TECH_RESEARCH.consumers`: PRD base, EXPAND, `context-pack.md` do BRAINSTORM_GERAL, **toda unidade de trabalho delegada** em `--mode agy|kiro|codex`, o brief do Open Design, o CODEX e o recap/handoff. Injete apenas o **grupo pertinente** a cada consumidor — o brief do Open Design nao tem uso para convencoes de ORM, e a lente de back-end nao tem uso para precificacao de concorrente.

Assim toda lente raciocina sobre o mesmo contexto de negocio **e** o mesmo baseline tecnico pesquisado, em vez de re-inferir dominio e stack a partir da demanda crua.

### Fallback (sem acesso a web)

Pergunte via `AskUserQuestion`:

- **Track de negocio:** (A) o usuario informa concorrentes/referencias manualmente, ou (B) seguir apenas com os `baselineFeatures` do arquetipo.
- **Track tecnico:** (A) o usuario informa as versoes e convencoes vigentes, ou (B) seguir sem elas — deixando explicito no PRD que os padroes nao foram verificados e podem estar defasados.

Registre a escolha e marque `status: SKIPPED` ou `PARTIAL` no snapshot correspondente.

**Gate:** `<featurePath>/market-research.md` **e** `<featurePath>/tech-research.md` gravados (cada um `DONE`, `PARTIAL` com lacunas marcadas, `DEFERRED` — so o tecnico, com top-up agendado no ARCH — ou `SKIPPED` com motivo) e todas as perguntas `origin = 'web-research'` (benchmark e lacunas de stack) respondidas ou diferidas.

---

## PRD_BASE

**Objetivo:** produzir o artefato base a partir da demanda — `PRD_Base` no modo PRD ou a **montagem de specs estruturadas** no modo Spec (OpenSpec). A escolha vem de `artifactMode`, definido no INIT.

### Modo PRD (`artifactMode = 'prd'`, padrao)

1. Carregue `skills/prd/SKILL.md`.
2. Aplique a entrevista de descoberta sobre a demanda, usando como contexto o `<featurePath>/codebase-memory.md` (o que existe), o `<featurePath>/market-research.md` (o que o mercado entrega) e o `<featurePath>/tech-research.md` (como a stack e construida hoje), mais o Prompt System.
3. Preencha cada secao inferivel; se nao inferivel, marque exatamente `"TBD"`. As funcionalidades `table-stakes` aprovadas no RESEARCH entram como requisitos funcionais; as `anti-feature` e `out-of-scope` entram em **Escopo** como exclusoes explicitas, com o motivo.
4. As secoes de engenharia usam o track tecnico: §7 (RNF), §10 (modelo de dados), §11 (contratos de API), §12 (seguranca) e §15 (arquitetura e decisoes tecnicas) citam a **versao pesquisada** e o padrao `current`, com a URL oficial. Padrao `deprecated` nunca vira decisao — vai para os anti-padroes tecnicos.

### Modo Spec (`artifactMode = 'spec'`, OpenSpec)

Quando o usuario escolheu Spec no INIT, este estagio **substitui o PRD base** acionando `/opsx:propose` (nunca escrevendo os arquivos manualmente):

1. Confirme que os comandos `/opsx:*` estao disponiveis (perfil core, instalado por padrao por `openspec init`). Se nao estiverem, pergunte via `AskUserQuestion` se deve cair para o modo PRD ou abortar — nao monte a estrutura manualmente nem siga como Claude direto.
2. Crie e monte o change set: `/opsx:propose <nome ou descricao>` (gera `proposal.md`, `specs/<capability-path>/spec.md`, `design.md` e `tasks.md` de uma vez; `specs/` e omitido sob `skip_specs`) em `openspec/changes/<nome>/`. Use `openspecChangeName(featurePath)` como `<nome>`.
3. Alimente os comandos com a demanda e o `<featurePath>/codebase-memory.md`; o que nao for inferivel fica como `"TBD"`.
4. Todas as etapas seguintes (`ARCH`, `EXPAND`, `COMPLEXITY`, `BRAINSTORM_GERAL`, `CODEX`, `AGY`, `FINAL`) passam a raciocinar sobre a **spec** em vez do PRD, refinando os artefatos do change set.

Detalhes do fluxo, chamadas de CLI (`openspec validate`, `openspec archive`) e handoff em `references/openspec.md`.

**Gate:** no modo PRD, todas as secoes do PRD Base preenchidas ou `"TBD"`; no modo Spec, change set OpenSpec criado por `/opsx:propose` (ou fallback para PRD/abortar registrado). Sem perguntas ao usuario alem do fallback.

---

## ARCH

**Objetivo:** entender a arquitetura antes de expandir requisitos.

Projeto existente:

- Reaproveite o indice do Code Base Memory criado no EXPLORE: `get_architecture` para o panorama, `search_graph`/`trace_path` para mapear os simbolos e fluxos afetados pela demanda, e `detect_changes` quando for um fix.
- Complemente com `Read`, `Glob` e `Grep` para detalhes que o grafo nao cobrir (config, padroes locais, persistencia, UI).
- Nao execute alteracoes no codigo.
- Registre achados, incertezas e sinais `hasBackend`, `hasFrontend`, `isGreenfield = false`. Persista o sinal no estado com `withGreenfieldSignal(state, false)` — ele viaja no handoff via o role `project-baseline` (FINAL passo 5) para o Orquestrador/Executor nao terem que re-derivar isGreenfield de forma independente e potencialmente divergente.
- **Derive `state.apiStyle`** quando `hasBackend`: detecte se o contrato e REST (`rest` → `openapi.yaml`), GraphQL (`graphql` → `schema.graphql`), gRPC (`grpc` → `service.proto`) ou orientado a eventos/filas/webhooks (`events` → `asyncapi.yaml`). Reaproveite o baseline de contrato descoberto no EXPLORE. Se ambiguo, pergunte via `AskUserQuestion`. Esse valor seleciona o formato do contrato maquina-legivel no FINAL (`resolveContractFormat(state.apiStyle)`).
- **Derive `uiPackageDir`** quando `hasFrontend`: inspecione se o repo e um monorepo (`pnpm-workspace.yaml`, `packages/` ou `apps/` presentes) ou um app unico. Use `resolveUiPackageDir({ isMonorepo, framework })` do engine como base (`packages/ui` para monorepo; `src/styles` para app unico Next.js/Vite/Remix). Se ambiguo, pergunte via `AskUserQuestion`. Grave a resposta em `state.uiPackageDir` — esse valor NAO e o destino da copia do Pensador; e o **alvo de materializacao** que o Orquestrador/Executor usa depois. O Pensador sempre persiste os arquivos verbatim dentro da pasta da feature (`<featurePath>/design-systems/<id>/`), nunca na arvore de codigo real.

Greenfield:

- Quando nao houver base de codigo relevante, marque `isGreenfield = true` e persista com `withGreenfieldSignal(state, true)` (mesma razao do caso brownfield acima).
- Entreviste o usuario via `AskUserQuestion` sobre stack desejada, canais de entrega, persistencia, integracoes e restricoes tecnicas.

**Top-up do track tecnico do RESEARCH.** Se `state.techResearch.status === 'DEFERRED'` (a stack nao era detectavel no RESEARCH), execute a pesquisa tecnica **agora**, com a stack que este estagio acabou de resolver: `detectTechStack` sobre as respostas/analise → `inferStackGaps` → `techResearchQueryPlan` → `classifyPatternAdoption` → `withTechResearch(state, { status: 'DONE', ... })`, atualizando `<featurePath>/tech-research.md`. Sao as mesmas funcoes do RESEARCH; o que muda e so o momento em que a stack ficou conhecida. Se a stack ja foi pesquisada no RESEARCH, **nao pergunte nem pesquise de novo** — reaproveite.

Saida obrigatoria:

- Grave `<featurePath>/architecture.md`.
- Inclua resumo da arquitetura, dominios detectados, decisoes conhecidas, lacunas tecnicas e sinais para `detectComplexity()`.
- Registre o **baseline tecnico pesquisado**: versao atual de cada tecnologia, estrutura de projeto idiomatica, padroes de arquitetura/design `current` e as convencoes que o Executor devera seguir — cada um com a URL oficial. Decisao que contraria o baseline vira override justificado, nao omissao.

**Gate:** `architecture.md` gravado (com o baseline tecnico), perguntas greenfield respondidas ou diferidas e, quando o track tecnico estava `DEFERRED`, top-up concluido ou fallback registrado.

---

## EXPAND

**Objetivo:** ampliar a demanda com requisitos candidatos nao previstos no enunciado.

1. Revise o `PRD_Base`, `architecture.md`, `market-research.md`, secoes `"TBD"`, funcionalidades implicitas, fluxos alternativos, integracoes, seguranca, erros, desempenho, acessibilidade, persistencia e mobile. Use o inventario de funcionalidades do RESEARCH como fonte de requisitos candidatos — **sem repetir** o que o usuario ja decidiu naquele estagio (deduplique).
2. **Gate de breaking change (brownfield):** se a feature toca o contrato de API existente descoberto no EXPLORE, classifique via `classifyContractChange({ touchesExistingContract, removesOrRenames, changesTypeOrRequired })`. Se o resultado for `breaking`, converta em pergunta explicita `AskUserQuestion` antes de consolidar — quebra de contrato e decisao arquitetural deliberada e versionada, nunca ajuste implicito. Mudancas `additive` seguem normalmente.
3. Converta candidatos importantes em perguntas com `origin = 'pensador'`, `stage = 'EXPAND'`.
4. Apresente via `AskUserQuestion`, agrupando apenas perguntas relacionadas de mesma origem e estagio.

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

Roteamento padrao (lentes primarias sao skills deterministas; Codex/AGY refinam; Open Design e o motor de design):

- `requirements-clarity` (lente primaria): sempre aplicavel como lente de clareza.
- `backend-development` (lente primaria): roda sempre que `hasBackend = true`, produzindo o checklist determinista de dados/APIs/contratos/seguranca que alimenta o **contrato maquina-legivel**. Codex com effort `high` roda **por cima dela** como lente de refinamento (`role: refine`) quando `hasBackend = true`.
- `ui-ux-pro-max` + `frontend-design` (lentes primarias): rodam sempre que `hasFrontend = true` e alimentam o Open Design. AGY com modelo `gemini-3.1-pro-high` roda **por cima delas** como lente de refinamento (`role: refine`) quando `hasFrontend = true`.
- **Open Design (motor de design, quando `hasFrontend = true`):** alem das perguntas de UX, o Pensador parseia o **brief de design** via `AskUserQuestion` (setor/industria do negocio, tom visual, marca/referencias, paleta, tipografia, estados de componente, responsividade, acessibilidade, microcopy — `openDesignBriefPlan()`). A dimensao `sectorContext` (setor/industria) **ja foi coletada no RESEARCH** (`state.sectorContext`): reaproveite-a em vez de perguntar de novo; sem ela o system fica com uma "vibe" de marca generica, sem iconografia/imagery nem microcopy do ramo real do usuario (ver `references/web-research.md`, `references/open-design.md` e `references/imagery.md`). O inventario de concorrentes do `market-research.md` tambem alimenta `brandReferences`. Cada resposta tem um destino estruturado no Open Design (`openDesignBriefRouting()`): `selection` (escolhe/importa o system), `input` (conteudo/componentes), `parameter` (estilizacao: hue/spacing/opacity), `constraint` (gate WCAG — enforced no review do modo Spec; documentado em PRD mode). Apos coletar o brief, **liste os candidates** via `od design-systems list --json` (ou `GET /api/design-systems`) e apresente os top-3 matches ao usuario via `AskUserQuestion` com preview do `visualTone` de cada um (inclua o system recomendado como primeira opcao). Somente apos confirmacao do usuario **grave os id(s) validados em `state.designSystems` (array de strings)** — ids nao confirmados causam exit 5 no FINAL. `buildArtifactList` le esse campo para emitir os artefatos `design-system-files` no handoff; sem ele o role `design-system-files` nao e gerado e o Orquestrador nao acha os arquivos verbatim. **Se `brandReferences` citar uma marca/repo real**, rode `od design-systems import-github <url>` (async: aguarde confirmacao do daemon antes de gravar o slug em `state.designSystems`). O download e a consolidacao acontecem no FINAL. Se o Open Design nao for detectado, ofereca instalacao via `AskUserQuestion` (igual ao Code Base Memory) ou caia para um `design-system.md` inline. Veja `references/open-design.md`.

Mapeamento deterministico em `STAGE_DELEGATION.BRAINSTORM_GERAL.domains.*.lenses` (`pensador-engine.mjs`).

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
Baseline tecnico pesquisado: <grupo technical do Prompt System + tech-research.md>
Requisitos consolidados: <EXPAND + BRAINSTORM_GERAL>
```

O baseline tecnico entra no prompt de proposito: a varredura deve raciocinar sobre as convencoes e versoes **pesquisadas**, nao sobre as que o modelo lembra. Divergencia entre o que o Codex propoe e o baseline pesquisado e um ponto a levantar, nao a resolver em silencio.

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
   - Modo PRD: `prd.md` e `userhistory.md` sempre; quando ha back-end, o **contrato maquina-legivel** (`openapi.yaml` / `schema.graphql` / `service.proto` / `asyncapi.yaml`, por `resolveContractFormat(state.apiStyle)`) como **fonte da verdade** E o `communication.md` como visao legivel derivada; `design-system.md` **somente quando ha front-end (`hasFrontend`) E o Open Design NAO foi usado** (fallback inline, nenhum system selecionado) — todos em `<featurePath>/`. Quando um system do Open Design foi selecionado, o `DESIGN.md` verbatim (em `design-systems/<id>/`) e o documento de design; **nao** gere `design-system.md` redundante. O `api-contract` viaja no `handoff.json` com o campo `validation` (`{ spec, mock, validate }`) para habilitar mock server e validacao de contrato no Executor.
   - Modo Spec (OpenSpec): o change set em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`); `userhistory.md`, `communication.md` e o contrato maquina-legivel standalone nao se aplicam — o contrato de API e dobrado no change (design.md + specs). **Excecao — Open Design continua valendo quando `hasFrontend`:** nao gera `design-system.md` standalone, mas roda do mesmo jeito (arquivos verbatim no repo + decisoes no `design.md` + capability `specs/ui-design-system/`). Ver passo 5.
   - Em **ambos** os modos, quando `hasFrontend`, os arquivos verbatim do Open Design vao para `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`, passo 5). O Orquestrador/Executor os materializa depois em `state.uiPackageDir` (`packages/ui`/`src/styles`).
4. Antes de sobrescrever artefatos existentes, confirme via `AskUserQuestion`.
5. Gere os artefatos:
   - **Baseline do projeto (`architecture.md`, `codebase-memory.md`, `project-baseline.json`) — nos DOIS modos, sempre:** `architecture.md` e `codebase-memory.md` ja foram gravados no ARCH/EXPLORE; confirme que continuam presentes em `<featurePath>/`. Gere `project-baseline.json` (novo, chamando `buildProjectBaseline(state)` para o conteudo — `isGreenfield`, `techStack`, `apiStyle`, `uiPackageDir`, `existingApiContractGlobs`) em `<featurePath>/project-baseline.json`. Os tres emitem roles `architecture`/`codebase-memory`/`project-baseline` no `handoff.json` (`buildArtifactList` ja os inclui automaticamente) — sem isso o Orquestrador/Executor re-derivam o brownfield do zero, exatamente o gap que este passo existe para fechar.
   - **Indice de requisitos (`requirements.json`) — somente modo PRD:** depois de `prd.md` gravado (com as tabelas `RF-XX`/`CA-XX` das secoes 6 e 14 preenchidas, nao `"TBD"` num requisito real), rode `extractRequirements(prdMarkdownText)` (`scripts/lib/requirements-extractor.mjs`) sobre o texto do `prd.md` que acabou de escrever e persista o resultado (`{ requirements, acceptanceCriteria }`) em `<featurePath>/requirements.json`. Emite o role `requirements-index` no `handoff.json` (`buildArtifactList` ja inclui quando `artifactMode = 'prd'`). Trate qualquer `warnings[]` retornado (secao ausente, referencia `CA -> RF` pendurada) como sinal para revisar o PRD antes de fechar FINAL — e a materia-prima do gate de cobertura RF/CA que o Orquestrador aplica na Fase 2/7; um indice incompleto ou ausente enfraquece esse gate silenciosamente rio abaixo.
   - **Design system (Open Design), quando `hasFrontend` — nos DOIS modos):** o Open Design e um **pipeline de arquivos**, nao prosa. NUNCA puxe so o `DESIGN.md` para re-escrever. Para cada system escolhido no BRAINSTORM_GERAL, **baixe e persista os arquivos verbatim** rodando:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/od-fetch-system.mjs" --id <id>[,<id>] --repo <repoRoot> --out-dir <featurePath> [--token $OD_API_TOKEN] [--locale pt-br]
     ```

     Isso grava `tokens.css` (fonte de verdade), `components.html`, `USAGE.md`, `DESIGN.md`, `preview/`, `system/`, `source/` em `<featurePath>/design-systems/<id>/` — ou seja, dentro de `.pensador/<slug>-vN/`, mantendo a saida do Pensador autocontida (ver `openDesignFetchPlan()` + `designSystemFilesRoot()`). Passe `--out-dir` com o `featurePath` da execucao (ex.: `.pensador/login-social-v1`). Quando o system traz `manifest.json`, o script deriva a lista de arquivos esperados dele (em vez da lista fixa) e reporta em `unexpectedMissing[]` qualquer arquivo prometido e nao copiado — nunca falha em silencio. `--locale <bcp47>` baixa tambem `DESIGN-<bcp47>.md` quando o system o oferece (opcional). Exit codes: `5` nenhuma fonte encontrada para o system, `6` fonte encontrada mas `tokens.css`/`DESIGN.md` ainda faltando. Se o script sair com erro (sem clone e sem REST), avise via `AskUserQuestion` e so entao caia para um `design-system.md` inline. Depois derive o `tokens.css` do projeto por composicao rastreavel dos systems (nunca um objeto JS a mao) e faca o `theme.ts` ler `var(--*)`.

     **Verificacao obrigatoria — nao feche o FINAL sem ela.** O script imprime JSON com `copied[]`, `fileSource` e `unexpectedMissing[]`. Para CADA `<id>`, confira as tres coisas:

     1. **Exit code `0`** e `results[].ok === true`.
     2. **`tokens.css` e `DESIGN.md` estao em `copied[]`** — sao os dois obrigatorios.
     3. **Liste o diretorio de verdade** (`ls -R <featurePath>/design-systems/<id>/`) e confira que o conteudo em disco bate com `copied[]`. Nao confie so no JSON: o passo 3 e o que pega o modo de falha real (abaixo).

     > ⚠️ **Modo de falha conhecido — o FINAL escrito a mao.** Se `design-systems/<id>/` contiver **so `DESIGN.md`**, o script NAO rodou: voce puxou `GET /api/design-systems/<id>` a mao, e esse endpoint serve **apenas metadados + DESIGN.md**, nunca os raw file bodies (`references/open-design.md`, passo 5a). O sintoma e um `DESIGN.md` com o conteudo certo mas gravado por `Write` — o script usa `copyFileSync`, copia byte a byte do clone. **Volte e rode o script.** Nunca grave arquivo de system com `Write`/`Edit`: eles sao copia verbatim, nao geracao.
     >
     > A mesma regra vale para o `handoff.json`: as entradas `design-system-files` saem de `buildArtifactList()` e carregam `verbatim: true` e `materializeInto`. Uma entrada sem esses campos e sinal de que o FINAL nao passou pelo engine.
   - **Modo PRD:** quando o Open Design foi usado, o `DESIGN.md` verbatim (em `design-systems/<id>/`) **e** o documento de design — **nao gere `design-system.md` standalone** (evita duplicacao). As decisoes de selecao/merge/overrides ja viajam no `handoff.json` (role `design-system-files` com o `<id>`). O `design-system.md` inline so e escrito no **fallback** (Open Design indisponivel/recusado): nesse caso preenche as 9 secoes do schema `DESIGN.md` a partir do brief. Os demais artefatos saem dos templates.
   - **Modo Spec:** dobre o design no change set usando o contrato `openDesignSpecContract(featurePath, state.designSystems, state.uiPackageDir)`. Ele entrega os caminhos concretos que os arquivos do OpenSpec DEVEM referenciar: (a) na secao *Decisions* do `design.md`, registre o(s) `<id>`, a origem verbatim (`verbatimDir`) e o alvo de materializacao (`materializeInto`) + overrides justificados; (b) na capability delta-spec `specs/ui-design-system/spec.md`, escreva requisitos `SHALL` + cenarios `#### Scenario:` que citam `materializedTokens` (ex.: `packages/ui/design-systems/<id>/tokens.css`) como fonte de estilo. Os arquivos verbatim continuam indo para `<featurePath>/design-systems/<id>/`. Finalize o change set e rode `openspec validate <nome> --strict --json` (e `/opsx:sync` se introduziu/ajustou specs). Contrato completo em `references/openspec.md` › **Contrato Spec ↔ Open Design**.
   - Detalhes e regra inviolavel ("never invent new tokens") em `references/open-design.md`.
   - **Handoff:** registre no `handoff.json` o(s) `<id>` concreto(s) escolhido(s) e o diretorio verbatim como role `design-system-files` (`design-systems/<id>/`, relativo ao `artifactRoot` `.pensador/<slug>-vN/`, uma entrada por id). Cada entrada carrega `materializeInto` (o alvo em `state.uiPackageDir`, ex.: `packages/ui/design-systems/<id>/`) para o Executor materializar depois. O role `design-system` (o `design-system.md`) so aparece no **fallback inline** (quando nenhum system foi usado). Isso e o que `buildArtifactList` emite quando `state.designSystems` esta preenchido; sem isso o consumidor (orquestrador) teria de parsear a prosa para achar os arquivos. Ver `references/handoff-contract.md`.
6. Apresente recap final: decisoes principais, perguntas diferidas, dominios cobertos, caminhos gerados e proximos passos de handoff. No modo Spec, oriente o handoff com `/opsx:apply`, `/opsx:sync` e `openspec archive <nome> --json --yes` (este ultimo altera specs principais: so apos confirmacao do usuario).

**Gate:** artefatos aplicaveis gerados, `handoff.json` gravado, caminhos reportados e recap/handoff apresentados. Quando `hasFrontend` e ha system(s) em `state.designSystems`, o gate inclui a **verificacao do passo 5**: `od-fetch-system.mjs` rodou com exit `0` e o conteudo de `<featurePath>/design-systems/<id>/` em disco bate com o `copied[]` do JSON.

---

## DONE

Estado terminal. O fluxo esta encerrado.

---

## Resumo dos gates

| Estagio | Gate de avanco |
|---|---|
| `INIT` | Demanda presente, modo de execucao resolvido, `artifactMode` definido, `featurePath` definido e retomada/novo fluxo decididos |
| `EXPLORE` | `codebase-memory.md` gravado (exploracao do Code Base Memory ou fallback registrado) |
| `RESEARCH` | `market-research.md` **e** `tech-research.md` gravados (`DONE`/`PARTIAL`/`DEFERRED`/`SKIPPED`) e perguntas `web-research` fechadas |
| `PRD_BASE` | Modo PRD: PRD Base completo; modo Spec: change set OpenSpec criado por `/opsx:propose` (ou fallback registrado) |
| `ARCH` | `architecture.md` gravado com baseline tecnico, perguntas greenfield fechadas e top-up tecnico concluido quando estava `DEFERRED` |
| `EXPAND` | Todas as perguntas respondidas ou diferidas |
| `COMPLEXITY` | Modo Lite/Completo escolhido |
| `BRAINSTORM_GERAL` | `agent.response.md` ou fallback por dominio; perguntas fechadas |
| `CODEX` | Front-end especifico: zero perguntas e avanco; caso contrario, todas respondidas ou diferidas |
| `AGY` | Todas as perguntas respondidas ou diferidas |
| `FINAL` | Artefatos gerados, caminhos reportados e recap/handoff entregues; com `hasFrontend` + system selecionado, `od-fetch-system.mjs` rodou (exit `0`) e o diretorio verbatim em disco foi conferido contra o `copied[]` |
| `DONE` | Terminal |

## Delegacao v2

| Estagio | Tipo | Alvo | Condicao | Saida |
|---|---|---|---|---|
| `RESEARCH` | ferramenta (track business) | `WebSearch` + `WebFetch` | demanda com superficie de produto (`researchRelevance().relevant`) | `market-research.md` + grupo `business` do Prompt System |
| `RESEARCH` | ferramenta (track technical) | `WebSearch` + `WebFetch` | stack detectada, greenfield ou impacto de arquitetura (`techResearchRelevance().relevant`) | `tech-research.md` + grupo `technical` do Prompt System |
| `ARCH` | ferramenta (top-up) | `WebSearch` + `WebFetch` | `techResearch.status === 'DEFERRED'` | `tech-research.md` atualizado |
| `BRAINSTORM_GERAL` | skill (primaria) | `requirements-clarity` | sempre | `shared-agents/requirements-clarity.response.md` |
| `BRAINSTORM_GERAL` | skill (primaria) | `backend-development` | `hasBackend` | `shared-agents/backend-development.response.md` |
| `BRAINSTORM_GERAL` | subagente (refino) | `codex:codex-rescue` | `hasBackend` | `shared-agents/codex.response.md` |
| `BRAINSTORM_GERAL` | skill (primaria) | `ui-ux-pro-max` | `hasFrontend` | `shared-agents/ui-ux-pro-max.response.md` |
| `BRAINSTORM_GERAL` | skill (primaria) | `frontend-design` | `hasFrontend` | `shared-agents/frontend-design.response.md` |
| `BRAINSTORM_GERAL` | subagente (refino) | `cc-antigravity-plugin:antigravity-agent` | `hasFrontend` | `shared-agents/agy.response.md` |
| `BRAINSTORM_GERAL`/`FINAL` | MCP/CLI (motor) | Open Design (`od`) | `hasFrontend` | arquivos verbatim em `design-systems/<id>/` (inclui `DESIGN.md`); `design-system.md` so no fallback inline |
| `CODEX` | subagente | `codex:codex-rescue` | nao especifico de front-end (`hasBackend` ou nao `hasFrontend`) | perguntas tecnicas finais |
| `AGY` | subagente | `cc-antigravity-plugin:antigravity-agent` | sempre | perguntas de produto finais |
