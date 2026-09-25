/**
 * Pure renderers for the resolved design package. Every function takes the design-contract (v2) and
 * returns text; nothing reads the clock or the disk, so the same contract always renders the same bytes.
 * All visual output references tokens through var(--token): no hex literal, no fallback value.
 */
import { contrastRatio } from './color.mjs';
import { ALL_TOKENS, EXTENSION_SHARED_TOKENS, EXTENSION_THEME_TOKENS, SCHEMA_SHARED_TOKENS, SCHEMA_THEME_TOKENS, THEME_TOKENS, SHARED_TOKENS } from './token-mapper.mjs';

/** Core states every component declares. `focus` alone is not accepted: keyboard focus is `focus-visible`. */
export const REQUIRED_COMPONENT_STATES = ['default', 'hover', 'focus-visible', 'disabled'];
export const DEFAULT_COMPONENTS = ['Button', 'Input', 'Card', 'Badge', 'Alert', 'Modal'].map((name) => ({ name, states: [...REQUIRED_COMPONENT_STATES] }));
export const DESIGN_SECTIONS = [
  'Visual Theme & Atmosphere', 'Color Palette & Roles', 'Typography Rules', 'Component Stylings', 'Layout Principles',
  'Depth & Elevation', "Do's and Don'ts", 'Responsive Behavior', 'Agent Prompt Guide',
];
export const PREVIEW_PAGES = [
  { file: 'colors.html', role: 'colors', title: 'Colors' },
  { file: 'typography.html', role: 'typography', title: 'Typography' },
  { file: 'spacing.html', role: 'spacing', title: 'Spacing, radius and elevation' },
  { file: 'components.html', role: 'components', title: 'Components' },
  { file: 'app.html', role: 'app', title: 'Key screen' },
];

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bare = (name) => name.replace(/^--/, '');
const slug = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function orderedTokens(values, order) {
  const known = order.filter((name) => name in values);
  const extra = Object.keys(values).filter((name) => !order.includes(name)).sort();
  return [...known, ...extra];
}

export function themeNames(contract) {
  return ['light', 'dark'].filter((name) => contract.themes?.[name]);
}

/* ------------------------------------------------------------------ tokens.css */

function declarations(values, order, indent) {
  return orderedTokens(values, order).map((name) => `${indent}${name}: ${values[name]};`).join('\n');
}

export function renderTokensCss(contract) {
  const { themes, tokens } = contract;
  const parts = [
    `/* Generated from design-contract.json (sha256 ${contract.sha256 ?? 'unsigned'}). Do not edit. */`,
    `:root,\n[data-theme="light"] {\n  color-scheme: light;\n${declarations(themes.light, THEME_TOKENS, '  ')}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;\n${declarations(themes.dark, THEME_TOKENS, '    ')}\n  }\n}`,
    `[data-theme="dark"] {\n  color-scheme: dark;\n${declarations(themes.dark, THEME_TOKENS, '  ')}\n}`,
    `:root {\n${declarations(tokens, SHARED_TOKENS, '  ')}\n}`,
  ];
  if (themes.compact) parts.push(`[data-density="compact"] {\n${declarations(themes.compact, SHARED_TOKENS, '  ')}\n}`);
  parts.push('@media (prefers-reduced-motion: reduce) {\n  :root {\n    --motion-fast: 0ms;\n    --motion-base: 0ms;\n  }\n}');
  return `${parts.join('\n\n')}\n`;
}

/* ------------------------------------------------------------------ DTCG */

const DTCG_GROUPS = [
  [/^--(font)-(.+)$/, 'font', 'fontFamily'],
  [/^--text-(.+)$/, 'fontSize', 'dimension'],
  [/^--leading-(.+)$/, 'lineHeight', 'number'],
  [/^--tracking-(.+)$/, 'letterSpacing', 'dimension'],
  [/^--space-(.+)$/, 'space', 'dimension'],
  [/^--section-y-(.+)$/, 'sectionY', 'dimension'],
  [/^--radius-(.+)$/, 'radius', 'dimension'],
  [/^--elev-(.+)$/, 'shadow', 'shadow'],
  [/^--focus-ring$/, 'shadow', 'shadow', 'focus-ring'],
  [/^--motion-(.+)$/, 'duration', 'duration'],
  [/^--ease-(.+)$/, 'easing', 'cubicBezier'],
  [/^--container-(.+)$/, 'container', 'dimension'],
  [/^--border-width$/, 'size', 'dimension', 'border-width'],
  [/^--control-h(?:-(.+))?$/, 'size', 'dimension', 'control-height'],
];

