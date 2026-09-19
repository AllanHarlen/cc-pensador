/**
 * Deterministic gates for the resolved design package (DESIGN stage, Phase 4).
 * Pure: every function takes the parsed contract/brief and returns findings, no I/O.
 *
 *   - checkContrastMatrix   the mandatory WCAG 2.2 AA matrix, in BOTH themes
 *   - checkScales           primitive ladders and the space/type/radius scales are monotonic
 *   - checkComponentStates  every component declares the core states, including focus-visible
 *   - checkBriefConformance a LOCKED brief field must show up unchanged in the contract
 */
import { DESIGN_BRIEF_DENSITY, DESIGN_BRIEF_MOTION } from '../pensador-engine.mjs';
import { contrastRatio, deltaE, parseColor, relativeLuminance } from './color.mjs';
import { REQUIRED_COMPONENT_STATES } from './design-render.mjs';
import { THEME_TOKENS, buildContrastPairs } from './token-mapper.mjs';

export { REQUIRED_COMPONENT_STATES };

/** Largest CIE76 distance still considered "the same colour" (below one just-noticeable difference). */
export const COLOR_TOLERANCE_DELTA_E = 2;

const BLOCKING = new Set(['critical', 'high']);
export const isBlocking = (finding) => BLOCKING.has(finding.severity);

const finding = (severity, code, message, path = null) => ({ severity, code, message, path });

/** The (theme, foreground, background) triples the audit requires, with their minimum ratio. */
export function requiredContrastPairs() {
  return buildContrastPairs({ light: {}, dark: {} });
}

export function checkContrastMatrix(contract) {
  const findings = [];
  const declared = new Map((contract.contrastPairs ?? []).map((pair) => [`${pair.theme}|${pair.foreground}|${pair.background}`, pair]));
  if (declared.size === 0) findings.push(finding('high', 'CONTRAST_MATRIX_MISSING', 'contrastPairs is empty; the WCAG matrix is mandatory', 'contrastPairs'));

  for (const theme of ['light', 'dark']) {
    const values = contract.themes?.[theme];
    if (!values) continue;
    for (const name of THEME_TOKENS) {
      if (name in values && parseColor(values[name]) == null) findings.push(finding('high', 'COLOR_UNPARSEABLE', `[${theme}] ${name} is not a hex, rgb() or oklch() colour: ${JSON.stringify(values[name])}`, `themes.${theme}.${name}`));
    }
  }

  for (const required of requiredContrastPairs()) {
    const key = `${required.theme}|${required.foreground}|${required.background}`;
    const pair = declared.get(key);
    if (!pair) {
      findings.push(finding('high', 'CONTRAST_PAIR_MISSING', `[${required.theme}] mandatory pair ${required.foreground} on ${required.background} is not in contrastPairs`, 'contrastPairs'));
      continue;
    }
    if (Number(pair.minimum) < required.minimum) {
      findings.push(finding('high', 'CONTRAST_MINIMUM_LOWERED', `[${required.theme}] ${required.foreground} on ${required.background} declares minimum ${pair.minimum}; WCAG 2.2 AA needs ${required.minimum}`, 'contrastPairs'));
    }
  }

  for (const pair of contract.contrastPairs ?? []) {
    const values = contract.themes?.[pair.theme] ?? {};
    const ratio = contrastRatio(values[pair.foreground] ?? pair.foreground, values[pair.background] ?? pair.background);
    const minimum = Math.max(Number(pair.minimum ?? 4.5), 0);
    if (ratio == null || ratio < minimum) {
      findings.push(finding('high', 'WCAG_CONTRAST', `[${pair.theme}] ${pair.foreground} on ${pair.background} is ${ratio?.toFixed(2) ?? 'invalid'} (minimum ${minimum}); use a safe variant (--*-text, --border-strong, --focus), never the raw engine value`, 'contrastPairs'));
    }
  }
  return findings;
}

const px = (value) => {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
};

function monotonic(values, direction) {
  for (let i = 1; i < values.length; i += 1) {
    if (direction === 'desc' ? values[i] > values[i - 1] + 1e-9 : values[i] < values[i - 1] - 1e-9) return false;
  }
  return true;
}

