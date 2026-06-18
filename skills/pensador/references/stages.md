# Estagios do Pensador v2

Este documento detalha os estagios do protocolo v2, seus gates e as regras de delegacao. Os antigos estagios autonomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos da maquina de estados. Suas responsabilidades agora vivem dentro de `BRAINSTORM_GERAL`.

---

## Visao geral

```text
INIT → EXPLORE → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

A sequencia e fixa e nunca reordenada. O avanco e controlado por gate: o Pensador so avanca quando todas as perguntas do estagio atual tem resposta, diferimento explicito ou fallback registrado.

Funil v2: **iniciar/retomar** -> **explorar (Code Base Memory)** -> **PRD/Spec base** -> **arquitetura** -> **expandir** -> **calibrar complexidade** -> **brainstorm geral por dominio** -> **varredura tecnica** -> **varredura de produto** -> **consolidar** -> **entregar**.

> **Modo de execucao.** O trabalho pesado de cada estagio (redigir PRD base, expandir, sintetizar analises, gerar artefatos) e executado pelo motor escolhido em `--modo`. Em `--modo claude` (padrao) o Claude Code redige inline; em `--modo agy|kiro|codex` o Pensador delega cada unidade de trabalho via slash command e so orquestra. Em qualquer modo, os gates e o canal `AskUserQuestion` permanecem identicos. Veja `references/execution-modes.md`.

---

## INIT

**Proposito:** obter demanda, resolver modo de execucao, resolver retomada e definir isolamento por atualizacao.

- `parseExecutionMode($ARGUMENTS)` separa `--modo` (claude/agy/kiro/codex), `--model`/`--effort` e a `demanda`. Modo desconhecido cai para `claude` com aviso via `AskUserQuestion`. Veja `references/execution-modes.md`.
- Checkpoints v2 ficam em `.pensador/<slug-da-demanda>-vN/.pensador-progress.json`.
- Checkpoint valido: perguntar via `AskUserQuestion` se o usuario quer retomar ou criar nova atualizacao.
- Checkpoint v1 em `pensador-output/.pensador-progress.json`: incompativel. Perguntar se deve iniciar fluxo v2 novo.
- Novo fluxo: executar `allocateFeatureDir()` e gravar `featurePath`.
- Demanda ausente: solicitar via `AskUserQuestion`.
- **OpenSpec (opcional):** se o preflight reportar `integrations.openspec.available = true`, perguntar via `AskUserQuestion` se o usuario quer gerar **PRD** (padrao) ou **Spec** estruturada; registrar `artifactMode` com `withArtifactMode()`. Veja `references/openspec.md`.

**Gate:** demanda presente, modo de execucao resolvido (motor disponivel ou fallback para `claude` registrado), `artifactMode` definido (`prd` padrao; `spec` quando OpenSpec escolhido), `featurePath` definido e decisao de retomada/novo fluxo registrada.

---

## EXPLORE

**Proposito:** explorar o projeto existente com o **Code Base Memory** (obrigatorio) antes de gerar o PRD/Spec, para entender a estrutura sobre a qual a feature/fix vai atuar.

- Disponivel (`integrations.codebaseMemory.available = true`): rodar o MCP `codebase-memory-mcp` na ordem `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (mais `detect_changes` em fixes).
- Gravar `<featurePath>/codebase-memory.md` com panorama de arquitetura, simbolos/arquivos afetados, cadeias de chamada relevantes, raio de impacto (fixes) e lacunas.
- Indisponivel (`integrations.codebaseMemory.available = false`): perguntar via `AskUserQuestion` se o usuario deseja **instalar o servidor agora**:
  - **Opcao A — Instalar (recomendada):** Claude executa o instalador da plataforma (`install.sh` no Linux/macOS; `install.ps1` no Windows via PowerShell) com `Bash`, aguarda conclusao, orienta o usuario a reconectar o MCP e retoma o EXPLORE com o servidor disponivel.
  - **Opcao B — Seguir sem:** usar `Read`/`Glob`/`Grep` e registrar a decisao no `codebase-memory.md`.
- Greenfield: registrar que nao ha codigo a indexar e avancar.

Estagio sem perguntas de produto: e visitado, produz o snapshot (ou registra fallback) e avanca. Veja `references/codebase-memory.md`.

**Gate:** `<featurePath>/codebase-memory.md` gravado (exploracao concluida ou fallback registrado).

---

## PRD_BASE

**Proposito:** criar o artefato base — `PRD_Base` no modo PRD ou o change set OpenSpec (via comandos `openspec-*`) no modo Spec. A escolha vem de `artifactMode`, definido no INIT.

### Modo PRD (`artifactMode = 'prd'`, padrao)

