# Changelog

## [2.5.0] — 2026-06-11

### Novas Funcionalidades

#### Modos de execução (`--modo`)
- Novo eixo de execução **ortogonal** às lentes de domínio: define qual motor realiza o trabalho pesado do fluxo (PRD base, expansão, síntese de análises, geração de artefatos).
  - `--modo claude` (padrão): o Claude Code executa o fluxo com os próprios tokens.
  - `--modo agy`: delega via `/cc-antigravity-plugin:antigravity` (padrão `--model claude-4.6-opus-thinking`).
  - `--modo kiro`: delega via `/cc-kiro-plugin:kiro` (padrão `--model claude-opus-4.8 --effort high`).
  - `--modo codex`: delega via `/codex:rescue` (padrão `--effort high`).
- **Invariante preservada:** em qualquer modo, todo diálogo com o usuário continua passando exclusivamente por `AskUserQuestion`. O motor externo nunca conversa com o usuário; só produz rascunhos/análises que o Pensador relê e consolida.
- Objetivo: baratear a geração de artefatos transferindo o custo para a quota da CLI externa, mantendo o Claude apenas como orquestrador.
- Sobrescritas `--model` (agy/kiro) e `--effort` (codex; `xhigh`/`extrahigh` → `high`); `--modo` desconhecido cai para `claude` com aviso.

#### Engine (`pensador-engine.mjs`)
- Novos exports puros e testados:
  - `EXECUTION_MODES` / `DEFAULT_EXECUTION_MODE` — registro dos modos.
  - `parseExecutionMode(rawArgs)` — extrai `--modo`/`--model`/`--effort` e devolve a `demanda`.
  - `resolveExecutionMode(mode, overrides)` — resolve o motor + parâmetro efetivo.
  - `buildDelegationInvocation(mode, payload)` — constrói o slash command de delegação com prompt JSON-quoted.

#### Preflight (`preflight.mjs`)
- Aceita `--modo <modo>` e adiciona o bloco `executionMode` ao relatório (disponibilidade do motor + fallback).
- Passa a checar o plugin do Kiro (`cc-kiro-plugin`) além de Codex e AGY. Continua saindo sempre com código 0.

#### Plugin
- `cc-kiro-plugin` adicionado como dependência cross-marketplace (junto a `cc-antigravity-plugin` e `openai-codex`).
- Versão do plugin elevada para `2.5.0`.

### Documentação
- Nova referência `skills/pensador/references/execution-modes.md`.
- `SKILL.md`, `stages.md`, `agent-stack.md`, `commands/pensador.md` e `README.md` atualizados para os modos de execução (parsing no INIT, delegação por estágio via `SlashCommand`).

### Testes
- Novo `test/execution-modes.test.js` (parse/resolve/buildDelegationInvocation). Suíte total: 161 testes verdes.

## [Unreleased]

- **Pasta de artefatos versionada por demanda** - os artefatos agora ficam em `.pensador/<slug-da-demanda>-vN/`, diretamente nessa pasta. Ex.: `/pensador desenvolva uma pagina de clientes` -> `.pensador/pagina-clientes-v1/`.

## [2.0.0] — 2026-06-05

### Breaking Changes

- **`STAGE_ORDER`** — alterado de 11 para 10 estágios. Os estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos; substituídos por `ARCH`, `COMPLEXITY` e `BRAINSTORM_GERAL`.
  - v1: `INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE`
  - v2: `INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE`

- **`CHECKPOINT_VERSION`** — elevado de `1` para `2`. Checkpoints v1 (gravados em `pensador-output/.pensador-progress.json`) são incompatíveis com v2. O Pensador detecta a incompatibilidade no INIT e oferece iniciar um novo fluxo v2.

- **Pasta de artefatos** — no v2, os artefatos ficam em `.pensador/<slug-da-demanda>-vN/`. Saídas legadas da v1 não são movidas automaticamente.

- **`REQUIREMENT_STAGES`** — alterado de `['EXPAND','CLARITY','BACKEND','UIUX','FRONTEND','CODEX','AGY']` para `['EXPAND','BRAINSTORM_GERAL','CODEX','AGY']`.

### Novas Funcionalidades

#### Estágio ARCH (análise de arquitetura)
- Varre o projeto via `Read`/`Glob`/`Grep` antes de expandir requisitos.
- Detecta linguagem, estrutura, padrões arquiteturais, design system, entrypoints e integrações.
- Modo greenfield: entrevista de preferências quando não há base de código relevante.
- Suporte a monorepos: lista sub-projetos e confirma escopo.
- Grava `<featurePath>/architecture.md` com retrato da arquitetura, sinais de complexidade e lacunas técnicas.

