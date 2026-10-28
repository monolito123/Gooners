/* ==========================================================
   Gooners Law — interface, conteúdo e simuladores
   ========================================================== */
(function () {
  'use strict';
  const CFG = window.LAW_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const s = String(v).trim().replace(/\s|R\$|US\$/g, ''); return s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(/\.(?=\d{3}(\D|$))/g, '')); };
  const brl = (n) => (isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  window.LawUI = { toast, esc };

  // ---------- navegação ----------
  const nav = $('#nav'), toTop = $('#toTop');
  addEventListener('scroll', () => { nav.classList.toggle('scrolled', scrollY > 20); toTop.classList.toggle('show', scrollY > 800); }, { passive: true });
  toTop.addEventListener('click', () => scrollTo({ top: 0 }));
  const menuBtn = $('#menuBtn'), links = $('#links');
  menuBtn.addEventListener('click', () => { const o = links.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', String(o)); });
  links.addEventListener('click', (e) => { if (e.target.closest('a')) { links.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } });
  $('#year').textContent = new Date().getFullYear();

  // ---------- áreas de atuação ----------
  const ICON = {
    shield: '<path d="M24 4 8 10v12c0 10 7 18 16 22 9-4 16-12 16-22V10z"/><path d="m17 24 5 5 9-10"/>',
    building: '<path d="M8 42V14l16-8 16 8v28M4 42h40M16 42V28h16v14M16 18h2M30 18h2"/>',
    tree: '<circle cx="24" cy="10" r="5"/><circle cx="12" cy="34" r="5"/><circle cx="36" cy="34" r="5"/><path d="M24 15v8M12 29v-6h24v6"/>',
    globe: '<circle cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c6 6 6 30 0 36M24 6c-6 6-6 30 0 36"/>',
    doc: '<path d="M12 4h16l10 10v30H12z"/><path d="M28 4v10h10M18 24h14M18 31h14M18 38h8"/>',
    scale: '<path d="M24 6v36M14 42h20M8 14h32M14 14l-6 12a6 6 0 0 0 12 0zM34 14l-6 12a6 6 0 0 0 12 0z"/>',
  };
  const AREAS = [
    ['shield', 'Proteção patrimonial', 'Organização preventiva do patrimônio pessoal e empresarial, segregando riscos da atividade e preservando bens familiares de forma lícita.',
      ['Mapeamento de riscos empresariais, trabalhistas e fiscais', 'Segregação entre patrimônio operacional e familiar', 'Revisão de garantias pessoais (aval, fiança)', 'Pactos antenupciais e regime de bens']],
    ['building', 'Holding familiar e patrimonial', 'Constituição e governança de holdings para concentrar imóveis, participações e investimentos com gestão centralizada.',
      ['Escolha do tipo societário e regime tributário', 'Integralização de imóveis e participações', 'Acordo de sócios e protocolo familiar', 'Cláusulas de incomunicabilidade, impenhorabilidade e reversão']],
    ['tree', 'Planejamento sucessório', 'Transmissão organizada do patrimônio entre gerações, reduzindo conflitos, custos e o tempo de um inventário.',
      ['Doação de quotas com reserva de usufruto', 'Testamentos e legados', 'Previdência privada (PGBL/VGBL) e seguros', 'Sucessão de empresas familiares']],
    ['globe', 'Estruturação offshore', 'Assessoria na criação, manutenção e regularização de estruturas no exterior para investimento, sucessão e internacionalização.',
      ['Análise comparativa de jurisdições', 'Sociedades de investimento, trusts e fundações privadas', 'Contas e custódia internacionais', 'Sucessão de ativos no exterior e estate tax americano']],
    ['doc', 'Compliance fiscal internacional', 'Conformidade com as regras brasileiras sobre ativos no exterior e com os padrões internacionais de transparência.',
      ['Lei 14.754/2023 (offshores e trusts)', 'Declaração de Capitais Brasileiros no Exterior (CBE)', 'CRS, FATCA e beneficiário final', 'Regularização e mudança de residência fiscal']],
    ['scale', 'Contencioso patrimonial', 'Defesa do patrimônio em disputas societárias, sucessórias e em execuções, com estratégia técnica e documental.',
      ['Desconsideração da personalidade jurídica', 'Impenhorabilidade e bem de família', 'Disputas entre herdeiros e sócios', 'Embargos e defesas em execução']],
  ];
  $('#areas').innerHTML = AREAS.map(([ic, t, d, items]) => `
    <article class="area reveal" tabindex="0" aria-expanded="false">
      <svg class="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${ICON[ic]}</svg>
      <h3>${t}</h3><p>${d}</p>
      <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
      <div class="more">VER DETALHES +</div>
    </article>`).join('');
  $$('.area').forEach((a) => {
    const toggle = () => { const o = a.classList.toggle('open'); a.setAttribute('aria-expanded', String(o)); $('.more', a).textContent = o ? 'RECOLHER −' : 'VER DETALHES +'; };
    a.addEventListener('click', toggle);
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  // ---------- jurisdições ----------
  const GOALS = { inv: 'Holding de investimentos', suc: 'Sucessão / trust', fund: 'Fundos', com: 'Operação comercial', prox: 'Proximidade com o Brasil' };
  const JUR = [
    { n: 'EUA (Delaware / Wyoming)', f: '🇺🇸', sys: 'Common law', g: ['inv', 'com', 'suc'], v: 'LLC, C-Corp, trusts estaduais', crs: 'Não (FATCA)', d: 'Mercado sofisticado e segurança jurídica. Exige atenção ao estate tax sobre bens situados nos EUA para não residentes.', warn: ['LLC sem tributação federal: regime privilegiado (IN 1.037, art. 2º)', 'Estate tax para não residentes'] },
    { n: 'Ilhas Virgens Britânicas', f: '🇻🇬', sys: 'Common law', g: ['inv', 'suc'], v: 'BC Company, trusts, VISTA trust', crs: 'Sim', d: 'Veículo tradicional para holdings de investimento; regras de substância econômica e registro de beneficiário final.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
    { n: 'Ilhas Cayman', f: '🇰🇾', sys: 'Common law', g: ['fund', 'inv', 'suc'], v: 'Exempted company, fundos, STAR trust, foundation company', crs: 'Sim', d: 'Principal centro de fundos de investimento do mundo; estruturas robustas para gestores e famílias.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
    { n: 'Bahamas', f: '🇧🇸', sys: 'Common law', g: ['suc', 'inv'], v: 'IBC, trusts, fundações', crs: 'Sim', d: 'Tradição em trusts e fundações para planejamento sucessório de longo prazo.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
    { n: 'Panamá', f: '🇵🇦', sys: 'Civil law', g: ['suc', 'com'], v: 'Fundação de interesse privado, S.A.', crs: 'Sim', d: 'Fundações privadas de tradição romano-germânica, próximas da lógica do direito brasileiro.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
    { n: 'Uruguai', f: '🇺🇾', sys: 'Civil law', g: ['prox', 'com', 'inv'], v: 'S.A., sociedades de responsabilidade limitada', crs: 'Sim', d: 'Proximidade geográfica e cultural com o Brasil e estabilidade institucional no Mercosul.', warn: [] },
    { n: 'Suíça', f: '🇨🇭', sys: 'Civil law', g: ['inv', 'com'], v: 'AG, GmbH, gestão patrimonial', crs: 'Sim', d: 'Referência em private banking e gestão de patrimônio, com elevada estabilidade política e monetária.', warn: [] },
    { n: 'Luxemburgo', f: '🇱🇺', sys: 'Civil law · UE', g: ['fund', 'inv'], v: 'SOPARFI, SICAV, RAIF, SIF', crs: 'Sim', d: 'Hub europeu de fundos e holdings com ampla rede de tratados e acesso ao mercado da União Europeia.', warn: [] },
    { n: 'Singapura', f: '🇸🇬', sys: 'Common law', g: ['inv', 'fund', 'com'], v: 'Pte. Ltd., VCC, family office', crs: 'Sim', d: 'Centro financeiro asiático com regime estruturado para family offices e fundos.', warn: [] },
    { n: 'Jersey', f: '🇯🇪', sys: 'Direito misto', g: ['suc', 'fund'], v: 'Trusts, fundações, companies', crs: 'Sim', d: 'Jurisdição consolidada para trusts e fundações, com supervisão rigorosa de prestadores de serviço fiduciário.', warn: [] },
  ];
  let goal = 'all';
  function renderJur() {
    $('#jurFilters').innerHTML = [['all', 'Todas'], ...Object.entries(GOALS)].map(([k, v]) => `<button data-g="${k}" aria-pressed="${goal === k}">${v}</button>`).join('');
    $('#jurGrid').innerHTML = JUR.filter((j) => goal === 'all' || j.g.includes(goal)).map((j, i) => `
      <article class="jur" style="animation-delay:${i * 40}ms">
        <header><h3>${j.n}</h3><span class="flag">${j.f}</span></header>
        <span class="sys">${j.sys}</span>
        <p>${j.d}</p>
        <dl><dt>Veículos</dt><dd>${j.v}</dd><dt>CRS</dt><dd>${j.crs}</dd></dl>
        <div class="tags">${j.g.map((g) => `<span class="tag">${GOALS[g]}</span>`).join('')}${j.warn.map((w) => `<span class="tag warn">⚠ ${w}</span>`).join('')}</div>
      </article>`).join('');
  }
  $('#jurFilters').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { goal = b.dataset.g; renderJur(); } });
  renderJur();

  // ---------- abas dos simuladores ----------
  function selectTab(id) {
    $$('.sim-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== id));
  }
  $('.sim-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); });
  function hashTab() { const id = location.hash.slice(1); if ($(`[data-panel="${id}"]`)) { selectTab(id); setTimeout(() => $('#ferramentas').scrollIntoView(), 0); } }
  addEventListener('hashchange', hashTab); hashTab();

  // ---------- diagnóstico ----------
  const QUIZ = [
    { q: 'Qual é, aproximadamente, o seu patrimônio total?', o: [['Até R$ 1 milhão', 0, 'p1'], ['De R$ 1 a 5 milhões', 1, 'p2'], ['De R$ 5 a 30 milhões', 2, 'p3'], ['Acima de R$ 30 milhões', 3, 'p4']] },
    { q: 'Qual é a sua principal atividade profissional?', o: [['Empregado(a) ou servidor(a)', 0], ['Profissional liberal', 2, 'liberal'], ['Empresário(a) / sócio(a) administrador(a)', 3, 'emp'], ['Investidor(a) / rentista', 1]] },
    { q: 'Em nome de quem estão os seus principais bens?', o: [['Praticamente tudo em meu nome (pessoa física)', 3, 'pf'], ['Parte em pessoa física, parte em empresas', 1, 'misto'], ['Já tenho holding patrimonial estruturada', 0, 'holding']] },
    { q: 'Como é a sua estrutura familiar?', o: [['Não tenho herdeiros necessários', 0], ['Filhos de uma mesma união', 1], ['Família recomposta / filhos de uniões diferentes', 3, 'recomp'], ['Herdeiros menores de idade ou incapazes', 2, 'menores']] },
    { q: 'Você já tem algum planejamento sucessório?', o: [['Nenhum', 3, 'semsuc'], ['Apenas testamento ou previdência privada', 1], ['Sim, com holding e/ou doações em vida', 0]] },
    { q: 'Possui ou pretende ter ativos no exterior?', o: [['Não', 0], ['Sim, tudo declarado e organizado', 1, 'offok'], ['Sim, mas não tenho certeza se está regular', 3, 'offirreg'], ['Pretendo ter em breve', 1, 'offplan']] },
    { q: 'Qual é a sua exposição a riscos e litígios?', o: [['Baixa', 0], ['Média — sou avalista/fiador ou tenho garantias pessoais', 2, 'aval'], ['Alta — atividade com passivos trabalhistas, fiscais ou regulatórios', 3, 'litig']] },
    { q: 'Seus herdeiros teriam liquidez para pagar ITCMD e custos de um inventário?', o: [['Sim, com folga', 0], ['Em parte', 1], ['Não — o patrimônio é majoritariamente imobilizado', 3, 'iliq']] },
  ];
  const RECS = {
    pf: ['Segregação patrimonial', 'Avaliar a transferência de bens de pessoa física para uma estrutura societária adequada, com análise de ITBI, IR e ganho de capital.'],
    emp: ['Separação entre operação e patrimônio', 'Evitar que bens familiares fiquem expostos aos riscos da empresa operacional; revisar contrato social e acordo de sócios.'],
    liberal: ['Proteção da atividade profissional', 'Avaliar sociedade profissional, seguros de responsabilidade civil e segregação de bens pessoais.'],
    semsuc: ['Planejamento sucessório', 'Definir como o patrimônio será transmitido: doações com reserva de usufruto, testamento, previdência e cláusulas restritivas.'],
    recomp: ['Prevenção de conflitos familiares', 'Famílias recompostas pedem regras claras: protocolo familiar, testamento e acordo de sócios na holding.'],
    menores: ['Proteção de herdeiros menores', 'Prever administração dos bens, tutela testamentária e cláusulas de inalienabilidade temporária.'],
    offirreg: ['Regularização de ativos no exterior', 'Prioridade: revisar declarações (DAA, CBE) e o enquadramento na Lei 14.754/2023 antes de qualquer nova estrutura.'],
    offplan: ['Desenho da estrutura internacional', 'Comparar jurisdições, veículos e custos de manutenção antes de abrir contas ou sociedades no exterior.'],
    offok: ['Sucessão dos ativos no exterior', 'Verificar como esses ativos serão transmitidos (probate, estate tax, trust) e a tributação anual.'],
    aval: ['Revisão de garantias pessoais', 'Mapear avais e fianças concedidos e negociar substituição por garantias reais ou corporativas.'],
    litig: ['Gestão de riscos e passivos', 'Medidas preventivas e de compliance. Atenção: transferências após dívidas constituídas podem configurar fraude contra credores ou à execução.'],
    iliq: ['Liquidez sucessória', 'Planejar recursos para tributos e custos: seguro de vida, previdência ou reserva específica na holding.'],
    p3: ['Governança patrimonial', 'Patrimônios desse porte se beneficiam de holding com governança, conselho de família e revisão anual.'],
    p4: ['Family office e estrutura multijurisdicional', 'Avaliar governança de family office e integração das estruturas no Brasil e no exterior.'],
  };
  const answers = [];
  let step = 0;
  const quiz = $('#quiz');
  function renderQuiz() {
    if (step >= QUIZ.length) return renderResult();
    const it = QUIZ[step];
    quiz.innerHTML = `
      <div class="q-progress"><i style="width:${(step / QUIZ.length) * 100}%"></i></div>
      <span class="q-count">Pergunta ${step + 1} de ${QUIZ.length}</span>
      <h3 class="q-title">${it.q}</h3>
      <div class="q-opts">${it.o.map((o, i) => `<button data-i="${i}">${o[0]}</button>`).join('')}</div>
      <div class="q-nav">${step ? '<button data-back>← Voltar</button>' : ''}</div>`;
  }
  quiz.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-back')) { step--; answers.pop(); return renderQuiz(); }
    if (b.hasAttribute('data-restart')) { step = 0; answers.length = 0; return renderQuiz(); }
    if (b.dataset.i != null) { answers[step] = QUIZ[step].o[+b.dataset.i]; step++; renderQuiz(); }
  });
  function renderResult() {
    const max = QUIZ.slice(1).reduce((s, q) => s + Math.max(...q.o.map((o) => o[1])), 0);
    const pts = answers.slice(1).reduce((s, a) => s + a[1], 0);
    const score = Math.round((pts / max) * 100);
    const [label, color, text] = score < 30 ? ['Exposição baixa', '#4ade80', 'Sua situação parece organizada. Uma revisão periódica ajuda a manter a estrutura alinhada às mudanças legais e familiares.']
      : score < 60 ? ['Exposição moderada', '#d4af6a', 'Há pontos de atenção que podem gerar custos e conflitos evitáveis. Um planejamento preventivo tende a ser mais simples agora.']
        : ['Exposição elevada', '#f87171', 'Seu patrimônio está exposto a riscos relevantes. Recomendamos uma análise detalhada com prioridade.'];
    const flags = answers.map((a) => a[2]).filter(Boolean);
    const recs = flags.map((f) => RECS[f]).filter(Boolean);
    if (!recs.length) recs.push(['Revisão periódica', 'Agende uma revisão anual da estrutura patrimonial e sucessória.']);
    quiz.innerHTML = `
      <div class="result">
        <div class="score-ring" style="--p:${score};--c:${color}"><div><span><b>${score}</b><small>índice de<br>exposição</small></span></div></div>
        <div>
          <h3 style="color:${color}">${label}</h3>
          <p>${text}</p>
          <ul>${recs.map(([t, d]) => `<li><b>${t}:</b> ${d}</li>`).join('')}</ul>
          <div class="hero-cta" style="margin-top:20px">
            <a href="#contato" class="btn btn-gold" id="quizCta">Falar com um especialista</a>
            <button class="btn btn-line" data-restart>Refazer diagnóstico</button>
          </div>
          <p class="disclaimer">Resultado indicativo, gerado localmente no seu navegador, que não substitui consulta jurídica.</p>
        </div>
      </div>`;
    $('#quizCta').addEventListener('click', () => {
      const f = $('#contactForm');
      f.assunto.value = flags.some((x) => x.startsWith('off')) ? 'Estruturação offshore' : flags.includes('semsuc') ? 'Planejamento sucessório' : 'Proteção patrimonial';
      if (!f.msg.value) f.msg.value = `Fiz o diagnóstico patrimonial no site (índice ${score}/100 — ${label}). Gostaria de conversar sobre: ${recs.map((r) => r[0]).join(', ')}.`;
    });
  }
  renderQuiz();

  // ---------- simulador inventário × holding ----------
  const suc = $('#sucForm');
  function runSuc() {
    const P = num(suc.pat.value) || 0, it = +suc.itcmd.value / 100, hon = (num(suc.hon.value) || 0) / 100, cus = (num(suc.cus.value) || 0) / 100;
    const impl = (num(suc.impl.value) || 0) / 100, dur = Math.max(0, parseInt(suc.dur.value, 10) || 0), doa = suc.doacao.checked;
    const inv = { itcmd: P * it, hon: P * hon, cus: P * cus }; inv.total = inv.itcmd + inv.hon + inv.cus;
    const hol = { itcmd: P * it, impl: P * impl, hon: doa ? 0 : P * hon * .5, cus: doa ? 0 : P * cus * .5 }; hol.total = hol.itcmd + hol.impl + hol.hon + hol.cus;
    const save = inv.total - hol.total, max = Math.max(inv.total, hol.total) || 1;
    const bar = (l, v, alt) => `<div class="bar"><span>${l}</span><i class="${alt ? 'alt' : ''}" style="width:${(v / max) * 100}%"></i><b>${brl(v)}</b></div>`;
    $('#sucOut').innerHTML = `
      <div class="compare">
        <div class="${save < 0 ? 'best' : ''}"><small>Inventário</small><b>${brl(inv.total)}</b><span>${((inv.total / (P || 1)) * 100).toFixed(1)}% do patrimônio · ~${dur} meses</span></div>
        <div class="${save >= 0 ? 'best' : ''}"><small>Holding${doa ? ' + doação' : ''}</small><b>${brl(hol.total)}</b><span>${((hol.total / (P || 1)) * 100).toFixed(1)}% do patrimônio · ${doa ? 'sucessão já organizada' : 'quotas ainda inventariadas'}</span></div>
      </div>
      <div class="bars">
        ${bar('ITCMD (inventário)', inv.itcmd)}${bar('Honorários + custas', inv.hon + inv.cus)}
        ${bar('ITCMD (holding)', hol.itcmd, 1)}${bar('Implementação' + (doa ? '' : ' + inv. quotas'), hol.impl + hol.hon + hol.cus, 1)}
      </div>
      <div class="saving">${save >= 0 ? 'Economia estimada: ' + brl(save) : 'Neste cenário, o inventário custa ' + brl(-save) + ' a menos'}</div>
      <p class="disclaimer">${doa ? 'Com a doação de quotas em vida, evita-se o inventário desses bens e o tempo em que o patrimônio fica bloqueado. ' : 'Sem doação em vida, a holding organiza a gestão, mas as quotas ainda serão inventariadas (estimado aqui com metade dos honorários e custas). '}Além do custo, considere o tempo de bloqueio dos bens, a governança e a redução de conflitos.</p>`;
  }
  suc.addEventListener('input', runSuc); runSuc();

  // ---------- simulador offshore ----------
  const off = $('#offForm');
  function runOff() {
    const L = num(off.lucro.value) || 0, fx = num(off.fx.value) || 0, ext = num(off.ext.value) || 0;
    const base = L * fx, gross = base * .15, credit = Math.min(ext * fx, gross), due = off.reg.value === 'tp' ? Math.max(0, gross - credit) : 0;
    $('#offOut').innerHTML = `
      <div class="lines">
        <div><span>Lucro convertido em reais</span><b>${brl(base)}</b></div>
        <div><span>Alíquota (Lei 14.754/2023)</span><b>15%</b></div>
        <div><span>Imposto bruto</span><b>${brl(gross)}</b></div>
        <div><span>Dedução do imposto pago no exterior (limitada)</span><b>− ${brl(credit)}</b></div>
        <div class="total"><span>${off.reg.value === 'tp' ? 'IRPF devido no ano (31/12)' : 'IRPF devido no ano'}</span><b>${brl(due)}</b></div>
      </div>
      <p class="disclaimer">${off.reg.value === 'tp'
        ? 'Controladas em jurisdição de tributação favorecida, regime fiscal privilegiado ou com renda ativa própria inferior a 60% têm o lucro tributado anualmente, mesmo sem distribuição.'
        : 'Controladas com renda ativa própria igual ou superior a 60%, fora de jurisdições de tributação favorecida ou regimes privilegiados, têm a tributação diferida até a distribuição dos lucros à pessoa física — quando incidem 15%.'}</p>`;
  }
  off.addEventListener('input', runOff); runOff();

  // ---------- FAQ ----------
  const FAQ = [
    ['Proteção patrimonial é legal?', 'Sim, quando feita de forma preventiva, transparente e com propósito legítimo: organizar a gestão, segregar riscos de atividades e planejar a sucessão. O que a lei não admite é a ocultação de bens ou a transferência para frustrar credores já existentes, o que pode configurar fraude contra credores ou fraude à execução.'],
    ['O que é uma holding familiar?', 'É uma sociedade criada para concentrar e administrar bens da família — imóveis, participações e investimentos. Ela facilita a gestão, permite regras de governança entre os familiares e viabiliza a sucessão por meio da doação de quotas, frequentemente com reserva de usufruto.'],
    ['A holding protege contra qualquer dívida?', 'Não. A estrutura societária não é uma blindagem absoluta: em casos de abuso, confusão patrimonial ou desvio de finalidade, a Justiça pode desconsiderar a personalidade jurídica (art. 50 do Código Civil). Por isso, a proteção depende de planejamento antecipado, substância e boa governança.'],
    ['Ter uma offshore é ilegal?', 'Não. Brasileiros podem manter sociedades, contas e investimentos no exterior, desde que declarem os bens à Receita Federal, prestem a declaração ao Banco Central quando exigida e recolham os tributos devidos.'],
    ['Como funciona a tributação de offshores desde 2024?', 'Com a Lei 14.754/2023, os lucros de entidades controladas no exterior por pessoas físicas residentes no Brasil passaram, conforme o enquadramento, a ser tributados anualmente a 15%, independentemente de distribuição. A lei também disciplinou a tributação de trusts e de aplicações financeiras no exterior.'],
    ['Trusts são reconhecidos no Brasil?', 'O Brasil não tem legislação civil própria sobre trusts, mas a Lei 14.754/2023 estabeleceu o tratamento tributário: em regra, os bens e direitos permanecem atribuídos ao instituidor enquanto ele viver, e há regras específicas para a transmissão aos beneficiários.'],
    ['Quanto tempo leva para estruturar uma holding?', 'Depende da quantidade e da natureza dos bens. Em casos usuais, a constituição, a integralização de imóveis e os registros levam de algumas semanas a poucos meses; o diagnóstico inicial define o cronograma.'],
  ];
  $('#faq').innerHTML = FAQ.map(([q, a]) => `<details class="reveal"><summary>${q}</summary><p>${a}</p></details>`).join('');

  // ---------- contato ----------
  $('#contactInfo').innerHTML = [
    ['✉', `<a href="mailto:${esc(CFG.email || '')}">${esc(CFG.email || '')}</a>`],
    CFG.whatsapp ? ['☏', `<a href="https://wa.me/${esc(CFG.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`] : null,
    CFG.cidade ? ['⌖', esc(CFG.cidade)] : null,
    CFG.horario ? ['◷', esc(CFG.horario)] : null,
  ].filter(Boolean).map(([i, t]) => `<li><span>${i}</span><span>${t}</span></li>`).join('');
  const form = $('#contactForm');
  let via = 'email';
  $$('button[type="submit"]', form).forEach((b) => b.addEventListener('click', () => (via = b.dataset.via)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const body = `Nome: ${d.nome}\nE-mail: ${d.email}\nTelefone: ${d.tel || '-'}\nAssunto: ${d.assunto}\n\n${d.msg}`;
    if (via === 'wa' && CFG.whatsapp) window.open(`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
    else location.href = `mailto:${CFG.email}?subject=${encodeURIComponent('[Gooners Law] ' + d.assunto)}&body=${encodeURIComponent(body)}`;
    $('#formMsg').textContent = via === 'wa' && !CFG.whatsapp ? 'WhatsApp ainda não configurado — abrimos seu e-mail com a mensagem pronta.' : 'Mensagem preparada! Conclua o envio no aplicativo aberto.';
  });

  // ---------- animação ao rolar ----------
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .12 }) : null;
  $$('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 6) * 60 + 'ms'; io ? io.observe(el) : el.classList.add('in'); });
})();
