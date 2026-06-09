# cc-pensador

> Claude Code plugin that conducts a natural language request through **ten stages of work** to a high-quality PRD — with architecture analysis, complexity heuristics, and domain lenses.

`version 2.0.0` · `category: planning` · all dialogue passes **exclusively** through `AskUserQuestion`.

**📖 [Leia em Português](./README.pt-BR.md) | Read in Portuguese**

## Overview

The `cc-pensador` distributes **Pensador v2**: the `pensador` skill and the `/pensador` command for Claude Code. Starting from a natural language request, Pensador analyzes the project architecture, calculates complexity, and orchestrates six domain-specific lenses in parallel (requirements clarity, backend, UI/UX, frontend, technical refinement, and product sweep) to produce a consolidated, high-fidelity PRD with supporting artifacts.

**Central invariant:** all dialogue between agents and user passes **exclusively** through the `AskUserQuestion` tool. No stage communicates through any other channel.

## Quick Start

### Installation

```bash
/plugin marketplace add AllanHarlen/cc-pensador
/plugin install cc-pensador@cc-pensador
/reload-plugins
```

### Dependencies: Codex and AGY

Pensador delegates to subagents **Codex** and **AGY**.

**Codex** (official plugin):
```bash
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

**AGY** (Pensador expects `cc-antigravity-plugin` with agents/antigravity-agent.md, commands/antigravity.md, scripts/antigravity-bridge.js)

> If a subagent is missing, Pensador detects it during preflight and asks via `AskUserQuestion` whether to proceed without it.

### Usage

```bash
/pensador <natural language request>
```

Example:
```bash
/pensador Create a login screen for users
```

If `<request>` is omitted, Pensador prompts for it via `AskUserQuestion` before starting the **PRD_BASE** stage.

## Ten Stages

```
INIT → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

| Stage | Purpose | Delegates | Always runs |
|---|---|---|---|
| **INIT** | Check v2 checkpoint resumption, allocate feature dir, obtain request | — | ✓ |
| **PRD_BASE** | Generate base PRD via `Strict_PRD_Schema`. No user questions; auto-advance. | skill `prd` | ✓ |
| **ARCH** | Analyze architecture via Read/Glob/Grep; write `architecture.md`. | — | ✓ |
| **EXPAND** | Amplify request with candidate requirements (Pensador questions). | — | ✓ |
| **COMPLEXITY** | Calculate complexity score (0–4); propose Lite or Full mode; user confirms. | — | ✓ |
| **BRAINSTORM_GERAL** | Orchestrate domain lenses in parallel: requirements-clarity + Codex (if backend) + AGY (if frontend). | `requirements-clarity` · `codex:codex-rescue` · `cc-antigravity-plugin:antigravity-agent` | ✓ |
| **CODEX** | Dedicated technical refinement with `effort high`. Does not run for frontend-only. | `codex:codex-rescue` | except frontend-only |
| **AGY** | Final product gaps sweep. | `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-high`) | ✓ |
| **FINAL** | Apply `withConsolidated`, confirm backend, generate artifacts, present recap and handoff. | — | ✓ |
| **DONE** | Terminal state. | — | — |

## Generated Artifacts

All saved directly under `.pensador/<slug-vN>/`. Confirms overwrite via `AskUserQuestion` if file exists.

- `prd.md` — Final consolidated PRD, structured per Strict PRD Schema. *(always)*
- `userhistory.md` — User journey in sequential steps. *(always)*
- `comunication_json.md` — Communication/API contract in JSON. *(when backend exists)*
- `architecture.md` — Detected architecture portrait. *(always, in `<featurePath>/`)*

## Lite vs. Full Mode

In the **COMPLEXITY** stage, Pensador calculates a score (0–4) based on four signals:

| Signal | +1 when |
|---|---|
| `domainCount > 1` | More than one functional/technical domain |
| `hasBackend` | API, data, auth, jobs, or server present |
| `hasBroadScopeKeywords` | Broad terms: platform, multi-user, compliance, payments |
| `isGreenfield` | ARCH found no existing base |

- **Score 0–1 → Lite suggestion:** streamlined flow, fewer domain questions.
- **Score ≥ 2 → Full suggestion:** integral flow, all domains.
- User always confirms or changes mode via `AskUserQuestion`.

## Project Structure

```
cc-pensador/
├─ .claude-plugin/
│  ├─ plugin.json            # plugin manifest
│  └─ marketplace.json       # marketplace entry
├─ commands/
│  └─ pensador.md            # /pensador command
├─ skills/
│  ├─ pensador/
│  │  ├─ SKILL.md
│  │  ├─ references/
│  │  │  ├─ stages.md
│  │  │  ├─ feature-isolation.md
│  │  │  ├─ agent-stack.md
│  │  │  ├─ skill-stack.md
│  │  │  └─ askuserquestion-protocol.md
│  │  └─ assets/             # templates
│  ├─ prd/SKILL.md
│  ├─ requirements-clarity/SKILL.md
│  ├─ backend-development/SKILL.md
│  ├─ ui-ux-pro-max/SKILL.md
│  └─ frontend-design/SKILL.md
├─ scripts/
│  ├─ preflight.mjs          # verifies Codex and AGY availability
│  └─ pensador-engine.mjs    # deterministic reference engine (validated by tests)
├─ test/
│  ├─ smoke.test.js
│  ├─ engine-complexity.test.js
│  ├─ feature-isolation.test.js
│  ├─ consolidate.test.js
│  ├─ artifacts.test.js
│  └─ docs-consistency.test.js
├─ CHANGELOG.md
└─ LICENSE                   # MIT
```

Add `.pensador/` to `.gitignore` to avoid versioning local artifacts and checkpoints.

## Testing

```bash
npm install
npm test       # Vitest — smoke · engine-complexity · feature-isolation · consolidate · artifacts · docs-consistency
```

## Migration from v1

| Aspect | v1 | v2 |
|---|---|---|
| `STAGE_ORDER` | 11 stages (CLARITY/BACKEND/UIUX/FRONTEND) | 10 stages (ARCH/COMPLEXITY/BRAINSTORM_GERAL) |
| `CHECKPOINT_VERSION` | 1 | 2 |
| Artifacts folder | legacy v1 root | `.pensador/<slug-vN>/` |
| v1 checkpoints | `pensador-output/.pensador-progress.json` | Incompatible — Pensador offers fresh start |
| Brainstorm | 4 sequential stages | 1 stage with parallel domain lenses |

v1 checkpoints are not auto-converted. Pensador detects incompatibility and offers to start fresh via `AskUserQuestion`.

## License

MIT

---

**Para mais detalhes em português, veja [README.pt-BR.md](./README.pt-BR.md)**
