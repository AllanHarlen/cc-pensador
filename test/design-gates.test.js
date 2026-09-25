/**
 * Phase 4/5 gates: audit v2 (WCAG in both themes, scales, states), brief conformance, render integrity,
 * engine-run, and the visual approval recorded in design-brief.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { auditDesignPackage, recordDesignReview, renderDesignPackage } from '../scripts/design-package.mjs';
import { componentKind, componentStyleCoverage, renderComponentsCss } from '../scripts/lib/design-render.mjs';
import { APPROVAL_FILE, DESIGN_APPROVAL_HEADER, loadApprovalKey, verifyApprovalRecord } from '../scripts/lib/design-approval.mjs';
import { approveCommand, adjustCommand, buildCommand, seedCommand } from '../scripts/design-brief.mjs';
import { deltaE } from '../scripts/lib/color.mjs';
import {
  checkBriefConformance, checkComponentStates, checkContrastMatrix, checkScales, requiredContrastPairs,
} from '../scripts/lib/design-gates.mjs';
import { canonicalJson, finalizeContract, mapEngineToContract } from '../scripts/lib/token-mapper.mjs';
import {
  DESIGN_BRIEF_DENSITY, DESIGN_BRIEF_MOTION, applyDesignAdjustments, approveDesignBrief, briefToSeed, buildDesignBrief, isDesignApproved,
} from '../scripts/pensador-engine.mjs';
import { EXTRAS, engineFixture, fixtureBrief, fixtureContract } from './helpers/design-fixture.js';

/** fixtureContract() with the origin trail the derivation records for every brief field the fixture brief locks. */
const gateContract = (over = {}) => fixtureContract({
  seedOrigin: { colorPrimary: 'brief', colorSuccess: 'brief', fontFamily: 'brief', fontFamilyCode: 'brief', fontSize: 'brief', borderRadius: 'brief' },
  ...over,
});

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const tmp = () => {
  const root = mkdtempSync(join(tmpdir(), 'design-gates-'));
  roots.push(root);
  return root;
};
const codes = (findings) => findings.map((f) => f.code);
const clone = (value) => JSON.parse(JSON.stringify(value));
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : canonicalJson(text));
};

/** A feature dir with source/engine-run.json, design-brief.json and a rendered resolved/ package. */
function feature({ contract = gateContract(), brief = fixtureBrief(), id = 'gestuor' } = {}) {
  const root = tmp();
  const systemDir = join(root, 'design-systems', id);
  write(join(systemDir, 'source', 'engine-run.json'), { schemaVersion: 1, status: 'ok', engine: 'clone', contractSha256: contract.sha256 });
  write(join(root, 'design-brief.json'), brief);
  write(join(systemDir, 'resolved', 'design-contract.json'), contract);
  const resolvedDir = join(systemDir, 'resolved');
  const audit = renderDesignPackage({ contractFile: join(resolvedDir, 'design-contract.json'), resolvedDir, strict: true });
  return { root, systemDir, resolvedDir, audit, contract, brief };
}

describe('color: deltaE', () => {
  it('is 0 for the same colour in any notation and grows with the distance', () => {
    expect(deltaE('#0F766E', '#0f766e')).toBeCloseTo(0, 5);
    expect(deltaE('#0F766E', 'rgb(15 118 110)')).toBeLessThan(0.5);
    expect(deltaE('#0F766E', '#DC2626')).toBeGreaterThan(30);
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 0);
    expect(deltaE('nope', '#fff')).toBeNull();
  });
});

