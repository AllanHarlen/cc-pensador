/**
 * Pensador Engine
 *
 * Pure, deterministic module — no I/O, no side effects.
 * Encapsulates the state machine, advancement gates, effort/model mappings,
 * consolidation, project classification, and artifact planning for the
 * Pensador PRD workflow.
 *
 * IMPORTANT — runtime role of this module:
 *   This file is the *deterministic reference specification* of the flow,
 *   exercised by the test suite. A Claude Code skill/command is Markdown
 *   interpreted by the LLM; it does NOT import this module at runtime nor keep
 *   a live `state` object across turns. The Pensador (the LLM) applies the same
 *   rules encoded here directly from the prose in `skills/pensador/SKILL.md`.
 *   If/when a CLI wrapper + state persistence are added, the skill can shell
 *   out to it; until then, this module's value is: (1) an unambiguous, testable
 *   definition of the rules, and (2) a guard against drift via property/unit
 *   tests.
 *
 * All data transformations are referentially transparent: same input → same output.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical stage order. Never reordered or skipped.
 * Semantic identifiers (not numeric) so each stage is self-describing and
 * insertion of new brainstorm stages does not silently shift a numbered label.
 *
 * Funnel: generate → explore (Code Base Memory) → base (PRD/Spec) → architecture →
 * expand → clarify → domain deep-dives → technical sweep (Codex) → product sweep
 * (AGY) → consolidate.
 */
export const STAGE_ORDER = [
  'INIT',
  'EXPLORE',
  'PRD_BASE',
  'ARCH',
  'EXPAND',
  'COMPLEXITY',
  'BRAINSTORM_GERAL',
  'CODEX',
  'AGY',
  'FINAL',
  'DONE',
];

/**
 * Stages that produce consolidated requirements (every working stage after the
 * PRD base scaffold). Used by consolidate().
 */
export const REQUIREMENT_STAGES = ['EXPAND', 'BRAINSTORM_GERAL', 'CODEX', 'AGY'];

/**
 * Stages that delegate to an external brainstorm skill or subagent, mapped to
 * the concrete delegation target. The Pensador uses this map so the skill/agent
 * choice per stage is deterministic and traceable.
 *
 * `relevantWhen` is an advisory signal (computed from classifyProject) telling
 * the LLM when a domain brainstorm is expected to surface questions. A stage
 * that is not relevant simply yields zero questions and auto-advances — it is
 * still *visited*, never skipped.
 */
export const STAGE_DELEGATION = {
  BRAINSTORM_GERAL: {
    kind: 'parallel',
    domains: {
      requirements: {
        kind: 'skill',
        ref: 'requirements-clarity',
        origin: 'requirements-clarity',
        relevantWhen: 'always',
      },
      backend: {
        kind: 'subagent',
        ref: 'codex:codex-rescue',
        origin: 'codex',
        param: '--effort high',
        relevantWhen: 'hasBackend',
      },
      uiux: {
        kind: 'subagent',
        ref: 'cc-antigravity-plugin:antigravity-agent',
        origin: 'agy',
        param: '--model gemini-3.1-pro-high',
        relevantWhen: 'hasFrontend',
      },
    },
  },
  // CODEX runs the final technical sweep — but a *front-end-specific* activity
  // (front-end present, no back-end) has nothing for Codex to refine, so Codex
  // does not participate. The stage is still visited (it yields zero questions
  // and auto-advances); see codexParticipates(). `relevantWhen` is advisory,
  // mirroring the BRAINSTORM_GERAL backend domain which is already gated off for
  // front-end-only work via hasBackend.
  CODEX:    { kind: 'subagent', ref: 'codex:codex-rescue',                          origin: 'codex', param: '--effort high', relevantWhen: 'not(frontendOnly)' },
  AGY:      { kind: 'subagent', ref: 'cc-antigravity-plugin:antigravity-agent',     origin: 'agy',   param: '--model gemini-3.1-pro-high' },
};

/** Origins that represent a resolved gap (anything not authored by the Pensador itself). */
export const GAP_ORIGINS = ['requirements-clarity', 'backend-development', 'ui-ux-pro-max', 'frontend-design', 'codex', 'agy'];

/** Allowlist of valid AGY model identifiers. */
export const AGY_MODEL_ALLOWLIST = [
  'gemini-3.1-pro-high',
];

/** AGY model used in the AGY stage. Must be a member of AGY_MODEL_ALLOWLIST. */
export const AGY_STAGE_MODEL = 'gemini-3.1-pro-high';

/** Channel constant for all user-facing questions. */
export const ASK_USER_QUESTION = 'ASK_USER_QUESTION';

/**
 * Detects whether the Pensador flow should run in Lite or Completo mode.
 *
 * @param {ComplexitySignals} signals
 * @returns {ComplexityResult}
 */
export function detectComplexity(signals = {}) {
  const score = [
    Number(signals?.domainCount) > 1,
    signals?.hasBackend === true,
    signals?.hasBroadScopeKeywords === true,
    signals?.isGreenfield === true,
  ].filter(Boolean).length;

  return {
    score,
    mode: score >= 2 ? 'Completo' : 'Lite',
  };
}

/**
 * Normalizes an update name ("nome da atualização") into a filesystem-safe slug
 * used directly as the update's folder name under `.pensador/`.
 *
 * Strips accents, lowercases, and collapses any run of non-alphanumeric
 * characters into a single hyphen. Pure and total: same input → same output,
 * never throws. Empty/whitespace-only input yields '' so the caller can apply a
 * fallback.
 *
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dirNameFromFeatureDir(featureDir) {
  return String(featureDir ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.pensador\//, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .pop() ?? '';
}

function nextFeatureVersion(existingFeatureDirs = [], baseSlug) {
  const re = new RegExp(`^${escapeRegex(baseSlug)}-v(\\d+)$`);
  const versions = (Array.isArray(existingFeatureDirs) ? existingFeatureDirs : [])
    .map(dirNameFromFeatureDir)
    .map((name) => name.match(re))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((version) => Number.isSafeInteger(version) && version > 0);

  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/**
 * Allocates the update directory or resumes an incomplete checkpoint.
 *
 * The folder name is the slug of the update name ("nome da atualização"), used
 * with a local version suffix under `.pensador/` (e.g. `.pensador/login-social-v1`).
 * Reusing the same slug allocates the next version (`-v2`, `-v3`, ...). There is
 * no numeric `feature-nN` prefix. An empty/blank name falls back to `atualizacao-v1`.
 *
 * @param {string[]} existingFeatureDirs - existing `.pensador/` children used
 *   to choose the next version for the same base slug.
 * @param {{ name?: string, slug?: string, incompleteCheckpoint?: string }} options
 * @returns {FeatureDirResult}
 */
export function allocateFeatureDir(existingFeatureDirs = [], options = {}) {
  if (options?.incompleteCheckpoint) {
    const checkpointName = String(options.incompleteCheckpoint);
    return {
      featureDir: `.pensador/${checkpointName}`,
      isResume: true,
      slug: checkpointName,
    };
  }

  const baseSlug = slugify(options?.name ?? options?.slug ?? '') || 'atualizacao';
  const version = nextFeatureVersion(existingFeatureDirs, baseSlug);
  const slug = `${baseSlug}-v${version}`;

  return {
    featureDir: `.pensador/${slug}`,
    isResume: false,
    slug,
  };
}