function dtcgToken(name, value) {
  for (const [pattern, group, type, fixedKey] of DTCG_GROUPS) {
    const match = pattern.exec(name);
    if (!match) continue;
    let key = fixedKey ?? match[match.length - 1] ?? 'base';
    if (fixedKey === 'control-height') key = match[1] ? `control-height-${match[1]}` : 'control-height';
    let out = value;
    if (type === 'number') out = Number(value);
    if (type === 'cubicBezier') {
      const numbers = /^cubic-bezier\(([^)]+)\)$/.exec(String(value))?.[1].split(',').map((n) => Number(n.trim()));
      if (numbers?.length === 4 && numbers.every(Number.isFinite)) out = numbers;
    }
    if (type === 'fontFamily') out = String(value).split(',').map((part) => part.trim().replace(/^["']|["']$/g, ''));
    return { group, key, token: { $value: out, $type: type } };
  }
  return null;
}

export function renderDtcg(contract) {
  const doc = {
    $description: `${contract.systemId} design tokens (W3C DTCG). Generated from design-contract.json; the CSS names are the TOKEN_SCHEMA names without "--".`,
    $extensions: { 'com.pensador': { sha256: contract.sha256 ?? null, version: contract.version, engine: contract.engine, themes: themeNames(contract) } },
    color: {},
  };
  for (const theme of themeNames(contract)) {
    doc.color[theme] = {};
    for (const name of orderedTokens(contract.themes[theme], THEME_TOKENS)) doc.color[theme][bare(name)] = { $value: contract.themes[theme][name], $type: 'color' };
  }
  for (const name of orderedTokens(contract.tokens, SHARED_TOKENS)) {
    const mapped = dtcgToken(name, contract.tokens[name]);
    if (!mapped) continue;
    doc[mapped.group] ??= {};
    doc[mapped.group][mapped.key] = mapped.token;
  }
  if (contract.themes.compact) {
    doc.$extensions['com.pensador'].compact = Object.fromEntries(Object.entries(contract.themes.compact).map(([name, value]) => [bare(name), value]));
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/* ------------------------------------------------------------------ Tailwind v4 */

export function renderTailwind(contract) {
  const t = contract.tokens;
  const lines = [
    `/* Generated from design-contract.json (sha256 ${contract.sha256 ?? 'unsigned'}). Do not edit. */`,
    '@import "tailwindcss";',
    '@import "./tokens.css";',
    '',
    '@theme inline {',
    ...orderedTokens(contract.themes.light, THEME_TOKENS).map((name) => `  --color-${bare(name)}: var(${name});`),
    ...['--elev-flat', '--elev-ring', '--elev-raised'].filter((name) => name in t).map((name) => `  --shadow-${bare(name).replace('elev-', '')}: var(${name});`),
    '}',
    '',
    '@theme {',
    `  --spacing: ${t['--space-1']};`,
    ...orderedTokens(t, SHARED_TOKENS).filter((name) => /^--(font|text|radius|ease)-/.test(name)).map((name) => `  ${name}: ${t[name]};`),
    '}',
  ];
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ DESIGN.md */

function yamlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function yaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  return Object.entries(value).map(([key, item]) => {
    if (Array.isArray(item)) return `${pad}${yamlKey(key)}: [${item.map((entry) => JSON.stringify(entry)).join(', ')}]`;
    if (item && typeof item === 'object') return `${pad}${yamlKey(key)}:\n${yaml(item, indent + 1)}`;
    return `${pad}${yamlKey(key)}: ${JSON.stringify(item)}`;
  }).join('\n');
}

const stripDashes = (values) => Object.fromEntries(Object.entries(values).map(([name, value]) => [bare(name), value]));

export function designFrontMatter(contract) {
  const themes = themeNames(contract);
  const t = contract.tokens;
  const pick = (re) => Object.fromEntries(Object.entries(t).filter(([name]) => re.test(name)).map(([name, value]) => [bare(name).replace(/^(text|radius|space)-/, ''), value]));
  return {
    name: contract.systemId,
    version: contract.version,
    engine: `${contract.engine?.name ?? 'unknown'}@${contract.engine?.version ?? 'unknown'}`,
    contractSha256: contract.sha256 ?? null,
    themes,
    defaultTheme: contract.defaultTheme ?? 'system',
    colors: Object.fromEntries(themes.map((theme) => [theme, stripDashes(contract.themes[theme])])),
    typography: {
      display: { fontFamily: t['--font-display'], tracking: t['--tracking-display'], lineHeight: t['--leading-tight'] },
      body: { fontFamily: t['--font-body'], fontSize: t['--text-base'], lineHeight: t['--leading-body'] },
      mono: { fontFamily: t['--font-mono'] },
      scale: pick(/^--text-/),
    },
    rounded: pick(/^--radius-/),
    spacing: pick(/^--space-/),
    components: Object.fromEntries((contract.components ?? []).map((component) => [component.name, { states: component.states ?? [] }])),
  };
}

function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function pairRatio(contract, pair) {
  const values = contract.themes?.[pair.theme] ?? {};
  const ratio = contrastRatio(values[pair.foreground] ?? pair.foreground, values[pair.background] ?? pair.background);
  return ratio == null ? null : Math.round(ratio * 100) / 100;
}

export function renderDesignMarkdown(contract) {
  const t = contract.tokens;
  const themes = themeNames(contract);
  const prose = contract.rationale ?? {};
  const components = contract.components?.length ? contract.components : DEFAULT_COMPONENTS;
  const colorRows = orderedTokens(contract.themes.light, THEME_TOKENS).map((name) => [
    `\`${name}\``, ...themes.map((theme) => `\`${contract.themes[theme][name] ?? ''}\``),
    EXTENSION_THEME_TOKENS.includes(name) ? 'extension' : 'schema',
  ]);
  const ratios = (contract.contrastPairs ?? []).map((pair) => [pair.theme, `\`${pair.foreground}\` on \`${pair.background}\``, pair.kind ?? 'text', String(pair.minimum), String(pairRatio(contract, pair) ?? 'n/a')]);
  const scaleRows = SCHEMA_SHARED_TOKENS.filter((name) => name.startsWith('--text-')).map((name) => [`\`${name}\``, `\`${t[name]}\``]);
  const spaceRows = SCHEMA_SHARED_TOKENS.filter((name) => /^--(space|section-y|container)/.test(name)).map((name) => [`\`${name}\``, `\`${t[name]}\``]);
  const antiPatterns = (contract.antiPatterns ?? []).map((item) => `- ${item}`).join('\n') || '- (none declared)';
  const componentRows = components.map((component) => [component.name, (component.states ?? []).join(', ')]);
  const sections = [
    `## 1. ${DESIGN_SECTIONS[0]}\n\n${prose.theme ?? `${contract.systemId} ships one palette in two themes (${themes.join(' and ')}), derived from a single seed by the Open Design brand engine. Default theme: ${contract.defaultTheme ?? 'system'} (follows \`prefers-color-scheme\`).`}\n\nImagery decision: \`${contract.imagery?.decision ?? 'n/a'}\`. Icons: \`${contract.iconography?.package ?? 'n/a'}\` ${contract.iconography?.version ?? ''} (${contract.iconography?.format ?? 'vector'}).`,
    `## 2. ${DESIGN_SECTIONS[1]}\n\n${prose.colors ?? 'Use semantic tokens only; raw values below are the resolved result per theme.'}\n\n${table(['Token', ...themes, 'Layer'], colorRows)}\n\n### Contrast matrix (WCAG 2.2 AA)\n\n${table(['Theme', 'Pair', 'Kind', 'Minimum', 'Ratio'], ratios)}`,
    `## 3. ${DESIGN_SECTIONS[2]}\n\n${prose.typography ?? 'Body, display and mono stacks come from the brief; sizes follow the engine modular scale.'}\n\n- Display: \`${t['--font-display']}\`\n- Body: \`${t['--font-body']}\`\n- Mono: \`${t['--font-mono']}\`\n- Leading: body \`${t['--leading-body']}\`, tight \`${t['--leading-tight']}\`; display tracking \`${t['--tracking-display']}\`\n\n${table(['Token', 'Value'], scaleRows)}`,
    `## 4. ${DESIGN_SECTIONS[3]}\n\n${prose.components ?? 'Every component is styled through tokens and must implement each listed state.'}\n\n${table(['Component', 'States'], componentRows)}\n\nIconography: functional icons use \`${contract.iconography?.package ?? 'n/a'}\`; emoji never replaces an icon.`,
    `## 5. ${DESIGN_SECTIONS[4]}\n\n${prose.layout ?? 'Spacing follows the seed size unit; page sections use the section rhythm tokens.'}\n\n${table(['Token', 'Value'], spaceRows)}\n\nControl heights: \`${t['--control-h-sm']}\` / \`${t['--control-h']}\` / \`${t['--control-h-lg']}\`.${contract.themes.compact ? ' Compact density is available with `data-density="compact"`.' : ''}`,
    `## 6. ${DESIGN_SECTIONS[5]}\n\n${prose.depth ?? 'Flat by default; a hairline ring separates surfaces and a soft shadow lifts overlays.'}\n\n- \`--elev-flat\`: \`${t['--elev-flat']}\`\n- \`--elev-ring\`: \`${t['--elev-ring']}\`\n- \`--elev-raised\`: \`${t['--elev-raised']}\`\n- \`--focus-ring\`: \`${t['--focus-ring']}\`\n- Motion: \`${t['--motion-fast']}\` / \`${t['--motion-base']}\`, easing \`${t['--ease-standard']}\`; disabled under \`prefers-reduced-motion\`.`,
    `## 7. ${DESIGN_SECTIONS[6]}\n\n**Do**\n\n- Reference tokens with \`var(--token)\`; use the \`*-text\` variants for semantic colors used as text.\n- Keep the focus ring visible on every interactive element.\n- Test both themes before shipping a screen.\n\n**Don't**\n\n${antiPatterns}\n- Never hard-code a hex, rgb or oklch literal, or a px value that has a token.\n- Never use \`--border\` as the only boundary of an input; use \`--border-strong\`.`,
    `## 8. ${DESIGN_SECTIONS[7]}\n\n${prose.responsive ?? 'Container and section rhythm shrink by breakpoint through the tokens below.'}\n\n${table(['Token', 'Value'], ['--container-max', '--container-gutter-desktop', '--container-gutter-tablet', '--container-gutter-phone', '--section-y-desktop', '--section-y-tablet', '--section-y-phone'].map((name) => [`\`${name}\``, `\`${t[name]}\``]))}`,
    `## 9. ${DESIGN_SECTIONS[8]}\n\n${prose.agentGuide ?? `Implement UI with \`tokens.css\` from this package. Precedence: \`design-contract.json\` and \`tokens.css\` > \`components.html\` > this prose. Do not invent tokens: a token that is missing requires a new Pensador version.`}\n\n- Files: \`tokens.css\`, \`design-tokens.json\` (DTCG), \`tailwind-v4.css\`, \`components.html\`, \`preview/\`.\n- Theme switch: set \`data-theme="light|dark"\` on \`<html>\`; without it the system preference applies.`,
  ];
  return `---\n${yaml(designFrontMatter(contract))}\n---\n\n# ${contract.systemId} — Resolved Design System\n\nGenerated from the authoritative \`design-contract.json\`. The front matter is normative; the prose explains it.\n\n${sections.join('\n\n')}\n`;
}

