/**
 * Decides whether a tool call may touch `.pensador-progress.json`.
 *
 * The stage gate (stage-gate.mjs) is only worth something if the checkpoint cannot simply
 * be edited around it — the OficinaAI run did exactly that with one `Edit`. This module is
 * the pure decision used by the PreToolUse hook `scripts/guard-checkpoint.mjs`:
 *
 *   - Edit / Write / MultiEdit: allowed when the fields owned by the gate
 *     (PROTECTED_FIELDS) are unchanged, or when the file is being created for the first
 *     time at stage INIT with none of them beyond `stage`. Everything else (`demanda`,
 *     `designSystems`, notes, ...) stays freely editable.
 *   - Bash / PowerShell: denied when the command both names the checkpoint and looks like
 *     a write (sed -i, redirect, tee, Set-Content, writeFile, mv, rm, ...). Reads pass.
 *
 * `advance-stage.mjs` never needs an exemption: its command line names the feature
 * directory, not the checkpoint file.
 */
import { PROTECTED_FIELDS, QUESTION_LOG } from './stage-gate.mjs';

const CHECKPOINT = '.pensador-progress.json';

const HOW_TO = 'Use: node "${CLAUDE_PLUGIN_ROOT}/scripts/advance-stage.mjs" --feature <featurePath> --to <PROXIMO_ESTAGIO> [--record \'<json>\']. ' +
  'The stage, stageHistory, stageRecords, complexityMode, hasFrontend, hasBackend, adopted and integrity fields are written only by that script (SKILL.md, "Gate de avanco").';

const SHELL_WRITE = [
  /\bsed\b[^|;&]*\s-[a-zA-Z]*i/,
  />>?\s*["']?[^\s|;&"']*\.pensador-(progress\.json|questions\.jsonl)/,
  /\btee\b/,
  /\b(Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item)\b/i,
  /\bwrite(File|FileSync)?\b|\bopen\([^)]*['"]w/i,
  /\b(mv|cp|rm|del|ren)\b/,
  /-replace\b/i,
];

const isCheckpointPath = (p) => typeof p === 'string' && (p === CHECKPOINT || p.split(/[\\/]/).pop() === CHECKPOINT);

function protectedView(obj) {
  return JSON.stringify(PROTECTED_FIELDS.map((key) => obj?.[key] ?? null));
}

function parse(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

function applyEdit(text, { old_string: oldString, new_string: newString, replace_all: all }) {
  if (typeof oldString !== 'string' || typeof newString !== 'string' || !text.includes(oldString)) return null;
  return all ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
}

/**
 * @param {{ tool_name: string, tool_input: object }} call
 * @param {{ readFile: (path: string) => string|null }} io - null when the file does not exist
 * @returns {{ allow: boolean, reason?: string }}
 */
export function evaluateToolCall(call, io) {
  const { tool_name: tool, tool_input: input = {} } = call ?? {};

  const logBlocked = { allow: false, reason: `Blocked: ${QUESTION_LOG} is the AskUserQuestion audit log, written only by the PostToolUse hook. Do not create, edit or delete it; ask the user for real instead.` };

  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(input.command ?? '');
    const writes = SHELL_WRITE.some((re) => re.test(command));
    if (command.includes(QUESTION_LOG) && writes) return logBlocked;
    if (!command.includes(CHECKPOINT)) return { allow: true };
    if (writes) return { allow: false, reason: `Blocked: this command writes to ${CHECKPOINT} by hand. ${HOW_TO}` };
    return { allow: true };
  }

  if (['Edit', 'Write', 'MultiEdit'].includes(tool) && typeof input.file_path === 'string' && input.file_path.endsWith(QUESTION_LOG)) {
    return logBlocked;
  }

  if (!['Edit', 'Write', 'MultiEdit'].includes(tool) || !isCheckpointPath(input.file_path)) return { allow: true };

  const before = io.readFile(input.file_path);
  const beforeObj = before === null ? undefined : parse(before);
  if (before !== null && beforeObj === undefined) return { allow: true }; // corrupt file: nothing to protect, let the user repair it

  let afterText;
  if (tool === 'Write') afterText = String(input.content ?? '');
  else {
    if (before === null) return { allow: true }; // the tool itself will fail on a missing file
    afterText = before;
    for (const edit of tool === 'MultiEdit' ? input.edits ?? [] : [input]) {
      afterText = afterText === null ? null : applyEdit(afterText, edit);
    }
    if (afterText === null) return { allow: true }; // edit will not apply; nothing to guard
  }
  const afterObj = parse(afterText);
  if (afterObj === undefined) return { allow: false, reason: `Blocked: the edit would leave ${CHECKPOINT} as invalid JSON.` };

  if (before === null) {
    const onlyInit = afterObj.stage === 'INIT' && PROTECTED_FIELDS.filter((k) => k !== 'stage').every((k) => afterObj[k] === undefined);
    return onlyInit ? { allow: true } : { allow: false, reason: `Blocked: a new ${CHECKPOINT} may only be created at stage INIT. ${HOW_TO}` };
  }

  if (protectedView(beforeObj) === protectedView(afterObj)) return { allow: true };
  return { allow: false, reason: `Blocked: this edit changes a gate-owned field of ${CHECKPOINT} (stage ${beforeObj.stage} -> ${afterObj.stage}). ${HOW_TO}` };
}
