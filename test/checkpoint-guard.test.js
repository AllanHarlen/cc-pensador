/**
 * Tests for the PreToolUse guard (scripts/lib/checkpoint-guard.mjs + scripts/guard-checkpoint.mjs).
 *
 * The stage gate is only meaningful if the checkpoint cannot be edited around it — the
 * OficinaAI run moved the stage with one Edit. These cases pin what is blocked (gate-owned
 * fields, shell writes) and, just as important, what must stay allowed (other fields, reads,
 * the first INIT checkpoint, unrelated files).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluateToolCall } from '../scripts/lib/checkpoint-guard.mjs';

const HOOK = fileURLToPath(new URL('../scripts/guard-checkpoint.mjs', import.meta.url));
const FILE = 'C:\\proj\\.pensador\\x-v1\\.pensador-progress.json';
const checkpoint = { slug: 'x', stage: 'INIT', artifactMode: 'prd', demanda: 'algo' };
const io = (obj = checkpoint) => ({ readFile: () => (obj === null ? null : JSON.stringify(obj, null, 2)) });

const edit = (oldString, newString, extra = {}) => ({ tool_name: 'Edit', tool_input: { file_path: FILE, old_string: oldString, new_string: newString, ...extra } });

describe('Edit', () => {
  it('blocks the OficinaAI shortcut: stage INIT -> DONE', () => {
    const v = evaluateToolCall(edit('"stage": "INIT"', '"stage": "DONE"'), io());
    expect(v.allow).toBe(false);
    expect(v.reason).toContain('advance-stage.mjs');
  });

  it('blocks fabricating gate-owned fields', () => {
    for (const [oldS, newS] of [
      ['"artifactMode": "prd"', '"artifactMode": "prd", "hasFrontend": true'],
      ['"artifactMode": "prd"', '"artifactMode": "prd", "complexityMode": "lite"'],
      ['"artifactMode": "prd"', '"artifactMode": "prd", "stageHistory": []'],
      ['"artifactMode": "prd"', '"artifactMode": "prd", "stageRecords": {}'],
    ]) {
      expect(evaluateToolCall(edit(oldS, newS), io()).allow).toBe(false);
    }
  });

  it('allows editing other fields', () => {
    expect(evaluateToolCall(edit('"demanda": "algo"', '"demanda": "algo mais"'), io()).allow).toBe(true);
    expect(evaluateToolCall(edit('"artifactMode": "prd"', '"artifactMode": "spec"'), io()).allow).toBe(true);
  });

  it('honours replace_all and rejects edits that would corrupt the JSON', () => {
    expect(evaluateToolCall(edit('INIT', 'DONE', { replace_all: true }), io()).allow).toBe(false);
    expect(evaluateToolCall(edit('"slug": "x",', '"slug": ,'), io()).allow).toBe(false);
  });

  it('ignores other files', () => {
    const other = { tool_name: 'Edit', tool_input: { file_path: 'C:\\proj\\prd.md', old_string: 'a', new_string: 'b' } };
    expect(evaluateToolCall(other, io()).allow).toBe(true);
  });
});

describe('MultiEdit', () => {
  it('applies the edits in order and blocks a stage change', () => {
    const call = {
      tool_name: 'MultiEdit',
      tool_input: { file_path: FILE, edits: [{ old_string: '"demanda": "algo"', new_string: '"demanda": "b"' }, { old_string: '"stage": "INIT"', new_string: '"stage": "FINAL"' }] },
    };
    expect(evaluateToolCall(call, io()).allow).toBe(false);
  });
});

describe('Write', () => {
  const write = (obj) => ({ tool_name: 'Write', tool_input: { file_path: FILE, content: JSON.stringify(obj) } });

  it('allows creating the first checkpoint at INIT', () => {
    expect(evaluateToolCall(write({ slug: 'x', stage: 'INIT' }), io(null)).allow).toBe(true);
  });

  it('blocks creating a checkpoint that already claims a later stage or history', () => {
    expect(evaluateToolCall(write({ stage: 'DONE' }), io(null)).allow).toBe(false);
    expect(evaluateToolCall(write({ stage: 'INIT', stageHistory: [{ stage: 'DONE' }] }), io(null)).allow).toBe(false);
  });

  it('blocks overwriting a checkpoint with a different stage, allows an unchanged gate view', () => {
    expect(evaluateToolCall(write({ ...checkpoint, stage: 'DONE' }), io()).allow).toBe(false);
    expect(evaluateToolCall(write({ ...checkpoint, demanda: 'nova' }), io()).allow).toBe(true);
  });

  it('blocks invalid JSON', () => {
    const call = { tool_name: 'Write', tool_input: { file_path: FILE, content: '{oops' } };
    expect(evaluateToolCall(call, io()).allow).toBe(false);
  });
});

describe('Bash / PowerShell', () => {
  const sh = (command, tool = 'Bash') => evaluateToolCall({ tool_name: tool, tool_input: { command } }, io());

  it('blocks shell writes to the checkpoint', () => {
    expect(sh(`sed -i 's/"stage": "INIT"/"stage": "DONE"/' .pensador/x-v1/.pensador-progress.json`).allow).toBe(false);
    expect(sh('echo "{}" > .pensador/x-v1/.pensador-progress.json').allow).toBe(false);
    expect(sh(`node -e "require('fs').writeFileSync('.pensador/x-v1/.pensador-progress.json','{}')"`).allow).toBe(false);
    expect(sh(`(Get-Content .pensador\\x\\.pensador-progress.json) -replace 'INIT','DONE' | Set-Content .pensador\\x\\.pensador-progress.json`, 'PowerShell').allow).toBe(false);
  });

  it('allows reading it and running advance-stage', () => {
    expect(sh('cat .pensador/x-v1/.pensador-progress.json').allow).toBe(true);
    expect(sh('grep stage .pensador/x-v1/.pensador-progress.json | head').allow).toBe(true);
    expect(sh('node "/p/scripts/advance-stage.mjs" --feature .pensador/x-v1 --to EXPLORE').allow).toBe(true);
    expect(sh('sed -i s/a/b/ README.md').allow).toBe(true);
  });
});

describe('hook process (stdin JSON -> exit code)', () => {
  const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });

  it('exits 2 with the reason on stderr when blocking', () => {
    const r = run({ tool_name: 'Bash', tool_input: { command: 'echo {} > .pensador-progress.json' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('advance-stage.mjs');
  });

  it('exits 0 for unrelated calls and for garbage input (fails open)', () => {
    expect(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }).status).toBe(0);
    expect(spawnSync(process.execPath, [HOOK], { input: 'not json .pensador-progress.json', encoding: 'utf8' }).status).toBe(0);
  });

  it('is registered as a PreToolUse hook in hooks/hooks.json', () => {
    const hooks = JSON.parse(readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8'));
    const entry = hooks.hooks.PreToolUse[0];
    expect(entry.matcher.split('|')).toEqual(expect.arrayContaining(['Edit', 'Write', 'MultiEdit', 'Bash', 'PowerShell']));
    expect(entry.hooks[0].command).toContain('guard-checkpoint.mjs');
  });
});

describe('hook process — audit log', () => {
  it('blocks a Write to .pensador-questions.jsonl through the real hook entry point (fast path must not skip it)', () => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'C:/p/.pensador/x-v1/.pensador-questions.jsonl', content: '{"stage":"INIT","count":9}' } }),
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('audit log');
  });
});
