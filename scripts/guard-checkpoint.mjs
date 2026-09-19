#!/usr/bin/env node
/**
 * PreToolUse hook (registered in hooks/hooks.json): refuses hand-edits of the
 * gate-owned fields of `.pensador-progress.json`. Decision logic lives in
 * scripts/lib/checkpoint-guard.mjs. Exit 2 + stderr = block and tell the model why;
 * exit 0 = allow. Any unexpected error allows the call — a broken guard must never
 * take a session down.
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateToolCall } from './lib/checkpoint-guard.mjs';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}
// Fast path: almost every tool call in every session has nothing to do with the checkpoint.
if (!['.pensador-progress.json', '.pensador-questions.jsonl', '.pensador-approval.json', 'design-brief.json', 'approval.key'].some((name) => raw.includes(name))) process.exit(0);

try {
  const call = JSON.parse(raw);
  const verdict = evaluateToolCall(call, {
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
  });
  if (!verdict.allow) {
    // Resolve the plugin-root placeholder so the model gets a command it can run as-is.
    const scriptsDir = dirname(fileURLToPath(import.meta.url)).split('\\').join('/');
    process.stderr.write(`${verdict.reason.split('${CLAUDE_PLUGIN_ROOT}/scripts').join(scriptsDir)}\n`);
    process.exit(2);
  }
} catch {
  /* fail open */
}
process.exit(0);
