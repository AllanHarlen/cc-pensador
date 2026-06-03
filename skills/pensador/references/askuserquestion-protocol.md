# Protocolo AskUserQuestion — Referência

Este documento descreve o uso de `AskUserQuestion` como o **único canal de diálogo** entre o Pensador e o usuário durante todo o fluxo.

---

## Princípio Central

> **`AskUserQuestion` é o único mecanismo pelo qual o Pensador apresenta perguntas ao usuário.**

Isso se aplica **sem exceção** a todas as origens e todos os estágios:

| Origem da pergunta | Exemplo | Canal |
|---|---|---|
| Própria do Pensador | Demanda ausente no INIT; requisitos candidatos no EXPAND | `AskUserQuestion` |
| Skill de brainstorm | Lacuna retornada por `requirements-clarity`/`backend-development`/`ui-ux-pro-max`/`frontend-design` nos estágios CLARITY/BACKEND/UIUX/FRONTEND | `AskUserQuestion` |
| Originada pelo Codex | Ponto em aberto retornado pelo `codex:codex-rescue` no estágio CODEX | `AskUserQuestion` |
| Originada pelo AGY | Pergunta de lacuna retornada pelo `cc-antigravity-plugin:antigravity-agent` no estágio AGY | `AskUserQuestion` |
| Fallback (skill/subagente indisponível) | Decisão de prosseguir sem uma skill de brainstorm, sem o Codex ou sem o AGY | `AskUserQuestion` |

O Pensador nunca exibe perguntas por texto livre no chat fora da ferramenta `AskUserQuestion`, nem por meio de qualquer outro mecanismo de diálogo.

---

## Invariante do Engine: `dispatchQuestion`

No Pensador Engine, o despacho de perguntas é modelado pela função `dispatchQuestion(question)`:

```js
// scripts/pensador-engine.mjs
export function dispatchQuestion(question) {
  return {
    ...question,
    channel: ASK_USER_QUESTION, // sempre 'ASK_USER_QUESTION'
  };
}
```

**A invariante é:** independentemente do valor de `question.origin` (`'pensador'`, `'requirements-clarity'`, `'backend-development'`, `'ui-ux-pro-max'`, `'frontend-design'`, `'codex'`, `'agy'`) ou do estágio em que a pergunta foi criada, `dispatchQuestion` **sempre** define `channel = ASK_USER_QUESTION`. Não há ramificação por origem — o canal é atribuído incondicionalmente.

Essa invariante é coberta pela **Propriedade 6** do design:

> *For any* conjunto de perguntas em qualquer estágio e de qualquer origem, incluindo perguntas de fallback por indisponibilidade do Codex ou do AGY, toda pergunta despachada ao usuário deve ter `channel` igual a `ASK_USER_QUESTION`.

---

## Aplicação por Estágio

### INIT

- Se a demanda estiver ausente ou vazia (`needsDemanda = true`), o Pensador usa `AskUserQuestion` para solicitá-la antes de iniciar o `PRD_BASE`.

### PRD_BASE

- Nenhuma pergunta ao usuário neste estágio. O Pensador gera o PRD Base automaticamente. Não há chamada a `AskUserQuestion`.

### EXPAND

- Requisitos candidatos identificados pelo Pensador a partir do `PRD_Base` são apresentados via `AskUserQuestion`.
- `origin = 'pensador'`.

### CLARITY / BACKEND / UIUX / FRONTEND (brainstorm)

- Lacunas retornadas pela skill do estágio são convertidas em perguntas e apresentadas via `AskUserQuestion`.
- `origin` = id da skill (`requirements-clarity`, `backend-development`, `ui-ux-pro-max`, `frontend-design`).
- Estágio de domínio não-aplicável → zero perguntas (auto-avanço), sem chamada a `AskUserQuestion`.
- Se a skill estiver indisponível, a pergunta de decisão de fallback é apresentada **individualmente** via `AskUserQuestion` (`origin = 'pensador'`).

### CODEX

- Pontos em aberto do Codex viram perguntas via `AskUserQuestion`. `origin = 'codex'`.
- Indisponibilidade → pergunta de fallback individual via `AskUserQuestion`.

### AGY

- Perguntas de lacunas do AGY via `AskUserQuestion`. `origin = 'agy'`.
- Indisponibilidade → pergunta de fallback individual via `AskUserQuestion`.

### FINAL / DONE

- Há **sempre uma** pergunta de confirmação da presença de **back-end** via `AskUserQuestion` (a heurística `classifyProject` é apresentada como sugestão; a resposta do usuário decide o `comunication_json.md`). Fora isso, o Pensador apenas reporta os caminhos dos artefatos — sem `AskUserQuestion`.

---

## Apresentação de Perguntas: Uma por vez vs. Lotes Agrupados

### Regra geral: uma pergunta por vez

Por padrão, cada pergunta é apresentada individualmente ao usuário via `AskUserQuestion`. Isso garante que a resposta do usuário seja inequivocamente associada a cada pergunta, facilitando o registro no Engine (`recordAnswer`).

### Quando agrupar em lote

O Pensador **pode** agrupar múltiplas perguntas em uma única chamada a `AskUserQuestion` quando:

1. As perguntas são **estreitamente relacionadas** entre si (tratam do mesmo tema ou funcionalidade).
2. A pergunta agrupada permanece **clara e respondível de forma inequívoca** — o usuário consegue identificar e responder cada item individualmente.
3. Todas as perguntas do grupo pertencem ao **mesmo estágio** e têm a **mesma origem**.

Quando um lote é apresentado, formule a pergunta agrupada como uma lista numerada ou estruturada, de modo que cada resposta do usuário possa ser registrada separadamente no Engine.

### Quando NÃO agrupar

- Perguntas de origens diferentes (Pensador + Codex, por exemplo) **não devem** ser agrupadas na mesma chamada.
- Perguntas de estágios diferentes **nunca** são agrupadas.
- Perguntas de fallback por indisponibilidade de subagente **sempre** são apresentadas individualmente — elas exigem uma decisão binária clara do usuário.

---

## Fluxo de Despacho (resumo)

```
pergunta criada (qualquer origem)
        │
        ▼
dispatchQuestion(question)
        │
        ▼
channel = ASK_USER_QUESTION   ← invariante; nunca depende de origin
        │
        ▼
AskUserQuestion(text, options?)
        │
        ▼
resposta do usuário
        │
        ▼
recordAnswer(state, questionId, answer)
        │
        ▼
canAdvance(state)?  →  se sim: advance(state)
```

---

## Rastreabilidade

O uso de `AskUserQuestion` como canal único garante que **todo diálogo entre o Pensador e o usuário seja rastreável**: cada pergunta tem um `id` único, um `stage`, uma `origin` e, após a resposta, um `answer` registrado no estado do Engine. Isso torna o fluxo audável e reproduzível.

---

## Leitura relacionada

- `references/stages.md` — protocolo de fallback por indisponibilidade de subagentes e gates de avanço.
- `references/agent-stack.md` — identificadores e parâmetros do Codex e do AGY.
- `scripts/pensador-engine.mjs` — implementação de referência de `dispatchQuestion`, `ASK_USER_QUESTION` e `addQuestions`.
