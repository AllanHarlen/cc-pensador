/**
 * Tests for scripts/lib/stage-gate.mjs and the scripts/advance-stage.mjs CLI.
 *
 * Regression target: the OficinaAI run (2026-09-18) hand-edited the checkpoint from
 * INIT to DONE, skipping six stages, and shipped a handoff.json that failed
 * validate-handoff.mjs. Every case below is one way that shortcut — or a cheaper variant
 * of it (empty stub files, an unrecorded stage, a made-up record) — must now be refused.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import fc from 'fast-check';
import { STAGE_ORDER } from '../scripts/pensador-engine.mjs';
import { designEvidence } from './helpers/design-fixture.js';
import { APPROVAL_FILE, DESIGN_APPROVAL_HEADER, approvalProof, approvalQuestionsIn, buildApprovalRecord, loadApprovalKey } from '../scripts/lib/design-approval.mjs';
import { applyTransition, checkTransition, computeIntegrity, questionsAskedIn, recordRequired, sealCheckpoint } from '../scripts/lib/stage-gate.mjs';

const body = (n = 600) => `# doc\n${'conteudo real '.repeat(Math.ceil(n / 13))}`;

/** files: { relPath: text }. Directories are implied by the paths. */
const envWith = (files = {}, { handoffOk = true } = {}) => ({
  readText: (rel) => (Object.hasOwn(files, rel) ? files[rel] : null),
  list: (dir) => [...new Set(Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1).split('/')[0]))],
  validateHandoff: () => ({ ok: handoffOk, errors: handoffOk ? [] : [{ code: 'INVALID_STAGE' }] }),
});

const codes = (result) => result.errors.map((e) => e.code);
const ok = (extra) => ({ outcome: 'asked', questionsAsked: 2, questionsClosed: 2, ...extra });

describe('checkTransition — ordering', () => {
  it('refuses INIT -> DONE (the OficinaAI shortcut)', () => {
    const r = checkTransition({ checkpoint: { stage: 'INIT' }, to: 'DONE', env: envWith() });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('STAGE_SKIP');
  });

  it('property: any target other than the immediate next stage is refused as STAGE_SKIP', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: STAGE_ORDER.length - 1 }), fc.integer({ min: 0, max: STAGE_ORDER.length - 1 }), (i, j) => {
        fc.pre(j !== i + 1);
        const r = checkTransition({ checkpoint: { stage: STAGE_ORDER[i] }, to: STAGE_ORDER[j], env: envWith() });
        return r.ok === false && codes(r).includes('STAGE_SKIP');
      }),
    );
  });

  it('rejects unknown stages', () => {
    expect(codes(checkTransition({ checkpoint: { stage: 'NOPE' }, to: 'EXPLORE', env: envWith() }))).toContain('UNKNOWN_CURRENT_STAGE');
    expect(codes(checkTransition({ checkpoint: { stage: 'INIT' }, to: 'NOPE', env: envWith() }))).toContain('UNKNOWN_TARGET_STAGE');
  });

  it('allows INIT -> EXPLORE with no artifacts', () => {
    expect(checkTransition({ checkpoint: { stage: 'INIT' }, to: 'EXPLORE', env: envWith() }).ok).toBe(true);
  });
});

