# Agent Stack do Pensador v2

Este documento descreve os subagentes usados pelo Pensador v2 e o contrato de arquivos compartilhados em `shared-agents/`.

As skills de dominio sao descritas em `references/skill-stack.md`.

---

## Visao geral

| Subagente | Identificador | Onde participa | Parametro efetivo |
|---|---|---|---|
| Codex | `codex:codex-rescue` | `BRAINSTORM_GERAL` quando `hasBackend`; `CODEX` sempre | `effort high` |
| AGY | `cc-antigravity-plugin:antigravity-agent` | `BRAINSTORM_GERAL` quando `hasFrontend`; `AGY` sempre | `model gemini-3.1-pro-high` |

O tool `Agent` recebe `subagent_type` e `prompt`; nao ha campo de flags. Sempre comunique o parametro no corpo do prompt e registre o valor para rastreabilidade.

```text
Agent(subagent_type="codex:codex-rescue", prompt="... Use effort: high. ...")
Agent(subagent_type="cc-antigravity-plugin:antigravity-agent", prompt="... Use model: gemini-3.1-pro-high. ...")
```

---

## BRAINSTORM_GERAL: roteamento por dominio

`BRAINSTORM_GERAL` e o ponto de orquestracao paralela. Ele usa o contexto gravado em:

```text
<featurePath>/shared-agents/context-pack.md
```

Roteamento:

| Dominio | Participante | Condicao | Saida esperada |
|---|---|---|---|
| Clareza de requisitos | `requirements-clarity` | sempre | `requirements-clarity.response.md` |
| Backend/tecnico | Codex | `hasBackend = true` | `codex.response.md` |
| Frontend/produto | AGY | `hasFrontend = true` | `agy.response.md` |

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
| `codex.response.md` | Codex | Pensador | Lacunas tecnicas, riscos de backend, contratos, dados e seguranca |
| `agy.response.md` | AGY | Pensador | Lacunas de produto/frontend, jornadas, telas, cenarios e riscos |
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

Codex roda quando `hasBackend = true`. O prompt deve pedir analise tecnica focada em dados, API, contratos, seguranca, consistencia, observabilidade, integracoes e riscos de implementacao. A resposta deve ser gravada em `shared-agents/codex.response.md`.

### No CODEX

Codex roda sempre como varredura tecnica final, considerando tambem `agent.response.md` e respostas do usuario. Pontos relevantes viram perguntas `origin = 'codex'`, `stage = 'CODEX'`.

---

## AGY

### Modelo

Modelo efetivo: `gemini-3.1-pro-high`.

Regra: comunique o modelo no prompt e registre o valor. Se o plugin rejeitar o identificador, aplique fallback do estagio afetado.

### No BRAINSTORM_GERAL

AGY roda quando `hasFrontend = true`. O prompt deve pedir analise de experiencia, produto, jornadas, telas, estados, cenarios de uso e riscos de decisao. A resposta deve ser gravada em `shared-agents/agy.response.md`.

### No AGY

AGY roda sempre como varredura final de produto, considerando o consolidado ate CODEX. Pontos relevantes viram perguntas `origin = 'agy'`, `stage = 'AGY'`.

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
- `references/askuserquestion-protocol.md`: canal unico, autoria, previews e handoff.
