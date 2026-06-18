#!/usr/bin/env node
/**
 * Preflight check for cc-pensador (Pensador PRD Workflow).
 *
 * Two responsibilities:
 *
 * 1) DOMAIN SUBAGENTS — the lenses used inside the workflow regardless of who
 *    runs it:
 *      - Codex (codex:codex-rescue)                       — CODEX / BRAINSTORM_GERAL
 *      - AGY   (cc-antigravity-plugin:antigravity-agent)  — AGY   / BRAINSTORM_GERAL
 *
 * 2) EXECUTION MODE (--modo) — who performs the heavy generative work of the
 *    flow. `claude` (default) spends Claude Code tokens; `agy` | `kiro` | `codex`
 *    delegate the work to an external CLI plugin (via a slash command) so the
 *    cost is billed to that engine's quota instead, while Claude orchestrates and
 *    keeps AskUserQuestion as the only user-dialogue channel.
 *
 * Detection strategy: inspect the Claude Code plugin cache on disk to determine
 * whether each plugin is installed. Claude Code caches plugins under
 * ~/.claude/plugins/cache/<marketplace>/<plugin-name>/<version>/
 *
 * Availability is based on the PLUGIN being installed. The `codex`/`agy`/
 * `kiro-cli` binaries are also probed, but only as ADVISORY info: these are
 * invoked via the plugin (Agent/Skill/SlashCommand mechanism), not necessarily a
 * global CLI, so a missing binary must not produce a false-negative.
 *
 * Usage:
 *   node preflight.mjs [--modo claude|agy|kiro|codex]
 *
 * Output: JSON to stdout. Always exits 0 — the /pensador command reads the
 * `status` field to decide whether to fall back (to user questions for a stage,
 * or to claude execution mode when a delegating engine is unavailable).
 *
 * Requirements: 4.4, 5.4
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

const HOME = homedir();
const PLUGINS_CACHE = join(HOME, ".claude", "plugins", "cache");

/** Codex subagent: plugin marketplace + name + the agent key used in commands */
const CODEX_MARKETPLACE = "openai-codex";
const CODEX_PLUGIN_NAME = "codex";
const CODEX_SUBAGENT_KEY = "codex:codex-rescue";

/** AGY subagent: plugin marketplace + name + the agent key used in commands */
const AGY_MARKETPLACE = "cc-antigravity-plugin";
const AGY_PLUGIN_NAME = "cc-antigravity-plugin";
const AGY_SUBAGENT_KEY = "cc-antigravity-plugin:antigravity-agent";

/** Kiro execution-mode plugin: marketplace + name + slash command */
const KIRO_MARKETPLACE = "cc-kiro-plugin";
const KIRO_PLUGIN_NAME = "cc-kiro-plugin";
const KIRO_COMMAND = "/cc-kiro-plugin:kiro";

/**
 * Code Base Memory MCP (https://github.com/DeusData/codebase-memory-mcp) — the
 * MANDATORY project-exploration support. Used before PRD_BASE/Spec generation to
 * build an accurate, token-cheap understanding of the existing codebase.
 */
const CODEBASE_MEMORY_SERVER = "codebase-memory-mcp";

/** OpenSpec (https://github.com/Fission-AI/OpenSpec) — OPTIONAL spec workflow. */
const OPENSPEC_CLI = "openspec";
const OPENSPEC_DIR = "openspec";

/**
 * Execution modes recognized by --modo. Mirrors EXECUTION_MODES in
 * pensador-engine.mjs. `claude` is the default and needs no plugin.
 */
const EXECUTION_MODES = {
  claude: { delegates: false, command: null, plugin: null, defaultParam: null },
  agy: {
    delegates: true,
    command: "/cc-antigravity-plugin:antigravity",
    plugin: { marketplace: AGY_MARKETPLACE, name: AGY_PLUGIN_NAME },
    defaultParam: "--model claude-4.6-opus-thinking",
  },
  kiro: {
    delegates: true,
    command: KIRO_COMMAND,
    plugin: { marketplace: KIRO_MARKETPLACE, name: KIRO_PLUGIN_NAME },
    defaultParam: "--model claude-opus-4.8 --effort high",
  },
  codex: {
    delegates: true,
    command: "/codex:rescue",
    plugin: { marketplace: CODEX_MARKETPLACE, name: CODEX_PLUGIN_NAME },
    defaultParam: "--effort high",
  },
};

