# Skill: Pensador

Esta skill orquestra o fluxo de cinco estágios do Pensador. Ela consulta o **Pensador Engine** para decisões de gate, mapeamentos e planejamento de artefatos, aplica a **Skill_PRD_Base** para o conteúdo do PRD, delega ao **Codex** (Estágio 3) e ao **AGY** (Estágio 4), e roteia **toda** pergunta — própria, do Codex, do AGY e de fallback — exclusivamente via `AskUserQuestion`.

---

## Referências de apoio

| Arquivo | Propósito |
|---|---|
| `skills/prd/SKILL.md` | Skill_PRD_Base — `Strict_PRD_Schema`, entrevista de descoberta, padrões de qualidade do PRD |
| `scripts/pensador-engine.mjs` | Pensador Engine — máquina de estados, gates, mapeamentos, planejamento de artefatos |
| `skills/pensador/references/stages.md` | Comportamento detalhado de cada estágio e gates de avanço |
| `skills/pensador/references/agent-stack.md` | Subagentes: mapeamento `extrahigh → high` (Codex) e modelo AGY |
| `skills/pensador/references/askuserquestion-protocol.md` | Canal único de diálogo — protocolo `AskUserQuestion` |
| `skills/pensador/assets/prd-template.md` | Template do artefato `prd.md` |
| `skills/pensador/assets/userhistory-template.md` | Template do artefato `userhistory.md` |
| `skills/pensador/assets/comunication_json-template.md` | Template do artefato `comunication_json.md` (somente Projeto_Fullstack) |

---

## Canal único de diálogo — regra invariante

> **Toda** pergunta apresentada ao usuário durante o fluxo — demanda ausente, requisitos candidatos (Estágio 2), pontos do Codex (Estágio 3), perguntas do AGY (Estágio 4) e decisões de fallback por indisponibilidade — usa **exclusivamente** a ferramenta `AskUserQuestion`.

Nenhum outro mecanismo de diálogo é utilizado. Esta regra não tem exceções.

O Engine modela esse invariante em `dispatchQuestion(question)`, que sempre retorna `channel = ASK_USER_QUESTION` independentemente da origem (`pensador | codex | agy`).

Consulte `references/askuserquestion-protocol.md` para o protocolo completo de quando agrupar ou separar perguntas.

---

## Gate de avanço — regra invariante

> O Pensador **nunca avança** para o próximo estágio enquanto existir ao menos uma pergunta sem resposta registrada no estágio atual.

O Engine implementa esse controle em:
- `canAdvance(state)` — retorna `true` somente se não há perguntas pendentes no `currentStage`.
- `advance(state)` — avança um passo em `STAGE_ORDER` se `canAdvance` for `true`; retorna o mesmo estado sem modificação quando bloqueado (no-op).

A sequência canônica é fixa e nunca reordenada:

```
INIT → STAGE_1 → STAGE_2 → STAGE_3 → STAGE_4 → FINAL → DONE
```

---

## Máquina de estados — visão geral

```
INIT
  Demanda ausente → AskUserQuestion para coletar a demanda
  Demanda presente → avança para STAGE_1

STAGE_1 — Geração do PRD Base
  Gate de saída: PRD_Base concluído (todas as seções preenchidas ou "TBD")
  Sem perguntas ao usuário neste estágio — avanço automático

STAGE_2 — Identificação de requisitos candidatos
  Gate de saída: todas as perguntas do estágio respondidas

STAGE_3 — Refinamento com Codex
  Gate de saída: todas as perguntas do estágio respondidas (incluindo fallback, se aplicável)

STAGE_4 — Questionamento com AGY
  Gate de saída: todas as perguntas do estágio respondidas (incluindo fallback, se aplicável)

FINAL — Geração de artefatos
  Gate de entrada: STAGE_4 concluído (planArtifacts retorna plano não-vazio)
  Gate de saída: todos os artefatos gerados e seus caminhos reportados ao usuário

DONE — Estado terminal
```

---

## INIT — Verificação da demanda

**Função do Engine:** `initState(demanda)`

Ao iniciar a skill, verifique se a demanda está presente:

1. Chame `initState(demanda)`.
2. Se `state.needsDemanda === true` (demanda vazia, só espaços ou ausente):
   - Apresente ao usuário via `AskUserQuestion`:
     > "Qual é a demanda? Descreva em linguagem natural o que você quer construir ou resolver."
   - Aguarde a resposta e use-a como demanda. Chame `initState(resposta)` novamente.
3. Quando `state.needsDemanda === false`, avance chamando `advance(state)` — o próximo estágio é `STAGE_1`.

---

## STAGE_1 — Geração do PRD Base

**Objetivo:** produzir o `PRD_Base` estruturado a partir da demanda, aplicando o `Strict_PRD_Schema` definido na `Skill_PRD_Base` (`skills/prd/SKILL.md`).

