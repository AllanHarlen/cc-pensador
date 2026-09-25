#!/usr/bin/env node
/**
 * Deterministic renderer and auditor for the Pensador's resolved visual package.
 * `render` builds every artifact from design-contract.json (v2); nothing is copied from elsewhere.
 * `audit` checks the package on disk (Phase 4 extends it with brief conformance and re-render integrity).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkBriefConformance, checkComponentStates, checkContrastMatrix, checkScales, isBlocking,
} from './lib/design-gates.mjs';
import {
  DEFAULT_COMPONENTS, REQUIRED_COMPONENT_STATES, renderComponentsCss, renderComponentsHtml, renderComponentsManifest, renderDesignMarkdown,
  renderDtcg, renderManifest, renderPreviewPages, renderTailwind, renderTokensCss, renderUsageMarkdown,
} from './lib/design-render.mjs';
import {
  ALL_TOKENS, CONTRACT_SCHEMA_VERSION, SCHEMA_SHARED_TOKENS, SCHEMA_THEME_TOKENS,
  canonicalJson, canonicalize, contractSha256, finalizeContract,
} from './lib/token-mapper.mjs';

export { REQUIRED_COMPONENT_STATES, renderComponentsHtml };
export const REQUIRED_PACKAGE_FILES = [
  'design-contract.json', 'tokens.css', 'components.css', 'design-tokens.json', 'tailwind-v4.css', 'DESIGN.md', 'components.html', 'USAGE.md', 'manifest.json', 'provenance.json',
];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

function inside(root, candidate) {
  const rel = relative(resolve(root), resolve(root, candidate));
  return rel && !rel.startsWith('..') && !rel.split(sep).includes('..');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const VAR_REF = /var\(\s*(--[a-z0-9-]+)/gi;

/** Where the feature keeps the brief: <feature>/design-systems/<id>/resolved -> <feature>/design-brief.json. */
export function defaultBriefFile(resolvedDir) {
  return join(resolvedDir, '..', '..', '..', 'design-brief.json');
}

const sha256Text = (text) => createHash('sha256').update(text).digest('hex');

/** Hash over the per-file hashes: one value that changes when any rendered file changes. */
export function packageSha256(files) {
  return sha256Text(Object.keys(files).sort().map((name) => `${name}:${files[name]}`).join('\n'));
}

/**
 * Re-renders the package in memory and compares it with the files on disk, byte for byte, plus the
 * hashes recorded in provenance.json. A hand-edited tokens.css or DESIGN.md cannot pass.
 */
export function checkIntegrity({ resolvedDir, contract }) {
  const findings = [];
  const add = (code, message, path) => findings.push({ severity: 'high', code, message, path });
  const expected = renderPackageFiles(contract);
  const expectedHashes = {};
  for (const [name, text] of Object.entries(expected)) {
    expectedHashes[name] = sha256Text(text);
    const file = join(resolvedDir, name);
    if (!existsSync(file)) add('INTEGRITY_FILE_MISSING', `${name} is missing; it is rendered from the contract`, name);
    else if (readFileSync(file, 'utf8') !== text) add('INTEGRITY_DRIFT', `${name} differs from a fresh render of design-contract.json; do not edit rendered files, change the seed and derive again`, name);
  }
  const provenanceFile = join(resolvedDir, 'provenance.json');
  if (!existsSync(provenanceFile)) add('PROVENANCE_MISSING', 'provenance.json is missing', 'provenance.json');
  else {
    let provenance = null;
    try { provenance = readJson(provenanceFile); } catch { add('PROVENANCE_INVALID', 'provenance.json is not valid JSON', 'provenance.json'); }
    if (provenance) {
      if (provenance.contractSha256 !== contract.sha256) add('PROVENANCE_HASH_MISMATCH', 'provenance.json contractSha256 does not match design-contract.json', 'provenance.json');
      for (const [name, hash] of Object.entries(expectedHashes)) {
        if (provenance.files?.[name] !== hash) add('PROVENANCE_HASH_MISMATCH', `provenance.json hash for ${name} does not match a fresh render`, 'provenance.json');
      }
      if (provenance.packageSha256 !== packageSha256(expectedHashes)) add('PROVENANCE_HASH_MISMATCH', 'provenance.json packageSha256 does not match a fresh render', 'provenance.json');
    }
  }
  return findings;
}

