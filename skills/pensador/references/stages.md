# Estagios do Pensador v2

Este documento detalha os estagios do protocolo v2, seus gates e as regras de delegacao. Os antigos estagios autonomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos da maquina de estados. Suas responsabilidades agora vivem dentro de `BRAINSTORM_GERAL`.

---

## Visao geral

```text
INIT → EXPLORE → RESEARCH → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

A sequencia e fixa e nunca reordenada. O avanco e controlado por gate: o Pensador so avanca quando todas as perguntas do estagio atual tem resposta, diferimento explicito ou fallback registrado.

Funil v2: **iniciar/retomar** -> **explorar (Code Base Memory)** -> **pesquisar mercado (web)** -> **PRD/Spec base** -> **arquitetura** -> **expandir** -> **calibrar complexidade** -> **brainstorm geral por dominio** -> **varredura tecnica** -> **varredura de produto** -> **consolidar** -> **entregar**.

> **Modo de execucao.** O trabalho pesado de cada estagio (redigir PRD base, expandir, sintetizar analises, gerar artefatos) e executado pelo motor escolhido em `--modo`. Em `--modo claude` (padrao) o Claude Code redige inline; em `--modo agy|kiro|codex` o Pensador delega cada unidade de trabalho via slash command e so orquestra. Em qualquer modo, os gates e o canal `AskUserQuestion` permanecem identicos. Veja `references/execution-modes.md`.

---

## INIT

**Proposito:** obter demanda, resolver modo de execucao, resolver retomada e definir isolamento por atualizacao.

- `parseExecutionMode($ARGUMENTS)` separa `--modo` (claude/agy/kiro/codex), `--model`/`--effort` e a `demanda`. Modo desconhecido cai para `claude` com aviso via `AskUserQuestion`. Veja `references/execution-modes.md`.
- Checkpoints v2 ficam em `.pensador/<slug-da-demanda>-vN/.pensador-progress.json`.
- Checkpoint valido: perguntar via `AskUserQuestion` se o usuario quer retomar ou criar nova atualizacao.
- Checkpoint v1 em `pensador-output/.pensador-progress.json`: incompativel. Perguntar se deve iniciar fluxo v2 novo.
- Novo fluxo: executar `allocateFeatureDir()` e gravar `featurePath`.
- Demanda ausente: solicitar via `AskUserQuestion`.
- **OpenSpec (opcional):** se o preflight reportar `integrations.openspec.available = true`, perguntar via `AskUserQuestion` se o usuario quer gerar **PRD** (padrao) ou **Spec** estruturada; registrar `artifactMode` com `withArtifactMode()`. Veja `references/openspec.md`.

**Gate:** demanda presente, modo de execucao resolvido (motor disponivel ou fallback para `claude` registrado), `artifactMode` definido (`prd` padrao; `spec` quando OpenSpec escolhido), `featurePath` definido e decisao de retomada/novo fluxo registrada.

---

## EXPLORE

**Proposito:** explorar o projeto existente com o **Code Base Memory** (obrigatorio) antes de gerar o PRD/Spec, para entender a estrutura sobre a qual a feature/fix vai atuar.

- Disponivel (`integrations.codebaseMemory.available = true`): rodar o MCP `codebase-memory-mcp` na ordem `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (mais `detect_changes` em fixes).
- Gravar `<featurePath>/codebase-memory.md` com panorama de arquitetura, simbolos/arquivos afetados, cadeias de chamada relevantes, raio de impacto (fixes) e lacunas.
- **Descoberta de contrato existente (brownfield):** buscar contratos de API ja versionados no repo via `contractDiscoveryGlobs()` (`**/openapi*.{yaml,yml,json}`, `**/*.graphql`, `**/*.proto`, `**/asyncapi*.{yaml,yml}`, `**/schema.prisma`). Se encontrar, registrar o caminho e o estilo no `codebase-memory.md` como **baseline** — a nova feature deve estender esse contrato, nao redescreve-lo em prosa (coesao front/back).
- Indisponivel (`integrations.codebaseMemory.available = false`): perguntar via `AskUserQuestion` se o usuario deseja **instalar o servidor agora**:
  - **Opcao A — Instalar (recomendada):** Claude executa o instalador da plataforma (`install.sh` no Linux/macOS; `install.ps1` no Windows via PowerShell) com `Bash`, aguarda conclusao, orienta o usuario a reconectar o MCP e retoma o EXPLORE com o servidor disponivel.
  - **Opcao B — Seguir sem:** usar `Read`/`Glob`/`Grep` e registrar a decisao no `codebase-memory.md`.
