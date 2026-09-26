/**
 * End to end with the REAL Open Design brand engine (no simulated engine, no fixture contract):
 * brief -> briefToSeed -> od-brand-build -> render -> audit -> approval -> stage gate.
 * Skipped when neither the open-design container nor the ~/.open-design clone can run the engine.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { buildBrandSystem } from '../scripts/od-brand-build.mjs';
import { deriveWithEngine } from '../scripts/lib/brand-engine.mjs';
import { recordDesignReview, renderDesignPackage } from '../scripts/design-package.mjs';
import { approveCommand, buildCommand, seedCommand } from '../scripts/design-brief.mjs';
import { DESIGN_APPROVAL_HEADER } from '../scripts/lib/design-approval.mjs';
import { applyTransition, checkTransition } from '../scripts/lib/stage-gate.mjs';
import { evaluateToolCall } from '../scripts/lib/checkpoint-guard.mjs';
import { EXTRAS } from './helpers/design-fixture.js';

const PROBE_BRAND = { name: 'Probe', slug: 'probe', colors: [], seed: { colorPrimary: '#0F766E' } };
const probe = deriveWithEngine({ brand: PROBE_BRAND });
const engineAvailable = probe.status === 'ok';

const root = mkdtempSync(join(tmpdir(), 'design-e2e-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const fsEnv = (feature) => ({
  readText: (rel) => {
    try { return readFileSync(join(feature, rel), 'utf8'); } catch { return null; }
  },
  list: (rel) => {
    try { return readdirSync(join(feature, rel)); } catch { return []; }
  },
  validateHandoff: () => ({ ok: true, errors: [] }),
});

describe.skipIf(!engineAvailable)('DESIGN stage, real brand engine', () => {
  it('derives, renders, audits, approves and passes the stage gate without any simulation', () => {
    const feature = join(root, '.pensador', 'probe-v1');
    mkdirSync(feature, { recursive: true });
    const systemDir = join(feature, 'design-systems', 'probe');

    const built = buildCommand({
      feature,
      name: 'Probe',
      slug: 'probe',
      answers: {
        colorPrimary: '#0F766E', colorSuccess: '#15803D', fontFamily: 'Inter, sans-serif', fontFamilyCode: 'JetBrains Mono, monospace',
        fontSize: 14, borderRadius: 8, density: 'comfortable', motion: 'subtle', themeDefault: 'system', themeExposure: 'toggle',
        visualTone: { value: 'calmo e profissional', locked: false },
      },
    });
    expect(built.status).toBe('ok');

    const seeded = seedCommand({ feature, dir: systemDir });
    expect(seeded.status).toBe('ok');
    const engineRun = buildBrandSystem({
      brand: readJson(join(systemDir, 'source', 'brand.json')),
      dir: systemDir,
      extras: EXTRAS,
      briefRef: 'design-brief.json',
      seedOrigin: readJson(join(systemDir, 'source', 'seed-origin.json')),
    });
    expect(engineRun.status).toBe('ok');

    const resolvedDir = join(systemDir, 'resolved');
    const rendered = renderDesignPackage({ contractFile: join(resolvedDir, 'design-contract.json'), resolvedDir, briefFile: join(feature, 'design-brief.json'), strict: true });
    expect(rendered.audit?.status ?? rendered.status).toBe('PASS');
    const audit = readJson(join(resolvedDir, 'design-audit.json'));
    expect(audit.checks).toEqual({ structure: 'PASS', componentCoverage: 'PASS', contrast: 'PASS', conformance: 'PASS', integrity: 'PASS', engineRun: 'PASS' });

    // the same seed through the engine again gives the same contract, byte for byte
    const again = buildBrandSystem({
      brand: readJson(join(systemDir, 'source', 'brand.json')), dir: join(root, 'again'), extras: EXTRAS, briefRef: 'design-brief.json',
      seedOrigin: readJson(join(systemDir, 'source', 'seed-origin.json')),
    });
    expect(again.contractSha256).toBe(engineRun.contractSha256);

    // no approval question yet -> the CLI refuses; then the PostToolUse hook logs the real question
    const sealed = applyTransition({ stage: 'AGY', hasFrontend: true }, 'DESIGN');
    expect(approveCommand({ feature, dir: systemDir }).issue).toBe('approval-question-not-observed');
    writeFileSync(join(feature, '.pensador-questions.jsonl'), `${JSON.stringify({ stage: 'DESIGN', count: 1, headers: [DESIGN_APPROVAL_HEADER] })}\n`);
    expect(approveCommand({ feature, dir: systemDir }).status).toBe('ok');

    // without the recorded design review the gate refuses; a PASS review of this contract unlocks it
    expect(checkTransition({ checkpoint: sealed, to: 'FINAL', env: fsEnv(feature), strict: true }).errors.map((e) => e.code)).toContain('DESIGN_REVIEW_MISSING');
    expect(recordDesignReview({ resolvedDir, verdict: 'PASS', reviewer: 'codex' }).status).toBe('ok');

    const gate = checkTransition({ checkpoint: sealed, to: 'FINAL', env: fsEnv(feature), strict: true });
    expect(gate.errors).toEqual([]);
    expect(gate.ok).toBe(true);

    // a hand edit after the approval is caught by the gate, and the guard would have blocked it
    const briefFile = join(feature, 'design-brief.json');
    expect(evaluateToolCall({ tool_name: 'Write', tool_input: { file_path: briefFile, content: '{}' } }, { readFile: () => null }).allow).toBe(false);
    const brief = readJson(briefFile);
    brief.fields.borderRadius.value = 2;
    writeFileSync(briefFile, JSON.stringify(brief));
    expect(checkTransition({ checkpoint: sealed, to: 'FINAL', env: fsEnv(feature), strict: true }).errors.map((e) => e.code)).toContain('DESIGN_APPROVAL_STALE');
  });
});

describe('DESIGN stage, real brand engine (availability)', () => {
  it('reports why the end-to-end case was skipped', () => {
    if (engineAvailable) expect(probe.engine).toMatch(/^(container|clone)$/);
    else expect(probe.reasonCode).toBe('OD_BRAND_ENGINE_UNAVAILABLE');
  });
});
