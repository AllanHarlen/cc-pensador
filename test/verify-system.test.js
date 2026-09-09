/**
 * od-verify-system.mjs — detects divergence between DESIGN.md (prose) and
 * tokens.css (machine-readable source of truth) inside a fetched Open
 * Design system. Achado 12.1 (analise-run-oficina-saas-20260905.md): a real
 * run's DESIGN.md described a yellow, Poppins-based product while
 * tokens.css defined a blue, Inter-based one — the same bundle, describing
 * two different products.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConsistencyReport,
  comparePalette,
  compareSpacingScale,
  compareTypography,
  hexValuesFromDesignMd,
  parseTokensCssProperties,
} from '../scripts/od-verify-system.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/od-verify-system.mjs', import.meta.url));
const roots = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

const REAL_TOKENS_CSS = `:root {
  --bg: #f5f8ff;
  --fg: #101828;
  --accent: #2563eb;
  --warn: #f59e0b;
  --danger: #ef4444;
  --font-body: Inter, sans-serif;
  --font-mono: "SF Mono", monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
}`;

const DIVERGENT_DESIGN_MD = `# Design System

## 2. Cores
- Primaria: #FECE14
- Secundaria: #000000
- Texto: #111827
- Warning: #D97706
- Danger: #DC2626

## 3. Tipografia
Fontes: Poppins (corpo) e IBM Plex Mono (codigo). Escala mobile-first compact.

## 4. Espacamento
Escala: 4/8/12/16/24/32
`;

const CONSISTENT_DESIGN_MD = `# Design System

## 2. Cores
- Primaria: #2563eb
- Fundo: #f5f8ff
- Texto: #101828
- Warning: #f59e0b
- Danger: #ef4444

## 3. Tipografia
Fontes: Inter (corpo) e SF Mono (codigo).

## 4. Espacamento
Escala: 4/8/12/16/20/24/32/48
`;

/* -------------------------------------------------------------------------- */
/* Pure functions                                                             */
/* -------------------------------------------------------------------------- */

describe('parseTokensCssProperties', () => {
  it('extracts every custom property with its trimmed value', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    expect(tokens.get('--accent')).toBe('#2563eb');
    expect(tokens.get('--font-body')).toBe('Inter, sans-serif');
    expect(tokens.get('--space-4')).toBe('16px');
  });
});

describe('hexValuesFromDesignMd', () => {
  it('collects every hex literal mentioned in the prose, lowercased', () => {
    const hexes = hexValuesFromDesignMd(DIVERGENT_DESIGN_MD);
    expect(hexes.has('#fece14')).toBe(true);
    expect(hexes.has('#000000')).toBe(true);
  });
});

describe('comparePalette (Achado 12.1: primary color yellow vs blue)', () => {
  it('flags a DESIGN.md color that never appears as a token value', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = comparePalette(tokens, DIVERGENT_DESIGN_MD);
    expect(result.onlyInDesignMd).toContain('#fece14');
    expect(result.onlyInDesignMd).toContain('#000000');
  });

  it('reports no divergence when every DESIGN.md color is also a token value', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = comparePalette(tokens, CONSISTENT_DESIGN_MD);
    expect(result.onlyInDesignMd).toEqual([]);
  });

  it('does not flag a token hex that DESIGN.md simply never mentions (prose is not expected to enumerate every token)', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = comparePalette(tokens, '# Design\nNo colors mentioned here.\n');
    expect(result.onlyInDesignMd).toEqual([]);
  });
});

describe('compareTypography (Achado 12.1: Poppins/IBM Plex Mono vs Inter/SF Mono)', () => {
  it('flags a declared font family never mentioned in DESIGN.md prose', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = compareTypography(tokens, DIVERGENT_DESIGN_MD);
    expect(result.missingFromProse).toContain('Inter');
    expect(result.missingFromProse).toContain('SF Mono');
  });

  it('does not mistake the word "Interaction" for the Inter font family', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = compareTypography(tokens, '# Design\n## Interaction patterns\nSF Mono is used for code.');
    expect(result.missingFromProse).toContain('Inter');
    expect(result.missingFromProse).not.toContain('SF Mono');
  });

  it('reports no divergence when every declared family is mentioned somewhere in the prose', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = compareTypography(tokens, CONSISTENT_DESIGN_MD);
    expect(result.missingFromProse).toEqual([]);
  });
});

