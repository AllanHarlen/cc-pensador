#!/usr/bin/env node
/**
 * CLI: the ONLY sanctioned way to change the gate-owned fields of `.pensador-progress.json`.
 * Hand-editing them (Edit/Write/sed) is forbidden by SKILL.md and blocked by the PreToolUse
 * hook; tampering is also detected here through the integrity seal. See
 * scripts/lib/stage-gate.mjs for the failure this prevents.
 *
 * Usage:
 *   node scripts/advance-stage.mjs --feature <featurePath> --seal
 *       Seals a freshly created checkpoint (stage INIT). Run once, right after INIT creates it.
 *   node scripts/advance-stage.mjs --feature <featurePath> --adopt
 *       Seals a checkpoint written before the gate existed (2.28 or older), only when the user
 *       explicitly asked to resume it. Earlier stages are marked backfilled.
 *   node scripts/advance-stage.mjs --feature <featurePath> --to <STAGE>
 *        [--record '<json>' | --record-file <path>] [--check-only]
 *
 * --record is the evidence for the stage being LEFT (see scripts/lib/stage-gate.mjs), e.g.
 *   EXPAND            '{"outcome":"asked","questionsAsked":3,"questionsClosed":3}'
 *   COMPLEXITY        '{"outcome":"asked","questionsAsked":1,"questionsClosed":1,"complexityMode":"completo"}'
 *   BRAINSTORM_GERAL  '{"outcome":"asked","questionsAsked":6,"questionsClosed":6,"hasFrontend":true,"hasBackend":true}'
 *   CODEX / AGY       '{"outcome":"asked",...}' (+ shared-agents/<codex|agy>.stage.response.md), or
 *                     '{"outcome":"fallback"|"none"|"skipped","note":"<why, >= 20 chars>"}'
 * "asked" is checked against the AskUserQuestion calls the PostToolUse hook logged for that stage
 * (.pensador-questions.jsonl); add "unverified": true only when hooks are disabled in this environment.
 * Stages that leave artifacts (EXPLORE, RESEARCH, PRD_BASE, ARCH, DESIGN, FINAL) need no record.
 *
 * Output: JSON on stdout `{ ok, from, to, errors[], written }`. Exit 0 only when the
 * operation is allowed (and, without --check-only, was written); exit 1 otherwise.
 * Nothing is written on failure.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyTransition, checkTransition, sealCheckpoint } from './lib/stage-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { feature: null, to: null, checkOnly: false, record: null, recordFile: null, seal: false, adopt: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--feature') args.feature = argv[++i] ?? null;
    else if (argv[i] === '--to') args.to = argv[++i] ?? null;
    else if (argv[i] === '--check-only') args.checkOnly = true;
    else if (argv[i] === '--record') args.record = argv[++i] ?? null;
    else if (argv[i] === '--record-file') args.recordFile = argv[++i] ?? null;
    else if (argv[i] === '--seal') args.seal = true;
    else if (argv[i] === '--adopt') args.adopt = true;
  }
  return args;
}

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
}

const { feature, to, checkOnly, record: recordArg, recordFile, seal, adopt } = parseArgs(process.argv.slice(2));
if (!feature || (!to && !seal && !adopt)) {
  emit({ ok: false, errors: [{ code: 'MISSING_ARGS', message: '--feature <featurePath> and one of --to <STAGE>, --seal, --adopt are required' }], written: false }, 1);
}

const featureDir = resolve(feature);
const checkpointPath = join(featureDir, '.pensador-progress.json');
let checkpoint;
try {
  checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
} catch (err) {
  emit({ ok: false, errors: [{ code: 'CHECKPOINT_UNREADABLE', message: `${checkpointPath}: ${err.message}` }], written: false }, 1);
}

if (seal || adopt) {
  const sealed = sealCheckpoint(checkpoint, { adopt });
  if (!sealed.ok || checkOnly) emit({ ...sealed, checkpoint: undefined, written: false }, sealed.ok ? 0 : 1);
  writeFileSync(checkpointPath, `${JSON.stringify(sealed.checkpoint, null, 2)}\n`);
  emit({ ok: true, errors: [], stage: sealed.checkpoint.stage, written: true }, 0);
}

let record;
if (recordArg !== null || recordFile !== null) {
  try {
    record = JSON.parse(recordArg ?? readFileSync(resolve(recordFile), 'utf8'));
  } catch (err) {
    emit({ ok: false, errors: [{ code: 'RECORD_UNREADABLE', message: `--record is not valid JSON: ${err.message}` }], written: false }, 1);
  }
}

const env = {
  readText: (rel) => {
    try {
      return readFileSync(join(featureDir, rel), 'utf8');
    } catch {
      return null;
    }
  },
  list: (rel) => {
    try {
      return readdirSync(join(featureDir, rel));
    } catch {
      return [];
    }
  },
  validateHandoff: () => {
    const run = spawnSync(process.execPath, [join(here, 'validate-handoff.mjs'), '--file', join(featureDir, 'handoff.json')], { encoding: 'utf8' });
    try {
      return JSON.parse(run.stdout);
    } catch {
      return { ok: false, errors: [{ code: 'VALIDATOR_OUTPUT_UNREADABLE', message: run.stderr || 'no output' }] };
    }
  },
};

const result = checkTransition({ checkpoint, to, record, env, strict: true });
if (!result.ok || checkOnly) {
  emit({ ...result, written: false }, result.ok ? 0 : 1);
}

writeFileSync(checkpointPath, `${JSON.stringify(applyTransition(checkpoint, to, { record }), null, 2)}\n`);
emit({ ...result, written: true }, 0);
