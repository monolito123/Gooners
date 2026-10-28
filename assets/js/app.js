/* ==========================================================
   Gooners — aplicação (roteamento, busca, favoritos, paleta)
   ========================================================== */
(function () {
  'use strict';
  const { TOOLS, CATEGORIES, h, copy, toast, stripAccents } = window.Gooners;
  const $ = (id) => document.getElementById(id);
  const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

  // ---------- armazenamento seguro ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('gooners:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('gooners:' + k, JSON.stringify(v)); } catch { /* indisponível */ } },
  };
  let favs = new Set(store.get('favs', []));
  let recents = store.get('recents', []);
  let currentCat = 'all';

  // ---------- tema ----------
  const root = document.documentElement;
  root.dataset.theme = store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  $('themeToggle').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
  });

  // ---------- busca ----------
  const norm = (s) => stripAccents(String(s)).toLowerCase();
  TOOLS.forEach((t) => { t._hay = norm([t.name, t.desc, t.keys, catById[t.cat].name].join(' ')); });
  function score(t, q) {
    if (!q) return 1;
    const terms = norm(q).split(/\s+/).filter(Boolean);
    let s = 0;
    for (const term of terms) {
      if (!t._hay.includes(term)) return 0;
      s += norm(t.name).includes(term) ? 3 : 1;
    }
    return s;
  }
  const search = (q, list = TOOLS) => list.map((t) => [t, score(t, q)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);

  // ---------- cards ----------
  function card(t, i = 0) {
    const c = catById[t.cat];
    const star = h('button', { class: 'star' + (favs.has(t.id) ? ' on' : ''), title: 'Favoritar', 'aria-label': 'Favoritar ' + t.name,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleFav(t.id); star.classList.toggle('on', favs.has(t.id)); star.textContent = favs.has(t.id) ? '★' : '☆'; } }, favs.has(t.id) ? '★' : '☆');
    return h('a', { class: 'tcard', href: '#/ferramenta/' + t.id, style: `--c:${c.color};animation-delay:${Math.min(i, 20) * 18}ms` },
      h('span', { class: 'ticon' }, t.icon), h('div', null, h('h3', null, t.name), h('p', null, t.desc)), star);
  }
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    store.set('favs', [...favs]);
    toast(favs.has(id) ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
    if (location.hash === '#/favoritos') renderGrid();
  }

  // ---------- home ----------
  function renderChips() {
    const counts = TOOLS.reduce((m, t) => ((m[t.cat] = (m[t.cat] || 0) + 1), m), {});
    const chip = (id, name, n) => h('button', { class: 'chip', role: 'tab', 'aria-selected': String(currentCat === id), onclick: () => { currentCat = id; if (location.hash === '#/favoritos') location.hash = '#/'; renderChips(); renderGrid(); } }, name, h('small', null, n));
    $('chips').replaceChildren(chip('all', 'Todas', TOOLS.length), ...CATEGORIES.map((c) => chip(c.id, c.name, counts[c.id] || 0)));
  }
  function renderGrid() {
    const q = $('search').value.trim();
    const favMode = location.hash === '#/favoritos';
    let list = TOOLS;
    if (favMode) list = TOOLS.filter((t) => favs.has(t.id));
    else if (currentCat !== 'all') list = list.filter((t) => t.cat === currentCat);
    list = search(q, list);
    $('grid').replaceChildren(...list.map(card));
    $('empty').hidden = list.length > 0;
    $('empty').textContent = favMode && !favs.size ? 'Você ainda não favoritou nenhuma ferramenta. Clique na ☆ de um card.' : 'Nenhuma ferramenta encontrada. Tente outro termo.';
    $('searchCount').textContent = q ? `${list.length} resultado(s)` : '';
    $('gridTitle').textContent = favMode ? 'Seus favoritos' : q ? `Resultados para “${q}”` : currentCat === 'all' ? 'Todas as ferramentas' : catById[currentCat].name;
    const rec = recents.map((id) => toolById[id]).filter(Boolean).slice(0, 6);
    $('recentWrap').hidden = !rec.length || !!q || favMode;
    $('recentGrid').replaceChildren(...rec.map(card));
  }
  $('search').addEventListener('input', renderGrid);
  $('stats').replaceChildren(
    h('div', null, h('b', null, TOOLS.length), 'ferramentas'),
    h('div', null, h('b', null, CATEGORIES.length), 'categorias'),
    h('div', null, h('b', null, '100%'), 'no navegador'),
    h('div', null, h('b', null, 'R$ 0'), 'para sempre'));

  // ---------- ferramenta ----------
  function openTool(id) {
    const t = toolById[id];
    if (!t) { location.hash = '#/'; return; }
    const c = catById[t.cat];
    $('toolIcon').textContent = t.icon;
    $('toolIcon').style.background = `linear-gradient(135deg, ${c.color}, var(--accent-2))`;
    $('toolCat').textContent = c.name;
    $('toolName').textContent = t.name;
    $('toolDesc').textContent = t.desc;
    document.title = `${t.name} — Gooners`;
    const body = $('toolBody');
    body.replaceChildren();
    body.style.animation = 'none'; void body.offsetWidth; body.style.animation = '';
    try { t.render(body); } catch (e) { body.append(h('p', { class: 'badge bad' }, 'Erro ao carregar ferramenta: ' + e.message)); console.error(e); }
    updateFavBtn(t.id);
    const related = TOOLS.filter((x) => x.cat === t.cat && x.id !== t.id).slice(0, 6);
    $('related').replaceChildren(...related.map(card));
    recents = [t.id, ...recents.filter((x) => x !== t.id)].slice(0, 12);
    store.set('recents', recents);
  }
  function updateFavBtn(id) {
    const on = favs.has(id);
    $('favBtn').textContent = on ? '★ Favorito' : '☆ Favoritar';
    $('favBtn').setAttribute('aria-pressed', String(on));
  }
  $('favBtn').addEventListener('click', () => { const id = location.hash.split('/')[2]; if (id) { toggleFav(id); updateFavBtn(id); } });
  $('shareBtn').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: document.title, url }); return; } catch { /* cancelado */ } }
    copy(url);
  });

  // ---------- roteador ----------
  function route() {
    const hash = location.hash || '#/';
    const [, page, id] = hash.split('/');
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', (a.dataset.nav === 'fav') === (page === 'favoritos') && page !== 'ferramenta'));
    if (page === 'ferramenta' && id) {
      $('view-home').hidden = true; $('view-tool').hidden = false;
      openTool(id);
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    } else {
      $('view-tool').hidden = true; $('view-home').hidden = false;
      document.title = 'Gooners — Ferramentas online grátis';
      $('toolBody').replaceChildren();
      renderGrid();
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- paleta de comandos ----------
  const pal = $('palette'), palIn = $('paletteInput'), palList = $('paletteList');
  let palSel = 0, palItems = [];
  function openPalette() { pal.hidden = false; palIn.value = ''; renderPalette(); setTimeout(() => palIn.focus(), 10); }
  function closePalette() { pal.hidden = true; }
  function renderPalette() {
    palItems = search(palIn.value).slice(0, 12);
    if (!palIn.value) palItems = [...recents.map((id) => toolById[id]).filter(Boolean), ...TOOLS.filter((t) => !recents.includes(t.id))].slice(0, 12);
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    palList.replaceChildren(...palItems.map((t, i) => h('li', { class: i === palSel ? 'sel' : '', onclick: () => go(t), onmousemove: () => { if (palSel !== i) { palSel = i; renderPalette(); } } },
      h('span', { class: 'ticon', style: `--c:${catById[t.cat].color}` }, t.icon), t.name, h('small', null, catById[t.cat].name))));
    palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  function go(t) { closePalette(); location.hash = '#/ferramenta/' + t.id; }
  palIn.addEventListener('input', () => { palSel = 0; renderPalette(); });
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { palSel = (palSel + 1) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = (palSel - 1 + palItems.length) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter' && palItems[palSel]) go(palItems[palSel]);
  });
  pal.addEventListener('click', (e) => { if (e.target === pal) closePalette(); });
  $('openPalette').addEventListener('click', openPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
    else if (e.key === 'Escape' && !pal.hidden) closePalette();
    else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('view-home').hidden) { e.preventDefault(); $('search').focus(); }
  });

  $('year').textContent = new Date().getFullYear();
  renderChips();
  route();
})();
