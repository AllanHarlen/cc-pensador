/**
 * Deterministic stage-advance gate for the Pensador checkpoint.
 *
 * Why this exists: a real run (OficinaAI, 2026-09-18) moved `.pensador-progress.json`
 * from `INIT` straight to `DONE` with one hand-edit, skipping EXPAND, COMPLEXITY,
 * BRAINSTORM_GERAL, CODEX, AGY and DESIGN, and closed with a `handoff.json` that
 * failed `validate-handoff.mjs`. The prose gates in SKILL.md were ignored. This module
 * turns the gates into a check the checkpoint cannot bypass: the checkpoint advances only
 * through `scripts/advance-stage.mjs` (and `scripts/guard-checkpoint.mjs`, a PreToolUse
 * hook, refuses hand-edits of the fields this gate owns).
 *
 * Three kinds of evidence, strongest first:
 *   1. Artifacts on disk with real content (size floor, JSON parses, audit status).
 *   2. A per-stage *record* the caller passes at the moment of leaving a stage
 *      (`--record`): outcome, questions asked/closed, a justification when nothing was
 *      asked, plus the scope flags (`hasFrontend`/`hasBackend`) and `complexityMode`.
 *      Stages with no natural artifact (EXPAND, COMPLEXITY, CODEX, AGY) are gated this way.
 *   3. `stageHistory`/`stageRecords` in the checkpoint, written only by this gate.
 *
 * Pure: every side effect (reading files, listing dirs, validating the handoff) is
 * injected through `env`, so the rules are unit-testable without a filesystem.
 */
import { createHash } from 'node:crypto';
import { STAGE_ORDER, pendingQuestions } from '../pensador-engine.mjs';

/** Sidecar written only by the PostToolUse hook (scripts/track-questions.mjs): one line per AskUserQuestion call. */
export const QUESTION_LOG = '.pensador-questions.jsonl';

/** Files that must exist, with a minimum of non-whitespace characters, before a stage may be left. */
const EXIT_ARTIFACTS = Object.freeze({
  EXPLORE: [{ path: 'codebase-memory.md', minChars: 150 }],
  RESEARCH: [
    { path: 'market-research.md', minChars: 400 },
    { path: 'tech-research.md', minChars: 400 },
  ],
  ARCH: [{ path: 'architecture.md', minChars: 400 }],
});

const PRD_MIN_CHARS = 1500;
const RESPONSE_MIN_CHARS = 100;
const NOTE_MIN_CHARS = 20;
const HANDOFF_ARTIFACT_MIN_CHARS = 20;

/** Stage -> outcomes its record may declare. */
const ALLOWED_OUTCOMES = Object.freeze({
  EXPAND: ['asked', 'none'],
  COMPLEXITY: ['asked'],
  BRAINSTORM_GERAL: ['asked', 'none', 'fallback'],
  CODEX: ['asked', 'none', 'skipped', 'fallback'],
  AGY: ['asked', 'none', 'fallback'],
  DESIGN: ['skipped'],
});

/** Stages whose delegated subagent must leave its raw answer on disk when it actually ran. */
const STAGE_RESPONSE_FILE = Object.freeze({
  CODEX: 'shared-agents/codex.stage.response.md',
  AGY: 'shared-agents/agy.stage.response.md',
});

/** Checkpoint fields owned by the gate: only `applyTransition` may change them. */
export const PROTECTED_FIELDS = Object.freeze(['stage', 'stageHistory', 'stageRecords', 'complexityMode', 'hasFrontend', 'hasBackend', 'adopted', 'integrity']);

const INTEGRITY_FIELDS = PROTECTED_FIELDS.filter((key) => key !== 'integrity');

/**
 * Fingerprint of the gate-owned fields. Written on every transition; verified before the
 * next one. It catches an out-of-band edit however it was made (the PreToolUse guard is a
 * heuristic for shell commands; this is the backstop that does not depend on how the write happened).
 */
export function computeIntegrity(checkpoint) {
  const view = INTEGRITY_FIELDS.map((key) => checkpoint?.[key] ?? null);
  return createHash('sha256').update(JSON.stringify(view)).digest('hex');
}

