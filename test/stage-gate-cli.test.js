/**
 * Process-level tests for the gate: scripts/advance-stage.mjs (seal / adopt / advance),
 * scripts/track-questions.mjs (PostToolUse) and the guard on the audit log — plus one
 * end-to-end walk through all thirteen stages with the real handoff validator.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { STAGE_ORDER } from '../scripts/pensador-engine.mjs';
import { evaluateToolCall } from '../scripts/lib/checkpoint-guard.mjs';
import { DESIGN_APPROVAL_HEADER } from '../scripts/lib/design-approval.mjs';
import { designEvidence } from './helpers/design-fixture.js';

const script = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const body = (n = 600) => `# doc\n${'conteudo real '.repeat(Math.ceil(n / 13))}`;
const ok = (extra) => ({ outcome: 'asked', questionsAsked: 2, questionsClosed: 2, ...extra });

describe('advance-stage CLI + question tracker', () => {
  let project;
  let dir;
  const feature = '.pensador/x-v1';

  const run = (...args) => {
    const r = spawnSync(process.execPath, [script('advance-stage.mjs'), '--feature', dir, ...args], { encoding: 'utf8' });
    return { status: r.status, json: JSON.parse(r.stdout) };
  };
  const checkpoint = () => JSON.parse(readFileSync(join(dir, '.pensador-progress.json'), 'utf8'));
  const setCheckpoint = (obj) => writeFileSync(join(dir, '.pensador-progress.json'), JSON.stringify(obj));
  const put = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
  };
  /** Simulates the PostToolUse hook firing after an AskUserQuestion call with `n` questions. */
  const askUser = (n, toolName = 'AskUserQuestion', header = undefined) =>
    spawnSync(process.execPath, [script('track-questions.mjs')], {
      input: JSON.stringify({ tool_name: toolName, cwd: project, tool_input: { questions: Array.from({ length: n }, (_, i) => ({ question: `q${i}`, ...(header ? { header } : {}) })) } }),
      encoding: 'utf8',
    });
  const logText = () => (existsSync(join(dir, '.pensador-questions.jsonl')) ? readFileSync(join(dir, '.pensador-questions.jsonl'), 'utf8') : '');

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'pensador-proj-'));
    dir = join(project, feature);
    mkdirSync(dir, { recursive: true });
    setCheckpoint({ slug: 'x', stage: 'INIT', artifactMode: 'prd' });
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  it('refuses to advance an unsealed checkpoint and says how to seal it', () => {
    const { status, json } = run('--to', 'EXPLORE');
    expect(status).toBe(1);
    expect(json.errors[0].code).toBe('CHECKPOINT_NOT_SEALED');
    expect(json.errors[0].message).toContain('--seal');
  });

  it('--seal, then a legal advance writes stage, history and a fresh seal', () => {
    expect(run('--seal').status).toBe(0);
    const { status, json } = run('--to', 'EXPLORE');
    expect(status).toBe(0);
    expect(json.written).toBe(true);
    const cp = checkpoint();
    expect(cp.stage).toBe('EXPLORE');
    expect(cp.stageHistory.map((h) => h.stage)).toEqual(['INIT', 'EXPLORE']);
    expect(typeof cp.integrity).toBe('string');
  });

  it('exits 1 and leaves the checkpoint untouched on a skip; --check-only never writes', () => {
    run('--seal');
    const before = readFileSync(join(dir, '.pensador-progress.json'), 'utf8');
    expect(run('--to', 'DONE').status).toBe(1);
    expect(run('--to', 'EXPLORE', '--check-only').json.written).toBe(false);
    expect(readFileSync(join(dir, '.pensador-progress.json'), 'utf8')).toBe(before);
  });

  it('catches a tampered checkpoint even when the write bypassed every hook', () => {
    run('--seal');
    run('--to', 'EXPLORE');
    setCheckpoint({ ...checkpoint(), stage: 'FINAL' }); // e.g. a python one-liner the guard did not recognise
    const { status, json } = run('--to', 'DONE');
    expect(status).toBe(1);
    expect(json.errors.map((e) => e.code)).toContain('CHECKPOINT_TAMPERED');
  });

  it('--adopt resumes a pre-gate checkpoint at its recorded stage', () => {
    setCheckpoint({ slug: 'x', stage: 'RESEARCH', artifactMode: 'prd' });
    expect(run('--seal').json.errors[0].code).toBe('SEAL_ONLY_AT_INIT');
    expect(run('--adopt').status).toBe(0);
    const cp = checkpoint();
    expect(cp.adopted.fromStage).toBe('RESEARCH');
    put('market-research.md', body());
    put('tech-research.md', body());
    expect(run('--to', 'PRD_BASE').status).toBe(0);
  });

  /** Seals a fresh checkpoint and walks the artifact-gated stages INIT -> EXPAND. */
  const walkToExpand = () => {
    expect(run('--seal').status).toBe(0);
    put('codebase-memory.md', body(300));
    for (const [to, files] of [
      ['EXPLORE', {}],
      ['RESEARCH', {}],
      ['PRD_BASE', { 'market-research.md': body(), 'tech-research.md': body() }],
      ['ARCH', { 'prd.md': body(2000) }],
      ['EXPAND', { 'architecture.md': body() }],
    ]) {
      for (const [rel, text] of Object.entries(files)) put(rel, text);
      expect(run('--to', to).status, to).toBe(0);
    }
    expect(checkpoint().stage).toBe('EXPAND');
  };

  it('rejects a stub artifact', () => {
    run('--seal');
    run('--to', 'EXPLORE');
    put('codebase-memory.md', '# x');
    expect(run('--to', 'RESEARCH').json.errors.map((e) => e.code)).toContain('ARTIFACT_TOO_SHORT');
  });

  it('takes the record inline or from a file and persists it', () => {
    walkToExpand();
    expect(run('--to', 'COMPLEXITY').json.errors[0].code).toBe('RECORD_REQUIRED');
    expect(run('--to', 'COMPLEXITY', '--record', 'not json').json.errors[0].code).toBe('RECORD_UNREADABLE');
    askUser(2);
    put('rec.json', ok());
    expect(run('--to', 'COMPLEXITY', '--record-file', join(dir, 'rec.json')).status).toBe(0);
    expect(checkpoint().stageRecords.EXPAND).toMatchObject({ outcome: 'asked', questionsAsked: 2 });
  });

  it('a record cannot claim questions the user was never asked (hook log is the witness)', () => {
    walkToExpand();
    const fake = run('--to', 'COMPLEXITY', '--record', JSON.stringify(ok()));
    expect(fake.json.errors.map((e) => e.code)).toContain('QUESTIONS_NOT_OBSERVED');
    askUser(1);
    expect(run('--to', 'COMPLEXITY', '--record', JSON.stringify(ok())).json.errors.map((e) => e.code)).toContain('QUESTIONS_NOT_OBSERVED');
    askUser(1);
    expect(run('--to', 'COMPLEXITY', '--record', JSON.stringify(ok())).status).toBe(0);
  });

  it('the tracker logs against the active stage, ignores other tools and finished features', () => {
    run('--seal');
    askUser(3);
    askUser(5, 'Bash');
    const lines = logText().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ stage: 'INIT', count: 3 });

    const done = join(project, '.pensador', 'old-v1');
    mkdirSync(done, { recursive: true });
    writeFileSync(join(done, '.pensador-progress.json'), JSON.stringify({ stage: 'DONE' }));
    askUser(1);
    expect(existsSync(join(done, '.pensador-questions.jsonl'))).toBe(false);
  });

  it('the tracker fails open on garbage and with no .pensador directory', () => {
    expect(spawnSync(process.execPath, [script('track-questions.mjs')], { input: 'garbage', encoding: 'utf8' }).status).toBe(0);
    rmSync(join(project, '.pensador'), { recursive: true, force: true });
    expect(askUser(1).status).toBe(0);
  });

  it('the guard blocks any hand-write to the audit log, but allows reading it', () => {
    const io = { readFile: () => null };
    const path = join(dir, '.pensador-questions.jsonl');
    expect(evaluateToolCall({ tool_name: 'Write', tool_input: { file_path: path, content: '{}' } }, io).allow).toBe(false);
    expect(evaluateToolCall({ tool_name: 'Edit', tool_input: { file_path: path, old_string: 'a', new_string: 'b' } }, io).allow).toBe(false);
    expect(evaluateToolCall({ tool_name: 'Bash', tool_input: { command: `echo '{"stage":"EXPAND","count":9}' >> ${feature}/.pensador-questions.jsonl` } }, io).allow).toBe(false);
    expect(evaluateToolCall({ tool_name: 'Bash', tool_input: { command: `cat ${feature}/.pensador-questions.jsonl` } }, io).allow).toBe(true);
  });

  it('refuses FINAL -> DONE for the hand-written handoff from the OficinaAI run', () => {
    setCheckpoint({ slug: 'x', stage: 'FINAL', artifactMode: 'prd', hasFrontend: false, hasBackend: false });
    run('--adopt');
    put('handoff.json', { schemaVersion: '1.0', slug: 'x', status: 'DONE' });
    const { status, json } = run('--to', 'DONE');
    expect(status).toBe(1);
    expect(json.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['HANDOFF_INVALID', 'MISSING_ARTIFACT']));
  });

  it('end to end: all thirteen stages, real validator, then DONE', () => {
    const go = (to, record) => {
      const r = run('--to', to, ...(record ? ['--record', JSON.stringify(record)] : []));
      expect(r.json.errors, `${checkpoint().stage} -> ${to}`).toEqual([]);
      expect(r.status).toBe(0);
    };
    expect(run('--seal').status).toBe(0);

    put('codebase-memory.md', body(300));
    go('EXPLORE');
    go('RESEARCH');
    put('market-research.md', body());
    put('tech-research.md', body());
    go('PRD_BASE');
    put('prd.md', body(2500));
    go('ARCH');
    put('architecture.md', body());
    go('EXPAND');

    askUser(2);
    go('COMPLEXITY', ok());
    askUser(1);
    go('BRAINSTORM_GERAL', ok({ questionsAsked: 1, questionsClosed: 1, complexityMode: 'completo' }));
    put('shared-agents/agent.response.md', body());
    askUser(3);
    go('CODEX', ok({ questionsAsked: 3, questionsClosed: 3, hasFrontend: true, hasBackend: true }));
    put('shared-agents/codex.stage.response.md', body());
    askUser(1);
    go('AGY', ok({ questionsAsked: 1, questionsClosed: 1 }));
    put('shared-agents/agy.stage.response.md', body());
    askUser(1);
    for (const [rel, text] of Object.entries(designEvidence().files)) put(rel, text);
    go('DESIGN', ok({ questionsAsked: 1, questionsClosed: 1 }));
    askUser(1, 'AskUserQuestion', DESIGN_APPROVAL_HEADER); // the visual approval of the preview, asked while the checkpoint is in DESIGN
    go('FINAL');

    put('project-baseline.json', { isGreenfield: true, techStack: ['nextjs', 'dotnet'] });
    put('requirements.json', { requirements: [{ id: 'RF-01' }], acceptanceCriteria: [] });
    put('ui-data-map.json', { screens: [{ name: 'home', reads: [] }] });
    put('seed-plan.json', { entities: [{ name: 'Servico' }] });
    put('handoff.json', {
      handoffVersion: 1,
      stage: 'pensador',
      slug: 'x',
      artifactMode: 'prd',
      producer: { plugin: 'cc-pensador', version: '2.29.0' },
      artifactRoot: feature,
      status: 'DONE',
      createdAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:00:00.000Z',
      summary: 'PRD, arquitetura, baseline, mapa de telas e plano de seed.',
      upstream: null,
      artifacts: [
        { role: 'prd', path: 'prd.md', required: true },
        { role: 'architecture', path: 'architecture.md', required: true },
        { role: 'project-baseline', path: 'project-baseline.json', required: true },
        { role: 'requirements-index', path: 'requirements.json', required: true },
        { role: 'ui-data-map', path: 'ui-data-map.json', required: true },
        { role: 'seed-plan', path: 'seed-plan.json', required: true },
      ],
      nextStage: { consumer: 'cc-orchestrador-subagents', entrypoint: '/orquestrador', instructions: 'Ingerir os artefatos e implementar o plano.' },
    });
    go('DONE');
    expect(checkpoint().stage).toBe('DONE');
    expect(checkpoint().stageHistory.map((h) => h.stage)).toEqual(STAGE_ORDER);
  });
});
