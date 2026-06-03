# Estágios do Pensador — Referência

Este documento detalha cada estágio do fluxo do Pensador, seus gates de avanço e as regras de delegação e fallback para as skills de brainstorm, o Codex e o AGY.

---

## Visão Geral da Máquina de Estados

```
INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE
```

A sequência é **fixa e nunca reordenada**. O avanço é controlado por um **gate**: o Pensador só avança quando **todas** as perguntas do estágio atual têm resposta registrada. Nenhum estágio é pulado — um estágio de brainstorm não-aplicável é **visitado** e auto-avança com zero perguntas.

Funil de raciocínio: **gerar** (PRD base) → **ampliar** (Pensador) → **clarificar** (requirements-clarity) → **aprofundar por domínio** (backend, ui/ux, frontend) → **varredura técnica** (Codex) → **varredura de produto** (AGY) → **consolidar** (Final).

> **Nota sobre o Engine:** `scripts/pensador-engine.mjs` é a especificação determinística de referência (testada), não um runtime importado pela skill. `canAdvance`/`advance` descrevem regras que o Pensador (LLM) segue diretamente. Veja a seção "Papel do Engine em runtime" em `SKILL.md`.

---

## INIT

**Propósito:** receber a demanda antes de iniciar o fluxo.

- Demanda fornecida (`$ARGUMENTS` não vazio) → `needsDemanda = false`, avança para `PRD_BASE`.
- Demanda ausente/só espaços → `needsDemanda = true`, o Pensador a solicita via `AskUserQuestion` antes de sair do `INIT`.

**Gate:** demanda presente e não vazia.

---

## PRD_BASE — Geração do PRD Base

**Propósito:** rascunho estruturado do PRD a partir da demanda, aplicando o `Strict_PRD_Schema` da `Skill_PRD_Base`.

- Aplica a Entrevista de Descoberta para inferir cada seção.
- Seção não inferível → valor exato `"TBD"` (nunca omitida/inventada).
- Resultado é o `PRD_Base`, base dos estágios seguintes.

**Gate:** `PRD_Base` completo (10 seções preenchidas ou `"TBD"`). Sem perguntas — avanço automático.

---

## EXPAND — Ampliação pelo Pensador

**Propósito:** ampliar a demanda com requisitos candidatos não previstos.

1. Revisar seções `"TBD"`, funcionalidades implícitas, fluxos alternativos, integrações e RNFs sugeridos mas não descritos.
2. Formular uma pergunta clara por candidato (`origin = 'pensador'`, `stage = 'EXPAND'`).
3. Apresentar via `AskUserQuestion` (agrupando só candidatos relacionados de mesma origem/estágio). Registrar respostas.

**Exemplos de candidatos:** autenticação/controle de acesso, tratamento de erros e validação, desempenho/disponibilidade, mobile/acessibilidade, persistência e backup.

**Gate:** todas as perguntas de EXPAND respondidas.

---

## Estágios de Brainstorm — CLARITY, BACKEND, UIUX, FRONTEND

Estes quatro estágios delegam a uma **skill especializada** para aplicar uma lente de domínio sobre o que já foi consolidado, expondo lacunas. Eles compartilham o mesmo protocolo (detalhado em `references/skill-stack.md`).

### Protocolo comum

1. **Relevância** (BACKEND/UIUX/FRONTEND; CLARITY é sempre relevante):
   - Classificar a natureza do projeto (`hasBackend` / `hasFrontend`) a partir da demanda + `PRD_Base` + consolidado parcial.
   - Não-relevante → zero perguntas + auto-avanço (estágio visitado, não pulado).
2. **Invocar a skill** via `Skill(skill="cc-pensador:<nome>")`, fornecendo demanda + PRD_Base + consolidado e pedindo lacunas/ambiguidades/decisões em aberto do domínio.
3. **Converter** cada lacuna em pergunta (`origin = <origin da skill>`, `stage = <ID>`).
4. **Apresentar** via `AskUserQuestion` (sem agrupar origens/estágios diferentes).
5. **Registrar** respostas — entram no consolidado com `resolvesGap = true`.

### Fallback (skill indisponível)

1. Registrar indisponibilidade com evidência.
2. `AskUserQuestion` **individual**: "A skill `<nome>` está indisponível. Prosseguir sem este brainstorm, ou aguardar/retentar?" (`origin = 'pensador'`, `stage = <ID>`).
3. Prosseguir → registra resposta, gate libera. Aguardar/retentar → retenta antes de nova pergunta.

### Detalhe por estágio

| Estágio | Skill | Relevante quando | Foco |
|---|---|---|---|
| **CLARITY** | `requirements-clarity` | sempre | Ambiguidades, termos vagos, requisitos implícitos, critérios de aceite verificáveis, escopo |
| **BACKEND** | `backend-development` | há backend | Modelo de dados, endpoints/contratos, integrações, auth, consistência, escalabilidade, observabilidade |
| **UIUX** | `ui-ux-pro-max` | há front-end | Fluxos de UX, estados de tela (vazio/carregando/erro), acessibilidade, hierarquia visual, microcopy |
| **FRONTEND** | `frontend-design` | há front-end | Componentização, design system, responsividade, layout, padrões de interação |

**Gate (cada estágio):** todas as perguntas do estágio (incl. fallback) respondidas.

