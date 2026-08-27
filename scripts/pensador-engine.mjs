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
 * Funnel: generate → explore (Code Base Memory) → research (web/market benchmark) →
 * base (PRD/Spec) → architecture → expand → clarify → domain deep-dives →
 * technical sweep (Codex) → product sweep (AGY) → consolidate.
 */
export const STAGE_ORDER = [
  'INIT',
  'EXPLORE',
  'RESEARCH',
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
 * Stages that produce consolidated requirements. RESEARCH is included because the
 * market benchmark turns competitor features into scope decisions the user answers
 * (in/out of scope), which are requirements like any other. Used by consolidate().
 */
export const REQUIREMENT_STAGES = ['RESEARCH', 'EXPAND', 'BRAINSTORM_GERAL', 'CODEX', 'AGY'];

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
    // Each domain now exposes a PRIMARY lens plus an ordered `lenses` array.
    // v2.6 promotion:
    //   - backend: the `backend-development` skill is the PRIMARY lens (a
    //     deterministic engineering checklist that ALWAYS runs when hasBackend),
    //     with Codex kept as the `refine` lens on top of it.
    //   - design: `ui-ux-pro-max` + `frontend-design` are PRIMARY lenses that
    //     feed the Open Design engine (`open-design`, role `design-engine`), with
    //     AGY kept as the `refine` lens. The old `uiux` key is now `design`.
    // The domain-level `ref`/`kind`/`origin` mirror the PRIMARY lens so callers
    // that only read the primary still work; `lenses` carries the full pipeline.
    domains: {
      requirements: {
        kind: 'skill',
        ref: 'requirements-clarity',
        origin: 'requirements-clarity',
        relevantWhen: 'always',
        lenses: [
          { kind: 'skill', ref: 'requirements-clarity', origin: 'requirements-clarity', role: 'primary' },
        ],
      },
      backend: {
        kind: 'skill',
        ref: 'backend-development',
        origin: 'backend-development',
        relevantWhen: 'hasBackend',
        lenses: [
          { kind: 'skill', ref: 'backend-development', origin: 'backend-development', role: 'primary' },
          { kind: 'subagent', ref: 'codex:codex-rescue', origin: 'codex', param: '--effort high', role: 'refine', relevantWhen: 'hasBackend' },
        ],
      },
      design: {
        kind: 'skill',
        ref: 'ui-ux-pro-max',
        origin: 'ui-ux-pro-max',
        relevantWhen: 'hasFrontend',
        lenses: [
          { kind: 'skill', ref: 'ui-ux-pro-max', origin: 'ui-ux-pro-max', role: 'primary' },
          { kind: 'skill', ref: 'frontend-design', origin: 'frontend-design', role: 'primary' },
          { kind: 'tool', ref: 'open-design', origin: 'open-design', role: 'design-engine', relevantWhen: 'hasFrontend' },
          { kind: 'subagent', ref: 'cc-antigravity-plugin:antigravity-agent', origin: 'agy', param: '--model gemini-3.1-pro-high', role: 'refine', relevantWhen: 'hasFrontend' },
        ],
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
export const GAP_ORIGINS = ['web-research', 'requirements-clarity', 'backend-development', 'ui-ux-pro-max', 'frontend-design', 'codex', 'agy'];

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
 * Final artifacts (prd.md, userhistory.md, communication.md) live directly
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
    // Spec mode only: true when the change does not alter any spec (pure
    // infra/tooling/doc change) — mirrors OpenSpec's `skip_specs: true` /
    // `openspec archive --skip-specs`. Drops the specs/ artifact from the plan.
    skipSpecs: false,
    // RESEARCH: product category detected from the demand (detectProductArchetype),
    // confirmed with the user, and used to drive the web/market benchmark.
    productArchetype: DEFAULT_PRODUCT_ARCHETYPE,
    // Business sector/industry ("oficina automotiva", "clínica odontológica").
    // Collected FIRST in RESEARCH: it seeds the search queries, the domain
    // vocabulary and, later, the Open Design brief + imagery pipeline.
    sectorContext: null,
    // RESEARCH outcome: competitors, feature inventory, sources and the reusable
    // Prompt System injected into every downstream prompt (see withMarketResearch).
    marketResearch: null,
    // RESEARCH technical track: technologies detected in the demand / existing code
    // (detectTechStack). Drives the technical query plan and the ARCH top-up.
    techStack: [],
    // Researched CURRENT versions, patterns, conventions and anti-patterns of the
    // stack (see withTechResearch). Status may be DEFERRED when ARCH resolves the stack.
    techResearch: null,
    // Open Design: system ids chosen at BRAINSTORM_GERAL. buildArtifactList
    // reads this to emit design-system-files entries for the handoff. Must be
    // set by the LLM when hasFrontend and a system is selected; empty array
    // means no verbatim files are planned (inline fallback or no OD).
    designSystems: [],
    // Target UI package where the executor will MATERIALIZE the verbatim system
    // files during implementation (packages/ui monorepo / src/styles single-app).
    // The Pensador itself persists the files under <featurePath>/design-systems/
    // (see designSystemFilesRoot) — this is only the downstream materialization hint.
    uiPackageDir: 'packages/ui',
    // API/communication contract style detected in ARCH. Selects the
    // machine-readable contract format (openapi.yaml / schema.graphql /
    // service.proto / asyncapi.yaml) that is the SOURCE OF TRUTH when hasBackend.
    // communication.md is the human-readable view derived from it.
    apiStyle: DEFAULT_API_STYLE,
    // Whether ARCH found no relevant existing codebase to build on. null until
    // ARCH resolves it (unknown at INIT/EXPLORE time); false is the common case
    // (brownfield — building on an existing project). Feeds detectComplexity()
    // AND travels downstream via project-baseline.json (see withGreenfieldSignal)
    // so the Orchestrador/Executor do not have to re-derive it independently.
    isGreenfield: null,
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
 * (RESEARCH, EXPAND, BRAINSTORM_GERAL, CODEX, AGY) into Requirement objects.
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
 * computed but never stored, leaving communication never planned.)
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
// Execution modes (--mode)
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
 * throws. Unknown `--mode <x>` falls back to the default mode with
 * `modeValid: false` so the caller can warn the user.
 *
 * The flag is `--mode`; `--modo` is kept as a silent legacy alias. Both accept
 * `--mode agy` and `--mode=agy` (case-insensitive value).
 *
 * The `mode|modo` alternation cannot swallow `--model`: the mandatory `=`/space
 * separator fails on the `l`, so `--model x` falls through to its own extractor
 * regardless of the order the two flags appear in.
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

  const requestedRaw = extract(/(^|\s)--(?:mode|modo)(?:=|\s+)([a-zA-Z]+)/);
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
  /**
   * Snapshot written under <featurePath>/. Consumed by PRD_BASE/Spec and ARCH
   * during the run, AND emitted as a handoff artifact (role `codebase-memory`,
   * see buildArtifactList) — the Orchestrador/Executor need the discovered
   * code map (symbols, call chains, existing API contract baseline) as much as
   * the LLM authoring the PRD does; re-deriving it from scratch downstream
   * would silently drop the brownfield exploration this stage exists for.
   */
  snapshotFile: 'codebase-memory.md',
};

/**
 * Builds the path of the Code Base Memory exploration snapshot inside the update
 * directory. Consumed by PRD_BASE/Spec and ARCH during the run, and emitted as
 * a handoff artifact by buildArtifactList (role `codebase-memory`).
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function codebaseMemorySnapshotPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${CODEBASE_MEMORY.snapshotFile}`;
}

/** Filename of the ARCH-stage architecture snapshot, written under <featurePath>/. */
export const ARCHITECTURE_SNAPSHOT_FILE = 'architecture.md';

/**
 * Builds the path of the ARCH-stage architecture snapshot inside the update
 * directory. Consumed downstream by EXPAND/COMPLEXITY during the run, and
 * emitted as a handoff artifact by buildArtifactList (role `architecture`) —
 * it carries the discovered domains, known decisions, researched technical
 * baseline and, in brownfield, the conventions the Orchestrador/Executor are
 * expected to preserve (see WORKFLOW.md's brownfield precedence rule).
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function architectureSnapshotPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${ARCHITECTURE_SNAPSHOT_FILE}`;
}

/** Filename of the machine-readable project baseline emitted at FINAL. */
export const PROJECT_BASELINE_FILE = 'project-baseline.json';

/**
 * Builds the path of the machine-readable project baseline artifact (role
 * `project-baseline`) inside the update directory. Unlike architecture.md/
 * codebase-memory.md (LLM-authored prose), this file is a small structured
 * summary the Orchestrador/Executor can parse directly instead of re-deriving
 * isGreenfield/stack/apiStyle/uiPackageDir from scratch — see
 * buildProjectBaseline().
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function projectBaselinePath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${PROJECT_BASELINE_FILE}`;
}

/** Filename of the RF/CA requirements index emitted at FINAL (PRD mode only). */
export const REQUIREMENTS_INDEX_FILE = 'requirements.json';

/**
 * Builds the path of the requirements index artifact (role
 * `requirements-index`) inside the update directory. PRD mode only — see
 * `scripts/lib/requirements-extractor.mjs` for how its content is derived
 * from the PRD's own RF/CA tables (section 6 + 14).
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function requirementsIndexPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${REQUIREMENTS_INDEX_FILE}`;
}

/**
 * @typedef {Object} ProjectBaseline
 * @property {boolean|null} isGreenfield
 * @property {string[]} techStack
 * @property {'rest'|'graphql'|'grpc'|'events'} apiStyle
 * @property {string} uiPackageDir
 * @property {string[]} existingApiContractGlobs // contractDiscoveryGlobs(), for the consumer to re-run the same discovery
 */

/**
 * Builds the machine-readable content of project-baseline.json (role
 * `project-baseline`). Unlike architecture.md/codebase-memory.md (LLM-authored
 * prose consumed by re-reading), this is a small structured summary so the
 * Orchestrador/Executor can branch on isGreenfield/techStack/apiStyle without
 * parsing prose — see the `project-baseline` role in handoff-contract.md §5.
 *
 * `isGreenfield: null` means ARCH has not resolved the signal yet (should not
 * happen once FINAL is reached in a well-formed run; kept null rather than
 * defaulted to false/true so a consumer can tell "unknown" from "resolved
 * brownfield/greenfield" and degrade explicitly instead of assuming).
 *
 * @param {StageState} state
 * @returns {ProjectBaseline}
 */
export function buildProjectBaseline(state) {
  return {
    isGreenfield: state.isGreenfield ?? null,
    techStack: Array.isArray(state.techStack) ? [...state.techStack] : [],
    apiStyle: state.apiStyle ?? DEFAULT_API_STYLE,
    uiPackageDir: state.uiPackageDir ?? 'packages/ui',
    existingApiContractGlobs: contractDiscoveryGlobs(),
  };
}

/**
 * Returns the canonical ordered sequence of Code Base Memory tool calls the
 * Pensador uses to explore a project before generating the PRD/Spec base.
 *
 * `index_status` is always first: it is a read-only gate that decides whether
 * `index_repository` — a full repository scan — is actually needed, and that
 * decision belongs to the user (AskUserQuestion), never fired automatically.
 * `index_repository` still appears in the deterministic sequence because this
 * function describes the canonical tool order, not a conditional executor;
 * the gate itself is documented prose (references/codebase-memory.md), not
 * something this pure function encodes.
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
    t.indexStatus,
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
// Web / market research (RESEARCH stage) — outside-in business context
// ---------------------------------------------------------------------------

/**
 * RESEARCH is the mirror image of EXPLORE: EXPLORE looks INWARD (the codebase via
 * Code Base Memory), RESEARCH looks OUTWARD (the market via WebSearch/WebFetch).
 *
 * Why it exists: the demand that reaches the Pensador is usually a *category* of
 * product that already has thousands of shipped implementations — a commercial
 * site for a company, a landing page for a service provider, a SaaS, a CRM. The
 * category's table-stakes feature set is public knowledge. Drafting the PRD/Spec
 * without reading it means re-deriving from scratch what the market already
 * settled, and shipping a product that is missing the obvious.
 *
 * So before PRD_BASE, the Pensador researches the web to answer three questions:
 *   1. Which archetype + sector is this? (detectProductArchetype + sectorContext)
 *   2. What do the competitors/references actually ship? (feature inventory)
 *   3. Which of those are table-stakes vs differentiators vs anti-features?
 *
 * The output is TWO reusable things (see PROMPT_SYSTEM_SECTIONS):
 *   - a feature inventory that seeds the PRD's scope/functional requirements and
 *     becomes explicit in/out-of-scope questions in RESEARCH and EXPAND;
 *   - a **Prompt System**: the domain-context block that is injected verbatim into
 *     every downstream prompt (context-pack.md, each delegated unit of work in a
 *     delegating --mode, the Open Design brief, the handoff), so every lens
 *     reasons with the same researched business context instead of a generic one.
 *
 * The constant is a deterministic descriptor consumed by the prose layer and the
 * tests; the engine performs no I/O.
 */
export const WEB_RESEARCH = {
  stage: 'RESEARCH',
  track: 'business',
  /**
   * The RESEARCH stage runs TWO tracks. This descriptor covers the business one;
   * the technical one is TECH_RESEARCH (current stack patterns/architecture/
   * conventions). Both write their own snapshot and both feed the Prompt System.
   */
  tracks: ['business', 'technical'],
  /** Mandatory whenever the demand has a product surface (see researchRelevance). */
  mandatory: true,
  relevantWhen: 'hasProductSurface',
  /** Claude Code tool names used to perform the research. */
  tools: {
    search: 'WebSearch',
    fetch: 'WebFetch',
  },
  /**
   * Query/fetch budget. RESEARCH runs BEFORE COMPLEXITY, so depth is not the
   * Lite/Completo flow mode — it comes from researchRelevance(), which reads the
   * breadth signals directly from the demand.
   */
  budget: {
    liteQueries: 4,
    completoQueries: 8,
    maxFetchPerQuery: 2,
    maxCompetitors: 5,
    minCompetitors: 3,
  },
  /**
   * Source quality tiers, best first. A feature may only be recorded as
   * `table-stakes` when it is corroborated by at least `minSourcesPerClaim`
   * INDEPENDENT sources — a single blog post is an opinion, not a market signal.
   */
  sourceTiers: [
    'official',    // tier 1: the competitor's own product/docs/pricing pages
    'comparison',  // tier 2: G2 / Capterra / TrustRadius / curated comparisons
    'community',   // tier 3: blogs, forums, Reddit, changelogs, release notes
  ],
  minSourcesPerClaim: 2,
  /**
   * Content compliance — non-negotiable. The research produces an analysis, never
   * a copy. Violating any of these turns a benchmark into plagiarism.
   */
  compliance: [
    'cite-source-url',            // every recorded finding carries its source URL
    'max-30-consecutive-words',   // never reproduce more than 30 words in a row
    'paraphrase-not-quote',       // summarize/rephrase; preserve meaning
    'no-proprietary-assets',      // never copy logos, imagery, brand copy or code
    'no-trademark-imitation',     // reference a brand's *patterns*, not its identity
  ],
  /** Working snapshot written under <featurePath>/ (not a final artifact). */
  snapshotFile: 'market-research.md',
  /** Where the researched Prompt System is reused downstream. */
  promptSystemConsumers: [
    'prd-base',        // PRD_BASE: scope, functional requirements, personas
    'expand',          // EXPAND: candidate requirements from the feature inventory
    'context-pack',    // BRAINSTORM_GERAL: shared-agents/context-pack.md
    'delegation',      // delegating --mode: prepended to every delegated prompt
    'open-design',     // design brief: sectorContext + brandReferences
    'handoff',         // recap/handoff: the benchmark behind the scope decisions
  ],
};

/**
 * Ordered sections of the reusable **Prompt System** produced by RESEARCH: the
 * researched context, packaged once and injected verbatim into every downstream
 * prompt so a lens/agent never has to re-infer the domain or the stack.
 *
 * It spans BOTH research tracks — the business group (what the product category
 * ships) and the technical group (how this stack is built today). A consumer that
 * only needs one side injects the group instead of the whole block; see
 * PROMPT_SYSTEM_SECTION_GROUPS.
 */
export const PROMPT_SYSTEM_SECTIONS = [
  // --- business track (WEB_RESEARCH) ---
  'businessContext',       // what the business does, sector, audience, jargon
  'productArchetype',      // the detected category + why
  'marketBaseline',        // table-stakes features the category always ships
  'competitorFeatures',    // per-competitor inventory with source URLs
  'differentiators',       // the wedge: what this product does that others do not
  'antiFeatures',          // common in the market and deliberately rejected here
  'domainVocabulary',      // the sector's real terms, used in UI copy and models
  'complianceNotes',       // sector-specific legal/regulatory constraints found
  // --- technical track (TECH_RESEARCH) ---
  'techStack',             // the stack + the CURRENT stable version of each part
  'architectureBaseline',  // idiomatic project structure and architecture patterns
  'designPatterns',        // the patterns the ecosystem recommends today
  'codingConventions',     // naming, lint/format, file layout the Executor must follow
  'securityBaseline',      // researched auth/authz and data-protection patterns
  'testingBaseline',       // test levels and the ecosystem's default tooling
  'technicalAntiPatterns', // what the docs now DISCOURAGE — the anti-staleness payload
  // --- shared ---
  'openQuestions',         // what neither track could settle → AskUserQuestion
];

/**
 * The two research tracks, so a consumer can inject only the half it needs: the
 * Open Design brief has no use for ORM conventions, and the backend lens has no
 * use for competitor pricing.
 */
export const PROMPT_SYSTEM_SECTION_GROUPS = {
  business: [
    'businessContext',
    'productArchetype',
    'marketBaseline',
    'competitorFeatures',
    'differentiators',
    'antiFeatures',
    'domainVocabulary',
    'complianceNotes',
  ],
  technical: [
    'techStack',
    'architectureBaseline',
    'designPatterns',
    'codingConventions',
    'securityBaseline',
    'testingBaseline',
    'technicalAntiPatterns',
  ],
};

/** Fallback archetype when the demand gives no recognizable category signal. */
export const DEFAULT_PRODUCT_ARCHETYPE = 'unknown';

/**
 * Registry of product archetypes the Pensador recognizes, in priority order
 * (earlier entries win keyword-score ties, so the more specific categories are
 * declared before the broader ones).
 *
 * Each entry carries:
 *   - `keywords`: accent-insensitive PT-BR/EN signals matched against the demand.
 *   - `baselineFeatures`: the category's table-stakes. These are asserted BEFORE
 *     any search — the web research CONFIRMS and EXTENDS them, it does not have to
 *     discover them from zero. A baseline feature the user does not want becomes an
 *     explicit `anti-feature`, never a silent omission.
 *   - `researchAngles`: deterministic query templates (`{{sector}}`, `{{demanda}}`)
 *     expanded by marketResearchQueryPlan().
 *   - `broadScope`: true when the category is inherently multi-domain, which pushes
 *     researchRelevance() to `completo` depth.
 */
export const PRODUCT_ARCHETYPES = {
  'landing-page': {
    id: 'landing-page',
    label: 'Landing page de conversão (empresa ou prestador de serviço)',
    broadScope: false,
    keywords: ['landing page', 'landingpage', 'lp de captura', 'pagina de captura', 'pagina de vendas', 'one page', 'squeeze page'],
    baselineFeatures: [
      'hero com proposta de valor e CTA primário acima da dobra',
      'prova social (depoimentos, logos de clientes, números)',
      'seção de benefícios/serviços orientada a dor do cliente',
      'formulário de captura curto + integração de lead (e-mail/CRM/WhatsApp)',
      'FAQ e quebra de objeções',
      'SEO on-page (title/description, Open Graph, dados estruturados)',
      'performance e Core Web Vitals (LCP/CLS) como requisito',
      'rastreamento de conversão (analytics + eventos de CTA)',
      'responsividade mobile-first e acessibilidade AA',
    ],
    researchAngles: [
      'melhores landing pages {{sector}} estrutura de secoes conversao',
      'landing page {{sector}} taxa de conversao boas praticas',
      'exemplos site {{sector}} chamada para acao formulario contato',
    ],
  },
  'institutional-site': {
    id: 'institutional-site',
    label: 'Site comercial/institucional de empresa',
    broadScope: false,
    keywords: ['site institucional', 'site comercial', 'site da empresa', 'website institucional', 'site corporativo', 'presenca digital', 'portfolio de servicos', 'institutional site', 'company website'],
    baselineFeatures: [
      'home com posicionamento, serviços e CTA de contato',
      'páginas de serviço/produto individuais (uma por oferta, boas para SEO)',
      'sobre a empresa, time e diferenciais',
      'portfólio/cases ou galeria de trabalhos',
      'contato: formulário, telefone, WhatsApp, mapa e horário',
      'blog/conteúdo para SEO orgânico',
      'SEO técnico (sitemap, robots, metadados, dados estruturados LocalBusiness)',
      'analytics e rastreamento de leads',
      'conformidade LGPD (banner de cookies, política de privacidade)',
      'responsividade e acessibilidade AA',
    ],
    researchAngles: [
      'site institucional {{sector}} paginas essenciais estrutura',
      'sites de {{sector}} referencia design conteudo',
      'seo local {{sector}} google meu negocio paginas de servico',
    ],
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'E-commerce / loja virtual',
    broadScope: true,
    keywords: ['e-commerce', 'ecommerce', 'loja virtual', 'loja online', 'carrinho de compras', 'checkout', 'catalogo de produtos', 'vender online', 'online store'],
    baselineFeatures: [
      'catálogo com categorias, busca e filtros facetados',
      'página de produto com variações, estoque e mídia',
      'carrinho, cupom e cálculo de frete',
      'checkout com múltiplos meios de pagamento (Pix, cartão, boleto)',
      'conta do cliente, endereços e histórico de pedidos',
      'gestão de pedidos, status e rastreio',
      'estoque, preço, promoções e catálogo no admin',
      'antifraude, notas fiscais e integrações logísticas',
      'e-mails transacionais e recuperação de carrinho',
      'analytics de funil e relatórios de venda',
    ],
    researchAngles: [
      'plataformas ecommerce {{sector}} funcionalidades comparativo',
      'checkout ecommerce brasil pix boleto melhores praticas conversao',
      'ecommerce {{sector}} integracoes frete estoque nota fiscal',
    ],
  },
  marketplace: {
    id: 'marketplace',
    label: 'Marketplace multi-vendedor',
    broadScope: true,
    keywords: ['marketplace', 'multi-vendedor', 'multivendedor', 'multi vendor', 'conectar prestadores', 'anunciantes e compradores', 'dois lados'],
    baselineFeatures: [
      'onboarding e verificação (KYC) dos dois lados',
      'catálogo/listagens publicadas pelos vendedores',
      'busca, filtros e ranking de relevância',
      'matchmaking, propostas ou pedidos',
      'split de pagamento, escrow e repasses',
      'avaliações e reputação bidirecional',
      'mensageria entre as partes',
      'gestão de disputas e moderação',
      'painéis distintos por perfil (comprador, vendedor, operação)',
      'políticas de taxa/comissão e relatórios financeiros',
    ],
    researchAngles: [
      'marketplace {{sector}} funcionalidades essenciais dois lados',
      'marketplace split de pagamento escrow repasse como funciona',
      'marketplace reputacao avaliacao moderacao boas praticas',
    ],
  },
  crm: {
    id: 'crm',
    label: 'CRM / gestão de relacionamento e pipeline comercial',
    broadScope: true,
    keywords: ['crm', 'pipeline de vendas', 'funil de vendas', 'gestao de leads', 'gestao de clientes', 'oportunidades de venda', 'kanban de vendas', 'pos-venda', 'relacionamento com cliente'],
    baselineFeatures: [
      'cadastro de contas, contatos e leads com deduplicação',
      'pipeline/kanban de oportunidades com estágios configuráveis',
      'atividades, tarefas e agenda vinculadas ao contato',
      'timeline unificada de interações (e-mail, ligação, WhatsApp, nota)',
      'campos personalizados por tipo de registro',
      'automação de etapa, atribuição e lembrete',
      'importação/exportação e integração com fontes de lead',
      'relatórios de conversão, previsão e desempenho por vendedor',
      'papéis, permissões e visibilidade por equipe/carteira',
      'auditoria/histórico de alterações',
    ],
    researchAngles: [
      'crm funcionalidades essenciais comparativo pipedrive hubspot rd station',
      'crm {{sector}} recursos especificos necessidades',
      'crm integracao whatsapp email automacao funil boas praticas',
    ],
  },
  saas: {
    id: 'saas',
    label: 'SaaS multi-tenant com assinatura',
    broadScope: true,
    keywords: ['saas', 'software como servico', 'assinatura mensal', 'multi-tenant', 'multitenant', 'multi tenant', 'plano de assinatura', 'trial', 'plataforma na nuvem', 'subscription'],
    baselineFeatures: [
      'signup, login, verificação de e-mail e recuperação de senha',
      'organização/workspace com convite de membros e papéis',
      'isolamento de dados por tenant',
      'planos, limites de uso e cobrança recorrente (gateway + webhooks)',
      'trial, upgrade/downgrade, cancelamento e dunning',
      'onboarding guiado e estado vazio produtivo',
      'configurações de conta, perfil e preferências',
      'auditoria, logs e exportação de dados (portabilidade LGPD)',
      'notificações in-app e por e-mail',
      'painel administrativo interno (suporte/impersonation controlada)',
      'observabilidade, limites de taxa e SLA',
    ],
    researchAngles: [
      'saas {{sector}} funcionalidades concorrentes comparativo',
      'saas multi-tenant onboarding billing planos boas praticas',
      'saas {{sector}} precificacao planos limites de uso',
    ],
  },
  erp: {
    id: 'erp',
    label: 'Sistema de gestão / ERP operacional',
    broadScope: true,
    keywords: ['erp', 'sistema de gestao', 'gestao empresarial', 'controle de estoque', 'financeiro contas a pagar', 'ordem de servico', 'emissao de nota fiscal', 'faturamento', 'back office'],
    baselineFeatures: [
      'cadastros mestres (clientes, fornecedores, produtos/serviços)',
      'processo operacional central (pedido, ordem de serviço ou produção)',
      'estoque com movimentações e custo',
      'financeiro: contas a pagar/receber, conciliação e fluxo de caixa',
      'faturamento e emissão fiscal (NF-e/NFS-e)',
      'papéis, permissões granulares e aprovações',
      'relatórios operacionais e gerenciais com exportação',
      'importação de dados legados e migração',
      'trilha de auditoria e imutabilidade de lançamentos',
      'integrações (bancos, fiscal, e-commerce, planilhas)',
    ],
    researchAngles: [
      'sistema de gestao {{sector}} funcionalidades modulos essenciais',
      'erp {{sector}} concorrentes comparativo recursos',
      'ordem de servico {{sector}} fluxo estoque financeiro nota fiscal',
    ],
  },
  booking: {
    id: 'booking',
    label: 'Agendamento/reservas para prestadores de serviço',
    broadScope: false,
    keywords: ['agendamento', 'agenda online', 'marcar horario', 'reserva', 'booking', 'consulta online', 'fila de atendimento', 'confirmacao de horario'],
    baselineFeatures: [
      'catálogo de serviços com duração e preço',
      'disponibilidade por profissional, recurso e horário de funcionamento',
      'reserva self-service com confirmação',
      'lembretes e confirmações (e-mail, SMS, WhatsApp)',
      'remarcação, cancelamento e política de no-show',
      'pagamento antecipado ou sinal (opcional)',
      'agenda operacional e visão do dia',
      'histórico do cliente e retorno/recorrência',
      'bloqueios, feriados e overbooking controlado',
      'métricas de ocupação e faltas',
    ],
    researchAngles: [
      'sistema de agendamento {{sector}} funcionalidades essenciais',
      'agendamento online {{sector}} lembrete whatsapp no-show politica',
      'software agenda {{sector}} concorrentes comparativo',
    ],
  },
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard/BI analítico',
    broadScope: true,
    keywords: ['dashboard', 'painel analitico', 'bi', 'business intelligence', 'indicadores', 'kpi', 'relatorios gerenciais', 'visualizacao de dados'],
    baselineFeatures: [
      'catálogo de métricas com definição explícita de cada KPI',
      'filtros de período, segmento e comparação (vs período anterior)',
      'visualizações adequadas ao tipo de dado + drill-down',
      'granularidade e agregação configuráveis',
      'exportação (CSV/PDF) e compartilhamento com permissão',
      'atualização/frescor do dado visível ao usuário',
      'estados vazio, carregando, parcial e erro',
      'desempenho de consulta e cache',
      'controle de acesso por métrica/linha (row-level security)',
    ],
    researchAngles: [
      'dashboard {{sector}} kpis indicadores essenciais',
      'painel {{sector}} metricas benchmark mercado',
      'dashboard boas praticas visualizacao drill down filtros',
    ],
  },
  'mobile-app': {
    id: 'mobile-app',
    label: 'Aplicativo mobile',
    broadScope: true,
    keywords: ['aplicativo mobile', 'app android', 'app ios', 'aplicativo para celular', 'react native', 'flutter', 'push notification'],
    baselineFeatures: [
      'onboarding e autenticação (incl. biometria/social)',
      'navegação nativa e estados offline',
      'push notifications com permissão e preferências',
      'sincronização e resolução de conflito',
      'deep links e compartilhamento',
      'atualização de versão e política de suporte',
      'permissões de dispositivo com justificativa',
      'requisitos de publicação nas lojas (privacidade, assets, revisão)',
      'telemetria de crash e uso',
    ],
    researchAngles: [
      'aplicativo {{sector}} funcionalidades concorrentes app store',
      'app {{sector}} avaliacoes usuarios reclamacoes recursos faltando',
      'mobile app {{sector}} offline push notificacao boas praticas',
    ],
  },
  'api-service': {
    id: 'api-service',
    label: 'API/serviço de back-end para consumo externo',
    broadScope: false,
    keywords: ['api publica', 'api rest', 'servico de integracao', 'webhook', 'microsservico', 'grpc', 'graphql api', 'sdk'],
    baselineFeatures: [
      'contrato versionado e publicado (OpenAPI/SDL/proto/AsyncAPI)',
      'autenticação e escopos (API key, OAuth2, JWT)',
      'paginação, filtros e ordenação consistentes',
      'idempotência em escritas e política de retry',
      'erros padronizados com código e correlação',
      'rate limiting e cotas por consumidor',
      'webhooks com assinatura e reentrega',
      'sandbox, mocks e documentação executável',
      'observabilidade (tracing, métricas, logs correlacionados)',
      'deprecação e compatibilidade retroativa',
    ],
    researchAngles: [
      'api {{sector}} padroes de mercado endpoints recursos',
      'api rest boas praticas versionamento idempotencia rate limit',
      'webhook assinatura reentrega boas praticas api publica',
    ],
  },
  unknown: {
    id: 'unknown',
    label: 'Categoria não identificada',
    broadScope: false,
    keywords: [],
    baselineFeatures: [],
    researchAngles: [
      '{{demanda}} funcionalidades essenciais concorrentes',
      '{{demanda}} {{sector}} como funciona mercado',
    ],
  },
};

