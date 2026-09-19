import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const isDockerPs = (command, args) => command === 'docker' && args[0] === 'ps';
const isDockerExec = (command, args) => command === 'docker' && args[0] === 'exec';
const isNode = (command) => command !== 'docker' && command !== 'git';

describe('runner source', () => {
  it('merges brand.seed on top of seedFromBrand (Phase 0 finding F7) and reads the brand from stdin', () => {
    const source = buildRunnerSource({ engineDir: '/e/', ext: '.js', packageJsons: ['/p.json'] });
    expect(source).toContain('const seed = { ...seedFromBrand(brand), ...overrides };');
    expect(source).toContain('fs.readFileSync(0');
    expect(source).toContain('"engineDir":"/e/"');
    expect(source).not.toContain('__CONFIG__');
  });
});

describe('engine chain: container -> clone -> BLOCKED', () => {
  const brand = readFixture('brand.json');

  it('uses the container first and never touches the clone when it works', () => {
    const run = fakeRun([[isDockerPs, { stdout: 'other\nopen-design\n' }], [isDockerExec, { stdout: engineStdout() }]]);
    const result = deriveWithEngine({ brand, run, env: {} });
    expect(result.status).toBe('ok');
    expect(result.engine).toBe('container');
    expect(result.engineInfo.version).toBe('0.22.1');
    expect(Object.keys(JSON.parse(engineStdout()).files)).toEqual(expect.arrayContaining(ENGINE_FILES));
    expect(run.calls.some((call) => isNode(call.command))).toBe(false);
    const exec = run.calls.find((call) => isDockerExec(call.command, call.args));
    expect(exec.args.slice(0, 3)).toEqual(['exec', '-i', 'open-design']);
    expect(JSON.parse(exec.input).slug).toBe('gestuor');
  });

  it('falls back to the clone when the container is missing, recording both attempts', () => {
    const clone = tmp();
    const run = fakeRun([
      [isDockerPs, { stdout: '' }],
      [(command) => isNode(command), { stdout: engineStdout('0.22.1') }],
      [(command) => command === 'git', { stdout: 'abc1234\n' }],
    ]);
    // a fake clone dir with the engine entry point so the existence check passes
    const engineDir = join(clone, 'apps', 'daemon', 'src', 'brands', 'engine');
    spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(engineDir)},{recursive:true});require('fs').writeFileSync(${JSON.stringify(join(engineDir, 'derive.ts'))},'')`]);
    const result = deriveWithEngine({ brand, run, env: {}, clone });
    expect(result.status).toBe('ok');
    expect(result.engine).toBe('clone');
    expect(result.engineInfo.commit).toBe('abc1234');
    expect(result.attempts.map((attempt) => [attempt.engine, attempt.ok, attempt.reasonCode])).toEqual([
      ['container', false, 'CONTAINER_NOT_FOUND'],
      ['clone', true, null],
    ]);
  });

  it('returns BLOCKED OD_BRAND_ENGINE_UNAVAILABLE with attempts and remediation when both fail', () => {
    const run = fakeRun([[isDockerPs, { error: Object.assign(new Error('nope'), { code: 'ENOENT' }), status: null }]]);
    const result = deriveWithEngine({ brand, run, env: {}, clone: join(tmp(), 'absent') });
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCode).toBe(REASON_ENGINE_UNAVAILABLE);
    expect(result.attempts.map((attempt) => attempt.reasonCode)).toEqual(['DOCKER_MISSING', 'CLONE_NOT_FOUND']);
    expect(result.remediation.join(' ')).toMatch(/open-design/);
  });

  it('classifies a failing docker exec and invalid engine output', () => {
    const run = fakeRun([[isDockerPs, { stdout: 'open-design' }], [isDockerExec, { status: 1, stderr: 'Error: Cannot find module' }]]);
    const failed = deriveWithEngine({ brand, engine: 'container', run, env: {} });
    expect(failed.attempts[0]).toMatchObject({ ok: false, reasonCode: 'CONTAINER_ENGINE_FAILED' });
    expect(failed.attempts[0].message).toContain('Cannot find module');

    const bad = deriveWithEngine({ brand, engine: 'container', run: fakeRun([[isDockerPs, { stdout: 'open-design' }], [isDockerExec, { stdout: '{"files":{}}' }]]), env: {} });
    expect(bad.attempts[0].reasonCode).toBe('INVALID_OUTPUT');
  });

  it('honours OD_CONTAINER and --engine clone|container', () => {
    const run = fakeRun([[isDockerExec, { stdout: engineStdout() }]]);
    const result = deriveWithEngine({ brand, engine: 'container', run, env: { OD_CONTAINER: 'my-od' } });
    expect(result.status).toBe('ok');
    expect(run.calls[0].args.slice(0, 3)).toEqual(['exec', '-i', 'my-od']);
    expect(deriveWithEngine({ brand, engine: 'clone', run: fakeRun([]), env: {}, clone: join(tmp(), 'x') }).attempts).toHaveLength(1);
  });
});

describe('od-brand-build', () => {
  const brand = readFixture('brand.json');
  const okRun = () => fakeRun([[isDockerPs, { stdout: 'open-design' }], [isDockerExec, { stdout: engineStdout() }]]);

  it('writes source/ and the v2 contract; render then passes the audit', () => {
    const dir = join(tmp(), 'design-systems', 'gestuor');
    const result = buildBrandSystem({ brand, dir, extras: EXTRAS, briefRef: 'design-brief.json', run: okRun(), env: {}, now: () => '2026-09-19T00:00:00.000Z' });
    expect(result.status).toBe('ok');
    for (const file of ['source/brand.json', 'source/engine-run.json', 'source/engine/seed.json', 'source/engine/tokens.dark.json', 'source/engine/variables.compact.css', 'resolved/design-contract.json']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    const run = JSON.parse(readFileSync(join(dir, 'source', 'engine-run.json'), 'utf8'));
    expect(run).toMatchObject({ status: 'ok', engine: 'container', version: '0.22.1', deriveSha256: 'abc', contractSha256: result.contractSha256 });
    const contract = JSON.parse(readFileSync(join(dir, 'resolved', 'design-contract.json'), 'utf8'));
    expect(contract.systemId).toBe('gestuor');
    expect(contract.provenance.seed.colorPrimary).toBe('brief');
    expect(contract.provenance.seed.motionUnit).toBe('engine-default');
    const audit = renderDesignPackage({ contractFile: join(dir, 'resolved', 'design-contract.json'), resolvedDir: join(dir, 'resolved') });
    expect(audit.status).toBe('PASS');
    expect(JSON.parse(readFileSync(join(dir, 'resolved', 'provenance.json'), 'utf8')).engine.run).toMatchObject({ path: 'container', version: '0.22.1' });
  });

  it('the contract bytes do not depend on which engine path ran', () => {
    const cloneDir = tmp();
    const engineDir = join(cloneDir, 'apps', 'daemon', 'src', 'brands', 'engine');
    spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(engineDir)},{recursive:true});require('fs').writeFileSync(${JSON.stringify(join(engineDir, 'derive.ts'))},'')`]);
    const viaContainer = buildBrandSystem({ brand, dir: join(tmp(), 'a'), extras: EXTRAS, run: okRun(), env: {} });
    const viaClone = buildBrandSystem({ brand, dir: join(tmp(), 'b'), extras: EXTRAS, engine: 'clone', clone: cloneDir, run: fakeRun([[(c) => c !== 'git', { stdout: engineStdout() }]]), env: {} });
    expect(viaContainer.engine).toBe('container');
    expect(viaClone.engine).toBe('clone');
    expect(viaClone.contractSha256).toBe(viaContainer.contractSha256);
  });

  it('records BLOCKED in engine-run.json and writes no contract when the engine is unavailable', () => {
    const dir = join(tmp(), 'gestuor');
    const result = buildBrandSystem({ brand, dir, run: fakeRun([[isDockerPs, { stdout: '' }]]), env: {}, clone: join(tmp(), 'none'), now: () => '2026-09-19T00:00:00.000Z' });
    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCode).toBe('OD_BRAND_ENGINE_UNAVAILABLE');
    expect(result.resume).toContain('od-brand-build.mjs');
    expect(existsSync(join(dir, 'resolved', 'design-contract.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'source', 'engine-run.json'), 'utf8')).status).toBe('BLOCKED');
    expect(auditDesignPackage({ resolvedDir: join(dir, 'resolved') }).status).toBe('BLOCKED');
  });
});

const cloneAvailable = existsSync(join(process.env.OD_CLONE_DIR ?? join(homedir(), '.open-design'), 'apps', 'daemon', 'src', 'brands', 'engine', 'derive.ts'));
const dockerAvailable = (() => {
  const listed = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 15_000 });
  return listed.status === 0 && /open-?design/i.test(listed.stdout);
})();

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

  it.skipIf(!cloneAvailable || !dockerAvailable)('container and clone produce the same contract byte for byte (same engine version)', () => {
    const a = build('container');
    const b = build('clone');
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(readFileSync(b.contract, 'utf8')).toBe(readFileSync(a.contract, 'utf8'));
  });
});