describe('checkTransition — artifacts need real content, not just existence', () => {
  it('EXPLORE needs a codebase-memory.md that is not a stub', () => {
    const cp = { stage: 'EXPLORE' };
    expect(codes(checkTransition({ checkpoint: cp, to: 'RESEARCH', env: envWith() }))).toContain('MISSING_ARTIFACT');
    expect(codes(checkTransition({ checkpoint: cp, to: 'RESEARCH', env: envWith({ 'codebase-memory.md': '# x' }) }))).toContain('ARTIFACT_TOO_SHORT');
    expect(checkTransition({ checkpoint: cp, to: 'RESEARCH', env: envWith({ 'codebase-memory.md': body(200) }) }).ok).toBe(true);
  });

  it('whitespace padding does not count as content', () => {
    const r = checkTransition({ checkpoint: { stage: 'EXPLORE' }, to: 'RESEARCH', env: envWith({ 'codebase-memory.md': ` ${'\n'.repeat(500)}x` }) });
    expect(codes(r)).toContain('ARTIFACT_TOO_SHORT');
  });

  it('RESEARCH needs both market and tech research', () => {
    const cp = { stage: 'RESEARCH' };
    expect(checkTransition({ checkpoint: cp, to: 'PRD_BASE', env: envWith({ 'market-research.md': body() }) }).ok).toBe(false);
    expect(checkTransition({ checkpoint: cp, to: 'PRD_BASE', env: envWith({ 'market-research.md': body(), 'tech-research.md': body() }) }).ok).toBe(true);
  });

  it('PRD_BASE needs a real prd.md in PRD mode but nothing in Spec mode', () => {
    expect(checkTransition({ checkpoint: { stage: 'PRD_BASE', artifactMode: 'prd' }, to: 'ARCH', env: envWith() }).ok).toBe(false);
    expect(codes(checkTransition({ checkpoint: { stage: 'PRD_BASE', artifactMode: 'prd' }, to: 'ARCH', env: envWith({ 'prd.md': body(300) }) }))).toContain('ARTIFACT_TOO_SHORT');
    expect(checkTransition({ checkpoint: { stage: 'PRD_BASE', artifactMode: 'prd' }, to: 'ARCH', env: envWith({ 'prd.md': body(2000) }) }).ok).toBe(true);
    expect(checkTransition({ checkpoint: { stage: 'PRD_BASE', artifactMode: 'spec' }, to: 'ARCH', env: envWith() }).ok).toBe(true);
  });

  it('ARCH needs architecture.md', () => {
    expect(checkTransition({ checkpoint: { stage: 'ARCH' }, to: 'EXPAND', env: envWith() }).ok).toBe(false);
  });

  it('BRAINSTORM_GERAL needs a shared-agents response with content', () => {
    const cp = { stage: 'BRAINSTORM_GERAL' };
    const record = ok({ hasFrontend: true, hasBackend: true });
    expect(checkTransition({ checkpoint: cp, to: 'CODEX', record, env: envWith() }).ok).toBe(false);
    expect(checkTransition({ checkpoint: cp, to: 'CODEX', record, env: envWith({ 'shared-agents/agent.response.md': 'vazio' }) }).ok).toBe(false);
    expect(checkTransition({ checkpoint: cp, to: 'CODEX', record, env: envWith({ 'shared-agents/agent.response.md': body() }) }).ok).toBe(true);
  });

  it('pending questions in the checkpoint block the advance', () => {
    const cp = { stage: 'EXPAND', questions: [{ id: 'q1', stage: 'EXPAND', answer: null }] };
    expect(codes(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record: ok(), env: envWith() }))).toContain('PENDING_QUESTIONS');
  });
});