/** Sum of questions the hook saw asked while the checkpoint was in `stage`. */
export function questionsAskedIn(logText, stage) {
  let total = 0;
  for (const line of (logText ?? '').split(/\r?\n/)) {
    try {
      const entry = JSON.parse(line);
      if (entry.stage === stage && Number.isInteger(entry.count)) total += entry.count;
    } catch {
      /* blank or partial line */
    }
  }
  return total;
}

const nonWhitespace = (text) => text.replace(/\s/g, '').length;

/** Does `stage` need a record when it is left? Depends on scope flags recorded earlier. */
export function recordRequired(stage, checkpoint) {
  if (stage === 'DESIGN') return checkpoint.hasFrontend === false;
  return Object.hasOwn(ALLOWED_OUTCOMES, stage);
}

function checkFile(env, fail, { path, minChars }) {
  const text = env.readText(path);
  if (text === null) return fail('MISSING_ARTIFACT', `${path} is required in the feature directory`);
  if (nonWhitespace(text) < minChars) {
    return fail('ARTIFACT_TOO_SHORT', `${path} has ${nonWhitespace(text)} non-whitespace characters; at least ${minChars} expected — a stub does not satisfy the gate`);
  }
  return null;
}

function checkJsonFile(env, fail, path) {
  const text = env.readText(path);
  if (text === null) return fail('MISSING_ARTIFACT', `${path} is required in the feature directory`);
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      return fail('ARTIFACT_TOO_SHORT', `${path} parses but is empty`);
    }
  } catch {
    return fail('ARTIFACT_INVALID_JSON', `${path} is not valid JSON`);
  }
  return null;
}

function checkRecord({ stage, checkpoint, record, env, fail, strict }) {
  const allowed = ALLOWED_OUTCOMES[stage];
  if (record === undefined || record === null || typeof record !== 'object') {
    return fail(
      'RECORD_REQUIRED',
      `leaving ${stage} requires --record '<json>' (outcome ${allowed.join('|')}, questionsAsked, questionsClosed, note when nothing was asked)`,
    );
  }
  const { outcome, questionsAsked = 0, questionsClosed = 0, note } = record;
  if (!allowed.includes(outcome)) {
    return fail('RECORD_INVALID', `${stage} record.outcome must be one of ${allowed.join(', ')}; got ${JSON.stringify(outcome)}`);
  }
  if (!Number.isInteger(questionsAsked) || !Number.isInteger(questionsClosed) || questionsAsked < 0 || questionsClosed < 0) {
    return fail('RECORD_INVALID', `${stage} record.questionsAsked/questionsClosed must be non-negative integers`);
  }
  if (questionsClosed < questionsAsked) {
    fail('PENDING_QUESTIONS', `${stage} record: ${questionsAsked - questionsClosed} question(s) asked but not answered or deferred`);
  }
  if (outcome === 'asked' && questionsAsked < 1) {
    fail('RECORD_INVALID', `${stage} outcome "asked" requires questionsAsked >= 1 (the user must actually be asked via AskUserQuestion)`);
  }
  if (strict && outcome === 'asked' && record.unverified !== true) {
    // The PostToolUse hook logs every AskUserQuestion call against the stage the checkpoint was in.
    const seen = questionsAskedIn(env.readText(QUESTION_LOG), stage);
    if (seen < questionsAsked) {
      fail(
        'QUESTIONS_NOT_OBSERVED',
        `${stage} record claims ${questionsAsked} question(s) asked, but the AskUserQuestion hook logged ${seen} while the checkpoint was in ${stage}. ` +
          `Ask the user for real (AskUserQuestion) before leaving the stage. Only if hooks are disabled in this environment, add "unverified": true to the record — it is kept in the checkpoint and must be disclosed in the recap.`,
      );
    }
  }
  if (outcome !== 'asked' && (typeof note !== 'string' || note.trim().length < NOTE_MIN_CHARS)) {
    fail('RECORD_NOTE_REQUIRED', `${stage} outcome "${outcome}" requires record.note (>= ${NOTE_MIN_CHARS} chars) saying why nothing was asked`);
  }

  if (stage === 'COMPLEXITY' && !['lite', 'completo'].includes(record.complexityMode)) {
    fail('RECORD_INVALID', 'COMPLEXITY record.complexityMode must be "lite" or "completo" (the choice the user confirmed)');
  }

  if (stage === 'BRAINSTORM_GERAL') {
    for (const flag of ['hasFrontend', 'hasBackend']) {
      if (typeof record[flag] !== 'boolean') fail('RECORD_INVALID', `BRAINSTORM_GERAL record.${flag} must be a boolean (it drives CODEX skip, DESIGN and the FINAL artifacts)`);
    }
  }

  if (stage === 'CODEX' && outcome === 'skipped' && !(checkpoint.hasFrontend === true && checkpoint.hasBackend === false)) {
    fail('RECORD_INVALID', 'CODEX may only be "skipped" for front-end-only work (hasFrontend true and hasBackend false)');
  }
  if (stage === 'DESIGN' && checkpoint.hasFrontend !== false) {
    fail('RECORD_INVALID', 'DESIGN may only be "skipped" when hasFrontend is false; with a front-end it must produce a PASS design-audit.json');
  }

  const responseFile = STAGE_RESPONSE_FILE[stage];
  if (responseFile && (outcome === 'asked' || outcome === 'none')) {
    checkFile(env, fail, { path: responseFile, minChars: RESPONSE_MIN_CHARS });
  }
  return null;
}

