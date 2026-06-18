# Skill Stack do Pensador v2

No protocolo v2, as skills nao sao estagios autonomos. Elas funcionam como **lentes de dominio** dentro do estagio `BRAINSTORM_GERAL`.

Os antigos estagios `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` nao fazem parte de `STAGE_ORDER` v2. Suas responsabilidades foram consolidadas no roteamento por dominio do BRAINSTORM_GERAL.

---

## Visao geral

| Lente | Skill | Origin | Quando usar | Foco |
|---|---|---|---|---|
| Clareza | `requirements-clarity` | `requirements-clarity` | Sempre | Ambiguidades, criterios de aceite, escopo, requisitos implicitos |
| Backend | `backend-development` | `backend-development` | Como referencia/fallback quando `hasBackend` e Codex nao cobrir o dominio | Dados, APIs, integracoes, seguranca, contratos |
| UI/UX | `ui-ux-pro-max` | `ui-ux-pro-max` | Como referencia/fallback quando `hasFrontend` e AGY nao cobrir UX suficiente | Fluxos, estados de tela, acessibilidade, microcopy |
| Frontend | `frontend-design` | `frontend-design` | Como referencia/fallback quando `hasFrontend` e for necessario detalhar construcao de UI | Componentizacao, design system, responsividade, layout |

`requirements-clarity` e a lente skill primaria do BRAINSTORM_GERAL. As demais skills continuam disponiveis como lentes especializadas de dominio, mas nao criam estagios independentes.

> **Motor de design (Open Design).** Quando `hasFrontend = true`, o Pensador parseia um **brief de design** e usa o **Open Design** (`od`, MCP/CLI) como motor para gerar o `design-system.md` (DESIGN.md brand-grade). As lentes `ui-ux-pro-max` e `frontend-design` definem *o que* perguntar; o Open Design materializa *o sistema de design*. Se indisponivel, ofereca instalacao via `AskUserQuestion` ou caia para um `design-system.md` inline. Veja `references/open-design.md`.

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

Quando Codex ou AGY nao cobrirem suficientemente um dominio durante BRAINSTORM_GERAL, o Pensador pode usar `backend-development`, `ui-ux-pro-max` ou `frontend-design` como lente complementar, respeitando o modo Lite/Completo e o gate do estagio.

---

## Leitura relacionada

- `references/stages.md`: definicao de `BRAINSTORM_GERAL`.
- `references/agent-stack.md`: roteamento de Codex/AGY e contrato `shared-agents/`.
- `references/feature-isolation.md`: layout isolado por feature.
- `references/askuserquestion-protocol.md`: regras de pergunta, previews, autoria e handoff.
