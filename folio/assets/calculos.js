/* Fólio — prazos processuais, dosimetria e prescrição, valores e datas por extenso. */
(function () {
  'use strict';
  const F = window.Folio;
  const { h } = F;

  // ======================================================================
  // Datas (sempre 'AAAA-MM-DD', aritmética em UTC)
  // ======================================================================
  const D = {
    parse: (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    str: (dt) => dt.toISOString().slice(0, 10),
    add: (s, n) => { const dt = D.parse(s); dt.setUTCDate(dt.getUTCDate() + n); return D.str(dt); },
    addMonths: (s, n) => { const dt = D.parse(s); const day = dt.getUTCDate(); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + n); const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate(); dt.setUTCDate(Math.min(day, last)); return D.str(dt); },
    dow: (s) => D.parse(s).getUTCDay(),
    br: (s) => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '',
    today: () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; },
    diff: (a, b) => Math.round((D.parse(b) - D.parse(a)) / 86400000),
  };
  F.D = D;
  const DOW = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const longDate = (s) => `${DOW[D.dow(s)]}, ${D.br(s)}`;

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
    const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Calendário-padrão: feriados nacionais, do DF e dias sem expediente forense (Lei 5.010/1966, art. 62).
  // Tudo pode ser desligado ou complementado: a referência final é a portaria anual do tribunal.
  function defaultCalendar(y) {
    const e = easter(y);
    const L = (date, name, base, type = 'feriado') => ({ id: date + ':' + name, date, name, base, type });
    const list = [
      L(`${y}-01-01`, 'Confraternização Universal', 'Lei 662/1949'),
      L(D.add(e, -48), 'Carnaval (segunda-feira)', 'Lei 5.010/1966, art. 62, III'),
      L(D.add(e, -47), 'Carnaval (terça-feira)', 'Lei 5.010/1966, art. 62, III'),
      L(D.add(e, -46), 'Quarta-feira de Cinzas (expediente reduzido)', 'CPC, art. 224, § 1º', 'reduzido'),
      L(D.add(e, -4), 'Quarta-feira Santa', 'Lei 5.010/1966, art. 62, II'),
      L(D.add(e, -3), 'Quinta-feira Santa', 'Lei 5.010/1966, art. 62, II'),
      L(D.add(e, -2), 'Sexta-feira da Paixão', 'Lei 5.010/1966, art. 62, II'),
      L(`${y}-04-21`, 'Tiradentes e Fundação de Brasília', 'Lei 662/1949'),
      L(`${y}-05-01`, 'Dia do Trabalho', 'Lei 662/1949'),
      L(D.add(e, 60), 'Corpus Christi', 'calendário forense (confira a portaria)'),
      L(`${y}-08-11`, 'Dia do Advogado (instalação dos cursos jurídicos)', 'Lei 5.010/1966, art. 62, IV'),
      L(`${y}-09-07`, 'Independência do Brasil', 'Lei 662/1949'),
      L(`${y}-10-12`, 'Nossa Senhora Aparecida', 'Lei 6.802/1980'),
      L(`${y}-10-28`, 'Dia do Servidor Público (costuma ser transferido)', 'confira a portaria do ano'),
      L(`${y}-11-01`, 'Todos os Santos', 'Lei 5.010/1966, art. 62, IV'),
      L(`${y}-11-02`, 'Finados', 'Lei 662/1949'),
      L(`${y}-11-15`, 'Proclamação da República', 'Lei 662/1949'),
      L(`${y}-11-30`, 'Dia do Evangélico (DF)', 'Lei Distrital 963/1995'),
      L(`${y}-12-08`, 'Dia da Justiça', 'Lei 5.010/1966, art. 62, IV'),
      L(`${y}-12-25`, 'Natal', 'Lei 662/1949'),
    ];
    if (y >= 2024) list.push(L(`${y}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei 14.759/2023'));
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }
  const inRecesso = (s) => { const md = s.slice(5); return md >= '12-20' || md <= '01-06'; };
  const inSuspensao = (s) => { const md = s.slice(5); return md >= '12-20' || md <= '01-20'; };

  // Monta a função que descreve cada dia
  function makeCalendar({ disabled, custom, recesso }) {
    const cache = {};
    const yearMap = (y) => {
      if (cache[y]) return cache[y];
      const m = {};
      for (const it of defaultCalendar(y)) if (!disabled.has(it.id)) (m[it.date] = m[it.date] || []).push(it);
      for (const it of custom) if (it.date.startsWith(String(y))) (m[it.date] = m[it.date] || []).push(it);
      return (cache[y] = m);
    };
    return (s) => {
      const w = D.dow(s);
      const items = yearMap(+s.slice(0, 4))[s] || [];
      const hol = items.find((i) => i.type === 'feriado');
      const red = items.find((i) => i.type === 'reduzido');
      const rec = recesso && inRecesso(s);
      const weekend = w === 0 || w === 6;
      const business = !weekend && !hol && !rec;
      return { s, weekend, holiday: hol ? hol.name : rec ? 'Recesso forense (20/12 a 06/01)' : null, reduced: business && red ? red.name : null, business, susp: inSuspensao(s) };
    };
  }

  // Contagem
  const RULES = {
    cpc: { name: 'Cível (CPC): dias úteis', unit: 'uteis', susp: true, base: ['CPC, art. 219 (só dias úteis)', 'CPC, art. 224 (exclui o dia do começo e inclui o do vencimento)', 'CPC, art. 220 (suspensão de 20/12 a 20/01)'] },
    jec: { name: 'Juizado Especial Cível: dias úteis', unit: 'uteis', susp: true, base: ['Lei 9.099/1995, art. 12-A (dias úteis)', 'CPC, art. 220 (suspensão de 20/12 a 20/01)'] },
    cpp: { name: 'Penal (CPP): dias corridos', unit: 'corridos', firstBusiness: true, extend: true, susp: true, base: ['CPP, art. 798 (prazo contínuo; exclui o dia do começo)', 'Súmula 310 do STF (começa no primeiro dia útil)', 'CPP, art. 798, § 3º (vencimento em dia sem expediente é prorrogado)', 'CPP, art. 798-A (suspensão de 20/12 a 20/01)'] },
    corridos: { name: 'Dias corridos (outros prazos)', unit: 'corridos', firstBusiness: false, extend: true, susp: false, base: ['Contagem contínua a partir do dia seguinte ao marco'] },
  };
  const EVENTS = {
    dje: { name: 'Disponibilização no DJe', base: 'Lei 11.419/2006, art. 4º, §§ 3º e 4º; CPC, art. 224, §§ 2º e 3º' },
    ciencia: { name: 'Ciência da intimação no sistema (PJe)', base: 'Lei 11.419/2006, art. 5º, §§ 1º e 2º; CPC, art. 231, V' },
    tacita: { name: 'Envio da intimação eletrônica, sem consulta (ciência tácita em 10 dias)', base: 'Lei 11.419/2006, art. 5º, § 3º' },
    citacao: { name: 'Confirmação da citação por meio eletrônico', base: 'CPC, art. 231, IX (5º dia útil após a confirmação)' },
    juntada: { name: 'Juntada do mandado ou do AR cumprido', base: 'CPC, art. 231, I e II' },
    outro: { name: 'Outro marco (intimação pessoal, audiência…)', base: 'CPC, art. 224' },
  };

  function computeDeadline({ event, date, days, rule, susp, cal }) {
    const R = RULES[rule];
    const info = cal;
    const nextBusiness = (s) => { let d = s; do d = D.add(d, 1); while (!info(d).business); return d; };
    const steps = [{ d: date, label: EVENTS[event].name, kind: 'event' }];
    let start = date; // dia do começo (excluído)
    if (event === 'dje') {
      const pub = nextBusiness(date);
      steps.push({ d: pub, label: 'Publicação (1º dia útil após a disponibilização)', kind: 'pub' });
      start = pub;
    } else if (event === 'ciencia') {
      if (!info(date).business) { start = nextBusiness(date); steps.push({ d: start, label: 'Consulta em dia sem expediente: ciência no 1º dia útil seguinte', kind: 'pub' }); }
    } else if (event === 'tacita') {
      let t = D.add(date, 10);
      steps.push({ d: t, label: '10º dia corrido após o envio', kind: 'pub' });
      if (!info(t).business) { t = nextBusiness(t); steps.push({ d: t, label: 'Ciência tácita prorrogada para o 1º dia útil', kind: 'pub' }); }
      start = t;
    } else if (event === 'citacao') {
      let t = date;
      for (let k = 0; k < 5; k++) t = nextBusiness(t);
      steps.push({ d: t, label: '5º dia útil após a confirmação (dia do começo)', kind: 'pub' });
      start = t;
    }
    const log = [];
    let k = 0, d = start, first = null, guard = 0;
    while (k < days) {
      d = D.add(d, 1);
      if (++guard > 6000) throw new Error('Prazo longo demais para calcular.');
      const x = info(d);
      const suspended = susp && x.susp;
      let counts, why = '';
      if (R.unit === 'uteis') {
        counts = x.business && !suspended && !(k === 0 && x.reduced);
        why = suspended ? 'suspensão de prazos' : x.weekend ? (D.dow(d) === 0 ? 'domingo' : 'sábado') : x.holiday ? x.holiday : k === 0 && x.reduced ? x.reduced + ': começo protraído' : '';
      } else {
        counts = !suspended && (k > 0 || !R.firstBusiness || (x.business && !x.reduced));
        why = suspended ? 'suspensão de prazos' : !counts ? (x.weekend ? (D.dow(d) === 0 ? 'domingo' : 'sábado') : x.holiday || x.reduced || '') + ': o prazo começa no 1º dia útil' : (!x.business ? (x.holiday || (x.weekend ? 'fim de semana' : '')) : '');
      }
      if (counts) { k++; if (k === 1) first = d; log.push({ d, kind: 'count', n: k, why: x.reduced && R.unit === 'uteis' ? x.reduced : why }); }
      else log.push({ d, kind: suspended ? 'susp' : 'skip', why });
    }
    let end = d;
    const extendNeeded = (s) => { const x = info(s); return R.unit === 'uteis' ? !!x.reduced : (!x.business || !!x.reduced || (susp && x.susp)); };
    if (R.unit === 'uteis' || R.extend) {
      while (extendNeeded(end)) {
        const x = info(end);
        end = D.add(end, 1);
        log.push({ d: end, kind: 'ext', why: 'vencimento prorrogado (' + (x.reduced || x.holiday || (x.weekend ? 'fim de semana' : 'suspensão')) + ')' });
        if (++guard > 6000) break;
      }
    }
    return { steps, start, first, end, log, days };
  }
  F.computeDeadline = computeDeadline;
  F.makeCalendar = makeCalendar;

  // ======================================================================
  // Por extenso
  // ======================================================================
  const UN = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const fem = (w) => w.replace(/^um$/, 'uma').replace(/^dois$/, 'duas').replace(/entos$/, 'entas');
  function ate999(n, f) {
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100), r = n % 100, parts = [];
    if (c) parts.push(f ? fem(CEN[c]) : CEN[c]);
    if (r) {
      if (r < 20) parts.push(f ? fem(UN[r]) : UN[r]);
      else { const u = r % 10; parts.push(DEZ[Math.floor(r / 10)] + (u ? ' e ' + (f ? fem(UN[u]) : UN[u]) : '')); }
    }
    return parts.join(' e ');
  }
  const SCALE = [null, null, ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões'], ['quatrilhão', 'quatrilhões']];
  F.extenso = (n, f = false) => {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'zero';
    const groups = [];
    for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (!g) continue;
      const txt = i === 0 ? ate999(g, f) : i === 1 ? (g === 1 ? 'mil' : ate999(g, f) + ' mil') : ate999(g, false) + ' ' + SCALE[i][g === 1 ? 0 : 1];
      parts.push({ g, i, txt });
    }
    let out = '';
    parts.forEach((p, k) => {
      if (!k) { out = p.txt; return; }
      const last = k === parts.length - 1;
      out += last && (p.g < 100 || p.g % 100 === 0) ? ' e ' : parts[k - 1].i === 1 ? ' ' : ', ';
      out += p.txt;
    });
    return out;
  };
  F.parseValor = (s) => {
    let t = String(s).replace(/[^\d,.-]/g, '');
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return Number(t);
  };
  F.reais = (v) => {
    const cents = Math.round(Math.abs(v) * 100);
    const int = Math.floor(cents / 100), c = cents % 100;
    let s = '';
    if (int) s = F.extenso(int) + (int >= 1e6 && int % 1e6 === 0 ? ' de ' : ' ') + (int === 1 ? 'real' : 'reais');
    if (c) s += (int ? ' e ' : '') + F.extenso(c) + (c === 1 ? ' centavo' : ' centavos') + (int ? '' : ' de real');
    return s || 'zero real';
  };
  const fmtBRL = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  F.fmtBRL = fmtBRL;
  F.dataExtenso = (s, mode) => {
    const [y, m, d] = s.split('-').map(Number);
    if (mode === 'curta') return `${d === 1 ? '1º' : d} de ${MES[m - 1]} de ${y}`;
    const dia = d === 1 ? 'primeiro' : F.extenso(d);
    if (mode === 'certidao') return `${d === 1 ? 'ao primeiro dia' : 'aos ' + F.extenso(d) + ' dias'} do mês de ${MES[m - 1]} do ano de ${F.extenso(y)}`;
    return `${dia} de ${MES[m - 1]} de ${F.extenso(y)}`;
  };
  const caseOf = (s, mode) => mode === 'upper' ? s.toLocaleUpperCase('pt-BR') : mode === 'cap' ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s;

  // ======================================================================
  // Prazos processuais (UI)
  // ======================================================================
  F.register({
    id: 'prazos', group: 'calc', name: 'Prazos processuais', tag: 'CPC · CPP',
    keywords: 'prazo calculadora dias úteis corridos dje pje intimação tácita feriados recesso suspensão contagem vencimento certidão',
    desc: 'Calcula o vencimento a partir da disponibilização no DJe, da ciência no PJe, da intimação tácita ou de outro marco, com dias úteis (CPC e Juizados) ou corridos (CPP), feriados do DF, recesso e suspensão de fim de ano.',
    refs: ['CPC, art. 219 e 224', 'Lei 11.419/2006', 'CPP, art. 798'],
    render(root) {
      const S = F.store.get('prazos', {});
      const disabled = new Set(S.disabled || []);
      const rule = F.select(Object.entries(RULES).map(([k, r]) => [k, r.name]), S.rule || 'cpc', { id: 'prazo-rule' });
      const event = F.select(Object.entries(EVENTS).map(([k, r]) => [k, r.name]), S.event || 'dje', { id: 'prazo-event' });
      const date = F.input({ id: 'prazo-date', type: 'date', value: D.today() });
      const days = F.input({ id: 'prazo-days', type: 'number', min: 1, max: 3650, value: S.days || 15, style: 'max-width:110px' });
      const dobro = F.check('Prazo em dobro', false);
      const dobroWhy = F.select([['Fazenda Pública (CPC, art. 183)', 'Fazenda Pública (CPC, art. 183)'], ['Ministério Público (CPC, art. 180)', 'Ministério Público (CPC, art. 180)'], ['Defensoria Pública (CPC, art. 186)', 'Defensoria Pública (CPC, art. 186)'], ['Litisconsortes com advogados distintos, autos físicos (CPC, art. 229)', 'Litisconsortes, autos físicos (CPC, art. 229)']], null, { id: 'prazo-dobro' });
      const susp = F.check('Aplicar a suspensão de 20/12 a 20/01', true);
      const excecao = F.check('Réu preso, Lei Maria da Penha ou medida urgente', false, 'CPP, art. 798-A: não há suspensão nesses casos.');
      const recesso = F.check('Recesso forense de 20/12 a 06/01 sem expediente', S.recesso !== false, 'Lei 5.010/1966, art. 62, I.');
      const what = F.input({ id: 'prazo-what', placeholder: 'ex.: apresentar contestação', value: S.what || '' });
      const customTa = F.textarea({ id: 'prazo-custom', class: 'textarea', style: 'min-height:90px', placeholder: '10/03/2027 Ponto facultativo\n15/04/2027 a 16/04/2027 Mudança de sistema\nreduzido: 05/05/2027 Indisponibilidade do PJe', value: S.custom || '' });
      const chips = h('div', { class: 'chips' });
      const PRESETS = [
        ['Contestação', 15, 'cpc'], ['Apelação (CPC)', 15, 'cpc'], ['Agravo de instrumento', 15, 'cpc'], ['Embargos de declaração (CPC)', 5, 'cpc'], ['Réplica', 15, 'cpc'], ['Cumprimento voluntário', 15, 'cpc'],
        ['Recurso inominado', 10, 'jec'], ['Embargos (JEC)', 5, 'jec'],
        ['Apelação (CPP)', 5, 'cpp'], ['Razões de apelação (CPP)', 8, 'cpp'], ['RESE', 5, 'cpp'], ['Embargos de declaração (CPP)', 2, 'cpp'], ['Resposta à acusação', 10, 'cpp'],
      ];
      for (const [n, d, r] of PRESETS) chips.append(h('button', { type: 'button', class: 'chip', onclick: () => { days.value = d; rule.value = r; what.value = n.replace(/ \(.+\)$/, '').toLowerCase(); calc(); } }, n, ' ', h('b', null, d)));

      const resultBox = h('div', { class: 'stack' });
      const calBox = h('div', { class: 'cal-wrap' });
      const tl = h('ol', { class: 'timeline' });
      const holList = h('div', { class: 'stack', style: 'max-height:340px;overflow:auto' });

      root.append(h('div', { class: 'grid-2' },
        h('div', { class: 'stack' },
          h('div', { class: 'card card-pad stack' },
            F.field('Regra de contagem', rule),
            F.field('Marco inicial', event),
            h('div', { class: 'fields-2' }, F.field('Data do marco', date), F.field('Prazo (dias)', days)),
            h('div', null, h('span', { class: 'label' }, 'Atalhos'), chips),
            F.field('Finalidade (para a certidão)', what),
            dobro, dobroWhy, susp, excecao, recesso),
          h('details', { class: 'card card-pad' }, h('summary', { class: 'small', style: 'cursor:pointer;font-weight:600' }, 'Feriados e dias sem expediente'),
            h('p', { class: 'tiny' }, 'Calendário-padrão com feriados nacionais, do DF e os dias sem expediente forense da Lei 5.010/1966. Desmarque o que não se aplica e acrescente os pontos facultativos e as indisponibilidades do sistema do ano (art. 224, § 1º, do CPC).'),
            holList, F.field('Dias adicionais (um por linha)', customTa, 'Use "reduzido:" para expediente reduzido ou indisponibilidade: o dia conta, mas o prazo não começa nem vence nele.'))),
        h('div', { class: 'stack' }, resultBox,
          h('div', { class: 'card card-pad stack' }, h('div', { class: 'row' }, h('h2', { style: 'margin:0' }, 'Calendário'), h('span', { class: 'grow', style: 'flex:1' }),
            h('div', { class: 'legend' }, h('span', null, h('i', { class: 'sw', style: 'background:var(--stamp-soft)' }), 'conta'), h('span', null, h('i', { class: 'sw day skip', style: 'aspect-ratio:auto' }), 'não conta'), h('span', null, h('i', { class: 'sw day susp', style: 'aspect-ratio:auto' }), 'suspenso'), h('span', null, h('i', { class: 'sw', style: 'background:var(--seal)' }), 'vencimento'))), calBox),
          h('details', { class: 'card card-pad' }, h('summary', { class: 'small', style: 'cursor:pointer;font-weight:600' }, 'Dia a dia'), tl))));

      const parseCustom = () => {
        const out = [];
        for (const raw of customTa.value.split('\n')) {
          const line = raw.trim(); if (!line) continue;
          const red = /^(reduzido|indisponibilidade|indisponível)\s*:\s*/i.test(line);
          const l2 = line.replace(/^[^:]*:\s*(?=\d)/, '');
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*(?:a|até|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{4}))?\s*(.*)$/.exec(l2) || /^(\d{4})-(\d{2})-(\d{2})()()()\s*(.*)$/.exec(l2);
          if (!m) continue;
          const a = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
          const b = m[4] ? `${m[6]}-${m[5].padStart(2, '0')}-${m[4].padStart(2, '0')}` : a;
          for (let d = a, g = 0; d <= b && g < 400; d = D.add(d, 1), g++) out.push({ id: 'c:' + d, date: d, name: m[7] || (red ? 'Expediente reduzido' : 'Sem expediente (informado)'), base: 'informado por você', type: red ? 'reduzido' : 'feriado' });
        }
        return out;
      };

      function renderHolidays(years) {
        holList.replaceChildren(...years.map((y) => h('div', null, h('div', { class: 'label', style: 'margin:6px 0 4px' }, String(y)),
          ...defaultCalendar(y).map((it) => {
            const c = F.check(`${D.br(it.date)} · ${it.name}`, !disabled.has(it.id), it.base);
            c.input.addEventListener('change', () => { c.input.checked ? disabled.delete(it.id) : disabled.add(it.id); calc(); });
            return c;
          }))));
      }

      function calc() {
        const R = rule.value;
        excecao.hidden = R !== 'cpp';
        dobroWhy.hidden = !dobro.input.checked;
        susp.hidden = R === 'corridos';
        F.store.set('prazos', { rule: R, event: event.value, days: days.value, custom: customTa.value, disabled: [...disabled], recesso: recesso.input.checked, what: what.value });
        resultBox.replaceChildren(); calBox.replaceChildren(); tl.replaceChildren();
        if (!date.value) { resultBox.append(h('div', { class: 'card card-pad empty' }, 'Informe a data do marco inicial.')); return; }
        const n = Math.max(1, Math.min(3650, parseInt(days.value, 10) || 0));
        const total = dobro.input.checked ? n * 2 : n;
        const useSusp = RULES[R].susp && susp.input.checked && !(R === 'cpp' && excecao.input.checked);
        const y0 = +date.value.slice(0, 4);
        renderHolidaysOnce(y0);
        let r;
        try {
          r = computeDeadline({ event: event.value, date: date.value, days: total, rule: R, susp: useSusp, cal: makeCalendar({ disabled, custom: parseCustom(), recesso: recesso.input.checked }) });
        } catch (e) { resultBox.append(h('div', { class: 'note note-warn' }, e.message)); return; }
        const unit = RULES[R].unit === 'uteis' ? 'dias úteis' : 'dias corridos';
        const skipped = r.log.filter((x) => x.kind !== 'count');
        const ext = r.log.filter((x) => x.kind === 'ext');
        const certidao = `Certifico que o prazo de ${total} (${F.extenso(total)}) ${unit}${what.value.trim() ? ' para ' + what.value.trim() : ''}${dobro.input.checked ? ', contado em dobro (' + dobroWhy.value + '),' : ''} teve início em ${D.br(r.first)} e término em ${D.br(r.end)}.`;
        const kv = h('dl', { class: 'kv' });
        for (const s of r.steps) kv.append(h('dt', null, D.br(s.d)), h('dd', null, s.label));
        kv.append(h('dt', null, D.br(r.start)), h('dd', null, 'Dia do começo (não é contado)'));
        kv.append(h('dt', null, D.br(r.first)), h('dd', null, `1º dia da contagem (${DOW[D.dow(r.first)]})`));
        resultBox.append(h('div', { class: 'card card-pad stack' },
          h('div', { class: 'result-line' },
            h('div', { class: 'stamp-box', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'k' }, 'Prazo final'), h('span', { class: 'v', id: 'prazo-final' }, D.br(r.end)), h('span', { class: 's' }, DOW[D.dow(r.end)])),
            h('div', { class: 'stack', style: 'gap:6px;flex:1;min-width:220px' },
              h('div', { class: 'small' }, h('strong', null, `${total} ${unit}`), dobro.input.checked ? ` (${n} em dobro)` : '', ` · ${D.diff(date.value, r.end)} dias no calendário`),
              h('div', { class: 'row' }, h('span', { class: 'pill pill-info' }, RULES[R].name), skipped.some((x) => x.kind === 'susp') ? h('span', { class: 'pill pill-warn' }, 'atravessa a suspensão de fim de ano') : null, ext.length ? h('span', { class: 'pill pill-warn' }, 'vencimento prorrogado') : null),
              h('div', { class: 'tiny' }, `${skipped.filter((x) => x.kind === 'skip').length} dia(s) não contado(s), ${skipped.filter((x) => x.kind === 'susp').length} em suspensão.`))),
          kv,
          h('div', { class: 'big-out small', id: 'prazo-certidao' }, certidao),
          h('div', { class: 'row' }, F.btn('Copiar certidão', () => F.copy(certidao), { icon: 'copy', small: true }), F.btn('Copiar data', () => F.copy(D.br(r.end)), { small: true, kind: 'quiet' })),
          h('div', { class: 'tiny' }, 'Fundamentos: ' + [EVENTS[event.value].base, ...RULES[R].base.filter((b) => useSusp || !/suspensão/.test(b))].join(' · ') + '.')));

        // calendário mensal
        const marks = {};
        marks[date.value] = 'event';
        for (const x of r.log) marks[x.d] = x.kind === 'count' ? 'count' : x.kind === 'susp' ? 'susp' : 'skip';
        const counts = Object.fromEntries(r.log.filter((x) => x.kind === 'count').map((x) => [x.d, x.n]));
        const reasons = Object.fromEntries(r.log.map((x) => [x.d, x.why]));
        for (const s of r.steps) if (!reasons[s.d]) reasons[s.d] = s.label;
        let m0 = date.value.slice(0, 7);
        const mEnd = r.end.slice(0, 7);
        let guard = 0;
        while (m0 <= mEnd && guard++ < 36) {
          const [yy, mm] = m0.split('-').map(Number);
          const first = `${m0}-01`;
          const len = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
          const grid = h('div', { class: 'cal-grid' }, ...['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => h('span', { class: 'dow' }, x)));
          for (let k = 0; k < D.dow(first); k++) grid.append(h('span', { class: 'day out' }));
          for (let dd = 1; dd <= len; dd++) {
            const s = `${m0}-${String(dd).padStart(2, '0')}`;
            const cls = ['day', marks[s] || ''];
            if (s === date.value) cls.push('event');
            if (s === r.first) cls.push('start');
            if (s === r.end) cls.push('end');
            grid.append(h('span', { class: cls.join(' '), title: `${D.br(s)}${reasons[s] ? ' · ' + reasons[s] : ''}${counts[s] ? ' · dia ' + counts[s] : ''}` }, String(dd), counts[s] ? h('i', null, counts[s]) : null));
          }
          calBox.append(h('div', { class: 'cal' }, h('h4', null, `${MES[mm - 1]} ${yy}`), grid));
          m0 = D.str(new Date(Date.UTC(yy, mm, 1))).slice(0, 7);
        }
        // dia a dia
        tl.append(h('li', null, h('span', null, D.br(date.value)), h('span', { class: 'n' }, '—'), h('span', null, EVENTS[event.value].name)));
        for (const s of r.steps.slice(1)) tl.append(h('li', null, h('span', null, D.br(s.d)), h('span', { class: 'n' }, '—'), h('span', null, s.label)));
        for (const x of r.log) tl.append(h('li', { class: x.kind === 'count' ? (x.d === r.end ? 'final' : '') : 'skipped' }, h('span', null, D.br(x.d) + ' ' + DOW[D.dow(x.d)].slice(0, 3)), h('span', { class: 'n' }, x.kind === 'count' ? String(x.n) : '·'), h('span', null, x.kind === 'count' ? (x.d === r.end ? 'vencimento' : x.why || '') : x.why || 'não conta')));
        const last = tl.lastChild; if (last && r.log.length && r.log[r.log.length - 1].kind === 'ext') last.className = 'final';
      }
      let shownYears = '';
      function renderHolidaysOnce(y) { const key = `${y - 1},${y},${y + 1}`; if (key !== shownYears) { shownYears = key; renderHolidays([y, y + 1]); } }
      [rule, event, date, days, dobroWhy].forEach((x) => x.addEventListener('change', calc));
      days.addEventListener('input', F.debounce(calc, 200));
      what.addEventListener('input', F.debounce(calc, 300));
      customTa.addEventListener('input', F.debounce(calc, 400));
      [dobro, susp, excecao, recesso].forEach((c) => c.input.addEventListener('change', calc));
      calc();
    },
  });

  // ======================================================================
  // Dosimetria e prescrição
  // ======================================================================
  const DY = 360; // convenção: ano de 12 meses e mês de 30 dias
  const toDays = (a, m, d) => (+a || 0) * DY + (+m || 0) * 30 + (+d || 0);
  const amd = (t) => ({ a: Math.floor(t / DY), m: Math.floor((t % DY) / 30), d: t % 30 });
  const fmtPena = (t) => {
    if (t <= 0) return '0 dia';
    const { a, m, d } = amd(t), p = [];
    if (a) p.push(`${a} ${a === 1 ? 'ano' : 'anos'}`);
    if (m) p.push(`${m} ${m === 1 ? 'mês' : 'meses'}`);
    if (d) p.push(`${d} ${d === 1 ? 'dia' : 'dias'}`);
    return p.length > 1 ? p.slice(0, -1).join(', ') + ' e ' + p[p.length - 1] : p[0];
  };
  F.fmtPena = fmtPena;
  const parseFrac = (s) => {
    const t = String(s).trim().replace(',', '.');
    let m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (m && +m[2] > 0) return [+m[1], +m[2]];
    m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
    if (m) return [Math.round(+m[1] * 100), 10000];
    return null;
  };
  // aplica a fração e despreza a fração de dia (CP, art. 11)
  F.applyFrac = (t, [p, q], up) => Math.floor((t * (up ? q + p : q - p)) / q);
  F.prescricao = (t) => t > 12 * DY ? [20, 'I'] : t > 8 * DY ? [16, 'II'] : t > 4 * DY ? [12, 'III'] : t > 2 * DY ? [8, 'IV'] : t >= DY ? [4, 'V'] : [3, 'VI'];

  F.register({
    id: 'pena', group: 'calc', name: 'Dosimetria e prescrição',
    keywords: 'pena dosimetria trifásico frações agravante atenuante causa de aumento diminuição regime prescrição art 109 115 detração substituição sursis',
    desc: 'Aplica as frações das três fases da dosimetria em anos, meses e dias, sugere o regime inicial e a possibilidade de substituição e sursis, e calcula a prescrição pela pena em abstrato ou em concreto.',
    refs: ['CP, art. 68', 'CP, art. 33', 'CP, art. 109 e 115', 'Súmula 231 do STJ'],
    render(root) {
      const num = (id, v, ph) => F.input({ id, type: 'number', min: 0, value: v, placeholder: ph, style: 'min-width:0' });
      const crime = F.input({ id: 'pena-crime', value: 'Furto qualificado (CP, art. 155, § 4º) — exemplo' });
      const minA = num('pena-min-a', 2), minM = num('pena-min-m', 0), maxA = num('pena-max-a', 8), maxM = num('pena-max-m', 0);
      const bA = num('pena-b-a', 2), bM = num('pena-b-m', 6), bD = num('pena-b-d', 0);
      const reinc = F.check('Réu reincidente', true);
      const violencia = F.check('Crime com violência ou grave ameaça', false);
      const culposo = F.check('Crime culposo', false);
      const detr = num('pena-detracao', 0);
      const ops = [
        { fase: 2, up: true, frac: '1/6', desc: 'Reincidência (CP, art. 61, I)' },
        { fase: 2, up: false, frac: '1/6', desc: 'Confissão espontânea (CP, art. 65, III, d)' },
        { fase: 3, up: false, frac: '1/3', desc: 'Tentativa (CP, art. 14, II)' },
      ];
      const opsBox = h('div', { class: 'stack' });
      const out = h('div', { class: 'stack' });
      // prescrição
      const pBase = F.seg([['concreta', 'Pena aplicada'], ['abstrata', 'Pena máxima cominada']], 'concreta', () => calc());
      const menor21 = F.check('Menor de 21 anos na data do fato ou maior de 70 na sentença', false, 'CP, art. 115: prazo reduzido de metade.');
      const execReinc = F.check('Prescrição da pretensão executória com reincidência', false, 'CP, art. 110: aumenta de 1/3.');
      const marco = F.input({ id: 'pena-marco', type: 'date', value: '' });
      const pOut = h('div', { class: 'stack' });

      root.append(h('div', { class: 'grid-even' },
        h('div', { class: 'stack' },
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Crime e pena cominada'), F.field('Crime', crime),
            h('div', { class: 'fields-2' }, h('div', { class: 'field' }, h('span', null, 'Mínimo (anos, meses)'), h('div', { class: 'fields-2' }, minA, minM)), h('div', { class: 'field' }, h('span', null, 'Máximo (anos, meses)'), h('div', { class: 'fields-2' }, maxA, maxM))),
            h('div', { class: 'field' }, h('span', null, '1ª fase: pena-base (anos, meses, dias)'), h('div', { class: 'fields-3', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, bA, bM, bD))),
          h('div', { class: 'card card-pad stack' }, h('h2', null, '2ª e 3ª fases'), h('p', { class: 'tiny', style: 'margin:0' }, 'Frações como 1/6, 2/3 ou percentuais (10%). Na 2ª fase, cada fração incide sobre a pena-base (agravantes e atenuantes se compensam) e o resultado fica entre o mínimo e o máximo cominados (Súmula 231 do STJ). Na 3ª fase, as causas incidem em cascata, na ordem da lista.'), opsBox,
            h('div', { class: 'row' }, F.btn('+ Agravante/atenuante', () => { ops.push({ fase: 2, up: true, frac: '1/6', desc: '' }); renderOps(); calc(); }, { small: true }), F.btn('+ Causa de aumento/diminuição', () => { ops.push({ fase: 3, up: true, frac: '1/3', desc: '' }); renderOps(); calc(); }, { small: true }))),
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Condições'), reinc, violencia, culposo, F.field('Detração: dias de prisão provisória', detr))),
        h('div', { class: 'stack' }, out,
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Prescrição'), F.field('Calcular pela', pBase), menor21, execReinc, F.field('Último marco interruptivo (opcional)', marco, 'Ex.: recebimento da denúncia, publicação da sentença (CP, art. 117).'), pOut))));

      function renderOps() {
        opsBox.replaceChildren(...ops.map((op, i) => {
          const fase = F.select([['2', '2ª fase'], ['3', '3ª fase']], String(op.fase), { 'aria-label': 'Fase' });
          const dir = F.select([['up', 'aumenta'], ['down', 'diminui']], op.up ? 'up' : 'down', { 'aria-label': 'Sentido' });
          const frac = F.input({ value: op.frac, 'aria-label': 'Fração', style: 'max-width:80px' });
          const desc = F.input({ value: op.desc, placeholder: 'Descrição', 'aria-label': 'Descrição' });
          fase.addEventListener('change', () => { op.fase = +fase.value; calc(); });
          dir.addEventListener('change', () => { op.up = dir.value === 'up'; calc(); });
          frac.addEventListener('input', F.debounce(() => { op.frac = frac.value; calc(); }, 200));
          desc.addEventListener('input', F.debounce(() => { op.desc = desc.value; calc(); }, 300));
          return h('div', { style: 'display:grid;grid-template-columns:minmax(0,92px) minmax(0,98px) minmax(0,80px) minmax(0,1fr) auto;gap:6px;align-items:center' }, fase, dir, frac, desc,
            h('button', { class: 'btn btn-sm btn-quiet', type: 'button', 'aria-label': 'Remover', onclick: () => { ops.splice(i, 1); renderOps(); calc(); } }, '×'));
        }));
      }
      let last = 0;
      function calc() {
        const base = toDays(bA.value, bM.value, bD.value);
        const min = toDays(minA.value, minM.value, 0), max = toDays(maxA.value, maxM.value, 0);
        const rows = [['1ª fase', 'Pena-base', base]];
        let t = base, bad = [];
        for (const fase of [2, 3]) {
          let factor = 1;
          for (const op of ops.filter((x) => x.fase === fase)) {
            const fr = parseFrac(op.frac);
            if (!fr) { bad.push(op.frac || '(vazio)'); continue; }
            if (fase === 2) {
              // 2ª fase: cada fração incide sobre a pena-base, e agravantes e atenuantes se compensam
              factor += (op.up ? 1 : -1) * fr[0] / fr[1];
              t = Math.max(0, Math.floor(base * factor + 1e-9));
            } else t = F.applyFrac(t, fr, op.up); // 3ª fase: em cascata
            rows.push([fase + 'ª fase', `${op.up ? '+' : '−'} ${op.frac} ${op.desc ? '· ' + op.desc : ''}`, t]);
          }
          if (fase === 2 && max > 0 && ops.some((x) => x.fase === 2)) {
            const c = Math.min(Math.max(t, min), max);
            if (c !== t) { rows.push(['2ª fase', c > t ? 'Limite do mínimo cominado (Súmula 231 do STJ)' : 'Limite do máximo cominado', c]); t = c; }
          }
        }
        last = t;
        const anos = t / DY;
        const R = reinc.input.checked;
        const regime = anos > 8 ? 'fechado' : anos > 4 ? (R ? 'fechado' : 'semiaberto') : (R ? 'semiaberto' : 'aberto');
        const regimeNote = anos > 8 ? 'pena superior a 8 anos (art. 33, § 2º, a)' : anos > 4 ? (R ? 'reincidente com pena superior a 4 anos (art. 33, § 2º, b)' : 'pena superior a 4 e até 8 anos, não reincidente (art. 33, § 2º, b)') : (R ? 'reincidente com pena até 4 anos: semiaberto se favoráveis as circunstâncias judiciais (Súmula 269 do STJ)' : 'pena até 4 anos, não reincidente (art. 33, § 2º, c)');
        const subst = culposo.input.checked || (anos <= 4 && !violencia.input.checked);
        const substOk = subst && !R;
        const sursis = anos <= 2 && !R;
        const dtr = Math.max(0, +detr.value || 0);
        out.replaceChildren(h('div', { class: 'card card-pad stack' },
          h('div', { class: 'result-line' }, h('div', { class: 'stamp-box' }, h('span', { class: 'k' }, 'Pena definitiva'), h('span', { class: 'v', id: 'pena-final', style: 'font-size:1.45rem' }, fmtPena(t)), h('span', { class: 's' }, `${F.nf(t)} dias na convenção 360/30`)),
            h('div', { class: 'stack', style: 'gap:6px;flex:1;min-width:200px' }, h('div', { class: 'row' }, h('span', { class: 'pill pill-info' }, 'Regime ' + regime)), h('div', { class: 'tiny' }, regimeNote))),
          bad.length ? h('div', { class: 'note note-warn' }, 'Fração inválida ignorada: ' + bad.join(', ')) : null,
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Fase'), h('th', null, 'Operação'), h('th', null, 'Pena resultante'))),
            h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r[0]), h('td', null, r[1]), h('td', null, fmtPena(r[2]))))))),
          h('dl', { class: 'kv' },
            h('dt', null, 'Substituição (art. 44)'), h('dd', null, substOk ? h('span', { class: 'pill pill-ok' }, 'cabível em tese') : h('span', { class: 'pill pill-bad' }, 'não cabível'), ' ', substOk ? (anos <= 1 ? 'uma pena restritiva de direitos ou multa' : 'uma restritiva e multa ou duas restritivas (art. 44, § 2º)') : subst && R ? 'reincidência impede, salvo art. 44, § 3º' : culposo.input.checked ? '' : 'pena acima de 4 anos ou crime com violência ou grave ameaça'),
            h('dt', null, 'Sursis (art. 77)'), h('dd', null, sursis ? h('span', { class: 'pill pill-ok' }, 'cabível em tese') : h('span', { class: 'pill pill-bad' }, 'não cabível'), ' ', sursis ? 'pena até 2 anos, não reincidente em crime doloso; subsidiário à substituição (art. 77, III)' : 'exige pena até 2 anos (ou até 4, nos casos do § 2º) e réu não reincidente em crime doloso'),
            dtr ? h('dt', null, 'Após detração (art. 42)') : null, dtr ? h('dd', null, `${fmtPena(Math.max(0, t - dtr))} a cumprir (${dtr} dias de prisão provisória); para o regime, veja o art. 387, § 2º, do CPP`) : null),
          h('div', { class: 'row' }, F.btn('Copiar memória de cálculo', () => F.copy([crime.value, ...rows.map((r) => `${r[0]}: ${r[1]} = ${fmtPena(r[2])}`), `Pena definitiva: ${fmtPena(t)}. Regime inicial: ${regime}.`].join('\n')), { icon: 'copy', small: true })),
          h('p', { class: 'tiny', style: 'margin:0' }, 'Convenção usada: ano = 12 meses e mês = 30 dias; frações de dia desprezadas (CP, art. 11). A fixação concreta depende da fundamentação do caso.')));
        // prescrição
        const ptBase = pBase.value === 'abstrata' ? max : t;
        if (!ptBase) { pOut.replaceChildren(h('div', { class: 'empty' }, 'Informe a pena máxima cominada.')); return; }
        const [yrs, inc] = F.prescricao(ptBase);
        let months = yrs * 12;
        const notes = [`${yrs} anos pela pena de ${fmtPena(ptBase)} (art. 109, ${inc})`];
        if (execReinc.input.checked) { months = Math.round(months * 4 / 3); notes.push('+ 1/3 pela reincidência (art. 110)'); }
        if (menor21.input.checked) { months = Math.round(months / 2); notes.push('÷ 2 pela idade (art. 115)'); }
        const ym = `${Math.floor(months / 12) ? Math.floor(months / 12) + (Math.floor(months / 12) === 1 ? ' ano' : ' anos') : ''}${months % 12 ? (Math.floor(months / 12) ? ' e ' : '') + (months % 12) + (months % 12 === 1 ? ' mês' : ' meses') : ''}`;
        const pend = marco.value ? D.add(D.addMonths(marco.value, months), -1) : null;
        const passed = pend && pend < D.today();
        pOut.replaceChildren(h('div', { class: 'result-line' }, h('div', { class: 'stamp-box', style: 'transform:none' }, h('span', { class: 'k' }, 'Prazo prescricional'), h('span', { class: 'v', style: 'font-size:1.45rem', id: 'pena-prescricao' }, ym)),
          pend ? h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'small' }, 'Último dia: ', h('strong', null, D.br(pend))), h('span', { class: 'pill ' + (passed ? 'pill-bad' : 'pill-ok') }, passed ? 'prazo já decorrido' : `faltam ${D.diff(D.today(), pend)} dias`)) : null),
        h('div', { class: 'tiny' }, notes.join(' · ') + (pend ? ' · contagem pelo calendário comum, incluído o dia do começo (CP, art. 10).' : '.') + (pBase.value === 'concreta' ? ' Pena em concreto: prescrição retroativa ou superveniente após o trânsito para a acusação (art. 110, § 1º).' : '')));
      }
      [minA, minM, maxA, maxM, bA, bM, bD, detr, marco].forEach((x) => x.addEventListener('input', F.debounce(calc, 150)));
      [reinc, violencia, culposo, menor21, execReinc].forEach((c) => c.input.addEventListener('change', calc));
      renderOps();
      calc();
    },
  });

  // ======================================================================
  // Valores e datas por extenso
  // ======================================================================
  F.register({
    id: 'extenso', group: 'calc', name: 'Valor por extenso',
    keywords: 'extenso valor reais número data certidão alvará sentença por cento percentual',
    desc: 'Escreve valores em reais, números, percentuais e datas por extenso, e insere o extenso entre parênteses em todos os valores de uma minuta de uma só vez.',
    refs: ['R$ 1.234,56 (mil…)', 'Datas de certidão'],
    render(root) {
      const kind = F.seg([['reais', 'Reais'], ['numero', 'Número'], ['pct', 'Percentual'], ['data', 'Data']], 'reais', () => run());
      const value = F.input({ id: 'ext-in', value: '12.345,67', style: 'font-size:1.15rem' });
      const gender = F.seg([['m', 'masculino (dias)'], ['f', 'feminino (horas, folhas)']], 'm', () => run());
      const dateMode = F.seg([['longa', 'Por extenso'], ['curta', 'Curta'], ['certidao', 'Certidão']], 'longa', () => run());
      const caseMode = F.seg([['lower', 'minúsculas'], ['cap', 'Primeira maiúscula'], ['upper', 'MAIÚSCULAS']], 'lower', () => run());
      const res = h('div', { class: 'big-out', id: 'ext-out' });
      const gRow = F.field('Gênero', gender), dRow = F.field('Formato da data', dateMode);
      let current = '';
      function run() {
        gRow.hidden = kind.value !== 'numero'; dRow.hidden = kind.value !== 'data';
        value.type = kind.value === 'data' ? 'date' : 'text';
        if (kind.value === 'data' && !/^\d{4}-\d{2}-\d{2}$/.test(value.value)) value.value = D.today();
        if (kind.value !== 'data' && /^\d{4}-\d{2}-\d{2}$/.test(value.value)) value.value = '';
        let txt = '';
        try {
          if (kind.value === 'data') txt = value.value ? F.dataExtenso(value.value, dateMode.value) : '';
          else {
            const v = F.parseValor(value.value);
            if (!isFinite(v)) txt = '';
            else if (v >= 1e18) throw new Error('Valor grande demais.');
            else if (kind.value === 'reais') txt = `${fmtBRL(v)} (${caseOf(F.reais(v), caseMode.value)})`;
            else if (kind.value === 'pct') { const [i, d = ''] = String(Math.abs(v)).split('.'); txt = `${String(v).replace('.', ',')}% (${caseOf(F.extenso(+i) + (d ? ' vírgula ' + (d.match(/^0+/) ? d.match(/^0+/)[0].split('').map(() => 'zero').join(' ') + ' ' : '') + F.extenso(+d) : '') + ' por cento', caseMode.value)})`; }
            else { const n = Math.floor(Math.abs(v)); txt = `${n.toLocaleString('pt-BR')} (${caseOf(F.extenso(n, gender.value === 'f'), caseMode.value)})`; }
          }
          if (kind.value === 'data') txt = caseOf(txt, caseMode.value);
        } catch (e) { txt = e.message; }
        current = txt;
        res.textContent = txt || 'Digite um valor.';
      }
      value.addEventListener('input', run);
      // inserir extenso em uma minuta
      const minuta = F.textarea({ id: 'ext-minuta', class: 'textarea prose', style: 'min-height:200px', value: 'Condeno o réu ao pagamento de R$ 5.000,00 a título de danos morais e à restituição de R$ 1.236,90, em dobro. Honorários de 10% sobre o valor da condenação. Prazo de 15 dias.' });
      const minOut = F.textarea({ id: 'ext-minuta-out', class: 'textarea prose', style: 'min-height:200px', readOnly: true });
      const incPct = F.check('Percentuais (10% → 10% (dez por cento))', true);
      const incDias = F.check('Prazos em dias (15 dias → 15 (quinze) dias)', true);
      const fill = () => {
        let t = minuta.value.replace(/R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?!\.?\d|,\d)(?!\s*\()/g, (m, n) => `${m} (${F.reais(F.parseValor(n))})`);
        if (incPct.input.checked) t = t.replace(/(?<![\d,])(\d{1,3}(?:,\d+)?)\s?%(?!\s*\()/g, (m, n) => { const [i, d] = n.split(','); return `${m} (${F.extenso(+i)}${d ? ' vírgula ' + F.extenso(+d) : ''} por cento)`; });
        if (incDias.input.checked) t = t.replace(/(?<![\d.,])(\d{1,4}) (dias|meses|anos|horas)\b/g, (m, n, u) => `${n} (${F.extenso(+n, u === 'horas')}) ${u}`);
        minOut.value = t;
      };
      minuta.addEventListener('input', F.debounce(fill, 150));
      incPct.input.addEventListener('change', fill); incDias.input.addEventListener('change', fill);
      root.append(h('div', { class: 'grid-even' },
        h('div', { class: 'card card-pad stack' }, F.field('Tipo', kind), F.field('Valor', value), gRow, dRow, F.field('Letras', caseMode), res, h('div', { class: 'row' }, F.btn('Copiar', () => F.copy(current), { icon: 'copy', kind: 'primary', small: true }), F.btn('Copiar só o extenso', () => F.copy((current.match(/\((.*)\)$/) || [0, current])[1]), { small: true }))),
        h('div', { class: 'card card-pad stack' }, h('h2', null, 'Inserir o extenso numa minuta'), h('p', { class: 'tiny', style: 'margin:0' }, 'Cole o texto: cada valor em reais sem extenso ganha o extenso entre parênteses.'), minuta, h('div', { class: 'row' }, incPct, incDias), minOut, h('div', { class: 'row' }, F.btn('Copiar texto', () => F.copy(minOut.value), { icon: 'copy', small: true })))));
      run(); fill();
    },
  });
})();
