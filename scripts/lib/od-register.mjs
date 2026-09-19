/**
 * Registers a Pensador `resolved/` design system in an Open Design daemon so the OPTIONAL prototype
 * (`od project create --design-system user:<id>`) reads the tokens VERBATIM.
 *
 * Why not `od design-systems import-local`: it re-scans the source and regenerates tokens.css, so the
 * daemon serves a generic palette and the agent invents the dark theme (measured: 0 of 16 dark tokens
 * identical). The resolved/ package already is the daemon's native layout, so it is registered like this:
 *
 *   1. POST /api/design-systems { title: <id>, category: 'Generated', status: 'published', body: DESIGN.md }
 *      -> the daemon creates <data>/design-systems/<id>/ with a generic wrapper (id = slug of the title);
 *   2. overlay the resolved/ files on that directory (tokens.css also over colors_and_type.css);
 *   3. read the tokens.css back FROM THE DAEMON and refuse unless it is byte-for-byte the resolved one.
 *
 * Step 2 writes into a directory the daemon owns. That is not a public API (validated on daemon 0.22.1
 * only), so the layout is checked, the daemon version is recorded and a missing layout is a stable refusal
 * with a remediation - never a silent partial registration.
 *
 * Side effects: state in the daemon (needs the user's acceptance, enforced by the CLI). This module never
 * starts a run. The bearer token is only forwarded as a header (never returned, logged or put in an error).
 * Every dependency (fetch, file system, docker) is injectable, so the tests need no daemon.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';

export const REGISTER_REASON = {
  INPUT_INVALID: 'OD_REGISTER_INPUT_INVALID',
  NO_TARGET: 'OD_REGISTER_NO_TARGET',
  INSECURE_TARGET: 'OD_REGISTER_INSECURE_TARGET',
  DAEMON_UNREACHABLE: 'OD_REGISTER_DAEMON_UNREACHABLE',
  AUTH_REQUIRED: 'OD_REGISTER_AUTH_REQUIRED',
  ID_MISMATCH: 'OD_REGISTER_ID_MISMATCH',
  MANIFEST_ID_MISMATCH: 'OD_REGISTER_MANIFEST_ID_MISMATCH',
  LAYOUT_MISSING: 'OD_REGISTER_LAYOUT_MISSING',
  TOKENS_DIVERGED: 'OD_REGISTER_TOKENS_DIVERGED',
  TOKENS_UNREADABLE: 'OD_REGISTER_TOKENS_UNREADABLE',
  MANIFEST_DIVERGED: 'OD_REGISTER_MANIFEST_DIVERGED',
  DAEMON_REJECTED: 'OD_REGISTER_DAEMON_REJECTED',
  COPY_FAILED: 'OD_REGISTER_COPY_FAILED',
};

/** Daemon versions whose on-disk layout was validated (the direct copy is not a public API). */
export const VALIDATED_DAEMON_VERSIONS = ['0.22.1'];

const REQUIRED_FILES = ['tokens.css', 'manifest.json', 'DESIGN.md'];
const OPTIONAL_FILES = ['design-tokens.json', 'tailwind-v4.css', 'components.html', 'components.manifest.json', 'USAGE.md'];
const SYSTEM_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const refuse = (reasonCode, message, remediation, extra = {}) => ({ status: 'REFUSED', reasonCode, message, remediation, ...extra });

/** Files to publish, as Map<relativePosixPath, Buffer>, plus the resolved tokens.css bytes. */
export function collectResolvedFiles(resolvedDir, { readFile = readFileSync, exists = existsSync, list = readdirSync, stat = statSync } = {}) {
  const files = new Map();
  const missing = [];
  for (const name of REQUIRED_FILES) {
    if (exists(join(resolvedDir, name))) files.set(name, readFile(join(resolvedDir, name)));
    else missing.push(name);
  }
  if (missing.length) return { missing, files };
  for (const name of OPTIONAL_FILES) if (exists(join(resolvedDir, name))) files.set(name, readFile(join(resolvedDir, name)));
  // The wrapper's palette must not reach the agent through another channel.
  files.set('colors_and_type.css', files.get('tokens.css'));
  const walk = (dir, prefix) => {
    for (const entry of list(dir)) {
      const abs = join(dir, entry);
      const rel = `${prefix}${entry}`;
      if (stat(abs).isDirectory()) walk(abs, `${rel}/`);
      else files.set(rel, readFile(abs));
    }
  };
  if (exists(join(resolvedDir, 'preview'))) walk(join(resolvedDir, 'preview'), 'preview/');
  return { missing, files };
}

