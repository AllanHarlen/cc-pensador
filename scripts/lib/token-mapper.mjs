/**
 * Deterministic mapper: Open Design brand-engine output -> Pensador design-contract v2.
 *
 * The engine (seed -> derive) emits the `--brand-*` namespace and Ant Design style ladders. The
 * mapper renames them to the Open Design TOKEN_SCHEMA (`--bg`, `--fg`, `--accent`...), applies
 * fixed rules for the tokens the engine does not produce, and swaps raw engine values for
 * WCAG-safe variants (text variants of the semantic colors, a 3:1 input border, a 3:1 focus color).
 * No timestamps, no LLM, no I/O: the same input always yields the same bytes.
 */
import { createHash } from 'node:crypto';
import { contrastRatio, mixColors } from './color.mjs';

export const CONTRACT_SCHEMA_VERSION = 2;
export const CONTRACT_VERSION = '1.0.0';
export const ENGINE_NAME = 'open-design-brand-engine';

/** OD TOKEN_SCHEMA tokens that change with the theme, in emission order. */
export const SCHEMA_THEME_TOKENS = [
  '--bg', '--surface', '--surface-warm', '--fg', '--fg-2', '--muted', '--meta', '--border', '--border-soft',
  '--accent', '--accent-on', '--accent-hover', '--accent-active', '--success', '--warn', '--danger',
];
/** Extension (layer C) theme tokens: not in the OD schema, declared by the Pensador. */
export const EXTENSION_THEME_TOKENS = [
  '--info', '--success-text', '--warn-text', '--danger-text', '--info-text', '--border-strong', '--focus',
];
export const THEME_TOKENS = [...SCHEMA_THEME_TOKENS, ...EXTENSION_THEME_TOKENS];

/** OD TOKEN_SCHEMA tokens that are theme independent, in emission order. */
export const SCHEMA_SHARED_TOKENS = [
  '--font-display', '--font-body', '--font-mono',
  '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl',
  '--leading-body', '--leading-tight', '--tracking-display',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-12',
  '--section-y-desktop', '--section-y-tablet', '--section-y-phone',
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill',
  '--elev-flat', '--elev-ring', '--elev-raised', '--focus-ring',
  '--motion-fast', '--motion-base', '--ease-standard',
  '--container-max', '--container-gutter-desktop', '--container-gutter-tablet', '--container-gutter-phone',
];
export const EXTENSION_SHARED_TOKENS = ['--border-width', '--control-h-sm', '--control-h', '--control-h-lg'];
export const SHARED_TOKENS = [...SCHEMA_SHARED_TOKENS, ...EXTENSION_SHARED_TOKENS];
export const ALL_TOKENS = [...THEME_TOKENS, ...SHARED_TOKENS];
export const REQUIRED_SCHEMA_TOKENS = [...SCHEMA_THEME_TOKENS, ...SCHEMA_SHARED_TOKENS];

/** Seed field that feeds a token; tokens without an entry are computed by mapper rules ("derived"). */
const TOKEN_SEED_FIELD = {
  '--accent': 'colorPrimary', '--accent-hover': 'colorPrimary', '--accent-active': 'colorPrimary',
  '--success': 'colorSuccess', '--warn': 'colorWarning', '--danger': 'colorError', '--info': 'colorInfo',
  '--success-text': 'colorSuccess', '--warn-text': 'colorWarning', '--danger-text': 'colorError', '--info-text': 'colorInfo',
  '--bg': 'colorBgBase', '--surface': 'colorBgBase', '--surface-warm': 'colorBgBase',
  '--fg': 'colorTextBase', '--fg-2': 'colorTextBase', '--muted': 'colorTextBase', '--meta': 'colorTextBase',
  '--border': 'colorBgBase', '--border-soft': 'colorBgBase', '--border-strong': 'colorTextBase',
  '--font-body': 'fontFamily', '--font-mono': 'fontFamilyCode',
  '--text-xs': 'fontSize', '--text-sm': 'fontSize', '--text-base': 'fontSize', '--text-lg': 'fontSize', '--text-xl': 'fontSize',
  '--text-2xl': 'fontSize', '--text-3xl': 'fontSize', '--text-4xl': 'fontSize',
  '--space-1': 'sizeUnit', '--space-2': 'sizeUnit', '--space-3': 'sizeUnit', '--space-4': 'sizeUnit', '--space-5': 'sizeUnit',
  '--space-6': 'sizeUnit', '--space-8': 'sizeUnit', '--space-12': 'sizeUnit',
  '--section-y-desktop': 'sizeUnit', '--section-y-tablet': 'sizeUnit', '--section-y-phone': 'sizeUnit',
  '--container-gutter-desktop': 'sizeUnit', '--container-gutter-tablet': 'sizeUnit', '--container-gutter-phone': 'sizeUnit',
  '--radius-sm': 'borderRadius', '--radius-md': 'borderRadius', '--radius-lg': 'borderRadius',
  '--border-width': 'lineWidth',
  '--control-h-sm': 'controlHeight', '--control-h': 'controlHeight', '--control-h-lg': 'controlHeight',
  '--motion-fast': 'motionUnit', '--motion-base': 'motionUnit',
};

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

