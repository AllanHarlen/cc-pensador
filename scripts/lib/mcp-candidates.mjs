import { join } from "node:path";

/**
 * Canonical candidate locations probed by preflight detection for the two
 * MCP servers shared across the workflow chain (cc-pensador ->
 * cc-orchestrador-subagents -> cc-executor-subagents): Codebase Memory
 * (mandatory here, optional downstream) and Context7 (optional everywhere).
 *
 * This is the union of every location any of the three plugins' own
 * preflight has ever probed. It exists because, before this file, the three
 * preflights disagreed on where to look — a server registered only in
 * `.kiro/settings/mcp.json` was "available" to this plugin but "absent" to
 * the Orchestrator's `mcp-detect.mjs`, and a server registered only in
 * `~/.codex/config.toml` was the reverse. `test/mcp-detection-parity.test.js`
 * asserts the sibling copies of this list (this file, the specs in
 * `cc-orchestrador-subagents/.../scripts/lib/mcp-detect.mjs`, and
 * `cc-executor-subagents/.../scripts/lib/mcp-candidates.mjs`) stay in sync
 * when checked out side by side in this combined workspace.
 *
 * Each config candidate is `{ base: "cwd" | "home", segments: string[], format }`.
 * `format` is `"json"` for every file except `~/.codex/config.toml`, which is
 * TOML: `preflight.mjs` matches it with a raw substring test (same class of
 * check as the legacy `fileMentions()`), never a structured parse — writing a
 * TOML parser for a single candidate is not worth the maintenance cost. Every
 * `"json"` candidate goes through `readMcpServerMaps()`/`findMcpServer()`,
 * which excludes servers listed in `disabledMcpjsonServers`.
 */

export const CODEBASE_MEMORY_CONFIG_CANDIDATES = [
  { base: "cwd", segments: [".mcp.json"], format: "json" },
  { base: "cwd", segments: [".kiro", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude.json"], format: "json" },
  { base: "home", segments: [".claude", ".mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".config", "claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".codex", "config.toml"], format: "toml" },
  { base: "home", segments: [".gemini", "config", "mcp_config.json"], format: "json" },
];

export const CODEBASE_MEMORY_SKILL_CANDIDATES = [
  { base: "home", segments: [".claude", "skills", "codebase-memory", "SKILL.md"] },
  { base: "home", segments: [".claude", "skills", "codebase-memory-mcp", "SKILL.md"] },
];

export const CODEBASE_MEMORY_BINARY_NAMES = ["codebase-memory-mcp"];
export const CODEBASE_MEMORY_SERVER_NAMES = ["codebase-memory-mcp", "codebase-memory"];
/**
 * No definition markers: unlike Context7 (`@upstash/context7-mcp`,
 * `mcp.context7.com` — stable identifiers distinct from the server's own
 * common name), Codebase Memory has no documented alternate-registration
 * convention. Reusing the server name itself as a marker would match any
 * unrelated definition whose command/args happen to contain the substring
 * "codebase-memory-mcp" (e.g. a path like `./codebase-memory-mcp-notes.js`)
 * — a real false positive caught by `test/preflight-detection.test.js`.
 */
export const CODEBASE_MEMORY_DEFINITION_MARKERS = [];

export const CONTEXT7_CONFIG_CANDIDATES = [
  { base: "cwd", segments: [".mcp.json"], format: "json" },
  { base: "cwd", segments: [".kiro", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude.json"], format: "json" },
  { base: "home", segments: [".claude", ".mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".config", "claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".codex", "config.toml"], format: "toml" },
  { base: "home", segments: [".gemini", "config", "mcp_config.json"], format: "json" },
  { base: "home", segments: [".gemini", "settings.json"], format: "json" },
  { base: "home", segments: [".gemini", "mcp.json"], format: "json" },
  { base: "home", segments: [".gemini", "antigravity-cli", "settings.json"], format: "json" },
  { base: "home", segments: [".gemini", "antigravity-cli", "import_manifest.json"], format: "json" },
  {
    base: "home",
    segments: [".gemini", "antigravity-cli", "plugins", "context7", "mcp_config.json"],
    format: "json",
  },
];

/** Directory-existence evidence (no content to parse) — the AGY/Gemini CLI bundles Context7 under these. */
export const CONTEXT7_MCP_DIRECTORY_CANDIDATES = [
  { base: "home", segments: [".gemini", "antigravity-cli", "mcp", "context7"] },
  { base: "home", segments: [".gemini", "antigravity-cli", "plugins", "context7"] },
];

export const CONTEXT7_SKILL_CANDIDATES = [
  { base: "home", segments: [".claude", "skills", "context7", "SKILL.md"] },
  { base: "home", segments: [".claude", "skills", "context7-mcp", "SKILL.md"] },
];

export const CONTEXT7_BINARY_NAMES = ["ctx7"];
export const CONTEXT7_SERVER_NAMES = ["context7", "context7-mcp", "ctx7"];
export const CONTEXT7_DEFINITION_MARKERS = ["@upstash/context7-mcp", "mcp.context7.com"];

/** Resolves a `{ base, segments }` candidate to an absolute path given `{ home, cwd }`. */
export function resolveCandidate({ base, segments }, { home, cwd }) {
  const root = base === "cwd" ? cwd : home;
  return join(root, ...segments);
}
