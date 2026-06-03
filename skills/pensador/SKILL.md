---
name: pensador
description: Orquestra o fluxo de oito estágios do Pensador que transforma uma demanda em linguagem natural num PRD de alta qualidade. Gera o PRD base (Strict_PRD_Schema), amplia a demanda, faz brainstorm dirigido por skills especializadas (requirements-clarity, backend-development, ui-ux-pro-max, frontend-design), refina com Codex e fecha lacunas de produto com AGY/Gemini. Entrega prd.md, userhistory.md e comunication_json.md (quando há back-end). Toda pergunta ao usuário passa exclusivamente por AskUserQuestion.
---

# Skill: Pensador

Esta skill orquestra o fluxo de **oito estágios de trabalho** do Pensador. Ela aplica a **Skill_PRD_Base** para o conteúdo do PRD, conduz **brainstorms dirigidos por skills especializadas** (Estágios 3–6), delega ao **Codex** (Estágio 7) e ao **AGY** (Estágio 8), e roteia **toda** pergunta — própria, das skills de brainstorm, do Codex, do AGY e de fallback — exclusivamente via `AskUserQuestion`.

O objetivo das etapas de brainstorm é **maximizar a integridade do PRD**: cada skill aplica uma lente de domínio (clareza de requisitos, backend, UI/UX, design de front-end) sobre o que já foi consolidado, expondo lacunas que de outra forma só apareceriam na implementação.

---

## Referências de apoio

| Arquivo | Propósito |
|---|---|
| `skills/prd/SKILL.md` | Skill_PRD_Base — `Strict_PRD_Schema`, entrevista de descoberta, padrões de qualidade do PRD |
| `scripts/pensador-engine.mjs` | Pensador Engine — **especificação determinística de referência** (máquina de estados, gates, mapeamentos, classificação, planejamento de artefatos) |
| `skills/pensador/references/stages.md` | Comportamento detalhado de cada estágio e gates de avanço |
| `skills/pensador/references/skill-stack.md` | As 4 skills de brainstorm: estágio, lente de domínio, invocação e gating de relevância |
| `skills/pensador/references/agent-stack.md` | Subagentes Codex/AGY: mapeamento `extrahigh → high` e modelo AGY |
| `skills/pensador/references/askuserquestion-protocol.md` | Canal único de diálogo — protocolo `AskUserQuestion` |
| `skills/pensador/assets/prd-template.md` | Template do artefato `prd.md` |
| `skills/pensador/assets/userhistory-template.md` | Template do artefato `userhistory.md` |
| `skills/pensador/assets/comunication_json-template.md` | Template do artefato `comunication_json.md` (quando há back-end) |

### Skills de brainstorm consumidas

| Skill | Estágio | Lente |
|---|---|---|
| `requirements-clarity` | CLARITY (3) | Ambiguidades, requisitos implícitos, critérios de aceite verificáveis |
| `backend-development` | BACKEND (4) | Dados, APIs, integrações, segurança, escalabilidade, contratos |
| `ui-ux-pro-max` | UIUX (5) | Fluxos de UX, estados de tela, acessibilidade, hierarquia visual |
| `frontend-design` | FRONTEND (6) | Componentização, design system, responsividade, layout |

---

## Papel do Engine em runtime — leitura obrigatória

> O `scripts/pensador-engine.mjs` é a **especificação determinística de referência** do fluxo, validada pelos testes. Uma skill/command do Claude Code é Markdown interpretado pelo LLM: **ela não importa esse módulo em runtime nem mantém um objeto `state` vivo entre turnos**. O Pensador (o LLM) aplica as **mesmas regras** descritas aqui em prosa.

Na prática isto significa: quando este documento diz "o gate só libera quando não há perguntas pendentes" ou "`extrahigh` mapeia para `high`", essas são regras que **você (o Pensador) deve seguir diretamente**. O Engine existe para (1) definir essas regras de forma inequívoca e testável e (2) impedir desvio (drift) via testes. Se um CLI + persistência de estado forem adicionados no futuro, a skill poderá delegar a ele; até lá, siga as regras em prosa.

O único script efetivamente executado por shell hoje é `scripts/preflight.mjs` (verificação de disponibilidade), invocado pelo command.

---

## Canal único de diálogo — regra invariante