#### Estágio COMPLEXITY (heurística de complexidade)
- Calcula score (0–4) com `detectComplexity(signals)` usando quatro sinais binários:
  - `domainCount > 1`, `hasBackend`, `hasBroadScopeKeywords`, `isGreenfield`
- Score 0–1 → sugere **Lite** (fluxo enxuto); score ≥ 2 → sugere **Completo** (fluxo integral).
- Desempate sempre resolve para Completo.
- Usuário sempre confirma ou altera o modo via `AskUserQuestion`.

#### Estágio BRAINSTORM_GERAL (brainstorm paralelo por domínio)
- Substitui os quatro estágios autônomos de brainstorm.
- Roteamento por domínio:
  - `requirements-clarity` — sempre (clareza de requisitos)
  - `codex:codex-rescue` `--effort high` — quando `hasBackend = true`
  - `cc-antigravity-plugin:antigravity-agent` `gemini-3.1-pro-high` — quando `hasFrontend = true`
- Contrato de arquivos em `shared-agents/`:
  - `context-pack.md` — gravado pelo orquestrador antes do dispatch
  - `<agent>.response.md` — resposta de cada participante
- Fallback por domínio: domínio falho não aborta os demais; pergunta de fallback via `AskUserQuestion`.

#### Isolamento por feature
- Cada execução cria (ou retoma) `.pensador/<slug-da-demanda>-vN/` com `shared-agents/` e artefatos finais diretamente na pasta.
- Versionamento local por demanda: primeira execução usa `-v1`; novas execuções com o mesmo slug usam `-v2`, `-v3`, ...
- `allocateFeatureDir(existingFeatureDirs, options)` — função pura no engine.
- `buildFeaturePath(featureDir, subdir)` — constrói caminhos derivados do `featurePath`.
- Retomada: no INIT, checkpoint v2 incompleto detectado → `AskUserQuestion` (retomar ou novo fluxo).

#### Melhorias de UX (AskUserQuestion)
- Opção recomendada sempre em primeiro lugar com sufixo "(Recomendado)".
- Previews para opções com artefatos concretos.
- Recap final antes do FINAL: resumo de todas as decisões do fluxo.
- Handoff por complexidade ao encerrar.
- PT-BR como idioma padrão dos artefatos.

### Mudanças no Engine (`pensador-engine.mjs`)

Novos exports públicos:
- `detectComplexity(signals)` — heurística determinística de complexidade
- `allocateFeatureDir(existingFeatureDirs, options)` — alocação de diretório por feature
- `buildFeaturePath(featureDir, subdir)` — construção de caminhos derivados

Outros:
- `initState()` agora inclui campo `featurePath: null`
- `buildArtifactList()` usa `state.featurePath` como basePath (fallback: `.pensador/atualizacao-v1/`)
- `deserializeState()` retorna `null` para checkpoints com `version !== 2`

### Testes

- Suíte expandida de 102 para 131 testes (100% verde).
- Novos arquivos:
  - `test/engine-complexity.test.js` — unitários + property-based (fast-check) para `detectComplexity`
  - `test/feature-isolation.test.js` — `allocateFeatureDir` e `buildFeaturePath`
- Atualizados: `test/smoke.test.js`, `test/consolidate.test.js`, `test/artifacts.test.js`, `test/docs-consistency.test.js`

### Guia de Migração

1. **Checkpoints v1** (`pensador-output/.pensador-progress.json`): não são convertidos automaticamente. O Pensador v2 detecta e oferece iniciar novo fluxo.
2. **Saídas legadas v1**: permanecem intactas; o v2 nunca grava artefatos fora de `.pensador/<slug-da-demanda>-vN/`.
3. **`.gitignore`**: adicionar `.pensador/` se ainda não estiver presente.
4. **Scripts customizados** que importavam `STAGE_ORDER` ou `REQUIREMENT_STAGES` precisam ser atualizados para os novos valores.

---

## [1.0.0] — 2025 (baseline)

- Fluxo de 8 estágios: PRD_BASE, EXPAND, CLARITY, BACKEND, UIUX, FRONTEND, CODEX, AGY, FINAL.
- Artefatos em pasta raiz legada.
- `CHECKPOINT_VERSION = 1`.
