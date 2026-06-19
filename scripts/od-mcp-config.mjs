#!/usr/bin/env node
/**
 * od-mcp-config.mjs — wire the Open Design MCP server into an agent's `.mcp.json`
 * WITHOUT a host `od` binary (the Docker install path).
 *
 * The `od mcp install <agent>` CLI is the native wiring path, but it needs the
 * `od` binary on the host — which the Docker install does not provide. This
 * helper closes that gap: it asks the running daemon for the canonical launch
 * spec (GET /api/mcp/install-info — the exact `{ command, args, env }` the
 * Settings → MCP panel and `od mcp install` use) and deep-merges an
 * `mcpServers.<name>` entry into a JSON config file (project `.mcp.json` by
 * default), preserving everything else in that file.
 *
 * It is invoked by scripts/install-open-design.ps1 and .sh; Node is already a
 * hard dependency of cc-pensador (the preflight runs via `node`), so this avoids
 * branching on jq/python/PowerShell JSON handling.
 *
 * Usage:
 *   node od-mcp-config.mjs --config <path> [--daemon-url <url>] [--name <server>] [--token <bearer>]
 *
 * Exit codes: 0 ok · 2 usage · 3 daemon unreachable / bad response · 4 config unreadable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function arg(name, fallback = undefined) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

const daemonUrl = (arg("daemon-url", process.env.OD_DAEMON_URL || "http://localhost:7456")).replace(/\/$/, "");
const configPath = arg("config");
const serverName = arg("name", "open-design");
const token = arg("token", process.env.OD_API_TOKEN || "");

if (!configPath) {
  console.error("od-mcp-config: --config <path> is required");
  process.exit(2);
}

const infoUrl = `${daemonUrl}/api/mcp/install-info`;
let info;
try {
  const res = await fetch(infoUrl, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    console.error(`od-mcp-config: daemon ${res.status} on ${infoUrl}`);
    process.exit(3);
  }
  info = await res.json();
} catch (err) {
  console.error(`od-mcp-config: cannot reach daemon at ${daemonUrl}: ${err?.message ?? err}`);
  process.exit(3);
}

if (!info || typeof info.command !== "string" || !Array.isArray(info.args)) {
  console.error(`od-mcp-config: unexpected /api/mcp/install-info payload: ${JSON.stringify(info)}`);
  process.exit(3);
}

const entry = { command: info.command, args: info.args };
if (info.env && typeof info.env === "object" && Object.keys(info.env).length > 0) {
  entry.env = info.env;
}

// Load + deep-merge into the existing config, preserving unrelated keys.
let config = {};
if (existsSync(configPath)) {
  const raw = readFileSync(configPath, "utf8").trim();
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch {
      console.error(`od-mcp-config: ${configPath} is not valid JSON; refusing to overwrite`);
      process.exit(4);
    }
  }
}
if (!config.mcpServers || typeof config.mcpServers !== "object") {
  config.mcpServers = {};
}
const replaced = Object.prototype.hasOwnProperty.call(config.mcpServers, serverName);
config.mcpServers[serverName] = entry;

mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    ok: true,
    action: replaced ? "updated" : "added",
    configPath,
    server: serverName,
    command: entry.command,
  }),
);
process.exit(0);
