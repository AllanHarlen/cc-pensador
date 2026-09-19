import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectOpenDesign } from '../scripts/lib/open-design-preflight.mjs';

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

describe('Open Design REST preflight', () => {
  it('accepts an authenticated daemon without CLI/MCP and never leaks its token', async () => {
    const secret = 'sentinel-never-log';
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { OD_DAEMON_URL: await endpoint(200, secret), OD_API_TOKEN: secret } });
    expect(result).toMatchObject({ detected: true, available: true, source: 'daemon-rest', reasonCode: null, mcpFunctional: false, daemon: { authenticated: true, authSource: 'environment' } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('classifies 401 as AUTH_REQUIRED without suggesting reinstall', async () => {
    const result = await detectOpenDesign({ home: isolatedHome(), timeoutMs: 5000, cliCheck: { ok: false }, env: { OD_DAEMON_URL: await endpoint(401) } });
    expect(result.detected).toBe(true);
    expect(result.available).toBe(false);
    expect(result.reasonCode).toBe('AUTH_REQUIRED');
    expect(result.fallbackBehavior).toMatch(/do not reinstall/i);
  });
});
