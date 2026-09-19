/**
 * Design-agent binding: detection (host PATH + OD daemon REST + container fallback), the pure
 * resolveDesignAgent/validateDesignAgent, the `design-brief.mjs agent` command and the preflight block.
 * Every environment dependency is injected — no test reads the real PATH, daemon or Docker.
 */
import { describe, it, expect } from 'vitest';
import {
  DESIGN_AGENT_HEADER, DESIGN_AGENT_NONE, resolveDesignAgent, validateDesignAgent, initState,
} from '../scripts/pensador-engine.mjs';
import {
  agentsFromDaemonPayload, detectDaemonDesignAgents, detectDesignAgents, detectHostDesignAgents, probeContainerAgents,
} from '../scripts/lib/design-agents.mjs';
import { agentCommand } from '../scripts/design-brief.mjs';
import { runPreflight } from '../scripts/preflight.mjs';

const NOW = '2026-09-19T12:00:00.000Z';
const host = (id, extra = {}) => ({ id, where: 'host', available: true, authenticated: 'unknown', source: 'path', ...extra });
const box = (id, extra = {}) => ({ id, where: 'container', available: true, authenticated: 'unknown', source: 'daemon-rest', ...extra });

describe('detectHostDesignAgents', () => {
  it('lists the candidates found on PATH, without the sibling agents unless their plugin exists', () => {
    const found = new Set(['claude', 'gemini', 'agy', 'kiro-cli']);
    const resolve = (bin) => (found.has(bin) ? `/bin/${bin}` : null);
    const agents = detectHostDesignAgents({ resolve });
    expect(agents.filter((a) => a.available).map((a) => a.id)).toEqual(['claude', 'gemini']);
    expect(agents.map((a) => a.id)).not.toContain('antigravity');
    expect(agents.map((a) => a.id)).not.toContain('kiro');
    const withSiblings = detectHostDesignAgents({ resolve, siblings: { agy: true, kiro: true } });
    expect(withSiblings.filter((a) => a.available).map((a) => a.id)).toEqual(['claude', 'gemini', 'antigravity', 'kiro']);
    expect(withSiblings.every((a) => a.where === 'host' && a.source === 'path')).toBe(true);
  });

  it('never throws on a resolver failure', () => {
    const agents = detectHostDesignAgents({ resolve: () => { throw new Error('EACCES'); } });
    expect(agents.every((a) => a.available === false)).toBe(true);
  });
});