> **Toda** pergunta apresentada ao usuário durante o fluxo — demanda ausente, requisitos candidatos (EXPAND), pontos das skills de brainstorm (CLARITY/BACKEND/UIUX/FRONTEND), pontos do Codex (CODEX), perguntas do AGY (AGY) e decisões de fallback por indisponibilidade — usa **exclusivamente** a ferramenta `AskUserQuestion`.

Nenhum outro mecanismo de diálogo é utilizado. Esta regra não tem exceções. Consulte `references/askuserquestion-protocol.md` para quando agrupar ou separar perguntas.

---

## Gate de avanço — regra invariante

> O Pensador **nunca avança** para o próximo estágio enquanto existir ao menos uma pergunta sem resposta registrada no estágio atual.

- `canAdvance(state)` é verdadeiro **se e somente se** não há perguntas pendentes no `currentStage`.
- Um estágio de brainstorm que produz **zero perguntas** (skill julgada não-aplicável àquela demanda) satisfaz o gate trivialmente e auto-avança. O estágio é **visitado**, nunca pulado.

A sequência canônica é fixa e nunca reordenada:

```
INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE
```

---

## Máquina de estados — visão geral

```
INIT
  Demanda ausente → AskUserQuestion para coletar a demanda
  Demanda presente → avança para PRD_BASE

PRD_BASE — Geração do PRD Base (Strict_PRD_Schema). Sem perguntas — avanço automático.

EXPAND — Requisitos candidatos do próprio Pensador.

CLARITY — Brainstorm com requirements-clarity (sempre relevante).

BACKEND — Brainstorm com backend-development (relevante se houver backend).

UIUX — Brainstorm com ui-ux-pro-max (relevante se houver front-end).

FRONTEND — Brainstorm com frontend-design (relevante se houver front-end).

CODEX — Refinamento técnico com Codex (--effort high).

AGY — Lacunas remanescentes de produto com AGY (gemini-3.1-pro-high).

FINAL — Consolidação (withConsolidated) e geração de artefatos.

DONE — Estado terminal.
```

Cada estágio de trabalho (exceto PRD_BASE) só avança quando todas as suas perguntas têm resposta registrada.

---

## INIT — Verificação da demanda

0. **Retomada (checkpoint):** antes de tudo, verifique se existe um checkpoint em `pensador-output/.pensador-progress.json`. Se existir e `deserializeState` o aceitar (versão compatível, estágio válido), **pergunte ao usuário via `AskUserQuestion`** se deseja **retomar** do estágio salvo ou **recomeçar** do zero. Em "retomar", restaure o estado e siga do `currentStage` salvo; em "recomeçar", ignore (e sobrescreva) o checkpoint. Se não houver checkpoint válido, siga normalmente.
1. Se a demanda estiver vazia, só com espaços ou ausente (`needsDemanda === true`), apresente via `AskUserQuestion`:
   > "Qual é a demanda? Descreva em linguagem natural o que você quer construir ou resolver."
2. Aguarde a resposta e use-a como demanda.
3. Com a demanda presente e não vazia, avance para `PRD_BASE`.

---

## Persistência e retomada (checkpoint)

O fluxo é longo; uma interrupção não deve perder o progresso.

- **Quando gravar:** ao **fechar o gate de cada estágio** (todas as perguntas com desfecho registrado), grave o estado serializado com `serializeState(state)` em `pensador-output/.pensador-progress.json`. O arquivo é o único estado durável entre invocações (a skill em si não mantém objeto vivo entre turnos).
- **Quando ler:** no passo 0 do `INIT`, leia o arquivo e use `deserializeState` — que retorna `null` (nunca lança) para conteúdo ausente, malformado ou de versão incompatível, caso em que se começa um fluxo novo.
- **Limpeza:** ao concluir o estágio `DONE`, o checkpoint pode ser removido (o fluxo terminou) — ou mantido como histórico, a critério do usuário.

> O checkpoint fica sob `pensador-output/` (ignorado pelo Git via `.gitignore`), junto dos artefatos.

---

## PRD_BASE — Geração do PRD Base

**Objetivo:** produzir o `PRD_Base` estruturado a partir da demanda, aplicando o `Strict_PRD_Schema` da `Skill_PRD_Base` (`skills/prd/SKILL.md`).