- Greenfield: registrar que nao ha codigo a indexar e avancar.

Estagio sem perguntas de produto: e visitado, produz o snapshot (ou registra fallback) e avanca. Veja `references/codebase-memory.md`.

**Gate:** `<featurePath>/codebase-memory.md` gravado (exploracao concluida ou fallback registrado).

---

## RESEARCH

**Proposito:** pesquisar na **web** o que o estagio anterior nao pode saber olhando o codigo — o baseline de mercado da categoria de produto **e** como a stack escolhida e construida hoje. E a contraparte "para fora" do EXPLORE.

Dois tracks, mesmo estagio:

| Track | Pergunta | Descritor | Snapshot |
|---|---|---|---|
| `business` | O que essa categoria de produto entrega? | `WEB_RESEARCH` | `market-research.md` |
| `technical` | Como essa stack e construida hoje? | `TECH_RESEARCH` | `tech-research.md` |

### Track `business`

Sequencia:

1. **`sectorContext` primeiro** — setor/industria do negocio, via `AskUserQuestion` quando nao inferivel. Grave em `state.sectorContext` e reaproveite no brief do Open Design (nao pergunte duas vezes).
2. **Arquetipo** — `detectProductArchetype(demanda + sectorContext)` sugere; o usuario confirma via `AskUserQuestion`. Grave em `state.productArchetype`. `PRODUCT_ARCHETYPES[<id>].baselineFeatures` ja da o table-stakes conhecido antes de qualquer busca.
3. **Relevancia e profundidade** — `researchRelevance({ isInternalOnly, archetype, hasBroadScopeKeywords, isGreenfield })`. `lite` = 4 consultas, `completo` = 8. Demanda sem superficie de produto (refactor/infra/CI) e `relevant: false`: o estagio e visitado, registra o motivo e avanca.
4. **Plano de consultas** — `marketResearchQueryPlan()` com `WebSearch`; `WebFetch` so nos resultados que valem leitura profunda (`budget.maxFetchPerQuery`). Alvo de 3 a 5 concorrentes/referencias.
5. **Qualidade de fonte** — `official` > `comparison` > `community`; `table-stakes` exige 2 fontes independentes.
6. **Conformidade** (`WEB_RESEARCH.compliance`) — citar URL, no maximo 30 palavras consecutivas, parafrasear, nunca copiar assets/textos/codigo de concorrente nem imitar marca.
7. **Classificacao** — `classifyFeatureTier()` em `table-stakes` / `differentiator` / `anti-feature` / `out-of-scope`. Decisao do usuario vence o sinal de mercado.
8. **Perguntas** — toda `table-stakes` ausente da demanda vira pergunta `origin = 'web-research'`, `stage = 'RESEARCH'` via `AskUserQuestion`. Respostas entram em `REQUIREMENT_STAGES`.
9. **Saidas** — `<featurePath>/market-research.md` (arquivo de trabalho, fora de `buildArtifactList`) e `withMarketResearch(state, research)`.

**Fallback:** sem acesso a web, pergunte via `AskUserQuestion` se o usuario informa os concorrentes manualmente ou se o fluxo segue apenas com o baseline do arquetipo; marque `status: SKIPPED` ou `PARTIAL`.

Protocolo completo em `references/web-research.md`.

### Track `technical`

Existe porque o conhecimento do modelo sobre um ecossistema em movimento esta congelado no corte de treinamento, e o modo de falha e silencioso: o PRD sai coerente, mas ancorado em padroes que a documentacao oficial ja substituiu. **Versao atual e abordagem recomendada sao pesquisadas, nunca lembradas.**

1. **Deteccao** — `detectTechStack(demanda + codebase-memory.md)`, com casamento por fronteira de palavra (`c#`, `.net`, `go` sem os falsos positivos de "algo"/"google"). Grave em `state.techStack`.
2. **Lacunas** — `inferStackGaps(detected, demanda)`: linguagem de servidor sem framework, intencao de login sem abordagem de auth, back-end sem banco. Cada uma vira `AskUserQuestion` com candidatos. Nao adivinhe.
3. **Relevancia/profundidade/diferimento** — `techResearchRelevance()`. Sem stack detectavel, `deferToArch: true` e `status: DEFERRED`: o ARCH resolve a stack e roda o top-up.
4. **Plano em tres fases** — `techResearchQueryPlan()`: `version-currency` obrigatoria (protegida, primeiro), `stack-patterns` em round-robin, cross-cutting com vagas reservadas. O truncamento so consome a fase 2.
5. **Fontes** — `official-docs` > `release-notes` > `reputable-guide` > `community`; `requiresOfficialSource: true`.
6. **Dimensoes** — as 10 de `TECH_RESEARCH_DIMENSIONS`.
7. **Adocao** — `classifyPatternAdoption()`: so `current` (e `experimental` consciente) vira decisao de PRD; `deprecated` vai para anti-padroes com o substituto.
8. **Saidas** — `<featurePath>/tech-research.md` (arquivo de trabalho) e `withTechResearch(state, research)`.

