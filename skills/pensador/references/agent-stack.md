# Agent Stack do Pensador — Referência

Este documento descreve os **subagentes** usados pelo Pensador nos estágios CODEX e AGY, o mapeamento de effort do Codex e o modelo do AGY.

Para as quatro **skills de brainstorm** (CLARITY/BACKEND/UIUX/FRONTEND), veja `references/skill-stack.md`.

---

## Visão Geral dos Subagentes

| Subagente | Identificador | Estágio | Parâmetro efetivo |
|---|---|---|---|
| Codex | `codex:codex-rescue` | CODEX (7) | `--effort high` |
| AGY | `cc-antigravity-plugin:antigravity-agent` | AGY (8) | `--model gemini-3.1-pro-high` |

---

## Como invocar subagentes — passagem de parâmetros (importante)

O tool `Agent` recebe `subagent_type` e `prompt`; **não há um campo para flags CLI** (`--effort`, `--model`). Portanto:

> O parâmetro efetivo é **comunicado no corpo do prompt** ao subagente (e/ou conforme a interface própria do subagente), e o valor é **registrado para rastreabilidade**. Nunca dependa de um campo de flag inexistente.

```
Agent(subagent_type="codex:codex-rescue", prompt="... Use effort: high. ...")
Agent(subagent_type="cc-antigravity-plugin:antigravity-agent", prompt="... Use model: gemini-3.1-pro-high. ...")
```

Os valores vêm sempre do Engine: `mapEffort('extrahigh')` para o Codex e `agyModelForStage4()` para o AGY.

---

## Codex — `codex:codex-rescue`

### Mapeamento de Effort: `extrahigh → high`

O usuário solicita effort `extrahigh`, mas o `codex:codex-rescue` reconhece apenas:

- `medium`
- `high`

| Solicitado (`requested`) | Efetivo (comunicado ao Codex) |
|---|---|
| `medium` | `medium` |
| `high` | `high` |
| `extrahigh` | `high` |

`extrahigh` é mapeado para `high` (o nível máximo real do Codex). O termo `extrahigh` preserva a intenção do usuário no vocabulário do fluxo; o valor passado é **sempre** `high`.

**Regra:** nunca comunique `extrahigh` ao Codex. Use sempre o retorno de `mapEffort('extrahigh')` (que é `'high'`).

```js
import { mapEffort } from '../../../scripts/pensador-engine.mjs';
const effort = mapEffort('extrahigh'); // 'high'
// → inclua "Use effort: high." no prompt do subagente
```

---

## AGY — `cc-antigravity-plugin:antigravity-agent`

### Modelo: `gemini-3.1-pro-high`

- Retornado por `agyModelForStage4()`.
- Verificado em tempo de chamada como membro do `AGY_MODEL_ALLOWLIST`.
- Única fonte de verdade — nunca hardcode o valor.

```js
import { agyModelForStage4 } from '../../../scripts/pensador-engine.mjs';
const model = agyModelForStage4(); // 'gemini-3.1-pro-high'
// → inclua "Use model: gemini-3.1-pro-high." no prompt do subagente
```

### `AGY_MODEL_ALLOWLIST` — por que existe

```js
export const AGY_MODEL_ALLOWLIST = ['gemini-3.1-pro-high'];
```

**Propósito:** guardar contra _model drift_ — o identificador do modelo mudar (atualização, renomeação, substituição) sem que o fluxo seja atualizado conscientemente. `agyModelForStage4()` lança erro explícito se `STAGE4_MODEL` não estiver na allowlist. Adotar um novo modelo deve ser **intencional**: adicionar à allowlist e atualizar `STAGE4_MODEL`.

---

## Disponibilidade e preflight

O `scripts/preflight.mjs` verifica a presença do Codex e do AGY antes do fluxo. **Atenção:** a verificação por binário CLI (`codex --version` / `agy --version`) pode gerar falso-negativo quando o subagente é distribuído apenas como *plugin* (sem binário homônimo no PATH) — em especial o AGY. Trate "indisponível" do preflight como um **sinal**, não veredito: confirme aplicando o protocolo de fallback no estágio correspondente. Veja `references/stages.md`.

---

## Resumo de Identificadores e Parâmetros

```
# CODEX (Estágio 7)
Subagente : codex:codex-rescue
Parâmetro : effort high   (de mapEffort('extrahigh') === 'high'; comunicado no prompt)

# AGY (Estágio 8)
Subagente : cc-antigravity-plugin:antigravity-agent
Parâmetro : model gemini-3.1-pro-high   (de agyModelForStage4(); comunicado no prompt)
```

---

## Leitura relacionada

- `references/skill-stack.md` — as 4 skills de brainstorm (CLARITY/BACKEND/UIUX/FRONTEND).
- `references/stages.md` — gates por estágio e protocolo de fallback.
- `references/askuserquestion-protocol.md` — canal único de diálogo.
- `scripts/pensador-engine.mjs` — `mapEffort`, `agyModelForStage4`, `AGY_MODEL_ALLOWLIST`, `STAGE_DELEGATION`.
