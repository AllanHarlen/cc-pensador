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
 * Source resolution, in priority order:
 *   1. Filesystem clone (fastest, no network): <clone-dir>/<id>/  — the Docker/pnpm
 *      install clones nexu-io/open-design; its design-systems/<id>/ has the files.
 *      NOTE: tokens.css may be absent in the clone for DESIGN.md-only systems (the
 *      daemon compiles it on demand). Missing required files fall through to step 2.
 *   2. od CLI: `od get-file design-systems/<id>/<file>` — routes through the running
 *      daemon, which compiles tokens.css and serves all registered files. Skipped if
 *      `od` is not in PATH or resolves to GNU coreutils (octal-dump), not Open Design.
 *   3. REST API: GET <daemon-url>/api/design-systems/<id> with a Bearer token — best-
 *      effort fallback. The endpoint returns metadata + DESIGN.md only; raw file bodies
 *      (tokens.css, components.html) are NOT served here. Contributes only what the
 *      payload explicitly exposes; never fabricates a file endpoint.
 *
 * It copies the canonical artifact set (OPEN_DESIGN.systemArtifacts), handling
 * directory entries (assets/, fonts/, preview/) via recursive copyTree.
 * tokens.css and DESIGN.md are required: their absence after all three paths is
 * a non-zero exit.
 *
 * Usage:
 *   node od-fetch-system.mjs --id <slug>[,<slug>] --repo <repoRoot>
 *        [--ui-dir packages/ui] [--clone-dir <path>] [--daemon-url <url>] [--token <bearer>]
 *
 * --clone-dir must point to the design-systems/ SUBDIRECTORY of the OD clone, not the
 * repo root. Default: ~/.open-design/design-systems (matches the Docker install layout).
 * If the script exits 5/6, verify with: ls ~/.open-design/design-systems/<id>/tokens.css
 * Override via OD_CLONE_DIR env or --clone-dir flag when using a non-default clone path.
 *
 * Exit codes: 0 ok · 2 usage · 5 no source found for a system · 6 required file missing.
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
const uiDir = String(arg("ui-dir", "packages/ui")).replace(/\/+$/, "");
const cloneDir = arg(
  "clone-dir",
  process.env.OD_CLONE_DIR || join(homedir(), ".open-design", "design-systems")
);
const daemonUrl = String(
  arg("daemon-url", process.env.OD_DAEMON_URL || "http://localhost:7456")
).replace(/\/$/, "");
const token = arg("token", process.env.OD_API_TOKEN || "");

if (ids.length === 0) {
  console.error("od-fetch-system: --id <slug>[,<slug>] is required");
  process.exit(2);
}

const REQUIRED = new Set(["tokens.css", "DESIGN.md"]);

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
 * Copy from the on-disk clone.
 * Handles directory entries (trailing '/') via copyTree, plain files via copyFileSync.
 * Returns { copied, missing, source } or null if the system dir is absent.
 */
