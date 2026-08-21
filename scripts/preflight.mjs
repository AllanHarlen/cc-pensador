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
 * It also reports an `integrations` block: codebaseMemory (MANDATORY exploration
 * before PRD/Spec), webResearch (MANDATORY two-track RESEARCH — business benchmark +
 * current stack practice; descriptive only, since WebSearch/WebFetch are built-in
 * tools and not probeable on disk),
 * openspec (OPTIONAL spec mode), and openDesign (OPTIONAL, front-end-conditional
 * design-system support — parsed design brief → DESIGN.md).
 * Optional integrations never affect the overall `status`.
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
const OPENSPEC_CONFIG_FILE = "config.yaml";
/** 1.9.0: honest root resolution (non-zero exit outside a root) + reliable archive exit codes. */
const OPENSPEC_MIN_VERSION = "1.9.0";
const OPENSPEC_RECOMMENDED_VERSION = "1.10.0";
/** Any of these under .claude/skills/ signals the EXPANDED profile is also installed (opt-in via `openspec config profile`). */
const OPENSPEC_EXPANDED_SKILL_DIRS = [
  "openspec-new-change",
  "openspec-ff-change",
  "openspec-verify-change",
];
/** Any of these signals the CORE profile is installed (what `openspec init` writes by default). */
const OPENSPEC_CORE_SKILL_DIRS = [
  "openspec-propose",
  "openspec-apply-change",
  "openspec-archive-change",
];

/**
 * Context7 MCP — OPTIONAL. Preferred source for the version-currency phase of
 * TECH_RESEARCH. Detection matches registered MCP server NAMES (below) or, for a
 * server registered under some other name, the package spec / endpoint inside its
 * definition.
 */
const CONTEXT7_SERVER_NAMES = ["context7", "context7-mcp", "ctx7"];
const CONTEXT7_DEFINITION_MARKERS = ["@upstash/context7-mcp", "mcp.context7.com"];

/**
 * Open Design (https://github.com/nexu-io/open-design) — OPTIONAL, front-end-
 * conditional design-system support. Detected via a registered MCP entry or a
 * non-coreutils `od` CLI on PATH. NOTE: GNU coreutils also ships an `od`
 * (octal-dump) binary, so a bare PATH probe is ambiguous — `checkOpenDesign()`
 * filters out the coreutils signature. When the demand has a front-end and OD is
 * unavailable, the Pensador offers to install it (local Docker/pnpm app — there
 * is no one-line installer); otherwise it degrades to an inline DESIGN.md. Never
 * blocks and never affects status.
 */
const OPEN_DESIGN_CLI = "od";
const OPEN_DESIGN_SERVER = "open-design";

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
 * Check whether a CLI binary is present on PATH and responsive. Optionally
 * enforces a minimum semver and flags whether it meets a recommended one.
 * @param {string} cli  Binary name (e.g. "codex", "agy", "kiro-cli", "openspec")
 * @param {{ minVersion?: string, recommendedVersion?: string }} [options]
 * @returns {{ ok: boolean, version?: string, minVersion?: string|null,
 *   recommendedVersion?: string|null, meetsRecommended?: boolean|null, error?: string }}
 */
function checkCli(cli, options = {}) {
  try {
    const out = execSync(`${cli} --version`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    })
      .toString()
      .trim();
    const versionLine = out.split(/\r?\n/)[0];
    const version = versionLine.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null;
    if (options.minVersion && (!version || compareSemver(version, options.minVersion) < 0)) {
      return {
        ok: false,
        version: version ?? versionLine,
        minVersion: options.minVersion,
        error: `${cli} ${options.minVersion}+ is required (found ${version ?? versionLine})`,
      };
    }
    return {
      ok: true,
      version: version ?? versionLine,
      minVersion: options.minVersion ?? null,
      recommendedVersion: options.recommendedVersion ?? null,
      meetsRecommended: options.recommendedVersion && version
        ? compareSemver(version, options.recommendedVersion) >= 0
        : null,
    };
  } catch (err) {
    return { ok: false, error: err.message?.split(/\r?\n/)[0] ?? "not found" };
  }
}

/**
 * Parses a strict semver string (core + optional prerelease). Returns null on
 * anything that doesn't match `x.y.z(-prerelease)?`.
 * @param {string} version
 */
function parseSemver(version) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map((part) => Number(part)),
    prerelease: match[4]?.split(".") ?? [],
  };
}

