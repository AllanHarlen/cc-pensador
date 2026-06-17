# cc-pensador

> Plugin de Claude Code que conduz uma demanda em linguagem natural por **onze estágios de trabalho** até um PRD de alta qualidade — com exploração via Code Base Memory, análise de arquitetura, heurística de complexidade, brainstorm geral por domínio e refinamento por subagentes (Codex e AGY/Gemini). Opcionalmente delega o trabalho pesado a uma CLI externa (Antigravity, Kiro ou Codex) via `--modo`, economizando tokens do Claude.

`versão 2.6.0` · `categoria: planning` · todo diálogo passa **exclusivamente** por `AskUserQuestion`.

## Sumário

- [Visão geral](#visão-geral)
- [Fluxo de estágios](#fluxo-de-estágios)
- [Artefatos gerados](#artefatos-gerados)
- [Isolamento por feature](#isolamento-por-feature)
- [Instalação](#instalação)
- [Uso](#uso)
- [Modos de execução (`--modo`)](#modos-de-execução---modo)
- [Code Base Memory (exploração obrigatória)](#code-base-memory-exploração-obrigatória)
- [OpenSpec (modo Spec opcional)](#openspec-modo-spec-opcional)
- [Modos Lite e Completo](#modos-lite-e-completo)
- [Preflight](#preflight)
- [Gates de avanço](#gates-de-avanço)
- [Engine de referência e testes](#engine-de-referência-e-testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Migração da v1](#migração-da-v1)

## Visão geral

O `cc-pensador` distribui o **Pensador v2**: a skill `pensador` e o comando `/pensador` para o Claude Code. A partir de uma demanda em linguagem natural, o Pensador analisa a arquitetura do projeto, calcula complexidade e orquestra seis lentes de domínio em paralelo (clareza de requisitos, backend, UI/UX, frontend, refinamento técnico e varredura de produto) para produzir um PRD consolidado e de alta fidelidade com artefatos de suporte.

**Invariante central:** todo diálogo entre os agentes e o usuário passa **exclusivamente** pela ferramenta `AskUserQuestion`. Nenhum estágio conversa por outro canal.

Por padrão (`--modo claude`), o Claude Code executa o fluxo com os próprios tokens. Com `--modo agy`, `--modo kiro` ou `--modo codex`, o Claude vira um orquestrador fino e delega o trabalho pesado a uma CLI externa — veja [Modos de execução](#modos-de-execução---modo).

## Fluxo de estágios

```
INIT → EXPLORE → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

O funil vai de **iniciar/retomar → PRD base → arquitetura → ampliar → calibrar complexidade → brainstorm por domínio → varredura técnica → varredura de produto → consolidar → entregar.**

| Estágio | O que faz | Delegação | Relevância |
|---|---|---|---|
| **INIT** | Verifica retomada de checkpoint v2, aloca feature dir, obtém demanda, pergunta PRD vs Spec quando OpenSpec é detectado. | — | sempre |
| **EXPLORE** | Explora o projeto com Code Base Memory (`index_repository → get_architecture → search_graph → trace_path`); grava `codebase-memory.md`. Fallback para Read/Glob/Grep se indisponível. | MCP `codebase-memory-mcp` | sempre |
| **PRD_BASE** | Gera PRD base pelo `Strict_PRD_Schema` (ou escala os comandos `openspec-*` para montar o change set no modo Spec). Sem perguntas ao usuário; avanço automático. | skill `prd` / `openspec-*` | sempre |
| **ARCH** | Analisa arquitetura (reaproveita o índice do Code Base Memory + Read/Glob/Grep); grava `architecture.md`. Entrevista greenfield se necessário. | — | sempre |
| **EXPAND** | Amplia demanda com requisitos candidatos (perguntas do Pensador). | — | sempre |
| **COMPLEXITY** | Calcula score por `detectComplexity()`; propõe Lite ou Completo; usuário confirma. | — | sempre |
| **BRAINSTORM_GERAL** | Orquestra lentes de domínio em paralelo: requirements-clarity + Codex se backend + AGY se frontend. | skill `requirements-clarity` · `codex:codex-rescue` · AGY | sempre |
| **CODEX** | Refinamento técnico dedicado com `effort high`. Não participa em atividade específica de front-end (`hasFrontend` sem `hasBackend`). | `codex:codex-rescue` | exceto front-end específico |
| **AGY** | Varredura final de lacunas de produto. | `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-high`) | sempre |
| **FINAL** | Aplica `withConsolidated`, confirma back-end, gera artefatos, apresenta recap e handoff. | — | sempre |
| **DONE** | Estado terminal. | — | — |

> O BRAINSTORM_GERAL substitui os antigos estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND`. Eles agora são lentes de domínio orquestradas em paralelo dentro de um único estágio.

## Artefatos gerados

Todos gravados diretamente sob `.pensador/<slug-da-demanda>-vN/`. Confirma sobrescrita via `AskUserQuestion` se o arquivo já existir.

- `prd.md` — PRD final consolidado, estruturado conforme o Strict PRD Schema. *(modo PRD)*
- `openspec/changes/<name>/` — change set OpenSpec (`proposal.md`, `design.md`, `tasks.md`, `specs/`), montado pelos comandos `openspec-*`. *(modo Spec)*
- `userhistory.md` — Jornada do usuário em passos sequenciais. *(só no modo PRD)*
- `comunication_json.md` — Contrato de comunicação/API em JSON. *(modo PRD, quando houver back-end)*
- `codebase-memory.md` — Snapshot da exploração do Code Base Memory. *(sempre, em `<featurePath>/`)*
- `architecture.md` — Retrato da arquitetura detectada no estágio ARCH. *(sempre, em `<featurePath>/`)*

## Isolamento por atualização

Cada execução do Pensador cria (ou retoma) um diretório isolado, nomeado pelo slug curto da demanda recebida com sufixo de versão:

```
.pensador/
└── <slug-da-demanda>-vN/          ← ex.: login-social-v1
    ├── .pensador-progress.json    ← checkpoint v2
    ├── architecture.md
    ├── shared-agents/             ← troca entre subagentes
    │   ├── context-pack.md
    │   ├── requirements-clarity.response.md
    │   ├── codex.response.md
    │   └── agy.response.md
    ├── prd.md                     ← artefatos finais
    ├── userhistory.md
    └── comunication_json.md
```

`<slug>` é o nome curto da demanda recebida normalizado (minúsculas, sem acentos, hifenizado); `-vN` é a versão local da mesma demanda (`v1` na primeira execução, depois `v2`, `v3`, ...). Fallback `atualizacao-v1`. No `INIT`, se houver checkpoint v2 incompleto, o Pensador oferece retomada via `AskUserQuestion`.

## Instalação

### 1 · Instalar o cc-pensador

```text
/plugin marketplace add AllanHarlen/cc-pensador
/plugin install cc-pensador@cc-pensador
/reload-plugins
```

### 2 · Dependências: Codex e AGY

O Pensador delega aos subagentes **Codex** (estágios BRAINSTORM_GERAL e CODEX) e **AGY** (estágios BRAINSTORM_GERAL e AGY) — ambos declarados como dependências do plugin.

**Codex** — plugin oficial:

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

**AGY** — o Pensador espera o `cc-antigravity-plugin` instalado, com estes arquivos presentes:

- `agents/antigravity-agent.md`
- `commands/antigravity.md`
- `scripts/antigravity-bridge.js`

> Se um subagente estiver ausente, o Pensador detecta no [preflight](#preflight) e pergunta (via `AskUserQuestion`) se deve prosseguir sem ele.

### 3 · Opcional: Kiro (para `--modo kiro`)

O modo de execução `--modo kiro` delega o trabalho pesado ao **Kiro CLI** via o plugin `cc-kiro-plugin`:

```text
/plugin marketplace add AllanHarlen/cc-kiro-plugin
/plugin install cc-kiro-plugin
/reload-plugins
```

Instale e autentique a Kiro CLI (`curl -fsSL https://cli.kiro.dev/install | bash` ou, no Windows, `irm 'https://cli.kiro.dev/install.ps1' | iex`; depois `kiro-cli login`). Os modos `--modo agy` e `--modo codex` reaproveitam os plugins `cc-antigravity-plugin` e `openai-codex` já instalados acima.

> Os três plugins (`cc-antigravity-plugin`, `openai-codex`, `cc-kiro-plugin`) são declarados como dependências cross-marketplace. Se o motor do `--modo` escolhido estiver ausente, o Pensador oferece cair para `--modo claude` via `AskUserQuestion`.

## Uso

```text
/pensador [--modo claude|agy|kiro|codex] [--model <id>] [--effort <nível>] <demanda>
```

Exemplo:

```text
/pensador Crie uma tela de login para os usuários
/pensador --modo kiro Crie uma tela de login para os usuários
/pensador --modo agy --model claude-4.6-opus-thinking Construir API de pagamentos
```

Se `<demanda>` for omitida, o Pensador a solicita via `AskUserQuestion` antes de iniciar o estágio **PRD_BASE**.

## Modos de execução (`--modo`)

O **modo de execução** define **qual motor executa o trabalho pesado** do fluxo (redigir o PRD base, expandir requisitos, sintetizar análises e gerar artefatos). É **ortogonal** às lentes de domínio (Codex/AGY/skills dentro dos estágios). Por padrão, o Claude Code faz tudo e gasta os próprios tokens; um modo delegado transfere esse custo para a quota da CLI externa, mantendo o Claude apenas como orquestrador.

| Modo | Quem trabalha | Slash command de delegação | Parâmetro padrão |
|---|---|---|---|
| `--modo claude` (padrão) | Claude Code | — | — |
| `--modo agy` | Antigravity CLI | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `--modo kiro` | Kiro CLI | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `--modo codex` | Codex CLI | `/codex:rescue` | `--effort high` |

- **Invariante preservada:** em qualquer modo, todo diálogo com o usuário continua passando **exclusivamente** por `AskUserQuestion`. O motor externo só produz rascunhos/análises; o Pensador relê, consolida e transforma decisões em perguntas.
- Sobrescritas: `--model <id>` (agy/kiro) e `--effort <nível>` (kiro/codex; `xhigh`/`extrahigh` → `high`).
- `--modo` desconhecido cai para `claude` com aviso via `AskUserQuestion`.
- O preflight é executado com `--modo <modo>`; se o motor estiver indisponível, o Pensador oferece cair para `--modo claude`.

Detalhes completos em `skills/pensador/references/execution-modes.md`. Mapeamento determinístico em `scripts/pensador-engine.mjs` (`EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`).

## Code Base Memory (exploração obrigatória)

Antes de redigir o PRD/Spec base, o Pensador explora o projeto existente com o **[Code Base Memory](https://github.com/DeusData/codebase-memory-mcp)** (`codebase-memory-mcp`, um servidor MCP), para que o artefato reflita a estrutura real sobre a qual a feature/fix vai atuar.

- Roda no fim do **INIT** (após alocar o feature dir), com `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (mais `detect_changes` em fixes). O resumo é gravado em `<featurePath>/codebase-memory.md`.
- O **ARCH** reaproveita o mesmo índice e complementa com Read/Glob/Grep.
- Detectado pelo preflight (CLI no PATH ou entrada de MCP em `.mcp.json`). Indisponível: o Pensador pergunta via `AskUserQuestion` se deve instalar o servidor ou cair para Read/Glob/Grep — nunca bloqueia.

Instalação: `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash` (ou `install.ps1` no Windows), depois reinicie o agente. Veja `skills/pensador/references/codebase-memory.md`.

## OpenSpec (modo Spec opcional)

O Pensador integra opcionalmente o **[OpenSpec](https://github.com/Fission-AI/OpenSpec)**. Quando o preflight detecta o OpenSpec (CLI `openspec` no PATH ou diretório `openspec/`), o **INIT** pergunta via `AskUserQuestion` se o usuário quer gerar um **PRD** (padrão) ou uma **Spec** estruturada.

- Escolhendo **Spec**, o estágio `PRD_BASE` passa a escalar os **comandos `openspec-*`** (`/openspec-new-change`, `/openspec-ff-change`, …), que montam o change set (`proposal.md`, `design.md`, `tasks.md`, `specs/`) em `openspec/changes/<name>/`. O Pensador nunca escreve esses arquivos manualmente. Todas as fases seguintes raciocinam sobre a spec.
- O modo Spec entrega **apenas** o change set OpenSpec — `userhistory.md` e `comunication_json.md` não se aplicam.
- A `STAGE_ORDER` não muda — `PRD_BASE` mantém o id e só seu comportamento/artefatos diferem (`artifactMode` ortogonal).
- O FINAL roda `/openspec-verify-change` e orienta o handoff para `/openspec-apply-change` / `/openspec-sync-specs` / `/openspec-archive-change`.
- Se os comandos `openspec-*` estiverem indisponíveis quando Spec for escolhido, o Pensador pergunta (via `AskUserQuestion`) se deve cair para o modo PRD ou abortar — não monta a estrutura manualmente. O prefixo legado `/opsx:*` está descontinuado.

Instalação: `npm install -g @fission-ai/openspec@latest` e depois `openspec init`. Veja `skills/pensador/references/openspec.md`.

## Modos Lite e Completo

No estágio **COMPLEXITY**, o Pensador calcula um score (0–4) com base em quatro sinais:

| Sinal | +1 quando |
|---|---|
| `domainCount > 1` | há mais de um domínio funcional/técnico |
| `hasBackend` | há API, dados, auth, jobs ou servidor |
| `hasBroadScopeKeywords` | termos amplos: plataforma, multiusuário, compliance, pagamentos |
| `isGreenfield` | ARCH não encontrou base existente |

- **Score 0–1 → sugestão Lite:** fluxo enxuto, menos perguntas por domínio.
- **Score ≥ 2 → sugestão Completo:** fluxo integral, todos os domínios.
- O usuário sempre confirma ou altera o modo via `AskUserQuestion`.

## Preflight

O comando `/pensador` executa um preflight antes de iniciar o fluxo, informando o modo de execução escolhido:

```bash
node scripts/preflight.mjs --modo <claude|agy|kiro|codex>
```

Ele inspeciona o cache de plugins do Claude Code para verificar a disponibilidade dos subagentes de domínio (Codex e AGY) e do **motor de execução** do `--modo` (Antigravity, Kiro ou Codex), e emite um JSON com o bloco `executionMode`, o bloco `integrations` (obrigatório `codebaseMemory` + opcional `openspec`) e o campo `status` (`ok` | `partial` | `unavailable`). O script **sempre sai com código 0**.

## Gates de avanço

O Pensador não avança para o próximo estágio enquanto houver perguntas sem resposta registrada no estágio atual. Um estágio sem perguntas satisfaz o gate e avança imediatamente. Os artefatos finais são gerados somente no estágio **FINAL**.

## Engine de referência e testes

O `scripts/pensador-engine.mjs` é a **especificação determinística de referência** do fluxo: máquina de estados, gates, mapeamentos de effort/modelo, modos de execução (`EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`), `detectComplexity`, `allocateFeatureDir`, `buildFeaturePath`, `classifyProject`, `consolidate`/`withConsolidated`, planejamento de artefatos e serialização de checkpoint v2. É um módulo puro — sem I/O, mesmas entradas → mesmas saídas — exercido pela suíte de testes.

> **Importante:** o engine **não é importado em runtime**. A skill é Markdown interpretado pelo LLM. O único script executado por shell é o `preflight.mjs`.

```bash
npm install
npm test       # Vitest — smoke · engine-complexity · feature-isolation · consolidate · artifacts · execution-modes · integrations · docs-consistency
```

## Estrutura do projeto

```
cc-pensador/
├─ .claude-plugin/
│  ├─ plugin.json            # manifesto do plugin (nome, versão, dependências)
│  └─ marketplace.json       # entrada de marketplace
├─ commands/
│  └─ pensador.md            # comando /pensador (orquestra os 11 estágios + --modo)
├─ skills/
│  ├─ pensador/
│  │  ├─ SKILL.md            # skill principal: protocolo v2 + gates + isolamento por feature + modos de execução
│  │  ├─ references/
│  │  │  ├─ stages.md                    # comportamento detalhado de cada estágio
│  │  │  ├─ feature-isolation.md         # .pensador/<slug-da-demanda>-vN/, allocateFeatureDir(), shared-agents/
│  │  │  ├─ agent-stack.md               # Codex/AGY/Kiro, roteamento BRAINSTORM_GERAL, motores de execução
│  │  │  ├─ skill-stack.md               # skills como lentes de domínio
│  │  │  ├─ execution-modes.md           # modos --modo (claude/agy/kiro/codex), parsing, preflight, delegação
│  │  │  ├─ codebase-memory.md           # Code Base Memory (MCP) obrigatório: exploração antes do PRD/Spec
│  │  │  ├─ openspec.md                  # OpenSpec opcional: escolha PRD vs Spec no INIT
│  │  │  └─ askuserquestion-protocol.md  # canal único, previews, recap final, handoff
│  │  └─ assets/                         # templates: prd · userhistory · comunication_json
│  ├─ prd/SKILL.md           # Skill_PRD_Base: Strict PRD Schema + entrevista de descoberta
│  ├─ requirements-clarity/SKILL.md
│  ├─ backend-development/SKILL.md
│  ├─ ui-ux-pro-max/SKILL.md
│  └─ frontend-design/SKILL.md
├─ scripts/
│  ├─ preflight.mjs          # verifica disponibilidade de Codex, AGY, Kiro e do motor de execução
│  └─ pensador-engine.mjs    # especificação determinística de referência (validada por testes)
├─ test/
│  ├─ smoke.test.js                # API pública do engine, STAGE_ORDER, checkpoint v2
│  ├─ engine-complexity.test.js    # detectComplexity — unitários + fast-check
│  ├─ feature-isolation.test.js    # allocateFeatureDir, buildFeaturePath
│  ├─ consolidate.test.js          # consolidate, withConsolidated
│  ├─ artifacts.test.js            # isFullstack, planArtifacts, buildArtifactList
│  ├─ execution-modes.test.js      # --modo: parse/resolve/buildDelegationInvocation
│  ├─ integrations.test.js         # Code Base Memory + OpenSpec (modo Spec)
│  └─ docs-consistency.test.js     # STAGE_ORDER verbatim nos docs
├─ CHANGELOG.md              # histórico de versões e breaking changes
└─ LICENSE                   # MIT
```

> **`.gitignore`:** adicione `.pensador/` para não versionar artefatos locais e checkpoints gerados pelo Pensador.

## Migração da v1

| Aspecto | v1 | v2 |
|---|---|---|
| `STAGE_ORDER` | 11 estágios (com CLARITY/BACKEND/UIUX/FRONTEND) | 11 estágios (com EXPLORE/ARCH/COMPLEXITY/BRAINSTORM_GERAL) |
| `CHECKPOINT_VERSION` | 1 | 2 |
| Pasta de artefatos | pasta raiz legada da v1 | `.pensador/<slug-da-demanda>-vN/` |
| Checkpoints v1 | `pensador-output/.pensador-progress.json` | Incompatíveis — Pensador oferece recomeçar |
| Brainstorm | 4 estágios sequenciais | 1 estágio paralelo por domínio |

> Checkpoints v1 não são convertidos automaticamente. O Pensador detecta a incompatibilidade e oferece iniciar um novo fluxo v2 via `AskUserQuestion`.

## Licença

MIT

---

**For English version, see [README.md](./README.md)**
