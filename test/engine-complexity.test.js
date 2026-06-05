import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectComplexity } from '../scripts/pensador-engine.mjs';

const signalsFor = ({
  domainCount = 1,
  hasBackend = false,
  hasBroadScopeKeywords = false,
  isGreenfield = false,
} = {}) => ({
  domainCount,
  hasBackend,
  hasBroadScopeKeywords,
  isGreenfield,
});

describe('detectComplexity(signals)', () => {
  describe('individual signals', () => {
    it('returns Lite for score 0 when all signals are false', () => {
      expect(detectComplexity(signalsFor())).toEqual({ score: 0, mode: 'Lite' });
    });

    it('returns Lite for score 1 when only domainCount > 1', () => {
      expect(detectComplexity(signalsFor({ domainCount: 2 }))).toEqual({ score: 1, mode: 'Lite' });
    });

    it('returns Lite for score 1 when only hasBackend is true', () => {
      expect(detectComplexity(signalsFor({ hasBackend: true }))).toEqual({ score: 1, mode: 'Lite' });
    });

    it('returns Lite for score 1 when only hasBroadScopeKeywords is true', () => {
      expect(detectComplexity(signalsFor({ hasBroadScopeKeywords: true }))).toEqual({ score: 1, mode: 'Lite' });
    });

    it('returns Lite for score 1 when only isGreenfield is true', () => {
      expect(detectComplexity(signalsFor({ isGreenfield: true }))).toEqual({ score: 1, mode: 'Lite' });
    });
  });

  describe('threshold', () => {
    it('returns Completo for score 2', () => {
      expect(detectComplexity(signalsFor({ domainCount: 2, hasBackend: true }))).toEqual({
        score: 2,
        mode: 'Completo',
      });
    });

    it('returns Completo for score 3', () => {
      expect(detectComplexity(signalsFor({
        domainCount: 2,
        hasBackend: true,
        hasBroadScopeKeywords: true,
      }))).toEqual({ score: 3, mode: 'Completo' });
    });

    it('returns Completo for score 4', () => {
      expect(detectComplexity(signalsFor({
        domainCount: 2,
        hasBackend: true,
        hasBroadScopeKeywords: true,
        isGreenfield: true,
      }))).toEqual({ score: 4, mode: 'Completo' });
    });

    it('treats a tie at 2 as Completo', () => {
      expect(detectComplexity(signalsFor({ hasBroadScopeKeywords: true, isGreenfield: true })).mode).toBe('Completo');
    });
  });

  describe('totality', () => {
    it('does not throw for {}', () => {
      expect(() => detectComplexity({})).not.toThrow();
      expect(detectComplexity({})).toEqual({ score: 0, mode: 'Lite' });
    });

    it('does not throw when called without args', () => {
      expect(() => detectComplexity()).not.toThrow();
      expect(detectComplexity()).toEqual({ score: 0, mode: 'Lite' });
    });

    it('treats missing domainCount as 1', () => {
      expect(detectComplexity({ hasBackend: true })).toEqual({ score: 1, mode: 'Lite' });
    });
  });

  describe('properties', () => {
    const signalsArbitrary = fc.record(
      {
        domainCount: fc.option(fc.integer({ min: -10, max: 10 }), { nil: undefined }),
        hasBackend: fc.option(fc.boolean(), { nil: undefined }),
        hasBroadScopeKeywords: fc.option(fc.boolean(), { nil: undefined }),
        isGreenfield: fc.option(fc.boolean(), { nil: undefined }),
      },
      { requiredKeys: [] }
    );

    it('score is always between 0 and 4', () => {
      fc.assert(fc.property(signalsArbitrary, (signals) => {
        const result = detectComplexity(signals);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(4);
      }));
    });

    it('mode is always Lite or Completo', () => {
      fc.assert(fc.property(signalsArbitrary, (signals) => {
        expect(['Lite', 'Completo']).toContain(detectComplexity(signals).mode);
      }));
    });

    it('is deterministic for the same input', () => {
      fc.assert(fc.property(signalsArbitrary, (signals) => {
        expect(detectComplexity(signals)).toEqual(detectComplexity(signals));
      }));
    });

    it('returns Completo whenever score >= 2', () => {
      fc.assert(fc.property(signalsArbitrary, (signals) => {
        const result = detectComplexity(signals);
        if (result.score >= 2) {
          expect(result.mode).toBe('Completo');
        }
      }));
    });
  });
});
