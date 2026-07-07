# Changelog

## [2.8.5] — 2026-07-07

### Artefatos verbatim do Open Design agora ficam dentro de `.pensador/<slug>-vN/`

Correção de integração Pensador ↔ Open Design: os arquivos verbatim do system (`tokens.css`, `DESIGN.md`, `components.html`, `preview/`, …) eram gravados em `packages/ui/design-systems/<id>/` na **raiz do projeto**, fora de `.pensador/`. Isso violava o contrato de handoff (§2 "nenhum artefato na raiz do projeto; o produtor nunca escreve na raiz de outro estágio"), o isolamento por feature ("todo caminho deriva de `featurePath`") e a regra §3 ("`artifacts[].path` é relativo a `artifactRoot`"). Resultado observado: nada aterrissava em `.pensador/`.

- **Destino realocado para a pasta da feature:** os arquivos verbatim agora vão para `<featurePath>/design-systems/<id>/` (dentro de `.pensador/<slug>-vN/`), mantendo a saída do Pensador autocontida. Novo helper puro `designSystemFilesRoot(featurePath)` no engine; `buildArtifactList` passa a raiz da feature para `openDesignFetchPlan()`.
- **`state.uiPackageDir` vira alvo de materialização:** deixa de ser o destino da cópia do Pensador e passa a ser o local (`packages/ui`/`src/styles`) onde o Executor materializa os arquivos na implementação. Cada entrada `design-system-files` do handoff carrega o novo campo `materializeInto`.
- **`od-fetch-system.mjs`:** novo parâmetro `--out-dir` (alias `--feature-dir`; `--ui-dir` mantido como alias legado) que enraíza a cópia sob a pasta da feature. `SKILL.md` FINAL passa a invocar com `--out-dir <featurePath>`.
- **Docs sincronizados:** `open-design.md`, `handoff-contract.md` (role `design-system-files` relativo ao `artifactRoot` + `materializeInto`), `feature-isolation.md` (layout + roles válidos), `openspec.md`, `SKILL.md` e ambos os READMEs.
- **Sincronização de versão:** `package.json` (2.8.3) e `plugin.json` (2.8.4) unificados em **2.8.5**. Testes: `artifacts.test.js` e `integrations.test.js` atualizados (+2 casos cobrindo `designSystemFilesRoot` e o enraizamento por `featurePath`).

## [2.8.3] — 2026-06-23

### Handoff carrega o `<id>` concreto do system (fecha o elo e2e)

O 2.8.2 documentou o diretório verbatim no contrato (prosa), mas o `handoff.json` **emitido** ainda listava só o `design-system.md` — o `<id>` concreto vivia só na prosa do `design-system.md`, forçando o consumidor (orquestrador) a parseá-la.

- **Novo artefato estruturado `design-system-files` em `buildArtifactList`:** quando `hasFrontend` **e** `state.designSystems` está preenchido (system escolhido no BRAINSTORM_GERAL), emite **uma entrada por `<id>` concreto** apontando para `packages/ui/design-systems/<id>/` (via `openDesignFetchPlan`, respeitando `state.uiPackageDir`). Vale nos dois modos (PRD e Spec) e é gated no estágio FINAL. Aditivo e sem `state.designSystems` não emite nada — as contagens de artefato existentes (2/3/4) seguem intactas.
- **`SKILL.md` FINAL** instrui registrar o(s) `<id>` e o dir verbatim no `handoff.json` (role `design-system-files`); **`references/handoff-contract.md`** ganha a linha do role. 207 testes verdes (+5 em `artifacts.test.js`).
- **Sincronização de versão:** `package.json` estava em 2.8.1 e `plugin.json` em 2.8.2 — ambos agora em 2.8.3.

## [2.8.2] — 2026-06-23

### Correções do review e2e Open Design (4 GAPs)

