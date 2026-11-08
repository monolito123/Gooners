// Pure helpers the console shares with its tests (payments/tools/check.mjs runs them): amounts
// as people type them, and the words and figures of the sales charts, the same rules as both
// apps (Money.parseReais, and Today in the Kotlin and Swift cores).

/**
 * Reais as people type them: "150", "150,5", "1.234,56" (centavos), or null. The same rule as
 * both apps (Money.parseReais): "12.34" is refused, not read as 1.234 or as 12,34.
 */
export function parseReais(s) {
  const m = /^(\d{1,3}(?:\.\d{3})+|\d{1,10})(?:,(\d{1,2}))?$/.exec(String(s).trim());
  return m ? Number(m[1].replaceAll('.', '')) * 100 + Number((m[2] || '').padEnd(2, '0')) : null;
}

/**
 * An asset or foreign-currency quantity as a decimal string for the API ("0,5" → "0.5",
 * "1.234,56" → "1234.56", "0.001" → "0.001"), or null. "1.000" is refused: it could be a
 * thousand or one, and a crypto amount must never be guessed.
 */
export function parseQuantity(s) {
  const t = String(s).trim();
  let m = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d+)$/.exec(t);
  if (m) return `${m[1].replaceAll('.', '')}.${m[2]}`;
  if (/^\d+$/.test(t)) return t;
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(t)) return t.replaceAll('.', '');
  m = /^(\d+)\.(\d+)$/.exec(t);
  if (m && !(m[2].length === 3 && m[1] !== '0')) return t;
  return null;
}

// ---------------------------------------------------------------- the sales charts
// The same functions as Today in the Kotlin and Swift cores, with the same test cases
// (payments/tools/check.mjs): one chart model for a day by hour and a period by day.

const METHOD_NAMES = { credit: 'Crédito', debit: 'Débito', prepaid: 'Pré-pago', card: 'Cartão', pix: 'Pix', crypto: 'Cripto' };
/** A payment method in the merchant's words; an unknown one reads as its code. */
export const methodName = (code) => METHOD_NAMES[code] || String(code).replaceAll('_', ' ');
/** The chart colour family of a method: credit, debit, pix, crypto, or other. */
export const chartFamily = (code) => (['credit', 'debit', 'pix', 'crypto'].includes(code) ? code : 'other');

const STATUSES = {
  captured: ['Paga', 'ok'], partially_refunded: ['Estorno parcial', 'warn'], refunded: ['Estornada', 'info'],
  requires_payment_method: ['Aguardando', 'warn'], requires_action: ['Aguardando', 'warn'], processing: ['Aguardando', 'warn'],
  failed: ['Recusada', 'bad'], canceled: ['Cancelada', ''],
};
/** A payment's state as a word and a chip tone. */
export const statusOf = (code) => STATUSES[code] || [String(code).replaceAll('_', ' '), ''];

/** Whole-percent shares adding up to exactly 100 (largest remainder), in the order given. */
export function shares(parts) {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => (p * 100) / total);
  const out = exact.map((x) => Math.floor(x));
  const left = 100 - out.reduce((a, b) => a + b, 0);
  exact.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, left).forEach(([, i]) => out[i]++);
  return out;
}