// ── Arguments ──────────────────────────────────────────────────────────────

/**
 * Parses `--modo <value>` / `--modo=<value>` from argv. Unknown / absent →
 * `claude`. Returns the resolved mode plus whether the requested value was valid.
 */
function parseModeArg(argv) {
  const joined = argv.join(" ");
  const m = joined.match(/--modo(?:=|\s+)([a-zA-Z]+)/);
  const requested = m ? m[1].toLowerCase() : null;
  const known = requested !== null && Object.prototype.hasOwnProperty.call(EXECUTION_MODES, requested);
  return {
    mode: known ? requested : "claude",
    requestedMode: requested,
    modeValid: requested === null || known,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check whether a CLI binary is present on PATH and responsive.
 * @param {string} cli  Binary name (e.g. "codex", "agy", "kiro-cli")
 * @returns {{ ok: boolean, version?: string, error?: string }}
 */
function checkCli(cli) {
  try {
    const out = execSync(`${cli} --version`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    })
      .toString()
      .trim();
    return { ok: true, version: out.split(/\r?\n/)[0] };
  } catch (err) {
    return { ok: false, error: err.message?.split(/\r?\n/)[0] ?? "not found" };
  }
}

/**
 * Naive semver comparison: returns negative / 0 / positive.
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const parse = (v) =>
    String(v)
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const aParts = parse(a);
  const bParts = parse(b);
  const max = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < max; i++) {
    const delta = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * Check whether a Claude Code plugin is installed in the cache.
 * @param {string} marketplace  Marketplace identifier (e.g. "openai-codex")
 * @param {string} pluginName   Plugin name within that marketplace
 * @returns {{ ok: boolean, version?: string, path?: string, error?: string }}
 */
function checkPlugin(marketplace, pluginName) {
  const dir = join(PLUGINS_CACHE, marketplace, pluginName);
  if (!existsSync(dir)) {
    return { ok: false, error: `Plugin directory not found: ${dir}` };
  }

  let versions = [];
  try {
    versions = readdirSync(dir).filter((v) => v.trim() !== "");
  } catch {
    return { ok: false, error: `Cannot read plugin directory: ${dir}` };
  }

  if (versions.length === 0) {
    return { ok: false, error: `No installed versions in: ${dir}` };
  }

  versions.sort(compareVersions);
  const latest = versions[versions.length - 1];
  return {
    ok: true,
    version: latest,
    path: join(dir, latest),
  };
}

// ── Checks ─────────────────────────────────────────────────────────────────

/**
 * Full availability check for the Codex subagent.
 * Verifies both the plugin cache entry and the CLI binary.
 */
function checkCodex() {
  const plugin = checkPlugin(CODEX_MARKETPLACE, CODEX_PLUGIN_NAME);
  const cli = checkCli("codex");

  // The subagent is invoked as a Claude Code plugin (codex:codex-rescue), not via
  // a global CLI. Availability hinges on the plugin being installed; the CLI check
  // is advisory only (many setups have no `codex` binary on PATH).
  const available = plugin.ok;
  return {
    subagentKey: CODEX_SUBAGENT_KEY,
    available,
    plugin,
    cli,
    cliAdvisory: true,
    stage: "CODEX",
    parameter: "--effort high",
    fallbackBehavior:
      "If unavailable, the Pensador will ask the user (via AskUserQuestion) whether to proceed without Codex refinement.",
  };
}

/**
 * Full availability check for the AGY subagent.
 * Verifies both the plugin cache entry and the CLI binary.
 */
function checkAgy() {
  const plugin = checkPlugin(AGY_MARKETPLACE, AGY_PLUGIN_NAME);
  const cli = checkCli("agy");

  // AGY ships as a plugin (cc-antigravity-plugin) with a bridge script — there is
  // typically no `agy` binary on PATH. Base availability on the plugin; the CLI
  // check is advisory only (avoids a guaranteed false-negative).
  const available = plugin.ok;
  return {
    subagentKey: AGY_SUBAGENT_KEY,
    available,
    plugin,
    cli,
    cliAdvisory: true,
    stage: "AGY",
    parameter: "--model gemini-3.1-pro-high",
    fallbackBehavior:
      "If unavailable, the Pensador will ask the user (via AskUserQuestion) whether to proceed without AGY gap analysis.",
  };
}

/**
 * Returns true when `path` exists and its text content mentions `needle`.
 * Total: never throws (missing/unreadable file → false).
 */
function fileMentions(path, needle) {
  try {
    return existsSync(path) && readFileSync(path, "utf8").includes(needle);
  } catch {
    return false;
  }
}

/**
 * MANDATORY: Code Base Memory MCP availability.
 *
 * The server may be reachable either as a CLI binary on PATH or as a registered
 * MCP server in one of the common host config files (project `.mcp.json`, Kiro
 * `.kiro/settings/mcp.json`, or the user-level Claude `~/.claude/.mcp.json`).
 * Both signals are advisory in isolation; availability is their OR.
 *
 * If unavailable, the Pensador asks (via AskUserQuestion) whether the user wants
 * to install the server now. If the user says yes, Claude runs the platform
 * installer and resumes the flow from EXPLORE. If the user declines, the fallback
 * is plain Read/Glob/Grep exploration.
 */
function checkCodebaseMemory() {
  const cli = checkCli(CODEBASE_MEMORY_SERVER);
  const configCandidates = [
    join(process.cwd(), ".mcp.json"),
    join(process.cwd(), ".kiro", "settings", "mcp.json"),
    join(HOME, ".claude", ".mcp.json"),
    join(HOME, ".claude", "settings", "mcp.json"),
  ];
  const configuredIn = configCandidates.filter((p) => fileMentions(p, CODEBASE_MEMORY_SERVER));
  const configured = configuredIn.length > 0;
  const available = cli.ok || configured;

  // Platform-specific install commands exposed so the Pensador can run them
  // directly when the user accepts the installation offer in EXPLORE.
  const installCommands = {
    linux:   "curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash",
    mac:     "curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash",
    windows: "Invoke-WebRequest -Uri https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 -OutFile install.ps1; .\\install.ps1",
  };

  return {
    server: CODEBASE_MEMORY_SERVER,
    mandatory: true,
    available,
    cli,
    configured,
    configuredIn,
    stage: "EXPLORE (pre-PRD_BASE/Spec exploration) + ARCH",
    purpose:
      "Explore the existing project before generating the PRD/Spec base, for an accurate understanding of the structure the feature/fix will act upon.",
    installCommands,
    fallbackBehavior:
      "If unavailable, offer installation via AskUserQuestion: " +
      "(A) install codebase-memory-mcp now (Claude runs the installer and restarts EXPLORE), " +
      "(B) skip exploration and use Read/Glob/Grep instead.",
  };
}

/**
 * OPTIONAL: OpenSpec availability.
 *
 * Detected via the `openspec` CLI on PATH or an existing `openspec/` directory in
 * the working tree (created by `openspec init`). When present, the Pensador asks
 * (via AskUserQuestion) in INIT whether to generate a PRD or a structured Spec.
 */
function checkOpenSpec() {
  const cli = checkCli(OPENSPEC_CLI);
  const dirPath = join(process.cwd(), OPENSPEC_DIR);
  const initialized = existsSync(dirPath);
  const available = cli.ok || initialized;

  return {
    cli: OPENSPEC_CLI,
    optional: true,
    available,
    cliCheck: cli,
    initialized,
    stage: "INIT",
    behavior:
      "When available, INIT presents an AskUserQuestion offering PRD or Spec. If the user picks Spec, PRD_BASE is repurposed into OpenSpec assembly and later stages reason over the spec.",
  };
}

/**
 * Availability check for the selected execution mode (--modo). For the default
 * `claude` mode, always available (no external plugin needed). For a delegating
 * mode, checks the plugin cache for the engine plugin; the matching CLI binary is
 * probed as advisory only.
 *
 * @param {string} mode  Resolved execution mode key.
 * @param {boolean} modeValid  Whether the requested --modo value was recognized.
 * @param {string|null} requestedMode  Raw requested value (for guidance).
 */
function checkExecutionMode(mode, modeValid, requestedMode) {
  const cfg = EXECUTION_MODES[mode] ?? EXECUTION_MODES.claude;

  if (!cfg.delegates) {
    return {
      mode,
      requestedMode,
      modeValid,
      delegates: false,
      available: true,
      command: null,
      fallbackBehavior:
        "Default mode: Claude Code performs the workflow itself. No external engine required.",
    };
  }

  const plugin = checkPlugin(cfg.plugin.marketplace, cfg.plugin.name);
  const cliName = mode === "kiro" ? "kiro-cli" : mode === "codex" ? "codex" : "agy";
  const cli = checkCli(cliName);

  return {
    mode,
    requestedMode,
    modeValid,
    delegates: true,
    available: plugin.ok,
    command: cfg.command,
    defaultParam: cfg.defaultParam,
    plugin,
    cli,
    cliAdvisory: true,
    fallbackBehavior:
      `If the ${mode} engine plugin is unavailable, the Pensador asks (via AskUserQuestion) whether to ` +
      `fall back to --modo claude (run on Claude Code tokens) or abort.`,
  };
}

// ── Report ─────────────────────────────────────────────────────────────────

const { mode, requestedMode, modeValid } = parseModeArg(process.argv.slice(2));

const codex = checkCodex();
const agy = checkAgy();
const executionMode = checkExecutionMode(mode, modeValid, requestedMode);
const codebaseMemory = checkCodebaseMemory();
const openspec = checkOpenSpec();

const subagentsAvailable = codex.available && agy.available;
// Overall status considers the domain subagents, the selected execution engine,
// AND the mandatory Code Base Memory exploration support. A delegating mode whose
// engine is missing, or a missing Code Base Memory server, are handled conditions
// (graceful fallback), so they degrade to "partial" rather than blocking. OpenSpec
// is optional and never affects status.
const allAvailable =
  subagentsAvailable && executionMode.available && codebaseMemory.available;

/**
 * Summary consumed by the /pensador command.
 *
 * Fields:
 *   status         "ok" | "partial" | "unavailable"
 *   executionMode  selected --modo engine availability
 *   subagents      domain-lens subagent checks (codex, agy)
 *   generatedAt    ISO timestamp
 *   guidance       human-readable summary for the LLM/command
 */
const report = {
  status: allAvailable
    ? "ok"
    : subagentsAvailable || executionMode.available || codex.available || agy.available || codebaseMemory.available
    ? "partial"
    : "unavailable",
  generatedAt: new Date().toISOString(),
  executionMode,
  subagents: {
    codex,
    agy,
  },
  integrations: {
    codebaseMemory,
    openspec,
  },
  guidance: buildGuidance(codex, agy, executionMode, codebaseMemory, openspec),
};

console.log(JSON.stringify(report, null, 2));
// Always exit 0: the /pensador command reads the `status` field from stdout to
// decide fallbacks. A non-zero exit is reserved for the script itself failing,
// not for a subagent/engine being unavailable (which is a normal, handled
// condition).
process.exit(0);

// ── Guidance builder ───────────────────────────────────────────────────────

/**
 * Produce a human-readable summary the /pensador command can embed in its
 * opening context or relay to the user when a subagent / execution engine is
 * missing.
 */
function buildGuidance(codex, agy, executionMode, codebaseMemory, openspec) {
  const lines = [];

  // Execution mode summary first — it is the most impactful decision.
  if (!executionMode.modeValid) {
    lines.push(
      `Execution mode: requested --modo "${executionMode.requestedMode}" is unknown; falling back to --modo claude.`,
    );
  }

  if (executionMode.delegates) {
    if (executionMode.available) {
      lines.push(
        `Execution mode: --modo ${executionMode.mode} — engine available. ` +
          `Delegating work via ${executionMode.command}${
            executionMode.defaultParam ? " " + executionMode.defaultParam : ""
          }. Claude orchestrates and owns AskUserQuestion.`,
      );
    } else {
      lines.push(
        `Execution mode: --modo ${executionMode.mode} — engine NOT available (plugin not found).`,
      );
      if (executionMode.plugin && !executionMode.plugin.ok) {
        lines.push(`  Plugin: ${executionMode.plugin.error}`);
      }
      lines.push(`  → ${executionMode.fallbackBehavior}`);
    }
  } else {
    lines.push("Execution mode: --modo claude (default) — Claude Code performs the workflow itself.");
  }

  lines.push("");

  // Code Base Memory (mandatory exploration support) + OpenSpec (optional).
  if (codebaseMemory) {
    if (codebaseMemory.available) {
      lines.push(
        `Code Base Memory: ${codebaseMemory.server} available — explore the project before PRD_BASE/Spec generation ` +
          `(index_repository → get_architecture → search_graph/trace_path).`,
      );
    } else {
      lines.push(
        `Code Base Memory: ${codebaseMemory.server} NOT available (no CLI on PATH, no MCP config entry).`,
      );
      lines.push(
        `  → EXPLORE stage action: use AskUserQuestion with two options:`,
      );
      lines.push(
        `    (A) Instalar agora — Claude runs the platform installer then resumes EXPLORE with the server running.`,
      );
      lines.push(
        `        Linux/macOS: ${codebaseMemory.installCommands?.linux ?? "install.sh"}`,
      );
      lines.push(
        `        Windows (PowerShell): ${codebaseMemory.installCommands?.windows ?? "install.ps1"}`,
      );
      lines.push(
        `    (B) Seguir sem o Code Base Memory — use Read/Glob/Grep exploration; record fallback in codebase-memory.md.`,
      );
    }
  }

  if (openspec) {
    if (openspec.available) {
      lines.push(
        "OpenSpec: detected — INIT should ask (via AskUserQuestion) whether to generate a PRD or a structured Spec.",
      );
    } else {
      lines.push("OpenSpec: not detected — flow stays in PRD mode (no PRD-vs-Spec question).");
    }
  }

  lines.push("");

  if (codex.available && agy.available) {
    lines.push("Domain subagents: both Codex and AGY are available.");
    lines.push(`  CODEX stage → ${codex.subagentKey} (${codex.parameter})`);
    lines.push(`  AGY stage   → ${agy.subagentKey} (${agy.parameter})`);
    return lines.join("\n");
  }

  lines.push("Domain subagents: one or more are unavailable.");

  if (!codex.available) {
    lines.push(`  ✗ Codex (${codex.subagentKey}) — NOT available (plugin not found)`);
    if (!codex.plugin.ok) lines.push(`    Plugin: ${codex.plugin.error}`);
    lines.push(`    → CODEX stage fallback: ${codex.fallbackBehavior}`);
  } else {
    lines.push(`  ✓ Codex (${codex.subagentKey}) — available (v${codex.plugin.version})`);
  }

  if (!agy.available) {
    lines.push(`  ✗ AGY (${agy.subagentKey}) — NOT available (plugin not found)`);
    if (!agy.plugin.ok) lines.push(`    Plugin: ${agy.plugin.error}`);
    lines.push(`    → AGY stage fallback: ${agy.fallbackBehavior}`);
  } else {
    lines.push(`  ✓ AGY (${agy.subagentKey}) — available (v${agy.plugin.version})`);
  }

  lines.push("");
  lines.push(
    "The Pensador handles unavailable subagents/engines at their respective points by asking the user (via AskUserQuestion) whether to proceed without them or fall back to --modo claude.",
  );

  return lines.join("\n");
}
