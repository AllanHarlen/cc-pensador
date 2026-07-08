/**
 * Unit tests for isFullstack, planArtifacts, and buildArtifactList
 * Task 7.1 — Fullstack detection and artifact planning
 *
 * Requirements: 9.1, 9.2, 9.3, 10.1, 11.3, 12.1, 12.2, 12.3
 */
import { describe, it, expect } from 'vitest';
import {
  isFullstack,
  classifyProject,
  planArtifacts,
  buildArtifactList,
  withConsolidated,
  initState,
  addQuestions,
  recordAnswer,
} from '../scripts/pensador-engine.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal StageState with the given stage and consolidated requirements. */
function stateAt(currentStage, consolidated = []) {
  return { ...initState('test demanda'), currentStage, consolidated };
}

/** A requirement with backend keywords only. */
const backendReq = (id = 'b1') => ({
  id,
  source: 'expand',
  text: 'We need a REST API with a database backend',
});

/** A requirement with frontend keywords only. */
const frontendReq = (id = 'f1') => ({
  id,
  source: 'expand',
  text: 'We need a React frontend UI component',
});

/** A requirement with neither backend nor frontend keywords. */
const otherReq = (id = 'o1') => ({
  id,
  source: 'expand',
  text: 'We need a CLI tool for batch processing',
});

// ---------------------------------------------------------------------------
// isFullstack
// ---------------------------------------------------------------------------

