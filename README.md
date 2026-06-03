# cc-pensador

Plugin de Claude Code para conduzir um workflow de PRD (Product Requirements Document) em cinco estágios sequenciais, com delegação ao Codex e ao AGY.

## Visão geral

O `cc-pensador` distribui o **Pensador** — uma skill e o comando `/pensador` para o Claude Code. Partindo de uma demanda em linguagem natural, o Pensador conduz o LLM por cinco estágios, questionando o usuário, refinando requisitos com subagentes especializados, e produzindo ao final um conjunto completo de artefatos de PRD.

Todo diálogo entre os agentes e o usuário passa exclusivamente pela ferramenta **AskUserQuestion**.

### Fluxo de estágios

| Estágio | Descrição |
|---|---|
| Estágio 1 | Gera o PRD base a partir do Strict PRD Schema (Skill_PRD_Base). |
| Estágio 2 | Amplia a demanda com perguntas próprias do Pensador ao usuário. |
| Estágio 3 | Delega ao Codex (`codex:codex-rescue`, `--effort high`) o refinamento dos requisitos. |
| Estágio 4 | Delega ao AGY (`cc-antigravity-plugin:antigravity-agent`, `gemini-3.1-pro-high`) o levantamento de lacunas remanescentes. |
| Estágio Final | Consolida todo o debate e gera os artefatos finais. |

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

## Arquivos principais

- `commands/pensador.md`
- `skills/pensador/SKILL.md`
- `skills/prd/SKILL.md`
- `scripts/preflight.mjs`
- `scripts/pensador-engine.mjs`