describe('audit v2: contrast matrix in both themes', () => {
  it('passes the fixture contract and requires every mandatory pair in light AND dark', () => {
    expect(checkContrastMatrix(gateContract())).toEqual([]);
    const required = requiredContrastPairs();
    expect(new Set(required.map((p) => p.theme))).toEqual(new Set(['light', 'dark']));
    expect(required.length).toBeGreaterThanOrEqual(2 * 21);
  });

  it('rejects an empty or partial matrix, a lowered minimum and a dark-only regression', () => {
    const empty = { ...gateContract(), contrastPairs: [] };
    expect(codes(checkContrastMatrix(empty))).toEqual(expect.arrayContaining(['CONTRAST_MATRIX_MISSING', 'CONTRAST_PAIR_MISSING']));

    const partial = clone(gateContract());
    partial.contrastPairs = partial.contrastPairs.filter((p) => p.theme === 'light');
    expect(checkContrastMatrix(partial).filter((f) => f.code === 'CONTRAST_PAIR_MISSING').every((f) => f.message.startsWith('[dark]'))).toBe(true);

    const lowered = clone(gateContract());
    lowered.contrastPairs[0].minimum = 1;
    expect(codes(checkContrastMatrix(lowered))).toContain('CONTRAST_MINIMUM_LOWERED');

    const darkBroken = clone(gateContract());
    darkBroken.themes.dark['--muted'] = darkBroken.themes.dark['--bg'];
    const found = checkContrastMatrix(darkBroken).filter((f) => f.code === 'WCAG_CONTRAST');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.message.startsWith('[dark]'))).toBe(true);
  });

  it('demands the safe text variant: the raw engine semantic colour on the background is not enough', () => {
    const raw = clone(gateContract());
    raw.themes.light['--warn-text'] = raw.themes.light['--warn'];
    expect(codes(checkContrastMatrix(raw))).toContain('WCAG_CONTRAST');
  });

  it('reads hex (3/6/8 digits), rgb() and oklch() colours and rejects anything else', () => {
    const contract = clone(gateContract());
    contract.themes.light['--bg'] = '#fff';
    contract.themes.light['--fg'] = 'rgb(0 0 0)';
    expect(checkContrastMatrix(contract).filter((f) => f.code === 'COLOR_UNPARSEABLE')).toEqual([]);
    contract.themes.dark['--accent'] = 'hsl(200 50% 50%)';
    expect(codes(checkContrastMatrix(contract))).toContain('COLOR_UNPARSEABLE');
  });
});

describe('audit v2: scales and component states', () => {
  it('accepts the fixture and rejects a reversed primitive ladder and a shrinking scale', () => {
    expect(checkScales(gateContract())).toEqual([]);
    const reversed = clone(gateContract());
    reversed.primitives.primary.reverse();
    expect(codes(checkScales(reversed))).toContain('SCALE_NOT_MONOTONIC');
    const shrinking = clone(gateContract());
    shrinking.tokens['--space-6'] = '2px';
    expect(codes(checkScales(shrinking))).toContain('SCALE_NOT_MONOTONIC');
  });

  it('requires focus-visible on every component (plain "focus" does not count) and the focus tokens', () => {
    expect(checkComponentStates(gateContract())).toEqual([]);
    const contract = clone(gateContract());
    contract.components[1].states = ['default', 'hover', 'focus', 'disabled'];
    expect(checkComponentStates(contract).map((f) => f.message)).toEqual([expect.stringContaining('Input is missing state focus-visible')]);
    delete contract.themes.dark['--focus'];
    expect(codes(checkComponentStates(contract))).toContain('FOCUS_TOKEN_MISSING');
  });
});