/** Feature tiers used to classify every finding of the market research. */
export const FEATURE_TIERS = ['table-stakes', 'differentiator', 'anti-feature', 'out-of-scope'];

/**
 * Competitor-coverage ratio at/above which a researched feature is considered
 * table-stakes (present in the clear majority of the benchmarked products).
 */
export const TABLE_STAKES_COVERAGE_THRESHOLD = 0.6;

/** Accent-insensitive, lowercase normalization used for keyword matching. */
function normalizeResearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Boundary-aware keyword match over already-normalized text.
 *
 * A plain `includes()` is not safe for this domain: `go` would match "algo"/"google"
 * and `crm` would match any longer token containing it. And `\b` is useless for the
 * identifiers that matter most here — `c#`, `.net`, `c++` end/start with non-word
 * characters, so `\bc#\b` never fires. So the boundary is expressed as lookarounds
 * over the alphanumeric class only: the keyword must not be glued to another letter
 * or digit, while surrounding punctuation is allowed.
 *
 * Pure and total: never throws (empty keyword → false).
 *
 * @param {string} haystack  normalized text
 * @param {string} keyword   raw keyword (normalized internally)
 * @returns {boolean}
 */
function matchesKeyword(haystack, keyword) {
  const needle = normalizeResearchText(keyword);
  if (needle === '') return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
}

