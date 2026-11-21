/* Fólio — núcleo: registro de ferramentas, rotas por #hash, utilitários de DOM, cópia, download e bibliotecas. */
(function () {
  'use strict';
  const F = (window.Folio = window.Folio || {});
  F.tools = [];
  F.groups = [
    { id: 'conv', name: 'Converter' },
    { id: 'pdf', name: 'PDF' },
    { id: 'calc', name: 'Prazos e cálculos' },
    { id: 'texto', name: 'Texto e dados' },
  ];

  // ---------- DOM ----------
  F.$ = (sel, root) => (root || document).querySelector(sel);
  F.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  F.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  const h = F.h;

  const ICONS = {
    upload: '<path d="M12 15V3m0 0L7 8m5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M12 3v12m0 0-5-5m5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    play: '<path d="m6 4 14 8-14 8z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  };
  F.icon = (name) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  };

  // ---------- controles ----------
  F.btn = (label, onclick, opts = {}) => h('button', { type: 'button', class: 'btn ' + (opts.kind ? 'btn-' + opts.kind : '') + (opts.small ? ' btn-sm' : ''), onclick, id: opts.id, title: opts.title, disabled: opts.disabled }, opts.icon ? F.icon(opts.icon) : null, label);
  F.field = (label, control, hint) => h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', null, hint) : null);
  F.input = (attrs) => h('input', Object.assign({ class: 'input', type: 'text' }, attrs));
  F.textarea = (attrs) => h('textarea', Object.assign({ class: 'textarea', spellcheck: 'false' }, attrs));
  F.select = (options, value, attrs) => {
    const s = h('select', Object.assign({ class: 'select' }, attrs));
    for (const o of options) {
      if (o.group) { const g = h('optgroup', { label: o.group }); for (const p of o.options) g.append(h('option', { value: p[0] }, p[1])); s.append(g); }
      else s.append(h('option', { value: o[0] }, o[1]));
    }
    if (value != null) s.value = value;
    return s;
  };
  F.check = (label, checked, hint, attrs) => {
    const input = h('input', Object.assign({ type: 'checkbox', checked: !!checked }, attrs));
    const el = h('label', { class: 'check' }, input, h('span', null, label, hint ? h('small', null, hint) : null));
    el.input = input;
    return el;
  };
  F.seg = (options, value, onChange, attrs) => {
    const el = h('div', Object.assign({ class: 'seg', role: 'group' }, attrs));
    el.value = value;
    const set = (v, fire) => { el.value = v; for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.v === v)); if (fire && onChange) onChange(v); };
    for (const [v, label] of options) el.append(h('button', { type: 'button', 'data-v': v, onclick: () => set(v, true) }, label));
    set(value, false);
    el.set = set;
    return el;
  };
  F.tabs = (names, onChange) => {
    const el = h('div', { class: 'tabs', role: 'tablist' });
    const set = (i, fire) => { [...el.children].forEach((b, k) => b.setAttribute('aria-selected', String(k === i))); el.index = i; if (fire && onChange) onChange(i); };
    names.forEach((n, i) => el.append(h('button', { type: 'button', role: 'tab', onclick: () => set(i, true) }, n)));
    set(0, false);
    el.set = set;
    return el;
  };

  // ---------- avisos ----------
  let toastHost;
  F.toast = (msg, kind) => {
    if (!toastHost) { toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
    toastHost.append(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 2600);
  };

  // ---------- armazenamento local (só conveniências) ----------
  F.store = {
    get(k, def) { try { const v = localStorage.getItem('folio:' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem('folio:' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };

  // ---------- cópia ----------
  function fallbackCopy(text, html) {
    const node = document.createElement(html ? 'div' : 'textarea');
    if (html) { node.innerHTML = html; node.contentEditable = 'true'; } else node.value = text;
    node.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;white-space:pre-wrap';
    document.body.appendChild(node);
    if (html) { const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } else node.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    node.remove();
    if (html) getSelection().removeAllRanges();
    return ok;
  }
  F.copy = async (text, html) => {
    if (!text) { F.toast('Nada para copiar ainda.', 'bad'); return false; }
    try {
      if (html && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      F.toast(html ? 'Copiado com formatação' : 'Copiado');
      return true;
    } catch {
      const ok = fallbackCopy(text, html);
      F.toast(ok ? 'Copiado' : 'O navegador bloqueou a cópia. Selecione o texto e use Ctrl+C.', ok ? '' : 'bad');
      return ok;
    }
  };

  // ---------- download ----------
  // No claude.ai a página roda num quadro que só salva arquivos pela capacidade "downloads"
  // (o visitante confirma). Fora dele (GitHub Pages, arquivo local), um <a download> comum.
  const host = !!(window.claude && typeof window.claude.use === 'function');
  let dlPromise = null;
  const downloads = () => (dlPromise = dlPromise || (host ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null)));
  if (host) downloads();
  F.save = async (filename, data, mime) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    if (host) {
      const dl = await downloads();
      if (dl) {
        try { await dl.save({ filename, data: blob }); F.toast('Arquivo enviado para download: ' + filename); return true; }
        catch (e) {
          const code = (e && e.code) || 'erro';
          if (code === 'declined') return false;
          if (code === 'rate_limited') F.toast('Já há um download aguardando confirmação.', 'bad');
          else F.toast('Não foi possível salvar o arquivo aqui (' + code + '). Use o botão Copiar.', 'bad');
          return false;
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: 'display:none' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  };

  // ---------- bibliotecas (carregadas sob demanda, versões fixas) ----------
  const LIBS = {
    pdfjs: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'],
    pdflib: ['https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'],
    mammoth: ['https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js'],
    turndown: ['https://cdnjs.cloudflare.com/ajax/libs/turndown/7.1.2/turndown.min.js', 'https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js'],
    marked: ['https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js'],
    jszip: ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'],
    dmp: ['https://cdnjs.cloudflare.com/ajax/libs/diff_match_patch/20121119/diff_match_patch.js'],
    tesseract: ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'],
  };
  const scriptCache = {};
  F.loadScript = (src) => (scriptCache[src] = scriptCache[src] || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { delete scriptCache[src]; reject(new Error('Não foi possível carregar ' + src.split('/').slice(-1)[0] + '. Verifique a conexão.')); };
    document.head.append(s);
  }));
  F.lib = async (name) => {
    for (const src of LIBS[name]) await F.loadScript(src);
    if (name === 'pdfjs' && window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return true;
  };
  F.openPdf = async (data) => {
    await F.lib('pdfjs');
    return window.pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, fontExtraProperties: false, useSystemFonts: false }).promise;
  };

  // ---------- Markdown → HTML seguro ----------
  F.mdToHtml = async (md) => {
    await F.lib('marked');
    const html = window.marked.parse(md || '', { gfm: true, breaks: false });
    const clean = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    const box = document.createElement('div');
    box.innerHTML = clean;
    for (const t of box.querySelectorAll('table')) { const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.append(t); }
    for (const a of box.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return box.innerHTML;
  };

  // ---------- arquivos ----------
  F.fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  F.baseName = (name) => String(name || 'documento').replace(/\.[^.]+$/, '');
  F.dropzone = ({ accept, multiple, title, hint, onFiles }) => {
    const input = h('input', { type: 'file', accept, multiple: !!multiple, tabindex: '-1' });
    const zone = h('div', { class: 'drop', role: 'button', tabindex: '0', 'aria-label': title }, F.icon('upload'), h('strong', null, title), h('span', null, hint), input);
    const take = (list) => { const files = Array.from(list || []); if (files.length) onFiles(multiple ? files : [files[0]]); };
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { take(input.files); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); take(e.dataTransfer.files); });
    return zone;
  };
  F.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  F.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  F.words = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  F.nf = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

  // ---------- registro e rotas ----------
  F.register = (tool) => { F.tools.push(tool); };

  const panels = {};
  let current = null;
  function show(id) {
    const tool = F.tools.find((t) => t.id === id) || F.tools[0];
    if (current === tool.id) return;
    current = tool.id;
    for (const [tid, p] of Object.entries(panels)) p.hidden = tid !== tool.id;
    if (!panels[tool.id]) {
      const body = h('div', { class: 'tool-body' });
      const group = F.groups.find((g) => g.id === tool.group);
      const panel = h('section', { class: 'tool', id: 'tool-' + tool.id, 'aria-labelledby': 'h-' + tool.id },
        h('header', { class: 'tool-head' },
          h('div', { class: 'eyebrow' }, group ? group.name : ''),
          h('h1', { id: 'h-' + tool.id }, tool.name),
          tool.desc ? h('p', { class: 'lede' }, tool.desc) : null,
          tool.refs && tool.refs.length ? h('div', { class: 'refs' }, tool.refs.map((r) => h('span', { class: 'ref' }, r))) : null),
        body);
      panels[tool.id] = panel;
      F.$('#main').append(panel);
      try { tool.render(body); } catch (e) { console.error(e); body.append(h('div', { class: 'note note-warn' }, 'Esta ferramenta não carregou: ' + e.message)); }
    }
    if (tool.onShow) tool.onShow();
    for (const a of F.$$('.side-link')) a.setAttribute('aria-current', a.dataset.id === tool.id ? 'page' : 'false');
    document.title = tool.id === F.tools[0].id ? 'Fólio Judiciário' : tool.name + ' · Fólio Judiciário';
    F.$('#sidebar').classList.remove('open');
    F.store.set('last', tool.id);
  }
  F.show = (id) => { if (location.hash.slice(1) !== id) location.hash = id; else show(id); };

  F.start = () => {
    document.documentElement.lang = 'pt-BR';
    const nav = F.$('#sidebar');
    const search = h('input', { class: 'side-search', type: 'search', placeholder: 'Buscar ferramenta…', 'aria-label': 'Buscar ferramenta', id: 'side-search' });
    nav.append(search);
    for (const g of F.groups) {
      const items = F.tools.filter((t) => t.group === g.id);
      if (!items.length) continue;
      nav.append(h('div', { class: 'side-group', 'data-group': g.id }, h('h2', null, g.name),
        items.map((t) => h('a', { class: 'side-link', href: '#' + t.id, 'data-id': t.id, 'data-k': (t.name + ' ' + (t.keywords || '') + ' ' + (t.desc || '')).toLowerCase() }, t.name, t.tag ? h('span', { class: 'tag' }, t.tag) : null))));
    }
    nav.append(h('div', { class: 'side-foot' },
      h('p', null, 'Os arquivos são processados no seu navegador e não são enviados a nenhum servidor.'),
      h('p', null, 'Projeto independente, sem vínculo oficial com o TJDFT. Confira prazos e cálculos nos sistemas e atos normativos oficiais.')));
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    search.addEventListener('input', () => {
      const q = norm(search.value.trim().toLowerCase());
      for (const a of F.$$('.side-link')) a.hidden = !!q && !norm(a.dataset.k).includes(q);
      for (const g of F.$$('.side-group')) g.hidden = F.$$('.side-link', g).every((a) => a.hidden);
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = F.$$('.side-link').find((x) => !x.hidden); if (a) F.show(a.dataset.id); } });
    F.$('#menu-btn').addEventListener('click', () => nav.classList.toggle('open'));
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); nav.classList.add('open'); search.focus(); search.select(); }
      if (e.key === 'Escape') nav.classList.remove('open');
    });
    const route = () => show(location.hash.slice(1) || F.tools[0].id);
    window.addEventListener('hashchange', route);
    route();
  };
})();
