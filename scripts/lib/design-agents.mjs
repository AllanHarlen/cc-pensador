/**
 * Detects the coding agents that can drive the OPTIONAL Open Design prototype/Critique, so the
 * Pensador can ask the user (AskUserQuestion, header AgenteDesign) which one to bind.
 *
 * Two places are inspected, both READ-ONLY (nothing here writes state, starts a run or prints a secret):
 *   - host      the agent CLI is on the PATH of the machine running Claude Code (PATH walk, PATHEXT aware);
 *   - daemon    what the Open Design daemon itself sees, via GET /api/agents (its own detection). The
 *               daemon lives in Docker (`where: 'container'`) or on the host (`where: 'host'`); only an
 *               agent visible in the daemon's environment can be launched by `od run start`. Without a
 *               token, a `command -v` probe inside the container is the fallback.
 *
 * Every dependency (PATH resolver, fetch, docker exec) is injectable, so the tests need no host state.
 * Output entries: { id, where: 'host'|'container', available, authenticated: true|false|'unknown', source }.
 * `id` follows the Open Design runtime ids (agy -> antigravity, kiro-cli -> kiro).
 */
import { execFileSync } from "node:child_process";
import { resolveOnPath } from "../od-onboard-agents.mjs";
import { detectOdContainer, odApiToken } from "./open-design-preflight.mjs";

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

/** GET <daemonUrl>/api/agents. Returns { entries, status } — never throws, never returns the token. */
export async function detectDaemonDesignAgents({ daemonUrl, token, where, fetchFn = fetch, timeoutMs = 4_000 } = {}) {
  if (!daemonUrl || !where) return { entries: [], status: "no-daemon" };
  try {
    const response = await fetchFn(`${daemonUrl}/api/agents`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Connection: "close" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) return { entries: [], status: "auth-required" };
    if (!response.ok) return { entries: [], status: "http-error" };
    return { entries: agentsFromDaemonPayload(await response.json(), where), status: "ok" };
  } catch {
    return { entries: [], status: "unreachable" };
  }
}

/**
 * Fallback when the REST answer is unavailable: `command -v <bin>` INSIDE the container (read-only).
 * `MSYS_NO_PATHCONV=1` keeps Git Bash from rewriting container paths.
 */
export function probeContainerAgents({ container, exec, env = process.env, siblings = {}, timeoutMs = 4_000 } = {}) {
  if (!container) return [];
  const run = exec ?? ((bin) => {
    execFileSync("docker", ["exec", container, "sh", "-c", `command -v ${bin}`], {
      env: { ...env, MSYS_NO_PATHCONV: "1" }, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, windowsHide: true,
    });
    return true;
  });
  return DESIGN_AGENT_CANDIDATES
    .filter((candidate) => !candidate.sibling || siblings[candidate.sibling] === true)
    .map((candidate) => {
      let found = false;
      for (const bin of candidate.bins) {
        try { if (run(bin)) { found = true; break; } } catch { /* not on the container PATH */ }
      }
      return { id: candidate.id, where: "container", available: found, authenticated: "unknown", source: "container-path" };
    });
}

/**
 * Full detection. `openDesign` is the preflight openDesign block (daemon url + docker evidence).
 * Returns { agents, daemonWhere, daemonStatus }; `daemonWhere` is null when the daemon is unreachable.
 */
export async function detectDesignAgents({ openDesign = null, env = process.env, siblings = {}, resolve, fetchFn, exec, timeoutMs, home, dockerProbe } = {}) {
  const agents = detectHostDesignAgents({ resolve, siblings });
  const daemon = openDesign?.daemon ?? {};
  // The preflight skips `docker ps` once the REST probe authenticates, so ask again (read-only) to
  // learn WHERE the daemon lives: an OD container publishing the daemon's port means "container".
  const dockerInfo = openDesign?.docker?.detected ? openDesign.docker : (dockerProbe ?? ((e, t) => detectOdContainer(e, t)))(env, timeoutMs ?? 1_500);
  const inDocker = Boolean(dockerInfo?.detected);
  let port = null;
  try { port = daemon.url ? Number(new URL(daemon.url).port) || null : null; } catch { /* keep null */ }
  const daemonInContainer = inDocker && (!dockerInfo.publishedPort || !port || dockerInfo.publishedPort === port);
  const daemonWhere = daemon.reachable ? (daemonInContainer ? "container" : "host") : null;
  let daemonStatus = daemonWhere ? "reachable" : "no-daemon";
  if (daemonWhere) {
    const token = odApiToken({ env, ...(home ? { home } : {}) });
    const rest = await detectDaemonDesignAgents({ daemonUrl: daemon.url, token, where: daemonWhere, fetchFn, timeoutMs });
    daemonStatus = rest.status;
    if (rest.entries.length) {
      // The daemon's own answer is the truth for its environment: it replaces the PATH guess there.
      const seen = new Set(rest.entries.map((e) => `${e.where}:${e.id}`));
      const kept = agents.filter((a) => !seen.has(`${a.where}:${a.id}`));
      agents.length = 0;
      agents.push(...kept, ...rest.entries);
    } else if (daemonWhere === "container") agents.push(...probeContainerAgents({ container: dockerInfo?.container ?? env.OD_CONTAINER ?? "open-design", exec, env, siblings, timeoutMs }));
  } else if (inDocker) {
    agents.push(...probeContainerAgents({ container: dockerInfo?.container ?? env.OD_CONTAINER ?? "open-design", exec, env, siblings, timeoutMs }));
  }
  return { agents, daemonWhere, daemonStatus };
}
