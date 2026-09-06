#!/usr/bin/env node
/**
 * od-verify-system.mjs — detect divergence between `DESIGN.md` (prose, for
 * humans) and `tokens.css` (machine-readable, the source of truth) inside a
 * fetched Open Design system directory.
 *
 * Achado 12.1 (analise-run-oficina-saas-20260905.md): a real run's
 * `DESIGN.md` and `tokens.css`, generated in the SAME bundle by upstream,
 * described two different products — primary color yellow `#FECE14` in the
 * prose vs `--accent: #2563eb` (blue) in the tokens, Poppins/IBM Plex Mono
 * vs Inter/SF Mono, a "mobile-first compact scale" that doesn't exist in the
 * fixed, non-responsive `tokens.css` scale. The implementation correctly
 * followed `tokens.css` (the source of truth) — but `DESIGN.md` is the
 * artifact a human reads to judge conformance, and it described a product
 * that never existed. `tokens.source.json` even lists DESIGN.md among its
 * source files without a single one of the 56 tokens tracing to it.
 *
 * `od-fetch-system.mjs` only validates PRESENCE (tokens.css/DESIGN.md
 * copied, manifest promises kept) — never CONTENT. This script is the
 * content check, run once per system right after the fetch, over whatever
 * `od-fetch-system.mjs` just copied byte-for-byte.
 *
 * Deliberately does NOT try to regenerate DESIGN.md from tokens.css: the
 * bundle comes from upstream and is copied verbatim; rewriting DESIGN.md
 * would break the provenance that source/tokens.source.json records.
 * Detecting and reporting divergence — so a human/gate can reject or accept
 * it explicitly — is the correction that fits a verbatim-copy pipeline.
 *
 * Usage:
 *   node od-verify-system.mjs --dir <featurePath>/design-systems/<id>
 *
 * Writes `<dir>/design-consistency.json` and exits 0 when no divergence is
 * found, 1 when at least one divergence was found (informational — the
 * caller decides whether that blocks FINAL), 2 on usage error. Missing
 * tokens.css/DESIGN.md is not this script's concern (od-fetch-system.mjs
 * already gates that) — it exits 0 with an explicit `skipped` reason
 * instead of failing redundantly.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback = undefined) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

const CSS_CUSTOM_PROPERTY_RE = /--([a-zA-Z][a-zA-Z0-9-_]*)\s*:\s*([^;}\n]+)/g;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

/** Custom properties declared in tokens.css: Map<name, value>. */
export function parseTokensCssProperties(cssText) {
  const tokens = new Map();
  for (const match of cssText.matchAll(CSS_CUSTOM_PROPERTY_RE)) {
    tokens.set(`--${match[1]}`, match[2].trim());
  }
  return tokens;
}

/** Every hex color literal mentioned anywhere in the tokens (values only), lowercased, deduped. */
function hexValuesFromTokens(tokens) {
  const hexes = new Set();
  for (const value of tokens.values()) {
    for (const hex of value.match(HEX_RE) ?? []) hexes.add(hex.toLowerCase());
  }
  return hexes;
}

/** Every hex color literal mentioned anywhere in DESIGN.md prose, lowercased, deduped. */
export function hexValuesFromDesignMd(designMdText) {
  const hexes = new Set();
  for (const hex of designMdText.match(HEX_RE) ?? []) hexes.add(hex.toLowerCase());
  return hexes;
}

/**
 * Palette divergence: a hex color DESIGN.md's prose asserts as part of the
 * palette (e.g. "Primaria: #FECE14") that never appears anywhere as a token
 * VALUE in tokens.css. The reverse (a token hex never mentioned in prose) is
 * not flagged — DESIGN.md is prose, not expected to enumerate every token.
 */
export function comparePalette(tokens, designMdText) {
  const tokenHexes = hexValuesFromTokens(tokens);
  const designMdHexes = hexValuesFromDesignMd(designMdText);
  const onlyInDesignMd = [...designMdHexes].filter((hex) => !tokenHexes.has(hex));
  return { tokenHexes: [...tokenHexes], designMdHexes: [...designMdHexes], onlyInDesignMd };
}

/**
 * Typography divergence: the first font family declared in each `--font-*`
 * token (e.g. `--font-body: Inter, sans-serif` -> "Inter") that is never
 * mentioned anywhere in the DESIGN.md prose at all.
 */
export function compareTypography(tokens, designMdText) {
  const declaredFamilies = [];
  for (const [name, value] of tokens) {
    if (!name.startsWith("--font-")) continue;
    const first = value.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
    if (first) declaredFamilies.push(first);
  }
  const lowerDesignMd = designMdText.toLowerCase();
  const missingFromProse = declaredFamilies.filter(
    (family) => !lowerDesignMd.includes(family.toLowerCase()),
  );
  return { declaredFamilies: [...new Set(declaredFamilies)], missingFromProse: [...new Set(missingFromProse)] };
}

