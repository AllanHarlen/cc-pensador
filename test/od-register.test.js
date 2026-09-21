/**
 * od-register-system: registers resolved/ in an Open Design daemon and refuses unless the daemon serves the
 * tokens.css verbatim. The daemon is SIMULATED (in-memory fetch + a temp data dir): no test touches a real
 * daemon or the network, and none may ever start a run.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { initState } from '../scripts/pensador-engine.mjs';
import { renderDesignPackage } from '../scripts/design-package.mjs';
import {
  REGISTER_REASON, VALIDATED_DAEMON_VERSIONS, collectResolvedFiles, defaultDataDir, fsTarget, registerDesignSystem,
} from '../scripts/lib/od-register.mjs';
import { REGISTER_CONSENT_HEADER, registerCommand } from '../scripts/od-register-system.mjs';
import { fixtureContract } from './helpers/design-fixture.js';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const SECRET = 'od-secret-token-9f3a';
const GENERIC_CSS = ':root { --brand-accent: #d66f4d; } /* generic wrapper palette */\n';

function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** A real, rendered resolved/ (the same files the Pensador ships). */
function renderedResolved() {
  const root = tmp('od-register-');
  const contractFile = join(root, 'contract.json');
  writeFileSync(contractFile, JSON.stringify(fixtureContract()));
  const resolvedDir = join(root, 'design-systems', 'gestuor', 'resolved');
  renderDesignPackage({ contractFile, resolvedDir });
  return { root, resolvedDir, systemDir: join(root, 'design-systems', 'gestuor') };
}

const slug = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * In-memory Open Design daemon. Stores design systems in `<dataDir>/design-systems/<slug>/`, the way the real
 * one does, and serves /file from that directory. `calls` records every request.
 */
function fakeDaemon({ dataDir, version = '0.22.1', authToken = null, createLayout = true, respondId = null, postStatus = 201, manifestSha = undefined, unreachable = false } = {}) {
  const calls = [];
  const statuses = {};
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: u.pathname + u.search, authorization: init.headers?.Authorization ?? null, body: init.body ?? null });
    if (unreachable) { const error = new Error('connect ECONNREFUSED'); error.name = 'TypeError'; throw error; }
    if (authToken && init.headers?.Authorization !== `Bearer ${authToken}`) return json({ error: 'unauthorized' }, 401);
    if (method === 'GET' && u.pathname === '/api/health') return json({ ok: true, version });
    if (method === 'POST' && u.pathname === '/api/design-systems') {
      const body = JSON.parse(init.body);
      const id = slug(body.title);
      if (postStatus === 409) return json({ error: 'exists' }, 409);
      if (createLayout) {
        const dir = join(dataDir, 'design-systems', id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'colors_and_type.css'), GENERIC_CSS);
        writeFileSync(join(dir, 'tokens.css'), GENERIC_CSS);
      }
      statuses[id] = body.status;
      return json({ id: respondId ?? `user:${id}`, status: body.status }, postStatus);
    }
    const match = u.pathname.match(/^\/api\/design-systems\/user%3A([^/]+)(\/file)?$/);
    if (match) {
      const dir = join(dataDir, 'design-systems', match[1]);
      if (method === 'PATCH') { statuses[match[1]] = JSON.parse(init.body).status; return json({ ok: true }); }
      if (match[2]) {
        const file = join(dir, u.searchParams.get('path'));
        return existsSync(file) ? json({ content: readFileSync(file, 'utf8') }) : json({ error: 'not found' }, 404);
      }
      const manifestFile = join(dir, 'manifest.json');
      const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
      if (manifest && manifestSha !== undefined) manifest.source = { ...manifest.source, contractSha256: manifestSha };
      return json({ id: `user:${match[1]}`, packageInfo: { manifest } });
    }
    return json({ error: 'not found' }, 404);
  };
  return { fetchFn, calls, statuses };
}

const startedRun = (calls) => calls.some((call) => /\/(runs?|api\/runs?)\b/.test(call.path));

