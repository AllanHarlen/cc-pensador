import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectOpenDesign, odApiToken, odCloneDir } from '../scripts/lib/open-design-preflight.mjs';

const cleanup = [];
afterEach(async () => {
  for (const item of cleanup.splice(0)) await item();
});

async function endpoint(status, expectedToken = null) {
  const server = createServer((request, response) => {
    const authorized = expectedToken == null || request.headers.authorization === `Bearer ${expectedToken}`;
    response.writeHead(authorized ? status : 401, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function isolatedHome() {
  const path = mkdtempSync(join(tmpdir(), 'od-home-'));
  cleanup.push(async () => rmSync(path, { recursive: true, force: true }));
  return path;
}

// The developer's real daemon may be listening on 7456 and docker may exist: isolate both.
const ISOLATED = { OD_PREFLIGHT_DISABLE_DEFAULT_URL: '1', OD_PREFLIGHT_DISABLE_DOCKER: '1' };
const noContainer = () => ({ detected: false, healthy: false, publishedPort: null, container: null });
const portOf = (url) => Number(new URL(url).port);

describe('Open Design REST preflight', () => {
  it('accepts an authenticated daemon without CLI/MCP and never leaks its token', async () => {
    const secret = 'sentinel-never-log';
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: await endpoint(200, secret), OD_API_TOKEN: secret } });
    expect(result).toMatchObject({ detected: true, available: true, source: 'daemon-rest', reasonCode: null, mcpFunctional: false, daemon: { authenticated: true, authSource: 'environment', where: 'host' } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('classifies 401 as AUTH_REQUIRED without suggesting reinstall', async () => {
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: await endpoint(401) } });
    expect(result.detected).toBe(true);
    expect(result.available).toBe(false);
    expect(result.reasonCode).toBe('AUTH_REQUIRED');
    expect(result.fallbackBehavior).toMatch(/do not reinstall/i);
  });

  it('needs no token for the loopback host daemon (auth is only on when OD_API_TOKEN is set for it)', async () => {
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: await endpoint(200) } });
    expect(result).toMatchObject({ available: true, reasonCode: null, daemon: { authenticated: true, authSource: null, where: 'host' }, portConflict: null });
  });

  it('reads the token from <clone>/.env (the host clone), not from the Docker deploy/.env', async () => {
    const secret = 'clone-env-token';
    const home = isolatedHome();
    mkdirSync(join(home, '.open-design', 'deploy'), { recursive: true });
    writeFileSync(join(home, '.open-design', '.env'), `OD_API_TOKEN=${secret}\n`);
    writeFileSync(join(home, '.open-design', 'deploy', '.env'), 'OD_API_TOKEN=stale-docker-token\n');
    expect(odApiToken({ env: {}, home })).toBe(secret);
    const result = await detectOpenDesign({ home, timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: await endpoint(200, secret) } });
    expect(result).toMatchObject({ available: true, daemon: { authenticated: true, authSource: 'open-design-env-file' } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('ignores the old Docker deploy/.env token and lets OD_CLONE_DIR relocate the clone', () => {
    const home = isolatedHome();
    mkdirSync(join(home, '.open-design', 'deploy'), { recursive: true });
    writeFileSync(join(home, '.open-design', 'deploy', '.env'), 'OD_API_TOKEN=stale-docker-token\n');
    expect(odApiToken({ env: {}, home })).toBeNull();
    const clone = isolatedHome();
    writeFileSync(join(clone, '.env'), 'OD_API_TOKEN=relocated\n');
    expect(odCloneDir({ env: { OD_CLONE_DIR: clone }, home })).toBe(clone);
    expect(odApiToken({ env: { OD_CLONE_DIR: clone }, home })).toBe('relocated');
  });

  it('talks to 127.0.0.1 when the configured daemon URL says localhost (localhost is the 403 powered-preview origin)', async () => {
    const url = await endpoint(200);
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: url.replace('127.0.0.1', 'localhost') } });
    expect(result.daemon.url).toBe(url);
    expect(result.available).toBe(true);
  });
});

describe('Open Design port-conflict guard (leftover Docker container)', () => {
  it('refuses a daemon answered by a leftover container on the same port and says how to migrate', async () => {
    const url = await endpoint(200);
    const result = await detectOpenDesign({
      home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_PREFLIGHT_DISABLE_DOCKER: '0', OD_DAEMON_URL: url },
      containerProbe: () => ({ detected: true, healthy: true, publishedPort: portOf(url), container: 'open-design' }),
    });
    expect(result).toMatchObject({ detected: true, available: false, reasonCode: 'LEGACY_CONTAINER_DAEMON', source: null, daemon: { reachable: true, where: 'container' } });
    expect(result.artifactAccess).not.toContain('rest');
    expect(result.portConflict).toMatchObject({ container: 'open-design', port: portOf(url) });
    expect(result.portConflict.remediation.join(' ')).toContain('docker stop open-design');
    expect(result.portConflict.remediation.join(' ')).toContain('docker update --restart=no open-design');
    expect(result.portConflict.remediation.join(' ')).toContain('onboard-open-design-agents');
    expect(result.fallbackBehavior).toMatch(/do not reinstall the Docker image/i);
  });

  it('does not flag a container that publishes a different port than the daemon that answered', async () => {
    const url = await endpoint(200);
    const result = await detectOpenDesign({
      home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_PREFLIGHT_DISABLE_DOCKER: '0', OD_DAEMON_URL: url },
      containerProbe: () => ({ detected: true, healthy: true, publishedPort: portOf(url) + 1, container: 'open-design' }),
    });
    expect(result).toMatchObject({ available: true, reasonCode: null, portConflict: null, daemon: { where: 'host' } });
  });

  it('a stopped/unreachable daemon with a container present asks to start the host daemon, not to reinstall', async () => {
    const result = await detectOpenDesign({
      home: isolatedHome(), timeoutMs: 500, cliCheck: { ok: false }, env: { ...ISOLATED, OD_PREFLIGHT_DISABLE_DOCKER: '0', OD_DAEMON_URL: 'http://127.0.0.1:1' },
      containerProbe: () => ({ detected: true, healthy: false, publishedPort: null, container: 'open-design' }),
    });
    expect(result).toMatchObject({ detected: true, available: false, reasonCode: 'DETECTED_UNREACHABLE', portConflict: null });
    expect(result.fallbackBehavior).toMatch(/host daemon/i);
    expect(result.fallbackBehavior).toMatch(/do not reinstall/i);
  });

  it('does not probe Docker at all when OD_PREFLIGHT_DISABLE_DOCKER=1', async () => {
    const containerProbe = () => { throw new Error('docker must not be probed'); };
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: await endpoint(200) }, containerProbe });
    expect(result.available).toBe(true);
  });

  it('exposes no docker evidence under the old key', async () => {
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { ...ISOLATED, OD_DAEMON_URL: await endpoint(200) }, containerProbe: noContainer });
    expect(result.docker).toBeUndefined();
    expect(result.legacyContainer).toEqual({ detected: false, healthy: false, publishedPort: null, container: null });
  });
});
