# cc-pensador

> Claude Code plugin that conducts a natural language request through **eleven stages of work** to a high-quality PRD — with Code Base Memory exploration, architecture analysis, complexity heuristics, and domain lenses. Optionally delegates the heavy work to an external CLI (Antigravity, Kiro, or Codex) via `--modo`, saving Claude tokens.

`version 2.7.0` · `category: planning` · all dialogue passes **exclusively** through `AskUserQuestion`.

**📖 [Leia em Português](./README.pt-BR.md) | Read in Portuguese**

## Overview

The `cc-pensador` distributes **Pensador v2**: the `pensador` skill and the `/pensador` command for Claude Code. Starting from a natural language request, Pensador analyzes the project architecture, calculates complexity, and orchestrates six domain-specific lenses in parallel (requirements clarity, backend, UI/UX, frontend, technical refinement, and product sweep) to produce a consolidated, high-fidelity PRD with supporting artifacts.

**Central invariant:** all dialogue between agents and user passes **exclusively** through the `AskUserQuestion` tool. No stage communicates through any other channel.

By default (`--modo claude`), Claude Code runs the flow on its own tokens. With `--modo agy`, `--modo kiro`, or `--modo codex`, Claude becomes a thin orchestrator and delegates the heavy work to an external CLI — see [Execution Modes](#execution-modes---modo).

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

### Optional: Kiro (for `--modo kiro`)

The `--modo kiro` execution mode delegates the heavy work to the **Kiro CLI** via the `cc-kiro-plugin`:

```bash
/plugin marketplace add AllanHarlen/cc-kiro-plugin
/plugin install cc-kiro-plugin
/reload-plugins
```

Install and authenticate the Kiro CLI (`curl -fsSL https://cli.kiro.dev/install | bash`, or on Windows `irm 'https://cli.kiro.dev/install.ps1' | iex`; then `kiro-cli login`). The `--modo agy` and `--modo codex` modes reuse the `cc-antigravity-plugin` and `openai-codex` plugins installed above.

> The three plugins (`cc-antigravity-plugin`, `openai-codex`, `cc-kiro-plugin`) are declared as cross-marketplace dependencies. If the chosen `--modo` engine is missing, Pensador offers to fall back to `--modo claude` via `AskUserQuestion`.

### Usage

```bash
/pensador [--modo claude|agy|kiro|codex] [--model <id>] [--effort <level>] <natural language request>
```

Example:
```bash
/pensador Create a login screen for users
/pensador --modo kiro Create a login screen for users
/pensador --modo agy --model claude-4.6-opus-thinking Build a payments API
```

If `<request>` is omitted, Pensador prompts for it via `AskUserQuestion` before starting the **PRD_BASE** stage.

## Execution Modes (`--modo`)

The **execution mode** defines **which engine performs the heavy work** of the flow (drafting the base PRD, expanding requirements, synthesizing analyses, and generating artifacts). It is **orthogonal** to the domain lenses (Codex/AGY/skills inside the stages). By default, Claude Code does everything and spends its own tokens; a delegated mode shifts that cost to the external CLI's quota, keeping Claude only as the orchestrator.

| Mode | Who works | Delegation slash command | Default parameter |
|---|---|---|---|
| `--modo claude` (default) | Claude Code | — | — |
| `--modo agy` | Antigravity CLI | `/cc-antigravity-plugin:antigravity` | `--model claude-4.6-opus-thinking` |
| `--modo kiro` | Kiro CLI | `/cc-kiro-plugin:kiro` | `--model claude-opus-4.8 --effort high` |
| `--modo codex` | Codex CLI | `/codex:rescue` | `--effort high` |

- **Preserved invariant:** in any mode, all user dialogue still passes **exclusively** through `AskUserQuestion`. The external engine only produces drafts/analyses; Pensador re-reads, consolidates, and turns decisions into questions.
- Overrides: `--model <id>` (agy/kiro) and `--effort <level>` (kiro/codex; `xhigh`/`extrahigh` → `high`).
- An unknown `--modo` falls back to `claude` with a warning via `AskUserQuestion`.
- Preflight runs with `--modo <mode>`; if the engine is unavailable, Pensador offers to fall back to `--modo claude`.

Full details in `skills/pensador/references/execution-modes.md`. Deterministic mapping in `scripts/pensador-engine.mjs` (`EXECUTION_MODES`, `parseExecutionMode`, `resolveExecutionMode`, `buildDelegationInvocation`).

## Code Base Memory (mandatory exploration)

Before drafting the PRD/Spec base, Pensador explores the existing project with **[Code Base Memory](https://github.com/DeusData/codebase-memory-mcp)** (`codebase-memory-mcp`, an MCP server) so the deliverable reflects the real structure the feature/fix will act upon.

- Runs at the end of **INIT** (after the feature dir is allocated), with `index_repository → get_architecture → get_graph_schema → search_graph → trace_path` (plus `detect_changes` for fixes). The summary is written to `<featurePath>/codebase-memory.md`.
- **ARCH** reuses the same index and complements it with Read/Glob/Grep.
- Detected by preflight (CLI on PATH or an MCP config entry). If unavailable, Pensador asks via `AskUserQuestion` whether to install it or fall back to plain Read/Glob/Grep — it never blocks.

Install: `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash` (or `install.ps1` on Windows), then restart your agent. See `skills/pensador/references/codebase-memory.md`.

## OpenSpec (optional spec mode)

Pensador optionally integrates **[OpenSpec](https://github.com/Fission-AI/OpenSpec)**. When preflight detects OpenSpec (the `openspec` CLI on PATH or an `openspec/` directory), **INIT** asks via `AskUserQuestion` whether to generate a **PRD** (default) or a structured **Spec**.

- Choosing **Spec** repurposes the `PRD_BASE` stage to drive the **`openspec-*` commands** (`/openspec-new-change`, `/openspec-ff-change`, …), which scaffold the change set (`proposal.md`, `design.md`, `tasks.md`, `specs/`) under `openspec/changes/<name>/`. Pensador never hand-writes these files. Every later stage then reasons over the spec.
- Spec mode delivers **only** the OpenSpec change set — `userhistory.md` and `comunication_json.md` do not apply.
- `STAGE_ORDER` is unchanged — `PRD_BASE` keeps its id and only its behavior/artifacts differ (orthogonal `artifactMode`).
- FINAL runs `/openspec-verify-change` and points the handoff at `/openspec-apply-change` / `/openspec-sync-specs` / `/openspec-archive-change`.
- If the `openspec-*` commands are unavailable when Spec is chosen, Pensador asks (via `AskUserQuestion`) whether to fall back to PRD mode or abort — it does not build the structure manually. The legacy `/opsx:*` prefix is deprecated.

Install: `npm install -g @fission-ai/openspec@latest` then `openspec init`. See `skills/pensador/references/openspec.md`.

## Open Design (optional design system)

Pensador optionally integrates **[Open Design](https://github.com/nexu-io/open-design)** (`od`, an MCP server + CLI) to close the design gap that purely functional requirements leave open. Without it, an antd-default UI renders as a generic admin template; with it, the front-end agent gets a real visual target.

- Relevant only when the demand has a **front-end** (`hasFrontend`). In **BRAINSTORM_GERAL**, the Pensador parses a **design brief** via `AskUserQuestion` — visual tone, brand/references, color palette, typography, component states, responsiveness, accessibility (WCAG target) and microcopy.
- In **FINAL**, that brief drives Open Design to emit `design-system.md` (a brand-grade `DESIGN.md`: palette, typography, spacing, layout, components, motion, voice, anti-patterns).
- Detected by preflight (the `od` CLI on PATH or an MCP config entry). If unavailable when a front-end is present, Pensador asks via `AskUserQuestion` whether to **install it now** (it runs the installer + `od mcp install <agent>` and resumes) or **fall back** to an inline `design-system.md` written from the same 9-section schema — it never blocks.

Install: `curl -fsSL https://open-design.ai/install.sh | sh -s claude` then `od mcp install claude` (swap `claude` for your agent). See `skills/pensador/references/open-design.md`.

## Comprehensive, non-truncated PRD

The `Strict_PRD_Schema` (`skills/prd/SKILL.md`) defines **17 mandatory sections** so the PRD details the whole product at modern-system depth: Overview, Problem & Context, Objectives & Metrics, Personas, Scope, Functional Requirements, Non-Functional Requirements, **Design System & UI/UX**, Use Cases & Flows, **Data Model & Domain**, **API Contracts & Integrations**, **Security/Privacy & Compliance (LGPD, roles, multitenancy)**, **Observability & Operations**, Acceptance Criteria, Architecture, **Risks & Mitigations**, and Delivery Plan. An explicit anti-truncation directive requires every gap (business rule or technology) to be resolved or marked exactly `"TBD"` — the PRD is never shortened for brevity.

## Eleven Stages

```
INIT → EXPLORE → PRD_BASE → ARCH → EXPAND → COMPLEXITY → BRAINSTORM_GERAL → CODEX → AGY → FINAL → DONE
```

| Stage | Purpose | Delegates | Always runs |
|---|---|---|---|
| **INIT** | Resolve execution mode (`--modo`), check v2 checkpoint resumption, allocate feature dir, obtain request, ask PRD-vs-Spec when OpenSpec is detected | — | ✓ |
| **EXPLORE** | Explore the project with Code Base Memory (`index_repository → get_architecture → search_graph → trace_path`); write `codebase-memory.md`. Falls back to Read/Glob/Grep if unavailable. | MCP `codebase-memory-mcp` | ✓ |
| **PRD_BASE** | Generate base PRD via `Strict_PRD_Schema` (or scaffold the OpenSpec change set via `openspec-*` commands in spec mode). No user questions; auto-advance. | skill `prd` / `openspec-*` | ✓ |
| **ARCH** | Analyze architecture (reuse the Code Base Memory index + Read/Glob/Grep); write `architecture.md`. | — | ✓ |
| **EXPAND** | Amplify request with candidate requirements (Pensador questions). | — | ✓ |
| **COMPLEXITY** | Calculate complexity score (0–4); propose Lite or Full mode; user confirms. | — | ✓ |
| **BRAINSTORM_GERAL** | Orchestrate domain lenses in parallel: requirements-clarity + Codex (if backend) + AGY (if frontend) + Open Design design brief (if frontend). | `requirements-clarity` · `codex:codex-rescue` · `cc-antigravity-plugin:antigravity-agent` · Open Design (`od`) | ✓ |
| **CODEX** | Dedicated technical refinement with `effort high`. Does not run for frontend-only. | `codex:codex-rescue` | except frontend-only |
| **AGY** | Final product gaps sweep. | `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-high`) | ✓ |
| **FINAL** | Apply `withConsolidated`, confirm backend, generate artifacts, present recap and handoff. | — | ✓ |
| **DONE** | Terminal state. | — | — |

## Generated Artifacts

All saved directly under `.pensador/<slug-vN>/`. Confirms overwrite via `AskUserQuestion` if file exists.

- `prd.md` — Final consolidated PRD, structured per Strict PRD Schema. *(PRD mode)*
- `openspec/changes/<name>/` — OpenSpec change set (`proposal.md`, `design.md`, `tasks.md`, `specs/`), scaffolded by the `openspec-*` commands. *(spec mode)*
- `userhistory.md` — User journey in sequential steps. *(PRD mode only)*
- `comunication_json.md` — Communication/API contract in JSON. *(PRD mode, when backend exists)*
- `design-system.md` — Brand-grade design system (DESIGN.md: palette, typography, spacing, components, motion, voice), produced via Open Design from a parsed design brief. *(PRD mode, when front-end exists; inline fallback if Open Design is unavailable)*
- `codebase-memory.md` — Code Base Memory exploration snapshot. *(always, in `<featurePath>/`)*
- `architecture.md` — Detected architecture portrait. *(always, in `<featurePath>/`)*
- `handoff.json` — Handoff manifest for `/cc-orchestrador-subagents:orchestrador` (artifact discovery anchor; see `references/handoff-contract.md`). *(always)*

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

## Preflight

The `/pensador` command runs a preflight before starting the flow, passing the chosen execution mode:

```bash
node scripts/preflight.mjs --modo <claude|agy|kiro|codex>
```

It inspects the Claude Code plugin cache to verify the availability of the domain subagents (Codex and AGY) and the `--modo` **execution engine** (Antigravity, Kiro, or Codex), and emits JSON with an `executionMode` block, an `integrations` block (mandatory `codebaseMemory` + optional `openspec` + optional `openDesign`), and a `status` field (`ok` | `partial` | `unavailable`). The script **always exits with code 0**.

## Project Structure

```
cc-pensador/
├─ .claude-plugin/
│  ├─ plugin.json            # plugin manifest
│  └─ marketplace.json       # marketplace entry
├─ commands/
│  └─ pensador.md            # /pensador command (orchestrates the 11 stages + --modo)
├─ skills/
│  ├─ pensador/
│  │  ├─ SKILL.md
│  │  ├─ references/
│  │  │  ├─ stages.md
│  │  │  ├─ feature-isolation.md
│  │  │  ├─ agent-stack.md
│  │  │  ├─ skill-stack.md
│  │  │  ├─ execution-modes.md           # --modo (claude/agy/kiro/codex): parsing, preflight, delegation
│  │  │  ├─ codebase-memory.md           # Code Base Memory (MCP) mandatory exploration before PRD/Spec
│  │  │  ├─ open-design.md               # Open Design (MCP/CLI) optional: design brief → design-system.md when front-end
│  │  │  ├─ openspec.md                  # OpenSpec optional spec mode (PRD vs Spec in INIT)
│  │  │  └─ askuserquestion-protocol.md
│  │  └─ assets/             # templates
│  ├─ prd/SKILL.md
│  ├─ requirements-clarity/SKILL.md
│  ├─ backend-development/SKILL.md
│  ├─ ui-ux-pro-max/SKILL.md
│  └─ frontend-design/SKILL.md
├─ scripts/
│  ├─ preflight.mjs          # verifies Codex, AGY, Kiro and the execution engine
│  └─ pensador-engine.mjs    # deterministic reference engine (validated by tests)
├─ test/
│  ├─ smoke.test.js
│  ├─ engine-complexity.test.js
│  ├─ feature-isolation.test.js
│  ├─ consolidate.test.js
│  ├─ artifacts.test.js
│  ├─ execution-modes.test.js            # --modo: parse/resolve/buildDelegationInvocation
│  ├─ integrations.test.js               # Code Base Memory + OpenSpec spec mode + Open Design
│  └─ docs-consistency.test.js
├─ CHANGELOG.md
└─ LICENSE                   # MIT
```

Add `.pensador/` to `.gitignore` to avoid versioning local artifacts and checkpoints.

## Testing

```bash
npm install
npm test       # Vitest — smoke · engine-complexity · feature-isolation · consolidate · artifacts · execution-modes · integrations · docs-consistency
```

## Migration from v1

| Aspect | v1 | v2 |
|---|---|---|
| `STAGE_ORDER` | 11 stages (CLARITY/BACKEND/UIUX/FRONTEND) | 11 stages (EXPLORE/ARCH/COMPLEXITY/BRAINSTORM_GERAL) |
| `CHECKPOINT_VERSION` | 1 | 2 |
| Artifacts folder | legacy v1 root | `.pensador/<slug-vN>/` |
| v1 checkpoints | `pensador-output/.pensador-progress.json` | Incompatible — Pensador offers fresh start |
| Brainstorm | 4 sequential stages | 1 stage with parallel domain lenses |

v1 checkpoints are not auto-converted. Pensador detects incompatibility and offers to start fresh via `AskUserQuestion`.

## License

MIT

---

**Para mais detalhes em português, veja [README.pt-BR.md](./README.pt-BR.md)**