describe('checkTransition — stage records (EXPAND, COMPLEXITY, BRAINSTORM_GERAL, CODEX, AGY)', () => {
  it('EXPAND without a record is refused; with asked questions it passes', () => {
    const cp = { stage: 'EXPAND' };
    expect(codes(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', env: envWith() }))).toContain('RECORD_REQUIRED');
    expect(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record: ok(), env: envWith() }).ok).toBe(true);
  });

  it('a record cannot claim "asked" with zero questions, nor leave questions open', () => {
    const cp = { stage: 'EXPAND' };
    expect(codes(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record: ok({ questionsAsked: 0, questionsClosed: 0 }), env: envWith() }))).toContain('RECORD_INVALID');
    expect(codes(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record: ok({ questionsAsked: 3, questionsClosed: 1 }), env: envWith() }))).toContain('PENDING_QUESTIONS');
  });

  it('asking nothing needs a written justification', () => {
    const cp = { stage: 'EXPAND' };
    expect(codes(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record: { outcome: 'none' }, env: envWith() }))).toContain('RECORD_NOTE_REQUIRED');
    const note = 'PRD ja cobre os fluxos; nenhum candidato novo relevante';
    expect(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record: { outcome: 'none', note }, env: envWith() }).ok).toBe(true);
  });

  it('rejects an outcome the stage does not allow', () => {
    expect(codes(checkTransition({ checkpoint: { stage: 'COMPLEXITY' }, to: 'BRAINSTORM_GERAL', record: { outcome: 'skipped', note: 'x'.repeat(30) }, env: envWith() }))).toContain('RECORD_INVALID');
  });

  it('COMPLEXITY needs the mode the user confirmed', () => {
    const cp = { stage: 'COMPLEXITY' };
    expect(codes(checkTransition({ checkpoint: cp, to: 'BRAINSTORM_GERAL', record: ok(), env: envWith() }))).toContain('RECORD_INVALID');
    expect(checkTransition({ checkpoint: cp, to: 'BRAINSTORM_GERAL', record: ok({ complexityMode: 'completo' }), env: envWith() }).ok).toBe(true);
  });

  it('BRAINSTORM_GERAL must record the scope flags as booleans', () => {
    const cp = { stage: 'BRAINSTORM_GERAL' };
    const files = envWith({ 'shared-agents/agent.response.md': body() });
    expect(codes(checkTransition({ checkpoint: cp, to: 'CODEX', record: ok(), env: files }))).toContain('RECORD_INVALID');
    expect(checkTransition({ checkpoint: cp, to: 'CODEX', record: ok({ hasFrontend: true, hasBackend: false }), env: files }).ok).toBe(true);
  });

  it('CODEX "asked" needs the subagent answer on disk; "skipped" only for front-end-only work', () => {
    const cp = { stage: 'CODEX', hasFrontend: true, hasBackend: true };
    expect(codes(checkTransition({ checkpoint: cp, to: 'AGY', record: ok(), env: envWith() }))).toContain('MISSING_ARTIFACT');
    expect(checkTransition({ checkpoint: cp, to: 'AGY', record: ok(), env: envWith({ 'shared-agents/codex.stage.response.md': body() }) }).ok).toBe(true);

    const skip = { outcome: 'skipped', note: 'atividade especifica de front-end: Codex nao participa' };
    expect(codes(checkTransition({ checkpoint: cp, to: 'AGY', record: skip, env: envWith() }))).toContain('RECORD_INVALID');
    expect(checkTransition({ checkpoint: { ...cp, hasBackend: false }, to: 'AGY', record: skip, env: envWith() }).ok).toBe(true);
  });

  it('AGY "fallback" needs only a note, no response file', () => {
    const fallback = { outcome: 'fallback', note: 'AGY indisponivel (quota); usuario aceitou seguir sem a varredura' };
    expect(checkTransition({ checkpoint: { stage: 'AGY' }, to: 'DESIGN', record: fallback, env: envWith() }).ok).toBe(true);
  });
});