/**
 * Detects the product archetype of a demand by scoring the registry keywords
 * against the (accent-insensitive) demand text. Pure and total: same input →
 * same output, never throws. Registry order breaks score ties, so a more
 * specific category (landing-page) wins over a broader one (institutional-site)
 * when both match equally.
 *
 * The result is a SUGGESTION: the Pensador confirms it via AskUserQuestion in
 * RESEARCH before spending the search budget on the wrong category.
 *
 * @param {string|null|undefined} text  the demand (optionally + sector context)
 * @returns {{ archetype: string, score: number, matches: string[] }}
 */
export function detectProductArchetype(text) {
  const haystack = normalizeResearchText(text);
  if (haystack === '') {
    return { archetype: DEFAULT_PRODUCT_ARCHETYPE, score: 0, matches: [] };
  }

  let best = { archetype: DEFAULT_PRODUCT_ARCHETYPE, score: 0, matches: [] };
  for (const entry of Object.values(PRODUCT_ARCHETYPES)) {
    if (entry.id === DEFAULT_PRODUCT_ARCHETYPE) continue;
    const matches = entry.keywords.filter((kw) => matchesKeyword(haystack, kw));
    if (matches.length > best.score) {
      best = { archetype: entry.id, score: matches.length, matches };
    }
  }
  return best;
}

/**
 * Normalizes an archetype key into its registry entry. Unknown / nullish → the
 * `unknown` entry. Pure and total.
 *
 * @param {string|null|undefined} archetype
 * @returns {typeof PRODUCT_ARCHETYPES['unknown']}
 */
export function resolveProductArchetype(archetype) {
  const key = Object.prototype.hasOwnProperty.call(PRODUCT_ARCHETYPES, archetype)
    ? archetype
    : DEFAULT_PRODUCT_ARCHETYPE;
  return PRODUCT_ARCHETYPES[key];
}

/**
 * Decides whether the web/market research is relevant for this demand and how
 * deep it should go.
 *
 * RESEARCH is skipped ONLY for a demand with no product surface — a pure internal
 * refactor, a build/CI fix, a dependency bump. Anything a user sees or buys has a
 * market baseline worth reading. When skipped, the stage is still visited and the
 * reason is recorded in market-research.md.
 *
 * Depth is decided here (not by COMPLEXITY, which runs later) from the breadth
 * signals available in the demand itself.
 *
 * @param {{ isInternalOnly?: boolean, archetype?: string, hasBroadScopeKeywords?: boolean,
 *   isGreenfield?: boolean }} [signals]
 * @returns {{ relevant: boolean, depth: 'lite'|'completo', reason: string }}
 */
export function researchRelevance(signals = {}) {
  const {
    isInternalOnly = false,
    archetype = DEFAULT_PRODUCT_ARCHETYPE,
    hasBroadScopeKeywords = false,
    isGreenfield = false,
  } = signals ?? {};

  if (isInternalOnly === true) {
    return {
      relevant: false,
      depth: 'lite',
      reason: 'Demanda sem superficie de produto (refactor/infra/CI): nao ha baseline de mercado a comparar.',
    };
  }

  const entry = resolveProductArchetype(archetype);
  const deep = entry.broadScope === true || hasBroadScopeKeywords === true || isGreenfield === true;

  return {
    relevant: true,
    depth: deep ? 'completo' : 'lite',
    reason: deep
      ? `Categoria ${entry.id} e/ou escopo amplo: benchmark completo (${WEB_RESEARCH.budget.completoQueries} consultas).`
      : `Categoria ${entry.id} de escopo contido: benchmark enxuto (${WEB_RESEARCH.budget.liteQueries} consultas).`,
  };
}

/**
 * Builds the deterministic query plan for the RESEARCH stage: the archetype's
 * research angles (with `{{sector}}`/`{{demanda}}` expanded) followed by the
 * cross-cutting angles that apply to every category. Truncated to the budget for
 * the requested depth so the stage can never turn into an unbounded crawl.
 *
 * Pure and total: same input → same output, never throws.
 *
 * @param {{ demanda?: string, archetype?: string, sectorContext?: string,
 *   region?: string, depth?: 'lite'|'completo' }} [options]
 * @returns {{ id: string, kind: string, query: string, purpose: string }[]}
 */
export function marketResearchQueryPlan(options = {}) {
  const {
    demanda = '',
    archetype = DEFAULT_PRODUCT_ARCHETYPE,
    sectorContext = '',
    region = 'Brasil',
    depth = 'completo',
  } = options ?? {};

  const entry = resolveProductArchetype(archetype);
  const sector = normalizeResearchText(sectorContext);
  const subject = normalizeResearchText(demanda) || entry.label.toLowerCase();
  const expand = (template) =>
    String(template)
      .replaceAll('{{sector}}', sector)
      .replaceAll('{{demanda}}', subject)
      .replace(/\s+/g, ' ')
      .trim();

  const angles = entry.researchAngles.map((template, index) => ({
    id: `q${index + 1}`,
    kind: index === 0 ? 'competitor-discovery' : 'feature-inventory',
    query: expand(template),
    purpose: 'Identificar concorrentes/referencias e o conjunto de funcionalidades da categoria.',
  }));

  const crossCutting = [
    {
      kind: 'sector-vocabulary',
      query: expand('{{sector}} termos do setor glossario processo de atendimento'),
      purpose: 'Capturar o vocabulario real do dominio para microcopy, entidades e iconografia.',
    },
    {
      kind: 'pricing-packaging',
      query: expand('{{demanda}} {{sector}} precos planos como cobram mercado ' + region),
      purpose: 'Entender empacotamento/monetizacao praticado no mercado.',
    },
    {
      kind: 'ux-patterns',
      query: expand('{{demanda}} {{sector}} reclamacoes usuarios o que falta avaliacoes'),
      purpose: 'Achar dores recorrentes dos concorrentes (fonte dos diferenciais).',
    },
    {
      kind: 'compliance',
      query: expand('{{sector}} ' + region + ' exigencias legais lgpd regulamentacao software'),
      purpose: 'Levantar restricoes legais/regulatorias do setor antes do PRD.',
    },
  ].map((item, index) => ({ id: `q${angles.length + index + 1}`, ...item }));

  const limit =
    depth === 'lite' ? WEB_RESEARCH.budget.liteQueries : WEB_RESEARCH.budget.completoQueries;

  return [...angles, ...crossCutting].filter((item) => item.query !== '').slice(0, limit);
}

/**
 * Builds the path of the market-research snapshot inside the update directory.
 * This is a WORKING file (it is NOT part of buildArtifactList — unlike
 * `codebase-memory.md`/`architecture.md`, which ARE emitted as handoff
 * artifacts) consumed by PRD_BASE, EXPAND, the BRAINSTORM_GERAL context pack
 * and the Open Design brief.
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function marketResearchSnapshotPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${WEB_RESEARCH.snapshotFile}`;
}

/**
 * Classifies a researched feature into one of FEATURE_TIERS.
 *
 * Precedence is deliberate: an explicit user decision always beats the market
 * signal. A feature the user rejected is an `anti-feature` (documented, not
 * forgotten); one they deferred is `out-of-scope`; otherwise majority competitor
 * coverage makes it `table-stakes`. Pure and total: same input → same output.
 *
 * @param {{ competitorCoverage?: number, userRejected?: boolean, deferred?: boolean,
 *   userRequested?: boolean }} [signals]
 * @returns {'table-stakes'|'differentiator'|'anti-feature'|'out-of-scope'}
 */
export function classifyFeatureTier(signals = {}) {
  const {
    competitorCoverage = 0,
    userRejected = false,
    deferred = false,
    userRequested = false,
  } = signals ?? {};

  if (userRejected === true) return 'anti-feature';
  if (deferred === true) return 'out-of-scope';

  const raw = Number(competitorCoverage);
  const coverage = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0;

  if (coverage >= TABLE_STAKES_COVERAGE_THRESHOLD) return 'table-stakes';
  if (userRequested === true || coverage > 0) return 'differentiator';
  return 'out-of-scope';
}

/**
 * Builds the reusable **Prompt System** produced by RESEARCH: the researched
 * business context packaged in PROMPT_SYSTEM_SECTIONS order, ready to be injected
 * verbatim into every downstream prompt (see WEB_RESEARCH.promptSystemConsumers).
 *
 * Mirrors buildPrdBase's contract: the engine guarantees STRUCTURAL completeness
 * (every section present, `"TBD"` when the research could not fill it); the LLM
 * layer fills the prose. Pure and total: same input → same output, no I/O.
 *
 * @param {{ demanda?: string, archetype?: string, sectorContext?: string,
 *   stack?: string[], sections?: Record<string, string> }} [research]
 * @returns {{ archetype: string, sectorContext: string, stack: string[],
 *   sections: Record<string, string> }}
 */
export function buildResearchPromptSystem(research = {}) {
  const {
    demanda = '',
    archetype = DEFAULT_PRODUCT_ARCHETYPE,
    sectorContext = '',
    stack = [],
    sections = {},
  } = research ?? {};
  const entry = resolveProductArchetype(archetype);
  const techEntries = (Array.isArray(stack) ? stack : []).filter(Boolean).map((id) => resolveTechEntry(id));

  const filled = {};
  for (const section of PROMPT_SYSTEM_SECTIONS) {
    const value = sections?.[section];
    filled[section] = typeof value === 'string' && value.trim() !== '' ? value : 'TBD';
  }

  // These sections are always derivable without a single search — from the demand,
  // the archetype registry and the detected stack — so never leave them as TBD.
  if (filled.productArchetype === 'TBD') {
    filled.productArchetype = `${entry.id} — ${entry.label}`;
  }
  if (filled.marketBaseline === 'TBD' && entry.baselineFeatures.length > 0) {
    filled.marketBaseline = entry.baselineFeatures.join('; ');
  }
  if (filled.businessContext === 'TBD' && String(demanda).trim() !== '') {
    filled.businessContext = String(demanda).trim();
  }
  // The stack itself is known from the demand; the VERSIONS are not (they are
  // researched), so the derived value names the technologies and leaves the version
  // to be filled by the technical track.
  if (filled.techStack === 'TBD' && techEntries.length > 0) {
    filled.techStack = techEntries
      .map((t) => `${t.label} (versao atual: TBD${t.versionSensitive ? ' — confirmar na pesquisa' : ''})`)
      .join('; ');
  }

  return {
    archetype: entry.id,
    sectorContext: String(sectorContext ?? ''),
    stack: techEntries.map((t) => t.id),
    sections: filled,
  };
}

/**
 * Records the RESEARCH outcome on the state. Normalizes the shape so later stages
 * (and the checkpoint) can rely on it, and always keeps `promptSystem` structurally
 * complete via buildResearchPromptSystem. Pure: returns a new state.
 *
 * `status`:
 *   - `DONE`    — research performed, findings recorded.
 *   - `PARTIAL` — some queries failed / budget exhausted; gaps marked TBD.
 *   - `SKIPPED` — no product surface, or no web access and the user opted out.
 *
 * @param {StageState} state
 * @param {{ status?: 'DONE'|'PARTIAL'|'SKIPPED', archetype?: string, sectorContext?: string,
 *   competitors?: object[], features?: object[], sources?: string[],
 *   promptSystem?: object, notes?: string }} [research]
 * @returns {StageState}
 */
export function withMarketResearch(state, research = {}) {
  const archetype = resolveProductArchetype(research?.archetype).id;
  const sectorContext = research?.sectorContext ?? state?.sectorContext ?? null;

  return {
    ...state,
    productArchetype: archetype,
    sectorContext,
    marketResearch: {
      status: ['DONE', 'PARTIAL', 'SKIPPED'].includes(research?.status) ? research.status : 'PARTIAL',
      archetype,
      sectorContext,
      competitors: Array.isArray(research?.competitors) ? research.competitors : [],
      features: Array.isArray(research?.features) ? research.features : [],
      sources: Array.isArray(research?.sources) ? research.sources : [],
      notes: typeof research?.notes === 'string' ? research.notes : '',
      promptSystem:
        research?.promptSystem ??
        buildResearchPromptSystem({
          demanda: state?.demanda ?? '',
          archetype,
          sectorContext: sectorContext ?? '',
          stack: Array.isArray(state?.techStack) ? state.techStack : [],
        }),
    },
  };
}

// ---------------------------------------------------------------------------
// Technical research track (RESEARCH stage, second track) — current stack
// patterns, architecture, design patterns and conventions
// ---------------------------------------------------------------------------

/**
 * The RESEARCH stage has TWO tracks, and they answer different questions:
 *
 *   - `business`  (WEB_RESEARCH):  what does this product CATEGORY ship? Competitors,
 *                 table-stakes features, sector vocabulary, pricing, compliance.
 *   - `technical` (TECH_RESEARCH): how is this STACK built TODAY? Current stable
 *                 versions, idiomatic project structure, architecture and design
 *                 patterns, conventions, security and testing baselines — and,
 *                 crucially, which patterns are now DISCOURAGED.
 *
 * Why the technical track cannot be skipped or answered from memory: an LLM's
 * knowledge of a fast-moving ecosystem is frozen at its training cutoff, and the
 * failure mode is silent. Asked for "login with React + TypeScript and a C# back
 * end", a model may confidently produce a PRD around patterns the official docs
 * have since replaced (class components, legacy data fetching, hand-rolled JWT
 * where the framework now ships a supported identity/auth stack, a folder layout
 * two majors out of date). The PRD then becomes a specification for building
 * yesterday's application — and every downstream stage (Orchestrador, Executor)
 * faithfully implements the stale decision.
 *
 * So the rule is: for every version-sensitive technology, the CURRENT stable
 * version and the CURRENT recommended approach are RESEARCHED, never recalled.
 *
 * DESIGN NOTE — the registry deliberately stores NO version numbers. Pinning
 * "React 19" or ".NET 10" here would recreate exactly the staleness this track
 * exists to eliminate. It stores only where the truth lives (`docsUrl`) and
 * whether it must be checked (`versionSensitive`).
 */
export const TECH_RESEARCH = {
  stage: 'RESEARCH',
  track: 'technical',
  mandatory: true,
  relevantWhen: 'stackDetected || isGreenfield || touchesArchitecture',
  tools: {
    search: 'WebSearch',
    fetch: 'WebFetch',
  },
  /**
   * Separate budget from the business track: every technology carries its own
   * documentation surface, so the ceiling scales with the stack size rather than
   * with the product category.
   */
  budget: {
    liteQueries: 6,
    completoQueries: 16,
    maxFetchPerQuery: 2,
    maxTechnologies: 6,
    /** Angles expanded per detected technology, per round of the round-robin. */
    maxAnglesPerTech: 3,
  },
  /**
   * Source tiers for TECHNICAL claims — deliberately different from the business
   * track. For a market claim a vendor page is biased; for a framework claim the
   * vendor IS the authority. Official documentation and release notes outrank any
   * third-party guide, however popular.
   */
  sourceTiers: [
    'official-docs',   // tier 1: the framework/language's own docs and guides
    'release-notes',   // tier 1: changelogs, RFCs, ADRs, migration guides
    'reputable-guide', // tier 2: recognized engineering references and style guides
    'community',       // tier 3: blogs, Stack Overflow, forums
  ],
  /** A pattern may only be recorded as `current` when the official docs back it. */
  requiresOfficialSource: true,
  /** Working snapshot written under <featurePath>/ (not a final artifact). */
  snapshotFile: 'tech-research.md',
  /**
   * Where the technical findings land. The technical track feeds the ENGINEERING
   * sections of the PRD, not the product ones.
   */
  consumers: [
    'prd-base',              // PRD §7 RNF, §10 data model, §11 contracts, §12 security, §15 architecture
    'arch',                  // architecture.md: researched baseline + top-up when stack was deferred
    'brainstorm-backend',    // the backend-development primary lens + Codex refine
    'brainstorm-frontend',   // ui-ux-pro-max / frontend-design + AGY refine
    'codex',                 // technical sweep reasons over researched conventions
    'handoff',               // Orchestrador/Executor implement with these conventions
  ],
};

