/**
 * Docs ↔ Engine consistency guard.
 *
 * The other suites validate `engine ↔ tests`. They do NOT read the Markdown the
 * LLM actually executes (SKILL.md, command, references, templates), so prose was
 * free to drift from the engine — and it did (a 5-stage → 8-stage migration left
 * stale "5 estágios" / "Stage 3 → codex" / "Estágios 1–4" references behind, plus
 * an `STAGE4_MODEL` identifier that no longer reflects the stage layout).
 *
 * This suite closes that gap by asserting:
 *   1. The canonical STAGE_ORDER sequence appears verbatim in the key docs, so a
 *      reorder/rename of stages forces the prose to be updated in lockstep.
 *   2. No doc or script reintroduces a stale stage-count / stage-number phrase or
 *      a removed engine identifier.
 *
 * The test/ directory itself is excluded from the scan (it necessarily contains
 * the forbidden tokens as regex literals).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { STAGE_ORDER } from '../scripts/pensador-engine.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', '.git', '.kiro', '.claude', '.pensador', 'pensador-output', 'test']);
const SCAN_EXT = new Set(['.md', '.mjs', '.js']);

/** Recursively collect scannable files (docs + scripts), skipping SKIP_DIRS and test/. */
function collectFiles(dir = REPO_ROOT) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if ([...SCAN_EXT].some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const FILES = collectFiles();
const rel = (f) => relative(REPO_ROOT, f).split(sep).join('/');

describe('docs ↔ engine consistency', () => {
  it('collects the Pensador docs and scripts to scan', () => {
    // Sanity: the scan must actually find the core docs, otherwise the guard is vacuous.
    const names = FILES.map(rel);
    expect(names).toContain('skills/pensador/SKILL.md');
    expect(names).toContain('commands/pensador.md');
    expect(names).toContain('scripts/preflight.mjs');
  });

  describe('canonical STAGE_ORDER sequence is mirrored in the key docs', () => {
    const canonical = STAGE_ORDER.join(' → ');
    const mustContain = [
      'README.md',
      'skills/pensador/SKILL.md',
      'skills/pensador/references/stages.md',
    ];

    for (const docPath of mustContain) {
      it(`${docPath} contains the verbatim sequence "${canonical}"`, () => {
        const file = FILES.find((f) => rel(f) === docPath);
        expect(file, `${docPath} not found in scan`).toBeDefined();
        const content = readFileSync(file, 'utf8');
        expect(content).toContain(canonical);
      });
    }
  });

  describe('no stale stage-count / stage-number phrase survives', () => {
    /** Patterns that only existed in the retired 5-stage model. */
    const forbidden = [
      { re: /\b5[\s-]?(est[aá]gios?|stages?)\b/i, label: '"5 estágios" / "5-stage" (flow has 8 stages)' },
      { re: /\bEst[aá]gios?\s+1\s*[–-]\s*4\b/i, label: '"Estágios 1–4" (retired numbering)' },
      { re: /\bEst[aá]gios?\s+2,\s*3\s+e\s+4\b/i, label: '"Estágios 2, 3 e 4" (retired numbering)' },
      { re: /Stage\s+3\s*→/i, label: '"Stage 3 →" CODEX/AGY mapping (retired numbering)' },
      { re: /Stage\s+4\s*→/i, label: '"Stage 4 →" CODEX/AGY mapping (retired numbering)' },
    ];

    for (const { re, label } of forbidden) {
      it(`no file contains ${label}`, () => {
        const offenders = FILES.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
        expect(offenders, `stale phrase found in: ${offenders.join(', ')}`).toEqual([]);
      });
    }
  });

  describe('no removed engine identifier is reintroduced', () => {
    // Built from fragments so this test file does not match its own assertion.
    const removed = ['STAGE4' + '_MODEL', 'agyModelForStage' + '4'];

    for (const ident of removed) {
      it(`no file references the removed identifier "${ident}"`, () => {
        const offenders = FILES.filter((f) => readFileSync(f, 'utf8').includes(ident)).map(rel);
        expect(offenders, `removed identifier found in: ${offenders.join(', ')}`).toEqual([]);
      });
    }
  });
});