function fromClone(id, destDir) {
  const srcSystem = join(cloneDir, id);
  if (!existsSync(srcSystem)) return null;
  const copied = [];
  const missing = [];
  for (const rel of OPEN_DESIGN.systemArtifacts) {
    const isDir = rel.endsWith("/");
    const name = rel.replace(/\/$/, "");
    const src = join(srcSystem, name);
    if (isDir) {
      if (existsSync(src) && statSync(src).isDirectory()) {
        copyTree(src, join(destDir, name));
        copied.push(rel);
      } else {
        missing.push(rel);
      }
    } else {
      if (existsSync(src)) {
        const dest = join(destDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        copied.push(rel);
      } else {
        missing.push(rel);
      }
    }
  }
  return { copied, missing, source: `clone:${srcSystem}` };
}

/**
 * Detect whether the `od` binary in PATH is the real Open Design CLI.
 * GNU coreutils ships an `od` (octal-dump) on virtually every Unix system —
 * its --version output contains "coreutils". Cached after first call.
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
 * Fetch individual files via `od get-file design-systems/<id>/<file>`.
 * This routes through the running daemon (which compiles tokens.css on demand),
 * making it the canonical path when the clone is absent or incomplete.
 * Directory entries (assets/, fonts/, preview/) are skipped — they cannot be
 * fetched atomically via get-file and are only available from the on-disk clone.
 *
 * @param {string} id  system slug
 * @param {string} destDir  where to write files
 * @param {Set<string>} [skipSet]  artifacts already written — avoid overwriting
 */
async function fromOdCli(id, destDir, skipSet = new Set()) {
  const copied = [];
  const missing = [];
  for (const rel of OPEN_DESIGN.systemArtifacts) {
    if (rel.endsWith("/") || skipSet.has(rel)) {
      if (rel.endsWith("/")) missing.push(rel); // dirs not available via get-file
      continue;
    }
    try {
      const body = execSync(`od get-file "design-systems/${id}/${rel}"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10000,
      });
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, body, "utf8");
      copied.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  return { copied, missing, source: `od-cli:${id}` };
}

/**
 * Best-effort REST fallback.
 * `GET /api/design-systems/<id>` returns metadata + DESIGN.md only.
 * Raw file bodies (tokens.css, components.html) are NOT served by this endpoint.
 * Accepts a few plausible payload shapes; unknown shapes yield nothing (no fabrication).
 */
async function fromRest(id, destDir) {
  const url = `${daemonUrl}/api/design-systems/${encodeURIComponent(id)}`;
  let payload;
  try {
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { copied: [], missing: [...OPEN_DESIGN.systemArtifacts], source: `rest:${res.status}` };
    payload = await res.json();
  } catch {
    return { copied: [], missing: [...OPEN_DESIGN.systemArtifacts], source: `rest:unreachable` };
  }
  const files = (payload && (payload.files || payload.artifacts)) || null;
  const copied = [];
  const missing = [];
  for (const rel of OPEN_DESIGN.systemArtifacts) {
    if (rel.endsWith("/")) { missing.push(rel); continue; }
    const body =
      files && typeof files[rel] === "string"
        ? files[rel]
        : typeof payload?.[rel] === "string"
          ? payload[rel]
          : null;
    if (body != null) {
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, body, "utf8");
      copied.push(rel);
    } else {
      missing.push(rel);
    }
  }
  return { copied, missing, source: `rest:${url}` };
}

const results = [];
let hadFatal = false;

for (const id of ids) {
  const destDir = join(repoRoot, uiDir, "design-systems", id);

  // ── Step 1: on-disk clone (fastest, no network) ─────────────────────────
  const cloneResult = fromClone(id, destDir);
  const copied = new Set(cloneResult ? cloneResult.copied : []);
  const sources = cloneResult ? [cloneResult.source] : [];

  const missingRequired = () => [...REQUIRED].filter((f) => !copied.has(f));

  // ── Step 2: od CLI for any missing required files ────────────────────────
  // `od get-file` routes through the daemon (compiles tokens.css on demand).
  // Pass already-copied set so we never overwrite files the clone provided.
  if (missingRequired().length > 0 && odCliAvailable()) {
    const cli = await fromOdCli(id, destDir, copied);
    for (const f of cli.copied) copied.add(f);
    if (cli.copied.length > 0) sources.push(cli.source);
  }

  // ── Step 3: REST (metadata only — last resort) ───────────────────────────
  if (missingRequired().length > 0 || copied.size === 0) {
    const rest = await fromRest(id, destDir);
    for (const f of rest.copied) copied.add(f);
    if (rest.copied.length > 0) sources.push(rest.source);
  }

  // ── Evaluate ─────────────────────────────────────────────────────────────
  const copiedArr = [...copied];
  if (copiedArr.length === 0) {
    console.error(
      `od-fetch-system: no source found for "${id}"\n` +
      `  clone-dir searched: ${cloneDir}/${id}/\n` +
      `  od CLI: ${odCliAvailable() ? "tried (no files returned)" : "not available — install OD or check PATH"}\n` +
      `  daemon: ${daemonUrl}/api/design-systems/${id}\n` +
      `  Verify: ls "${cloneDir}/${id}/tokens.css"\n` +
      `  Override: --clone-dir <path-to-design-systems-dir>  or  OD_CLONE_DIR env var`
    );
    results.push({ id, ok: false, reason: "no-source", destDir });
    hadFatal = true;
    continue;
  }

  const stillMissingRequired = missingRequired();
  const ok = stillMissingRequired.length === 0;
  if (!ok) hadFatal = true;
  results.push({
    id,
    ok,
    source: sources.join("+"),
    destDir: join(uiDir, "design-systems", id),
    copied: copiedArr,
    missingRequired: stillMissingRequired,
  });
}

console.log(JSON.stringify({ ok: !hadFatal, results }, null, 2));
process.exit(hadFatal ? 6 : 0);
