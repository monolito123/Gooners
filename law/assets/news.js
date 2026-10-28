/* ==========================================================
   Gooners Law — portal de notícias jurídicas em tempo real
   Agrega feeds RSS (Google Notícias por tema + veículos jurídicos),
   atualiza automaticamente e mantém cache local para abertura instantânea.
   ========================================================== */
(function () {
  'use strict';
  const CFG = window.LAW_CONFIG || {};
  const { toast, esc } = window.LawUI;
  const $ = (s) => document.querySelector(s);
  const REFRESH_MS = Math.max(1, CFG.newsRefreshMinutes || 3) * 60e3;
  const PAGE = 13;

  const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const TABS = [['all', 'Todas'], ['patrimonial', 'Proteção patrimonial'], ['offshore', 'Offshore'], ['sucessoes', 'Sucessões'], ['tributario', 'Tributário'], ['tribunais', 'Tribunais'], ['empresarial', 'Empresarial'], ['geral', 'Geral']];
  const CAT_NAME = Object.fromEntries(TABS);
  let FEEDS = []; // carregado de data/feeds.json

  // Camada 1: data/news.json — coletado no servidor pelo GitHub Actions (scripts/fetch-news.mjs).
  // Camada 2: leitura direta dos feeds via proxies CORS públicos, para captar o que saiu entre duas coletas.
  const PROXIES = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  let proxyFirst = 0, proxiesDown = 0;
  let serverUpdated = 0;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('gooners-law:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('gooners-law:' + k, JSON.stringify(v)); } catch { /* cota cheia ou indisponível */ } },
  };

  let items = [];
  let tab = 'all', query = '', shown = PAGE;
  let lastUpdate = 0, nextAt = 0, loading = false, firstLoadDone = false;
  const sourceStatus = new Map();
  const seen = new Set(store.get('seen', []));

  async function fetchWithTimeout(url, ms, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(timer); }
  }
  async function fetchText(url) {
    let lastErr;
    for (let k = 0; k < PROXIES.length; k++) {
      const idx = (proxyFirst + k) % PROXIES.length;
      try {
        const r = await fetchWithTimeout(PROXIES[idx](url), 9000, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const t = await r.text();
        if (!/<(rss|feed|rdf)/i.test(t.slice(0, 2000))) throw new Error('Resposta não é RSS');
        proxyFirst = idx;
        return t;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Falha');
  }
  async function loadFeeds() {
    if (FEEDS.length) return;
    try { FEEDS = (await (await fetchWithTimeout('data/feeds.json', 8000)).json()).feeds; } catch { FEEDS = []; }
  }
  async function fromServer() {
    const r = await fetchWithTimeout('data/news.json?t=' + Math.floor(Date.now() / 60e3), 10000, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    serverUpdated = j.updated || 0;
    for (const [name, st] of Object.entries(j.sources || {})) sourceStatus.set(name, st);
    return j.items || [];
  }
  async function fromProxies() {
    // Se os proxies falharam em sequência, tenta só a cada 3 ciclos para não atrasar a página.
    if (proxiesDown >= 2 && (proxiesDown++ % 3)) return [];
    const res = await Promise.allSettled(FEEDS.map(async (f) => {
      const list = parseFeed(await fetchText(f.type === 'gnews' ? gnews(f.q) : f.url), f);
      sourceStatus.set(f.name, [true, list.length]);
      return list;
    }));
    const out = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    proxiesDown = out.length ? 0 : proxiesDown + 1;
    return out;
  }

  const stripHtml = (s) => { const d = new DOMParser().parseFromString(s || '', 'text/html'); return (d.body.textContent || '').replace(/\s+/g, ' ').trim(); };
  const normTitle = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

  function parseFeed(xml, feed) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const nodes = [...doc.querySelectorAll('item, entry')].slice(0, 40);
    const txt = (n, sel) => n.querySelector(sel)?.textContent?.trim() || '';
    return nodes.map((n) => {
      let title = stripHtml(txt(n, 'title'));
      const linkEl = n.querySelector('link');
      const link = (linkEl && (linkEl.getAttribute('href') || linkEl.textContent.trim())) || '';
      const source = txt(n, 'source') || feed.source || feed.name;
      if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
      let desc = stripHtml(txt(n, 'description') || txt(n, 'summary') || txt(n, 'content'));
      if (!desc || normTitle(desc).startsWith(normTitle(title).slice(0, 40))) desc = '';
      const date = new Date(txt(n, 'pubDate') || txt(n, 'published') || txt(n, 'updated') || txt(n, 'dc\\:date'));
      return { title, link, source, desc: desc.slice(0, 280), date: isNaN(date) ? Date.now() : +date, cats: [feed.cat] };
    }).filter((x) => x.title && /^https?:/.test(x.link));
  }

  async function refresh(manual) {
    if (loading) return;
    loading = true;
    setStatus('<span class="spin">↻</span> Atualizando fontes…');
    await loadFeeds();
    const [srv, live] = await Promise.allSettled([fromServer(), fromProxies()]);
    const fresh = [...(live.value || []), ...(srv.value || [])];
    loading = false;
    renderSources();
    if (!fresh.length) {
      setStatus(items.length ? '⚠ Sem conexão com as fontes — exibindo última atualização salva.' : '⚠ Não foi possível carregar as notícias agora.');
      if (!items.length) renderEmpty();
      scheduleNext();
      return;
    }
    // Mescla com o que já temos, deduplica e ordena
    const map = new Map();
    for (const it of [...fresh, ...items]) {
      const k = normTitle(it.title);
      if (!map.has(k)) map.set(k, { ...it, cats: new Set(it.cats) });
      else it.cats.forEach((c) => map.get(k).cats.add(c));
    }
    const merged = [...map.values()].filter((x) => x.date < Date.now() + 36e5).sort((a, b) => b.date - a.date).slice(0, 400);
    const newOnes = firstLoadDone ? merged.filter((x) => !seen.has(normTitle(x.title))) : [];
    items = merged.map((x) => ({ ...x, cats: [...x.cats] }));
    lastUpdate = Date.now();
    store.set('cache', { t: lastUpdate, items: items.slice(0, 150) });
    if (newOnes.length) notify(newOnes);
    if (!firstLoadDone) items.forEach((x) => seen.add(normTitle(x.title)));
    firstLoadDone = true;
    render();
    renderTicker();
    if (manual) toast(newOnes.length ? `${newOnes.length} nova(s) notícia(s)` : 'Notícias atualizadas');
    scheduleNext();
  }

  function scheduleNext() { nextAt = Date.now() + REFRESH_MS; }
  function markSeen() { items.forEach((x) => seen.add(normTitle(x.title))); store.set('seen', [...seen].slice(-1500)); }

  // ---------- renderização ----------
  const rel = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    const d = Math.floor(s / 86400);
    return d === 1 ? 'ontem' : `há ${d} dias`;
  };
  const filtered = () => {
    const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return items.filter((x) => (tab === 'all' || x.cats.includes(tab)) && (!q || (x.title + ' ' + x.desc + ' ' + x.source).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)));
  };

  function renderTabs() {
    const count = (id) => (id === 'all' ? items.length : items.filter((x) => x.cats.includes(id)).length);
    $('#newsTabs').innerHTML = TABS.map(([id, n]) => `<button role="tab" data-t="${id}" aria-selected="${tab === id}">${n}${items.length ? `<small>${count(id)}</small>` : ''}</button>`).join('');
  }

  function card(x, i, feat) {
    const isNew = Date.now() - x.date < 60 * 60e3 || x._new;
    return `<a class="news-card${feat ? ' feat' : ''}${isNew ? ' fresh' : ''}" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" style="animation-delay:${Math.min(i, 12) * 35}ms">
      <div class="news-meta"><span class="cat">${esc(CAT_NAME[x.cats[0]] || 'Geral')}</span><span>·</span><time datetime="${new Date(x.date).toISOString()}" data-rel="${x.date}">${rel(x.date)}</time></div>
      <h3>${esc(x.title)}</h3>
      ${x.desc ? `<p>${esc(x.desc)}</p>` : ''}
      <div class="src"><span>${esc(x.source)}</span><span>Ler na fonte ↗</span></div>
    </a>`;
  }

  function render() {
    renderTabs();
    const list = filtered();
    const grid = $('#newsGrid');
    if (!list.length) grid.innerHTML = `<div class="news-empty">${items.length ? 'Nenhuma notícia corresponde ao filtro.' : 'Carregando…'}</div>`;
    else grid.innerHTML = list.slice(0, shown).map((x, i) => card(x, i, i === 0 && !query)).join('');
    $('#newsMore').hidden = list.length <= shown;
    $('#newsLatest').innerHTML = items.slice(0, 6).map((x) => `<li><div><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><small>${esc(x.source)} · <span data-rel="${x.date}">${rel(x.date)}</span></small></div></li>`).join('');
    updateStatus();
  }

  function renderSkeleton() { $('#newsGrid').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join(''); }

  function renderEmpty() {
    const links = [['Migalhas', 'https://www.migalhas.com.br'], ['Consultor Jurídico', 'https://www.conjur.com.br'], ['JOTA', 'https://www.jota.info'], ['Notícias do STF', 'https://noticias.stf.jus.br'], ['Notícias do STJ', 'https://www.stj.jus.br/sites/portalp/Comunicacao/Ultimas-noticias'], ['Receita Federal', 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias']];
    $('#newsGrid').innerHTML = `<div class="news-empty">
      <p>As fontes de notícias não responderam (bloqueador de conteúdo, rede corporativa ou instabilidade dos serviços). Tentaremos novamente em instantes.</p>
      <p>Enquanto isso, acesse diretamente: ${links.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener" style="color:var(--gold)">${n}</a>`).join(' · ')}</p></div>`;
  }

  function renderTicker() {
    const top = items.slice(0, 15);
    if (!top.length) return;
    $('#ticker').innerHTML = top.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><b>${esc(CAT_NAME[x.cats[0]] || 'Geral')}</b>${esc(x.title)}</a>`).join('');
    $('#ticker').style.animationDuration = Math.max(60, top.length * 9) + 's';
  }

  function renderSources() {
    $('#newsSources').innerHTML = FEEDS.map((f) => {
      const s = sourceStatus.get(f.name);
      const label = f.type === 'gnews' && !f.source ? 'Google Notícias · ' + f.name : f.name;
      return `<li><span>${esc(label)}</span><span class="st ${s ? (s[0] ? 'ok' : 'err') : ''}">${s ? (s[0] ? '● ' + s[1] : '● offline') : '…'}</span></li>`;
    }).join('');
  }

  function setStatus(html) { $('#newsStatus').innerHTML = html; }
  function updateStatus() {
    if (loading) return;
    if (!lastUpdate) return;
    const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
    const time = new Date(lastUpdate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const srv = serverUpdated ? ` · coleta do servidor ${rel(serverUpdated)}` : '';
    setStatus(`<span class="ok">●</span> ${items.length} notícias · verificado às ${time}${srv} · próxima em ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
  }

  // ---------- alertas ----------
  function notify(list) {
    list.forEach((x) => (x._new = true));
    document.title = `(${list.length}) Gooners Law — Notícias`;
    if (window.Notification && Notification.permission === 'granted' && document.hidden) {
      const x = list[0];
      const n = new Notification('Gooners Law · ' + (CAT_NAME[x.cats[0]] || 'Notícia'), { body: x.title, tag: 'gooners-law-news' });
      n.onclick = () => { window.focus(); window.open(x.link, '_blank', 'noopener'); };
    }
  }
  const notifyBtn = $('#notifyBtn');
  function syncNotifyBtn() {
    if (!window.Notification) { notifyBtn.disabled = true; notifyBtn.textContent = 'Não suportado'; return; }
    if (Notification.permission === 'granted') { notifyBtn.textContent = '✓ Alertas ativos'; notifyBtn.disabled = true; }
    if (Notification.permission === 'denied') { notifyBtn.textContent = 'Alertas bloqueados'; notifyBtn.disabled = true; }
  }
  notifyBtn.addEventListener('click', async () => { await Notification.requestPermission(); syncNotifyBtn(); if (Notification.permission === 'granted') toast('Você será avisado sobre novas notícias.'); });
  syncNotifyBtn();

  // ---------- eventos ----------
  $('#newsTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; shown = PAGE; render(); } });
  let qt;
  $('#newsSearch').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value.trim(); shown = PAGE; render(); }, 150); });
  $('#newsRefresh').addEventListener('click', () => refresh(true));
  $('#newsMore').addEventListener('click', () => { shown += PAGE; render(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      document.title = 'Gooners Law — Proteção Patrimonial, Offshore e Notícias Jurídicas';
      markSeen();
      if (Date.now() >= nextAt) refresh();
    }
  });

  // Relógio: tempos relativos, contagem regressiva e atualização automática
  setInterval(() => {
    document.querySelectorAll('[data-rel]').forEach((el) => (el.textContent = rel(+el.dataset.rel)));
    updateStatus();
    if (!document.hidden && nextAt && Date.now() >= nextAt) refresh();
  }, 1000);

  // ---------- inicialização ----------
  renderTabs();
  const cache = store.get('cache', null);
  if (cache && cache.items && cache.items.length) {
    items = cache.items;
    items.forEach((x) => seen.add(normTitle(x.title)));
    lastUpdate = cache.t;
    firstLoadDone = true;
    render();
    renderTicker();
  } else renderSkeleton();
  refresh();
  window.addEventListener('beforeunload', markSeen);
})();