describe('collectResolvedFiles', () => {
  it('gathers the package, overlays tokens.css on colors_and_type.css and walks preview/', () => {
    const { resolvedDir } = renderedResolved();
    const { missing, files } = collectResolvedFiles(resolvedDir);
    expect(missing).toEqual([]);
    for (const name of ['tokens.css', 'manifest.json', 'DESIGN.md', 'design-tokens.json', 'tailwind-v4.css', 'components.html', 'USAGE.md', 'components.manifest.json']) {
      expect(files.has(name), name).toBe(true);
    }
    expect(files.get('colors_and_type.css').equals(files.get('tokens.css'))).toBe(true);
    expect([...files.keys()].some((key) => key.startsWith('preview/'))).toBe(true);
    // the contract and the audit stay in the Pensador: the daemon does not need them
    expect(files.has('design-contract.json')).toBe(false);
  });

  it('reports the missing required files', () => {
    const dir = tmp('od-register-empty-');
    expect(collectResolvedFiles(dir).missing).toEqual(['tokens.css', 'manifest.json', 'DESIGN.md']);
  });
});

describe('registerDesignSystem - daemon on the host', () => {
  it('registers, overlays resolved/ and verifies the tokens.css the daemon serves', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir });
    const result = await registerDesignSystem({
      resolvedDir, daemonUrl: 'http://127.0.0.1:7466', token: SECRET, target: fsTarget(dataDir), fetchFn: daemon.fetchFn, now: () => '2026-09-19T12:00:00.000Z',
    });
    expect(result.status).toBe('ok');
    expect(result).toMatchObject({ systemId: 'gestuor', daemonSystemId: 'user:gestuor', created: true, daemonVersion: '0.22.1', daemonVersionValidated: true, daemonWhere: 'host', manifestVerified: true });
    const dir = join(dataDir, 'design-systems', 'gestuor');
    const tokens = readFileSync(join(resolvedDir, 'tokens.css'));
    expect(readFileSync(join(dir, 'tokens.css')).equals(tokens)).toBe(true);
    expect(readFileSync(join(dir, 'colors_and_type.css')).equals(tokens)).toBe(true);
    expect(existsSync(join(dir, 'preview'))).toBe(true);
    expect(result.tokensBytes).toBe(tokens.length);
    expect(daemon.statuses.gestuor).toBe('published');
    // it asked for the published system and read tokens.css back from the DAEMON
    const post = daemon.calls.find((call) => call.method === 'POST');
    expect(JSON.parse(post.body)).toMatchObject({ title: 'gestuor', category: 'Generated', status: 'published' });
    expect(daemon.calls.some((call) => call.path.includes('/file?path=tokens.css'))).toBe(true);
    expect(startedRun(daemon.calls)).toBe(false);
    expect(result.statePatch).toEqual({
      designRegistrations: { gestuor: { registeredAt: '2026-09-19T12:00:00.000Z', daemonWhere: 'host', daemonVersion: '0.22.1', contractSha256: expect.stringMatching(/^[0-9a-f]{64}$/), tokensBytes: tokens.length } },
    });
  });

  it('forwards the token as a Bearer header only and never returns it', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir, authToken: SECRET });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://localhost:7466', token: SECRET, target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.status).toBe('ok');
    expect(daemon.calls.every((call) => call.authorization === `Bearer ${SECRET}`)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('is idempotent: an existing system (HTTP 409) is overlaid again', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    mkdirSync(join(dataDir, 'design-systems', 'gestuor'), { recursive: true });
    const daemon = fakeDaemon({ dataDir, postStatus: 409 });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.status).toBe('ok');
    expect(result.created).toBe(false);
  });

  it('records a version outside the validated list without refusing (the byte comparison is the gate)', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir, version: '0.99.0' });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.status).toBe('ok');
    expect(result.daemonVersion).toBe('0.99.0');
    expect(result.daemonVersionValidated).toBe(false);
    expect(VALIDATED_DAEMON_VERSIONS).toContain('0.22.1');
  });
});

