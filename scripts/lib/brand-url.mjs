/**
 * Optional brand-URL path of the Open Design brand engine (`buildFromUrl`, no LLM): the daemon's own
 * prefetch reads the site's colours and fonts and `seedFromMaterial` picks a primary colour and a font
 * stack. It runs from the host daemon's compiled engine (`<clone>/apps/daemon/dist/brands/engine/build.js`):
 * `build.ts` imports `@open-design/contracts` and the SSRF-safe fetcher, which need the installed
 * dependencies of the built clone (the same ones the host daemon runs with). The result is a PROPOSAL for
 * the unlocked `colorPrimary` and `fontFamily` (never written into a locked field); the user confirms it,
 * with a colour preview, before it enters the seed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultRun, resolveCloneDir } from './brand-engine.mjs';

export const REASON_BRAND_URL_UNAVAILABLE = 'OD_BRAND_URL_UNAVAILABLE';

const RUNNER_TEMPLATE = `
import fs from 'node:fs';
const CONFIG = __CONFIG__;
const { url } = JSON.parse(fs.readFileSync(0, 'utf8'));
const { buildFromUrl } = await import(CONFIG.buildModule);
const system = await buildFromUrl(url);
let version = 'unknown';
for (const file of CONFIG.packageJsons) {
  try { version = JSON.parse(fs.readFileSync(file, 'utf8')).version || version; if (version !== 'unknown') break; } catch {}
}
process.stdout.write(JSON.stringify({ seed: system.seed, slug: system.slug, engine: { version } }));
`;

/** http(s) only, no credentials, no whitespace: the daemon's fetcher enforces the SSRF policy on top. */
export function isBrandUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const tail = (text) => String(text ?? '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400);

/**
 * @returns {{ status: 'ok', url: string, proposals: {colorPrimary?: string, fontFamily?: string}, engine: object }
 *   | { status: 'UNAVAILABLE', reasonCode: string, message: string }}
 */
export function deriveSeedFromUrl({ url, clone, run = defaultRun, env = process.env, home } = {}) {
  if (!isBrandUrl(url)) return { status: 'UNAVAILABLE', reasonCode: 'INVALID_URL', message: 'brand URL must be an absolute http(s) URL without credentials' };
  const dir = resolveCloneDir({ clone, env, home });
  const buildFile = join(dir, 'apps', 'daemon', 'dist', 'brands', 'engine', 'build.js');
  if (!existsSync(buildFile)) {
    return { status: 'UNAVAILABLE', reasonCode: 'CLONE_NOT_BUILT', message: `built Open Design engine not found at ${buildFile} (run scripts/install-open-design.ps1|.sh, which installs and builds the host daemon)` };
  }
  const source = RUNNER_TEMPLATE.replace('__CONFIG__', JSON.stringify({ buildModule: pathToFileURL(buildFile).href, packageJsons: [join(dir, 'apps', 'daemon', 'package.json'), join(dir, 'package.json')] }));
  const result = run(process.execPath, ['--no-warnings', '--input-type=module', '-e', source], { input: JSON.stringify({ url }), timeout: 90_000 });
  if (result.error || result.status !== 0) {
    return { status: 'UNAVAILABLE', reasonCode: REASON_BRAND_URL_UNAVAILABLE, message: `buildFromUrl failed in ${dir}: ${tail(result.stderr) || result.error?.message || `exit ${result.status}`}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { status: 'UNAVAILABLE', reasonCode: 'INVALID_OUTPUT', message: 'buildFromUrl runner did not print JSON' };
  }
  const proposals = {};
  if (HEX.test(parsed?.seed?.colorPrimary ?? '')) proposals.colorPrimary = parsed.seed.colorPrimary.toUpperCase();
  if (typeof parsed?.seed?.fontFamily === 'string' && parsed.seed.fontFamily.trim()) proposals.fontFamily = parsed.seed.fontFamily;
  return { status: 'ok', url, target: dir, proposals, engine: parsed.engine ?? {} };
}