/**
 * Strict semver comparison (core numeric, then prerelease per semver.org
 * precedence rules). Returns null when either input fails to parse.
 * @param {string} left
 * @param {string} right
 */
function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;

  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    if (a.prerelease[i] == null) return -1;
    if (b.prerelease[i] == null) return 1;
    if (a.prerelease[i] === b.prerelease[i]) continue;
    const aNumber = /^\d+$/.test(a.prerelease[i]);
    const bNumber = /^\d+$/.test(b.prerelease[i]);
    if (aNumber && bNumber) return Number(a.prerelease[i]) - Number(b.prerelease[i]);
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return a.prerelease[i].localeCompare(b.prerelease[i]);
  }
  return 0;
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
 * Normalizes a filesystem path for comparison: forward slashes, no trailing
 * separator, lower-cased. Claude Code stores the keys of `~/.claude.json`'s
 * `projects` map with forward slashes, while `process.cwd()` on Windows yields
 * backslashes — comparing them raw would never match.
 */
function normalizePathKey(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Reads a JSON MCP config and returns the server maps that apply to `cwd`: the
 * file's root `mcpServers`, plus the entry for the current project when the file
 * is Claude Code's `~/.claude.json` (which nests per-project config under
 * `projects[<absolute path>]`).
 *
 * Returns `[]` when the file is missing or unparseable — an unreadable config is
 * not evidence either way. Total: never throws.
 *
 * @param {string} file
 * @param {string} cwd
 * @returns {{ servers: object, disabled: string[] }[]}
 */
function readMcpServerMaps(file, cwd) {
  let json;
  try {
    if (!existsSync(file)) return [];
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!json || typeof json !== "object") return [];

  const maps = [];
  if (json.mcpServers && typeof json.mcpServers === "object") {
    maps.push({ servers: json.mcpServers, disabled: [] });
  }
  if (json.projects && typeof json.projects === "object") {
    const wanted = normalizePathKey(cwd);
    for (const [key, project] of Object.entries(json.projects)) {
      if (normalizePathKey(key) !== wanted) continue;
      if (project?.mcpServers && typeof project.mcpServers === "object") {
        maps.push({
          servers: project.mcpServers,
          disabled: Array.isArray(project.disabledMcpjsonServers)
            ? project.disabledMcpjsonServers
            : [],
        });
      }
    }
  }
  return maps;
}

/**
 * Finds an MCP server registration across `files`, matching either the server's
 * NAME (against `names`) or a marker inside its definition (`markers` — package
 * spec or endpoint, for a server registered under a custom name). Servers listed
 * in `disabledMcpjsonServers` do not count.
 *
 * This parses the JSON rather than substring-scanning the raw text, which matters
 * most for `~/.claude.json`: that file is Claude Code's entire user config
 * (100+ KB) and carries per-project `allowedTools`, example file paths and other
 * arbitrary data, so a bare substring hit there would report a server as
 * registered when nothing is.
 *
 * @param {string[]} files
 * @param {string} cwd
 * @param {string[]} names
 * @param {string[]} [markers]
 * @returns {{ path: string, server: string }|null}
 */
