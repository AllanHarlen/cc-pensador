#!/usr/bin/env node
/** Deterministic renderer and auditor for the Pensador's resolved visual package. */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_TOKEN_FAMILIES = [
  "colors", "typography", "spacing", "breakpoints", "radius", "borders", "elevation", "motion",
];
export const REQUIRED_COMPONENT_STATES = ["default", "hover", "focus", "disabled"];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, "utf8");
}

function flatten(value, prefix = "", out = {}) {
  for (const [key, item] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item) && !("value" in item)) flatten(item, path, out);
    else out[path] = item && typeof item === "object" && "value" in item ? item.value : item;
  }
  return out;
}

function cssName(path) {
  return `--${path.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}

function resolveAlias(value, flat, stack = []) {
  if (typeof value !== "string") return value;
  const match = value.match(/^\{([^}]+)\}$/) || value.match(/^\$([a-zA-Z0-9_.-]+)$/);
  if (!match) return value;
  const key = match[1];
  if (stack.includes(key) || !(key in flat)) return undefined;
  return resolveAlias(flat[key], flat, [...stack, key]);
}

function renderCss(tokens) {
  const flat = flatten(tokens);
  const lines = Object.keys(flat).sort().map((key) => {
    const value = resolveAlias(flat[key], flat);
    return `  ${cssName(key)}: ${value};`;
  });
  return `/* Generated from design-contract.json. Do not edit. */\n:root {\n${lines.join("\n")}\n}\n`;
}

function renderDesignMarkdown(contract) {
  const families = REQUIRED_TOKEN_FAMILIES.map((family) => {
    const rows = Object.entries(flatten(contract.tokens?.[family] ?? {}))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `| \`${name}\` | \`${String(value)}\` |`).join("\n");
    return `## ${family}\n\n| Token | Value |\n|---|---|\n${rows || "| _missing_ | _missing_ |"}`;
  }).join("\n\n");
  const components = (contract.components ?? []).map((component) =>
    `| ${component.name} | ${(component.states ?? []).join(", ")} |`,
  ).join("\n");
  return `# ${contract.systemId} — Resolved Design System\n\n` +
    `Generated from the authoritative \`design-contract.json\`.\n\n${families}\n\n` +
    `## Components\n\n| Component | States |\n|---|---|\n${components}\n\n` +
    `## Iconography\n\n- Package: \`${contract.iconography?.package}\`\n- Version: \`${contract.iconography?.version}\`\n- Format: vector\n\n` +
    `## Imagery\n\nDecision: \`${contract.imagery?.decision}\`. See \`assets/manifest.json\`.\n\n` +
    `## Anti-patterns\n\n${(contract.antiPatterns ?? []).map((item) => `- ${item}`).join("\n")}\n`;
}