function safeRel(rel) {
  const normal = posix.normalize(rel);
  return !normal.startsWith('..') && !posix.isAbsolute(normal) && !rel.includes('\\');
}

/** Target = a data directory reachable from this machine (daemon on the host). */
export function fsTarget(dataDir, { fs = { existsSync, statSync, mkdirSync, writeFileSync } } = {}) {
  const base = (id) => join(resolve(dataDir), 'design-systems', id);
  return {
    where: 'host',
    describe: (id) => base(id),
    exists: (id) => {
      try { return fs.existsSync(base(id)) && fs.statSync(base(id)).isDirectory(); } catch { return false; }
    },
    commit: (id, files) => {
      for (const [rel, buffer] of files) {
        if (!safeRel(rel)) throw new Error(`unsafe path ${rel}`);
        const dest = join(base(id), ...rel.split('/'));
        fs.mkdirSync(dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buffer);
      }
    },
  };
}

/** Target = the daemon's data directory INSIDE a container (daemon in Docker): `docker exec` + `docker cp`. */
export function dockerTarget({ container, dataDir = '/app/.od', exec = defaultExec, stageRoot = tmpdir() } = {}) {
  const base = (id) => `${dataDir.replace(/\/+$/, '')}/design-systems/${id}`;
  return {
    where: 'container',
    describe: (id) => `${container}:${base(id)}`,
    exists: (id) => {
      try { return exec('docker', ['exec', container, 'test', '-d', base(id)]).status === 0; } catch { return false; }
    },
    commit: (id, files) => {
      const stage = mkdtempSync(join(stageRoot, 'pensador-od-register-'));
      try {
        for (const [rel, buffer] of files) {
          if (!safeRel(rel)) throw new Error(`unsafe path ${rel}`);
          const dest = join(stage, ...rel.split('/'));
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, buffer);
        }
        const result = exec('docker', ['cp', `${stage}${sep}.`, `${container}:${base(id)}`]);
        if (result.status !== 0) throw new Error('docker cp failed');
      } finally {
        rmSync(stage, { recursive: true, force: true });
      }
    },
  };
}

function defaultExec(command, args) {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    return { status: 0, stdout };
  } catch (error) {
    return { status: typeof error.status === 'number' ? error.status : 1, stdout: '' };
  }
}

function baseUrlOf(daemonUrl) {
  try {
    const parsed = new URL(daemonUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return { origin: parsed.origin, hostname: parsed.hostname };
  } catch {
    return null;
  }
}

/** Reads a /file response: the daemon answers JSON `{ content }`; a raw text body is accepted too. */
async function readFileBody(response) {
  const text = await response.text();
  if (/json/i.test(response.headers?.get?.('content-type') ?? '') || text.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(text);
      if (typeof json?.content === 'string') return Buffer.from(json.content, 'utf8');
      return null;
    } catch { /* fall through to the raw body */ }
  }
  return Buffer.from(text, 'utf8');
}

/**
 * @param {object} opts
 * @param {string} opts.resolvedDir  design-systems/<id>/resolved
 * @param {string} opts.daemonUrl    explicit daemon URL (never guessed: the wrong port is the real daemon)
 * @param {string} [opts.systemId]   defaults to manifest.json id; must equal it
 * @param {string|null} [opts.token] bearer token (only forwarded as a header)
 * @param {{ where: string, describe: Function, exists: Function, commit: Function }} opts.target
 * @param {boolean} [opts.allowRemote]
 * @param {Function} [opts.fetchFn]
 * @param {() => string} [opts.now]
 */
