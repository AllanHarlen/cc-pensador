import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mapEngineToContract } from '../../scripts/lib/token-mapper.mjs';
import { APPROVAL_FILE, buildApprovalRecord, loadApprovalKey } from '../../scripts/lib/design-approval.mjs';

const DIR = join(fileURLToPath(new URL('../fixtures/engine-output/', import.meta.url)));

export function readFixture(name) {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8'));
}

export function engineFixture() {
  return {
    brand: readFixture('brand.json'),
    seed: readFixture('seed.json'),
    tokens: { default: readFixture('tokens.default.json'), dark: readFixture('tokens.dark.json'), compact: readFixture('tokens.compact.json') },
  };
}

export const EXTRAS = {
  components: [
    { name: 'Button', states: ['default', 'hover', 'focus-visible', 'active', 'disabled', 'loading', 'error', 'empty'] },
    { name: 'Input', states: ['default', 'hover', 'focus-visible', 'disabled', 'error'] },
    { name: 'Card', states: ['default', 'hover', 'focus-visible', 'disabled', 'empty'] },
  ],
  layouts: [{ route: '/', name: 'Painel', viewport: 'responsive' }],
  iconography: { package: 'lucide-react', version: '1.0.0', format: 'vector', usages: { home: 'House' } },
  imagery: { decision: 'required-only', assets: [] },
  microcopy: { tone: 'direct', primaryAction: 'Novo cliente' },
  antiPatterns: ['emoji as icon'],
};

/** A signed v2 contract built from the committed engine output (no engine needed). */
export function fixtureContract(overrides = {}) {
  const { seed, tokens } = engineFixture();
  return mapEngineToContract({
    systemId: 'gestuor',
    seed,
    tokens,
    engine: { version: '0.22.1' },
    seedOrigin: { colorPrimary: 'brief', colorSuccess: 'brief', fontFamily: 'brief' },
    briefRef: 'design-brief.json',
    extras: EXTRAS,
    ...overrides,
  });
}

/** A brief whose LOCKED fields agree with fixtureContract() (teal primary, Inter, 36px controls, radius 8). */
export function fixtureBrief(overrides = {}) {
  const locked = (value) => ({ value, locked: true, questionRef: 'q' });
  return {
    schemaVersion: 1,
    product: { name: 'Gestuor', slug: 'gestuor' },
    fields: {
      colorPrimary: locked('#0F766E'),
      colorSuccess: locked('#16A34A'),
      fontFamily: locked('Inter, sans-serif'),
      fontFamilyCode: locked('JetBrains Mono, monospace'),
      fontSize: locked(14),
      borderRadius: locked(8),
      themeDefault: locked('system'),
      ...overrides.fields,
    },
    issues: [],
    approvedAt: null,
    approvedSha256: null,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'fields')),
  };
}

/**
 * The files the DESIGN stage gate reads (relative to the feature dir): a contract, an audit whose five
 * checks pass, a successful engine run and an approved brief. `over` patches individual files.
 */
export function designEvidence({ id = 'professional', over = {} } = {}) {
  const contract = fixtureContract({ systemId: id });
  const approvedBrief = fixtureBrief({ approvedAt: '2026-09-19T10:00:00.000Z', approvedSha256: contract.sha256 });
  const files = {
    [`design-systems/${id}/resolved/design-contract.json`]: JSON.stringify(contract),
    [`design-systems/${id}/resolved/design-audit.json`]: JSON.stringify({
      status: 'PASS', contractSha256: contract.sha256, findings: [],
      checks: { structure: 'PASS', contrast: 'PASS', conformance: 'PASS', integrity: 'PASS', engineRun: 'PASS' },
    }),
    [`design-systems/${id}/source/engine-run.json`]: JSON.stringify({ status: 'ok', engine: 'clone', contractSha256: contract.sha256 }),
    'design-brief.json': JSON.stringify(approvedBrief),
    [APPROVAL_FILE]: JSON.stringify(buildApprovalRecord({ key: loadApprovalKey({ create: true }), systemId: 'professional', brief: approvedBrief, contractSha256: contract.sha256, approvedAt: approvedBrief.approvedAt })),
  };
  for (const [file, value] of Object.entries(over)) {
    if (value === null) delete files[file];
    else files[file] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return { files, contract };
}
