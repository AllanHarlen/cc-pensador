# cc-pensador

> Plugin de Claude Code que conduz uma demanda em linguagem natural por **dez estágios de trabalho** até um PRD de alta qualidade — com análise de arquitetura, heurística de complexidade, brainstorm geral por domínio e refinamento por subagentes (Codex e AGY/Gemini).

`versão 2.0.0` · `categoria: planning` · todo diálogo passa **exclusivamente** por `AskUserQuestion`.

## Sumário

- [Visão geral](#visão-geral)
- [Fluxo de estágios](#fluxo-de-estágios)
- [Artefatos gerados](#artefatos-gerados)
- [Isolamento por feature](#isolamento-por-feature)
- [Instalação](#instalação)
- [Uso](#uso)
- [Modos Lite e Completo](#modos-lite-e-completo)
- [Preflight](#preflight)
- [Gates de avanço](#gates-de-avanço)
- [Engine de referência e testes](#engine-de-referência-e-testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Migração da v1](#migração-da-v1)

## Visão geral

O `cc-pensador` distribui o **Pensador v2**: a skill `pensador` e o comando `/pensador` para o Claude Code. A partir de uma demanda em linguagem natural, o Pensador analisa a arquitetura do projeto, estima a complexidade, coordena um brainstorm geral por domínio em paralelo, refina com Codex e AGY e produz artefatos de PRD isolados por feature em `.pensador/feature-nN/`.

**Invariante central:** todo diálogo entre os agentes e o usuário passa **exclusivamente** pela ferramenta `AskUserQuestion`. Nenhum estágio conversa por outro canal.

## Fluxo de estágios

```
INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

O funil vai de **iniciar/retomar → PRD base → arquitetura → ampliar → calibrar complexidade → brainstorm por domínio → varredura técnica → varredura de produto → consolidar → entregar.**

| Estágio | O que faz | Delegação | Relevância |
|---|---|---|---|
| **INIT** | Verifica retomada, aloca feature dir, obtém demanda. | — | sempre |
| **PRD_BASE** | Gera PRD base pelo `Strict_PRD_Schema`. | skill `prd` | sempre |
| **ARCH** | Analisa arquitetura via Read/Glob/Grep; grava `architecture.md`. Entrevista greenfield se necessário. | — | sempre |
| **EXPAND** | Amplia demanda com requisitos candidatos (perguntas do Pensador). | — | sempre |
| **COMPLEXITY** | Calcula score por `detectComplexity()`; propõe Lite ou Completo; usuário confirma. | — | sempre |
| **BRAINSTORM_GERAL** | Orquestra lentes de domínio em paralelo (requirements-clarity + Codex se backend + AGY se frontend). | skills + `codex:codex-rescue` + AGY | sempre |
| **CODEX** | Refinamento técnico dedicado. | `codex:codex-rescue` (`--effort high`) | sempre |
| **AGY** | Lacunas de produto remanescentes. | `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-high`) | sempre |
| **FINAL** | Consolida e gera os artefatos finais. | — | sempre |

> O BRAINSTORM_GERAL substitui os antigos estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND`. Eles agora são lentes de domínio orquestradas em paralelo dentro de um único estágio.

## Artefatos gerados

Todos gravados sob `.pensador/feature-nN/pensador-output/`. Confirma sobrescrita via `AskUserQuestion` se o arquivo já existir.

- `prd.md` — PRD final consolidado, estruturado conforme o Strict PRD Schema. *(sempre)*
- `userhistory.md` — Jornada do usuário em passos sequenciais. *(sempre)*
- `comunication_json.md` — Contrato de comunicação/API em JSON. *(sempre que houver back-end)*
- `architecture.md` — Retrato da arquitetura detectada no estágio ARCH. *(sempre, em `<featurePath>/`)*

## Isolamento por feature

Cada execução do Pensador cria (ou retoma) um diretório isolado:

```
.pensador/
└── feature-nN[-sufixo]/
    ├── .pensador-progress.json    ← checkpoint v2
    ├── architecture.md
    ├── shared-agents/             ← troca entre subagentes
    │   ├── context-pack.md
    │   ├── requirements-clarity.response.md
    │   ├── codex.response.md
    │   └── agy.response.md
    └── pensador-output/           ← artefatos finais
        ├── prd.md
        ├── userhistory.md
        └── comunication_json.md
```

`N` é um inteiro auto-incremental. No `INIT`, se houver checkpoint v2 incompleto, o Pensador oferece retomada via `AskUserQuestion`.

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

## Uso

```text
/pensador <demanda>
```

Exemplo:

```text
/pensador Crie uma tela de login para os usuários
```

Se `<demanda>` for omitida, o Pensador a solicita via `AskUserQuestion` antes de iniciar o estágio **PRD_BASE**.

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

O comando `/pensador` executa um preflight antes de iniciar o fluxo:

```bash
node scripts/preflight.mjs
```

Ele inspeciona o cache de plugins do Claude Code para verificar a disponibilidade do Codex e do AGY, e emite um JSON com o campo `status` (`ok` | `partial` | `unavailable`). O script **sempre sai com código 0**.

## Gates de avanço

O Pensador não avança para o próximo estágio enquanto houver perguntas sem resposta registrada no estágio atual. Um estágio sem perguntas satisfaz o gate e avança imediatamente. Os artefatos finais são gerados somente no estágio **FINAL**.

## Engine de referência e testes

O `scripts/pensador-engine.mjs` é a **especificação determinística de referência** do fluxo: máquina de estados, gates, mapeamentos de effort/modelo, `detectComplexity`, `allocateFeatureDir`, `buildFeaturePath`, `classifyProject`, `consolidate`/`withConsolidated`, planejamento de artefatos e serialização de checkpoint v2. É um módulo puro — sem I/O, mesmas entradas → mesmas saídas — exercido pela suíte de testes.

> **Importante:** o engine **não é importado em runtime**. A skill é Markdown interpretado pelo LLM. O único script executado por shell é o `preflight.mjs`.

```bash
npm install
npm test       # Vitest — smoke · engine-complexity · feature-isolation · consolidate · artifacts · docs-consistency
```

## Estrutura do projeto

```
cc-pensador/
├─ .claude-plugin/
│  ├─ plugin.json            # manifesto do plugin (nome, versão, dependências)
│  └─ marketplace.json       # entrada de marketplace
├─ commands/
│  └─ pensador.md            # comando /pensador (orquestra os 10 estágios)
├─ skills/
│  ├─ pensador/
│  │  ├─ SKILL.md            # skill principal: protocolo v2 + gates + isolamento por feature
│  │  ├─ references/         # stages.md · skill-stack.md · agent-stack.md · askuserquestion-protocol.md · feature-isolation.md
│  │  └─ assets/             # templates: prd · userhistory · comunication_json
│  ├─ prd/SKILL.md           # Skill_PRD_Base: Strict PRD Schema + entrevista de descoberta
│  ├─ requirements-clarity/SKILL.md
│  ├─ backend-development/SKILL.md
│  ├─ ui-ux-pro-max/SKILL.md
│  └─ frontend-design/SKILL.md
├─ scripts/
│  ├─ preflight.mjs          # verifica disponibilidade de Codex e AGY
│  └─ pensador-engine.mjs    # especificação determinística de referência (validada por testes)
├─ test/                     # smoke · engine-complexity · feature-isolation · consolidate · artifacts · docs-consistency (Vitest)
└─ LICENSE                   # MIT
```

## Migração da v1

| Aspecto | v1 | v2 |
|---|---|---|
| `STAGE_ORDER` | 11 estágios (com CLARITY/BACKEND/UIUX/FRONTEND) | 10 estágios (com ARCH/COMPLEXITY/BRAINSTORM_GERAL) |
| `CHECKPOINT_VERSION` | 1 | 2 |
| Pasta de artefatos | `pensador-output/` | `.pensador/feature-nN/pensador-output/` |
| Checkpoints v1 | `pensador-output/.pensador-progress.json` | Incompatíveis — Pensador oferece recomeçar |
| Brainstorm | 4 estágios sequenciais | 1 estágio paralelo por domínio |

> Checkpoints v1 não são convertidos automaticamente. O Pensador detecta a incompatibilidade e oferece iniciar um novo fluxo v2 via `AskUserQuestion`.
