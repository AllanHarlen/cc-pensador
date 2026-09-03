/**
 * Unit tests for scripts/lib/handoff-validator.mjs.
 *
 * `handoff.json` is the single discovery anchor between the three workflow
 * plugins (handoff-contract.md section 4), and until this validator existed
 * no code anywhere checked that a producer actually wrote one conforming to
 * the contract. These tests cover both directions: a well-formed handoff for
 * each stage validates clean (positive), and each specific contract
 * violation is caught with the right error code (negative) — including the
 * exact drift this validator exists to prevent (an artifact role that is not
 * in the vocabulary for its stage).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  validateHandoff,
  HANDOFF_ROLES_BY_STAGE,
  HANDOFF_STAGES,
  HANDOFF_STATUSES,
  SUPPORTED_HANDOFF_VERSION,
} from '../scripts/lib/handoff-validator.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONTRACT_PATH = join(REPO_ROOT, 'skills/pensador/references/handoff-contract.md');

/** A minimal, valid Pensador-stage handoff — the baseline every negative test mutates from. */
function validPensadorHandoff(overrides = {}) {
  return {
    handoffVersion: 1,
    stage: 'pensador',
    slug: 'login-social',
    artifactMode: 'prd',
    producer: { plugin: 'cc-pensador', version: '2.15.0' },
    artifactRoot: '.pensador/login-social-v1',
    status: 'DONE',
    createdAt: '2026-06-18T15:40:00.000Z',
    updatedAt: '2026-06-18T15:40:00.000Z',
    summary: 'PRD, arquitetura, contrato de API e baseline do projeto para login social.',
    upstream: null,
    artifacts: [
      { role: 'prd', path: 'prd.md', required: true, description: 'PRD consolidado' },
      { role: 'architecture', path: 'architecture.md', required: true, description: 'Arquitetura alvo' },
      { role: 'project-baseline', path: 'project-baseline.json', required: true, description: 'Baseline maquina-legivel' },
    ],
    nextStage: { consumer: 'cc-orchestrador-subagents', entrypoint: '/orchestrador', instructions: 'Ingerir os artefatos e implementar o plano.' },
    ...overrides,
  };
}

function validOrchestradorHandoff(overrides = {}) {
  return {
    handoffVersion: 1,
    stage: 'orchestrador',
    slug: 'login-social',
    producer: { plugin: 'cc-orchestrador-subagents', version: '3.0.0' },
    artifactRoot: '.orchestration/login-social',
    status: 'DONE',
    createdAt: '2026-06-19T10:00:00.000Z',
    updatedAt: '2026-06-19T18:00:00.000Z',
    summary: 'Implementacao completa, reviews aprovados, E2E verificado.',
    upstream: { stage: 'pensador', handoffPath: '.pensador/login-social-v1/handoff.json' },
    artifacts: [
      { role: 'implementation-report', path: 'report/implementation-report.md', required: true },
      { role: 'review-final', path: 'review/review-final.md', required: true },
    ],
    nextStage: { consumer: 'cc-executor-subagents', entrypoint: '/executor', instructions: 'Review plano-vs-entrega e ajustes finos.' },
    ...overrides,
  };
}

function validTestadorHandoff(overrides = {}) {
  return {
    handoffVersion: 1,
    stage: 'testador',
    slug: 'login-social',
    producer: { plugin: 'cc-testador-subagents', version: '1.0.0' },
    artifactRoot: '.testador/login-social/artefatos',
    status: 'DONE',
    createdAt: '2026-06-20T08:00:00.000Z',
    updatedAt: '2026-06-20T10:00:00.000Z',
    summary: 'Validacao aprovada: 0 achados bloqueantes.',
    upstream: { stage: 'orchestrador', handoffPath: '.orchestration/login-social/report/handoff.json' },
    artifacts: [
      { role: 'test-report', path: 'review/test-report.md', required: true },
      { role: 'monitoring', path: 'run/monitoring.md', required: true },
    ],
    nextStage: { consumer: 'cc-executor-subagents', entrypoint: '/executor' },
    ...overrides,
  };
}

