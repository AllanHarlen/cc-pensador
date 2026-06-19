/**
 * Integration tests — Code Base Memory (mandatory exploration) and OpenSpec
 * (optional spec mode).
 *
 * These pin the deterministic reference behavior added to pensador-engine.mjs:
 *   - CODEBASE_MEMORY registry + codebaseMemorySnapshotPath + exploration plan.
 *   - ARTIFACT_MODES (prd/spec) + resolveArtifactMode + withArtifactMode.
 *   - planArtifacts / buildArtifactList in spec mode (OpenSpec change set).
 */
import { describe, it, expect } from 'vitest';
import {
  CODEBASE_MEMORY,
  codebaseMemorySnapshotPath,
  codebaseMemoryExplorationPlan,
  DEFAULT_ARTIFACT_MODE,
  ARTIFACT_MODES,
  resolveArtifactMode,
  withArtifactMode,
  OPENSPEC,
  openspecChangeName,
  openspecChangeDir,
  OPEN_DESIGN,
  designSystemArtifactPath,
  openDesignBriefPlan,
  initState,
  planArtifacts,
  buildArtifactList,
} from '../scripts/pensador-engine.mjs';

// ---------------------------------------------------------------------------
// Code Base Memory
// ---------------------------------------------------------------------------

describe('Code Base Memory (mandatory exploration)', () => {
  it('exposes the codebase-memory-mcp server descriptor', () => {
    expect(CODEBASE_MEMORY.server).toBe('codebase-memory-mcp');
    expect(CODEBASE_MEMORY.mandatory).toBe(true);
    expect(CODEBASE_MEMORY.snapshotFile).toBe('codebase-memory.md');
    expect(CODEBASE_MEMORY.tools.indexRepository).toBe('index_repository');
    expect(CODEBASE_MEMORY.tools.getArchitecture).toBe('get_architecture');
    expect(CODEBASE_MEMORY.tools.detectChanges).toBe('detect_changes');
  });

  it('codebaseMemorySnapshotPath writes inside the update directory', () => {
    expect(codebaseMemorySnapshotPath('.pensador/login-social-v1')).toBe(
      '.pensador/login-social-v1/codebase-memory.md'
    );
  });

  it('codebaseMemorySnapshotPath falls back when featurePath is null', () => {
    expect(codebaseMemorySnapshotPath(null)).toBe('.pensador/atualizacao-v1/codebase-memory.md');
    expect(codebaseMemorySnapshotPath(undefined)).toBe('.pensador/atualizacao-v1/codebase-memory.md');
  });

  it('exploration plan starts with index then architecture/schema/search/trace', () => {
    expect(codebaseMemoryExplorationPlan()).toEqual([
      'index_repository',
      'get_architecture',
      'get_graph_schema',
      'search_graph',
      'trace_path',
    ]);
  });

  it('appends detect_changes only for a fix over existing code', () => {
    expect(codebaseMemoryExplorationPlan({ isFix: true })).toContain('detect_changes');
    expect(codebaseMemoryExplorationPlan({ isFix: false })).not.toContain('detect_changes');
  });

  it('exploration plan is total — never throws', () => {
    expect(() => codebaseMemoryExplorationPlan()).not.toThrow();
    expect(() => codebaseMemoryExplorationPlan(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Artifact mode (PRD vs OpenSpec)
// ---------------------------------------------------------------------------

describe('artifact mode (PRD vs OpenSpec)', () => {
  it('defaults to prd', () => {
    expect(DEFAULT_ARTIFACT_MODE).toBe('prd');
    expect(initState('x').artifactMode).toBe('prd');
  });

  it('exposes prd and spec modes', () => {
    expect(ARTIFACT_MODES.prd.openspec).toBe(false);
    expect(ARTIFACT_MODES.spec.openspec).toBe(true);
    expect(ARTIFACT_MODES.spec.primaryArtifact).toBe('proposal.md');
  });

  it('resolveArtifactMode normalizes unknown/nullish to prd', () => {
    expect(resolveArtifactMode('spec')).toBe('spec');
    expect(resolveArtifactMode('prd')).toBe('prd');
    expect(resolveArtifactMode('bogus')).toBe('prd');
    expect(resolveArtifactMode(undefined)).toBe('prd');
    expect(resolveArtifactMode(null)).toBe('prd');
  });

  it('withArtifactMode sets the mode without mutating the input', () => {
    const state = initState('Criar uma tela de login');
    const next = withArtifactMode(state, 'spec');
    expect(next.artifactMode).toBe('spec');
    expect(state.artifactMode).toBe('prd');
  });

  it('withArtifactMode normalizes an invalid mode to prd', () => {
    expect(withArtifactMode(initState('x'), 'turbo').artifactMode).toBe('prd');
  });
});

// ---------------------------------------------------------------------------
// OpenSpec descriptor
// ---------------------------------------------------------------------------

describe('OpenSpec descriptor', () => {
  it('pins CLI, dir and openspec-* commands (legacy /opsx:* is deprecated)', () => {
    expect(OPENSPEC.cli).toBe('openspec');
    expect(OPENSPEC.dir).toBe('openspec');
    expect(OPENSPEC.changesDir).toBe('openspec/changes');
    expect(OPENSPEC.optional).toBe(true);
    expect(OPENSPEC.changeFiles).toEqual(['proposal.md', 'design.md', 'tasks.md', 'specs/']);
    expect(OPENSPEC.commands.newChange).toBe('/openspec-new-change');
    expect(OPENSPEC.commands.ffChange).toBe('/openspec-ff-change');
    expect(OPENSPEC.commands.verifyChange).toBe('/openspec-verify-change');
    // No deprecated /opsx:* prefix anywhere in the command set.
    for (const cmd of Object.values(OPENSPEC.commands)) {
      expect(cmd.startsWith('/openspec-')).toBe(true);
      expect(cmd).not.toContain('opsx');
    }
  });

  it('derives the change name and directory from the feature path', () => {
    expect(openspecChangeName('.pensador/login-social-v1')).toBe('login-social-v1');
    expect(openspecChangeName(null)).toBe('atualizacao-v1');
    expect(openspecChangeDir('.pensador/login-social-v1')).toBe(
      'openspec/changes/login-social-v1'
    );
    expect(openspecChangeDir(null)).toBe('openspec/changes/atualizacao-v1');
  });
});

// ---------------------------------------------------------------------------
// Spec-mode artifact planning
// ---------------------------------------------------------------------------

/** Builds a FINAL-stage state in the given artifact mode with the given consolidated reqs. */
function finalState(artifactMode, consolidated = []) {
  return { ...initState('demanda'), currentStage: 'FINAL', artifactMode, consolidated };
}

const backendReq = { id: 'b1', source: 'expand', text: 'REST API with a database backend' };
const frontendReq = { id: 'f1', source: 'expand', text: 'A React frontend UI component' };

describe('planArtifacts in spec mode', () => {
  it('delivers only the OpenSpec change set (no prd/userhistory/comunication)', () => {
    const plan = planArtifacts(finalState('spec', [frontendReq]));
    expect(plan.prd).toBe(false);
    expect(plan.proposal).toBe(true);
    expect(plan.specs).toBe(true);
    expect(plan.design).toBe(true);
    expect(plan.tasks).toBe(true);
    expect(plan.userhistory).toBe(false);
    expect(plan.comunication).toBe(false);
  });

  it('drops comunication even when a back-end is present (spec mode)', () => {
    const plan = planArtifacts(finalState('spec', [backendReq]));
    expect(plan.comunication).toBe(false);
    expect(plan.userhistory).toBe(false);
  });

  it('keeps prd mode unchanged (prd + userhistory + comunication on backend)', () => {
    const plan = planArtifacts(finalState('prd', [backendReq]));
    expect(plan.prd).toBe(true);
    expect(plan.proposal).toBe(false);
    expect(plan.userhistory).toBe(true);
    expect(plan.comunication).toBe(true);
  });

  it('returns an empty plan outside FINAL/DONE regardless of mode', () => {
    const plan = planArtifacts({ ...initState('x'), currentStage: 'EXPLORE', artifactMode: 'spec' });
    expect(plan.proposal).toBe(false);
    expect(plan.prd).toBe(false);
  });
});

describe('buildArtifactList in spec mode', () => {
  it('emits only proposal/design/tasks/specs (no prd/userhistory/comunication)', () => {
    const kinds = buildArtifactList(finalState('spec', [backendReq])).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['proposal', 'design', 'tasks', 'specs']));
    expect(kinds).not.toContain('prd');
    expect(kinds).not.toContain('userhistory');
    expect(kinds).not.toContain('comunication');
    expect(kinds).toHaveLength(4);
  });

  it('writes spec artifacts under openspec/changes/<name>/ (not .pensador/)', () => {
    const state = { ...finalState('spec', [frontendReq]), featurePath: '.pensador/login-social-v1' };
    const artifacts = buildArtifactList(state);
    const proposal = artifacts.find((a) => a.kind === 'proposal');
    expect(proposal.path).toBe('openspec/changes/login-social-v1/proposal.md');
    expect(proposal.managedBy).toBe('openspec');
    const specs = artifacts.find((a) => a.kind === 'specs');
    expect(specs.path).toBe('openspec/changes/login-social-v1/specs/');
    for (const a of artifacts) {
      expect(a.path.startsWith('openspec/changes/')).toBe(true);
      expect(a.managedBy).toBe('openspec');
    }
  });

  it('prd mode emits design-system for a front-end demand (prd + userhistory + design-system)', () => {
    const kinds = buildArtifactList(finalState('prd', [frontendReq])).map((a) => a.kind);
    expect(kinds).toEqual(['prd', 'userhistory', 'design-system']);
  });
});

// ---------------------------------------------------------------------------
// Open Design (design-system support for front-end work)
// ---------------------------------------------------------------------------

describe('Open Design descriptor', () => {
  it('exposes the od CLI descriptor and DESIGN.md schema', () => {
    expect(OPEN_DESIGN.cli).toBe('od');
    expect(OPEN_DESIGN.optional).toBe(true);
    expect(OPEN_DESIGN.relevantWhen).toBe('hasFrontend');
    expect(OPEN_DESIGN.designSystemFile).toBe('design-system.md');
    // The 9-section DESIGN.md brand contract.
    expect(OPEN_DESIGN.designSchema).toEqual([
      'color',
      'typography',
      'spacing',
      'layout',
      'components',
      'motion',
      'voice',
      'brand',
      'anti-patterns',
    ]);
    // Open Design is a local-first app (Docker or pnpm), offered via an installer script.
    expect(OPEN_DESIGN.installCommands.scriptWindows).toContain('install-open-design.ps1');
    expect(OPEN_DESIGN.installCommands.scriptUnix).toContain('install-open-design.sh');
    expect(OPEN_DESIGN.installCommands.docker).toContain('docker compose up');
    expect(OPEN_DESIGN.installCommands.docker).toContain('nexu-io/open-design');
    expect(OPEN_DESIGN.installCommands.local).toContain('pnpm tools-dev');
    // `od mcp install` is the real post-setup wiring step.
    expect(OPEN_DESIGN.installCommands.mcp).toContain('od mcp install');
    // Real design verbs the Pensador drives.
    expect(OPEN_DESIGN.commands.designSystemsList).toContain('od design-systems list');
    expect(OPEN_DESIGN.commands.designSystemShow).toContain('od design-systems show');
    expect(OPEN_DESIGN.commands.mcpInstall).toContain('od mcp install');
    expect(OPEN_DESIGN.commands.mcpConfigHelper).toContain('od-mcp-config.mjs');
    // Docker-friendly REST fallback the verbs wrap.
    expect(OPEN_DESIGN.commands.apiDesignSystems).toContain('/api/design-systems');
    // The dead one-line installer must never come back.
    expect(JSON.stringify(OPEN_DESIGN.installCommands)).not.toContain('open-design.ai/install.sh');
    expect(JSON.stringify(OPEN_DESIGN.commands)).not.toContain('open-design.ai/install.sh');
  });

  it('designSystemArtifactPath writes inside the update directory', () => {
    expect(designSystemArtifactPath('.pensador/locadora-v1')).toBe(
      '.pensador/locadora-v1/design-system.md'
    );
  });

  it('designSystemArtifactPath falls back when featurePath is null/undefined', () => {
    expect(designSystemArtifactPath(null)).toBe('.pensador/atualizacao-v1/design-system.md');
    expect(designSystemArtifactPath(undefined)).toBe('.pensador/atualizacao-v1/design-system.md');
  });

  it('openDesignBriefPlan covers every design dimension and never throws', () => {
    const plan = openDesignBriefPlan();
    expect(plan).toEqual([
      'visualTone',
      'brandReferences',
      'colorPalette',
      'typography',
      'componentStates',
      'responsiveness',
      'accessibility',
      'microcopy',
    ]);
    expect(() => openDesignBriefPlan()).not.toThrow();
  });
});

describe('design-system artifact planning (PRD mode, front-end gated)', () => {
  it('plans design-system when the demand has a front-end', () => {
    const plan = planArtifacts(finalState('prd', [frontendReq]));
    expect(plan.designSystem).toBe(true);
  });

  it('does NOT plan design-system for a back-end-only demand', () => {
    const plan = planArtifacts(finalState('prd', [backendReq]));
    expect(plan.designSystem).toBe(false);
  });

  it('never plans design-system in spec mode', () => {
    const plan = planArtifacts(finalState('spec', [frontendReq]));
    expect(plan.designSystem).toBe(false);
  });

  it('buildArtifactList includes a design-system artifact with the right filename/path', () => {
    const state = { ...finalState('prd', [frontendReq]), featurePath: '.pensador/locadora-v1' };
    const ds = buildArtifactList(state).find((a) => a.kind === 'design-system');
    expect(ds).toBeDefined();
    expect(ds.filename).toBe('design-system.md');
    expect(ds.path).toBe('.pensador/locadora-v1/design-system.md');
  });

  it('fullstack demand emits prd + userhistory + comunication + design-system', () => {
    const kinds = buildArtifactList(finalState('prd', [backendReq, frontendReq])).map((a) => a.kind);
    expect(kinds).toEqual(['prd', 'userhistory', 'comunication', 'design-system']);
  });
});
