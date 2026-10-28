/* ==========================================================
   Gooners — aplicação (busca, favoritos, ferramenta, paleta, PWA)
   ========================================================== */
(function () {
  'use strict';
  const { TOOLS, CATEGORIES, h, copy, toast, stripAccents } = window.Gooners;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const R = body.dataset.root || '';
  const PAGE = body.dataset.page;
  const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
  const toolHref = (id) => `${R}ferramentas/${id}/index.html`;
  const svg = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `${R}assets/icons.svg#i-${name}`); s.append(u); return s; };

  // Endereços antigos (#/ferramenta/<id>) → páginas estáticas
  const legacy = location.hash.match(/^#\/ferramenta\/([\w-]+)/);
  if (legacy && toolById[legacy[1]]) { location.replace(toolHref(legacy[1])); return; }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('gooners:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('gooners:' + k, JSON.stringify(v)); } catch { /* indisponível */ } },
  };
  let favs = new Set(store.get('favs', []).filter((id) => toolById[id]));
  let recents = store.get('recents', []).filter((id) => toolById[id]);
  const usage = store.get('usage', {});

  // ---------- tema ----------
  const root = document.documentElement;
  function toggleTheme() { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; store.set('theme', root.dataset.theme); }
  $('themeToggle').addEventListener('click', toggleTheme);

  // ---------- menu lateral (mobile) ----------
  const sidebar = $('sidebar'), scrim = $('scrim'), menuBtn = $('menuBtn');
  const setMenu = (open) => { sidebar.classList.toggle('open', open); scrim.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
  scrim.addEventListener('click', () => setMenu(false));

  // ---------- cards ----------
  function card(t) {
    const c = catById[t.cat];
    return h('a', { class: 'tcard', href: toolHref(t.id), 'data-id': t.id, style: `--c:${c.color}` },
      h('span', { class: 'ticon' }, svg(t.icon)), h('span', { class: 'tbody' }, h('span', { class: 'tname' }, t.name), h('span', { class: 'tdesc' }, t.desc)));
  }
  function decorate(scope = document) {
    scope.querySelectorAll('.tcard[data-id]').forEach((a) => {
      if (a.querySelector('.star')) return;
      const id = a.dataset.id;
      const b = h('button', { class: 'star' + (favs.has(id) ? ' on' : ''), type: 'button', 'aria-label': 'Favoritar ' + (toolById[id]?.name || ''), 'aria-pressed': String(favs.has(id)),
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleFav(id); } }, svg('star'));
      a.append(b);
    });
  }
  function syncStars() {
    document.querySelectorAll('.tcard[data-id] .star').forEach((b) => { const on = favs.has(b.parentElement.dataset.id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('favCount').textContent = favs.size;
  }
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store.set('favs', [...favs]);
    toast(favs.has(id) ? 'Adicionada aos favoritos' : 'Removida dos favoritos');
    syncStars(); updateFavBtn(); renderPersonal();
  }

  // ---------- recentes na barra lateral ----------
  function renderNavRecent() {
    const list = recents.slice(0, 5).map((id) => toolById[id]);
    $('navRecent').hidden = !list.length;
    $('navRecentList').replaceChildren(...list.map((t) => h('a', { class: 'nav-item', href: toolHref(t.id), style: `--c:${catById[t.cat].color}` }, svg(t.icon), h('span', null, t.name))));
  }

  // ---------- busca ----------
  const norm = (s) => stripAccents(String(s)).toLowerCase();
  TOOLS.forEach((t) => { t._name = norm(t.name); t._hay = norm([t.name, t.desc, t.keys, catById[t.cat].name].join(' ')); });
  function score(t, q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return 1;
    let s = 0;
    for (const term of terms) {
      if (t._name.startsWith(term)) s += 6;
      else if (t._name.includes(term)) s += 4;
      else if (t._hay.includes(term)) s += 1;
      else if (term.length > 3 && t._hay.includes(term.slice(0, -1))) s += .5; // tolera plural/singular
      else return 0;
    }
    return s + Math.min(2, (usage[t.id] || 0) / 10);
  }
  const search = (q, list = TOOLS) => list.map((t) => [t, score(t, q)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);

  const pageSearch = $('search');
  if (pageSearch) {
    const sections = [...document.querySelectorAll('[data-cat-section]')];
    const run = () => {
      const q = pageSearch.value.trim();
      let shown = 0;
      sections.forEach((sec) => {
        if (sec.dataset.catSection === 'popular') { sec.hidden = !!q; return; }
        let n = 0;
        sec.querySelectorAll('.tcard[data-id]').forEach((a) => { const ok = !q || score(toolById[a.dataset.id], q) > 0; a.hidden = !ok; if (ok) n++; });
        sec.hidden = !n; shown += n;
      });
      if ($('personal')) $('personal').hidden = !!q || !$('personalGrid').children.length;
      $('empty').hidden = shown > 0;
      $('searchCount').textContent = q ? `${shown} resultado${shown === 1 ? '' : 's'}` : '';
    };
    pageSearch.addEventListener('input', run);
    pageSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = document.querySelector('[data-cat-section]:not([hidden]) .tcard:not([hidden])'); if (first) location.href = first.href; }
    });
    const q0 = new URLSearchParams(location.search).get('q');
    if (q0) { pageSearch.value = q0; run(); }
  }

  // ---------- home: atalhos pessoais ----------
  function renderPersonal() {
    const grid = $('personalGrid');
    if (grid) {
      const ids = [...new Set([...favs, ...recents])].slice(0, 12);
      grid.replaceChildren(...ids.map((id) => card(toolById[id])));
      decorate(grid);
      $('personal').hidden = !ids.length || !!(pageSearch && pageSearch.value.trim());
    }
    if ($('favGrid')) {
      $('favGrid').replaceChildren(...[...favs].map((id) => card(toolById[id])));
      $('favEmpty').hidden = favs.size > 0;
      $('recGrid').replaceChildren(...recents.map((id) => card(toolById[id])));
      decorate($('favGrid')); decorate($('recGrid'));
    }
  }

  // ---------- página de ferramenta ----------
  const toolId = body.dataset.tool;
  function updateFavBtn() {
    const b = $('favBtn'); if (!b || !toolId) return;
    const on = favs.has(toolId);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    b.querySelector('span').textContent = on ? 'Favorita' : 'Favoritar';
  }
  if (PAGE === 'tool' && toolById[toolId]) {
    const t = toolById[toolId];
    const tb = $('toolBody');
    tb.replaceChildren();
    window.Gooners.currentTool = t.id;
    try { t.render(tb); } catch (e) { tb.append(h('p', { class: 'badge bad' }, 'Erro ao carregar a ferramenta: ' + e.message)); console.error(e); }
    recents = [t.id, ...recents.filter((x) => x !== t.id)].slice(0, 12);
    usage[t.id] = (usage[t.id] || 0) + 1;
    store.set('recents', recents); store.set('usage', usage);
    $('favBtn').addEventListener('click', () => toggleFav(t.id));
    $('shareBtn').addEventListener('click', async () => {
      const data = { title: document.title, text: t.desc, url: location.href.split('#')[0] };
      if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
      copy(data.url);
    });
    $('focusBtn').addEventListener('click', () => { const on = body.classList.toggle('focus-mode'); toast(on ? 'Modo foco ativado' : 'Modo foco desativado'); window.scrollTo({ top: 0 }); });
    updateFavBtn();
  }

  // ---------- paleta de comandos ----------
  const pal = $('palette'), palIn = $('paletteInput'), palList = $('paletteList');
  let palSel = 0, palItems = [];
  function openPalette(q = '') { pal.hidden = false; palIn.value = q; palSel = 0; renderPalette(); palIn.focus(); }
  function closeDialogs() { pal.hidden = true; $('shortcuts').hidden = true; }
  const CT = window.GOONERS_CONTACT || {};
  const ACTIONS = [
    { name: 'Alternar tema claro/escuro', icon: 'moon', keys: 'tema escuro claro dark light', run: () => { toggleTheme(); closeDialogs(); } },
    { name: 'Falar no WhatsApp', icon: 'message-circle', keys: 'whatsapp contato suporte ajuda', href: `https://wa.me/${CT.whatsapp}?text=${encodeURIComponent('Olá! Vim pelo site do Gooners.')}`, ext: true },
    { name: 'Contato e sugestões', icon: 'mail', keys: 'contato email sugestao problema erro', href: `${R}contato/index.html` },
    { name: 'Seus favoritos', icon: 'star', keys: 'favoritos salvos', href: `${R}favoritos/index.html` },
    { name: 'Gooners Law', icon: 'scale', keys: 'law juridico advogado patrimonial offshore', href: `${R}law/index.html` },
    { name: 'Notícias jurídicas', icon: 'newspaper', keys: 'noticias juridicas stf stj', href: `${R}law/noticias/index.html` },
  ].map((a) => ({ ...a, action: true, _hay: norm(a.name + ' ' + a.keys) }));
  const matchAction = (a, q) => norm(q).split(/\s+/).filter(Boolean).every((t) => a._hay.includes(t));
  function renderPalette() {
    const q = palIn.value.trim();
    const rows = [];
    if (q) {
      // Ações cujo nome contém a busca vêm antes das ferramentas; as que só batem por palavra-chave vêm depois
      const acts = ACTIONS.filter((a) => matchAction(a, q)), top = acts.filter((a) => norm(q).split(/\s+/).every((t) => norm(a.name).includes(t))), rest = acts.filter((a) => !top.includes(a));
      const tools = search(q).slice(0, 12);
      palItems = [...top, ...tools, ...rest];
      if (top.length) rows.push([0, 'Ações']);
      if (tools.length && top.length) rows.push([top.length, 'Ferramentas']);
      if (rest.length && tools.length) rows.push([top.length + tools.length, 'Outras ações']);
    }
    else {
      const rec = recents.slice(0, 5).map((id) => toolById[id]);
      const rest = TOOLS.filter((t) => !rec.includes(t)).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 10);
      palItems = [...rec, ...rest, ...ACTIONS];
      if (rec.length) rows.push([0, 'Recentes']);
      rows.push([rec.length, rec.length ? 'Sugestões' : 'Ferramentas']);
      rows.push([rec.length + rest.length, 'Ações']);
    }
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    const lis = [];
    palItems.forEach((t, i) => {
      const g = rows.find((r) => r[0] === i); if (g) lis.push(h('li', { class: 'group', role: 'presentation' }, g[1]));
      const link = t.action
        ? h('a', { href: t.href || '#', target: t.ext ? '_blank' : null, rel: t.ext ? 'noopener' : null, onclick: (e) => { if (t.run) { e.preventDefault(); t.run(); } } }, h('span', { class: 'ticon', style: '--c:var(--muted)' }, svg(t.icon)), h('b', null, t.name), h('small', null, 'Ação'))
        : h('a', { href: toolHref(t.id) }, h('span', { class: 'ticon', style: `--c:${catById[t.cat].color}` }, svg(t.icon)), h('b', null, t.name), h('small', null, catById[t.cat].name));
      lis.push(h('li', { class: i === palSel ? 'sel' : '', role: 'option', 'aria-selected': String(i === palSel), onmousemove: () => { if (palSel !== i) { palSel = i; renderPalette(); } } }, link));
    });
    if (!palItems.length) lis.push(h('li', { class: 'group' }, 'Nenhum resultado'));
    palList.replaceChildren(...lis);
    palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  palIn.addEventListener('input', () => { palSel = 0; renderPalette(); });
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { palSel = (palSel + 1) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = (palSel - 1 + palItems.length) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter' && palItems[palSel]) palList.querySelector('li.sel a')?.click();
  });
  [pal, $('shortcuts')].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) closeDialogs(); }));
  $('openPalette').addEventListener('click', () => openPalette());
  $('shortcutsBtn').addEventListener('click', () => { $('shortcuts').hidden = false; });

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closeDialogs(); return; }
    if (e.key === 'Escape') { closeDialogs(); setMenu(false); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !pal.hidden || !$('shortcuts').hidden) return;
    if (e.key === '/') { e.preventDefault(); pageSearch ? pageSearch.focus() : openPalette(); }
    else if (e.key === '?') $('shortcuts').hidden = false;
    else if (e.key.toLowerCase() === 't') toggleTheme();
    else if (e.key.toLowerCase() === 'f' && PAGE === 'tool') toggleFav(toolId);
  });

  // ---------- PWA ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBtn').hidden = true; });
  try {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register(R + 'sw.js').catch(() => {});
  } catch { /* ambiente sem service worker (iframe isolado) */ }

  // ---------- demonstração ao vivo (home) ----------
  const demo = $('demoInput');
  if (demo) {
    const BOLD = (s) => Array.from(s).map((c) => { const k = c.codePointAt(0); return k >= 65 && k <= 90 ? String.fromCodePoint(0x1D400 + k - 65) : k >= 97 && k <= 122 ? String.fromCodePoint(0x1D41A + k - 97) : k >= 48 && k <= 57 ? String.fromCodePoint(0x1D7CE + k - 48) : c; }).join('');
    const runDemo = () => {
      const v = demo.value;
      $('dChars').textContent = Array.from(v).length.toLocaleString('pt-BR');
      $('dWords').textContent = (v.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length.toLocaleString('pt-BR');
      $('dNoSp').textContent = Array.from(v.replace(/\s/g, '')).length.toLocaleString('pt-BR');
      $('dRev').textContent = Array.from(v).reverse().join('');
      $('dUp').textContent = v.toLocaleUpperCase('pt-BR');
      $('dSlug').textContent = stripAccents(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      $('dBold').textContent = BOLD(v);
    };
    demo.addEventListener('input', runDemo); runDemo();
    document.querySelectorAll('.demo-out output').forEach((o) => { o.title = 'Clique para copiar'; o.addEventListener('click', () => o.textContent && copy(o.textContent)); });
  }

  // ---------- copiar dados de contato ----------
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); });

  // ---------- formulário de contato ----------
  const cf = $('contactForm');
  if (cf) {
    let via = 'wa';
    cf.querySelectorAll('button[type="submit"]').forEach((b) => b.addEventListener('click', () => (via = b.dataset.via)));
    const t0 = new URLSearchParams(location.search).get('ferramenta'); if (t0) { $('cfTool').value = t0; $('cfTipo').value = 'Relatar um problema'; }
    cf.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = $('cfMsgOut');
      if (!cf.checkValidity()) { out.textContent = 'Preencha seu nome e a mensagem.'; out.style.color = 'var(--bad-text)'; cf.querySelector(':invalid')?.focus(); return; }
      const v = Object.fromEntries(new FormData(cf));
      const text = `Olá! Sou ${v.nome}.\nAssunto: ${v.tipo}${v.tool ? '\nFerramenta: ' + v.tool : ''}\n\n${v.msg}`;
      if (via === 'wa') window.open(`https://wa.me/${CT.whatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      else location.href = `mailto:${CT.email}?subject=${encodeURIComponent('[Gooners] ' + v.tipo)}&body=${encodeURIComponent(text)}`;
      out.style.color = ''; out.textContent = via === 'wa' ? `Mensagem pronta no WhatsApp ${CT.phone}. Conclua o envio no aplicativo.` : `E-mail pronto para ${CT.email}. Conclua o envio no seu aplicativo de e-mail.`;
    });
  }

  // ---------- busca na página 404 ----------
  const nf = $('nfSearch');
  if (nf) nf.addEventListener('keydown', (e) => { if (e.key === 'Enter' && nf.value.trim()) location.href = `${R}index.html?q=${encodeURIComponent(nf.value.trim())}`; });

  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));
  decorate(); syncStars(); renderNavRecent(); renderPersonal();
})();