describe('registerDesignSystem - refusals', () => {
  it('REFUSES with OD_REGISTER_TOKENS_DIVERGED when the daemon serves other tokens, and unpublishes the system', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir });
    // the overlay does not take effect (a daemon that regenerates the file): the wrapper stays on disk
    const noopTarget = { where: 'host', describe: () => 'noop', exists: () => true, commit: () => {} };
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: noopTarget, fetchFn: daemon.fetchFn });
    expect(result.status).toBe('REFUSED');
    expect(result.reasonCode).toBe('OD_REGISTER_TOKENS_DIVERGED');
    expect(result.diverged).toEqual(['tokens.css', 'colors_and_type.css']);
    expect(result.rolledBackToDraft).toBe(true);
    expect(daemon.statuses.gestuor).toBe('draft');
    expect(result.remediation).toMatch(/prototype/i);
    expect(result.statePatch).toBeUndefined();
    expect(startedRun(daemon.calls)).toBe(false);
  });

  it('REFUSES when the overlay changes a single byte of tokens.css', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir });
    const real = fsTarget(dataDir);
    const tampering = { ...real, commit: (id, files) => {
      const copy = new Map(files);
      copy.set('tokens.css', Buffer.concat([files.get('tokens.css'), Buffer.from(' ')]));
      real.commit(id, copy);
    } };
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: tampering, fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_TOKENS_DIVERGED');
  });

  it('REFUSES with OD_REGISTER_LAYOUT_MISSING when the daemon layout is not the expected one, and writes nothing', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir, createLayout: false, version: '0.30.0' });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.status).toBe('REFUSED');
    expect(result.reasonCode).toBe('OD_REGISTER_LAYOUT_MISSING');
    expect(result.daemonVersion).toBe('0.30.0');
    expect(result.message).toMatch(/0\.30\.0/);
    expect(result.remediation).toMatch(/--data-dir/);
    expect(existsSync(join(dataDir, 'design-systems'))).toBe(false);
  });

  it('REFUSES with OD_REGISTER_AUTH_REQUIRED when the daemon needs a token and none was given', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir, authToken: SECRET });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', token: null, target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.status).toBe('REFUSED');
    expect(result.reasonCode).toBe('OD_REGISTER_AUTH_REQUIRED');
    expect(result.remediation).toMatch(/OD_API_TOKEN/);
    expect(existsSync(join(dataDir, 'design-systems'))).toBe(false);
  });

  it('REFUSES with OD_REGISTER_AUTH_REQUIRED for a wrong token, without echoing it', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir, authToken: SECRET });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', token: 'wrong-token-123', target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_AUTH_REQUIRED');
    expect(JSON.stringify(result)).not.toContain('wrong-token-123');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('REFUSES with OD_REGISTER_DAEMON_UNREACHABLE naming only the error class', async () => {
    const { resolvedDir } = renderedResolved();
    const daemon = fakeDaemon({ dataDir: tmp('od-data-'), unreachable: true });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', token: SECRET, target: fsTarget(tmp('od-data-')), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_DAEMON_UNREACHABLE');
    expect(result.message).toContain('TypeError');
    expect(result.message).not.toContain('ECONNREFUSED');
    expect(result.remediation).toMatch(/10-30 s/);
  });

  it('REFUSES before any request when the system id differs from the manifest id', async () => {
    const { resolvedDir } = renderedResolved();
    const daemon = fakeDaemon({ dataDir: tmp('od-data-') });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', systemId: 'other', target: fsTarget(tmp('od-data-')), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_MANIFEST_ID_MISMATCH');
    expect(daemon.calls).toHaveLength(0);
  });

  it('REFUSES when the daemon names the system differently (the id is the slug of the title)', async () => {
    const { resolvedDir } = renderedResolved();
    const daemon = fakeDaemon({ dataDir: tmp('od-data-'), respondId: 'user:gestuor-2' });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: fsTarget(tmp('od-data-')), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_ID_MISMATCH');
    expect(result.createdId).toBe('user:gestuor-2');
  });

  it('REFUSES with OD_REGISTER_MANIFEST_DIVERGED when the daemon parsed another contract hash', async () => {
    const { resolvedDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir, manifestSha: 'f'.repeat(64) });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', target: fsTarget(dataDir), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_MANIFEST_DIVERGED');
    expect(result.rolledBackToDraft).toBe(true);
  });

  it('REFUSES to send the daemon token to a non-loopback host unless --allow-remote', async () => {
    const { resolvedDir } = renderedResolved();
    const daemon = fakeDaemon({ dataDir: tmp('od-data-') });
    const result = await registerDesignSystem({ resolvedDir, daemonUrl: 'https://daemon.example.com', token: SECRET, target: fsTarget(tmp('od-data-')), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_INSECURE_TARGET');
    expect(daemon.calls).toHaveLength(0);
  });

  it('REFUSES an implicit daemon URL, a missing target and an incomplete resolved/', async () => {
    const { resolvedDir } = renderedResolved();
    const daemon = fakeDaemon({ dataDir: tmp('od-data-') });
    expect((await registerDesignSystem({ resolvedDir, target: fsTarget(tmp('od-data-')), fetchFn: daemon.fetchFn })).reasonCode).toBe('OD_REGISTER_INPUT_INVALID');
    expect((await registerDesignSystem({ resolvedDir, daemonUrl: 'http://127.0.0.1:7466', fetchFn: daemon.fetchFn })).reasonCode).toBe('OD_REGISTER_NO_TARGET');
    const empty = tmp('od-register-empty-');
    const result = await registerDesignSystem({ resolvedDir: empty, daemonUrl: 'http://127.0.0.1:7466', target: fsTarget(tmp('od-data-')), fetchFn: daemon.fetchFn });
    expect(result.reasonCode).toBe('OD_REGISTER_INPUT_INVALID');
    expect(daemon.calls).toHaveLength(0);
  });

  it('uses only stable, documented reason codes', () => {
    for (const code of Object.values(REGISTER_REASON)) expect(code).toMatch(/^OD_REGISTER_[A-Z_]+$/);
  });
});