/**
 * The dimensions the technical research must answer. Mirrors the role of
 * `openDesignBriefPlan()` for design: an explicit, ordered checklist so the
 * research cannot quietly stop at "which version is current".
 */
export const TECH_RESEARCH_DIMENSIONS = [
  'stackVersions',        // current stable/LTS version + support window (MANDATORY when versionSensitive)
  'projectStructure',     // idiomatic folder/layer layout for the current major
  'architecturePatterns', // e.g. layered, clean, vertical slice, feature-based front end
  'designPatterns',       // repository, mediator/CQRS, DI, hooks composition, etc.
  'conventions',          // naming, lint/format, file naming, commit style
  'securityPatterns',     // auth/authz flows, secret and token handling, hashing
  'testingStrategy',      // test levels and the ecosystem's default tooling
  'performancePatterns',  // rendering/query/caching guidance for the stack
  'antiPatterns',         // what the docs now DISCOURAGE — the anti-staleness payload
  'officialReferences',   // canonical doc URLs backing each decision
];

/** Adoption status of a researched technical pattern, best first. */
export const PATTERN_ADOPTION = ['current', 'experimental', 'legacy', 'deprecated'];

/**
 * Age (in months) beyond which a source is no longer evidence that a pattern is
 * *current practice*. A 2019 tutorial may still be correct, but it cannot be the
 * basis for claiming a pattern is the recommended approach today.
 */
export const PATTERN_STALENESS_MONTHS = 24;

/**
 * Query templates per technology category, expanded with `{{tech}}`. Keeping the
 * angles on the CATEGORY (instead of on each of the ~50 registry entries) is what
 * keeps the registry compact and uniformly maintained: adding a technology means
 * adding one line, and it immediately inherits the right questions.
 */
export const TECH_CATEGORY_ANGLES = {
  language: [
    '{{tech}} style guide coding conventions official',
    '{{tech}} project structure best practices modern',
  ],
  'frontend-framework': [
    '{{tech}} official project structure recommended patterns',
    '{{tech}} data fetching state management recommended approach docs',
    '{{tech}} deprecated patterns migration guide what not to use',
  ],
  'ui-library': [
    '{{tech}} component composition theming best practices docs',
    '{{tech}} accessibility form components patterns',
  ],
  'state-data': [
    '{{tech}} recommended patterns docs when to use',
    '{{tech}} caching invalidation best practices',
  ],
  'backend-framework': [
    '{{tech}} project structure architecture layers best practices docs',
    '{{tech}} authentication authorization recommended approach official docs',
    '{{tech}} deprecated obsolete api migration guide',
  ],
  orm: [
    '{{tech}} modeling migrations best practices docs',
    '{{tech}} performance n+1 query tracking best practices',
  ],
  database: [
    '{{tech}} schema indexing best practices',
    '{{tech}} migration strategy production best practices',
  ],
  auth: [
    '{{tech}} secure implementation token storage refresh rotation official docs',
    '{{tech}} common vulnerabilities implementation mistakes',
  ],
  testing: [
    '{{tech}} testing strategy structure best practices docs',
  ],
  infra: [
    '{{tech}} production configuration best practices docs',
  ],
  mobile: [
    '{{tech}} project structure navigation state recommended docs',
    '{{tech}} deprecated api migration guide',
  ],
  unknown: [
    '{{tech}} official documentation best practices project structure',
    '{{tech}} current stable version recommended patterns',
  ],
};

/** Mandatory version-currency angle for every version-sensitive technology. */
export const TECH_VERSION_ANGLE = '{{tech}} latest stable version release notes breaking changes';

/**
 * Cross-cutting angles that depend on the COMBINATION of technologies rather than
 * on any single one — the front↔back boundary is where most integration mistakes
 * live, and no per-technology query would surface them.
 */
export const TECH_CROSS_CUTTING_ANGLES = [
  {
    kind: 'integration-contract',
    template: '{{frontend}} {{backend}} integracao api contrato tipos boas praticas',
    purpose: 'Padroes de integracao e tipagem compartilhada entre front-end e back-end.',
  },
  {
    kind: 'auth-flow',
    template: '{{frontend}} {{backend}} autenticacao login token refresh boas praticas seguranca',
    purpose: 'Fluxo de autenticacao recomendado para o par front/back (storage, refresh, expiracao).',
  },
  {
    kind: 'project-conventions',
    template: '{{primary}} convencoes de projeto lint formatacao estrutura de pastas recomendada',
    purpose: 'Convencoes de codigo/estrutura que o Executor deve seguir.',
  },
];

/**
 * Registry of technologies the Pensador recognizes in a demand, in priority order.
 *
 * Compact by design: `{ id, label, category, keywords, docsUrl, versionSensitive }`.
 * The research questions come from the technology's CATEGORY
 * (TECH_CATEGORY_ANGLES), so entries never duplicate query prose — and NO entry
 * carries a version number (see the DESIGN NOTE on TECH_RESEARCH).
 *
 * `keywords` are matched with boundary awareness (matchesKeyword), which is what
 * makes `c#`, `.net` and `go` safely detectable.
 */
export const TECH_STACK_REGISTRY = {
  // --- Frontend frameworks (declared before the bare languages so a framework wins) ---
  nextjs: { id: 'nextjs', label: 'Next.js', category: 'frontend-framework', keywords: ['next.js', 'nextjs', 'next js'], docsUrl: 'https://nextjs.org/docs', versionSensitive: true },
  'react-native': { id: 'react-native', label: 'React Native', category: 'mobile', keywords: ['react native', 'react-native'], docsUrl: 'https://reactnative.dev/docs/getting-started', versionSensitive: true },
  react: { id: 'react', label: 'React', category: 'frontend-framework', keywords: ['react', 'reactjs', 'react.js'], docsUrl: 'https://react.dev', versionSensitive: true },
  nuxt: { id: 'nuxt', label: 'Nuxt', category: 'frontend-framework', keywords: ['nuxt', 'nuxtjs'], docsUrl: 'https://nuxt.com/docs', versionSensitive: true },
  vue: { id: 'vue', label: 'Vue', category: 'frontend-framework', keywords: ['vue', 'vuejs', 'vue.js'], docsUrl: 'https://vuejs.org/guide/introduction.html', versionSensitive: true },
  angular: { id: 'angular', label: 'Angular', category: 'frontend-framework', keywords: ['angular'], docsUrl: 'https://angular.dev', versionSensitive: true },
  svelte: { id: 'svelte', label: 'Svelte / SvelteKit', category: 'frontend-framework', keywords: ['svelte', 'sveltekit'], docsUrl: 'https://svelte.dev/docs', versionSensitive: true },
  remix: { id: 'remix', label: 'Remix / React Router', category: 'frontend-framework', keywords: ['remix'], docsUrl: 'https://remix.run/docs', versionSensitive: true },
  astro: { id: 'astro', label: 'Astro', category: 'frontend-framework', keywords: ['astro'], docsUrl: 'https://docs.astro.build', versionSensitive: true },
  flutter: { id: 'flutter', label: 'Flutter', category: 'mobile', keywords: ['flutter', 'dart'], docsUrl: 'https://docs.flutter.dev', versionSensitive: true },

  // --- UI / styling ---
  tailwind: { id: 'tailwind', label: 'Tailwind CSS', category: 'ui-library', keywords: ['tailwind', 'tailwindcss'], docsUrl: 'https://tailwindcss.com/docs', versionSensitive: true },
  'shadcn-ui': { id: 'shadcn-ui', label: 'shadcn/ui', category: 'ui-library', keywords: ['shadcn', 'shadcn/ui'], docsUrl: 'https://ui.shadcn.com/docs', versionSensitive: true },
  mui: { id: 'mui', label: 'MUI (Material UI)', category: 'ui-library', keywords: ['mui', 'material ui', 'material-ui'], docsUrl: 'https://mui.com/material-ui/getting-started/', versionSensitive: true },
  antd: { id: 'antd', label: 'Ant Design', category: 'ui-library', keywords: ['antd', 'ant design'], docsUrl: 'https://ant.design/docs/react/introduce', versionSensitive: true },
  chakra: { id: 'chakra', label: 'Chakra UI', category: 'ui-library', keywords: ['chakra', 'chakra ui'], docsUrl: 'https://chakra-ui.com/docs', versionSensitive: true },
  'styled-components': { id: 'styled-components', label: 'styled-components', category: 'ui-library', keywords: ['styled components', 'styled-components'], docsUrl: 'https://styled-components.com/docs', versionSensitive: false },

  // --- State / data ---
  'tanstack-query': { id: 'tanstack-query', label: 'TanStack Query', category: 'state-data', keywords: ['tanstack query', 'react query', 'react-query'], docsUrl: 'https://tanstack.com/query/latest/docs', versionSensitive: true },
  redux: { id: 'redux', label: 'Redux Toolkit', category: 'state-data', keywords: ['redux', 'redux toolkit', 'rtk'], docsUrl: 'https://redux-toolkit.js.org', versionSensitive: true },
  zustand: { id: 'zustand', label: 'Zustand', category: 'state-data', keywords: ['zustand'], docsUrl: 'https://zustand.docs.pmnd.rs', versionSensitive: false },

  // --- Languages ---
  typescript: { id: 'typescript', label: 'TypeScript', category: 'language', keywords: ['typescript', 'ts'], docsUrl: 'https://www.typescriptlang.org/docs/', versionSensitive: true },
  csharp: { id: 'csharp', label: 'C#', category: 'language', keywords: ['c#', 'csharp', 'c sharp'], docsUrl: 'https://learn.microsoft.com/dotnet/csharp/', versionSensitive: true },
  javascript: { id: 'javascript', label: 'JavaScript', category: 'language', keywords: ['javascript', 'js'], docsUrl: 'https://developer.mozilla.org/docs/Web/JavaScript', versionSensitive: false },
  python: { id: 'python', label: 'Python', category: 'language', keywords: ['python'], docsUrl: 'https://docs.python.org/3/', versionSensitive: true },
  java: { id: 'java', label: 'Java', category: 'language', keywords: ['java'], docsUrl: 'https://docs.oracle.com/en/java/', versionSensitive: true },
  go: { id: 'go', label: 'Go', category: 'language', keywords: ['go', 'golang'], docsUrl: 'https://go.dev/doc/', versionSensitive: true },
  php: { id: 'php', label: 'PHP', category: 'language', keywords: ['php'], docsUrl: 'https://www.php.net/docs.php', versionSensitive: true },
  kotlin: { id: 'kotlin', label: 'Kotlin', category: 'language', keywords: ['kotlin'], docsUrl: 'https://kotlinlang.org/docs/home.html', versionSensitive: true },
  swift: { id: 'swift', label: 'Swift', category: 'language', keywords: ['swift', 'swiftui'], docsUrl: 'https://developer.apple.com/documentation/swift', versionSensitive: true },
  ruby: { id: 'ruby', label: 'Ruby', category: 'language', keywords: ['ruby'], docsUrl: 'https://www.ruby-lang.org/en/documentation/', versionSensitive: false },
  rust: { id: 'rust', label: 'Rust', category: 'language', keywords: ['rust'], docsUrl: 'https://doc.rust-lang.org/book/', versionSensitive: true },

  // --- Backend frameworks / runtimes ---
  dotnet: { id: 'dotnet', label: 'ASP.NET Core (.NET)', category: 'backend-framework', keywords: ['asp.net core', 'asp.net', 'aspnet', '.net', 'dotnet', 'net core', 'minimal api'], docsUrl: 'https://learn.microsoft.com/aspnet/core/', versionSensitive: true },
  nestjs: { id: 'nestjs', label: 'NestJS', category: 'backend-framework', keywords: ['nestjs', 'nest.js'], docsUrl: 'https://docs.nestjs.com', versionSensitive: true },
  express: { id: 'express', label: 'Express', category: 'backend-framework', keywords: ['express', 'expressjs'], docsUrl: 'https://expressjs.com', versionSensitive: true },
  nodejs: { id: 'nodejs', label: 'Node.js', category: 'backend-framework', keywords: ['node.js', 'nodejs', 'node js'], docsUrl: 'https://nodejs.org/docs/latest/api/', versionSensitive: true },
  fastapi: { id: 'fastapi', label: 'FastAPI', category: 'backend-framework', keywords: ['fastapi'], docsUrl: 'https://fastapi.tiangolo.com', versionSensitive: true },
  django: { id: 'django', label: 'Django', category: 'backend-framework', keywords: ['django'], docsUrl: 'https://docs.djangoproject.com/en/stable/', versionSensitive: true },
  flask: { id: 'flask', label: 'Flask', category: 'backend-framework', keywords: ['flask'], docsUrl: 'https://flask.palletsprojects.com', versionSensitive: false },
  'spring-boot': { id: 'spring-boot', label: 'Spring Boot', category: 'backend-framework', keywords: ['spring boot', 'springboot', 'spring'], docsUrl: 'https://docs.spring.io/spring-boot/index.html', versionSensitive: true },
  laravel: { id: 'laravel', label: 'Laravel', category: 'backend-framework', keywords: ['laravel'], docsUrl: 'https://laravel.com/docs', versionSensitive: true },
  rails: { id: 'rails', label: 'Ruby on Rails', category: 'backend-framework', keywords: ['rails', 'ruby on rails'], docsUrl: 'https://guides.rubyonrails.org', versionSensitive: true },

  // --- ORM / data access ---
  'entity-framework': { id: 'entity-framework', label: 'Entity Framework Core', category: 'orm', keywords: ['entity framework', 'ef core', 'efcore'], docsUrl: 'https://learn.microsoft.com/ef/core/', versionSensitive: true },
  dapper: { id: 'dapper', label: 'Dapper', category: 'orm', keywords: ['dapper'], docsUrl: 'https://www.learndapper.com', versionSensitive: false },
  prisma: { id: 'prisma', label: 'Prisma', category: 'orm', keywords: ['prisma'], docsUrl: 'https://www.prisma.io/docs', versionSensitive: true },
  drizzle: { id: 'drizzle', label: 'Drizzle ORM', category: 'orm', keywords: ['drizzle'], docsUrl: 'https://orm.drizzle.team/docs/overview', versionSensitive: true },
  typeorm: { id: 'typeorm', label: 'TypeORM', category: 'orm', keywords: ['typeorm'], docsUrl: 'https://typeorm.io', versionSensitive: false },
  sequelize: { id: 'sequelize', label: 'Sequelize', category: 'orm', keywords: ['sequelize'], docsUrl: 'https://sequelize.org/docs/v6/', versionSensitive: false },

  // --- Databases ---
  postgres: { id: 'postgres', label: 'PostgreSQL', category: 'database', keywords: ['postgres', 'postgresql'], docsUrl: 'https://www.postgresql.org/docs/', versionSensitive: false },
  sqlserver: { id: 'sqlserver', label: 'SQL Server', category: 'database', keywords: ['sql server', 'sqlserver', 'mssql'], docsUrl: 'https://learn.microsoft.com/sql/sql-server/', versionSensitive: false },
  mysql: { id: 'mysql', label: 'MySQL', category: 'database', keywords: ['mysql', 'mariadb'], docsUrl: 'https://dev.mysql.com/doc/', versionSensitive: false },
  mongodb: { id: 'mongodb', label: 'MongoDB', category: 'database', keywords: ['mongodb', 'mongo'], docsUrl: 'https://www.mongodb.com/docs/', versionSensitive: false },
  redis: { id: 'redis', label: 'Redis', category: 'database', keywords: ['redis'], docsUrl: 'https://redis.io/docs/latest/', versionSensitive: false },
  sqlite: { id: 'sqlite', label: 'SQLite', category: 'database', keywords: ['sqlite'], docsUrl: 'https://www.sqlite.org/docs.html', versionSensitive: false },

  // --- Auth ---
  'aspnet-identity': { id: 'aspnet-identity', label: 'ASP.NET Core Identity', category: 'auth', keywords: ['asp.net core identity', 'aspnet identity', 'identity framework'], docsUrl: 'https://learn.microsoft.com/aspnet/core/security/authentication/identity', versionSensitive: true },
  'next-auth': { id: 'next-auth', label: 'Auth.js / NextAuth', category: 'auth', keywords: ['next-auth', 'nextauth', 'auth.js', 'authjs'], docsUrl: 'https://authjs.dev/getting-started', versionSensitive: true },
  keycloak: { id: 'keycloak', label: 'Keycloak', category: 'auth', keywords: ['keycloak'], docsUrl: 'https://www.keycloak.org/documentation', versionSensitive: true },
  auth0: { id: 'auth0', label: 'Auth0', category: 'auth', keywords: ['auth0'], docsUrl: 'https://auth0.com/docs', versionSensitive: false },
  'entra-id': { id: 'entra-id', label: 'Microsoft Entra ID', category: 'auth', keywords: ['entra id', 'azure ad', 'azure active directory'], docsUrl: 'https://learn.microsoft.com/entra/identity-platform/', versionSensitive: false },
  'firebase-auth': { id: 'firebase-auth', label: 'Firebase Authentication', category: 'auth', keywords: ['firebase auth', 'firebase authentication'], docsUrl: 'https://firebase.google.com/docs/auth', versionSensitive: false },
  // Label carries no spec version on purpose: which OAuth revision is current is
  // itself something the research resolves (see the DESIGN NOTE on TECH_RESEARCH).
  oidc: { id: 'oidc', label: 'OAuth / OpenID Connect', category: 'auth', keywords: ['oauth', 'oauth2', 'openid connect', 'oidc', 'sso'], docsUrl: 'https://openid.net/developers/how-connect-works/', versionSensitive: true },
  jwt: { id: 'jwt', label: 'JWT (JSON Web Tokens)', category: 'auth', keywords: ['jwt', 'json web token'], docsUrl: 'https://datatracker.ietf.org/doc/html/rfc8725', versionSensitive: false },

  // --- Testing ---
  vitest: { id: 'vitest', label: 'Vitest', category: 'testing', keywords: ['vitest'], docsUrl: 'https://vitest.dev/guide/', versionSensitive: true },
  jest: { id: 'jest', label: 'Jest', category: 'testing', keywords: ['jest'], docsUrl: 'https://jestjs.io/docs/getting-started', versionSensitive: false },
  playwright: { id: 'playwright', label: 'Playwright', category: 'testing', keywords: ['playwright'], docsUrl: 'https://playwright.dev/docs/intro', versionSensitive: true },
  cypress: { id: 'cypress', label: 'Cypress', category: 'testing', keywords: ['cypress'], docsUrl: 'https://docs.cypress.io', versionSensitive: false },
  'testing-library': { id: 'testing-library', label: 'Testing Library', category: 'testing', keywords: ['testing library', 'testing-library', 'rtl'], docsUrl: 'https://testing-library.com/docs/', versionSensitive: false },
  xunit: { id: 'xunit', label: 'xUnit', category: 'testing', keywords: ['xunit'], docsUrl: 'https://xunit.net/docs/getting-started/v3/getting-started', versionSensitive: false },
  nunit: { id: 'nunit', label: 'NUnit', category: 'testing', keywords: ['nunit'], docsUrl: 'https://docs.nunit.org', versionSensitive: false },
  pytest: { id: 'pytest', label: 'pytest', category: 'testing', keywords: ['pytest'], docsUrl: 'https://docs.pytest.org/en/stable/', versionSensitive: false },

  // --- Infra ---
  docker: { id: 'docker', label: 'Docker', category: 'infra', keywords: ['docker', 'docker compose'], docsUrl: 'https://docs.docker.com', versionSensitive: false },
  kubernetes: { id: 'kubernetes', label: 'Kubernetes', category: 'infra', keywords: ['kubernetes', 'k8s'], docsUrl: 'https://kubernetes.io/docs/home/', versionSensitive: true },
  terraform: { id: 'terraform', label: 'Terraform', category: 'infra', keywords: ['terraform'], docsUrl: 'https://developer.hashicorp.com/terraform/docs', versionSensitive: true },
  'github-actions': { id: 'github-actions', label: 'GitHub Actions', category: 'infra', keywords: ['github actions'], docsUrl: 'https://docs.github.com/actions', versionSensitive: false },
  azure: { id: 'azure', label: 'Azure', category: 'infra', keywords: ['azure'], docsUrl: 'https://learn.microsoft.com/azure/', versionSensitive: false },
  aws: { id: 'aws', label: 'AWS', category: 'infra', keywords: ['aws', 'amazon web services'], docsUrl: 'https://docs.aws.amazon.com', versionSensitive: false },
  vercel: { id: 'vercel', label: 'Vercel', category: 'infra', keywords: ['vercel'], docsUrl: 'https://vercel.com/docs', versionSensitive: false },
};

