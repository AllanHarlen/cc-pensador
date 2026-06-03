# Estágios do Pensador — Referência

Este documento detalha cada estágio do fluxo do Pensador, seus gates de avanço e as regras de delegação e fallback para Codex e AGY.

---

## Visão Geral da Máquina de Estados

```
INIT → STAGE_1 → STAGE_2 → STAGE_3 → STAGE_4 → FINAL → DONE
```

A sequência é **fixa e nunca reordenada**. O avanço entre estágios é controlado por um **gate**: o Pensador só avança quando **todas** as perguntas do estágio atual têm resposta registrada. Nenhum estágio é pulado.

A lógica determinística de gate e transição é implementada no Pensador Engine (`scripts/pensador-engine.mjs`):

- `canAdvance(state)` — retorna `true` se e somente se não há perguntas pendentes no estágio atual.
- `advance(state)` — avança um passo em `STAGE_ORDER` se `canAdvance` for `true`; caso contrário, retorna o mesmo estado (no-op).

---

## INIT

**Propósito:** receber a demanda do usuário antes de iniciar o fluxo.

**Comportamento:**
- Se a demanda for fornecida no acionamento do comando (`$ARGUMENTS` não vazio), `initState` define `needsDemanda = false` e o fluxo avança imediatamente para `STAGE_1`.
- Se a demanda estiver ausente ou for composta apenas de espaços, `initState` define `needsDemanda = true` e o Pensador **solicita a demanda ao usuário via `AskUserQuestion`** antes de sair do `INIT`.

**Gate de avanço:** demanda presente e não vazia.

---

## STAGE_1 — Geração do PRD Base

**Propósito:** produzir um rascunho estruturado do PRD a partir da demanda, aplicando o `Strict_PRD_Schema` definido na `Skill_PRD_Base` (`skills/prd/SKILL.md`).

**Comportamento:**
- O Pensador aplica a Entrevista de Descoberta da `Skill_PRD_Base` para inferir o conteúdo de cada seção a partir da demanda.
- Toda seção obrigatória do `Strict_PRD_Schema` que **não puder ser preenchida** com as informações presentes na demanda recebe o valor `"TBD"` — nunca é omitida ou inventada.
- O `PRD_Base` é armazenado no estado (`state.prdBase`) e serve de base para os estágios seguintes.

**Gate de avanço:** `PRD_Base` concluído (todas as 10 seções preenchidas ou marcadas `"TBD"`). Não há perguntas ao usuário neste estágio — o avanço é automático.

---

## STAGE_2 — Identificação de Requisitos Candidatos

**Propósito:** ampliar a demanda identificando requisitos adicionais não previstos no enunciado original.

### Como identificar requisitos candidatos

Com base no `PRD_Base` e na demanda, o Pensador deve:

1. Revisar as seções do `PRD_Base` marcadas como `"TBD"` — cada uma representa uma lacuna candidata.
2. Avaliar se há funcionalidades implícitas, fluxos alternativos, integrações ou restrições não funcionais que a demanda sugere mas não descreve.
3. Para cada requisito candidato identificado, formular uma pergunta clara e objetiva ao usuário.

**Exemplos de candidatos comuns:**
- Autenticação e controle de acesso (quando a demanda descreve uma funcionalidade protegida).
- Tratamento de erros e mensagens de validação.
- Requisitos de desempenho ou disponibilidade não mencionados.
- Suporte a dispositivos móveis ou acessibilidade.
- Persistência de dados e estratégia de backup.

### Apresentação ao usuário

Cada requisito candidato é apresentado via `AskUserQuestion`. O Pensador pode agrupar candidatos relacionados em uma única pergunta, desde que a pergunta permaneça clara e a resposta do usuário seja registrável de forma inequívoca.

**Gate de avanço:** todas as perguntas do Estágio 2 têm resposta registrada (`canAdvance` retorna `true`).

---

## STAGE_3 — Refinamento com Codex

**Propósito:** aprofundar os requisitos com análise especializada, identificando lacunas técnicas não previstas nos Estágios 1 e 2.