/* ------------------------------------------------------------------ CSS shared by components and previews */

// Preview scaffolding (.page, .scope, .grid, .swatch, .app...) is NOT product CSS: `.grid` here is a
// flex row and would override Tailwind's `grid` utility. It stays in preview.css / components.html only.
const PREVIEW_SCAFFOLD_HEAD = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: var(--text-base)/var(--leading-body) var(--font-body); }
h1, h2, h3 { font-family: var(--font-display); line-height: var(--leading-tight); letter-spacing: var(--tracking-display); margin: 0 0 var(--space-3); }
h1 { font-size: var(--text-3xl); } h2 { font-size: var(--text-xl); } h3 { font-size: var(--text-lg); }
a { color: var(--info-text); }
code { font-family: var(--font-mono); font-size: var(--text-sm); }
.page { max-width: var(--container-max); margin: 0 auto; padding: var(--space-8) var(--container-gutter-desktop); }
.scope { background: var(--bg); color: var(--fg); padding: var(--space-6); border: var(--border-width) solid var(--border); border-radius: var(--radius-md); margin-bottom: var(--space-6); }
.scope > h2 { color: var(--muted); font-size: var(--text-sm); text-transform: uppercase; }
.grid { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.state { display: flex; flex-direction: column; gap: var(--space-2); }
.state-label { font-size: var(--text-xs); color: var(--muted); text-transform: uppercase; }
.swatch { width: 9rem; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); box-shadow: var(--elev-ring); }
.swatch i { display: block; height: var(--space-12); }
.swatch span { display: block; padding: var(--space-2); font-size: var(--text-xs); color: var(--muted); }
`;

/**
 * Product component rules (.btn, .input, .card, .badge, .alert, .modal and their states) — the part
 * of the preview CSS an application must import. Published as components.css: a real run shipped a
 * front-end whose Button/Card/Input/Badge/Dialog had no styles in the final bundle because these rules
 * lived only inside components.html and preview/preview.css (OficinaAI, 2026-09-22).
 */
export function componentCss() {
  return `.btn { min-height: var(--control-h); padding: 0 var(--space-4); border: var(--border-width) solid transparent; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-on); font: 600 var(--text-sm)/1 var(--font-body); cursor: pointer; transition: background var(--motion-fast) var(--ease-standard); }
