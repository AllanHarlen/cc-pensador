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
import { existsSync, readdirSync } from "node:fs";
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

const subagentsAvailable = codex.available && agy.available;
// Overall status considers BOTH the domain subagents AND (for a delegating mode)
// the selected execution engine. A delegating mode whose engine is missing is a
// handled condition (fall back to claude), so it degrades to "partial" rather
// than blocking.
const allAvailable = subagentsAvailable && executionMode.available;

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
    : subagentsAvailable || executionMode.available || codex.available || agy.available
    ? "partial"
    : "unavailable",
  generatedAt: new Date().toISOString(),
  executionMode,
  subagents: {
    codex,
    agy,
  },
  guidance: buildGuidance(codex, agy, executionMode),
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
function buildGuidance(codex, agy, executionMode) {
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