- **`preview/` em vez de `preview/app.html` (GAP 1 — bug real):** dos ~152 systems curados do Open Design, só 1 traz `preview/app.html`; a maioria traz `preview/colors.html`, `preview/spacing.html` e `preview/typography.html`. O `od-fetch-system.mjs` já copiava o diretório inteiro corretamente via `copyTree`; o bug estava nas referências documentais que apontavam para um arquivo inexistente. Corrigido em: `OPEN_DESIGN.systemArtifacts` no `pensador-engine.mjs`, tabela de artefatos verbatim em `references/open-design.md`, e testes em `test/integrations.test.js` (202 testes verdes).
- **Handoff declara o diretório verbatim por contrato (GAP 2):** `references/handoff-contract.md` role `design-system` expandido para incluir `packages/ui/design-systems/<id>/` (com `tokens.css`, `components.html` e `preview/`) — não apenas o `design-system.md`. Elimina acoplamento por convenção tácita que quebraria silenciosamente se o caminho mudar.
- **`od-fetch-system.mjs` agora é descobrível (GAP 3):** adicionado à tabela de referências da `SKILL.md` e à seção "Leitura relacionada" de `references/open-design.md`. Um mantenedor lendo a documentação canônica agora encontra o script.
- **Localização do `OD_API_TOKEN` documentada (GAP 4):** nota adicionada a `references/open-design.md` — o token é gerado em `~/.open-design/deploy/.env` pelo script instalador; necessário apenas pelo fallback REST (`GET /api/design-systems/<id>` retorna 401 sem ele); o caminho primário (clone em disco) não precisa do token.

## [2.8.1] — 2026-06-22

### Correção — o 2.8.0 não estava "ligado" ao caminho de execução

O 2.8.0 adicionou os helpers (`openDesignFetchPlan`/`openDesignBriefRouting`/`openDesignDeliveryFor`) e reescreveu `references/open-design.md`, mas **a `SKILL.md` — que é o que o LLM realmente executa — continuava mandando o comportamento antigo** ("gera `design-system.md` via Open Design a partir do brief"). Além disso, `openDesignFetchPlan()` só **planeja** caminhos (o engine não faz I/O), então **nada copiava os arquivos**. Resultado: uma run em 2.8.0 ainda produzia só prosa (confirmado no projeto OficinaAI — nenhum `tokens.css`/`components.html` persistido).

- **Novo `scripts/od-fetch-system.mjs` (o mecanismo de I/O que faltava):** copia os arquivos **verbatim** de um system (`tokens.css`, `components.html`, `components.manifest.json`, `USAGE.md`, `DESIGN.md`, `preview/`) para `<ui-dir>/design-systems/<id>/`. Resolve a fonte por ordem: (1) clone em disco (`~/.open-design/design-systems/<id>/`, robusto), (2) REST `GET /api/design-systems/<id>` com `Bearer` (best-effort, sem fabricar endpoint). `tokens.css` e `DESIGN.md` são obrigatórios (exit ≠ 0 se faltarem). Importa `OPEN_DESIGN.systemArtifacts` do engine (DRY).
- **`SKILL.md` agora WIRA o fluxo novo:** o estágio **FINAL** instrui rodar `od-fetch-system.mjs` para persistir os verbatim, derivar o `tokens.css` do projeto por composição rastreável, e tornar o `design-system.md` um **documento de decisões** que referencia os arquivos (modo PRD) ou dobrar no change set (modo Spec: decisões no `design.md` + capability `specs/ui-design-system/`). O **BRAINSTORM_GERAL** passa a escolher o system e a rotear o brief (`openDesignBriefRouting`). Linhas de planejamento de artefatos corrigidas (Open Design roda nos dois modos quando `hasFrontend`).
- **Verificado contra o clone real:** o script copiou o system `agentic` (tokens.css + components.html + preview/) com exit 0. Suíte: **202 testes** verdes.

## [2.8.0] — 2026-06-21

### Open Design consumido como pipeline de artefatos (não como prosa) + integração no modo Spec

Causa raiz endereçada: versões anteriores puxavam **só o `DESIGN.md`** do Open Design e o re-escreviam em prosa no `design-system.md`, descartando `tokens.css`, `components.html` e `preview/`. O agente de front-end nunca via os tokens reais → tema chapado, magic numbers, anti-padrões (emoji como ícone, `borderRadius` inventado, accent espalhado).

