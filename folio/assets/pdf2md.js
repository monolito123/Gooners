/* Fólio — motor de conversão PDF → Markdown.
   1. extract(): lê a camada de texto com o pdf.js (posição, tamanho e estilo de cada trecho).
   2. convert(): reconstrói linhas, colunas, parágrafos, títulos, citações recuadas, listas e tabelas;
      remove cabeçalhos e rodapés repetidos e os carimbos de assinatura (PJe, SEI, e-SAJ). */
(function () {
  'use strict';
  const F = (window.Folio = window.Folio || {});

  // ---------- padrões de carimbos e numeração ----------
  const STAMP_LINE = [
    /^assinado eletronicamente por:?\s/i,
    /^documento assinado eletronicamente por\s/i,
    /^assinado (digitalmente|com certificado digital) por\s/i,
    /^este documento (é c[óo]pia do original|foi (gerado|assinado|protocolado|liberado|juntado))/i,
    /^para conferir o original/i,
    /^a autenticidade (deste|do) documento pode ser conferida/i,
    /^n[úu]mero do documento:\s*\d+/i,
    /consultadocumento\/listview\.seam/i,
    /^https?:\/\/\S*(pje|consultapublica|autenticidade|verificador|conferencia|sei\b|esaj)\S*/i,
    /^num\.\s*\d+\s*[-–]\s*p[áa]g\.\s*\d+$/i,
    /^c[óo]digo (verificador|de valida[çc][ãa]o|crc|de autentica[çc][ãa]o)/i,
    /^id\.?\s*do documento:?\s*\d+/i,
  ];
  const PAGE_NUM = [
    /^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?$/i,
    /^[-–—]\s*\d{1,4}\s*[-–—]$/,
    /^fls?\.?\s*\d{1,5}(\s*(v|verso))?$/i,
  ];
  const RE_PJE_ID = /Num\.\s*(\d{4,})\s*[-–]\s*P[áa]g\.\s*(\d+)/i;
  const RE_SIG_PJE = /Assinado eletronicamente por:?\s*(.+?)\s*[-–]\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/i;
  const RE_SIG_SEI = /Documento assinado eletronicamente por\s+(.+?),\s*(.+?),\s*em\s*(\d{2}\/\d{2}\/\d{4})(?:,?\s*[àa]s\s*(\d{1,2}[:h]\d{2}))?/i;
  const RE_CNJ = /\b(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})\b/g;
  const BULLET = /^[•●▪◦‣∙·■□➢►\-–—*]\s+/;
  const ORDERED = /^(\d{1,3})[.)]\s+(?=\S)/;
  const LETTERED = /^(?:[a-zA-Z]|[ivxlc]{1,6}|[IVXLC]{1,6})\s*[.)–—-]\s+(?=\S)/;

  F.cnjValid = (digits) => {
    const d = String(digits).replace(/\D/g, '');
    if (d.length !== 20) return false;
    const n = d.slice(0, 7), dv = d.slice(7, 9), rest = d.slice(9);
    return mod97(n + rest + dv) === 1;
  };
  function mod97(str) { let r = 0; for (const ch of str) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97; return r; }
  F.mod97 = mod97;

  function styleOfFont(font) {
    if (!font) return { b: false, i: false };
    const name = String(font.name || font.loadedName || '');
    const b = !!(font.bold || font.black) || /bold|black|heavy|semibold|demi|[-,+]bd\b|[-,]b$/i.test(name);
    const i = !!font.italic || /italic|oblique|[-,]it\b|[-,]i$/i.test(name);
    return { b, i };
  }

  // ---------- 1. extração ----------
  async function extract(pdf, { pages, fonts = true, onProgress, signal } = {}) {
    const list = pages && pages.length ? pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const out = [];
    const Util = window.pdfjsLib.Util;
    for (let k = 0; k < list.length; k++) {
      if (signal && signal.aborted) throw new DOMException('Conversão cancelada', 'AbortError');
      const n = list[k];
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const fontMap = {};
      if (fonts) {
        try { await page.getOperatorList(); } catch { /* ignora */ }
        const names = [...new Set(tc.items.map((it) => it.fontName).filter(Boolean))];
        await Promise.all(names.map((fn) => new Promise((res) => {
          let done = false;
          const t = setTimeout(() => { if (!done) { done = true; res(); } }, 700);
          try {
            page.commonObjs.get(fn, (font) => { if (done) return; done = true; clearTimeout(t); fontMap[fn] = styleOfFont(font); res(); });
          } catch { done = true; clearTimeout(t); res(); }
        })));
      }
      const items = [], side = [];
      for (const it of tc.items) {
        if (!it || typeof it.str !== 'string' || !it.str.length) continue;
        const m = Util.transform(vp.transform, it.transform);
        const horizontal = Math.abs(m[1]) < 0.05 * Math.abs(m[0]) && m[0] > 0;
        if (!horizontal) { if (it.str.trim()) side.push(it.str); continue; }
        let size = Math.hypot(m[2], m[3]);
        if (!(size > 0.5)) size = it.height || 10;
        const st = fontMap[it.fontName] || { b: false, i: false };
        items.push({ str: it.str, x: m[4], y: m[5], w: Math.max(0, it.width || 0), size, b: st.b, i: st.i });
      }
      out.push({ num: n, width: vp.width, height: vp.height, items, side: side.join(' ').replace(/\s+/g, ' ').trim() });
      page.cleanup();
      if (onProgress) onProgress(k + 1, list.length);
    }
    return out;
  }

  // ---------- 2. linhas ----------
  function buildLines(pg) {
    const items = pg.items.filter((it) => it.str.trim() || it.w > 0).slice().sort((p, q) => p.y - q.y || p.x - q.x);
    const lines = [];
    for (const it of items) {
      const top = it.y - it.size * 0.8, bot = it.y + it.size * 0.22;
      let best = null, bestOv = 0;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 8; k--) {
        const L = lines[k];
        const ov = Math.min(bot, L.bot) - Math.max(top, L.top);
        const minH = Math.min(bot - top, L.bot - L.top);
        if (ov > 0.5 * minH && ov > bestOv) { best = L; bestOv = ov; }
      }
      if (best) { best.items.push(it); best.top = Math.min(best.top, top); best.bot = Math.max(best.bot, bot); }
      else lines.push({ items: [it], top, bot });
    }
    const res = [];
    for (const L of lines) {
      const its = L.items.sort((p, q) => p.x - q.x);
      // negrito simulado (mesmo texto desenhado duas vezes, levemente deslocado)
      const uniq = [];
      for (const it of its) {
        const dup = uniq.find((u) => u.str === it.str && Math.abs(u.x - it.x) < Math.max(1.2, it.size * 0.12) && Math.abs(u.y - it.y) < 1.5);
        if (dup) { dup.b = true; continue; }
        uniq.push(it);
      }
      const visible = uniq.filter((it) => it.str.trim());
      if (!visible.length) continue;
      // tamanho dominante (ponderado pelo número de caracteres) e linha de base
      const sizes = {};
      for (const it of visible) { const s = Math.round(it.size * 2) / 2; sizes[s] = (sizes[s] || 0) + it.str.trim().length; }
      const size = +Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0];
      const main = visible.filter((it) => Math.abs(it.size - size) < 0.6);
      const y = (main.length ? main : visible).reduce((s, it) => s + it.y, 0) / (main.length || visible.length);
      // fragmentos: trechos separados por um vão grande (colunas, tabelas)
      const frags = [];
      let cur = null, prev = null, pendingSpace = false;
      const splitGap = Math.max(1.5 * size, 12);
      for (const it of uniq) {
        if (!it.str.trim()) { if (cur) pendingSpace = true; continue; }
        const gap = prev ? it.x - (prev.x + prev.w) : 0;
        if (!cur || gap > splitGap) {
          cur = { x0: it.x, x1: it.x + it.w, runs: [] };
          frags.push(cur);
        } else if ((pendingSpace || gap > 0.18 * size) && !/\s$/.test(prev.str) && !/^\s/.test(it.str)) {
          cur.runs.push({ t: ' ', b: prev.b, i: prev.i });
        }
        pendingSpace = false;
        cur.runs.push({ t: it.str, b: it.b, i: it.i });
        cur.x1 = Math.max(cur.x1, it.x + it.w);
        prev = it;
      }
      for (const f of frags) { f.runs = tidyRuns(f.runs); f.text = runsText(f.runs); }
      const fr = frags.filter((f) => f.text.trim());
      if (!fr.length) continue;
      const line = makeLine(pg, fr, y, size, L.top, L.bot);
      line.ocr = visible.some((it) => it.ocr);
      res.push(line);
    }
    res.sort((a, b) => a.y - b.y || a.x0 - b.x0);
    return res;
  }
  function makeLine(pg, frags, y, size, top, bot) {
    const runs = [];
    frags.forEach((f, k) => { if (k) runs.push({ t: ' ', b: false, i: false, gap: true }); runs.push(...f.runs); });
    const text = runsText(runs).replace(/\s+/g, ' ').trim();
    const letters = runs.filter((r) => /\S/.test(r.t));
    return {
      page: pg.num, pw: pg.width, ph: pg.height, y, top, bot, size, frags, runs, text,
      x0: frags[0].x0, x1: frags[frags.length - 1].x1, col: 0,
      bold: letters.length > 0 && letters.every((r) => r.b),
      italic: letters.length > 0 && letters.every((r) => r.i),
    };
  }
  const runsText = (runs) => runs.map((r) => r.t).join('');
  function tidyRuns(runs) {
    const out = [];
    for (const r of runs) {
      const t = r.t.replace(/\u00a0/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
      if (!t) continue;
      const last = out[out.length - 1];
      if (last && last.b === r.b && last.i === r.i) last.t += t;
      else out.push({ t, b: !!r.b, i: !!r.i });
    }
    return out;
  }

  // ---------- 3. colunas (ex.: Diário da Justiça em duas colunas) ----------
  function splitColumns(lines, pg) {
    const frags = [];
    lines.forEach((L, li) => L.frags.forEach((f) => frags.push({ f, L, li })));
    const N = frags.length;
    if (N < 12) return null;
    const W = pg.width;
    let best = null;
    for (let x = 0.3 * W; x <= 0.7 * W; x += 2) {
      let cross = 0;
      for (const { f } of frags) if (f.x0 < x - 2 && f.x1 > x + 2) cross++;
      if (!best || cross < best.cross) best = { x, cross, x2: x };
      else if (cross === best.cross && x - best.x2 <= 2.01) best.x2 = x;
    }
    const gx = (best.x + best.x2) / 2;
    const left = frags.filter(({ f }) => f.x1 <= gx + 2).length;
    const right = frags.filter(({ f }) => f.x0 >= gx - 2).length;
    const both = lines.filter((L) => L.frags.some((f) => f.x1 <= gx + 2) && L.frags.some((f) => f.x0 >= gx - 2)).length;
    if (!(best.cross <= 0.12 * N && left >= 0.2 * N && right >= 0.2 * N && both >= 3)) return null;
    const out = [];
    let colL = [], colR = [];
    const flush = () => { out.push(...colL, ...colR); colL = []; colR = []; };
    for (const L of lines) {
      const spans = L.frags.filter((f) => f.x0 < gx - 2 && f.x1 > gx + 2);
      if (spans.length) { flush(); out.push(Object.assign(makeLine(pg, L.frags, L.y, L.size, L.top, L.bot), { col: 0 })); continue; }
      const lf = L.frags.filter((f) => f.x1 <= gx + 2), rf = L.frags.filter((f) => f.x0 >= gx - 2);
      if (lf.length) colL.push(Object.assign(makeLine(pg, lf, L.y, L.size, L.top, L.bot), { col: 1 }));
      if (rf.length) colR.push(Object.assign(makeLine(pg, rf, L.y, L.size, L.top, L.bot), { col: 2 }));
    }
    flush();
    return out;
  }

  // ---------- utilidades estatísticas ----------
  function mode(values, weights) {
    const m = new Map();
    values.forEach((v, i) => m.set(v, (m.get(v) || 0) + (weights ? weights[i] : 1)));
    let best = null, bw = -1;
    for (const [v, w] of m) if (w > bw) { best = v; bw = w; }
    return best;
  }
  const normKey = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const isUpper = (t) => { const letters = t.replace(/[^\p{L}]/gu, ''); return letters.length >= 3 && letters === letters.toLocaleUpperCase('pt-BR'); };

  // ---------- 4. conversão ----------
  function convert(pagesData, opts = {}) {
    const o = Object.assign({
      markers: 'comment', headers: true, stamps: true, headings: true, styles: true, quotes: true,
      tables: true, dehyphen: true, columns: true, frontMatter: false, pjeDocs: true, fileName: '', title: '',
    }, opts);
    const meta = { pages: pagesData.length, removed: new Map(), signatures: [], pageIds: {}, docs: [], cnj: [], headings: [], emptyPages: [], side: [], ocrPages: [] };

    // linhas por página
    const pages = pagesData.map((pg) => {
      let lines = buildLines(pg);
      if (o.columns) { const c = splitColumns(lines, pg); if (c) lines = c; }
      return { pg, lines };
    });

    // assinaturas e IDs do PJe (sempre extraídos, para os detalhes)
    const sigSeen = new Set();
    for (const { pg, lines } of pages) {
      for (const L of lines) {
        const id = RE_PJE_ID.exec(L.text);
        if (id && !meta.pageIds[pg.num]) meta.pageIds[pg.num] = { id: id[1], p: +id[2] };
        let s = RE_SIG_PJE.exec(L.text);
        if (s) { const key = s[1] + s[2]; if (!sigSeen.has(key)) { sigSeen.add(key); meta.signatures.push({ name: s[1].trim(), when: s[2], page: pg.num, sys: 'PJe' }); } }
        s = RE_SIG_SEI.exec(L.text);
        if (s) { const key = s[1] + s[3]; if (!sigSeen.has(key)) { sigSeen.add(key); meta.signatures.push({ name: s[1].trim(), role: s[2].trim(), when: s[3] + (s[4] ? ' ' + s[4] : ''), page: pg.num, sys: 'SEI' }); } }
      }
      if (pg.side) meta.side.push({ page: pg.num, text: pg.side });
    }

    // cabeçalhos e rodapés repetidos
    const T = pages.length;
    const zoneOf = (L, idx, n) => (idx < 4 && L.bot < L.ph * 0.16) || (idx >= n - 4 && L.top > L.ph * 0.84);
    const keyPages = new Map();
    if (o.headers && T >= 2) {
      for (const { pg, lines } of pages) {
        const seen = new Set();
        lines.forEach((L, idx) => {
          if (!zoneOf(L, idx, lines.length)) return;
          const k = normKey(L.text);
          if (k.length < 2 || seen.has(k)) return;
          seen.add(k);
          const e = keyPages.get(k) || { n: 0, ys: [] };
          e.n++; e.ys.push(L.y / L.ph);
          keyPages.set(k, e);
        });
        void pg;
      }
    }
    const minRepeat = Math.max(2, Math.ceil(T * 0.5));
    for (const P of pages) {
      const { lines } = P;
      const keep = [];
      let stampFrom = Infinity;
      lines.forEach((L, idx) => {
        const t = L.text;
        let drop = null;
        if (o.stamps && (STAMP_LINE.some((re) => re.test(t)) || RE_PJE_ID.test(t) && t.replace(RE_PJE_ID, '').trim().length < 70 && L.top > L.ph * 0.7)) {
          drop = 'Carimbo de assinatura/autenticação';
          if (L.top > L.ph * 0.72) stampFrom = Math.min(stampFrom, L.top);
        } else if (o.stamps && L.top > stampFrom - 1) drop = 'Carimbo de assinatura/autenticação';
        else if (o.headers && zoneOf(L, idx, lines.length)) {
          if (PAGE_NUM.some((re) => re.test(t))) drop = 'Número de página';
          else if (T >= 2) {
            // repetido em boa parte das páginas e sempre na mesma altura (cabeçalho ou rodapé de verdade)
            const e = keyPages.get(normKey(t));
            if (e && e.n >= minRepeat && Math.max(...e.ys) - Math.min(...e.ys) < 0.02) drop = 'Cabeçalho/rodapé repetido: ' + t.replace(/\d+/g, '#').slice(0, 90);
          }
        }
        if (drop) meta.removed.set(drop, (meta.removed.get(drop) || 0) + 1);
        else keep.push(L);
      });
      P.lines = keep;
      const chars = keep.reduce((s, L) => s + L.text.replace(/\s/g, '').length, 0);
      if (chars < 25 && !P.pg.ocr) meta.emptyPages.push(P.pg.num);
      if (P.pg.ocr) meta.ocrPages.push(P.pg.num);
    }

    // métricas do corpo do texto
    const all = pages.flatMap((P) => P.lines);
    const body = all.length ? mode(all.map((L) => Math.round(L.size * 2) / 2), all.map((L) => L.text.length)) : 12;
    const bodyLines = all.filter((L) => Math.abs(L.size - body) <= 0.75);
    const margins = {};
    for (const col of [0, 1, 2]) {
      const ls = bodyLines.filter((L) => L.col === col);
      if (!ls.length) continue;
      const left = mode(ls.map((L) => Math.round(L.x0)), ls.map((L) => L.text.length));
      const xs = ls.map((L) => L.x1).sort((a, b) => a - b);
      const right = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))];
      margins[col] = { left, right };
    }
    const mg = (L) => margins[L.col] || margins[0] || margins[1] || { left: 0, right: L.pw };
    const gaps = [];
    for (const P of pages) for (let k = 1; k < P.lines.length; k++) {
      const a = P.lines[k - 1], b = P.lines[k];
      if (a.col === b.col && Math.abs(a.size - body) <= 0.75 && Math.abs(b.size - body) <= 0.75) { const g = b.y - a.y; if (g > body * 0.8 && g < body * 3) gaps.push(Math.round(g * 2) / 2); }
    }
    const lineGap = gaps.length ? mode(gaps) : body * 1.3;

    // vizinhança e classificação de cada linha
    const seq = [];
    for (const P of pages) P.lines.forEach((L, k) => {
      const prev = P.lines[k - 1], next = P.lines[k + 1];
      L.gapBefore = prev && prev.col === L.col ? L.y - prev.y : Infinity;
      L.gapAfter = next && next.col === L.col ? next.y - L.y : Infinity;
      const m = mg(L), width = m.right - m.left;
      L.centered = L.x0 > m.left + 0.08 * width && Math.abs((L.x0 + L.x1) / 2 - (m.left + m.right) / 2) < 0.06 * width && L.x1 - L.x0 < 0.85 * width;
      L.indent = L.x0 - m.left;
      L.short = L.x1 < m.right - Math.max(2.5 * L.size, 0.06 * width);
      seq.push(L);
    });

    // títulos
    // em páginas com OCR o tamanho vem da altura da linha, que oscila: exige mais evidência
    const isBig = (L) => L.text.length <= 160 && (L.ocr ? L.size >= body * 1.22 && (L.centered || L.text.split(/\s+/).length <= 6) : L.size >= body * 1.15);
    const bigSizes = [...new Set(seq.filter(isBig).map((L) => Math.round(L.size)))].sort((a, b) => b - a);
    const isolated = (L) => L.gapBefore > lineGap * 1.3 || L.gapAfter > lineGap * 1.3;
    for (const L of seq) {
      L.kind = 'text';
      const t = L.text;
      if (BULLET.test(t) && t.length > 2) { L.kind = 'li'; L.ordered = false; continue; }
      if (ORDERED.test(t) && !(o.headings && L.bold && isUpper(t) && t.length < 100)) { L.kind = 'li'; L.ordered = true; continue; }
      if (!o.headings) { if (LETTERED.test(t)) L.listStart = true; continue; }
      const words = t.split(/\s+/).length;
      if (t.length > 160 || words > 22 || /[,;]$/.test(t) || !/\p{L}{2}/u.test(t)) { if (LETTERED.test(t)) L.listStart = true; continue; }
      if (isBig(L)) { L.kind = 'h'; L.level = Math.min(3, bigSizes.indexOf(Math.round(L.size)) + 1 || 3); continue; }
      if (L.ocr && L.size >= body * 1.1) { if (LETTERED.test(t)) L.listStart = true; continue; }
      const caps = isUpper(t);
      if (Math.abs(L.size - body) <= 0.75 || L.size < body) {
        if (L.bold && words <= 16 && (isolated(L) || L.centered) && !/[.:]$/.test(t) || (L.bold && caps && words <= 12 && isolated(L))) { L.kind = 'h'; L.level = caps ? 2 : 3; continue; }
        if (caps && L.centered && isolated(L) && words <= 10 && !/[.:;]$/.test(t)) { L.kind = 'h'; L.level = 2; continue; }
      }
      if (LETTERED.test(t)) L.listStart = true;
    }
    if (bigSizes.length === 0) for (const L of seq) if (L.kind === 'h' && L.level === 3 && seq.every((x) => x.kind !== 'h' || x.level !== 2)) L.level = 2;

    // ---------- agrupamento em blocos ----------
    const blocks = [];
    let cur = null, lastPage = null, lastId = null;
    const docSig = (page) => meta.signatures.find((s) => s.page === page) || null;
    const multiDocs = new Set(Object.values(meta.pageIds).map((v) => v.id)).size >= 2;
    const continues = (B, L) => {
      if (!B || !['p', 'li', 'quote'].includes(B.type) || L.kind !== 'text' || L.listStart) return false;
      const P = B.lines[B.lines.length - 1];
      if (Math.abs(L.size - P.size) > (L.ocr || P.ocr ? 0.3 : 0.12) * Math.max(L.size, P.size)) return false;
      if (B.type === 'quote' && L.indent < 1.2 * body) return false;
      const ended = /[.:;!?…"”)\]]$/.test(P.text);
      if (/^[a-zà-ú(,;]/.test(L.text)) return true;
      return !ended && !P.short;
    };
    const newBlock = (type, L, extra) => { cur = Object.assign({ type, lines: [L], page: L.page }, extra || {}); blocks.push(cur); return cur; };

    for (let k = 0; k < seq.length; k++) {
      const L = seq[k];
      const P = cur && cur.lines[cur.lines.length - 1];
      // mudança de página
      if (L.page !== lastPage) {
        const idInfo = meta.pageIds[L.page];
        if (o.pjeDocs && multiDocs && idInfo && idInfo.id !== lastId) {
          const sig = docSig(L.page);
          blocks.push({ type: 'doc', id: idInfo.id, sig, page: L.page });
          cur = null;
        }
        if (idInfo) lastId = idInfo.id;
        const carry = lastPage != null && cur && continues(cur, L);
        if (lastPage != null || o.markers !== 'none') {
          if (carry) cur.lines.push({ marker: L.page });
          else blocks.push({ type: 'page', page: L.page, id: idInfo ? idInfo.id : null, ip: idInfo ? idInfo.p : null });
        }
        lastPage = L.page;
        if (carry) { cur.lines.push(L); continue; }
        cur = null;
      }
      if (L.kind === 'h') {
        if (cur && cur.type === 'h' && cur.level === L.level && P && P.page === L.page && L.gapBefore < lineGap * 1.6 && Math.abs(P.size - L.size) < 0.6) { cur.lines.push(L); continue; }
        newBlock('h', L, { level: L.level });
        continue;
      }
      if (L.kind === 'li') { newBlock('li', L, { ordered: L.ordered }); continue; }
      // texto corrido
      let start = !cur || cur.type === 'h' || cur.type === 'table';
      if (!start && P) {
        if (P.col !== L.col) start = !continues(cur, L);
        else {
          if (Math.abs(L.size - P.size) > (L.ocr || P.ocr ? 0.3 : 0.12) * Math.max(L.size, P.size)) start = true;
          else if (L.gapBefore > lineGap * 1.45 + 0.5) start = true;
          else if (L.listStart) start = true;
          else if (L.x0 > P.x0 + 1.2 * body && cur.type !== 'li') start = true; // recuo de primeira linha
          else if (cur.type === 'li' && L.x0 < cur.lines[0].x0 - 2 && L.indent < 0.5 * body && P.short) start = true;
          else if (P.short && /[.:;!?…"”)]$/.test(P.text)) start = true;
          else if (P.short && /^[\p{Lu}][\p{L}º°ª.\s]{1,28}:\s/u.test(L.text)) start = true; // campos: "Classe: ..."
          else if (P.x1 - P.x0 < 0.6 * (mg(P).right - mg(P).left) && /^[\p{Lu}]/u.test(L.text) && !/[,\-]$/.test(P.text)) start = true;
          else if (P.centered && P.short) start = true;
          else if (cur.type === 'quote' && L.indent < 1.2 * body) start = true;
        }
      }
      if (start) newBlock('p', L);
      else cur.lines.push(L);
    }

    // citações recuadas (≥ 2,5 corpos ou 10% da largura; fonte menor reforça)
    if (o.quotes) for (const B of blocks) {
      if (B.type !== 'p') continue;
      const ls = B.lines.filter((x) => !x.marker);
      if (!ls.length) continue;
      const m = mg(ls[0]), width = m.right - m.left;
      const minInd = Math.max(2.5 * body, 0.1 * width);
      const smaller = ls.every((x) => x.size <= body * 0.93);
      const listy = BULLET.test(ls[0].text) || ORDERED.test(ls[0].text) || LETTERED.test(ls[0].text);
      const indented = ls.every((x) => x.indent >= minInd && !x.centered);
      if ((indented && (ls.length >= 2 || smaller) && (!listy || smaller)) || (smaller && ls.every((x) => x.indent >= 1.2 * body && !x.centered))) B.type = 'quote';
    }

    // tabelas
    if (o.tables) detectTables(blocks, lineGap);

    // ---------- 5. Markdown ----------
    const md = [];
    const mark = (n) => o.markers === 'comment' ? `<!-- p. ${n} -->` : o.markers === 'text' ? `*[p. ${n}]*` : '';
    let firstContent = true;
    for (const B of blocks) {
      if (B.type === 'page') {
        if (o.markers === 'none') continue;
        const extra = B.id ? (o.markers === 'comment' ? ` · ID ${B.id}, p. ${B.ip}` : ` · ID ${B.id}`) : '';
        md.push(o.markers === 'comment' ? `<!-- página ${B.page}${extra} -->` : `*[p. ${B.page}${extra}]*`);
        continue;
      }
      if (B.type === 'doc') {
        if (!firstContent) md.push('---');
        md.push(`**Documento ID ${B.id}**` + (B.sig ? ` · assinado eletronicamente por ${escapeMd(B.sig.name)} em ${B.sig.when}` : ''));
        continue;
      }
      firstContent = false;
      if (B.type === 'h') {
        const text = B.lines.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
        md.push('#'.repeat(B.level) + ' ' + escapeMd(text).replace(/^(\d+)\./, '$1\\.'));
        meta.headings.push({ level: B.level, text, page: B.page });
        continue;
      }
      if (B.type === 'table') { md.push(tableMd(B.rows)); continue; }
      let text = joinLines(B.lines, o, mark).trim();
      if (!text) continue;
      if (B.type === 'li') {
        text = B.ordered ? text.replace(/^(\d{1,3})[.)]\s+/, '$1. ') : text.replace(/^(\\?[•●▪◦‣∙·■□➢►\-–—*])\s+/, '- ');
        md.push(text);
      } else if (B.type === 'quote') {
        md.push(text.split('\n').map((l) => '> ' + l).join('\n'));
      } else {
        md.push(text.replace(/^(\d+)([.)])(\s)/, '$1\\$2$3').replace(/^([#>+])/, '\\$1').replace(/^([-*])(\s)/, '\\$1$2'));
      }
    }
    // listas consecutivas sem linha em branco entre os itens
    let out = '';
    md.forEach((chunk, idx) => {
      if (!chunk) return;
      const prev = md[idx - 1];
      const tight = prev && /^(- |\d+\. )/.test(chunk) && /^(- |\d+\. )/.test(prev) && chunk.length < 160 && prev.length < 160;
      out += (out ? (tight ? '\n' : '\n\n') : '') + chunk;
    });

    // CNJ, documentos
    const seenCnj = new Set();
    for (const m of out.matchAll(RE_CNJ)) {
      const digits = m.slice(1).join('');
      if (seenCnj.has(digits) || !F.cnjValid(digits)) continue;
      seenCnj.add(digits);
      meta.cnj.push(`${m[1]}-${m[2]}.${m[3]}.${m[4]}.${m[5]}.${m[6]}`);
    }
    const docMap = new Map();
    for (const [p, v] of Object.entries(meta.pageIds)) { if (!docMap.has(v.id)) docMap.set(v.id, []); docMap.get(v.id).push(+p); }
    meta.docs = [...docMap].map(([id, ps]) => ({ id, pages: ps, sig: docSig(ps[0]) }));

    if (o.frontMatter) {
      const y = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      const fm = ['---', 'titulo: ' + y(o.title || F.baseName(o.fileName)), 'arquivo: ' + y(o.fileName || ''), 'paginas: ' + meta.pages];
      if (meta.cnj.length) fm.push('processo: ' + y(meta.cnj[0]));
      if (meta.docs.length) fm.push('documentos_pje: [' + meta.docs.map((d) => d.id).join(', ') + ']');
      if (meta.signatures.length) fm.push('assinaturas:', ...meta.signatures.map((s) => `  - nome: ${y(s.name)}\n    data: ${y(s.when)}`));
      fm.push('convertido_em: ' + new Date().toISOString().slice(0, 10), '---', '');
      out = fm.join('\n') + '\n' + out;
    }
    meta.bodySize = body;
    meta.lineGap = lineGap;
    meta.removed = [...meta.removed].map(([what, count]) => ({ what, count }));
    return { markdown: out.trim() + '\n', meta };
  }

  // junta as linhas de um bloco, desfazendo hifenização e preservando negrito/itálico
  function joinLines(lines, o, mark) {
    const runs = [];
    let pendingMarker = null;
    for (const L of lines) {
      if (L.marker) { pendingMarker = L.marker; continue; }
      const lr = L.runs.map((r) => ({ t: r.gap ? ' ' : r.t, b: r.b, i: r.i }));
      if (runs.length) {
        const last = runs[runs.length - 1];
        const firstChar = (lr.find((r) => r.t.trim()) || { t: '' }).t.trimStart()[0] || '';
        const hy = /([\p{L}])[-\u2010\u00ad]\s*$/u;
        if (o.dehyphen && hy.test(last.t) && /\p{Ll}/u.test(firstChar)) {
          last.t = last.t.replace(/[-\u2010\u00ad]\s*$/u, '');
          if (pendingMarker) { runs.push({ t: '', marker: pendingMarker }); pendingMarker = null; }
          lr[0].t = lr[0].t.trimStart();
        } else {
          last.t = last.t.replace(/\u00ad\s*$/, '').replace(/\s+$/, '');
          runs.push({ t: ' ', b: last.b, i: last.i, space: true });
          if (pendingMarker) { runs.push({ t: '', marker: pendingMarker }); runs.push({ t: ' ', b: false, i: false, space: true }); pendingMarker = null; }
        }
      }
      runs.push(...lr);
    }
    return runsToMd(runs, o.styles, mark);
  }

  function runsToMd(runs, styles, mark) {
    // espaços adotam o estilo dos vizinhos quando ambos coincidem
    const rs = runs.map((r) => Object.assign({}, r));
    for (let k = 0; k < rs.length; k++) {
      if (rs[k].marker || rs[k].t.trim()) continue;
      const a = rs[k - 1], b = rs[k + 1];
      if (a && b && !a.marker && !b.marker && a.b === b.b && a.i === b.i) { rs[k].b = a.b; rs[k].i = a.i; } else { rs[k].b = false; rs[k].i = false; }
    }
    const merged = [];
    for (const r of rs) {
      const last = merged[merged.length - 1];
      if (!r.marker && last && !last.marker && last.b === r.b && last.i === r.i) last.t += r.t;
      else merged.push(Object.assign({}, r));
    }
    let out = '';
    for (const r of merged) {
      if (r.marker) { const m = mark(r.marker); out += m ? m : ''; continue; }
      const t = escapeMd(r.t).replace(/[ \t]+/g, ' ');
      if (!styles || (!r.b && !r.i) || !t.trim()) { out += t; continue; }
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
      const mk = r.b && r.i ? '***' : r.b ? '**' : '*';
      out += m[1] + mk + m[2] + mk + m[3];
    }
    return out.replace(/ {2,}/g, ' ');
  }

  function escapeMd(t) {
    return String(t)
      .replace(/\\/g, '\\\\')
      .replace(/([*`])/g, '\\$1')
      .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
      .replace(/<(?=[A-Za-z!/?])/g, '\\<');
  }

  // tabelas: linhas consecutivas com 2+ fragmentos alinhados em colunas
  function detectTables(blocks, lineGap) {
    for (let bi = 0; bi < blocks.length; bi++) {
      const B = blocks[bi];
      if (B.type !== 'p' && B.type !== 'h') continue;
      // reúne blocos de uma linha consecutivos na mesma página
      const run = [];
      let j = bi;
      while (j < blocks.length) {
        const C = blocks[j];
        if (!['p', 'h'].includes(C.type)) break;
        const ls = C.lines.filter((x) => !x.marker);
        if (!ls.length || !ls.every((x) => x.frags.length >= 2)) break;
        const prev = run.length ? run[run.length - 1] : null;
        if (prev && (ls[0].page !== prev.page || ls[0].col !== prev.col || ls[0].y - prev.y > lineGap * 2.4)) break;
        run.push(...ls);
        j++;
      }
      if (run.length < 2) continue;
      // intervalos de coluna
      const all = run.flatMap((L) => L.frags.map((f) => [f.x0, f.x1])).sort((a, b) => a[0] - b[0]);
      const cols = [];
      for (const [a, b] of all) { const c = cols[cols.length - 1]; if (c && a <= c[1] + 4) c[1] = Math.max(c[1], b); else cols.push([a, b]); }
      if (cols.length < 2 || cols.length > 12) continue;
      const rowsOk = run.every((L) => L.frags.length >= Math.min(2, cols.length));
      if (!rowsOk) continue;
      const rows = run.map((L) => {
        const cells = cols.map(() => []);
        for (const f of L.frags) { const ci = cols.findIndex(([a, b]) => f.x0 >= a - 1 && f.x0 <= b + 1); cells[ci < 0 ? 0 : ci].push(f.text.trim()); }
        return cells.map((c) => c.join(' ').replace(/\|/g, '\\|').replace(/\s+/g, ' '));
      });
      blocks.splice(bi, j - bi, { type: 'table', rows, ncols: cols.length, page: run[0].page, lines: run });
    }
    // tabela que continua na página seguinte: junta as partes (e descarta o cabeçalho repetido)
    for (let i = 0; i < blocks.length; i++) {
      const A = blocks[i];
      if (A.type !== 'table') continue;
      let j = i + 1;
      while (j < blocks.length && blocks[j].type === 'page') j++;
      const B = blocks[j];
      if (j === i + 1 || !B || B.type !== 'table' || B.ncols !== A.ncols) continue;
      const rows = B.rows[0].join('|') === A.rows[0].join('|') ? B.rows.slice(1) : B.rows;
      A.rows.push(...rows);
      blocks.splice(j, 1);
      i--;
    }
  }
  function tableMd(rows) {
    const line = (cells) => '| ' + cells.join(' | ') + ' |';
    return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n');
  }

  // ---------- OCR (páginas digitalizadas) ----------
  // Converte o resultado do Tesseract em itens com a mesma forma dos itens do pdf.js.
  function ocrItems(data, scale) {
    const items = [];
    for (const line of data.lines || []) {
      const lb = line.bbox; const hgt = (lb.y1 - lb.y0) / scale;
      const size = Math.max(4, hgt * 0.74);
      const base = (line.baseline && line.baseline.y0 ? line.baseline.y0 : lb.y1 - (lb.y1 - lb.y0) * 0.2) / scale;
      for (const w of line.words || []) {
        if (!w.text || !w.text.trim()) continue;
        items.push({ str: w.text, x: w.bbox.x0 / scale, y: base, w: (w.bbox.x1 - w.bbox.x0) / scale, size, b: false, i: false, ocr: true });
      }
    }
    return items;
  }

  F.pdf2md = { extract, convert, ocrItems, cnjRe: RE_CNJ };
})();
