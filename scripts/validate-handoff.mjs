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
 * When the handoff declares both a `ui-data-map` and an `api-contract`
 * artifact, also runs `validateContractCoverage()` (scripts/lib/contract-
 * coverage.mjs): every screen's read/write operation must match a real
 * operation in the contract. This is the FINAL-stage half of the gate that
 * closes a real run's defect (OficinaAI, 2026-09-16) — 41 RFs, 21 openapi.yaml
 * operations, no list endpoint for the painel's core screens, discovered only
 * by a browser E2E after the front-end had already filled those screens from
 * client-side localStorage. A `status: "DONE"` handoff with unresolved gaps
 * is a blocking error; anything else (missing artifact, unsupported format)
 * degrades to a warning, never a silent pass.
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
import { validateContractCoverage } from "./lib/contract-coverage.mjs";

/** api-contract artifact `spec` field (buildArtifactList) -> contract-coverage.mjs `format`. */
const SPEC_TO_FORMAT = { openapi: "rest", "graphql-sdl": "graphql", protobuf: "grpc", asyncapi: "events" };

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

/** Like readDeclaredJson, but returns the raw text (for a YAML contract) instead of parsing it. */
function readDeclaredText(handoffPath, declaredPaths) {
  for (const declared of declaredPaths.filter((value) => typeof value === "string" && value.trim() !== "")) {
    for (const candidate of [resolve(dirname(handoffPath), declared), resolve(declared)]) {
      try {
        return readFileSync(candidate, "utf8");
      } catch {
        // Try the next path.
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

  // Contract coverage: only meaningful once BOTH a ui-data-map and an
  // api-contract artifact are declared — a backend-only or front-end-not-yet-
  // planned handoff simply has nothing to cross-check, which is not an error.
  const warnings = [...visual.warnings];
  let contractCoverageErrors = [];
  const uiDataMapArtifact = parsed.artifacts?.find((artifact) => artifact?.role === "ui-data-map");
  const apiContractArtifact = parsed.artifacts?.find((artifact) => artifact?.role === "api-contract");
  if (uiDataMapArtifact) {
    const uiDataMap = readDeclaredJson(resolved, [uiDataMapArtifact.path, "ui-data-map.json"]);
    if (!uiDataMap) {
      warnings.push({ code: "UI_DATA_MAP_UNREADABLE", severity: "warning", message: `ui-data-map artifact declared (${uiDataMapArtifact.path}) but the file could not be read/parsed.`, path: "artifacts[ui-data-map]" });
    } else if (!apiContractArtifact) {
      if ((uiDataMap.screens ?? []).length > 0) {
        warnings.push({ code: "API_CONTRACT_MISSING_FOR_COVERAGE_CHECK", severity: "warning", message: "ui-data-map has screens but no api-contract artifact is declared — contract coverage was not checked.", path: "artifacts[api-contract]" });
      }
    } else {
      const contractText = readDeclaredText(resolved, [apiContractArtifact.path]);
      if (contractText == null) {
        warnings.push({ code: "API_CONTRACT_UNREADABLE", severity: "warning", message: `api-contract artifact declared (${apiContractArtifact.path}) but the file could not be read.`, path: "artifacts[api-contract]" });
      } else {
        const format = SPEC_TO_FORMAT[apiContractArtifact.spec] ?? "rest";
        const coverage = validateContractCoverage(uiDataMap, contractText, { format });
        if (!coverage.applicable) {
          warnings.push({ code: "CONTRACT_COVERAGE_NOT_APPLICABLE", severity: "warning", message: coverage.reason, path: "artifacts[api-contract]" });
        } else if (!coverage.ok) {
          contractCoverageErrors = coverage.gaps.map((gap) => ({
            code: "CONTRACT_COVERAGE_GAP",
            message: `screen "${gap.screenId}" references operation "${gap.operation}" (${gap.reason}), which has no matching operation in the api-contract.`,
            path: "artifacts[ui-data-map].screens[].reads[]/writes[]",
          }));
        }
      }
    }
  }
  // Only a status: DONE handoff is actually blocked by a coverage gap — a
  // PARTIAL/BLOCKED handoff already discloses its gap via `summary`, same
  // scoping validateVisualCompleteness() already uses.
  const blockingContractCoverageErrors = parsed.status === "DONE" ? contractCoverageErrors : [];
  if (parsed.status !== "DONE" && contractCoverageErrors.length > 0) {
    warnings.push(...contractCoverageErrors.map((error) => ({ ...error, severity: "warning" })));
  }

  const errors = [...result.errors, ...visual.errors, ...blockingContractCoverageErrors];
  const ok = result.ok && visual.ok && blockingContractCoverageErrors.length === 0;
  console.log(JSON.stringify({ ok, file: resolved, errors, warnings }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

main();