/** source/engine-run.json must exist, report success and belong to this very contract. */
export function checkEngineRun({ resolvedDir, contract }) {
  const file = join(resolvedDir, '..', 'source', 'engine-run.json');
  const bad = (code, message) => [{ severity: 'high', code, message, path: 'source/engine-run.json' }];
  if (!existsSync(file)) return bad('ENGINE_RUN_MISSING', 'source/engine-run.json is missing; the design system was not derived by od-brand-build.mjs');
  let run = null;
  try { run = readJson(file); } catch { return bad('ENGINE_RUN_INVALID', 'source/engine-run.json is not valid JSON'); }
  if (run.status !== 'ok') return bad('ENGINE_RUN_FAILED', `source/engine-run.json status is ${JSON.stringify(run.status)}${run.reasonCode ? ` (${run.reasonCode})` : ''}, not "ok"`);
  if (run.contractSha256 !== contract.sha256) return bad('ENGINE_RUN_CONTRACT_MISMATCH', 'source/engine-run.json contractSha256 does not match design-contract.json; the contract was edited after derivation');
  return [];
}

/**
 * Audit v2. `checks` splits the verdict per gate so the stage gate can demand each one:
 * structure (files, tokens, states, scales, assets), contrast (WCAG matrix, both themes),
 * conformance (locked brief fields), integrity (re-render byte compare), engineRun.
 * `strict` (the CLI default) turns a missing brief / engine-run into a blocking finding;
 * otherwise those checks are reported as SKIPPED, which the stage gate refuses.
 */
