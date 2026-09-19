import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColor } from '../scripts/lib/color.mjs';
import { REQUIRED_SCHEMA_TOKENS, THEME_TOKENS, SHARED_TOKENS, canonicalJson, contractSha256, mapEngineToContract } from '../scripts/lib/token-mapper.mjs';
import { renderPackageFiles } from '../scripts/design-package.mjs';
import { engineFixture, fixtureContract } from './helpers/design-fixture.js';

describe('color', () => {
  it('parses hex, rgb and oklch and computes WCAG contrast', () => {
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor('rgb(255 0 0)')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColor('nope')).toBeNull();
    const red = parseColor('oklch(0.628 0.2577 29.23)');
    expect(red.r).toBeGreaterThan(0.95);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', 'rgb(255 255 255)')).toBeCloseTo(4.48, 1);
  });
});

describe('engine -> TOKEN_SCHEMA mapper', () => {
  const contract = fixtureContract();

  it('maps every required schema token in both themes', () => {
    for (const name of REQUIRED_SCHEMA_TOKENS) {
      const inTheme = name in contract.themes.light;
      const value = inTheme ? contract.themes.light[name] : contract.tokens[name];
      expect(value, name).toBeTruthy();
      if (inTheme) expect(contract.themes.dark[name], `dark ${name}`).toBeTruthy();
    }
    expect(Object.keys(contract.themes.light)).toEqual(THEME_TOKENS);
    expect(Object.keys(contract.tokens)).toEqual(SHARED_TOKENS);
  });

  it('applies the deterministic rules for tokens the engine does not produce', () => {
    const t = contract.tokens;
    expect(t['--section-y-desktop']).toBe('96px');
    expect(t['--section-y-tablet']).toBe('64px');
    expect(t['--section-y-phone']).toBe('48px');
    expect(t['--container-max']).toBe('1200px');
    expect(t['--container-gutter-desktop']).toBe('32px');
    expect(t['--radius-sm']).toBe('8px');
    expect(t['--radius-md']).toBe('12px');
    expect(t['--radius-lg']).toBe('16px');
    expect(t['--tracking-display']).toBe('-0.01em');
    expect(t['--motion-fast']).toBe('100ms');
    expect(t['--text-xs']).toBe('11px');
    expect(t['--text-4xl']).toBe('38px');
    expect(t['--leading-body']).toBe('1.571');
    expect(t['--focus-ring']).toBe('0 0 0 2px var(--bg), 0 0 0 4px var(--focus)');
    expect(t['--font-display']).toBe(t['--font-body']);
    expect(contract.themes.light['--accent-on']).toBe('#ffffff');
  });

  it('honours a display font supplied by the brief', () => {
    const { seed, tokens } = engineFixture();
    const custom = mapEngineToContract({ systemId: 'x', seed, tokens, engine: { version: '1' }, fontDisplay: 'Fraunces, serif', extras: {} });
    expect(custom.tokens['--font-display']).toBe('Fraunces, serif');
  });

  it('keeps locked brief colors in the light theme and derives the dark ones', () => {
    expect(contract.themes.light['--accent']).toBe('#0f766e');
    expect(contract.themes.dark['--accent']).not.toBe('#0f766e');
    expect(contract.provenance.light['--accent']).toBe('brief');
    expect(contract.provenance.light['--accent-on']).toBe('derived');
    expect(contract.provenance.dark['--accent']).toBe('derived');
    expect(contract.provenance.seed.fontFamily).toBe('brief');
    expect(contract.provenance.seed.borderRadius).toBe('engine-default');
  });

  it('replaces raw engine values that fail WCAG with safe variants (Phase 0 findings)', () => {
    for (const pair of contract.contrastPairs) {
      const values = contract.themes[pair.theme];
      expect(contrastRatio(values[pair.foreground], values[pair.background]), `${pair.theme} ${pair.foreground}/${pair.background}`).toBeGreaterThanOrEqual(pair.minimum);
    }
    // engine success/warning on the light layout are 3.30/3.19 raw; the text variants must not be the raw values
    expect(contract.themes.light['--warn-text']).not.toBe(contract.themes.light['--warn']);
    // colorBorder is 1.41:1; input borders use --border-strong (>= 3:1)
    expect(contrastRatio(contract.themes.light['--border-strong'], contract.themes.light['--surface'])).toBeGreaterThanOrEqual(3);
    expect(contract.themes.compact['--control-h']).toBe('28px');
    expect(contract.themes.compact['--space-4']).toBe('12px');
  });

  it('signs the canonical contract without its own hash', () => {
    expect(contract.sha256).toBe(contractSha256(contract));
    const { sha256: _omit, ...rest } = contract;
    expect(canonicalJson(rest)).not.toContain('"sha256"');
  });
});

describe('determinism (property)', () => {
  const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, '0')}`);
  const colorKeys = ['colorPrimary', 'colorPrimaryHover', 'colorPrimaryActive', 'colorSuccess', 'colorSuccessHover', 'colorSuccessActive', 'colorWarning', 'colorWarningHover', 'colorWarningActive', 'colorError', 'colorErrorHover', 'colorErrorActive', 'colorInfo', 'colorLinkHover', 'colorLinkActive'];

  const shuffled = (object, order) => Object.fromEntries(Object.keys(object).map((key, index) => [key, object[key], order[index % order.length]]).sort((a, b) => a[2] - b[2]).map(([key, value]) => [key, value]));

  it('same seed -> same contract bytes, independent of key order; every contrast pair holds for any ladder colors', () => {
    fc.assert(fc.property(fc.array(hex, { minLength: colorKeys.length, maxLength: colorKeys.length }), fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 8 }), (colors, order) => {
      const { seed, tokens } = engineFixture();
      const patch = (set) => ({ ...set, ...Object.fromEntries(colorKeys.map((key, index) => [key, colors[index]])) });
      const a = mapEngineToContract({ systemId: 'p', seed, tokens: { default: patch(tokens.default), dark: patch(tokens.dark), compact: tokens.compact }, engine: { version: '1' }, extras: {} });
      const b = mapEngineToContract({ systemId: 'p', seed: shuffled(seed, order), tokens: { default: shuffled(patch(tokens.default), order), dark: shuffled(patch(tokens.dark), order), compact: shuffled(tokens.compact, order) }, engine: { version: '1' }, extras: {} });
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(a.sha256).toBe(b.sha256);
      expect(renderPackageFiles(a)['tokens.css']).toBe(renderPackageFiles(b)['tokens.css']);
      for (const pair of a.contrastPairs) {
        const values = a.themes[pair.theme];
        expect(contrastRatio(values[pair.foreground], values[pair.background])).toBeGreaterThanOrEqual(pair.minimum);
      }
    }), { numRuns: 60 });
  });

});
