# Agent Stack do Pensador v2

Este documento descreve os subagentes usados pelo Pensador v2 e o contrato de arquivos compartilhados em `shared-agents/`.

As skills de dominio sao descritas em `references/skill-stack.md`. Os **modos de execucao** (`--modo`), que delegam o trabalho pesado do fluxo a uma CLI externa, sao descritos em `references/execution-modes.md`.

> **Dois eixos distintos.** Codex e AGY aparecem aqui como **lentes de domínio** (refinamento técnico e varredura de produto dentro dos estágios). Isso é independente do **modo de execução**, que escolhe quem redige os artefatos do fluxo (Claude, AGY, Kiro ou Codex). O Kiro participa apenas como motor de execução (`--modo kiro`), não como lente de domínio.

---

## Visao geral

| Subagente | Identificador | Onde participa | Parametro efetivo |
|---|---|---|---|
| Codex | `codex:codex-rescue` | `BRAINSTORM_GERAL` quando `hasBackend`; `CODEX` quando nao for atividade especifica de front-end | `effort high` |
| AGY | `cc-antigravity-plugin:antigravity-agent` | `BRAINSTORM_GERAL` quando `hasFrontend`; `AGY` sempre | `model gemini-3.1-pro-high` |

O tool `Agent` recebe `subagent_type` e `prompt`; nao ha campo de flags. Sempre comunique o parametro no corpo do prompt e registre o valor para rastreabilidade.

```text
Agent(subagent_type="codex:codex-rescue", prompt="... Use effort: high. ...")
Agent(subagent_type="cc-antigravity-plugin:antigravity-agent", prompt="... Use model: gemini-3.1-pro-high. ...")
```

---

## Motores de execucao (`--modo`)

Quando o usuario escolhe um modo de execucao delegado, o Pensador entrega o trabalho pesado de cada estagio ao motor via slash command (tool `SlashCommand`), enquanto mantem `AskUserQuestion` como unico canal com o usuario.

| Motor | Modo | Slash command | Parametro padrao | Plugin |
|---|---|---|---|---|
| Antigravity | `--modo agy` | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` | `cc-antigravity-plugin` |
| Kiro | `--modo kiro` | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` | `cc-kiro-plugin` |
| Codex | `--modo codex` | `/codex:rescue` | `--effort high` | `openai-codex` |

O motor `claude` (padrao) nao delega: o Claude Code redige inline. Detalhes de parsing, preflight, contrato de delegacao e fallback em `references/execution-modes.md`.

---

## BRAINSTORM_GERAL: roteamento por dominio

`BRAINSTORM_GERAL` e o ponto de orquestracao paralela. Ele usa o contexto gravado em:

```text
<featurePath>/shared-agents/context-pack.md
```

Roteamento (lentes primarias sao skills deterministas; Codex/AGY sao lentes de refinamento; Open Design e o motor de design):

| Dominio | Lente primaria | Refino/Motor | Condicao | Saida esperada |
|---|---|---|---|---|
| Clareza de requisitos | `requirements-clarity` | — | sempre | `requirements-clarity.response.md` |
| Backend/tecnico | `backend-development` (skill) | Codex `effort high` | `hasBackend = true` | `backend-development.response.md` + `codex.response.md` |
| UX/Frontend | `ui-ux-pro-max` + `frontend-design` (skills) | AGY `gemini-3.1-pro-high` | `hasFrontend = true` | `ui-ux-pro-max.response.md` + `frontend-design.response.md` + `agy.response.md` |
| Design system | Open Design (`od`) | — | `hasFrontend = true` | brief de design parseado -> arquivos verbatim `design-systems/<id>/` (no FINAL) |

As lentes primarias (`backend-development`, `ui-ux-pro-max`, `frontend-design`) rodam sempre que o dominio e relevante, produzindo um checklist determinista. Codex e AGY refinam por cima delas. Mapeamento em `STAGE_DELEGATION.BRAINSTORM_GERAL.domains.*.lenses`.

O Pensador consolida as respostas em:

```text
<featurePath>/shared-agents/agent.response.md
```

Esse arquivo e a fonte de perguntas candidatas do BRAINSTORM_GERAL.

---

## Contrato `shared-agents/`

| Arquivo | Escritor | Leitor | Conteudo |
|---|---|---|---|
| `context-pack.md` | Pensador | Skills e subagentes | Demanda, PRD Base, arquitetura, EXPAND, complexidade, dominios e instrucoes |
| `requirements-clarity.response.md` | Skill `requirements-clarity` | Pensador | Ambiguidades, criterios de aceite, escopo e perguntas candidatas |
| `backend-development.response.md` | Skill `backend-development` (lente primaria) | Pensador | Checklist de dados, APIs, contratos, seguranca, consistencia, observabilidade |
| `ui-ux-pro-max.response.md` | Skill `ui-ux-pro-max` (lente primaria) | Pensador | Fluxos, estados de tela, acessibilidade, hierarquia, microcopy |
| `frontend-design.response.md` | Skill `frontend-design` (lente primaria) | Pensador | Componentizacao, design system, tokens, responsividade, layout |
| `codex.response.md` | Codex (refino) | Pensador | Lacunas tecnicas, riscos de backend, contratos, dados e seguranca |
| `agy.response.md` | AGY (refino) | Pensador | Lacunas de produto/frontend, jornadas, telas, cenarios e riscos |
| `agent.response.md` | Pensador | Pensador/FINAL | Consolidado com autoria, dominio, severidade, deduplicacao e perguntas aprovadas |

