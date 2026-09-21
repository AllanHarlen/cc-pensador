import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRunnerSource, deriveWithEngine, ENGINE_FILES, REASON_ENGINE_UNAVAILABLE } from '../scripts/lib/brand-engine.mjs';
import { buildBrandSystem } from '../scripts/od-brand-build.mjs';
import { auditDesignPackage, renderDesignPackage } from '../scripts/design-package.mjs';
import { EXTRAS, engineFixture, readFixture } from './helpers/design-fixture.js';

const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'od-brand-')); dirs.push(dir); return dir; };

function engineStdout(version = '0.22.1') {
  const { seed, tokens } = engineFixture();
  const files = { 'seed.json': JSON.stringify(seed), 'tokens.default.json': JSON.stringify(tokens.default), 'tokens.dark.json': JSON.stringify(tokens.dark), 'tokens.compact.json': JSON.stringify(tokens.compact) };
  for (const name of ['default', 'dark', 'compact']) files[`variables.${name}.css`] = ':root {}';
  return JSON.stringify({ files, engine: { version, deriveSha256: 'abc' } });
}

/** Fake process runner: `handlers` maps a matcher to a result. */
function fakeRun(handlers) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, input: options?.input });
    for (const [match, result] of handlers) if (match(command, args)) return { status: 0, stdout: '', stderr: '', error: null, ...result };
    return { status: 1, stdout: '', stderr: 'unhandled', error: null };
  };
  run.calls = calls;
  return run;
}

const isNode = (command) => command !== 'git';

/** A fake clone dir with the engine entry point, so attemptClone's existence check passes. */
function fakeClone() {
  const clone = tmp();
  const engineDir = join(clone, 'apps', 'daemon', 'src', 'brands', 'engine');
  mkdirSync(engineDir, { recursive: true });
  writeFileSync(join(engineDir, 'derive.ts'), '');
  return clone;
}

describe('runner source', () => {
  it('merges brand.seed on top of seedFromBrand (Phase 0 finding F7) and reads the brand from stdin', () => {
    const source = buildRunnerSource({ engineDir: '/e/', ext: '.js', packageJsons: ['/p.json'] });
    expect(source).toContain('const seed = { ...seedFromBrand(brand), ...overrides };');
    expect(source).toContain('fs.readFileSync(0');
    expect(source).toContain('"engineDir":"/e/"');
    expect(source).not.toContain('__CONFIG__');
  });
});

describe('engine chain: clone -> BLOCKED (the Docker container runtime was removed)', () => {
  const brand = readFixture('brand.json');
  const gitAndNode = () => fakeRun([[(command) => command === 'git', { stdout: 'abc1234\n' }], [isNode, { stdout: engineStdout() }]]);

  it('runs the engine from the host clone and records the clone commit', () => {
    const run = gitAndNode();
    const result = deriveWithEngine({ brand, run, env: {}, clone: fakeClone() });
    expect(result.status).toBe('ok');
    expect(result.engine).toBe('clone');
    expect(result.engineInfo.version).toBe('0.22.1');
    expect(result.engineInfo.commit).toBe('abc1234');
    expect(Object.keys(JSON.parse(engineStdout()).files)).toEqual(expect.arrayContaining(ENGINE_FILES));
    expect(result.attempts.map((attempt) => [attempt.engine, attempt.ok, attempt.reasonCode])).toEqual([['clone', true, null]]);
    expect(run.calls.some((call) => call.command === 'docker')).toBe(false);
    const engineCall = run.calls.find((call) => isNode(call.command));
    expect(JSON.parse(engineCall.input).slug).toBe('gestuor');
  });

  it('returns BLOCKED OD_BRAND_ENGINE_UNAVAILABLE with the attempt and a clone remediation when there is no clone', () => {
    const run = fakeRun([]);
    const result = deriveWithEngine({ brand, run, env: {}, clone: join(tmp(), 'absent') });
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCode).toBe(REASON_ENGINE_UNAVAILABLE);
    expect(result.attempts.map((attempt) => attempt.reasonCode)).toEqual(['CLONE_NOT_FOUND']);
    expect(result.remediation.join(' ')).toMatch(/\.open-design/);
    expect(result.remediation.join(' ')).not.toMatch(/docker/i);
    expect(run.calls).toHaveLength(0);
  });

  it('rejects a Node too old to strip TypeScript types, without running anything', () => {
    const run = fakeRun([]);
    const result = deriveWithEngine({ brand, run, env: {}, clone: fakeClone(), nodeVersion: '20.11.0' });
    expect(result.attempts[0]).toMatchObject({ ok: false, reasonCode: 'NODE_TOO_OLD' });
    expect(run.calls).toHaveLength(0);
  });

  it('classifies a failing engine run and invalid engine output', () => {
    const failed = deriveWithEngine({ brand, run: fakeRun([[isNode, { status: 1, stderr: 'Error: Cannot find module' }]]), env: {}, clone: fakeClone() });
    expect(failed.attempts[0]).toMatchObject({ ok: false, reasonCode: 'CLONE_ENGINE_FAILED' });
    expect(failed.attempts[0].message).toContain('Cannot find module');

    const bad = deriveWithEngine({ brand, run: fakeRun([[isNode, { stdout: '{"files":{}}' }]]), env: {}, clone: fakeClone() });
    expect(bad.attempts[0].reasonCode).toBe('INVALID_OUTPUT');
  });

  it('accepts auto and clone (the same path) and refuses the removed container engine', () => {
    const clone = fakeClone();
    expect(deriveWithEngine({ brand, engine: 'auto', run: gitAndNode(), env: {}, clone }).engine).toBe('clone');
    expect(deriveWithEngine({ brand, engine: 'clone', run: gitAndNode(), env: {}, clone }).engine).toBe('clone');
    expect(() => deriveWithEngine({ brand, engine: 'container', run: fakeRun([]), env: {}, clone })).toThrow(/container runtime was removed/);
  });

  it('honours OD_CLONE_DIR', () => {
    const clone = fakeClone();
    const result = deriveWithEngine({ brand, run: gitAndNode(), env: { OD_CLONE_DIR: clone } });
    expect(result.status).toBe('ok');
    expect(result.attempts[0].target).toBe(clone);
  });
});