---

## CODEX — Refinamento técnico

**Subagente:** `codex:codex-rescue` · **Effort efetivo:** `--effort high`.

> O usuário solicita `extrahigh`, mas o Codex reconhece só `medium` e `high`. `mapEffort('extrahigh') === 'high'`. **Sempre** use `high`, nunca `extrahigh`.
>
> **Passagem do parâmetro:** o tool `Agent` não possui campo de flags — comunique `effort: high` **no corpo do prompt** e registre o valor para rastreabilidade.

**Entrada mínima:**
```
Analise os requisitos abaixo e identifique lacunas técnicas, funcionalidades não previstas,
inconsistências ou riscos. Use effort: high. Retorne uma lista de pontos em aberto.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <consolidado de EXPAND..FRONTEND>
```

Cada ponto → pergunta (`origin = 'codex'`, `stage = 'CODEX'`) via `AskUserQuestion`; resposta consolidada com `source = 'codex'`, `resolvesGap = true`.

**Fallback:** pergunta individual via `AskUserQuestion` ("Codex indisponível… prosseguir ou aguardar/retentar?"). O gate trata como qualquer pergunta.

**Gate:** todas as perguntas de CODEX (incl. fallback) respondidas.

---

## AGY — Lacunas de produto

**Subagente:** `cc-antigravity-plugin:antigravity-agent` · **Modelo:** `gemini-3.1-pro-high` (de `agyStageModel()`, no `AGY_MODEL_ALLOWLIST`).

> **Passagem do parâmetro:** comunique `model: gemini-3.1-pro-high` no corpo do prompt (ou conforme a interface do antigravity-agent) e registre para rastreabilidade.

**Entrada mínima:**
```
Levante perguntas sobre lacunas remanescentes, aspectos não cobertos, cenários de uso não
considerados ou riscos de produto. Retorne uma lista de perguntas abertas para o usuário.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <consolidado de EXPAND..CODEX>
```

Cada pergunta → `origin = 'agy'`, `stage = 'AGY'` via `AskUserQuestion`; resposta consolidada com `source = 'agy'`, `resolvesGap = true`.

**Fallback:** status crus do bridge (`QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`) preservados; pergunta individual via `AskUserQuestion`.

**Gate:** todas as perguntas de AGY (incl. fallback) respondidas. Avança para FINAL.

---

## FINAL — Geração dos Artefatos

**Gate de entrada:** `currentStage ∈ {FINAL, DONE}`.

**Processo:**
1. **`withConsolidated(state)`** — grava `consolidate(state)` em `state.consolidated`. **Obrigatório antes de planejar**: `planArtifacts`/`buildArtifactList` leem `state.consolidated`.
2. `classifyProject(consolidated)` → `{hasBackend, hasFrontend, isFullstack}`. Sinal ambíguo → confirmar fullstack com o usuário via `AskUserQuestion`.
3. `planArtifacts(state)` → `prd`/`userhistory` sempre; `comunication = isFullstack`.
4. Gerar `prd.md` (Strict_PRD_Schema + template), incorporando as respostas de todos os estágios nas seções pertinentes.
5. Gerar `userhistory.md` (`buildUserHistory`, passos contíguos a partir de 1).
6. Se fullstack, gerar `comunication_json.md` (contratos levantados em BACKEND).
7. `buildArtifactList(state)` → informar o `path` de cada artefato.

> **Destino e sobrescrita:** os artefatos são gravados sob `pensador-output/` (nunca na raiz). Antes de gravar cada arquivo, se ele já existir nesse diretório, **confirme a sobrescrita via `AskUserQuestion`**. Crie o diretório se ausente.

| Artefato | Arquivo | Condição |
|---|---|---|
| PRD Final | `prd.md` | Sempre |
| Jornada do Usuário | `userhistory.md` | Sempre |
| Comunicação Back-End | `comunication_json.md` | Somente se `isFullstack === true` |

**Gate para DONE:** artefatos aplicáveis gerados e caminhos reportados.

---

## DONE

Estado terminal. Sem perguntas nem ações pendentes. Resumo final com os caminhos dos artefatos.

---

## Resumo dos Gates

| Estágio | Gate de Avanço |
|---|---|
| `INIT` | Demanda presente e não vazia |
| `PRD_BASE` | PRD_Base completo (10 seções preenchidas ou `"TBD"`) |
| `EXPAND` | Todas as perguntas respondidas |
| `CLARITY` | Todas respondidas (incl. fallback) |
| `BACKEND` | Todas respondidas (incl. fallback); zero se não-aplicável |
| `UIUX` | Todas respondidas (incl. fallback); zero se não-aplicável |
| `FRONTEND` | Todas respondidas (incl. fallback); zero se não-aplicável |
| `CODEX` | Todas respondidas (incl. fallback) |
| `AGY` | Todas respondidas (incl. fallback) |
| `FINAL` | `withConsolidated` + artefatos gerados e caminhos reportados |
| `DONE` | — (terminal) |

---

## Canal Único de Diálogo

**Toda** pergunta — do Pensador, das skills de brainstorm, do Codex, do AGY ou de fallback — usa **exclusivamente** `AskUserQuestion`. Consulte `references/askuserquestion-protocol.md` e `references/skill-stack.md` / `references/agent-stack.md`.
