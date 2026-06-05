# Changelog

## [2.0.0] — 2026-06-05

### Breaking Changes

- **`STAGE_ORDER`** — alterado de 11 para 10 estágios. Os estágios autônomos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` foram removidos; substituídos por `ARCH`, `COMPLEXITY` e `BRAINSTORM_GERAL`.
  - v1: `INIT → PRD_BASE → EXPAND → CLARITY → BACKEND → UIUX → FRONTEND → CODEX → AGY → FINAL → DONE`
  - v2: `INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE`

- **`CHECKPOINT_VERSION`** — elevado de `1` para `2`. Checkpoints v1 (gravados em `pensador-output/.pensador-progress.json`) são incompatíveis com v2. O Pensador detecta a incompatibilidade no INIT e oferece iniciar um novo fluxo v2.

- **Pasta de artefatos** — alterada de `pensador-output/` (raiz) para `.pensador/feature-nN/pensador-output/`. Artefatos v1 na raiz **não são movidos automaticamente**.

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
- Cada execução cria (ou retoma) `.pensador/feature-nN/` com `shared-agents/` e `pensador-output/`.
- Numeração auto-incremental com sufixo opcional (`feature-n3-pagamento`).
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
- `buildArtifactList()` usa `state.featurePath` como basePath (fallback: `.pensador/feature-n1/pensador-output/`)
- `deserializeState()` retorna `null` para checkpoints com `version !== 2`

### Testes

- Suíte expandida de 102 para 131 testes (100% verde).
- Novos arquivos:
  - `test/engine-complexity.test.js` — unitários + property-based (fast-check) para `detectComplexity`
  - `test/feature-isolation.test.js` — `allocateFeatureDir` e `buildFeaturePath`
- Atualizados: `test/smoke.test.js`, `test/consolidate.test.js`, `test/artifacts.test.js`, `test/docs-consistency.test.js`

### Guia de Migração

1. **Checkpoints v1** (`pensador-output/.pensador-progress.json`): não são convertidos automaticamente. O Pensador v2 detecta e oferece iniciar novo fluxo.
2. **Artefatos v1** em `pensador-output/`: permanecem intactos; o v2 nunca grava nessa pasta.
3. **`.gitignore`**: adicionar `.pensador/` se ainda não estiver presente (junto com `pensador-output/`).
4. **Scripts customizados** que importavam `STAGE_ORDER` ou `REQUIREMENT_STAGES` precisam ser atualizados para os novos valores.

---

## [1.0.0] — 2025 (baseline)

- Fluxo de 8 estágios: PRD_BASE, EXPAND, CLARITY, BACKEND, UIUX, FRONTEND, CODEX, AGY, FINAL.
- Artefatos em `pensador-output/` (raiz).
- `CHECKPOINT_VERSION = 1`.
