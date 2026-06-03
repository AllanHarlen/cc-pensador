/**
 * Unit tests for consolidate(state)
 * Task 5.1 — Implements and verifies the consolidation of answered questions
 * from Stages 2, 3, and 4 into Requirement objects.
 *
 * Requirements: 3.3, 4.3, 5.3, 7.3, 8.1, 8.3
 */
import { describe, it, expect } from 'vitest';
import { consolidate, initState, addQuestions, recordAnswer } from '../scripts/pensador-engine.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a state with questions in a given stage, recording answers for a subset.
 */
function buildStateWithQuestions({ stage, questions, answeredIds = [] }) {
  let state = initState('Test demanda');
  state = addQuestions(state, stage, questions);
  for (const id of answeredIds) {
    state = recordAnswer(state, id, `Answer for ${id}`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('consolidate(state)', () => {
  describe('source field maps to originating stage', () => {
    it('sets source to "stage_2" for questions from STAGE_2', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_2', [
        { id: 'q1', text: 'Question 1?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 'q1', 'My answer');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('stage_2');
    });

    it('sets source to "stage_3" for questions from STAGE_3', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_3', [
        { id: 'q2', text: 'Question 2?', origin: 'codex', answer: null },
      ]);
      state = recordAnswer(state, 'q2', 'Codex answer');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('stage_3');
    });

    it('sets source to "stage_4" for questions from STAGE_4', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_4', [
        { id: 'q3', text: 'Question 3?', origin: 'agy', answer: null },
      ]);
      state = recordAnswer(state, 'q3', 'AGY answer');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('stage_4');
    });
  });

  describe('resolvesGap flag for Codex/AGY origins', () => {
    it('sets resolvesGap = true for questions with origin "codex"', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_3', [
        { id: 'cq1', text: 'Codex gap?', origin: 'codex', answer: null },
      ]);
      state = recordAnswer(state, 'cq1', 'Gap answer');

      const result = consolidate(state);
      expect(result[0].resolvesGap).toBe(true);
    });

    it('sets resolvesGap = true for questions with origin "agy"', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_4', [
        { id: 'aq1', text: 'AGY gap?', origin: 'agy', answer: null },
      ]);
      state = recordAnswer(state, 'aq1', 'Gap answer');

      const result = consolidate(state);
      expect(result[0].resolvesGap).toBe(true);
    });

    it('does NOT set resolvesGap = true for questions with origin "pensador"', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_2', [
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
      state = addQuestions(state, 'STAGE_2', [
        { id: 'q1', text: 'Answered?', origin: 'pensador', answer: null },
        { id: 'q2', text: 'Unanswered?', origin: 'pensador', answer: null },
      ]);
      // Only answer q1
      state = recordAnswer(state, 'q1', 'Yes');

      const result = consolidate(state);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('q1');
    });

    it('returns empty array when no questions are answered', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_2', [
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

  describe('only includes stages 2, 3, and 4', () => {
    it('excludes questions from STAGE_1', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_1', [
        { id: 's1q1', text: 'Stage 1 question?', origin: 'pensador', answer: null },
      ]);
      state = recordAnswer(state, 's1q1', 'Stage 1 answer');

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

    it('only includes questions from stages 2, 3, 4 when mixed stages present', () => {
      let state = initState('Test demanda');
      state = addQuestions(state, 'STAGE_1', [
        { id: 's1q', text: 'S1 question', origin: 'pensador', answer: null },
      ]);
      state = addQuestions(state, 'STAGE_2', [
        { id: 's2q', text: 'S2 question', origin: 'pensador', answer: null },
      ]);
      state = addQuestions(state, 'STAGE_3', [
        { id: 's3q', text: 'S3 question', origin: 'codex', answer: null },
      ]);
      state = addQuestions(state, 'STAGE_4', [
        { id: 's4q', text: 'S4 question', origin: 'agy', answer: null },
      ]);
      // Answer all
      state = recordAnswer(state, 's1q', 'S1 ans');
      state = recordAnswer(state, 's2q', 'S2 ans');
      state = recordAnswer(state, 's3q', 'S3 ans');
      state = recordAnswer(state, 's4q', 'S4 ans');

      const result = consolidate(state);
      expect(result).toHaveLength(3);
      const ids = result.map((r) => r.id);
      expect(ids).not.toContain('s1q');
      expect(ids).toContain('s2q');
      expect(ids).toContain('s3q');
      expect(ids).toContain('s4q');
    });
  });

  describe('full consolidation scenario', () => {
    it('consolidates all answered questions across stages 2, 3, 4 with correct metadata', () => {
      let state = initState('Build a login screen');

      state = addQuestions(state, 'STAGE_2', [
        { id: 'pq1', text: 'OAuth needed?', origin: 'pensador', answer: null },
        { id: 'pq2', text: 'MFA needed?', origin: 'pensador', answer: null },
      ]);
      state = addQuestions(state, 'STAGE_3', [
        { id: 'cq1', text: 'Codex: API auth gap?', origin: 'codex', answer: null },
      ]);
      state = addQuestions(state, 'STAGE_4', [
        { id: 'aq1', text: 'AGY: session management?', origin: 'agy', answer: null },
        { id: 'aq2', text: 'AGY: CSRF protection?', origin: 'agy', answer: null },
      ]);

      // Answer most but leave pq2 unanswered
      state = recordAnswer(state, 'pq1', 'Yes, OAuth');
      state = recordAnswer(state, 'cq1', 'Yes, JWT-based API');
      state = recordAnswer(state, 'aq1', 'Yes, server-side sessions');
      state = recordAnswer(state, 'aq2', 'Yes, CSRF tokens');

      const result = consolidate(state);

      expect(result).toHaveLength(4);

      const pq1Req = result.find((r) => r.id === 'pq1');
      expect(pq1Req.source).toBe('stage_2');
      expect(pq1Req.resolvesGap).not.toBe(true);
      expect(pq1Req.text).toBe('Yes, OAuth');

      const cq1Req = result.find((r) => r.id === 'cq1');
      expect(cq1Req.source).toBe('stage_3');
      expect(cq1Req.resolvesGap).toBe(true);

      const aq1Req = result.find((r) => r.id === 'aq1');
      expect(aq1Req.source).toBe('stage_4');
      expect(aq1Req.resolvesGap).toBe(true);

      const aq2Req = result.find((r) => r.id === 'aq2');
      expect(aq2Req.source).toBe('stage_4');
      expect(aq2Req.resolvesGap).toBe(true);

      // pq2 not in result (unanswered)
      expect(result.find((r) => r.id === 'pq2')).toBeUndefined();
    });
  });
});