export function auditDesignPackage({ resolvedDir, contract, brief, briefFile, strict = false } = {}) {
  const findings = [];
  const add = (severity, code, message, path = null) => findings.push({ severity, code, message, path });
  const checks = { structure: 'PASS', contrast: 'PASS', conformance: 'SKIPPED', integrity: 'PASS', engineRun: 'SKIPPED' };
  const blocked = () => ({ status: 'BLOCKED', generatedAt: new Date().toISOString(), contractSha256: contract?.sha256 ?? null, checks: { ...checks, structure: 'BLOCKED' }, findings });
  const verdict = (start) => (findings.slice(start).some(isBlocking) ? 'BLOCKED' : 'PASS');

  if (!resolvedDir || !existsSync(resolvedDir)) {
    add('critical', 'PACKAGE_MISSING', `Resolved design package not found at ${resolvedDir ?? '(no --dir given)'}`, resolvedDir);
    return blocked();
  }
  if (contract === undefined) {
    const contractFile = join(resolvedDir, 'design-contract.json');
    if (!existsSync(contractFile)) {
      add('critical', 'CONTRACT_MISSING', 'design-contract.json is missing', 'design-contract.json');
      return blocked();
    }
    contract = readJson(contractFile);
  }
  if (contract.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    add('critical', 'CONTRACT_VERSION_UNSUPPORTED', `design-contract.json must have schemaVersion ${CONTRACT_SCHEMA_VERSION} (found ${JSON.stringify(contract.schemaVersion)}); re-derive it with od-brand-build.mjs`, 'schemaVersion');
    return blocked();
  }

  let mark = findings.length;
  if (contract.sha256 !== contractSha256(contract)) add('high', 'CONTRACT_HASH_MISMATCH', 'contract sha256 does not match its content; the contract was edited after render', 'sha256');

  for (const theme of ['light', 'dark']) {
    if (!contract.themes?.[theme]) { add('high', 'THEME_MISSING', `themes.${theme} is required (light and dark are always shipped)`, `themes.${theme}`); continue; }
    for (const name of SCHEMA_THEME_TOKENS) if (!(name in contract.themes[theme])) add('high', 'TOKEN_MISSING', `themes.${theme} lacks ${name}`, `themes.${theme}.${name}`);
  }
  for (const name of SCHEMA_SHARED_TOKENS) if (!(name in (contract.tokens ?? {}))) add('high', 'TOKEN_MISSING', `tokens lacks ${name}`, `tokens.${name}`);

  const defined = new Set([...ALL_TOKENS, ...Object.keys(contract.tokens ?? {}), ...Object.keys(contract.themes?.light ?? {}), ...Object.keys(contract.themes?.dark ?? {})]);
  const scanned = [...Object.entries(contract.tokens ?? {}), ...Object.values(contract.themes ?? {}).flatMap((values) => Object.entries(values))];
  for (const [name, value] of scanned) {
    for (const match of String(value).matchAll(VAR_REF)) if (!defined.has(match[1])) add('high', 'TOKEN_ALIAS_UNDEFINED', `${name} references undefined ${match[1]}`, name);
  }

  findings.push(...checkScales(contract), ...checkComponentStates(contract));
  if (contract.iconography?.format !== 'vector' || !contract.iconography?.package || !contract.iconography?.version) add('high', 'ICONOGRAPHY_INVALID', 'A versioned vector icon package is required', 'iconography');
  if (/\p{Extended_Pictographic}/u.test(JSON.stringify(contract.iconography?.usages ?? {}))) add('high', 'EMOJI_ICON', 'Emoji cannot substitute a functional icon', 'iconography.usages');

  for (const file of REQUIRED_PACKAGE_FILES) if (!existsSync(join(resolvedDir, file))) add('high', 'REQUIRED_FILE_MISSING', `${file} is missing`, file);
  const cssFile = join(resolvedDir, 'tokens.css');
  if (existsSync(cssFile)) {
    const css = readFileSync(cssFile, 'utf8');
    if (!css.includes('[data-theme="dark"]') || !css.includes('prefers-color-scheme: dark')) add('high', 'THEME_CSS_MISSING', 'tokens.css must declare [data-theme="dark"] and a prefers-color-scheme: dark block', 'tokens.css');
  }
  const previewDir = join(resolvedDir, 'preview');
  if (!existsSync(previewDir) || !statSync(previewDir).isDirectory() || !existsSync(join(previewDir, 'index.html'))) add('high', 'PREVIEW_MISSING', 'preview/index.html is required', 'preview');

  const manifestFile = join(resolvedDir, 'assets', 'manifest.json');
  if (!existsSync(manifestFile)) add('high', 'ASSET_MANIFEST_MISSING', 'assets/manifest.json is required', 'assets/manifest.json');
  else {
    const manifest = readJson(manifestFile);
    const ids = new Set();
    for (const asset of manifest.assets ?? []) {
      if (ids.has(asset.id)) add('high', 'ASSET_DUPLICATE_ID', `Duplicate asset id ${asset.id}`, asset.id);
      ids.add(asset.id);
      const required = asset.classification === 'required';
      const assetFile = inside(join(resolvedDir, 'assets'), asset.file) ? join(resolvedDir, 'assets', asset.file) : null;
      if (!assetFile || !existsSync(assetFile)) { if (required) add('critical', 'REQUIRED_ASSET_MISSING', `Required asset ${asset.id} is missing`, asset.file); continue; }
      const missingSeedBinding = asset.purpose === 'seed-demo' && !asset.seedBindings?.length;
      if (!asset.alt || !asset.routes?.length || !asset.componentSlot || !asset.materializeInto || missingSeedBinding) add('high', 'ASSET_BINDING_INCOMPLETE', `Asset ${asset.id} lacks semantic placement metadata${missingSeedBinding ? ' or seedBindings' : ''}`, asset.id);
      if (asset.sha256 !== sha256(assetFile)) add('high', 'ASSET_HASH_MISMATCH', `Asset ${asset.id} hash does not match`, asset.file);
    }
  }
  checks.structure = verdict(mark);

  mark = findings.length;
  findings.push(...checkContrastMatrix(contract));
  checks.contrast = verdict(mark);

  mark = findings.length;
  const briefPath = briefFile ?? defaultBriefFile(resolvedDir);
  if (brief === undefined && existsSync(briefPath)) {
    try { brief = readJson(briefPath); } catch { brief = null; }
  }
  if (brief === undefined) {
    if (strict) { add('high', 'BRIEF_MISSING', `design-brief.json not found at ${briefPath}; conformance with the brief cannot be checked`, 'design-brief.json'); checks.conformance = 'BLOCKED'; }
  } else {
    findings.push(...checkBriefConformance(brief, contract).findings);
    checks.conformance = verdict(mark);
  }

  mark = findings.length;
  findings.push(...checkIntegrity({ resolvedDir, contract }));
  checks.integrity = verdict(mark);

  mark = findings.length;
  const engineRunFile = join(resolvedDir, '..', 'source', 'engine-run.json');
  if (existsSync(engineRunFile) || strict) {
    findings.push(...checkEngineRun({ resolvedDir, contract }));
    checks.engineRun = verdict(mark);
  }

  const blocking = findings.filter(isBlocking);
  return { status: blocking.length ? 'BLOCKED' : 'PASS', generatedAt: new Date().toISOString(), contractSha256: contract.sha256, checks, findings };
}

