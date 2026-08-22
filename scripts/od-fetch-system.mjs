#!/usr/bin/env node
/**
 * od-fetch-system.mjs — copy an Open Design system's VERBATIM artifacts
 * (tokens.css, components.html, DESIGN.md, …) into the target repo so the
 * front-end agent consumes them directly, instead of a prose re-write.
 *
 * This is the I/O mechanism behind `openDesignFetchPlan()` (which only PLANS the
 * paths — the engine itself performs no I/O). The Pensador's FINAL stage runs
 * this script after picking the system(s) in BRAINSTORM_GERAL.
 *
 * Source resolution, in priority order — deliberately probed, never assumed:
 *   1. Filesystem clone (fastest, no network, and the ONLY source that does not
 *      depend on any `od` CLI surface): <clone-dir>/<id>/ — the Docker/pnpm
 *      install clones nexu-io/open-design; its design-systems/<id>/ has the
 *      files. This is the PRIMARY source precisely because upstream's CLI
 *      surface has churned (design-systems subcommands were rolled back and
 *      reworked in release 0.20.0) — the clone keeps working regardless.
 *   2. od CLI: `od get-file design-systems/<id>/<file>` — routes through the
 *      running daemon, which compiles tokens.css and serves all registered
 *      files. Skipped unless `od get-file --help` actually responds (not just
 *      `od --version`) — a renamed/removed subcommand degrades silently to
 *      step 3 instead of throwing on every file.
 *   3. REST API: GET <daemon-url>/api/design-systems/<id> with a Bearer token —
 *      best-effort fallback. The endpoint returns metadata + DESIGN.md only;
 *      raw file bodies (tokens.css, components.html) are NOT served here.
 *      Contributes only what the payload explicitly exposes; never fabricates
 *      a file endpoint.
 *
 * Manifest-driven file list: `manifest.json` (schemaVersion
 * 'od-design-system-project/v1') is fetched FIRST via the same three-source
 * chain. When present and parseable, it is the authority for which files this
 * system promises (files.*, usage, componentsManifest, preview.pages[],
 * sourceFiles.*) — see `deriveExpectedFiles()`. `OPEN_DESIGN.systemArtifacts`
 * is used only as a FALLBACK for legacy systems that ship no manifest.json.
 * Any manifest-promised file that never gets copied is reported under
 * `unexpectedMissing` — never silently dropped.
 *
 * tokens.css and DESIGN.md are always required; their absence after all three
 * sources is a non-zero exit for that system.
 *
 * Usage:
 *   node od-fetch-system.mjs --id <slug>[,<slug>] --repo <repoRoot>
 *        [--out-dir <.pensador/<slug>-vN>] [--clone-dir <path>] [--daemon-url <url>]
 *        [--token <bearer>] [--locale <bcp47>]
 *
 * --out-dir is the directory (relative to --repo) UNDER WHICH `design-systems/<id>/`
 * is created. In the Pensador flow this is the FEATURE ROOT (`.pensador/<slug>-vN`)
 * so the verbatim files stay inside the producer's artifact root — the Pensador
 * never writes into the project's real source tree (packages/ui); the downstream
 * Orchestrator/Executor materializes them there during implementation.
 * `--feature-dir` is an alias; `--ui-dir` is the DEPRECATED legacy alias (kept so
 * older callers don't break) and defaults to `packages/ui`.
 *
 * --locale <bcp47> additionally fetches `DESIGN-<bcp47>.md` when the system ships
 * it (upstream curated systems ship up to 17 locale variants). Optional, never
 * fatal when absent. Not fetched by default, to keep the base copy lean.
 *
 * --clone-dir must point to the design-systems/ SUBDIRECTORY of the OD clone, not the
 * repo root. Default: ~/.open-design/design-systems (matches the Docker install layout).
 * If the script exits 5/6, verify with: ls ~/.open-design/design-systems/<id>/tokens.css
 * Override via OD_CLONE_DIR env or --clone-dir flag when using a non-default clone path.
 *
 * Exit codes: 0 ok · 2 usage · 5 no source found at all for a system ·
 * 6 a source was found but a required file (tokens.css/DESIGN.md) is still missing.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { OPEN_DESIGN } from "./pensador-engine.mjs";

function arg(name, fallback = undefined) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

const ids = String(arg("id", ""))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const repoRoot = arg("repo", process.cwd());
// Destination base (relative to repoRoot) under which design-systems/<id>/ is
// created. Precedence: --out-dir → --feature-dir → --ui-dir (deprecated) → packages/ui.
const outDir = String(
  arg("out-dir", arg("feature-dir", arg("ui-dir", "packages/ui")))
).replace(/\/+$/, "");
const cloneDir = arg(
  "clone-dir",
  process.env.OD_CLONE_DIR || join(homedir(), ".open-design", "design-systems")
);
const daemonUrl = String(
  arg("daemon-url", process.env.OD_DAEMON_URL || "http://localhost:7456")
).replace(/\/$/, "");
const token = arg("token", process.env.OD_API_TOKEN || "");
const locale = arg("locale", "");

// Only run the shell (and enforce --id) when invoked directly, so tests can
// import deriveExpectedFiles without touching the filesystem/network or
// exiting the test process (mirrors od-onboard-agents.mjs).
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
const runningAsCli =
  invokedDirectly || (process.argv[1] && /od-fetch-system\.mjs$/.test(process.argv[1]));

if (runningAsCli && ids.length === 0) {
  console.error("od-fetch-system: --id <slug>[,<slug>] is required");
  process.exit(2);
}

const BASE_REQUIRED = new Set(["tokens.css", "DESIGN.md"]);
const LEGACY_DIRS = ["assets/", "fonts/", "preview/"];

function copyTree(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const s = join(srcDir, entry);
    const d = join(destDir, entry);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else copyFileSync(s, d);
  }
}

/**
 * Detect whether the `od` binary in PATH is the real Open Design CLI (not GNU
 * coreutils' octal-dump `od`, which ships on virtually every Unix system and
 * also responds to --version).
 */
