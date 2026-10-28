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
  function openPalette(q = '') { pal.hidden = false; palIn.value = q; palSel = 0; renderPalette(); setTimeout(() => palIn.focus(), 10); }
  function closeDialogs() { pal.hidden = true; $('shortcuts').hidden = true; }
  function renderPalette() {
    const q = palIn.value.trim();
    const rows = [];
    if (q) palItems = search(q).slice(0, 14);
    else {
      const rec = recents.slice(0, 5).map((id) => toolById[id]);
      const rest = TOOLS.filter((t) => !rec.includes(t)).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 10);
      palItems = [...rec, ...rest];
      if (rec.length) rows.push([0, 'Recentes']);
      rows.push([rec.length, rec.length ? 'Sugestões' : 'Ferramentas']);
    }
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    const lis = [];
    palItems.forEach((t, i) => {
      const g = rows.find((r) => r[0] === i); if (g) lis.push(h('li', { class: 'group', role: 'presentation' }, g[1]));
      lis.push(h('li', { class: i === palSel ? 'sel' : '', role: 'option', 'aria-selected': String(i === palSel), onmousemove: () => { if (palSel !== i) { palSel = i; renderPalette(); } } },
        h('a', { href: toolHref(t.id) }, h('span', { class: 'ticon', style: `--c:${catById[t.cat].color}` }, svg(t.icon)), h('b', null, t.name), h('small', null, catById[t.cat].name))));
    });
    if (!palItems.length) lis.push(h('li', { class: 'group' }, 'Nenhum resultado'));
    palList.replaceChildren(...lis);
    palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  palIn.addEventListener('input', () => { palSel = 0; renderPalette(); });
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { palSel = (palSel + 1) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = (palSel - 1 + palItems.length) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter' && palItems[palSel]) location.href = toolHref(palItems[palSel].id);
  });
  [pal, $('shortcuts')].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) closeDialogs(); }));
  $('openPalette').addEventListener('click', () => openPalette());
  $('shortcutsBtn').addEventListener('click', () => { $('shortcuts').hidden = false; });

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closeDialogs(); return; }
    if (e.key === 'Escape') { closeDialogs(); setMenu(false); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
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

  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));
  decorate(); syncStars(); renderNavRecent(); renderPersonal();
})();
