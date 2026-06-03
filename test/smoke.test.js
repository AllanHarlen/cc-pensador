/**
 * Smoke test — verifies that the Pensador Engine module can be imported
 * and that its public API surface is intact.
 */
import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER,
  REQUIREMENT_STAGES,
  STAGE_DELEGATION,
  GAP_ORIGINS,
  AGY_MODEL_ALLOWLIST,
  AGY_STAGE_MODEL,
  ASK_USER_QUESTION,
  initState,
  addQuestions,
  recordAnswer,
  pendingQuestions,
  canAdvance,
  advance,
  consolidate,
  withConsolidated,
  mapEffort,
  agyStageModel,
  classifyProject,
  isFullstack,
  planArtifacts,
  buildArtifactList,
  buildPrdBase,
  buildUserHistory,
  dispatchQuestion,
  CHECKPOINT_VERSION,
  serializeState,
  deserializeState,
} from '../scripts/pensador-engine.mjs';

describe('Pensador Engine — smoke', () => {
  it('exports STAGE_ORDER with the correct canonical sequence', () => {
    expect(STAGE_ORDER).toEqual([
      'INIT',
      'PRD_BASE',
      'EXPAND',
      'CLARITY',
      'BACKEND',
      'UIUX',
      'FRONTEND',
      'CODEX',
      'AGY',
      'FINAL',
      'DONE',
    ]);
  });

  it('exports REQUIREMENT_STAGES covering every working stage after PRD_BASE', () => {
    expect(REQUIREMENT_STAGES).toEqual([
      'EXPAND',
      'CLARITY',
      'BACKEND',
      'UIUX',
      'FRONTEND',
      'CODEX',
      'AGY',
    ]);
  });

  it('maps each brainstorm/refinement stage to a delegation target', () => {
    expect(STAGE_DELEGATION.CLARITY.ref).toBe('requirements-clarity');
    expect(STAGE_DELEGATION.BACKEND.ref).toBe('backend-development');
    expect(STAGE_DELEGATION.UIUX.ref).toBe('ui-ux-pro-max');
    expect(STAGE_DELEGATION.FRONTEND.ref).toBe('frontend-design');
    expect(STAGE_DELEGATION.CODEX.ref).toBe('codex:codex-rescue');
    expect(STAGE_DELEGATION.AGY.ref).toBe('cc-antigravity-plugin:antigravity-agent');
  });

  it('GAP_ORIGINS lists every non-pensador origin', () => {
    expect(GAP_ORIGINS).toContain('requirements-clarity');
    expect(GAP_ORIGINS).toContain('backend-development');
    expect(GAP_ORIGINS).toContain('ui-ux-pro-max');
    expect(GAP_ORIGINS).toContain('frontend-design');
    expect(GAP_ORIGINS).toContain('codex');
    expect(GAP_ORIGINS).toContain('agy');
    expect(GAP_ORIGINS).not.toContain('pensador');
  });

  it('exports AGY_MODEL_ALLOWLIST containing AGY_STAGE_MODEL', () => {
    expect(Array.isArray(AGY_MODEL_ALLOWLIST)).toBe(true);
    expect(AGY_MODEL_ALLOWLIST).toContain(AGY_STAGE_MODEL);
    expect(AGY_STAGE_MODEL).toBe('gemini-3.1-pro-high');
  });

  it('exports ASK_USER_QUESTION channel constant', () => {
    expect(ASK_USER_QUESTION).toBe('ASK_USER_QUESTION');
  });

  it('exports all required public API functions', () => {
    const fns = [
      initState,
      addQuestions,
      recordAnswer,
      pendingQuestions,
      canAdvance,
      advance,
      consolidate,
      withConsolidated,
      mapEffort,
      agyStageModel,
      classifyProject,
      isFullstack,
      planArtifacts,
      buildArtifactList,
      buildPrdBase,
      buildUserHistory,
      dispatchQuestion,
      serializeState,
      deserializeState,
    ];
    for (const fn of fns) {
      expect(typeof fn).toBe('function');
    }
  });

  it('initState returns a valid StageState for a non-empty demanda', () => {
    const state = initState('Criar uma tela de login');
    expect(state.currentStage).toBe('INIT');
    expect(state.needsDemanda).toBe(false);
    expect(state.demanda).toBe('Criar uma tela de login');
    expect(state.questions).toEqual([]);
    expect(state.consolidated).toEqual([]);
  });

  it('initState signals needsDemanda for empty/absent demanda', () => {
    expect(initState('').needsDemanda).toBe(true);
    expect(initState('   ').needsDemanda).toBe(true);
    expect(initState(undefined).needsDemanda).toBe(true);
    expect(initState(null).needsDemanda).toBe(true);
  });
});

describe('Pensador Engine — checkpoint serialization', () => {
  /** Builds a non-trivial mid-flow state to exercise the round-trip. */
  function midFlowState() {
    let state = initState('Criar uma API REST com banco de dados');
    state = addQuestions(state, 'EXPAND', [
      { id: 'q1', text: 'Auth?', origin: 'pensador', answer: null },
    ]);
    state = recordAnswer(state, 'q1', 'JWT');
    return { ...state, currentStage: 'CLARITY' };
  }

  it('round-trips a StageState through serialize → deserialize', () => {
    const state = midFlowState();
    const restored = deserializeState(serializeState(state));
    expect(restored).toEqual(state);
  });

  it('serialize output carries the checkpoint version', () => {
    const parsed = JSON.parse(serializeState(initState('x')));
    expect(parsed.version).toBe(CHECKPOINT_VERSION);
    expect(typeof parsed.savedAt).toBe('string');
  });

  it('deserialize returns null (never throws) for malformed / absent input', () => {
    expect(deserializeState(undefined)).toBeNull();
    expect(deserializeState(null)).toBeNull();
    expect(deserializeState('')).toBeNull();
    expect(deserializeState('{not json')).toBeNull();
    expect(deserializeState(JSON.stringify({ version: CHECKPOINT_VERSION }))).toBeNull();
  });

  it('deserialize rejects an incompatible checkpoint version', () => {
    const stale = JSON.stringify({ version: CHECKPOINT_VERSION + 1, state: initState('x') });
    expect(deserializeState(stale)).toBeNull();
  });

  it('deserialize rejects a state with an unknown currentStage', () => {
    const bad = JSON.stringify({
      version: CHECKPOINT_VERSION,
      state: { ...initState('x'), currentStage: 'BOGUS' },
    });
    expect(deserializeState(bad)).toBeNull();
  });
});