Formato recomendado para respostas:

```markdown
# <participante>.response

## Contexto usado
- Feature: <featurePath>
- Modo: Lite|Completo
- Dominios: <lista>

## Pontos em aberto
| ID | Dominio | Severidade | Evidencia | Pergunta candidata | Autoria |
|---|---|---|---|---|---|

## Observacoes
- <riscos ou premissas>
```

---

## Codex

### Effort

O usuario pode pedir `extrahigh`, mas o valor efetivo aceito pelo fluxo e `high`.

| Solicitado | Efetivo |
|---|---|
| `medium` | `medium` |
| `high` | `high` |
| `extrahigh` | `high` |

Regra: nunca comunique `extrahigh` ao Codex. Use `effort high`.

### No BRAINSTORM_GERAL

Codex roda quando `hasBackend = true`, como **lente de refinamento por cima da lente primaria `backend-development`**. O prompt deve pedir analise tecnica focada em dados, API, contratos, seguranca, consistencia, observabilidade, integracoes e riscos de implementacao, aprofundando o checklist ja levantado pela lente primaria. A resposta deve ser gravada em `shared-agents/codex.response.md`.

### No CODEX

Codex roda como varredura tecnica final, considerando tambem `agent.response.md` e respostas do usuario. Pontos relevantes viram perguntas `origin = 'codex'`, `stage = 'CODEX'`.

**Excecao — atividade especifica de front-end:** quando `hasFrontend = true` e `hasBackend = false` (`codexParticipates = false`), o Codex nao participa. O estagio e visitado, mas nao ha delegacao nem fallback: registra zero perguntas e avanca. Isso e coerente com o BRAINSTORM_GERAL, onde o dominio de backend so aciona o Codex quando `hasBackend = true`.

---

## AGY

### Modelo

Modelo efetivo: `gemini-3.1-pro-high`.

Regra: comunique o modelo no prompt e registre o valor. Se o plugin rejeitar o identificador, aplique fallback do estagio afetado.

### No BRAINSTORM_GERAL

AGY roda quando `hasFrontend = true`, como **lente de refinamento por cima das lentes primarias `ui-ux-pro-max` e `frontend-design`**. O prompt deve pedir analise de experiencia, produto, jornadas, telas, estados, cenarios de uso e riscos de decisao. A resposta deve ser gravada em `shared-agents/agy.response.md`.

### No AGY

AGY roda sempre como varredura final de produto, considerando o consolidado ate CODEX. Pontos relevantes viram perguntas `origin = 'agy'`, `stage = 'AGY'`.

---

## Open Design (motor de design)

O Open Design (`od`, MCP/CLI) nao e uma lente de perguntas como Codex/AGY: e o **motor de design** acionado quando `hasFrontend = true`. No `BRAINSTORM_GERAL`, o Pensador parseia o **brief de design** (tom visual, marca, paleta, tipografia, estados, responsividade, acessibilidade, microcopy) via `AskUserQuestion`; no `FINAL`, esse brief alimenta o Open Design para gerar o artefato `design-system.md` (DESIGN.md de 9 secoes).

Fallback (decidido via `AskUserQuestion`): instalar o Open Design agora (app local-first; o cc-pensador traz um script Docker — `scripts/install-open-design.ps1|.sh` — que verifica git+docker, sobe o daemon e conecta o MCP via `od mcp install <agent>`) ou escrever um `design-system.md` inline a partir do schema de 9 secoes. Com o Open Design no ar, o Pensador puxa o DESIGN.md via `od design-systems list/show` (ou pela API do daemon, no modo Docker). Detalhes em `references/open-design.md`.

---

## Fallback

Fallback e sempre decidido via `AskUserQuestion`.

No `BRAINSTORM_GERAL`, o fallback e por dominio. Uma falha em Codex nao impede aproveitar a resposta de `requirements-clarity` ou AGY, por exemplo. As opcoes padrao sao:

- Retentar o participante.
- Seguir sem aquele dominio.
- Registrar lacunas daquele dominio como `"TBD"`.

Nos estagios `CODEX` e `AGY`, o fallback bloqueia o gate do proprio estagio ate haver resposta ou diferimento.

---

## Leitura relacionada

- `references/stages.md`: gates e comportamento por estagio.
- `references/feature-isolation.md`: layout de `shared-agents/` e retomada.
- `references/skill-stack.md`: skills como lentes de dominio.
- `references/open-design.md`: Open Design como motor de design (brief + `design-system.md`).
- `references/askuserquestion-protocol.md`: canal unico, autoria, previews e handoff.