describe('od-brand-build', () => {
  const brand = readFixture('brand.json');
  const okRun = () => fakeRun([[(command) => command === 'git', { stdout: 'abc1234\n' }], [isNode, { stdout: engineStdout() }]]);

  it('writes source/ and the v2 contract; render then passes the audit', () => {
    const dir = join(tmp(), 'design-systems', 'gestuor');
    const result = buildBrandSystem({ brand, dir, extras: EXTRAS, briefRef: 'design-brief.json', clone: fakeClone(), run: okRun(), env: {}, now: () => '2026-09-19T00:00:00.000Z' });
    expect(result.status).toBe('ok');
    for (const file of ['source/brand.json', 'source/engine-run.json', 'source/engine/seed.json', 'source/engine/tokens.dark.json', 'source/engine/variables.compact.css', 'resolved/design-contract.json']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    const run = JSON.parse(readFileSync(join(dir, 'source', 'engine-run.json'), 'utf8'));
    expect(run).toMatchObject({ status: 'ok', engine: 'clone', version: '0.22.1', deriveSha256: 'abc', contractSha256: result.contractSha256 });
    const contract = JSON.parse(readFileSync(join(dir, 'resolved', 'design-contract.json'), 'utf8'));
    expect(contract.systemId).toBe('gestuor');
    expect(contract.provenance.seed.colorPrimary).toBe('brief');
    expect(contract.provenance.seed.motionUnit).toBe('engine-default');
    const audit = renderDesignPackage({ contractFile: join(dir, 'resolved', 'design-contract.json'), resolvedDir: join(dir, 'resolved') });
    expect(audit.status).toBe('PASS');
    expect(JSON.parse(readFileSync(join(dir, 'resolved', 'provenance.json'), 'utf8')).engine.run).toMatchObject({ path: 'clone', version: '0.22.1' });
  });

  it('the contract bytes are the same for --engine auto and --engine clone', () => {
    const clone = fakeClone();
    const viaAuto = buildBrandSystem({ brand, dir: join(tmp(), 'a'), extras: EXTRAS, clone, run: okRun(), env: {} });
    const viaClone = buildBrandSystem({ brand, dir: join(tmp(), 'b'), extras: EXTRAS, engine: 'clone', clone, run: okRun(), env: {} });
    expect(viaAuto.engine).toBe('clone');
    expect(viaClone.engine).toBe('clone');
    expect(viaClone.contractSha256).toBe(viaAuto.contractSha256);
  });

  it('records BLOCKED in engine-run.json and writes no contract when the engine is unavailable', () => {
    const dir = join(tmp(), 'gestuor');
    const result = buildBrandSystem({ brand, dir, run: fakeRun([]), env: {}, clone: join(tmp(), 'none'), now: () => '2026-09-19T00:00:00.000Z' });
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCode).toBe('OD_BRAND_ENGINE_UNAVAILABLE');
    expect(result.resume).toContain('od-brand-build.mjs');
    expect(existsSync(join(dir, 'resolved', 'design-contract.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'source', 'engine-run.json'), 'utf8')).status).toBe('BLOCKED');
    expect(auditDesignPackage({ resolvedDir: join(dir, 'resolved') }).status).toBe('BLOCKED');
  });
});

const cloneAvailable = existsSync(join(process.env.OD_CLONE_DIR ?? join(homedir(), '.open-design'), 'apps', 'daemon', 'src', 'brands', 'engine', 'derive.ts'));

describe('real engines (skipped when unavailable)', () => {
  const brand = readFixture('brand.json');
  const build = (engine) => buildBrandSystem({ brand, dir: join(tmp(), engine), extras: EXTRAS, engine });

  it.skipIf(!cloneAvailable)('runs the engine from the Open Design clone and yields a contract that passes the audit', () => {
    const result = build('clone');
    expect(result.status).toBe('ok');
    const contract = JSON.parse(readFileSync(result.contract, 'utf8'));
    expect(contract.themes.light['--accent']).toBe('#0f766e');
    expect(contract.themes.light['--success']).toBe('#16a34a');
    expect(contract.tokens['--font-body']).toBe('Inter, sans-serif');
    expect(contract.themes.dark['--accent']).not.toBe(contract.themes.light['--accent']);
    const resolvedDir = join(result.contract, '..');
    expect(renderDesignPackage({ contractFile: result.contract, resolvedDir }).status).toBe('PASS');
  });
});
