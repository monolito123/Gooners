/* ==========================================================
   Gooners Law — interações (todas as páginas)
   ========================================================== */
(function () {
  'use strict';
  const CFG = window.LAW_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const H = document.body.dataset.h || '../';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n) => `<svg class="ic" aria-hidden="true"><use href="${H}assets/icons.svg#i-${n}"/></svg>`;
  const num = (v) => { const s = String(v).trim().replace(/\s|R\$|US\$/g, ''); return s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(/\.(?=\d{3}(\D|$))/g, '')); };
  const brl = (n) => (isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const store = {
    get(k, d) { try { const v = localStorage.getItem('gooners-law:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('gooners-law:' + k, JSON.stringify(v)); } catch { /* indisponível */ } },
  };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Link copiado'); } catch { prompt('Copie o link:', text); } }
  async function share(title, url) { if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(url); }
  const wa = (text) => `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(text)}`;
  const waBtn = (label, text) => `<a class="btn btn-wa sm" href="${esc(wa(text))}" target="_blank" rel="noopener">${ic('message-circle')}${label}</a>`;
  window.LawUI = { toast, esc, store, share, ic, wa };
  // Botões de copiar (telefone, e-mail, mensagens)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copiado: ' + b.dataset.copy.slice(0, 40)); } catch { prompt('Copie:', b.dataset.copy); }
  });

  // ---------- navegação ----------
  const nav = $('#nav'), toTop = $('#toTop');
  addEventListener('scroll', () => { nav.classList.toggle('scrolled', scrollY > 10); toTop.classList.toggle('show', scrollY > 900); }, { passive: true });
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  const menuBtn = $('#menuBtn'), links = $('#links');
  const setMenu = (o) => { links.classList.toggle('open', o); menuBtn.setAttribute('aria-expanded', String(o)); };
  menuBtn.addEventListener('click', () => setMenu(!links.classList.contains('open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  $$('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

  // ---------- áreas ----------
  $$('.area-more').forEach((b) => b.addEventListener('click', () => {
    const ul = b.nextElementSibling, open = ul.hidden;
    ul.hidden = !open; b.setAttribute('aria-expanded', String(open));
    b.firstChild.textContent = open ? 'Recolher ' : 'Ver detalhes ';
  }));

  // ---------- jurisdições: filtro e comparação ----------
  const jurData = $('#jurData');
  if (jurData) {
    const { JUR, GOALS } = JSON.parse(jurData.textContent);
    const filters = $('#jurFilters');
    filters.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $$('button', filters).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $$('.jur').forEach((j) => (j.hidden = b.dataset.g !== 'all' && !j.dataset.g.split(' ').includes(b.dataset.g)));
    });
    const bar = $('#compareBar'), table = $('#compareTable');
    const selected = () => $$('.jur input:checked').map((i) => i.value);
    $('#jurGrid').addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
      if (selected().length > 3) { cb.checked = false; toast('Compare até 3 jurisdições por vez'); }
      cb.closest('.jur').classList.toggle('selected', cb.checked);
      const n = selected().length;
      bar.hidden = !n; $('#compareInfo').textContent = n === 1 ? '1 jurisdição selecionada. Escolha mais uma.' : `${n} jurisdições selecionadas`;
      $('#compareBtn').disabled = n < 2;
    });
    $('#compareBtn').addEventListener('click', () => {
      const js = selected().map((id) => JUR.find((j) => j.id === id));
      const row = (label, f) => `<tr><th scope="row">${label}</th>${js.map((j) => `<td>${f(j)}</td>`).join('')}</tr>`;
      table.innerHTML = `<table><thead><tr><th></th>${js.map((j) => `<th scope="col">${j.f} ${esc(j.n)}</th>`).join('')}</tr></thead><tbody>
        ${row('Sistema jurídico', (j) => j.sys)}${row('Veículos usuais', (j) => j.v)}${row('Participa do CRS', (j) => j.crs)}
        ${row('Objetivos', (j) => j.g.map((g) => GOALS[g]).join(', '))}${row('Perfil', (j) => j.d)}${row('Pontos de atenção', (j) => j.warn.length ? j.warn.join('; ') : 'Verificar o regime específico aplicável')}</tbody></table>`;
      table.hidden = false; table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('#compareClear').addEventListener('click', () => { $$('.jur input:checked').forEach((i) => { i.checked = false; i.closest('.jur').classList.remove('selected'); }); bar.hidden = true; table.hidden = true; });
  }

  // ---------- abas dos simuladores ----------
  const tabs = $('.sim-tabs');
  if (tabs) {
    const select = (id, focus) => {
      $$('button', tabs).forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== id));
    };
    tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(b.dataset.tab); });
    tabs.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      const bs = $$('button', tabs), i = bs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      select(bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length].dataset.tab, true);
    });
    const fromHash = () => { const id = location.hash.slice(1); if ($(`[data-panel="${id}"]`)) { select(id); setTimeout(() => $('#simuladores').scrollIntoView(), 0); } };
    addEventListener('hashchange', fromHash); fromHash();
  }

  // ---------- diagnóstico ----------
  const quiz = $('#quiz');
  if (quiz) {
    const QUIZ = [
      { q: 'Qual é, aproximadamente, o seu patrimônio total?', o: [['Até R$ 1 milhão', 0, 'p1'], ['De R$ 1 a 5 milhões', 1, 'p2'], ['De R$ 5 a 30 milhões', 2, 'p3'], ['Acima de R$ 30 milhões', 3, 'p4']] },
      { q: 'Qual é a sua principal atividade profissional?', o: [['Empregado(a) ou servidor(a)', 0], ['Profissional liberal', 2, 'liberal'], ['Empresário(a) / sócio(a) administrador(a)', 3, 'emp'], ['Investidor(a) / rentista', 1]] },
      { q: 'Em nome de quem estão os seus principais bens?', o: [['Praticamente tudo em meu nome (pessoa física)', 3, 'pf'], ['Parte em pessoa física, parte em empresas', 1], ['Já tenho holding patrimonial estruturada', 0]] },
      { q: 'Como é a sua estrutura familiar?', o: [['Não tenho herdeiros necessários', 0], ['Filhos de uma mesma união', 1], ['Família recomposta / filhos de uniões diferentes', 3, 'recomp'], ['Herdeiros menores de idade ou incapazes', 2, 'menores']] },
      { q: 'Você já tem algum planejamento sucessório?', o: [['Nenhum', 3, 'semsuc'], ['Apenas testamento ou previdência privada', 1], ['Sim, com holding e/ou doações em vida', 0]] },
      { q: 'Possui ou pretende ter ativos no exterior?', o: [['Não', 0], ['Sim, tudo declarado e organizado', 1, 'offok'], ['Sim, mas não tenho certeza se está regular', 3, 'offirreg'], ['Pretendo ter em breve', 1, 'offplan']] },
      { q: 'Qual é a sua exposição a riscos e litígios?', o: [['Baixa', 0], ['Média: sou avalista/fiador ou tenho garantias pessoais', 2, 'aval'], ['Alta: atividade com passivos trabalhistas, fiscais ou regulatórios', 3, 'litig']] },
      { q: 'Seus herdeiros teriam liquidez para pagar ITCMD e os custos de um inventário?', o: [['Sim, com folga', 0], ['Em parte', 1], ['Não: o patrimônio é majoritariamente imobilizado', 3, 'iliq']] },
    ];
    const RECS = {
      pf: ['Segregação patrimonial', 'Avaliar a transferência de bens da pessoa física para uma estrutura societária adequada, com análise de ITBI, IR e ganho de capital.'],
      emp: ['Separação entre operação e patrimônio', 'Evitar que bens familiares fiquem expostos aos riscos da empresa operacional; revisar contrato social e acordo de sócios.'],
      liberal: ['Proteção da atividade profissional', 'Avaliar sociedade profissional, seguros de responsabilidade civil e segregação de bens pessoais.'],
      semsuc: ['Planejamento sucessório', 'Definir como o patrimônio será transmitido: doações com reserva de usufruto, testamento, previdência e cláusulas restritivas.'],
      recomp: ['Prevenção de conflitos familiares', 'Famílias recompostas pedem regras claras: protocolo familiar, testamento e acordo de sócios na holding.'],
      menores: ['Proteção de herdeiros menores', 'Prever a administração dos bens, a tutela testamentária e cláusulas de inalienabilidade temporária.'],
      offirreg: ['Regularização de ativos no exterior', 'Prioridade: revisar declarações (DAA, CBE) e o enquadramento na Lei 14.754/2023 antes de qualquer nova estrutura.'],
      offplan: ['Desenho da estrutura internacional', 'Comparar jurisdições, veículos e custos de manutenção antes de abrir contas ou sociedades no exterior.'],
      offok: ['Sucessão dos ativos no exterior', 'Verificar como esses ativos serão transmitidos (probate, estate tax, trust) e a tributação anual.'],
      aval: ['Revisão de garantias pessoais', 'Mapear avais e fianças concedidos e negociar a substituição por garantias reais ou corporativas.'],
      litig: ['Gestão de riscos e passivos', 'Medidas preventivas e de compliance. Atenção: transferências após dívidas constituídas podem configurar fraude contra credores ou fraude à execução.'],
      iliq: ['Liquidez sucessória', 'Planejar recursos para tributos e custos: seguro de vida, previdência ou reserva específica na holding.'],
      p3: ['Governança patrimonial', 'Patrimônios desse porte se beneficiam de holding com governança, conselho de família e revisão anual.'],
      p4: ['Family office e estrutura multijurisdicional', 'Avaliar a governança de family office e a integração das estruturas no Brasil e no exterior.'],
    };
    const answers = []; let step = 0;
    const render = () => {
      if (step >= QUIZ.length) return result();
      const it = QUIZ[step];
      quiz.innerHTML = `<div class="q-progress"><i style="width:${(step / QUIZ.length) * 100}%"></i></div><span class="q-count">Pergunta ${step + 1} de ${QUIZ.length}</span>
        <h3 class="q-title">${it.q}</h3><div class="q-opts">${it.o.map((o, i) => `<button data-i="${i}">${o[0]}</button>`).join('')}</div><div class="q-nav">${step ? '<button data-back>← Voltar</button>' : ''}</div>`;
    };
    quiz.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-back')) { step--; answers.pop(); return render(); }
      if (b.hasAttribute('data-restart')) { step = 0; answers.length = 0; return render(); }
      if (b.dataset.i != null) { answers[step] = QUIZ[step].o[+b.dataset.i]; step++; render(); quiz.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    function result() {
      const max = QUIZ.slice(1).reduce((s, q) => s + Math.max(...q.o.map((o) => o[1])), 0);
      const score = Math.round((answers.slice(1).reduce((s, a) => s + a[1], 0) / max) * 100);
      const [label, color, text] = score < 30 ? ['Exposição baixa', '#15803d', 'Sua situação parece organizada. Uma revisão periódica ajuda a manter a estrutura alinhada às mudanças legais e familiares.']
        : score < 60 ? ['Exposição moderada', '#b88c3e', 'Há pontos de atenção que podem gerar custos e conflitos evitáveis. Um planejamento preventivo tende a ser mais simples agora.']
          : ['Exposição elevada', '#b42318', 'Seu patrimônio está exposto a riscos relevantes. Recomendamos uma análise detalhada com prioridade.'];
      const flags = answers.map((a) => a[2]).filter(Boolean);
      const recs = flags.map((f) => RECS[f]).filter(Boolean);
      if (!recs.length) recs.push(['Revisão periódica', 'Agende uma revisão anual da estrutura patrimonial e sucessória.']);
      store.set('diagnostico', { score, label, recs: recs.map((r) => r[0]), t: Date.now() });
      quiz.innerHTML = `<div class="result"><div class="score-ring" style="--p:${score};--c:${color}"><div><span><b>${score}</b><small>índice de<br>exposição</small></span></div></div>
        <div><h3 style="color:${color}">${label}</h3><p>${text}</p><ul>${recs.map(([t, d]) => `<li><b>${t}:</b> ${d}</li>`).join('')}</ul>
        <div class="hero-cta"><a href="#contato" class="btn btn-gold" id="quizCta">Falar com um especialista</a>${waBtn('Enviar resultado pelo WhatsApp', `Olá! Fiz o diagnóstico patrimonial no site da Gooners Law.\nÍndice de exposição: ${score}/100 (${label}).\nPontos de atenção: ${recs.map((r) => r[0]).join(', ')}.\nGostaria de conversar.`)}<button class="btn btn-line" data-restart>Refazer diagnóstico</button></div>
        <p class="disclaimer">Resultado indicativo, gerado no seu navegador, que não substitui uma consulta jurídica.</p></div></div>`;
      $('#quizCta').addEventListener('click', () => {
        const f = $('#contactForm'); if (!f) return;
        f.assunto.value = flags.some((x) => x.startsWith('off')) ? 'Estruturação offshore' : flags.includes('semsuc') ? 'Planejamento sucessório' : 'Proteção patrimonial';
        if (!f.msg.value) f.msg.value = `Fiz o diagnóstico patrimonial no site (índice ${score}/100, ${label}). Gostaria de conversar sobre: ${recs.map((r) => r[0]).join(', ')}.`;
      });
    }
    render();
  }

  // ---------- simulador inventário × holding ----------
  const suc = $('#sucForm');
  if (suc) {
    const run = () => {
      const P = num(suc.pat.value) || 0, it = +suc.itcmd.value / 100, hon = (num(suc.hon.value) || 0) / 100, cus = (num(suc.cus.value) || 0) / 100;
      const impl = (num(suc.impl.value) || 0) / 100, dur = Math.max(0, parseInt(suc.dur.value, 10) || 0), doa = suc.doacao.checked;
      const inv = { itcmd: P * it, hon: P * hon, cus: P * cus }; inv.total = inv.itcmd + inv.hon + inv.cus;
      const hol = { itcmd: P * it, impl: P * impl, rest: doa ? 0 : P * (hon + cus) * .5 }; hol.total = hol.itcmd + hol.impl + hol.rest;
      const save = inv.total - hol.total, max = Math.max(inv.total, hol.total) || 1, pct = (v) => ((v / (P || 1)) * 100).toFixed(1) + '%';
      const bar = (l, v, alt) => `<div class="bar"><span>${l}</span><i class="${alt ? 'alt' : ''}" style="width:${(v / max) * 100}%"></i><b>${brl(v)}</b></div>`;
      $('#sucOut').innerHTML = `<div class="compare"><div class="${save < 0 ? 'best' : ''}"><small>Inventário</small><b>${brl(inv.total)}</b><span>${pct(inv.total)} do patrimônio · cerca de ${dur} meses</span></div>
        <div class="${save >= 0 ? 'best' : ''}"><small>Holding${doa ? ' + doação' : ''}</small><b>${brl(hol.total)}</b><span>${pct(hol.total)} do patrimônio · ${doa ? 'sucessão já organizada' : 'quotas ainda inventariadas'}</span></div></div>
        <div class="bars">${bar('ITCMD (inventário)', inv.itcmd)}${bar('Honorários + custas', inv.hon + inv.cus)}${bar('ITCMD (holding)', hol.itcmd, 1)}${bar('Implementação' + (doa ? '' : ' + quotas'), hol.impl + hol.rest, 1)}</div>
        <div class="saving">${save >= 0 ? 'Economia estimada: ' + brl(save) : 'Neste cenário, o inventário custa ' + brl(-save) + ' a menos'}</div>
        <p class="disclaimer">${doa ? 'Com a doação de quotas em vida, evita-se o inventário desses bens e o período em que o patrimônio fica bloqueado.' : 'Sem doação em vida, a holding organiza a gestão, mas as quotas ainda serão inventariadas (estimado aqui com metade dos honorários e das custas).'} Considere também a governança e a redução de conflitos.</p>
        <div class="sim-actions">${waBtn('Discutir esta simulação no WhatsApp', `Olá! Simulei no site da Gooners Law um patrimônio de ${brl(P)} (ITCMD ${(it * 100).toFixed(0)}%).\nInventário estimado: ${brl(inv.total)} · Holding${doa ? ' + doação' : ''}: ${brl(hol.total)}.\nGostaria de avaliar o meu caso.`)}</div>`;
    };
    suc.addEventListener('input', run); run();
  }

  // ---------- simulador offshore ----------
  const off = $('#offForm');
  if (off) {
    const run = () => {
      const fx = num(off.fx.value) || 0, ext = (num(off.ext.value) || 0) * fx, annual = off.reg.value === 'tp';
      const base = (annual ? num(off.lucro.value) : num(off.dist.value)) * fx || 0;
      const gross = base * .15, credit = Math.min(ext, gross), due = Math.max(0, gross - credit);
      off.dist.closest('label').hidden = annual;
      $('#offOut').innerHTML = `<div class="lines">
        <div><span>${annual ? 'Lucro apurado em 31/12' : 'Lucro distribuído'} (em reais)</span><b>${brl(base)}</b></div>
        <div><span>Alíquota (Lei 14.754/2023)</span><b>15%</b></div><div><span>Imposto bruto</span><b>${brl(gross)}</b></div>
        <div><span>Dedução do imposto pago no exterior (limitada)</span><b>− ${brl(credit)}</b></div>
        <div class="total"><span>IRPF devido no ano</span><b>${brl(due)}</b></div></div>
        <p class="disclaimer">${annual ? 'Nesse enquadramento, o lucro é tributado anualmente, mesmo sem distribuição.' : 'Com renda ativa própria de pelo menos 60%, fora de jurisdições favorecidas e regimes privilegiados, a tributação ocorre na distribuição do lucro à pessoa física.'}</p>
        <div class="sim-actions">${waBtn('Revisar minha estrutura offshore', `Olá! Simulei no site da Gooners Law a tributação de uma offshore (Lei 14.754/2023): IRPF estimado de ${brl(due)} no ano. Gostaria de revisar a minha estrutura.`)}</div>`;
    };
    off.addEventListener('input', run); run();
  }

  // ---------- checklist ----------
  const ck = $('#ckList');
  if (ck) {
    const state = store.get('checklist', {});
    const boxes = $$('input[data-k]', ck);
    const sync = () => { const n = boxes.filter((b) => b.checked).length, p = Math.round((n / boxes.length) * 100); $('#ckPct').textContent = p + '%'; $('#ckBar').style.width = p + '%'; };
    boxes.forEach((b) => { b.checked = !!state[b.dataset.k]; b.addEventListener('change', () => { state[b.dataset.k] = b.checked; store.set('checklist', state); sync(); }); });
    $('#ckReset').addEventListener('click', () => { boxes.forEach((b) => (b.checked = false)); store.set('checklist', {}); sync(); });
    $('#ckSend').addEventListener('click', () => {
      const have = boxes.filter((b) => b.checked).map((b) => '✔ ' + b.nextElementSibling.textContent), miss = boxes.filter((b) => !b.checked).map((b) => '• ' + b.nextElementSibling.textContent);
      window.open(wa(`Olá! Estou organizando a documentação para uma holding familiar (${Math.round((have.length / boxes.length) * 100)}% pronta).\n\nJá tenho:\n${have.join('\n') || '—'}\n\nAinda falta:\n${miss.join('\n') || '—'}`), '_blank', 'noopener');
    });
    $('#ckPrint').addEventListener('click', () => { document.body.classList.add('print-checklist'); print(); setTimeout(() => document.body.classList.remove('print-checklist'), 500); });
    sync();
  }

  // ---------- contato e agendamento ----------
  const form = $('#contactForm');
  if (form) {
    // Próximo dia útil como sugestão; fins de semana não são aceitos
    const d = new Date(); do d.setDate(d.getDate() + 1); while (d.getDay() % 6 === 0);
    const iso = (x) => new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    form.data.min = iso(new Date(Date.now() + 864e5)); form.data.value = iso(d);
    const msg = $('#formMsg');
    const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', !!err); };
    form.data.addEventListener('change', () => { const x = new Date(form.data.value + 'T12:00'); if (x.getDay() % 6 === 0) say('Atendemos de segunda a sexta. Escolha um dia útil.', true); else say(''); });
    const data = () => Object.fromEntries(new FormData(form));
    const dateLabel = (v) => new Date(v.data + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    const valid = () => {
      if (!form.checkValidity()) { const bad = $$(':invalid', form)[0]; say(bad && bad.name === 'lgpd' ? 'Para continuar, aceite o tratamento dos dados (LGPD).' : 'Preencha nome, e-mail válido, data e mensagem.', true); bad?.focus(); return false; }
      if (new Date(form.data.value + 'T12:00').getDay() % 6 === 0) { say('Escolha um dia útil (segunda a sexta).', true); return false; }
      return true;
    };
    let via = 'email';
    $$('button[type="submit"]', form).forEach((b) => b.addEventListener('click', () => (via = b.dataset.via)));
    form.addEventListener('submit', (e) => {
      e.preventDefault(); if (!valid()) return;
      const v = data();
      const body = `Nome: ${v.nome}\nE-mail: ${v.email}\nTelefone: ${v.tel || '-'}\nAssunto: ${v.assunto}\nPreferência: ${dateLabel(v)}, às ${v.hora} (${v.modo})\n\n${v.msg}`;
      if (via === 'wa') window.open(wa(body), '_blank', 'noopener');
      else location.href = `mailto:${CFG.email}?subject=${encodeURIComponent('[Gooners Law] ' + v.assunto + ' — agendamento')}&body=${encodeURIComponent(body)}`;
      say(via === 'wa' ? `Mensagem pronta no WhatsApp ${CFG.telefone}. Conclua o envio no aplicativo.` : `E-mail pronto para ${CFG.email}. Conclua o envio no seu aplicativo de e-mail.`);
      const fb = $('#formFallback'); fb.hidden = false; $('#fbText').value = body; $('#fbCopy').dataset.copy = body;
    });
    $('#icsBtn').addEventListener('click', () => {
      if (!valid()) return;
      const v = data(), [hh, mm] = v.hora.split(':'), start = v.data.replace(/-/g, '') + 'T' + hh + mm + '00', end = v.data.replace(/-/g, '') + 'T' + String(+hh + 1).padStart(2, '0') + mm + '00';
      const escI = (s) => String(s).replace(/[\\,;]/g, '\\$&').replace(/\n/g, '\\n');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gooners Law//Agendamento//PT', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${Date.now()}@gooners.law`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;TZID=America/Sao_Paulo:${start}`, `DTEND;TZID=America/Sao_Paulo:${end}`,
        `SUMMARY:${escI('Consulta Gooners Law — ' + v.assunto)}`, `DESCRIPTION:${escI(`${v.modo}. Horário solicitado, sujeito a confirmação.\n\n${v.msg}`)}`, 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Consulta Gooners Law', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'consulta-gooners-law.ics'; a.click();
      say('Evento salvo. Lembre-se de enviar a solicitação para confirmarmos o horário.');
    });
  }

  // ---------- glossário ----------
  const gl = $('#glSearch');
  if (gl) {
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    gl.addEventListener('input', () => {
      const q = norm(gl.value.trim()); let n = 0;
      $$('#glossary section').forEach((sec) => {
        let k = 0;
        $$('.term', sec).forEach((t) => { const ok = !q || norm(t.textContent).includes(q); t.hidden = !ok; if (ok) k++; });
        sec.hidden = !k; n += k;
      });
      $('#glEmpty').hidden = n > 0;
    });
  }

  // ---------- artigo: progresso de leitura, sumário e compartilhamento ----------
  const prose = $('.prose');
  if (prose) {
    const bar = $('#readBar'), tocLinks = $$('.toc a');
    addEventListener('scroll', () => {
      const r = prose.getBoundingClientRect(), total = r.height - innerHeight * .6;
      bar.style.width = Math.max(0, Math.min(100, (-r.top / Math.max(1, total)) * 100)) + '%';
      let cur = null; $$('.prose section').forEach((s) => { if (s.getBoundingClientRect().top < 160) cur = s.id; });
      tocLinks.forEach((a) => a.classList.toggle('active', a.hash === '#' + cur));
    }, { passive: true });
    $('#shareArticle')?.addEventListener('click', () => share(document.title, location.href.split('#')[0]));
  }

  // ---------- animação ao rolar ----------
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .1 }) : null;
  $$('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 6) * 50 + 'ms'; io ? io.observe(el) : el.classList.add('in'); });
})();
