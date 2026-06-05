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
 * Funnel: generate → expand → clarify → domain deep-dives → technical sweep
 * (Codex) → product sweep (AGY) → consolidate.
 */
export const STAGE_ORDER = [
  'INIT',
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
  CODEX:    { kind: 'subagent', ref: 'codex:codex-rescue',                          origin: 'codex', param: '--effort high' },
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
 * Allocates the next feature directory or resumes an incomplete checkpoint.
 *
 * @param {string[]} existingFeatureDirs
 * @param {{ nameSuffix?: string, incompleteCheckpoint?: string }} options
 * @returns {FeatureDirResult}
 */
export function allocateFeatureDir(existingFeatureDirs = [], options = {}) {
  if (options?.incompleteCheckpoint) {
    const checkpointName = String(options.incompleteCheckpoint);
    const featureN = Number(checkpointName.match(/feature-n(\d+)/)?.[1] ?? 0);
    return {
      featureDir: `.pensador/${checkpointName}`,
      isResume: true,
      featureN,
    };
  }

  const maxN = (Array.isArray(existingFeatureDirs) ? existingFeatureDirs : []).reduce((max, dirName) => {
    const n = Number(String(dirName).match(/feature-n(\d+)/)?.[1] ?? 0);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const featureN = maxN + 1;
  const dirName = options?.nameSuffix
    ? `feature-n${featureN}-${options.nameSuffix}`
    : `feature-n${featureN}`;

  return {
    featureDir: `.pensador/${dirName}`,
    isResume: false,
    featureN,
  };
}

/**
 * Builds a path inside a feature directory.
 *
 * @param {string} featureDir
 * @param {'shared-agents' | 'pensador-output'} subdir
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
 *   - demanda non-empty → needsDemanda=false, currentStage='INIT' (first advance targets PRD_BASE)
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

// ---------------------------------------------------------------------------
// Artifact planning
// ---------------------------------------------------------------------------

/**
 * Plans which artifacts should be generated.
 * Returns an empty plan when not in FINAL or DONE stage (gate enforcement).
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
  if (!finalStages.has(state.currentStage)) {
    return { prd: false, userhistory: false, comunication: false };
  }

  return {
    prd: true,
    userhistory: true,
    comunication: classifyProject(state.consolidated).hasBackend,
  };
}

/**
 * Builds the list of Artifact objects to be generated.
 * Always includes prd and userhistory; includes comunication iff there is a
 * back-end (see planArtifacts). Every artifact has a filename consistent with
 * its kind and a non-empty path.
 *
 * @param {StageState} state
 * @returns {Artifact[]}
 */
export function buildArtifactList(state) {
  const plan = planArtifacts(state);
  // Artifacts are written under a dedicated output directory so a /pensador run
  // never clobbers a pre-existing prd.md (or sibling) at the project root. The
  // LLM still confirms before overwriting a file that already exists in here.
  const basePath = state.featurePath
    ? `${state.featurePath}/pensador-output/`
    : '.pensador/feature-n1/pensador-output/';

  /** @type {Artifact[]} */
  const artifacts = [];

  if (plan.prd) {
    artifacts.push({
      kind: 'prd',
      filename: 'prd.md',
      path: `${basePath}prd.md`,
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
 * file (e.g. pensador-output/.pensador-progress.json), enabling a /pensador run
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
 * @typedef {'INIT'|'PRD_BASE'|'ARCH'|'EXPAND'|'COMPLEXITY'|'BRAINSTORM_GERAL'|'CODEX'|'AGY'|'FINAL'|'DONE'} Stage
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
 * @property {string|null} [featurePath] // .pensador/feature-nN - set after feature allocation
 */

/**
 * @typedef {Object} ArtifactPlan
 * @property {boolean} prd
 * @property {boolean} userhistory
 * @property {boolean} comunication
 */

/**
 * @typedef {Object} Artifact
 * @property {'prd'|'comunication'|'userhistory'} kind
 * @property {'prd.md'|'comunication_json.md'|'userhistory.md'} filename
 * @property {string} path
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
 * @property {number} featureN
 */