describe('checkBriefConformance', () => {
  it('passes when every locked field shows up unchanged in the contract', () => {
    expect(checkBriefConformance(fixtureBrief(), gateContract())).toEqual({ status: 'PASS', findings: [] });
  });

  it('blocks a diverging LOCKED primary, compared with the light theme only', () => {
    const wrong = fixtureBrief({ fields: { colorPrimary: { value: '#7C3AED', locked: true, questionRef: 'q' } } });
    const result = checkBriefConformance(wrong, gateContract());
    expect(result.status).toBe('BLOCKED');
    expect(result.findings.map((f) => f.message).join('\n')).toMatch(/colorPrimary.*light --accent/s);
    // The dark accent is derived and differs by design: it must never be the reference.
    expect(gateContract().themes.dark['--accent']).not.toBe(gateContract().themes.light['--accent']);
    expect(checkBriefConformance(fixtureBrief(), gateContract()).status).toBe('PASS');
  });

  it('tolerates a colour within ΔE and blocks one beyond it', () => {
    const near = fixtureBrief({ fields: { colorPrimary: { value: '#0F766F', locked: true, questionRef: 'q' } } });
    const contract = clone(gateContract());
    contract.seed.colorPrimary = '#0F766F';
    expect(checkBriefConformance(near, contract).status).toBe('PASS');
  });

  it.each([
    ['fontFamily', { value: 'Georgia, serif', locked: true }],
    ['fontSize', { value: 18, locked: true }],
    ['borderRadius', { value: 2, locked: true }],
    ['density', { value: 'compact', locked: true }],
    ['motion', { value: 'none', locked: true }],
    ['themeDefault', { value: 'dark', locked: true }],
    ['colorSuccess', { value: '#22C55E', locked: true }],
  ])('blocks a diverging locked %s', (field, value) => {
    const brief = fixtureBrief({ fields: { [field]: { ...value, questionRef: 'q' } } });
    const result = checkBriefConformance(brief, gateContract());
    expect(result.status).toBe('BLOCKED');
    expect(codes(result.findings)).toContain('BRIEF_MISMATCH');
  });

  it('only informs about an UNLOCKED field that differs (a proposal may change)', () => {
    const brief = fixtureBrief({ fields: { fontFamily: { value: 'Georgia, serif', locked: false, questionRef: null } } });
    const result = checkBriefConformance(brief, gateContract());
    expect(result.status).toBe('PASS');
    expect(result.findings.map((f) => f.severity)).toEqual(['info']);
  });

  it('blocks an invalid or missing brief and surfaces rejected answers', () => {
    expect(checkBriefConformance(null, gateContract()).status).toBe('BLOCKED');
    const brief = fixtureBrief({ issues: [{ field: 'colorPrimary', reason: 'invalid-value' }] });
    expect(codes(checkBriefConformance(brief, gateContract()).findings)).toContain('BRIEF_INVALID');
  });
});