**Funções do Engine:** `buildPrdBase(demanda, requiredSections)`

### Procedimento

1. Carregue a `Skill_PRD_Base` (`skills/prd/SKILL.md`) para obter:
   - O `Strict_PRD_Schema` — lista das 10 seções obrigatórias na ordem definida.
   - O roteiro da Entrevista de Descoberta — perguntas guia para inferir o conteúdo de cada seção.
2. Aplique a Entrevista de Descoberta sobre a demanda para extrair o conteúdo de cada seção.
3. Para cada seção obrigatória do `Strict_PRD_Schema`:
   - Se a informação for inferível da demanda: preencha com o conteúdo inferido.
   - Se não for inferível: marque com o valor exato `"TBD"` — nunca omita a seção, nunca invente conteúdo.
4. Armazene o resultado em `state.prdBase` (via `buildPrdBase`).

### Gate de saída

Todas as 10 seções obrigatórias do `Strict_PRD_Schema` preenchidas ou marcadas `"TBD"`. Nenhuma pergunta ao usuário neste estágio — avanço automático via `advance(state)`.

---

## STAGE_2 — Identificação de requisitos candidatos

**Objetivo:** ampliar a demanda identificando requisitos adicionais não previstos no enunciado original.

**Funções do Engine:** `addQuestions(state, 'STAGE_2', questions)`, `recordAnswer(state, id, answer)`, `canAdvance(state)`, `advance(state)`

### Como identificar requisitos candidatos

Com base no `PRD_Base` e na demanda, revise:

1. Seções marcadas como `"TBD"` no `PRD_Base` — cada uma representa uma lacuna candidata.
2. Funcionalidades implícitas que a demanda sugere mas não descreve explicitamente.
3. Fluxos alternativos, integrações, restrições não funcionais (autenticação, tratamento de erros, desempenho, acessibilidade, persistência de dados, suporte móvel, etc.).

Para cada requisito candidato identificado, formule uma pergunta clara e objetiva.

### Apresentação ao usuário

- Registre as perguntas com `origin = 'pensador'` e `stage = 'STAGE_2'` usando `addQuestions`.
- Apresente cada pergunta (ou grupo de perguntas estreitamente relacionadas) via `AskUserQuestion`.
- Perguntas de origens diferentes **não** devem ser agrupadas.
- Aguarde a resposta e registre com `recordAnswer(state, questionId, answer)`.

### Gate de saída

`canAdvance(state)` retorna `true` (todas as perguntas do Estágio 2 com resposta registrada). Chame `advance(state)` para transitar ao STAGE_3.

---

## STAGE_3 — Refinamento com Codex

**Objetivo:** aprofundar os requisitos com análise especializada do Codex, identificando lacunas técnicas não previstas nos Estágios 1 e 2.

**Funções do Engine:** `mapEffort('extrahigh')`, `addQuestions(state, 'STAGE_3', questions)`, `recordAnswer`, `canAdvance`, `advance`

### Delegação ao Codex

**Subagente:** `codex:codex-rescue`
**Parâmetro de effort:** `--effort high` (resultado de `mapEffort('extrahigh')` — nunca passe `--effort extrahigh`)

```
Agent(codex:codex-rescue, --effort high, <prompt>)
```

**Prompt mínimo para o Codex:**

```
Analise os requisitos abaixo e identifique lacunas técnicas, funcionalidades não previstas,
inconsistências ou riscos. Retorne uma lista de pontos em aberto que precisam ser esclarecidos.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <lista do Estágio 2>
```

### Processamento do retorno do Codex

Para cada ponto em aberto retornado pelo Codex:

1. Crie uma `Question` com `origin = 'codex'` e `stage = 'STAGE_3'`.
2. Registre com `addQuestions(state, 'STAGE_3', [question])`.
3. Apresente ao usuário via `AskUserQuestion`.
4. Registre a resposta com `recordAnswer`.

As respostas incorporadas ao consolidado terão `source = 'stage_3'` e `resolvesGap = true`.

### Indisponibilidade do Codex (fallback)

Se o Codex retornar erro operacional (timeout, quota esgotada, bloqueio):

1. Registre a indisponibilidade com a evidência retornada pelo subagente.
2. Apresente ao usuário via `AskUserQuestion` — **individualmente, nunca agrupada**:
   > "O Codex (codex:codex-rescue) está indisponível no momento. Deseja prosseguir sem o refinamento técnico do Codex, ou prefere aguardar/retentar?"
3. Registre a pergunta de fallback com `origin = 'pensador'` e `stage = 'STAGE_3'`.
4. Se o usuário optar por **prosseguir**: registre a resposta; `canAdvance` liberará o avanço.
5. Se o usuário optar por **aguardar/retentar**: retente a delegação antes de apresentar nova pergunta de fallback.

