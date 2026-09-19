/** Color parsing and WCAG 2.x contrast. Node built-ins only; pure functions. */

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function fromHex(text) {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (!match) return null;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 };
}

function channelValue(token) {
  const value = String(token).trim();
  return value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value) / 255;
}

function fromRgb(text) {
  const match = /^rgba?\(\s*([^)]+)\)$/i.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map(channelValue);
  return [r, g, b].some(Number.isNaN) ? null : { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

const encode = (linear) => (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);

function fromOklch(text) {
  const match = /^oklch\(\s*([^)]+)\)$/i.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[\s/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const L = parts[0].endsWith('%') ? Number.parseFloat(parts[0]) / 100 : Number.parseFloat(parts[0]);
  const C = Number.parseFloat(parts[1]);
  const H = (Number.parseFloat(parts[2]) * Math.PI) / 180;
  if ([L, C, H].some(Number.isNaN)) return null;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clamp01(encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}

/** Parses #rgb/#rgba/#rrggbb/#rrggbbaa, rgb[a](), oklch() into {r,g,b} in 0..1 (alpha ignored). */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return fromHex(text) ?? fromRgb(text) ?? fromOklch(text);
}

const linearize = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function relativeLuminance(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a == null || b == null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hexByte = (n) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');

export function toHex(value) {
  const rgb = parseColor(value);
  return rgb ? `#${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}` : null;
}

/** Linear mix in sRGB of `from` toward `to` (`amount` 0..1), returned as #rrggbb. */
export function mixColors(from, to, amount) {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return null;
  const mix = (x, y) => x + (y - x) * amount;
  return `#${hexByte(mix(a.r, b.r))}${hexByte(mix(a.g, b.g))}${hexByte(mix(a.b, b.b))}`;
}

function toLab({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(linearize);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 colour difference (D65 Lab) between two colours; null when either does not parse. */
export function deltaE(first, second) {
  const a = parseColor(first);
  const b = parseColor(second);
  if (!a || !b) return null;
  const x = toLab(a);
  const y = toLab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}