describe('checkTransition — DESIGN', () => {
  const cp = { stage: 'DESIGN', hasFrontend: true };
  const withEvidence = (over) => envWith(designEvidence({ over }).files);
  const evidenceCodes = (over) => codes(checkTransition({ checkpoint: cp, to: 'FINAL', env: withEvidence(over) }));
  const auditPath = 'design-systems/professional/resolved/design-audit.json';
  const auditWith = (patch) => ({ ...JSON.parse(designEvidence().files[auditPath]), ...patch });

  it('with a front-end, requires the audit, conformance, integrity, engine run and the approval', () => {
    expect(codes(checkTransition({ checkpoint: cp, to: 'FINAL', env: envWith() }))).toContain('MISSING_ARTIFACT');
    expect(checkTransition({ checkpoint: cp, to: 'FINAL', env: withEvidence({}) }).ok).toBe(true);
  });

  it('a BLOCKED audit is refused', () => {
    expect(evidenceCodes({ [auditPath]: auditWith({ status: 'BLOCKED' }) })).toContain('DESIGN_AUDIT_NOT_PASS');
  });

  it.each(['structure', 'contrast', 'conformance', 'integrity', 'engineRun'])('refuses when checks.%s is not PASS (SKIPPED does not count)', (check) => {
    const checks = { structure: 'PASS', contrast: 'PASS', conformance: 'PASS', integrity: 'PASS', engineRun: 'PASS', [check]: 'SKIPPED' };
    expect(evidenceCodes({ [auditPath]: auditWith({ checks }) })).toContain('DESIGN_CHECK_NOT_PASS');
  });

  it('a hand-written {status: PASS} with no checks is refused', () => {
    expect(evidenceCodes({ [auditPath]: { status: 'PASS', findings: [] } })).toContain('DESIGN_CHECK_NOT_PASS');
  });

  it('refuses an audit made for another contract', () => {
    expect(evidenceCodes({ [auditPath]: auditWith({ contractSha256: 'f'.repeat(64) }) })).toContain('DESIGN_AUDIT_STALE');
  });

  it('requires source/engine-run.json, with status ok and the same contract', () => {
    const run = 'design-systems/professional/source/engine-run.json';
    expect(evidenceCodes({ [run]: null })).toContain('ENGINE_RUN_MISSING');
    expect(evidenceCodes({ [run]: { status: 'BLOCKED', reasonCode: 'OD_BRAND_ENGINE_UNAVAILABLE' } })).toContain('ENGINE_RUN_FAILED');
    expect(evidenceCodes({ [run]: { status: 'ok', contractSha256: 'e'.repeat(64) } })).toContain('ENGINE_RUN_CONTRACT_MISMATCH');
  });

  it('requires the design review (design-review.json) PASS for THIS contract', () => {
    const review = 'design-systems/professional/resolved/design-review.json';
    const current = JSON.parse(designEvidence().files[review]);
    expect(evidenceCodes({ [review]: null })).toContain('DESIGN_REVIEW_MISSING');
    expect(evidenceCodes({ [review]: { ...current, contractSha256: 'c'.repeat(64) } })).toContain('DESIGN_REVIEW_STALE');
    expect(evidenceCodes({ [review]: { ...current, verdict: 'FAIL', blockingFindings: 2 } })).toContain('DESIGN_REVIEW_NOT_PASS');
  });

  it('requires the visual approval of THIS contract in design-brief.json', () => {
    expect(evidenceCodes({ 'design-brief.json': null })).toContain('DESIGN_NOT_APPROVED');
    const brief = JSON.parse(designEvidence().files['design-brief.json']);
    expect(evidenceCodes({ 'design-brief.json': { ...brief, approvedAt: null, approvedSha256: null } })).toContain('DESIGN_NOT_APPROVED');
    expect(evidenceCodes({ 'design-brief.json': { ...brief, approvedSha256: 'd'.repeat(64) } })).toContain('DESIGN_NOT_APPROVED');
  });

  it('refuses an approval typed by hand: no record, forged proof, stale or edited brief', () => {
    const brief = JSON.parse(designEvidence().files['design-brief.json']);
    const record = JSON.parse(designEvidence().files[APPROVAL_FILE]);
    expect(evidenceCodes({ [APPROVAL_FILE]: null })).toContain('DESIGN_APPROVAL_UNSIGNED');
    expect(evidenceCodes({ [APPROVAL_FILE]: { ...record, proof: 'f'.repeat(64) } })).toContain('DESIGN_APPROVAL_FORGED');
    // the old nonce format (sha256 over a nonce that lived in the workspace) is not accepted any more
    const { proof: _p, systemId: _s, ...legacy } = record;
    expect(evidenceCodes({ [APPROVAL_FILE]: { ...legacy, schemaVersion: 1, nonce: 'b'.repeat(32), proof: 'a'.repeat(64) } })).toContain('DESIGN_APPROVAL_FORGED');
    // a proof recomputed without the user's key (anyone who read the workspace) is forged
    expect(evidenceCodes({ [APPROVAL_FILE]: { ...record, proof: approvalProof({ key: Buffer.alloc(32, 7), systemId: record.systemId, contractSha256: record.contractSha256, briefSha256: record.briefSha256, approvedAt: record.approvedAt }) } })).toContain('DESIGN_APPROVAL_FORGED');
    // signed for another design system
    expect(evidenceCodes({ [APPROVAL_FILE]: buildApprovalRecord({ key: loadApprovalKey({ create: true }), systemId: 'other', brief, contractSha256: record.contractSha256, approvedAt: record.approvedAt }) })).toContain('DESIGN_APPROVAL_STALE');
    // a brief edited after the approval keeps the approval fields but not the content hash
    const edited = { ...brief, fields: { ...brief.fields, borderRadius: { ...brief.fields.borderRadius, value: 2 } } };
    expect(evidenceCodes({ 'design-brief.json': edited })).toContain('DESIGN_APPROVAL_STALE');
    // approvedAt typed to another instant no longer matches the signed record
    expect(evidenceCodes({ 'design-brief.json': { ...brief, approvedAt: '2030-01-01T00:00:00.000Z' } })).toContain('DESIGN_APPROVAL_FORGED');
    // a record signed for another contract is stale even though its own proof is valid
    const other = designEvidence({ over: {} }).files;
    expect(codes(checkTransition({ checkpoint: cp, to: 'FINAL', env: envWith(other) }))).not.toContain('DESIGN_APPROVAL_FORGED');
  });

  it('without the per-user key (another machine, CI) the gate fails with DESIGN_APPROVAL_KEY_MISSING instead of a weaker check', () => {
    const env = { ...withEvidence({}), approvalKey: () => null };
    const result = checkTransition({ checkpoint: cp, to: 'FINAL', env });
    expect(codes(result)).toContain('DESIGN_APPROVAL_KEY_MISSING');
    expect(result.errors.find((e) => e.code === 'DESIGN_APPROVAL_KEY_MISSING').message).toContain('design-brief.mjs approve');
    // the key of another user cannot verify it either
    expect(codes(checkTransition({ checkpoint: cp, to: 'FINAL', env: { ...withEvidence({}), approvalKey: () => Buffer.alloc(32, 9) } }))).toContain('DESIGN_APPROVAL_FORGED');
    expect(checkTransition({ checkpoint: cp, to: 'FINAL', env: { ...withEvidence({}), approvalKey: () => loadApprovalKey() } }).ok).toBe(true);
  });

  it('in strict mode, only a logged approval question (header) counts; --unverified is an explicit escape', () => {
    const sealed = applyTransition({ stage: 'AGY', hasFrontend: true }, 'DESIGN');
    const files = designEvidence().files;
    const otherQuestion = envWith({ ...files, '.pensador-questions.jsonl': JSON.stringify({ stage: 'DESIGN', count: 1, headers: ['Paleta'] }) });
    expect(codes(checkTransition({ checkpoint: sealed, to: 'FINAL', env: otherQuestion, strict: true }))).toContain('DESIGN_APPROVAL_NOT_OBSERVED');
    const approval = envWith({ ...files, '.pensador-questions.jsonl': JSON.stringify({ stage: 'DESIGN', count: 1, headers: [DESIGN_APPROVAL_HEADER] }) });
    expect(codes(checkTransition({ checkpoint: sealed, to: 'FINAL', env: approval, strict: true }))).not.toContain('DESIGN_APPROVAL_NOT_OBSERVED');
    const unverified = envWith({ ...files, [APPROVAL_FILE]: { ...JSON.parse(files[APPROVAL_FILE]), unverified: true } });
    // the record was re-signed by nobody: changing it breaks the proof instead of unlocking the gate
    expect(codes(checkTransition({ checkpoint: sealed, to: 'FINAL', env: unverified, strict: true }))).toContain('DESIGN_APPROVAL_NOT_OBSERVED');
    expect(approvalQuestionsIn(null, 'DESIGN')).toBe(0);
  });

  it('in strict mode, the AskUserQuestion hook must have logged the approval question in DESIGN', () => {
    const sealed = applyTransition({ stage: 'AGY', hasFrontend: true }, 'DESIGN');
    const files = designEvidence().files;
    const noQuestion = checkTransition({ checkpoint: sealed, to: 'FINAL', env: envWith(files), strict: true });
    expect(codes(noQuestion)).toContain('DESIGN_APPROVAL_NOT_OBSERVED');
    const logged = envWith({ ...files, '.pensador-questions.jsonl': JSON.stringify({ stage: 'DESIGN', count: 1, headers: [DESIGN_APPROVAL_HEADER] }) });
    expect(codes(checkTransition({ checkpoint: sealed, to: 'FINAL', env: logged, strict: true }))).not.toContain('DESIGN_APPROVAL_NOT_OBSERVED');
  });

  it('without a front-end, must be explicitly recorded as skipped', () => {
    const noFront = { stage: 'DESIGN', hasFrontend: false };
    expect(codes(checkTransition({ checkpoint: noFront, to: 'FINAL', env: envWith() }))).toContain('RECORD_REQUIRED');
    expect(checkTransition({ checkpoint: noFront, to: 'FINAL', record: { outcome: 'skipped', note: 'demanda sem front-end: nada a desenhar' }, env: envWith() }).ok).toBe(true);
    expect(recordRequired('DESIGN', { hasFrontend: true })).toBe(false);
  });
});