- Aplicar `Strict_PRD_Schema`.
- Inferir secoes a partir da demanda e do `<featurePath>/codebase-memory.md`.
- Usar exatamente `"TBD"` quando a informacao nao for inferivel.

### Modo Spec (`artifactMode = 'spec'`, OpenSpec)

- Acionar os comandos `openspec-*` (nunca escrever os arquivos manualmente): `/openspec-new-change <nome>` + `/openspec-ff-change <nome>` criam `proposal.md`, `design.md`, `tasks.md` e `specs/` em `openspec/changes/<nome>/` (`<nome>` = `openspecChangeName(featurePath)`).
- Alimentar com a demanda e o `codebase-memory.md`; usar `"TBD"` no que nao for inferivel.
- Se os comandos `openspec-*` nao estiverem disponiveis: perguntar via `AskUserQuestion` se deve cair para PRD ou abortar; nao montar a estrutura manualmente.
- Todas as etapas seguintes raciocinam sobre a spec. O prefixo legado `/opsx:*` esta descontinuado. Veja `references/openspec.md`.

**Gate:** modo PRD — PRD Base completo (secoes preenchidas ou `"TBD"`); modo Spec — change set OpenSpec criado pelos comandos `openspec-*` (ou fallback registrado). Sem perguntas alem do fallback.

---

## ARCH

**Proposito:** entender arquitetura, stack e contexto tecnico antes de fazer perguntas de produto.

### Projeto existente

Reaproveite o indice do Code Base Memory criado no EXPLORE (`get_architecture`, `search_graph`, `trace_path`, `detect_changes` em fixes) e complemente com `Read`, `Glob` e `Grep` para identificar:

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

**Participacao do Codex:** quando a atividade e especifica de front-end (`hasFrontend = true` e `hasBackend = false`, ou seja `codexParticipates = false`), o Codex nao participa. O estagio e visitado, mas nao delega: registra zero perguntas, sem fallback, e avanca automaticamente. Com `hasBackend = true` (back-end ou fullstack) o Codex roda normalmente.

**Fallback:** quando o Codex participa, pergunta individual via `AskUserQuestion` para retentar, seguir sem Codex ou registrar lacunas como `"TBD"`.

**Gate:** atividade especifica de front-end avanca com zero perguntas; caso contrario, todas as perguntas/fallbacks de CODEX respondidos ou diferidos.

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
2. Confirmar back-end via `AskUserQuestion`, apresentando a heuristica como sugestao (so no modo PRD; no modo Spec nao se aplica).
3. Gerar artefatos conforme `artifactMode`:
   - Modo PRD: `prd.md` + `userhistory.md` (+ `comunication_json.md` quando ha back-end) em `<featurePath>/`.
   - Modo Spec: finalizar o change set em `openspec/changes/<nome>/` e rodar `/openspec-verify-change <nome>` (e `/openspec-sync-specs <nome>` se introduziu/ajustou specs).
4. Confirmar sobrescrita via `AskUserQuestion` quando arquivo ja existir.
5. Apresentar recap final e handoff. No modo Spec, orientar com `/openspec-apply-change`, `/openspec-sync-specs` e `/openspec-archive-change` (este move pastas: so apos confirmacao do usuario).

| Artefato | Condicao |
|---|---|
| `prd.md` | Modo PRD |
| `userhistory.md` | Modo PRD |
| `comunication_json.md` | Modo PRD, quando ha back-end confirmado |
| `openspec/changes/<nome>/` (`proposal.md` · `design.md` · `tasks.md` · `specs/`) | Modo Spec (via comandos `openspec-*`) |

**Gate:** artefatos aplicaveis gerados, `handoff.json` gravado, caminhos reportados, recap final e handoff entregues.

---

## DONE

Estado terminal. Sem perguntas ou acoes pendentes.

---

## Resumo dos gates

| Estagio | Gate |
|---|---|
| `INIT` | Demanda presente, `artifactMode` definido, `featurePath` definido e retomada/novo fluxo resolvido |
| `EXPLORE` | `codebase-memory.md` gravado (exploracao do Code Base Memory ou fallback registrado) |
| `PRD_BASE` | Modo PRD: PRD Base completo; modo Spec: change set OpenSpec criado pelos comandos `openspec-*` (ou fallback) |
| `ARCH` | `architecture.md` gravado |
| `EXPAND` | Perguntas respondidas ou diferidas |
| `COMPLEXITY` | Modo Lite/Completo escolhido |
| `BRAINSTORM_GERAL` | `agent.response.md` ou fallback por dominio; perguntas fechadas |
| `CODEX` | Front-end especifico: zero perguntas e avanco; caso contrario, perguntas/fallbacks fechados |
| `AGY` | Perguntas/fallbacks fechados |
| `FINAL` | Artefatos, recap e handoff entregues |
| `DONE` | Terminal |