let _odCliAvailable;
function odCliAvailable() {
  if (_odCliAvailable !== undefined) return _odCliAvailable;
  try {
    const out = execSync("od --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    });
    _odCliAvailable = !out.toLowerCase().includes("coreutils");
  } catch {
    _odCliAvailable = false;
  }
  return _odCliAvailable;
}

/**
 * Probe the `get-file` SUBCOMMAND specifically, not just the binary. Upstream
 * release 0.20.0 rolled back the design-systems CLI/API surface; a renamed or
 * removed `get-file` must degrade to REST, not throw once per file.
 */
let _odGetFileAvailable;
function odGetFileAvailable() {
  if (_odGetFileAvailable !== undefined) return _odGetFileAvailable;
  if (!odCliAvailable()) return (_odGetFileAvailable = false);
  try {
    execSync("od get-file --help", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    });
    _odGetFileAvailable = true;
  } catch {
    _odGetFileAvailable = false;
  }
  return _odGetFileAvailable;
}

/**
 * Fetch a single plain file (not a directory) through the three-source chain,
 * in priority order. Returns the source tag on success ('clone' | 'od-cli' |
 * 'rest:<url>') or null if no source had it.
 */
async function fetchFile(id, rel, destDir) {
  // 1. clone
  const src = join(cloneDir, id, rel);
  if (existsSync(src) && !statSync(src).isDirectory()) {
    const dest = join(destDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    return "clone";
  }

  // 2. od get-file
  if (odGetFileAvailable()) {
    try {
      const body = execSync(`od get-file "design-systems/${id}/${rel}"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10000,
      });
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, body, "utf8");
      return "od-cli";
    } catch {
      // fall through to REST
    }
  }

  // 3. REST (best-effort; only serves what the payload explicitly exposes)
  const url = `${daemonUrl}/api/design-systems/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const files = (payload && (payload.files || payload.artifacts)) || null;
    const body =
      files && typeof files[rel] === "string"
        ? files[rel]
        : typeof payload?.[rel] === "string"
          ? payload[rel]
          : null;
    if (body == null) return null;
    const dest = join(destDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body, "utf8");
    return `rest:${url}`;
  } catch {
    return null;
  }
}

/** Directories (assets/, fonts/, preview/) are only ever available from the
 * on-disk clone — neither `od get-file` nor the REST payload can serve a
 * directory atomically. Best-effort: absence is never fatal. */
function fetchDir(id, rel, destDir) {
  const name = rel.replace(/\/$/, "");
  const src = join(cloneDir, id, name);
  if (existsSync(src) && statSync(src).isDirectory()) {
    copyTree(src, join(destDir, name));
    return "clone";
  }
  return null;
}

/**
 * Derive the manifest-promised file list from a parsed manifest.json, per the
 * upstream `od-design-system-project/v1` schema (files.*, usage,
 * componentsManifest, preview.pages[], sourceFiles.*). Returns
 * { files: string[], required: Set<string> } — `files` excludes directories
 * (assets/, fonts/), which manifest.json does not declare and which stay on
 * the legacy best-effort path via LEGACY_DIRS.
 */
export function deriveExpectedFiles(manifest) {
  const files = [];
  const required = new Set();
  const add = (rel, isRequired = false) => {
    if (typeof rel !== "string" || rel.length === 0) return;
    files.push(rel);
    if (isRequired) required.add(rel);
  };
  if (manifest.files && typeof manifest.files === "object") {
    add(manifest.files.design, true);
    add(manifest.files.tokens, true);
    add(manifest.files.designTokens);
    add(manifest.files.tailwind);
    add(manifest.files.components);
  }
  add(manifest.usage);
  add(manifest.componentsManifest);
  if (Array.isArray(manifest.preview?.pages)) {
    for (const page of manifest.preview.pages) add(page?.path);
  }
  if (manifest.sourceFiles && typeof manifest.sourceFiles === "object") {
    add(manifest.sourceFiles.evidence);
    add(manifest.sourceFiles.tokens);
    add(manifest.sourceFiles.report);
  }
  return { files: [...new Set(files)], required };
}

async function main() {
const results = [];
let hadNoSource = false;
let hadMissingRequired = false;

for (const id of ids) {
  const destDir = join(repoRoot, outDir, "design-systems", id);
  const fileSource = {};
  const copied = new Set();

  // ── manifest.json first: it decides what else we look for ──────────────
  const manifestSrc = await fetchFile(id, "manifest.json", destDir);
  let manifest = null;
  let manifestValid = false;
  if (manifestSrc) {
    fileSource["manifest.json"] = manifestSrc;
    copied.add("manifest.json");
    try {
      manifest = JSON.parse(readFileSync(join(destDir, "manifest.json"), "utf8"));
      manifestValid = manifest.schemaVersion === OPEN_DESIGN.manifestSchemaVersion;
    } catch {
      manifest = null;
    }
  }

  const usingManifest = Boolean(manifest);
  const { files: manifestFiles, required: manifestRequired } = usingManifest
    ? deriveExpectedFiles(manifest)
    : { files: [], required: new Set() };

  const expectedFiles = usingManifest
    ? manifestFiles
    : OPEN_DESIGN.systemArtifacts.filter((f) => !f.endsWith("/") && f !== "manifest.json");
  const required = usingManifest ? manifestRequired : new Set(BASE_REQUIRED);

  if (locale) expectedFiles.push(`DESIGN-${locale}.md`);

  // ── fetch every expected plain file through the 3-source chain ─────────
  for (const rel of expectedFiles) {
    if (copied.has(rel)) continue;
    const source = await fetchFile(id, rel, destDir);
    if (source) {
      fileSource[rel] = source;
      copied.add(rel);
    }
  }

  // ── legacy directories: best-effort, clone-only, never fatal ───────────
  for (const rel of LEGACY_DIRS) {
    const source = fetchDir(id, rel, destDir);
    if (source) {
      fileSource[rel] = source;
      copied.add(rel);
    }
  }

  const copiedArr = [...copied];
  const noSourceAtAll = copiedArr.length === 0;
  if (noSourceAtAll) {
    console.error(
      `od-fetch-system: no source found for "${id}"\n` +
      `  clone-dir searched: ${cloneDir}/${id}/\n` +
      `  od get-file: ${odGetFileAvailable() ? "tried (no files returned)" : "not available — install OD, check PATH, or the subcommand was removed upstream"}\n` +
      `  daemon: ${daemonUrl}/api/design-systems/${id}\n` +
      `  Verify: ls "${cloneDir}/${id}/tokens.css"\n` +
      `  Override: --clone-dir <path-to-design-systems-dir>  or  OD_CLONE_DIR env var`
    );
    results.push({ id, ok: false, reason: "no-source", destDir });
    hadNoSource = true;
    continue;
  }

  const missingRequired = [...required].filter((f) => !copied.has(f));
  // Manifest-promised files that never got copied and are NOT already
  // reported via missingRequired — visible drift, non-fatal by design (many
  // are genuinely optional: locale variants, source-evidence files).
  const unexpectedMissing = usingManifest
    ? manifestFiles.filter((f) => !copied.has(f) && !missingRequired.includes(f))
    : [];

  const ok = missingRequired.length === 0;
  if (!ok) hadMissingRequired = true;

  results.push({
    id,
    ok,
    manifestUsed: usingManifest,
    manifestSchemaValid: usingManifest ? manifestValid : null,
    destDir: join(outDir, "design-systems", id),
    copied: copiedArr,
    fileSource,
    missingRequired,
    unexpectedMissing,
  });
}

console.log(JSON.stringify({ ok: !hadNoSource && !hadMissingRequired, results }, null, 2));
process.exit(hadNoSource ? 5 : hadMissingRequired ? 6 : 0);
}

if (runningAsCli) {
  await main();
}