describe('checkTransition — FINAL -> DONE', () => {
  const visited = (extra = {}) => STAGE_ORDER.slice(0, -1).map((stage) => ({ stage, ...extra }));
  const records = Object.fromEntries(['EXPAND', 'COMPLEXITY', 'BRAINSTORM_GERAL', 'CODEX', 'AGY'].map((s) => [s, ok()]));
  const finalCp = (over = {}) => ({ stage: 'FINAL', artifactMode: 'prd', hasFrontend: false, hasBackend: true, stageHistory: visited(), stageRecords: { ...records, DESIGN: ok() }, ...over });
  const handoff = (artifacts = []) => JSON.stringify({ artifacts });
  const goodFiles = (over = {}) => ({
    'project-baseline.json': '{"isGreenfield":true}',
    'requirements.json': '{"requirements":[1]}',
    'seed-plan.json': '{"entities":[1]}',
    'handoff.json': handoff([{ role: 'prd', path: 'prd.md', required: true }]),
    'prd.md': body(),
    ...over,
  });

  it('refuses without a full stageHistory', () => {
    const cp = finalCp({ stageHistory: [{ stage: 'INIT' }, { stage: 'EXPLORE' }] });
    expect(codes(checkTransition({ checkpoint: cp, to: 'DONE', env: envWith(goodFiles()) }))).toContain('STAGES_NOT_VISITED');
  });

  it('refuses when a stage was visited but never recorded', () => {
    const cp = finalCp({ stageRecords: { EXPAND: ok() } });
    expect(codes(checkTransition({ checkpoint: cp, to: 'DONE', env: envWith(goodFiles()) }))).toContain('RECORD_MISSING');
  });

  it('refuses a missing handoff.json or one the validator rejects', () => {
    const { 'handoff.json': _drop, ...rest } = goodFiles();
    expect(codes(checkTransition({ checkpoint: finalCp(), to: 'DONE', env: envWith(rest) }))).toContain('MISSING_HANDOFF');
    expect(codes(checkTransition({ checkpoint: finalCp(), to: 'DONE', env: envWith(goodFiles(), { handoffOk: false }) }))).toContain('HANDOFF_INVALID');
  });

  it('refuses a handoff that declares a required artifact that is missing or empty', () => {
    const missing = goodFiles({ 'handoff.json': handoff([{ role: 'prd', path: 'prd.md', required: true }, { role: 'api-contract', path: 'openapi.yaml', required: true }]) });
    expect(codes(checkTransition({ checkpoint: finalCp(), to: 'DONE', env: envWith(missing) }))).toContain('HANDOFF_ARTIFACT_MISSING');
    const empty = goodFiles({ 'openapi.yaml': ' ', 'handoff.json': handoff([{ role: 'api-contract', path: 'openapi.yaml', required: true }]) });
    expect(codes(checkTransition({ checkpoint: finalCp(), to: 'DONE', env: envWith(empty) }))).toContain('HANDOFF_ARTIFACT_EMPTY');
  });

  it('accepts a directory artifact that has files, and ignores required:false', () => {
    const files = goodFiles({
      'shared-agents/agent.response.md': body(),
      'handoff.json': handoff([{ role: 'shared-agents', path: 'shared-agents/', required: true }, { role: 'x', path: 'nope.md', required: false }]),
    });
    expect(checkTransition({ checkpoint: finalCp(), to: 'DONE', env: envWith(files) }).ok).toBe(true);
  });

  it('requires the FINAL artifacts implied by the scope: baseline, requirements, ui-data-map, seed-plan', () => {
    const cp = finalCp({ hasFrontend: true, stageRecords: records });
    const files = goodFiles();
    delete files['project-baseline.json'];
    delete files['seed-plan.json'];
    const r2 = checkTransition({ checkpoint: cp, to: 'DONE', env: envWith(files) });
    const missing = r2.errors.filter((e) => e.code === 'MISSING_ARTIFACT').map((e) => e.message);
    expect(missing.some((m) => m.includes('project-baseline.json'))).toBe(true);
    expect(missing.some((m) => m.includes('ui-data-map.json'))).toBe(true);
    expect(missing.some((m) => m.includes('seed-plan.json'))).toBe(true);
  });

  it('accepts a complete run', () => {
    expect(checkTransition({ checkpoint: finalCp(), to: 'DONE', env: envWith(goodFiles()) })).toMatchObject({ ok: true });
  });
});

