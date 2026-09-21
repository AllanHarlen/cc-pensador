import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function dotenv(path) {
  const result = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      result[match[1]] = value;
    }
  } catch { /* absent/unreadable is not evidence */ }
  return result;
}

function url(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    // The daemon treats `localhost` as its "powered preview" origin and refuses most API routes to requests
    // carrying Sec-Fetch-* headers (Node's fetch sends them): API clients must talk to the loopback IP.
    if (parsed.hostname === "localhost") parsed.hostname = "127.0.0.1";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch { return null; }
}

function mcpEvidence(files, cwd) {
  const configuredIn = [];
  const urls = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const json = JSON.parse(readFileSync(file, "utf8"));
      const maps = [json.mcpServers];
      for (const [project, config] of Object.entries(json.projects ?? {})) {
        if (String(project).replace(/\\/g, "/").toLowerCase() === cwd.replace(/\\/g, "/").toLowerCase()) maps.push(config?.mcpServers);
      }
      for (const servers of maps.filter(Boolean)) {
        for (const [name, definition] of Object.entries(servers)) {
          const blob = JSON.stringify(definition ?? {});
          const structuredMarker = Boolean(definition?.url || definition?.env?.OD_DAEMON_URL) ||
            (String(definition?.command ?? "").toLowerCase() === "od" && (definition?.args ?? []).some((arg) => String(arg).toLowerCase() === "mcp"));
          if (name.toLowerCase() !== "open-design" && !structuredMarker) continue;
          configuredIn.push(file);
          for (const candidate of [definition?.url, definition?.env?.OD_DAEMON_URL, ...(blob.match(/https?:\/\/[^\s"']+/g) ?? [])]) {
            const normalized = url(candidate);
            if (normalized) urls.push(normalized);
          }
        }
      }
    } catch { /* malformed config is not evidence */ }
  }
  return { configuredIn: [...new Set(configuredIn)], urls: [...new Set(urls)] };
}

/** Directory of the Open Design clone the host daemon runs from (`OD_CLONE_DIR` overrides ~/.open-design). */
export function odCloneDir({ env = process.env, home = homedir() } = {}) {
  return env.OD_CLONE_DIR || join(home, ".open-design");
}

/**
 * Daemon bearer token: `OD_API_TOKEN` from the environment, then `<clone>/.env`. The loopback host daemon
 * needs none (auth only turns on when `OD_API_TOKEN` is set for it), so `null` is a normal answer.
 * Never printed: callers only forward it as a header.
 */
export function odApiToken({ env = process.env, home = homedir() } = {}) {
  return env.OD_API_TOKEN || dotenv(join(odCloneDir({ env, home }), ".env")).OD_API_TOKEN || null;
}

async function probe(baseUrl, token, timeoutMs) {
  try {
    const response = await fetch(`${baseUrl}/api/design-systems`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Connection: "close",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = response.status;
    try { await response.body?.cancel(); } catch {}
    return { url: baseUrl, reachable: true, authenticated: status === 200, httpStatus: status };
  } catch (error) {
    return { url: baseUrl, reachable: false, authenticated: false, httpStatus: null, error: error.name };
  }
}

/**
 * Read-only `docker ps` evidence of a LEFTOVER Open Design container. The Docker install is no longer a
 * supported runtime (a Linux container cannot launch the host's claude/codex/agy), so this only feeds the
 * port-conflict guard: a container publishing the daemon's port is the daemon the preflight would talk to.
 */
export function detectLegacyContainer(env, timeoutMs) {
  return legacyContainer(env, timeoutMs);
}

function legacyContainer(env, timeoutMs) {
  try {
    const stdout = execFileSync("docker", ["ps", "--format", "{{json .}}"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: Math.max(100, timeoutMs), windowsHide: true });
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!/open[-_ ]?design|ghcr\.io\/nexu-io\/od/i.test([row.Names, row.Image, row.Labels].join(" "))) continue;
      const match = String(row.Ports ?? "").match(/:(\d+)->\d+\/tcp/i);
      return { detected: true, healthy: /healthy/i.test(row.Status ?? ""), publishedPort: match ? Number(match[1]) : null, container: row.Names ?? null };
    }
  } catch { /* docker is optional (and now unexpected); raw errors may expose environment data */ }
  return { detected: false, healthy: false, publishedPort: null, container: null };
}

export async function detectOpenDesign({ cwd = process.cwd(), env = process.env, timeoutMs = 1_500, cliCheck = { ok: false }, legacy = {}, home = homedir(), containerProbe = legacyContainer } = {}) {
  const cloneEnv = dotenv(join(odCloneDir({ env, home }), ".env"));
  const token = env.OD_API_TOKEN || cloneEnv.OD_API_TOKEN || null;
  const authSource = env.OD_API_TOKEN ? "environment" : token ? "open-design-env-file" : null;
  const mcp = mcpEvidence([join(cwd, ".mcp.json"), join(cwd, ".kiro", "settings", "mcp.json"), join(home, ".claude", ".mcp.json"), join(home, ".claude", "settings", "mcp.json"), join(home, ".claude.json")], cwd);
  const defaultUrl = env.OD_PREFLIGHT_DISABLE_DEFAULT_URL === "1" ? null : "http://127.0.0.1:7456";
  const candidates = [...new Set([env.OD_DAEMON_URL, ...mcp.urls, cloneEnv.OD_DAEMON_URL, cloneEnv.DAEMON_URL, defaultUrl].map(url).filter(Boolean))];
  const probes = [];
  for (const candidate of candidates) {
    const result = await probe(candidate, token, timeoutMs);
    probes.push(result);
    if (result.authenticated) break;
  }
  const usable = probes.find((item) => item.authenticated) ?? null;
  const auth = probes.find((item) => [401, 403].includes(item.httpStatus)) ?? null;
  const reachable = probes.find((item) => item.reachable) ?? null;
  const chosen = usable ?? auth ?? reachable;
  // Port-conflict guard: a leftover Docker container publishing the port the preflight just reached IS the
  // daemon answering. It cannot launch the host's agents, so it is refused instead of used.
  const leftover = env.OD_PREFLIGHT_DISABLE_DOCKER === "1"
    ? { detected: false, healthy: false, publishedPort: null, container: null }
    : containerProbe(env, timeoutMs);
  let chosenPort = null;
  try { chosenPort = chosen?.url ? Number(new URL(chosen.url).port) || null : null; } catch { /* keep null */ }
  const containerDaemon = Boolean(chosen?.reachable && leftover.detected && leftover.publishedPort && chosenPort === leftover.publishedPort);
  const portConflict = containerDaemon
    ? {
      container: leftover.container,
      port: leftover.publishedPort,
      remediation: [
        `docker stop ${leftover.container ?? "open-design"}`,
        `docker update --restart=no ${leftover.container ?? "open-design"}`,
        "start the host daemon: scripts/onboard-open-design-agents.ps1|.sh --launch (Windows: scripts/register-open-design-daemon-task.ps1 keeps it running after a reboot)",
      ],
    }
    : null;
  const configured = mcp.configuredIn.length > 0;
  const available = !containerDaemon && (cliCheck.ok || Boolean(usable));
  const detected = available || configured || leftover.detected || Boolean(reachable);
  const reasonCode = containerDaemon ? "LEGACY_CONTAINER_DAEMON" : available ? null : auth ? "AUTH_REQUIRED" : leftover.detected ? "DETECTED_UNREACHABLE" : detected ? "HTTP_ERROR" : "NOT_DETECTED";
  return {
    ...legacy,
    detected,
    available,
    source: cliCheck.ok ? "cli" : usable && !containerDaemon ? "daemon-rest" : configured ? "mcp-config" : null,
    reasonCode,
    configured,
    configuredIn: mcp.configuredIn,
    mcpFunctional: cliCheck.ok,
    daemon: { url: chosen?.url ?? null, reachable: Boolean(chosen?.reachable), authenticated: Boolean(usable), httpStatus: chosen?.httpStatus ?? null, authSource, where: chosen?.reachable ? (containerDaemon ? "container" : "host") : null },
    legacyContainer: leftover,
    portConflict,
    artifactAccess: [...new Set(["clone", ...(usable && !containerDaemon ? ["rest"] : []), ...(cliCheck.ok ? ["cli"] : [])])],
    stage: "BRAINSTORM_GERAL (brief) + DESIGN (resolved authoritative package)",
    fallbackBehavior: containerDaemon
      ? "Stop the leftover Docker container and start the host daemon (see portConflict.remediation); do not reinstall the Docker image."
      : reasonCode === "AUTH_REQUIRED" ? "Set OD_API_TOKEN (or <clone>/.env) to the token the daemon was started with and resume; do not reinstall."
        : reasonCode === "DETECTED_UNREACHABLE" ? "Start the host daemon (scripts/onboard-open-design-agents.ps1|.sh --launch) and resume; do not reinstall."
          : "Offer installation only when no CLI, MCP or daemon was detected.",
  };
}