- **Artefatos verbatim (`OPEN_DESIGN.systemArtifacts` + `openDesignFetchPlan()`):** o Pensador agora baixa e **persiste verbatim** todos os arquivos do system na read-order oficial do `USAGE.md` (`USAGE.md → DESIGN.md → tokens.css → components.html → components.manifest.json → preview/app.html`) em `packages/ui/design-systems/<id>/`. `tokens.css` é a **fonte de verdade** (colar antes de qualquer CSS); inventar token é proibido pelo skills-protocol do Open Design.
- **`design-system.md` vira documento de decisões:** deixa de duplicar tokens; passa a registrar seleção do system, merge e overrides justificados, **apontando** para `tokens.css`/`components.html`.
- **Roteamento do brief (`openDesignBriefRouting()`):** as 8 dimensões do `AskUserQuestion` deixam de virar prosa e são roteadas para destinos estruturados do Open Design — `selection` (escolha/import do system), `input` (`od.inputs`: conteúdo/componentes), `parameter` (`od.parameters`: `accent_hue`/`section_spacing`/…), `constraint` (gate WCAG AA).
- **Integração com o modo Spec/OpenSpec (`openDesignDeliveryFor()`):** o Open Design agora **também roda no modo Spec** (antes era excluído). Os arquivos verbatim continuam indo para o repo; as **decisões** entram na seção *Decisions* do `design.md` do change; e os **requisitos** de UI viram a capability delta-spec `specs/ui-design-system/spec.md` (requisitos `SHALL` + cenários `#### Scenario:`), dando ao review um critério de aceite formal. `planArtifacts` mantém `designSystem: false` no modo Spec (sem arquivo standalone) — Open Design roda mesmo assim.
- **Acesso a arquivo verificado:** documentado que os arquivos brutos vêm via MCP `get_file` ou cópia do clone Docker — **não** fabricar endpoint REST sem confirmar o payload de `/api/design-systems/<id>`.
- **Docs/testes:** `references/open-design.md` reescrito (passos 4-7 + read order + roteamento do brief + seção **Modo Spec**); `references/openspec.md` atualizado (exceção do design-system no modo Spec). Suíte: **202 testes** verdes (7 novos cobrindo `systemArtifacts`, `briefRouting`, `fetchPlan`, `deliveryFor`).

## [2.7.2] — 2026-06-18

### Open Design via CLI real + instalador Docker (opcional, via AskUserQuestion)

- **Novo script instalador** `scripts/install-open-design.ps1` (Windows) e `scripts/install-open-design.sh` (macOS/Linux): automatiza o caminho Docker do QUICKSTART — verifica `git`/`docker`/`docker compose`, clona `nexu-io/open-design`, gera `OD_API_TOKEN` em `deploy/.env` (idempotente, preserva token existente), sobe `docker compose up -d`, aguarda o daemon em `http://localhost:7456` e conecta o MCP. Parâmetros: `-Agent`/`--agent`, `-Port`/`--port`, `-McpConfig`/`--mcp-config`, `-McpName`/`--mcp-name`, `-SkipMcp`/`--skip-mcp`.
- **Auto-wiring do MCP nos dois cenários** via novo helper `scripts/od-mcp-config.mjs`: com `od` no host usa o nativo `od mcp install <agent>`; no modo Docker (sem `od`) busca a spec canônica do daemon em `GET /api/mcp/install-info` e faz merge da entrada `mcpServers.<nome>` no `.mcp.json`, preservando o resto do arquivo (usa Node, sem `jq`/`python`). Ressalva documentada: o bridge stdio do `od mcp` precisa do `od` no host para subir; sem ele, o Pensador usa a API REST do daemon (`/api/design-systems`).
- **Fluxo do Pensador atualizado:** quando a demanda tem front-end e o Open Design não é detectado, o `AskUserQuestion` oferece **(A) instalar via Docker** (o Claude roda o script) ou **(B) `design-system.md` inline**. Após a instalação, o Pensador aciona o Open Design pelos **verbos reais**.
- **Correção de modelo:** o `od mcp install <agent>` **existe** e é o passo real de wiring do MCP (a entrada anterior do 2.7.1 dizia o contrário). O que de fato não existe é o instalador de uma linha `open-design.ai/install.sh` (404). Esclarecido também que o Open Design **não sintetiza** um DESIGN.md a partir de um brief: ele **cura/importa** systems (`od design-systems list/show/import-github/import-shadcn`) e o Pensador consolida o DESIGN.md escolhido em `design-system.md`. No modo Docker (sem `od` no host), os mesmos dados vêm da API do daemon (`/api/design-systems`).
- **Descritor `OPEN_DESIGN` (`pensador-engine.mjs`):** `installCommands` agora expõe `scriptWindows`/`scriptUnix`/`docker`/`local`/`mcp`; `commands` traz os verbos reais (`designSystemsList`, `designSystemShow`, `importGithub`, `importShadcn`, `mcpInstall`) e os equivalentes REST (`apiDesignSystems`, `apiDesignSystemById`). Removidos os verbos fictícios (`od skill list`, `od plugin apply`, `od get-file`, `od get-artifact`).
- **Docs/preflight/testes** atualizados em conjunto (`open-design.md`, `agent-stack.md`, `commands/pensador.md`, `preflight.mjs`, `README*`). Suíte: 195 testes verdes.