describe('applyTransition', () => {
  it('records the visit and moves the stage', () => {
    const next = applyTransition({ stage: 'INIT', stageHistory: [{ stage: 'INIT' }] }, 'EXPLORE', { now: 'T' });
    expect(next.stage).toBe('EXPLORE');
    expect(next.stageHistory.map((h) => h.stage)).toEqual(['INIT', 'EXPLORE']);
  });

  it('stores the record under the stage LEFT and lifts the scope flags', () => {
    const record = ok({ hasFrontend: true, hasBackend: false, complexityMode: 'lite' });
    const next = applyTransition({ stage: 'BRAINSTORM_GERAL', stageHistory: [] }, 'CODEX', { now: 'T', record });
    expect(next.stageRecords.BRAINSTORM_GERAL).toMatchObject({ outcome: 'asked', at: 'T' });
    expect(next).toMatchObject({ hasFrontend: true, hasBackend: false, complexityMode: 'lite' });
  });

  it('backfills a legacy checkpoint without history up to its current stage', () => {
    const next = applyTransition({ stage: 'RESEARCH' }, 'PRD_BASE', { now: 'T' });
    expect(next.stageHistory.map((h) => h.stage)).toEqual(['INIT', 'EXPLORE', 'RESEARCH', 'PRD_BASE']);
    expect(next.stageHistory[0].backfilled).toBe(true);
    expect(next.stageHistory[3].backfilled).toBeUndefined();
  });
});

