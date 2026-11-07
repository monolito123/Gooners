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