function checkDesignAudit(env, fail) {
  const systems = env.list('design-systems');
  const audits = systems.map((id) => ({ id, text: env.readText(`design-systems/${id}/resolved/design-audit.json`) })).filter((a) => a.text !== null);
  if (audits.length === 0) {
    return fail('MISSING_ARTIFACT', 'leaving DESIGN with a front-end requires design-systems/<id>/resolved/design-audit.json (run design-package.mjs audit)');
  }
  for (const { id, text } of audits) {
    let status = null;
    try {
      status = JSON.parse(text).status;
    } catch {
      /* falls through as not PASS */
    }
    if (status !== 'PASS') fail('DESIGN_AUDIT_NOT_PASS', `design-systems/${id}/resolved/design-audit.json status is ${JSON.stringify(status)}, not "PASS"`);
  }
  return null;
}

function checkFinalToDone({ checkpoint, env, fail }) {
  const visited = new Map((checkpoint.stageHistory ?? []).map((entry) => [entry.stage, entry]));
  const missing = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf('DONE')).filter((stage) => !visited.has(stage));
  if (missing.length > 0) fail('STAGES_NOT_VISITED', `cannot reach DONE: stageHistory has no record of ${missing.join(', ')}`);

  for (const stage of Object.keys(ALLOWED_OUTCOMES)) {
    const backfilled = visited.get(stage)?.backfilled === true;
    if (recordRequired(stage, checkpoint) && !backfilled && !checkpoint.stageRecords?.[stage]) {
      fail('RECORD_MISSING', `cannot reach DONE: no stage record for ${stage}`);
    }
  }
  if (checkpoint.hasFrontend === undefined || checkpoint.hasBackend === undefined) {
    if (!visited.get('BRAINSTORM_GERAL')?.backfilled) fail('SCOPE_FLAGS_MISSING', 'cannot reach DONE: hasFrontend/hasBackend were never recorded (BRAINSTORM_GERAL record)');
  }

  checkJsonFile(env, fail, 'project-baseline.json');
  if ((checkpoint.artifactMode ?? 'prd') === 'prd') checkJsonFile(env, fail, 'requirements.json');
  if (checkpoint.hasFrontend === true) checkJsonFile(env, fail, 'ui-data-map.json');
  if (checkpoint.hasBackend === true) checkJsonFile(env, fail, 'seed-plan.json');

  const handoffText = env.readText('handoff.json');
  if (handoffText === null) return fail('MISSING_HANDOFF', 'FINAL -> DONE requires handoff.json in the feature directory');

  const result = env.validateHandoff();
  if (!result.ok) {
    const detail = (result.errors ?? []).map((e) => e.code).join(', ') || 'unknown';
    fail('HANDOFF_INVALID', `validate-handoff.mjs reported ok:false (${detail}); fix the handoff or write status PARTIAL/BLOCKED with a summary that names the gap`);
  }

  let handoff = null;
  try {
    handoff = JSON.parse(handoffText);
  } catch {
    return fail('HANDOFF_INVALID', 'handoff.json is not valid JSON');
  }
  for (const artifact of handoff.artifacts ?? []) {
    if (artifact?.required === false || typeof artifact?.path !== 'string') continue;
    const text = env.readText(artifact.path);
    if (text !== null) {
      if (nonWhitespace(text) < HANDOFF_ARTIFACT_MIN_CHARS) fail('HANDOFF_ARTIFACT_EMPTY', `handoff artifact ${artifact.role ?? '?'} (${artifact.path}) is empty`);
    } else if (env.list(artifact.path.replace(/\/$/, '')).length === 0) {
      fail('HANDOFF_ARTIFACT_MISSING', `handoff declares required artifact ${artifact.role ?? '?'} at ${artifact.path}, but nothing exists there`);
    }
  }
  return null;
}

