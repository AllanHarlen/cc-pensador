/**
 * Unit tests for consolidate(state) and withConsolidated(state)
 *
 * Verifies the consolidation of answered questions from every
 * requirement-producing stage (EXPAND, CLARITY, BACKEND, UIUX, FRONTEND,
 * CODEX, AGY) into Requirement objects, and that withConsolidated stores the
 * result on state (the bridge the FINAL stage needs before planning artifacts).
 *
 * Requirements: 3.3, 4.3, 5.3, 7.3, 8.1, 8.3
 */
import { describe, it, expect } from 'vitest';
import {
  consolidate,
  withConsolidated,
  initState,
  addQuestions,
  recordAnswer,
} from '../scripts/pensador-engine.mjs';

describe('consolidate(state)', () => {
  describe('source field maps to originating stage', () => {
    it('sets source to "expand" for questions from EXPAND', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'EXPAND', [
        { id: 'q1', text: 'Question 1?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 'q1', 'My answer');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('expand');
    });

    it('sets source to "clarity" for questions from CLARITY', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'CLARITY', [
        { id: 'q2', text: 'Ambiguous req?', origin: 'requirements-clarity', answer: null },
      ]);
      state = recordAnswer(state, 'q2', 'Clarified');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('clarity');
    });

    it('sets source to "codex" for questions from CODEX', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'CODEX', [
        { id: 'q3', text: 'Question 3?', origin: 'codex', answer: null },
      ]);
      state = recordAnswer(state, 'q3', 'Codex answer');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('codex');
    });

    it('sets source to "agy" for questions from AGY', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'AGY', [
        { id: 'q4', text: 'Question 4?', origin: 'agy', answer: null },
      ]);
      state = recordAnswer(state, 'q4', 'AGY answer');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('agy');
    });
  });

  describe('resolvesGap flag for non-pensador origins', () => {
    it.each([
      ['CLARITY', 'requirements-clarity'],
      ['BACKEND', 'backend-development'],
      ['UIUX', 'ui-ux-pro-max'],
      ['FRONTEND', 'frontend-design'],
      ['CODEX', 'codex'],
      ['AGY', 'agy'],
    ])('sets resolvesGap = true for %s questions (origin %s)', (stage, origin) => {
      let state = initState('Test demanda');
      state = addQuestions(state, stage, [
        { id: 'g1', text: 'Gap?', origin, answer: null },
      ]);
      state = recordAnswer(state, 'g1', 'Gap answer');

      const result = consolidate(state);
      expect(result[0].resolvesGap).toBe(true);
    });

    it('does NOT set resolvesGap = true for questions with origin "pensador"', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'EXPAND', [
        { id: 'pq1', text: 'Pensador question?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 'pq1', 'User answer');

      const result = consolidate(state);
      expect(result[0].resolvesGap).not.toBe(true);
    });
  });

  describe('excludes unanswered questions', () => {
    it('excludes questions with answer === null', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'EXPAND', [
        { id: 'q1', text: 'Answered?', origin: 'pensador', answer: null },
        { id: 'q2', text: 'Unanswered?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 'q1', 'Yes');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('q1');
    });

    it('returns empty array when no questions are answered', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'EXPAND', [
        { id: 'q1', text: 'Question 1?', origin: 'pensador', answer: null },
        { id: 'q2', text: 'Question 2?', origin: 'pensador', answer: null },
      ]);

      const result = consolidate(state);
      expect(result).toHaveLength(0);
    });

    it('returns empty array when state has no questions', () => {
      const state = initState('Test demanda');
      const result = consolidate(state);
      expect(result).toHaveLength(0);
    });
  });

  describe('only includes requirement-producing stages', () => {
    it('excludes questions from PRD_BASE', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'PRD_BASE', [
        { id: 's1q1', text: 'PRD base question?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 's1q1', 'answer');

      const result = consolidate(state);
      expect(result).toHaveLength(0);
    });

    it('excludes questions from INIT stage', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'INIT', [
        { id: 'iq1', text: 'Init question?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 'iq1', 'Init answer');

      const result = consolidate(state);
      expect(result).toHaveLength(0);
    });

    it('includes every working stage when all are present', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'PRD_BASE', [
        { id: 'baseq', text: 'base', origin: 'pensador', answer: null },
      ]);
      state = addQuestions(state, 'EXPAND', [
        { id: 'expandq', text: 'expand', origin: 'pensador', answer: null },
      ]);
      state = addQuestions(state, 'CLARITY', [
        { id: 'clarityq', text: 'clarity', origin: 'requirements-clarity', answer: null },
      ]);
      state = addQuestions(state, 'BACKEND', [
        { id: 'backendq', text: 'backend', origin: 'backend-development', answer: null },
      ]);
      state = addQuestions(state, 'UIUX', [
        { id: 'uiuxq', text: 'uiux', origin: 'ui-ux-pro-max', answer: null },
      ]);
      state = addQuestions(state, 'FRONTEND', [
        { id: 'frontendq', text: 'frontend', origin: 'frontend-design', answer: null },
      ]);
      state = addQuestions(state, 'CODEX', [
        { id: 'codexq', text: 'codex', origin: 'codex', answer: null },
      ]);
      state = addQuestions(state, 'AGY', [
        { id: 'agyq', text: 'agy', origin: 'agy', answer: null },
      ]);
      for (const id of ['baseq', 'expandq', 'clarityq', 'backendq', 'uiuxq', 'frontendq', 'codexq', 'agyq']) {
        state = recordAnswer(state, id, `ans ${id}`);
      }

      const result = consolidate(state);
      const ids = result.map((r) => r.id);
      expect(ids).not.toContain('baseq');
      expect(ids).toEqual(
        expect.arrayContaining(['expandq', 'clarityq', 'backendq', 'uiuxq', 'frontendq', 'codexq', 'agyq'])
      );
      expect(result).toHaveLength(7);
    });
  });

  describe('full consolidation scenario', () => {
    it('consolidates all answered questions across stages with correct metadata', () => {
      let state = initState('Build a login screen');

      state = addQuestions(state, 'EXPAND', [
        { id: 'pq1', text: 'OAuth needed?', origin: 'pensador', answer: null },
        { id: 'pq2', text: 'MFA needed?', origin: 'pensador', answer: null },
      ]);
      state = addQuestions(state, 'CLARITY', [
        { id: 'rcq1', text: 'Which roles can log in?', origin: 'requirements-clarity', answer: null },
      ]);
      state = addQuestions(state, 'CODEX', [
        { id: 'cq1', text: 'Codex: API auth gap?', origin: 'codex', answer: null },
      ]);
      state = addQuestions(state, 'AGY', [
        { id: 'aq1', text: 'AGY: session management?', origin: 'agy', answer: null },
      ]);

      // Answer most but leave pq2 unanswered
      state = recordAnswer(state, 'pq1', 'Yes, OAuth');
      state = recordAnswer(state, 'rcq1', 'Admins and members');
      state = recordAnswer(state, 'cq1', 'Yes, JWT-based API');
      state = recordAnswer(state, 'aq1', 'Yes, server-side sessions');

      const result = consolidate(state);
      expect(result).toHaveLength(4);

      const pq1Req = result.find((r) => r.id === 'pq1');
      expect(pq1Req.source).toBe('expand');
      expect(pq1Req.resolvesGap).not.toBe(true);
      expect(pq1Req.text).toBe('Yes, OAuth');

      const rcq1Req = result.find((r) => r.id === 'rcq1');
      expect(rcq1Req.source).toBe('clarity');
      expect(rcq1Req.resolvesGap).toBe(true);

      const cq1Req = result.find((r) => r.id === 'cq1');
      expect(cq1Req.source).toBe('codex');
      expect(cq1Req.resolvesGap).toBe(true);

      const aq1Req = result.find((r) => r.id === 'aq1');
      expect(aq1Req.source).toBe('agy');
      expect(aq1Req.resolvesGap).toBe(true);

      // pq2 not in result (unanswered)
      expect(result.find((r) => r.id === 'pq2')).toBeUndefined();
    });
  });
});

describe('withConsolidated(state)', () => {
  it('stores the consolidate() result on state.consolidated', () => {
    let state = initState('Test demanda');
    state = addQuestions(state, 'EXPAND', [
      { id: 'q1', text: 'Need a REST API?', origin: 'pensador', answer: null },
    ]);
    state = recordAnswer(state, 'q1', 'Yes, REST API with database');

    expect(state.consolidated).toEqual([]); // empty before
    const next = withConsolidated(state);
    expect(next.consolidated).toEqual(consolidate(state));
    expect(next.consolidated).toHaveLength(1);
  });

  it('does not mutate the input state', () => {
    let state = initState('Test demanda');
    state = addQuestions(state, 'EXPAND', [
      { id: 'q1', text: 'x?', origin: 'pensador', answer: null },
    ]);
    state = recordAnswer(state, 'q1', 'y');

    const before = state.consolidated;
    withConsolidated(state);
    expect(state.consolidated).toBe(before);
    expect(state.consolidated).toEqual([]);
  });
});
