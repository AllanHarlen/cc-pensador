/**
 * Preflight DETECTION tests — the two probes whose failure modes are silent.
 *
 * These spawn `scripts/preflight.mjs` with a synthetic HOME and cwd, because the
 * detection functions are script-internal (not exported) and their whole point is
 * reading the real filesystem.
 *
 * Why they exist:
 *   - OpenSpec `profile`: reporting "core" when NO `openspec-*` skill is installed
 *     made INIT offer Spec mode, and `PRD_BASE` then invoked a `/opsx:propose`
 *     that does not exist — a late abort the integration exists to prevent.
 *   - Context7: detection used to substring-scan `~/.claude.json`, which is Claude
 *     Code's whole user config (100+ KB of per-project `allowedTools`, example
 *     paths and history). A stray `ctx7`/`context7` there marked the server
 *     available, and RESEARCH only found out mid-flow when the MCP call failed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFLIGHT = join(ROOT, 'scripts', 'preflight.mjs');

/** The forward-slash form Claude Code uses for `projects` keys in ~/.claude.json. */
const asProjectKey = (p) => p.split(String.fromCharCode(92)).join('/');

let SANDBOX;
let seq = 0;

beforeAll(() => {
  SANDBOX = join(tmpdir(), `pensador-preflight-${process.pid}`);
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });
});
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

/**
 * Runs the preflight in an isolated HOME + cwd and returns its parsed report.
 *
 * `claudeJson` may be a function receiving the run's cwd, so a test can register
 * an MCP server under the exact project key this run will look for.
 *
 * @param {{
 *   claudeJson?: object | ((cwd: string) => object),
 *   projectSkills?: string[],
 *   homeSkills?: string[],
 *   mcpJson?: object,  // written to <cwd>/.mcp.json (project-level MCP registration)
 *   extraPath?: string,  // directory prepended to PATH (e.g. a fake `od` shim)
 * }} [setup]
 */
function runPreflight(setup = {}) {
  const base = join(SANDBOX, `case-${seq++}`);
  const home = join(base, 'home');
  const cwd = join(base, 'proj');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });

  const config =
    typeof setup.claudeJson === 'function' ? setup.claudeJson(cwd) : setup.claudeJson;
  if (config) writeFileSync(join(home, '.claude.json'), JSON.stringify(config));

  if (setup.mcpJson) writeFileSync(join(cwd, '.mcp.json'), JSON.stringify(setup.mcpJson));

  for (const name of setup.projectSkills ?? []) {
    const dir = join(cwd, '.claude', 'skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n`);
  }
  for (const name of setup.homeSkills ?? []) {
    const dir = join(home, '.claude', 'skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n`);
  }

  const path = setup.extraPath
    ? `${setup.extraPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`
    : process.env.PATH;

  const out = execFileSync(process.execPath, [PREFLIGHT], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/**
 * Writes a fake `od` shim on PATH that prints a given first line for
 * `--version`. Used to simulate GNU coreutils' unrelated `od` (octal-dump)
 * binary, which collides by name with the Open Design CLI.
 */
function fakeOdBinary(versionLine) {
  const dir = join(SANDBOX, `od-shim-${seq++}`);
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'od.cmd'), `@echo off\r\necho ${versionLine}\r\n`);
  } else {
    const script = join(dir, 'od');
    writeFileSync(script, `#!/bin/sh\necho "${versionLine}"\n`);
    chmodSync(script, 0o755);
  }
  return dir;
}

/** Writes a fake binary shim on PATH that prints `versionLine` for `--version`. */
function fakeBinary(name, versionLine) {
  const dir = join(SANDBOX, `bin-shim-${seq++}`);
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(dir, `${name}.cmd`), `@echo off\r\necho ${versionLine}\r\n`);
  } else {
    const script = join(dir, name);
    writeFileSync(script, `#!/bin/sh\necho "${versionLine}"\n`);
    chmodSync(script, 0o755);
  }
  return dir;
}

const TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// OpenSpec profile — core / expanded / none
// ---------------------------------------------------------------------------

describe('preflight: OpenSpec profile detection', () => {
  it('reports "none" and suppresses Spec mode when no openspec-* skill exists', () => {
    const os = runPreflight().integrations.openspec;
    expect(os.profile).toBe('none');
    // Even with a compatible CLI on PATH, Spec mode must NOT be offered: without
    // the skills the /opsx:* commands do not exist.
    expect(os.available).toBe(false);
    expect(os.optional).toBe(true);
  }, TIMEOUT);

  it('never moves the overall status, available or not', () => {
    // The sandbox HOME has no plugin cache, so the status reflects the other
    // (mandatory) integrations. What matters is that it is IDENTICAL whether or
    // not OpenSpec is usable — that is the "optional, never gates" invariant.
    const without = runPreflight();
    const with_ = runPreflight({ projectSkills: ['openspec-propose'] });
    expect(without.integrations.openspec.available).toBe(false);
    expect(with_.integrations.openspec.available).toBe(true);
    expect(with_.status).toBe(without.status);
  }, TIMEOUT * 2);

  it('reports "core" from a project-level core skill', () => {
    const report = runPreflight({ projectSkills: ['openspec-propose'] });
    expect(report.integrations.openspec.profile).toBe('core');
  }, TIMEOUT);

  it('reports "core" from a user-level (~/.claude/skills) install', () => {
    const report = runPreflight({ homeSkills: ['openspec-apply-change'] });
    expect(report.integrations.openspec.profile).toBe('core');
  }, TIMEOUT);

  it('reports "expanded" only when an expanded-profile skill is present', () => {
    const report = runPreflight({
      projectSkills: ['openspec-propose', 'openspec-verify-change'],
    });
    expect(report.integrations.openspec.profile).toBe('expanded');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// Context7 — structured MCP registration, not substring scanning
// ---------------------------------------------------------------------------

describe('preflight: Context7 detection', () => {
  it('ignores ctx7/context7 text outside mcpServers (history, allowedTools, paths)', () => {
    const report = runPreflight({
      claudeJson: (cwd) => ({
        projects: {
          [asProjectKey(cwd)]: {
            allowedTools: ['Bash(npx ctx7 setup)'],
            history: [{ display: 'como uso o context7 aqui?' }],
            exampleFiles: ['src/ctx7-helper.ts'],
          },
        },
      }),
    });
    expect(report.integrations.context7.available).toBe(false);
  }, TIMEOUT);

  it('detects a server registered at the config root', () => {
    const report = runPreflight({
      claudeJson: { mcpServers: { context7: { command: 'npx' } } },
    });
    const c7 = report.integrations.context7;
    expect(c7.available).toBe(true);
    expect(c7.evidence.some((e) => e.server === 'context7')).toBe(true);
  }, TIMEOUT);

  it('matches the current project even though its key uses forward slashes', () => {
    // process.cwd() is backslash-separated on Windows while the stored key is
    // not; without normalization this is a silent false negative.
    const report = runPreflight({
      claudeJson: (cwd) => ({
        projects: { [asProjectKey(cwd)]: { mcpServers: { context7: { command: 'npx' } } } },
      }),
    });
    expect(report.integrations.context7.available).toBe(true);
  }, TIMEOUT);

  it('normalizes trailing separator and case in the project key', () => {
    const report = runPreflight({
      claudeJson: (cwd) => ({
        projects: {
          [`${asProjectKey(cwd).toUpperCase()}/`]: {
            mcpServers: { context7: { command: 'npx' } },
          },
        },
      }),
    });
    expect(report.integrations.context7.available).toBe(true);
  }, TIMEOUT);

  it('does not count a server disabled for the project', () => {
    const report = runPreflight({
      claudeJson: (cwd) => ({
        projects: {
          [asProjectKey(cwd)]: {
            mcpServers: { context7: { command: 'npx' } },
            disabledMcpjsonServers: ['context7'],
          },
        },
      }),
    });
    expect(report.integrations.context7.available).toBe(false);
  }, TIMEOUT);

  it('does not match a registration belonging to a different project', () => {
    const report = runPreflight({
      claudeJson: {
        projects: { 'C:/Users/someone/OtherProject': { mcpServers: { context7: {} } } },
      },
    });
    expect(report.integrations.context7.available).toBe(false);
  }, TIMEOUT);

  it('identifies a server registered under a custom name by its package spec', () => {
    const report = runPreflight({
      claudeJson: {
        mcpServers: {
          'docs-lookup': { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        },
      },
    });
    const c7 = report.integrations.context7;
    expect(c7.available).toBe(true);
    expect(c7.evidence.some((e) => e.server === 'docs-lookup')).toBe(true);
  }, TIMEOUT);

  it('survives a malformed mcpServers without treating it as evidence', () => {
    const report = runPreflight({ claudeJson: { mcpServers: null } });
    expect(report.integrations.context7.available).toBe(false);
  }, TIMEOUT);

  it('is available via a ctx7 binary on PATH even with no config registration at all', () => {
    const shim = fakeBinary('ctx7', 'ctx7 0.4.0');
    const report = runPreflight({ extraPath: shim });
    expect(report.integrations.context7.available).toBe(true);
    expect(report.integrations.context7.evidence.some((e) => e.type === 'binary')).toBe(true);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// Codebase Memory — checkCodebaseMemory() used to rely on the raw-substring
// fileMentions() (no JSON parse, no disabled-server exclusion): the exact
// false-positive class the Context7 checks above already guard against.
// findMcpServerAcrossCandidates() closes that gap here too.
// ---------------------------------------------------------------------------

describe('preflight: Codebase Memory detection', () => {
  // These two assert `.configured` (the config-only signal), not `.available`
  // (`cli.ok || configured`): a dev machine that happens to have the real
  // `codebase-memory-mcp` binary on PATH would otherwise make `available`
  // true regardless of what the config-detection logic under test decides.

  it('does not count a server disabled for the project', () => {
    const report = runPreflight({
      claudeJson: (cwd) => ({
        projects: {
          [asProjectKey(cwd)]: {
            mcpServers: { 'codebase-memory-mcp': { command: 'node' } },
            disabledMcpjsonServers: ['codebase-memory-mcp'],
          },
        },
      }),
    });
    expect(report.integrations.codebaseMemory.configured).toBe(false);
  }, TIMEOUT);

  it('ignores an unrelated "codebase-memory-mcp" mention outside mcpServers', () => {
    const report = runPreflight({
      claudeJson: {
        mcpServers: { unrelated: { command: 'node', args: ['./codebase-memory-mcp-notes.js'] } },
      },
    });
    expect(report.integrations.codebaseMemory.configured).toBe(false);
  }, TIMEOUT);

  it('detects a server registered only under .kiro/settings/mcp.json', () => {
    const base = join(SANDBOX, `case-${seq++}`);
    const home = join(base, 'home');
    const cwd = join(base, 'proj');
    mkdirSync(join(cwd, '.kiro', 'settings'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(cwd, '.kiro', 'settings', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'codebase-memory-mcp': { command: 'node' } } }),
    );
    const out = execFileSync(process.execPath, [PREFLIGHT], {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
    expect(JSON.parse(out).integrations.codebaseMemory.available).toBe(true);
  }, TIMEOUT);

  it('counts an installed codebase-memory skill as evidence even with no config entry', () => {
    const report = runPreflight({ homeSkills: ['codebase-memory-mcp'] });
    const cbm = report.integrations.codebaseMemory;
    expect(cbm.available).toBe(true);
    expect(cbm.evidence.some((e) => e.type === 'skill')).toBe(true);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// Open Design — checkOpenDesign() had NO test coverage at all: the coreutils
// false-positive filter, the `available` formula and the full
// integrations.openDesign payload shape were unguarded. See the OpenDesign
// upgrade plan (Bucket A, item 9 / Workstream B).
// ---------------------------------------------------------------------------

describe('preflight: Open Design detection', () => {
  it('reports unavailable/unconfigured with no od on PATH and no MCP registration', () => {
    const od = runPreflight().integrations.openDesign;
    expect(od.available).toBe(false);
    expect(od.configured).toBe(false);
    expect(od.configuredIn).toEqual([]);
    expect(od.mcpFunctional).toBe(false);
    expect(od.optional).toBe(true);
    expect(od.relevantWhen).toBe('hasFrontend');
  }, TIMEOUT);

  it('never moves the overall status, available or not', () => {
    const without = runPreflight();
    const withMcp = runPreflight({ mcpJson: { mcpServers: { 'open-design': { command: 'node', args: [] } } } });
    expect(without.integrations.openDesign.available).toBe(false);
    expect(withMcp.integrations.openDesign.available).toBe(true);
    expect(withMcp.status).toBe(without.status);
  }, TIMEOUT * 2);

  it('ignores GNU coreutils\' od (octal-dump) — the classic false positive', () => {
    const shim = fakeOdBinary('od (GNU coreutils) 9.4');
    const od = runPreflight({ extraPath: shim }).integrations.openDesign;
    expect(od.cliCheck.ok).toBe(false);
    expect(od.cliCheck.error).toMatch(/coreutils/i);
    expect(od.available).toBe(false);
    expect(od.mcpFunctional).toBe(false);
  }, TIMEOUT);

  it('treats a non-coreutils od on PATH as the real CLI: available AND mcpFunctional', () => {
    const shim = fakeOdBinary('od (Open Design CLI) 0.20.2');
    const od = runPreflight({ extraPath: shim }).integrations.openDesign;
    expect(od.cliCheck.ok).toBe(true);
    expect(od.available).toBe(true);
    expect(od.mcpFunctional).toBe(true);
  }, TIMEOUT);

  it('configured via project .mcp.json is available but NOT mcpFunctional without a real od binary', () => {
    // available = cli.ok || configured — a registered MCP entry makes the REST/
    // daemon path usable, but the MCP stdio bridge (`od mcp`) still needs a
    // real `od` binary on PATH, which this case does not provide.
    const od = runPreflight({
      mcpJson: { mcpServers: { 'open-design': { command: 'node', args: ['daemon.js'] } } },
    }).integrations.openDesign;
    expect(od.configured).toBe(true);
    expect(od.configuredIn).toHaveLength(1);
    expect(od.available).toBe(true);
    expect(od.mcpFunctional).toBe(false);
  }, TIMEOUT);

  it('ignores an unrelated "open-design" mention outside mcpServers (the fileMentions substring bug this replaced)', () => {
    // Before the fix, checkOpenDesign() used a raw String.includes over the
    // whole file — any occurrence of the literal text "open-design" (a
    // comment, an unrelated path/server name) reported configured:true.
    const od = runPreflight({
      mcpJson: {
        mcpServers: { unrelated: { command: 'node', args: ['./open-design-notes.js'] } },
        _comment: 'see open-design for context',
      },
    }).integrations.openDesign;
    expect(od.configured).toBe(false);
    expect(od.configuredIn).toEqual([]);
  }, TIMEOUT);

  it('reads ~/.claude/settings/mcp.json in addition to the three documented locations', () => {
    // preflight.mjs probes 4 candidates; keep this in sync with the doc table
    // in skills/pensador/references/open-design.md.
    const base = join(SANDBOX, `case-${seq++}`);
    const home = join(base, 'home');
    const cwd = join(base, 'proj');
    mkdirSync(join(home, '.claude', 'settings'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(home, '.claude', 'settings', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'open-design': { command: 'node', args: [] } } }),
    );
    const out = execFileSync(process.execPath, [PREFLIGHT], {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
    const od = JSON.parse(out).integrations.openDesign;
    expect(od.configured).toBe(true);
    expect(od.configuredIn.some((p) => p.includes(join('.claude', 'settings', 'mcp.json')))).toBe(true);
  }, TIMEOUT);
});
