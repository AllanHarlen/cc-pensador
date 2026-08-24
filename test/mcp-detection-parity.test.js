/**
 * MCP detection parity guard.
 *
 * Context7 and Codebase Memory detection each have their own implementation
 * in the three workflow plugins (Pensador, Orchestrator, Executor), but the
 * CANDIDATE LOCATIONS they probe are meant to be the same union across all
 * three — see the header comment in `scripts/lib/mcp-candidates.mjs`. Before
 * this guard existed, the three preflights disagreed on where to look: a
 * server registered only in `.kiro/settings/mcp.json` was "available" to
 * Pensador's EXPLORE stage but "absent" to the Orchestrator's `mcp-detect.mjs`
 * a few minutes later in the same joint run, and a server registered only in
 * `~/.codex/config.toml` was the reverse.
 *
 * This suite asserts the sibling plugins' candidate-list modules stay a
 * structural match of the canonical Pensador copy. Because the three plugins
 * are independent git repos, the sibling repos may not be checked out side by
 * side. When a sibling is absent the assertion is SKIPPED (not failed), so a
 * standalone cc-pensador checkout stays green while a combined workspace
 * enforces the parity — same pattern as `test/handoff-contract-sync.test.js`.
 *
 * Structural (not byte-identical) comparison: each sibling's file carries its
 * own header comment tailored to that plugin, which is fine — what must match
 * is the DATA (which locations, in which order, with which format).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS_ROOT = join(REPO_ROOT, '..');

const CANONICAL_PATH = join(REPO_ROOT, 'scripts/lib/mcp-candidates.mjs');

const SIBLINGS = [
  {
    plugin: 'cc-orchestrador-subagents',
    path: join(
      SIBLINGS_ROOT,
      'cc-orchestrador-subagents/skills/orchestrator-multi-agent-development/scripts/lib/mcp-candidates.mjs',
    ),
  },
  {
    plugin: 'cc-executor-subagents',
    path: join(
      SIBLINGS_ROOT,
      'cc-executor-subagents/skills/executor-subagents/scripts/lib/mcp-candidates.mjs',
    ),
  },
];

/** The constants every copy of `mcp-candidates.mjs` must agree on structurally. */
const SHARED_EXPORTS = [
  'CODEBASE_MEMORY_CONFIG_CANDIDATES',
  'CODEBASE_MEMORY_SKILL_CANDIDATES',
  'CONTEXT7_CONFIG_CANDIDATES',
  'CONTEXT7_MCP_DIRECTORY_CANDIDATES',
  'CONTEXT7_SKILL_CANDIDATES',
];

async function loadModule(path) {
  return import(pathToFileURL(path).href);
}

describe('MCP candidate lists stay a superset-and-order match across the three workflow plugins', () => {
  it('the canonical Pensador copy exists', () => {
    expect(existsSync(CANONICAL_PATH), `${CANONICAL_PATH} not found`).toBe(true);
  });

  for (const { plugin, path } of SIBLINGS) {
    const present = existsSync(path);

    describe.skipIf(!present)(plugin, () => {
      it(`${plugin}/scripts/lib/mcp-candidates.mjs exists and exports the shared constants`, async () => {
        const canonical = await loadModule(CANONICAL_PATH);
        const sibling = await loadModule(path);
        for (const name of SHARED_EXPORTS) {
          expect(sibling[name], `${plugin} is missing export ${name}`).toBeDefined();
          expect(canonical[name], `canonical is missing export ${name}`).toBeDefined();
        }
      });

      for (const exportName of SHARED_EXPORTS) {
        it(`${exportName} matches the canonical list (same candidates, same order)`, async () => {
          const canonical = await loadModule(CANONICAL_PATH);
          const sibling = await loadModule(path);
          expect(sibling[exportName]).toEqual(canonical[exportName]);
        });
      }
    });
  }
});
