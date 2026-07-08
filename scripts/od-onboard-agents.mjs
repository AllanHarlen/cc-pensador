/**
 * od-onboard-agents.mjs — locate the host coding-agent CLIs (claude, codex,
 * antigravity) and register them with a LOCAL (host) Open Design daemon so its
 * agent onboarding can actually detect them.
 *
 * WHY THIS EXISTS
 * ----------------
 * Open Design's onboarding detects an agent by probing its binary on the daemon
 * process's PATH (apps/daemon/src/runtimes/executables.ts `resolveOnPath`). When
 * the daemon runs under the bundled Docker install, the container is a Linux
 * image with its own PATH and no view of the host filesystem — so the Windows
 * host binaries (`claude.cmd`, `codex.cmd`, `agy.exe`) can never be found or
 * executed there. Agent detection therefore only works against a daemon running
 * on the HOST, where `process.env.PATH` is the user's real shell PATH.
 *
 * This script bridges that gap. It:
 *   1. Resolves the host path of each agent CLI (PATH walk that mirrors Open
 *      Design's own `resolveOnPath`, honoring PATHEXT on Windows), accepting
 *      explicit overrides via flags / env.
 *   2. Writes the path overrides Open Design understands into the HOST daemon's
 *      `app-config.json` (`agentCliEnv.<agent>.<*_BIN>`), preserving the rest of
 *      the file. Only `claude` (CLAUDE_BIN) and `codex` (CODEX_BIN) have an
 *      allowlisted `*_BIN` key — see app-config.ts `AGENT_CLI_ENV_KEYS`.
 *   3. For `antigravity` (its def's bin is `agy`, and it has NO `*_BIN` override
 *      key) it reports the directory of `agy` in `pathAdditions`, so the daemon
 *      launcher can prepend it to PATH and detection resolves it.
 *   4. Optionally verifies a running daemon's `/api/agents` to confirm each
 *      agent now reports `available`.
 *
 * The detection / merge / path math is exposed as pure functions for tests; the
 * `main()` block at the bottom is the only part that touches fs / network.
 *
 * Usage:
 *   node od-onboard-agents.mjs [--data-dir <dir> | --config <app-config.json>]
 *        [--clone-dir <openDesignClone>]
 *        [--claude-bin <path>] [--codex-bin <path>] [--agy-bin <path>]
 *        [--verify <daemon-url>] [--token <bearer>] [--dry-run]
 *
 * Exit codes: 0 ok (≥1 agent detected) · 2 usage · 7 no agent detected.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import nodePath, { delimiter, dirname, join } from "node:path";

// ── Agent onboarding descriptors ────────────────────────────────────────────
//
// `bins` mirrors each Open Design runtime def's `bin` (+ fallbacks). `envKey`
// is the allowlisted `agentCliEnv` override key from the daemon's app-config.ts;
// `null` means the agent has no `*_BIN` override and must be resolved via PATH
// (true for antigravity, whose bin is `agy`).
export const AGENT_ONBOARDING = [
  { id: "claude", label: "Claude Code", bins: ["claude"], envKey: "CLAUDE_BIN" },
  { id: "codex", label: "Codex", bins: ["codex"], envKey: "CODEX_BIN" },
  { id: "antigravity", label: "Antigravity", bins: ["agy"], envKey: null },
];

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Resolve a binary name on PATH, honoring PATHEXT on win32. Mirrors Open
 * Design's `resolveOnPath` so detection here matches what the daemon will see.
 * Pure: all environment/fs access is injected, so tests run deterministically.
 *
 * @returns absolute path string, or null when not found.
 */
