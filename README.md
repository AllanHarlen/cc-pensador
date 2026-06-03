# cc-pensador

> Plugin de Claude Code que conduz uma demanda em linguagem natural por **8 estágios de trabalho** até um PRD de alta qualidade — com brainstorms guiados por skills especializadas e refinamento por subagentes (Codex e AGY/Gemini).

`versão 1.0.0` · `categoria: planning` · todo diálogo passa **exclusivamente** por `AskUserQuestion`.

## Sumário

- [Visão geral](#visão-geral)
- [Fluxo de estágios](#fluxo-de-estágios)
- [Artefatos gerados](#artefatos-gerados)
- [Instalação](#instalação)
- [Uso](#uso)
- [Skills de brainstorm (empacotadas)](#skills-de-brainstorm-empacotadas)
- [Effort e modelo](#effort-e-modelo)
- [Preflight](#preflight)
- [Gates de avanço](#gates-de-avanço)
- [Engine de referência e testes](#engine-de-referência-e-testes)
- [Estrutura do projeto](#estrutura-do-projeto)

## Visão geral

O `cc-pensador` distribui o **Pensador**: a skill `pensador` e o comando `/pensador` para o Claude Code. A partir de uma demanda em linguagem natural, o Pensador conduz o LLM por **oito estágios de trabalho** (mais a entrega final), questionando o usuário, refinando requisitos com skills de brainstorm e subagentes especializados, e produzindo ao final um conjunto completo de artefatos de PRD.

**Invariante central:** todo diálogo entre os agentes e o usuário passa **exclusivamente** pela ferramenta `AskUserQuestion`. Nenhum estágio conversa por outro canal — nem a demanda ausente, nem os requisitos candidatos, nem os pontos das skills de brainstorm, do Codex, do AGY, nem as decisões de fallback.

## Fluxo de estágios

```
INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE
```

O funil vai de **gerar → ampliar → clarificar → mergulhos por domínio → varredura técnica (Codex) → varredura de produto (AGY) → consolidar.**

| Estágio | O que faz | Delegação | Relevância |
|---|---|---|---|
| **PRD_BASE** | Gera o PRD base a partir do Strict PRD Schema. | skill `prd` | sempre |
| **EXPAND** | Amplia a demanda com requisitos candidatos (perguntas próprias do Pensador). | — | sempre |
| **CLARITY** | Brainstorm de clareza de requisitos. | skill `requirements-clarity` | sempre |
| **BACKEND** | Brainstorm de back-end. | skill `backend-development` | se há back-end |
| **UIUX** | Brainstorm de UX. | skill `ui-ux-pro-max` | se há front-end |
| **FRONTEND** | Brainstorm de design de front-end. | skill `frontend-design` | se há front-end |
| **CODEX** | Refinamento técnico. | `codex:codex-rescue` (`--effort high`) | sempre |
| **AGY** | Lacunas de produto remanescentes. | `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-high`) | sempre |
| **FINAL** | Consolida o debate e gera os artefatos finais. | — | sempre |

> A relevância (`se há back-end` / `se há front-end`) é derivada de uma classificação por palavras-chave da demanda e dos requisitos (`classifyProject`). Um estágio de brainstorm **não relevante produz zero perguntas e auto-avança — é visitado, nunca pulado.** Toda pergunta desses estágios também passa por `AskUserQuestion`.

## Artefatos gerados

- `prd.md` — PRD final consolidado, estruturado conforme o Strict PRD Schema. *(sempre)*
- `userhistory.md` — Jornada do usuário em passos sequenciais. *(sempre)*
- `comunication_json.md` — Comunicação de back-end em JSON. *(somente em projetos fullstack — back-end **e** front-end)*

## Instalação

### 1 · Instalar o cc-pensador

```text
/plugin marketplace add AllanHarlen/cc-pensador
/plugin install cc-pensador@cc-pensador
/reload-plugins
```

### 2 · Dependências: Codex e AGY

O Pensador delega aos subagentes **Codex** (estágio CODEX) e **AGY** (estágio AGY) — ambos declarados como dependências do plugin.

**Codex** — plugin oficial (https://github.com/openai/codex-plugin-cc):

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

> Se um subagente estiver ausente, o Pensador detecta no [preflight](#preflight) e pergunta (via `AskUserQuestion`) se deve prosseguir sem ele. Os estágios de brainstorm por skill têm fallback próprio dentro do fluxo.

## Uso

```text
/pensador <demanda>
```

Exemplo:

```text
/pensador Crie uma tela de login para os usuários
```

Se `<demanda>` for omitida, o Pensador a solicita via `AskUserQuestion` antes de iniciar o estágio **PRD_BASE**.

## Skills de brainstorm (empacotadas)

Os estágios CLARITY/BACKEND/UIUX/FRONTEND usam skills especializadas, versionadas no plugin sob `skills/`. Cada `SKILL.md` já traz um checklist de domínio autossuficiente (com frontmatter `name`/`description`) e pode ser enriquecido com o conteúdo upstream de mcp.directory:

```bash
curl -L -o skill.zip "https://mcp.directory/api/skills/download/2157" && unzip -o skill.zip -d skills/requirements-clarity && rm skill.zip
curl -L -o skill.zip "https://mcp.directory/api/skills/download/1186" && unzip -o skill.zip -d skills/backend-development && rm skill.zip
curl -L -o skill.zip "https://mcp.directory/api/skills/download/191"  && unzip -o skill.zip -d skills/ui-ux-pro-max && rm skill.zip
curl -L -o skill.zip "https://mcp.directory/api/skills/download/1"    && unzip -o skill.zip -d skills/frontend-design && rm skill.zip
```

> Garanta que cada diretório tenha um `SKILL.md` com frontmatter (`name`, `description`) na raiz. Se o zip extrair aninhado, mova o `SKILL.md` para `skills/<id>/`.

## Effort e modelo

| Parâmetro | Valor |
|---|---|
| Effort Codex (estágio CODEX) | `--effort high` (mapeado de `extrahigh` → `high`) |
| Modelo AGY (estágio AGY) | `gemini-3.1-pro-high` |

## Preflight

O comando `/pensador` executa um preflight antes de iniciar o fluxo:

```bash
node scripts/preflight.mjs
```

Ele inspeciona o cache de plugins do Claude Code para verificar a disponibilidade do Codex (`codex:codex-rescue`) e do AGY (`cc-antigravity-plugin:antigravity-agent`), e emite um JSON com o campo `status` (`ok` | `partial` | `unavailable`). O script **sempre sai com código 0** — a disponibilidade é decidida pelo campo `status`, não pelo exit code, e a presença dos binários `codex`/`agy` no PATH é apenas informativa (os subagentes são invocados via plugin, não por CLI global).

## Gates de avanço

O Pensador não avança para o próximo estágio enquanto houver perguntas sem resposta registrada do usuário no estágio atual. Um estágio de brainstorm sem perguntas satisfaz o gate e avança na iteração seguinte. Os artefatos finais são gerados somente no estágio **FINAL** (após o AGY).

## Engine de referência e testes

O `scripts/pensador-engine.mjs` é a **especificação determinística de referência** do fluxo: máquina de estados, gates de avanço, mapeamentos de effort/modelo, classificação de projeto (`classifyProject`), consolidação (`consolidate`/`withConsolidated`) e planejamento de artefatos. É um módulo puro — sem I/O, mesmas entradas → mesmas saídas — exercido pela suíte de testes.

> **Importante:** o engine **não é importado em runtime**. A skill é Markdown interpretado pelo LLM, que aplica as mesmas regras descritas em prosa na `skills/pensador/SKILL.md`. O único script executado por shell é o `preflight.mjs`. O engine serve como (1) definição inequívoca e testável das regras e (2) guarda contra _drift_ via testes.

```bash
npm install
npm test       # Vitest — 82 testes (smoke · consolidate · artifacts)
```

## Estrutura do projeto

```
cc-pensador/
├─ .claude-plugin/
│  ├─ plugin.json            # manifesto do plugin (nome, versão, dependências)
│  └─ marketplace.json       # entrada de marketplace
├─ commands/
│  └─ pensador.md            # comando /pensador (orquestra os 8 estágios)
├─ skills/
│  ├─ pensador/
│  │  ├─ SKILL.md            # skill principal: protocolo de cada estágio + gates
│  │  ├─ references/         # stages.md · skill-stack.md · agent-stack.md · askuserquestion-protocol.md
│  │  └─ assets/             # templates: prd · userhistory · comunication_json
│  ├─ prd/SKILL.md           # Skill_PRD_Base: Strict PRD Schema + entrevista de descoberta
│  ├─ requirements-clarity/SKILL.md
│  ├─ backend-development/SKILL.md
│  ├─ ui-ux-pro-max/SKILL.md
│  └─ frontend-design/SKILL.md
├─ scripts/
│  ├─ preflight.mjs          # verifica disponibilidade de Codex e AGY
│  └─ pensador-engine.mjs    # especificação determinística de referência (validada por testes)
└─ test/                     # smoke · consolidate · artifacts (Vitest)
```