/** Categories treated as the front-end side of the boundary. */
const FRONTEND_CATEGORIES = new Set(['frontend-framework', 'ui-library', 'state-data', 'mobile']);
/** Categories treated as the back-end side of the boundary. */
const BACKEND_CATEGORIES = new Set(['backend-framework', 'orm', 'database']);

/**
 * Server-side languages and the framework candidates their ecosystem defaults to.
 *
 * This closes a real gap: a demand like "back end with C#" names the LANGUAGE but
 * not the framework, so `backend` would come back empty and the front↔back
 * cross-cutting angles (integration contract, auth flow) would never fire — exactly
 * the angles that matter most for a login feature. The language therefore counts as
 * the back-end side of the boundary, and `inferStackGaps()` turns the missing
 * framework into an explicit AskUserQuestion with these candidates.
 *
 * TypeScript/JavaScript are intentionally absent: they are ambiguous (front or back),
 * and when they ARE the back end the demand names a runtime/framework (Node, Nest,
 * Express) which is already a registry entry.
 */
export const SERVER_LANGUAGE_FRAMEWORKS = {
  csharp: ['dotnet'],
  java: ['spring-boot'],
  kotlin: ['spring-boot'],
  python: ['fastapi', 'django', 'flask'],
  php: ['laravel'],
  ruby: ['rails'],
  go: ['go'],
  rust: ['rust'],
};

/**
 * Resolves a technology id into its registry entry. An id that is NOT in the
 * registry yields a generic `unknown`-category entry built from the id itself, so
 * a brand-new framework mentioned in the demand is still researched (with the
 * generic angles) instead of silently dropped. Pure and total.
 *
 * @param {string|null|undefined} id
 * @returns {{ id: string, label: string, category: string, keywords: string[], docsUrl: string|null, versionSensitive: boolean, known: boolean }}
 */
export function resolveTechEntry(id) {
  const key = normalizeResearchText(id);
  if (Object.prototype.hasOwnProperty.call(TECH_STACK_REGISTRY, key)) {
    return { ...TECH_STACK_REGISTRY[key], known: true };
  }
  return {
    id: key,
    label: String(id ?? '').trim() || 'tecnologia nao identificada',
    category: 'unknown',
    keywords: [],
    docsUrl: null,
    // An unrecognized technology is assumed fast-moving: checking the current
    // version is cheap, assuming a stale one is not.
    versionSensitive: true,
    known: false,
  };
}

/**
 * Detects the technology stack mentioned in a text (the demand, optionally
 * concatenated with the EXPLORE snapshot so a brownfield stack is picked up from
 * the codebase instead of being asked for again).
 *
 * Boundary-aware matching makes `C#`, `.NET` and `Go` detectable without the false
 * positives a substring search would produce ("algo" → Go, "abc#" → C#). Registry
 * order is preserved, so a specific entry (Next.js, React Native) is reported
 * before the broader one it contains (React).
 *
 * Pure and total: same input → same output, never throws.
 *
 * @param {string|null|undefined} text
 * @param {{ maxTechnologies?: number }} [options]
 * @returns {{ entries: object[], ids: string[], byCategory: Record<string, string[]>,
 *   frontend: string[], backend: string[], versionSensitive: string[], detected: boolean }}
 */
export function detectTechStack(text, options = {}) {
  const haystack = normalizeResearchText(text);
  const limit = Number.isSafeInteger(options?.maxTechnologies) && options.maxTechnologies > 0
    ? options.maxTechnologies
    : TECH_RESEARCH.budget.maxTechnologies;

  const entries = [];
  for (const entry of Object.values(TECH_STACK_REGISTRY)) {
    if (entries.length >= limit) break;
    const matches = entry.keywords.filter((kw) => matchesKeyword(haystack, kw));
    if (matches.length > 0) {
      entries.push({ ...entry, known: true, matches });
    }
  }

  const byCategory = {};
  for (const entry of entries) {
    byCategory[entry.category] = [...(byCategory[entry.category] ?? []), entry.id];
  }

  // A server-side LANGUAGE counts as the back-end side of the boundary, so the
  // front↔back cross-cutting angles still fire when the demand names only "C#".
  const backend = entries
    .filter(
      (e) =>
        BACKEND_CATEGORIES.has(e.category) ||
        Object.prototype.hasOwnProperty.call(SERVER_LANGUAGE_FRAMEWORKS, e.id),
    )
    .map((e) => e.id);

  return {
    entries,
    ids: entries.map((e) => e.id),
    byCategory,
    frontend: entries.filter((e) => FRONTEND_CATEGORIES.has(e.category)).map((e) => e.id),
    backend,
    versionSensitive: entries.filter((e) => e.versionSensitive === true).map((e) => e.id),
    detected: entries.length > 0,
  };
}

/**
 * Finds the under-specified parts of a detected stack and turns each into a ready
 * AskUserQuestion with concrete candidates.
 *
 * This is what prevents the technical research from confidently researching the
 * wrong thing. "Back end with C#" does not say ASP.NET Core; "login screen" does not
 * say which auth approach. Guessing produces a PRD built on an assumption the user
 * never made, so the gap is surfaced BEFORE the search budget is spent.
 *
 * Pure and total: same input → same output, never throws.
 *
 * @param {{ ids?: string[], byCategory?: Record<string,string[]>, entries?: object[] }} detected
 *   result of detectTechStack()
 * @param {string} [demanda] used to detect auth intent in the demand text
 * @returns {{ kind: string, missing: string, candidates: string[], question: string }[]}
 */
export function inferStackGaps(detected = {}, demanda = '') {
  const ids = Array.isArray(detected?.ids) ? detected.ids : [];
  const byCategory = detected?.byCategory ?? {};
  const has = (category) => Array.isArray(byCategory[category]) && byCategory[category].length > 0;
  const gaps = [];

  // 1. Server language without a framework → the ecosystem's candidates.
  if (!has('backend-framework')) {
    for (const id of ids) {
      const candidates = SERVER_LANGUAGE_FRAMEWORKS[id];
      if (!candidates) continue;
      const framework = candidates.filter((c) => c !== id);
      if (framework.length === 0) continue;
      gaps.push({
        kind: 'backend-framework-missing',
        missing: 'backend-framework',
        candidates: framework,
        question:
          `A demanda cita ${resolveTechEntry(id).label} no back-end, mas nao o framework. ` +
          `Qual sera usado? (candidatos do ecossistema: ${framework.map((c) => resolveTechEntry(c).label).join(', ')})`,
      });
      break;
    }
  }

  // 2. Auth intent in the demand with no auth technology chosen.
  const wantsAuth = ['login', 'autenticacao', 'autenticar', 'cadastro de usuario', 'signup', 'sign up', 'sso', 'auth']
    .some((kw) => matchesKeyword(normalizeResearchText(demanda), kw));
  if (wantsAuth && !has('auth')) {
    const backendIds = Array.isArray(detected?.backend) ? detected.backend : [];
    const candidates = backendIds.includes('dotnet') || backendIds.includes('csharp')
      ? ['aspnet-identity', 'oidc', 'jwt']
      : backendIds.includes('nextjs') || ids.includes('nextjs')
      ? ['next-auth', 'oidc', 'jwt']
      : ['oidc', 'jwt', 'keycloak'];
    gaps.push({
      kind: 'auth-approach-missing',
      missing: 'auth',
      candidates,
      question:
        'A demanda envolve login/autenticacao, mas nao define a abordagem. ' +
        `Usar qual? (${candidates.map((c) => resolveTechEntry(c).label).join(', ')}) ` +
        'A escolha muda o que a pesquisa tecnica precisa confirmar (armazenamento de token, refresh, hashing, lockout).',
    });
  }

  // 3. Persistence implied by a back end but no database chosen.
  if ((has('backend-framework') || (Array.isArray(detected?.backend) && detected.backend.length > 0)) && !has('database')) {
    gaps.push({
      kind: 'database-missing',
      missing: 'database',
      candidates: ['postgres', 'sqlserver', 'mysql', 'mongodb'],
      question:
        'Ha back-end mas nenhum banco de dados definido. Qual sera usado? ' +
        '(a escolha define modelagem, migrations e os padroes de acesso a dados pesquisados)',
    });
  }

  return gaps;
}

/**
 * Decides whether the technical track runs now, later, or not at all.
 *
 * `deferToArch` is the important case: when no stack can be detected from the
 * demand or the codebase, there is nothing to research YET — the stack is only
 * settled in ARCH (greenfield interview / project analysis). The track is then
 * marked deferred and ARCH performs the top-up with the resolved stack, reusing
 * the very same query-plan functions. This keeps the flow honest instead of
 * researching a stack the user has not chosen.
 *
 * @param {{ stackDetected?: boolean, isGreenfield?: boolean, isInternalOnly?: boolean,
 *   touchesArchitecture?: boolean, techCount?: number }} [signals]
 * @returns {{ relevant: boolean, depth: 'lite'|'completo', deferToArch: boolean, reason: string }}
 */
export function techResearchRelevance(signals = {}) {
  const {
    stackDetected = false,
    isGreenfield = false,
    isInternalOnly = false,
    touchesArchitecture = false,
    techCount = 0,
  } = signals ?? {};

  if (isInternalOnly === true && touchesArchitecture !== true) {
    return {
      relevant: false,
      depth: 'lite',
      deferToArch: false,
      reason: 'Demanda sem impacto de arquitetura/implementacao: nao ha padrao de stack a pesquisar.',
    };
  }

  if (stackDetected !== true) {
    return {
      relevant: true,
      depth: 'lite',
      deferToArch: true,
      reason:
        'Stack ainda nao definida (nem na demanda, nem no codigo existente): o track tecnico e diferido para o ARCH, ' +
        'que resolve a stack (analise do projeto ou entrevista greenfield) e roda o top-up com o mesmo plano de consultas.',
    };
  }

  const deep = isGreenfield === true || Number(techCount) >= 3;

  return {
    relevant: true,
    depth: deep ? 'completo' : 'lite',
    deferToArch: false,
    reason: deep
      ? `Stack com ${techCount} tecnologia(s) e/ou greenfield: pesquisa tecnica completa (${TECH_RESEARCH.budget.completoQueries} consultas).`
      : `Stack enxuta (${techCount} tecnologia(s)) sobre projeto existente: pesquisa tecnica reduzida (${TECH_RESEARCH.budget.liteQueries} consultas).`,
  };
}