**Fallback:** sem acesso a web, pergunte se o usuario informa versoes/convencoes vigentes ou se o fluxo segue sem elas — deixando explicito no PRD que os padroes nao foram verificados.

Protocolo completo em `references/tech-research.md`.

### Prompt System

`buildResearchPromptSystem()` empacota os dois tracks em `PROMPT_SYSTEM_SECTIONS`, agrupados por `PROMPT_SYSTEM_SECTION_GROUPS` (`business` / `technical`), e o bloco e injetado verbatim nos consumidores de `WEB_RESEARCH.promptSystemConsumers` + `TECH_RESEARCH.consumers`: PRD base, EXPAND, `context-pack.md`, prompts delegados em `--modo`, brief do Open Design, CODEX e handoff. Injete apenas o grupo pertinente a cada consumidor.

**Gate:** `market-research.md` **e** `tech-research.md` gravados (`DONE`/`PARTIAL`/`DEFERRED`/`SKIPPED` com motivo) e perguntas `web-research` — benchmark e lacunas de stack — respondidas ou diferidas.

---

## PRD_BASE

**Proposito:** criar o artefato base — `PRD_Base` no modo PRD ou o change set OpenSpec (via `/opsx:propose`) no modo Spec. A escolha vem de `artifactMode`, definido no INIT.

### Modo PRD (`artifactMode = 'prd'`, padrao)

- Aplicar `Strict_PRD_Schema`.
- Inferir secoes a partir da demanda, do `<featurePath>/codebase-memory.md`, do `<featurePath>/market-research.md` e do `<featurePath>/tech-research.md` (+ Prompt System).
- Secoes de engenharia (§7, §10, §11, §12, §15) citam a versao pesquisada e o padrao `current`, com URL oficial; padrao `deprecated` vai para anti-padroes, nunca para decisao.
- `table-stakes` aprovadas viram requisitos funcionais; `anti-feature` e `out-of-scope` viram exclusoes explicitas na secao Escopo, com o motivo.
- Usar exatamente `"TBD"` quando a informacao nao for inferivel.

### Modo Spec (`artifactMode = 'spec'`, OpenSpec)

- Acionar `/opsx:propose <nome ou descricao>` (nunca escrever os arquivos manualmente): cria `proposal.md`, `specs/<capability-path>/spec.md`, `design.md` e `tasks.md` em `openspec/changes/<nome>/` (`<nome>` = `openspecChangeName(featurePath)`; `specs/` e omitido sob `skip_specs`).
- Alimentar com a demanda e o `codebase-memory.md`; usar `"TBD"` no que nao for inferivel.
- Se os comandos `/opsx:*` nao estiverem disponiveis: perguntar via `AskUserQuestion` se deve cair para PRD ou abortar; nao montar a estrutura manualmente.
- Todas as etapas seguintes raciocinam sobre a spec. Veja `references/openspec.md`.

**Gate:** modo PRD — PRD Base completo (secoes preenchidas ou `"TBD"`); modo Spec — change set OpenSpec criado por `/opsx:propose` (ou fallback registrado). Sem perguntas alem do fallback.

---

## ARCH

**Proposito:** entender arquitetura, stack e contexto tecnico antes de fazer perguntas de produto.

### Projeto existente

Reaproveite o indice do Code Base Memory criado no EXPLORE (`get_architecture`, `search_graph`, `trace_path`, `detect_changes` em fixes) e complemente com `Read`, `Glob` e `Grep` para identificar:

- Stack, framework, linguagem e gerenciador de pacotes.
- Estrutura de pastas, entrypoints e padroes locais.
- Front-end, back-end, persistencia, jobs, integracoes e autenticacao.
- **Estilo de API (`state.apiStyle`)** quando `hasBackend`: detectar se o contrato e REST (→ `openapi.yaml`), GraphQL (→ `schema.graphql`), gRPC (→ `service.proto`) ou orientado a eventos/filas (→ `asyncapi.yaml`). Reaproveitar o baseline de contrato descoberto no EXPLORE. Se ambiguo, perguntar via `AskUserQuestion`. Esse valor seleciona o formato do contrato maquina-legivel no FINAL (`resolveContractFormat()`).
- Artefatos relevantes ja existentes.
- Riscos, convencoes e lacunas tecnicas.

