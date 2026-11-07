// The sales chart (docs/06 §8): bars for the series the chart is about, a line for what it is
// compared with, one y axis with clean ticks, and the reader's way in: hover or keyboard focus
// shows every series at a bucket, and a table holds the same numbers. Built with DOM calls (the
// console's CSP allows no inline markup or styles); colours come from tokens.css.
import { compact } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const el = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};

// A column with a 4px rounded data end and a square foot on the baseline.
const column = (x, y, w, base) => {
  const r = Math.min(4, w / 2, base - y);
  return `M${x},${base} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${base} Z`;
};

/**
 * A chart of a sales view (format.js dayView or periodView). brl formats centavos for the
 * readout and the table; unit names the bucket ("hora" or "dia").
 */
export function salesChart(view, { brl, unit, height = 220 }) {
  const n = view.buckets.length;
  const hasCompare = view.compare.length === n;
  const root = el('div', 'chart');

  // The legend: two series, so a key for each; bars get a block, the line a short stroke.
  root.append(el('div', 'legend-row',
    el('span', 'key', el('span', 'swatch focus'), view.focusName),
    hasCompare ? el('span', 'key', el('span', 'line-key'), view.compareName) : null));

  const plot = el('div', 'plot');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  const peak = view.buckets.indexOf(Math.max(...view.buckets));
  plot.setAttribute('aria-label', `${view.title}: ${brl(view.gross)} vendidos${view.change ? `, ${view.change} ${view.versus}` : ''}`
    + (view.gross > 0 ? `. Maior ${unit}: ${view.spoken[peak]}, ${brl(view.buckets[peak])}` : '') + `. Use as setas para ler cada ${unit}.`);
  const tip = el('div', 'tip');
  tip.hidden = true;
  tip.setAttribute('aria-live', 'polite');
  plot.append(tip);
  root.append(plot);

  let selected = -1;
  let geometry = null;

  const show = (i) => {
    selected = i;
    plot.querySelectorAll('.bar.on').forEach((b) => b.classList.remove('on'));
    const cross = plot.querySelector('.cross');
    if (i < 0 || !geometry) {
      tip.hidden = true;
      if (cross) cross.setAttribute('visibility', 'hidden');
      return;
    }
    plot.querySelector(`.bar[data-i="${i}"]`)?.classList.add('on');
    const x = geometry.center(i);
    if (cross) {
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.setAttribute('visibility', 'visible');
    }
    // Values lead, names follow; the line series keyed with a stroke, the bars with a block.
    tip.replaceChildren(...[el('div', 'tip-title', view.spoken[i]),
      el('div', 'tip-row', el('span', 'swatch focus'), el('strong', null, brl(view.buckets[i])), el('span', 'muted', view.focusName)),
      hasCompare ? el('div', 'tip-row', el('span', 'line-key'), el('strong', null, brl(view.compare[i])), el('span', 'muted', view.compareName)) : null].filter(Boolean));
    tip.hidden = false;
    // Above the column's tallest mark, inside the plot; beside the column when there is no room above.
    const w = tip.offsetWidth || 168, th = tip.offsetHeight || 64;
    const markTop = Math.min(geometry.y(view.buckets[i]), hasCompare ? geometry.y(view.compare[i]) : Infinity);
    let left = x - w / 2, top = markTop - th - 8;
    if (top < 0) {
      top = 0;
      left = x + w + 12 <= geometry.width ? x + 12 : x - w - 12;
    }
    tip.style.left = `${Math.max(0, Math.min(geometry.width - w, left))}px`;
    tip.style.top = `${top}px`;
  };

  const draw = () => {
    const width = Math.max(240, plot.clientWidth || 600);
    const left = 64, right = 8, top = 12, bottom = 26;
    const plotH = height - top - bottom;
    const slot = (width - left - right) / n;
    const bw = Math.min(24, slot * 0.62);
    const yMax = view.ticks[view.ticks.length - 1] || 1;
    const y = (v) => top + plotH - (v / yMax) * plotH;
    const center = (i) => left + i * slot + slot / 2;
    geometry = { width, center, y };
    const s = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' });
    for (const t of view.ticks) {
      s.append(svg('line', { x1: left, x2: width - right, y1: y(t), y2: y(t), class: 'grid' }));
      const label = svg('text', { x: left - 8, y: y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
      label.textContent = compact(t);
      s.append(label);
    }
    view.buckets.forEach((v, i) => {
      if (v > 0) s.append(svg('path', { d: column(center(i) - bw / 2, Math.min(y(v), y(0) - 1), bw, y(0)), class: 'bar', 'data-i': i }));
    });
    if (hasCompare) {
      s.append(svg('polyline', { points: view.compare.map((v, i) => `${center(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: 'compare-line' }));
    }
    // As many x labels as fit side by side (48px apart), the first and the last always.
    const shown = [];
    for (const i of view.axis) if (!shown.length || center(i) - center(shown[shown.length - 1]) >= 48) shown.push(i);
    const last = view.axis[view.axis.length - 1];
    if (shown[shown.length - 1] !== last) {
      while (shown.length > 1 && center(last) - center(shown[shown.length - 1]) < 48) shown.pop();
      shown.push(last);
    }
    for (const i of shown) {
      const label = svg('text', { x: center(i), y: height - 6, class: 'tick', 'text-anchor': i === 0 && slot < 40 ? 'start' : i === n - 1 && slot < 40 ? 'end' : 'middle' });
      label.textContent = view.labels[i];
      s.append(label);
    }
    s.append(svg('line', { x1: 0, x2: 0, y1: top, y2: y(0), class: 'cross', visibility: 'hidden' }));
    // The hit area of a bucket is its whole column, not the painted bar.
    view.buckets.forEach((_, i) => {
      const hit = svg('rect', { x: left + i * slot, y: top, width: slot, height: plotH, class: 'hit' });
      hit.addEventListener('pointerenter', () => show(i));
      hit.addEventListener('pointerdown', () => show(i));
      s.append(hit);
    });
    plot.querySelector('svg')?.remove();
    plot.prepend(s);
    if (selected >= 0) show(selected);
  };

  plot.addEventListener('pointerleave', () => show(-1));
  plot.addEventListener('focus', () => show(selected >= 0 ? selected : Math.max(0, view.buckets.findLastIndex((v) => v > 0))));
  plot.addEventListener('blur', () => show(-1));
  plot.addEventListener('keydown', (e) => {
    const next = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: n - 1 }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      show(Math.max(0, Math.min(n - 1, next)));
    } else if (e.key === 'Escape') show(-1);
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(plot);
  requestAnimationFrame(draw);

  // The same numbers as a table: what a screen reader or a careful reader uses.
  const table = el('table', 'small');
  table.append(el('thead', null, el('tr', null, el('th', null, unit === 'hora' ? 'Hora' : 'Dia'), el('th', 'num', view.focusName),
    hasCompare ? el('th', 'num', view.compareName) : null)));
  const body = el('tbody');
  view.buckets.forEach((v, i) => {
    if (v === 0 && (!hasCompare || view.compare[i] === 0)) return; // an empty row says nothing
    body.append(el('tr', null, el('td', null, view.spoken[i]), el('td', 'num', brl(v)), hasCompare ? el('td', 'num', brl(view.compare[i])) : null));
  });
  table.append(body);
  const details = el('details', 'table-view', el('summary', null, 'Ver os números em tabela'), el('div', 'table-wrap', table));
  root.append(details);
  return root;
}

/**
 * How customers paid: a thin bar split by method (a 2px gap between parts, the methods in a
 * fixed order) above a list with each one's name, amount and share. The list is the legend.
 */
export function methodMix(view, { brl, methodName, family }) {
  const total = view.byMethod.reduce((a, m) => a + m.gross, 0) || 1;
  const bar = el('div', 'mix');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', view.byMethod.map((m, i) => `${methodName(m.method)} ${view.shares[i]}%`).join(', '));
  for (const m of view.byMethod) {
    if (m.gross <= 0) continue;
    const seg = el('span', 'seg-' + family(m.method));
    seg.style.width = `${(100 * m.gross) / total}%`;
    seg.title = `${methodName(m.method)}: ${brl(m.gross)}`;
    bar.append(seg);
  }
  const list = el('ul', 'legend');
  view.byMethod.forEach((m, i) => list.append(el('li', null, el('span', 'sw seg-' + family(m.method)), el('span', null, methodName(m.method)),
    el('span', 'money', brl(m.gross)), el('span', 'pct', `${view.shares[i]}%`))));
  return [bar, list];
}