/**
 * Builds the deterministic technical query plan in THREE phases, so the budget is
 * never consumed by the first technology in the list:
 *
 *   1. `version-currency` for every version-sensitive technology. Mandatory and
 *      first: every later answer ("recommended project structure", "recommended
 *      auth approach") is only meaningful relative to the current major version.
 *      This is the phase that neutralizes the training-cutoff drift.
 *   2. `stack-patterns` in ROUND-ROBIN across technologies (first angle of each,
 *      then the second of each, …). A naive per-technology loop spent the whole
 *      budget on React and left the C# back end with almost nothing.
 *   3. Cross-cutting angles (integration contract, auth flow, conventions), with
 *      their slots RESERVED up front — they were being truncated away, which is
 *      precisely backwards: the front↔back boundary is where integration mistakes
 *      concentrate, and no per-technology query surfaces them.
 *
 * BUDGET SEMANTICS: phases 1 and 3 are MANDATORY and never truncated; the depth
 * budget governs how many phase-2 queries fit alongside them. So the returned plan
 * can exceed `liteQueries` when the stack is large — six technologies genuinely
 * require six version checks, and silently dropping one would reintroduce exactly
 * the staleness this track exists to remove. (In the real flow that combination
 * does not arise: techResearchRelevance() already returns `completo` from three
 * technologies up.)
 *
 * Pure and total: same input → same output, never throws.
 *
 * @param {{ stack?: string[], demanda?: string, depth?: 'lite'|'completo' }} [options]
 * @returns {{ id: string, kind: string, tech: string|null, query: string, purpose: string, docsUrl: string|null }[]}
 */
export function techResearchQueryPlan(options = {}) {
  const { stack = [], demanda = '', depth = 'completo' } = options ?? {};
  const ids = (Array.isArray(stack) ? stack : [])
    .filter(Boolean)
    .slice(0, TECH_RESEARCH.budget.maxTechnologies);
  const entries = ids.map((id) => resolveTechEntry(id));

  const expandFor = (entry, template) =>
    String(template).replaceAll('{{tech}}', entry.label.toLowerCase()).replace(/\s+/g, ' ').trim();

  // --- Phase 1: mandatory version currency ---------------------------------
  const versionQueries = entries
    .filter((entry) => entry.versionSensitive === true)
    .map((entry) => ({
      kind: 'version-currency',
      tech: entry.id,
      query: expandFor(entry, TECH_VERSION_ANGLE),
      purpose:
        'OBRIGATORIA: confirmar a versao estavel atual e o que mudou — sem isso todo padrao recomendado fica ancorado no corte de treinamento.',
      docsUrl: entry.docsUrl,
    }));

  // --- Phase 2: stack patterns, round-robin across technologies ------------
  const anglesByEntry = entries.map((entry) => ({
    entry,
    angles: (TECH_CATEGORY_ANGLES[entry.category] ?? TECH_CATEGORY_ANGLES.unknown).slice(
      0,
      TECH_RESEARCH.budget.maxAnglesPerTech,
    ),
  }));
  const maxRounds = Math.max(0, ...anglesByEntry.map((a) => a.angles.length));
  const patternQueries = [];
  for (let round = 0; round < maxRounds; round++) {
    for (const { entry, angles } of anglesByEntry) {
      if (round >= angles.length) continue;
      patternQueries.push({
        kind: 'stack-patterns',
        tech: entry.id,
        query: expandFor(entry, angles[round]),
        purpose: 'Estrutura de projeto, padroes de arquitetura/design, convencoes e anti-padroes vigentes.',
        docsUrl: entry.docsUrl,
      });
    }
  }

  // --- Phase 3: cross-cutting (reserved slots) -----------------------------
  const frontendLabel = entries.find((e) => FRONTEND_CATEGORIES.has(e.category))?.label ?? '';
  // Prefer the concrete framework over the bare language: "react + asp.net core"
  // is a far better integration query than "react + c#".
  const backendLabel =
    entries.find((e) => e.category === 'backend-framework')?.label ??
    entries.find(
      (e) =>
        BACKEND_CATEGORIES.has(e.category) ||
        Object.prototype.hasOwnProperty.call(SERVER_LANGUAGE_FRAMEWORKS, e.id),
    )?.label ??
    '';
  const primaryLabel = entries[0]?.label ?? normalizeResearchText(demanda);

  const crossQueries = [];
  for (const angle of TECH_CROSS_CUTTING_ANGLES) {
    // A boundary angle is meaningless without both sides of the boundary.
    const needsBothSides =
      angle.template.includes('{{frontend}}') && angle.template.includes('{{backend}}');
    if (needsBothSides && (frontendLabel === '' || backendLabel === '')) continue;

    const query = String(angle.template)
      .replaceAll('{{frontend}}', frontendLabel.toLowerCase())
      .replaceAll('{{backend}}', backendLabel.toLowerCase())
      .replaceAll('{{primary}}', String(primaryLabel).toLowerCase())
      .replace(/\s+/g, ' ')
      .trim();
    if (query === '') continue;

    crossQueries.push({ kind: angle.kind, tech: null, query, purpose: angle.purpose, docsUrl: null });
  }

  const limit =
    depth === 'lite' ? TECH_RESEARCH.budget.liteQueries : TECH_RESEARCH.budget.completoQueries;

  // Version currency and cross-cutting are mandatory; only phase 2 absorbs the cut.
  // No final slice(): it would silently drop a mandatory query (see BUDGET SEMANTICS).
  const patternSlots = Math.max(0, limit - versionQueries.length - crossQueries.length);
  const ordered = [...versionQueries, ...patternQueries.slice(0, patternSlots), ...crossQueries];

  return ordered.map((item, index) => ({ id: `t${index + 1}`, ...item }));
}

/**
 * Builds the path of the technical-research snapshot inside the update directory.
 * Working file, like codebase-memory.md / market-research.md / architecture.md —
 * NOT part of buildArtifactList.
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function techResearchSnapshotPath(featurePath) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${TECH_RESEARCH.snapshotFile}`;
}

/**
 * Classifies the adoption status of a researched technical pattern — the gate that
 * keeps stale practice out of the PRD.
 *
 * Precedence, strongest signal first:
 *   1. The official docs discourage it, or it has a documented replacement → `deprecated`.
 *   2. It is flagged experimental/preview/RFC → `experimental`.
 *   3. Official docs back it AND the evidence is recent → `current`.
 *   4. Anything else → `legacy`: it may still work, but it is not today's
 *      recommended approach and cannot be presented as such.
 *
 * Only `current` (and a consciously chosen `experimental`) may become a PRD
 * decision. `legacy` requires an explicit justification; `deprecated` belongs in
 * the anti-patterns section.
 *
 * Pure and total: same input → same output, never throws.
 *
 * @param {{ discouraged?: boolean, replacedBy?: string|null, experimental?: boolean,
 *   inOfficialDocs?: boolean, sourceAgeMonths?: number }} [signals]
 * @returns {'current'|'experimental'|'legacy'|'deprecated'}
 */
export function classifyPatternAdoption(signals = {}) {
  const {
    discouraged = false,
    replacedBy = null,
    experimental = false,
    inOfficialDocs = false,
    sourceAgeMonths = Number.POSITIVE_INFINITY,
  } = signals ?? {};

  if (discouraged === true) return 'deprecated';
  if (typeof replacedBy === 'string' && replacedBy.trim() !== '') return 'deprecated';
  if (experimental === true) return 'experimental';

  const rawAge = Number(sourceAgeMonths);
  const age = Number.isFinite(rawAge) ? Math.max(rawAge, 0) : Number.POSITIVE_INFINITY;

  if (inOfficialDocs === true && age <= PATTERN_STALENESS_MONTHS) return 'current';
  return 'legacy';
}

/**
 * Records the technical-research outcome on the state.
 *
 * `status`:
 *   - `DONE`     — researched, findings recorded.
 *   - `PARTIAL`  — some queries failed / budget exhausted; gaps marked TBD.
 *   - `DEFERRED` — stack unknown at RESEARCH; ARCH performs the top-up.
 *   - `SKIPPED`  — no architectural/implementation impact, or no web access and the
 *                  user opted out.
 *
 * @param {StageState} state
 * @param {{ status?: 'DONE'|'PARTIAL'|'DEFERRED'|'SKIPPED', stack?: string[],
 *   versions?: Record<string,string>, patterns?: object[], conventions?: object[],
 *   antiPatterns?: object[], sources?: string[], notes?: string }} [research]
 * @returns {StageState}
 */
export function withTechResearch(state, research = {}) {
  const stack = (Array.isArray(research?.stack) ? research.stack : state?.techStack ?? [])
    .filter(Boolean)
    .map((id) => resolveTechEntry(id).id);

  return {
    ...state,
    techStack: stack,
    techResearch: {
      status: ['DONE', 'PARTIAL', 'DEFERRED', 'SKIPPED'].includes(research?.status)
        ? research.status
        : 'PARTIAL',
      stack,
      versions: research?.versions && typeof research.versions === 'object' ? research.versions : {},
      patterns: Array.isArray(research?.patterns) ? research.patterns : [],
      conventions: Array.isArray(research?.conventions) ? research.conventions : [],
      antiPatterns: Array.isArray(research?.antiPatterns) ? research.antiPatterns : [],
      sources: Array.isArray(research?.sources) ? research.sources : [],
      notes: typeof research?.notes === 'string' ? research.notes : '',
    },
  };
}

// ---------------------------------------------------------------------------
// Output/artifact mode (PRD vs OpenSpec) — orthogonal to execution mode
// ---------------------------------------------------------------------------

/**
 * The artifact mode selects WHICH base deliverable the flow produces. It is
 * orthogonal to the execution mode (--mode) and to the domain lenses.
 *
 *   - `prd` (default): the classic Pensador flow. PRD_BASE drafts a base PRD and
 *     FINAL emits prd.md (+ userhistory.md, + communication.md when backend).
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
 * Records whether ARCH found no relevant existing codebase (greenfield) or is
 * building on top of one (brownfield). ARCH calls this once it resolves the
 * signal (project existing vs. greenfield interview). Feeds detectComplexity()
 * directly AND travels downstream through project-baseline.json (see
 * buildArtifactList) so the Orchestrador/Executor consume the Pensador's
 * finding instead of re-deriving it independently and possibly disagreeing.
 *
 * @param {StageState} state
 * @param {boolean} isGreenfield
 * @returns {StageState}
 */
export function withGreenfieldSignal(state, isGreenfield) {
  return { ...state, isGreenfield: Boolean(isGreenfield) };
}

/**
 * OpenSpec (https://github.com/Fission-AI/OpenSpec) descriptor.
 *
 * In spec mode the Pensador does NOT hand-write the change files: it drives the
 * `/opsx:*` slash commands (the CORE profile, the default since OpenSpec 1.4 —
 * `openspec init` never installs the expanded profile unless explicitly
 * configured), which scaffold and manage the change set under
 * `openspec/changes/<name>/`. `expandedCommands` are opportunistic extras,
 * never a requirement. Detection (CLI on PATH + version floor, an initialized
 * `openspec/` root, installed skill directories) lives in preflight.mjs.
 *
 * If the `/opsx:*` commands are unavailable when spec mode is chosen, the
 * Pensador must NOT create the structure manually nor proceed as plain Claude:
 * it asks (via AskUserQuestion) whether to fall back to PRD mode or abort.
 *
 * Archiving is ALWAYS done via `openspec archive <name> --json --yes` (and
 * `--skip-specs` when applicable) — never a hand-rolled `mkdir`/`mv`. The
 * OpenSpec agent contract explicitly forbids manually creating, moving, or
 * deleting anything under `openspec/`.
 */
export const OPENSPEC = {
  cli: 'openspec',
  package: '@fission-ai/openspec',
  repo: 'https://github.com/Fission-AI/OpenSpec',
  /** Lowest CLI version this integration is written against (1.9.0: honest root resolution, reliable archive exit codes). */
  minVersion: '1.9.0',
  /** Version the docs/flow are written against; below this, features work but are undertested here. */
  recommendedVersion: '1.10.0',
  minNodeVersion: '20.19.0',
  dir: 'openspec',
  /** Root config written by `openspec init` (schema + optional context/rules/operations). */
  configFile: 'openspec/config.yaml',
  specsDir: 'openspec/specs',
  changesDir: 'openspec/changes',
  optional: true,
  /** The profile this integration targets. `openspec init` installs this by default. */
  profile: 'core',
  /** /opsx:* slash commands from the CORE profile (installed by `openspec init` by default). */
  commands: {
    explore: '/opsx:explore',
    propose: '/opsx:propose',
    apply: '/opsx:apply',
    update: '/opsx:update',
    sync: '/opsx:sync',
    archive: '/opsx:archive',
  },
  /** Skill directory names backing each core command (`.claude/skills/<name>/SKILL.md`). */
  skills: {
    explore: 'openspec-explore',
    propose: 'openspec-propose',
    apply: 'openspec-apply-change',
    update: 'openspec-update-change',
    sync: 'openspec-sync-specs',
    archive: 'openspec-archive-change',
  },
  /**
   * /opsx:* slash commands from the EXPANDED profile. Only present when the
   * user ran `openspec config profile` to opt in; the flow must never require
   * them — `commands`/`cliCalls` above are always sufficient.
   */
  expandedCommands: {
    new: '/opsx:new',
    continue: '/opsx:continue',
    ff: '/opsx:ff',
    verify: '/opsx:verify',
    bulkArchive: '/opsx:bulk-archive',
    onboard: '/opsx:onboard',
  },
  /**
   * Scriptable CLI calls the flow uses directly instead of expanded-profile
   * commands (all support --json; see docs/agent-contract.md).
   */
  cliCalls: {
    doctor: 'openspec doctor --json',
    list: 'openspec list --json',
    status: 'openspec status --change <name> --json',
    instructions: 'openspec instructions <artifact> --change <name> --json',
    validate: 'openspec validate <name> --strict --json',
    archive: 'openspec archive <name> --json --yes',
  },
  /** Exit-code contract (docs/agent-contract.md). */
  exitCodes: { ok: 0, error: 1, promptCancelled: 130 },
  /** Diagnostic codes the flow may see in --json error payloads. */
  diagnosticCodes: [
    'no_openspec_root',
    'openspec_config_missing',
    'archive_confirmation_required',
  ],
  /** Files OpenSpec scaffolds inside openspec/changes/<name>/. `specs/` is omitted when the change sets `skip_specs: true`. */
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
   * NOTE: upstream now documents a one-line hosted installer
   * (`open-design.ai/install.sh | sh -s <agent>`), but this repo deliberately
   * does NOT use it — it is opaque (nothing to review before running it) and
   * this repo already clones the source, which is auditable. Open Design is a
   * local-first daemon + web/desktop app run via Docker or a pnpm dev
   * environment (Node 24 + pnpm 10.33). `od mcp install <agent>` DOES exist
   * and is the real post-setup step that wires the daemon's stdio MCP server
   * into the agent. See the canonical-sources note in
   * skills/pensador/references/open-design.md — the root CHANGELOG.md is
   * stale; do not re-derive install instructions from it.
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
    /**
     * Canonical file-access verbs, in order of preference:
     *   1. `od get-file design-systems/<id>/<file>` — CLI verb, routes through the
     *      daemon which compiles tokens.css on demand (most reliable for all files).
     *   2. MCP `get_file` tool — same daemon route, agent-native.
     *   3. On-disk clone `open-design/design-systems/<id>/` — fastest, no network,
     *      but requires a local clone; tokens.css may be absent for DESIGN.md-only
     *      systems (the daemon compiles it; the clone may not have it pre-built).
     *
     * Do NOT fabricate a REST file endpoint — `GET /api/design-systems/<id>` returns
     * only metadata + DESIGN.md, not raw file bodies for tokens.css/components.html.
     */
    odGetFile: 'od get-file design-systems/<id>/<file>',
    mcpGetFile: 'get_file (Open Design MCP tool) — pulls a system file verbatim (tokens.css, components.html, …)',
    clonedSystemsDir: 'open-design/design-systems/<id>/  (filesystem source when no REST/MCP file access)',
    /**
     * Deterministic artifact-quality gate (upstream 0.20.0+, unverified locally —
     * see the "Suposições não verificadas" note in the implementation plan).
     * Accepts a file or stdin, applies a failure threshold, returns readable or
     * JSON findings WITHOUT invoking a model. Optional, capability-probed by
     * checkOpenDesign() — never assumed present.
     */
    odLint: 'od lint <file> --json',
    /** Plugin/marketplace vocabulary (upstream 0.8.0+; documentation-only here). */
    pluginInstall: 'od plugin install github:<owner>/<repo>[@<version>][/<subfolder>]',
    pluginDoctor: 'od plugin doctor',
    marketplaceAdd: 'od marketplace add <url>',
  },
  /**
   * The verbatim artifacts every curated/imported system ships. Entries ending
   * with '/' are directories copied recursively; entries without are plain files.
   * The Pensador must fetch ALL of these — not just DESIGN.md — and persist them
   * into the target repo so the front-end agent consumes tokens.css/components.html
   * DIRECTLY, never a prose re-write. `tokens.css` is the source of truth;
   * inventing tokens is forbidden by the Open Design skills protocol.
   *
   * Read order (agent consumption): manifest.json → USAGE.md → DESIGN.md →
   * tokens.css (paste first) → design-tokens.json / tailwind-v4.css (alternate
   * consumption forms of the same tokens) → components.html →
   * components.manifest.json → assets/ → fonts/ (typography fidelity) →
   * preview/ (visual sanity check).
   *
   * This list is the FALLBACK used when a system ships no manifest.json (legacy
   * DESIGN.md-only systems). When manifest.json IS present, od-fetch-system.mjs
   * derives the authoritative file list from its `files`/`usage`/
   * `componentsManifest`/`preview.pages[]`/`sourceFiles` fields instead — see
   * that script's `deriveExpectedFiles()`.
   */
  systemArtifacts: [
    'manifest.json',         // machine-readable entry point — schemaVersion 'od-design-system-project/v1' when present; drives od-fetch-system.mjs's per-system file list
    'USAGE.md',              // router: how to consume the package (read first)
    'DESIGN.md',             // intent: prose (>=7 H2 sections upstream; this repo targets the 9-section designSchema below) + anti-patterns
    'tokens.css',            // SOURCE OF TRUTH: compiled CSS custom properties — paste before any component CSS
    'design-tokens.json',    // machine-readable token export (same values as tokens.css, structured)
    'tailwind-v4.css',       // Tailwind v4 @theme mapping onto the same custom properties
    'components.html',       // fixtures: real component HTML/CSS + states
    'components.manifest.json', // component inventory
    'assets/',               // optional brand assets directory
    'fonts/',                // optional webfont files — required for typography fidelity
    'preview/',              // visual sanity-check dir — contents vary by system (colors.html / spacing.html / typography.html / …)
  ],
  /** Schema version manifest.json declares when present (upstream 'design-systems' contract). */
  manifestSchemaVersion: 'od-design-system-project/v1',
  /** Eventual UI-package location the executor MATERIALIZES the verbatim files
   *  into during implementation. The Pensador itself persists them under
   *  <featurePath>/design-systems/<id>/ (see designSystemFilesRoot). */
  systemsDir: 'packages/ui/design-systems',
  /**
   * The 9-section DESIGN.md schema used as the brand contract for the INLINE
   * fallback (Open Design unavailable/declined). Every section the Pensador
   * parses from the design brief maps onto one of these.
   *
   * Upstream curated DESIGN.md files only require "at least seven substantive
   * H2 sections" without a fixed template — this 9-section list is this repo's
   * own canonical target, a superset that satisfies that minimum.
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
 * Root directory (relative to the repo) under which the Open Design VERBATIM
 * system files are persisted by the Pensador. Per the handoff contract, every
 * Pensador artifact lives under the feature root `.pensador/<slug>-vN/` — the
 * producer never writes into the project's real source tree. So the verbatim
 * files land in `<featurePath>/design-systems/<id>/`, NOT in the eventual UI
 * package (`packages/ui`); the downstream Orchestrator/Executor materializes
 * them into `state.uiPackageDir` during implementation.
 *
 * Falls back to `.pensador/atualizacao-v1` when featurePath is unset, mirroring
 * designSystemArtifactPath. Pure and total: same input → same output.
 *
 * @param {string|null|undefined} featurePath
 * @returns {string}
 */