/**
 * Spacing-scale divergence: the numeric px values of every `--space-*`
 * token, compared against a numeric scale mentioned near the words
 * espacamento/spacing/spacing scale in DESIGN.md's prose (best-effort — a
 * scale that cannot be confidently extracted from prose is reported as
 * `proseScaleFound: false`, never as a false divergence).
 */
export function compareSpacingScale(tokens, designMdText) {
  const tokenScale = [];
  for (const [name, value] of tokens) {
    if (!name.startsWith("--space-")) continue;
    const px = value.match(/^(\d+(?:\.\d+)?)px$/);
    if (px) tokenScale.push(Number(px[1]));
  }
  tokenScale.sort((a, b) => a - b);

  // Line-based, not a single backtracking regex over the whole text: finds
  // the line mentioning espacamento/spacing, then looks for a run of 3+
  // numbers on that line or the next one (a heading followed by the scale on
  // the next line is the common shape; a blank line means a new topic
  // started). Isolating the candidate line first avoids a single complex
  // regex backtracking into the MIDDLE of a multi-digit number to satisfy a
  // minimum-repetition count from an unrelated position.
  const KEYWORD_RE = /espa[çc]amento|spacing/i;
  const SCALE_RE = /((?:\d+(?:\/|,\s*)){2,}\d+)/;
  const lines = designMdText.split("\n");
  let match = null;
  for (let i = 0; i < lines.length && !match; i += 1) {
    if (!KEYWORD_RE.test(lines[i])) continue;
    match = lines[i].match(SCALE_RE) ?? (lines[i + 1]?.trim() ? lines[i + 1].match(SCALE_RE) : null);
  }
  if (!match) {
    return { tokenScale, proseScaleFound: false, proseScale: [], matches: null };
  }
  const proseScale = match[1].split(/\/|,/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  const proseScaleSet = new Set(proseScale);
  const tokenScaleSet = new Set(tokenScale);
  const matches =
    proseScaleSet.size === tokenScaleSet.size &&
    [...proseScaleSet].every((value) => tokenScaleSet.has(value));
  return { tokenScale, proseScaleFound: true, proseScale, matches };
}

/**
 * Runs all three comparisons and returns a single report. Pure — no I/O,
 * testable directly.
 */
export function buildConsistencyReport(cssText, designMdText) {
  const tokens = parseTokensCssProperties(cssText);
  const palette = comparePalette(tokens, designMdText);
  const typography = compareTypography(tokens, designMdText);
  const spacing = compareSpacingScale(tokens, designMdText);

  const divergences = [];
  if (palette.onlyInDesignMd.length > 0) {
    divergences.push({
      kind: "PALETTE_DIVERGENCE",
      message: `DESIGN.md mentions color(s) ${palette.onlyInDesignMd.join(", ")} that never appear as a token value in tokens.css`,
      detail: palette,
    });
  }
  if (typography.missingFromProse.length > 0) {
    divergences.push({
      kind: "TYPOGRAPHY_DIVERGENCE",
      message: `tokens.css declares font famil${typography.missingFromProse.length === 1 ? "y" : "ies"} ${typography.missingFromProse.join(", ")} never mentioned anywhere in DESIGN.md`,
      detail: typography,
    });
  }
  if (spacing.proseScaleFound && spacing.matches === false) {
    divergences.push({
      kind: "SPACING_SCALE_DIVERGENCE",
      message: `DESIGN.md's spacing scale (${spacing.proseScale.join("/")}) does not match tokens.css's --space-* values (${spacing.tokenScale.join("/")})`,
      detail: spacing,
    });
  }

  return {
    schemaVersion: 1,
    consistent: divergences.length === 0,
    divergences,
    palette,
    typography,
    spacing,
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
const runningAsCli = invokedDirectly || (process.argv[1] && /od-verify-system\.mjs$/.test(process.argv[1]));

function main() {
  const dir = arg("dir");
  if (!dir) {
    console.error("od-verify-system: --dir <design-systems/<id>> is required");
    process.exit(2);
  }
  const cssPath = join(dir, "tokens.css");
  const designMdPath = join(dir, "DESIGN.md");
  if (!existsSync(cssPath) || !existsSync(designMdPath)) {
    const report = {
      schemaVersion: 1,
      consistent: true,
      skipped: true,
      reason: "tokens.css and/or DESIGN.md not found — od-fetch-system.mjs's own presence gate already covers this",
      divergences: [],
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const cssText = readFileSync(cssPath, "utf8");
  const designMdText = readFileSync(designMdPath, "utf8");
  const report = buildConsistencyReport(cssText, designMdText);

  const outPath = join(dir, "design-consistency.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.consistent ? 0 : 1);
}

if (runningAsCli) main();