### Delegação ao Codex

**Subagente:** `codex:codex-rescue`  
**Parâmetro de effort:** `--effort high`

> O usuário solicita effort `extrahigh`, mas o `codex:codex-rescue` reconhece apenas `medium` e `high`. O Engine mapeia `extrahigh → high` via `mapEffort('extrahigh')`, que retorna `'high'`. O Pensador **sempre passa `--effort high`** ao Codex (nunca `--effort extrahigh`).

**Instrução ao Codex:** fornecer os requisitos consolidados após o Estágio 2 e instruir o Codex a identificar **lacunas de funcionalidades não previstas** na demanda e no `PRD_Base`.

**Entrada para o Codex (conteúdo mínimo):**
```
Analise os requisitos abaixo e identifique lacunas técnicas, funcionalidades não previstas,
inconsistências ou riscos. Retorne uma lista de pontos em aberto que precisam ser esclarecidos.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <lista do Estágio 2>
```

### Processamento do retorno do Codex

Cada ponto em aberto retornado pelo Codex é:
1. Convertido em uma pergunta dirigida ao usuário.
2. Registrado como questão com `origin = 'codex'` no estado do Engine (`addQuestions`).
3. Apresentado ao usuário via `AskUserQuestion`.

As respostas do usuário são incorporadas ao conjunto de requisitos consolidados com `source = 'stage_3'` e `resolvesGap = true`.

### Indisponibilidade do Codex (fallback)

Se o Codex estiver indisponível ou retornar erro operacional (ex.: timeout, quota esgotada, bloqueio):

1. **Registrar a indisponibilidade** com a evidência retornada pelo subagente.
2. **Gerar uma pergunta de fallback** via `AskUserQuestion`:

   > "O Codex (codex:codex-rescue) está indisponível no momento. Deseja prosseguir sem o refinamento técnico do Codex, ou prefere aguardar/retentar?"

3. **Se o usuário optar por prosseguir:** avançar para o Estágio 4 sem os pontos do Codex (o gate considera a pergunta de fallback como respondida).
4. **Se o usuário optar por aguardar/retentar:** permanecer no Estágio 3 e retentar a delegação antes de apresentar nova pergunta de fallback.

A pergunta de fallback **é tratada como qualquer outra pergunta do estágio**: o gate não avança enquanto ela não tiver resposta registrada.

**Gate de avanço:** todas as perguntas do Estágio 3 (incluindo eventuais perguntas de fallback) têm resposta registrada.

---

## STAGE_4 — Questionamento com AGY

**Propósito:** fechar lacunas remanescentes com uma perspectiva diferente, usando o AGY com o modelo Gemini 3.1 Pro high.

### Delegação ao AGY

**Subagente:** `cc-antigravity-plugin:antigravity-agent`  
**Parâmetro de modelo:** `--model gemini-3.1-pro-high`

> O identificador `gemini-3.1-pro-high` é obtido via `agyModelForStage4()` no Engine, que verifica a pertinência ao `AGY_MODEL_ALLOWLIST` antes de retornar o valor. Sempre use o retorno dessa função — nunca hardcode o valor diretamente.

**Instrução ao AGY:** fornecer os requisitos consolidados após o Estágio 3 e instruir o AGY a identificar **lacunas remanescentes de funcionalidades não previstas** na demanda e no `PRD_Base`.

**Entrada para o AGY (conteúdo mínimo):**
```
Analise os requisitos abaixo e levante perguntas sobre lacunas remanescentes,
aspectos não cobertos, cenários de uso não considerados ou riscos de produto.
Retorne uma lista de perguntas abertas para o usuário responder.

Demanda: <demanda>
PRD Base: <seções do PRD_Base>
Requisitos consolidados até agora: <lista dos Estágios 2 e 3>
```

### Processamento do retorno do AGY

Cada pergunta retornada pelo AGY é:
1. Registrada com `origin = 'agy'` no estado do Engine (`addQuestions`).
2. Apresentada ao usuário via `AskUserQuestion`.