### Greenfield

Se nao houver base de codigo relevante:

- Marque `isGreenfield = true`.
- Entreviste o usuario via `AskUserQuestion` sobre stack, front-end, back-end, persistencia, integracoes, deploy e restricoes.
- Use respostas diferidas como `"TBD"` no `architecture.md`.

### Top-up do track tecnico do RESEARCH

Se `state.techResearch.status === 'DEFERRED'`, a stack so ficou conhecida aqui: rode agora `detectTechStack` → `inferStackGaps` → `techResearchQueryPlan` → `classifyPatternAdoption` → `withTechResearch(state, { status: 'DONE', ... })`, atualizando `tech-research.md`. Sao as mesmas funcoes do RESEARCH; muda so o momento em que a stack ficou conhecida. Se ja foi pesquisada la, reaproveite — nao pergunte nem pesquise de novo.

### Saida

Grave `<featurePath>/architecture.md` com:

- Resumo da arquitetura.
- Sinais `hasBackend`, `hasFrontend`, `isGreenfield`.
- Dominios detectados.
- Decisoes conhecidas e lacunas.
- **Baseline tecnico pesquisado:** versao atual por tecnologia, estrutura idiomatica, padroes `current` e convencoes para o Executor, cada um com a URL oficial. Divergencia deliberada vira override justificado, nao omissao.
- Entradas para `detectComplexity()`.

**Gate:** `architecture.md` gravado com o baseline tecnico, perguntas greenfield fechadas e top-up concluido quando o track tecnico estava `DEFERRED`.

---

## EXPAND

**Proposito:** ampliar a demanda com requisitos candidatos do proprio Pensador.

1. Revisar demanda, PRD Base, `architecture.md` e `market-research.md` (deduplicando o que o RESEARCH ja decidiu).
2. Identificar requisitos implicitos, fluxos alternativos, RNFs, integracoes, seguranca, erros, acessibilidade e persistencia.
3. **Gate de breaking change (quando ha contrato existente):** se a feature toca um contrato de API descoberto no EXPLORE, classificar via `classifyContractChange()` como `additive` ou `breaking`. Uma mudanca `breaking` (remove/renomeia operacao, muda tipo ou obrigatoriedade) vira pergunta explicita `AskUserQuestion` — quebra de contrato e decisao arquitetural deliberada, com versionamento, nao ajuste rapido.
4. Converter lacunas importantes em perguntas `origin = 'pensador'`, `stage = 'EXPAND'`.
5. Apresentar via `AskUserQuestion`, com opcao recomendada quando aplicavel.

**Gate:** todas as perguntas respondidas ou diferidas.

---

## COMPLEXITY

**Proposito:** decidir a profundidade de execucao antes do brainstorm geral.

`detectComplexity()` usa:

| Sinal | Como interpretar |
|---|---|
| `domainCount` | Quantidade de dominios funcionais/tecnicos distintos |
| `hasBackend` | API, servidor, dados, auth, jobs, integracoes ou contratos |
| `hasBroadScopeKeywords` | Plataforma, sistema, multiusuario, dashboard amplo, automacao, pagamentos, compliance ou escopo amplo |
| `isGreenfield` | Projeto novo sem arquitetura existente |

Resultado:

- **Lite:** poucas areas, baixo risco, pouco ou nenhum back-end.
- **Completo:** back-end, escopo amplo, multiplos dominios, integracoes, greenfield relevante ou alto risco.

Pergunte ao usuario via `AskUserQuestion` se aceita a sugestao. Inclua:

- Opcao recomendada.
- Preview do que muda no fluxo.
- Profundidade por dominio.
- Possibilidade de seguir com a alternativa.

**Gate:** modo `Lite` ou `Completo` registrado.

---

## BRAINSTORM_GERAL

**Proposito:** executar um brainstorm unico, orientado por dominios, substituindo CLARITY/BACKEND/UIUX/FRONTEND.

### Contexto compartilhado

Grave antes da delegacao:

```text
<featurePath>/shared-agents/context-pack.md
```

