/* Fólio — conversores: PDF → Markdown, Word → Markdown, texto formatado → Markdown,
   Markdown → Word (.docx) e limpeza de texto copiado de PDF. */
(function () {
  'use strict';
  const F = window.Folio;
  const { h } = F;

  // "1-3, 5, 8-" → [1,2,3,5,8,...,max]
  F.parseRanges = (str, max) => {
    const s = String(str || '').trim();
    if (!s || /^(todas?|tudo|\*)$/i.test(s)) return Array.from({ length: max }, (_, i) => i + 1);
    const out = new Set();
    for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
      const m = /^(\d*)\s*(?:-|–|a|até)\s*(\d*)$/i.exec(part);
      if (m) {
        let a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : max;
        if (a > b) [a, b] = [b, a];
        for (let i = Math.max(1, a); i <= Math.min(max, b); i++) out.add(i);
      } else if (/^\d+$/.test(part)) { const n = +part; if (n >= 1 && n <= max) out.add(n); }
      else throw new Error('Intervalo inválido: "' + part + '". Use algo como 1-3, 5, 8-10.');
    }
    return [...out].sort((a, b) => a - b);
  };

  // Painel de saída com abas (texto / visualização / detalhes) e ações
  function outputPanel({ tabs, ext = 'md', onCopy, onSave, extraActions = [] }) {
    const tabBar = F.tabs(tabs, (i) => select(i));
    const views = tabs.map(() => h('div', { class: 'out-view' }));
    const stats = h('div', { class: 'stats' });
    const copyBtn = F.btn('Copiar', () => onCopy(), { icon: 'copy', small: true });
    const saveBtn = F.btn('Baixar .' + ext, () => onSave(), { icon: 'download', kind: 'primary', small: true });
    const el = h('div', { class: 'card' }, h('div', { class: 'out-head' }, tabBar, h('span', { class: 'grow' }), ...extraActions, copyBtn, saveBtn), h('div', { class: 'out-body' }, views), stats);
    let onSelect = null;
    function select(i) { views.forEach((v, k) => (v.hidden = k !== i)); tabBar.set(i, false); if (onSelect) onSelect(i); }
    select(0);
    return { el, views, stats, select, tabBar, copyBtn, saveBtn, set onSelect(fn) { onSelect = fn; } };
  }
  F.outputPanel = outputPanel;

  // ======================================================================
  // PDF → Markdown
  // ======================================================================
  F.register({
    id: 'pdf-markdown', group: 'conv', name: 'PDF para Markdown', tag: 'principal',
    keywords: 'converter pdf markdown md texto pje autos sentença ocr',
    desc: 'Converte decisões, petições e autos em PDF para Markdown limpo: títulos, parágrafos, citações recuadas, listas e tabelas, sem cabeçalhos repetidos nem carimbos de assinatura do PJe.',
    refs: ['Vários arquivos', 'OCR opcional', 'IDs do PJe'],
    render(root) {
      const files = [];
      let active = null;
      const store = F.store.get('pdfmd-opts', {});
      const o = Object.assign({ markers: 'comment', headers: true, stamps: true, headings: true, styles: true, quotes: true, tables: true, dehyphen: true, columns: true, frontMatter: false, pjeDocs: true, range: '' }, store);

      // ---- coluna esquerda: arquivos e opções ----
      const list = h('ul', { class: 'files', 'aria-label': 'Arquivos' });
      const prog = h('div', { class: 'progress', hidden: true }, h('i'));
      const progText = h('div', { class: 'tiny', hidden: true });
      const drop = F.dropzone({ accept: 'application/pdf,.pdf', multiple: true, title: 'Escolha ou arraste PDFs', hint: 'Vários arquivos de uma vez · nada sai do seu computador', onFiles: addFiles });

      const opt = (key, label, hint) => { const c = F.check(label, o[key], hint); c.input.addEventListener('change', () => { o[key] = c.input.checked; persist(); reconvertAll(key === 'styles'); }); return c; };
      const markers = F.seg([['comment', 'Comentário'], ['text', 'Visível'], ['none', 'Não marcar']], o.markers, (v) => { o.markers = v; persist(); reconvertAll(); });
      const range = F.input({ id: 'pdfmd-range', placeholder: 'Todas (ex.: 1-3, 7, 10-)', value: o.range });
      range.addEventListener('change', () => { o.range = range.value; persist(); (async () => { for (const st of files.slice()) if (st.pdf) await process(st); })(); });
      const persist = () => F.store.set('pdfmd-opts', o);

      const options = h('div', { class: 'card card-pad stack' },
        h('h2', null, 'Opções'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Marcar as páginas'), markers, h('small', { class: 'tiny' }, 'Comentário: <!-- página 3 -->, invisível na leitura. Visível: *[p. 3]*.')),
        F.field('Páginas', range),
        h('div', { class: 'sep' }),
        opt('stamps', 'Remover carimbos de assinatura', 'PJe, SEI e e-SAJ: "Assinado eletronicamente por", URL de conferência, "Num. … - Pág. …". Os dados ficam em Detalhes.'),
        opt('headers', 'Remover cabeçalhos, rodapés e números de página repetidos'),
        opt('pjeDocs', 'Separar documentos do PJe pelo ID', 'Em autos completos, insere um divisor a cada novo ID.'),
        opt('headings', 'Detectar títulos (RELATÓRIO, FUNDAMENTAÇÃO…)'),
        opt('styles', 'Manter negrito e itálico'),
        opt('quotes', 'Citações recuadas como blocos de citação (>)'),
        opt('tables', 'Detectar tabelas'),
        opt('columns', 'Detectar duas colunas', 'Diários oficiais e informativos.'),
        opt('dehyphen', 'Juntar palavras hifenizadas no fim da linha'),
        opt('frontMatter', 'Incluir cabeçalho YAML', 'Título, processo, IDs, assinaturas e data da conversão.'));

      const filesCard = h('div', { class: 'card card-pad stack', style: 'grid-area:files' }, drop, prog, progText, list);
      options.style.gridArea = 'opts';

      // ---- coluna direita: resultado ----
      const ta = F.textarea({ id: 'pdfmd-out', 'aria-label': 'Markdown gerado', placeholder: 'O Markdown aparece aqui.' });
      const preview = h('div', { class: 'doc' });
      const details = h('div', { class: 'card-pad stack' });
      const zipBtn = F.btn('Todos (.zip)', () => saveZip(), { icon: 'download', small: true });
      zipBtn.hidden = true;
      const out = outputPanel({
        tabs: ['Markdown', 'Visualizar', 'Detalhes'],
        extraActions: [zipBtn],
        onCopy: () => F.copy(ta.value),
        onSave: () => active && active.result ? F.save(F.baseName(active.name) + '.md', ta.value, 'text/markdown') : F.toast('Converta um PDF primeiro.', 'bad'),
      });
      out.views[0].append(ta);
      out.views[1].append(preview);
      out.views[2].append(details);
      out.onSelect = (i) => { if (i === 1) renderPreview(); };
      const ocrNote = h('div', { class: 'note note-warn', hidden: true });
      const hint = h('div', { class: 'note note-info home-hint', hidden: true });
      const right = h('div', { class: 'stack', style: 'grid-area:out' }, hint, ocrNote, out.el);
      root.append(h('div', { class: 'grid-pdfmd' }, filesCard, right, options));

      // ---- arquivos ----
      function addFiles(fs, isExample) {
        const pdfs = fs.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
        if (!pdfs.length) { F.toast('Escolha arquivos PDF.', 'bad'); return; }
        if (!isExample) { for (const ex of files.filter((x) => x.example)) removeFile(ex, true); }
        for (const f of pdfs) {
          const st = { id: Math.random().toString(36).slice(2), name: f.name, size: f.size, file: f, status: 'aguardando', pages: new Map(), example: !!isExample };
          files.push(st);
        }
        renderList();
        hint.hidden = !isExample;
        (async () => { for (const st of files.filter((x) => x.status === 'aguardando')) await process(st); })();
      }
      function removeFile(st, silent) {
        const i = files.indexOf(st); if (i < 0) return;
        files.splice(i, 1);
        try { st.pdf && st.pdf.destroy(); } catch { /* ignora */ }
        if (active === st) { active = files[0] || null; showActive(); }
        if (!silent) renderList();
      }
      function renderList() {
        list.replaceChildren(...files.map((st) => h('li', { class: st === active ? 'active' : '' },
          h('span', { class: 'name', title: st.name, onclick: () => { active = st; renderList(); showActive(); } }, st.name, st.example ? ' ' : null, st.example ? h('span', { class: 'example-flag' }, 'exemplo fictício') : null),
          h('span', { class: 'meta' }, st.status === 'pronto' ? (st.pdf ? st.pdf.numPages + ' p.' : '') : st.status),
          h('button', { class: 'icon-btn', type: 'button', title: 'Remover', 'aria-label': 'Remover ' + st.name, onclick: () => removeFile(st) }, '×'))));
        zipBtn.hidden = files.filter((x) => x.result).length < 2;
      }
      function setProgress(done, total, label) {
        prog.hidden = progText.hidden = total == null;
        if (total == null) return;
        prog.firstChild.style.width = Math.round((done / total) * 100) + '%';
        progText.textContent = label;
      }

      async function process(st) {
        try {
          st.status = 'lendo'; renderList();
          if (!st.pdf) {
            const buf = await st.file.arrayBuffer();
            st.pdf = await F.openPdf(new Uint8Array(buf));
            try { const md = await st.pdf.getMetadata(); st.title = (md && md.info && md.info.Title) || ''; if (/^\(?(anonymous|untitled|sem t[íi]tulo)\)?$/i.test(st.title.trim())) st.title = ''; } catch { st.title = ''; }
          }
          const nums = F.parseRanges(o.range, st.pdf.numPages);
          if (!nums.length) throw new Error('Nenhuma página no intervalo escolhido.');
          const missing = nums.filter((n) => !st.pages.has(n));
          if (missing.length) {
            const got = await F.pdf2md.extract(st.pdf, { pages: missing, onProgress: (d, t) => setProgress(d, t, `${st.name}: lendo página ${d} de ${t}`) });
            for (const pg of got) st.pages.set(pg.num, pg);
          }
          setProgress(null);
          st.nums = nums;
          convertOne(st);
          st.status = 'pronto';
          if (!active || !active.result || (active.example && !st.example)) active = st;
          renderList();
          if (active === st) showActive();
        } catch (e) {
          setProgress(null);
          st.status = 'erro';
          st.error = /password/i.test(e && e.name + e.message) ? 'O PDF está protegido por senha.' : (e && e.message) || String(e);
          renderList();
          if (!active || active === st) { active = st; showActive(); }
        }
      }
      function convertOne(st) {
        const t0 = performance.now();
        st.result = F.pdf2md.convert(st.nums.map((n) => st.pages.get(n)), Object.assign({}, o, { fileName: st.name, title: st.title }));
        st.ms = performance.now() - t0;
      }
      const reconvertAll = F.debounce(() => { for (const st of files) if (st.result) convertOne(st); showActive(); }, 120);

      function showActive() {
        const st = active;
        ocrNote.hidden = true;
        if (!st) { ta.value = ''; preview.replaceChildren(h('div', { class: 'empty' }, 'Escolha um PDF para começar.')); details.replaceChildren(); out.stats.textContent = ''; return; }
        if (st.status === 'erro') { ta.value = ''; out.stats.textContent = ''; details.replaceChildren(h('div', { class: 'note note-warn' }, 'Não foi possível ler "' + st.name + '": ' + st.error)); out.select(2); return; }
        if (!st.result) { ta.value = ''; preview.replaceChildren(); details.replaceChildren(h('div', { class: 'empty' }, 'Convertendo…')); out.stats.textContent = ''; return; }
        const { markdown, meta } = st.result;
        ta.value = markdown;
        if (out.tabBar.index === 1) renderPreview();
        const words = F.words(markdown.replace(/<!--[\s\S]*?-->/g, ''));
        out.stats.replaceChildren(...[`${meta.pages} página(s)`, `${F.nf(words)} palavras`, `${F.nf(markdown.length)} caracteres`, `${meta.headings.length} títulos`, `${Math.round(st.ms)} ms`].map((t) => h('span', null, t)));
        if (meta.emptyPages.length) {
          ocrNote.replaceChildren(
            h('p', null, h('strong', null, `${meta.emptyPages.length} página(s) sem texto selecionável`), ` (${compactPages(meta.emptyPages)}). Provavelmente são imagens digitalizadas.`),
            h('div', { class: 'row' }, F.btn('Reconhecer texto (OCR)', () => runOcr(st), { icon: 'scan', small: true }), h('span', { class: 'tiny' }, 'Baixa o modelo de português (~1,4 MB) e processa no navegador. Pode levar alguns segundos por página.')));
          ocrNote.hidden = false;
        }
        renderDetails(st);
      }
      async function renderPreview() {
        if (!active || !active.result) return;
        try { preview.innerHTML = await F.mdToHtml(ta.value); } catch (e) { preview.replaceChildren(h('div', { class: 'note note-warn' }, e.message)); }
      }
      ta.addEventListener('input', F.debounce(() => { if (out.tabBar.index === 1) renderPreview(); }, 300));

      function renderDetails(st) {
        const { meta } = st.result;
        const kv = h('dl', { class: 'kv' });
        const add = (k, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return; kv.append(h('dt', null, k), h('dd', null, v)); };
        add('Arquivo', `${st.name} · ${F.fmtBytes(st.size)}`);
        add('Páginas', `${meta.pages} convertida(s) de ${st.pdf.numPages}`);
        add('Título nos metadados', st.title);
        add('Processo(s)', meta.cnj.length ? meta.cnj.join(', ') : null);
        add('Corpo do texto', `fonte de ${F.nf(meta.bodySize, 1)} pt, entrelinha de ${F.nf(meta.lineGap, 1)} pt`);
        if (meta.ocrPages.length) add('OCR', 'páginas ' + compactPages(meta.ocrPages));
        const blocks = [kv];
        if (meta.docs.length) {
          blocks.push(h('h3', null, 'Documentos do PJe'), h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, 'ID'), h('th', null, 'Páginas do PDF'), h('th', null, 'Assinatura'))),
            h('tbody', null, meta.docs.map((d) => h('tr', null, h('td', { class: 'mono' }, d.id), h('td', null, compactPages(d.pages)), h('td', null, d.sig ? `${d.sig.name} · ${d.sig.when}` : '—')))))));
        }
        if (meta.signatures.length && !meta.docs.length) {
          blocks.push(h('h3', null, 'Assinaturas eletrônicas'), h('ul', { class: 'outline' }, meta.signatures.map((s) => h('li', null, `${s.name}${s.role ? ', ' + s.role : ''} · ${s.when}`, h('span', { class: 'pg' }, s.sys + ', p. ' + s.page)))));
        }
        if (meta.headings.length) {
          blocks.push(h('h3', null, 'Sumário'), h('ul', { class: 'outline' }, meta.headings.map((x) => h('li', { class: 'l' + x.level }, x.text, h('span', { class: 'pg' }, 'p. ' + x.page)))));
        }
        if (meta.removed.length) {
          blocks.push(h('h3', null, 'Removido da saída'), h('ul', { class: 'outline' }, meta.removed.map((r) => h('li', null, r.what, h('span', { class: 'pg' }, r.count + '×')))));
        }
        if (meta.side.length) {
          blocks.push(h('h3', null, 'Texto na margem (girado)'), ...meta.side.slice(0, 4).map((s) => h('p', { class: 'tiny' }, `p. ${s.page}: ${s.text.slice(0, 280)}`)));
        }
        details.replaceChildren(...blocks);
      }

      // ---- OCR ----
      async function runOcr(st) {
        const pages = st.result.meta.emptyPages.slice();
        try {
          setProgress(0, pages.length, 'Carregando o OCR…');
          await F.lib('tesseract');
          const opts = { langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int' };
          // No claude.ai o quadro bloqueia downloads de outras origens: o modelo de português vai junto com a
          // página (assets/ocr/por-traineddata.js) e um worker próprio o entrega ao Tesseract no lugar do fetch.
          if (window.claude && window.claude.use) {
            const local = new URL('assets/ocr/por-traineddata.js', location.href).href;
            let hasLocal = false;
            try { hasLocal = (await fetch(local, { method: 'HEAD' })).ok; } catch { hasLocal = false; }
            if (hasLocal) {
              const src = `importScripts(${JSON.stringify(local)});
const b = atob(self.FOLIO_POR_TRAINEDDATA); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
const f0 = self.fetch.bind(self);
self.fetch = (url, ...a) => String(url).endsWith('/por.traineddata.gz') ? Promise.resolve(new Response(u.slice(0))) : f0(url, ...a);
importScripts('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js');`;
              Object.assign(opts, { workerPath: URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), workerBlobURL: false, cacheMethod: 'none', langPath: 'https://modelo.local/tessdata' });
            }
          }
          const worker = await window.Tesseract.createWorker('por', 1, opts);
          let k = 0;
          for (const n of pages) {
            setProgress(k, pages.length, `OCR: página ${n} (${k + 1} de ${pages.length})`);
            const page = await st.pdf.getPage(n);
            const scale = 2.5;
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            const { data } = await worker.recognize(canvas);
            const pd = st.pages.get(n);
            const vec = pd.items;
            const extra = F.pdf2md.ocrItems(data, scale).filter((it) => !vec.some((v) => it.x + it.w / 2 >= v.x - 1 && it.x + it.w / 2 <= v.x + v.w + 1 && it.y - it.size / 2 >= v.y - v.size - 2 && it.y - it.size / 2 <= v.y + 2));
            pd.items = vec.concat(extra);
            pd.ocr = true;
            k++;
          }
          await worker.terminate();
          setProgress(null);
          convertOne(st); showActive();
          F.toast('OCR concluído em ' + pages.length + ' página(s).');
        } catch (e) {
          setProgress(null);
          F.toast('O OCR não funcionou aqui: ' + (e && e.message ? e.message : e) + '. Em alguns ambientes o download do modelo de idioma é bloqueado.', 'bad');
        }
      }

      async function saveZip() {
        const done = files.filter((x) => x.result);
        if (!done.length) return;
        await F.lib('jszip');
        const zip = new window.JSZip();
        const used = new Set();
        for (const st of done) {
          let name = F.baseName(st.name) + '.md', i = 2;
          while (used.has(name)) name = F.baseName(st.name) + ` (${i++}).md`;
          used.add(name);
          zip.file(name, st === active ? ta.value : st.result.markdown);
        }
        F.save('pdf-markdown.zip', await zip.generateAsync({ type: 'blob' }), 'application/zip');
      }

      // exemplo inicial (documento fictício)
      hint.append(h('span', { class: 'example-flag' }, 'Exemplo'), h('span', null, 'Esta é uma sentença fictícia para mostrar a conversão. Arraste seus PDFs para substituí-la.'));
      showActive();
      fetch('assets/exemplo.pdf').then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => addFiles([new File([b], 'sentenca-exemplo.pdf', { type: 'application/pdf' })], true)).catch(() => showActive());
    },
  });

  function compactPages(nums) {
    const s = [...nums].sort((a, b) => a - b), out = [];
    for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i])); i = j; }
    return out.join(', ');
  }
  F.compactPages = compactPages;

  // ======================================================================
  // Turndown configurado (HTML → Markdown)
  // ======================================================================
  async function turndown(opts = {}) {
    await F.lib('turndown');
    const td = new window.TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**', hr: '---' });
    if (window.turndownPluginGfm) td.use(window.turndownPluginGfm.gfm);
    td.remove(['style', 'script', 'meta', 'link', 'title']);
    td.addRule('vazios', { filter: (n) => n.nodeName === 'A' && !n.getAttribute('href'), replacement: (c) => c });
    td.addRule('sublinhado', { filter: ['u', 'ins'], replacement: (c) => c });
    td.addRule('word', { filter: (n) => /^O:P$/i.test(n.nodeName), replacement: (c) => c });
    if (opts.noLinks) td.addRule('semLinks', { filter: (n) => n.nodeName === 'A', replacement: (c) => c });
    if (opts.noImages) td.addRule('semImagens', { filter: 'img', replacement: () => '' });
    // itens de lista com um espaço depois do marcador (o padrão do Turndown usa três)
    td.addRule('itemLista', {
      filter: 'li',
      replacement(content, node, options) {
        const parent = node.parentNode;
        let prefix = options.bulletListMarker + ' ';
        if (parent && parent.nodeName === 'OL') { const start = parent.getAttribute('start'); prefix = (start ? Number(start) : 1) + Array.prototype.indexOf.call(parent.children, node) + '. '; }
        content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n' + ' '.repeat(prefix.length));
        return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
      },
    });
    return td;
  }
  // Prepara HTML (Word, PJe, navegador) para virar Markdown: células de tabela sem parágrafos internos
  F.prepHtml = (html) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    for (const cell of box.querySelectorAll('td, th')) {
      const ps = [...cell.children].filter((c) => c.nodeName === 'P');
      if (!ps.length) continue;
      ps.forEach((pp, i) => { const frag = document.createDocumentFragment(); if (i) frag.append(document.createElement('br')); frag.append(...pp.childNodes); pp.replaceWith(frag); });
    }
    // primeira linha vira cabeçalho quando a tabela não tem <th>
    for (const t of box.querySelectorAll('table')) {
      if (t.querySelector('th')) continue;
      const tr = t.querySelector('tr'); if (!tr) continue;
      for (const td of [...tr.children]) { const th = document.createElement('th'); th.append(...td.childNodes); td.replaceWith(th); }
    }
    for (const el of box.querySelectorAll('td strong, th strong')) if (el.closest('th')) el.replaceWith(...el.childNodes);
    return box.innerHTML;
  };
  F.turndown = turndown;
  const tidyMd = (md) => md.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  // ======================================================================
  // Word (.docx) → Markdown
  // ======================================================================
  F.register({
    id: 'word-markdown', group: 'conv', name: 'Word para Markdown',
    keywords: 'docx word minuta modelo converter markdown mammoth',
    desc: 'Converte minutas e modelos .docx em Markdown, mantendo títulos, listas, negrito, itálico, notas de rodapé, tabelas e citações (estilo "Citação" do Word).',
    refs: ['.docx', 'Vários arquivos'],
    render(root) {
      const files = [];
      let active = null;
      const keepImages = F.check('Manter imagens (embutidas no Markdown)', false, 'Deixa o arquivo bem maior.');
      const list = h('ul', { class: 'files' });
      const warn = h('div', { class: 'note', hidden: true });
      const ta = F.textarea({ id: 'docx-out', 'aria-label': 'Markdown gerado', placeholder: 'Escolha um arquivo .docx para converter.' });
      const preview = h('div', { class: 'doc' });
      const out = outputPanel({
        tabs: ['Markdown', 'Visualizar'],
        onCopy: () => F.copy(ta.value),
        onSave: () => active ? F.save(F.baseName(active.name) + '.md', ta.value, 'text/markdown') : F.toast('Converta um arquivo primeiro.', 'bad'),
      });
      out.views[0].append(ta); out.views[1].append(preview);
      out.onSelect = async (i) => { if (i === 1) preview.innerHTML = await F.mdToHtml(ta.value); };
      const drop = F.dropzone({ accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: true, title: 'Escolha ou arraste arquivos .docx', hint: 'Arquivos .doc antigos: salve como .docx no Word antes', onFiles: add });
      keepImages.input.addEventListener('change', () => { for (const st of files) st.md = null; if (active) show(active); });
      root.append(h('div', { class: 'grid-2' },
        h('div', { class: 'stack' }, h('div', { class: 'card card-pad stack' }, drop, list), h('div', { class: 'card card-pad stack' }, h('h2', null, 'Opções'), keepImages), warn),
        h('div', { class: 'stack' }, out.el)));

      function add(fs) {
        for (const f of fs) {
          if (!/\.docx$/i.test(f.name)) { F.toast(f.name + ': use arquivos .docx.', 'bad'); continue; }
          files.push({ name: f.name, file: f, md: null });
        }
        renderList();
        if (files.length) show(files[files.length - 1]);
      }
      function renderList() {
        list.replaceChildren(...files.map((st) => h('li', { class: st === active ? 'active' : '' },
          h('span', { class: 'name', onclick: () => show(st) }, st.name), h('span', { class: 'meta' }, F.fmtBytes(st.file.size)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remover', onclick: () => { files.splice(files.indexOf(st), 1); if (active === st) { active = null; ta.value = ''; } renderList(); } }, '×'))));
      }
      async function show(st) {
        active = st; renderList();
        try {
          if (!st.md) {
            await F.lib('mammoth');
            const buf = await st.file.arrayBuffer();
            const styleMap = [
              "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Citação'] => blockquote > p:fresh", "p[style-name='Citacao'] => blockquote > p:fresh",
              "p[style-name='Intense Quote'] => blockquote > p:fresh", "p[style-name='Citação Intensa'] => blockquote > p:fresh",
              "p[style-name='Title'] => h1:fresh", "p[style-name='Título'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh",
              "r[style-name='Strong'] => strong", "u => u",
            ];
            const opts = { styleMap, includeDefaultStyleMap: true };
            if (!keepImages.input.checked) opts.convertImage = window.mammoth.images.imgElement(() => ({ src: '' }));
            const res = await window.mammoth.convertToHtml({ arrayBuffer: buf }, opts);
            const td = await turndown({ noImages: !keepImages.input.checked });
            st.md = tidyMd(td.turndown(F.prepHtml(res.value)));
            st.warnings = res.messages.filter((m) => m.type === 'warning').map((m) => m.message);
          }
          ta.value = st.md;
          out.stats.replaceChildren(h('span', null, F.nf(F.words(st.md)) + ' palavras'), h('span', null, F.nf(st.md.length) + ' caracteres'));
          warn.hidden = !st.warnings.length;
          const uniq = [...new Set(st.warnings.map((w) => w.replace(/Unrecognised (paragraph|run) style: '([^']+)'.*/, 'Estilo não mapeado: $2')))];
          warn.replaceChildren(h('p', null, h('strong', null, 'Observações da conversão')), ...uniq.slice(0, 8).map((w) => h('p', { class: 'tiny' }, w)));
          if (out.tabBar.index === 1) preview.innerHTML = await F.mdToHtml(ta.value);
        } catch (e) {
          ta.value = '';
          F.toast('Não foi possível ler ' + st.name + ': ' + e.message, 'bad');
        }
      }
    },
  });

  // ======================================================================
  // Texto formatado (HTML) → Markdown
  // ======================================================================
  F.register({
    id: 'html-markdown', group: 'conv', name: 'Texto formatado para Markdown',
    keywords: 'colar html rich text word navegador pje editor converter markdown',
    desc: 'Cole um trecho copiado do Word, do editor do PJe ou de uma página de jurisprudência: a formatação vira Markdown na hora. Também aceita arquivos .html.',
    refs: ['Colar', '.html'],
    render(root) {
      const box = h('div', { class: 'doc card', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Área para colar texto formatado', id: 'html-paste', style: 'min-height:420px;max-height:640px;outline:none' });
      const noLinks = F.check('Remover links', false);
      const noImages = F.check('Remover imagens', true);
      const ta = F.textarea({ id: 'html-out', 'aria-label': 'Markdown gerado' });
      const out = outputPanel({ tabs: ['Markdown'], onCopy: () => F.copy(ta.value), onSave: () => F.save('texto.md', ta.value, 'text/markdown') });
      out.views[0].append(ta);
      const fileBtn = F.dropzone({ accept: '.html,.htm,text/html', multiple: false, title: 'Ou abra um arquivo .html', hint: 'Páginas salvas, e-mails exportados', onFiles: async ([f]) => { await F.lib('marked'); box.innerHTML = window.DOMPurify.sanitize(await f.text()); run(); } });
      const run = F.debounce(async () => {
        const td = await turndown({ noLinks: noLinks.input.checked, noImages: noImages.input.checked });
        ta.value = box.textContent.trim() ? tidyMd(td.turndown(F.prepHtml(box.innerHTML))) : '';
        out.stats.replaceChildren(h('span', null, F.nf(F.words(ta.value)) + ' palavras'));
      }, 150);
      box.addEventListener('paste', async (e) => {
        const html = e.clipboardData && e.clipboardData.getData('text/html');
        if (!html) return; // texto puro: o navegador cola normalmente
        e.preventDefault();
        await F.lib('marked');
        const clean = window.DOMPurify.sanitize(html.replace(/<!--\[if[\s\S]*?endif\]-->/g, ''), { FORBID_TAGS: ['style', 'meta', 'link'], FORBID_ATTR: ['style', 'class'] });
        const sel = getSelection();
        if (sel.rangeCount && box.contains(sel.anchorNode)) { const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(r.createContextualFragment(clean)); }
        else box.insertAdjacentHTML('beforeend', clean);
        run();
      });
      box.addEventListener('input', run);
      noLinks.input.addEventListener('change', run); noImages.input.addEventListener('change', run);
      root.append(h('div', { class: 'grid-even' },
        h('div', { class: 'stack' }, h('div', { class: 'row' }, h('span', { class: 'label' }, 'Cole aqui (Ctrl+V)'), h('span', { class: 'grow' }), F.btn('Limpar', () => { box.innerHTML = ''; run(); }, { small: true, kind: 'quiet' })), box, h('div', { class: 'row' }, noLinks, noImages), fileBtn),
        h('div', { class: 'stack' }, out.el)));
      box.innerHTML = '<h2>Ementa (exemplo)</h2><p><strong>DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL.</strong> Descontos indevidos em conta. Dano moral <em>in re ipsa</em>.</p><ol><li>Responsabilidade objetiva do fornecedor (CDC, art. 14).</li><li>Restituição em dobro (CDC, art. 42, parágrafo único).</li></ol><blockquote><p>Recurso conhecido e desprovido.</p></blockquote>';
      run();
    },
  });

  // ======================================================================
  // Markdown → Word (.docx)
  // ======================================================================
  const SAMPLE_MD = `# DESPACHO

**Processo:** 0701234-93.2026.8.07.0001

**Classe:** Procedimento Comum Cível

Trata-se de pedido de tutela de urgência formulado por JOÃO EXEMPLO DA SILVA. Antes de apreciá-lo, determino:

1. a intimação do autor para que junte o extrato bancário dos últimos três meses;
2. a citação do réu, com as advertências do art. 344 do CPC.

Quanto ao ponto, o art. 300 do CPC dispõe:

> A tutela de urgência será concedida quando houver elementos que evidenciem a probabilidade do direito e o perigo de dano ou o risco ao resultado útil do processo.

| Providência | Prazo |
|---|---|
| Emenda à inicial | 15 dias |
| Contestação | 15 dias |

Intimem-se.

*Documento fictício, gerado como exemplo.*
`;
  F.register({
    id: 'markdown-word', group: 'conv', name: 'Markdown para Word',
    keywords: 'docx word gerar minuta formatação abnt copiar formatado colar pje',
    desc: 'Gera um .docx formatado (fonte, entrelinha, recuo, margens e citação recuada de 4 cm) a partir de Markdown, ou copia o texto já formatado para colar no editor do PJe ou no Word.',
    refs: ['.docx', 'Citação recuada 4 cm', 'Copiar formatado'],
    render(root) {
      const saved = F.store.get('mdword-opts', {});
      const o = Object.assign({ font: 'Times New Roman', size: '12', line: '1.5', indent: '2.5', justify: true, abnt: true, pageNum: true }, saved);
      const ta = F.textarea({ id: 'mdword-in', 'aria-label': 'Markdown', value: F.store.get('mdword-text', SAMPLE_MD), style: 'min-height:420px' });
      const font = F.select([['Times New Roman', 'Times New Roman'], ['Arial', 'Arial'], ['Calibri', 'Calibri'], ['Georgia', 'Georgia'], ['Verdana', 'Verdana']], o.font, { id: 'mdword-font' });
      const size = F.select([['11', '11 pt'], ['12', '12 pt'], ['13', '13 pt'], ['14', '14 pt']], o.size, { id: 'mdword-size' });
      const line = F.select([['1', 'Simples'], ['1.15', '1,15'], ['1.5', '1,5'], ['2', 'Duplo']], o.line, { id: 'mdword-line' });
      const indent = F.select([['0', 'Sem recuo'], ['1.25', '1,25 cm'], ['2', '2 cm'], ['2.5', '2,5 cm'], ['3', '3 cm']], o.indent, { id: 'mdword-indent' });
      const justify = F.check('Texto justificado', o.justify);
      const abnt = F.check('Margens 3/2/3/2 cm (ABNT)', o.abnt, 'Desmarcado: 2,5 cm em todos os lados.');
      const pageNum = F.check('Numerar páginas no rodapé', o.pageNum);
      const preview = h('div', { class: 'doc', id: 'mdword-preview' });
      const sync = () => {
        Object.assign(o, { font: font.value, size: size.value, line: line.value, indent: indent.value, justify: justify.input.checked, abnt: abnt.input.checked, pageNum: pageNum.input.checked });
        F.store.set('mdword-opts', o); F.store.set('mdword-text', ta.value);
        render();
      };
      const render = F.debounce(async () => {
        preview.innerHTML = await F.mdToHtml(ta.value);
        styleForWord(preview, o);
      }, 150);
      [font, size, line, indent].forEach((s) => s.addEventListener('change', sync));
      [justify, abnt, pageNum].forEach((c) => c.input.addEventListener('change', sync));
      ta.addEventListener('input', sync);
      const out = outputPanel({
        tabs: ['Prévia'], ext: 'docx',
        onCopy: () => { const box = h('div'); box.innerHTML = preview.innerHTML; styleForWord(box, o, true); F.copy(preview.innerText, box.innerHTML); },
        onSave: async () => {
          try { const blob = await F.markdownToDocx(ta.value, o); F.save((firstHeading(ta.value) || 'documento') + '.docx', blob); }
          catch (e) { F.toast('Não foi possível gerar o .docx: ' + e.message, 'bad'); }
        },
      });
      out.copyBtn.lastChild.textContent = 'Copiar formatado';
      out.views[0].append(preview);
      root.append(h('div', { class: 'grid-even' },
        h('div', { class: 'stack' }, h('div', { class: 'card' }, ta),
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Formatação'), h('div', { class: 'fields-2' }, F.field('Fonte', font), F.field('Tamanho', size), F.field('Entrelinha', line), F.field('Recuo da 1ª linha', indent)), justify, abnt, pageNum,
            h('p', { class: 'tiny' }, 'Citações (>) saem com recuo de 4 cm, fonte 2 pt menor e entrelinha simples, como nas citações longas da ABNT NBR 10520.'))),
        h('div', { class: 'stack' }, out.el)));
      render();
    },
  });
  const firstHeading = (md) => { const m = /^#{1,3}\s+(.+)$/m.exec(md); return m ? m[1].replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) : ''; };

  // Aplica a formatação escolhida na prévia (e em linha, para colar no Word / PJe)
  function styleForWord(root, o, inline) {
    const sz = +o.size, lh = (+o.line * 1.15).toFixed(2);
    const fam = `font-family:'${o.font}',serif` + (inline ? ';color:#000' : '');
    root.setAttribute('style', `${fam};font-size:${sz}pt;line-height:${lh}`);
    for (const p of root.querySelectorAll('p')) {
      const inQuote = p.closest('blockquote'), inCell = p.closest('td,th,li');
      const st = inQuote ? `margin:0 0 ${sz}pt 4cm;font-size:${sz - 2}pt;line-height:1.15;text-align:justify;text-indent:0`
        : inCell ? 'margin:0;text-indent:0' : `margin:0 0 6pt;text-indent:${o.indent}cm;text-align:${o.justify ? 'justify' : 'left'}`;
      p.setAttribute('style', st + (inline ? ';' + fam + (inQuote ? '' : `;font-size:${sz}pt`) : ''));
    }
    for (const b of root.querySelectorAll('blockquote')) b.setAttribute('style', 'margin:0;padding:0;border:0;color:inherit;font-size:inherit');
    for (const x of root.querySelectorAll('h1')) x.setAttribute('style', `text-align:center;font-size:${sz + 2}pt;font-weight:bold;margin:12pt 0 6pt;${fam}`);
    for (const x of root.querySelectorAll('h2,h3,h4')) x.setAttribute('style', `font-size:${sz}pt;font-weight:bold;margin:12pt 0 6pt;${fam}`);
    for (const t of root.querySelectorAll('table')) t.setAttribute('style', 'border-collapse:collapse;margin:6pt 0');
    for (const c of root.querySelectorAll('td,th')) c.setAttribute('style', `border:1px solid #777;padding:3pt 6pt;text-align:left;vertical-align:top;font-size:${sz - 1}pt`);
  }

  // ---------- gerador de .docx (WordprocessingML mínimo, validado com o Word e o LibreOffice) ----------
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  F.markdownToDocx = async (md, o) => {
    await F.lib('marked'); await F.lib('jszip');
    const tokens = window.marked.lexer(md || '', { gfm: true });
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const links = [], nums = [];
    const sz = Math.round(+o.size * 2), cm = (v) => Math.round(+v * 567);
    const line = Math.round(240 * +o.line);
    const pageW = 11906, mar = o.abnt ? { t: 1701, l: 1701, b: 1134, r: 1134 } : { t: 1418, l: 1418, b: 1418, r: 1418 };
    const textW = pageW - mar.l - mar.r;

    const run = (text, st) => {
      const rp = [];
      if (st.link) rp.push('<w:rStyle w:val="Hyperlink"/>');
      if (st.code) rp.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
      if (st.b) rp.push('<w:b/>');
      if (st.i) rp.push('<w:i/>');
      if (st.s) rp.push('<w:strike/>');
      if (st.code) rp.push(`<w:sz w:val="${sz - 2}"/>`);
      return `<w:r>${rp.length ? '<w:rPr>' + rp.join('') + '</w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
    };
    const inline = (toks, st = {}) => (toks || []).map((t) => {
      switch (t.type) {
        case 'strong': return inline(t.tokens, Object.assign({}, st, { b: true }));
        case 'em': return inline(t.tokens, Object.assign({}, st, { i: true }));
        case 'del': return inline(t.tokens, Object.assign({}, st, { s: true }));
        case 'codespan': return run(unesc(t.text), Object.assign({}, st, { code: true }));
        case 'br': return '<w:r><w:br/></w:r>';
        case 'link': {
          if (!/^(https?:|mailto:)/i.test(t.href || '')) return inline(t.tokens, st);
          links.push(t.href); const id = 'rIdL' + links.length;
          return `<w:hyperlink r:id="${id}">${inline(t.tokens, Object.assign({}, st, { link: true }))}</w:hyperlink>`;
        }
        case 'image': return run(t.text ? '[imagem: ' + t.text + ']' : '[imagem]', st);
        case 'html': return /^<br\s*\/?>$/i.test(t.text.trim()) ? '<w:r><w:br/></w:r>' : '';
        case 'text': return t.tokens && t.tokens.length ? inline(t.tokens, st) : run(unesc(t.text).replace(/\n/g, ' '), st);
        case 'escape': return run(unesc(t.text), st);
        default: return t.text ? run(unesc(t.text), st) : '';
      }
    }).join('');
    const para = (content, p = {}) => {
      const pp = [];
      if (p.style) pp.push(`<w:pStyle w:val="${p.style}"/>`);
      if (p.num) pp.push(`<w:numPr><w:ilvl w:val="${p.num.lvl}"/><w:numId w:val="${p.num.id}"/></w:numPr>`);
      if (p.border) pp.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>');
      if (p.ind != null) pp.push(`<w:ind w:firstLine="${p.ind}"/>`);
      if (p.jc) pp.push(`<w:jc w:val="${p.jc}"/>`);
      return `<w:p>${pp.length ? '<w:pPr>' + pp.join('') + '</w:pPr>' : ''}${content}</w:p>`;
    };
    const blocks = (toks, ctx = {}) => (toks || []).map((t) => {
      switch (t.type) {
        case 'heading': return para(inline(t.tokens), { style: 'Heading' + Math.min(3, t.depth) });
        case 'paragraph': return para(inline(t.tokens), ctx.quote ? { style: 'Quote' } : ctx.cell ? { style: 'TableText' } : {});
        case 'text': return para(t.tokens ? inline(t.tokens) : run(unesc(t.text), {}), ctx.quote ? { style: 'Quote' } : ctx.cell ? { style: 'TableText' } : {});
        case 'blockquote': return blocks(t.tokens, Object.assign({}, ctx, { quote: true }));
        case 'code': return para(t.text.split('\n').map((l, k) => (k ? '<w:r><w:br/></w:r>' : '') + run(l, {})).join(''), { style: 'Code' });
        case 'hr': return para('', { border: true });
        case 'space': case 'html': case 'def': return '';
        case 'list': {
          const lvl = ctx.lvl == null ? 0 : ctx.lvl + 1;
          let id = 1;
          if (t.ordered) { nums.push(+t.start || 1); id = nums.length + 1; }
          return t.items.map((it) => {
            const parts = [];
            let first = true;
            for (const c of it.tokens) {
              if (c.type === 'list') { parts.push(blocks([c], Object.assign({}, ctx, { lvl }))); continue; }
              if (c.type !== 'text' && c.type !== 'paragraph') { parts.push(blocks([c], ctx)); continue; }
              const prefix = it.task ? run(it.checked ? '☒ ' : '☐ ', {}) : '';
              const content = prefix + (c.tokens ? inline(c.tokens) : run(unesc(c.text), {}));
              parts.push(para(content, first ? { style: 'ListParagraph', num: { id, lvl: Math.min(lvl, 2) } } : { style: 'ListParagraph' }));
              first = false;
            }
            return parts.join('');
          }).join('');
        }
        case 'table': {
          const n = t.header.length, colW = Math.floor(textW / n);
          const b = (s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
          const cell = (c, head, k) => `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : ''}</w:tcPr>${para(inline(c.tokens, head ? { b: true } : {}), { style: 'TableText', jc: t.align && t.align[k] === 'right' ? 'right' : t.align && t.align[k] === 'center' ? 'center' : null })}</w:tc>`;
          return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="' + colW + '"/>'.repeat(n)}</w:tblGrid>`
            + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${t.header.map((c, k) => cell(c, true, k)).join('')}</w:tr>`
            + t.rows.map((r) => `<w:tr>${r.map((c, k) => cell(c, false, k)).join('')}</w:tr>`).join('') + '</w:tbl>' + para('', { style: 'TableText' });
        }
        default: return t.text ? para(run(unesc(t.text), {})) : '';
      }
    }).join('');

    let bodyXml = blocks(tokens);
    if (!bodyXml) bodyXml = para('');
    const sect = `<w:sectPr>${o.pageNum ? '<w:footerReference w:type="default" r:id="rIdF1"/>' : ''}<w:pgSz w:w="${pageW}" w:h="16838"/><w:pgMar w:top="${mar.t}" w:right="${mar.r}" w:bottom="${mar.b}" w:left="${mar.l}" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>`;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}${sect}</w:body></w:document>`;
    const font = xmlEsc(o.font);
    const rFonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${rFonts}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="pt-BR" w:eastAsia="pt-BR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="${cm(o.indent)}"/><w:jc w:val="${o.justify ? 'both' : 'left'}"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${sz + 4}"/><w:szCs w:val="${sz + 4}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:i/><w:iCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="240" w:line="240" w:lineRule="auto"/><w:ind w:left="2268" w:firstLine="0"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="${sz - 4}"/><w:szCs w:val="${sz - 4}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Texto de tabela"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="${sz - 2}"/><w:szCs w:val="${sz - 2}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Código"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="${sz - 2}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="right"/></w:pPr><w:rPr><w:sz w:val="${sz - 4}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F3D99"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;
    const lvls = (fmt) => [0, 1, 2].map((l) => {
      const f = fmt === 'bullet' ? ['bullet', ['•', '◦', '▪'][l]] : [['decimal', 'lowerLetter', 'lowerRoman'][l], ['%1.', '%2)', '%3.'][l]];
      return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${f[0]}"/><w:lvlText w:val="${f[1]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join('');
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums.map((start, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS1" Type="${RT}/styles" Target="styles.xml"/><Relationship Id="rIdN1" Type="${RT}/numbering" Target="numbering.xml"/>${o.pageNum ? `<Relationship Id="rIdF1" Type="${RT}/footer" Target="footer1.xml"/>` : ''}${links.map((u, k) => `<Relationship Id="rIdL${k + 1}" Type="${RT}/hyperlink" Target="${xmlEsc(u)}" TargetMode="External"/>`).join('')}</Relationships>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${o.pageNum ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(firstHeading(md) || 'Documento')}</dc:title><dc:creator>Fólio Judiciário</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const zip = new window.JSZip();
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', rels);
    zip.file('docProps/core.xml', core);
    zip.file('word/document.xml', doc);
    zip.file('word/styles.xml', styles);
    zip.file('word/numbering.xml', numbering);
    zip.file('word/_rels/document.xml.rels', docRels);
    if (o.pageNum) zip.file('word/footer1.xml', footer);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  };

  // ======================================================================
  // Limpar texto copiado de PDF
  // ======================================================================
  const STAMPS_TXT = [/^assinado eletronicamente por/i, /^documento assinado eletronicamente/i, /^n[úu]mero do documento:/i, /consultadocumento\/listview\.seam/i, /^num\.\s*\d+\s*-\s*p[áa]g\.\s*\d+$/i, /^https?:\/\/\S*pje\S*$/i, /^este documento (é c[óo]pia|foi (gerado|assinado))/i, /^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?$/i, /^[-–]\s*\d{1,4}\s*[-–]$/];
  F.cleanPdfText = (text, o) => {
    let t = String(text || '').replace(/\r\n?/g, '\n');
    if (o.ligatures) t = t.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/[​-‍﻿]/g, '').replace(/ /g, ' ').replace(/\t/g, ' ');
    let lines = t.split('\n').map((l) => l.replace(/[ \t]+$/g, ''));
    if (o.stamps) lines = lines.filter((l) => !STAMPS_TXT.some((re) => re.test(l.trim())));
    if (o.join) {
      const lens = lines.map((l) => l.trim().length).filter((n) => n > 20).sort((a, b) => a - b);
      const typical = lens.length ? lens[Math.floor(lens.length * 0.85)] : 80;
      const out = [];
      let cur = '';
      const isStart = (l) => /^([•●▪◦\-–—*]\s|\d{1,3}[.)]\s|[a-z][)]\s|[IVXLC]+\s*[-–.)]\s|art\.\s*\d|§\s*\d|par[áa]grafo [úu]nico)/i.test(l);
      const isHeading = (l) => l.length < 70 && /\p{L}{3}/u.test(l) && l === l.toLocaleUpperCase('pt-BR') && !/[,;]$/.test(l);
      for (let k = 0; k < lines.length; k++) {
        const l = lines[k].trim();
        if (!l) { if (cur) { out.push(cur); cur = ''; } continue; }
        if (!cur) { cur = l; if (isHeading(l)) { out.push(cur); cur = ''; } continue; }
        const prevEnded = /[.:;!?…"”)]$/.test(cur) && lines[k - 1].trim().length < typical * 0.8;
        if (prevEnded || isStart(l) || isHeading(l)) { out.push(cur); cur = l; if (isHeading(l)) { out.push(cur); cur = ''; } continue; }
        if (o.dehyphen && /\p{L}-$/u.test(cur) && /^\p{Ll}/u.test(l)) cur = cur.slice(0, -1) + l;
        else cur += ' ' + l;
      }
      if (cur) out.push(cur);
      t = out.join('\n\n');
    } else t = lines.join('\n');
    if (o.spaces) t = t.replace(/[ ]{2,}/g, ' ').replace(/ +([,.;:!?)])/g, '$1').replace(/\( +/g, '(').replace(/\n{3,}/g, '\n\n');
    if (o.quotes) t = t.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'");
    return t.trim() + '\n';
  };
  F.register({
    id: 'limpar-texto', group: 'conv', name: 'Limpar texto de PDF',
    keywords: 'colar texto pdf quebra de linha hifenização juntar linhas espaços ligaduras',
    desc: 'Cole um trecho copiado de PDF: junta as linhas quebradas no meio das frases, desfaz a hifenização, remove carimbos e números de página e corrige ligaduras (ﬁ, ﬂ) e espaços.',
    refs: ['Colar e copiar'],
    render(root) {
      const sample = 'Trata-se de ação de indenização ajuizada por JOÃO EXEMPLO\nDA SILVA em desfavor de BANCO FICTÍCIO S.A., na qual o autor ale-\nga que foram descontadas de sua conta parcelas de um emprés-\ntimo que aﬁrma nunca ter contratado .\nNum. 123456789 - Pág. 1\nO réu apresentou contestação, na qual sustenta a regularidade\nda contratação.\n\nII – FUNDAMENTAÇÃO\nO feito comporta julgamento antecipado.';
      const input = F.textarea({ id: 'limpar-in', 'aria-label': 'Texto original', class: 'textarea prose', value: sample, style: 'min-height:360px' });
      const output = F.textarea({ id: 'limpar-out', 'aria-label': 'Texto limpo', class: 'textarea prose', style: 'min-height:360px', readOnly: true });
      const ck = { join: F.check('Juntar linhas quebradas', true), dehyphen: F.check('Desfazer hifenização', true), stamps: F.check('Remover carimbos do PJe e números de página', true), ligatures: F.check('Corrigir ligaduras e caracteres invisíveis', true), spaces: F.check('Espaços duplicados e antes de pontuação', true), quotes: F.check('Aspas curvas → retas', false) };
      const stats = h('div', { class: 'stats' });
      const run = () => {
        const o = Object.fromEntries(Object.entries(ck).map(([k, c]) => [k, c.input.checked]));
        output.value = F.cleanPdfText(input.value, o);
        const a = input.value.split('\n').length, b = output.value.trim().split('\n').filter(Boolean).length;
        stats.replaceChildren(h('span', null, `${a} linhas → ${b} parágrafos`), h('span', null, `${F.nf(F.words(output.value))} palavras`));
      };
      input.addEventListener('input', F.debounce(run, 120));
      Object.values(ck).forEach((c) => c.input.addEventListener('change', run));
      root.append(h('div', { class: 'stack' },
        h('div', { class: 'card card-pad row' }, ...Object.values(ck)),
        h('div', { class: 'grid-even' },
          h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Texto copiado do PDF'), h('span', { class: 'grow' }), F.btn('Limpar', () => { input.value = ''; run(); input.focus(); }, { small: true, kind: 'quiet' })), input),
          h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Resultado'), h('span', { class: 'grow' }), F.btn('Copiar', () => F.copy(output.value), { icon: 'copy', small: true, kind: 'primary' })), output, stats))));
      run();
    },
  });
})();