/**
 * Checks whether the checkpoint may move to `to`.
 *
 * @param {object} params
 * @param {object} params.checkpoint - parsed `.pensador-progress.json`
 * @param {string} params.to - requested target stage
 * @param {object} [params.record] - evidence for the stage being left (see module doc)
 * @param {boolean} [params.strict] - also require a sealed, untampered checkpoint and verify
 *        claimed questions against the hook log (the CLI always passes true; unit tests of pure rules omit it)
 * @param {object} params.env
 * @param {(relPath: string) => string|null} params.env.readText - null when missing/unreadable, relative to featurePath
 * @param {(relDir: string) => string[]} params.env.list - entry names in a dir under featurePath ([] when missing)
 * @param {() => { ok: boolean, errors?: Array<{code: string}> }} [params.env.validateHandoff] - required for `to === 'DONE'`
 * @returns {{ ok: boolean, from: string|null, to: string, errors: Array<{code: string, message: string}> }}
 */
export function checkTransition({ checkpoint, to, record, env, strict = false }) {
  const errors = [];
  const from = typeof checkpoint?.stage === 'string' ? checkpoint.stage : null;
  const fail = (code, message) => {
    errors.push({ code, message });
    return null;
  };

  const fromIndex = STAGE_ORDER.indexOf(from);
  const toIndex = STAGE_ORDER.indexOf(to);

  if (fromIndex === -1) fail('UNKNOWN_CURRENT_STAGE', `checkpoint stage "${from}" is not one of ${STAGE_ORDER.join(', ')}`);
  if (toIndex === -1) fail('UNKNOWN_TARGET_STAGE', `target stage "${to}" is not one of ${STAGE_ORDER.join(', ')}`);
  if (errors.length > 0) return { ok: false, from, to, errors };

  if (strict) {
    if (typeof checkpoint.integrity !== 'string') {
      fail(
        'CHECKPOINT_NOT_SEALED',
        `checkpoint has no integrity seal. A new checkpoint at INIT: run advance-stage.mjs --feature <featurePath> --seal. ` +
          `A checkpoint from before the gate existed, resumed at the user's explicit request: --adopt.`,
      );
    } else if (checkpoint.integrity !== computeIntegrity(checkpoint)) {
      fail('CHECKPOINT_TAMPERED', 'a gate-owned checkpoint field (stage, stageHistory, stageRecords, complexityMode, hasFrontend, hasBackend) was changed outside advance-stage.mjs; restore it from git/backup or start a new feature version');
    }
    if (errors.length > 0) return { ok: false, from, to, errors };
  }

  if (toIndex !== fromIndex + 1) {
    const next = STAGE_ORDER[fromIndex + 1] ?? null;
    fail(
      'STAGE_SKIP',
      next === null
        ? `${from} is terminal; there is no stage after it`
        : `stages advance one at a time: ${from} -> ${next}, not ${from} -> ${to}. ` +
            `Every stage between them must be visited (a stage with nothing to ask still runs and records zero questions).`,
    );
    return { ok: false, from, to, errors };
  }

  if (Array.isArray(checkpoint.questions)) {
    const pending = pendingQuestions({ questions: checkpoint.questions }, from);
    if (pending.length > 0) fail('PENDING_QUESTIONS', `${pending.length} unanswered question(s) in ${from}: ${pending.map((q) => q.id).join(', ')}`);
  }

  for (const artifact of EXIT_ARTIFACTS[from] ?? []) checkFile(env, fail, artifact);

  if (from === 'PRD_BASE' && (checkpoint.artifactMode ?? 'prd') === 'prd') checkFile(env, fail, { path: 'prd.md', minChars: PRD_MIN_CHARS });

  if (from === 'BRAINSTORM_GERAL') {
    const responses = env.list('shared-agents').filter((name) => name.endsWith('.response.md'));
    const usable = responses.filter((name) => nonWhitespace(env.readText(`shared-agents/${name}`) ?? '') >= RESPONSE_MIN_CHARS);
    if (usable.length === 0) fail('MISSING_ARTIFACT', `leaving BRAINSTORM_GERAL requires at least one shared-agents/*.response.md with real content (>= ${RESPONSE_MIN_CHARS} chars; agent.response.md consolidates them)`);
  }

  if (from === 'DESIGN' && checkpoint.hasFrontend === true) checkDesignAudit(env, fail);

  if (recordRequired(from, checkpoint)) checkRecord({ stage: from, checkpoint, record, env, fail, strict });

  if (to === 'DONE') checkFinalToDone({ checkpoint, env, fail });

  return { ok: errors.length === 0, from, to, errors };
}