O arquivo deve conter o **Prompt System** do RESEARCH — grupo `business` (contexto de negocio, baseline de mercado, diferenciais, anti-features, vocabulario do dominio) e grupo `technical` (stack com versao pesquisada, baseline de arquitetura, padroes, convencoes, seguranca, testes, anti-padroes) —, demanda, PRD Base, `architecture.md`, respostas de EXPAND, modo Lite/Completo, sinais de complexidade, dominios detectados e instrucoes de saida.

### Roteamento

| Participante | Papel | Quando roda | Foco |
|---|---|---|---|
| `requirements-clarity` | lente primaria | sempre | Clareza, ambiguidades, aceite, escopo |
| `backend-development` | lente primaria | `hasBackend` | Dados, APIs, contratos, seguranca (alimenta o contrato maquina-legivel), raciocinando sobre o grupo `technical` do Prompt System — versao, padroes e convencoes pesquisados, nao lembrados |
| Codex `effort high` | refino | `hasBackend` | Aprofunda riscos tecnicos sobre a lente primaria |
| `ui-ux-pro-max` + `frontend-design` | lentes primarias | `hasFrontend` | UX, estados de tela, componentizacao, design system (alimentam o Open Design) |
| AGY `gemini-3.1-pro-high` | refino | `hasFrontend` | Experiencia, produto, jornadas, cenarios |
| Open Design (`od`) | motor de design | `hasFrontend` | Brief de design (tom, marca, paleta, tipografia, estados, responsividade, acessibilidade, microcopy) -> arquivos verbatim no FINAL. `sectorContext` vem do RESEARCH (`state.sectorContext`) e nao e perguntado de novo; concorrentes do `market-research.md` alimentam `brandReferences`. Veja `references/open-design.md`. |

Em modo Lite, limite a quantidade de perguntas por dominio e favoreca `"TBD"` para lacunas menores. Em modo Completo, aprofunde dominios de maior risco.

### Saidas

Cada participante grava sua resposta em `shared-agents/*.response.md`. O Pensador consolida em:

```text
<featurePath>/shared-agents/agent.response.md
```

`agent.response.md` deve registrar autoria, dominio, severidade, pergunta candidata, evidencias e se houve deduplicacao.

### Fallback por dominio

Se um participante falhar:

1. Registre evidencia da falha.
2. Pergunte via `AskUserQuestion` se deve retentar, seguir sem aquele dominio ou registrar lacunas como `"TBD"`.
3. Nao bloqueie dominios independentes que ja responderam.

### Perguntas ao usuario

- Deduplicate contra PRD Base, EXPAND e respostas anteriores.
- Agrupe por dominio quando fizer sentido.
- Preserve selo de autoria: `Pensador`, `requirements-clarity`, `Codex` ou `AGY`.
- Use PT-BR por padrao.

**Gate:** `agent.response.md` produzido ou fallback registrado; todas as perguntas respondidas ou diferidas.

---

## CODEX

**Proposito:** varredura tecnica final, apos o brainstorm geral.

- Subagente: `codex:codex-rescue`.
- Parametro efetivo: `effort high` no prompt.
- Entrada: demanda, PRD Base, `architecture.md`, grupo `technical` do Prompt System + `tech-research.md`, EXPAND, `agent.response.md` e respostas consolidadas.
- Saida: pontos tecnicos em aberto, convertidos em perguntas `origin = 'codex'`. Divergencia entre o que o Codex propoe e o baseline pesquisado e um ponto a levantar, nao a resolver em silencio.

**Participacao do Codex:** quando a atividade e especifica de front-end (`hasFrontend = true` e `hasBackend = false`, ou seja `codexParticipates = false`), o Codex nao participa. O estagio e visitado, mas nao delega: registra zero perguntas, sem fallback, e avanca automaticamente. Com `hasBackend = true` (back-end ou fullstack) o Codex roda normalmente.

**Fallback:** quando o Codex participa, pergunta individual via `AskUserQuestion` para retentar, seguir sem Codex ou registrar lacunas como `"TBD"`.

**Gate:** atividade especifica de front-end avanca com zero perguntas; caso contrario, todas as perguntas/fallbacks de CODEX respondidos ou diferidos.

---

## AGY

**Proposito:** varredura final de produto.

- Subagente: `cc-antigravity-plugin:antigravity-agent`.
- Modelo: `gemini-3.1-pro-high` no prompt.
- Entrada: demanda, PRD Base, `architecture.md`, EXPAND, `agent.response.md`, CODEX e consolidado parcial.
- Saida: lacunas de produto, riscos e cenarios nao cobertos, convertidos em perguntas `origin = 'agy'`.