/** Every file `render` writes (relative to resolved/), as text, from an already signed contract. */
export function renderPackageFiles(input) {
  const contract = canonicalize(input); // key order must never leak into the output
  const files = {
    'design-contract.json': canonicalJson(contract),
    'tokens.css': renderTokensCss(contract),
    'components.css': renderComponentsCss(contract),
    'design-tokens.json': renderDtcg(contract),
    'tailwind-v4.css': renderTailwind(contract),
    'DESIGN.md': renderDesignMarkdown(contract),
    'components.html': renderComponentsHtml(contract),
    'USAGE.md': renderUsageMarkdown(contract),
    'manifest.json': `${JSON.stringify(renderManifest(contract), null, 2)}\n`,
    'components.manifest.json': `${JSON.stringify(renderComponentsManifest(contract), null, 2)}\n`,
  };
  for (const [name, text] of Object.entries(renderPreviewPages(contract))) files[`preview/${name}`] = text;
  return files;
}

function readEngineRun(resolvedDir) {
  const file = join(resolvedDir, '..', 'source', 'engine-run.json');
  if (!existsSync(file)) return null;
  try {
    const run = readJson(file);
    return { path: run.engine ?? null, version: run.version ?? null, commit: run.commit ?? null, deriveSha256: run.deriveSha256 ?? null };
  } catch {
    return null;
  }
}

export function renderDesignPackage({ contractFile, resolvedDir, resolved, provenance = {}, briefFile, strict = false }) {
  resolvedDir ??= resolved;
  if (!contractFile || !resolvedDir) throw new TypeError('contractFile and resolvedDir are required');
  const contract = finalizeContract(readJson(contractFile));
  if (contract.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw new TypeError(`design-contract.json must have schemaVersion ${CONTRACT_SCHEMA_VERSION}; derive it with od-brand-build.mjs`);
  }
  if (!contract.themes?.light || !contract.themes?.dark) throw new TypeError('design-contract.json needs themes.light and themes.dark');
  const files = renderPackageFiles(contract);
  const hashes = {};
  for (const [name, text] of Object.entries(files)) {
    writeText(join(resolvedDir, name), text);
    hashes[name] = createHash('sha256').update(text).digest('hex');
  }
  const assets = { schemaVersion: 1, decision: contract.imagery?.decision, assets: contract.imagery?.assets ?? [] };
  if (!existsSync(join(resolvedDir, 'assets', 'manifest.json'))) writeText(join(resolvedDir, 'assets', 'manifest.json'), canonicalJson(assets));
  writeText(join(resolvedDir, 'provenance.json'), canonicalJson({
    schemaVersion: 2,
    systemId: contract.systemId,
    contractSha256: contract.sha256,
    version: contract.version,
    briefRef: contract.briefRef ?? null,
    engine: { ...contract.engine, run: readEngineRun(resolvedDir) },
    files: hashes,
    packageSha256: packageSha256(hashes),
    ...provenance,
  }));
  const audit = auditDesignPackage({ resolvedDir, contract, briefFile, strict });
  writeText(join(resolvedDir, 'design-audit.json'), canonicalJson(audit));
  return audit;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) out._.push(item);
    else out[item.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? 'audit';
  const resolvedDir = resolve(String(args.resolved ?? args.dir ?? '.'));
  const briefFile = typeof args.brief === 'string' ? resolve(args.brief) : undefined;
  // The CLI is the real gate: a missing brief or engine-run is a blocking finding, never a skip.
  const audit = command === 'render'
    ? renderDesignPackage({ contractFile: resolve(String(args.contract ?? join(resolvedDir, 'design-contract.json'))), resolvedDir, briefFile, strict: true })
    : auditDesignPackage({ resolvedDir, briefFile, strict: true });
  if (command !== 'render' && existsSync(resolvedDir)) writeText(join(resolvedDir, 'design-audit.json'), canonicalJson(audit));
  // What the skill layer records in state.designPackages[<id>] and state.designBriefPath (P12).
  const systemId = existsSync(join(resolvedDir, 'design-contract.json')) ? readJson(join(resolvedDir, 'design-contract.json')).systemId : null;
  const briefPath = briefFile ?? defaultBriefFile(resolvedDir);
  const statePatch = {
    designPackages: systemId ? { [systemId]: { auditStatus: audit.status, contractSha256: audit.contractSha256 ?? null } } : {},
    designBriefPath: existsSync(briefPath) ? briefPath : null,
  };
  console.log(JSON.stringify({ ...audit, statePatch }, null, 2));
  process.exitCode = audit.status === 'PASS' ? 0 : 1;
}

export { DEFAULT_COMPONENTS };