O gate não avança enquanto a pergunta de fallback não tiver resposta registrada.

### Gate de saída

`canAdvance(state)` retorna `true` (todas as perguntas do Estágio 3, incluindo eventuais fallbacks, respondidas). Chame `advance(state)` para transitar ao STAGE_4.

---

## STAGE_4 — Questionamento com AGY

**Objetivo:** fechar lacunas remanescentes com uma perspectiva diferente, usando o AGY com Gemini 3.1 Pro high.

**Funções do Engine:** `agyModelForStage4()`, `addQuestions(state, 'STAGE_4', questions)`, `recordAnswer`, `canAdvance`, `advance`

### Delegação ao AGY

**Subagente:** `cc-antigravity-plugin:antigravity-agent`
**Parâmetro de modelo:** `--model gemini-3.1-pro-high` (resultado de `agyModelForStage4()` — verificado no `AGY_MODEL_ALLOWLIST`)

```
Agent(cc-antigravity-plugin:antigravity-agent, --model gemini-3.1-pro-high, <prompt>)
```

**Prompt mínimo para o AGY:**

```
Analise os requisitos abaixo e levante perguntas sobre lacunas remanescentes,
aspectos não cobertos, cenários de uso não considerados ou riscos de produto.
Retorne uma lista de perguntas abertas para o usuário responder.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <lista dos Estágios 2 e 3>
```

### Processamento do retorno do AGY

Para cada pergunta retornada pelo AGY:

1. Crie uma `Question` com `origin = 'agy'` e `stage = 'STAGE_4'`.
2. Registre com `addQuestions(state, 'STAGE_4', [question])`.
3. Apresente ao usuário via `AskUserQuestion`.
4. Registre a resposta com `recordAnswer`.

As respostas incorporadas ao consolidado terão `source = 'stage_4'` e `resolvesGap = true`.

### Indisponibilidade do AGY (fallback)

Se o AGY retornar erro operacional (`QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`):

1. Registre a indisponibilidade com o status retornado pelo bridge AGY.
2. Apresente ao usuário via `AskUserQuestion` — **individualmente, nunca agrupada**:
   > "O AGY (cc-antigravity-plugin:antigravity-agent) está indisponível no momento. Deseja prosseguir sem as perguntas adicionais do AGY, ou prefere aguardar/retentar?"
3. Registre a pergunta de fallback com `origin = 'pensador'` e `stage = 'STAGE_4'`.
4. Se o usuário optar por **prosseguir**: registre a resposta; `canAdvance` liberará o avanço.
5. Se o usuário optar por **aguardar/retentar**: retente a delegação antes de apresentar nova pergunta de fallback.

O gate não avança enquanto a pergunta de fallback não tiver resposta registrada.

### Gate de saída

`canAdvance(state)` retorna `true` (todas as perguntas do Estágio 4, incluindo eventuais fallbacks, respondidas). Chame `advance(state)` para transitar ao FINAL.

---

## FINAL — Geração de artefatos

**Objetivo:** consolidar todo o debate dos estágios anteriores e gerar os artefatos finais.

**Gate de entrada:** `currentStage` deve estar em `{FINAL, DONE}` — `planArtifacts(state)` retorna plano vazio fora desses estágios.

**Funções do Engine:** `consolidate(state)`, `planArtifacts(state)`, `buildArtifactList(state)`, `buildUserHistory(consolidated)`, `isFullstack(consolidated)`

### Procedimento

1. Chame `consolidate(state)` para obter todos os requisitos consolidados dos Estágios 2, 3 e 4.
2. Chame `planArtifacts(state)` para determinar quais artefatos gerar:
   - `prd: true` — sempre.
   - `userhistory: true` — sempre.
   - `comunication: isFullstack(consolidated)` — somente se a demanda resultar em `Projeto_Fullstack`.
3. Chame `buildArtifactList(state)` para obter a lista de artefatos com `filename` e `path`.

### Geração do prd.md

- Consolide o `PRD_Base` (Estágio 1) com os requisitos respondidos nos Estágios 2, 3 e 4.
- Aplique o `Strict_PRD_Schema` da `Skill_PRD_Base` (`skills/prd/SKILL.md`) como estrutura obrigatória.
- Use `skills/pensador/assets/prd-template.md` como template de saída.
- Seções sem informação disponível recebem `"TBD"`.
- Grave o arquivo em `prd.md`.

### Geração do userhistory.md

- Chame `buildUserHistory(consolidated)` para obter os `JourneyStep[]` — passos sequenciais numerados a partir de 1.
- Use `skills/pensador/assets/userhistory-template.md` como template de saída.
- Documente o fluxo principal derivado dos casos de uso do `prd.md`.
- Grave o arquivo em `userhistory.md`.