1. Carregue a `Skill_PRD_Base` para obter o `Strict_PRD_Schema` (10 seções na ordem) e o roteiro da Entrevista de Descoberta.
2. Aplique a entrevista sobre a demanda para inferir o conteúdo de cada seção.
3. Para cada seção: preencha se inferível; caso contrário marque exatamente `"TBD"` — nunca omita, nunca invente.

**Gate de saída:** todas as 10 seções preenchidas ou `"TBD"`. Sem perguntas — avanço automático.

---

## EXPAND — Ampliação pelo Pensador

**Objetivo:** ampliar a demanda com requisitos candidatos não previstos no enunciado.

1. Revise as seções `"TBD"` do `PRD_Base` (cada uma é uma lacuna candidata), funcionalidades implícitas, fluxos alternativos e requisitos não-funcionais (auth, erros, desempenho, acessibilidade, persistência, mobile…).
2. Para cada candidato, formule uma pergunta clara. Registre com `origin = 'pensador'`, `stage = 'EXPAND'`.
3. Apresente via `AskUserQuestion` (agrupe apenas candidatos estreitamente relacionados, mesma origem/estágio). Registre cada resposta.

**Gate de saída:** todas as perguntas de EXPAND respondidas.

---

## Estágios de Brainstorm (CLARITY, BACKEND, UIUX, FRONTEND) — procedimento comum

Os quatro estágios seguem o **mesmo procedimento**, mudando apenas a skill e a lente. Veja `references/skill-stack.md` para os detalhes de cada skill.

### Procedimento genérico

1. **Avalie a relevância** (apenas para BACKEND/UIUX/FRONTEND; CLARITY é sempre relevante):
   - Classifique a natureza do projeto a partir da demanda + `PRD_Base` + requisitos consolidados até aqui (sinais `hasBackend` / `hasFrontend`).
   - `BACKEND` é relevante quando há backend; `UIUX` e `FRONTEND` quando há front-end.
   - Se **não for relevante**, registre zero perguntas e auto-avance (o estágio é visitado, não pulado). Informe brevemente: "Estágio <X> não se aplica a esta demanda."
2. **Invoque a skill** para obter a lente de domínio:
   ```
   Skill(skill="cc-pensador:<nome-da-skill>")
   ```
   Forneça à skill a demanda, o `PRD_Base` e os requisitos consolidados, pedindo que ela identifique **lacunas, ambiguidades e decisões em aberto** no seu domínio.
3. **Converta** cada lacuna retornada em uma pergunta objetiva. Registre com `origin = <origin da skill>` (ex.: `requirements-clarity`) e `stage = <ID do estágio>`.
4. **Deduplique antes de perguntar:** descarte qualquer lacuna **já respondida** num estágio anterior (especialmente EXPAND) ou já coberta pelo `PRD_Base`. Não reapresente ao usuário uma pergunta cujo conteúdo já foi resolvido — reaproveite a resposta existente. CLARITY, em particular, **não** repete os candidatos que EXPAND já fechou.
5. **Apresente** via `AskUserQuestion`. Não agrupe perguntas de origens diferentes nem de estágios diferentes.
6. **Registre** cada resposta. Respostas de brainstorm entram no consolidado com `resolvesGap = true`.

### Volume e priorização das perguntas

Para evitar fadiga do usuário num fluxo de oito estágios:

- **Priorize por impacto:** ordene as lacunas pelo risco de não resolvê-las agora e apresente primeiro as de **maior impacto**. Como diretriz, mantenha cada estágio em torno de **3–5 perguntas essenciais**; lacunas menores podem ser registradas como `"TBD"` no PRD em vez de virarem pergunta.
- **Ofereça saída explícita:** ao apresentar o lote de um estágio, inclua sempre a opção de **"seguir sem responder as demais"**. Se o usuário a escolher, registre as perguntas restantes do estágio como deliberadamente diferidas (com a marcação correspondente) — isso satisfaz o gate sem forçar respostas. O gate exige que toda pergunta tenha um desfecho registrado (respondida **ou** explicitamente diferida pelo usuário), nunca uma pergunta pendente silenciosa.

### Fallback (skill indisponível)

Se a skill não puder ser carregada/invocada:
1. Registre a indisponibilidade com a evidência.
2. Apresente via `AskUserQuestion`, **individualmente**:
   > "A skill `<nome>` está indisponível. Deseja prosseguir sem este brainstorm, ou prefere aguardar/retentar?"
