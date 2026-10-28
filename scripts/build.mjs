#!/usr/bin/env node
// Gera as páginas estáticas do Gooners (home, categorias, uma página por ferramenta),
// sitemap.xml, robots.txt e manifest — tudo indexável por buscadores.
// Uso: node scripts/build.mjs   (SITE_URL=https://seu-dominio/ para mudar a URL canônica)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { SITE, POPULAR, HOME_FAQ, seoFor } from './seo-content.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(ROOT + 'scripts/site.config.json', 'utf8'));
const SITE_URL = (process.env.SITE_URL || cfg.siteUrl).replace(/\/?$/, '/');
const TODAY = new Date().toISOString().slice(0, 10);

// Carrega o catálogo de ferramentas executando tools.js num contexto isolado
const sandbox = { window: {}, document: { getElementById() {} } };
vm.runInNewContext(readFileSync(ROOT + 'assets/js/tools.js', 'utf8'), sandbox);
const { TOOLS, CATEGORIES } = sandbox.window.Gooners;
const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

const hash = (f) => createHash('md5').update(readFileSync(ROOT + f)).digest('hex').slice(0, 8);
const V = { css: hash('assets/css/gooners.css'), tools: hash('assets/js/tools.js'), app: hash('assets/js/app.js') };
const clamp = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,:;]$/, '') + '…');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const toolUrl = (id) => `${SITE_URL}ferramentas/${id}/`;
const catUrl = (id) => `${SITE_URL}categorias/${id}/`;

