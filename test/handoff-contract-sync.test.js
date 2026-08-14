/**
 * Handoff contract sync guard.
 *
 * The handoff contract (`references/handoff-contract.md`) is the joint-operation
 * contract shared by the three workflow plugins (Pensador → Orchestrador →
 * Executor). Section 8 of the contract requires the document to remain
 * BYTE-IDENTICAL across the three repos — otherwise the "identical source of
 * truth" promise silently breaks (as it did before: the orchestrator carried a
 * stale copy and the executor had none).
 *
 * This suite asserts that the sibling copies match the Pensador's canonical copy.
 * Because the three plugins are independent git repos, the sibling repos may not
 * be checked out side by side. When a sibling is absent the assertion is SKIPPED
 * (not failed), so a standalone cc-pensador checkout stays green while a combined
 * workspace enforces the sync.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS_ROOT = join(REPO_ROOT, '..');

const CANONICAL = join(REPO_ROOT, 'skills/pensador/references/handoff-contract.md');

/** Normalize line endings so git autocrlf differences do not cause false diffs. */
const normalize = (s) => s.replace(/\r\n/g, '\n');

/** Sibling plugin copies that must mirror the canonical contract verbatim. */
const SIBLINGS = [
  {
    plugin: 'cc-orchestrador-subagents',
    path: join(
      SIBLINGS_ROOT,
      'cc-orchestrador-subagents/skills/orchestrator-multi-agent-development/references/handoff-contract.md',
    ),
  },
  {
    plugin: 'cc-executor-subagents',
    path: join(
      SIBLINGS_ROOT,
      'cc-executor-subagents/skills/executor-subagents/references/handoff-contract.md',
    ),
  },
];

describe('handoff contract stays byte-identical across the three plugins', () => {
  it('the canonical Pensador copy exists', () => {
    expect(existsSync(CANONICAL), `${CANONICAL} not found`).toBe(true);
  });

  const canonicalText = existsSync(CANONICAL) ? normalize(readFileSync(CANONICAL, 'utf8')) : '';

  for (const { plugin, path } of SIBLINGS) {
    const present = existsSync(path);

    it.skipIf(!present)(`${plugin} copy matches the canonical contract`, () => {
      expect(normalize(readFileSync(path, 'utf8'))).toBe(canonicalText);
    });

    it.runIf(!present)(`${plugin} copy is absent (sibling repo not checked out) — skipping sync check`, () => {
      // Documents why the sync assertion above was skipped in this workspace.
      expect(present).toBe(false);
    });
  }
});
