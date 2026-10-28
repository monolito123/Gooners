#!/usr/bin/env node
// Gera as páginas estáticas da Gooners Law: home, portal de notícias, glossário e artigos.
// As manchetes de law/data/news.json são pré-renderizadas no HTML (indexáveis) e atualizadas ao vivo no navegador.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AREAS, STEPS, GOALS, JUR, FAQ, CHECKLIST, GLOSSARY, ARTICLES } from './law-content.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(ROOT + 'scripts/site.config.json', 'utf8'));
const SITE_URL = (process.env.SITE_URL || cfg.siteUrl).replace(/\/?$/, '/');
const LAW_URL = SITE_URL + 'law/';
const NOW = new Date();
const hash = (f) => createHash('md5').update(readFileSync(ROOT + f)).digest('hex').slice(0, 8);
const V = { css: hash('law/assets/law.css'), js: hash('law/assets/law.js'), news: hash('law/assets/news.js'), cfg: hash('law/assets/config.js') };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const out = (rel, html) => { const f = ROOT + rel; mkdirSync(f.replace(/[^/]+$/, ''), { recursive: true }); writeFileSync(f, html); };
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- notícias pré-renderizadas ----------
let NEWS = { updated: 0, items: [] };
try { NEWS = JSON.parse(readFileSync(ROOT + 'law/data/news.json', 'utf8')); } catch { /* ainda sem coleta */ }
const CAT_NAME = { patrimonial: 'Proteção patrimonial', offshore: 'Offshore', sucessoes: 'Sucessões', tributario: 'Tributário', tribunais: 'Tribunais', empresarial: 'Empresarial', geral: 'Geral' };
const fmtDate = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const newsCard = (x, feat = false) => `<article class="news-card${feat ? ' feat' : ''}" data-link="${esc(x.link)}">
  <div class="news-meta"><span class="cat">${esc(CAT_NAME[x.cats?.[0]] || 'Geral')}</span><time datetime="${new Date(x.date).toISOString()}" data-rel="${x.date}">${fmtDate(x.date)}</time></div>
  <h3><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></h3>
  ${x.desc ? `<p>${esc(x.desc)}</p>` : ''}
  <footer><span class="src">${esc(x.source)}</span></footer>
</article>`;

