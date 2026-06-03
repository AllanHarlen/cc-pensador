#!/usr/bin/env node
/**
 * Preflight check for cc-pensador (Pensador PRD Workflow).
 *
 * Checks the availability of the two subagents used by the /pensador command:
 *   - Codex  (codex:codex-rescue)           — used in Stage 3 (effort high)
 *   - AGY    (cc-antigravity-plugin:antigravity-agent) — used in Stage 4 (gemini-3.1-pro-high)
 *
 * Detection strategy: inspect the Claude Code plugin cache on disk to determine
 * whether each plugin is installed. Claude Code caches plugins under
 * ~/.claude/plugins/cache/<marketplace>/<plugin-name>/<version>/
 *
 * The script also checks for the `codex` and `agy` CLI binaries, since the
 * Pensador skill delegates to them via the Agent/Skill mechanism.
 *
 * Output: JSON to stdout. Exit 0 if both subagents are available; exit 1 if
 * one or more required dependencies are missing (so the /pensador command can
 * decide whether to fall back to user questions for those stages).
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

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check whether a CLI binary is present on PATH and responsive.
 * @param {string} cli  Binary name (e.g. "codex", "agy")
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

  const available = plugin.ok && cli.ok;
  return {
    subagentKey: CODEX_SUBAGENT_KEY,
    available,
    plugin,
    cli,
    stage: "stage_3",
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

  const available = plugin.ok && cli.ok;
  return {
    subagentKey: AGY_SUBAGENT_KEY,
    available,
    plugin,
    cli,
    stage: "stage_4",
    parameter: "--model gemini-3.1-pro-high",
    fallbackBehavior:
      "If unavailable, the Pensador will ask the user (via AskUserQuestion) whether to proceed without AGY gap analysis.",
  };
}

// ── Report ─────────────────────────────────────────────────────────────────

const codex = checkCodex();
const agy = checkAgy();

const allAvailable = codex.available && agy.available;

/**
 * Summary consumed by the /pensador command.
 *
 * Fields:
 *   status        "ok" | "partial" | "unavailable"
 *   codex         Codex subagent check result
 *   agy           AGY subagent check result
 *   generatedAt   ISO timestamp
 *   guidance      Human-readable summary for the LLM/command
 */
const report = {
  status: allAvailable ? "ok" : codex.available || agy.available ? "partial" : "unavailable",
  generatedAt: new Date().toISOString(),
  subagents: {
    codex,
    agy,
  },
  guidance: buildGuidance(codex, agy),
};

console.log(JSON.stringify(report, null, 2));
process.exit(allAvailable ? 0 : 1);

// ── Guidance builder ───────────────────────────────────────────────────────

/**
 * Produce a human-readable summary the /pensador command can embed in its
 * opening context or relay to the user when a subagent is missing.
 */
function buildGuidance(codex, agy) {
  const lines = [];

  if (codex.available && agy.available) {
    lines.push("Both Codex and AGY subagents are available. The full 5-stage Pensador workflow can proceed.");
    lines.push(`  Stage 3 → ${codex.subagentKey} (${codex.parameter})`);
    lines.push(`  Stage 4 → ${agy.subagentKey} (${agy.parameter})`);
    return lines.join("\n");
  }

  lines.push("Pensador preflight: one or more subagents are unavailable.");
  lines.push("");

  if (!codex.available) {
    lines.push(`  ✗ Codex (${codex.subagentKey}) — NOT available`);
    if (!codex.plugin.ok)  lines.push(`    Plugin: ${codex.plugin.error}`);
    if (!codex.cli.ok)     lines.push(`    CLI:    ${codex.cli.error}`);
    lines.push(`    → Stage 3 fallback: ${codex.fallbackBehavior}`);
    lines.push("");
  } else {
    lines.push(`  ✓ Codex (${codex.subagentKey}) — available (v${codex.plugin.version})`);
  }

  if (!agy.available) {
    lines.push(`  ✗ AGY (${agy.subagentKey}) — NOT available`);
    if (!agy.plugin.ok)  lines.push(`    Plugin: ${agy.plugin.error}`);
    if (!agy.cli.ok)     lines.push(`    CLI:    ${agy.cli.error}`);
    lines.push(`    → Stage 4 fallback: ${agy.fallbackBehavior}`);
  } else {
    lines.push(`  ✓ AGY (${agy.subagentKey}) — available (v${agy.plugin.version})`);
  }

  lines.push("");
  lines.push(
    "The Pensador will handle unavailable subagents at their respective stages by asking the user whether to proceed without them.",
  );

  return lines.join("\n");
}
