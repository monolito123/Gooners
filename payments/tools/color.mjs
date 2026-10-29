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
