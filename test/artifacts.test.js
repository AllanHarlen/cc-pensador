/**
 * Unit tests for isFullstack, planArtifacts, and buildArtifactList
 * Task 7.1 — Fullstack detection and artifact planning
 *
 * Requirements: 9.1, 9.2, 9.3, 10.1, 11.3, 12.1, 12.2, 12.3
 */
import { describe, it, expect } from 'vitest';
import {
  isFullstack,
  planArtifacts,
  buildArtifactList,
  initState,
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
  source: 'stage_2',
  text: 'We need a REST API with a database backend',
});

/** A requirement with frontend keywords only. */
const frontendReq = (id = 'f1') => ({
  id,
  source: 'stage_2',
  text: 'We need a React frontend UI component',
});

/** A requirement with neither backend nor frontend keywords. */
const otherReq = (id = 'o1') => ({
  id,
  source: 'stage_2',
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
        source: 'stage_2',
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
        { id: 'pt1', source: 'stage_2', text: 'Precisamos de um servidor com banco de dados' },
        frontendReq(),
      ];
      expect(isFullstack(ptReqs)).toBe(true);
    });

    it('recognises "tela" (Portuguese) as a frontend keyword', () => {
      const ptReqs = [
        backendReq(),
        { id: 'pt2', source: 'stage_2', text: 'Criar uma tela de login' },
      ];
      expect(isFullstack(ptReqs)).toBe(true);
    });

    it('is case-insensitive (uppercase keywords)', () => {
      const upperReqs = [
        { id: 'u1', source: 'stage_2', text: 'BACKEND API SERVER with DATABASE' },
        { id: 'u2', source: 'stage_2', text: 'FRONTEND WEB UI' },
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
    const nonFinalStages = ['INIT', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4'];

    for (const stage of nonFinalStages) {
      it(`returns empty plan for currentStage = ${stage}`, () => {
        const plan = planArtifacts(stateAt(stage, [backendReq(), frontendReq()]));
        expect(plan.prd).toBe(false);
        expect(plan.userhistory).toBe(false);
        expect(plan.comunication).toBe(false);
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

    it('sets comunication = true iff consolidated requirements are fullstack (FINAL)', () => {
      const fullstack = planArtifacts(stateAt('FINAL', [backendReq(), frontendReq()]));
      expect(fullstack.comunication).toBe(true);

      const notFullstack = planArtifacts(stateAt('FINAL', [otherReq()]));
      expect(notFullstack.comunication).toBe(false);
    });

    it('sets comunication = true iff consolidated requirements are fullstack (DONE)', () => {
      const fullstack = planArtifacts(stateAt('DONE', [backendReq(), frontendReq()]));
      expect(fullstack.comunication).toBe(true);

      const notFullstack = planArtifacts(stateAt('DONE', []));
      expect(notFullstack.comunication).toBe(false);
    });

    it('sets comunication = false when no requirements are present (empty consolidated)', () => {
      const plan = planArtifacts(stateAt('FINAL', []));
      expect(plan.comunication).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// buildArtifactList
// ---------------------------------------------------------------------------

describe('buildArtifactList(state)', () => {
  describe('gate enforcement — no artifacts outside FINAL/DONE', () => {
    const nonFinalStages = ['INIT', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4'];

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

  describe('comunication artifact conditional on fullstack', () => {
    it('includes comunication when requirements are fullstack', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      const com = artifacts.find((a) => a.kind === 'comunication');
      expect(com).toBeDefined();
    });

    it('excludes comunication when requirements are not fullstack', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [otherReq()]));
      const com = artifacts.find((a) => a.kind === 'comunication');
      expect(com).toBeUndefined();
    });

    it('excludes comunication when consolidated is empty', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', []));
      const com = artifacts.find((a) => a.kind === 'comunication');
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

    it('comunication artifact has filename "comunication_json.md"', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      const com = artifacts.find((a) => a.kind === 'comunication');
      expect(com.filename).toBe('comunication_json.md');
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

  describe('total artifact count', () => {
    it('returns 2 artifacts (prd + userhistory) for non-fullstack project in FINAL', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [otherReq()]));
      expect(artifacts).toHaveLength(2);
    });

    it('returns 3 artifacts (prd + userhistory + comunication) for fullstack project in FINAL', () => {
      const artifacts = buildArtifactList(stateAt('FINAL', [backendReq(), frontendReq()]));
      expect(artifacts).toHaveLength(3);
    });
  });
});