/** "+50%", "−12,5%" (a true minus sign), "0%"; null when there is nothing to compare with. */
export function change(pct) {
  if (pct === null || pct === undefined) return null;
  const a = Math.abs(pct);
  const n = Number.isInteger(a) ? String(a) : a.toFixed(1).replace('.', ',');
  return pct > 0 ? `+${n}%` : pct < 0 ? `−${n}%` : '0%';
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const weekdayOf = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
/** "vs. sexta passada até agora" for today; "vs. domingo passado" for a past day. */
export function versus(lastWeekDate, today) {
  const w = weekdayOf(lastWeekDate);
  if (!w) return 'vs. semana passada';
  return `vs. ${w} ${w === 'sábado' || w === 'domingo' ? 'passado' : 'passada'}${today ? ' até agora' : ''}`;
}

const ORDER = ['credit', 'debit', 'prepaid', 'card', 'pix', 'crypto'];
/** Methods in a fixed order, so each keeps its place and colour from one day to the next. */
export const ordered = (parts) => [...parts].sort((a, b) => {
  const ia = ORDER.includes(a.method) ? ORDER.indexOf(a.method) : ORDER.length;
  const ib = ORDER.includes(b.method) ? ORDER.indexOf(b.method) : ORDER.length;
  return ia - ib || (a.method < b.method ? -1 : a.method > b.method ? 1 : 0);
});

// Whole centavos and integer division: every platform rounds the same way.
const idiv = (a, b) => Math.floor(a / b);
const tenths = (t, whole) => (whole ? String(idiv(t + 5, 10)) : t % 10 === 0 ? String(t / 10) : `${idiv(t, 10)},${t % 10}`);
/** An axis label: "R$ 900", "R$ 2,5 mil", "R$ 12 mil", "R$ 1,3 mi". */
export function compact(centavos) {
  const c = Math.max(0, centavos);
  const reais = idiv(c + 50, 100);
  if (reais < 1000) return `R$ ${reais}`;
  if (reais < 1_000_000) return `R$ ${tenths(idiv(c + 5000, 10000), reais >= 10000)} mil`;
  return `R$ ${tenths(idiv(c + 5_000_000, 10_000_000), reais >= 10_000_000)} mi`;
}

/** The y-axis lines from 0 up to the first clean step at or above max, three steps at most. */
export function ticks(max) {
  if (max <= 0) return [0, 10000];
  const raw = idiv(max + 2, 3);
  let p = 100;
  while (p * 10 <= raw) p *= 10;
  const step = [10, 20, 25, 50, 100].map((f) => (f * p) / 10).find((x) => x >= raw && x >= 100) ?? p * 10;
  const n = idiv(max + step - 1, step);
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}

/** Which buckets get an x-axis label: every one up to 8, else about six, the last always. */
export function axis(n) {
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  if (n === 24) return [0, 6, 12, 18, 23];
  const step = idiv(n - 1 + 4, 5);
  const out = [];
  for (let i = 0; i < n - 1 - idiv(step, 2); i += step) out.push(i);
  out.push(n - 1);
  return out;
}

const ddMM = (iso) => {
  const p = iso.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
};
const signOf = (pct) => (pct === null || pct === undefined || pct === 0 ? 0 : pct > 0 ? 1 : -1);
const maxOf = (...lists) => Math.max(0, ...lists.flat());

/** A day by hour, against the same weekday last week. */
export function dayView(d, today) {
  const buckets = d.hourly?.length ? d.hourly : Array(24).fill(0);
  const lw = d.last_week;
  const compare = lw?.hourly?.length === buckets.length ? lw.hourly : [];
  const parts = ordered(d.by_method);
  const vs = lw ? versus(lw.date, today) : 'vs. semana passada';
  return {
    title: today ? 'Hoje' : 'Dia', range: ddMM(d.date),
    gross: d.gross, net: d.net, fees: d.fees, refunded: d.refunded, sales: d.sales, averageTicket: d.average_ticket,
    change: change(lw?.change_pct), changeSign: signOf(lw?.change_pct), versus: vs,
    focusName: today ? 'Hoje' : ddMM(d.date), compareName: vs.replace(/^vs\. /, '').replace(/ até agora$/, ''),
    buckets, compare, labels: buckets.map((_, i) => `${i}h`), spoken: buckets.map((_, i) => `${i}h às ${(i + 1) % 24}h`),
    axis: axis(buckets.length), ticks: ticks(maxOf(buckets, compare)),
    byMethod: parts, shares: shares(parts.map((m) => m.gross)),
    waitingCount: d.waiting?.count || 0, waitingAmount: d.waiting?.amount || 0,
    empty: today ? 'Nenhuma venda ainda hoje. A primeira aparece aqui na hora.' : 'Nenhuma venda neste dia.',
  };
}

/** A period by day, against the period just before; today is YYYY-MM-DD in Brasília. */
export function periodView(p, today) {
  const endsToday = p.to === today;
  const buckets = p.daily.map((d) => d.gross);
  const compare = p.previous.daily.length === buckets.length ? p.previous.daily : [];
  const parts = ordered(p.by_method);
  return {
    title: endsToday ? `Últimos ${p.days} dias` : `${p.days} dias`, range: `${ddMM(p.from)} a ${ddMM(p.to)}`,
    gross: p.gross, net: p.net, fees: p.fees, refunded: p.refunded, sales: p.sales, averageTicket: p.average_ticket,
    change: change(p.previous.change_pct), changeSign: signOf(p.previous.change_pct),
    versus: `vs. os ${p.days} dias anteriores${endsToday ? ' até agora' : ''}`,
    focusName: `Estes ${p.days} dias`, compareName: `${p.days} dias anteriores`,
    buckets, compare, labels: p.daily.map((d) => ddMM(d.date)), spoken: p.daily.map((d) => `${weekdayOf(d.date)}, ${ddMM(d.date)}`),
    axis: axis(buckets.length), ticks: ticks(maxOf(buckets, compare)),
    byMethod: parts, shares: shares(parts.map((m) => m.gross)),
    waitingCount: 0, waitingAmount: 0, empty: `Nenhuma venda nestes ${p.days} dias.`,
  };
}