**Fallback:** preservar status como `QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` ou `TIMEOUT` quando disponivel; perguntar via `AskUserQuestion`.

**Gate:** todas as perguntas/fallbacks de AGY respondidos ou diferidos.

---

## FINAL

**Proposito:** consolidar respostas e gerar artefatos finais.

1. Aplicar `withConsolidated(state)`.
2. Confirmar back-end via `AskUserQuestion`, apresentando a heuristica como sugestao (so no modo PRD; no modo Spec nao se aplica).
3. Gerar artefatos conforme `artifactMode`:
   - Modo PRD: `prd.md` + `userhistory.md` (+ contrato maquina-legivel `openapi.yaml`/`schema.graphql`/`service.proto`/`asyncapi.yaml` **e** `communication.md` quando ha back-end) (+ `design-system.md` quando ha front-end **e** o Open Design NAO foi usado — fallback inline) em `<featurePath>/`. O contrato maquina-legivel e a **fonte da verdade**; o `communication.md` e a visao legivel derivada. Quando um system do Open Design foi selecionado, o `DESIGN.md` verbatim em `design-systems/<id>/` e o documento de design — nao gere `design-system.md` redundante.
   - Modo Spec: finalizar o change set em `openspec/changes/<nome>/` e rodar `openspec validate <nome> --strict --json`. **Nao** rode `/opsx:sync` aqui: sincronizar publica como spec vigente um comportamento ainda nao implementado e drena os deltas que o Orchestrador ingere — isso e do estagio seguinte. O contrato de API e dobrado no change (design.md + specs), sem artefato standalone.
4. Confirmar sobrescrita via `AskUserQuestion` quando arquivo ja existir.
5. Apresentar recap final e handoff. No modo Spec, orientar com `/opsx:apply`, `/opsx:sync` e `openspec archive <nome> --json --yes` (este altera specs principais: so apos confirmacao do usuario).

| Artefato | Condicao |
|---|---|
| `prd.md` | Modo PRD |
| `userhistory.md` | Modo PRD |
| `openapi.yaml` / `schema.graphql` / `service.proto` / `asyncapi.yaml` (contrato maquina-legivel, fonte da verdade) | Modo PRD, quando ha back-end confirmado (formato por `state.apiStyle`) |
| `communication.md` (visao legivel derivada do contrato) | Modo PRD, quando ha back-end confirmado |
| `design-system.md` | Modo PRD, quando ha front-end **e** o Open Design NAO foi usado (fallback inline). Com um system selecionado, o `DESIGN.md` verbatim em `design-systems/<id>/` substitui este doc. |
| `design-systems/<id>/` (arquivos verbatim: `tokens.css`, `DESIGN.md`, `components.html`, …) | Modo PRD e Spec, quando ha front-end **e** um system do Open Design foi selecionado |
| `openspec/changes/<nome>/` (`proposal.md` · `design.md` · `tasks.md` · `specs/`) | Modo Spec (via `/opsx:propose`) |

**Gate:** artefatos aplicaveis gerados, `handoff.json` gravado, caminhos reportados, recap final e handoff entregues.

---

## DONE

Estado terminal. Sem perguntas ou acoes pendentes.

---

## Resumo dos gates

| Estagio | Gate |
|---|---|
| `INIT` | Demanda presente, `artifactMode` definido, `featurePath` definido e retomada/novo fluxo resolvido |
| `EXPLORE` | `codebase-memory.md` gravado (exploracao do Code Base Memory ou fallback registrado) |
| `RESEARCH` | `market-research.md` **e** `tech-research.md` gravados (`DONE`/`PARTIAL`/`DEFERRED`/`SKIPPED`) e perguntas `web-research` fechadas |
| `PRD_BASE` | Modo PRD: PRD Base completo; modo Spec: change set OpenSpec criado por `/opsx:propose` (ou fallback) |
| `ARCH` | `architecture.md` gravado com baseline tecnico; top-up tecnico concluido quando estava `DEFERRED` |
| `EXPAND` | Perguntas respondidas ou diferidas |
| `COMPLEXITY` | Modo Lite/Completo escolhido |
| `BRAINSTORM_GERAL` | `agent.response.md` ou fallback por dominio; perguntas fechadas |
| `CODEX` | Front-end especifico: zero perguntas e avanco; caso contrario, perguntas/fallbacks fechados |
| `AGY` | Perguntas/fallbacks fechados |
| `FINAL` | Artefatos, recap e handoff entregues |
| `DONE` | Terminal |