function channel(hex) {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  const match = String(color).match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return 0.2126 * channel(match[1]) + 0.7152 * channel(match[2]) + 0.0722 * channel(match[3]);
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  if (a == null || b == null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function inside(root, candidate) {
  const rel = relative(resolve(root), resolve(root, candidate));
  return rel && !rel.startsWith("..") && !rel.split(sep).includes("..");
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function auditDesignPackage({ resolvedDir, contract } = {}) {
  const findings = [];
  const add = (severity, code, message, path = null) => findings.push({ severity, code, message, path });

  if (!resolvedDir || !existsSync(resolvedDir)) {
    add("critical", "PACKAGE_MISSING", `Resolved design package not found at ${resolvedDir ?? "(no --dir given)"}`, resolvedDir);
    return { status: "BLOCKED", generatedAt: new Date().toISOString(), findings };
  }
  if (contract === undefined) {
    const contractFile = join(resolvedDir, "design-contract.json");
    if (!existsSync(contractFile)) {
      add("critical", "CONTRACT_MISSING", "design-contract.json is missing", "design-contract.json");
      return { status: "BLOCKED", generatedAt: new Date().toISOString(), findings };
    }
    contract = readJson(contractFile);
  }

  for (const family of REQUIRED_TOKEN_FAMILIES) {
    if (!contract.tokens?.[family] || Object.keys(flatten(contract.tokens[family])).length === 0) add("high", "TOKEN_FAMILY_MISSING", `Missing token family: ${family}`, `tokens.${family}`);
  }
  const flat = flatten(contract.tokens ?? {});
  for (const [name, value] of Object.entries(flat)) {
    if (typeof value === "string" && (/^\{[^}]+\}$/.test(value) || /^\$[\w.-]+$/.test(value)) && resolveAlias(value, flat) === undefined) add("high", "TOKEN_ALIAS_UNDEFINED", `Undefined or cyclic alias at ${name}`, name);
  }
  if (!Array.isArray(contract.components) || contract.components.length === 0) add("high", "COMPONENTS_MISSING", "At least one component contract is required", "components");
  for (const component of contract.components ?? []) {
    for (const state of REQUIRED_COMPONENT_STATES) if (!component.states?.includes(state)) add("high", "COMPONENT_STATE_MISSING", `${component.name} is missing state ${state}`, `components.${component.name}`);
  }
  if (contract.iconography?.format !== "vector" || !contract.iconography?.package || !contract.iconography?.version) add("high", "ICONOGRAPHY_INVALID", "A versioned vector icon package is required", "iconography");
  const serialized = JSON.stringify(contract.iconography?.usages ?? {});
  if (/\p{Extended_Pictographic}/u.test(serialized)) add("high", "EMOJI_ICON", "Emoji cannot substitute a functional icon", "iconography.usages");
  for (const pair of contract.contrastPairs ?? []) {
    const fg = resolveAlias(pair.foreground, flat) ?? pair.foreground;
    const bg = resolveAlias(pair.background, flat) ?? pair.background;
    const ratio = contrast(fg, bg);
    if (ratio == null || ratio < Number(pair.minimum ?? 4.5)) add("high", "WCAG_CONTRAST", `Contrast ${pair.foreground}/${pair.background} is ${ratio?.toFixed(2) ?? "invalid"}`, "contrastPairs");
  }
  for (const file of ["tokens.css", "design-tokens.json", "DESIGN.md", "components.html"]) if (!existsSync(join(resolvedDir, file))) add("high", "REQUIRED_FILE_MISSING", `${file} is missing`, file);
  const previewDir = join(resolvedDir, "preview");
  if (!existsSync(previewDir) || !statSync(previewDir).isDirectory()) add("high", "PREVIEW_MISSING", "preview/ is required", "preview");

  const manifestFile = join(resolvedDir, "assets", "manifest.json");
  if (!existsSync(manifestFile)) add("high", "ASSET_MANIFEST_MISSING", "assets/manifest.json is required", "assets/manifest.json");
  else {
    const manifest = readJson(manifestFile);
    const ids = new Set();
    for (const asset of manifest.assets ?? []) {
      if (ids.has(asset.id)) add("high", "ASSET_DUPLICATE_ID", `Duplicate asset id ${asset.id}`, asset.id);
      ids.add(asset.id);
      const required = asset.classification === "required";
      const assetFile = inside(join(resolvedDir, "assets"), asset.file) ? join(resolvedDir, "assets", asset.file) : null;
      if (!assetFile || !existsSync(assetFile)) { if (required) add("critical", "REQUIRED_ASSET_MISSING", `Required asset ${asset.id} is missing`, asset.file); continue; }
      const missingSeedBinding = asset.purpose === "seed-demo" && !asset.seedBindings?.length;
      if (!asset.alt || !asset.routes?.length || !asset.componentSlot || !asset.materializeInto || missingSeedBinding) add("high", "ASSET_BINDING_INCOMPLETE", `Asset ${asset.id} lacks semantic placement metadata${missingSeedBinding ? " or seedBindings" : ""}`, asset.id);
      if (asset.sha256 !== sha256(assetFile)) add("high", "ASSET_HASH_MISMATCH", `Asset ${asset.id} hash does not match`, asset.file);
    }
  }

  const blocking = findings.filter((item) => ["critical", "high"].includes(item.severity));
  return { status: blocking.length ? "BLOCKED" : "PASS", generatedAt: new Date().toISOString(), findings };
}

export function renderComponentsHtml(contract) {
  const components = Array.isArray(contract?.components) && contract.components.length > 0
    ? contract.components
    : [
        { name: "Button", states: REQUIRED_COMPONENT_STATES },
        { name: "Card", states: REQUIRED_COMPONENT_STATES },
        { name: "Input", states: REQUIRED_COMPONENT_STATES },
        { name: "Badge", states: REQUIRED_COMPONENT_STATES },
        { name: "Modal", states: REQUIRED_COMPONENT_STATES },
      ];

  const sections = components.map((comp) => {
    const states = Array.isArray(comp.states) && comp.states.length > 0 ? comp.states : REQUIRED_COMPONENT_STATES;
    const stateBlocks = states.map((state) => {
      const stateClass = `state-${state}`;
      let markup = "";
      switch (comp.name.toLowerCase()) {
        case "button":
        case "botao":
          markup = `<button type="button" class="btn ${stateClass}" ${state === "disabled" ? "disabled" : ""}>Button (${state})</button>`;
          break;
        case "card":
          markup = `<div class="card ${stateClass}"><div class="card-header">Card Title</div><div class="card-body">Card content displaying ${state} state.</div></div>`;
          break;
        case "input":
        case "campo":
          markup = `<input type="text" class="input ${stateClass}" placeholder="Input state: ${state}" ${state === "disabled" ? "disabled" : ""} ${state === "focus" ? "autofocus" : ""} value="${state === "disabled" ? "Valor desabilitado" : ""}" />`;
          break;
        case "badge":
          markup = `<span class="badge ${stateClass}">Badge (${state})</span>`;
          break;
        case "modal":
          markup = `<div class="modal ${stateClass}"><div class="modal-dialog"><div class="modal-header">Modal Title</div><div class="modal-body">Modal showing ${state} state.</div></div></div>`;
          break;
        default:
          markup = `<div class="component component-${comp.name.toLowerCase()} ${stateClass}" ${state === "disabled" ? 'data-disabled="true"' : ""}><span>${comp.name} [${state}]</span></div>`;
          break;
      }
      return `        <div class="fixture-state">
          <span class="state-label">${state}</span>
          <div class="state-render">${markup}</div>
        </div>`;
    }).join("\n");

    return `    <section class="component-section" id="component-${comp.name.toLowerCase()}">
      <h2>${comp.name}</h2>
      <div class="fixtures-grid">
${stateBlocks}
      </div>
    </section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${contract?.systemId ?? "Design System"} — Component Fixtures</title>
  <link rel="stylesheet" href="./tokens.css">
  <style>
    :root {
      font-family: var(--typography-font-family, system-ui, -apple-system, sans-serif);
      background-color: var(--colors-background, #fafafa);
      color: var(--colors-text, #18181b);
    }
    body { margin: 0; padding: 2rem; }
    h1 { font-size: 1.875rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.25rem; margin-bottom: 1rem; border-bottom: 1px solid var(--borders-default, #e4e4e7); padding-bottom: 0.5rem; }
    .component-section { margin-bottom: 2.5rem; }
    .fixtures-grid { display: flex; flex-wrap: wrap; gap: 1.5rem; }
    .fixture-state { display: flex; flex-direction: column; gap: 0.5rem; }
    .state-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--colors-muted, #71717a); }
    .btn { padding: 0.5rem 1rem; border-radius: var(--radius-md, 0.375rem); border: 1px solid transparent; background: var(--colors-primary, #2563eb); color: #fff; cursor: pointer; transition: all 0.15s ease-in-out; }
    .btn.state-hover { filter: brightness(0.9); }
    .btn.state-focus { outline: 2px solid var(--colors-primary, #2563eb); outline-offset: 2px; }
    .btn:disabled, .btn.state-disabled { opacity: 0.5; cursor: not-allowed; }
    .card { padding: 1rem; border-radius: var(--radius-md, 0.375rem); border: 1px solid var(--borders-default, #e4e4e7); background: #fff; box-shadow: var(--elevation-sm, 0 1px 2px rgba(0,0,0,0.05)); }
    .card.state-hover { box-shadow: var(--elevation-md, 0 4px 6px rgba(0,0,0,0.1)); }
    .card.state-focus { border-color: var(--colors-primary, #2563eb); }
    .card.state-disabled { opacity: 0.6; background: #f4f4f5; }
    .input { padding: 0.5rem 0.75rem; border-radius: var(--radius-md, 0.375rem); border: 1px solid var(--borders-default, #e4e4e7); background: #fff; }
    .input.state-hover { border-color: var(--colors-primary, #2563eb); }
    .input.state-focus { outline: 2px solid var(--colors-primary, #2563eb); border-color: transparent; }
    .input:disabled, .input.state-disabled { opacity: 0.5; background: #f4f4f5; cursor: not-allowed; }
    .badge { display: inline-flex; align-items: center; padding: 0.25rem 0.625rem; font-size: 0.75rem; font-weight: 500; border-radius: var(--radius-full, 9999px); background: var(--colors-primary-light, #dbeafe); color: var(--colors-primary, #1e40af); }
    .badge.state-hover { filter: brightness(0.95); }
    .badge.state-focus { ring: 2px solid var(--colors-primary, #2563eb); }
    .badge.state-disabled { opacity: 0.5; }
    .modal { padding: 1rem; border-radius: var(--radius-lg, 0.5rem); border: 1px solid var(--borders-default, #e4e4e7); background: #fff; box-shadow: var(--elevation-lg, 0 10px 15px -3px rgba(0,0,0,0.1)); min-width: 250px; }
  </style>
</head>
<body>
  <h1>${contract?.systemId ?? "Design System"} — Component Fixtures</h1>
${sections}
</body>
</html>
`;
}

export function renderDesignPackage({ contractFile, originalDir, resolvedDir, original, resolved, provenance = {} }) {
  originalDir ??= original;
  resolvedDir ??= resolved;
  if (!contractFile || !resolvedDir) throw new TypeError("contractFile and resolvedDir are required");
  const contract = readJson(contractFile);
  mkdirSync(resolvedDir, { recursive: true });
  for (const entry of ["components.html", "preview"]) {
    const source = originalDir ? join(originalDir, entry) : null;
    if (source && existsSync(source) && !existsSync(join(resolvedDir, entry))) cpSync(source, join(resolvedDir, entry), { recursive: true });
  }
  if (!existsSync(join(resolvedDir, "components.html"))) {
    writeFileSync(join(resolvedDir, "components.html"), renderComponentsHtml(contract), "utf8");
  }
  const previewDir = join(resolvedDir, "preview");
  if (!existsSync(previewDir)) {
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(join(previewDir, "index.html"), `<!DOCTYPE html><html><head><title>Preview</title><link rel="stylesheet" href="../tokens.css"></head><body><h1>Design Preview</h1><p>Preview page for tokens and typography.</p></body></html>`, "utf8");
  }
  writeJson(join(resolvedDir, "design-contract.json"), contract);
  writeJson(join(resolvedDir, "design-tokens.json"), contract.tokens ?? {});
  writeFileSync(join(resolvedDir, "tokens.css"), renderCss(contract.tokens ?? {}), "utf8");
  writeFileSync(join(resolvedDir, "DESIGN.md"), renderDesignMarkdown(contract), "utf8");
  const assets = { schemaVersion: 1, decision: contract.imagery?.decision, assets: contract.imagery?.assets ?? [] };
  if (!existsSync(join(resolvedDir, "assets", "manifest.json"))) writeJson(join(resolvedDir, "assets", "manifest.json"), assets);
  writeJson(join(resolvedDir, "provenance.json"), { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSystem: basename(dirname(originalDir || resolvedDir)), ...provenance });
  const audit = auditDesignPackage({ resolvedDir, contract });
  writeJson(join(resolvedDir, "design-audit.json"), audit);
  return audit;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) out._.push(item);
    else out[item.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? "audit";
  const resolvedDir = resolve(String(args.resolved ?? args.dir ?? "."));
  const result = command === "render"
    ? renderDesignPackage({ contractFile: resolve(String(args.contract)), originalDir: args.original ? resolve(String(args.original)) : null, resolvedDir })
    : auditDesignPackage({ resolvedDir });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : 1;
}
