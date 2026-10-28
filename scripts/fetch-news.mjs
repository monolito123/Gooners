#!/usr/bin/env node
// Coleta os feeds de law/data/feeds.json no servidor (sem CORS) e grava law/data/news.json.
// Uso: node scripts/fetch-news.mjs   (Node 18+; sem dependências)
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../law/data/', import.meta.url);
const { feeds } = JSON.parse(await readFile(new URL('feeds.json', root), 'utf8'));
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
const text = (s) => decode(decode(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await getOnce(url); } catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
}

async function getOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; GoonersLawNewsBot/1.0)', accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parse(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, 40).map((b) => {
    let title = text(tag(b, 'title'));
    const source = text(tag(b, 'source')) || feed.source || feed.name;
    if (title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    let desc = text(tag(b, 'description'));
    if (!desc || norm(desc).startsWith(norm(title).slice(0, 40))) desc = '';
    const date = Date.parse(text(tag(b, 'pubDate')) || text(tag(b, 'dc:date')));
    return { title, link: text(tag(b, 'link')), source, desc: desc.slice(0, 280), date: isNaN(date) ? Date.now() : date, cats: [feed.cat] };
  }).filter((x) => x.title && /^https?:/.test(x.link));
}

const sources = {};
const all = [];
await Promise.all(feeds.map(async (f) => {
  try {
    const list = parse(await get(f.type === 'gnews' ? gnews(f.q) : f.url), f);
    sources[f.name] = [true, list.length];
    all.push(...list);
  } catch (e) {
    sources[f.name] = [false, 0];
    console.warn(`✗ ${f.name}: ${e.message}`);
  }
}));

const map = new Map();
for (const it of all.sort((a, b) => b.date - a.date)) {
  const k = norm(it.title);
  if (!map.has(k)) map.set(k, it);
  else if (!map.get(k).cats.includes(it.cats[0])) map.get(k).cats.push(it.cats[0]);
}
const items = [...map.values()].filter((x) => x.date < Date.now() + 36e5).slice(0, 300);
if (!items.length) { console.error('Nenhuma notícia coletada — news.json mantido.'); process.exit(0); }
await writeFile(new URL('news.json', root), JSON.stringify({ updated: Date.now(), sources, items }));
console.log(`✓ ${items.length} notícias de ${Object.values(sources).filter((s) => s[0]).length}/${feeds.length} fontes`);
