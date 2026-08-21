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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

  for (const name of setup.projectSkills ?? []) {
    mkdirSync(join(cwd, '.claude', 'skills', name), { recursive: true });
  }
  for (const name of setup.homeSkills ?? []) {
    mkdirSync(join(home, '.claude', 'skills', name), { recursive: true });
  }

  const out = execFileSync(process.execPath, [PREFLIGHT], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
  return JSON.parse(out);
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
});