As respostas do usuário são incorporadas ao conjunto de requisitos consolidados com `source = 'stage_4'` e `resolvesGap = true`.

### Indisponibilidade do AGY (fallback)

Se o AGY estiver indisponível ou retornar erro operacional (status: `QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`):

1. **Registrar a indisponibilidade** com o status retornado pelo bridge AGY.
2. **Gerar uma pergunta de fallback** via `AskUserQuestion`:

   > "O AGY (cc-antigravity-plugin:antigravity-agent) está indisponível no momento. Deseja prosseguir sem as perguntas adicionais do AGY, ou prefere aguardar/retentar?"

3. **Se o usuário optar por prosseguir:** avançar para o Estágio Final sem as perguntas do AGY.
4. **Se o usuário optar por aguardar/retentar:** permanecer no Estágio 4 e retentar a delegação antes de apresentar nova pergunta de fallback.

A pergunta de fallback obedece ao mesmo gate das demais: não há avanço enquanto não tiver resposta.

**Gate de avanço:** todas as perguntas do Estágio 4 (incluindo eventuais perguntas de fallback) têm resposta registrada.

---

## FINAL — Geração dos Artefatos

**Propósito:** consolidar todo o debate dos estágios anteriores e gerar os artefatos finais.

**Gate de entrada:** conclusão do Estágio 4 (`currentStage` deve estar em `{FINAL, DONE}` para que `planArtifacts` retorne um plano não-vazio).

**Artefatos gerados:**

| Artefato | Arquivo | Condição |
|---|---|---|
| PRD Final | `prd.md` | Sempre |
| Jornada do Usuário | `userhistory.md` | Sempre |
| Comunicação Back-End | `comunication_json.md` | Somente se `isFullstack(consolidated) === true` |

**Processo:**
1. Chamar `consolidate(state)` para obter todos os requisitos dos Estágios 2, 3 e 4.
2. Chamar `planArtifacts(state)` para determinar quais artefatos gerar.
3. Gerar `prd.md` consolidando o `PRD_Base` com os requisitos consolidados, seguindo o `Strict_PRD_Schema` da `Skill_PRD_Base`.
4. Gerar `userhistory.md` usando `buildUserHistory(consolidated)` — passos sequenciais numerados a partir de 1.
5. Se `planArtifacts.comunication === true`, gerar `comunication_json.md` descrevendo os contratos de comunicação back-end em JSON.
6. Chamar `buildArtifactList(state)` e informar ao usuário **o caminho de cada artefato gerado**.

**Gate de avanço para DONE:** todos os artefatos aplicáveis foram gerados e seus caminhos foram reportados ao usuário.

---

## DONE

**Propósito:** estado terminal. O fluxo está encerrado e todos os artefatos foram entregues.

Não há perguntas nem ações pendentes neste estágio. O Pensador pode apresentar um resumo final ao usuário com os caminhos dos artefatos gerados.

---

## Resumo dos Gates

| Estágio | Gate de Avanço |
|---|---|
| `INIT` | Demanda presente e não vazia |
| `STAGE_1` | PRD_Base concluído (todas as seções preenchidas ou `"TBD"`) |
| `STAGE_2` | Todas as perguntas do estágio respondidas |
| `STAGE_3` | Todas as perguntas do estágio respondidas (incluindo fallback do Codex, se aplicável) |
| `STAGE_4` | Todas as perguntas do estágio respondidas (incluindo fallback do AGY, se aplicável) |
| `FINAL` | Todos os artefatos gerados e caminhos reportados |
| `DONE` | — (estado terminal) |

---

## Canal Único de Diálogo

**Toda** pergunta apresentada ao usuário — própria do Pensador, originada pelo Codex, originada pelo AGY ou de fallback por indisponibilidade — usa **exclusivamente** a ferramenta `AskUserQuestion`. Nenhum outro mecanismo de diálogo é utilizado.

Consulte `references/askuserquestion-protocol.md` para o protocolo completo e `references/agent-stack.md` para os detalhes do mapeamento de effort e do modelo AGY.