// ---------- shell ----------
function shell({ L, H, path, title, desc, body, jsonld = [], page, ogType = 'website', extraHead = '' }) {
  const ic = (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const canonical = LAW_URL + path;
  const ticker = [...NEWS.items.slice(0, 14), ...NEWS.items.slice(0, 14)].map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><b>${esc(CAT_NAME[x.cats?.[0]] || 'Geral')}</b>${esc(x.title)}</a>`).join('');
  const nav = [['Atuação', `${L}#atuacao`], ['Offshore', `${L}#offshore`], ['Simuladores', `${L}#simuladores`], ['Notícias', `${L}noticias/`, 'news'], ['Artigos', `${L}artigos/`, 'articles'], ['Glossário', `${L}glossario/`, 'glossary']];
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Gooners Law">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${LAW_URL}assets/og-law.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${LAW_URL}assets/og-law.png">
<meta name="theme-color" content="#0b1830">
<link rel="icon" href="${L}assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${L}assets/apple-touch-icon.png">
<link rel="alternate" type="application/json" title="Notícias jurídicas — Gooners Law" href="${L}data/news.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${L}assets/law.css?v=${V.css}">
${extraHead}${jsonld.map(ld).join('\n')}
</head>
<body data-page="${page}" data-l="${L}" data-h="${H}">
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<div class="ticker" aria-label="Últimas notícias jurídicas">
  <a class="live" href="${L}noticias/"><i></i>AO VIVO</a>
  <div class="ticker-track"><div class="ticker-move" id="ticker">${ticker || '<span>Carregando manchetes jurídicas…</span>'}</div></div>
  <a class="ticker-all" href="${L}noticias/">Todas as notícias ${ic('arrow-right')}</a>
</div>
<header class="nav" id="nav">
  <div class="nav-inner">
    <a href="${L}" class="logo" aria-label="Gooners Law — página inicial"><img src="${L}assets/icon.svg" width="36" height="36" alt=""><span>Gooners <em>Law</em></span></a>
    <nav class="links" id="links" aria-label="Principal">
      ${nav.map(([n, href, p]) => `<a href="${href}"${p === page ? ' aria-current="page"' : ''}>${n}${p === 'news' ? '<span class="dot" aria-hidden="true"></span>' : ''}</a>`).join('')}
      <a href="${L}#contato" class="btn btn-gold sm">Agendar consulta</a>
    </nav>
    <button class="menu-btn" id="menuBtn" aria-label="Abrir menu" aria-expanded="false" aria-controls="links"><span></span><span></span><span></span></button>
  </div>
</header>
<main id="conteudo" tabindex="-1">
${body}
</main>
<footer class="foot">
  <div class="foot-inner">
    <div class="foot-brand">
      <a href="${L}" class="logo"><img src="${L}assets/icon.svg" width="32" height="32" alt=""><span>Gooners <em>Law</em></span></a>
      <p>Assistência jurídica em proteção patrimonial, planejamento sucessório e assessoria offshore, com portal de notícias jurídicas em tempo real.</p>
      <a href="${L}#contato" class="btn btn-gold sm">Agendar consulta</a>
    </div>
    <div><h3>Atuação</h3><ul>${AREAS.map((a) => `<li><a href="${L}#area-${slug(a.title)}">${a.title}</a></li>`).join('')}</ul></div>
    <div><h3>Conteúdo</h3><ul><li><a href="${L}noticias/">Notícias jurídicas</a></li><li><a href="${L}artigos/">Artigos</a></li><li><a href="${L}glossario/">Glossário jurídico</a></li>${ARTICLES.map((a) => `<li><a href="${L}artigos/${a.slug}/">${esc(a.title.split(':')[0])}</a></li>`).join('')}</ul></div>
    <div><h3>Ferramentas</h3><ul><li><a href="${L}#simuladores">Diagnóstico patrimonial</a></li><li><a href="${L}#simuladores">Inventário × holding</a></li><li><a href="${L}#simuladores">Tributação offshore</a></li><li><a href="${L}#simuladores">Checklist da holding</a></li><li><a href="${L}#offshore">Comparador de jurisdições</a></li><li><a href="${H}">Gooners: ferramentas online</a></li></ul></div>
  </div>
  <div class="foot-legal">
    <p>Conteúdo de caráter exclusivamente informativo, que não constitui aconselhamento jurídico, fiscal ou financeiro nem promessa de resultado. Cada caso exige análise individual por profissional habilitado. Publicidade informativa nos termos do Código de Ética e Disciplina da OAB e do Provimento CFOAB nº 205/2021. As notícias pertencem aos respectivos veículos e são exibidas com link para a fonte original.</p>
    <p>© <span data-year>${NOW.getFullYear()}</span> Gooners Law · <a href="${H}sitemap.xml">Mapa do site</a></p>
  </div>
</footer>
<button class="to-top" id="toTop" aria-label="Voltar ao topo">${ic('arrow-up-right')}</button>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="${L}assets/config.js?v=${V.cfg}" defer></script>
<script src="${L}assets/law.js?v=${V.js}" defer></script>
<script src="${L}assets/news.js?v=${V.news}" defer></script>
</body>
</html>
`;
}

const ORG = { '@context': 'https://schema.org', '@type': 'LegalService', '@id': LAW_URL + '#org', name: 'Gooners Law', url: LAW_URL, logo: LAW_URL + 'assets/icon-512.png', image: LAW_URL + 'assets/og-law.png',
  description: 'Assistência jurídica especializada em proteção patrimonial, holdings, planejamento sucessório e assessoria offshore.', areaServed: { '@type': 'Country', name: 'Brasil' }, inLanguage: 'pt-BR',
  knowsAbout: ['Proteção patrimonial', 'Holding familiar', 'Planejamento sucessório', 'Estruturação offshore', 'Lei 14.754/2023', 'Trusts', 'ITCMD', 'Compliance fiscal internacional'],
  hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Áreas de atuação', itemListElement: AREAS.map((a) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: a.title, description: a.text } })) } };
const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
const faqLd = (faq) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const crumbs = (items) => `<nav class="crumbs" aria-label="Você está em"><ol>${items.map(([n, href], i) => `<li>${href && i < items.length - 1 ? `<a href="${href}">${esc(n)}</a>` : `<span aria-current="page">${esc(n)}</span>`}</li>`).join('')}</ol></nav>`;

// ---------- HOME ----------
{
  const L = '', H = '../', ic = (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const latest = NEWS.items.slice(0, 4);
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">Proteção patrimonial · Estruturação offshore · Sucessão</p>
      <h1>Seu patrimônio merece <em>arquitetura jurídica</em>, não improviso.</h1>
      <p class="sub">Assessoria técnica para famílias, empresários e investidores que querem organizar, proteger e transmitir patrimônio no Brasil e no exterior, com conformidade fiscal e segurança jurídica.</p>
      <div class="hero-cta"><a href="#simuladores" class="btn btn-gold">Fazer diagnóstico gratuito</a><a href="#contato" class="btn btn-line-light">Agendar consulta</a></div>
      <ul class="pillars">
        <li>${ic('shield')}<div><b>Planejamento lícito</b><span>Estruturas preventivas, com propósito negocial.</span></div></li>
        <li>${ic('globe')}<div><b>Visão internacional</b><span>Jurisdições e veículos analisados caso a caso.</span></div></li>
        <li>${ic('file-check')}<div><b>Conformidade</b><span>Lei 14.754/2023, CBE, CRS e FATCA.</span></div></li>
      </ul>
    </div>
    <aside class="hero-news" aria-label="Últimas notícias">
      <header><span class="live-pill"><i></i>Ao vivo</span><a href="noticias/">Portal de notícias ${ic('arrow-right')}</a></header>
      <ol id="heroNews">${latest.map((x) => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><span class="hn-cat">${esc(CAT_NAME[x.cats?.[0]] || 'Geral')}</span>${esc(x.title)}<small>${esc(x.source)} · <time data-rel="${x.date}">${fmtDate(x.date)}</time></small></a></li>`).join('')}</ol>
    </aside>
  </div>
