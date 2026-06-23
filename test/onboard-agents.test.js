/**
 * Onboarding agent detection / registration — pins the deterministic core of
 * scripts/od-onboard-agents.mjs (the helper that wires host claude/codex/
 * antigravity CLIs into a LOCAL Open Design daemon's app-config).
 *
 * Only the pure helpers are exercised here; the fs/network shell in `main()`
 * runs solely when the file is invoked directly.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_ONBOARDING,
  resolveOnPath,
  detectAgents,
  buildAgentCliEnvPatch,
  pathAdditionsFor,
  mergeAppConfig,
} from '../scripts/od-onboard-agents.mjs';

describe('AGENT_ONBOARDING descriptors', () => {
  it('covers the three agents with the right *_BIN override keys', () => {
    const byId = Object.fromEntries(AGENT_ONBOARDING.map((a) => [a.id, a]));
    expect(byId.claude.envKey).toBe('CLAUDE_BIN');
    expect(byId.claude.bins).toEqual(['claude']);
    expect(byId.codex.envKey).toBe('CODEX_BIN');
    expect(byId.codex.bins).toEqual(['codex']);
    // antigravity's bin is `agy` and Open Design has NO *_BIN allowlist key for
    // it — so it must resolve via PATH, never an env override.
    expect(byId.antigravity.bins).toEqual(['agy']);
    expect(byId.antigravity.envKey).toBeNull();
  });
});

describe('resolveOnPath', () => {
  const exists = (set) => (p) => set.has(p);

  it('finds a posix binary on PATH', () => {
    const found = resolveOnPath('codex', {
      platform: 'linux',
      pathEnv: '/usr/bin:/home/u/.local/bin',
      existsSyncFn: exists(new Set(['/home/u/.local/bin/codex'])),
    });
    expect(found).toBe('/home/u/.local/bin/codex');
  });

  it('honors PATHEXT on win32 (claude.CMD)', () => {
    const found = resolveOnPath('claude', {
      platform: 'win32',
      pathEnv: 'C:\\npm',
      pathext: '.EXE;.CMD;.BAT',
      delimiter: ';',
      existsSyncFn: exists(new Set(['C:\\npm\\claude.CMD'])),
    });
    expect(found).toBe('C:\\npm\\claude.CMD');
  });

  it('searches extraDirs after PATH and dedupes', () => {
    const found = resolveOnPath('agy', {
      platform: 'win32',
      pathEnv: 'C:\\npm',
      pathext: '.EXE',
      delimiter: ';',
      extraDirs: ['C:\\agy\\bin'],
      existsSyncFn: exists(new Set(['C:\\agy\\bin\\agy.EXE'])),
    });
    expect(found).toBe('C:\\agy\\bin\\agy.EXE');
  });

  it('returns null when absent and is total on bad input', () => {
    expect(resolveOnPath('nope', { pathEnv: '/usr/bin', existsSyncFn: () => false })).toBeNull();
    expect(resolveOnPath('', {})).toBeNull();
    expect(resolveOnPath(null, {})).toBeNull();
  });
});

describe('detectAgents', () => {
  const linuxOpts = (present, overrides = {}) => ({
    platform: 'linux',
    pathEnv: '/usr/bin:/opt/bin',
    existsSyncFn: (p) => present.has(p),
    overrides,
  });

  it('resolves each agent on PATH and exposes dir + source', () => {
    const present = new Set(['/opt/bin/claude', '/usr/bin/codex', '/opt/bin/agy']);
    const detected = detectAgents(linuxOpts(present));
    const byId = Object.fromEntries(detected.map((a) => [a.id, a]));
    expect(byId.claude.path).toBe('/opt/bin/claude');
    expect(byId.claude.dir).toBe('/opt/bin');
    expect(byId.claude.source).toBe('path');
    expect(byId.codex.path).toBe('/usr/bin/codex');
    expect(byId.antigravity.path).toBe('/opt/bin/agy');
  });

  it('an explicit override that exists wins over PATH', () => {
    const present = new Set(['/usr/bin/claude', '/custom/claude']);
    const detected = detectAgents(linuxOpts(present, { claude: '/custom/claude' }));
    const claude = detected.find((a) => a.id === 'claude');
    expect(claude.path).toBe('/custom/claude');
    expect(claude.source).toBe('override');
  });

  it('a non-existent override falls back to the PATH walk', () => {
    const present = new Set(['/usr/bin/claude']);
    const detected = detectAgents(linuxOpts(present, { claude: '/ghost/claude' }));
    const claude = detected.find((a) => a.id === 'claude');
    expect(claude.path).toBe('/usr/bin/claude');
    expect(claude.source).toBe('path');
  });

  it('marks undetected agents with a null path', () => {
    const detected = detectAgents(linuxOpts(new Set(['/usr/bin/codex'])));
    const byId = Object.fromEntries(detected.map((a) => [a.id, a]));
    expect(byId.codex.path).toBe('/usr/bin/codex');
    expect(byId.claude.path).toBeNull();
    expect(byId.claude.dir).toBeNull();
    expect(byId.claude.source).toBe('none');
  });
});

describe('buildAgentCliEnvPatch', () => {
  it('emits CLAUDE_BIN/CODEX_BIN but never an antigravity entry', () => {
    const detected = [
      { id: 'claude', envKey: 'CLAUDE_BIN', path: '/b/claude' },
      { id: 'codex', envKey: 'CODEX_BIN', path: '/b/codex' },
      { id: 'antigravity', envKey: null, path: '/b/agy' },
    ];
    expect(buildAgentCliEnvPatch(detected)).toEqual({
      claude: { CLAUDE_BIN: '/b/claude' },
      codex: { CODEX_BIN: '/b/codex' },
    });
  });

  it('skips agents without a resolved path and is total on bad input', () => {
    expect(buildAgentCliEnvPatch([{ id: 'claude', envKey: 'CLAUDE_BIN', path: null }])).toEqual({});
    expect(buildAgentCliEnvPatch(null)).toEqual({});
    expect(buildAgentCliEnvPatch(undefined)).toEqual({});
  });
});

describe('pathAdditionsFor', () => {
  it('returns unique dirs (agy dir is what makes antigravity resolvable)', () => {
    const detected = [
      { dir: '/npm' },
      { dir: '/npm' },
      { dir: '/agy/bin' },
      { dir: null },
    ];
    expect(pathAdditionsFor(detected)).toEqual(['/npm', '/agy/bin']);
    expect(pathAdditionsFor(null)).toEqual([]);
  });
});

describe('mergeAppConfig', () => {
  it('deep-merges agentCliEnv, preserving unrelated keys and agents', () => {
    const existing = {
      telemetry: { metrics: true },
      agentCliEnv: {
        claude: { ANTHROPIC_BASE_URL: 'https://x' },
        gemini: { GEMINI_BIN: '/b/gemini' },
      },
    };
    const patch = { claude: { CLAUDE_BIN: '/b/claude' }, codex: { CODEX_BIN: '/b/codex' } };
    const merged = mergeAppConfig(existing, patch);
    // Unrelated top-level key untouched.
    expect(merged.telemetry).toEqual({ metrics: true });
    // Unrelated agent untouched; claude's existing env preserved + extended.
    expect(merged.agentCliEnv.gemini).toEqual({ GEMINI_BIN: '/b/gemini' });
    expect(merged.agentCliEnv.claude).toEqual({
      ANTHROPIC_BASE_URL: 'https://x',
      CLAUDE_BIN: '/b/claude',
    });
    expect(merged.agentCliEnv.codex).toEqual({ CODEX_BIN: '/b/codex' });
  });

  it('does not mutate the input and tolerates a missing/!object base', () => {
    const existing = { agentCliEnv: { claude: {} } };
    const merged = mergeAppConfig(existing, { claude: { CLAUDE_BIN: '/b/claude' } });
    expect(existing.agentCliEnv.claude).toEqual({}); // untouched
    expect(merged).not.toBe(existing);
    expect(mergeAppConfig(null, { codex: { CODEX_BIN: '/c' } })).toEqual({
      agentCliEnv: { codex: { CODEX_BIN: '/c' } },
    });
    expect(mergeAppConfig(undefined, {})).toEqual({});
  });
});