function shell({ R, path, title, desc, body, jsonld = [], page, tool = '', cat = '', robots = 'index,follow,max-image-preview:large', ogType = 'website' }) {
  const ic = (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="${R}assets/icons.svg#i-${n}"/></svg>`;
  const canonical = SITE_URL + path;
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, TOOLS.filter((t) => t.cat === c.id).length]));
  const navCat = CATEGORIES.map((c) => `<a href="${R}categorias/${c.id}/" class="nav-item${cat === c.id && page === 'category' ? ' active' : ''}" style="--c:${c.color}">${ic(c.icon)}<span>${c.name}</span><small>${counts[c.id]}</small></a>`).join('');
  const footCols = CATEGORIES.map((c) => `<div><h3><a href="${R}categorias/${c.id}/">${c.name}</a></h3><ul>${TOOLS.filter((t) => t.cat === c.id).map((t) => `<li><a href="${R}ferramentas/${t.id}/">${esc(t.name)}</a></li>`).join('')}</ul></div>`).join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}assets/img/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE_URL}assets/img/og-image.png">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c0d10" media="(prefers-color-scheme: dark)">
<meta name="application-name" content="Gooners">
<meta name="apple-mobile-web-app-title" content="Gooners">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
<link rel="icon" href="${R}assets/img/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${R}assets/img/apple-touch-icon.png">
<link rel="manifest" href="${R}manifest.webmanifest">
<link rel="sitemap" type="application/xml" href="${R}sitemap.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${R}assets/css/gooners.css?v=${V.css}">
<script>try{var t=localStorage.getItem('gooners:theme');t=t?JSON.parse(t):null;document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme='light'}</script>
${jsonld.map(ld).join('\n')}
</head>
<body data-page="${page}" data-tool="${tool}" data-cat="${cat}" data-root="${R}">
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<header class="topbar">
  <button class="icon-btn only-mobile" id="menuBtn" aria-label="Abrir menu" aria-expanded="false">${ic('menu')}</button>
  <a class="brand" href="${R}" aria-label="Gooners — página inicial"><img src="${R}assets/img/icon.svg" width="30" height="30" alt=""><span>Gooners</span></a>
  <button class="search-trigger" id="openPalette" aria-label="Buscar ferramentas">${ic('search')}<span>Buscar entre ${TOOLS.length} ferramentas…</span><kbd>Ctrl K</kbd></button>
  <div class="top-actions">
    <a class="top-link hide-mobile" href="${R}law/">${ic('scale')}<span>Gooners Law</span></a>
    <button class="icon-btn" id="installBtn" hidden aria-label="Instalar aplicativo" title="Instalar aplicativo">${ic('download')}</button>
    <button class="icon-btn hide-mobile" id="shortcutsBtn" aria-label="Atalhos de teclado" title="Atalhos (?)">${ic('keyboard')}</button>
    <button class="icon-btn" id="themeToggle" aria-label="Alternar tema claro/escuro" title="Alternar tema">${ic('moon', 'i-moon')}${ic('sun', 'i-sun')}</button>
  </div>
</header>
<div class="layout">
  <aside class="sidebar" id="sidebar" aria-label="Navegação">
    <nav>
      <a href="${R}" class="nav-item${page === 'home' ? ' active' : ''}">${ic('house')}<span>Início</span></a>
      <a href="${R}favoritos/" class="nav-item${page === 'favorites' ? ' active' : ''}">${ic('star')}<span>Favoritos</span><small id="favCount">0</small></a>
      <p class="nav-label">Categorias</p>
      ${navCat}
      <div id="navRecent" hidden><p class="nav-label">Recentes</p><div id="navRecentList"></div></div>
    </nav>
    <a class="side-promo" href="${R}law/">
      <span class="side-promo-ic">${ic('scale')}</span>
      <b>Gooners Law</b>
      <span>Proteção patrimonial, offshore e notícias jurídicas em tempo real.</span>
    </a>
  </aside>
  <div class="scrim" id="scrim" hidden></div>
  <main id="conteudo" class="main" tabindex="-1">
${body}
  </main>
</div>
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <a class="brand" href="${R}"><img src="${R}assets/img/icon.svg" width="28" height="28" alt=""><span>Gooners</span></a>
      <p>${TOOLS.length} ferramentas online gratuitas, processadas no seu navegador. Sem cadastro, sem anúncios invasivos e com funcionamento offline.</p>
      <p><a href="${R}law/">Gooners Law</a> · <a href="${R}law/noticias/">Notícias jurídicas</a> · <a href="${R}sitemap.xml">Mapa do site</a></p>
    </div>
    <div class="footer-cols">${footCols}</div>
  </div>
  <p class="copy">© <span data-year>${new Date().getFullYear()}</span> Gooners. Ferramentas oferecidas “como estão”; confira resultados críticos antes de usá-los.</p>
</footer>
<div class="palette" id="palette" hidden>
  <div class="palette-box" role="dialog" aria-modal="true" aria-label="Buscar ferramenta">
    <div class="palette-input">${ic('search')}<input id="paletteInput" placeholder="Buscar ferramenta…" autocomplete="off" aria-label="Buscar ferramenta"><kbd>Esc</kbd></div>
    <ul id="paletteList" role="listbox"></ul>
    <p class="palette-hint"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span></p>
  </div>
</div>
<div class="palette" id="shortcuts" hidden>
  <div class="palette-box shortcuts-box" role="dialog" aria-modal="true" aria-labelledby="shTitle">
    <h2 id="shTitle">Atalhos de teclado</h2>
    <dl>
      <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Buscar ferramenta</dd>
      <dt><kbd>/</kbd></dt><dd>Focar a busca da página</dd>
      <dt><kbd>F</kbd></dt><dd>Favoritar a ferramenta aberta</dd>
      <dt><kbd>T</kbd></dt><dd>Alternar tema claro/escuro</dd>
      <dt><kbd>?</kbd></dt><dd>Mostrar estes atalhos</dd>
      <dt><kbd>Esc</kbd></dt><dd>Fechar janelas</dd>
    </dl>
    <button class="btn btn-ghost" data-close>Fechar</button>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="${R}assets/js/tools.js?v=${V.tools}" defer></script>
<script src="${R}assets/js/app.js?v=${V.app}" defer></script>
</body>
</html>
`;
}

// ---------- componentes ----------
const icFor = (R) => (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="${R}assets/icons.svg#i-${n}"/></svg>`;
const card = (R, t) => { const ic = icFor(R); const c = catById[t.cat];
  return `<a class="tcard" href="${R}ferramentas/${t.id}/" data-id="${t.id}" style="--c:${c.color}"><span class="ticon">${ic(t.icon)}</span><span class="tbody"><span class="tname">${esc(t.name)}</span><span class="tdesc">${esc(t.desc)}</span></span></a>`; };
const crumbs = (R, items) => `<nav class="crumbs" aria-label="Você está em"><ol>${items.map(([n, href], i) => `<li>${href && i < items.length - 1 ? `<a href="${href}">${esc(n)}</a>` : `<span aria-current="page">${esc(n)}</span>`}</li>`).join('')}</ol></nav>`;
const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
const faqLd = (faq) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const faqHtml = (faq) => `<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
const ORG = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Gooners', url: SITE_URL, logo: SITE_URL + 'assets/img/icon-512.png' };

const out = (rel, html) => { const f = ROOT + rel; mkdirSync(f.replace(/[^/]+$/, ''), { recursive: true }); writeFileSync(f, html); };

// ---------- home ----------
{
  const R = '', ic = icFor(R);
  const popular = POPULAR.map((id) => toolById[id]).filter(Boolean);
  const sections = CATEGORIES.map((c) => `
    <section class="cat-section" data-cat-section="${c.id}" aria-labelledby="h-${c.id}">
      <header class="sec-head"><span class="sec-ic" style="--c:${c.color}">${ic(c.icon)}</span><div><h2 id="h-${c.id}">${c.name}</h2><p>${c.desc}</p></div><a class="sec-more" href="categorias/${c.id}/">Ver categoria ${ic('arrow-right')}</a></header>
      <div class="grid">${TOOLS.filter((t) => t.cat === c.id).map((t) => card(R, t)).join('')}</div>
    </section>`).join('');
  const body = `
    <section class="hero">
      <p class="eyebrow"><span class="dot"></span>${TOOLS.length} ferramentas gratuitas · atualizado em ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>
      <h1>Ferramentas online grátis para o seu dia a dia</h1>
      <p class="lead">Texto, documentos, Pix, consultas de CEP e CNPJ, conversores e calculadoras. Tudo processado no seu navegador, sem cadastro.</p>
      <div class="search" role="search">
        ${ic('search')}
        <input id="search" type="search" placeholder="O que você precisa fazer? Ex.: contar caracteres, gerar Pix…" autocomplete="off" aria-label="Buscar ferramentas" enterkeyhint="search">
        <span class="search-count" id="searchCount" aria-live="polite"></span>
        <kbd>/</kbd>
      </div>
      <div class="quick" aria-label="Mais usadas">${popular.slice(0, 6).map((t) => `<a href="ferramentas/${t.id}/">${esc(t.name)}</a>`).join('')}</div>
    </section>

    <ul class="trust" aria-label="Diferenciais">
      <li>${ic('shield')}<div><b>Privado</b><span>Seus dados ficam no seu dispositivo</span></div></li>
      <li>${ic('zap')}<div><b>Instantâneo</b><span>Resultado enquanto você digita</span></div></li>
      <li>${ic('wifi-off')}<div><b>Funciona offline</b><span>Instale como aplicativo</span></div></li>
      <li>${ic('smartphone')}<div><b>Em qualquer tela</b><span>Celular, tablet e computador</span></div></li>
    </ul>

    <section id="personal" class="cat-section" hidden aria-labelledby="h-personal">
      <header class="sec-head"><span class="sec-ic">${ic('history')}</span><div><h2 id="h-personal">Seus atalhos</h2><p>Favoritas e usadas recentemente neste navegador.</p></div></header>
      <div class="grid grid-compact" id="personalGrid"></div>
    </section>

    <section class="cat-section" data-cat-section="popular" aria-labelledby="h-pop">
      <header class="sec-head"><span class="sec-ic" style="--c:#f59e0b">${ic('star')}</span><div><h2 id="h-pop">Mais populares</h2><p>As ferramentas mais procuradas do Gooners.</p></div></header>
      <div class="grid">${popular.map((t) => card(R, t)).join('')}</div>
    </section>
    ${sections}
    <p class="empty" id="empty" hidden>Nenhuma ferramenta encontrada. Tente outro termo, como “data”, “texto” ou “pdf”.</p>

    <section class="law-cta">
      <div>
        <p class="eyebrow">Plataforma parceira</p>
        <h2>Gooners Law</h2>
        <p>Assistência jurídica em proteção patrimonial e assessoria offshore, com portal de notícias jurídicas atualizado em tempo real.</p>
      </div>
      <div class="law-cta-actions"><a class="btn btn-gold" href="law/">Conhecer a Gooners Law</a><a class="btn btn-ghost-light" href="law/noticias/">Ver notícias</a></div>
    </section>

    <section class="cat-section seo-text" aria-labelledby="h-faq">
      <h2 id="h-faq">Perguntas frequentes</h2>
      ${faqHtml(HOME_FAQ)}
    </section>`;
  out('index.html', shell({ R, path: '', page: 'home', title: `${SITE.name} — ${SITE.tagline}: texto, Pix, CPF, CEP e calculadoras`, desc: SITE.description, body,
    jsonld: [ORG, { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: SITE_URL, inLanguage: 'pt-BR', description: SITE.description,
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: SITE_URL + '?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Ferramentas Gooners', itemListElement: TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: toolUrl(t.id), name: t.name })) }, faqLd(HOME_FAQ)] }));
}

