/**
 * Adapter for the Open Design brand engine (seed -> derived light/dark/compact token sets).
 *
 * The engine has no public REST endpoint (Phase 0: POST /api/brand/build is a 404 and there is no
 * `pnpm brand:build`), so the adapter runs the engine's own modules with Node built-ins only:
 *   1. clone: `node --import ts-register.mjs -e <runner>` against the host daemon's sources in
 *      ~/.open-design (*.ts) — the same clone the host daemon runs from;
 *   2. BLOCKED (OD_BRAND_ENGINE_UNAVAILABLE) with remediation and the resume command.
 * No token, secret or daemon state is involved. The runner mirrors brands/system.ts:139-143:
 * `seedFromBrand()` ignores `brand.seed`, so the sanitized overrides are merged on top of it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REASON_ENGINE_UNAVAILABLE = 'OD_BRAND_ENGINE_UNAVAILABLE';
export const ENGINE_FILES = [
  'seed.json',
  'tokens.default.json', 'tokens.dark.json', 'tokens.compact.json',
  'variables.default.css', 'variables.dark.css', 'variables.compact.css',
];

/** Runner executed inside the engine's runtime. `__CONFIG__` is replaced by a JSON literal. */
const RUNNER_TEMPLATE = `
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const CONFIG = __CONFIG__;
const brand = JSON.parse(fs.readFileSync(0, 'utf8'));
const load = (name) => import(pathToFileURL(CONFIG.engineDir + name + CONFIG.ext).href);
const { seedFromBrand } = await load('seed');
const { deriveTokens } = await load('derive');
const { tokensToJson, tokensToCssVars } = await load('export');
const TYPES = { colorPrimary: 'string', colorSuccess: 'string', colorWarning: 'string', colorError: 'string', colorInfo: 'string', colorLink: 'string', colorTextBase: 'string', colorBgBase: 'string', fontFamily: 'string', fontFamilyCode: 'string', fontSize: 'number', borderRadius: 'number', sizeUnit: 'number', sizeStep: 'number', controlHeight: 'number', lineWidth: 'number', motionUnit: 'number', motionBase: 'number', wireframe: 'boolean', motion: 'boolean' };
const overrides = {};
for (const [key, type] of Object.entries(TYPES)) if (typeof brand.seed?.[key] === type) overrides[key] = brand.seed[key];
const seed = { ...seedFromBrand(brand), ...overrides };
const files = { 'seed.json': JSON.stringify(seed, null, 2) };
for (const algorithm of ['default', 'dark', 'compact']) {
  const tokens = deriveTokens(seed, algorithm);
  files['tokens.' + algorithm + '.json'] = tokensToJson(tokens);
  files['variables.' + algorithm + '.css'] = tokensToCssVars(tokens);
}
let version = 'unknown';
for (const file of CONFIG.packageJsons) {
  try { version = JSON.parse(fs.readFileSync(file, 'utf8')).version || version; if (version !== 'unknown') break; } catch {}
}
let deriveSha256 = null;
try { deriveSha256 = crypto.createHash('sha256').update(fs.readFileSync(CONFIG.engineDir + 'derive' + CONFIG.ext)).digest('hex'); } catch {}
process.stdout.write(JSON.stringify({ files, engine: { version, deriveSha256 } }));
`;

export function buildRunnerSource({ engineDir, ext, packageJsons }) {
  return RUNNER_TEMPLATE.replace('__CONFIG__', JSON.stringify({ engineDir, ext, packageJsons }));
}

export function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error ?? null };
}

function parseEngineOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reasonCode: 'INVALID_OUTPUT', message: 'engine runner did not print JSON' };
  }
  const missing = ENGINE_FILES.filter((name) => typeof parsed?.files?.[name] !== 'string');
  if (missing.length) return { ok: false, reasonCode: 'INVALID_OUTPUT', message: `engine output is missing ${missing.join(', ')}` };
  try {
    const seed = JSON.parse(parsed.files['seed.json']);
    const tokens = {
      default: JSON.parse(parsed.files['tokens.default.json']),
      dark: JSON.parse(parsed.files['tokens.dark.json']),
      compact: JSON.parse(parsed.files['tokens.compact.json']),
    };
    return { ok: true, files: parsed.files, seed, tokens, engineInfo: parsed.engine ?? {} };
  } catch {
    return { ok: false, reasonCode: 'INVALID_OUTPUT', message: 'engine output files are not valid JSON' };
  }
}