/**
 * Builds a path inside an update directory.
 *
 * Final artifacts (prd.md, userhistory.md, comunication_json.md) live directly
 * in the update directory — only sibling working dirs like `shared-agents` go
 * through here.
 *
 * @param {string} featureDir
 * @param {'shared-agents'} subdir
 * @returns {string}
 */
export function buildFeaturePath(featureDir, subdir) {
  return `${featureDir}/${subdir}`;
}

// ---------------------------------------------------------------------------
// State initialization
// ---------------------------------------------------------------------------

/**
 * Creates the initial StageState.
 *
 * @param {string | undefined | null} demanda - The user's demand in natural language.
 * @returns {StageState}
 *
 * Behaviour:
 *   - demanda empty / whitespace-only / absent → needsDemanda=true, currentStage='INIT'
 *   - demanda non-empty → needsDemanda=false, currentStage='INIT' (first advance targets EXPLORE)
 */
export function initState(demanda) {
  const trimmed = typeof demanda === 'string' ? demanda.trim() : '';
  const needsDemanda = trimmed.length === 0;

  return {
    demanda: needsDemanda ? null : trimmed,
    needsDemanda,
    currentStage: 'INIT',
    questions: [],
    prdBase: { sections: {} },
    consolidated: [],
    featurePath: null,
    // Output mode: 'prd' (default) or 'spec' (OpenSpec). When OpenSpec is
    // detected at preflight, INIT asks the user and may switch this to 'spec'.
    artifactMode: DEFAULT_ARTIFACT_MODE,
  };
}

// ---------------------------------------------------------------------------
// Questions and gates
// ---------------------------------------------------------------------------

/**
 * Adds a list of questions for a given stage to the state.
 *
 * @param {StageState} state
 * @param {string} stage
 * @param {Question[]} questions
 * @returns {StageState}
 */
export function addQuestions(state, stage, questions) {
  const tagged = questions.map((q) => ({
    ...q,
    stage,
    answer: q.answer ?? null,
    channel: ASK_USER_QUESTION,
  }));

  return {
    ...state,
    questions: [...state.questions, ...tagged],
  };
}

/**
 * Records the user's answer for a specific question.
 *
 * @param {StageState} state
 * @param {string} questionId
 * @param {string} answer
 * @returns {StageState}
 */
export function recordAnswer(state, questionId, answer) {
  return {
    ...state,
    questions: state.questions.map((q) =>
      q.id === questionId ? { ...q, answer } : q
    ),
  };
}

/**
 * Returns all unanswered questions for a given stage.
 *
 * @param {StageState} state
 * @param {string} stage
 * @returns {Question[]}
 */
export function pendingQuestions(state, stage) {
  return state.questions.filter((q) => q.stage === stage && q.answer === null);
}

/**
 * Returns true iff there are no unanswered questions in the current stage.
 *
 * @param {StageState} state
 * @returns {boolean}
 */
export function canAdvance(state) {
  return pendingQuestions(state, state.currentStage).length === 0;
}

/**
 * Advances the state by one step in STAGE_ORDER if canAdvance is true.
 * Returns the same state (no-op) when blocked by pending questions.
 *
 * A brainstorm stage with zero questions (e.g. a domain skill judged not
 * relevant) trivially satisfies the gate and advances on the next call — the
 * stage is visited, never skipped.
 *
 * @param {StageState} state
 * @returns {StageState}
 */