describe('daemon detection', () => {
  const payload = { agents: [{ id: 'claude', available: true }, { id: 'codex', available: false }, { name: 'no-id' }] };

  it('maps the /api/agents payload and drops entries without an id', () => {
    expect(agentsFromDaemonPayload(payload, 'container')).toEqual([
      { id: 'claude', where: 'container', available: true, authenticated: 'unknown', source: 'daemon-rest' },
      { id: 'codex', where: 'container', available: false, authenticated: 'unknown', source: 'daemon-rest' },
    ]);
    expect(agentsFromDaemonPayload(null, 'host')).toEqual([]);
  });

  it('sends the token only as a header and reports status codes without throwing', async () => {
    let seen;
    const ok = await detectDaemonDesignAgents({
      daemonUrl: 'http://127.0.0.1:7456', token: 'secret', where: 'container',
      fetchFn: async (url, init) => { seen = { url, headers: init.headers }; return { status: 200, ok: true, json: async () => payload }; },
    });
    expect(seen.url).toBe('http://127.0.0.1:7456/api/agents');
    expect(seen.headers.Authorization).toBe('Bearer secret');
    expect(ok.status).toBe('ok');
    expect(JSON.stringify(ok)).not.toContain('secret');
    expect((await detectDaemonDesignAgents({ daemonUrl: 'http://x', where: 'host', fetchFn: async () => ({ status: 401, ok: false }) })).status).toBe('auth-required');
    expect((await detectDaemonDesignAgents({ daemonUrl: 'http://x', where: 'host', fetchFn: async () => { throw new Error('ECONNREFUSED'); } })).status).toBe('unreachable');
    expect((await detectDaemonDesignAgents({})).status).toBe('no-daemon');
  });

  it('probes the container PATH read-only when REST is not available', () => {
    const calls = [];
    const agents = probeContainerAgents({
      container: 'open-design',
      exec: (bin) => { calls.push(bin); if (bin !== 'codex') throw new Error('not found'); return true; },
    });
    expect(agents.filter((a) => a.available).map((a) => a.id)).toEqual(['codex']);
    expect(agents.every((a) => a.where === 'container' && a.source === 'container-path')).toBe(true);
    expect(calls.every((bin) => /^[a-z-]+$/.test(bin))).toBe(true);
    expect(probeContainerAgents({})).toEqual([]);
  });

  it('classifies a daemon published by an OD container as "container" even though preflight skipped docker ps', async () => {
    const result = await detectDesignAgents({
      openDesign: { daemon: { url: 'http://127.0.0.1:7456', reachable: true }, docker: { detected: false } },
      env: { OD_API_TOKEN: 'secret' },
      resolve: (bin) => (bin === 'gemini' ? '/bin/gemini' : null),
      dockerProbe: () => ({ detected: true, publishedPort: 7456, container: 'open-design' }),
      fetchFn: async () => ({ status: 200, ok: true, json: async () => ({ agents: [{ id: 'claude', available: true }] }) }),
    });
    expect(result.daemonWhere).toBe('container');
    expect(result.agents.find((a) => a.id === 'gemini')).toMatchObject({ where: 'host', available: true });
    expect(result.agents.find((a) => a.id === 'claude' && a.where === 'container')).toMatchObject({ available: true });
    expect(result.agents.find((a) => a.id === 'claude' && a.where === 'host')).toMatchObject({ available: false });
  });

  it('lets the daemon answer override the PATH guess when the daemon runs on the host', async () => {
    const result = await detectDesignAgents({
      openDesign: { daemon: { url: 'http://127.0.0.1:7456', reachable: true }, docker: { detected: false } },
      env: {},
      resolve: (bin) => (bin === 'claude' ? '/bin/claude' : null),
      dockerProbe: () => ({ detected: false }),
      fetchFn: async () => ({ status: 200, ok: true, json: async () => ({ agents: [{ id: 'claude', available: false }] }) }),
    });
    expect(result.daemonWhere).toBe('host');
    expect(result.agents.filter((a) => a.id === 'claude')).toEqual([expect.objectContaining({ where: 'host', available: false, source: 'daemon-rest' })]);
  });

  it('falls back to the container PATH probe when the daemon answer is empty', async () => {
    const result = await detectDesignAgents({
      openDesign: { daemon: { url: 'http://127.0.0.1:7456', reachable: true }, docker: { detected: true, publishedPort: 7456, container: 'od' } },
      env: {}, resolve: () => null,
      fetchFn: async () => ({ status: 401, ok: false }),
      exec: (bin) => { if (bin === 'qwen') return true; throw new Error('no'); },
    });
    expect(result.daemonStatus).toBe('auth-required');
    expect(result.agents.filter((a) => a.available)).toEqual([expect.objectContaining({ id: 'qwen', where: 'container' })]);
  });
});

describe('resolveDesignAgent', () => {
  it('accepts an agent that lives where the daemon runs', () => {
    const r = resolveDesignAgent([host('claude'), box('claude')], 'claude', { daemonWhere: 'container', now: NOW });
    expect(r).toMatchObject({ ok: true, prototypeEnabled: true, designAgent: { id: 'claude', where: 'container', chosenAt: NOW } });
    expect(validateDesignAgent(r.designAgent).ok).toBe(true);
  });

  it('refuses a host-only agent with a container daemon and offers the two remediations', () => {
    const r = resolveDesignAgent([host('gemini')], { id: 'gemini' }, { daemonWhere: 'container', now: NOW });
    expect(r).toMatchObject({ ok: false, designAgent: null, prototypeEnabled: false, issues: ['agent-not-visible-to-daemon'] });
    expect(r.remediations).toEqual(['install-and-authenticate-gemini-in-container', 'run-daemon-on-host']);
  });

  it('refuses the reverse case (container-only agent, daemon on the host)', () => {
    const r = resolveDesignAgent([box('codex')], 'codex', { daemonWhere: 'host', now: NOW });
    expect(r.issues).toEqual(['agent-not-visible-to-daemon']);
    expect(r.remediations).toEqual(['install-and-authenticate-codex-in-daemon-host', 'run-daemon-in-container']);
  });

  it('records the choice but keeps the prototype off while the daemon is unreachable', () => {
    const r = resolveDesignAgent([host('claude')], 'claude', { daemonWhere: null, now: NOW });
    expect(r).toMatchObject({ ok: true, prototypeEnabled: false, issues: ['daemon-unreachable'], designAgent: { id: 'claude', where: 'host' } });
  });

  it('refuses an agent that is not authenticated where the daemon runs', () => {
    const r = resolveDesignAgent([box('claude', { authenticated: false })], 'claude', { daemonWhere: 'container', now: NOW });
    expect(r).toMatchObject({ ok: false, issues: ['agent-not-authenticated'], remediations: ['authenticate-claude-in-container'] });
  });

  it('"none" skips the prototype; unknown or empty choices are refused', () => {
    expect(resolveDesignAgent([], 'none')).toMatchObject({ ok: true, designAgent: { id: DESIGN_AGENT_NONE }, prototypeEnabled: false });
    expect(resolveDesignAgent([], { id: 'none' }).ok).toBe(true);
    expect(resolveDesignAgent([host('claude')], 'ghost', { daemonWhere: 'host' }).issues).toEqual(['agent-not-detected']);
    expect(resolveDesignAgent([host('claude', { available: false })], 'claude', { daemonWhere: 'host' }).issues).toEqual(['agent-not-detected']);
    expect(resolveDesignAgent(undefined, undefined).issues).toEqual(['no-choice']);
  });

  it('is total: garbage input never throws', () => {
    for (const bad of [null, 42, [], {}, 'x']) {
      expect(() => resolveDesignAgent(bad, bad, { daemonWhere: bad })).not.toThrow();
    }
  });
});

