# Estagios do Pensador v2

Este documento detalha os estagios do protocolo v2, seus gates e as regras de delegacao. Os antigos estagios autonomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos da maquina de estados. Suas responsabilidades agora vivem dentro de `BRAINSTORM_GERAL`.

---

## Visao geral

```text
INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

A sequencia e fixa e nunca reordenada. O avanco e controlado por gate: o Pensador so avanca quando todas as perguntas do estagio atual tem resposta, diferimento explicito ou fallback registrado.

Funil v2: **iniciar/retomar** -> **PRD base** -> **arquitetura** -> **expandir** -> **calibrar complexidade** -> **brainstorm geral por dominio** -> **varredura tecnica** -> **varredura de produto** -> **consolidar** -> **entregar**.

---

## INIT

**Proposito:** obter demanda, resolver retomada e definir isolamento por feature.

- Checkpoints v2 ficam em `.pensador/feature-nN/.pensador-progress.json`.
- Checkpoint valido: perguntar via `AskUserQuestion` se o usuario quer retomar ou criar nova feature.
- Checkpoint v1 em `pensador-output/.pensador-progress.json`: incompativel. Perguntar se deve iniciar fluxo v2 novo.
- Novo fluxo: executar `allocateFeatureDir()` e gravar `featurePath`.
- Demanda ausente: solicitar via `AskUserQuestion`.

**Gate:** demanda presente, `featurePath` definido e decisao de retomada/novo fluxo registrada.

---

## PRD_BASE

**Proposito:** criar rascunho estruturado do PRD pela `Skill_PRD_Base`.

- Aplicar `Strict_PRD_Schema`.
- Inferir secoes a partir da demanda.
- Usar exatamente `"TBD"` quando a informacao nao for inferivel.

**Gate:** PRD Base completo com todas as secoes preenchidas ou `"TBD"`. Sem perguntas.

---

## ARCH

**Proposito:** entender arquitetura, stack e contexto tecnico antes de fazer perguntas de produto.

### Projeto existente

Use `Read`, `Glob` e `Grep` para identificar:

- Stack, framework, linguagem e gerenciador de pacotes.
- Estrutura de pastas, entrypoints e padroes locais.
- Front-end, back-end, persistencia, jobs, integracoes e autenticacao.
- Artefatos relevantes ja existentes.
- Riscos, convencoes e lacunas tecnicas.

### Greenfield

Se nao houver base de codigo relevante:

- Marque `isGreenfield = true`.
- Entreviste o usuario via `AskUserQuestion` sobre stack, front-end, back-end, persistencia, integracoes, deploy e restricoes.
- Use respostas diferidas como `"TBD"` no `architecture.md`.

### Saida

Grave `<featurePath>/architecture.md` com:

- Resumo da arquitetura.
- Sinais `hasBackend`, `hasFrontend`, `isGreenfield`.
- Dominios detectados.
- Decisoes conhecidas e lacunas.
- Entradas para `detectComplexity()`.

**Gate:** `architecture.md` gravado e perguntas greenfield fechadas.

---

## EXPAND

**Proposito:** ampliar a demanda com requisitos candidatos do proprio Pensador.

1. Revisar demanda, PRD Base e `architecture.md`.
2. Identificar requisitos implicitos, fluxos alternativos, RNFs, integracoes, seguranca, erros, acessibilidade e persistencia.
3. Converter lacunas importantes em perguntas `origin = 'pensador'`, `stage = 'EXPAND'`.
4. Apresentar via `AskUserQuestion`, com opcao recomendada quando aplicavel.

**Gate:** todas as perguntas respondidas ou diferidas.

---

## COMPLEXITY

**Proposito:** decidir a profundidade de execucao antes do brainstorm geral.

`detectComplexity()` usa:

| Sinal | Como interpretar |
|---|---|
| `domainCount` | Quantidade de dominios funcionais/tecnicos distintos |
| `hasBackend` | API, servidor, dados, auth, jobs, integracoes ou contratos |
| `hasBroadScopeKeywords` | Plataforma, sistema, multiusuario, dashboard amplo, automacao, pagamentos, compliance ou escopo amplo |
| `isGreenfield` | Projeto novo sem arquitetura existente |

Resultado:

- **Lite:** poucas areas, baixo risco, pouco ou nenhum back-end.
- **Completo:** back-end, escopo amplo, multiplos dominios, integracoes, greenfield relevante ou alto risco.

Pergunte ao usuario via `AskUserQuestion` se aceita a sugestao. Inclua:

- Opcao recomendada.
- Preview do que muda no fluxo.
- Profundidade por dominio.
- Possibilidade de seguir com a alternativa.

**Gate:** modo `Lite` ou `Completo` registrado.

---

## BRAINSTORM_GERAL

**Proposito:** executar um brainstorm unico, orientado por dominios, substituindo CLARITY/BACKEND/UIUX/FRONTEND.

### Contexto compartilhado

Grave antes da delegacao:

```text
<featurePath>/shared-agents/context-pack.md
```

O arquivo deve conter demanda, PRD Base, `architecture.md`, respostas de EXPAND, modo Lite/Completo, sinais de complexidade, dominios detectados e instrucoes de saida.

### Roteamento

| Participante | Quando roda | Papel |
|---|---|---|
| `requirements-clarity` | sempre | Clareza, ambiguidades, aceite, escopo |
| Codex `effort high` | `hasBackend` | Dados, APIs, seguranca, contratos, riscos tecnicos |
| AGY `gemini-3.1-pro-high` | `hasFrontend` | Experiencia, produto, jornadas, telas, cenarios |

Em modo Lite, limite a quantidade de perguntas por dominio e favoreca `"TBD"` para lacunas menores. Em modo Completo, aprofunde dominios de maior risco.

### Saidas

Cada participante grava sua resposta em `shared-agents/*.response.md`. O Pensador consolida em:

```text
<featurePath>/shared-agents/agent.response.md
```

`agent.response.md` deve registrar autoria, dominio, severidade, pergunta candidata, evidencias e se houve deduplicacao.

### Fallback por dominio

Se um participante falhar:

1. Registre evidencia da falha.
2. Pergunte via `AskUserQuestion` se deve retentar, seguir sem aquele dominio ou registrar lacunas como `"TBD"`.
3. Nao bloqueie dominios independentes que ja responderam.

### Perguntas ao usuario

- Deduplicate contra PRD Base, EXPAND e respostas anteriores.
- Agrupe por dominio quando fizer sentido.
- Preserve selo de autoria: `Pensador`, `requirements-clarity`, `Codex` ou `AGY`.
- Use PT-BR por padrao.

**Gate:** `agent.response.md` produzido ou fallback registrado; todas as perguntas respondidas ou diferidas.

---

## CODEX

**Proposito:** varredura tecnica final, apos o brainstorm geral.

- Subagente: `codex:codex-rescue`.
- Parametro efetivo: `effort high` no prompt.
- Entrada: demanda, PRD Base, `architecture.md`, EXPAND, `agent.response.md` e respostas consolidadas.
- Saida: pontos tecnicos em aberto, convertidos em perguntas `origin = 'codex'`.

**Fallback:** pergunta individual via `AskUserQuestion` para retentar, seguir sem Codex ou registrar lacunas como `"TBD"`.

**Gate:** todas as perguntas/fallbacks de CODEX respondidos ou diferidos.

---

## AGY

**Proposito:** varredura final de produto.

- Subagente: `cc-antigravity-plugin:antigravity-agent`.
- Modelo: `gemini-3.1-pro-high` no prompt.
- Entrada: demanda, PRD Base, `architecture.md`, EXPAND, `agent.response.md`, CODEX e consolidado parcial.
- Saida: lacunas de produto, riscos e cenarios nao cobertos, convertidos em perguntas `origin = 'agy'`.

**Fallback:** preservar status como `QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` ou `TIMEOUT` quando disponivel; perguntar via `AskUserQuestion`.

**Gate:** todas as perguntas/fallbacks de AGY respondidos ou diferidos.

---

## FINAL

**Proposito:** consolidar respostas e gerar artefatos finais.

1. Aplicar `withConsolidated(state)`.
2. Confirmar back-end via `AskUserQuestion`, apresentando a heuristica como sugestao.
3. Gerar artefatos em `<featurePath>/pensador-output/`.
4. Confirmar sobrescrita via `AskUserQuestion` quando arquivo ja existir.
5. Apresentar recap final e handoff.

| Artefato | Condicao |
|---|---|
| `prd.md` | Sempre |
| `userhistory.md` | Sempre |
| `comunication_json.md` | Quando ha back-end confirmado |

**Gate:** artefatos aplicaveis gerados, caminhos reportados, recap final e handoff entregues.

---

## DONE

Estado terminal. Sem perguntas ou acoes pendentes.

---

## Resumo dos gates

| Estagio | Gate |
|---|---|
| `INIT` | Demanda presente, `featurePath` definido e retomada/novo fluxo resolvido |
| `PRD_BASE` | PRD Base completo |
| `ARCH` | `architecture.md` gravado |
| `EXPAND` | Perguntas respondidas ou diferidas |
| `COMPLEXITY` | Modo Lite/Completo escolhido |
| `BRAINSTORM_GERAL` | `agent.response.md` ou fallback por dominio; perguntas fechadas |
| `CODEX` | Perguntas/fallbacks fechados |
| `AGY` | Perguntas/fallbacks fechados |
| `FINAL` | Artefatos, recap e handoff entregues |
| `DONE` | Terminal |