function findMcpServer(files, cwd, names, markers = []) {
  const wanted = names.map((n) => n.toLowerCase());
  const wantedMarkers = markers.map((m) => m.toLowerCase());
  for (const file of files) {
    for (const { servers, disabled } of readMcpServerMaps(file, cwd)) {
      const off = new Set(disabled.map((n) => String(n).toLowerCase()));
      for (const [name, definition] of Object.entries(servers)) {
        const key = name.toLowerCase();
        if (off.has(key)) continue;
        if (wanted.includes(key)) return { path: file, server: name };
        if (wantedMarkers.length === 0) continue;
        let blob = "";
        try {
          blob = JSON.stringify(definition ?? "").toLowerCase();
        } catch {
          blob = "";
        }
        if (wantedMarkers.some((m) => blob.includes(m))) return { path: file, server: name };
      }
    }
  }
  return null;
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
 * OPTIONAL: Context7 MCP — current, versioned documentation for a library,
 * framework, SDK, API or cloud service, injected into context before code
 * that uses it is written or a PRD/Spec claim about it is drafted.
 *
 * Purpose here specifically: the TECH_RESEARCH track's `version-currency`
 * phase (references/tech-research.md) exists to neutralize the model's
 * training-cutoff staleness for version-sensitive tech — Context7 is the
 * versioned-documentation source that phase consults when available, ranking
 * above release notes / guides / community sources under the same
 * official-first tier ordering TECH_RESEARCH already uses.
 *
 * Detection: skill presence, plus a real MCP server registration found by
 * PARSING the known config files (`findMcpServer`) rather than substring-scanning
 * them. The strictness matters because a false positive is silent and costly:
 * RESEARCH would elect Context7 as the preferred source for the version-currency
 * phase and only discover it is not registered when `resolve-library-id` fails
 * mid-flow. `~/.claude.json` in particular is Claude Code's whole user config and
 * holds arbitrary per-project data, so a bare `ctx7`/`context7` substring there is
 * not evidence of anything. Disabled servers do not count.
 *
 * Absence never blocks the flow — the phase falls back to WebSearch/WebFetch.
 */
function checkContext7() {
  const evidence = [];
  const skillCandidates = [
    join(HOME, ".claude", "skills", "context7", "SKILL.md"),
    join(HOME, ".claude", "skills", "context7-mcp", "SKILL.md"),
  ];
  for (const file of skillCandidates) {
    if (existsSync(file)) evidence.push({ type: "skill", path: file });
  }

  const configCandidates = [
    join(process.cwd(), ".mcp.json"),
    join(HOME, ".claude.json"),
    join(HOME, ".claude", ".mcp.json"),
    join(HOME, ".claude", "mcp.json"),
    join(HOME, ".config", "claude", "mcp.json"),
  ];
  const hit = findMcpServer(
    configCandidates,
    process.cwd(),
    CONTEXT7_SERVER_NAMES,
    CONTEXT7_DEFINITION_MARKERS,
  );
  if (hit) {
    evidence.push({ type: "mcp-config", path: hit.path, server: hit.server });
  }

  const available = evidence.length > 0;
  return {
    server: "context7",
    mandatory: false,
    available,
    evidence,
    stage: "RESEARCH (TECH_RESEARCH track, version-currency phase)",
    purpose:
      "Current, versioned library/framework documentation so version-sensitive claims in the PRD/Spec " +
      "are researched, not recalled from the training cutoff.",
    installCommands: { any: "npx ctx7 setup --claude" },
    fallbackBehavior:
      "If unavailable, TECH_RESEARCH falls back to WebSearch/WebFetch for the version-currency phase " +
      "and the limitation is noted alongside the researched claim.",
  };
}

/**
 * MANDATORY (when the demand has a product surface): web/market research support.
 *
 * Unlike the other integrations, this one has NOTHING to probe on disk: the RESEARCH
 * stage runs on Claude Code's built-in `WebSearch`/`WebFetch` tools, whose
 * availability is only observable by the agent at runtime (they may be disabled by
 * policy or offline). So this block is DESCRIPTIVE: it carries the stage contract,
 * budget and compliance rules the Pensador must honor, and `probeable: false` makes
 * explicit that `available` is not a disk check. It never affects the overall status.
 */
function checkWebResearch() {
  return {
    tools: { search: "WebSearch", fetch: "WebFetch" },
    mandatory: true,
    probeable: false,
    stage: "RESEARCH (pre-PRD_BASE/Spec) — two tracks",
    tracks: {
      business: {
        relevantWhen: "hasProductSurface",
        snapshotFile: "market-research.md",
        budget: { liteQueries: 4, completoQueries: 8, maxFetchPerQuery: 2, minCompetitors: 3, maxCompetitors: 5 },
        sourceTiers: ["official", "comparison", "community"],
        purpose:
          "Research the business context and the category's table-stakes feature set (competitors/references) before drafting the PRD/Spec.",
        fallbackBehavior:
          "(A) the user supplies the competitors/references manually, or " +
          "(B) proceed on the archetype baselineFeatures alone; record SKIPPED/PARTIAL in market-research.md.",
      },
      technical: {
        relevantWhen: "stackDetected || isGreenfield || touchesArchitecture",
        snapshotFile: "tech-research.md",
        budget: { liteQueries: 6, completoQueries: 16, maxFetchPerQuery: 2, maxTechnologies: 6, maxAnglesPerTech: 3 },
        // Inverted relative to the business track ON PURPOSE: for a market claim the
        // vendor page is biased; for a framework claim the vendor IS the authority.
        sourceTiers: ["official-docs", "release-notes", "reputable-guide", "community"],
        purpose:
          "Research how the requested stack is built TODAY — current stable versions, idiomatic project structure, " +
          "architecture/design patterns, conventions, security and testing baselines, and which patterns are now discouraged. " +
          "An LLM's knowledge of a fast-moving ecosystem is frozen at its training cutoff and the failure mode is silent, so " +
          "version and recommended approach are RESEARCHED, never recalled.",
        fallbackBehavior:
          "(A) the user supplies current versions/conventions manually, or " +
          "(B) proceed without them and state explicitly in the PRD that the patterns were NOT verified and may be stale; " +
          "record SKIPPED/PARTIAL in tech-research.md. When the stack is not yet known, record DEFERRED and let ARCH top it up.",
      },
    },
    compliance: [
      "cite-source-url",
      "max-30-consecutive-words",
      "paraphrase-not-quote",
      "no-proprietary-assets",
      "no-trademark-imitation",
    ],
    purpose:
      "Look OUTWARD before drafting the PRD/Spec: benchmark the product category AND the current engineering practice of the " +
      "chosen stack, then package both as a reusable Prompt System injected into every downstream prompt.",
    fallbackBehavior:
      "If WebSearch/WebFetch are unavailable at runtime, ask via AskUserQuestion per track (see tracks.*.fallbackBehavior).",
  };
}

/**
 * OPTIONAL: OpenSpec availability.
 *
 * Detected via three independent signals:
 *   1) the `openspec` CLI on PATH, gated on OPENSPEC_MIN_VERSION (1.9.0 — the
 *      version that made root resolution and archive exit codes reliable
 *      enough to script against). Below the floor, Spec mode is NOT offered
 *      and the flow stays in PRD mode — OpenSpec stays optional and this
 *      check never affects the overall `status`.
 *   2) `openspec doctor --json` against the project root — exit 0 means an
 *      initialized, healthy root (config.yaml present). This does NOT gate
 *      availability: an uninitialized root is a one-command fix, so it is
 *      reported (`initialized`/`doctorOk`) and surfaced in `behavior` as an
 *      instruction to run `openspec init` before /opsx:propose.
 *   3) which profile is installed, probing BOTH `.claude/skills/` and
 *      `~/.claude/skills/`: CORE (the default since OpenSpec 1.4 —
 *      `/opsx:explore|propose|apply|update|sync|archive`), EXPANDED (adds
 *      `/opsx:new|continue|ff|verify|bulk-archive|onboard`, opt-in via
 *      `openspec config profile`), or NONE. The flow targets CORE and never
 *      requires EXPANDED, but `none` DOES suppress Spec mode — without the
 *      skills the /opsx:* commands do not exist, and offering Spec would abort
 *      late in PRD_BASE.
 *
 * When available, the Pensador asks (via AskUserQuestion) in INIT whether to
 * generate a PRD or a structured Spec.
 */
function checkOpenSpec() {
  const cli = checkCli(OPENSPEC_CLI, {
    minVersion: OPENSPEC_MIN_VERSION,
    recommendedVersion: OPENSPEC_RECOMMENDED_VERSION,
  });

  const configPath = join(process.cwd(), OPENSPEC_DIR, OPENSPEC_CONFIG_FILE);
  const dirPath = join(process.cwd(), OPENSPEC_DIR);
  let initialized = existsSync(configPath) || existsSync(dirPath);
  let doctorOk = null;
  if (cli.ok) {
    try {
      const out = execSync("openspec doctor --json", {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
        env: { ...process.env, NO_COLOR: "1", OPENSPEC_NO_UPDATE_CHECK: "1" },
      }).toString();
      const report = JSON.parse(out);
      doctorOk = report?.root?.healthy === true;
      initialized = doctorOk || initialized;
    } catch (err) {
      // Non-zero exit (e.g. no_openspec_root) still emits the null-shape JSON
      // report on stdout per the agent contract — parse it if present so
      // doctorOk reflects "confirmed unhealthy" (false) rather than "unknown"
      // (null, reserved for a genuine CLI failure with no parseable output).
      try {
        const report = JSON.parse(String(err.stdout ?? ""));
        doctorOk = report?.root?.healthy === true;
      } catch {
        // No parseable stdout — leave doctorOk as null (unknown); fall back
        // to the static existsSync signal above.
      }
    }
  }

  // Skills may live in the project (.claude/skills/) or user-wide (~/.claude/skills/).
  // Probing BOTH matters: a `none` verdict below suppresses Spec mode, so a
  // project-only probe would false-negative on a user-wide install.
  const skillInstalled = (name) =>
    existsSync(join(process.cwd(), ".claude", "skills", name)) ||
    existsSync(join(HOME, ".claude", "skills", name));

  // Three states, not two. Reporting "core" when NOTHING is installed is the
  // exact failure this integration exists to prevent: INIT would offer Spec,
  // PRD_BASE would invoke /opsx:propose, and the flow would abort late.
  let profile;
  if (OPENSPEC_EXPANDED_SKILL_DIRS.some(skillInstalled)) {
    profile = "expanded";
  } else if (OPENSPEC_CORE_SKILL_DIRS.some(skillInstalled)) {
    profile = "core";
  } else {
    profile = "none";
  }

  const meetsMinimum = cli.ok;
  const belowRecommended = cli.ok && cli.meetsRecommended === false;
  // Spec mode needs BOTH a usable CLI and the /opsx:* skills that drive it.
  const available = meetsMinimum && profile !== "none";

  let behavior;
  if (available) {
    const rootNote = initialized
      ? ""
      : " The OpenSpec root is not initialized yet — if the user picks Spec, run `openspec init --tools claude` (add `--language \"Portuguese (pt-BR)\"` for pt-BR artifacts) before /opsx:propose.";
    behavior = (belowRecommended
      ? `OpenSpec ${cli.version} detected (meets the ${OPENSPEC_MIN_VERSION}+ floor, below the recommended ${OPENSPEC_RECOMMENDED_VERSION}). ` +
        "INIT presents an AskUserQuestion offering PRD or Spec; consider `npm install -g @fission-ai/openspec@latest`."
      : "OpenSpec detected. INIT presents an AskUserQuestion offering PRD or Spec. If the user picks Spec, PRD_BASE is repurposed into OpenSpec assembly and later stages reason over the spec.") + rootNote;
  } else if (meetsMinimum && profile === "none") {
    behavior =
      `OpenSpec CLI ${cli.version} is present but no \`openspec-*\` skills are installed, so the /opsx:* commands do not exist. ` +
      "Spec mode is NOT offered; the flow stays in PRD mode. Run `openspec init --tools claude` to install them.";
  } else if (cli.error && cli.minVersion) {
    behavior =
      `OpenSpec CLI found but below the ${OPENSPEC_MIN_VERSION}+ floor (${cli.error}). ` +
      "Spec mode is not offered; the flow stays in PRD mode. Run `npm install -g @fission-ai/openspec@latest` to enable it.";
  } else {
    behavior = "OpenSpec not detected. The flow stays in PRD mode and the question is not asked.";
  }

  return {
    cli: OPENSPEC_CLI,
    optional: true,
    available,
    version: cli.version ?? null,
    meetsMinimum,
    belowRecommended,
    minVersion: OPENSPEC_MIN_VERSION,
    recommendedVersion: OPENSPEC_RECOMMENDED_VERSION,
    cliCheck: cli,
    initialized,
    doctorOk,
    profile,
    stage: "INIT",
    behavior,
  };
}

/**
 * OPTIONAL (front-end-conditional): Open Design availability.
 *
 * Reachable either as the `od` CLI on PATH or as a registered MCP server entry
 * in one of the common host configs. Relevant only when the demand has a
 * front-end: in that case, if unavailable, the Pensador offers to install it via
 * AskUserQuestion. Install is automated by the bundled script
 * (scripts/install-open-design.ps1|.sh): it brings Open Design up via Docker and
 * wires the MCP. If declined, the fallback is an inline DESIGN.md written from
 * the same 9-section schema.
 *
 * Like OpenSpec, this is purely optional and never affects the overall status.
 */
function checkOpenDesign() {
  const cliRaw = checkCli(OPEN_DESIGN_CLI);

  // GNU coreutils ships an `od` (octal-dump) binary on virtually every Unix-like
  // system, and its `--version` advertises "GNU coreutils". That is NOT the Open
  // Design daemon CLI. Without this guard, `checkCli("od")` reports success on any
  // machine with coreutils, producing a false positive that makes the Pensador
  // believe Open Design is installed when it is not.
  const looksLikeCoreutils = cliRaw.ok && /coreutils/i.test(cliRaw.version ?? "");
  const cli = looksLikeCoreutils
    ? {
        ok: false,
        error: `Ignored GNU coreutils 'od' (octal-dump) on PATH, not the Open Design CLI: ${cliRaw.version}`,
      }
    : cliRaw;

  const configCandidates = [
    join(process.cwd(), ".mcp.json"),
    join(process.cwd(), ".kiro", "settings", "mcp.json"),
    join(HOME, ".claude", ".mcp.json"),
    join(HOME, ".claude", "settings", "mcp.json"),
  ];
  const configuredIn = configCandidates.filter((p) => fileMentions(p, OPEN_DESIGN_SERVER));
  const configured = configuredIn.length > 0;

  // Because PATH-based `od` detection collides with coreutils, the reliable signal
  // for Open Design availability is an explicit MCP registration. A non-coreutils
  // `od` on PATH is still honored, but the registered MCP entry is authoritative.
  const available = cli.ok || configured;

  // `available` means the daemon REST API is usable (entry registered or `od` binary
  // present). It does NOT guarantee the MCP stdio bridge works: the bridge requires
  // a non-coreutils `od` binary on the host PATH (`od mcp` cmd). When `available` is
  // true only via a config entry (cli.ok=false), the Pensador reads design-systems
  // through the REST API — that still works — but MCP `get_file` may fail. The
  // `mcpFunctional` field makes this distinction explicit for the caller.
  const mcpFunctional = cli.ok;

  // Open Design has no one-line `curl | sh` installer (the old
  // open-design.ai/install.sh endpoint is gone — 404). It is a local-first daemon
  // + web app, brought up via Docker or a pnpm dev environment (Node 24 +
  // pnpm 10.33). This repo ships an installer script (scripts/install-open-design.*)
  // that automates the Docker path; `od mcp install <agent>` is the real
  // post-setup step that wires the daemon's MCP server into the agent.
  // See https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md
  const installCommands = {
    repo: "https://github.com/nexu-io/open-design",
    scriptWindows: 'pwsh -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-open-design.ps1"',
    scriptUnix: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-open-design.sh"',
    docker:
      "git clone --depth 1 https://github.com/nexu-io/open-design && cd open-design/deploy && cp .env.example .env && docker compose up -d   # app em http://localhost:7456",
    local:
      "git clone https://github.com/nexu-io/open-design && cd open-design && corepack enable && pnpm install && pnpm tools-dev run web   # requer Node 24 + pnpm 10.33",
    mcp: "od mcp install claude",
  };

  return {
    server: OPEN_DESIGN_SERVER,
    cli: OPEN_DESIGN_CLI,
    optional: true,
    relevantWhen: "hasFrontend",
    available,
    // true only when a non-coreutils `od` binary is on PATH — the MCP stdio bridge
    // (`od mcp`) needs this. false means daemon REST is usable but `get_file` via
    // MCP may not work; od-fetch-system.mjs falls back to the clone on disk.
    mcpFunctional,
    cliCheck: cli,
    configured,
    configuredIn,
    stage: "BRAINSTORM_GERAL (UI/UX design brief) + FINAL (design-system.md)",
    purpose:
      "Drive Open Design (od design-systems list/show/import-*, or the daemon REST API) to pull a brand-grade DESIGN.md the Pensador consolidates into design-system.md, so the front-end agent has a real visual target instead of a flat default theme.",
    installCommands,
    fallbackBehavior:
      "When the demand has a front-end and Open Design is unavailable, offer installation via AskUserQuestion: " +
      "(A) install Open Design now — Claude runs the bundled installer script (scripts/install-open-design.ps1|.sh), which checks git+docker, brings the daemon up via Docker, and wires the MCP, then resumes; " +
      "(B) skip and write an inline DESIGN.md (design-system.md) from the 9-section schema.",
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
const context7 = checkContext7();
const webResearch = checkWebResearch();
const openspec = checkOpenSpec();
const openDesign = checkOpenDesign();

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
    context7,
    webResearch,
    openspec,
    openDesign,
  },
  guidance: buildGuidance(codex, agy, executionMode, codebaseMemory, context7, webResearch, openspec, openDesign),
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
function buildGuidance(codex, agy, executionMode, codebaseMemory, context7, webResearch, openspec, openDesign) {
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
          `(index_status gate → index_repository if confirmed → get_architecture → search_graph/trace_path).`,
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

  if (context7) {
    if (context7.available) {
      lines.push(
        `Context7: available — RESEARCH's version-currency phase (TECH_RESEARCH) resolves the library ` +
          `identifier before requesting docs, and passes the project's fixed version when a manifest pins one.`,
      );
    } else {
      lines.push(
        `Context7: NOT available — version-currency phase falls back to WebSearch/WebFetch. ` +
          `Optional install: ${context7.installCommands?.any ?? "npx ctx7 setup --claude"}.`,
      );
    }
  }

  if (webResearch) {
    const biz = webResearch.tracks.business;
    const tech = webResearch.tracks.technical;
    lines.push(
      `Web research: RESEARCH runs TWO tracks on ${webResearch.tools.search}/${webResearch.tools.fetch} (not probeable on disk).`,
    );
    lines.push(
      `  business  → collect sectorContext, confirm the product archetype, run the bounded plan ` +
        `(${biz.budget.liteQueries} queries lite / ${biz.budget.completoQueries} completo, ` +
        `${biz.budget.minCompetitors}-${biz.budget.maxCompetitors} competitors) → ${biz.snapshotFile}.`,
    );
    lines.push(
      `  technical → detect the stack, close the stack gaps via AskUserQuestion, then run version-currency (MANDATORY) + ` +
        `patterns round-robin + front/back cross-cutting ` +
        `(${tech.budget.liteQueries} queries lite / ${tech.budget.completoQueries} completo, ` +
        `up to ${tech.budget.maxTechnologies} technologies) → ${tech.snapshotFile}.`,
    );
    lines.push(
      `  Source tiers — business: ${biz.sourceTiers.join(" > ")} | technical: ${tech.sourceTiers.join(" > ")}.`,
    );
    lines.push(`  Compliance (mandatory): ${webResearch.compliance.join(", ")}.`);
    lines.push(`  → ${webResearch.fallbackBehavior}`);
  }

  if (openspec) {
    if (openspec.available && !openspec.belowRecommended) {
      lines.push(
        `OpenSpec: detected (${openspec.version}, ${openspec.profile} profile) — INIT should ask (via AskUserQuestion) ` +
          "whether to generate a PRD or a structured Spec.",
      );
    } else if (openspec.available && openspec.belowRecommended) {
      lines.push(
        `OpenSpec: detected (${openspec.version}, meets the ${openspec.minVersion}+ floor but below the recommended ` +
          `${openspec.recommendedVersion}) — INIT still offers PRD vs Spec; suggest ` +
          "`npm install -g @fission-ai/openspec@latest` when convenient.",
      );
    } else if (openspec.meetsMinimum && openspec.profile === "none") {
      lines.push(
        `OpenSpec: CLI ${openspec.version} present but no \`openspec-*\` skills installed — the /opsx:* commands do not exist, ` +
          "so Spec mode is NOT offered and the flow stays in PRD mode. Run `openspec init --tools claude` to install them.",
      );
    } else if (openspec.cliCheck?.minVersion) {
      lines.push(
        `OpenSpec: CLI found but below the ${openspec.minVersion}+ floor — Spec mode is NOT offered, flow stays in PRD mode. ` +
          "Run `npm install -g @fission-ai/openspec@latest` to enable it.",
      );
    } else {
      lines.push("OpenSpec: not detected — flow stays in PRD mode (no PRD-vs-Spec question).");
    }
  }

  if (openDesign) {
    if (openDesign.available) {
      lines.push(
        `Open Design: ${openDesign.cli} available — when the demand has a front-end, parse a design brief and drive it ` +
          `to emit a brand-grade design-system.md (DESIGN.md).`,
      );
    } else {
      lines.push(
        `Open Design: not detected (no registered MCP entry; any \`${openDesign.cli}\` on PATH is GNU coreutils octal-dump, not Open Design).`,
      );
      lines.push(
        `  → Only relevant when the demand has a front-end. In that case, use AskUserQuestion with two options:`,
      );
      lines.push(
        `    (A) Instalar agora — Open Design é um app local (daemon + web). O cc-pensador traz um script instalador que usa Docker:`,
      );
      lines.push(`        Windows:  ${openDesign.installCommands?.scriptWindows}`);
      lines.push(`        macOS/Linux: ${openDesign.installCommands?.scriptUnix}`);
      lines.push(
        `        (o script verifica git+docker, sobe o daemon e conecta o MCP via \`${openDesign.installCommands?.mcp}\`)`,
      );
      lines.push(
        `    (B) Seguir sem — write an inline design-system.md from the 9-section DESIGN.md schema.`,
      );
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
