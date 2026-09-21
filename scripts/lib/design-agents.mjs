/**
 * Detects the coding agents that can drive the OPTIONAL Open Design prototype/Critique, so the
 * Pensador can ask the user (AskUserQuestion, header AgenteDesign) which one to bind.
 *
 * Two places are inspected, both READ-ONLY (nothing here writes state, starts a run or prints a secret):
 *   - host      the agent CLI is on the PATH of the machine running Claude Code (PATH walk, PATHEXT aware);
 *   - daemon    what the Open Design daemon itself sees, via GET /api/agents (its own detection). The
 *               daemon runs on the host (`where: 'host'`); only an agent visible in the daemon's
 *               environment can be launched by `od run start`.
 *
 * Every dependency (PATH resolver, fetch) is injectable, so the tests need no host state.
 * Output entries: { id, where: 'host', available, authenticated: true|false|'unknown', source }.
 * `id` follows the Open Design runtime ids (agy -> antigravity, kiro-cli -> kiro).
 */
import { resolveOnPath } from "../od-onboard-agents.mjs";
import { odApiToken } from "./open-design-preflight.mjs";

/** Host CLIs worth offering. `sibling` ones are listed only when the sibling plugin is installed. */
export const DESIGN_AGENT_CANDIDATES = [
  { id: "claude", bins: ["claude"] },
  { id: "codex", bins: ["codex"] },
  { id: "gemini", bins: ["gemini"] },
  { id: "opencode", bins: ["opencode", "opencode-cli"] },
  { id: "cursor-agent", bins: ["cursor-agent"] },
  { id: "qwen", bins: ["qwen"] },
  { id: "antigravity", bins: ["agy"], sibling: "agy" },
  { id: "kiro", bins: ["kiro-cli"], sibling: "kiro" },
];

/**
 * @param {{ resolve?: (bin:string)=>string|null, siblings?: {agy?:boolean, kiro?:boolean} }} [opts]
 */
export function detectHostDesignAgents({ resolve = (bin) => resolveOnPath(bin), siblings = {} } = {}) {
  return DESIGN_AGENT_CANDIDATES
    .filter((candidate) => !candidate.sibling || siblings[candidate.sibling] === true)
    .map((candidate) => {
      let found = false;
      for (const bin of candidate.bins) {
        try { if (resolve(bin)) { found = true; break; } } catch { /* an unreadable PATH entry is not evidence */ }
      }
      return { id: candidate.id, where: "host", available: found, authenticated: "unknown", source: "path" };
    });
}

/** Maps the daemon's AgentInfo list (GET /api/agents) into entries; unknown shapes yield []. */
export function agentsFromDaemonPayload(payload, where) {
  const list = Array.isArray(payload?.agents) ? payload.agents : [];
  return list
    .filter((agent) => agent && typeof agent.id === "string")
    .map((agent) => ({
      id: agent.id,
      where,
      available: agent.available === true,
      authenticated: typeof agent.authenticated === "boolean" ? agent.authenticated : "unknown",
      source: "daemon-rest",
    }));
}

/**
 * `GET /api/agents` makes the daemon probe ~30 agent CLIs (each `--version`, and on Windows each is a `.cmd`
 * shim), measured at 5.2-5.4 s on the host daemon: longer than the preflight's generic 5 s timeout, which made
 * the daemon answer look "unreachable". This call gets its own floor, whatever the caller's timeout is.
 */
export const DAEMON_AGENTS_MIN_TIMEOUT_MS = 20_000;

/** GET <daemonUrl>/api/agents. Returns { entries, status } — never throws, never returns the token. */
export async function detectDaemonDesignAgents({ daemonUrl, token, where, fetchFn = fetch, timeoutMs = DAEMON_AGENTS_MIN_TIMEOUT_MS } = {}) {
  if (!daemonUrl || !where) return { entries: [], status: "no-daemon" };
  try {
    const response = await fetchFn(`${daemonUrl}/api/agents`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Connection: "close" },
      signal: AbortSignal.timeout(Math.max(timeoutMs, DAEMON_AGENTS_MIN_TIMEOUT_MS)),
    });
    if (response.status === 401 || response.status === 403) return { entries: [], status: "auth-required" };
    if (!response.ok) return { entries: [], status: "http-error" };
    return { entries: agentsFromDaemonPayload(await response.json(), where), status: "ok" };
  } catch {
    return { entries: [], status: "unreachable" };
  }
}

/**
 * Full detection. `openDesign` is the preflight openDesign block; its `daemon.where` says where the
 * daemon answered. Returns { agents, daemonWhere, daemonStatus }: `daemonWhere` is 'host', 'container'
 * (a LEFTOVER Docker container holding the port: the agents are refused, see the port-conflict guard) or
 * null when the daemon is unreachable.
 */
export async function detectDesignAgents({ openDesign = null, env = process.env, siblings = {}, resolve, fetchFn, timeoutMs, home } = {}) {
  const agents = detectHostDesignAgents({ resolve, siblings });
  const daemon = openDesign?.daemon ?? {};
  const daemonWhere = daemon.reachable ? (daemon.where === "container" ? "container" : "host") : null;
  let daemonStatus = daemonWhere ? "reachable" : "no-daemon";
  if (daemonWhere === "container") daemonStatus = "legacy-container";
  else if (daemonWhere) {
    const token = odApiToken({ env, ...(home ? { home } : {}) });
    const rest = await detectDaemonDesignAgents({ daemonUrl: daemon.url, token, where: daemonWhere, fetchFn, timeoutMs });
    daemonStatus = rest.status;
    if (rest.entries.length) {
      // The daemon's own answer is the truth for its environment: it replaces the PATH guess there.
      const seen = new Set(rest.entries.map((e) => `${e.where}:${e.id}`));
      const kept = agents.filter((a) => !seen.has(`${a.where}:${a.id}`));
      agents.length = 0;
      agents.push(...kept, ...rest.entries);
    }
  }
  return { agents, daemonWhere, daemonStatus };
}