export function resolveOnPath(bin, opts = {}) {
  if (typeof bin !== "string" || bin.trim() === "") return null;
  const platform = opts.platform ?? process.platform;
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const sep = opts.delimiter ?? (platform === "win32" ? ";" : ":");
  const exists = opts.existsSyncFn ?? existsSync;
  // Join with the *target* platform's semantics, not the OS we run on — so a
  // linux-shaped probe stays forward-slashed even when this script runs on
  // Windows (and the unit tests can inject either platform deterministically).
  const joinFor = platform === "win32" ? nodePath.win32.join : nodePath.posix.join;
  const exts =
    platform === "win32"
      ? (opts.pathext ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
          .split(";")
          .map((e) => e.trim())
          .filter(Boolean)
      : [""];
  const extraDirs = Array.isArray(opts.extraDirs) ? opts.extraDirs : [];
  const seen = new Set();
  const dirs = [...pathEnv.split(sep), ...extraDirs].filter((d) => {
    if (!d || seen.has(d)) return false;
    seen.add(d);
    return true;
  });
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = joinFor(dir, bin + ext);
      if (exists(full)) return full;
    }
  }
  return null;
}

/**
 * Detect every onboarding agent. `overrides` maps an agent id to an explicit
 * absolute path (from a flag/env); when present and existing it wins over the
 * PATH walk. Returns one record per descriptor with `{ id, label, envKey, path,
 * dir, source }` where `path` is null when undetected.
 */
export function detectAgents(opts = {}) {
  const overrides = opts.overrides ?? {};
  const exists = opts.existsSyncFn ?? existsSync;
  return AGENT_ONBOARDING.map((agent) => {
    const override = overrides[agent.id];
    let path = null;
    let source = "none";
    if (typeof override === "string" && override.trim() && exists(override.trim())) {
      path = override.trim();
      source = "override";
    } else {
      for (const bin of agent.bins) {
        const resolved = resolveOnPath(bin, opts);
        if (resolved) {
          path = resolved;
          source = "path";
          break;
        }
      }
    }
    return {
      id: agent.id,
      label: agent.label,
      envKey: agent.envKey,
      path,
      dir: path ? dirname(path) : null,
      source,
    };
  });
}

/**
 * Build the `agentCliEnv` patch Open Design persists. Only agents WITH an
 * allowlisted `*_BIN` key and a resolved path get an entry — antigravity is
 * deliberately excluded (no override key; it is wired via PATH instead).
 */
export function buildAgentCliEnvPatch(detected) {
  const patch = {};
  for (const a of detected || []) {
    if (a && a.envKey && a.path) {
      patch[a.id] = { [a.envKey]: a.path };
    }
  }
  return patch;
}

/**
 * Unique directories that must be on the daemon's PATH for detection to work —
 * driven primarily by antigravity (no `*_BIN` override), but we include every
 * detected agent's dir so a GUI-launched daemon with a thin PATH still resolves
 * all of them.
 */
export function pathAdditionsFor(detected) {
  const dirs = [];
  const seen = new Set();
  for (const a of detected || []) {
    if (a && a.dir && !seen.has(a.dir)) {
      seen.add(a.dir);
      dirs.push(a.dir);
    }
  }
  return dirs;
}

/**
 * Deep-merge an `agentCliEnv` patch into an existing app-config object,
 * preserving every unrelated key and unrelated agent entries. Pure: returns a
 * new object, never mutates the input.
 */
export function mergeAppConfig(existing, patch) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing
      : {};
  const next = { ...base };
  const currentEnv =
    base.agentCliEnv && typeof base.agentCliEnv === "object" && !Array.isArray(base.agentCliEnv)
      ? base.agentCliEnv
      : {};
  const mergedEnv = { ...currentEnv };
  for (const [agentId, env] of Object.entries(patch || {})) {
    mergedEnv[agentId] = { ...(currentEnv[agentId] || {}), ...env };
  }
  if (Object.keys(mergedEnv).length > 0) {
    next.agentCliEnv = mergedEnv;
  }
  return next;
}

// ── Impure shell (fs + network) ──────────────────────────────────────────────

function arg(name, fallback = undefined) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