3. Registre como `origin = 'pensador'`, `stage = <ID do estágio>`. O gate não avança até essa pergunta ter resposta.

### Foco de cada estágio

- **CLARITY → `requirements-clarity`** *(sempre)*: ambiguidades, termos vagos, requisitos implícitos, critérios de aceite verificáveis, escopo fora/dentro.
- **BACKEND → `backend-development`** *(se backend)*: modelo de dados, endpoints/contratos, integrações, autenticação/autorização, consistência, escalabilidade, observabilidade.
- **UIUX → `ui-ux-pro-max`** *(se front-end)*: fluxos de UX, estados de tela (vazio/carregando/erro), acessibilidade, hierarquia visual, microcopy.
- **FRONTEND → `frontend-design`** *(se front-end)*: componentização, design system, responsividade, layout, padrões de interação.

**Gate de saída (cada estágio):** todas as perguntas do estágio (incl. fallback) respondidas.

---

## CODEX — Refinamento técnico

**Subagente:** `codex:codex-rescue` · **Parâmetro efetivo:** `--effort high` (de `mapEffort('extrahigh')` — nunca `extrahigh`).

> **Como o parâmetro é passado:** o tool `Agent` não tem campo de flags. Comunique o effort **no corpo do prompt** ao subagente (ex.: "Use effort 'high'.") e registre o valor para rastreabilidade. Veja `references/agent-stack.md`.

```
Agent(subagent_type="codex:codex-rescue", prompt=<prompt incluindo "effort: high">)
```

**Prompt mínimo:**
```
Analise os requisitos abaixo e identifique lacunas técnicas, funcionalidades não previstas,
inconsistências ou riscos. Use effort: high. Retorne uma lista de pontos em aberto.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <consolidado de EXPAND..FRONTEND>
```

Para cada ponto: crie `Question` com `origin = 'codex'`, `stage = 'CODEX'`; apresente via `AskUserQuestion`; registre a resposta (`resolvesGap = true`).

**Fallback (indisponível):** pergunta individual via `AskUserQuestion` ("O Codex está indisponível… prosseguir ou aguardar/retentar?"), `origin = 'pensador'`, `stage = 'CODEX'`. Em "aguardar/retentar", retente antes de nova pergunta de fallback.

**Gate de saída:** todas as perguntas de CODEX (incl. fallback) respondidas.

---

## AGY — Lacunas de produto

**Subagente:** `cc-antigravity-plugin:antigravity-agent` · **Modelo:** `gemini-3.1-pro-high` (de `agyStageModel()`, verificado no `AGY_MODEL_ALLOWLIST`).

> **Como o parâmetro é passado:** comunique o modelo **no corpo do prompt** (ou conforme a interface do antigravity-agent) e registre para rastreabilidade. Veja `references/agent-stack.md`.

```
Agent(subagent_type="cc-antigravity-plugin:antigravity-agent", prompt=<prompt incluindo "model: gemini-3.1-pro-high">)
```

**Prompt mínimo:**
```
Levante perguntas sobre lacunas remanescentes, aspectos não cobertos, cenários de uso não
considerados ou riscos de produto. Retorne uma lista de perguntas abertas para o usuário.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <consolidado de EXPAND..CODEX>
```

Para cada pergunta: `origin = 'agy'`, `stage = 'AGY'`; apresente via `AskUserQuestion`; registre (`resolvesGap = true`).

**Fallback (indisponível):** espelha o do Codex (`QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`), pergunta individual, `origin = 'pensador'`, `stage = 'AGY'`.

**Gate de saída:** todas as perguntas de AGY (incl. fallback) respondidas. Avança para FINAL.

---

## FINAL — Geração de artefatos

**Gate de entrada:** `currentStage ∈ {FINAL, DONE}`.

### Procedimento

1. **Consolide:** aplique `withConsolidated(state)` — isto grava `consolidate(state)` em `state.consolidated`. **Este passo é obrigatório antes de planejar artefatos**, pois `planArtifacts`/`buildArtifactList` leem `state.consolidated` (que está vazio até aqui). Saltar este passo faz o `comunication_json.md` nunca ser planejado.
2. **Classifique o projeto:** `classifyProject(consolidated)` → `{hasBackend, hasFrontend, isFullstack}`. A classificação é uma heurística por palavra-chave (sujeita a falso-positivo/negativo). Como o `comunication_json.md` é gatilhado por `hasBackend`, **sempre confirme com o usuário via `AskUserQuestion`** se o projeto **tem back-end** (API/contrato de comunicação) — apresentando o resultado da heurística como sugestão — **antes** de decidir gerar o artefato. A resposta do usuário prevalece sobre a heurística.
3. **Planeje:** `planArtifacts(state)` → `prd` e `userhistory` sempre; `comunication = hasBackend` (confirmado no passo 2). `buildArtifactList(state)` → lista com `filename` e `path` (sob `pensador-output/`).

