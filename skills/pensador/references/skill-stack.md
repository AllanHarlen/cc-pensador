# Skill Stack do Pensador v2

No protocolo v2, as skills nao sao estagios autonomos. Elas funcionam como **lentes de dominio** dentro do estagio `BRAINSTORM_GERAL`.

Os antigos estagios `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` nao fazem parte de `STAGE_ORDER` v2. Suas responsabilidades foram consolidadas no roteamento por dominio do BRAINSTORM_GERAL.

---

## Visao geral

No v2.6 cada dominio do BRAINSTORM_GERAL tem uma lente **primaria** (skill determinista, roda sempre que o dominio e relevante) e, quando aplicavel, lentes de **refinamento** (subagentes) e o **motor de design**.

| Lente | Skill | Origin | Papel | Quando usar | Foco |
|---|---|---|---|---|---|
| Clareza | `requirements-clarity` | `requirements-clarity` | primaria | Sempre | Ambiguidades, criterios de aceite, escopo, requisitos implicitos |
| Backend | `backend-development` | `backend-development` | **primaria** | `hasBackend` | Dados, APIs, integracoes, seguranca, contratos (alimenta o contrato maquina-legivel) |
| Backend (refino) | `codex:codex-rescue` | `codex` | refine | `hasBackend` | Aprofunda riscos tecnicos sobre o checklist da lente primaria |
| UX | `ui-ux-pro-max` | `ui-ux-pro-max` | **primaria** | `hasFrontend` | Fluxos, estados de tela, acessibilidade, microcopy (alimenta o Open Design) |
| Frontend | `frontend-design` | `frontend-design` | **primaria** | `hasFrontend` | Componentizacao, design system, responsividade, layout (alimenta o Open Design) |
| Design (motor) | Open Design (`od`) | `open-design` | design-engine | `hasFrontend` | Materializa o design system verbatim a partir do brief |
| UX/Front (refino) | `cc-antigravity-plugin:antigravity-agent` | `agy` | refine | `hasFrontend` | Aprofunda produto/experiencia sobre as lentes primarias |

`requirements-clarity`, `backend-development`, `ui-ux-pro-max` e `frontend-design` sao as **lentes primarias** (skills deterministas) do BRAINSTORM_GERAL. Codex e AGY entram como **lentes de refinamento** por cima delas; o Open Design entra como **motor de design**. Nenhuma cria estagio independente. Mapeamento em `STAGE_DELEGATION.BRAINSTORM_GERAL.domains.*.lenses`.

> **Motor de design (Open Design).** Quando `hasFrontend = true`, as lentes primarias `ui-ux-pro-max` e `frontend-design` definem *o que* perguntar; o Pensador parseia um **brief de design** e usa o **Open Design** (`od`, MCP/CLI) como motor para materializar o system verbatim (`DESIGN.md`/`tokens.css`/…). Se indisponivel, ofereca instalacao via `AskUserQuestion` ou caia para um `design-system.md` inline. Veja `references/open-design.md`.

---

## Protocolo de invocacao

1. Garanta que `<featurePath>/shared-agents/context-pack.md` exista.
2. Invoque apenas a skill ou lente necessaria para o dominio.
3. Forneca demanda, PRD Base, `architecture.md`, EXPAND, modo Lite/Completo, sinais `hasBackend`/`hasFrontend` e dominios detectados.
4. Peca explicitamente lacunas, ambiguidades e decisoes em aberto em formato de perguntas candidatas.
5. Grave ou incorpore a resposta em `shared-agents/<origin>.response.md`.
6. Consolide em `shared-agents/agent.response.md`.
7. Deduplicate antes de perguntar ao usuario.

Exemplo:

```text
Skill(skill="cc-pensador:requirements-clarity")

Contexto:
- Leia/considere shared-agents/context-pack.md.
- Retorne lacunas de clareza, criterios de aceite e escopo.
- Use formato de perguntas candidatas com evidencia e severidade.
```

---

## Profundidade por modo

| Modo | Como aplicar lentes |
|---|---|
| Lite | Priorizar perguntas essenciais; limitar volume; registrar lacunas menores como `"TBD"` |
| Completo | Aprofundar dominios de risco, especialmente backend, frontend amplo, integracoes e greenfield |

---

## Dedupe e autoria

Toda pergunta candidata deve preservar:

- `origin`: skill ou agente que identificou o ponto.
- `domain`: clareza, backend, uiux, frontend, produto ou tecnico.
- `stage = 'BRAINSTORM_GERAL'`.
- Evidencia ou trecho de contexto que motivou a pergunta.

Antes de perguntar:

- Remova duplicatas do PRD Base, EXPAND e respostas anteriores.
- Una perguntas equivalentes de origens diferentes, preservando todos os selos de autoria.
- Nao reapresente perguntas ja respondidas.

---

## Fallback de lentes

Se uma skill estiver indisponivel:

1. Registre a indisponibilidade.
2. Pergunte via `AskUserQuestion` se deve retentar, seguir sem a lente ou registrar as lacunas como `"TBD"`.
3. O fallback e por dominio; dominios independentes continuam validos.

Quando uma lente primaria (`backend-development`, `ui-ux-pro-max` ou `frontend-design`) estiver indisponivel, o Pensador aplica o fallback por dominio via `AskUserQuestion` (retentar, seguir sem a lente ou registrar `"TBD"`) e ainda pode aproveitar a lente de refinamento (Codex/AGY) daquele dominio, respeitando o modo Lite/Completo e o gate do estagio.

---

## Leitura relacionada

- `references/stages.md`: definicao de `BRAINSTORM_GERAL`.
- `references/agent-stack.md`: roteamento de Codex/AGY e contrato `shared-agents/`.
- `references/feature-isolation.md`: layout isolado por feature.
- `references/askuserquestion-protocol.md`: regras de pergunta, previews, autoria e handoff.