const tail = (text) => String(text ?? '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400);

export function resolveCloneDir({ clone, env = process.env, home = homedir() } = {}) {
  return resolve(clone || env.OD_CLONE_DIR || join(home, '.open-design'));
}

export function attemptClone({ brand, run = defaultRun, env = process.env, clone, home, nodeVersion = process.versions.node }) {
  const dir = resolveCloneDir({ clone, env, home });
  const engineDir = `${join(dir, 'apps', 'daemon', 'src', 'brands', 'engine')}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!existsSync(join(engineDir, 'derive.ts'))) {
    return { engine: 'clone', ok: false, reasonCode: 'CLONE_NOT_FOUND', message: `Open Design sources not found at ${dir}` };
  }
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 6)) {
    return { engine: 'clone', ok: false, reasonCode: 'NODE_TOO_OLD', message: `Node ${nodeVersion} cannot strip TypeScript types; use Node >= 22.6` };
  }
  const source = buildRunnerSource({ engineDir, ext: '.ts', packageJsons: [join(dir, 'apps', 'daemon', 'package.json'), join(dir, 'package.json')] });
  const register = pathToFileURL(join(import.meta.dirname, 'ts-register.mjs')).href;
  const flags = major === 22 ? ['--experimental-strip-types'] : [];
  const result = run(process.execPath, [...flags, '--no-warnings', '--import', register, '--input-type=module', '-e', source], { input: JSON.stringify(brand) });
  if (result.error || result.status !== 0) {
    return { engine: 'clone', ok: false, reasonCode: 'CLONE_ENGINE_FAILED', message: `engine run in ${dir} failed: ${tail(result.stderr) || result.error?.message || `exit ${result.status}`}` };
  }
  const parsed = parseEngineOutput(result.stdout);
  if (parsed.ok) {
    const git = run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { timeout: 10_000 });
    if (git.status === 0 && git.stdout.trim()) parsed.engineInfo = { ...parsed.engineInfo, commit: git.stdout.trim() };
  }
  return { engine: 'clone', target: dir, ...parsed };
}

const REMEDIATION = [
  'clone Open Design to ~/.open-design (or set OD_CLONE_DIR) with Node >= 22.6 (scripts/install-open-design.ps1|.sh does it), then',
  're-run the same od-brand-build.mjs command to resume the DESIGN stage.',
];

/**
 * Runs the engine from the host clone and returns its result, or a BLOCKED result.
 * `engine` accepts 'auto' or 'clone' (the same thing): the Docker container is no longer a supported runtime.
 * @returns {{status:'ok'|'BLOCKED', engine?:string, files?:object, seed?:object, tokens?:object, engineInfo?:object, attempts:object[], reasonCode?:string, remediation?:string[]}}
 */
export function deriveWithEngine({ brand, engine = 'auto', clone, run, env, home, nodeVersion } = {}) {
  if (!brand || typeof brand !== 'object') throw new TypeError('brand object is required');
  if (engine !== 'auto' && engine !== 'clone') throw new TypeError(`unsupported engine "${engine}": use auto or clone (the Docker container runtime was removed)`);
  const outcome = attemptClone({ brand, run, env, clone, home, nodeVersion });
  const { files, seed, tokens, engineInfo, ...record } = outcome;
  const attempts = [{ engine: record.engine, target: record.target ?? null, ok: outcome.ok, reasonCode: outcome.reasonCode ?? null, message: outcome.message ?? null }];
  if (outcome.ok) return { status: 'ok', engine: record.engine, files, seed, tokens, engineInfo, attempts };
  return { status: 'BLOCKED', reasonCode: REASON_ENGINE_UNAVAILABLE, attempts, remediation: REMEDIATION };
}
