/**
 * Smoke test — verifies that the Pensador Engine module can be imported
 * and that its public API surface is intact.
 */
import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER,
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
  mapEffort,
  agyModelForStage4,
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
      'STAGE_1',
      'STAGE_2',
      'STAGE_3',
      'STAGE_4',
      'FINAL',
      'DONE',
    ]);
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
      mapEffort,
      agyModelForStage4,
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