### Geração do comunication_json.md (somente Projeto_Fullstack)

- **Condição:** `planArtifacts(state).comunication === true` (ou seja, `isFullstack(consolidated) === true`).
- Use `skills/pensador/assets/comunication_json-template.md` como template de saída.
- Documente os contratos de comunicação JSON entre front-end e back-end: endpoints REST (ou equivalente), schemas de request/response e códigos de erro.
- Mantenha consistência de nomenclatura com o `prd.md` (IDs RF-XX, terminologia do glossário).
- Grave o arquivo em `comunication_json.md`.
- Se `isFullstack` for falso, **não** gere este arquivo. Registre no `prd.md` que o `comunication_json.md` não se aplica.

### Reporte ao usuário

Após gerar todos os artefatos aplicáveis, informe ao usuário o caminho de cada um:

- `prd.md` — sempre gerado.
- `userhistory.md` — sempre gerado.
- `comunication_json.md` — gerado apenas quando `Projeto_Fullstack`.

Use o `path` retornado por `buildArtifactList(state)` para cada artefato. **Não use `AskUserQuestion` nesta etapa** — apenas informe os caminhos.

### Gate de saída para DONE

Todos os artefatos aplicáveis foram gerados e seus caminhos foram reportados ao usuário. Chame `advance(state)` para transitar ao estado terminal `DONE`.

---

## DONE — Estado terminal

O fluxo está encerrado. Todos os artefatos foram entregues ao usuário. Não há perguntas nem ações pendentes.

O Pensador pode apresentar um resumo final com os caminhos dos artefatos gerados e uma breve confirmação de conclusão.

---

## Resumo dos gates

| Estágio | Gate de Avanço |
|---|---|
| `INIT` | Demanda presente e não vazia |
| `STAGE_1` | PRD_Base concluído — todas as 10 seções preenchidas ou `"TBD"` |
| `STAGE_2` | Todas as perguntas do estágio respondidas |
| `STAGE_3` | Todas as perguntas respondidas (incluindo fallback do Codex, se aplicável) |
| `STAGE_4` | Todas as perguntas respondidas (incluindo fallback do AGY, se aplicável) |
| `FINAL` | Todos os artefatos aplicáveis gerados e caminhos reportados |
| `DONE` | — (estado terminal) |

---

## Resumo das funções do Engine por estágio

| Estágio | Funções do Engine utilizadas |
|---|---|
| INIT | `initState(demanda)` |
| STAGE_1 | `buildPrdBase(demanda, requiredSections)`, `advance(state)` |
| STAGE_2 | `addQuestions`, `recordAnswer`, `canAdvance`, `advance` |
| STAGE_3 | `mapEffort('extrahigh')`, `addQuestions`, `recordAnswer`, `canAdvance`, `advance` |
| STAGE_4 | `agyModelForStage4()`, `addQuestions`, `recordAnswer`, `canAdvance`, `advance` |
| FINAL | `consolidate`, `planArtifacts`, `buildArtifactList`, `buildUserHistory`, `isFullstack` |
| DONE | — |

---

## Rastreabilidade de requisitos

Esta skill implementa diretamente os seguintes requisitos:

| Requisito | Descrição resumida | Cobertura nesta skill |
|---|---|---|
| 1.3 | Ordem fixa dos estágios | Máquina de estados e gates de avanço |
| 2.4 | Avanço somente após respostas registradas | Gate de STAGE_2 |
| 3.1 | Identificar e apresentar requisitos candidatos | Procedimento do STAGE_2 |
| 5.5 | Avanço do STAGE_4 somente após todas as respostas | Gate de STAGE_4 |
| 6.1 | Usar `AskUserQuestion` para toda pergunta | Regra invariante documentada |
| 6.2 | Encaminhar perguntas do Codex e AGY via `AskUserQuestion` | STAGE_3 e STAGE_4 |
| 6.3 | `AskUserQuestion` como único canal | Regra invariante documentada |
| 7.1 | Instruir Codex e AGY a identificar lacunas | Prompts mínimos do STAGE_3 e STAGE_4 |
| 8.1 | Gerar `prd.md` consolidando todo o debate | Procedimento do FINAL |
| 8.3 | `prd.md` com requisitos refinados dos estágios 2–4 | `consolidate` + `Strict_PRD_Schema` |
| 11.3 | Gerar artefatos somente após STAGE_4 | Gate de entrada do FINAL |
| 12.1 | Entregar `prd.md` e `userhistory.md` | Procedimento do FINAL |
| 12.3 | Informar caminhos de cada artefato | Reporte ao usuário no FINAL |
| 13.1 | Disponibilizar o Pensador como skill | Este arquivo |