describe('strict mode — seal, tamper detection, observed questions', () => {
  const sealed = (over = {}) => {
    const r = sealCheckpoint({ stage: 'INIT', artifactMode: 'prd' }, { now: 'T' });
    return { ...r.checkpoint, ...over };
  };
  const advanceTo = (cp, to, record) => applyTransition(cp, to, { now: 'T2', record });
  const log = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n');

  it('refuses an unsealed checkpoint', () => {
    const r = checkTransition({ checkpoint: { stage: 'INIT' }, to: 'EXPLORE', env: envWith(), strict: true });
    expect(codes(r)).toEqual(['CHECKPOINT_NOT_SEALED']);
  });

  it('accepts a sealed checkpoint and keeps it sealed across transitions', () => {
    const cp = sealed();
    expect(checkTransition({ checkpoint: cp, to: 'EXPLORE', env: envWith(), strict: true }).ok).toBe(true);
    const next = advanceTo(cp, 'EXPLORE');
    expect(next.integrity).toBe(computeIntegrity(next));
    expect(checkTransition({ checkpoint: next, to: 'RESEARCH', env: envWith({ 'codebase-memory.md': body(200) }), strict: true }).ok).toBe(true);
  });

  it('detects any out-of-band edit of a gate-owned field, however it was made', () => {
    const cp = advanceTo(sealed(), 'EXPLORE');
    for (const forged of [{ stage: 'FINAL' }, { hasFrontend: true }, { stageHistory: [] }, { complexityMode: 'lite' }, { stageRecords: { EXPAND: ok() } }]) {
      const r = checkTransition({ checkpoint: { ...cp, ...forged }, to: 'RESEARCH', env: envWith({ 'codebase-memory.md': body(200) }), strict: true });
      expect(codes(r)).toContain('CHECKPOINT_TAMPERED');
    }
  });

  it('ignores edits of other fields', () => {
    const cp = { ...advanceTo(sealed(), 'EXPLORE'), demanda: 'texto editado depois' };
    expect(checkTransition({ checkpoint: cp, to: 'RESEARCH', env: envWith({ 'codebase-memory.md': body(200) }), strict: true }).ok).toBe(true);
  });

  it('seal is only for a fresh INIT checkpoint; adopt resumes an older one with backfilled history', () => {
    expect(sealCheckpoint({ stage: 'RESEARCH' }).errors[0].code).toBe('SEAL_ONLY_AT_INIT');
    expect(sealCheckpoint({ stage: 'DONE' }, { adopt: true }).errors[0].code).toBe('ALREADY_DONE');
    expect(sealCheckpoint(sealed()).errors[0].code).toBe('ALREADY_SEALED');
    const adopted = sealCheckpoint({ stage: 'RESEARCH' }, { adopt: true }).checkpoint;
    expect(adopted.adopted.fromStage).toBe('RESEARCH');
    expect(adopted.stageHistory.map((h) => h.stage)).toEqual(['INIT', 'EXPLORE', 'RESEARCH']);
    expect(adopted.integrity).toBe(computeIntegrity(adopted));
  });

  it('a claimed "asked" must be backed by the hook log for that stage', () => {
    const cp = sealed({ stage: 'EXPAND' });
    const withIntegrity = { ...cp, integrity: computeIntegrity({ ...cp }) };
    const claim = ok({ questionsAsked: 3, questionsClosed: 3 });
    const files = (text) => envWith(text === null ? {} : { '.pensador-questions.jsonl': text });
    expect(codes(checkTransition({ checkpoint: withIntegrity, to: 'COMPLEXITY', record: claim, env: files(null), strict: true }))).toContain('QUESTIONS_NOT_OBSERVED');
    expect(codes(checkTransition({ checkpoint: withIntegrity, to: 'COMPLEXITY', record: claim, env: files(log({ stage: 'EXPAND', count: 1 })), strict: true }))).toContain('QUESTIONS_NOT_OBSERVED');
    expect(codes(checkTransition({ checkpoint: withIntegrity, to: 'COMPLEXITY', record: claim, env: files(log({ stage: 'RESEARCH', count: 9 })), strict: true }))).toContain('QUESTIONS_NOT_OBSERVED');
    expect(checkTransition({ checkpoint: withIntegrity, to: 'COMPLEXITY', record: claim, env: files(log({ stage: 'EXPAND', count: 2 }, { stage: 'EXPAND', count: 1 })), strict: true }).ok).toBe(true);
  });

  it('"unverified": true is the explicit escape when hooks are disabled, and is persisted', () => {
    const base = sealed({ stage: 'EXPAND' });
    const cp = { ...base, integrity: computeIntegrity(base) };
    const record = ok({ unverified: true });
    expect(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record, env: envWith(), strict: true }).ok).toBe(true);
    expect(advanceTo(cp, 'COMPLEXITY', record).stageRecords.EXPAND.unverified).toBe(true);
  });

  it('"none"/"fallback" outcomes need no logged questions', () => {
    const base = sealed({ stage: 'EXPAND' });
    const cp = { ...base, integrity: computeIntegrity(base) };
    const record = { outcome: 'none', note: 'nenhum requisito candidato novo; PRD base cobre tudo' };
    expect(checkTransition({ checkpoint: cp, to: 'COMPLEXITY', record, env: envWith(), strict: true }).ok).toBe(true);
  });

  it('questionsAskedIn tolerates blank and partial lines', () => {
    expect(questionsAskedIn('\n{"stage":"AGY","count":2}\n{broken', 'AGY')).toBe(2);
    expect(questionsAskedIn(null, 'AGY')).toBe(0);
  });
});
