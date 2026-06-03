# Agent Stack do Pensador — Referência

Este documento descreve os subagentes utilizados pelo Pensador, o mapeamento de effort do Codex e o modelo do AGY.

---

## Visão Geral dos Subagentes

O Pensador delega tarefas a dois subagentes especializados em estágios distintos do fluxo:

| Subagente | Identificador | Estágio | Parâmetro |
|---|---|---|---|
| Codex | `codex:codex-rescue` | Estágio 3 | `--effort high` |
| AGY | `cc-antigravity-plugin:antigravity-agent` | Estágio 4 | `--model gemini-3.1-pro-high` |

---

## Codex — `codex:codex-rescue`

### Como chamar

```
Agent(codex:codex-rescue, --effort high, <prompt>)
```

### Mapeamento de Effort: `extrahigh → high`

O usuário solicita effort `extrahigh` ao Codex. Contudo, o `codex:codex-rescue` reconhece apenas dois níveis de effort efetivo:

- `--effort medium`
- `--effort high`

O Pensador Engine mapeia o nível solicitado para o nível efetivo via `mapEffort(requested)`:

| Solicitado (`requested`) | Efetivo (parâmetro passado ao Codex) |
|---|---|
| `medium` | `--effort medium` |
| `high` | `--effort high` |
| `extrahigh` | `--effort high` |

Portanto, `extrahigh` é mapeado para `high` — o nível máximo real do Codex. O termo `extrahigh` preserva a intenção do usuário no vocabulário do fluxo; o parâmetro passado ao subagente é **sempre** `--effort high`.

**Regra:** nunca passe `--effort extrahigh` ao `codex:codex-rescue`. Use sempre o retorno de `mapEffort('extrahigh')` (que é `'high'`) para construir o parâmetro.

### Função do Engine

```js
import { mapEffort } from '../../../scripts/pensador-engine.mjs';

const effortParam = `--effort ${mapEffort('extrahigh')}`;
// effortParam === '--effort high'
```

---

## AGY — `cc-antigravity-plugin:antigravity-agent`

### Como chamar

```
Agent(cc-antigravity-plugin:antigravity-agent, --model gemini-3.1-pro-high, <prompt>)
```

### Modelo: `gemini-3.1-pro-high`

O modelo utilizado no Estágio 4 é `gemini-3.1-pro-high`. Esse identificador é:

- Retornado por `agyModelForStage4()` no Pensador Engine.
- Verificado em tempo de chamada como membro do `AGY_MODEL_ALLOWLIST`.
- A única fonte de verdade para o modelo do AGY — nunca hardcode o valor diretamente.

### Função do Engine

```js
import { agyModelForStage4 } from '../../../scripts/pensador-engine.mjs';

const modelParam = `--model ${agyModelForStage4()}`;
// modelParam === '--model gemini-3.1-pro-high'
```

### `AGY_MODEL_ALLOWLIST` — Por que existe

O `AGY_MODEL_ALLOWLIST` é a lista de identificadores de modelo AGY reconhecidos pelo Pensador:

```js
export const AGY_MODEL_ALLOWLIST = [
  'gemini-3.1-pro-high',
];
```

**Propósito:** guardar contra _model drift_ — a situação em que o identificador do modelo AGY muda (por atualização, renomeação ou substituição de versão) sem que o fluxo do Pensador seja atualizado conscientemente. Ao verificar o membro da allowlist em `agyModelForStage4()`, qualquer tentativa de usar um modelo não autorizado lança um erro explícito em vez de falhar silenciosamente ou produzir resultados inesperados.

Se um novo modelo AGY for adotado, a atualização deve ser **intencional**: adicionar o identificador ao `AGY_MODEL_ALLOWLIST` e atualizar `STAGE4_MODEL` no Engine.

---

## Resumo de Identificadores e Parâmetros

```
# Estágio 3 — Codex
Subagente : codex:codex-rescue
Parâmetro : --effort high
Origem    : mapEffort('extrahigh') === 'high'

# Estágio 4 — AGY
Subagente : cc-antigravity-plugin:antigravity-agent
Parâmetro : --model gemini-3.1-pro-high
Origem    : agyModelForStage4() === 'gemini-3.1-pro-high' (verificado no AGY_MODEL_ALLOWLIST)
```

---

## Leitura relacionada

- `references/stages.md` — gates de avanço por estágio e protocolo de fallback por indisponibilidade.
- `references/askuserquestion-protocol.md` — canal único de diálogo com o usuário.
- `scripts/pensador-engine.mjs` — implementação de referência de `mapEffort`, `agyModelForStage4` e `AGY_MODEL_ALLOWLIST`.
