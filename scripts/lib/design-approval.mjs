/**
 * Approval record of the DESIGN stage. `design-brief.mjs approve` writes it next to the brief
 * (`<featurePath>/.pensador-approval.json`); the stage gate re-verifies it. It signs, with an
 * HMAC-SHA256 key that lives in the user's profile (never in the workspace), the design system id,
 * the contract hash, the brief content hash (without the approval fields) and the approval time —
 * so a hand-typed `approvedAt`/`approvedSha256`, or a brief edited after the approval, does not
 * reproduce a valid signature. The PreToolUse guard blocks direct writes to both files and any
 * access to the key; the signature is the backstop that does not depend on how the write happened.
 *
 * Residual limit: whoever can run arbitrary code as the same OS user can read the key and sign.
 * The guard closes the tool paths (Read/Grep/Edit/Write/Bash naming the key), not a determined
 * local attacker.
 *
 * The approval question is identified by its `header` (AskUserQuestion, <= 12 chars), which the
 * PostToolUse hook copies to the question log.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from './token-mapper.mjs';

export const APPROVAL_FILE = '.pensador-approval.json';
export const DESIGN_BRIEF_FILE = 'design-brief.json';
/** `header` of the AskUserQuestion that asks the user to approve the rendered preview/. */
export const DESIGN_APPROVAL_HEADER = 'AprovDesign';
/** Basename of the per-user signing key; the PreToolUse guard refuses every tool call that names it. */
export const APPROVAL_KEY_FILE = 'approval.key';
/** Overrides the key directory (tests, CI runners with a mounted secret). */
export const APPROVAL_KEY_DIR_ENV = 'PENSADOR_APPROVAL_KEY_DIR';

const APPROVAL_FIELDS = ['approvedAt', 'approvedSha256'];
const SHA256_HEX = /^[0-9a-f]{64}$/;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Per-user directory OUTSIDE any project workspace: %LOCALAPPDATA%/pensador on Windows, ~/.pensador elsewhere. */
export function approvalKeyDir(env = process.env) {
  if (env[APPROVAL_KEY_DIR_ENV]) return env[APPROVAL_KEY_DIR_ENV];
  if (process.platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'pensador');
  return join(homedir(), '.pensador');
}

export const approvalKeyPath = (env = process.env) => join(approvalKeyDir(env), APPROVAL_KEY_FILE);

/**
 * Reads the signing key (hex, 32 bytes). Returns null when it does not exist or is malformed: there
 * is no weaker fallback, the caller must fail with DESIGN_APPROVAL_KEY_MISSING. `create` is only
 * passed by `design-brief.mjs approve`, the one place allowed to mint a key (file 0600, dir 0700).
 * The key is never printed and never stored in state, handoff or the approval record.
 */
export function loadApprovalKey({ create = false, env = process.env } = {}) {
  const file = approvalKeyPath(env);
  try {
    if (existsSync(file)) {
      const hex = readFileSync(file, 'utf8').trim();
      return SHA256_HEX.test(hex) ? Buffer.from(hex, 'hex') : null;
    }
  } catch {
    return null;
  }
  if (!create) return null;
  const key = randomBytes(32);
  mkdirSync(approvalKeyDir(env), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows: the per-user profile ACL is the protection */
  }
  return key;
}

/** Hash of the brief WITHOUT its approval fields: any content edit after the approval changes it. */
export function briefContentSha256(brief) {
  const rest = Object.fromEntries(Object.entries(brief ?? {}).filter(([key]) => !APPROVAL_FIELDS.includes(key)));
  return sha256(canonicalJson(rest));
}

/** HMAC-SHA256 over system id + contract hash + brief hash + approval time (+ the unverified flag). */
export function approvalProof({ key, systemId, contractSha256, briefSha256, approvedAt, unverified = false }) {
  const message = ['pensador-design-approval/v2', systemId, contractSha256, briefSha256, approvedAt, unverified ? 'unverified' : 'verified'].join('|');
  return createHmac('sha256', key).update(message).digest('hex');
}

