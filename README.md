# cc-pensador

Plugin de Claude Code para conduzir um workflow de PRD (Product Requirements Document) em cinco estágios sequenciais, com delegação ao Codex e ao AGY.

## Visão geral

O `cc-pensador` distribui o **Pensador** — uma skill e o comando `/pensador` para o Claude Code. Partindo de uma demanda em linguagem natural, o Pensador conduz o LLM por cinco estágios, questionando o usuário, refinando requisitos com subagentes especializados, e produzindo ao final um conjunto completo de artefatos de PRD.

Todo diálogo entre os agentes e o usuário passa exclusivamente pela ferramenta **AskUserQuestion**.

### Fluxo de estágios

```
INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE
```

| Estágio | Descrição |
|---|---|
| PRD_BASE | Gera o PRD base a partir do Strict PRD Schema (Skill_PRD_Base). |
| EXPAND | Amplia a demanda com perguntas próprias do Pensador ao usuário. |
| CLARITY | Brainstorm de clareza de requisitos com a skill `requirements-clarity` *(sempre)*. |
| BACKEND | Brainstorm de back-end com a skill `backend-development` *(se há backend)*. |
| UIUX | Brainstorm de UX com a skill `ui-ux-pro-max` *(se há front-end)*. |
| FRONTEND | Brainstorm de design de front-end com a skill `frontend-design` *(se há front-end)*. |
| CODEX | Delega ao Codex (`codex:codex-rescue`, `--effort high`) o refinamento técnico. |
| AGY | Delega ao AGY (`cc-antigravity-plugin:antigravity-agent`, `gemini-3.1-pro-high`) as lacunas de produto. |
| FINAL | Consolida todo o debate e gera os artefatos finais. |

As etapas de brainstorm (CLARITY/BACKEND/UIUX/FRONTEND) usam skills especializadas para reforçar a integridade do PRD. Uma etapa de domínio não-aplicável produz zero perguntas e auto-avança (é visitada, não pulada). Toda pergunta dessas etapas também passa por **AskUserQuestion**.

### Artefatos gerados

- `prd.md` — PRD final consolidado, estruturado conforme o Strict PRD Schema.
- `userhistory.md` — Jornada do usuário em passos sequenciais.
- `comunication_json.md` — Comunicação de back-end em JSON (gerado somente para projetos fullstack).

## Uso

```text
/pensador <demanda>
```

Se `<demanda>` for omitida, o Pensador solicita a demanda ao usuário via AskUserQuestion antes de iniciar o Estágio 1.

## Dependências oficiais

Este plugin depende do Codex plugin oficial para Claude Code: https://github.com/openai/codex-plugin-cc.

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

Para o Estágio 4, o Pensador espera `cc-antigravity-plugin` com estes arquivos presentes no plugin instalado:

- `agents/antigravity-agent.md`
- `commands/antigravity.md`
- `scripts/antigravity-bridge.js`

## Mapeamento de effort e modelo

| Parâmetro | Valor |
|---|---|
| Effort Codex (Estágio 3) | `--effort high` (mapeado de `extrahigh`) |
| Modelo AGY (Estágio 4) | `gemini-3.1-pro-high` |

## Preflight

O comando `/pensador` executa um preflight antes de iniciar o fluxo:

```bash
node scripts/preflight.mjs
```

O preflight verifica a disponibilidade do Codex (`codex:codex-rescue`) e do AGY (`cc-antigravity-plugin:antigravity-agent`) e reporta o status antes do início dos estágios.

## Gates de avanço

O Pensador não avança para o próximo estágio enquanto houver perguntas sem resposta registrada do usuário no estágio atual. Os artefatos finais são gerados somente após a conclusão do Estágio 4.

## Skills de brainstorm (empacotadas)

As etapas CLARITY/BACKEND/UIUX/FRONTEND usam skills especializadas, versionadas no plugin sob `skills/`. Cada `SKILL.md` já traz um checklist de domínio autossuficiente e pode ser enriquecido com o conteúdo upstream de mcp.directory:

```bash
curl -L -o skill.zip "https://mcp.directory/api/skills/download/2157" && unzip -o skill.zip -d skills/requirements-clarity && rm skill.zip
curl -L -o skill.zip "https://mcp.directory/api/skills/download/1186" && unzip -o skill.zip -d skills/backend-development && rm skill.zip
curl -L -o skill.zip "https://mcp.directory/api/skills/download/191"  && unzip -o skill.zip -d skills/ui-ux-pro-max && rm skill.zip
curl -L -o skill.zip "https://mcp.directory/api/skills/download/1"    && unzip -o skill.zip -d skills/frontend-design && rm skill.zip
```

> Garanta que cada diretório tenha um `SKILL.md` com frontmatter (`name`, `description`) na raiz. Se o zip extrair aninhado, mova o `SKILL.md` para `skills/<id>/`.

## Arquivos principais

- `commands/pensador.md`
- `skills/pensador/SKILL.md`
- `skills/pensador/references/` — `stages.md`, `skill-stack.md`, `agent-stack.md`, `askuserquestion-protocol.md`
- `skills/prd/SKILL.md`
- `skills/requirements-clarity/SKILL.md` · `skills/backend-development/SKILL.md` · `skills/ui-ux-pro-max/SKILL.md` · `skills/frontend-design/SKILL.md`
- `scripts/preflight.mjs`
- `scripts/pensador-engine.mjs` — especificação determinística de referência (validada por testes)
