import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { APPROVAL_KEY_DIR_ENV, APPROVAL_KEY_FILE, approvalKeyPath, buildApprovalRecord, loadApprovalKey, verifyApprovalRecord } from '../scripts/lib/design-approval.mjs';

const dirs = [];
const freshEnv = () => {
  const dir = mkdtempSync(join(tmpdir(), 'approval-key-'));
  dirs.push(dir);
  return { [APPROVAL_KEY_DIR_ENV]: join(dir, 'nested') };
};
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const brief = { schemaVersion: 1, fields: {}, approvedAt: '2026-09-19T12:00:00.000Z', approvedSha256: 'c'.repeat(64) };
const sign = (key, over = {}) => buildApprovalRecord({ key, systemId: 'sys', brief, contractSha256: 'c'.repeat(64), approvedAt: brief.approvedAt, ...over });
const check = (record, key, over = {}) => verifyApprovalRecord(record, { brief, contractSha256: 'c'.repeat(64), systemId: 'sys', key, ...over });

describe('approval key', () => {
  it('is never created by a read, only by create:true, and lives outside the workspace env dir', () => {
    const env = freshEnv();
    expect(loadApprovalKey({ env })).toBeNull();
    const key = loadApprovalKey({ create: true, env });
    expect(key).toHaveLength(32);
    expect(approvalKeyPath(env).endsWith(APPROVAL_KEY_FILE)).toBe(true);
    expect(loadApprovalKey({ env }).equals(key)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(approvalKeyPath(env)).mode & 0o777).toBe(0o600);
  });

  it('a malformed key file is treated as missing, not as a weaker key', () => {
    const env = freshEnv();
    loadApprovalKey({ create: true, env });
    writeFileSync(approvalKeyPath(env), 'not-a-key');
    expect(loadApprovalKey({ env })).toBeNull();
  });

  it('the record carries no secret: key bytes appear nowhere in it', () => {
    const key = loadApprovalKey({ create: true, env: freshEnv() });
    const text = JSON.stringify(sign(key));
    expect(text).not.toContain(key.toString('hex'));
    expect(text).not.toContain('nonce');
  });

  it('accepts a valid signature and rejects: other key, missing key, changed field', () => {
    const key = loadApprovalKey({ create: true, env: freshEnv() });
    const record = sign(key);
    expect(check(record, key).ok).toBe(true);
    expect(check(record, Buffer.alloc(32, 1)).code).toBe('DESIGN_APPROVAL_FORGED');
    expect(check(record, null).code).toBe('DESIGN_APPROVAL_KEY_MISSING');
    expect(check({ ...record, approvedAt: '2030-01-01T00:00:00.000Z' }, key).code).toBe('DESIGN_APPROVAL_FORGED');
    expect(check({ ...record, systemId: 'other' }, key).code).toBe('DESIGN_APPROVAL_FORGED');
    expect(check({ ...record, unverified: true }, key).code).toBe('DESIGN_APPROVAL_FORGED');
  });

  it('brief or contract changed after the approval are stale even with a valid signature', () => {
    const key = loadApprovalKey({ create: true, env: freshEnv() });
    const record = sign(key);
    expect(check(record, key, { brief: { ...brief, fields: { x: 1 } } }).code).toBe('DESIGN_APPROVAL_STALE');
    expect(check(record, key, { contractSha256: 'd'.repeat(64) }).code).toBe('DESIGN_APPROVAL_STALE');
  });
});
