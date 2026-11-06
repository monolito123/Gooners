// Line icons for the console, from payments/design/icons.json (the Android app draws the same
// paths): stroked in the current text colour, so they follow the theme. Built with DOM calls,
// which the console's CSP allows (no inline markup or styles).
import { GRID, PATHS, STROKE } from './icon-paths.js';

const NS = 'http://www.w3.org/2000/svg';

/** An icon as an inline SVG element, hidden from screen readers (its link has the words). */
export function icon(name, size = 20) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${GRID} ${GRID}`, width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': STROKE, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'icon' })) {
    svg.setAttribute(k, String(v));
  }
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * A sparkline of values as bars, one per slot (the hours of a day), scaled to the largest.
 * Empty slots keep a faint baseline so the shape of the day reads at a glance.
 */
export function sparkBars(values, { width = 288, height = 64, label = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${width} ${height}`, class: 'spark', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' })) {
    svg.setAttribute(k, String(v));
  }
  const max = Math.max(1, ...values);
  const slot = width / values.length;
  values.forEach((v, i) => {
    const h = v > 0 ? Math.max(3, (v / max) * (height - 4)) : 2;
    const r = document.createElementNS(NS, 'rect');
    for (const [k, val] of Object.entries({ x: (i * slot + slot * 0.15).toFixed(2), y: (height - h).toFixed(2), width: (slot * 0.7).toFixed(2), height: h.toFixed(2), rx: 2,
      class: v > 0 ? 'bar' : 'bar empty' })) {
      r.setAttribute(k, String(val));
    }
    svg.append(r);
  });
  return svg;
}