export function designSystemFilesRoot(featurePath) {
  return String(featurePath || '.pensador/atualizacao-v1').replace(/\/+$/, '');
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
    'sectorContext',      // setor/indústria do negócio (ex.: oficina automotiva, clínica,
                           // e-commerce de moda) — orienta iconografia, imagery de produto/
                           // serviço e microcopy de domínio; sem isso o system fica com
                           // "vibe" genérica de marca sem nada do ramo real do usuário
    'visualTone',          // ex.: "clean azul/grafite tipo Linear/Vercel", "vibrante"
    'brandReferences',     // produtos/sites de referência ou identidade existente
    'colorPalette',        // cor de marca, neutros, semânticas (sucesso/erro/aviso)
    'typography',          // famílias, escala, pesos
    'componentStates',     // default/hover/focus/active/disabled/loading/vazio/erro
    'responsiveness',      // breakpoints, grid, densidade
    'accessibility',       // contraste, foco, leitura de tela, alvo WCAG
    'microcopy',           // voz/tom de textos, mensagens de estado
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
    sectorContext: 'input',       // orienta imagery/iconografia de produto-serviço e o
                                   // vocabulário de domínio da microcopy (não é tema visual)
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
 * them); the rest are best-effort. `od-fetch-system.mjs` attempts all three
 * resolution paths (clone → od get-file → REST) before declaring required files
 * missing. Pure and total: same input → same output.
 *
 * The `rootDir` is the directory under which `design-systems/<id>/` is created.
 * In the Pensador flow this is the FEATURE ROOT (`.pensador/<slug>-vN/`, via
 * designSystemFilesRoot) so the verbatim files stay inside the producer's
 * artifact root — NOT the eventual UI package. The legacy default remains
 * `packages/ui` only for direct/standalone callers.
 *
 * @param {string[]|null|undefined} systemIds  selected/imported system slugs
 * @param {string} [rootDir='packages/ui']  base dir under which design-systems/<id>/ lands
 * @returns {{ id: string, destDir: string, files: { source: string, dest: string, required: boolean }[] }[]}
 */