describe('compareSpacingScale (Achado 12.1: "mobile-first compact scale" vs fixed 4..48px)', () => {
  it('flags a mismatched scale when DESIGN.md declares a different one from tokens.css', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = compareSpacingScale(tokens, DIVERGENT_DESIGN_MD);
    expect(result.proseScaleFound).toBe(true);
    expect(result.matches).toBe(false);
    // tokens.css tem 20 e 48 que a prosa "4/8/12/16/24/32" nao menciona.
    expect(result.tokenScale).toContain(20);
    expect(result.tokenScale).toContain(48);
  });

  it('reports a match when the prose scale equals the token scale exactly', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = compareSpacingScale(tokens, CONSISTENT_DESIGN_MD);
    expect(result.proseScaleFound).toBe(true);
    expect(result.matches).toBe(true);
  });

  it('never reports a false divergence when no extractable scale exists in the prose', () => {
    const tokens = parseTokensCssProperties(REAL_TOKENS_CSS);
    const result = compareSpacingScale(tokens, '# Design\nNo spacing section here.\n');
    expect(result.proseScaleFound).toBe(false);
    expect(result.proseScale).toEqual([]);
  });
});

describe('buildConsistencyReport (the full, integrated check)', () => {
  it('is consistent: false with all three divergence kinds for the exact Achado 12.1 fixture', () => {
    const report = buildConsistencyReport(REAL_TOKENS_CSS, DIVERGENT_DESIGN_MD);
    expect(report.consistent).toBe(false);
    const kinds = report.divergences.map((d) => d.kind);
    expect(kinds).toContain('PALETTE_DIVERGENCE');
    expect(kinds).toContain('TYPOGRAPHY_DIVERGENCE');
    expect(kinds).toContain('SPACING_SCALE_DIVERGENCE');
  });

  it('is consistent: true when DESIGN.md and tokens.css actually agree', () => {
    const report = buildConsistencyReport(REAL_TOKENS_CSS, CONSISTENT_DESIGN_MD);
    expect(report.consistent).toBe(true);
    expect(report.divergences).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* CLI end-to-end                                                             */
/* -------------------------------------------------------------------------- */

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'od-verify-test-'));
  roots.push(dir);
  return dir;
}

function runCli(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '' };
  }
}

describe('CLI: od-verify-system.mjs', () => {
  it('exits 1 and writes design-consistency.json when the bundle diverges', () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, 'tokens.css'), REAL_TOKENS_CSS, 'utf8');
    writeFileSync(join(dir, 'DESIGN.md'), DIVERGENT_DESIGN_MD, 'utf8');

    const { status, stdout } = runCli(['--dir', dir]);
    expect(status).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.consistent).toBe(false);

    const written = JSON.parse(readFileSync(join(dir, 'design-consistency.json'), 'utf8'));
    expect(written.consistent).toBe(false);
  });

  it('exits 0 when the bundle is internally consistent', () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, 'tokens.css'), REAL_TOKENS_CSS, 'utf8');
    writeFileSync(join(dir, 'DESIGN.md'), CONSISTENT_DESIGN_MD, 'utf8');

    const { status, stdout } = runCli(['--dir', dir]);
    expect(status).toBe(0);
    expect(JSON.parse(stdout).consistent).toBe(true);
  });

  it('exits 0 with skipped: true when tokens.css or DESIGN.md is missing (od-fetch-system.mjs already gates presence)', () => {
    const dir = fixtureDir();
    const { status, stdout } = runCli(['--dir', dir]);
    expect(status).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.skipped).toBe(true);
    expect(existsSync(join(dir, 'design-consistency.json'))).toBe(false);
  });

  it('exits 2 without --dir', () => {
    const { status } = runCli([]);
    expect(status).toBe(2);
  });
});
