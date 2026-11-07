/* ==========================================================
   Gooners Law — notícias jurídicas em tempo real
   Camada 1: data/news.json, coletado no servidor (GitHub Actions) e pré-renderizado no HTML.
   Camada 2: leitura direta dos feeds por proxies CORS (somente no portal), para captar
   o que saiu entre duas coletas. Cache local garante abertura instantânea.
   ========================================================== */
(function () {
  'use strict';
  const CFG = window.LAW_CONFIG || {};
  const { toast, esc, store, share, ic } = window.LawUI;
  const $ = (s) => document.querySelector(s);
  const L = document.body.dataset.l || '';
  const PORTAL = !!$('#newsGrid');
  const REFRESH_MS = Math.max(1, CFG.newsRefreshMinutes || 3) * 60e3;
  const PAGE = 18;
  const TABS = [['all', 'Todas'], ['patrimonial', 'Proteção patrimonial'], ['offshore', 'Offshore'], ['sucessoes', 'Sucessões'], ['tributario', 'Tributário'], ['tribunais', 'Tribunais'], ['empresarial', 'Empresarial'], ['geral', 'Geral']];
  const CAT_NAME = Object.fromEntries(TABS);
  const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const PROXIES = [(u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`];

  let FEEDS = [], items = [], serverUpdated = 0, lastUpdate = 0, nextAt = 0, loading = false, firstDone = false, proxyFirst = 0, proxiesDown = 0;
  let tab = 'all', query = '', period = 'all', source = '', shown = PAGE, view = store.get('view', 'grid');
  const sourceStatus = new Map();
  const seen = new Set(store.get('seen', []));
  const readSet = new Set(store.get('read', []));
  let saved = store.get('saved', []);
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const key = (x) => norm(x.title).slice(0, 90);

  // ---------- coleta ----------
  async function timed(url, ms, opts = {}) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); } }
  async function fromServer() {
    const r = await timed(`${L}data/news.json?t=${Math.floor(Date.now() / 60e3)}`, 10000, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); serverUpdated = j.updated || 0;
    for (const [n, st] of Object.entries(j.sources || {})) sourceStatus.set(n, st);
    return j.items || [];
  }
  const stripHtml = (s) => (new DOMParser().parseFromString(s || '', 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  function parseFeed(xml, f) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml'), txt = (n, s) => n.querySelector(s)?.textContent?.trim() || '';
    return [...doc.querySelectorAll('item, entry')].slice(0, 40).map((n) => {
      let title = stripHtml(txt(n, 'title')); const le = n.querySelector('link'), link = (le && (le.getAttribute('href') || le.textContent.trim())) || '';
      const src = txt(n, 'source') || f.source || f.name; if (title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
      let desc = stripHtml(txt(n, 'description') || txt(n, 'summary')); if (!desc || norm(desc).startsWith(norm(title).slice(0, 40))) desc = '';
      const d = new Date(txt(n, 'pubDate') || txt(n, 'published') || txt(n, 'updated'));
      return { title, link, source: src, desc: desc.slice(0, 280), date: isNaN(d) ? Date.now() : +d, cats: [f.cat] };
    }).filter((x) => x.title && /^https?:/.test(x.link));
  }
  async function viaProxy(url) {
    let err;
    for (let k = 0; k < PROXIES.length; k++) {
      const i = (proxyFirst + k) % PROXIES.length;
      try { const r = await timed(PROXIES[i](url), 9000, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const t = await r.text(); if (!/<(rss|feed|rdf)/i.test(t.slice(0, 2000))) throw new Error('não é RSS'); proxyFirst = i; return t; } catch (e) { err = e; }
    }
    throw err;
  }
  async function fromProxies() {
    if (!PORTAL || (proxiesDown >= 2 && proxiesDown++ % 3)) return [];
    if (!FEEDS.length) try { FEEDS = (await (await timed(`${L}data/feeds.json`, 8000)).json()).feeds; } catch { return []; }
    const res = await Promise.allSettled(FEEDS.map(async (f) => { const l = parseFeed(await viaProxy(f.type === 'gnews' ? gnews(f.q) : f.url), f); sourceStatus.set(f.name, [true, l.length]); return l; }));
    const outp = res.flatMap((r) => r.value || []); proxiesDown = outp.length ? 0 : proxiesDown + 1; return outp;
  }

  function merge(fresh) {
    const map = new Map();
    for (const it of [...fresh, ...items]) { const k = key(it); if (!map.has(k)) map.set(k, { ...it, cats: new Set(it.cats) }); else it.cats.forEach((c) => map.get(k).cats.add(c)); }
    const merged = [...map.values()].filter((x) => x.date < Date.now() + 36e5).sort((a, b) => b.date - a.date).slice(0, 400).map((x) => ({ ...x, cats: [...x.cats] }));
    const news = firstDone ? merged.filter((x) => !seen.has(key(x))) : [];
    items = merged; lastUpdate = Date.now();
    store.set('cache', { t: lastUpdate, items: items.slice(0, 150) });
    if (!firstDone) items.forEach((x) => seen.add(key(x)));
    firstDone = true;
    if (news.length) notify(news);
    renderAll();
    return news.length;
  }
  async function refresh(manual) {
    if (loading) return; loading = true;
    setStatus(`<span class="spin">↻</span> Atualizando fontes…`);
    nextAt = Date.now() + REFRESH_MS;
    let added = 0, got = 0;
    // Dados do servidor aparecem assim que chegam; os feeds diretos complementam depois
    const srv = fromServer().then((l) => { got += l.length; if (l.length) { loading = false; added += merge(l); loading = true; } }).catch(() => {});
    const live = fromProxies().then((l) => { got += l.length; if (l.length) { loading = false; added += merge(l); loading = true; } }).catch(() => {});
    await Promise.all([srv, live]);
    loading = false;
    if (!got) { setStatus(items.length ? '⚠ Sem conexão com as fontes. Exibindo a última atualização.' : '⚠ Não foi possível carregar as notícias agora.'); if (!items.length && PORTAL) renderEmpty(); renderSide(); return; }
    updateStatus();
    if (manual) toast(added ? `${added} nova(s) notícia(s)` : 'Notícias atualizadas');
  }

  // ---------- utilidades de exibição ----------
  const rel = (t) => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'agora'; if (s < 3600) return `há ${Math.floor(s / 60)} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; const d = Math.floor(s / 86400); return d === 1 ? 'ontem' : `há ${d} dias`; };
  const isSaved = (x) => saved.some((s) => s.link === x.link);
  function card(x, i, feat) {
    const fresh = Date.now() - x.date < 60 * 60e3 || x._new;
    return `<article class="news-card${feat ? ' feat' : ''}${fresh ? ' fresh' : ''}${readSet.has(x.link) ? ' read' : ''}" data-link="${esc(x.link)}" style="animation-delay:${Math.min(i, 10) * 30}ms">
      <div class="news-meta"><span class="cat">${esc(CAT_NAME[x.cats[0]] || 'Geral')}</span><time datetime="${new Date(x.date).toISOString()}" data-rel="${x.date}">${rel(x.date)}</time></div>
      <h3><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></h3>${x.desc ? `<p>${esc(x.desc)}</p>` : ''}
      <footer><span class="src">${esc(x.source)}</span>${PORTAL ? `<button class="act${isSaved(x) ? ' on' : ''}" data-act="save" aria-label="${isSaved(x) ? 'Remover dos salvos' : 'Salvar para ler depois'}" title="Ler depois">${ic('bookmark')}</button><a class="act" data-act="wa" href="https://wa.me/?text=${encodeURIComponent(x.title + ' — ' + x.link)}" target="_blank" rel="noopener" aria-label="Enviar pelo WhatsApp" title="Enviar pelo WhatsApp">${ic('message-circle')}</a><button class="act" data-act="share" aria-label="Compartilhar" title="Compartilhar">${ic('share-2')}</button>` : ''}</footer></article>`;
  }
  function filtered() {
    const q = norm(query), now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const minDate = period === 'today' ? midnight : period === '24h' ? Date.now() - 864e5 : period === '7d' ? Date.now() - 7 * 864e5 : 0;
    const base = tab === 'saved' ? saved : items;
    return base.filter((x) => (tab === 'all' || tab === 'saved' || x.cats.includes(tab)) && x.date >= minDate && (!source || x.source === source) && (!q || norm(`${x.title} ${x.desc} ${x.source}`).includes(q)));
  }

  // ---------- renderização ----------
  function renderTicker() {
    const t = $('#ticker'); if (!t || !items.length) return;
    t.innerHTML = [...items.slice(0, 14), ...items.slice(0, 14)].map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><b>${esc(CAT_NAME[x.cats[0]] || 'Geral')}</b>${esc(x.title)}</a>`).join('');
    t.style.animationDuration = Math.max(70, 14 * 9) + 's';
  }
  function renderHome() {
    const hn = $('#heroNews');
    if (hn && items.length) hn.innerHTML = items.slice(0, 4).map((x) => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><span class="hn-cat">${esc(CAT_NAME[x.cats[0]] || 'Geral')}</span>${esc(x.title)}<small>${esc(x.source)} · <time data-rel="${x.date}">${rel(x.date)}</time></small></a></li>`).join('');
    const pv = $('#newsPreview');
    if (pv && items.length) pv.innerHTML = items.slice(0, 6).map((x, i) => card(x, i, false)).join('');
  }
  function renderTabs() {
    const c = (id) => (id === 'all' ? items.length : items.filter((x) => x.cats.includes(id)).length);
    $('#newsTabs').innerHTML = TABS.map(([id, n]) => `<button role="tab" data-t="${id}" aria-selected="${tab === id}">${n}<small>${c(id)}</small></button>`).join('') +
      `<button role="tab" data-t="saved" aria-selected="${tab === 'saved'}">${ic('bookmark')}Salvas<small>${saved.length}</small></button>`;
  }
  function renderPortal() {
    renderTabs();
    const list = filtered(), grid = $('#newsGrid');
    grid.classList.toggle('list', view === 'list');
    $('#viewGrid').setAttribute('aria-pressed', String(view === 'grid')); $('#viewList').setAttribute('aria-pressed', String(view === 'list'));
    const plain = !query && tab === 'all' && period === 'all' && !source;
    grid.innerHTML = list.length ? list.slice(0, shown).map((x, i) => card(x, i, i === 0 && plain && view === 'grid')).join('')
      : `<div class="news-empty">${tab === 'saved' ? 'Você ainda não salvou notícias. Use o ícone de marcador para ler depois.' : items.length ? 'Nenhuma notícia corresponde aos filtros.' : 'Carregando…'}</div>`;
    $('#newsMore').hidden = list.length <= shown;
    const srcSel = $('#newsSource'), cur = srcSel.value, srcs = [...new Set(items.map((x) => x.source))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (srcSel.options.length - 1 !== srcs.length) { srcSel.innerHTML = '<option value="">Todas as fontes</option>' + srcs.map((s) => `<option>${esc(s)}</option>`).join(''); srcSel.value = cur; }
    renderSide();
  }
  function renderSide() {
    if (!PORTAL) return;
    $('#newsLatest').innerHTML = items.slice(0, 6).map((x) => `<li><div><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><small>${esc(x.source)} · <span data-rel="${x.date}">${rel(x.date)}</span></small></div></li>`).join('');
    $('#newsTopics').innerHTML = TABS.slice(1).map(([id, n]) => `<li><button data-t="${id}">${n}<b>${items.filter((x) => x.cats.includes(id)).length}</b></button></li>`).join('');
    const names = FEEDS.length ? FEEDS.map((f) => [f.type === 'gnews' && !f.source ? 'Google Notícias · ' + f.name : f.name, f.name]) : [...sourceStatus.keys()].map((n) => [n, n]);
    $('#newsSources').innerHTML = names.map(([label, n]) => { const s = sourceStatus.get(n); return `<li><span>${esc(label)}</span><span class="st ${s ? (s[0] ? 'ok' : 'err') : ''}">${s ? (s[0] ? '● ' + s[1] : '● offline') : '…'}</span></li>`; }).join('');
    updateStatus();
  }
  function renderEmpty() {
    const links = [['Migalhas', 'https://www.migalhas.com.br'], ['Consultor Jurídico', 'https://www.conjur.com.br'], ['JOTA', 'https://www.jota.info'], ['STF', 'https://noticias.stf.jus.br'], ['STJ', 'https://www.stj.jus.br/sites/portalp/Comunicacao/Ultimas-noticias']];
    $('#newsGrid').innerHTML = `<div class="news-empty"><p>As fontes não responderam agora (bloqueador de conteúdo, rede corporativa ou instabilidade). Tentaremos de novo em instantes.</p><p>Acesse diretamente: ${links.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(' · ')}</p></div>`;
  }
  const renderAll = () => { renderTicker(); renderHome(); if (PORTAL) renderPortal(); };
  const setStatus = (html) => { const s = $('#newsStatus'); if (s) s.innerHTML = html; };
  function updateStatus() {
    if (loading || !lastUpdate || !$('#newsStatus')) return;
    const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
    setStatus(`<span class="ok">●</span> ${items.length} notícias · verificado às ${new Date(lastUpdate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${serverUpdated ? ` · coleta ${rel(serverUpdated)}` : ''} · próxima em ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
  }

  // ---------- alertas ----------
  function notify(list) {
    list.forEach((x) => (x._new = true));
    if (document.hidden) document.title = `(${list.length}) ` + document.title.replace(/^\(\d+\) /, '');
    if (window.Notification && Notification.permission === 'granted' && document.hidden) {
      const x = list[0], n = new Notification('Gooners Law · ' + (CAT_NAME[x.cats[0]] || 'Notícia'), { body: x.title, tag: 'gooners-law-news', icon: L + 'assets/icon.svg' });
      n.onclick = () => { window.focus(); window.open(x.link, '_blank', 'noopener'); };
    }
  }

  // ---------- eventos do portal ----------
  if (PORTAL) {
    const nb = $('#notifyBtn');
    const syncN = () => { if (!window.Notification) { nb.disabled = true; nb.lastChild.textContent = 'Não suportado'; } else if (Notification.permission !== 'default') { nb.disabled = true; nb.lastChild.textContent = Notification.permission === 'granted' ? 'Alertas ativos' : 'Alertas bloqueados'; } };
    nb.addEventListener('click', async () => { await Notification.requestPermission(); syncN(); if (Notification.permission === 'granted') toast('Você será avisado sobre novas notícias.'); }); syncN();
    const setTab = (t) => { tab = t; shown = PAGE; renderPortal(); };
    $('#newsTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.t); });
    $('#newsTopics').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setTab(b.dataset.t); $('#newsTabs').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
    let qt; $('#newsSearch').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); shown = PAGE; renderPortal(); }, 150); });
    $('#newsPeriod').addEventListener('change', (e) => { period = e.target.value; shown = PAGE; renderPortal(); });
    $('#newsSource').addEventListener('change', (e) => { source = e.target.value; shown = PAGE; renderPortal(); });
    $('#viewGrid').addEventListener('click', () => { view = 'grid'; store.set('view', view); renderPortal(); });
    $('#viewList').addEventListener('click', () => { view = 'list'; store.set('view', view); renderPortal(); });
    $('#newsRefresh').addEventListener('click', () => refresh(true));
    $('#newsMore').addEventListener('click', () => { shown += PAGE; renderPortal(); });
    const q0 = new URLSearchParams(location.search).get('q'); if (q0) { query = q0; $('#newsSearch').value = q0; }
  }
  document.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.news-card[data-link]'); if (!cardEl) return;
    const link = cardEl.dataset.link, act = e.target.closest('[data-act]');
    if (!act) { if (e.target.closest('a')) { readSet.add(link); store.set('read', [...readSet].slice(-600)); cardEl.classList.add('read'); } return; }
    if (act.dataset.act === 'wa') return;
    e.preventDefault();
    const x = items.find((i) => i.link === link) || saved.find((i) => i.link === link); if (!x) return;
    if (act.dataset.act === 'share') return share(x.title, x.link);
    if (isSaved(x)) { saved = saved.filter((s) => s.link !== link); toast('Removida dos salvos'); } else { saved = [{ ...x, _new: false }, ...saved].slice(0, 200); toast('Salva para ler depois'); }
    store.set('saved', saved); renderPortal();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    document.title = document.title.replace(/^\(\d+\) /, '');
    items.forEach((x) => seen.add(key(x))); store.set('seen', [...seen].slice(-1500));
    if (Date.now() >= nextAt) refresh();
  });
  setInterval(() => {
    document.querySelectorAll('[data-rel]').forEach((el) => (el.textContent = rel(+el.dataset.rel)));
    updateStatus();
    if (!document.hidden && nextAt && Date.now() >= nextAt) refresh();
  }, 1000);

  // ---------- início ----------
  const cache = store.get('cache', null);
  if (cache?.items?.length) { items = cache.items; lastUpdate = cache.t; items.forEach((x) => seen.add(key(x))); firstDone = true; renderAll(); }
  else if (PORTAL) renderTabs();
  refresh();
})();
