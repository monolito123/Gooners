// WCAG 2.x contrast, token resolution and colour-vision-deficiency simulation (Machado et al. 2009, severity 1.0).
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export const luminance = (h) => {
  const [r, g, b] = hexToRgb(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Two decimals, as the docs print them. Pass/fail always uses the exact value. */
export const fmt = (r) => r.toFixed(2);

export function resolveTokens(tokens) {
  const get = (path) => path.split('.').reduce((o, k) => o?.[k], tokens);
  const resolve = (v) => (typeof v === 'string' && v.startsWith('{') ? resolve(get(v.slice(1, -1)).$value) : v);
  return (theme, role) => resolve(tokens.theme[theme][role].$value).toUpperCase();
}

const M = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export function simulate(hex, type) {
  const rgb = hexToRgb(hex).map(lin);
  const out = M[type].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
  return '#' + out.map((c) => Math.round(unlin(c) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
/** CIE76 ΔE. Above ~20 reads as clearly different colours; below ~10 they are easy to confuse. */
export const deltaE = (a, b) => Math.hypot(...toLab(a).map((v, i) => v - toLab(b)[i]));

// ---------------------------------------------------------------- categorical chart palettes
// The data-visualization method docs/06 §8 applies: OKLab (Ottosson 2020), distances as
// Euclidean ΔE in OKLab ×100, colour-vision deficiency simulated with the Machado matrices
// above at severity 1.0 in linear RGB. A categorical palette must sit in a lightness band,
// keep its chroma, stay apart for dichromats and for everyone else, and stand off its surface.

const oklabLinear = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const linearOf = (hex, type) => {
  const rgb = hexToRgb(hex).map(lin);
  return type ? M[type].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) : rgb;
};
/** OKLCH lightness and chroma of a colour. */
export const oklch = (hex) => {
  const [L, a, b] = oklabLinear(linearOf(hex));
  return [L, Math.hypot(a, b)];
};
/** ΔE in OKLab ×100, as seen with normal vision or simulated protanopia, deuteranopia or tritanopia. */
export const okDeltaE = (x, y, type) => {
  const [p, q] = [oklabLinear(linearOf(x, type)), oklabLinear(linearOf(y, type))];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };
/**
 * Checks a categorical palette. `pairs: 'all'` compares every pair (any two marks can touch);
 * `relief` names the secondary encodings the charts carry: 'gaps' (a surface gap between
 * marks) lets the colour-vision distance sit in the 6–8 floor band, 'labels' (legend rows
 * with names and amounts, and a table view) lets a mark fall under 3:1 on the surface.
 * Returns the failures (empty when it passes) and the measured figures.
 */
export function checkCategorical(palette, { mode, surface, pairs = 'adjacent', relief = [] }) {
  const fails = [];
  const [lo, hi] = BAND[mode];
  for (const c of palette) {
    const [L, C] = oklch(c);
    if (L < lo || L > hi) fails.push(`${c} lightness ${L.toFixed(3)} outside ${lo}–${hi}`);
    if (C < 0.1) fails.push(`${c} chroma ${C.toFixed(3)} reads as gray`);
    const k = contrast(c, surface);
    if (k < 3 && !relief.includes('labels')) fails.push(`${c} is ${k.toFixed(2)}:1 on ${surface}: needs 3:1 or labels`);
  }
  const list = palette.flatMap((a, i) => palette.slice(i + 1).map((b, j) => [a, b, j === 0]))
    .filter(([, , adjacent]) => pairs === 'all' || adjacent);
  let cvd = Infinity, normal = Infinity;
  for (const [a, b] of list) {
    cvd = Math.min(cvd, okDeltaE(a, b, 'protan'), okDeltaE(a, b, 'deutan'));
    normal = Math.min(normal, okDeltaE(a, b));
  }
  if (cvd < 6 || (cvd < 8 && !relief.includes('gaps'))) fails.push(`worst colour-vision ΔE ${cvd.toFixed(1)} (needs 8, or 6 with gaps)`);
  if (normal < 15) fails.push(`worst normal-vision ΔE ${normal.toFixed(1)} (needs 15)`);
  return { fails, cvd, normal };
}
