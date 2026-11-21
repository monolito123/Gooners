/* Fólio — utilitários de PDF (pdf-lib + pdf.js): juntar, dividir/extrair/girar/excluir páginas, imagens para PDF. */
(function () {
  'use strict';
  const F = window.Folio;
  const { h } = F;

  const pdfLib = async () => { await F.lib('pdflib'); return window.PDFLib; };
  const loadPdf = async (bytes) => {
    const { PDFDocument } = await pdfLib();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc;
  };
  const savePdf = async (doc, name) => {
    doc.setProducer('Fólio Judiciário'); doc.setCreator('Fólio Judiciário');
    const bytes = await doc.save({ useObjectStreams: true });
    return { blob: new Blob([bytes], { type: 'application/pdf' }), name };
  };
  const pagesTxt = (nums) => F.compactPages(nums).replace(/–/g, '-');
  const safeName = (s, def) => (String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || def).replace(/\.pdf$/i, '') + '.pdf';

  // miniaturas com pdf.js (renderizadas só quando aparecem na tela)
  function thumbGrid(pdf, { onClick, label } = {}) {
    const grid = h('div', { class: 'thumbs', style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px' });
    const cells = [];
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); draw(e.target); }
    }, { rootMargin: '200px' }) : null;
    async function draw(cell) {
      try {
        const page = await pdf.getPage(+cell.dataset.n);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 160 / Math.max(vp0.width, vp0.height) });
        const c = cell.querySelector('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      } catch { /* miniatura opcional */ }
    }
    for (let n = 1; n <= pdf.numPages; n++) {
      const cell = h('button', { type: 'button', class: 'thumb', 'data-n': n, title: (label || 'Página') + ' ' + n, onclick: () => onClick && onClick(n),
        style: 'display:grid;gap:4px;justify-items:center;padding:6px;border:1px solid var(--rule);border-radius:6px;background:var(--sheet);cursor:pointer;min-width:0' },
      h('canvas', { width: 80, height: 110, style: 'max-width:100%;height:auto;background:#fff;box-shadow:0 0 0 1px var(--rule-2);transition:transform .15s' }),
      h('span', { class: 'tiny mono' }, String(n)));
      cells.push(cell); grid.append(cell);
      if (io) io.observe(cell); else if (n <= 60) draw(cell);
    }
    grid.cells = cells;
    return grid;
  }

  // ======================================================================
  F.register({
    id: 'juntar-pdf', group: 'pdf', name: 'Juntar PDFs',
    keywords: 'unir mesclar combinar pdf juntada documentos petição anexos',
    desc: 'Une vários PDFs em um só, na ordem que você escolher. Útil para preparar uma juntada com petição e anexos.',
    refs: ['pdf-lib', 'Sem limite de arquivos'],
    render(root) {
      const items = [];
      const list = h('ul', { class: 'files' });
      const name = F.input({ id: 'juntar-nome', value: 'documentos-juntados.pdf' });
      const status = h('div', { class: 'small muted' });
      const go = F.btn('Juntar e baixar', merge, { icon: 'download', kind: 'primary' });
      const drop = F.dropzone({ accept: 'application/pdf,.pdf', multiple: true, title: 'Escolha ou arraste os PDFs', hint: 'Depois ajuste a ordem com as setas', onFiles: add });
      root.append(h('div', { class: 'grid-2' },
        h('div', { class: 'stack' }, h('div', { class: 'card card-pad stack' }, drop), h('div', { class: 'card card-pad stack' }, F.field('Nome do arquivo final', name), h('div', { class: 'row' }, go), status)),
        h('div', { class: 'card card-pad stack' }, h('h2', null, 'Ordem dos documentos'), list)));
      render();
      async function add(fs) {
        for (const f of fs) {
          if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { F.toast(f.name + ' não é PDF.', 'bad'); continue; }
          const it = { name: f.name, size: f.size, file: f, pages: '…' };
          items.push(it); render();
          try { const bytes = new Uint8Array(await f.arrayBuffer()); const d = await loadPdf(bytes); it.pages = d.getPageCount(); it.enc = d.isEncrypted; it.bytes = bytes; }
          catch (e) { it.error = e.message; it.pages = '!'; }
          render();
        }
      }
      function render() {
        if (!items.length) { list.replaceChildren(h('li', { class: 'empty', style: 'border:0' }, 'Nenhum arquivo ainda. A ordem da lista será a ordem no PDF final.')); status.textContent = ''; go.disabled = true; return; }
        const total = items.reduce((s, it) => s + (typeof it.pages === 'number' ? it.pages : 0), 0);
        list.replaceChildren(...items.map((it, i) => h('li', null,
          h('span', { class: 'mono tiny' }, String(i + 1).padStart(2, '0')),
          h('span', { class: 'name', title: it.name }, it.name, it.enc ? h('span', { class: 'pill pill-warn', style: 'margin-left:6px' }, 'protegido') : null, it.error ? h('span', { class: 'pill pill-bad', style: 'margin-left:6px' }, 'erro') : null),
          h('span', { class: 'meta' }, `${it.pages} p. · ${F.fmtBytes(it.size)}`),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); } }, '↑'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Descer', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); } }, '↓'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remover', onclick: () => { items.splice(i, 1); render(); } }, '×'))));
        status.textContent = `${items.length} arquivo(s), ${total} página(s) no total.`;
        go.disabled = items.length < 1 || items.some((it) => !it.bytes);
      }
      async function merge() {
        try {
          go.disabled = true; status.textContent = 'Juntando…';
          const { PDFDocument } = await pdfLib();
          const out = await PDFDocument.create();
          for (const it of items) {
            const src = await loadPdf(it.bytes);
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach((p) => out.addPage(p));
          }
          const { blob } = await savePdf(out);
          status.textContent = `Pronto: ${out.getPageCount()} páginas, ${F.fmtBytes(blob.size)}.`;
          if (items.some((it) => it.enc)) F.toast('Algum arquivo é protegido: confira o resultado.', 'bad');
          await F.save(safeName(name.value, 'documentos-juntados'), blob);
        } catch (e) { status.textContent = 'Erro: ' + e.message; }
        finally { go.disabled = false; }
      }
    },
  });

  // ======================================================================
  F.register({
    id: 'dividir-pdf', group: 'pdf', name: 'Dividir e extrair páginas',
    keywords: 'separar extrair páginas girar rotacionar excluir apagar pdf dividir',
    desc: 'Extraia um trecho dos autos, separe o PDF em vários arquivos, gire páginas digitalizadas de lado ou exclua páginas em branco. Clique nas miniaturas para escolher as páginas.',
    refs: ['Extrair', 'Separar', 'Girar', 'Excluir'],
    render(root) {
      let st = null;
      const mode = F.seg([['extrair', 'Extrair'], ['separar', 'Separar'], ['girar', 'Girar'], ['excluir', 'Excluir']], 'extrair', () => update());
      const ranges = F.input({ id: 'dividir-ranges', placeholder: 'ex.: 1-3, 7, 10-' });
      const every = F.input({ id: 'dividir-every', type: 'number', min: 1, value: 10, style: 'max-width:120px' });
      const splitBy = F.seg([['faixas', 'Pelas faixas'], ['cada', 'A cada N páginas']], 'faixas', () => update());
      const angle = F.seg([['90', '90° →'], ['180', '180°'], ['270', '90° ←']], '90', () => update());
      const info = h('div', { class: 'small muted' });
      const go = F.btn('Gerar e baixar', run, { icon: 'download', kind: 'primary' });
      const fileLine = h('div', { class: 'small' });
      const thumbsBox = h('div', { class: 'card card-pad' }, h('div', { class: 'empty' }, 'Escolha um PDF para ver as páginas.'));
      const helpTxt = h('p', { class: 'tiny' });
      const splitRow = h('div', { class: 'stack' }, F.field('Como separar', splitBy), F.field('Páginas por arquivo', every));
      const angleRow = F.field('Girar', angle);
      const drop = F.dropzone({ accept: 'application/pdf,.pdf', multiple: false, title: 'Escolha ou arraste um PDF', hint: 'Autos, petições, anexos', onFiles: ([f]) => open(f) });
      root.append(h('div', { class: 'grid-2' },
        h('div', { class: 'stack' }, h('div', { class: 'card card-pad stack' }, drop, fileLine),
          h('div', { class: 'card card-pad stack' }, F.field('O que fazer', mode), F.field('Páginas', ranges, 'Separe faixas por vírgula. No modo Separar, cada faixa vira um arquivo; use ";" para agrupar (ex.: 1-3; 4-9; 10-).'), splitRow, angleRow, helpTxt, h('div', { class: 'row' }, go), info)),
        thumbsBox));
      ranges.addEventListener('input', F.debounce(update, 150));
      every.addEventListener('input', F.debounce(update, 150));
      update();

      async function open(f) {
        try {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf.slice(0));
          const pdf = await F.openPdf(new Uint8Array(buf));
          if (st && st.pdf) st.pdf.destroy();
          st = { name: f.name, size: f.size, bytes, pdf, n: pdf.numPages };
          fileLine.replaceChildren(h('strong', null, f.name), ` · ${st.n} páginas · ${F.fmtBytes(f.size)}`);
          const grid = thumbGrid(pdf, { onClick: toggle });
          thumbsBox.replaceChildren(h('div', { class: 'row', style: 'margin-bottom:10px' }, h('strong', { class: 'small' }, 'Páginas'), h('span', { class: 'tiny' }, 'clique para incluir ou tirar da seleção')), grid);
          st.grid = grid;
          ranges.value = '';
          update();
        } catch (e) { F.toast('Não foi possível abrir o PDF: ' + e.message, 'bad'); }
      }
      function toggle(n) {
        if (!st) return;
        let sel = [];
        try { sel = ranges.value.trim() ? F.parseRanges(ranges.value.replace(/;/g, ','), st.n) : []; } catch { sel = []; }
        const set = new Set(sel);
        set.has(n) ? set.delete(n) : set.add(n);
        ranges.value = F.compactPages([...set]).replace(/–/g, '-');
        update();
      }
      function groups() {
        if (!st) return [];
        if (mode.value === 'separar' && splitBy.value === 'cada') {
          const k = Math.max(1, +every.value || 1), out = [];
          for (let a = 1; a <= st.n; a += k) out.push(Array.from({ length: Math.min(k, st.n - a + 1) }, (_, i) => a + i));
          return out;
        }
        const txt = ranges.value.trim();
        if (mode.value === 'separar') return (txt ? (txt.includes(';') ? txt.split(';') : txt.split(',')) : []).filter((x) => x.trim()).map((part) => F.parseRanges(part, st.n)).filter((g) => g.length);
        return txt ? [F.parseRanges(txt.replace(/;/g, ','), st.n)] : [];
      }
      function update() {
        const m = mode.value;
        splitRow.hidden = m !== 'separar';
        every.closest('label').hidden = splitBy.value !== 'cada';
        ranges.closest('label').hidden = m === 'separar' && splitBy.value === 'cada';
        angleRow.hidden = m !== 'girar';
        helpTxt.textContent = { extrair: 'Gera um PDF só com as páginas escolhidas, na ordem digitada (ex.: 5, 1-3).', separar: 'Gera vários PDFs, entregues juntos em um .zip.', girar: 'Gira as páginas escolhidas e mantém as demais.', excluir: 'Gera um PDF sem as páginas escolhidas.' }[m];
        let g = [];
        try { g = groups(); info.textContent = ''; } catch (e) { info.textContent = e.message; }
        const chosen = new Set(g.flat());
        if (st && st.grid) for (const c of st.grid.cells) {
          const on = chosen.has(+c.dataset.n);
          c.style.borderColor = on ? (m === 'excluir' ? 'var(--bad)' : 'var(--stamp)') : 'var(--rule)';
          c.style.background = on ? (m === 'excluir' ? 'var(--bad-soft)' : 'var(--stamp-soft)') : 'var(--sheet)';
          c.style.opacity = m === 'excluir' && on ? '.6' : '1';
          c.querySelector('canvas').style.transform = m === 'girar' && on ? `rotate(${angle.value}deg)` : 'none';
        }
        if (st && !info.textContent) {
          const total = chosen.size;
          info.textContent = !total ? 'Nenhuma página escolhida.' : m === 'separar' ? `${g.length} arquivo(s) serão gerados.` : m === 'excluir' ? `O PDF final terá ${st.n - total} páginas.` : `${total} página(s) selecionada(s).`;
        }
        go.disabled = !st || !chosen.size;
      }
      async function run() {
        if (!st) return;
        try {
          go.disabled = true;
          const { PDFDocument, degrees } = await pdfLib();
          const src = await loadPdf(st.bytes);
          const base = F.baseName(st.name);
          const g = groups();
          if (mode.value === 'extrair') {
            const out = await PDFDocument.create();
            (await out.copyPages(src, g[0].map((n) => n - 1))).forEach((p) => out.addPage(p));
            const { blob } = await savePdf(out);
            await F.save(`${base} (p. ${pagesTxt(g[0])}).pdf`, blob);
          } else if (mode.value === 'separar') {
            await F.lib('jszip');
            const zip = new window.JSZip();
            for (const pages of g) {
              const out = await PDFDocument.create();
              (await out.copyPages(src, pages.map((n) => n - 1))).forEach((p) => out.addPage(p));
              const bytes = await out.save({ useObjectStreams: true });
              zip.file(`${base} (p. ${pagesTxt(pages)}).pdf`, bytes);
            }
            await F.save(base + ' (separado).zip', await zip.generateAsync({ type: 'blob' }));
          } else if (mode.value === 'girar') {
            const sel = new Set(g[0]);
            src.getPages().forEach((p, i) => { if (sel.has(i + 1)) p.setRotation(degrees((p.getRotation().angle + +angle.value) % 360)); });
            const { blob } = await savePdf(src);
            await F.save(base + ' (girado).pdf', blob);
          } else {
            const del = new Set(g[0]);
            const keep = src.getPageIndices().filter((i) => !del.has(i + 1));
            if (!keep.length) { F.toast('Não dá para excluir todas as páginas.', 'bad'); return; }
            const out = await PDFDocument.create();
            (await out.copyPages(src, keep)).forEach((p) => out.addPage(p));
            const { blob } = await savePdf(out);
            await F.save(base + ' (sem p. ' + pagesTxt(g[0]) + ').pdf', blob);
          }
        } catch (e) { F.toast('Erro: ' + e.message, 'bad'); }
        finally { update(); }
      }
    },
  });

  // ======================================================================
  F.register({
    id: 'imagens-pdf', group: 'pdf', name: 'Imagens para PDF',
    keywords: 'foto jpg png imagem digitalização converter pdf comprovante',
    desc: 'Junta fotos e digitalizações (JPG, PNG, WebP) em um PDF, uma imagem por página, com tamanho A4 e redução opcional de resolução para deixar o arquivo menor.',
    refs: ['A4', 'Reduz o tamanho'],
    render(root) {
      const imgs = [];
      const list = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px' });
      const size = F.seg([['a4', 'A4'], ['carta', 'Carta'], ['imagem', 'Tamanho da imagem']], 'a4');
      const margin = F.seg([['0', 'Sem margem'], ['1', '1 cm'], ['2', '2 cm']], '1');
      const reduce = F.check('Reduzir para até 150 dpi (arquivo menor)', true, 'Recomprime em JPEG com qualidade 85%.');
      const gray = F.check('Converter para tons de cinza', false);
      const name = F.input({ id: 'img-nome', value: 'imagens.pdf' });
      const status = h('div', { class: 'small muted' });
      const go = F.btn('Gerar PDF', build, { icon: 'download', kind: 'primary', disabled: true });
      const drop = F.dropzone({ accept: 'image/jpeg,image/png,image/webp,image/gif,image/bmp', multiple: true, title: 'Escolha ou arraste imagens', hint: 'JPG, PNG, WebP · a ordem pode ser ajustada', onFiles: add });
      root.append(h('div', { class: 'grid-2' },
        h('div', { class: 'stack' }, h('div', { class: 'card card-pad stack' }, drop),
          h('div', { class: 'card card-pad stack' }, F.field('Tamanho da página', size), F.field('Margem', margin), reduce, gray, F.field('Nome do arquivo', name), h('div', { class: 'row' }, go), status)),
        h('div', { class: 'card card-pad stack' }, h('h2', null, 'Páginas'), list)));
      render();
      function add(fs) {
        for (const f of fs) { if (!/^image\//.test(f.type)) { F.toast(f.name + ' não é imagem.', 'bad'); continue; } imgs.push({ file: f, url: URL.createObjectURL(f) }); }
        render();
      }
      function render() {
        go.disabled = !imgs.length;
        if (!imgs.length) { list.replaceChildren(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Nenhuma imagem ainda.')); return; }
        list.replaceChildren(...imgs.map((im, i) => h('div', { style: 'border:1px solid var(--rule);border-radius:6px;padding:6px;display:grid;gap:4px;background:var(--sheet);min-width:0' },
          h('img', { src: im.url, alt: im.file.name, style: 'width:100%;aspect-ratio:3/4;object-fit:contain;background:var(--sheet-2)' }),
          h('div', { class: 'tiny', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `${i + 1}. ${im.file.name}`),
          h('div', { class: 'row', style: 'gap:2px' },
            h('button', { class: 'btn btn-sm btn-quiet', type: 'button', 'aria-label': 'Mover para trás', disabled: i === 0, onclick: () => { [imgs[i - 1], imgs[i]] = [imgs[i], imgs[i - 1]]; render(); } }, '←'),
            h('button', { class: 'btn btn-sm btn-quiet', type: 'button', 'aria-label': 'Mover para frente', disabled: i === imgs.length - 1, onclick: () => { [imgs[i + 1], imgs[i]] = [imgs[i], imgs[i + 1]]; render(); } }, '→'),
            h('button', { class: 'btn btn-sm btn-quiet', type: 'button', 'aria-label': 'Remover', onclick: () => { URL.revokeObjectURL(im.url); imgs.splice(i, 1); render(); } }, '×')))));
        status.textContent = imgs.length + ' imagem(ns).';
      }
      async function toJpeg(im, maxW, maxH) {
        const bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Imagem ilegível: ' + im.file.name)); img.src = im.url; });
        let w = bmp.naturalWidth, hh = bmp.naturalHeight;
        const k = Math.min(1, maxW / w, maxH / hh);
        w = Math.max(1, Math.round(w * k)); hh = Math.max(1, Math.round(hh * k));
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
        if (gray.input.checked) ctx.filter = 'grayscale(1)';
        ctx.drawImage(bmp, 0, 0, w, hh);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
        return { bytes: new Uint8Array(await blob.arrayBuffer()), w: bmp.naturalWidth, h: bmp.naturalHeight };
      }
      async function build() {
        try {
          go.disabled = true; status.textContent = 'Gerando…';
          const { PDFDocument } = await pdfLib();
          const doc = await PDFDocument.create();
          const mPt = +margin.value * 28.3465;
          for (const [i, im] of imgs.entries()) {
            status.textContent = `Imagem ${i + 1} de ${imgs.length}…`;
            let emb, iw, ih;
            const needCanvas = reduce.input.checked || gray.input.checked || !/jpe?g|png/.test(im.file.type);
            if (needCanvas) {
              const lim = reduce.input.checked ? 150 / 72 : 10;
              const pw0 = size.value === 'carta' ? 612 : 595.28, ph0 = size.value === 'carta' ? 792 : 841.89;
              const j = await toJpeg(im, Math.max(pw0, ph0) * lim, Math.max(pw0, ph0) * lim);
              emb = await doc.embedJpg(j.bytes); iw = j.w; ih = j.h;
            } else {
              const bytes = new Uint8Array(await im.file.arrayBuffer());
              emb = /png/.test(im.file.type) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
              iw = emb.width; ih = emb.height;
            }
            let pw, ph;
            if (size.value === 'imagem') { pw = iw * 0.75 + 2 * mPt; ph = ih * 0.75 + 2 * mPt; }
            else { const portrait = ih >= iw; const a = size.value === 'carta' ? [612, 792] : [595.28, 841.89]; [pw, ph] = portrait ? a : [a[1], a[0]]; }
            const page = doc.addPage([pw, ph]);
            const k = Math.min((pw - 2 * mPt) / iw, (ph - 2 * mPt) / ih);
            const w = iw * k, hh = ih * k;
            page.drawImage(emb, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
          }
          const { blob } = await savePdf(doc);
          status.textContent = `Pronto: ${doc.getPageCount()} página(s), ${F.fmtBytes(blob.size)}.`;
          await F.save(safeName(name.value, 'imagens'), blob);
        } catch (e) { status.textContent = 'Erro: ' + e.message; }
        finally { go.disabled = !imgs.length; }
      }
    },
  });
})();
