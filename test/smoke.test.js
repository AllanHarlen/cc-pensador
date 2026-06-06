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
  isFrontendOnly,
  codexParticipates,
  planArtifacts,
  buildArtifactList,
  buildPrdBase,
  buildUserHistory,
  dispatchQuestion,
  detectComplexity,
  allocateFeatureDir,
  buildFeaturePath,
  CHECKPOINT_VERSION,
  serializeState,
  deserializeState,
} from '../scripts/pensador-engine.mjs';

describe('Pensador Engine — smoke', () => {
  it('exports STAGE_ORDER with the correct canonical sequence', () => {
    expect(STAGE_ORDER).toEqual([
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
    ]);
  });

  it('exports REQUIREMENT_STAGES covering every working stage after PRD_BASE', () => {
    expect(REQUIREMENT_STAGES).toEqual([
      'EXPAND',
      'BRAINSTORM_GERAL',
      'CODEX',
      'AGY',
    ]);
  });

  it('maps each brainstorm/refinement stage to a delegation target', () => {
    expect(STAGE_DELEGATION.BRAINSTORM_GERAL.kind).toBe('parallel');
    expect(STAGE_DELEGATION.BRAINSTORM_GERAL.domains.requirements.ref).toBe('requirements-clarity');
    expect(STAGE_DELEGATION.BRAINSTORM_GERAL.domains.backend.ref).toBe('codex:codex-rescue');
    expect(STAGE_DELEGATION.BRAINSTORM_GERAL.domains.uiux.ref).toBe('cc-antigravity-plugin:antigravity-agent');
    expect(STAGE_DELEGATION.CODEX.ref).toBe('codex:codex-rescue');
    expect(STAGE_DELEGATION.AGY.ref).toBe('cc-antigravity-plugin:antigravity-agent');
  });

  it('gates the CODEX stage off for a front-end-specific activity', () => {
    // Advisory marker on the delegation entry.
    expect(STAGE_DELEGATION.CODEX.relevantWhen).toBe('not(frontendOnly)');
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
      detectComplexity,
      allocateFeatureDir,
      buildFeaturePath,
      serializeState,
      deserializeState,
    ];
    for (const fn of fns) {
      expect(typeof fn).toBe('function');
    }
  });

  describe('Codex participation', () => {
    it('isFrontendOnly is true only when there is a front-end and no back-end', () => {
      expect(isFrontendOnly({ hasFrontend: true, hasBackend: false })).toBe(true);
      expect(isFrontendOnly({ hasFrontend: true, hasBackend: true })).toBe(false);
      expect(isFrontendOnly({ hasFrontend: false, hasBackend: true })).toBe(false);
      expect(isFrontendOnly({ hasFrontend: false, hasBackend: false })).toBe(false);
    });

    it('isFrontendOnly is total — no args / partial signals never throw', () => {
      expect(() => isFrontendOnly()).not.toThrow();
      expect(isFrontendOnly()).toBe(false);
      expect(isFrontendOnly({ hasFrontend: true })).toBe(true);
    });

    it('codexParticipates is the negation of isFrontendOnly', () => {
      for (const s of [
        { hasFrontend: true, hasBackend: false },
        { hasFrontend: true, hasBackend: true },
        { hasFrontend: false, hasBackend: true },
        { hasFrontend: false, hasBackend: false },
        {},
      ]) {
        expect(codexParticipates(s)).toBe(!isFrontendOnly(s));
      }
    });

    it('excludes Codex from a front-end-specific activity but keeps it for back-end/fullstack', () => {
      expect(codexParticipates({ hasFrontend: true, hasBackend: false })).toBe(false);
      expect(codexParticipates({ hasFrontend: true, hasBackend: true })).toBe(true);
      expect(codexParticipates({ hasFrontend: false, hasBackend: true })).toBe(true);
    });

    it('accepts a classifyProject result directly', () => {
      const frontOnly = classifyProject([{ text: 'Criar uma tela de login responsiva' }]);
      expect(frontOnly.hasFrontend).toBe(true);
      expect(frontOnly.hasBackend).toBe(false);
      expect(codexParticipates(frontOnly)).toBe(false);
    });
  });

  it('initState returns a valid StageState for a non-empty demanda', () => {
    const state = initState('Criar uma tela de login');
    expect(state.currentStage).toBe('INIT');
    expect(state.needsDemanda).toBe(false);
    expect(state.demanda).toBe('Criar uma tela de login');
    expect(state.questions).toEqual([]);
    expect(state.consolidated).toEqual([]);
    expect(state.featurePath).toBeNull();
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
    return { ...state, currentStage: 'BRAINSTORM_GERAL' };
  }

  it('CHECKPOINT_VERSION is 2', () => {
    expect(CHECKPOINT_VERSION).toBe(2);
  });

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

  it('deserialize rejects a v1 checkpoint (version 1)', () => {
    const v1 = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      state: { ...initState('x'), currentStage: 'EXPAND' },
    });
    expect(deserializeState(v1)).toBeNull();
  });

  it('deserialize rejects a state with an unknown currentStage', () => {
    const bad = JSON.stringify({
      version: CHECKPOINT_VERSION,
      state: { ...initState('x'), currentStage: 'BOGUS' },
    });
    expect(deserializeState(bad)).toBeNull();
  });
});