/**
 * Returns the checkpoint with `stage` moved to `to`, the visit recorded in
 * `stageHistory`, and the evidence for the stage just left in `stageRecords`. A
 * checkpoint without history (written before this gate existed, or created by INIT) is
 * backfilled up to its current stage first, flagged `backfilled`.
 *
 * @param {object} checkpoint
 * @param {string} to
 * @param {{ now?: string, record?: object }} [options]
 */
export function applyTransition(checkpoint, to, { now = new Date().toISOString(), record } = {}) {
  const history = Array.isArray(checkpoint.stageHistory)
    ? [...checkpoint.stageHistory]
    : STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(checkpoint.stage) + 1).map((stage) => ({ stage, at: now, backfilled: true }));
  history.push({ stage: to, at: now });

  const next = { ...checkpoint, stage: to, stageHistory: history, updatedAt: now };
  if (record && typeof record === 'object') {
    next.stageRecords = { ...checkpoint.stageRecords, [checkpoint.stage]: { ...record, at: now } };
    for (const key of ['complexityMode', 'hasFrontend', 'hasBackend']) {
      if (record[key] !== undefined) next[key] = record[key];
    }
  }
  next.integrity = computeIntegrity(next);
  return next;
}

/**
 * Seals a checkpoint so that later transitions can prove nobody edited the gate-owned fields.
 *   - default: only for a checkpoint still at INIT (a fresh feature).
 *   - adopt:   for a checkpoint that already advanced without this gate (written before 2.29.0)
 *              — its earlier stages are backfilled and flagged `adopted`, so DONE does not demand
 *              records the old run never produced. Use only when the user asked to resume it.
 *
 * @returns {{ ok: boolean, errors: Array<{code: string, message: string}>, checkpoint?: object }}
 */
export function sealCheckpoint(checkpoint, { adopt = false, now = new Date().toISOString() } = {}) {
  const fail = (code, message) => ({ ok: false, errors: [{ code, message }] });
  if (typeof checkpoint?.integrity === 'string') return fail('ALREADY_SEALED', 'checkpoint is already sealed');
  const index = STAGE_ORDER.indexOf(checkpoint?.stage);
  if (index === -1) return fail('UNKNOWN_CURRENT_STAGE', 'checkpoint has no valid stage');
  if (checkpoint.stage === 'DONE') return fail('ALREADY_DONE', 'checkpoint is at DONE; start a new feature version instead of adopting it');
  if (!adopt && checkpoint.stage !== 'INIT') {
    return fail('SEAL_ONLY_AT_INIT', `--seal is only for a fresh checkpoint at INIT (this one is at ${checkpoint.stage}). To resume a checkpoint from before the gate at the user's request, use --adopt.`);
  }
  if (Array.isArray(checkpoint.stageHistory) && checkpoint.stageHistory.length > 1) {
    return fail('HISTORY_PRESENT', 'checkpoint already has a stageHistory');
  }
  const sealed = {
    ...checkpoint,
    stageHistory: STAGE_ORDER.slice(0, index + 1).map((stage) => ({ stage, at: now, ...(adopt && stage !== 'INIT' ? { backfilled: true } : {}) })),
    updatedAt: now,
    ...(adopt && checkpoint.stage !== 'INIT' ? { adopted: { fromStage: checkpoint.stage, at: now } } : {}),
  };
  sealed.integrity = computeIntegrity(sealed);
  return { ok: true, errors: [], checkpoint: sealed };
}
