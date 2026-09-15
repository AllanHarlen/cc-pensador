#!/usr/bin/env node
/**
 * CLI: validates a handoff.json file against the canonical envelope shape
 * (scripts/lib/handoff-validator.mjs). Producers run this before writing
 * `status: "DONE"`; consumers run it before trusting an upstream handoff.
 *
 * For `stage: "pensador"`, also runs `validateVisualCompleteness()`: a
 * `status: "DONE"` handoff with a front-end demand needs a `resolved` Open
 * Design package plus `ui-prototype`/`brand-assets` artifacts, not just a
 * structurally valid envelope. Errors from both checks share one array —
 * the caller does not need to know they came from two functions.
 *
 * Usage:
 *   node scripts/validate-handoff.mjs --file <path/to/handoff.json>
 *
 * Output: JSON to stdout, `{ ok: boolean, file: string, errors: [...] }`.
 * Exit code 0 only when `ok === true` — mirrors preflight.mjs's convention
 * of always emitting JSON but signaling failure via a non-zero exit too, so
 * this also works as a plain shell gate (`node validate-handoff.mjs --file
 * <path> || exit 1`).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateHandoff, validateVisualCompleteness } from "./lib/handoff-validator.mjs";

function parseArgs(argv) {
  const args = { file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") {
      args.file = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

function readDeclaredJson(handoffPath, declaredPaths) {
  for (const declared of declaredPaths.filter((value) => typeof value === "string" && value.trim() !== "")) {
    for (const candidate of [resolve(dirname(handoffPath), declared), resolve(declared)]) {
      try {
        return JSON.parse(readFileSync(candidate, "utf8"));
      } catch {
        // Try the next path: handoffs may use artifact-root-relative or project-relative paths.
      }
    }
  }
  return null;
}

function main() {
  const { file } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.log(JSON.stringify({ ok: false, file: null, errors: [{ code: "MISSING_FILE_ARG", message: "--file <path> is required", path: null }] }));
    process.exitCode = 1;
    return;
  }

  const resolved = resolve(file);
  let raw;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (error) {
    console.log(JSON.stringify({ ok: false, file: resolved, errors: [{ code: "FILE_NOT_READABLE", message: error.message, path: null }] }));
    process.exitCode = 1;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, file: resolved, errors: [{ code: "INVALID_JSON", message: error.message, path: null }] }));
    process.exitCode = 1;
    return;
  }

  const result = validateHandoff(parsed);
  // Visual completeness only adds meaningful errors once the envelope itself
  // is well-formed (it reads handoff.stage/status/artifacts directly); still
  // safe to call unconditionally since it degrades to `{ ok: true, errors:
  // [] }` on anything it does not recognize as a DONE Pensador handoff.
  const baselineArtifact = parsed.artifacts?.find((artifact) => artifact?.role === "project-baseline");
  const brandArtifact = parsed.artifacts?.find((artifact) => artifact?.role === "brand-assets");
  const projectBaseline = readDeclaredJson(resolved, [baselineArtifact?.path, "project-baseline.json"]);
  const assetsManifest = readDeclaredJson(resolved, [
    brandArtifact?.manifest,
    brandArtifact?.path ? join(brandArtifact.path, "manifest.json") : null,
    "assets/manifest.json",
  ]);
  const visual = validateVisualCompleteness(parsed, { projectBaseline, assetsManifest });
  const errors = [...result.errors, ...visual.errors];
  console.log(JSON.stringify({ ok: result.ok && visual.ok, file: resolved, errors, warnings: visual.warnings }, null, 2));
  process.exitCode = result.ok && visual.ok ? 0 : 1;
}

main();