.btn:hover, .btn.state-hover { background: var(--accent-hover); }
.btn:active, .btn.state-active { background: var(--accent-active); }
.btn:focus-visible, .btn.state-focus, .btn.state-focus-visible { outline: none; box-shadow: var(--focus-ring); }
.btn:disabled, .btn.state-disabled { opacity: 0.5; cursor: not-allowed; }
.btn.state-loading { opacity: 0.75; cursor: progress; }
.btn.state-error { background: var(--danger); }
.btn.secondary { background: var(--surface); color: var(--fg); border-color: var(--border-strong); }
.input { min-height: var(--control-h); padding: 0 var(--space-3); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: var(--text-base) var(--font-body); }
.input:hover, .input.state-hover { border-color: var(--fg-2); }
.input:focus-visible, .input.state-focus, .input.state-focus-visible { outline: none; box-shadow: var(--focus-ring); }
.input:disabled, .input.state-disabled { opacity: 0.5; cursor: not-allowed; }
.input.state-error { border-color: var(--danger-text); }
.field-error { color: var(--danger-text); font-size: var(--text-sm); }
.card { padding: var(--space-4); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--elev-ring); }
.card.state-hover { box-shadow: var(--elev-raised); }
.card.state-focus, .card.state-focus-visible { box-shadow: var(--focus-ring); }
.card.state-disabled { opacity: 0.5; }
.card.state-empty { color: var(--muted); border: var(--border-width) dashed var(--border-strong); box-shadow: none; }
.badge { display: inline-flex; align-items: center; min-height: var(--space-6); padding: 0 var(--space-3); border-radius: var(--radius-pill); background: var(--surface-warm); color: var(--fg-2); font-size: var(--text-xs); font-weight: 600; box-shadow: var(--elev-ring); }
.badge.state-hover { background: var(--border-soft); }
.badge.state-focus, .badge.state-focus-visible { box-shadow: var(--focus-ring); }
.badge.state-disabled { opacity: 0.5; }
.badge.ok { color: var(--success-text); } .badge.warn { color: var(--warn-text); } .badge.bad { color: var(--danger-text); } .badge.info { color: var(--info-text); }
.alert { padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); background: var(--surface); border: var(--border-width) solid var(--border); border-left: var(--space-1) solid var(--info); }
.alert.state-error { border-left-color: var(--danger); color: var(--danger-text); }
.alert.state-focus, .alert.state-focus-visible { box-shadow: var(--focus-ring); }
.alert.state-disabled { opacity: 0.5; }
.modal { min-width: 16rem; padding: var(--space-5); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--elev-raised); }
.modal.state-disabled { opacity: 0.5; }
.modal.state-focus, .modal.state-focus-visible { box-shadow: var(--focus-ring); }
${EXTENDED_COMPONENT_CSS}`;
}

/** Rules for every kind beyond the original six (see componentKind). Tokens only; px only as 0. */
const EXTENDED_COMPONENT_CSS = `.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: var(--control-h); height: var(--control-h); padding: 0; border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; transition: background var(--motion-fast) var(--ease-standard); }
.icon-btn:hover, .icon-btn.state-hover { background: var(--surface-warm); }
.icon-btn:active, .icon-btn.state-active, .icon-btn[aria-current="page"] { background: var(--border-soft); }
.icon-btn:focus-visible, .icon-btn.state-focus, .icon-btn.state-focus-visible { outline: none; box-shadow: var(--focus-ring); }
.icon-btn:disabled, .icon-btn.state-disabled { opacity: 0.5; cursor: not-allowed; }
.icon-btn.state-loading { opacity: 0.75; cursor: progress; }
.textarea, .select { width: 100%; min-height: var(--control-h); padding: var(--space-2) var(--space-3); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: var(--text-base)/var(--leading-body) var(--font-body); }
.textarea { min-height: calc(var(--control-h) * 2.5); resize: vertical; }
.select { appearance: none; padding-right: var(--space-8); background-image: linear-gradient(45deg, transparent 50%, var(--fg-2) 50%), linear-gradient(135deg, var(--fg-2) 50%, transparent 50%); background-position: calc(100% - var(--space-4)) 50%, calc(100% - var(--space-3)) 50%; background-size: var(--space-1) var(--space-1); background-repeat: no-repeat; cursor: pointer; }
.textarea:hover, .textarea.state-hover, .select:hover, .select.state-hover { border-color: var(--fg-2); }
.textarea:focus-visible, .textarea.state-focus, .textarea.state-focus-visible, .select:focus-visible, .select.state-focus, .select.state-focus-visible, .select.state-open, .select.state-active { outline: none; box-shadow: var(--focus-ring); }
.textarea:disabled, .textarea.state-disabled, .select:disabled, .select.state-disabled { opacity: 0.5; cursor: not-allowed; }
.textarea.state-error, .select.state-error { border-color: var(--danger-text); }
.field { display: grid; gap: var(--space-1); }
.field-label { color: var(--fg); font: 600 var(--text-sm)/var(--leading-tight) var(--font-body); }
.field-hint { color: var(--muted); font-size: var(--text-xs); }
.field.state-error .field-label { color: var(--danger-text); }
.field.state-hover .input { border-color: var(--fg-2); }
.field.state-focus .input, .field.state-focus-visible .input { box-shadow: var(--focus-ring); }
.field.state-disabled { opacity: 0.5; }
.checkbox, .radio { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--fg); font-size: var(--text-sm); cursor: pointer; }
.checkbox input, .radio input { width: var(--space-4); height: var(--space-4); margin: 0; accent-color: var(--accent); }
.checkbox:hover input, .checkbox.state-hover input, .radio:hover input, .radio.state-hover input { outline: var(--border-width) solid var(--border-strong); }
.checkbox input:focus-visible, .checkbox.state-focus input, .checkbox.state-focus-visible input, .radio input:focus-visible, .radio.state-focus input, .radio.state-focus-visible input { outline: none; box-shadow: var(--focus-ring); }
.checkbox.state-disabled, .radio.state-disabled { opacity: 0.5; cursor: not-allowed; }
.checkbox.state-error, .radio.state-error { color: var(--danger-text); }
.switch { display: inline-flex; align-items: center; width: calc(var(--space-8) + var(--space-2)); height: var(--space-6); padding: 0 var(--space-1); border: 0; border-radius: var(--radius-pill); background: var(--border-strong); cursor: pointer; transition: background var(--motion-fast) var(--ease-standard); }
.switch::after { content: ""; width: var(--space-4); height: var(--space-4); border-radius: var(--radius-pill); background: var(--surface); box-shadow: var(--elev-ring); transition: transform var(--motion-fast) var(--ease-standard); }
.switch:not([aria-checked="true"]):hover, .switch.state-hover { background: var(--fg-2); }
.switch[aria-checked="true"], .switch.state-checked { background: var(--accent); }
.switch[aria-checked="true"]::after, .switch.state-checked::after { transform: translateX(var(--space-4)); }
.switch:focus-visible, .switch.state-focus, .switch.state-focus-visible { outline: none; box-shadow: var(--focus-ring); }
.switch:disabled, .switch.state-disabled { opacity: 0.5; cursor: not-allowed; }
.card.state-active { box-shadow: var(--elev-flat); }
.card[aria-selected="true"], .card.state-selected { box-shadow: 0 0 0 var(--border-width) var(--accent), var(--elev-raised); }
.carousel { display: flex; gap: var(--space-4); overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: var(--space-2); }
.carousel > * { flex: 0 0 auto; min-width: 12rem; scroll-snap-align: start; }
.carousel:hover, .carousel.state-hover { scrollbar-color: var(--border-strong) transparent; }
.table { width: 100%; border-collapse: collapse; background: var(--surface); color: var(--fg); font-size: var(--text-sm); }
.table th, .table td { padding: var(--space-2) var(--space-3); border-bottom: var(--border-width) solid var(--border); text-align: left; }
.table th { background: var(--surface-warm); color: var(--fg-2); font-weight: 600; }
.table tbody tr:hover, .table.state-hover tbody tr:first-child { background: var(--surface-warm); }
.table tbody tr[aria-selected="true"] { background: var(--border-soft); }
.table.state-loading { opacity: 0.6; cursor: progress; }
.table-empty { padding: var(--space-6); color: var(--muted); text-align: center; }
.tabs { display: flex; gap: var(--space-1); border-bottom: var(--border-width) solid var(--border); }
.tab { padding: var(--space-2) var(--space-4); border: 0; border-bottom: calc(var(--border-width) * 2) solid transparent; background: transparent; color: var(--fg-2); font: 600 var(--text-sm)/1 var(--font-body); cursor: pointer; }
.tab:hover, .tabs.state-hover .tab:first-child { color: var(--fg); }
.tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
.tab:focus-visible, .tabs.state-focus .tab:first-child, .tabs.state-focus-visible .tab:first-child { outline: none; box-shadow: var(--focus-ring); }
.tab:disabled, .tabs.state-disabled .tab { opacity: 0.5; cursor: not-allowed; }
.toast { display: flex; align-items: center; gap: var(--space-3); min-width: 16rem; max-width: 24rem; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--fg); color: var(--bg); box-shadow: var(--elev-raised); font-size: var(--text-sm); transition: opacity var(--motion-base) var(--ease-standard), transform var(--motion-base) var(--ease-standard); }
.toast.error { border-left: var(--space-1) solid var(--danger); }
.toast.state-visible { opacity: 1; transform: none; }
.toast.state-exiting { opacity: 0; transform: translateY(var(--space-2)); }
.sidebar { display: flex; flex-direction: column; gap: var(--space-1); width: 16rem; padding: var(--space-4) var(--space-3); background: var(--surface); border-right: var(--border-width) solid var(--border); }
.sidebar.state-collapsed { width: calc(var(--control-h) + var(--space-6)); overflow: hidden; }
.sidebar.state-expanded { width: 16rem; }
.topnav { display: flex; align-items: center; gap: var(--space-4); min-height: calc(var(--control-h) + var(--space-4)); padding: 0 var(--space-4); background: var(--surface); border-bottom: var(--border-width) solid var(--border); }
.topnav.state-scrolled { border-bottom-color: transparent; box-shadow: var(--elev-raised); }
.nav-item { display: flex; align-items: center; gap: var(--space-2); min-height: var(--control-h); padding: 0 var(--space-3); border-radius: var(--radius-sm); color: var(--fg-2); font-size: var(--text-sm); text-decoration: none; }
.nav-item:hover, .sidebar.state-hover .nav-item:last-child, .topnav.state-hover .nav-item:last-child { background: var(--surface-warm); color: var(--fg); }
.nav-item[aria-current="page"], .nav-item.state-active { background: var(--border-soft); color: var(--fg); font-weight: 600; }
.nav-item:focus-visible, .sidebar.state-focus .nav-item:first-child, .sidebar.state-focus-visible .nav-item:first-child, .topnav.state-focus .nav-item:first-child, .topnav.state-focus-visible .nav-item:first-child { outline: none; box-shadow: var(--focus-ring); }
.empty-state { display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-8) var(--space-4); border: var(--border-width) dashed var(--border-strong); border-radius: var(--radius-md); color: var(--muted); text-align: center; }
.empty-state h3 { color: var(--fg); }
.empty-state.state-hover { border-color: var(--fg-2); }
.skeleton { display: block; min-height: var(--space-4); border-radius: var(--radius-sm); background: linear-gradient(90deg, var(--surface-warm) 25%, var(--border-soft) 50%, var(--surface-warm) 75%); background-size: 200% 100%; animation: skeleton-pulse 1.4s ease-in-out infinite; }
@keyframes skeleton-pulse { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.stepper { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); margin: 0; padding: 0; list-style: none; counter-reset: step; }
.step { display: flex; align-items: center; gap: var(--space-2); color: var(--muted); font-size: var(--text-sm); }
.step::before { counter-increment: step; content: counter(step); display: inline-grid; place-items: center; width: var(--space-6); height: var(--space-6); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius-pill); background: var(--surface); color: var(--fg-2); font-weight: 600; }
.step[aria-current="step"], .step.state-active { color: var(--fg); }
.step[aria-current="step"]::before, .step.state-active::before { border-color: var(--accent); background: var(--accent); color: var(--accent-on); }
.step.state-completed { color: var(--fg-2); }
.step.state-completed::before { border-color: var(--success); background: var(--surface-warm); color: var(--success-text); }
.stepper.state-hover .step:first-child { color: var(--fg); }
.tooltip { display: inline-block; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--fg); color: var(--bg); font-size: var(--text-xs); box-shadow: var(--elev-raised); }
.avatar { display: inline-grid; place-items: center; width: var(--control-h); height: var(--control-h); overflow: hidden; border-radius: var(--radius-pill); background: var(--surface-warm); color: var(--fg-2); font-weight: 600; box-shadow: var(--elev-ring); }
.pagination { display: flex; gap: var(--space-1); }
.breadcrumb { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); color: var(--muted); font-size: var(--text-sm); }
.breadcrumb a { color: var(--fg-2); }
.breadcrumb [aria-current="page"] { color: var(--fg); font-weight: 600; }
.progress { width: 100%; height: var(--space-2); overflow: hidden; border-radius: var(--radius-pill); background: var(--border-soft); }
.progress > span { display: block; height: 100%; background: var(--accent); }
.spinner { display: inline-block; width: var(--space-6); height: var(--space-6); border: calc(var(--border-width) * 2) solid var(--border-soft); border-top-color: var(--accent); border-radius: var(--radius-pill); animation: spinner-rotate 0.8s linear infinite; }
@keyframes spinner-rotate { to { transform: rotate(360deg); } }
.accordion { border: var(--border-width) solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.accordion > summary { padding: var(--space-3) var(--space-4); color: var(--fg); font-weight: 600; cursor: pointer; }
.accordion > :not(summary) { margin: 0; padding: 0 var(--space-4) var(--space-3); color: var(--fg-2); }
.menu { display: grid; min-width: 12rem; padding: var(--space-1); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--elev-raised); }
.menu-item { min-height: var(--control-h); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg); text-align: left; font: var(--text-sm) var(--font-body); cursor: pointer; }
.menu-item:hover, .menu.state-hover .menu-item:first-child { background: var(--surface-warm); }
.menu-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
:is(.carousel, .table, .toast, .sidebar, .topnav, .empty-state, .skeleton, .stepper, .tooltip, .avatar, .pagination, .breadcrumb, .progress, .spinner, .accordion, .menu):is(:focus-visible, .state-focus, .state-focus-visible) { outline: none; box-shadow: var(--focus-ring); }
:is(.carousel, .table, .toast, .sidebar, .topnav, .empty-state, .skeleton, .stepper, .tooltip, .avatar, .pagination, .breadcrumb, .progress, .spinner, .accordion, .menu).state-disabled { opacity: 0.5; pointer-events: none; }
:is(.avatar, .tooltip, .progress, .spinner, .accordion, .pagination, .breadcrumb).state-hover { filter: brightness(0.97); }
@media (prefers-reduced-motion: reduce) { .skeleton, .spinner { animation: none; } .toast, .switch, .switch::after { transition: none; } }
`;

const PREVIEW_SCAFFOLD_TAIL = `.component { padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring); }
.component.state-disabled { opacity: 0.5; }
.component.state-focus, .component.state-focus-visible { box-shadow: var(--focus-ring); }
.app { display: grid; grid-template-columns: 12rem 1fr; min-height: 22rem; background: var(--bg); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--elev-ring); }
.app nav { background: var(--surface); padding: var(--space-4); border-right: var(--border-width) solid var(--border); display: flex; flex-direction: column; gap: var(--space-2); }
.app nav a { color: var(--fg-2); text-decoration: none; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); }
.app nav a[aria-current="page"] { background: var(--accent); color: var(--accent-on); }
.app main { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-4); }
.stat strong { display: block; font-family: var(--font-display); font-size: var(--text-2xl); }
.stat span { color: var(--muted); font-size: var(--text-sm); }
.row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: var(--border-width) solid var(--border-soft); }
.bar { height: var(--space-4); border-radius: var(--radius-pill); background: var(--accent); }
.demo { background: var(--surface); box-shadow: var(--elev-ring); padding: var(--space-4); border-radius: var(--radius-md); margin-bottom: var(--space-3); }
@media (max-width: 720px) { .app { grid-template-columns: 1fr; } .page { padding: var(--space-6) var(--container-gutter-phone); } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export function baseCss() {
  return `${PREVIEW_SCAFFOLD_HEAD}${componentCss()}${PREVIEW_SCAFFOLD_TAIL}`;
}

/* ------------------------------------------------------------------ components */

/**
 * Component name -> styled kind. Exact names first (English and Portuguese, with or without
 * separators), then suffix rules so product-specific names (ServiceCard, StatusPill, PhoneInput)
 * inherit the rules of their base kind. A name that matches nothing stays `generic`: it is
 * declared in the contract but has no product CSS, and the audit reports it (componentCoverage).
 * Audit finding: a real contract (OficinaAI, 2026-09) declared 24 components and only 6 had rules;
 * the other 18 rendered as one grey placeholder and the audit still said PASS.
 */
const COMPONENT_KIND_BY_NAME = {
  button: 'button', botao: 'button',
  iconbutton: 'icon-button', botaoicone: 'icon-button', botaodeicone: 'icon-button',
  input: 'input', campo: 'input', campodetexto: 'input', textfield: 'input',
  textarea: 'textarea', areadetexto: 'textarea',
  select: 'select', selecao: 'select', combobox: 'select', dropdown: 'select', seletor: 'select',
  formfield: 'field', field: 'field', campodeformulario: 'field',
  checkbox: 'checkbox', caixadeselecao: 'checkbox',
  radio: 'radio', radiobutton: 'radio', radiogroup: 'radio',
  switch: 'switch', toggle: 'switch', interruptor: 'switch',
  card: 'card', cartao: 'card',
  carousel: 'carousel', carrossel: 'carousel',
  badge: 'badge', selo: 'badge', pill: 'badge', chip: 'badge', tag: 'badge',
  alert: 'alert', alerta: 'alert', banner: 'alert', aviso: 'alert',
  modal: 'modal', dialog: 'modal', dialogo: 'modal', drawer: 'modal',
  table: 'table', tabela: 'table', datatable: 'table', datagrid: 'table',
  tabs: 'tabs', tab: 'tabs', abas: 'tabs',
  toast: 'toast', snackbar: 'toast', notificacao: 'toast',
  sidebar: 'sidebar', sidenav: 'sidebar', barralateral: 'sidebar', menulateral: 'sidebar',
  topnav: 'topnav', navbar: 'topnav', header: 'topnav', appbar: 'topnav', cabecalho: 'topnav',
  emptystate: 'empty-state', estadovazio: 'empty-state',
  skeleton: 'skeleton', esqueleto: 'skeleton',
  stepper: 'stepper', steps: 'stepper', etapas: 'stepper', wizard: 'stepper',
  tooltip: 'tooltip', dica: 'tooltip',
  avatar: 'avatar',
  pagination: 'pagination', paginacao: 'pagination',
  breadcrumb: 'breadcrumb', breadcrumbs: 'breadcrumb', trilha: 'breadcrumb',
  progress: 'progress', progressbar: 'progress', progresso: 'progress',
  spinner: 'spinner', loader: 'spinner', carregando: 'spinner',
  accordion: 'accordion', acordeao: 'accordion', collapse: 'accordion',
  menu: 'menu', dropdownmenu: 'menu', contextmenu: 'menu',
};
const COMPONENT_KIND_SUFFIXES = [
  ['iconbutton', 'icon-button'], ['button', 'button'], ['botao', 'button'],
  ['textarea', 'textarea'], ['input', 'input'], ['field', 'field'], ['select', 'select'],
  ['card', 'card'], ['cartao', 'card'], ['pill', 'badge'], ['badge', 'badge'], ['chip', 'badge'], ['tag', 'badge'],
  ['alert', 'alert'], ['banner', 'alert'], ['modal', 'modal'], ['dialog', 'modal'], ['drawer', 'modal'],
  ['table', 'table'], ['tabela', 'table'], ['tabs', 'tabs'], ['toast', 'toast'], ['nav', 'topnav'], ['navbar', 'topnav'],
  ['header', 'topnav'], ['sidebar', 'sidebar'], ['menu', 'menu'], ['stepper', 'stepper'], ['carousel', 'carousel'],
  ['skeleton', 'skeleton'], ['avatar', 'avatar'], ['tooltip', 'tooltip'], ['spinner', 'spinner'], ['progress', 'progress'],
];

/** The styled kind of a contract component (`generic` when no product rule applies). */
export function componentKind(name) {
  const compact = slug(name).replace(/-/g, '');
  if (COMPONENT_KIND_BY_NAME[compact]) return COMPONENT_KIND_BY_NAME[compact];
  for (const [suffix, kind] of COMPONENT_KIND_SUFFIXES) if (compact.endsWith(suffix)) return kind;
  return 'generic';
}

function fixture(component, state) {
  const kind = componentKind(component.name);
  const cls = `state-${state}`;
  const disabled = state === 'disabled' ? ' disabled' : '';
  const label = esc(component.name);
  const st = esc(state);
  const on = ['checked', 'selected', 'active', 'open', 'expanded', 'completed'].includes(state);
  switch (kind) {
    case 'button': return `<button type="button" class="btn ${cls}"${disabled}>${label} (${st})</button>`;
    case 'icon-button': return `<button type="button" class="icon-btn ${cls}" aria-label="${label} ${st}"${disabled}><span aria-hidden="true">+</span></button>`;
    case 'input': return `<input type="text" class="input ${cls}" aria-label="${label} ${st}" value="${state === 'empty' ? '' : st}" placeholder="${label}"${disabled}>${state === 'error' ? '<span class="field-error">Required field</span>' : ''}`;
    case 'textarea': return `<textarea class="textarea ${cls}" aria-label="${label} ${st}" placeholder="${label}"${disabled}>${state === 'empty' ? '' : st}</textarea>${state === 'error' ? '<span class="field-error">Required field</span>' : ''}`;
    case 'select': return `<select class="select ${cls}" aria-label="${label} ${st}"${disabled}><option>${label} (${st})</option><option>Option 2</option></select>${state === 'error' ? '<span class="field-error">Choose an option</span>' : ''}`;
    case 'field': return `<div class="field ${cls}"><label class="field-label">${label}</label><input type="text" class="input${state === 'error' ? ' state-error' : ''}" aria-label="${label} ${st}"${disabled}><span class="${state === 'error' ? 'field-error' : 'field-hint'}">${state === 'error' ? 'Required field' : 'Helper text'}</span></div>`;
    case 'checkbox': return `<label class="checkbox ${cls}"><input type="checkbox"${state === 'checked' ? ' checked' : ''}${disabled}> ${label} (${st})</label>`;
    case 'radio': return `<label class="radio ${cls}"><input type="radio" name="r-${slug(component.name)}-${st}"${state === 'checked' ? ' checked' : ''}${disabled}> ${label} (${st})</label>`;
    case 'switch': return `<button type="button" role="switch" class="switch ${cls}" aria-checked="${on}" aria-label="${label} ${st}"${disabled}></button>`;
    case 'card': return `<div class="card ${cls}"${state === 'selected' ? ' aria-selected="true"' : ''}><h3>${label}</h3><p>${state === 'empty' ? 'Nothing here yet' : `State: ${st}`}</p></div>`;
    case 'carousel': return `<div class="carousel ${cls}" tabindex="0" aria-label="${label} ${st}"><div class="card">1</div><div class="card">2</div><div class="card">3</div></div>`;
    case 'badge': return `<span class="badge ${cls}">${label} (${st})</span>`;
    case 'alert': return `<div class="alert ${cls}" role="status">${label} (${st})</div>`;
    case 'modal': return `<div class="modal ${cls}" role="dialog" aria-label="${label}"><h3>${label}</h3><p>State: ${st}</p></div>`;
    case 'table': return `<table class="table ${cls}" aria-label="${label} ${st}"><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody>${state === 'empty' ? '<tr><td class="table-empty" colspan="2">No records yet</td></tr>' : `<tr${state === 'active' ? ' aria-selected="true"' : ''}><td>${label}</td><td>${st}</td></tr><tr><td>Row 2</td><td>ok</td></tr>`}</tbody></table>`;
    case 'tabs': return `<div class="tabs ${cls}" role="tablist" aria-label="${label} ${st}"><button type="button" role="tab" class="tab" aria-selected="${on || state === 'default'}"${disabled}>${label}</button><button type="button" role="tab" class="tab" aria-selected="false"${disabled}>Second</button></div>`;
    case 'toast': return `<div class="toast ${cls}" role="status">${label} (${st})</div>`;
    case 'sidebar': return `<nav class="sidebar ${cls}" aria-label="${label} ${st}"><a class="nav-item" aria-current="page" href="#">Dashboard</a><a class="nav-item" href="#">${label}</a></nav>`;
    case 'topnav': return `<header class="topnav ${cls}"><strong>${label}</strong><a class="nav-item" aria-current="page" href="#">Home</a><a class="nav-item" href="#">${st}</a></header>`;
    case 'empty-state': return `<div class="empty-state ${cls}"><h3>${label}</h3><p>Nothing here yet (${st})</p><button type="button" class="btn">Create</button></div>`;
    case 'skeleton': return `<div class="skeleton ${cls}" aria-busy="true" aria-label="${label} ${st}"></div>`;
    case 'stepper': return `<ol class="stepper ${cls}" aria-label="${label} ${st}"><li class="step state-completed">Done</li><li class="step${state === 'completed' ? ' state-completed' : ''}" aria-current="step">${label}</li><li class="step">Next</li></ol>`;
    case 'tooltip': return `<span class="tooltip ${cls}" role="tooltip">${label} (${st})</span>`;
    case 'avatar': return `<span class="avatar ${cls}" aria-label="${label} ${st}">AB</span>`;
    case 'pagination': return `<nav class="pagination ${cls}" aria-label="${label} ${st}"><button type="button" class="icon-btn"${disabled}>1</button><button type="button" class="icon-btn" aria-current="page"${disabled}>2</button><button type="button" class="icon-btn"${disabled}>3</button></nav>`;
    case 'breadcrumb': return `<nav class="breadcrumb ${cls}" aria-label="${label} ${st}"><a href="#">Home</a><span aria-hidden="true">/</span><span aria-current="page">${label}</span></nav>`;
    case 'progress': return `<div class="progress ${cls}" role="progressbar" aria-label="${label} ${st}" aria-valuenow="60" aria-valuemin="0" aria-valuemax="100"><span style="width: 60%"></span></div>`;
    case 'spinner': return `<span class="spinner ${cls}" role="status" aria-label="${label} ${st}"></span>`;
    case 'accordion': return `<details class="accordion ${cls}"${on ? ' open' : ''}><summary>${label} (${st})</summary><p>Content</p></details>`;
    case 'menu': return `<div class="menu ${cls}" role="menu" aria-label="${label} ${st}"><button type="button" role="menuitem" class="menu-item"${disabled}>${label}</button><button type="button" role="menuitem" class="menu-item"${disabled}>Second</button></div>`;
    default: return `<div class="component ${cls}"><span>${label} [${st}]</span></div>`;
  }
}

function componentSections(contract) {
  const components = contract.components?.length ? contract.components : DEFAULT_COMPONENTS;
  return components.map((component) => {
    const states = component.states?.length ? component.states : REQUIRED_COMPONENT_STATES;
    const blocks = states.map((state) => `<div class="state"><span class="state-label">${esc(state)}</span>${fixture(component, state)}</div>`).join('\n      ');
    return `  <section id="component-${slug(component.name)}">\n    <h3>${esc(component.name)}</h3>\n    <div class="grid">\n      ${blocks}\n    </div>\n  </section>`;
  }).join('\n');
}

function themeScopes(contract, body) {
  return themeNames(contract).map((theme) => `<section class="scope" data-theme="${theme}">\n<h2>${theme} theme</h2>\n${body}\n</section>`).join('\n');
}

function htmlPage({ contract, title, css, cssHref, body, cssRel = './tokens.css' }) {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${esc(title)} — ${esc(contract.systemId)}</title>\n  <link rel="stylesheet" href="${cssRel}">\n${cssHref ? `  <link rel="stylesheet" href="${cssHref}">\n` : `  <style>\n${css}  </style>\n`}</head>\n<body>\n<div class="page">\n<h1>${esc(title)}</h1>\n${body}\n</div>\n</body>\n</html>\n`;
}

/**
 * Which contract components have dedicated product CSS in components.css and which only get the
 * generic `.component` preview placeholder. The generic ones are declared (name + states) but not
 * designed yet: the implementer must build them from tokens, and the orchestrator should know it.
 */
export function componentStyleCoverage(contract) {
  const components = contract.components?.length ? contract.components : DEFAULT_COMPONENTS;
  const styled = [];
  const generic = [];
  for (const component of components) {
    (componentKind(component.name) === 'generic' ? generic : styled).push(component.name);
  }
  return { styled, generic };
}

/** Every product class components.css defines (listed in its header and in USAGE.md). */
export const COMPONENT_CLASSES = [
  '.btn', '.icon-btn', '.input', '.textarea', '.select', '.field', '.field-label', '.field-hint', '.field-error', '.checkbox',
  '.radio', '.switch', '.card', '.carousel', '.badge', '.alert', '.modal', '.table', '.tabs', '.tab', '.toast', '.sidebar',
  '.topnav', '.nav-item', '.empty-state', '.skeleton', '.stepper', '.step', '.tooltip', '.avatar', '.pagination',
  '.breadcrumb', '.progress', '.spinner', '.accordion', '.menu', '.menu-item',
];

/** components.css (package root): the importable product component rules, nothing from the preview. */
export function renderComponentsCss(contract) {
  const { styled, generic } = componentStyleCoverage(contract);
  const note = generic.length
    ? ` * Without dedicated rules (build them from tokens, never from preview scaffolding): ${generic.join(', ')}.\n`
    : '';
  return `/*\n * ${contract.systemId} component styles · contract ${contract.sha256 ?? 'unsigned'}\n * Import after tokens.css. Classes: ${COMPONENT_CLASSES.join(' ')} + state-* modifiers.\n * Styled components: ${styled.join(', ') || 'none'}.\n${note} */\n${componentCss()}`;
}

/** components.html (package root): all components, all states, both themes, straight from the contract. */
export function renderComponentsHtml(contract) {
  return htmlPage({ contract, title: 'Component fixtures', css: baseCss(), body: themeScopes(contract, componentSections(contract)) });
}

/* ------------------------------------------------------------------ preview pages */

function colorsBody(contract) {
  return themeNames(contract).map((theme) => {
    const values = contract.themes[theme];
    const swatches = orderedTokens(values, THEME_TOKENS).map((name) => `<div class="swatch"><i style="background: var(${name})"></i><span><code>${esc(name)}</code><br>${esc(values[name])}</span></div>`).join('\n');
    const rows = (contract.contrastPairs ?? []).filter((pair) => pair.theme === theme).map((pair) => `<div class="row"><span><code>${esc(pair.foreground)}</code> on <code>${esc(pair.background)}</code></span><span class="badge ${(pairRatio(contract, pair) ?? 0) >= pair.minimum ? 'ok' : 'bad'}">${esc(pairRatio(contract, pair) ?? 'n/a')} : 1 (min ${esc(pair.minimum)})</span></div>`).join('\n');
    return `<section class="scope" data-theme="${theme}">\n<h2>${theme} theme</h2>\n<div class="grid">\n${swatches}\n</div>\n<h3>Contrast</h3>\n${rows}\n</section>`;
  }).join('\n');
}

function typographyBody(contract) {
  const t = contract.tokens;
  const specimens = SCHEMA_SHARED_TOKENS.filter((name) => name.startsWith('--text-')).reverse().map((name) => `<p style="font-size: var(${name}); font-family: ${name === '--text-4xl' || name === '--text-3xl' ? 'var(--font-display)' : 'var(--font-body)'}">${esc(bare(name))} — ${esc(t[name])} — The quick brown fox jumps over the lazy dog</p>`).join('\n');
  return themeScopes(contract, `${specimens}\n<p><code>mono: ${esc(t['--font-mono'])}</code></p>`);
}

function spacingBody(contract) {
  const t = contract.tokens;
  const spaces = SCHEMA_SHARED_TOKENS.filter((name) => name.startsWith('--space-')).map((name) => `<div class="row"><code>${esc(name)} ${esc(t[name])}</code><span class="bar" style="width: var(${name})"></span></div>`).join('\n');
  const radii = SCHEMA_SHARED_TOKENS.filter((name) => name.startsWith('--radius-')).map((name) => `<div class="state"><span class="state-label">${esc(name)} ${esc(t[name])}</span><div class="demo" style="border-radius: var(${name})">radius</div></div>`).join('\n');
  const elev = ['--elev-flat', '--elev-ring', '--elev-raised'].map((name) => `<div class="state"><span class="state-label">${esc(name)}</span><div class="demo" style="box-shadow: var(${name})">elevation</div></div>`).join('\n');
  return themeScopes(contract, `${spaces}\n<div class="grid">${radii}</div>\n<div class="grid">${elev}</div>`);
}

function appBody(contract) {
  const layout = contract.layouts?.[0] ?? {};
  const copy = contract.microcopy ?? {};
  const title = layout.name ?? layout.title ?? layout.route ?? 'Overview';
  const primary = copy.primaryAction ?? 'Create';
  const empty = copy.emptyState ?? 'Nothing here yet';
  const screen = `<div class="app">
  <nav aria-label="Main"><strong>${esc(contract.systemId)}</strong><a href="#" aria-current="page">${esc(title)}</a><a href="#">Reports</a><a href="#">Settings</a></nav>
  <main>
    <div class="row"><h2>${esc(title)}</h2><button type="button" class="btn">${esc(primary)}</button></div>
    <div class="stats"><div class="card stat"><strong>128</strong><span>Active</span></div><div class="card stat"><strong>12</strong><span>Pending</span></div><div class="card stat"><strong>3</strong><span>Late</span></div></div>
    <div class="card"><div class="row"><span>Item A</span><span class="badge ok">Done</span></div><div class="row"><span>Item B</span><span class="badge warn">Pending</span></div><div class="row"><span>Item C</span><span class="badge bad">Late</span></div></div>
    <div class="card state-empty">${esc(empty)}</div>
    <div class="row"><input class="input" aria-label="Search" placeholder="Search"><button type="button" class="btn secondary">Filter</button></div>
  </main>
</div>`;
  return themeScopes(contract, screen);
}

export function renderPreviewPages(contract) {
  const bodies = { 'colors.html': colorsBody, 'typography.html': typographyBody, 'spacing.html': spacingBody, 'components.html': (c) => themeScopes(c, componentSections(c)), 'app.html': appBody };
  const pages = {};
  for (const { file, title } of PREVIEW_PAGES) {
    pages[file] = htmlPage({ contract, title, cssHref: './preview.css', cssRel: '../tokens.css', body: bodies[file](contract) });
  }
  const links = PREVIEW_PAGES.map((page) => `<li><a href="./${page.file}">${esc(page.title)}</a></li>`).join('\n');
  pages['index.html'] = htmlPage({
    contract, title: 'Design system preview', cssHref: './preview.css', cssRel: '../tokens.css',
    body: `<p>Engine <code>${esc(contract.engine?.name)}@${esc(contract.engine?.version)}</code> · contract <code>${esc(contract.sha256 ?? 'unsigned')}</code> · themes: ${themeNames(contract).map(esc).join(', ')}</p>\n<ul>\n${links}\n</ul>\n${themeScopes(contract, '<p><button type="button" class="btn">Primary</button> <button type="button" class="btn secondary">Secondary</button></p>')}`,
  });
  pages['preview.css'] = baseCss();
  return pages;
}

/* ------------------------------------------------------------------ USAGE.md, manifests */

export function renderUsageMarkdown(contract) {
  const { generic } = componentStyleCoverage(contract);
  const genericNote = generic.length
    ? `\n\nComponents declared in the contract without dedicated rules in \`components.css\`: ${generic.map((name) => `\`${name}\``).join(', ')}. Build them from tokens only, and cover every state listed in \`components.manifest.json\`.`
    : '';
  return `# Using ${contract.systemId}\n\nContract \`${contract.sha256 ?? 'unsigned'}\` · engine ${contract.engine?.name}@${contract.engine?.version}\n\n## CSS\n\n\`\`\`html\n<link rel="stylesheet" href="tokens.css">\n<link rel="stylesheet" href="components.css">\n<html data-theme="dark"> <!-- optional; omitted = follows prefers-color-scheme -->\n\`\`\`\n\n## Tailwind v4\n\n\`\`\`css\n@import "./tailwind-v4.css";\n@import "./components.css";\n\`\`\`\n\n## Components\n\n\`components.css\` is the only component stylesheet to import. \`components.html\` and \`preview/\` are visual references: their scaffolding classes (\`.page\`, \`.scope\`, \`.grid\`, \`.state\`) collide with utility frameworks and must never be copied into the product. After a build, confirm the component classes reached the compiled CSS bundle.${genericNote}\n\n## Rules\n\n- Use \`var(--token)\` only; the tokens are the TOKEN_SCHEMA names (plus the extensions \`--info\`, \`--*-text\`, \`--border-strong\`, \`--focus\`, \`--border-width\`, \`--control-h*\`).\n- Semantic colors as text use \`--success-text\`, \`--warn-text\`, \`--danger-text\`, \`--info-text\`.\n- Input borders use \`--border-strong\` (3:1); \`--border\` is decorative.\n- A new token requires a new Pensador version of this design system.\n\n## Files\n\n- \`design-contract.json\` (source of truth), \`tokens.css\`, \`components.css\`, \`design-tokens.json\` (DTCG), \`tailwind-v4.css\`, \`DESIGN.md\`, \`components.html\`, \`preview/\`.\n`;
}