const SCALES = [
  { label: 'space', tokens: ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-12'] },
  { label: 'type', tokens: ['--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl'] },
  { label: 'radius', tokens: ['--radius-sm', '--radius-md', '--radius-lg'] },
  { label: 'section-y', tokens: ['--section-y-phone', '--section-y-tablet', '--section-y-desktop'] },
  { label: 'control-h', tokens: ['--control-h-sm', '--control-h', '--control-h-lg'] },
];

export function checkScales(contract) {
  const findings = [];
  for (const [name, ladder] of Object.entries(contract.primitives ?? {})) {
    if (!Array.isArray(ladder) || ladder.length < 2) continue;
    const luminances = ladder.map(relativeLuminance);
    if (luminances.some((value) => value == null)) findings.push(finding('high', 'SCALE_INVALID', `primitives.${name} has a value that is not a colour`, `primitives.${name}`));
    else if (!monotonic(luminances, 'desc')) findings.push(finding('high', 'SCALE_NOT_MONOTONIC', `primitives.${name} must go from lightest to darkest without reversing`, `primitives.${name}`));
  }
  for (const { label, tokens } of SCALES) {
    const values = tokens.map((name) => px(contract.tokens?.[name]));
    if (values.some((value) => value == null)) continue; // a missing/odd token is reported by the token checks
    if (!monotonic(values, 'asc')) findings.push(finding('high', 'SCALE_NOT_MONOTONIC', `${label} scale (${tokens.join(', ')}) must not decrease`, 'tokens'));
  }
  return findings;
}

export function checkComponentStates(contract) {
  const findings = [];
  if (!Array.isArray(contract.components) || contract.components.length === 0) {
    return [finding('high', 'COMPONENTS_MISSING', 'At least one component contract is required', 'components')];
  }
  for (const component of contract.components) {
    for (const state of REQUIRED_COMPONENT_STATES) {
      if (!component.states?.includes(state)) findings.push(finding('high', 'COMPONENT_STATE_MISSING', `${component.name} is missing state ${state}`, `components.${component.name}`));
    }
  }
  for (const token of ['--focus', '--focus-ring']) {
    const present = token === '--focus' ? contract.themes?.light?.[token] && contract.themes?.dark?.[token] : contract.tokens?.[token];
    if (!present) findings.push(finding('high', 'FOCUS_TOKEN_MISSING', `${token} is required for a visible focus-visible state`, token));
  }
  return findings;
}

const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * A LOCKED brief field is an explicit user decision: any divergence in the contract blocks.
 * Unlocked fields (proposals) only produce informative findings. The primary is compared with the
 * LIGHT theme only: the engine derives a different accent for the dark theme by design.
 *
 * @returns {{ status: 'PASS'|'BLOCKED', findings: object[] }}
 */
export function checkBriefConformance(brief, contract) {
  const findings = [];
  const fields = brief?.fields && typeof brief.fields === 'object' ? brief.fields : {};
  if (!brief || typeof brief !== 'object' || brief.schemaVersion !== 1) {
    return { status: 'BLOCKED', findings: [finding('high', 'BRIEF_INVALID', 'design-brief.json is missing or has an unsupported schemaVersion', 'design-brief.json')] };
  }
  for (const issue of brief.issues ?? []) findings.push(finding('high', 'BRIEF_INVALID', `brief field ${issue.field} was rejected (${issue.reason}); fix the answer and rebuild the brief`, `fields.${issue.field}`));

  const severityFor = (field) => (fields[field].locked ? 'high' : 'info');
  const seed = contract?.seed ?? {};
  const tokens = contract?.tokens ?? {};
  const light = contract?.themes?.light ?? {};
  const mismatch = (field, message) => findings.push(finding(severityFor(field), 'BRIEF_MISMATCH', `${fields[field].locked ? 'locked ' : ''}brief field ${field}: ${message}`, `fields.${field}`));

  const colors = { colorPrimary: '--accent', colorSuccess: '--success', colorWarning: '--warn', colorError: '--danger', colorInfo: '--info' };
  for (const [field, token] of Object.entries(colors)) {
    if (!(field in fields)) continue;
    const wanted = fields[field].value;
    if (!sameText(seed[field] ?? '', wanted)) mismatch(field, `seed has ${JSON.stringify(seed[field])}, brief asks ${JSON.stringify(wanted)}`);
    const distance = deltaE(light[token], wanted);
    if (distance == null || distance > COLOR_TOLERANCE_DELTA_E) mismatch(field, `light ${token} is ${JSON.stringify(light[token])}, ΔE ${distance?.toFixed(1) ?? 'n/a'} from ${wanted} (tolerance ${COLOR_TOLERANCE_DELTA_E})`);
  }

  const literal = { fontFamily: '--font-body', fontFamilyCode: '--font-mono' };
  for (const [field, token] of Object.entries(literal)) {
    if (!(field in fields)) continue;
    const wanted = fields[field].value;
    if (!sameText(tokens[token] ?? '', wanted)) mismatch(field, `${token} is ${JSON.stringify(tokens[token])}, brief asks ${JSON.stringify(wanted)}`);
  }
  if ('fontSize' in fields && px(tokens['--text-base']) !== fields.fontSize.value) mismatch('fontSize', `--text-base is ${JSON.stringify(tokens['--text-base'])}, brief asks ${fields.fontSize.value}px`);
  if ('borderRadius' in fields && px(tokens['--radius-sm']) !== fields.borderRadius.value) mismatch('borderRadius', `--radius-sm is ${JSON.stringify(tokens['--radius-sm'])}, brief asks ${fields.borderRadius.value}px`);

  if ('density' in fields) {
    const preset = DESIGN_BRIEF_DENSITY[fields.density.value];
    if (preset && (px(tokens['--control-h']) !== preset.controlHeight || Number(seed.sizeUnit) !== preset.sizeUnit)) {
      mismatch('density', `${fields.density.value} needs --control-h ${preset.controlHeight}px and sizeUnit ${preset.sizeUnit}; contract has ${JSON.stringify(tokens['--control-h'])} and ${JSON.stringify(seed.sizeUnit)}`);
    }
  }
  if ('motion' in fields) {
    const preset = DESIGN_BRIEF_MOTION[fields.motion.value];
    if (preset && (seed.motion !== preset.motion || (preset.motion && Number(seed.motionUnit) !== preset.motionUnit))) {
      mismatch('motion', `${fields.motion.value} needs motion=${preset.motion}${preset.motion ? ` and motionUnit ${preset.motionUnit}` : ''}; contract seed has motion=${JSON.stringify(seed.motion)} and motionUnit ${JSON.stringify(seed.motionUnit)}`);
    }
  }
  if ('themeDefault' in fields && contract?.defaultTheme !== fields.themeDefault.value) mismatch('themeDefault', `contract defaultTheme is ${JSON.stringify(contract?.defaultTheme)}, brief asks ${JSON.stringify(fields.themeDefault.value)}`);

  // Origin trail: a locked decision must be recorded as coming from the brief, never as an engine default.
  const seedKeys = { colorPrimary: ['colorPrimary'], colorSuccess: ['colorSuccess'], colorWarning: ['colorWarning'], colorError: ['colorError'], colorInfo: ['colorInfo'], fontFamily: ['fontFamily'], fontFamilyCode: ['fontFamilyCode'], fontSize: ['fontSize'], borderRadius: ['borderRadius'], density: ['controlHeight'], motion: ['motion'] };
  for (const [field, keys] of Object.entries(seedKeys)) {
    if (!(field in fields) || !fields[field].locked) continue;
    for (const key of keys) {
      const origin = contract?.provenance?.seed?.[key];
      if (origin && origin !== 'brief') findings.push(finding('medium', 'PROVENANCE_MISMATCH', `locked brief field ${field} feeds seed ${key}, but the contract records its origin as ${origin}`, `provenance.seed.${key}`));
    }
  }

  return { status: findings.some(isBlocking) ? 'BLOCKED' : 'PASS', findings };
}