## [2.7.1] — 2026-06-18

### Correção — instalação/detecção do Open Design

- **Falso positivo de detecção corrigido (`preflight.mjs`):** o GNU coreutils instala um binário `od` (octal-dump) em quase todo sistema Unix-like, e `checkCli("od")` o aceitava como sucesso, reportando o Open Design como disponível quando não estava. O `checkOpenDesign()` agora filtra a assinatura "GNU coreutils" do `od --version`; a detecção confiável passa a ser a **entrada MCP registrada**, e só um `od` não-coreutils no PATH é honrado.
- **Comandos de instalação inexistentes removidos:** o `curl -fsSL https://open-design.ai/install.sh | sh -s <agent>` retornava **404** (endpoint fora do ar) e o `od mcp install` **não existe**. O Open Design é um app **local-first** (daemon + web/desktop) — agora os artefatos apontam para os métodos reais do [QUICKSTART](https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md): **Docker** (`docker compose up -d`, app em http://localhost:7456) ou **pnpm** (`pnpm tools-dev run web`, Node 24 + pnpm 10.33).
- **Descritor `OPEN_DESIGN` (`pensador-engine.mjs`) atualizado:** `installCommands` agora expõe `docker`/`local`; os subcomandos fictícios `od skill list` / `od plugin apply` / `od get-file` / `od get-artifact` foram substituídos por `commands.daemonBuild` / `commands.toolsDev`, alinhados ao CLI real (`apps/daemon/dist/cli.js`).
- **Docs atualizadas:** `references/open-design.md`, `references/agent-stack.md`, `README.md` e `README.pt-BR.md` descrevem a detecção (com o aviso do falso positivo do coreutils) e a instalação local-first real.
- **Testes:** `test/integrations.test.js` agora valida os comandos reais e impede o retorno das strings fictícias. Suíte total: 195 testes verdes.

## [2.7.0] — 2026-06-18

### PRD abrangente (anti-truncamento)

- **`Strict_PRD_Schema` expandido de 10 para 17 seções obrigatórias**, cobrindo o produto inteiro na profundidade de sistemas modernos: adiciona **Escopo**, **Design System & UI/UX**, **Modelo de Dados & Domínio**, **Contratos de API & Integrações**, **Segurança/Privacidade & Conformidade (LGPD, papéis, multitenancy)**, **Observabilidade & Operação** e **Riscos & Mitigações**.
- Nova **diretriz de exaustividade (anti-truncamento)**: o PRD não tem teto de tamanho; todo gap (regra de negócio ou tecnologia) deve ser resolvido ou marcado exatamente como `"TBD"`. Proíbe placeholders rasos em Design System, Modelo de Dados e Contratos de API.
- `skills/prd/SKILL.md` e `skills/pensador/assets/prd-template.md` reescritos para as 17 seções, com IDs adicionais (`ENT-`, `EP-`) e referências cruzadas.

### Integração com o Open Design (sistema de design)

- Nova integração **opcional e condicional a front-end** com o **[Open Design](https://github.com/nexu-io/open-design)** (`od`, MCP + CLI) para fechar a lacuna de design (sem design system/tokens, a UI vira template genérico).
  - Quando `hasFrontend`, o **BRAINSTORM_GERAL** parseia um **brief de design** via `AskUserQuestion` (tom visual, marca/referências, paleta, tipografia, estados de componente, responsividade, acessibilidade, microcopy — `openDesignBriefPlan()`).
  - O **FINAL** gera o novo artefato `design-system.md` (DESIGN.md de 9 seções) via Open Design a partir do brief; modo PRD apenas, quando `hasFrontend`.
  - Detecção via preflight; indisponível quando há front-end: o Pensador oferece instalação via `AskUserQuestion` (igual ao Code Base Memory) — `curl -fsSL https://open-design.ai/install.sh | sh -s <agent>` + `od mcp install <agent>` — ou cai para um `design-system.md` inline. Nunca bloqueia e não altera o `status` do preflight.
  - Novo role de handoff `design-system` no contrato Pensador→Orchestrador.

### Engine (`pensador-engine.mjs`)

- Novos exports puros e testados:
  - `OPEN_DESIGN` (descritor: CLI `od`, comandos de instalação, schema DESIGN.md de 9 seções, arquivo `design-system.md`).
  - `designSystemArtifactPath()` — caminho do artefato sob `<featurePath>/`.
  - `openDesignBriefPlan()` — dimensões do brief de design a parsear.
- `planArtifacts()` / `buildArtifactList()`: no modo PRD planejam `design-system.md` quando `hasFrontend` (`plan.designSystem`); modo Spec inalterado.
- Typedefs `ArtifactPlan` e `Artifact` atualizados (kind `design-system`).

### Preflight (`preflight.mjs`)

- Novo bloco `integrations.openDesign` (opcional, `relevantWhen: hasFrontend`) com disponibilidade, origem da detecção, comandos de instalação e fallback. Continua saindo sempre com código 0; não afeta o `status`.

### Documentação

- Nova referência `skills/pensador/references/open-design.md`.
- `SKILL.md`, `stages.md`, `skill-stack.md`, `agent-stack.md`, `askuserquestion-protocol.md`, `openspec.md`, `ui-ux-pro-max/SKILL.md`, `frontend-design/SKILL.md`, `feature-isolation.md`, `handoff-contract.md`, `commands/pensador.md`, `README.md` e `README.pt-BR.md` atualizados para o Open Design, o artefato/role `design-system` e o PRD de 17 seções. As lentes `ui-ux-pro-max` e `frontend-design` deixaram de citar os estágios legados `UIUX`/`FRONTEND` e passaram a se descrever como lentes do `BRAINSTORM_GERAL`.

### Testes

- `test/integrations.test.js` ganhou cobertura do Open Design (descritor, `designSystemArtifactPath`, `openDesignBriefPlan`, planejamento gated por front-end). `test/artifacts.test.js` atualizado para o artefato `design-system`. Suíte total: 195 testes verdes.

## [2.6.0] — 2026-06-17

### Mudança de Estágios (STAGE_ORDER)

- **Novo estágio `EXPLORE`** inserido logo após `INIT`. `STAGE_ORDER` passou de 10 para **11 estágios**:
  `INIT → EXPLORE → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE`.
- `CHECKPOINT_VERSION` permanece `2` (o campo `artifactMode` ausente em checkpoints antigos resolve para `prd`).

### Novas Funcionalidades

#### Code Base Memory (obrigatório) — estágio EXPLORE
- Suporte ao **Code Base Memory** ([codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)) como exploração **obrigatória** do projeto, agora em um estágio dedicado `EXPLORE` (entre `INIT` e `PRD_BASE`).
  - Sequência `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (e `detect_changes` em fixes); grava o snapshot `<featurePath>/codebase-memory.md`.
  - O `ARCH` reaproveita o índice criado no `EXPLORE`, complementando com `Read`/`Glob`/`Grep`.
  - Indisponível: o Pensador pergunta via `AskUserQuestion` se deve instalar o servidor ou cair para `Read`/`Glob`/`Grep`. Não bloqueia o fluxo.

#### OpenSpec (opcional) — via comandos `openspec-*`
- Suporte opcional ao **OpenSpec** ([OpenSpec](https://github.com/Fission-AI/OpenSpec)).
  - Quando o preflight detecta o OpenSpec (CLI `openspec` no PATH ou diretório `openspec/`), o `INIT` pergunta via `AskUserQuestion` se o usuário quer gerar um **PRD** (padrão) ou uma **Spec** estruturada.
  - No modo Spec, a fase `PRD_BASE` passa a **acionar os comandos `openspec-*`** (`/openspec-new-change`, `/openspec-ff-change`, …) — o Pensador nunca escreve os arquivos manualmente. O change set (`proposal.md`, `design.md`, `tasks.md`, `specs/`) vive em `openspec/changes/<nome>/`.
  - O modo Spec entrega **apenas** o change set OpenSpec: `userhistory.md` e `comunication_json.md` não se aplicam.
  - Se os comandos `openspec-*` estiverem indisponíveis, o Pensador pergunta via `AskUserQuestion` se deve cair para PRD ou abortar — sem montar a estrutura manualmente. O prefixo legado `/opsx:*` está descontinuado.
  - O `FINAL` roda `/openspec-verify-change` e orienta o handoff com `/openspec-apply-change`, `/openspec-sync-specs` e `/openspec-archive-change`.

#### Engine (`pensador-engine.mjs`)
- `STAGE_ORDER` inclui `EXPLORE`; `Stage` typedef atualizado.
- Novos exports puros e testados:
  - `CODEBASE_MEMORY`, `codebaseMemorySnapshotPath()`, `codebaseMemoryExplorationPlan()`.
  - `ARTIFACT_MODES` / `DEFAULT_ARTIFACT_MODE`, `resolveArtifactMode()`, `withArtifactMode()`.
  - `OPENSPEC` (comandos `openspec-*`), `openspecChangeName()`, `openspecChangeDir()`.
  - `initState()` passa a incluir `artifactMode: 'prd'`.
  - `planArtifacts()` / `buildArtifactList()`: no modo Spec retornam apenas o change set OpenSpec (`proposal`/`design`/`tasks`/`specs`) sob `openspec/changes/<nome>/` (`managedBy: 'openspec'`); o modo PRD permanece idêntico.

#### Preflight (`preflight.mjs`)
- Novo bloco `integrations` no relatório: `codebaseMemory` (obrigatório) e `openspec` (opcional), com disponibilidade, origem da detecção e comportamento de fallback. A ausência do Code Base Memory degrada o status para `partial`; OpenSpec é puramente opcional. Continua saindo sempre com código 0.

### Documentação
- Novas referências `skills/pensador/references/codebase-memory.md` e `skills/pensador/references/openspec.md`.
- `SKILL.md`, `stages.md`, `feature-isolation.md`, `askuserquestion-protocol.md`, `commands/pensador.md`, `README.md` e `README.pt-BR.md` atualizados para o estágio `EXPLORE`, os 11 estágios e o modo Spec via comandos `openspec-*`.

### Testes
- Novo `test/integrations.test.js` (Code Base Memory, artifact mode, OpenSpec via `openspec-*`, spec-mode artifacts em `openspec/changes/`). Suíte total: 184 testes verdes.

## [2.5.0] — 2026-06-11

### Novas Funcionalidades

#### Modos de execução (`--modo`)
- Novo eixo de execução **ortogonal** às lentes de domínio: define qual motor realiza o trabalho pesado do fluxo (PRD base, expansão, síntese de análises, geração de artefatos).
  - `--modo claude` (padrão): o Claude Code executa o fluxo com os próprios tokens.
  - `--modo agy`: delega via `/cc-antigravity-plugin:antigravity` (padrão `--model claude-4.6-opus-thinking`).
  - `--modo kiro`: delega via `/cc-kiro-plugin:kiro` (padrão `--model claude-opus-4.8 --effort high`).
  - `--modo codex`: delega via `/codex:rescue` (padrão `--effort high`).
- **Invariante preservada:** em qualquer modo, todo diálogo com o usuário continua passando exclusivamente por `AskUserQuestion`. O motor externo nunca conversa com o usuário; só produz rascunhos/análises que o Pensador relê e consolida.
- Objetivo: baratear a geração de artefatos transferindo o custo para a quota da CLI externa, mantendo o Claude apenas como orquestrador.
- Sobrescritas `--model` (agy/kiro) e `--effort` (codex; `xhigh`/`extrahigh` → `high`); `--modo` desconhecido cai para `claude` com aviso.

#### Engine (`pensador-engine.mjs`)
- Novos exports puros e testados:
  - `EXECUTION_MODES` / `DEFAULT_EXECUTION_MODE` — registro dos modos.
  - `parseExecutionMode(rawArgs)` — extrai `--modo`/`--model`/`--effort` e devolve a `demanda`.
  - `resolveExecutionMode(mode, overrides)` — resolve o motor + parâmetro efetivo.
  - `buildDelegationInvocation(mode, payload)` — constrói o slash command de delegação com prompt JSON-quoted.

#### Preflight (`preflight.mjs`)
- Aceita `--modo <modo>` e adiciona o bloco `executionMode` ao relatório (disponibilidade do motor + fallback).
- Passa a checar o plugin do Kiro (`cc-kiro-plugin`) além de Codex e AGY. Continua saindo sempre com código 0.

#### Plugin
- `cc-kiro-plugin` adicionado como dependência cross-marketplace (junto a `cc-antigravity-plugin` e `openai-codex`).
- Versão do plugin elevada para `2.5.0`.

### Documentação
- Nova referência `skills/pensador/references/execution-modes.md`.
- `SKILL.md`, `stages.md`, `agent-stack.md`, `commands/pensador.md` e `README.md` atualizados para os modos de execução (parsing no INIT, delegação por estágio via `SlashCommand`).

### Testes
- Novo `test/execution-modes.test.js` (parse/resolve/buildDelegationInvocation). Suíte total: 161 testes verdes.

## [Unreleased]

- **Pasta de artefatos versionada por demanda** - os artefatos agora ficam em `.pensador/<slug-da-demanda>-vN/`, diretamente nessa pasta. Ex.: `/pensador desenvolva uma pagina de clientes` -> `.pensador/pagina-clientes-v1/`.

## [2.0.0] — 2026-06-05

### Breaking Changes

- **`STAGE_ORDER`** — alterado de 11 para 10 estágios. Os estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos; substituídos por `ARCH`, `COMPLEXITY` e `BRAINSTORM_GERAL`.
  - v1: `INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE`
  - v2: `INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE`

- **`CHECKPOINT_VERSION`** — elevado de `1` para `2`. Checkpoints v1 (gravados em `pensador-output/.pensador-progress.json`) são incompatíveis com v2. O Pensador detecta a incompatibilidade no INIT e oferece iniciar um novo fluxo v2.

- **Pasta de artefatos** — no v2, os artefatos ficam em `.pensador/<slug-da-demanda>-vN/`. Saídas legadas da v1 não são movidas automaticamente.

- **`REQUIREMENT_STAGES`** — alterado de `['EXPAND','CLARITY','BACKEND','UIUX','FRONTEND','CODEX','AGY']` para `['EXPAND','BRAINSTORM_GERAL','CODEX','AGY']`.

### Novas Funcionalidades

#### Estágio ARCH (análise de arquitetura)
- Varre o projeto via `Read`/`Glob`/`Grep` antes de expandir requisitos.
- Detecta linguagem, estrutura, padrões arquiteturais, design system, entrypoints e integrações.
- Modo greenfield: entrevista de preferências quando não há base de código relevante.
- Suporte a monorepos: lista sub-projetos e confirma escopo.
- Grava `<featurePath>/architecture.md` com retrato da arquitetura, sinais de complexidade e lacunas técnicas.

#### Estágio COMPLEXITY (heurística de complexidade)
- Calcula score (0–4) com `detectComplexity(signals)` usando quatro sinais binários:
  - `domainCount > 1`, `hasBackend`, `hasBroadScopeKeywords`, `isGreenfield`
- Score 0–1 → sugere **Lite** (fluxo enxuto); score ≥ 2 → sugere **Completo** (fluxo integral).
- Desempate sempre resolve para Completo.
- Usuário sempre confirma ou altera o modo via `AskUserQuestion`.

#### Estágio BRAINSTORM_GERAL (brainstorm paralelo por domínio)
- Substitui os quatro estágios autônomos de brainstorm.
- Roteamento por domínio:
  - `requirements-clarity` — sempre (clareza de requisitos)
  - `codex:codex-rescue` `--effort high` — quando `hasBackend = true`
  - `cc-antigravity-plugin:antigravity-agent` `gemini-3.1-pro-high` — quando `hasFrontend = true`
- Contrato de arquivos em `shared-agents/`:
  - `context-pack.md` — gravado pelo orquestrador antes do dispatch
  - `<agent>.response.md` — resposta de cada participante
- Fallback por domínio: domínio falho não aborta os demais; pergunta de fallback via `AskUserQuestion`.

#### Isolamento por feature
- Cada execução cria (ou retoma) `.pensador/<slug-da-demanda>-vN/` com `shared-agents/` e artefatos finais diretamente na pasta.
- Versionamento local por demanda: primeira execução usa `-v1`; novas execuções com o mesmo slug usam `-v2`, `-v3`, ...
- `allocateFeatureDir(existingFeatureDirs, options)` — função pura no engine.
- `buildFeaturePath(featureDir, subdir)` — constrói caminhos derivados do `featurePath`.
- Retomada: no INIT, checkpoint v2 incompleto detectado → `AskUserQuestion` (retomar ou novo fluxo).

#### Melhorias de UX (AskUserQuestion)
- Opção recomendada sempre em primeiro lugar com sufixo "(Recomendado)".
- Previews para opções com artefatos concretos.
- Recap final antes do FINAL: resumo de todas as decisões do fluxo.
- Handoff por complexidade ao encerrar.
- PT-BR como idioma padrão dos artefatos.

### Mudanças no Engine (`pensador-engine.mjs`)

Novos exports públicos:
- `detectComplexity(signals)` — heurística determinística de complexidade
- `allocateFeatureDir(existingFeatureDirs, options)` — alocação de diretório por feature
- `buildFeaturePath(featureDir, subdir)` — construção de caminhos derivados

Outros:
- `initState()` agora inclui campo `featurePath: null`
- `buildArtifactList()` usa `state.featurePath` como basePath (fallback: `.pensador/atualizacao-v1/`)
- `deserializeState()` retorna `null` para checkpoints com `version !== 2`

### Testes

- Suíte expandida de 102 para 131 testes (100% verde).
- Novos arquivos:
  - `test/engine-complexity.test.js` — unitários + property-based (fast-check) para `detectComplexity`
  - `test/feature-isolation.test.js` — `allocateFeatureDir` e `buildFeaturePath`
- Atualizados: `test/smoke.test.js`, `test/consolidate.test.js`, `test/artifacts.test.js`, `test/docs-consistency.test.js`

### Guia de Migração

1. **Checkpoints v1** (`pensador-output/.pensador-progress.json`): não são convertidos automaticamente. O Pensador v2 detecta e oferece iniciar novo fluxo.
2. **Saídas legadas v1**: permanecem intactas; o v2 nunca grava artefatos fora de `.pensador/<slug-da-demanda>-vN/`.
3. **`.gitignore`**: adicionar `.pensador/` se ainda não estiver presente.
4. **Scripts customizados** que importavam `STAGE_ORDER` ou `REQUIREMENT_STAGES` precisam ser atualizados para os novos valores.

---

## [1.0.0] — 2025 (baseline)

- Fluxo de 8 estágios: PRD_BASE, EXPAND, CLARITY, BACKEND, UIUX, FRONTEND, CODEX, AGY, FINAL.
- Artefatos em pasta raiz legada.
- `CHECKPOINT_VERSION = 1`.