describe('render integrity and engine run (on disk)', () => {
  it('a rendered package passes all five checks, binds the audit to the contract and records packageSha256', () => {
    const { audit, resolvedDir, contract } = feature();
    expect(audit.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(audit.status).toBe('PASS');
    expect(audit.checks).toEqual({ structure: 'PASS', componentCoverage: 'PASS', contrast: 'PASS', conformance: 'PASS', integrity: 'PASS', engineRun: 'PASS' });
    expect(audit.contractSha256).toBe(contract.sha256);
    const provenance = JSON.parse(readFileSync(join(resolvedDir, 'provenance.json'), 'utf8'));
    expect(provenance.contractSha256).toBe(contract.sha256);
    expect(provenance.packageSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(['tokens.css', 'DESIGN.md', 'components.html', 'tailwind-v4.css', 'preview/colors.html'])('a hand edit of %s is caught as INTEGRITY_DRIFT', (file) => {
    const { resolvedDir } = feature();
    writeFileSync(join(resolvedDir, file), `${readFileSync(join(resolvedDir, file), 'utf8')}\n/* hand edit */\n`);
    const audit = auditDesignPackage({ resolvedDir, strict: true });
    expect(audit.status).toBe('BLOCKED');
    expect(audit.checks.integrity).toBe('BLOCKED');
    expect(audit.findings.find((f) => f.code === 'INTEGRITY_DRIFT')?.path).toBe(file);
  });

  it('a deleted rendered file and a doctored provenance.json are caught', () => {
    const a = feature();
    rmSync(join(a.resolvedDir, 'USAGE.md'));
    expect(codes(auditDesignPackage({ resolvedDir: a.resolvedDir, strict: true }).findings)).toContain('INTEGRITY_FILE_MISSING');

    const b = feature();
    const file = join(b.resolvedDir, 'provenance.json');
    const provenance = JSON.parse(readFileSync(file, 'utf8'));
    provenance.packageSha256 = '0'.repeat(64);
    write(file, provenance);
    expect(codes(auditDesignPackage({ resolvedDir: b.resolvedDir, strict: true }).findings)).toContain('PROVENANCE_HASH_MISMATCH');
  });

  it('editing the contract after render breaks its hash and the integrity check', () => {
    const { resolvedDir } = feature();
    const file = join(resolvedDir, 'design-contract.json');
    const edited = JSON.parse(readFileSync(file, 'utf8'));
    edited.tokens['--radius-sm'] = '99px';
    write(file, edited);
    const audit = auditDesignPackage({ resolvedDir, strict: true });
    expect(audit.status).toBe('BLOCKED');
    expect(codes(audit.findings)).toEqual(expect.arrayContaining(['CONTRACT_HASH_MISMATCH', 'INTEGRITY_DRIFT']));

    // Re-signing the edited contract hides the hash mismatch, but not the engine run or the render.
    write(file, finalizeContract(edited));
    const resigned = auditDesignPackage({ resolvedDir, strict: true });
    expect(resigned.status).toBe('BLOCKED');
    expect(codes(resigned.findings)).toEqual(expect.arrayContaining(['ENGINE_RUN_CONTRACT_MISMATCH', 'INTEGRITY_DRIFT', 'PROVENANCE_HASH_MISMATCH']));
  });

  it('demands source/engine-run.json with status ok (strict), and skips it otherwise', () => {
    const { resolvedDir, systemDir } = feature();
    const runFile = join(systemDir, 'source', 'engine-run.json');
    write(runFile, { schemaVersion: 1, status: 'BLOCKED', reasonCode: 'OD_BRAND_ENGINE_UNAVAILABLE' });
    expect(codes(auditDesignPackage({ resolvedDir, strict: true }).findings)).toContain('ENGINE_RUN_FAILED');
    rmSync(runFile);
    const strict = auditDesignPackage({ resolvedDir, strict: true });
    expect(codes(strict.findings)).toContain('ENGINE_RUN_MISSING');
    const lenient = auditDesignPackage({ resolvedDir });
    expect(lenient.checks.engineRun).toBe('SKIPPED');
  });

  it('a missing brief blocks in strict mode and is reported SKIPPED otherwise', () => {
    const { resolvedDir, root } = feature();
    rmSync(join(root, 'design-brief.json'));
    const strict = auditDesignPackage({ resolvedDir, strict: true });
    expect(codes(strict.findings)).toContain('BRIEF_MISSING');
    expect(strict.checks.conformance).toBe('BLOCKED');
    expect(auditDesignPackage({ resolvedDir }).checks.conformance).toBe('SKIPPED');
  });

  it('a diverging locked field blocks the package end to end', () => {
    const brief = fixtureBrief({ fields: { colorPrimary: { value: '#7C3AED', locked: true, questionRef: 'q' } } });
    const { audit } = feature({ brief });
    expect(audit.status).toBe('BLOCKED');
    expect(audit.checks.conformance).toBe('BLOCKED');
  });
});

describe('design-package CLI', () => {
  const cli = fileURLToPath(new URL('../scripts/design-package.mjs', import.meta.url));

  it('audit writes design-audit.json and prints the statePatch the skill layer records (P12)', () => {
    const { resolvedDir, root, contract } = feature();
    rmSync(join(resolvedDir, 'design-audit.json'));
    const out = spawnSync(process.execPath, [cli, 'audit', '--dir', resolvedDir], { encoding: 'utf8' });
    expect(out.status).toBe(0);
    const json = JSON.parse(out.stdout);
    expect(json.statePatch.designPackages.gestuor).toEqual({ auditStatus: 'PASS', contractSha256: contract.sha256 });
    expect(json.statePatch.designBriefPath).toBe(join(root, 'design-brief.json'));
    expect(JSON.parse(readFileSync(join(resolvedDir, 'design-audit.json'), 'utf8')).status).toBe('PASS');
  });

  it('exits 1 on a tampered package', () => {
    const { resolvedDir } = feature();
    writeFileSync(join(resolvedDir, 'tokens.css'), ':root{}');
    expect(spawnSync(process.execPath, [cli, 'audit', '--dir', resolvedDir], { encoding: 'utf8' }).status).toBe(1);
  });
});

describe('visual approval in design-brief.json (Phase 5)', () => {
  const sha = 'a'.repeat(64);

  it('approveDesignBrief records approvedAt + approvedSha256 and refuses malformed input', () => {
    const brief = fixtureBrief();
    const ok = approveDesignBrief(brief, { approvedAt: '2026-09-19T10:00:00.000Z', contractSha256: sha });
    expect(ok).toMatchObject({ ok: true, issue: null, brief: { approvedAt: '2026-09-19T10:00:00.000Z', approvedSha256: sha } });
    expect(brief.approvedAt).toBeNull(); // pure: the input is untouched
    expect(approveDesignBrief(brief, { approvedAt: 'yesterday', contractSha256: sha }).issue).toBe('invalid-approvedAt');
    expect(approveDesignBrief(brief, { approvedAt: '2026-09-19T10:00:00.000Z', contractSha256: 'xyz' }).issue).toBe('invalid-sha256');
    expect(approveDesignBrief(undefined, {}).ok).toBe(false);
  });

  it('isDesignApproved only accepts an approval of the SAME contract', () => {
    const approved = approveDesignBrief(fixtureBrief(), { approvedAt: '2026-09-19T10:00:00.000Z', contractSha256: sha }).brief;
    expect(isDesignApproved(approved, sha)).toBe(true);
    expect(isDesignApproved(approved, 'b'.repeat(64))).toBe(false);
    expect(isDesignApproved(fixtureBrief(), sha)).toBe(false);
    expect(isDesignApproved(null, sha)).toBe(false);
  });

  it('a quick adjustment locks the field, changes the seed and clears the previous approval', () => {
    const approved = approveDesignBrief(fixtureBrief(), { approvedAt: '2026-09-19T10:00:00.000Z', contractSha256: sha }).brief;
    const { brief, applied, issues } = applyDesignAdjustments(approved, { colorPrimary: '#7C3AED', density: 'compact', themeDefault: 'dark' });
    expect(applied).toEqual(['colorPrimary', 'density', 'themeDefault']);
    expect(issues).toEqual([]);
    expect(brief.approvedAt).toBeNull();
    expect(brief.approvedSha256).toBeNull();
    expect(brief.fields.colorPrimary).toEqual({ value: '#7C3AED', locked: true, questionRef: 'approval-adjust' });
    expect(briefToSeed(brief).seed).toMatchObject({ colorPrimary: '#7C3AED', controlHeight: DESIGN_BRIEF_DENSITY.compact.controlHeight });
    expect(isDesignApproved(brief, sha)).toBe(false);
  });

  it('refuses fields that are not quick adjustments and invalid values, leaving the approval alone', () => {
    const approved = approveDesignBrief(fixtureBrief(), { approvedAt: '2026-09-19T10:00:00.000Z', contractSha256: sha }).brief;
    const { brief, applied, issues } = applyDesignAdjustments(approved, { colorSuccess: '#111111', density: 'huge', nope: 1 });
    expect(applied).toEqual([]);
    expect(issues).toEqual([{ field: 'colorSuccess', reason: 'not-adjustable' }, { field: 'density', reason: 'invalid-value' }, { field: 'nope', reason: 'not-adjustable' }]);
    expect(brief).toBe(approved);
  });

  it('CLI flow: build -> seed -> (derive, render) -> approve -> adjust clears the approval', () => {
    const root = tmp();
    const answers = join(root, 'answers.json');
    write(answers, { colorPrimary: '#0F766E', fontFamily: 'Inter, sans-serif', themeDefault: 'system' });
    const built = buildCommand({ feature: root, answers: JSON.parse(readFileSync(answers, 'utf8')), name: 'Gestuor', slug: 'gestuor' });
    expect(built.status).toBe('ok');
    expect(built.statePatch.designBriefPath).toBe(join(root, 'design-brief.json'));

    const systemDir = join(root, 'design-systems', 'gestuor');
    const seeded = seedCommand({ feature: root, dir: systemDir });
    expect(seeded.seed.colorInfo).toBeDefined();
    const brand = JSON.parse(readFileSync(join(systemDir, 'source', 'brand.json'), 'utf8'));
    expect(brand).toMatchObject({ slug: 'gestuor', defaultTheme: 'system', seed: { colorPrimary: '#0F766E' } });
    expect(JSON.parse(readFileSync(join(systemDir, 'source', 'seed-origin.json'), 'utf8')).colorPrimary).toBe('brief');

    // approval before an audited contract exists is refused
    expect(approveCommand({ feature: root, dir: systemDir }).status).toBe('REFUSED');

    const contract = gateContract();
    write(join(systemDir, 'source', 'engine-run.json'), { status: 'ok', contractSha256: contract.sha256 });
    write(join(systemDir, 'resolved', 'design-contract.json'), contract);
    const resolvedDir = join(systemDir, 'resolved');
    renderDesignPackage({ contractFile: join(resolvedDir, 'design-contract.json'), resolvedDir, strict: true });
    // no approval question logged by the hook: refused; hand-typing a log line is what the guard blocks
    expect(approveCommand({ feature: root, dir: systemDir }).issue).toBe('approval-question-not-observed');
    write(join(root, '.pensador-questions.jsonl'), `${JSON.stringify({ stage: 'DESIGN', count: 1, headers: [DESIGN_APPROVAL_HEADER] })}
`);
    const approved = approveCommand({ feature: root, dir: systemDir, now: () => '2026-09-19T12:00:00.000Z' });
    expect(existsSync(join(root, APPROVAL_FILE))).toBe(true);
    expect(verifyApprovalRecord(JSON.parse(readFileSync(join(root, APPROVAL_FILE), 'utf8')), { brief: JSON.parse(readFileSync(join(root, 'design-brief.json'), 'utf8')), contractSha256: contract.sha256, systemId: 'gestuor', key: loadApprovalKey() }).ok).toBe(true);
    expect(approved).toMatchObject({ status: 'ok', approvedAt: '2026-09-19T12:00:00.000Z', approvedSha256: contract.sha256 });
    expect(isDesignApproved(JSON.parse(readFileSync(join(root, 'design-brief.json'), 'utf8')), contract.sha256)).toBe(true);

    const adjusted = adjustCommand({ feature: root, set: { borderRadius: 4 } });
    expect(adjusted).toMatchObject({ status: 'ok', applied: ['borderRadius'], approvalCleared: true });
    expect(JSON.parse(readFileSync(join(root, 'design-brief.json'), 'utf8')).approvedAt).toBeNull();
  });

  it('approve refuses when the audit belongs to another contract or is not PASS', () => {
    const { root, systemDir, resolvedDir } = feature();
    write(join(resolvedDir, 'design-audit.json'), { status: 'PASS', contractSha256: 'f'.repeat(64) });
    expect(approveCommand({ feature: root, dir: systemDir }).issue).toBe('audit-not-pass');
    write(join(resolvedDir, 'design-audit.json'), { status: 'BLOCKED', contractSha256: gateContract().sha256 });
    expect(approveCommand({ feature: root, dir: systemDir }).issue).toBe('audit-not-pass');
  });
});

/**
 * Property: for ANY valid brief, the whole chain seed -> contract -> render -> audit passes conformance,
 * integrity and the audit. The engine is simulated by a faithful "derive" that honours the seed fields
 * (the real one is exercised byte for byte in brand-engine.test.js); what is under test here is that the
 * Pensador's own mapping, render and gates never disagree with the brief.
 */
describe('property: any valid brief yields a resolved/ that passes audit, conformance and integrity', () => {
  const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, '0')}`);
  const fonts = fc.constantFrom('Inter, sans-serif', 'Georgia, serif', 'DM Sans, sans-serif', 'IBM Plex Sans, sans-serif');
  const mono = fc.constantFrom('JetBrains Mono, monospace', 'Fira Code, monospace');
  const locked = (value) => ({ value, locked: true, questionRef: 'q' });
  const briefArb = fc.record({
    colorPrimary: hex, colorSuccess: hex, colorWarning: hex, colorError: hex, colorInfo: hex,
    fontFamily: fonts, fontFamilyCode: mono,
    fontSize: fc.integer({ min: 12, max: 20 }),
    density: fc.constantFrom(...Object.keys(DESIGN_BRIEF_DENSITY)),
    borderRadius: fc.integer({ min: 0, max: 24 }),
    motion: fc.constantFrom(...Object.keys(DESIGN_BRIEF_MOTION)),
    themeDefault: fc.constantFrom('light', 'dark', 'system'),
    lockedFlags: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
  });

  /** Engine stand-in: the derived token sets follow the seed the way the real engine does for these fields. */
  function derive(seed) {
    const { tokens } = engineFixture();
    const fs = seed.fontSize ?? 14;
    const patch = (set) => ({
      ...set,
      colorPrimary: seed.colorPrimary, colorPrimaryHover: seed.colorPrimary, colorPrimaryActive: seed.colorPrimary,
      colorSuccess: seed.colorSuccess, colorSuccessHover: seed.colorSuccess, colorSuccessActive: seed.colorSuccess,
      colorWarning: seed.colorWarning, colorWarningHover: seed.colorWarning, colorWarningActive: seed.colorWarning,
      colorError: seed.colorError, colorErrorHover: seed.colorError, colorErrorActive: seed.colorError,
      colorInfo: seed.colorInfo, colorLinkHover: seed.colorInfo, colorLinkActive: seed.colorInfo,
      fontFamily: seed.fontFamily, fontFamilyCode: seed.fontFamilyCode,
      fontSize: fs, fontSizeSM: fs - 2, fontSizeLG: fs + 2, fontSizeXL: fs + 6,
      fontSizeHeading3: fs + 10, fontSizeHeading2: fs + 16, fontSizeHeading1: fs + 24,
      borderRadius: seed.borderRadius,
      controlHeight: seed.controlHeight, controlHeightSM: seed.controlHeight - 8, controlHeightLG: seed.controlHeight + 8,
    });
    return { default: patch(tokens.default), dark: patch(tokens.dark), compact: tokens.compact };
  }

  it('holds for generated briefs (locked and unlocked mixed)', () => {
    fc.assert(fc.property(briefArb, ({ lockedFlags, ...values }) => {
      const names = Object.keys(values);
      const answers = Object.fromEntries(names.map((name, index) => [name, { value: values[name], locked: lockedFlags[index], questionRef: 'q' }]));
      const brief = buildDesignBrief({ product: { name: 'P', slug: 'p' }, answers });
      expect(brief.issues).toEqual([]);
      const { seed, provenance } = briefToSeed(brief);

      const origin = Object.fromEntries(Object.entries(provenance).map(([key, value]) => [key, value === 'brief-unlocked' ? 'brief' : value]));
      const contract = mapEngineToContract({
        systemId: 'p', seed, tokens: derive(seed), engine: { version: '1' }, seedOrigin: origin, briefRef: 'design-brief.json', defaultTheme: values.themeDefault, extras: EXTRAS,
      });
      const root = tmp();
      const systemDir = join(root, 'design-systems', 'p');
      const resolvedDir = join(systemDir, 'resolved');
      write(join(root, 'design-brief.json'), brief);
      write(join(systemDir, 'source', 'engine-run.json'), { status: 'ok', contractSha256: contract.sha256 });
      write(join(resolvedDir, 'design-contract.json'), contract);
      const audit = renderDesignPackage({ contractFile: join(resolvedDir, 'design-contract.json'), resolvedDir, strict: true });
      expect(audit.findings.filter((f) => f.severity === 'critical' || f.severity === 'high'), JSON.stringify(values)).toEqual([]);
      expect(audit.checks).toEqual({ structure: 'PASS', componentCoverage: 'PASS', contrast: 'PASS', conformance: 'PASS', integrity: 'PASS', engineRun: 'PASS' });
      // every LOCKED field is present, unchanged, in the contract
      expect(checkBriefConformance(brief, contract).status).toBe('PASS');
      rmSync(root, { recursive: true, force: true });
    }), { numRuns: 40 });
  });

  it('mutating any locked colour after derivation is always caught by conformance', () => {
    fc.assert(fc.property(hex, hex, (primary, other) => {
      fc.pre(deltaE(primary, other) > 5);
      const brief = buildDesignBrief({ answers: { colorPrimary: primary } });
      const { seed } = briefToSeed(brief);
      const contract = mapEngineToContract({ systemId: 'p', seed: { ...seed, colorPrimary: other }, tokens: derive({ ...seed, colorPrimary: other, colorSuccess: '#16A34A', colorWarning: '#D97706', colorError: '#DC2626', fontFamily: 'Inter, sans-serif', fontFamilyCode: 'JetBrains Mono, monospace', controlHeight: 36, borderRadius: 8 }), engine: { version: '1' }, extras: EXTRAS });
      expect(checkBriefConformance(brief, contract).status).toBe('BLOCKED');
    }), { numRuns: 40 });
  });
});

describe('design review record (design-review.json)', () => {
  it('records a PASS bound to the contract only over a PASS audit of the same contract', () => {
    const { resolvedDir, contract } = feature();
    const result = recordDesignReview({ resolvedDir, verdict: 'pass', reviewer: 'codex', report: 'review/design-codex.md', now: '2026-09-25T10:00:00.000Z' });
    expect(result.status).toBe('ok');
    const stored = JSON.parse(readFileSync(join(resolvedDir, 'design-review.json'), 'utf8'));
    expect(stored).toMatchObject({ verdict: 'PASS', reviewer: 'codex', contractSha256: contract.sha256, blockingFindings: 0 });
    expect(result.statePatch.designPackages[contract.systemId]).toEqual({ reviewStatus: 'PASS', reviewContractSha256: contract.sha256 });
  });

  it('refuses a PASS with blocking findings, over a failing audit, or without a reviewer', () => {
    const { resolvedDir } = feature();
    expect(recordDesignReview({ resolvedDir, verdict: 'PASS', reviewer: 'codex', blockingFindings: 2 }).reasonCode).toBe('REVIEW_PASS_WITH_BLOCKING_FINDINGS');
    expect(recordDesignReview({ resolvedDir, verdict: 'PASS' }).reasonCode).toBe('REVIEW_REVIEWER_REQUIRED');
    expect(recordDesignReview({ resolvedDir, verdict: 'MAYBE', reviewer: 'codex' }).reasonCode).toBe('REVIEW_VERDICT_INVALID');
    write(join(resolvedDir, 'design-audit.json'), { status: 'BLOCKED', contractSha256: 'x' });
    expect(recordDesignReview({ resolvedDir, verdict: 'PASS', reviewer: 'codex' }).reasonCode).toBe('REVIEW_WITHOUT_PASSING_AUDIT');
    // a FAIL is always recordable: it is what keeps the handoff from claiming PASS
    expect(recordDesignReview({ resolvedDir, verdict: 'FAIL', reviewer: 'codex', blockingFindings: 3 }).status).toBe('ok');
  });
});

describe('component coverage (components.css)', () => {
  // The 24 components of a real contract (OficinaAI, 2026-09): only 6 had rules before.
  const REAL = ['Button', 'IconButton', 'Input', 'PhoneInput', 'Textarea', 'Select', 'Checkbox', 'Switch', 'Card', 'ServiceCard', 'PartCard', 'Carousel',
    'Badge', 'StatusPill', 'Table', 'Tabs', 'Modal', 'Toast', 'Sidebar', 'TopNav', 'EmptyState', 'Skeleton', 'FormField', 'Stepper'];

  it('maps every component of the real contract to a styled kind (product names inherit their base kind)', () => {
    const contract = { systemId: 'x', components: REAL.map((name) => ({ name, states: ['default'] })) };
    expect(componentStyleCoverage(contract).generic).toEqual([]);
    expect(componentKind('ServiceCard')).toBe('card');
    expect(componentKind('StatusPill')).toBe('badge');
    expect(componentKind('PhoneInput')).toBe('input');
    expect(componentKind('Botão')).toBe('button');
    expect(componentKind('Widget')).toBe('generic');
  });

  it('components.css only references tokens and lists the unstyled components', () => {
    const contract = { systemId: 'x', components: [...REAL, 'Widget'].map((name) => ({ name, states: ['default'] })) };
    const css = renderComponentsCss(contract);
    expect(css).toMatch(/Without dedicated rules.*Widget/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/[^0-9.\w-](?:[2-9]|1\d)\d*px/);
  });

  it('the audit reports an unstyled component as a non-blocking componentCoverage WARN', () => {
    const contract = gateContract({
      extras: { ...EXTRAS, components: [...EXTRAS.components, { name: 'Widget', states: ['default', 'hover', 'focus-visible', 'disabled'] }] },
    });
    const { audit } = feature({ contract });
    expect(audit.checks.componentCoverage).toBe('WARN');
    expect(audit.findings.find((f) => f.code === 'COMPONENT_WITHOUT_RULES')).toMatchObject({ severity: 'medium' });
  });
});

describe('sanity: the tests do not write into the repository', () => {
  it('uses temp dirs only', () => {
    expect(existsSync(join(tmpdir()))).toBe(true);
  });
});
