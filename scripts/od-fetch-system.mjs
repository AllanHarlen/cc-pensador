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
 * Source resolution, in order of preference:
 *   1. Filesystem clone (most robust): <clone-dir>/<id>/  — the Docker/pnpm
 *      install clones nexu-io/open-design; its design-systems/<id>/ has the files.
 *   2. REST API: GET <daemon-url>/api/design-systems/<id> with a Bearer token,
 *      IF the payload exposes file bodies. The daemon returns 401 without a token
 *      and may return only metadata — so the clone is tried first and the REST is
 *      a best-effort fallback that never invents a file endpoint.
 *
 * It copies the canonical artifact set (OPEN_DESIGN.systemArtifacts) plus the
 * whole preview/ dir when present, skipping files the system does not ship.
 * tokens.css and DESIGN.md are required: their absence is a non-zero exit.
 *
 * Usage:
 *   node od-fetch-system.mjs --id <slug>[,<slug>] --repo <repoRoot>
 *        [--ui-dir packages/ui] [--clone-dir <path>] [--daemon-url <url>] [--token <bearer>]
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

/** Copy from the on-disk clone. Returns { copied:[], missing:[] } or null if absent. */
function fromClone(id, destDir) {
  const srcSystem = join(cloneDir, id);
  if (!existsSync(srcSystem)) return null;
  const copied = [];
  const missing = [];
  for (const rel of OPEN_DESIGN.systemArtifacts) {
    const src = join(srcSystem, rel);
    if (existsSync(src)) {
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      copied.push(rel);
    } else {
      missing.push(rel);
    }
  }
  // Bring the whole preview/ dir (systems vary: app.html vs colors/typography/…).
  const previewSrc = join(srcSystem, "preview");
  if (existsSync(previewSrc) && statSync(previewSrc).isDirectory()) {
    copyTree(previewSrc, join(destDir, "preview"));
  }
  return { copied, missing, source: `clone:${srcSystem}` };
}

/** Best-effort REST fallback. Only writes files whose bodies the payload exposes. */
async function fromRest(id, destDir) {
  const url = `${daemonUrl}/api/design-systems/${encodeURIComponent(id)}`;
  let payload;
  try {
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { copied: [], missing: OPEN_DESIGN.systemArtifacts, source: `rest:${res.status}` };
    payload = await res.json();
  } catch (err) {
    return { copied: [], missing: OPEN_DESIGN.systemArtifacts, source: `rest:unreachable` };
  }
  // Accept a few plausible shapes: { files: { "tokens.css": "..." } } or
  // { tokens_css, design_md, ... }. Unknown shapes yield nothing (no fabrication).
  const files = (payload && (payload.files || payload.artifacts)) || null;
  const copied = [];
  const missing = [];
  for (const rel of OPEN_DESIGN.systemArtifacts) {
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
  let r = fromClone(id, destDir);
  if (!r || r.copied.length === 0) {
    const rest = await fromRest(id, destDir);
    // Prefer whichever produced files.
    r = rest.copied.length > 0 ? rest : r || rest;
  }
  if (!r || r.copied.length === 0) {
    console.error(`od-fetch-system: no source found for "${id}" (clone-dir=${cloneDir}, daemon=${daemonUrl})`);
    results.push({ id, ok: false, reason: "no-source", destDir });
    hadFatal = true;
    continue;
  }
  const missingRequired = [...REQUIRED].filter((f) => !r.copied.includes(f));
  const ok = missingRequired.length === 0;
  if (!ok) hadFatal = true;
  results.push({
    id,
    ok,
    source: r.source,
    destDir: join(uiDir, "design-systems", id),
    copied: r.copied,
    missingRequired,
  });
}

console.log(JSON.stringify({ ok: !hadFatal, results }, null, 2));
process.exit(hadFatal ? 6 : 0);
