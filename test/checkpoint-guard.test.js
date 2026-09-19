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

describe('design approval files (design-brief.json, .pensador-approval.json)', () => {
  const BRIEF = 'C:/proj/.pensador/x-v1/design-brief.json';
  const APPROVAL = 'C:/proj/.pensador/x-v1/.pensador-approval.json';

  it('blocks Edit/Write/MultiEdit of the brief inside .pensador and of the approval record anywhere', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      expect(evaluateToolCall({ tool_name: tool, tool_input: { file_path: BRIEF, content: '{}', old_string: 'a', new_string: 'b', edits: [] } }, io()).allow).toBe(false);
      expect(evaluateToolCall({ tool_name: tool, tool_input: { file_path: APPROVAL, content: '{}', old_string: 'a', new_string: 'b', edits: [] } }, io()).allow).toBe(false);
    }
    const v = evaluateToolCall({ tool_name: 'Write', tool_input: { file_path: BRIEF, content: '{}' } }, io());
    expect(v.reason).toContain('design-brief.mjs');
  });

  it('does not touch a design-brief.json that belongs to the user project', () => {
    expect(evaluateToolCall({ tool_name: 'Write', tool_input: { file_path: 'C:/proj/docs/design-brief.json', content: '{}' } }, io()).allow).toBe(true);
  });

  it('blocks shell writes (redirect, sed -i, Set-Content) but allows reads and the CLI', () => {
    for (const command of [
      'echo {} > .pensador/x-v1/design-brief.json',
      'sed -i s/null/"2026-01-01"/ .pensador/x-v1/design-brief.json',
      'Set-Content .pensador/x-v1/.pensador-approval.json "{}"',
      'cp fake.json .pensador/x-v1/.pensador-approval.json',
    ]) {
      expect(evaluateToolCall({ tool_name: 'Bash', tool_input: { command } }, io()).allow, command).toBe(false);
    }
    for (const command of [
      'cat .pensador/x-v1/design-brief.json',
      'node scripts/design-brief.mjs approve --feature .pensador/x-v1 --dir .pensador/x-v1/design-systems/a',
    ]) {
      expect(evaluateToolCall({ tool_name: 'Bash', tool_input: { command } }, io()).allow, command).toBe(true);
    }
  });
});

describe('approval signing key (approval.key)', () => {
  const KEY = 'C:/Users/u/AppData/Local/pensador/approval.key';

  it('blocks Read/Grep/Glob/Edit/Write of the key wherever it is', () => {
    for (const [tool, tool_input] of [['Read', { file_path: KEY }], ['Grep', { pattern: 'a', path: KEY }], ['Glob', { pattern: '**/approval.key' }], ['Edit', { file_path: KEY, old_string: 'a', new_string: 'b' }], ['Write', { file_path: KEY, content: 'x' }]]) {
      const v = evaluateToolCall({ tool_name: tool, tool_input }, io());
      expect(v.allow, tool).toBe(false);
      expect(v.reason).toContain('approval.key');
    }
  });

  it('blocks shell commands that name the key, reads included; the CLI does not need to name it', () => {
    for (const command of ['cat ~/.pensador/approval.key', 'Get-Content $env:LOCALAPPDATA\pensador\approval.key', 'cp ~/.pensador/approval.key /tmp/k']) {
      expect(evaluateToolCall({ tool_name: 'Bash', tool_input: { command } }, io()).allow, command).toBe(false);
    }
    expect(evaluateToolCall({ tool_name: 'Bash', tool_input: { command: 'node scripts/design-brief.mjs approve --feature f --dir d' } }, io()).allow).toBe(true);
  });

  it('leaves ordinary reads alone', () => {
    expect(evaluateToolCall({ tool_name: 'Read', tool_input: { file_path: 'C:/proj/src/a.ts' } }, io()).allow).toBe(true);
  });
});