export async function registerDesignSystem({ resolvedDir, daemonUrl, systemId, token = null, target, allowRemote = false, fetchFn = fetch, now = () => new Date().toISOString(), timeoutMs = 30_000, fsOps } = {}) {
  const url = typeof daemonUrl === 'string' ? baseUrlOf(daemonUrl) : null;
  if (!url) return refuse(REGISTER_REASON.INPUT_INVALID, 'daemonUrl must be an explicit http(s) URL', 'pass --daemon-url http://127.0.0.1:<port> (never rely on a default: the default port may be the real daemon)');
  if (!target) return refuse(REGISTER_REASON.NO_TARGET, 'no data directory or container to write the design system into', 'pass --data-dir <daemon data dir> (daemon on the host) or --container <name> (daemon in Docker)');
  if (!LOOPBACK.has(url.hostname) && !allowRemote) {
    return refuse(REGISTER_REASON.INSECURE_TARGET, 'refusing to send the daemon token to a non-loopback host', 'use a loopback daemon URL, or pass --allow-remote if the daemon really is remote');
  }

  const collected = collectResolvedFiles(resolve(resolvedDir), fsOps);
  if (collected.missing.length) {
    return refuse(REGISTER_REASON.INPUT_INVALID, `resolved/ is missing ${collected.missing.join(', ')}`, 'render the package first: design-package.mjs render, then audit until status PASS');
  }
  const { files } = collected;
  let manifest;
  try { manifest = JSON.parse(files.get('manifest.json').toString('utf8')); } catch { manifest = null; }
  const id = systemId ?? manifest?.id;
  if (typeof id !== 'string' || !SYSTEM_ID.test(id)) {
    return refuse(REGISTER_REASON.INPUT_INVALID, 'the system id must be a lowercase slug (a-z, 0-9, -)', 'pass --system-id <slug> equal to the manifest.json id');
  }
  if (manifest?.id !== id) {
    return refuse(REGISTER_REASON.MANIFEST_ID_MISMATCH, `manifest.json id (${manifest?.id ?? 'absent'}) differs from the system id (${id}); the daemon ignores a system whose manifest id is not its directory name`, 'render again so manifest.json carries the system id, or fix --system-id');
  }
  const contractSha256 = manifest?.source?.contractSha256 ?? null;

  const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const call = async (path, init = {}) => {
    const response = await fetchFn(`${url.origin}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
    return response;
  };
  const unreachable = (error) => refuse(REGISTER_REASON.DAEMON_UNREACHABLE, `the daemon at ${url.origin} did not answer (${error?.name ?? 'error'})`, 'start the Open Design daemon (the first start of a host daemon takes 10-30 s) and check the port; then run register again');
  const authRequired = () => refuse(REGISTER_REASON.AUTH_REQUIRED, 'the daemon requires its API token (HTTP 401/403)', 'set OD_API_TOKEN (environment or the Open Design deploy .env) and run register again; the token is never printed');

  // daemon version: recorded because the copy below depends on its on-disk layout
  let daemonVersion = null;
  try {
    for (const path of ['/api/health', '/api/version']) {
      const response = await call(path);
      if (response.status === 401 || response.status === 403) return authRequired();
      if (!response.ok) continue;
      const json = await response.json().catch(() => null);
      if (typeof json?.version === 'string') { daemonVersion = json.version; break; }
    }
  } catch (error) {
    return unreachable(error);
  }

  // 1. create (or reuse) the design system, published
  let created = false;
  try {
    const response = await call('/api/design-systems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: id, category: 'Generated', status: 'published', body: files.get('DESIGN.md').toString('utf8') }),
    });
    if (response.status === 401 || response.status === 403) return authRequired();
    if (response.status === 409) {
      created = false;
    } else if (!response.ok) {
      return refuse(REGISTER_REASON.DAEMON_REJECTED, `POST /api/design-systems answered HTTP ${response.status}`, 'check the daemon logs and the version (the payload is validated on 0.22.1); nothing was written to its data directory');
    } else {
      created = true;
      const json = await response.json().catch(() => null);
      if (typeof json?.id === 'string' && json.id !== `user:${id}`) {
        return refuse(REGISTER_REASON.ID_MISMATCH, `the daemon named the system ${json.id}, not user:${id} (the id is the slug of the title)`, `remove ${json.id} from the daemon and use a --system-id that is already a slug`, { daemonVersion, createdId: json.id });
      }
    }
  } catch (error) {
    return unreachable(error);
  }

  // 2. overlay resolved/ on the directory the daemon created (not a public API: check the layout first)
  if (!target.exists(id)) {
    return refuse(
      REGISTER_REASON.LAYOUT_MISSING,
      `expected ${target.describe(id)} after the POST, but it does not exist (daemon ${daemonVersion ?? 'unknown version'}; layout validated only on ${VALIDATED_DAEMON_VERSIONS.join(', ')})`,
      'point --data-dir/--container at the daemon\'s real data directory (where user design systems live), or upgrade/downgrade the daemon to a validated version; the system exists in the daemon as a generic wrapper and must not be used for a prototype',
      { daemonVersion, created },
    );
  }
  try {
    target.commit(id, files);
  } catch (error) {
    return refuse(REGISTER_REASON.COPY_FAILED, `could not write the resolved/ files (${error?.message ?? 'error'})`, 'check permissions of the daemon data directory (or docker access) and run register again', { daemonVersion, created });
  }

  // 3. verify what the DAEMON serves, not the disk
  const expected = files.get('tokens.css');
  const encoded = encodeURIComponent(`user:${id}`);
  const rollback = async () => {
    try {
      const response = await call(`/api/design-systems/${encoded}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'draft' }) });
      return response.ok;
    } catch { return false; }
  };
  const served = {};
  try {
    for (const name of ['tokens.css', 'colors_and_type.css']) {
      const response = await call(`/api/design-systems/${encoded}/file?path=${encodeURIComponent(name)}`);
      if (response.status === 401 || response.status === 403) return authRequired();
      if (!response.ok) {
        const rolledBackToDraft = await rollback();
        return refuse(REGISTER_REASON.TOKENS_UNREADABLE, `the daemon does not serve ${name} (HTTP ${response.status})`, 'the daemon does not see the copied files: check that --data-dir/--container is the daemon\'s data directory; the system was set back to draft', { daemonVersion, created, rolledBackToDraft });
      }
      served[name] = await readFileBody(response);
    }
  } catch (error) {
    return unreachable(error);
  }
  const diverged = Object.entries(served).filter(([, body]) => !body || !Buffer.isBuffer(body) || !body.equals(expected)).map(([name]) => name);
  if (diverged.length) {
    const rolledBackToDraft = await rollback();
    return refuse(
      REGISTER_REASON.TOKENS_DIVERGED,
      `the daemon serves ${diverged.join(' and ')} different from resolved/tokens.css`,
      `do not run the prototype: the agent would read other tokens. The system was ${rolledBackToDraft ? 'set back to draft' : 'left published (the rollback failed: unpublish it in the daemon)'}; check the data directory and register again`,
      { daemonVersion, created, diverged, rolledBackToDraft },
    );
  }

  // the daemon also reports the manifest it parsed: the contract hash must be ours
  let manifestSeen = null;
  try {
    const response = await call(`/api/design-systems/${encoded}`);
    if (response.ok) {
      const json = await response.json().catch(() => null);
      const seen = json?.packageInfo?.manifest;
      manifestSeen = seen?.source?.contractSha256 ?? seen?.contractSha256 ?? null;
    }
  } catch { /* the byte comparison above is the hard gate */ }
  if (contractSha256 && manifestSeen && manifestSeen !== contractSha256) {
    const rolledBackToDraft = await rollback();
    return refuse(REGISTER_REASON.MANIFEST_DIVERGED, 'the daemon parsed a manifest with another contractSha256', 'the overlay of manifest.json did not take effect; check the data directory and register again', { daemonVersion, created, rolledBackToDraft });
  }

  const registeredAt = now();
  return {
    status: 'ok',
    systemId: id,
    daemonSystemId: `user:${id}`,
    created,
    daemonVersion,
    daemonVersionValidated: daemonVersion ? VALIDATED_DAEMON_VERSIONS.includes(daemonVersion) : false,
    daemonWhere: target.where,
    filesWritten: [...files.keys()].sort(),
    tokensBytes: expected.length,
    contractSha256,
    manifestVerified: Boolean(manifestSeen),
    registeredAt,
    statePatch: { designRegistrations: { [id]: { registeredAt, daemonWhere: target.where, daemonVersion, contractSha256, tokensBytes: expected.length } } },
  };
}

