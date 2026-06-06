---
description: Conduz o Pensador v2 em dez estagios, com arquitetura, expansao, complexidade, brainstorm geral por dominio, Codex, AGY e artefatos isolados por feature.
argument-hint: "<demanda em linguagem natural - ex.: 'Crie uma tela de login para os usuarios'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, Skill
---

# /pensador

Inicia o **Pensador v2** para a demanda em `$ARGUMENTS`. O fluxo cobre dez estagios:

1. **INIT** - Demanda, checkpoint v2 e `allocateFeatureDir()`.
2. **PRD_BASE** - Geracao do PRD Base pela `Skill_PRD_Base`.
3. **ARCH** - Analise do projeto via `Read`/`Glob`/`Grep`; em greenfield, entrevista o usuario; grava `architecture.md`.
4. **EXPAND** - Ampliacao da demanda com requisitos candidatos.
5. **COMPLEXITY** - `detectComplexity()` com `domainCount`, `hasBackend`, `hasBroadScopeKeywords` e `isGreenfield`; sugere Lite ou Completo.
6. **BRAINSTORM_GERAL** - Orquestracao por dominio: `requirements-clarity`, Codex `effort high` se `hasBackend`, AGY `gemini-3.1-pro-high` se `hasFrontend`; usa `shared-agents/context-pack.md` e `agent.response.md`.
7. **CODEX** - Refinamento tecnico final com `codex:codex-rescue`; nao participa em atividade especifica de front-end (`hasFrontend` sem `hasBackend`).
8. **AGY** - Lacunas finais de produto com `cc-antigravity-plugin:antigravity-agent`.
9. **FINAL** - Consolidacao, artefatos, recap final e handoff.
10. **DONE** - Estado terminal.

`STAGE_ORDER` v2:

```text
INIT -> PRD_BASE -> ARCH -> EXPAND -> COMPLEXITY -> BRAINSTORM_GERAL -> CODEX -> AGY -> FINAL -> DONE
```

Os antigos `CLARITY`, `BACKEND`, `UIUX` e `FRONTEND` nao sao mais estagios autonomos; eles viraram lentes de dominio dentro de `BRAINSTORM_GERAL`.

**Regra central:** todo dialogo com o usuario usa exclusivamente `AskUserQuestion`.

---

## Comportamento

### Passo 1 - Preflight

Execute o preflight para verificar disponibilidade dos subagentes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Parse o JSON retornado e registre o status:

- `status: "ok"` - subagentes disponiveis.
- `status: "partial"` - prossiga e aplique fallback nos dominios/estagios afetados.
- `status: "unavailable"` - informe a indisponibilidade e use fallback em CODEX/AGY quando necessario.

Se o preflight falhar, nao aborte. Trate como `partial`.

### Passo 2 - Carregar Pensador

```text
Skill(skill="cc-pensador:pensador")
```

A skill define gates, checkpoint v2, isolamento por atualizacao, delegacao e fallback.

### Passo 3 - INIT

- Verifique checkpoints v2 em `.pensador/<slug>/.pensador-progress.json`.
- Se houver checkpoint valido, pergunte via `AskUserQuestion` se deve retomar ou iniciar nova atualizacao.
- Se houver checkpoint v1 em `pensador-output/.pensador-progress.json`, trate como incompativel e recomende iniciar v2 novo.
- Para novo fluxo, use `allocateFeatureDir()` e registre `featurePath`.
- Se `$ARGUMENTS` estiver vazio, solicite a demanda via `AskUserQuestion`.

### Passo 4 - Executar os estagios

Siga a ordem v2 definida em `skills/pensador/SKILL.md` e `skills/pensador/references/stages.md`.

Artefatos e estado devem ficar sob:

```text
.pensador/<slug>/
  .pensador-progress.json
  architecture.md
  shared-agents/
  prd.md
  userhistory.md
  comunication_json.md
```

### Passo 5 - Reportar ao usuario

Ao concluir FINAL, informe:

- Caminho de `prd.md`.
- Caminho de `userhistory.md`.
- Caminho de `comunication_json.md`, se houver back-end confirmado.
- Caminho de `architecture.md`.
- Caminho de `shared-agents/agent.response.md`.
- Recap final e handoff.

---

## Arquivos de referencia

| Arquivo | Proposito |
|---|---|
| `skills/pensador/SKILL.md` | Skill principal do Pensador v2 |
| `skills/prd/SKILL.md` | Skill_PRD_Base: schema e entrevista de descoberta |
| `skills/pensador/references/stages.md` | Definicao detalhada dos dez estagios |
| `skills/pensador/references/feature-isolation.md` | Isolamento `.pensador/<slug>/`, `allocateFeatureDir()`, checkpoint e `shared-agents/` |
| `skills/pensador/references/skill-stack.md` | Skills como lentes de dominio do BRAINSTORM_GERAL |
| `skills/pensador/references/agent-stack.md` | Codex/AGY, roteamento por dominio e contrato `shared-agents/` |
| `skills/pensador/references/askuserquestion-protocol.md` | AskUserQuestion, opcoes recomendadas, previews, recap final e handoff |
| `scripts/preflight.mjs` | Verifica disponibilidade de Codex e AGY |
| `scripts/pensador-engine.mjs` | Especificacao deterministica de referencia, nao importada em runtime pela skill |

---

## Quando invocado sem argumento

Se `$ARGUMENTS` estiver vazio, solicite a demanda via `AskUserQuestion`. Nunca inicie `PRD_BASE` sem demanda presente e nao vazia.