/** sha256 of the canonical contract without its own `sha256` field. */
export function contractSha256(contract) {
  const { sha256: _ignored, ...rest } = contract;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

export function finalizeContract(contract) {
  const { sha256: _ignored, ...rest } = contract;
  return { ...rest, sha256: contractSha256(rest) };
}

const px = (n) => `${Math.round(Number(n) * 100) / 100}px`;
const ms = (value) => {
  const text = String(value).trim();
  const number = Number.parseFloat(text);
  if (Number.isNaN(number)) return text;
  return `${Math.round(text.endsWith('ms') ? number : number * 1000)}ms`;
};
const round3 = (n) => `${Math.round(Number(n) * 1000) / 1000}`;

/**
 * First candidate meeting `minimum` on every background. When the whole ladder fails, mix the first
 * candidate toward `towards` (the theme's foreground) in 5% steps until it passes: deterministic and
 * keeps the hue as long as possible.
 */
function pickReadable(candidates, backgrounds, minimum, towards) {
  const usable = candidates.filter((c) => typeof c === 'string' && c);
  const worst = (c) => Math.min(...backgrounds.map((bg) => contrastRatio(c, bg) ?? 0));
  const passing = usable.find((c) => worst(c) >= minimum);
  if (passing) return passing;
  if (towards) {
    for (let step = 1; step <= 20; step += 1) {
      const mixed = mixColors(usable[0], towards, step / 20);
      if (mixed && worst(mixed) >= minimum) return mixed;
    }
  }
  return usable.reduce((best, c) => (worst(c) > worst(best) ? c : best), usable[0]);
}

function onColor(background) {
  const white = contrastRatio('#ffffff', background) ?? 0;
  const black = contrastRatio('#000000', background) ?? 0;
  return white >= black ? '#ffffff' : '#000000';
}

/** Theme-dependent tokens from one derived engine token set (light = default, dark = dark). */
export function mapThemeTokens(t) {
  const bg = t.colorBgLayout;
  const surface = t.colorBgContainer;
  const backgrounds = [bg, surface];
  const text = (...c) => pickReadable(c, backgrounds, 4.5, t.colorText);
  return {
    '--bg': bg,
    '--surface': surface,
    '--surface-warm': t.colorBgElevated,
    '--fg': t.colorText,
    '--fg-2': text(t.colorTextSecondary, t.colorText),
    '--muted': text(t.colorTextSecondary, t.colorText),
    '--meta': text(t.colorTextTertiary, t.colorTextSecondary, t.colorText),
    '--border': t.colorBorder,
    '--border-soft': t.colorBorderSecondary,
    '--accent': t.colorPrimary,
    '--accent-on': onColor(t.colorPrimary),
    '--accent-hover': t.colorPrimaryHover,
    '--accent-active': t.colorPrimaryActive,
    '--success': t.colorSuccess,
    '--warn': t.colorWarning,
    '--danger': t.colorError,
    '--info': t.colorInfo,
    '--success-text': text(t.colorSuccess, t.colorSuccessActive, t.colorSuccessHover),
    '--warn-text': text(t.colorWarning, t.colorWarningActive, t.colorWarningHover),
    '--danger-text': text(t.colorError, t.colorErrorActive, t.colorErrorHover),
    '--info-text': text(t.colorInfo, t.colorLinkActive, t.colorLinkHover),
    '--border-strong': pickReadable([t.colorTextTertiary, t.colorTextSecondary, t.colorText], backgrounds, 3, t.colorText),
    '--focus': pickReadable([t.colorPrimary, t.colorPrimaryHover, t.colorPrimaryActive, t.colorText], backgrounds, 3, t.colorText),
  };
}

/** Theme-independent tokens from the default-algorithm engine set and the merged seed. */
export function mapSharedTokens(t, seed, { fontDisplay } = {}) {
  const unit = Number(seed.sizeUnit) || 4;
  const radius = Number(t.borderRadius);
  return {
    '--font-display': fontDisplay || t.fontFamily,
    '--font-body': t.fontFamily,
    '--font-mono': t.fontFamilyCode,
    '--text-xs': px(t.fontSizeSM - 1),
    '--text-sm': px(t.fontSizeSM),
    '--text-base': px(t.fontSize),
    '--text-lg': px(t.fontSizeLG),
    '--text-xl': px(t.fontSizeXL),
    '--text-2xl': px(t.fontSizeHeading3),
    '--text-3xl': px(t.fontSizeHeading2),
    '--text-4xl': px(t.fontSizeHeading1),
    '--leading-body': round3(t.lineHeight),
    '--leading-tight': round3(t.lineHeightHeading),
    '--tracking-display': t.fontSizeHeading1 >= 32 ? '-0.01em' : '0em',
    '--space-1': px(t.sizeXXS),
    '--space-2': px(t.sizeXS),
    '--space-3': px(t.sizeSM),
    '--space-4': px(t.size),
    '--space-5': px(t.sizeMD),
    '--space-6': px(t.sizeLG),
    '--space-8': px(t.sizeXL),
    '--space-12': px(t.sizeXXL),
    '--section-y-desktop': px(24 * unit),
    '--section-y-tablet': px(16 * unit),
    '--section-y-phone': px(12 * unit),
    '--radius-sm': px(radius),
    '--radius-md': px(Math.round(radius * 1.5)),
    '--radius-lg': px(radius * 2),
    '--radius-pill': '9999px',
    '--elev-flat': 'none',
    '--elev-ring': '0 0 0 1px var(--border)',
    '--elev-raised': '0 2px 8px color-mix(in oklab, var(--fg), transparent 92%)',
    '--focus-ring': '0 0 0 2px var(--bg), 0 0 0 4px var(--focus)',
    '--motion-fast': ms(t.motionDurationFast),
    '--motion-base': ms(t.motionDurationMid),
    '--ease-standard': t.motionEaseInOut,
    '--container-max': '1200px',
    '--container-gutter-desktop': px(8 * unit),
    '--container-gutter-tablet': px(6 * unit),
    '--container-gutter-phone': px(4 * unit),
    '--border-width': px(t.lineWidth),
    '--control-h-sm': px(t.controlHeightSM),
    '--control-h': px(t.controlHeight),
    '--control-h-lg': px(t.controlHeightLG),
  };
}

/** Compact density: only the space/control tokens whose value changes (the engine's compact set is not a color theme). */
export function mapCompactOverrides(compact, seed, shared) {
  if (!compact) return null;
  const mapped = mapSharedTokens({ ...compact, fontFamily: shared['--font-body'], fontFamilyCode: shared['--font-mono'] }, seed);
  const diff = {};
  for (const name of Object.keys(mapped)) {
    if (mapped[name] !== shared[name] && (name.startsWith('--space-') || name.startsWith('--control-h'))) diff[name] = mapped[name];
  }
  return Object.keys(diff).length ? diff : null;
}

/** Contrast matrix the audit must enforce, per theme. `kind` decides the WCAG threshold (text 4.5, non-text 3). */
export function buildContrastPairs(themes) {
  const pairs = [];
  const text = [
    ['--fg', '--bg'], ['--fg', '--surface'], ['--fg-2', '--bg'], ['--fg-2', '--surface'],
    ['--muted', '--bg'], ['--muted', '--surface'], ['--meta', '--bg'], ['--meta', '--surface'],
    ['--accent-on', '--accent'],
    ['--success-text', '--bg'], ['--success-text', '--surface'], ['--warn-text', '--bg'], ['--warn-text', '--surface'],
    ['--danger-text', '--bg'], ['--danger-text', '--surface'], ['--info-text', '--bg'], ['--info-text', '--surface'],
  ];
  const nonText = [['--border-strong', '--bg'], ['--border-strong', '--surface'], ['--focus', '--bg'], ['--focus', '--surface']];
  for (const theme of Object.keys(themes).filter((name) => name === 'light' || name === 'dark').sort()) {
    for (const [foreground, background] of text) pairs.push({ theme, foreground, background, minimum: 4.5, kind: 'text' });
    for (const [foreground, background] of nonText) pairs.push({ theme, foreground, background, minimum: 3, kind: 'non-text' });
  }
  return pairs;
}

const SEED_ORIGINS = new Set(['brief', 'proposed', 'derived', 'engine-default']);

function originFor(field, seedOrigin) {
  const origin = seedOrigin?.[field];
  return SEED_ORIGINS.has(origin) ? origin : 'engine-default';
}

/**
 * @param {object} input
 * @param {string} input.systemId
 * @param {object} input.seed merged seed actually sent to the engine
 * @param {{default: object, dark: object, compact?: object}} input.tokens derived engine token sets
 * @param {{name?: string, version: string}} input.engine
 * @param {Record<string,string>} [input.seedOrigin] seed field -> brief|proposed|engine-default
 * @param {string|null} [input.briefRef]
 * @param {string} [input.fontDisplay]
 * @param {'light'|'dark'|'system'} [input.defaultTheme]
 * @param {object} [input.extras] components, layouts, iconography, imagery, microcopy, antiPatterns, rationale
 */
export function mapEngineToContract({
  systemId, seed, tokens, engine, seedOrigin = {}, briefRef = null, fontDisplay, defaultTheme = 'system', extras = {},
}) {
  if (!systemId) throw new TypeError('systemId is required');
  if (!tokens?.default || !tokens?.dark) throw new TypeError('engine output must include default and dark token sets');
  const light = mapThemeTokens(tokens.default);
  const dark = mapThemeTokens(tokens.dark);
  const shared = mapSharedTokens(tokens.default, seed, { fontDisplay });
  const compact = mapCompactOverrides(tokens.compact, seed, shared);

  const themes = { light, dark, ...(compact ? { compact } : {}) };
  const provenance = { light: {}, dark: {}, shared: {} };
  for (const name of THEME_TOKENS) {
    const field = TOKEN_SEED_FIELD[name];
    provenance.light[name] = field ? originFor(field, seedOrigin) : 'derived';
    provenance.dark[name] = 'derived';
  }
  for (const name of SHARED_TOKENS) {
    const field = name === '--font-display' && fontDisplay ? 'fontDisplay' : TOKEN_SEED_FIELD[name];
    provenance.shared[name] = field ? originFor(field, seedOrigin) : 'derived';
  }
  const seedProvenance = Object.fromEntries(Object.keys(seed).sort().map((key) => [key, originFor(key, seedOrigin)]));

  const contract = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    systemId,
    version: CONTRACT_VERSION,
    briefRef,
    defaultTheme,
    engine: { name: engine?.name ?? ENGINE_NAME, version: String(engine?.version ?? 'unknown') },
    seed,
    themes,
    tokens: shared,
    primitives: { primary: tokens.default.primaryPalette ?? [] },
    provenance: { ...provenance, seed: seedProvenance },
    contrastPairs: buildContrastPairs(themes),
    components: extras.components ?? [],
    layouts: extras.layouts ?? [],
    iconography: extras.iconography ?? {},
    imagery: extras.imagery ?? { decision: 'required-only', assets: [] },
    microcopy: extras.microcopy ?? {},
    antiPatterns: extras.antiPatterns ?? [],
    ...(extras.rationale ? { rationale: extras.rationale } : {}),
  };
  return finalizeContract(contract);
}
