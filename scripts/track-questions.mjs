#!/usr/bin/env node
/**
 * PostToolUse hook for AskUserQuestion (registered in hooks/hooks.json).
 *
 * Appends one line per call to `<featurePath>/.pensador-questions.jsonl`, stamped with the
 * stage the active checkpoint is in. `advance-stage.mjs` later refuses a stage record that
 * claims more questions than were logged — the difference between "the user was asked"
 * and "the model says the user was asked". The log is written only here; the PreToolUse
 * guard blocks any Edit/Write/shell write to it.
 *
 * The active feature is the most recently touched non-DONE checkpoint under
 * `<cwd>/.pensador/`. Any error is swallowed: a broken tracker must never break a session.
 */
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTION_LOG } from './lib/stage-gate.mjs';

try {
  const raw = readFileSync(0, 'utf8');
  const call = JSON.parse(raw);
  if (call.tool_name !== 'AskUserQuestion') process.exit(0);

  const root = join(call.cwd ?? process.cwd(), '.pensador');
  let active = null;
  for (const name of readdirSync(root)) {
    const file = join(root, name, '.pensador-progress.json');
    try {
      const checkpoint = JSON.parse(readFileSync(file, 'utf8'));
      if (checkpoint.stage === 'DONE') continue;
      const mtime = statSync(file).mtimeMs;
      if (active === null || mtime > active.mtime) active = { dir: join(root, name), stage: checkpoint.stage, mtime };
    } catch {
      /* not a feature directory */
    }
  }
  if (active !== null) {
    const count = Array.isArray(call.tool_input?.questions) ? call.tool_input.questions.length : 1;
    appendFileSync(join(active.dir, QUESTION_LOG), `${JSON.stringify({ stage: active.stage, count, at: new Date().toISOString() })}\n`);
  }
} catch {
  /* fail open */
}
process.exit(0);
