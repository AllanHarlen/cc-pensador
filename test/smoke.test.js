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
  STAGE4_MODEL,
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
  agyModelForStage4,
  classifyProject,
  isFullstack,
  planArtifacts,
  buildArtifactList,
  buildPrdBase,
  buildUserHistory,
  dispatchQuestion,
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

  it('exports AGY_MODEL_ALLOWLIST containing STAGE4_MODEL', () => {
    expect(Array.isArray(AGY_MODEL_ALLOWLIST)).toBe(true);
    expect(AGY_MODEL_ALLOWLIST).toContain(STAGE4_MODEL);
    expect(STAGE4_MODEL).toBe('gemini-3.1-pro-high');
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
      agyModelForStage4,
      classifyProject,
      isFullstack,
      planArtifacts,
      buildArtifactList,
      buildPrdBase,
      buildUserHistory,
      dispatchQuestion,
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