describe('isFullstack(requirements)', () => {
  describe('determinism and totality', () => {
    it('returns the same result on repeated calls with the same input', () => {
      const reqs = [backendReq(), frontendReq()];
      expect(isFullstack(reqs)).toBe(isFullstack(reqs));
    });

    it('returns false for an empty requirements list', () => {
      expect(isFullstack([])).toBe(false);
    });

    it('does not throw for any input (total function)', () => {
      expect(() => isFullstack([])).not.toThrow();
      expect(() => isFullstack([backendReq()])).not.toThrow();
      expect(() => isFullstack([frontendReq()])).not.toThrow();
      expect(() => isFullstack([backendReq(), frontendReq()])).not.toThrow();
    });
  });

  describe('fullstack detection', () => {
    it('returns true when requirements mention both backend and frontend', () => {
      expect(isFullstack([backendReq(), frontendReq()])).toBe(true);
    });

    it('returns true when a single requirement mentions both backend and frontend', () => {
      const combined = {
        id: 'c1',
        source: 'expand',
        text: 'REST API backend server with a React web frontend interface',
      };
      expect(isFullstack([combined])).toBe(true);
    });

    it('returns false when only backend keywords are present', () => {
      expect(isFullstack([backendReq()])).toBe(false);
    });

    it('returns false when only frontend keywords are present', () => {
      expect(isFullstack([frontendReq()])).toBe(false);
    });

    it('returns false when neither backend nor frontend keywords are present', () => {
      expect(isFullstack([otherReq()])).toBe(false);
    });

    it('recognises "servidor" (Portuguese) as a backend keyword', () => {
      const ptReqs = [
        { id: 'pt1', source: 'expand', text: 'Precisamos de um servidor com banco de dados' },
        frontendReq(),
      ];
      expect(isFullstack(ptReqs)).toBe(true);
    });

    it('recognises "tela" (Portuguese) as a frontend keyword', () => {
      const ptReqs = [
        backendReq(),
        { id: 'pt2', source: 'expand', text: 'Criar uma tela de login' },
      ];
      expect(isFullstack(ptReqs)).toBe(true);
    });

    it('is case-insensitive (uppercase keywords)', () => {
      const upperReqs = [
        { id: 'u1', source: 'expand', text: 'BACKEND API SERVER with DATABASE' },
        { id: 'u2', source: 'expand', text: 'FRONTEND WEB UI' },
      ];
      expect(isFullstack(upperReqs)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// planArtifacts
// ---------------------------------------------------------------------------

describe('planArtifacts(state)', () => {
  describe('gate: empty plan outside FINAL/DONE', () => {
    const nonFinalStages = ['INIT', 'EXPLORE', 'PRD_BASE', 'ARCH', 'EXPAND', 'COMPLEXITY', 'BRAINSTORM_GERAL', 'CODEX', 'AGY'];

    for (const stage of nonFinalStages) {
      it(`returns empty plan for currentStage = ${stage}`, () => {
        const plan = planArtifacts(stateAt(stage, [backendReq(), frontendReq()]));
        expect(plan.prd).toBe(false);
        expect(plan.userhistory).toBe(false);
        expect(plan.communication).toBe(false);
      });
    }
  });

  describe('active plan in FINAL and DONE stages', () => {
    it('sets prd = true and userhistory = true when currentStage is FINAL', () => {
      const plan = planArtifacts(stateAt('FINAL', []));
      expect(plan.prd).toBe(true);
      expect(plan.userhistory).toBe(true);
    });

    it('sets prd = true and userhistory = true when currentStage is DONE', () => {
      const plan = planArtifacts(stateAt('DONE', []));
      expect(plan.prd).toBe(true);
      expect(plan.userhistory).toBe(true);
    });

    it('sets communication = true when a back-end is present (fullstack, FINAL)', () => {
      const fullstack = planArtifacts(stateAt('FINAL', [backendReq(), frontendReq()]));
      expect(fullstack.communication).toBe(true);

      const noBackend = planArtifacts(stateAt('FINAL', [otherReq()]));
      expect(noBackend.communication).toBe(false);
    });

    it('sets communication = true when a back-end is present (fullstack, DONE)', () => {
      const fullstack = planArtifacts(stateAt('DONE', [backendReq(), frontendReq()]));
      expect(fullstack.communication).toBe(true);

      const noBackend = planArtifacts(stateAt('DONE', []));
      expect(noBackend.communication).toBe(false);
    });

    it('sets communication = true for a back-end-only project (no front-end)', () => {
      const plan = planArtifacts(stateAt('FINAL', [backendReq()]));
      expect(plan.communication).toBe(true);
    });

    it('sets communication = false for a front-end-only project (no back-end)', () => {
      const plan = planArtifacts(stateAt('FINAL', [frontendReq()]));
      expect(plan.communication).toBe(false);
    });

    it('sets communication = false when no requirements are present (empty consolidated)', () => {
      const plan = planArtifacts(stateAt('FINAL', []));
      expect(plan.communication).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// buildArtifactList
// ---------------------------------------------------------------------------

describe('buildArtifactList(state)', () => {
  describe('gate enforcement — no artifacts outside FINAL/DONE', () => {
    const nonFinalStages = ['INIT', 'EXPLORE', 'PRD_BASE', 'ARCH', 'EXPAND', 'COMPLEXITY', 'BRAINSTORM_GERAL', 'CODEX', 'AGY'];

    for (const stage of nonFinalStages) {
      it(`returns empty list for currentStage = ${stage}`, () => {
        const artifacts = buildArtifactList(stateAt(stage, [backendReq(), frontendReq()]));
        expect(artifacts).toHaveLength(0);
      });
    }
  });

  describe('always includes prd and userhistory in FINAL/DONE', () => {
    it('includes prd artifact in FINAL stage', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', []));
      const prd = artifacts.find((a) => a.kind === 'prd');
      expect(prd).toBeDefined();
    });

    it('includes userhistory artifact in FINAL stage', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', []));
      const uh = artifacts.find((a) => a.kind === 'userhistory');
      expect(uh).toBeDefined();
    });

    it('includes both prd and userhistory in DONE stage', () => {
      const artifacts = buildArtifactList(stateAt('DONE', []));
      expect(artifacts.find((a) => a.kind === 'prd')).toBeDefined();
      expect(artifacts.find((a) => a.kind === 'userhistory')).toBeDefined();
    });
  });

  describe('communication artifact conditional on back-end presence', () => {
    it('includes communication when a back-end is present (fullstack)', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com).toBeDefined();
    });

    it('includes communication for a back-end-only project (no front-end)', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq()]));
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com).toBeDefined();
    });

    it('excludes communication when there is no back-end (front-end only)', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [frontendReq()]));
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com).toBeUndefined();
    });

    it('excludes communication when there is no back-end (other/CLI)', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [otherReq()]));
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com).toBeUndefined();
    });

    it('excludes communication when consolidated is empty', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', []));
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com).toBeUndefined();
    });
  });

  describe('artifact filename consistency', () => {
    it('prd artifact has filename "prd.md"', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', []));
      const prd = artifacts.find((a) => a.kind === 'prd');
      expect(prd.filename).toBe('prd.md');
    });

    it('userhistory artifact has filename "userhistory.md"', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', []));
      const uh = artifacts.find((a) => a.kind === 'userhistory');
      expect(uh.filename).toBe('userhistory.md');
    });

    it('communication artifact has filename "communication.md"', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com.filename).toBe('communication.md');
    });

    it('api-contract artifact is the machine-readable source of truth (openapi.yaml by default)', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq()]));
      const contract = artifacts.find((a) => a.kind === 'api-contract');
      expect(contract).toBeDefined();
      expect(contract.filename).toBe('openapi.yaml');
      expect(contract.spec).toBe('openapi');
      expect(contract.validation.mock).toContain('prism');
      // The human-readable communication view points back at the contract.
      const com = artifacts.find((a) => a.kind === 'communication');
      expect(com.derivedFrom).toBe('openapi.yaml');
    });

    it('api-contract follows the detected apiStyle (graphql → schema.graphql)', () => {
      const state = { ...stateAt('FINAL', [backendReq()]), apiStyle: 'graphql' };
      const contract = buildArtifactList(state).find((a) => a.kind === 'api-contract');
      expect(contract.filename).toBe('schema.graphql');
      expect(contract.spec).toBe('graphql-sdl');
    });

    it('excludes api-contract when there is no back-end', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [frontendReq()]));
      expect(artifacts.some((a) => a.kind === 'api-contract')).toBe(false);
    });
  });

  describe('artifact path is non-empty', () => {
    it('every artifact in FINAL stage has a non-empty path', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      for (const artifact of artifacts) {
        expect(typeof artifact.path).toBe('string');
        expect(artifact.path.length).toBeGreaterThan(0);
      }
    });

    it('every artifact in DONE stage has a non-empty path', () => {
      const artifacts = buildArtifactList(stateAt('DONE', [backendReq(), frontendReq()]));
      for (const artifact of artifacts) {
        expect(typeof artifact.path).toBe('string');
        expect(artifact.path.length).toBeGreaterThan(0);
      }
    });
  });

  describe('basePath with featurePath', () => {
    it('writes artifacts directly inside the update directory when featurePath is set', () => {
      const state = { ...stateAt('FINAL', []), featurePath: '.pensador/login-social-v1' };
      const prd = buildArtifactList(state).find((a) => a.kind === 'prd');
      expect(prd.path).toBe('.pensador/login-social-v1/prd.md');
    });

    it('falls back to .pensador/atualizacao-v1/ when featurePath is null', () => {
      const state = stateAt('FINAL', []);
      const prd = buildArtifactList(state).find((a) => a.kind === 'prd');
      expect(prd.path).toContain('.pensador/atualizacao-v1/');
    });
  });

  describe('total artifact count', () => {
    it('returns 2 artifacts (prd + userhistory) for a project with no back-end in FINAL', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [otherReq()]));
      expect(artifacts).toHaveLength(2);
    });

    it('returns 5 artifacts (prd + userhistory + api-contract + communication + design-system) for a fullstack project in FINAL', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      expect(artifacts.map((a) => a.kind)).toEqual([
        'prd',
        'userhistory',
        'api-contract',
        'communication',
        'design-system',
      ]);
    });

    it('returns 4 artifacts (prd + userhistory + api-contract + communication) for a back-end-only project in FINAL', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq()]));
      expect(artifacts.map((a) => a.kind)).toEqual([
        'prd',
        'userhistory',
        'api-contract',
        'communication',
      ]);
    });

    it('returns 3 artifacts (prd + userhistory + design-system) for a front-end-only project in FINAL', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [frontendReq()]));
      expect(artifacts.map((a) => a.kind)).toEqual(['prd', 'userhistory', 'design-system']);
    });
  });

  describe('design-system-files artifact (verbatim Open Design system dir)', () => {
    it('is NOT emitted when no system was selected (counts unchanged)', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [frontendReq()]));
      expect(artifacts.some((a) => a.kind === 'design-system-files')).toBe(false);
    });

    it('emits one verbatim-dir artifact per selected system, keyed by concrete id', () => {
      const state = { ...stateAt('FINAL', [frontendReq()]), designSystems: ['agentic'] };
      const dsf = buildArtifactList(state).filter((a) => a.kind === 'design-system-files');
      expect(dsf).toHaveLength(1);
      // Persisted under the feature root (featurePath is null here → fallback).
      expect(dsf[0].path).toBe('.pensador/atualizacao-v1/design-systems/agentic/');
      expect(dsf[0].verbatim).toBe(true);
      // uiPackageDir is only the downstream materialization hint, not the path.
      expect(dsf[0].materializeInto).toBe('packages/ui/design-systems/agentic/');
    });

    it('roots verbatim files under the concrete featurePath', () => {
      const state = {
        ...stateAt('FINAL', [frontendReq()]),
        featurePath: '.pensador/login-social-v1',
        designSystems: ['agentic'],
      };
      const dsf = buildArtifactList(state).find((a) => a.kind === 'design-system-files');
      expect(dsf.path).toBe('.pensador/login-social-v1/design-systems/agentic/');
    });

    it('supports a merge of multiple systems', () => {
      const state = {
        ...stateAt('FINAL', [frontendReq()]),
        featurePath: '.pensador/login-social-v1',
        designSystems: ['bmw', 'clean'],
      };
      const paths = buildArtifactList(state)
        .filter((a) => a.kind === 'design-system-files')
        .map((a) => a.path);
      expect(paths).toEqual([
        '.pensador/login-social-v1/design-systems/bmw/',
        '.pensador/login-social-v1/design-systems/clean/',
      ]);
    });

    it('records a custom uiPackageDir as materializeInto and fires in spec mode too', () => {
      const state = {
        ...stateAt('FINAL', [frontendReq()]),
        featurePath: '.pensador/checkout-v2',
        artifactMode: 'spec',
        designSystems: ['vercel'],
        uiPackageDir: 'frontend/packages/ui',
      };
      const dsf = buildArtifactList(state).find((a) => a.kind === 'design-system-files');
      // Persisted inside the feature root regardless of the UI package target.
      expect(dsf.path).toBe('.pensador/checkout-v2/design-systems/vercel/');
      expect(dsf.materializeInto).toBe('frontend/packages/ui/design-systems/vercel/');
    });

    it('is gated on the final stage and on hasFrontend', () => {
      // Not final → nothing.
      const early = { ...stateAt('EXPAND', [frontendReq()]), designSystems: ['agentic'] };
      expect(buildArtifactList(early)).toHaveLength(0);
      // Final but back-end-only → no design-system-files even if a system slipped in.
      const beOnly = { ...stateAt('FINAL', [backendReq()]), designSystems: ['agentic'] };
      expect(buildArtifactList(beOnly).some((a) => a.kind === 'design-system-files')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// classifyProject
// ---------------------------------------------------------------------------

describe('classifyProject(requirements)', () => {
  it('flags backend-only requirements', () => {
    const c = classifyProject([backendReq()]);
    expect(c.hasBackend).toBe(true);
    expect(c.hasFrontend).toBe(false);
    expect(c.isFullstack).toBe(false);
  });

  it('flags frontend-only requirements', () => {
    const c = classifyProject([frontendReq()]);
    expect(c.hasFrontend).toBe(true);
    expect(c.hasBackend).toBe(false);
    expect(c.isFullstack).toBe(false);
  });

  it('flags fullstack when both layers are present', () => {
    const c = classifyProject([backendReq(), frontendReq()]);
    expect(c.isFullstack).toBe(true);
  });

  it('is total: handles empty and missing input without throwing', () => {
    expect(() => classifyProject([])).not.toThrow();
    expect(() => classifyProject(undefined)).not.toThrow();
    expect(classifyProject([]).isFullstack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: withConsolidated → planArtifacts (regression for the prior
// wiring gap where state.consolidated stayed empty and communication
// was never planned).
// ---------------------------------------------------------------------------

describe('withConsolidated wires consolidated requirements into artifact planning', () => {
  /** Drives a state through answered questions, then to FINAL with consolidation applied. */
  function finalStateFrom(questions) {
    let state = initState('demanda');
    state = addQuestions(state, 'EXPAND', questions);
    for (const q of questions) {
      state = recordAnswer(state, q.id, q.answerText);
    }
    state = { ...state, currentStage: 'FINAL' };
    return withConsolidated(state);
  }

  it('plans communication when answered requirements are fullstack', () => {
    const state = finalStateFrom([
      { id: 'a', text: 'backend?', origin: 'pensador', answer: null, answerText: 'A REST API with a database' },
      { id: 'b', text: 'frontend?', origin: 'pensador', answer: null, answerText: 'A React web UI' },
    ]);
    expect(planArtifacts(state).communication).toBe(true);
    expect(buildArtifactList(state).find((a) => a.kind === 'communication')).toBeDefined();
  });

  it('does NOT plan communication when answered requirements are not fullstack', () => {
    const state = finalStateFrom([
      { id: 'a', text: 'what?', origin: 'pensador', answer: null, answerText: 'A CLI batch tool' },
    ]);
    expect(planArtifacts(state).communication).toBe(false);
    expect(buildArtifactList(state).find((a) => a.kind === 'communication')).toBeUndefined();
  });
});