describe('validateDesignAgent + state', () => {
  it('validates null, none and a full choice; rejects malformed values', () => {
    expect(validateDesignAgent(null).ok).toBe(true);
    expect(validateDesignAgent({ id: 'none' }).ok).toBe(true);
    expect(validateDesignAgent({ id: 'claude', where: 'host', chosenAt: NOW }).ok).toBe(true);
    expect(validateDesignAgent({ id: 'claude', where: 'moon', chosenAt: NOW }).issues).toEqual(['invalid-where']);
    expect(validateDesignAgent({ id: 'Claude Code', where: 'host', chosenAt: NOW }).issues).toContain('invalid-id');
    expect(validateDesignAgent({ id: 'claude', where: 'host', chosenAt: 'ontem' }).issues).toEqual(['invalid-chosenAt']);
    expect(validateDesignAgent('claude').ok).toBe(false);
  });

  it('a new state has no agent bound (prototype/Critique stay off)', () => {
    expect(initState('demanda').designAgent).toBeNull();
  });

  it('exposes the fixed AskUserQuestion header (<= 12 chars, as the tool requires)', () => {
    expect(DESIGN_AGENT_HEADER).toBe('AgenteDesign');
    expect(DESIGN_AGENT_HEADER.length).toBeLessThanOrEqual(12);
  });
});

describe('design-brief.mjs agent', () => {
  const preflight = { integrations: { designAgents: { daemonWhere: 'container', agents: [host('gemini'), box('claude')] } } };

  it('takes daemonWhere from the preflight and returns a statePatch only when accepted', () => {
    const ok = agentCommand({ agents: preflight, choose: 'claude', now: NOW });
    expect(ok).toMatchObject({ status: 'ok', prototypeEnabled: true, statePatch: { designAgent: { id: 'claude', where: 'container', chosenAt: NOW } } });
    const refused = agentCommand({ agents: preflight, choose: 'gemini', now: NOW });
    expect(refused.status).toBe('REFUSED');
    expect(refused.statePatch).toEqual({});
    expect(refused.remediations).toHaveLength(2);
  });

  it('accepts the designAgents block or a bare list, and --daemon-where overrides it', () => {
    expect(agentCommand({ agents: preflight.integrations.designAgents, choose: 'claude', now: NOW }).status).toBe('ok');
    expect(agentCommand({ agents: [host('gemini')], choose: 'gemini', daemonWhere: 'host', now: NOW }).status).toBe('ok');
    expect(agentCommand({ agents: preflight, choose: 'gemini', daemonWhere: 'host', now: NOW }).status).toBe('ok');
    expect(agentCommand({ agents: preflight, choose: 'none' }).statePatch).toEqual({ designAgent: { id: 'none' } });
  });
});

describe('preflight designAgents block', () => {
  const env = { ...process.env, OD_PREFLIGHT_DISABLE_DEFAULT_URL: '1', OD_PREFLIGHT_DISABLE_DOCKER: '1' };

  it('reports only available agents, the fixed header and the daemon location', async () => {
    const report = await runPreflight({
      cwd: process.cwd(), env, timeoutMs: 5000,
      designAgentDeps: {
        resolve: (bin) => (bin === 'claude' ? '/bin/claude' : null),
        dockerProbe: () => ({ detected: false }),
      },
    });
    const block = report.integrations.designAgents;
    expect(block.header).toBe('AgenteDesign');
    expect(block.agents.map((a) => a.id)).toEqual(['claude']);
    expect(block.agents.every((a) => a.available)).toBe(true);
    expect(typeof block.undetectedCount).toBe('number');
    expect(report.guidance).toContain('Design agent: claude@host');
    expect(report.guidance).toContain('AgenteDesign');
    expect(JSON.stringify(block)).not.toMatch(/token|secret|bearer/i);
  });

  it('says no question is needed when nothing is detected', async () => {
    const report = await runPreflight({
      cwd: process.cwd(), env, timeoutMs: 5000,
      designAgentDeps: { resolve: () => null, dockerProbe: () => ({ detected: false }) },
    });
    expect(report.integrations.designAgents.agents).toEqual([]);
    expect(report.guidance).toContain('Design agent: none detected');
  });
});