> **Destino e sobrescrita (regra invariante):** todo artefato é gravado sob `pensador-output/` (caminho de `buildArtifactList`) — **nunca** na raiz do projeto, para não clobberar um `prd.md` existente. Antes de gravar cada arquivo, verifique se ele já existe nesse diretório; **se existir, confirme a sobrescrita via `AskUserQuestion`** (canal único) antes de escrever. Crie o diretório se ausente.

### Geração do `prd.md`
Consolide o `PRD_Base` com as respostas de EXPAND, CLARITY, BACKEND, UIUX, FRONTEND, CODEX e AGY. Aplique o `Strict_PRD_Schema` e o template `assets/prd-template.md`. Seções sem informação → `"TBD"`. As respostas das skills de brainstorm devem aparecer nas seções pertinentes (CLARITY→Requisitos/Critérios; BACKEND→Arquitetura/RNF; UIUX/FRONTEND→Casos de Uso/Arquitetura/UI). Grave em `prd.md`.

### Geração do `userhistory.md`
Use `buildUserHistory(consolidated)` (passos contíguos a partir de 1) e o template `assets/userhistory-template.md`, derivando o fluxo principal dos casos de uso do `prd.md`. Incorpore os fluxos/estados levantados em UIUX. Grave em `userhistory.md`.

### Geração do `comunication_json.md` (quando há back-end)
**Condição:** `planArtifacts(state).comunication === true` — verdadeiro sempre que houver back-end (`classifyProject(consolidated).hasBackend`), seja fullstack (contrato front↔back) ou back-end-only (contrato de API para consumidores externos). Use `assets/comunication_json-template.md`; documente endpoints, schemas de request/response e códigos de erro, incorporando os contratos levantados em BACKEND e mantendo consistência com os IDs `RF-XX`. Grave em `comunication_json.md`. Se **não** houver back-end, **não** gere e registre no `prd.md` que não se aplica.

### Reporte ao usuário
Informe o `path` de cada artefato gerado (sem `AskUserQuestion`).

**Gate de saída para DONE:** todos os artefatos aplicáveis gerados e caminhos reportados.

---

## DONE — Estado terminal

Fluxo encerrado. Apresente um resumo final com os caminhos dos artefatos e uma breve confirmação.

---

## Resumo dos gates

| Estágio | Gate de Avanço |
|---|---|
| `INIT` | Demanda presente e não vazia |
| `PRD_BASE` | PRD_Base concluído — 10 seções preenchidas ou `"TBD"` |
| `EXPAND` | Todas as perguntas respondidas |
| `CLARITY` | Todas as perguntas respondidas (incl. fallback) |
| `BACKEND` | Todas as perguntas respondidas (incl. fallback); zero perguntas se não-aplicável |
| `UIUX` | Todas as perguntas respondidas (incl. fallback); zero perguntas se não-aplicável |
| `FRONTEND` | Todas as perguntas respondidas (incl. fallback); zero perguntas se não-aplicável |
| `CODEX` | Todas as perguntas respondidas (incl. fallback) |
| `AGY` | Todas as perguntas respondidas (incl. fallback) |
| `FINAL` | `withConsolidated` aplicado + todos os artefatos gerados e caminhos reportados |
| `DONE` | — (terminal) |

## Delegação por estágio (de `STAGE_DELEGATION`)

| Estágio | Tipo | Alvo | Parâmetro |
|---|---|---|---|
| CLARITY | skill | `requirements-clarity` | — |
| BACKEND | skill | `backend-development` | — |
| UIUX | skill | `ui-ux-pro-max` | — |
| FRONTEND | skill | `frontend-design` | — |
| CODEX | subagente | `codex:codex-rescue` | `--effort high` (no prompt) |
| AGY | subagente | `cc-antigravity-plugin:antigravity-agent` | `--model gemini-3.1-pro-high` (no prompt) |