</section>

<section class="section" id="atuacao" aria-labelledby="h-areas">
  <div class="wrap">
    <header class="sec-head"><p class="kicker">Áreas de atuação</p><h2 id="h-areas">Soluções integradas para proteger o que você construiu</h2><p>Atuação preventiva e consultiva, com integração entre direito societário, sucessório, tributário e internacional.</p></header>
    <div class="areas">${AREAS.map((a) => `
      <article class="area reveal" id="area-${slug(a.title)}">
        <span class="area-ic">${ic(a.icon)}</span>
        <h3>${a.title}</h3><p>${a.text}</p>
        <button class="area-more" aria-expanded="false">Ver detalhes ${ic('chevron-down')}</button>
        <ul hidden>${a.items.map((i) => `<li>${ic('check')}${i}</li>`).join('')}</ul>
      </article>`).join('')}
    </div>
  </div>
</section>

<section class="section alt" aria-labelledby="h-method">
  <div class="wrap">
    <header class="sec-head"><p class="kicker">Metodologia</p><h2 id="h-method">Como trabalhamos</h2></header>
    <ol class="method">${STEPS.map(([t, d], i) => `<li class="reveal"><span>${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
  </div>
</section>

<section class="section" id="offshore" aria-labelledby="h-off">
  <div class="wrap">
    <header class="sec-head"><p class="kicker">Assessoria offshore</p><h2 id="h-off">Comparador de jurisdições</h2><p>Visão de referência para iniciar a conversa. Filtre por objetivo e marque até três jurisdições para comparar lado a lado.</p></header>
    <div class="filters" id="jurFilters" role="group" aria-label="Filtrar por objetivo"><button data-g="all" aria-pressed="true">Todas</button>${Object.entries(GOALS).map(([k, v]) => `<button data-g="${k}" aria-pressed="false">${v}</button>`).join('')}</div>
    <div class="jur-grid" id="jurGrid">${JUR.map((j) => `
      <article class="jur" data-id="${j.id}" data-g="${j.g.join(' ')}">
        <header><span class="flag" aria-hidden="true">${j.f}</span><div><h3>${j.n}</h3><span class="sys">${j.sys}</span></div></header>
        <p>${j.d}</p>
        <dl><dt>Veículos</dt><dd>${j.v}</dd><dt>CRS</dt><dd>${j.crs}</dd></dl>
        <div class="tags">${j.g.map((g) => `<span class="tag">${GOALS[g]}</span>`).join('')}${j.warn.map((w) => `<span class="tag warn">${w}</span>`).join('')}</div>
        <label class="cmp"><input type="checkbox" value="${j.id}"> Comparar</label>
      </article>`).join('')}
    </div>
    <div class="compare-bar" id="compareBar" hidden><span id="compareInfo"></span><button class="btn btn-navy sm" id="compareBtn">Comparar selecionadas</button><button class="btn btn-line sm" id="compareClear">Limpar</button></div>
    <div class="compare-table" id="compareTable" hidden></div>
    <script type="application/json" id="jurData">${JSON.stringify({ JUR, GOALS }).replace(/</g, '\\u003c')}</script>
    <div class="note">
      <h3>Regras brasileiras que se aplicam a qualquer estrutura</h3>
      <ul>
        <li><b>Lei 14.754/2023:</b> lucros de entidades controladas no exterior tributados anualmente a 15% em 31/12, conforme o enquadramento. Trusts têm tratamento de transparência, com bens atribuídos ao instituidor. <a href="artigos/lei-14754-tributacao-offshore-trusts/">Leia o guia</a>.</li>
        <li><b>Declaração de Capitais Brasileiros no Exterior (CBE)</b> ao Banco Central, quando atingidos os limites vigentes, e informação na Declaração de Ajuste Anual.</li>
        <li><b>Troca automática de informações</b> (CRS/OCDE e FATCA): sigilo não é estratégia, conformidade é.</li>
        <li>Jurisdições de tributação favorecida e regimes privilegiados (IN RFB 1.037/2010) têm efeitos fiscais específicos. Confira sempre a versão vigente.</li>
      </ul>
    </div>
  </div>
</section>

<section class="section alt" id="simuladores" aria-labelledby="h-sim">
  <div class="wrap">
    <header class="sec-head"><p class="kicker">Ferramentas interativas</p><h2 id="h-sim">Simuladores jurídicos</h2><p>Calculados no seu navegador: nenhum dado é enviado.</p></header>
    <div class="sim-tabs" role="tablist" aria-label="Simuladores">
      <button role="tab" id="tab-diagnostico" aria-controls="diagnostico" aria-selected="true" data-tab="diagnostico">${ic('chart-line')}Diagnóstico patrimonial</button>
      <button role="tab" id="tab-sucessao" aria-controls="sucessao" aria-selected="false" data-tab="sucessao">${ic('tree-pine')}Inventário × holding</button>
      <button role="tab" id="tab-offshore-calc" aria-controls="offshore-calc" aria-selected="false" data-tab="offshore-calc">${ic('globe')}Tributação offshore</button>
      <button role="tab" id="tab-checklist" aria-controls="checklist" aria-selected="false" data-tab="checklist">${ic('clipboard-list')}Checklist da holding</button>
    </div>
    <div class="panel" id="diagnostico" role="tabpanel" aria-labelledby="tab-diagnostico" data-panel="diagnostico"><div class="quiz" id="quiz"></div></div>
    <div class="panel" id="sucessao" role="tabpanel" aria-labelledby="tab-sucessao" data-panel="sucessao" hidden>
      <div class="sim">
        <form class="sim-form" id="sucForm" onsubmit="return false">
          <label>Patrimônio total (R$)<input name="pat" value="5.000.000" inputmode="decimal"></label>
          <label>Alíquota de ITCMD aplicável (%)<select name="itcmd"><option value="2">2%</option><option value="3">3%</option><option value="4" selected>4%</option><option value="5">5%</option><option value="6">6%</option><option value="7">7%</option><option value="8">8% (teto — Resolução do Senado nº 9/1992)</option></select></label>
          <div class="two"><label>Honorários do inventário (% do monte)<input name="hon" value="6" inputmode="decimal"></label><label>Custas e emolumentos (%)<input name="cus" value="2" inputmode="decimal"></label></div>
          <div class="two"><label>Duração do inventário (meses)<input name="dur" value="24" inputmode="numeric"></label><label>Implementação da holding (%)<input name="impl" value="2" inputmode="decimal"></label></div>
          <label class="chk"><input type="checkbox" name="doacao" checked> Doação de quotas em vida (com reserva de usufruto)</label>
        </form>
        <div class="sim-out" id="sucOut"></div>
      </div>
      <p class="disclaimer">Estimativa simplificada e ilustrativa. A Reforma Tributária (EC 132/2023) tornou o ITCMD obrigatoriamente progressivo e as alíquotas estaduais vêm sendo alteradas. A base de cálculo, a valoração das quotas e a tributação na integralização (ITBI e IR) exigem análise individual.</p>
    </div>
    <div class="panel" id="offshore-calc" role="tabpanel" aria-labelledby="tab-offshore-calc" data-panel="offshore-calc" hidden>
      <div class="sim">
        <form class="sim-form" id="offForm" onsubmit="return false">
          <label>Lucro anual da controlada no exterior (US$)<input name="lucro" value="200.000" inputmode="decimal"></label>
          <div class="two"><label>Câmbio (R$ por US$)<input name="fx" value="5,40" inputmode="decimal"></label><label>Imposto pago no exterior (US$)<input name="ext" value="0" inputmode="decimal"></label></div>
          <label>Enquadramento<select name="reg"><option value="tp">Tributação anual: jurisdição favorecida, regime privilegiado ou renda ativa &lt; 60%</option><option value="ativa">Renda ativa própria ≥ 60%: tributação na distribuição</option></select></label>
          <label>Lucro distribuído no ano (US$, para o regime de distribuição)<input name="dist" value="0" inputmode="decimal"></label>
        </form>
        <div class="sim-out" id="offOut"></div>
      </div>
      <p class="disclaimer">Cálculo de referência da alíquota de 15% prevista na Lei 14.754/2023 para pessoas físicas residentes, com dedução limitada do imposto pago no exterior. Não considera ajustes de variação cambial, prejuízos acumulados, tratados nem regras de transição.</p>
    </div>
    <div class="panel" id="checklist" role="tabpanel" aria-labelledby="tab-checklist" data-panel="checklist" hidden>
      <div class="check-head"><div><h3>Documentos para estruturar uma holding familiar</h3><p>Marque o que você já tem. O progresso fica salvo neste navegador.</p></div><div class="progress"><span id="ckPct">0%</span><div class="bar"><i id="ckBar"></i></div></div></div>
      <div class="check-grid" id="ckList">${CHECKLIST.map(([g, items], gi) => `<fieldset><legend>${g}</legend>${items.map((it, ii) => `<label><input type="checkbox" data-k="${gi}-${ii}"><span>${it}</span></label>`).join('')}</fieldset>`).join('')}</div>
      <div class="check-actions"><button class="btn btn-navy sm" id="ckPrint">${ic('printer')}Imprimir lista</button><button class="btn btn-line sm" id="ckReset">Recomeçar</button><a class="btn btn-gold sm" href="#contato">Enviar para análise</a></div>
    </div>
  </div>
</section>

<section class="section" id="noticias" aria-labelledby="h-news">
  <div class="wrap">
    <header class="sec-head row"><div><p class="kicker"><span class="live-pill dark"><i></i>Tempo real</span> Portal de notícias</p><h2 id="h-news">Notícias jurídicas</h2></div><a class="btn btn-navy" href="noticias/">Abrir o portal completo ${ic('arrow-right')}</a></header>
    <div class="news-grid preview" id="newsPreview">${NEWS.items.slice(0, 6).map((x) => newsCard(x)).join('')}</div>
  </div>
</section>

<section class="section alt" id="artigos" aria-labelledby="h-art">
  <div class="wrap">
    <header class="sec-head row"><div><p class="kicker">Conteúdo</p><h2 id="h-art">Artigos e guias</h2></div><a class="link-more" href="artigos/">Todos os artigos ${ic('arrow-right')}</a></header>
    <div class="articles">${ARTICLES.map((a) => `<a class="art-card reveal" href="artigos/${a.slug}/"><span class="tag">${a.tag}</span><h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p><span class="art-meta">${ic('clock')}${a.minutes} min de leitura</span></a>`).join('')}</div>
  </div>
</section>

<section class="section" id="faq" aria-labelledby="h-faq">
  <div class="wrap faq-wrap">
    <header class="sec-head"><p class="kicker">Perguntas frequentes</p><h2 id="h-faq">Dúvidas comuns</h2><p>Não encontrou sua dúvida? Consulte o <a href="glossario/">glossário jurídico</a> ou fale conosco.</p></header>
    <div class="faq-list">${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </div>
</section>

<section class="section contact" id="contato" aria-labelledby="h-contact">
  <div class="wrap contact-card">
    <div class="contact-copy">
      <p class="kicker">Atendimento reservado</p>
      <h2 id="h-contact">Agende uma consulta</h2>
      <p>Escolha o melhor dia e horário e conte, em linhas gerais, o que você precisa. As informações são tratadas com sigilo profissional e em conformidade com a LGPD.</p>
      <ul class="contact-info" id="contactInfo"></ul>
    </div>
    <form id="contactForm" class="contact-form" novalidate>
      <label>Nome<input name="nome" required autocomplete="name"></label>
      <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
      <label>Telefone / WhatsApp<input name="tel" autocomplete="tel" inputmode="tel"></label>
      <label>Assunto<select name="assunto"><option>Proteção patrimonial</option><option>Holding familiar</option><option>Planejamento sucessório</option><option>Estruturação offshore</option><option>Regularização de ativos no exterior</option><option>Outro</option></select></label>
      <label>Data preferida<input name="data" type="date" required></label>
      <label>Horário<select name="hora">${['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'].map((h) => `<option>${h}</option>`).join('')}</select></label>
      <fieldset class="full mode"><legend>Formato</legend><label><input type="radio" name="modo" value="Videochamada" checked> Videochamada</label><label><input type="radio" name="modo" value="Presencial"> Presencial</label><label><input type="radio" name="modo" value="Telefone"> Telefone</label></fieldset>
      <label class="full">Mensagem<textarea name="msg" rows="4" required></textarea></label>
      <label class="chk full"><input type="checkbox" name="lgpd" required> Concordo com o tratamento dos meus dados para retorno do contato (LGPD).</label>
      <div class="full form-actions">
        <button class="btn btn-gold" type="submit" data-via="email">${ic('send')}Enviar por e-mail</button>
        <button class="btn btn-line-light" type="submit" data-via="wa">${ic('message-circle')}WhatsApp</button>
        <button class="btn btn-line-light" type="button" id="icsBtn">${ic('calendar-check')}Salvar na agenda</button>
      </div>
      <p class="form-msg full" id="formMsg" role="status"></p>
    </form>
  </div>
</section>`;
  out('law/index.html', shell({ L, H, path: '', page: 'home', title: 'Gooners Law — Proteção patrimonial, holding, sucessão e assessoria offshore', desc: 'Assistência jurídica em proteção patrimonial, holding familiar, planejamento sucessório e estruturação offshore. Simuladores gratuitos e notícias jurídicas em tempo real.', body,
    jsonld: [ORG, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Gooners Law', url: LAW_URL, inLanguage: 'pt-BR', publisher: { '@id': LAW_URL + '#org' } }, faqLd(FAQ)] }));
}

// ---------- PORTAL DE NOTÍCIAS ----------
{
  const L = '../', H = '../../', ic = (n) => `<svg class="ic" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const items = NEWS.items.slice(0, 25);
  const body = `
<div class="wrap page">
  ${crumbs([['Gooners Law', L], ['Notícias']])}
  <header class="page-head row">
    <div><p class="kicker"><span class="live-pill dark"><i></i>Tempo real</span> Portal de notícias jurídicas</p><h1>Notícias jurídicas de hoje</h1><p class="lead">Proteção patrimonial, offshore, sucessões, tributário, tribunais superiores e direito empresarial, reunidos de dezenas de veículos e atualizados automaticamente.</p></div>
    <div class="news-status" id="newsStatus">${NEWS.updated ? `Atualizado em ${fmtDate(NEWS.updated)}` : 'Conectando às fontes…'}</div>
  </header>
  <div class="news-tools">
    <div class="news-search">${ic('search')}<input id="newsSearch" type="search" placeholder="Buscar notícias (ex.: ITCMD, STF, offshore)…" aria-label="Buscar notícias"></div>
    <select id="newsPeriod" aria-label="Período"><option value="all">Qualquer data</option><option value="today">Hoje</option><option value="24h">Últimas 24 h</option><option value="7d">Últimos 7 dias</option></select>
    <select id="newsSource" aria-label="Fonte"><option value="">Todas as fontes</option></select>
    <div class="seg" role="group" aria-label="Visualização"><button id="viewGrid" aria-pressed="true" title="Grade">${ic('layout-grid')}</button><button id="viewList" aria-pressed="false" title="Lista">${ic('list')}</button></div>
    <button class="btn btn-line sm" id="newsRefresh">${ic('refresh-cw')}Atualizar</button>
  </div>
  <div class="news-tabs" id="newsTabs" role="tablist" aria-label="Temas"></div>
  <div class="news-layout">
    <div>
      <div class="news-grid" id="newsGrid">${items.map((x, i) => newsCard(x, i === 0)).join('')}</div>
      <div class="news-more"><button class="btn btn-line" id="newsMore">Carregar mais notícias</button></div>
    </div>
    <aside class="news-side">
      <section class="side-card"><h2>Mais recentes</h2><ol id="newsLatest" class="latest"></ol></section>
      <section class="side-card"><h2>Por tema</h2><ul id="newsTopics" class="topics"></ul></section>
      <section class="side-card"><h2>Alertas</h2><p>Receba um aviso no navegador quando chegar uma notícia nova enquanto a página estiver aberta.</p><button class="btn btn-gold sm" id="notifyBtn">${ic('bell')}Ativar alertas</button></section>
      <section class="side-card"><h2>Fontes monitoradas</h2><ul id="newsSources" class="sources"></ul></section>
      <section class="side-card navy"><h2>Precisa de orientação?</h2><p>Transforme a notícia em plano de ação para o seu patrimônio.</p><a class="btn btn-gold sm" href="${L}#contato">Agendar consulta</a></section>
    </aside>
  </div>
</div>`;
  out('law/noticias/index.html', shell({ L, H, path: 'noticias/', page: 'news', title: 'Notícias jurídicas de hoje em tempo real — Gooners Law', desc: 'Últimas notícias jurídicas sobre proteção patrimonial, offshore, ITCMD, inventário, reforma tributária, STF, STJ e direito empresarial, atualizadas em tempo real.', body,
    jsonld: [crumbLd([['Gooners Law', LAW_URL], ['Notícias', LAW_URL + 'noticias/']]), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Notícias jurídicas — Gooners Law', url: LAW_URL + 'noticias/', inLanguage: 'pt-BR', dateModified: new Date(NEWS.updated || NOW).toISOString(),
      mainEntity: { '@type': 'ItemList', itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: x.link, name: x.title })) } }] }));
}

// ---------- GLOSSÁRIO ----------
{
  const L = '../', H = '../../', ic = (n) => `<svg class="ic" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const letters = [...new Set(GLOSSARY.map(([t]) => t[0].toUpperCase()))];
  const body = `
<div class="wrap page narrow">
  ${crumbs([['Gooners Law', L], ['Glossário']])}
  <header class="page-head"><p class="kicker">Referência</p><h1>Glossário jurídico de patrimônio e sucessão</h1><p class="lead">${GLOSSARY.length} termos de proteção patrimonial, holdings, sucessões e estruturas internacionais, explicados em linguagem direta.</p></header>
  <div class="gl-tools"><div class="news-search">${ic('search')}<input id="glSearch" type="search" placeholder="Buscar termo…" aria-label="Buscar termo"></div><nav class="az" aria-label="Índice alfabético">${letters.map((l) => `<a href="#letra-${l}">${l}</a>`).join('')}</nav></div>
  <div class="glossary" id="glossary">${letters.map((l) => `<section id="letra-${l}"><h2>${l}</h2><dl>${GLOSSARY.filter(([t]) => t[0].toUpperCase() === l).map(([t, d]) => `<div class="term" id="${slug(t)}"><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl></section>`).join('')}</div>
  <p class="empty" id="glEmpty" hidden>Nenhum termo encontrado.</p>
</div>`;
  out('law/glossario/index.html', shell({ L, H, path: 'glossario/', page: 'glossary', title: 'Glossário jurídico: holding, sucessão, offshore e trusts — Gooners Law', desc: `Significado de ${GLOSSARY.slice(0, 3).map(([t]) => t).join(', ')} e outros ${GLOSSARY.length - 3} termos de patrimônio, sucessão e offshore.`, body,
    jsonld: [crumbLd([['Gooners Law', LAW_URL], ['Glossário', LAW_URL + 'glossario/']]), { '@context': 'https://schema.org', '@type': 'DefinedTermSet', name: 'Glossário jurídico Gooners Law', url: LAW_URL + 'glossario/', inLanguage: 'pt-BR',
      hasDefinedTerm: GLOSSARY.map(([t, d]) => ({ '@type': 'DefinedTerm', name: t, description: d, url: LAW_URL + 'glossario/#' + slug(t) })) }] }));
}

// ---------- ARTIGOS ----------
const published = cfg.articlesPublished || NOW.toISOString().slice(0, 10);
{
  const L = '../', H = '../../', ic = (n) => `<svg class="ic" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const body = `
<div class="wrap page">
  ${crumbs([['Gooners Law', L], ['Artigos']])}
  <header class="page-head"><p class="kicker">Conteúdo</p><h1>Artigos e guias jurídicos</h1><p class="lead">Guias práticos sobre proteção patrimonial, holdings, sucessão e tributação de ativos no exterior.</p></header>
  <div class="articles">${ARTICLES.map((a) => `<a class="art-card" href="${a.slug}/"><span class="tag">${a.tag}</span><h2>${esc(a.title)}</h2><p>${esc(a.desc)}</p><span class="art-meta">${ic('clock')}${a.minutes} min de leitura</span></a>`).join('')}</div>
</div>`;
  out('law/artigos/index.html', shell({ L, H, path: 'artigos/', page: 'articles', title: 'Artigos sobre proteção patrimonial, holding e offshore — Gooners Law', desc: 'Guias práticos sobre holding familiar, proteção patrimonial lícita e a tributação de offshores e trusts pela Lei 14.754/2023.', body,
    jsonld: [crumbLd([['Gooners Law', LAW_URL], ['Artigos', LAW_URL + 'artigos/']])] }));
}
for (const a of ARTICLES) {
  const L = '../../', H = '../../../', ic = (n) => `<svg class="ic" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const url = `${LAW_URL}artigos/${a.slug}/`;
  const others = ARTICLES.filter((x) => x !== a);
  const body = `
<div class="read-progress" aria-hidden="true"><i id="readBar"></i></div>
<article class="wrap page article">
  ${crumbs([['Gooners Law', L], ['Artigos', '../'], [a.title.split(':')[0]]])}
  <header class="art-head"><span class="tag">${a.tag}</span><h1>${esc(a.title)}</h1><p class="lead">${esc(a.desc)}</p>
    <div class="art-byline"><span>Equipe Gooners Law</span><span>·</span><time datetime="${published}">${new Date(published + 'T12:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</time><span>·</span><span>${a.minutes} min de leitura</span>
    <button class="btn btn-line sm" id="shareArticle">${ic('share-2')}Compartilhar</button></div></header>
  <div class="art-layout">
    <nav class="toc" aria-label="Neste artigo"><p>Neste artigo</p><ol>${a.sections.map(([t]) => `<li><a href="#${slug(t)}">${t}</a></li>`).join('')}</ol></nav>
    <div class="prose">
      ${a.sections.map(([t, html]) => `<section id="${slug(t)}"><h2>${t}</h2>${html}</section>`).join('\n')}
      <aside class="art-cta"><h2>Quer aplicar isso ao seu caso?</h2><p>Cada patrimônio tem riscos e objetivos próprios. Agende uma conversa para avaliar a melhor estrutura.</p><a class="btn btn-gold" href="${L}#contato">Agendar consulta</a></aside>
      <p class="disclaimer">Conteúdo informativo, elaborado com base na legislação vigente na data de publicação. Não substitui a análise individual por profissional habilitado.</p>
    </div>
  </div>
  <section class="related"><h2>Leia também</h2><div class="articles two">${others.map((x) => `<a class="art-card" href="../${x.slug}/"><span class="tag">${x.tag}</span><h3>${esc(x.title)}</h3><p>${esc(x.desc)}</p></a>`).join('')}</div></section>
</article>`;
  out(`law/artigos/${a.slug}/index.html`, shell({ L, H, path: `artigos/${a.slug}/`, page: 'article', ogType: 'article', title: a.title.length > 58 ? a.title : `${a.title} — Gooners Law`, desc: a.desc, body,
    extraHead: `<meta property="article:published_time" content="${published}">\n<meta property="article:section" content="${esc(a.tag)}">\n`,
    jsonld: [crumbLd([['Gooners Law', LAW_URL], ['Artigos', LAW_URL + 'artigos/'], [a.title, url]]), { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.desc, url, mainEntityOfPage: url, inLanguage: 'pt-BR',
      datePublished: published, dateModified: published, image: LAW_URL + 'assets/og-law.png', author: { '@type': 'Organization', name: 'Gooners Law', url: LAW_URL }, publisher: { '@id': LAW_URL + '#org', '@type': 'Organization', name: 'Gooners Law', logo: { '@type': 'ImageObject', url: LAW_URL + 'assets/icon-512.png' } } }] }));
}
console.log(`✓ Gooners Law: home, notícias (${NEWS.items.length} itens), glossário (${GLOSSARY.length} termos), ${ARTICLES.length} artigos`);