export function renderManifest(contract) {
  return {
    schemaVersion: 'od-design-system-project/v1',
    id: contract.systemId,
    name: contract.systemId,
    category: 'Generated',
    description: `Design system generated from a brief by the Open Design brand engine (${contract.engine?.name}@${contract.engine?.version}).`,
    source: { type: 'generated', origin: 'cc-pensador brand engine', contractSha256: contract.sha256 ?? null },
    files: { design: 'DESIGN.md', tokens: 'tokens.css', componentsCss: 'components.css', designTokens: 'design-tokens.json', tailwind: 'tailwind-v4.css', components: 'components.html', contract: 'design-contract.json' },
    usage: 'USAGE.md',
    componentsManifest: 'components.manifest.json',
    importMode: 'normalized',
    themes: themeNames(contract),
    preview: { dir: 'preview', pages: PREVIEW_PAGES.map((page) => ({ path: `preview/${page.file}`, role: page.role, title: page.title })) },
  };
}

export function renderComponentsManifest(contract) {
  const components = contract.components?.length ? contract.components : DEFAULT_COMPONENTS;
  return { schemaVersion: 'od-components-manifest/v1', components: components.map((component) => ({ name: component.name, states: component.states ?? [] })) };
}

export { ALL_TOKENS, EXTENSION_SHARED_TOKENS, EXTENSION_THEME_TOKENS, SCHEMA_SHARED_TOKENS, SCHEMA_THEME_TOKENS, THEME_TOKENS, SHARED_TOKENS };