// ---------- favoritos (página pessoal, não indexada) ----------
out('favoritos/index.html', shell({ R: '../', path: 'favoritos/', page: 'favorites', robots: 'noindex,follow', title: 'Seus favoritos — Gooners', desc: 'Suas ferramentas favoritas e recentes no Gooners.',
  body: `${crumbs('../', [['Início', '../'], ['Favoritos']])}
    <header class="page-head"><h1>Favoritos</h1><p class="lead">Ferramentas que você marcou com estrela e as usadas recentemente. Ficam salvas só neste navegador.</p></header>
    <section class="cat-section"><h2 class="mini-title">Favoritas</h2><div class="grid" id="favGrid"></div><p class="empty" id="favEmpty" hidden>Você ainda não favoritou nenhuma ferramenta. Clique na estrela de um card ou aperte <kbd>F</kbd> dentro de uma ferramenta.</p></section>
    <section class="cat-section"><h2 class="mini-title">Recentes</h2><div class="grid grid-compact" id="recGrid"></div></section>` }));

// ---------- categorias ----------
for (const c of CATEGORIES) {
  const R = '../../', ic = icFor(R), list = TOOLS.filter((t) => t.cat === c.id);
  const items = [['Início', SITE_URL], [c.name, catUrl(c.id)]];
  const body = `${crumbs(R, [['Início', R], [c.name]])}
    <header class="page-head with-ic"><span class="sec-ic lg" style="--c:${c.color}">${ic(c.icon)}</span><div><h1>Ferramentas de ${c.name.toLowerCase()}</h1><p class="lead">${c.desc} ${list.length} ferramentas gratuitas, sem cadastro.</p></div></header>
    <div class="filter-bar"><div class="search sm" role="search">${ic('search')}<input id="search" type="search" placeholder="Filtrar nesta categoria…" aria-label="Filtrar ferramentas"><span class="search-count" id="searchCount"></span></div></div>
    <section class="cat-section" data-cat-section="${c.id}"><div class="grid">${list.map((t) => card(R, t)).join('')}</div></section>
    <p class="empty" id="empty" hidden>Nenhuma ferramenta encontrada.</p>
    <section class="cat-section"><h2 class="mini-title">Outras categorias</h2><div class="cat-pills">${CATEGORIES.filter((x) => x.id !== c.id).map((x) => `<a href="../${x.id}/" style="--c:${x.color}">${ic(x.icon)}${x.name}</a>`).join('')}</div></section>`;
  out(`categorias/${c.id}/index.html`, shell({ R, path: `categorias/${c.id}/`, page: 'category', cat: c.id, title: `Ferramentas de ${c.name} online grátis — ${SITE.name}`, desc: clamp(`${c.desc} ${list.length} ferramentas grátis: ${list.slice(0, 2).map((t) => t.name).join(', ')} e mais.`, 160), body,
    jsonld: [crumbLd(items), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Ferramentas de ${c.name}`, url: catUrl(c.id), inLanguage: 'pt-BR', hasPart: list.map((t) => ({ '@type': 'WebApplication', name: t.name, url: toolUrl(t.id) })) }] }));
}

// ---------- ferramentas ----------
for (const t of TOOLS) {
  const R = '../../', ic = icFor(R), c = catById[t.cat], s = seoFor(t);
  const related = [...TOOLS.filter((x) => x.cat === t.cat && x.id !== t.id), ...POPULAR.map((id) => toolById[id]).filter((x) => x && x.cat !== t.cat)].slice(0, 8);
  const items = [['Início', SITE_URL], [c.name, catUrl(c.id)], [t.name, toolUrl(t.id)]];
  const desc = `${t.desc} Grátis, rápido, sem cadastro e direto no navegador.`;
  const body = `${crumbs(R, [['Início', R], [c.name, `${R}categorias/${c.id}/`], [t.name]])}
    <header class="tool-head">
      <span class="tool-icon" style="--c:${c.color}">${ic(t.icon)}</span>
      <div class="tool-title"><h1>${esc(t.name)}</h1><p class="lead">${esc(t.desc)}</p></div>
      <div class="tool-actions">
        <button class="btn btn-ghost" id="favBtn" aria-pressed="false" title="Favoritar (F)">${ic('star')}<span>Favoritar</span></button>
        <button class="btn btn-ghost" id="shareBtn">${ic('share-2')}<span>Compartilhar</span></button>
        <button class="icon-btn" id="focusBtn" aria-label="Modo foco" title="Modo foco">${ic('maximize-2')}</button>
      </div>
    </header>
    <section class="tool-card" id="toolCard" aria-label="${esc(t.name)}">
      <div class="tool-body" id="toolBody"><noscript><p class="hint">Esta ferramenta precisa de JavaScript ativado no navegador.</p></noscript><div class="tool-skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>
    </section>
    <div class="tool-info">
      <article class="info-main">
        <section><h2>Como usar — ${esc(t.name)}</h2><ol class="steps">${s.how.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>
        <section><h2>Perguntas frequentes</h2>${faqHtml(s.faq)}</section>
      </article>
      <aside class="info-side">
        <h2>Ferramentas relacionadas</h2>
        <div class="grid grid-compact">${related.map((x) => card(R, x)).join('')}</div>
        <a class="sec-more" href="${R}categorias/${c.id}/">Todas de ${c.name.toLowerCase()} ${ic('arrow-right')}</a>
      </aside>
    </div>`;
  out(`ferramentas/${t.id}/index.html`, shell({ R, path: `ferramentas/${t.id}/`, page: 'tool', tool: t.id, cat: t.cat, title: `${s.title} — ${SITE.name}`, desc, body,
    jsonld: [crumbLd(items), { '@context': 'https://schema.org', '@type': 'WebApplication', name: t.name, url: toolUrl(t.id), description: desc, inLanguage: 'pt-BR', applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' }, publisher: { '@type': 'Organization', name: 'Gooners', url: SITE_URL } }, faqLd(s.faq)] }));
}

// Remove páginas de ferramentas que não existem mais
for (const d of existsSync(ROOT + 'ferramentas') ? readdirSync(ROOT + 'ferramentas') : []) if (!toolById[d]) rmSync(ROOT + 'ferramentas/' + d, { recursive: true });

// ---------- sitemap, robots, manifest ----------
const lawPages = ['law/', 'law/noticias/', 'law/glossario/', 'law/artigos/', ...(existsSync(ROOT + 'law/artigos') ? readdirSync(ROOT + 'law/artigos').filter((d) => existsSync(`${ROOT}law/artigos/${d}/index.html`)).map((d) => `law/artigos/${d}/`) : [])];
const urls = [['', '1.0', 'weekly'], ...CATEGORIES.map((c) => [`categorias/${c.id}/`, '0.8', 'weekly']), ...TOOLS.map((t) => [`ferramentas/${t.id}/`, POPULAR.includes(t.id) ? '0.9' : '0.7', 'monthly']),
  ...lawPages.map((p) => [p, p === 'law/noticias/' ? '0.9' : '0.8', p === 'law/noticias/' ? 'hourly' : 'monthly'])];
writeFileSync(ROOT + 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, pr, cf]) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${TODAY}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(ROOT + 'robots.txt', `User-agent: *\nAllow: /\nDisallow: /favoritos/\nDisallow: /scripts/\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
writeFileSync(ROOT + 'manifest.webmanifest', JSON.stringify({
  name: 'Gooners — Ferramentas online', short_name: 'Gooners', description: SITE.description, lang: 'pt-BR', start_url: './', scope: './', display: 'standalone', background_color: '#ffffff', theme_color: '#4f46e5',
  icons: [{ src: 'assets/img/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'assets/img/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'assets/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: 'assets/img/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  shortcuts: POPULAR.slice(0, 4).map((id) => ({ name: toolById[id].name, url: `ferramentas/${id}/` })),
  categories: ['utilities', 'productivity'],
}, null, 2));
// Versão do service worker acompanha o conteúdo publicado
const swPath = ROOT + 'sw.js';
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'gooners-${V.css}${V.tools}${V.app}';`));
console.log(`✓ ${TOOLS.length} ferramentas, ${CATEGORIES.length} categorias, ${urls.length} URLs no sitemap (${SITE_URL})`);