export function advance(state) {
  if (!canAdvance(state)) {
    return state;
  }

  const currentIndex = STAGE_ORDER.indexOf(state.currentStage);
  // If already at the last stage, stay there
  if (currentIndex === -1 || currentIndex === STAGE_ORDER.length - 1) {
    return state;
  }

  return {
    ...state,
    currentStage: STAGE_ORDER[currentIndex + 1],
  };
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

/**
 * Consolidates all answered questions from the requirement-producing stages
 * (EXPAND, BRAINSTORM_GERAL, CODEX, AGY) into Requirement objects.
 * Unanswered questions are excluded.
 *
 * @param {StageState} state
 * @returns {Requirement[]}
 */
export function consolidate(state) {
  const targetStages = new Set(REQUIREMENT_STAGES);

  return state.questions
    .filter((q) => targetStages.has(q.stage) && q.answer !== null)
    .map((q) => ({
      id: q.id,
      source: q.stage.toLowerCase(),
      text: q.answer,
      origin: q.origin,
      // Any non-pensador origin (a brainstorm skill, Codex, or AGY) closes a gap.
      resolvesGap: q.origin && q.origin !== 'pensador' ? true : undefined,
    }));
}

/**
 * Returns a new state whose `consolidated` field is the result of consolidate().
 *
 * This is the bridge the FINAL stage MUST use before planning artifacts:
 * `planArtifacts`/`buildArtifactList` read `state.consolidated`, which is empty
 * until this is called. (Fixes the prior wiring gap where consolidate() was
 * computed but never stored, leaving comunication_json never planned.)
 *
 * @param {StageState} state
 * @returns {StageState}
 */
export function withConsolidated(state) {
  return {
    ...state,
    consolidated: consolidate(state),
  };
}

// ---------------------------------------------------------------------------
// Delegation mappings
// ---------------------------------------------------------------------------

/**
 * Maps a requested effort level to the effective effort accepted by Codex.
 * extrahigh → high (Codex only recognises medium and high).
 *
 * @param {'medium' | 'high' | 'extrahigh'} requested
 * @returns {'medium' | 'high'}
 */
export function mapEffort(requested) {
  switch (requested) {
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'extrahigh':
      return 'high';
    default:
      return 'high';
  }
}

/**
 * Returns the AGY model identifier for the AGY stage.
 * Asserts membership in AGY_MODEL_ALLOWLIST at call time.
 *
 * @returns {'gemini-3.1-pro-high'}
 */
export function agyStageModel() {
  const model = AGY_STAGE_MODEL;
  if (!AGY_MODEL_ALLOWLIST.includes(model)) {
    throw new Error(
      `AGY_STAGE_MODEL '${model}' is not in AGY_MODEL_ALLOWLIST: [${AGY_MODEL_ALLOWLIST.join(', ')}]`
    );
  }
  return model;
}

// ---------------------------------------------------------------------------
// Execution modes (--modo)
// ---------------------------------------------------------------------------

/**
 * Execution mode selects WHICH engine performs the heavy generative work of the
 * Pensador workflow (drafting the PRD base, expanding requirements, synthesizing
 * brainstorm/Codex/AGY analyses, writing artifacts). It is orthogonal to the
 * stage delegation in STAGE_DELEGATION (Codex/AGY/skills as *domain lenses*).
 *
 *   - `claude` (default): Claude Code itself does the work, spending its tokens.
 *   - `agy` | `kiro` | `codex`: Claude Code becomes a thin orchestrator that
 *     delegates each unit of work to the external CLI plugin via a slash command,
 *     so the work is billed against that engine's quota instead of Claude's.
 *
 * INVARIANT: regardless of mode, ALL user dialogue still routes exclusively
 * through AskUserQuestion. A delegating mode never lets the external engine talk
 * to the user — it only produces drafts/analysis the Pensador relays.
 */
export const DEFAULT_EXECUTION_MODE = 'claude';

/**
 * Registry of execution modes. `delegates: false` means Claude does the work
 * inline. For delegating modes, `command` + `paramFlag`/`defaultParam` describe
 * the slash-command invocation, and `plugin` is what preflight.mjs probes in the
 * Claude Code plugin cache.
 */
export const EXECUTION_MODES = {
  claude: {
    mode: 'claude',
    label: 'Claude Code (padrão)',
    delegates: false,
    command: null,
    defaultModel: null,
    defaultEffort: null,
    plugin: null,
  },
  agy: {
    mode: 'agy',
    label: 'Antigravity (AGY)',
    delegates: true,
    command: '/cc-antigravity-plugin:antigravity',
    defaultModel: 'claude-4.6-opus-thinking',
    defaultEffort: null,
    plugin: { marketplace: 'cc-antigravity-plugin', name: 'cc-antigravity-plugin' },
  },
  kiro: {
    mode: 'kiro',
    label: 'Kiro CLI',
    delegates: true,
    command: '/cc-kiro-plugin:kiro',
    // Default: Claude Opus 4.8 at high effort. The Kiro bridge normalizes model
    // aliases / natural forms into the canonical Kiro id.
    defaultModel: 'claude-opus-4.8',
    defaultEffort: 'high',
    plugin: { marketplace: 'cc-kiro-plugin', name: 'cc-kiro-plugin' },
  },
  codex: {
    mode: 'codex',
    label: 'Codex CLI',
    delegates: true,
    command: '/codex:rescue',
    defaultModel: null,
    defaultEffort: 'high',
    plugin: { marketplace: 'openai-codex', name: 'codex' },
  },
};

/**
 * Parses the raw `$ARGUMENTS` string of `/pensador`, extracting the execution
 * mode flag and optional `--model` / `--effort` overrides, and returns the
 * leftover text as the demanda. Pure and total: same input → same output, never
 * throws. Unknown `--modo <x>` falls back to the default mode with
 * `modeValid: false` so the caller can warn the user.
 *
 * Accepts `--modo agy` and `--modo=agy` (case-insensitive value).
 *
 * @param {string | null | undefined} rawArgs
 * @returns {{ mode: string, requestedMode: string|null, modeValid: boolean,
 *   modelOverride: string|null, effortOverride: string|null, demanda: string }}
 */
export function parseExecutionMode(rawArgs) {
  let text = typeof rawArgs === 'string' ? rawArgs : '';

  const extract = (re) => {
    const m = text.match(re);
    if (!m) return null;
    text = text.replace(m[0], ' ');
    return m[2];
  };

  const requestedRaw = extract(/(^|\s)--modo(?:=|\s+)([a-zA-Z]+)/);
  const modelOverride = extract(/(^|\s)--model(?:=|\s+)(\S+)/);
  const effortOverride = extract(/(^|\s)--effort(?:=|\s+)(\S+)/);

  const requestedMode = requestedRaw ? requestedRaw.toLowerCase() : null;
  const known =
    requestedMode !== null &&
    Object.prototype.hasOwnProperty.call(EXECUTION_MODES, requestedMode);

  return {
    mode: known ? requestedMode : DEFAULT_EXECUTION_MODE,
    requestedMode,
    modeValid: requestedMode === null || known,
    modelOverride: modelOverride ?? null,
    effortOverride: effortOverride ?? null,
    demanda: text.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Normalizes a requested Codex/Kiro effort to a value the flow communicates.
 * Mirrors mapEffort but also accepts `xhigh` (Codex/Kiro spelling) → high.
 *
 * @param {string} requested
 * @returns {'medium'|'high'}
 */
function normalizeEffort(requested) {
  return mapEffort(requested === 'xhigh' ? 'extrahigh' : requested);
}

/**
 * Resolves an execution mode key (plus optional overrides) into a concrete
 * descriptor with the effective `model` and `effort` the slash command should
 * carry. Pure and total: unknown mode → default (claude). For a non-delegating
 * mode, both are null.
 *
 * Override precedence (per field): explicit override > mode default > none.
 *
 * @param {string} mode
 * @param {{ model?: string, modelOverride?: string, effort?: string, effortOverride?: string }} [overrides]
 * @returns {{ mode: string, label: string, delegates: boolean, command: string|null,
 *   model: string|null, effort: string|null,
 *   modelSource: 'override'|'default'|'none', effortSource: 'override'|'default'|'none',
 *   plugin: { marketplace: string, name: string }|null }}
 */
export function resolveExecutionMode(mode, overrides = {}) {
  const key = Object.prototype.hasOwnProperty.call(EXECUTION_MODES, mode)
    ? mode
    : DEFAULT_EXECUTION_MODE;
  const base = EXECUTION_MODES[key];

  if (!base.delegates) {
    return { ...base, model: null, effort: null, modelSource: 'none', effortSource: 'none' };
  }

  const modelOverride = overrides.model ?? overrides.modelOverride ?? null;
  const effortOverride = overrides.effort ?? overrides.effortOverride ?? null;

  const model = modelOverride ?? base.defaultModel ?? null;
  const modelSource = modelOverride ? 'override' : base.defaultModel ? 'default' : 'none';

  let effort = effortOverride ?? base.defaultEffort ?? null;
  const effortSource = effortOverride ? 'override' : base.defaultEffort ? 'default' : 'none';
  if (effort) effort = normalizeEffort(effort);

  return { ...base, model, effort, modelSource, effortSource };
}

/**
 * Builds the slash-command invocation string a delegating execution mode uses to
 * hand one unit of work to its external engine. Returns null for a
 * non-delegating mode (claude does the work inline). Appends `--model` and/or
 * `--effort` when resolved, then the JSON-quoted prompt.
 *
 * Examples:
 *   buildDelegationInvocation('agy',  { prompt: 'PromptSystem' })
 *     → '/cc-antigravity-plugin:antigravity --model claude-4.6-opus-thinking "PromptSystem"'
 *   buildDelegationInvocation('kiro', { prompt: 'PromptSystem' })
 *     → '/cc-kiro-plugin:kiro --model claude-opus-4.8 --effort high "PromptSystem"'
 *   buildDelegationInvocation('codex', { prompt: 'PromptSystem' })
 *     → '/codex:rescue --effort high "PromptSystem"'
 *
 * @param {string | ReturnType<typeof resolveExecutionMode>} modeOrConfig
 * @param {{ prompt?: string, model?: string, effort?: string }} [payload]
 * @returns {string | null}
 */
export function buildDelegationInvocation(modeOrConfig, payload = {}) {
  const config =
    typeof modeOrConfig === 'string'
      ? resolveExecutionMode(modeOrConfig, payload)
      : modeOrConfig;

  if (!config || !config.delegates || !config.command) {
    return null;
  }

  const parts = [config.command];
  if (config.model) parts.push('--model', config.model);
  if (config.effort) parts.push('--effort', config.effort);
  parts.push(JSON.stringify(typeof payload.prompt === 'string' ? payload.prompt : ''));
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Code Base Memory (MCP) — project exploration before PRD/Spec generation
// ---------------------------------------------------------------------------

/**
 * Code Base Memory MCP (https://github.com/DeusData/codebase-memory-mcp).
 *
 * A structural code-intelligence engine exposed as an MCP server. Before the
 * Pensador drafts the PRD_BASE (or the OpenSpec base, when in spec mode), it
 * uses this server to *explore the existing project* and build an accurate,
 * token-cheap understanding of the structure the feature/fix will act upon.
 *
 * This is the MANDATORY exploration support: it runs in the dedicated EXPLORE
 * stage (right after INIT, before PRD_BASE/Spec) and its snapshot feeds PRD_BASE
 * and the deeper ARCH analysis. When the server is unavailable, the Pensador
 * degrades gracefully to plain `Read`/`Glob`/`Grep` exploration (handled via
 * AskUserQuestion) — the stage is still visited.
 *
 * The constant is a deterministic descriptor (server id, tool names, config
 * locations, snapshot filename) consumed by the prose layer and the tests; the
 * engine performs no I/O.
 */
export const CODEBASE_MEMORY = {
  server: 'codebase-memory-mcp',
  repo: 'https://github.com/DeusData/codebase-memory-mcp',
  mandatory: true,
  /** Where the MCP server is typically registered, by host. */
  configFiles: {
    claudeProject: '.mcp.json',
    claudeGlobal: '~/.claude/.mcp.json',
    kiro: '.kiro/settings/mcp.json',
  },
  /** The subset of the 14 MCP tools the Pensador relies on for exploration. */
  tools: {
    indexRepository: 'index_repository',
    indexStatus: 'index_status',
    listProjects: 'list_projects',
    getArchitecture: 'get_architecture',
    getGraphSchema: 'get_graph_schema',
    searchGraph: 'search_graph',
    tracePath: 'trace_path',
    detectChanges: 'detect_changes',
    getCodeSnippet: 'get_code_snippet',
    searchCode: 'search_code',
  },
  /** Working snapshot written under <featurePath>/ (not a final artifact). */
  snapshotFile: 'codebase-memory.md',
};

/**
 * Builds the path of the Code Base Memory exploration snapshot inside the update
 * directory. Like `architecture.md`, this is a working file (it is NOT part of
 * buildArtifactList) consumed by PRD_BASE/Spec and ARCH.
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function codebaseMemorySnapshotPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${CODEBASE_MEMORY.snapshotFile}`;
}

/**
 * Returns the canonical ordered sequence of Code Base Memory tool calls the
 * Pensador uses to explore a project before generating the PRD/Spec base.
 *
 * Pure and total: same input → same output, never throws. When the demand is a
 * fix/change over existing code (`isFix`), `detect_changes` is appended to map
 * the git diff to affected symbols and blast radius.
 *
 * @param {{ isFix?: boolean }} [options]
 * @returns {string[]} ordered MCP tool names
 */
export function codebaseMemoryExplorationPlan(options = {}) {
  const t = CODEBASE_MEMORY.tools;
  const plan = [
    t.indexRepository,
    t.getArchitecture,
    t.getGraphSchema,
    t.searchGraph,
    t.tracePath,
  ];
  if (options?.isFix === true) {
    plan.push(t.detectChanges);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Output/artifact mode (PRD vs OpenSpec) — orthogonal to execution mode
// ---------------------------------------------------------------------------

/**
 * The artifact mode selects WHICH base deliverable the flow produces. It is
 * orthogonal to the execution mode (--modo) and to the domain lenses.
 *
 *   - `prd` (default): the classic Pensador flow. PRD_BASE drafts a base PRD and
 *     FINAL emits prd.md (+ userhistory.md, + comunication_json.md when backend).
 *   - `spec`: OpenSpec mode (https://github.com/Fission-AI/OpenSpec). Offered
 *     ONLY when preflight detects OpenSpec; chosen by the user via AskUserQuestion
 *     in INIT. The PRD_BASE stage is repurposed into a structured OpenSpec base
 *     assembly, and every later stage reasons over the spec instead of the PRD.
 *     FINAL emits the OpenSpec change set (proposal.md, specs.md, design.md,
 *     tasks.md) in place of prd.md.
 *
 * The stage machine (STAGE_ORDER) is unchanged in either mode: `PRD_BASE` keeps
 * its id and simply produces a spec base when artifactMode === 'spec'.
 */
export const DEFAULT_ARTIFACT_MODE = 'prd';

export const ARTIFACT_MODES = {
  prd: {
    mode: 'prd',
    label: 'PRD',
    baseStageLabel: 'PRD base',
    primaryArtifact: 'prd.md',
    openspec: false,
  },
  spec: {
    mode: 'spec',
    label: 'OpenSpec',
    baseStageLabel: 'montagem de specs estruturadas (OpenSpec)',
    primaryArtifact: 'proposal.md',
    openspec: true,
  },
};

/**
 * Normalizes an artifact-mode key. Unknown / nullish → the default ('prd').
 * Pure and total.
 *
 * @param {string|null|undefined} mode
 * @returns {'prd'|'spec'}
 */
export function resolveArtifactMode(mode) {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_MODES, mode)
    ? mode
    : DEFAULT_ARTIFACT_MODE;
}

/**
 * Returns a new state with the chosen artifact mode applied (normalized).
 * The Pensador calls this in INIT after the user answers the PRD-vs-Spec
 * AskUserQuestion (only presented when OpenSpec is detected).
 *
 * @param {StageState} state
 * @param {string} mode
 * @returns {StageState}
 */
export function withArtifactMode(state, mode) {
  return { ...state, artifactMode: resolveArtifactMode(mode) };
}

/**
 * OpenSpec (https://github.com/Fission-AI/OpenSpec) descriptor.
 *
 * In spec mode the Pensador does NOT hand-write the change files: it drives the
 * `openspec-*` skills/commands, which scaffold and manage the change set under
 * `openspec/changes/<name>/`. The legacy `/opsx:*` prefix is DEPRECATED — always
 * use `openspec-*`. Detection (CLI on PATH, an `openspec/` directory, or the
 * openspec plugin) lives in preflight.mjs.
 *
 * If the `openspec-*` commands are unavailable when spec mode is chosen, the
 * Pensador must NOT create the structure manually nor proceed as plain Claude:
 * it asks (via AskUserQuestion) whether to fall back to PRD mode or abort.
 */
export const OPENSPEC = {
  cli: 'openspec',
  package: '@fission-ai/openspec',
  repo: 'https://github.com/Fission-AI/OpenSpec',
  dir: 'openspec',
  specsDir: 'openspec/specs',
  changesDir: 'openspec/changes',
  optional: true,
  /** openspec-* slash commands (the legacy /opsx:* prefix is deprecated). */
  commands: {
    onboard: '/openspec-onboard',
    explore: '/openspec-explore',
    newChange: '/openspec-new-change',
    ffChange: '/openspec-ff-change',
    continueChange: '/openspec-continue-change',
    applyChange: '/openspec-apply-change',
    verifyChange: '/openspec-verify-change',
    syncSpecs: '/openspec-sync-specs',
    archiveChange: '/openspec-archive-change',
    bulkArchiveChange: '/openspec-bulk-archive-change',
  },
  /** Files OpenSpec scaffolds inside openspec/changes/<name>/. */
  changeFiles: ['proposal.md', 'design.md', 'tasks.md', 'specs/'],
};

/**
 * Derives the OpenSpec change name from the update directory. The change name is
 * the feature slug (e.g. `.pensador/login-social-v1` → `login-social-v1`).
 * Empty/absent → `atualizacao-v1`. Pure and total.
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function openspecChangeName(featurePath) {
  return dirNameFromFeatureDir(featurePath) || 'atualizacao-v1';
}

/**
 * Builds the OpenSpec change directory for an update: `openspec/changes/<name>`.
 * This is where the `openspec-*` commands scaffold the change set (it lives in
 * the project's `openspec/` tree, NOT under `.pensador/`).
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function openspecChangeDir(featurePath) {
  return `${OPENSPEC.changesDir}/${openspecChangeName(featurePath)}`;
}

// ---------------------------------------------------------------------------
// Open Design (MCP + CLI) — design-system support for front-end work
// ---------------------------------------------------------------------------

/**
 * Open Design (https://github.com/nexu-io/open-design).
 *
 * The open-source, local-first design engine that ships as skills, an `od` CLI,
 * and an MCP server consumed natively by coding agents. The Pensador uses it to
 * close the design gap that pure functional requirements leave open: instead of
 * "antd default + functional flows" (which renders as a generic admin template),
 * Open Design turns a parsed design brief into a brand-grade `DESIGN.md` design
 * system — palette, typography, spacing, layout, components, motion, voice and
 * anti-patterns — so the downstream front-end agent has an actual visual target.
 *
 * This is an OPTIONAL, front-end-conditional support (like Code Base Memory's
 * offer, but only relevant when `hasFrontend`): when the demand has a front-end
 * and the server is unavailable, the Pensador offers to install it via
 * AskUserQuestion. If declined, it degrades to an inline `DESIGN.md` written from
 * the same 9-section schema. The constant is a deterministic descriptor consumed
 * by the prose layer and the tests; the engine performs no I/O.
 */
export const OPEN_DESIGN = {
  cli: 'od',
  repo: 'https://github.com/nexu-io/open-design',
  optional: true,
  /** Only relevant when the demand has a front-end (hasFrontend). */
  relevantWhen: 'hasFrontend',
  /** Where the MCP server is typically registered, by host. */
  configFiles: {
    claudeProject: '.mcp.json',
    claudeGlobal: '~/.claude/.mcp.json',
    kiro: '.kiro/settings/mcp.json',
  },
  /**
   * How the user actually brings Open Design up when they accept the install
   * offer (made via AskUserQuestion when the demand has a front-end).
   *
   * NOTE: Open Design has NO one-line `curl | sh` installer — the old
   * `open-design.ai/install.sh` endpoint is gone (404). It is a local-first
   * daemon + web/desktop app run via Docker or a pnpm dev environment
   * (Node 24 + pnpm 10.33). `od mcp install <agent>` DOES exist and is the real
   * post-setup step that wires the daemon's stdio MCP server into the agent.
   * See https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md
   */
  installCommands: {
    /** Recommended: the repo's installer script offered via AskUserQuestion. */
    scriptWindows: 'scripts/install-open-design.ps1',
    scriptUnix: 'scripts/install-open-design.sh',
    /** What the script does under the hood (Docker — simplest, no Node toolchain). */
    docker:
      'git clone --depth 1 https://github.com/nexu-io/open-design && cd open-design/deploy && cp .env.example .env && docker compose up -d',
    /** Alternative: the pnpm dev environment, which also yields the `od` binary. */
    local:
      'git clone https://github.com/nexu-io/open-design && cd open-design && corepack enable && pnpm install && pnpm tools-dev run web',
    /** Post-setup: wire the daemon's MCP server into the agent (needs `od`). */
    mcp: 'od mcp install claude',
  },
  /**
   * Open Design does NOT synthesize a DESIGN.md from a prose brief; it curates /
   * imports DESIGN.md systems and uses them to skin generated prototypes. So the
   * Pensador drives it with these REAL verbs: list/show the curated systems (or
   * import one from a real brand/repo), pull the chosen DESIGN.md, then
   * consolidate + adapt it into <featurePath>/design-system.md.
   *
   * The `od …` forms assume the pnpm/local install (a host `od` binary). With the
   * Docker install there is no host `od`, so the same data is read straight from
   * the daemon's REST API (the endpoints the `od` verbs wrap).
   */
  commands: {
    designSystemsList: 'od design-systems list --json',
    designSystemShow: 'od design-systems show <id> --json',
    importGithub: 'od design-systems import-github <url>',
    importShadcn: 'od design-systems import-shadcn <reference>',
    mcpInstall: 'od mcp install claude',
    mcpConfigHelper: 'node scripts/od-mcp-config.mjs --config <.mcp.json> --daemon-url http://localhost:7456',
    apiDesignSystems: 'GET http://localhost:7456/api/design-systems',
    apiDesignSystemById: 'GET http://localhost:7456/api/design-systems/<id>',
    /**
     * The verbatim system files (tokens.css, components.html, …) are NOT prose —
     * pull them as files, not as a summary. Verified file-access paths, in order
     * of preference: MCP `get_file`, then the cloned repo's on-disk folder. Do NOT
     * fabricate a REST file endpoint — confirm the `/api/design-systems/<id>`
     * payload empirically before relying on it for raw file bodies.
     */
    mcpGetFile: 'get_file (Open Design MCP tool) — pulls a system file verbatim (tokens.css, components.html, …)',
    clonedSystemsDir: 'open-design/design-systems/<id>/  (filesystem source when no REST/MCP file access)',
  },
  /**
   * The verbatim artifacts every curated/imported system ships, in the official
   * USAGE.md read order (router → intent → tokens → fixtures → preview). The
   * Pensador must fetch ALL of these — not just DESIGN.md — and persist them into
   * the target repo so the front-end agent consumes tokens.css/components.html
   * DIRECTLY, never a prose re-write. `tokens.css` is the source of truth;
   * inventing tokens is forbidden by the Open Design skills protocol.
   */
  systemArtifacts: [
    'USAGE.md', // router: how to consume the package (read first)
    'DESIGN.md', // intent: 9-section prose + anti-patterns
    'tokens.css', // SOURCE OF TRUTH: compiled CSS custom properties — paste before any component CSS
    'components.html', // fixtures: real component HTML/CSS + states
    'components.manifest.json', // component inventory
    'preview/',          // visual sanity-check dir — contents vary by system (colors.html / spacing.html / typography.html / …)
  ],
  /** Where the verbatim system files are persisted in the target repo. */
  systemsDir: 'packages/ui/design-systems',
  /**
   * The 9-section DESIGN.md schema Open Design uses as the brand contract. Every
   * section the Pensador parses from the design brief maps onto one of these.
   */
  designSchema: [
    'color',
    'typography',
    'spacing',
    'layout',
    'components',
    'motion',
    'voice',
    'brand',
    'anti-patterns',
  ],
  /** Final design-system artifact written under <featurePath>/ in PRD mode. */
  designSystemFile: 'design-system.md',
};

/**
 * Builds the path of the design-system artifact (DESIGN.md) inside the update
 * directory. This is a FINAL artifact (it IS part of buildArtifactList in PRD
 * mode when the demand has a front-end).
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function designSystemArtifactPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${OPEN_DESIGN.designSystemFile}`;
}

/**
 * Returns the ordered design-brief dimensions the Pensador must parse (via
 * AskUserQuestion when not inferable) before driving Open Design. Feeding all of
 * these to Open Design is what guarantees a brand-grade result instead of a flat
 * default theme. Pure and total: same input → same output, never throws.
 *
 * @returns {string[]}
 */
export function openDesignBriefPlan() {
  return [
    'visualTone',        // ex.: "clean azul/grafite tipo Linear/Vercel", "vibrante"
    'brandReferences',   // produtos/sites de referência ou identidade existente
    'colorPalette',      // cor de marca, neutros, semânticas (sucesso/erro/aviso)
    'typography',        // famílias, escala, pesos
    'componentStates',   // default/hover/focus/active/disabled/loading/vazio/erro
    'responsiveness',    // breakpoints, grid, densidade
    'accessibility',     // contraste, foco, leitura de tela, alvo WCAG
    'microcopy',         // voz/tom de textos, mensagens de estado
  ];
}

/**
 * Routes each design-brief dimension (collected via AskUserQuestion) to WHERE it
 * acts on Open Design — instead of dissolving every answer into the prose of
 * design-system.md, which is what produced a flat theme. There are four
 * destinations, not one:
 *
 *  - 'selection'  → picks/imports the curated system (and its `theme` enum input).
 *  - 'input'      → typed `od.inputs` of the generation skill (content/components).
 *  - 'parameter'  → tweakable `od.parameters` sliders (hue, spacing, opacity).
 *  - 'constraint' → a validation gate over the output (e.g. WCAG AA contrast).
 *
 * A user answer that MATCHES the chosen system becomes an input/parameter; one
 * that CONFLICTS becomes a documented override in design-system.md — never a new
 * invented token (forbidden by the Open Design skills protocol). Pure and total:
 * same input → same output, never throws, no I/O.
 *
 * @returns {Record<string, 'selection'|'input'|'parameter'|'constraint'>}
 */
export function openDesignBriefRouting() {
  return {
    visualTone: 'selection',      // casa o system curado mais próximo + `theme` enum
    brandReferences: 'selection', // marca real citada → import-github do system
    colorPalette: 'parameter',    // accent_hue / accent_strength sobre o token
    typography: 'parameter',      // escala/família (section override quando conflita)
    componentStates: 'input',     // estados exigidos, validados vs components.html
    responsiveness: 'parameter',  // section_spacing / densidade
    accessibility: 'constraint',  // gate WCAG (contraste AA) sobre o output
    microcopy: 'input',           // tagline + copy das seções + CTAs
  };
}

/**
 * Plans the verbatim system files to fetch from Open Design and where each lands
 * in the target repo, so the front-end agent consumes tokens.css/components.html
 * directly. This is a deterministic descriptor — the engine performs NO I/O; the
 * skill/LLM layer (MCP `get_file` or the cloned repo) does the actual fetch.
 *
 * `tokens.css` and `DESIGN.md` are marked required (a system is unusable without
 * them); the rest are best-effort. Pure and total: same input → same output.
 *
 * @param {string[]|null|undefined} systemIds  selected/imported system slugs
 * @param {string} [uiPackageDir='packages/ui']  the design-system package root
 * @returns {{ id: string, destDir: string, files: { source: string, dest: string, required: boolean }[] }[]}
 */
export function openDesignFetchPlan(systemIds, uiPackageDir = 'packages/ui') {
  const ids = Array.isArray(systemIds) ? systemIds.filter(Boolean) : [];
  const base = `${String(uiPackageDir).replace(/\/+$/, '')}/design-systems`;
  const required = new Set(['tokens.css', 'DESIGN.md']);
  return ids.map((id) => ({
    id,
    destDir: `${base}/${id}/`,
    files: OPEN_DESIGN.systemArtifacts.map((source) => ({
      source,
      dest: `${base}/${id}/${source}`,
      required: required.has(source),
    })),
  }));
}

/**
 * Open Design applies whenever the demand has a front-end — in BOTH artifact
 * modes. The verbatim system files (tokens.css, components.html, …) are always
 * persisted to the repo (`systemsDir`), mode-independent. What changes per mode
 * is WHERE the design decisions and the design-system requirements are written:
 *
 *  - PRD mode  → a standalone `design-system.md` (decisions + 9-section schema).
 *  - Spec mode → folded into the OpenSpec change: decisions go into `design.md`
 *    (Decisions section) and the UI design-system requirements become a delta
 *    spec capability `specs/ui-design-system/spec.md` (normative SHALL/Scenario
 *    form: use tokens.css, never invent tokens, accent ≤ 2×, WCAG AA). The
 *    Pensador does NOT hand-write these — it feeds the `openspec-*` commands.
 *
 * This is why `planArtifacts` keeps `designSystem: false` in spec mode: there is
 * no standalone file, but Open Design still runs. Pure and total.
 *
 * @param {'prd'|'spec'|undefined} artifactMode
 * @param {string} [changeName='<name>']  the OpenSpec change folder name
 * @returns {{ mode: 'prd'|'spec', systemsDir: string, standaloneArtifact: boolean, decisionsDoc: string, requirementsDoc: string }}
 */
export function openDesignDeliveryFor(artifactMode, changeName = '<name>') {
  const spec = resolveArtifactMode(artifactMode) === 'spec';
  const changeDir = `openspec/changes/${changeName}`;
  return {
    mode: spec ? 'spec' : 'prd',
    // Verbatim system files land in the repo in BOTH modes.
    systemsDir: OPEN_DESIGN.systemsDir,
    // A standalone design-system.md exists only in PRD mode.
    standaloneArtifact: !spec,
    // Where the design DECISIONS (selection, merge, justified overrides) are written.
    decisionsDoc: spec ? `${changeDir}/design.md` : OPEN_DESIGN.designSystemFile,
    // Where the UI design-system REQUIREMENTS live.
    requirementsDoc: spec
      ? `${changeDir}/specs/ui-design-system/spec.md`
      : OPEN_DESIGN.designSystemFile,
  };
}

// ---------------------------------------------------------------------------
// Project classification & fullstack detection
// ---------------------------------------------------------------------------

/**
 * Classifies a set of consolidated requirements by the layers they mention.
 * Deterministic and total: same input → same result, never throws.
 *
 * NOTE: this is a keyword heuristic to *signal* relevance of the BACKEND /
 * UIUX / FRONTEND brainstorm stages and to gate the comunication_json artifact.
 * It is intentionally conservative; the Pensador confirms project nature with
 * the user (via AskUserQuestion) when the signal is ambiguous.
 *
 * @param {Requirement[]} requirements
 * @returns {{ hasBackend: boolean, hasFrontend: boolean, isFullstack: boolean }}
 */
export function classifyProject(requirements) {
  const combined = (requirements ?? []).map((r) => r.text).join(' ').toLowerCase();
  const hasBackend =
    /\b(api|back[\s-]?end|servidor|server|endpoint|banco de dados|database|rest|graphql|webhook|micro[\s-]?servi[çc]o|fila|queue|autentica[çc][ãa]o|persist[êe]ncia)\b/.test(
      combined
    );
  const hasFrontend =
    /\b(front[\s-]?end|tela|interface|ui|ux|componente|component|web|mobile|app|cliente|layout|p[áa]gina|design|responsiv)\b/.test(
      combined
    );
  return { hasBackend, hasFrontend, isFullstack: hasBackend && hasFrontend };
}

/**
 * Determines whether a set of consolidated requirements represents a
 * fullstack project (back-end + front-end with inter-layer data exchange).
 *
 * @param {Requirement[]} requirements
 * @returns {boolean}
 */
export function isFullstack(requirements) {
  return classifyProject(requirements).isFullstack;
}

/**
 * An activity is *front-end-specific* when it has a front-end and no back-end.
 * Codex (the technical sweep) does not participate in such activities.
 *
 * Accepts either raw signals ({ hasBackend, hasFrontend }) or the result of
 * classifyProject — both expose the same boolean fields.
 *
 * @param {{ hasBackend?: boolean, hasFrontend?: boolean }} signals
 * @returns {boolean}
 */
export function isFrontendOnly(signals = {}) {
  return signals?.hasFrontend === true && signals?.hasBackend !== true;
}

/**
 * Decides whether Codex participates in the flow for a given classification.
 *
 * Codex is excluded from a front-end-specific activity (front-end, no back-end):
 *   - In BRAINSTORM_GERAL the backend domain is already gated on hasBackend, so a
 *     front-end-only run never reaches Codex there.
 *   - In the CODEX stage this is the gate: when false, the stage is still visited
 *     but yields zero questions and auto-advances.
 *
 * @param {{ hasBackend?: boolean, hasFrontend?: boolean }} signals
 * @returns {boolean}
 */
export function codexParticipates(signals = {}) {
  return !isFrontendOnly(signals);
}

// ---------------------------------------------------------------------------
// Artifact planning
// ---------------------------------------------------------------------------

/**
 * Plans which artifacts should be generated.
 * Returns an empty plan when not in FINAL or DONE stage (gate enforcement).
 *
 * In PRD mode (default) it plans prd.md + userhistory.md (+ comunication_json.md
 * when back-end). In spec mode (artifactMode === 'spec', OpenSpec) it plans ONLY
 * the change set (proposal/design/tasks/specs) — userhistory and comunication do
 * not apply.
 *
 * The comunication_json artifact documents the API/communication contract
 * (endpoints, request/response schemas, error codes). That contract is valuable
 * whenever a back-end exists — both for a fullstack front↔back boundary and for a
 * back-end-only API consumed by external clients — so it is gated on hasBackend,
 * not strictly on isFullstack.
 *
 * @param {StageState} state
 * @returns {ArtifactPlan}
 */
export function planArtifacts(state) {
  const finalStages = new Set(['FINAL', 'DONE']);
  const empty = {
    prd: false,
    userhistory: false,
    comunication: false,
    designSystem: false,
    proposal: false,
    specs: false,
    design: false,
    tasks: false,
  };
  if (!finalStages.has(state.currentStage)) {
    return empty;
  }

  const spec = resolveArtifactMode(state.artifactMode) === 'spec';
  const { hasBackend, hasFrontend } = classifyProject(state.consolidated);

  if (spec) {
    // Spec mode delivers ONLY the OpenSpec change set (scaffolded by the
    // openspec-* commands). userhistory.md and comunication_json.md do not apply.
    // Open Design STILL runs when hasFrontend (see openDesignDeliveryFor): the
    // verbatim system files go to the repo, decisions fold into design.md, and
    // the UI requirements become a `ui-design-system` delta spec — so there is
    // no standalone design-system.md here (designSystem: false), by design.
    return {
      prd: false,
      proposal: true,
      specs: true,
      design: true,
      tasks: true,
      userhistory: false,
      comunication: false,
      designSystem: false,
    };
  }

  return {
    prd: true,
    proposal: false,
    specs: false,
    design: false,
    tasks: false,
    userhistory: true,
    comunication: hasBackend,
    // The design-system artifact (DESIGN.md, produced via Open Design) is planned
    // whenever the demand has a front-end — that is the layer the bare functional
    // PRD leaves unspecified.
    designSystem: hasFrontend,
  };
}

/**
 * Builds the list of Artifact objects to be generated.
 * In PRD mode includes prd + userhistory (+ comunication when back-end). In spec
 * mode (OpenSpec) it returns ONLY the change set (proposal/design/tasks/specs)
 * under openspec/changes/<name>/, scaffolded by the openspec-* commands — no
 * prd/userhistory/comunication. Every artifact has a filename consistent with its
 * kind and a non-empty path.
 *
 * @param {StageState} state
 * @returns {Artifact[]}
 */
export function buildArtifactList(state) {
  const plan = planArtifacts(state);
  // PRD-mode artifacts are written directly inside the update directory
  // (.pensador/<slug-da-demanda>-vN/) so a /pensador run never clobbers a pre-existing prd.md
  // (or sibling) at the project root. The LLM still confirms before overwriting
  // a file that already exists in here.
  const basePath = state.featurePath
    ? `${state.featurePath}/`
    : '.pensador/atualizacao-v1/';

  // Spec-mode artifacts live under the project's OpenSpec tree and are scaffolded
  // by the openspec-* commands (the Pensador never hand-writes them).
  const changeDir = openspecChangeDir(state.featurePath);

  /** @type {Artifact[]} */
  const artifacts = [];

  if (plan.prd) {
    artifacts.push({
      kind: 'prd',
      filename: 'prd.md',
      path: `${basePath}prd.md`,
    });
  }

  // OpenSpec (spec mode) change set — created via the openspec-* commands under
  // openspec/changes/<name>/, replacing prd.md as the base deliverable.
  if (plan.proposal) {
    artifacts.push({
      kind: 'proposal',
      filename: 'proposal.md',
      path: `${changeDir}/proposal.md`,
      managedBy: 'openspec',
    });
  }

  if (plan.design) {
    artifacts.push({
      kind: 'design',
      filename: 'design.md',
      path: `${changeDir}/design.md`,
      managedBy: 'openspec',
    });
  }

  if (plan.tasks) {
    artifacts.push({
      kind: 'tasks',
      filename: 'tasks.md',
      path: `${changeDir}/tasks.md`,
      managedBy: 'openspec',
    });
  }

  if (plan.specs) {
    artifacts.push({
      kind: 'specs',
      filename: 'specs/',
      path: `${changeDir}/specs/`,
      managedBy: 'openspec',
    });
  }

  if (plan.userhistory) {
    artifacts.push({
      kind: 'userhistory',
      filename: 'userhistory.md',
      path: `${basePath}userhistory.md`,
    });
  }

  if (plan.comunication) {
    artifacts.push({
      kind: 'comunication',
      // Deliberate spelling — matches the user-requested filename, do NOT "fix" to "communication".
      filename: 'comunication_json.md',
      path: `${basePath}comunication_json.md`,
    });
  }

  if (plan.designSystem) {
    artifacts.push({
      kind: 'design-system',
      filename: OPEN_DESIGN.designSystemFile,
      path: `${basePath}${OPEN_DESIGN.designSystemFile}`,
    });
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// PRD base scaffold
// ---------------------------------------------------------------------------

/**
 * Builds the initial PRD scaffold (PRD_BASE stage) from a user demand and the
 * list of required sections defined by the Strict_PRD_Schema.
 *
 * Rules:
 *  - Every section in `requiredSections` is guaranteed to appear as a key in
 *    the returned `PrdDocument.sections`.
 *  - Sections are set to exactly `"TBD"` as a placeholder.
 *  - The function is pure: same inputs → same output, no I/O, no side effects.
 *
 * Note: actual content derivation (replacing "TBD" with inferred text) is the
 * responsibility of the LLM skill layer, which interprets the demanda. The
 * Engine's job here is only to ensure structural completeness — every required
 * section is always present.
 *
 * @param {string | null | undefined} demanda - The user's demand in natural language.
 * @param {string[]} requiredSections - Ordered list of section names from the
 *   Strict_PRD_Schema (e.g. ['Visão Geral', 'Problema', ...]).
 * @returns {PrdDocument}
 */
export function buildPrdBase(demanda, requiredSections) {
  const sections = {};

  for (const section of requiredSections) {
    sections[section] = 'TBD';
  }

  return { sections };
}

// ---------------------------------------------------------------------------
// User history builder
// ---------------------------------------------------------------------------

/**
 * Builds a sequential list of JourneyStep objects from a set of interactions.
 * The order values form a contiguous strictly increasing sequence starting at 1.
 *
 * @param {Requirement[]} requirements
 * @returns {JourneyStep[]}
 */
export function buildUserHistory(requirements) {
  return requirements.map((req, index) => ({
    order: index + 1,
    interaction: req.text,
  }));
}

// ---------------------------------------------------------------------------
// Dialogue dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatches a question to the user by assigning the ASK_USER_QUESTION channel.
 * The channel is always ASK_USER_QUESTION regardless of the question's origin
 * (pensador | requirements-clarity | backend-development | ui-ux-pro-max |
 * frontend-design | codex | agy), including fallback questions.
 *
 * @param {Question} question
 * @returns {Question}
 */
export function dispatchQuestion(question) {
  return {
    ...question,
    channel: ASK_USER_QUESTION,
  };
}

// ---------------------------------------------------------------------------
// State persistence (checkpoint / resume)
// ---------------------------------------------------------------------------

/**
 * Schema version for the serialized checkpoint. Bump when the StageState shape
 * changes incompatibly so deserializeState can reject stale checkpoints.
 */
export const CHECKPOINT_VERSION = 2;

/**
 * Serializes a StageState to a JSON string suitable for writing to a checkpoint
 * file (e.g. .pensador/<slug-da-demanda>-vN/.pensador-progress.json), enabling a /pensador run
 * to be resumed after an interruption.
 *
 * StageState is already plain/JSON-able; this wraps it with a version tag and a
 * timestamp. Pure: no I/O — the caller owns reading/writing the file.
 *
 * @param {StageState} state
 * @returns {string}
 */
export function serializeState(state) {
  return JSON.stringify(
    { version: CHECKPOINT_VERSION, savedAt: new Date().toISOString(), state },
    null,
    2
  );
}

/**
 * Parses a checkpoint string produced by serializeState back into a StageState.
 * Returns null (never throws) when the input is absent, malformed, or carries an
 * incompatible version — the caller then starts a fresh flow.
 *
 * @param {string | null | undefined} serialized
 * @returns {StageState | null}
 */
export function deserializeState(serialized) {
  if (typeof serialized !== 'string' || serialized.trim() === '') return null;

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!parsed || parsed.version !== CHECKPOINT_VERSION) return null;

  const { state } = parsed;
  // Minimal structural validation — enough to trust the resume target.
  if (
    !state ||
    typeof state.currentStage !== 'string' ||
    !STAGE_ORDER.includes(state.currentStage) ||
    !Array.isArray(state.questions) ||
    !Array.isArray(state.consolidated)
  ) {
    return null;
  }

  return state;
}

// ---------------------------------------------------------------------------
// JSDoc type definitions (for IDE support — not runtime types)
// ---------------------------------------------------------------------------

/**
 * @typedef {'INIT'|'EXPLORE'|'PRD_BASE'|'ARCH'|'EXPAND'|'COMPLEXITY'|'BRAINSTORM_GERAL'|'CODEX'|'AGY'|'FINAL'|'DONE'} Stage
 */

/**
 * @typedef {'pensador'|'requirements-clarity'|'backend-development'|'ui-ux-pro-max'|'frontend-design'|'codex'|'agy'} Origin
 */

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {Stage} stage
 * @property {Origin} origin
 * @property {string} text
 * @property {string[]} [options]
 * @property {string|null} answer
 * @property {'ASK_USER_QUESTION'} channel
 */

/**
 * @typedef {Object} Requirement
 * @property {string} id
 * @property {string} source           // originating stage, lowercased
 * @property {string} text
 * @property {Origin} [origin]
 * @property {boolean} [resolvesGap]   // true when origin is a brainstorm skill / Codex / AGY
 */

/**
 * @typedef {Object} PrdDocument
 * @property {{ [sectionName: string]: string }} sections
 */

/**
 * @typedef {Object} StageState
 * @property {string|null} demanda
 * @property {boolean} needsDemanda
 * @property {Stage} currentStage
 * @property {Question[]} questions
 * @property {PrdDocument} prdBase
 * @property {Requirement[]} consolidated
 * @property {string|null} [featurePath] // .pensador/<slug-da-demanda>-vN - set after update-dir allocation
 * @property {'prd'|'spec'} [artifactMode] // output mode: 'prd' (default) or 'spec' (OpenSpec)
 */

/**
 * @typedef {Object} ArtifactPlan
 * @property {boolean} prd
 * @property {boolean} userhistory
 * @property {boolean} comunication
 * @property {boolean} [designSystem] // design-system.md (Open Design) when hasFrontend, PRD mode
 * @property {boolean} [proposal]  // OpenSpec (spec mode)
 * @property {boolean} [specs]     // OpenSpec (spec mode)
 * @property {boolean} [design]    // OpenSpec (spec mode)
 * @property {boolean} [tasks]     // OpenSpec (spec mode)
 */

/**
 * @typedef {Object} Artifact
 * @property {'prd'|'comunication'|'userhistory'|'design-system'|'proposal'|'specs'|'design'|'tasks'} kind
 * @property {'prd.md'|'comunication_json.md'|'userhistory.md'|'design-system.md'|'proposal.md'|'specs/'|'design.md'|'tasks.md'} filename
 * @property {string} path
 * @property {'openspec'} [managedBy] // present when the artifact is scaffolded by the openspec-* commands
 */

/**
 * @typedef {Object} JourneyStep
 * @property {number} order
 * @property {string} interaction
 */


/**
 * @typedef {Object} ComplexitySignals
 * @property {number} [domainCount]
 * @property {boolean} [hasBackend]
 * @property {boolean} [hasBroadScopeKeywords]
 * @property {boolean} [isGreenfield]
 */

/**
 * @typedef {Object} ComplexityResult
 * @property {number} score
 * @property {'Lite'|'Completo'} mode
 */

/**
 * @typedef {Object} FeatureDirResult
 * @property {string} featureDir
 * @property {boolean} isResume
 * @property {string} slug
 */