/** Resolve the host daemon's app-config.json path (mirrors app-config.ts `appConfigDir`). */
function resolveConfigPath() {
  const explicit = arg("config");
  if (explicit) return explicit;
  const cloneDir = arg("clone-dir", join(homedir(), ".open-design"));
  const dataDir =
    arg("data-dir", process.env.OD_DATA_DIR?.trim() || join(cloneDir, ".od"));
  return join(dataDir, "app-config.json");
}

async function verifyAgents(daemonUrl, token, detected) {
  const base = String(daemonUrl).replace(/\/$/, "");
  const url = `${base}/api/agents`;
  let payload;
  try {
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { ok: false, reason: `daemon ${res.status} on ${url}` };
    payload = await res.json();
  } catch (err) {
    return { ok: false, reason: `unreachable: ${err?.message ?? err}` };
  }
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.agents)
      ? payload.agents
      : [];
  const byId = new Map(list.map((a) => [a?.id, a]));
  const result = {};
  for (const a of detected) {
    const found = byId.get(a.id);
    result[a.id] = {
      available: Boolean(found?.available),
      ...(found?.version ? { version: found.version } : {}),
      ...(found?.authStatus ? { authStatus: found.authStatus } : {}),
    };
  }
  return { ok: true, agents: result, url };
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const overrides = {
    claude: arg("claude-bin", process.env.CLAUDE_BIN),
    codex: arg("codex-bin", process.env.CODEX_BIN),
    antigravity: arg("agy-bin", process.env.AGY_BIN),
  };

  const detected = detectAgents({ overrides });
  const found = detected.filter((a) => a.path);
  const missing = detected.filter((a) => !a.path).map((a) => a.id);

  const patch = buildAgentCliEnvPatch(detected);
  const pathAdditions = pathAdditionsFor(found);
  const configPath = resolveConfigPath();

  let configAction = "skipped";
  if (Object.keys(patch).length > 0 && !dryRun) {
    let existing = {};
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf8").trim();
      if (raw) {
        try {
          existing = JSON.parse(raw);
        } catch {
          console.error(
            `od-onboard-agents: ${configPath} is not valid JSON; refusing to overwrite`,
          );
          process.exit(2);
        }
      }
    }
    const merged = mergeAppConfig(existing, patch);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    configAction = "written";
  } else if (Object.keys(patch).length > 0 && dryRun) {
    configAction = "dry-run";
  }

  const verifyUrl = arg("verify");
  let verification = null;
  if (verifyUrl) {
    verification = await verifyAgents(
      verifyUrl,
      arg("token", process.env.OD_API_TOKEN || ""),
      detected,
    );
  }

  const report = {
    ok: found.length > 0,
    detected: detected.map((a) => ({
      id: a.id,
      label: a.label,
      path: a.path,
      source: a.source,
      registeredVia: a.envKey ? `agentCliEnv.${a.id}.${a.envKey}` : "PATH (no *_BIN override key)",
    })),
    missing,
    appConfig: { path: configPath, action: configAction, agentCliEnv: patch },
    // The launcher MUST prepend these to the daemon's PATH so antigravity (and
    // any agent without a *_BIN override) resolves on the host.
    pathAdditions,
    ...(verification ? { verification } : {}),
    notes: [
      missing.length
        ? `Not found on host: ${missing.join(", ")}. Install them or pass --<agent>-bin.`
        : "All three agents resolved on the host.",
      "Agent detection only works against a daemon running on the HOST. The bundled Docker daemon (Linux container) cannot see or execute host binaries.",
      pathAdditions.length
        ? `Launch the host daemon with these dirs prepended to PATH: ${pathAdditions.join(delimiter)}`
        : "No PATH additions required.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(found.length > 0 ? 0 : 7);
}

// Only run the shell when invoked directly, so tests can import the pure helpers.
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
// The URL comparison above is brittle on Windows (drive-letter / slash form), so
// fall back to a basename check that is robust across platforms.
if (
  invokedDirectly ||
  (process.argv[1] && /od-onboard-agents\.mjs$/.test(process.argv[1]))
) {
  await main();
}