export function openDesignFetchPlan(systemIds, rootDir = 'packages/ui') {
  const ids = Array.isArray(systemIds) ? systemIds.filter(Boolean) : [];
  const base = `${String(rootDir).replace(/\/+$/, '')}/design-systems`;
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
 * modes. The verbatim system files (tokens.css, DESIGN.md, components.html, …)
 * are always persisted by the Pensador under the FEATURE ROOT
 * (`<featurePath>/design-systems/<id>/`, see designSystemFilesRoot); `systemsDir`
 * here is the eventual UI-package target the executor materializes into.
 *
 * This is the Open-Design-in-use delivery descriptor: when a system is fetched,
 * its verbatim DESIGN.md IS the design document, so the Pensador emits NO standalone
 * design-system.md (in either mode). What changes per mode is only WHERE the design
 * decisions and the design-system requirements are recorded:
 *
 *  - PRD mode  → decisions/requirements live in the verbatim DESIGN.md (plus the
 *    design-system-files handoff entry carrying the concrete <id>).
 *  - Spec mode → folded into the OpenSpec change: decisions go into `design.md`
 *    (Decisions section) and the UI design-system requirements become a delta
 *    spec capability `specs/ui-design-system/spec.md` (normative SHALL/Scenario
 *    form: use tokens.css, never invent tokens, accent ≤ 2×, WCAG AA). The
 *    Pensador does NOT hand-write these — it feeds the `openspec-*` commands.
 *
 * The standalone `design-system.md` exists ONLY on the inline fallback path
 * (Open Design unavailable / declined) — see planArtifacts, which gates
 * `designSystem` on `hasFrontend && !usesOpenDesign`. Pure and total.
 *
 * @param {'prd'|'spec'|undefined} artifactMode
 * @param {string} [changeName='<name>']  the OpenSpec change folder name
 * @returns {{ mode: 'prd'|'spec', systemsDir: string, standaloneArtifact: boolean, decisionsDoc: string, requirementsDoc: string }}
 */
export function openDesignDeliveryFor(artifactMode, changeName = '<name>') {
  const spec = resolveArtifactMode(artifactMode) === 'spec';
  const changeDir = `openspec/changes/${changeName}`;
  // The verbatim DESIGN.md that ships inside every fetched system — relative to
  // the artifactRoot, matching the design-system-files handoff path convention.
  const verbatimDesignDoc = 'design-systems/<id>/DESIGN.md';
  return {
    mode: spec ? 'spec' : 'prd',
    // Eventual UI-package target the executor materializes into (both modes).
    systemsDir: OPEN_DESIGN.systemsDir,
    // When Open Design is used, its verbatim DESIGN.md IS the design document —
    // the Pensador never writes a redundant standalone design-system.md (this
    // function only describes the Open-Design-in-use delivery). The inline
    // design-system.md exists solely on the fallback path (no system selected).
    standaloneArtifact: false,
    // Where the design DECISIONS live. PRD mode → the verbatim DESIGN.md (+ the
    // design-system-files handoff entry carrying the concrete <id>). Spec mode →
    // the OpenSpec change's design.md Decisions section.
    decisionsDoc: spec ? `${changeDir}/design.md` : verbatimDesignDoc,
    // Where the UI design-system REQUIREMENTS live.
    requirementsDoc: spec
      ? `${changeDir}/specs/ui-design-system/spec.md`
      : verbatimDesignDoc,
  };
}

/**
 * Spec-mode contract binding the OpenSpec change files to the Open Design design
 * system. This closes a real gap: in spec mode the change set is scaffolded under
 * `openspec/changes/<name>/` while the verbatim system files are persisted by the
 * Pensador under `<featurePath>/design-systems/<id>/` — two DIFFERENT trees. With
 * no explicit contract, the generated `design.md`/`ui-design-system` spec would
 * have no reliable pointer to the real tokens, and the executor would not know
 * where to source them from. This descriptor gives the LLM the exact, concrete
 * paths every OpenSpec artifact MUST reference.
 *
 * Path roles per system:
 *   - `verbatimDir` / `tokens` / `designMd` / `components`: the SOURCE the Pensador
 *     produced, under the feature root (handoff `design-system-files`). The
 *     `design.md` Decisions section cites these so the executor knows the origin.
 *   - `materializeInto` / `materializedTokens`: the RUNTIME target the executor
 *     copies into. The `ui-design-system` spec requirements cite `materializedTokens`
 *     because the spec describes the final code's consumption path.
 *
 * Pure and total: same input → same output, never throws, no I/O.
 *
 * @param {string|null|undefined} featurePath
 * @param {string[]|null|undefined} systemIds  the concrete system ids (state.designSystems)
 * @param {string} [uiPackageDir='packages/ui']  the runtime UI-package target
 * @returns {{
 *   changeName: string, changeDir: string, designDoc: string,
 *   capabilityName: string, capabilitySpec: string,
 *   systems: { id: string, verbatimDir: string, tokens: string, designMd: string,
 *     components: string, materializeInto: string, materializedTokens: string }[]
 * }}
 */
export function openDesignSpecContract(featurePath, systemIds, uiPackageDir = 'packages/ui') {
  const changeName = openspecChangeName(featurePath);
  const changeDir = openspecChangeDir(featurePath);
  const root = designSystemFilesRoot(featurePath);
  const uiRoot = String(uiPackageDir || 'packages/ui').replace(/\/+$/, '');
  const ids = Array.isArray(systemIds) ? systemIds.filter(Boolean) : [];
  return {
    changeName,
    changeDir,
    // Design DECISIONS: which system, why, overrides, and the source/target paths.
    designDoc: `${changeDir}/design.md`,
    // UI design-system REQUIREMENTS as a delta-spec capability. This is the
    // canonical WRITE path; OpenSpec 1.7+ also supports nested capability
    // paths (specs/<area>/<capability>/spec.md) when reading existing specs,
    // so consumers should not assume this exact depth when scanning.
    capabilityName: 'ui-design-system',
    capabilitySpec: `${changeDir}/specs/ui-design-system/spec.md`,
    systems: ids.map((id) => {
      const src = `${root}/design-systems/${id}`;
      const dst = `${uiRoot}/design-systems/${id}`;
      return {
        id,
        verbatimDir: `${src}/`,
        tokens: `${src}/tokens.css`,
        designMd: `${src}/DESIGN.md`,
        components: `${src}/components.html`,
        materializeInto: `${dst}/`,
        materializedTokens: `${dst}/tokens.css`,
      };
    }),
  };
}

/**
 * Suggests the UI package directory where Open Design verbatim system files
 * should be persisted, based on architecture signals detected in ARCH/EXPLORE.
 *
 * The SKILL.md layer calls this in ARCH to seed `state.uiPackageDir` and
 * presents the result to the user via AskUserQuestion when the signal is
 * ambiguous. The engine default ('packages/ui') is the correct monorepo path;
 * single-app projects typically use 'src/styles'. Pure and total.
 *
 * @param {{ isMonorepo?: boolean, framework?: string }} [signals]
 * @returns {string}
 */
export function resolveUiPackageDir(signals = {}) {
  const { isMonorepo, framework } = signals ?? {};
  if (isMonorepo) return 'packages/ui';
  if (framework === 'nextjs' || framework === 'next') return 'src/styles';
  if (framework === 'vite' || framework === 'remix' || framework === 'nuxt') return 'src/styles';
  // Unknown or single-app without detected framework: ask user (this value is the safe default).
  return 'src/styles';
}

// ---------------------------------------------------------------------------
// Project classification & fullstack detection
// ---------------------------------------------------------------------------

/**
 * Classifies a set of consolidated requirements by the layers they mention.
 * Deterministic and total: same input → same result, never throws.
 *
 * NOTE: this is a keyword heuristic to *signal* relevance of the BACKEND /
 * UIUX / FRONTEND brainstorm stages and to gate the communication artifact.
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
// API/communication contract (Spec-Driven Development) — machine-readable
// source of truth + derived human-readable view.
// ---------------------------------------------------------------------------

/**
 * SDD principle applied to the front↔back (or back↔consumer) boundary: the
 * SOURCE OF TRUTH is a machine-readable contract that can drive mocks
 * (Prism), contract tests (Schemathesis/Pact) and codegen — NOT prose. The
 * Markdown `communication.md` becomes a human-readable VIEW derived from it.
 *
 * The concrete contract format follows the API style detected in ARCH
 * (state.apiStyle). Each entry pins the machine-readable file, the spec family,
 * and the validation/mock tooling directive carried in the handoff so the
 * downstream Executor can enforce "the spec is law" in CI.
 */
export const API_CONTRACT_FORMATS = {
  rest: {
    style: 'rest',
    spec: 'openapi',
    file: 'openapi.yaml',
    label: 'OpenAPI 3.1 (REST/JSON)',
    mock: 'prism mock openapi.yaml',
    validate: 'schemathesis run openapi.yaml',
  },
  graphql: {
    style: 'graphql',
    spec: 'graphql-sdl',
    file: 'schema.graphql',
    label: 'GraphQL SDL',
    mock: 'graphql-faker schema.graphql',
    validate: 'graphql-inspector validate schema.graphql',
  },
  grpc: {
    style: 'grpc',
    spec: 'protobuf',
    file: 'service.proto',
    label: 'Protocol Buffers (gRPC)',
    mock: 'grpcmock service.proto',
    validate: 'buf lint service.proto',
  },
  events: {
    style: 'events',
    spec: 'asyncapi',
    file: 'asyncapi.yaml',
    label: 'AsyncAPI 3 (eventos/filas/webhooks)',
    mock: 'microcks-cli asyncapi.yaml',
    validate: 'asyncapi validate asyncapi.yaml',
  },
};

/** Default API style when ARCH has not (yet) detected a more specific one. */
export const DEFAULT_API_STYLE = 'rest';

/**
 * Normalizes an API-style key into a concrete contract format descriptor.
 * Unknown / nullish → the default (rest → OpenAPI). Pure and total.
 *
 * @param {string|null|undefined} apiStyle
 * @returns {typeof API_CONTRACT_FORMATS['rest']}
 */
export function resolveContractFormat(apiStyle) {
  const key = Object.prototype.hasOwnProperty.call(API_CONTRACT_FORMATS, apiStyle)
    ? apiStyle
    : DEFAULT_API_STYLE;
  return API_CONTRACT_FORMATS[key];
}

/**
 * Builds the path of the machine-readable contract artifact inside the update
 * directory. This is a FINAL artifact (source of truth) written whenever the
 * demand has a back-end in PRD mode. Pure and total.
 *
 * @param {string|null|undefined} featurePath
 * @param {string|null|undefined} apiStyle
 * @returns {string}
 */
export function contractArtifactPath(featurePath, apiStyle) {
  const base = featurePath ? `${featurePath}/` : '.pensador/atualizacao-v1/';
  return `${base}${resolveContractFormat(apiStyle).file}`;
}

/**
 * Returns the mock + validation directive for a given API style, carried in the
 * handoff `api-contract` role so the Executor can spin up a mock server (enabling
 * the parallel front/back contract-first workflow) and validate the code against
 * the contract in CI ("the spec is law"). Pure and total.
 *
 * @param {string|null|undefined} apiStyle
 * @returns {{ spec: string, mock: string, validate: string }}
 */
export function contractValidationPlan(apiStyle) {
  const fmt = resolveContractFormat(apiStyle);
  return { spec: fmt.spec, mock: fmt.mock, validate: fmt.validate };
}

/**
 * Glob patterns the Pensador scans in EXPLORE/ARCH to DISCOVER an existing API
 * contract in a brownfield project, so a new feature EXTENDS the current contract
 * instead of re-describing it in prose (cohesion between existing front and back).
 * The discovered baseline is recorded in codebase-memory.md / architecture.md.
 *
 * @returns {string[]}
 */
export function contractDiscoveryGlobs() {
  return [
    '**/openapi*.{yaml,yml,json}',
    '**/swagger*.{yaml,yml,json}',
    '**/*.graphql',
    '**/schema.gql',
    '**/*.proto',
    '**/asyncapi*.{yaml,yml,json}',
    '**/schema.prisma',
  ];
}

/**
 * Classifies how a feature affects an existing API contract, so the FINAL/EXPAND
 * breaking-change gate can treat a break as a deliberate architectural decision
 * (SDD: "breaking changes are serious, not quick edits"). Pure and total.
 *
 *   - 'none'     → no existing contract is touched (new contract, or no back-end).
 *   - 'additive' → only new endpoints/fields/optional params are added.
 *   - 'breaking' → something is removed/renamed, or a type/required constraint
 *                  changes on an existing operation.
 *
 * @param {{ touchesExistingContract?: boolean, removesOrRenames?: boolean, changesTypeOrRequired?: boolean }} [signals]
 * @returns {'none'|'additive'|'breaking'}
 */
export function classifyContractChange(signals = {}) {
  if (signals?.touchesExistingContract !== true) return 'none';
  if (signals?.removesOrRenames === true || signals?.changesTypeOrRequired === true) {
    return 'breaking';
  }
  return 'additive';
}

// ---------------------------------------------------------------------------
// Artifact planning
// ---------------------------------------------------------------------------

/**
 * Plans which artifacts should be generated.
 * Returns an empty plan when not in FINAL or DONE stage (gate enforcement).
 *
 * In PRD mode (default) it plans prd.md + userhistory.md (+ communication.md
 * when back-end). In spec mode (artifactMode === 'spec', OpenSpec) it plans ONLY
 * the change set (proposal/design/tasks/specs) — userhistory and communication do
 * not apply.
 *
 * The communication artifact documents the API/communication contract
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
    communication: false,
    apiContract: false,
    designSystem: false,
    proposal: false,
    specs: false,
    design: false,
    tasks: false,
    // architecture.md/codebase-memory.md/project-baseline.json are written by
    // EXPLORE and ARCH regardless of artifactMode (PRD or Spec) — both stages
    // always run in the fixed STAGE_ORDER, so these are unconditionally planned
    // once the flow reaches FINAL/DONE, independent of hasBackend/hasFrontend.
    architecture: false,
    codebaseMemory: false,
    projectBaseline: false,
    requirementsIndex: false,
  };
  if (!finalStages.has(state.currentStage)) {
    return empty;
  }

  const spec = resolveArtifactMode(state.artifactMode) === 'spec';
  const { hasBackend, hasFrontend } = classifyProject(state.consolidated);
  // When Open Design is used (≥1 system selected in BRAINSTORM_GERAL), its
  // verbatim files already include a DESIGN.md — so the Pensador does NOT emit a
  // redundant standalone design-system.md. The standalone doc is written ONLY as
  // the inline fallback (Open Design unavailable / declined → no system selected).
  const usesOpenDesign =
    Array.isArray(state.designSystems) && state.designSystems.filter(Boolean).length > 0;

  if (spec) {
    // Spec mode delivers ONLY the OpenSpec change set (scaffolded by the
    // openspec-* commands). userhistory.md and communication.md do not apply.
    // The API contract is folded into the change (design.md + specs/), so no
    // standalone machine-readable contract is emitted here either (apiContract:
    // false), mirroring how design is folded in. Open Design STILL runs when
    // hasFrontend (see openDesignDeliveryFor): the verbatim system files go to
    // the repo, decisions fold into design.md, and the UI requirements become a
    // `ui-design-system` delta spec — so there is no standalone design-system.md
    // here (designSystem: false), by design.
    //
    // When state.skipSpecs is true (infra/tooling/doc-only change, mirroring
    // OpenSpec's skip_specs), the specs/ delta is dropped from the plan — the
    // change set is proposal+design+tasks only.
    return {
      prd: false,
      proposal: true,
      specs: !state.skipSpecs,
      design: true,
      tasks: true,
      userhistory: false,
      communication: false,
      apiContract: false,
      designSystem: false,
      architecture: true,
      codebaseMemory: true,
      projectBaseline: true,
      requirementsIndex: false,
    };
  }

  return {
    prd: true,
    proposal: false,
    specs: false,
    design: false,
    tasks: false,
    userhistory: true,
    // The machine-readable contract (openapi.yaml / schema.graphql / service.proto
    // / asyncapi.yaml) is the SOURCE OF TRUTH whenever a back-end exists — both
    // for a fullstack front↔back boundary and for a back-end-only API. It is
    // gated on hasBackend, like communication.
    apiContract: hasBackend,
    // communication.md is the human-readable VIEW derived from the contract.
    communication: hasBackend,
    // The standalone design-system.md is planned only when the demand has a
    // front-end AND Open Design was NOT used — i.e. the inline fallback path.
    // When Open Design is used, its verbatim DESIGN.md (in design-systems/<id>/)
    // IS the design document, so no redundant standalone doc is emitted.
    designSystem: hasFrontend && !usesOpenDesign,
    architecture: true,
    codebaseMemory: true,
    projectBaseline: true,
    // requirements.json is derived from the PRD's own RF/CA tables (section 6
    // + 14) — PRD mode only. Spec mode's equivalent (SHALL requirements +
    // #### Scenario: blocks in specs/) is exposed live via `openspec status`,
    // a different, I/O-based path this pure engine does not attempt to mirror.
    requirementsIndex: true,
  };
}

/**
 * Builds the list of Artifact objects to be generated.
 * In PRD mode includes prd + userhistory (+ communication when back-end). In spec
 * mode (OpenSpec) it returns ONLY the change set (proposal/design/tasks/specs)
 * under openspec/changes/<name>/, scaffolded by the openspec-* commands — no
 * prd/userhistory/communication. Every artifact has a filename consistent with its
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

  // architecture.md / codebase-memory.md / project-baseline.json: common to
  // BOTH artifactMode (PRD and Spec) — EXPLORE and ARCH always run in the
  // fixed STAGE_ORDER, so these are unconditionally planned by the time FINAL
  // is reached. They are what makes the brownfield exploration this run did
  // (discovered domains, existing API contract baseline, researched technical
  // conventions, code map) available to the Orchestrador/Executor instead of
  // being re-derived from scratch (or lost) downstream.
  if (plan.architecture) {
    artifacts.push({
      kind: 'architecture',
      filename: ARCHITECTURE_SNAPSHOT_FILE,
      path: architectureSnapshotPath(state.featurePath),
    });
  }

  if (plan.codebaseMemory) {
    artifacts.push({
      kind: 'codebase-memory',
      filename: CODEBASE_MEMORY.snapshotFile,
      path: codebaseMemorySnapshotPath(state.featurePath),
    });
  }

  if (plan.projectBaseline) {
    artifacts.push({
      kind: 'project-baseline',
      filename: PROJECT_BASELINE_FILE,
      path: projectBaselinePath(state.featurePath),
    });
  }

  // requirements.json (role requirements-index): PRD mode only — see
  // planArtifacts() and scripts/lib/requirements-extractor.mjs.
  if (plan.requirementsIndex) {
    artifacts.push({
      kind: 'requirements-index',
      filename: REQUIREMENTS_INDEX_FILE,
      path: requirementsIndexPath(state.featurePath),
    });
  }

  if (plan.userhistory) {
    artifacts.push({
      kind: 'userhistory',
      filename: 'userhistory.md',
      path: `${basePath}userhistory.md`,
    });
  }

  // Machine-readable API contract — the SOURCE OF TRUTH for the front↔back (or
  // back↔consumer) boundary. Emitted before communication so the derived view
  // follows its source. Format follows state.apiStyle (openapi.yaml by default).
  if (plan.apiContract) {
    const fmt = resolveContractFormat(state.apiStyle);
    artifacts.push({
      kind: 'api-contract',
      filename: fmt.file,
      path: `${basePath}${fmt.file}`,
      spec: fmt.spec,
      // Mock + validation directive for the parallel workflow and CI enforcement.
      validation: contractValidationPlan(state.apiStyle),
    });
  }

  if (plan.communication) {
    artifacts.push({
      kind: 'communication',
      filename: 'communication.md',
      path: `${basePath}communication.md`,
      // Human-readable VIEW derived from the machine-readable api-contract above.
      derivedFrom: resolveContractFormat(state.apiStyle).file,
    });
  }

  if (plan.designSystem) {
    artifacts.push({
      kind: 'design-system',
      filename: OPEN_DESIGN.designSystemFile,
      path: `${basePath}${OPEN_DESIGN.designSystemFile}`,
    });
  }

  // Verbatim Open Design system files persisted by the Pensador. Per the handoff
  // contract, every producer artifact lives under the feature root — the Pensador
  // never writes into the project's real source tree. So the files land in
  // `<featurePath>/design-systems/<id>/` (designSystemFilesRoot), keyed by the
  // CONCRETE system id(s) chosen at BRAINSTORM_GERAL (state.designSystems). This
  // makes the design-system-files path genuinely relative to artifactRoot, so the
  // handoff carries the real path without the consumer parsing design-system.md
  // prose. The downstream Orchestrator/Executor materializes them into
  // state.uiPackageDir (packages/ui / src/styles) during implementation. Fires in
  // BOTH modes when the demand has a front-end AND a system was selected; gated on
  // FINAL/DONE via the empty-plan short-circuit above.
  const isFinalStage = plan.prd || plan.proposal || plan.designSystem || plan.userhistory;
  const { hasFrontend } = classifyProject(state.consolidated);
  const selectedSystems = Array.isArray(state.designSystems)
    ? state.designSystems.filter(Boolean)
    : [];
  if (isFinalStage && hasFrontend && selectedSystems.length > 0) {
    const materializeRoot = String(state.uiPackageDir || 'packages/ui').replace(/\/+$/, '');
    for (const entry of openDesignFetchPlan(selectedSystems, designSystemFilesRoot(state.featurePath))) {
      artifacts.push({
        kind: 'design-system-files',
        filename: `design-systems/${entry.id}/`,
        path: entry.destDir,
        verbatim: true,
        // The eventual UI package the executor materializes these into.
        materializeInto: `${materializeRoot}/design-systems/${entry.id}/`,
      });
    }
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
 * (pensador | web-research | requirements-clarity | backend-development |
 * ui-ux-pro-max | frontend-design | codex | agy), including fallback questions.
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
 * @typedef {'INIT'|'EXPLORE'|'RESEARCH'|'PRD_BASE'|'ARCH'|'EXPAND'|'COMPLEXITY'|'BRAINSTORM_GERAL'|'CODEX'|'AGY'|'FINAL'|'DONE'} Stage
 */

/**
 * @typedef {'pensador'|'web-research'|'requirements-clarity'|'backend-development'|'ui-ux-pro-max'|'frontend-design'|'codex'|'agy'} Origin
 */

/**
 * @typedef {Object} ResearchedFeature
 * @property {string} name
 * @property {'table-stakes'|'differentiator'|'anti-feature'|'out-of-scope'} tier
 * @property {number} [competitorCoverage]  // 0..1 share of benchmarked products shipping it
 * @property {string[]} [sources]           // source URLs backing the finding
 */

/**
 * @typedef {Object} ResearchedPattern
 * @property {string} name
 * @property {'current'|'experimental'|'legacy'|'deprecated'} adoption
 * @property {string} [tech]          // technology id the pattern belongs to
 * @property {string} [replacedBy]    // documented replacement, when deprecated
 * @property {string[]} [sources]     // official-docs URLs backing the finding
 */

/**
 * @typedef {Object} TechResearch
 * @property {'DONE'|'PARTIAL'|'DEFERRED'|'SKIPPED'} status
 * @property {string[]} stack
 * @property {Record<string,string>} versions   // tech id → researched current version
 * @property {ResearchedPattern[]} patterns
 * @property {ResearchedPattern[]} conventions
 * @property {ResearchedPattern[]} antiPatterns
 * @property {string[]} sources
 * @property {string} notes
 */

/**
 * @typedef {Object} MarketResearch
 * @property {'DONE'|'PARTIAL'|'SKIPPED'} status
 * @property {string} archetype
 * @property {string|null} sectorContext
 * @property {{ name: string, url?: string, notes?: string }[]} competitors
 * @property {ResearchedFeature[]} features
 * @property {string[]} sources
 * @property {string} notes
 * @property {{ archetype: string, sectorContext: string, sections: Record<string,string> }} promptSystem
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
 * @property {string} [productArchetype] // product category detected/confirmed in RESEARCH
 * @property {string|null} [sectorContext] // business sector/industry collected in RESEARCH
 * @property {MarketResearch|null} [marketResearch] // RESEARCH business track + reusable Prompt System
 * @property {string[]} [techStack]                 // technologies detected in RESEARCH (detectTechStack)
 * @property {TechResearch|null} [techResearch]     // RESEARCH technical track (may be DEFERRED to ARCH)
 * @property {string[]} [designSystems]  // Open Design system ids chosen at BRAINSTORM_GERAL (hasFrontend)
 * @property {string} [uiPackageDir]     // UI package root for verbatim system files (default 'packages/ui')
 * @property {'rest'|'graphql'|'grpc'|'events'} [apiStyle] // API style detected in ARCH → machine-readable contract format
 */

/**
 * @typedef {Object} ArtifactPlan
 * @property {boolean} prd
 * @property {boolean} userhistory
 * @property {boolean} communication
 * @property {boolean} [apiContract] // machine-readable contract (openapi.yaml/…) when hasBackend, PRD mode
 * @property {boolean} [designSystem] // design-system.md (Open Design) when hasFrontend, PRD mode
 * @property {boolean} [proposal]  // OpenSpec (spec mode)
 * @property {boolean} [specs]     // OpenSpec (spec mode)
 * @property {boolean} [design]    // OpenSpec (spec mode)
 * @property {boolean} [tasks]     // OpenSpec (spec mode)
 */

/**
 * @typedef {Object} Artifact
 * @property {'prd'|'communication'|'api-contract'|'userhistory'|'design-system'|'design-system-files'|'proposal'|'specs'|'design'|'tasks'|'architecture'|'codebase-memory'|'project-baseline'|'requirements-index'} kind
 * @property {string} filename
 * @property {string} path
 * @property {'openspec'} [managedBy] // present when the artifact is scaffolded by the openspec-* commands
 * @property {boolean} [verbatim]     // true for design-system-files (tokens.css, components.html, …)
 * @property {string} [spec]          // contract spec family for api-contract (openapi/graphql-sdl/protobuf/asyncapi)
 * @property {{ spec: string, mock: string, validate: string }} [validation] // mock+validate directive for api-contract
 * @property {string} [derivedFrom]   // for communication: the machine-readable contract file it is a view of
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
