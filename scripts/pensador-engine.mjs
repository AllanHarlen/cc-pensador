/**
 * Pensador Engine
 *
 * Pure, deterministic module — no I/O, no side effects.
 * Encapsulates the state machine, advancement gates, effort/model mappings,
 * consolidation, fullstack detection, and artifact planning for the Pensador
 * PRD workflow.
 *
 * All data transformations are referentially transparent: same input → same output.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical stage order. Never reordered or skipped. */
export const STAGE_ORDER = ['INIT', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'FINAL', 'DONE'];

/** Allowlist of valid AGY model identifiers. */
export const AGY_MODEL_ALLOWLIST = [
  'gemini-3.1-pro-high',
];

/** AGY model used in Stage 4. Must be a member of AGY_MODEL_ALLOWLIST. */
export const STAGE4_MODEL = 'gemini-3.1-pro-high';

/** Channel constant for all user-facing questions. */
export const ASK_USER_QUESTION = 'ASK_USER_QUESTION';

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
 *   - demanda non-empty → needsDemanda=false, currentStage='INIT' (first advance targets STAGE_1)
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
 * Consolidates all answered questions from stages 2, 3, and 4 into
 * Requirement objects.
 *
 * @param {StageState} state
 * @returns {Requirement[]}
 */
export function consolidate(state) {
  const targetStages = new Set(['STAGE_2', 'STAGE_3', 'STAGE_4']);

  return state.questions
    .filter((q) => targetStages.has(q.stage) && q.answer !== null)
    .map((q) => ({
      id: q.id,
      source: q.stage.toLowerCase(),
      text: q.answer,
      resolvesGap: q.origin === 'codex' || q.origin === 'agy' ? true : undefined,
    }));
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
 * Returns the AGY model identifier for Stage 4.
 * Asserts membership in AGY_MODEL_ALLOWLIST at call time.
 *
 * @returns {'gemini-3.1-pro-high'}
 */
export function agyModelForStage4() {
  const model = STAGE4_MODEL;
  if (!AGY_MODEL_ALLOWLIST.includes(model)) {
    throw new Error(
      `STAGE4_MODEL '${model}' is not in AGY_MODEL_ALLOWLIST: [${AGY_MODEL_ALLOWLIST.join(', ')}]`
    );
  }
  return model;
}

// ---------------------------------------------------------------------------
// Fullstack detection
// ---------------------------------------------------------------------------

/**
 * Determines whether a set of consolidated requirements represents a
 * fullstack project (back-end + front-end with inter-layer data exchange).
 *
 * This function is deterministic and total: same input → same result.
 *
 * @param {Requirement[]} requirements
 * @returns {boolean}
 */
export function isFullstack(requirements) {
  const combined = requirements.map((r) => r.text).join(' ').toLowerCase();
  const hasBackend =
    /\b(api|back[\s-]?end|servidor|server|endpoint|banco de dados|database|rest|graphql|webhook)\b/.test(
      combined
    );
  const hasFrontend =
    /\b(front[\s-]?end|tela|interface|ui|ux|componente|component|web|mobile|app|cliente)\b/.test(
      combined
    );
  return hasBackend && hasFrontend;
}

// ---------------------------------------------------------------------------
// Artifact planning
// ---------------------------------------------------------------------------

/**
 * Plans which artifacts should be generated.
 * Returns an empty plan when not in FINAL or DONE stage (gate enforcement).
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
    comunication: isFullstack(state.consolidated),
  };
}

/**
 * Builds the list of Artifact objects to be generated.
 * Always includes prd and userhistory; includes comunication iff fullstack.
 * Every artifact has a filename consistent with its kind and a non-empty path.
 *
 * @param {StageState} state
 * @returns {Artifact[]}
 */
export function buildArtifactList(state) {
  const plan = planArtifacts(state);
  const basePath = './';

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
 * Builds the initial PRD scaffold (Stage 1) from a user demand and the list
 * of required sections defined by the Strict_PRD_Schema.
 *
 * Rules:
 *  - Every section in `requiredSections` is guaranteed to appear as a key in
 *    the returned `PrdDocument.sections`.
 *  - Sections whose content cannot be deterministically derived from the
 *    demanda string are set to exactly `"TBD"` as a placeholder.
 *  - The function is pure: same inputs → same output, no I/O, no side effects.
 *
 * Note: actual content derivation (replacing "TBD" with inferred text) is the
 * responsibility of the LLM skill layer, which interprets the demanda.  The
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
 * (pensador | codex | agy), including fallback questions.
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
// JSDoc type definitions (for IDE support — not runtime types)
// ---------------------------------------------------------------------------

/**
 * @typedef {'INIT'|'STAGE_1'|'STAGE_2'|'STAGE_3'|'STAGE_4'|'FINAL'|'DONE'} Stage
 */

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {Stage} stage
 * @property {'pensador'|'codex'|'agy'} origin
 * @property {string} text
 * @property {string[]} [options]
 * @property {string|null} answer
 * @property {'ASK_USER_QUESTION'} channel
 */

/**
 * @typedef {Object} Requirement
 * @property {string} id
 * @property {'prd_base'|'stage_2'|'stage_3'|'stage_4'} source
 * @property {string} text
 * @property {boolean} [resolvesGap]
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
