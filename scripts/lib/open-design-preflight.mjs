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

/** Daemon bearer token (env first, then the OD deploy .env). Never printed: callers only forward it as a header. */
export function odApiToken({ env = process.env, home = homedir() } = {}) {
  return env.OD_API_TOKEN || dotenv(join(home, ".open-design", "deploy", ".env")).OD_API_TOKEN || null;
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

/** Read-only `docker ps` evidence of an Open Design container (also used to tell WHERE the daemon runs). */
export function detectOdContainer(env, timeoutMs) {
  return docker(env, timeoutMs);
}

function docker(env, timeoutMs) {
  try {
    const stdout = execFileSync("docker", ["ps", "--format", "{{json .}}"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: Math.max(100, timeoutMs), windowsHide: true });
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!/open[-_ ]?design|ghcr\.io\/nexu-io\/od/i.test([row.Names, row.Image, row.Labels].join(" "))) continue;
      const match = String(row.Ports ?? "").match(/:(\d+)->\d+\/tcp/i);
      return { detected: true, healthy: /healthy/i.test(row.Status ?? ""), publishedPort: match ? Number(match[1]) : null, container: row.Names ?? null };
    }
  } catch { /* docker is optional and raw errors may expose environment data */ }
  return { detected: false, healthy: false, publishedPort: null, container: null };
}

export async function detectOpenDesign({ cwd = process.cwd(), env = process.env, timeoutMs = 1_500, cliCheck = { ok: false }, legacy = {}, home = homedir() } = {}) {
  const deploy = dotenv(join(home, ".open-design", "deploy", ".env"));
  const token = env.OD_API_TOKEN || deploy.OD_API_TOKEN || null;
  const authSource = env.OD_API_TOKEN ? "environment" : token ? "open-design-env-file" : null;
  const mcp = mcpEvidence([join(cwd, ".mcp.json"), join(cwd, ".kiro", "settings", "mcp.json"), join(home, ".claude", ".mcp.json"), join(home, ".claude", "settings", "mcp.json"), join(home, ".claude.json")], cwd);
  const defaultUrl = env.OD_PREFLIGHT_DISABLE_DEFAULT_URL === "1" ? null : "http://127.0.0.1:7456";
  const candidates = [...new Set([env.OD_DAEMON_URL, ...mcp.urls, deploy.OD_DAEMON_URL, deploy.DAEMON_URL, defaultUrl].map(url).filter(Boolean))];
  const probes = [];
  for (const candidate of candidates) {
    const result = await probe(candidate, token, timeoutMs);
    probes.push(result);
    if (result.authenticated) break;
  }
  const container = probes.some((item) => item.authenticated) || env.OD_PREFLIGHT_DISABLE_DOCKER === "1"
    ? { detected: false, healthy: false, publishedPort: null, container: null }
    : docker(env, timeoutMs);
  if (!probes.some((item) => item.authenticated) && container.publishedPort) {
    const discovered = `http://127.0.0.1:${container.publishedPort}`;
    if (!candidates.includes(discovered)) probes.push(await probe(discovered, token, timeoutMs));
  }
  const usable = probes.find((item) => item.authenticated) ?? null;
  const auth = probes.find((item) => [401, 403].includes(item.httpStatus)) ?? null;
  const reachable = probes.find((item) => item.reachable) ?? null;
  const configured = mcp.configuredIn.length > 0;
  const available = cliCheck.ok || Boolean(usable);
  const detected = available || configured || container.detected || Boolean(reachable);
  const reasonCode = available ? null : auth ? "AUTH_REQUIRED" : container.detected ? "DETECTED_UNREACHABLE" : detected ? "HTTP_ERROR" : "NOT_DETECTED";
  const chosen = usable ?? auth ?? reachable;
  return {
    ...legacy,
    detected,
    available,
    source: cliCheck.ok ? "cli" : usable ? "daemon-rest" : configured ? "mcp-config" : container.detected ? "docker" : null,
    reasonCode,
    configured,
    configuredIn: mcp.configuredIn,
    mcpFunctional: cliCheck.ok,
    daemon: { url: chosen?.url ?? null, reachable: Boolean(chosen?.reachable), authenticated: Boolean(usable), httpStatus: chosen?.httpStatus ?? null, authSource },
    docker: container,
    artifactAccess: [...new Set(["clone", ...(usable ? ["rest"] : []), ...(cliCheck.ok ? ["cli"] : [])])],
    stage: "BRAINSTORM_GERAL (brief) + DESIGN (resolved authoritative package)",
    fallbackBehavior: reasonCode === "AUTH_REQUIRED" ? "Configure OD_API_TOKEN and resume; do not reinstall." : reasonCode === "DETECTED_UNREACHABLE" ? "Repair/start the detected daemon and resume; do not reinstall." : "Offer installation only when no CLI, MCP, daemon, or container was detected.",
  };
}
