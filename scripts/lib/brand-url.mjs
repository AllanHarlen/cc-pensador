/**
 * Optional brand-URL path of the Open Design brand engine (`buildFromUrl`, no LLM): the daemon's own
 * prefetch reads the site's colours and fonts and `seedFromMaterial` picks a primary colour and a font
 * stack. Only the container can run it: `build.ts` imports `@open-design/contracts` and the SSRF-safe
 * fetcher, which need the daemon's installed dependencies (the clone has no node_modules). The result
 * is a PROPOSAL for the unlocked `colorPrimary` and `fontFamily` (never written into a locked field);
 * the user confirms it, with a colour preview, before it enters the seed.
 */
import { CONTAINER_ENGINE_DIR, defaultRun, findContainer } from './brand-engine.mjs';

export const REASON_BRAND_URL_UNAVAILABLE = 'OD_BRAND_URL_UNAVAILABLE';

const RUNNER = `
import fs from 'node:fs';
const { url } = JSON.parse(fs.readFileSync(0, 'utf8'));
const { buildFromUrl } = await import(${JSON.stringify(`${CONTAINER_ENGINE_DIR}build.js`)});
const system = await buildFromUrl(url);
let version = 'unknown';
for (const file of ['/app/apps/daemon/package.json', '/app/package.json']) {
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
export function deriveSeedFromUrl({ url, container, run = defaultRun, env = process.env } = {}) {
  if (!isBrandUrl(url)) return { status: 'UNAVAILABLE', reasonCode: 'INVALID_URL', message: 'brand URL must be an absolute http(s) URL without credentials' };
  const found = container ? { name: container } : findContainer({ run, env });
  if (!found.name) return { status: 'UNAVAILABLE', reasonCode: found.reasonCode ?? REASON_BRAND_URL_UNAVAILABLE, message: found.message ?? 'no Open Design container' };
  const result = run('docker', ['exec', '-i', found.name, 'node', '--input-type=module', '-e', RUNNER], { input: JSON.stringify({ url }), timeout: 90_000 });
  if (result.error || result.status !== 0) {
    return { status: 'UNAVAILABLE', reasonCode: REASON_BRAND_URL_UNAVAILABLE, message: `buildFromUrl failed in ${found.name}: ${tail(result.stderr) || result.error?.message || `exit ${result.status}`}` };
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
  return { status: 'ok', url, target: found.name, proposals, engine: parsed.engine ?? {} };
}
