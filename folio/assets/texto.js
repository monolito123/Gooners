/* Fólio — texto e dados: número CNJ, extração de dados, anonimização (LGPD), comparação de versões e ementa (Recomendação CNJ 154/2024). */
(function () {
  'use strict';
  const F = window.Folio;
  const { h } = F;

  // ======================================================================
  // Número único (Resolução CNJ 65/2008)
  // ======================================================================
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SE', 'SP', 'TO'];
  const SEG = { 1: 'Supremo Tribunal Federal', 2: 'Conselho Nacional de Justiça', 3: 'Superior Tribunal de Justiça', 4: 'Justiça Federal', 5: 'Justiça do Trabalho', 6: 'Justiça Eleitoral', 7: 'Justiça Militar da União', 8: 'Justiça dos Estados e do Distrito Federal e Territórios', 9: 'Justiça Militar Estadual' };
  function tribunal(j, tr) {
    const n = +tr;
    if (j === 8) return n === 7 ? 'TJDFT (Tribunal de Justiça do Distrito Federal e dos Territórios)' : UFS[n - 1] ? 'TJ' + UFS[n - 1] : '?';
    if (j === 4) return n === 90 ? 'Conselho da Justiça Federal' : n >= 1 && n <= 6 ? `TRF da ${n}ª Região` : '?';
    if (j === 5) return n === 0 ? 'Tribunal Superior do Trabalho' : n === 90 ? 'CSJT' : n <= 24 ? `TRT da ${n}ª Região` : '?';
    if (j === 6) return n === 0 ? 'Tribunal Superior Eleitoral' : UFS[n - 1] ? 'TRE-' + UFS[n - 1] : '?';
    if (j === 9) return { 13: 'TJM-MG', 21: 'TJM-RS', 26: 'TJM-SP' }[n] || '?';
    if (j === 7) return n === 0 ? 'Superior Tribunal Militar' : `${n}ª Circunscrição Judiciária Militar`;
    return n === 0 ? SEG[j] : '?';
  }
  F.cnjDv = (n7, ano, j, tr, orig) => String(98 - F.mod97(`${n7}${ano}${j}${tr}${orig}00`)).padStart(2, '0');
  F.cnjParse = (raw) => {
    const d = String(raw).replace(/\D/g, '');
    if (d.length !== 20) return null;
    const p = { n: d.slice(0, 7), dv: d.slice(7, 9), ano: d.slice(9, 13), j: d.slice(13, 14), tr: d.slice(14, 16), o: d.slice(16, 20) };
    p.ok = F.cnjValid(d);
    p.dvOk = F.cnjDv(p.n, p.ano, p.j, p.tr, p.o);
    p.fmt = `${p.n}-${p.dv}.${p.ano}.${p.j}.${p.tr}.${p.o}`;
    p.fixed = `${p.n}-${p.dvOk}.${p.ano}.${p.j}.${p.tr}.${p.o}`;
    return p;
  };
  const RE_CNJ_ANY = /(?<!\d)(\d{7})[-.\s]?(\d{2})[.\s]?(\d{4})[.\s]?(\d)[.\s]?(\d{2})[.\s]?(\d{4})(?!\d)/g;

  F.register({
    id: 'numero-cnj', group: 'texto', name: 'Número CNJ',
    keywords: 'numeração única processo cnj dígito verificador validar formatar resolução 65 lote',
    desc: 'Valida e decompõe o número único do processo, calcula o dígito verificador e corrige, formata e remove duplicatas de listas inteiras de números colados de planilhas ou relatórios.',
    refs: ['Resolução CNJ 65/2008', 'Módulo 97'],
    render(root) {
      const one = F.input({ id: 'cnj-one', value: '0701234-93.2026.8.07.0001', style: 'font-family:var(--font-mono);font-size:1.05rem' });
      const oneOut = h('div', { class: 'stack' });
      const lot = F.textarea({ id: 'cnj-lote', style: 'min-height:170px', value: 'Processos da pauta:\n0701234-93.2026.8.07.0001\n07012349320268070001 (repetido, sem pontuação)\n0701234-94.2026.8.07.0001 (dígito errado)\n0001234-26.2025.8.07.0016' });
      const lotOut = h('div', { class: 'stack' });
      const g = { n: F.input({ id: 'cnj-g-n', value: '0705555', maxLength: 7 }), ano: F.input({ id: 'cnj-g-ano', value: String(new Date().getFullYear()), maxLength: 4 }), j: F.input({ id: 'cnj-g-j', value: '8', maxLength: 1 }), tr: F.input({ id: 'cnj-g-tr', value: '07', maxLength: 2 }), o: F.input({ id: 'cnj-g-o', value: '0001', maxLength: 4 }) };
      const genOut = h('div', { class: 'big-out mono', id: 'cnj-gerado' });
      root.append(h('div', { class: 'grid-even' },
        h('div', { class: 'stack' },
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Validar um número'), one, oneOut),
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Calcular o dígito verificador'),
            h('div', { class: 'fields-3', style: 'grid-template-columns:2fr 1.3fr .6fr .8fr 1.1fr' }, F.field('Sequencial', g.n), F.field('Ano', g.ano), F.field('J', g.j), F.field('TR', g.tr), F.field('Origem', g.o)),
            genOut, h('div', { class: 'row' }, F.btn('Copiar', () => F.copy(genOut.textContent), { icon: 'copy', small: true })))),
        h('div', { class: 'card card-pad stack' }, h('h2', null, 'Lista de processos'), h('p', { class: 'tiny', style: 'margin:0' }, 'Cole qualquer texto: os números são encontrados, validados, formatados e deduplicados.'), lot, lotOut)));

      const decompose = (p) => h('dl', { class: 'kv' },
        h('dt', null, 'Sequencial'), h('dd', { class: 'mono' }, p.n),
        h('dt', null, 'Dígito verificador'), h('dd', null, h('span', { class: 'mono' }, p.dv), ' ', p.ok ? h('span', { class: 'pill pill-ok' }, 'confere') : h('span', { class: 'pill pill-bad' }, 'deveria ser ' + p.dvOk)),
        h('dt', null, 'Ano de ajuizamento'), h('dd', { class: 'mono' }, p.ano),
        h('dt', null, 'Segmento (J)'), h('dd', null, `${p.j} · ${SEG[p.j] || 'inválido'}`),
        h('dt', null, 'Tribunal (TR)'), h('dd', null, `${p.tr} · ${tribunal(+p.j, p.tr)}`),
        h('dt', null, 'Origem (OOOO)'), h('dd', null, `${p.o} · ${p.o === '0000' ? 'competência originária do tribunal' : 'unidade de origem de 1º grau'}`));
      function runOne() {
        const p = F.cnjParse(one.value);
        if (!p) { oneOut.replaceChildren(h('div', { class: 'note' }, 'O número tem 20 dígitos: NNNNNNN-DD.AAAA.J.TR.OOOO.')); return; }
        oneOut.replaceChildren(h('div', { class: 'row' }, p.ok ? h('span', { class: 'pill pill-ok' }, 'Número válido') : h('span', { class: 'pill pill-bad' }, 'Dígito verificador inválido'), h('span', { class: 'mono' }, p.ok ? p.fmt : p.fixed), F.btn('Copiar', () => F.copy(p.ok ? p.fmt : p.fixed), { small: true, kind: 'quiet', icon: 'copy' })), decompose(p));
      }
      function runGen() {
        const n = g.n.value.replace(/\D/g, '').padStart(7, '0').slice(-7), ano = g.ano.value.replace(/\D/g, '').padStart(4, '0'), j = g.j.value.replace(/\D/g, '').slice(0, 1) || '8', tr = g.tr.value.replace(/\D/g, '').padStart(2, '0'), o = g.o.value.replace(/\D/g, '').padStart(4, '0');
        genOut.textContent = `${n}-${F.cnjDv(n, ano, j, tr, o)}.${ano}.${j}.${tr}.${o}`;
      }
      let lotList = [];
      function runLot() {
        const seen = new Map();
        for (const m of lot.value.matchAll(RE_CNJ_ANY)) {
          const p = F.cnjParse(m.slice(1).join(''));
          const k = p.n + p.ano + p.j + p.tr + p.o + p.dv;
          if (seen.has(k)) seen.get(k).count++; else seen.set(k, Object.assign(p, { count: 1 }));
        }
        lotList = [...seen.values()];
        const ok = lotList.filter((p) => p.ok), bad = lotList.filter((p) => !p.ok);
        lotOut.replaceChildren(
          h('div', { class: 'row' }, h('span', { class: 'pill pill-ok' }, ok.length + ' válido(s)'), bad.length ? h('span', { class: 'pill pill-bad' }, bad.length + ' com dígito errado') : null, h('span', { class: 'tiny' }, lotList.reduce((s, p) => s + p.count - 1, 0) + ' repetição(ões) removida(s)')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Número'), h('th', null, 'Situação'), h('th', null, 'Tribunal'))),
            h('tbody', null, lotList.map((p) => h('tr', null, h('td', { class: 'mono' }, p.fmt), h('td', null, p.ok ? 'válido' : 'DV correto: ' + p.dvOk), h('td', null, tribunal(+p.j, p.tr).replace(/ \(.+\)/, ''))))))),
          h('div', { class: 'row' }, F.btn('Copiar válidos', () => F.copy(ok.map((p) => p.fmt).join('\n')), { icon: 'copy', small: true }), F.btn('Copiar só dígitos', () => F.copy(ok.map((p) => p.fmt.replace(/\D/g, '')).join('\n')), { small: true }), F.btn('Baixar .csv', () => F.save('processos.csv', '﻿numero;valido;dv_correto;tribunal\n' + lotList.map((p) => [p.fmt, p.ok ? 'sim' : 'não', p.dvOk, tribunal(+p.j, p.tr)].join(';')).join('\n'), 'text/csv'), { small: true, icon: 'download' })));
      }
      one.addEventListener('input', runOne);
      Object.values(g).forEach((x) => x.addEventListener('input', runGen));
      lot.addEventListener('input', F.debounce(runLot, 200));
      runOne(); runGen(); runLot();
    },
  });

  // ======================================================================
  // Extrair dados de um texto
  // ======================================================================
  const cpfOk = (c) => { const d = c.replace(/\D/g, ''); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false; const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; return dv(9) === +d[9] && dv(10) === +d[10]; };
  const cnpjOk = (c) => { const d = c.replace(/\D/g, ''); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false; const calc = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = w.reduce((a, x, i) => a + x * +d[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; }; return calc(12) === +d[12] && calc(13) === +d[13]; };
  F.cpfOk = cpfOk; F.cnpjOk = cnpjOk;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const EXTRACTORS = [
    { id: 'cnj', name: 'Processos (número CNJ)', re: RE_CNJ_ANY, norm: (m) => { const p = F.cnjParse(m[0]); return p && p.ok ? p.fmt : null; } },
    { id: 'pje', name: 'IDs de documentos do PJe', re: /\b(?:ID|Id\.?|Num\.)\s*(?:n[º°.]*\s*)?(\d{6,12})\b/g, norm: (m) => 'ID ' + m[1] },
    { id: 'leis', name: 'Dispositivos legais', re: /\barts?\.\s*\d+[º°o]?(?:-[A-Z])?(?:\s*(?:,|e|a)\s*\d+[º°o]?(?:-[A-Z])?)*(?:,?\s*(?:§§?\s*\d+[º°o]?|par[áa]grafo [úu]nico|(?:inc(?:iso)?s?\.?\s*)?[IVXLC]+\b|al[íi]nea\s*["“]?[a-z]["”]?))*(?:,?\s*(?:d[aoe]s?|desta|deste)\s+(?:Lei(?: Complementar)?(?: n[º°.]*)?\s*[\d.]+\/\d{2,4}|Decreto(?:-Lei)?(?: n[º°.]*)?\s*[\d.]+\/\d{2,4}|C[óo]digo(?: de Processo)? (?:Civil|Penal)|C[óo]digo (?:Tribut[áa]rio Nacional|de Defesa do Consumidor|de Tr[âa]nsito Brasileiro|Eleitoral)|Constitui[çc][ãa]o(?: Federal)?|CPC|CPP|CP|CC|CF(?:\/88)?|CDC|CLT|CTN|ECA|CTB|LEP|LINDB|LC))?/g, norm: (m) => m[0].replace(/\s+/g, ' ').trim() },
    { id: 'normas', name: 'Leis e súmulas citadas', re: /\b(?:Lei(?: Complementar)?|Decreto(?:-Lei)?|Resolu[çc][ãa]o(?: CNJ)?|Provimento)\s*(?:n[º°.]*\s*)?[\d.]+\/\d{2,4}|\bS[úu]mula(?: Vinculante)?\s*(?:n[º°.]*\s*)?\d+(?:\s*d[oa]\s*(?:STF|STJ|TST|TJDFT))?|\bTema(?: Repetitivo)?\s*(?:n[º°.]*\s*)?[\d.]+(?:\s*d[oa]\s*(?:STF|STJ))?/gi, norm: (m) => m[0].replace(/\s+/g, ' ').trim() },
    { id: 'valores', name: 'Valores em reais', re: /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?!\.?\d|,\d)/g, norm: (m) => F.fmtBRL(F.parseValor(m[1])), sum: true },
    { id: 'datas', name: 'Datas', re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b|\b(\d{1,2})º? de (janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})\b/gi, norm: (m) => { const d = m[1] ? [+m[3], +m[2], +m[1]] : [+m[6], MESES.indexOf(m[5].toLowerCase()) + 1, +m[4]]; if (d[1] < 1 || d[1] > 12 || d[2] < 1 || d[2] > 31) return null; return `${String(d[2]).padStart(2, '0')}/${String(d[1]).padStart(2, '0')}/${d[0]}`; }, sort: (a, b) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join('')) },
    { id: 'cpf', name: 'CPFs válidos', re: /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, norm: (m) => cpfOk(m[0]) ? m[0].replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : null },
    { id: 'cnpj', name: 'CNPJs válidos', re: /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, norm: (m) => cnpjOk(m[0]) ? m[0].replace(/\D/g, '').replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : null },
    { id: 'oab', name: 'Inscrições na OAB', re: /\bOAB\s*[\/-]?\s*([A-Z]{2})?\s*(?:n[º°.]*\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:\s*[-\/]\s*([A-Z]{2}))?(?:-?[AaBbEe]\b)?/g, norm: (m) => `OAB/${m[1] || m[3] || '??'} ${m[2].replace(/\./g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` },
    { id: 'emails', name: 'E-mails', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, norm: (m) => m[0].toLowerCase() },
    { id: 'tel', name: 'Telefones', re: /(?<!\d)(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, norm: (m) => { const d = m[0].replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 10 || d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : null; } },
    { id: 'cep', name: 'CEPs', re: /\b\d{2}\.?\d{3}-\d{3}\b/g, norm: (m) => m[0].replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2') },
  ];
  F.extractData = (text) => EXTRACTORS.map((ex) => {
    const counts = new Map();
    for (const m of text.matchAll(ex.re)) { const v = ex.norm(m); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
    let items = [...counts.keys()];
    if (ex.sort) items.sort(ex.sort);
    const total = ex.sum ? items.reduce((s, v) => s + F.parseValor(v) * counts.get(v), 0) : null;
    const distinctSum = ex.sum ? items.reduce((s, v) => s + F.parseValor(v), 0) : null;
    return { ex, items, counts, total, distinctSum };
  });

  F.register({
    id: 'extrair-dados', group: 'texto', name: 'Extrair dados do texto',
    keywords: 'extrair encontrar processos cpf cnpj oab valores datas artigos leis súmulas ids pje somar',
    desc: 'Encontra num texto os números de processo, IDs do PJe, dispositivos legais, súmulas, valores (com soma), datas, CPFs e CNPJs válidos, inscrições na OAB, e-mails, telefones e CEPs.',
    refs: ['Soma de valores', 'Validação de CPF e CNPJ'],
    render(root) {
      const sample = 'Trata-se de apelação nos autos 0701234-93.2026.8.07.0001, interposta por BANCO FICTÍCIO S.A. (CNPJ 11.222.333/0001-81), representado por Ana Exemplo (OAB/DF 12.345), contra a sentença de ID 123456789. O autor (CPF 123.456.789-09) comprovou descontos de R$ 412,30 em 05/08/2026, 05/09/2026 e 5 de outubro de 2026. A condenação abrange R$ 5.000,00 de danos morais, nos termos dos arts. 14 e 42, parágrafo único, do CDC e do art. 85, § 2º, do CPC, observada a Súmula 362 do STJ e a Lei nº 14.905/2024. Contato do escritório: contato@exemplo.adv.br, (61) 3333-4444, CEP 70040-010.';
      const ta = F.textarea({ id: 'extrair-in', class: 'textarea prose', style: 'min-height:300px', value: sample });
      const out = h('div', { class: 'stack' });
      const run = () => {
        const res = F.extractData(ta.value).filter((r) => r.items.length);
        if (!res.length) { out.replaceChildren(h('div', { class: 'card card-pad empty' }, 'Nada encontrado ainda.')); return; }
        out.replaceChildren(h('div', { class: 'grid-even', style: 'gap:12px' }, res.map((r) => h('div', { class: 'card card-pad stack', style: 'gap:8px' },
          h('div', { class: 'row' }, h('strong', { class: 'small' }, r.ex.name), h('span', { class: 'pill pill-info' }, String(r.items.length)), h('span', { style: 'flex:1' }), F.btn('Copiar', () => F.copy(r.items.join('\n')), { small: true, kind: 'quiet', icon: 'copy' })),
          h('ul', { class: 'outline', style: 'max-height:180px;overflow:auto' }, r.items.map((v) => h('li', null, h('span', { class: r.ex.id === 'leis' || r.ex.id === 'normas' ? '' : 'mono' }, v), r.counts.get(v) > 1 ? h('span', { class: 'pg' }, r.counts.get(v) + '×') : null))),
          r.ex.sum ? h('div', { class: 'small' }, 'Soma das ocorrências: ', h('strong', null, F.fmtBRL(r.total)), r.total !== r.distinctSum ? h('span', { class: 'tiny' }, ` · valores distintos: ${F.fmtBRL(r.distinctSum)}`) : null) : null))));
      };
      ta.addEventListener('input', F.debounce(run, 200));
      root.append(h('div', { class: 'grid-2', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1.25fr)' }, h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Texto'), h('span', { class: 'grow' }), F.btn('Limpar', () => { ta.value = ''; run(); ta.focus(); }, { small: true, kind: 'quiet' })), ta), out));
      run();
    },
  });

  // ======================================================================
  // Anonimização (LGPD)
  // ======================================================================
  const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', "d'", 'di', 'du', 'del', 'van', 'von']);
  F.initials = (name) => name.split(/\s+/).filter((w) => w && !PARTICLES.has(w.toLowerCase())).map((w) => w[0].toLocaleUpperCase('pt-BR') + '.').join('');
  const STOP = /^(Poder|Judici[áa]rio|Tribunal|Justi[çc]a|Distrito|Federal|Territ[óo]rios|Minist[ée]rio|P[úu]blico|Defensoria|Vara|Juizado|Ju[íi]za?|Desembargador[a]?|Relator[a]?|C[óo]digo|Lei|Processo|Classe|Autor[a]?|R[ée]u|Senten[çc]a|Ac[óo]rd[ãa]o|Turma|C[âa]mara|Rep[úu]blica|Bras[íi]lia|Brasil|Estado|Uni[ãa]o|Banco|Caixa|Supremo|Superior|Constitui[çc][ãa]o|Art|Arts|Súmula|S[úu]mula|Secretaria|Cart[óo]rio|Excelent[íi]ssim[oa]|Senhor[a]?|Doutor[a]?|Dr[a]?|DECIDO|RELAT[ÓO]RIO|FUNDAMENTA[ÇC][ÃA]O|DISPOSITIVO|CPF|CNPJ|OAB|PJe|ID|DJe|CPC|CPP|CDC|STJ|STF|TJDFT|Recurso|Apela[çc][ãa]o|Agravo|Embargos|S\.A\.|Ltda)$/i;
  F.suggestNames = (text) => {
    const W = "[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][a-záâãàéêíóôõúç]+|[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ]{2,}";
    const re = new RegExp(`(?:${W})(?:\\s+(?:(?:da|de|do|das|dos|e)\\s+)?(?:${W})){1,5}`, 'g');
    const counts = new Map();
    for (const m of text.matchAll(re)) {
      let words = m[0].split(/\s+/);
      while (words.length && STOP.test(words[0])) words.shift();
      while (words.length && (STOP.test(words[words.length - 1]) || PARTICLES.has(words[words.length - 1].toLowerCase()))) words.pop();
      if (words.length < 2 || words.some((w) => STOP.test(w))) continue;
      const name = words.join(' ');
      if (name.length < 6) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 20);
  };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  F.anonymize = (text, o) => {
    const report = [];
    let t = text;
    const rep = (type, re, fn) => {
      t = t.replace(re, (...args) => {
        const m = args[0];
        const out = fn(...args);
        if (out === m) return m;
        const r = report.find((x) => x.type === type && x.orig === m);
        if (r) r.n++; else report.push({ type, orig: m, sub: out, n: 1 });
        return out;
      });
    };
    // nomes primeiro (linhas "NOME" ou "NOME = SUBSTITUTO")
    const names = (o.names || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, s] = l.split(/\s*=\s*/); return { n: n.trim(), s: (s || '').trim() }; }).filter((x) => x.n.length >= 3).sort((a, b) => b.n.length - a.n.length);
    names.forEach((x, i) => {
      const sub = x.s || (o.nameMode === 'iniciais' ? F.initials(x.n) : `[PESSOA ${i + 1}]`);
      const re = new RegExp('(?<![\\p{L}])' + x.n.split(/\s+/).map(escRe).join('\\s+') + '(?![\\p{L}])', 'giu');
      rep('Nome', re, () => sub);
    });
    const label = (l) => o.style === 'etiqueta' ? `[${l}]` : null;
    if (o.cpf) rep('CPF', /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, (m) => cpfOk(m) ? (label('CPF') || m.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '***.$2.$3-**')) : m);
    if (o.cnpj) rep('CNPJ', /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, (m) => cnpjOk(m) ? (label('CNPJ') || m.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.***/****-$5')) : m);
    if (o.rg) rep('RG', /\b(RG|R\.G\.|C[ée]dula de identidade|identidade)(\s*(?:n[º°.]*)?\s*:?\s*)([\dXx.\-]{5,14})(\s*[-\/]?\s*(?:SSP|SESP|PC|DETRAN|IFP|SDS)\s*[\/-]?\s*[A-Z]{2})?/gi, (m, a, b, c, d) => `${a}${b}${label('RG') || c.replace(/\d(?=[\d.\-Xx]{3})/g, '*')}${d || ''}`);
    if (o.email) rep('E-mail', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => label('E-MAIL') || m[0] + '***@' + m.split('@')[1]);
    if (o.tel) rep('Telefone', /(?<!\d)(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, (m) => label('TELEFONE') || m.replace(/\d(?=(?:\D*\d){4})/g, (d, off) => (off < m.search(/\d{4}-?\d{4}/) ? d : '*')));
    if (o.cep) rep('CEP', /\b\d{2}\.?\d{3}-\d{3}\b/g, (m) => label('CEP') || m.slice(0, 2) + '***-***');
    if (o.banco) rep('Dados bancários', /\b(ag[êe]ncia|ag\.|conta(?:-corrente| corrente| poupan[çc]a)?|c\/c)(\s*(?:n[º°.]*)?\s*:?\s*)([\dXx][\dXx.\-]{2,15})/gi, (m, a, b, c) => `${a}${b}${label('CONTA') || c.replace(/\d/g, '*')}`);
    if (o.placa) rep('Placa', /\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/g, (m) => label('PLACA') || m.slice(0, 3) + '-****');
    if (o.nasc) rep('Nascimento', /\b(nascid[oa] em|data de nascimento:?|DN:?)(\s*)(\d{2}\/\d{2}\/\d{4})/gi, (m, a, b) => `${a}${b}${label('DATA') || '**/**/****'}`);
    if (o.endereco) rep('Endereço', /\b(?:Rua|Avenida|Av\.|Travessa|Alameda|Rodovia|Quadra|QD\.?|SQ[NS]W?|SH[ICDN][A-Z]{0,2}|SCLN|SCLS|CLN|CLS|QN[A-Z]|QS|QI|QL|QNM|QNN|QNL|SMPW|SMDB|Conjunto|Conj\.)\s+[^\n;]{2,70}?(?=,?\s*(?:CEP|Bras[íi]lia|Taguatinga|Ceil[âa]ndia|Gama|Guar[áa]|Samambaia|Sobradinho|Planaltina|-?\s*DF)\b|[;\n]|\.\s|$)/g, () => label('ENDEREÇO') || '[endereço omitido]');
    return { text: t, report };
  };

  F.register({
    id: 'anonimizar', group: 'texto', name: 'Anonimizar (LGPD)',
    keywords: 'lgpd anonimizar pseudonimizar dados pessoais cpf nome iniciais segredo de justiça mascarar ocultar',
    desc: 'Mascara CPF, RG, contatos, contas, placas e datas de nascimento, e troca os nomes das partes por iniciais ou etiquetas, para publicar decisões e preparar minutas em segredo de justiça. Gera um relatório do que foi trocado.',
    refs: ['Lei 13.709/2018', 'Iniciais ou etiquetas', 'Relatório'],
    render(root) {
      const sample = 'JOÃO EXEMPLO DA SILVA, CPF 123.456.789-09, RG 1.234.567 SSP/DF, nascido em 12/03/1985, residente na SQS 308 Bloco C, apartamento 201, Brasília-DF, CEP 70355-030, telefone (61) 99876-5432, e-mail joao.exemplo@email.com, ajuizou ação contra MARIA EXEMPLO DE OLIVEIRA. A ré, por sua vez, informou a conta 12345-6 da agência 1234. Testemunha: Pedro Exemplo Santos, condutor do veículo de placa JKL-1A23.';
      const ta = F.textarea({ id: 'anon-in', class: 'textarea prose', style: 'min-height:220px', value: sample });
      const names = F.textarea({ id: 'anon-nomes', style: 'min-height:100px', value: 'JOÃO EXEMPLO DA SILVA\nMARIA EXEMPLO DE OLIVEIRA\nPedro Exemplo Santos = [TESTEMUNHA]', placeholder: 'Um nome por linha. Para escolher o substituto: NOME = SUBSTITUTO' });
      const nameMode = F.seg([['iniciais', 'Iniciais (J.E.S.)'], ['etiqueta', 'Etiquetas ([PESSOA 1])']], 'iniciais', () => run());
      const style = F.seg([['parcial', 'Máscara parcial (***.456.789-**)'], ['etiqueta', 'Etiqueta ([CPF])']], 'parcial', () => run());
      const ck = { cpf: F.check('CPF', true), rg: F.check('RG', true), email: F.check('E-mail', true), tel: F.check('Telefone', true), cep: F.check('CEP', true), banco: F.check('Agência e conta', true), placa: F.check('Placa de veículo', true), nasc: F.check('Data de nascimento', true), endereco: F.check('Endereço (experimental)', true), cnpj: F.check('CNPJ', false, 'Pessoa jurídica não é dado pessoal.') };
      const sugg = h('div', { class: 'chips' });
      const outTa = F.textarea({ id: 'anon-out', class: 'textarea prose', style: 'min-height:220px', readOnly: true });
      const rep = h('div', { class: 'table-wrap' });
      let lastReport = [];
      function run() {
        const o = Object.fromEntries(Object.entries(ck).map(([k, c]) => [k, c.input.checked]));
        Object.assign(o, { names: names.value, nameMode: nameMode.value, style: style.value });
        const r = F.anonymize(ta.value, o);
        outTa.value = r.text;
        lastReport = r.report;
        rep.replaceChildren(r.report.length ? h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Tipo'), h('th', null, 'Original'), h('th', null, 'Substituído por'), h('th', null, 'Vezes'))),
          h('tbody', null, r.report.map((x) => h('tr', null, h('td', null, x.type), h('td', null, x.orig), h('td', { class: 'mono' }, x.sub), h('td', { class: 'num' }, String(x.n)))))) : h('div', { class: 'empty' }, 'Nada foi substituído.'));
        const listed = new Set(names.value.split('\n').map((l) => l.split('=')[0].trim().toLowerCase()));
        const sug = F.suggestNames(ta.value).filter(([n]) => !listed.has(n.toLowerCase()));
        sugg.replaceChildren(...(sug.length ? sug.map(([n, c]) => h('button', { type: 'button', class: 'chip', title: 'Acrescentar à lista', onclick: () => { names.value = (names.value.trim() + '\n' + n).trim(); run(); } }, '+ ', n, c > 1 ? h('b', null, ' ' + c) : null)) : [h('span', { class: 'tiny' }, 'Sem sugestões.')]));
      }
      ta.addEventListener('input', F.debounce(run, 250));
      names.addEventListener('input', F.debounce(run, 250));
      Object.values(ck).forEach((c) => c.input.addEventListener('change', run));
      root.append(h('div', { class: 'grid-even' },
        h('div', { class: 'stack' },
          h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Texto original'), h('span', { class: 'grow' }), F.btn('Limpar', () => { ta.value = ''; run(); ta.focus(); }, { small: true, kind: 'quiet' })), ta),
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Nomes a substituir'), names, h('div', null, h('span', { class: 'label' }, 'Nomes encontrados no texto'), sugg), F.field('Substituir nomes por', nameMode)),
          h('div', { class: 'card card-pad stack' }, h('h2', null, 'Outros dados'), h('div', { class: 'fields-2' }, ...Object.values(ck)), F.field('Forma', style))),
        h('div', { class: 'stack' },
          h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Texto anonimizado'), h('span', { class: 'grow' }), F.btn('Copiar', () => F.copy(outTa.value), { icon: 'copy', small: true, kind: 'primary' }), F.btn('Baixar .txt', () => F.save('texto-anonimizado.txt', outTa.value, 'text/plain'), { icon: 'download', small: true })), outTa),
          h('div', { class: 'card card-pad stack' }, h('div', { class: 'row' }, h('h2', { style: 'margin:0' }, 'Relatório de substituições'), h('span', { style: 'flex:1' }), F.btn('Copiar', () => F.copy(lastReport.map((x) => `${x.type}\t${x.orig}\t${x.sub}\t${x.n}`).join('\n')), { small: true, kind: 'quiet', icon: 'copy' })), rep,
            h('p', { class: 'tiny', style: 'margin:0' }, 'Revise o resultado: nomes escritos de outro jeito (abreviados, com erro, só o prenome) não são encontrados automaticamente. O relatório contém os dados originais; não o publique.')))));
      run();
    },
  });

  // ======================================================================
  // Comparar versões
  // ======================================================================
  F.register({
    id: 'comparar', group: 'texto', name: 'Comparar versões',
    keywords: 'diff comparar diferença minuta versão revisão alterações texto',
    desc: 'Mostra o que mudou entre duas versões de uma minuta, palavra por palavra: inclusões em verde, exclusões riscadas, com contagem de alterações.',
    refs: ['Por palavra ou letra'],
    render(root) {
      const a = F.textarea({ id: 'cmp-a', class: 'textarea prose', style: 'min-height:200px', value: 'Ante o exposto, JULGO PROCEDENTE o pedido para condenar o réu ao pagamento de R$ 10.000,00 a título de danos morais, com correção monetária desde a citação. Condeno o réu ao pagamento das custas e dos honorários, que fixo em 15% do valor da condenação.' });
      const b = F.textarea({ id: 'cmp-b', class: 'textarea prose', style: 'min-height:200px', value: 'Ante o exposto, JULGO PROCEDENTES os pedidos para condenar o réu ao pagamento de R$ 5.000,00 a título de danos morais, com correção monetária a partir desta data (Súmula 362 do STJ). Condeno o réu ao pagamento das custas e dos honorários advocatícios, que fixo em 10% do valor da condenação.' });
      const gran = F.seg([['palavra', 'Por palavra'], ['letra', 'Por letra']], 'palavra', () => run());
      const view = F.seg([['ambas', 'Alterações'], ['nova', 'Só a versão nova'], ['antiga', 'Só a anterior']], 'ambas', () => { box.className = 'diff' + (view.value === 'nova' ? ' only-new' : view.value === 'antiga' ? ' only-old' : ''); });
      const ignoreWs = F.check('Ignorar diferenças de espaços e quebras de linha', true);
      const box = h('div', { class: 'diff', id: 'cmp-out' });
      const stats = h('div', { class: 'row' });
      async function run() {
        try { await F.lib('dmp'); } catch (e) { box.textContent = e.message; return; }
        const norm = (s) => ignoreWs.input.checked ? s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() : s;
        const A = norm(a.value), B = norm(b.value);
        const dmp = new window.diff_match_patch();
        dmp.Diff_Timeout = 2;
        let diffs;
        if (gran.value === 'palavra') {
          const map = new Map(), arr = [];
          const enc = (s) => (s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || []).map((tok) => { if (!map.has(tok)) { map.set(tok, String.fromCharCode(arr.length + 256)); arr.push(tok); } return map.get(tok); }).join('');
          const ea = enc(A), eb = enc(B);
          diffs = dmp.diff_main(ea, eb, false);
          dmp.diff_cleanupSemantic(diffs);
          diffs = diffs.map(([op, s]) => [op, [...s].map((ch) => arr[ch.charCodeAt(0) - 256]).join('')]);
        } else { diffs = dmp.diff_main(A, B); dmp.diff_cleanupSemantic(diffs); }
        box.replaceChildren(...diffs.map(([op, s]) => op === 0 ? document.createTextNode(s) : h(op > 0 ? 'ins' : 'del', null, s)));
        const words = (op) => diffs.filter((d) => d[0] === op).reduce((n, d) => n + F.words(d[1]), 0);
        const changes = diffs.filter((d) => d[0] !== 0).length;
        stats.replaceChildren(h('span', { class: 'pill pill-ok' }, `+${words(1)} palavra(s)`), h('span', { class: 'pill pill-bad' }, `−${words(-1)} palavra(s)`), h('span', { class: 'tiny' }, changes ? `${changes} trecho(s) alterado(s)` : 'As versões são iguais.'));
      }
      a.addEventListener('input', F.debounce(run, 300)); b.addEventListener('input', F.debounce(run, 300));
      ignoreWs.input.addEventListener('change', run);
      const swap = F.btn('Inverter', () => { [a.value, b.value] = [b.value, a.value]; run(); }, { small: true, kind: 'quiet', icon: 'swap' });
      root.append(h('div', { class: 'stack' },
        h('div', { class: 'grid-even' }, h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Versão anterior'), h('span', { class: 'grow' }), swap), a), h('div', { class: 'card' }, h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Versão nova')), b)),
        h('div', { class: 'card' }, h('div', { class: 'out-head' }, gran, view, ignoreWs, h('span', { class: 'grow' }), stats), box)));
      run();
    },
  });

  // ======================================================================
  // Ementa (Recomendação CNJ 154/2024)
  // ======================================================================
  F.register({
    id: 'ementa', group: 'texto', name: 'Ementa padronizada',
    keywords: 'ementa acórdão padronização recomendação cnj 154 2024 caso em exame questão em discussão razões de decidir tese',
    desc: 'Monta a ementa na estrutura da Recomendação CNJ 154/2024: cabeçalho, caso em exame, questão em discussão, razões de decidir, dispositivo e tese, dispositivos e jurisprudência citados, com numeração contínua dos parágrafos.',
    refs: ['Recomendação CNJ 154/2024', '.docx e texto'],
    render(root) {
      const S = F.store.get('ementa', null);
      const f = {
        ramo: F.input({ id: 'em-ramo', value: 'Direito do Consumidor' }),
        classe: F.input({ id: 'em-classe', value: 'Apelação cível' }),
        assunto: F.input({ id: 'em-assunto', value: 'Descontos indevidos em conta. Empréstimo não contratado. Dano moral' }),
        resultado: F.input({ id: 'em-resultado', value: 'Recurso desprovido' }),
        caso: F.textarea({ id: 'em-caso', class: 'textarea prose', style: 'min-height:80px', value: 'Apelação cível interposta pelo réu contra sentença que declarou inexistente contrato de empréstimo, determinou a restituição em dobro dos valores descontados e fixou indenização por danos morais de R$ 5.000,00.' }),
        questao: F.textarea({ id: 'em-questao', class: 'textarea prose', style: 'min-height:80px', value: 'Há duas questões em discussão: (i) saber se houve falha na prestação do serviço bancário; (ii) saber se o valor da indenização por danos morais é proporcional.' }),
        razoes: F.textarea({ id: 'em-razoes', class: 'textarea prose', style: 'min-height:120px', value: 'O fornecedor de serviços responde objetivamente pelos danos causados por defeitos na prestação do serviço (CDC, art. 14).\nO banco não apresentou o contrato nem comprovou a disponibilização do crédito, ônus que lhe cabia.\nO valor de R$ 5.000,00 atende à extensão do dano e às circunstâncias do caso.' }),
        dispositivo: F.input({ id: 'em-dispositivo', value: 'Recurso desprovido.' }),
        tese: F.textarea({ id: 'em-tese', class: 'textarea prose', style: 'min-height:70px', value: 'A instituição financeira responde objetivamente pelos descontos de parcelas de empréstimo cuja contratação não comprova.\nO desconto indevido em verba de natureza alimentar gera dano moral.' }),
        dispositivos: F.input({ id: 'em-dispositivos', value: 'CDC, arts. 14 e 42, parágrafo único; CPC, art. 373, II.' }),
        juris: F.input({ id: 'em-juris', value: '' , placeholder: 'ex.: STJ, REsp nº ..., Rel. Min. ..., Terceira Turma, j. ...' }),
      };
      if (S) for (const [k, v] of Object.entries(S)) if (f[k] && typeof v === 'string') f[k].value = v;
      const preview = h('div', { class: 'doc', id: 'em-preview', style: 'max-height:none' });
      let md = '', plain = '';
      const up = (s) => s.trim().replace(/\.$/, '').toLocaleUpperCase('pt-BR');
      const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      function build() {
        F.store.set('ementa', Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])));
        let n = 0;
        const head = [f.ramo.value, f.classe.value, ...f.assunto.value.split(/\.\s*/), f.resultado.value].map(up).filter(Boolean).join('. ') + '.';
        const sec = [];
        const para = (t) => `${++n}. ${t.trim().replace(/([^.!?])$/, '$1.')}`;
        sec.push(['I. CASO EM EXAME', lines(f.caso.value).map(para)]);
        sec.push(['II. QUESTÃO EM DISCUSSÃO', lines(f.questao.value).map(para)]);
        sec.push(['III. RAZÕES DE DECIDIR', lines(f.razoes.value).map(para)]);
        const teses = lines(f.tese.value);
        const dispo = [para(f.dispositivo.value || 'Recurso desprovido.')];
        sec.push(['IV. DISPOSITIVO E TESE', dispo]);
        const teseTxt = teses.length ? `Tese de julgamento: “${teses.map((t, i) => `${i + 1}. ${t.replace(/([^.!?])$/, '$1.')}`).join(' ')}”` : '';
        md = `**Ementa:** ${head}\n\n` + sec.map(([t, ps]) => `**${t}**\n\n${ps.join('\n\n')}`).join('\n\n')
          + (teseTxt ? `\n\n*${teseTxt.replace(/^Tese de julgamento:/, 'Tese de julgamento:*')}` : '')
          + (f.dispositivos.value.trim() ? `\n\n*Dispositivos relevantes citados:* ${f.dispositivos.value.trim()}` : '')
          + (f.juris.value.trim() ? `\n\n*Jurisprudência relevante citada:* ${f.juris.value.trim()}` : '');
        md = md.replace(/^\*Tese de julgamento:\*\*/m, '*Tese de julgamento:*');
        plain = `Ementa: ${head}\n\n` + sec.map(([t, ps]) => `${t}\n\n${ps.join('\n\n')}`).join('\n\n') + (teseTxt ? `\n\n${teseTxt}` : '')
          + (f.dispositivos.value.trim() ? `\n\nDispositivos relevantes citados: ${f.dispositivos.value.trim()}` : '') + (f.juris.value.trim() ? `\n\nJurisprudência relevante citada: ${f.juris.value.trim()}` : '');
        F.mdToHtml(md).then((html) => { preview.innerHTML = html; });
        stats.textContent = `${F.nf(F.words(plain))} palavras · ${n} parágrafos numerados`;
      }
      const stats = h('span', { class: 'tiny' });
      Object.values(f).forEach((el) => el.addEventListener('input', F.debounce(build, 200)));
      const form = h('div', { class: 'card card-pad stack' },
        h('h2', null, 'Cabeçalho'), h('div', { class: 'fields-2' }, F.field('Ramo do direito', f.ramo), F.field('Classe', f.classe)), F.field('Assunto (frases separadas por ponto)', f.assunto), F.field('Resultado', f.resultado),
        h('div', { class: 'sep' }),
        F.field('I. Caso em exame', f.caso, 'Um parágrafo por linha.'), F.field('II. Questão em discussão', f.questao), F.field('III. Razões de decidir', f.razoes, 'Cada linha vira um parágrafo numerado.'),
        F.field('IV. Dispositivo', f.dispositivo), F.field('Tese de julgamento', f.tese, 'Uma tese por linha.'), F.field('Dispositivos relevantes citados', f.dispositivos), F.field('Jurisprudência relevante citada', f.juris));
      const outCard = h('div', { class: 'card' },
        h('div', { class: 'out-head' }, h('strong', { class: 'small' }, 'Ementa'), stats, h('span', { class: 'grow' }),
          F.btn('Copiar texto', () => F.copy(plain), { icon: 'copy', small: true }),
          F.btn('Copiar formatado', () => F.copy(plain, `<div style="font-family:'Times New Roman',serif;font-size:12pt;text-align:justify">${preview.innerHTML}</div>`), { small: true }),
          F.btn('Baixar .docx', async () => { try { F.save('ementa.docx', await F.markdownToDocx(md, { font: 'Times New Roman', size: '12', line: '1', indent: '0', justify: true, abnt: true, pageNum: false })); } catch (e) { F.toast(e.message, 'bad'); } }, { icon: 'download', small: true, kind: 'primary' })),
        preview);
      root.append(h('div', { class: 'grid-even' }, form, h('div', { class: 'stack', style: 'position:sticky;top:72px' }, outCard, h('p', { class: 'tiny' }, 'Estrutura da Recomendação CNJ nº 154/2024 e do Manual de Padronização de Ementas do CNJ. Os textos iniciais são um exemplo fictício.'))));
      build();
    },
  });
})();