/** @returns the record the CLI persists: no secret inside, only the signature the key makes. */
export function buildApprovalRecord({ key, systemId, brief, contractSha256, approvedAt, unverified = false }) {
  if (!Buffer.isBuffer(key) || key.length < 32) throw new Error('buildApprovalRecord needs the per-user approval key');
  const briefSha256 = briefContentSha256(brief);
  return {
    schemaVersion: 2,
    approvedAt,
    systemId,
    contractSha256,
    briefSha256,
    ...(unverified ? { unverified: true } : {}),
    proof: approvalProof({ key, systemId, contractSha256, briefSha256, approvedAt, unverified }),
  };
}

const safeEqualHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks the record against the brief and the contract on disk.
 * @param {{ brief: object, contractSha256: string, systemId?: string, key?: Buffer|null }} ctx
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
export function verifyApprovalRecord(record, { brief, contractSha256, systemId, key }) {
  const bad = (code, message) => ({ ok: false, code, message });
  if (record === null || typeof record !== 'object') {
    return bad('DESIGN_APPROVAL_UNSIGNED', `${APPROVAL_FILE} is missing: the approval must be recorded by design-brief.mjs approve, not typed into ${DESIGN_BRIEF_FILE}`);
  }
  if (record.schemaVersion !== 2 || !SHA256_HEX.test(record.contractSha256 ?? '') || !SHA256_HEX.test(record.briefSha256 ?? '') || typeof record.approvedAt !== 'string' || typeof record.systemId !== 'string' || !SHA256_HEX.test(record.proof ?? '')) {
    return bad('DESIGN_APPROVAL_FORGED', `${APPROVAL_FILE} is malformed or in the old nonce format; approve the current preview again with design-brief.mjs approve`);
  }
  if (!Buffer.isBuffer(key)) {
    return bad('DESIGN_APPROVAL_KEY_MISSING', `the per-user approval key (${APPROVAL_KEY_FILE}) is not available on this machine, so the signature of ${APPROVAL_FILE} cannot be verified. Nothing weaker is accepted: approve the preview again here with design-brief.mjs approve, which signs it with this machine's key`);
  }
  const expected = approvalProof({ key, systemId: record.systemId, contractSha256: record.contractSha256, briefSha256: record.briefSha256, approvedAt: record.approvedAt, unverified: record.unverified === true });
  if (!safeEqualHex(record.proof, expected)) return bad('DESIGN_APPROVAL_FORGED', `${APPROVAL_FILE} does not carry a valid signature (it was not produced by design-brief.mjs approve with this user's key)`);
  if (systemId !== undefined && record.systemId !== systemId) return bad('DESIGN_APPROVAL_STALE', `the approval was signed for design system "${record.systemId}", not "${systemId}"; approve it again`);
  if (record.contractSha256 !== contractSha256) return bad('DESIGN_APPROVAL_STALE', `the approval was recorded for another design-contract.json (${record.contractSha256}); approve the current preview again`);
  if (brief?.approvedAt !== record.approvedAt || brief?.approvedSha256 !== record.contractSha256) {
    return bad('DESIGN_APPROVAL_FORGED', `${DESIGN_BRIEF_FILE} approvedAt/approvedSha256 do not match ${APPROVAL_FILE}`);
  }
  if (record.briefSha256 !== briefContentSha256(brief)) {
    return bad('DESIGN_APPROVAL_STALE', `${DESIGN_BRIEF_FILE} was changed after the approval; use design-brief.mjs adjust and approve again`);
  }
  return { ok: true };
}

/** How many logged AskUserQuestion entries in `stage` carried the approval header. */
export function approvalQuestionsIn(logText, stage) {
  let total = 0;
  for (const line of (logText ?? '').split(/\r?\n/)) {
    try {
      const entry = JSON.parse(line);
      if (entry.stage === stage && Array.isArray(entry.headers) && entry.headers.includes(DESIGN_APPROVAL_HEADER)) total += 1;
    } catch {
      /* blank or partial line */
    }
  }
  return total;
}