describe('registerCommand - user acceptance and the host data dir', () => {
  it('needs the user\'s acceptance (--accepted) and does nothing without it', async () => {
    const { systemDir } = renderedResolved();
    const daemon = fakeDaemon({ dataDir: tmp('od-data-') });
    const result = await registerCommand({ dir: systemDir, daemonUrl: 'http://127.0.0.1:7466', dataDir: tmp('od-data-'), token: null, fetchFn: daemon.fetchFn });
    expect(result.status).toBe('REFUSED');
    expect(result.reasonCode).toBe('OD_REGISTER_CONSENT_REQUIRED');
    expect(result.remediation).toContain(REGISTER_CONSENT_HEADER);
    expect(daemon.calls).toHaveLength(0);
  });

  it('registers with the directory name as the system id when accepted', async () => {
    const { systemDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir });
    const result = await registerCommand({ dir: systemDir, daemonUrl: 'http://127.0.0.1:7466', dataDir, accepted: true, token: null, fetchFn: daemon.fetchFn });
    expect(result.status).toBe('ok');
    expect(result.systemId).toBe('gestuor');
  });

  it('defaults the data dir to the host daemon clone (~/.open-design/.od) and OD_DATA_DIR overrides it', () => {
    expect(defaultDataDir({ env: {}, home: join('h', 'me') })).toBe(join(process.cwd(), 'h', 'me', '.open-design', '.od'));
    expect(defaultDataDir({ env: { OD_DATA_DIR: join('x', 'data') }, home: 'h' })).toBe(join(process.cwd(), 'x', 'data'));
  });

  it('without --data-dir it registers into the host daemon data dir and never gets a run', async () => {
    const { systemDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const daemon = fakeDaemon({ dataDir });
    const result = await registerCommand({ dir: systemDir, daemonUrl: 'http://127.0.0.1:7456', accepted: true, token: null, fetchFn: daemon.fetchFn, env: { OD_DATA_DIR: dataDir } });
    expect(result.status).toBe('ok');
    expect(result.daemonWhere).toBe('host');
    expect(existsSync(join(dataDir, 'design-systems', 'gestuor', 'tokens.css'))).toBe(true);
    expect(startedRun(daemon.calls)).toBe(false);
  });

  it('talks to the loopback IP even when given localhost (the daemon answers 403 to fetch on localhost)', async () => {
    const { systemDir } = renderedResolved();
    const dataDir = tmp('od-data-');
    const urls = [];
    const daemon = fakeDaemon({ dataDir });
    const fetchFn = (url, init) => { urls.push(String(url)); return daemon.fetchFn(url, init); };
    const result = await registerCommand({ dir: systemDir, daemonUrl: 'http://localhost:7456', dataDir, accepted: true, token: null, fetchFn });
    expect(result.status).toBe('ok');
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('http://127.0.0.1:7456/'))).toBe(true);
  });

  it('fsTarget refuses a path escape and writes nested preview files', () => {
    const dataDir = tmp('od-data-');
    mkdirSync(join(dataDir, 'design-systems', 'x'), { recursive: true });
    const target = fsTarget(dataDir);
    expect(() => target.commit('x', new Map([['../evil', Buffer.from('a')]]))).toThrow(/unsafe path/);
    target.commit('x', new Map([['preview/a/b.html', Buffer.from('ok')]]));
    expect(statSync(join(dataDir, 'design-systems', 'x', 'preview', 'a')).isDirectory()).toBe(true);
    expect(readdirSync(join(dataDir, 'design-systems', 'x', 'preview', 'a'))).toEqual(['b.html']);
  });
});

describe('state', () => {
  it('starts with no registrations', () => {
    expect(initState().designRegistrations).toEqual({});
  });
});