function validExecutorHandoff(overrides = {}) {
  return {
    handoffVersion: 1,
    stage: 'executor',
    slug: 'login-social',
    producer: { plugin: 'cc-executor-subagents', version: '2.4.0' },
    artifactRoot: '.executor/login-social/artefatos',
    status: 'DONE',
    createdAt: '2026-06-20T09:00:00.000Z',
    updatedAt: '2026-06-20T11:00:00.000Z',
    summary: 'Correcoes aplicadas, review plano-vs-entrega aprovado.',
    upstream: { stage: 'orchestrador', handoffPath: '.orchestration/login-social/report/handoff.json' },
    artifacts: [
      { role: 'plan-vs-output-review', path: 'plan-vs-output-review.md', required: true },
      { role: 'implementation-report', path: 'report/implementation-report.md', required: true },
    ],
    nextStage: null,
    ...overrides,
  };
}

describe('validateHandoff — positive path (well-formed handoffs)', () => {
  it('accepts a well-formed Pensador handoff', () => {
    const result = validateHandoff(validPensadorHandoff());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed Orchestrador handoff (joint mode, with upstream)', () => {
    const result = validateHandoff(validOrchestradorHandoff());
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed Orchestrador handoff in independent mode (upstream: null)', () => {
    const result = validateHandoff(validOrchestradorHandoff({ upstream: null }));
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed Executor handoff (terminal stage, nextStage: null)', () => {
    const result = validateHandoff(validExecutorHandoff());
    expect(result.ok).toBe(true);
  });

  it('accepts status PARTIAL/BLOCKED when summary actually explains the gap', () => {
    const result = validateHandoff(
      validOrchestradorHandoff({ status: 'PARTIAL', summary: 'E2E nao verificado: Playwright MCP indisponivel neste ambiente.' }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts every role declared for each stage in HANDOFF_ROLES_BY_STAGE', () => {
    for (const stage of HANDOFF_STAGES) {
      for (const role of HANDOFF_ROLES_BY_STAGE[stage]) {
        const base = stage === 'pensador'
          ? validPensadorHandoff()
          : stage === 'orchestrador'
            ? validOrchestradorHandoff()
            : stage === 'testador'
              ? validTestadorHandoff()
              : validExecutorHandoff();
        const result = validateHandoff({ ...base, artifacts: [{ role, path: 'x', required: true }] });
        expect(result.ok, `role ${role} should be valid for stage ${stage}: ${JSON.stringify(result.errors)}`).toBe(true);
      }
    }
  });
});

describe('validateHandoff — negative path (contract violations)', () => {
  it('rejects a non-object payload', () => {
    const result = validateHandoff('not an object');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_ENVELOPE');
  });

  it('rejects null', () => {
    expect(validateHandoff(null).ok).toBe(false);
  });

  it('rejects a handoffVersion other than the supported one, and stops there (no secondary errors)', () => {
    const result = validateHandoff(validPensadorHandoff({ handoffVersion: 2 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('UNSUPPORTED_HANDOFF_VERSION');
  });

  it('rejects a stage outside the enum', () => {
    const result = validateHandoff(validPensadorHandoff({ stage: 'orquestrador' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_STAGE')).toBe(true);
  });

  it('rejects an empty slug', () => {
    const result = validateHandoff(validPensadorHandoff({ slug: '' }));
    expect(result.errors.some((e) => e.code === 'INVALID_SLUG')).toBe(true);
  });

  it('rejects a missing producer.version', () => {
    const result = validateHandoff(validPensadorHandoff({ producer: { plugin: 'cc-pensador' } }));
    expect(result.errors.some((e) => e.code === 'INVALID_PRODUCER')).toBe(true);
  });

  it('rejects a status outside the enum', () => {
    const result = validateHandoff(validPensadorHandoff({ status: 'FINISHED' }));
    expect(result.errors.some((e) => e.code === 'INVALID_STATUS')).toBe(true);
  });

  it('rejects a non-ISO createdAt/updatedAt', () => {
    const result = validateHandoff(validPensadorHandoff({ createdAt: 'yesterday' }));
    expect(result.errors.some((e) => e.code === 'INVALID_CREATED_AT')).toBe(true);
  });

  it('rejects an empty summary', () => {
    const result = validateHandoff(validPensadorHandoff({ summary: '' }));
    expect(result.errors.some((e) => e.code === 'INVALID_SUMMARY')).toBe(true);
  });

  it('rejects a PARTIAL/BLOCKED status with a near-empty summary (defeats the field\'s purpose)', () => {
    const result = validateHandoff(validOrchestradorHandoff({ status: 'BLOCKED', summary: 'n/a' }));
    expect(result.errors.some((e) => e.code === 'SUMMARY_TOO_SHORT_FOR_NON_DONE_STATUS')).toBe(true);
  });

  it('rejects a Pensador handoff with a non-null upstream (it is always the first stage)', () => {
    const result = validateHandoff(validPensadorHandoff({ upstream: { stage: 'orchestrador', handoffPath: 'x' } }));
    expect(result.errors.some((e) => e.code === 'PENSADOR_CANNOT_HAVE_UPSTREAM')).toBe(true);
  });

  it('rejects an upstream missing handoffPath', () => {
    const result = validateHandoff(validOrchestradorHandoff({ upstream: { stage: 'pensador' } }));
    expect(result.errors.some((e) => e.code === 'INVALID_UPSTREAM')).toBe(true);
  });

  it('rejects artifacts that is not an array', () => {
    const result = validateHandoff(validPensadorHandoff({ artifacts: {} }));
    expect(result.errors.some((e) => e.code === 'INVALID_ARTIFACTS')).toBe(true);
  });

  it('rejects an artifact entry missing required', () => {
    const result = validateHandoff(validPensadorHandoff({ artifacts: [{ role: 'prd', path: 'prd.md' }] }));
    expect(result.errors.some((e) => e.code === 'INVALID_ARTIFACT_REQUIRED')).toBe(true);
  });

  it('rejects an artifact entry missing path', () => {
    const result = validateHandoff(validPensadorHandoff({ artifacts: [{ role: 'prd', required: true }] }));
    expect(result.errors.some((e) => e.code === 'INVALID_ARTIFACT_PATH')).toBe(true);
  });

  // The exact bug class this validator exists to catch: E1 from the audit —
  // a role the engine never emits for that stage, or a stage-crossed role
  // (e.g. an Orchestrador-only role claimed by a Pensador handoff).
  it('rejects an artifact role that is not in the vocabulary for the declared stage', () => {
    const result = validateHandoff(validPensadorHandoff({ artifacts: [{ role: 'review-final', path: 'x', required: true }] }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_ARTIFACT_ROLE')).toBe(true);
  });

  it('rejects a role valid for the Orchestrador but claimed by an Executor handoff', () => {
    const result = validateHandoff(validExecutorHandoff({ artifacts: [{ role: 'tasks-classification', path: 'x', required: true }] }));
    expect(result.errors.some((e) => e.code === 'UNKNOWN_ARTIFACT_ROLE')).toBe(true);
  });

  it('rejects artifactMode on a non-Pensador stage', () => {
    const result = validateHandoff(validOrchestradorHandoff({ artifactMode: 'prd' }));
    expect(result.errors.some((e) => e.code === 'ARTIFACT_MODE_ONLY_ON_PENSADOR')).toBe(true);
  });

  it('rejects an artifactMode outside prd|spec', () => {
    const result = validateHandoff(validPensadorHandoff({ artifactMode: 'markdown' }));
    expect(result.errors.some((e) => e.code === 'INVALID_ARTIFACT_MODE')).toBe(true);
  });

  it('rejects a nextStage missing entrypoint', () => {
    const result = validateHandoff(validPensadorHandoff({ nextStage: { consumer: 'cc-orchestrador-subagents' } }));
    expect(result.errors.some((e) => e.code === 'INVALID_NEXT_STAGE')).toBe(true);
  });

  it('flags (without failing structurally elsewhere) an Executor handoff with a non-null nextStage', () => {
    const result = validateHandoff(validExecutorHandoff({ nextStage: { consumer: 'x', entrypoint: '/y' } }));
    expect(result.errors.some((e) => e.code === 'EXECUTOR_NEXT_STAGE_SHOULD_BE_NULL')).toBe(true);
  });

  it('collects multiple independent errors in one pass instead of stopping at the first', () => {
    const result = validateHandoff(validPensadorHandoff({ slug: '', status: 'FINISHED', summary: '' }));
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('INVALID_SLUG');
    expect(codes).toContain('INVALID_STATUS');
    expect(codes).toContain('INVALID_SUMMARY');
  });
});

describe('HANDOFF_ROLES_BY_STAGE stays in lockstep with handoff-contract.md section 5', () => {
  const contractText = readFileSync(CONTRACT_PATH, 'utf8');

  function extractStageRoles(stageHeading) {
    const start = contractText.indexOf(stageHeading);
    expect(start, `heading not found: ${stageHeading}`).toBeGreaterThan(-1);
    const rest = contractText.slice(start);
    const nextHeading = rest.indexOf('\n### ', 1);
    const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    return new Set([...section.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]));
  }

  it('pensador role set matches the contract table', () => {
    expect(new Set(HANDOFF_ROLES_BY_STAGE.pensador)).toEqual(extractStageRoles('### Pensador (`stage: pensador`)'));
  });

  it('orchestrador role set matches the contract table', () => {
    expect(new Set(HANDOFF_ROLES_BY_STAGE.orchestrador)).toEqual(extractStageRoles('### Orchestrador (`stage: orchestrador`)'));
  });

  it('testador role set matches the contract table', () => {
    expect(new Set(HANDOFF_ROLES_BY_STAGE.testador)).toEqual(extractStageRoles('### Testador (`stage: testador`)'));
  });

  it('executor role set matches the contract table', () => {
    expect(new Set(HANDOFF_ROLES_BY_STAGE.executor)).toEqual(extractStageRoles('### Executor (`stage: executor`)'));
  });
});

describe('exported constants', () => {
  it('SUPPORTED_HANDOFF_VERSION is 1 (matches HANDOFF_VERSION in handoff-contract.md)', () => {
    expect(SUPPORTED_HANDOFF_VERSION).toBe(1);
    expect(readFileSync(CONTRACT_PATH, 'utf8')).toContain('`HANDOFF_VERSION = 1`');
  });

  it('HANDOFF_STAGES and HANDOFF_STATUSES are frozen (cannot be mutated by a caller)', () => {
    expect(Object.isFrozen(HANDOFF_STAGES)).toBe(true);
    expect(Object.isFrozen(HANDOFF_STATUSES)).toBe(true);
  });
});

describe('validate-handoff.mjs CLI', () => {
  it('exits 0 and reports ok:true for a valid handoff file', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'handoff-cli-test-'));
    try {
      const file = join(dir, 'handoff.json');
      writeFileSync(file, JSON.stringify(validPensadorHandoff()));
      const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/validate-handoff.mjs'), '--file', file], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 and reports the violation for an invalid handoff file', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'handoff-cli-test-'));
    try {
      const file = join(dir, 'handoff.json');
      writeFileSync(file, JSON.stringify(validPensadorHandoff({ artifacts: [{ role: 'review-final', path: 'x', required: true }] })));
      const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/validate-handoff.mjs'), '--file', file], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.errors.some((e) => e.code === 'UNKNOWN_ARTIFACT_ROLE')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with a clear error when --file is missing', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/validate-handoff.mjs')], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors[0].code).toBe('MISSING_FILE_ARG');
  });

  it('exits 1 with a clear error when the file does not exist', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/validate-handoff.mjs'), '--file', 'does/not/exist.json'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors[0].code).toBe('FILE_NOT_READABLE');
  });

  it('exits 1 with a clear error when the file is not valid JSON', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'handoff-cli-test-'));
    try {
      const file = join(dir, 'handoff.json');
      writeFileSync(file, '{ not valid json');
      const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/validate-handoff.mjs'), '--file', file], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).errors[0].code).toBe('INVALID_JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
