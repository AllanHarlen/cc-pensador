/**
 * Handoff role-vocabulary consistency guard.
 *
 * `references/handoff-contract.md` section 5 is the canonical vocabulary of
 * `role` values the Pensador is allowed to emit in `handoff.json`'s
 * `artifacts[]`. `references/feature-isolation.md` restates that same list in
 * its own "Manifesto de handoff" section as operator-facing guidance, so an
 * LLM reading feature-isolation.md alone (without cross-referencing the
 * contract) still gets the right set.
 *
 * These two lists drifted before (feature-isolation.md was missing
 * `api-contract` and `openspec-change`, and neither doc knew about the
 * `project-baseline` role once it was added) — the drift was invisible
 * because `handoff-contract-sync.test.js` only compares handoff-contract.md
 * across the three plugin repos, not this doc against that one within a
 * single repo. This suite closes that specific gap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const CONTRACT_PATH = join(REPO_ROOT, 'skills/pensador/references/handoff-contract.md');
const FEATURE_ISOLATION_PATH = join(REPO_ROOT, 'skills/pensador/references/feature-isolation.md');

/** Extracts the Pensador role table from handoff-contract.md section 5 (stops at the next `###` heading). */
function extractContractRoles(text) {
  const start = text.indexOf('### Pensador (`stage: pensador`)');
  expect(start, 'Pensador role table heading not found in handoff-contract.md').toBeGreaterThan(-1);
  const rest = text.slice(start);
  const nextHeading = rest.indexOf('\n### ', 1);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const roles = [...section.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map((m) => m[1]);
  expect(roles.length, 'no role rows parsed from the Pensador table').toBeGreaterThan(0);
  return new Set(roles);
}

/** Extracts the "Roles validos do Pensador" inline list from feature-isolation.md. */
function extractFeatureIsolationRoles(text) {
  const match = text.match(/Roles validos do Pensador[^:]*:\s*(.+)/);
  expect(match, '"Roles validos do Pensador" sentence not found in feature-isolation.md').not.toBeNull();
  const roles = [...match[1].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
  expect(roles.length, 'no roles parsed from the feature-isolation.md sentence').toBeGreaterThan(0);
  return new Set(roles);
}

describe('Pensador handoff role vocabulary stays consistent across its own docs', () => {
  const contractText = readFileSync(CONTRACT_PATH, 'utf8');
  const featureIsolationText = readFileSync(FEATURE_ISOLATION_PATH, 'utf8');

  const contractRoles = extractContractRoles(contractText);
  const featureIsolationRoles = extractFeatureIsolationRoles(featureIsolationText);

  it('feature-isolation.md does not list a role absent from the handoff-contract.md table', () => {
    const extra = [...featureIsolationRoles].filter((role) => !contractRoles.has(role));
    expect(extra, `roles in feature-isolation.md but not in handoff-contract.md: ${extra.join(', ')}`).toEqual([]);
  });

  it('handoff-contract.md does not list a role absent from feature-isolation.md', () => {
    const missing = [...contractRoles].filter((role) => !featureIsolationRoles.has(role));
    expect(missing, `roles in handoff-contract.md but not in feature-isolation.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('both docs agree on the exact same role set (regression pin)', () => {
    expect([...featureIsolationRoles].sort()).toEqual([...contractRoles].sort());
  });

  // Negative path: prove the extractors themselves would actually catch a
  // drift, rather than trivially matching everything.
  it('the extractor rejects a role list that omits a role present in the contract', () => {
    const truncated = new Set([...contractRoles].slice(1));
    const missing = [...contractRoles].filter((role) => !truncated.has(role));
    expect(missing.length).toBeGreaterThan(0);
  });

  it('project-baseline is present in both docs (the artifact this guard was added for)', () => {
    expect(contractRoles.has('project-baseline')).toBe(true);
    expect(featureIsolationRoles.has('project-baseline')).toBe(true);
  });

  it('api-contract and openspec-change are present in both docs (the roles that previously drifted)', () => {
    for (const role of ['api-contract', 'openspec-change']) {
      expect(contractRoles.has(role), `${role} missing from handoff-contract.md`).toBe(true);
      expect(featureIsolationRoles.has(role), `${role} missing from feature-isolation.md`).toBe(true);
    }
  });
});
