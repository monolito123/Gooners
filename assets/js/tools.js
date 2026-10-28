/* ==========================================================
   Gooners — catálogo de ferramentas
   Cada ferramenta: { id, name, cat, icon, desc, keys, render(root) }
   ========================================================== */
(function () {
  'use strict';

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    return el;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1600);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Copiado!');
  }
  const copyBtn = (get, label = 'Copiar') => h('button', { class: 'btn btn-sm', onclick: () => { const v = get(); if (v) copy(v); } }, label);
  const field = (label, control) => h('label', { class: 'f' }, label, control);
  const inp = (attrs = {}) => h('input', { class: 'inp', ...attrs });
  const area = (attrs = {}) => h('textarea', { class: 'inp', spellcheck: false, ...attrs });
  const sel = (options, attrs = {}) => h('select', { class: 'inp', ...attrs },
    options.map((o) => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o)));
  const check = (label, checked = false) => {
    const c = h('input', { type: 'checkbox', checked });
    return { el: h('label', { class: 'check' }, c, label), get on() { return c.checked; }, input: c };
  };
  const resultItem = (k, v) => h('div', { class: 'result-item' },
    k != null ? h('span', { class: 'k' }, k) : null,
    h('span', { class: /\s/.test(String(v)) ? 'v' : 'v mono', style: 'flex:1' }, v),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => copy(String(v)) }, 'Copiar'));
  const fmt = (n, d = 2) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d });
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = (v) => { const s = String(v).trim().replace(/\s/g, ''); return s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? parseFloat(s.replace(/\./g, '')) : parseFloat(s); };

  function randInt(min, max) { // inclusive, criptograficamente seguro e sem viés
    const range = max - min + 1;
    if (range <= 0) return min;
    const maxU = 0x100000000;
    const limit = maxU - (maxU % range);
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return min + (x % range);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = randInt(0, i); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** Ferramenta padrão texto → texto, com opções e atualização ao vivo. */
  function textTool(root, transform, opts = {}) {
    const input = area({ placeholder: opts.placeholder || 'Digite ou cole seu texto aqui…' });
    const output = area({ readOnly: true, placeholder: 'O resultado aparece aqui' });
    const extra = opts.controls ? opts.controls(run) : null;
    function run() {
      try { output.value = transform(input.value); output.classList.remove('err'); }
      catch (e) { output.value = '⚠ ' + e.message; }
    }
    // Lembra o último texto digitado em cada ferramenta (somente neste navegador)
    const memKey = window.Gooners && window.Gooners.currentTool ? 'gooners:input:' + window.Gooners.currentTool : null;
    const remember = () => { if (!memKey) return; try { input.value ? localStorage.setItem(memKey, input.value.slice(0, 20000)) : localStorage.removeItem(memKey); } catch { /* indisponível */ } };
    let memT;
    input.addEventListener('input', () => { run(); clearTimeout(memT); memT = setTimeout(remember, 300); });
    root.append(h('div', { class: 'stack' },
      extra,
      h('div', { class: 'cols-2' }, field('Entrada', input), field('Resultado', output)),
      h('div', { class: 'toolbar' },
        copyBtn(() => output.value, 'Copiar resultado'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { input.value = output.value; run(); } }, '⇅ Usar resultado como entrada'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { input.value = ''; run(); remember(); input.focus(); } }, 'Limpar'),
        h('span', { class: 'spacer' }),
        opts.sample ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { input.value = opts.sample; run(); } }, 'Exemplo') : null)));
    let saved = null;
    try { saved = memKey && localStorage.getItem(memKey); } catch { /* indisponível */ }
    if (saved) input.value = saved;
    else if (opts.sample && opts.prefill) input.value = opts.sample;
    run();
    setTimeout(() => input.focus(), 50);
    return { input, output, run };
  }

  // ---------- dados auxiliares ----------
  const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slugify = (s, sep = '-') => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');

  const UPSIDE = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
    A: '∀', B: 'ꓭ', C: 'Ɔ', D: 'ꓷ', E: 'Ǝ', F: 'Ⅎ', G: '⅁', H: 'H', I: 'I', J: 'ſ', K: 'ꓘ', L: '˥', M: 'W', N: 'N', O: 'O', P: 'Ԁ', Q: 'Ό', R: 'ꓤ', S: 'S', T: '⊥', U: '∩', V: 'Λ', W: 'M', X: 'X', Y: '⅄', Z: 'Z',
    '1': 'Ɩ', '2': 'ᄅ', '3': 'Ɛ', '4': 'ㄣ', '5': 'ϛ', '6': '9', '7': 'ㄥ', '8': '8', '9': '6', '0': '0',
    '.': '˙', ',': "'", "'": ',', '"': '„', '?': '¿', '!': '¡', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '_': '‾', '&': '⅋', ';': '؛' };

  function mathStyle(s, upper, lower, digit, exceptions = {}) {
    return Array.from(s).map((ch) => {
      if (exceptions[ch]) return exceptions[ch];
      const c = ch.codePointAt(0);
      if (upper && c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
      if (lower && c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
      if (digit && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
      return ch;
    }).join('');
  }
  const SMALLCAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';
  const STYLES = [
    ['Negrito', (s) => mathStyle(s, 0x1D400, 0x1D41A, 0x1D7CE)],
    ['Itálico', (s) => mathStyle(s, 0x1D434, 0x1D44E, 0, { h: 'ℎ' })],
    ['Negrito itálico', (s) => mathStyle(s, 0x1D468, 0x1D482, 0)],
    ['Sem serifa negrito', (s) => mathStyle(s, 0x1D5D4, 0x1D5EE, 0x1D7EC)],
    ['Cursiva', (s) => mathStyle(s, 0x1D4D0, 0x1D4EA, 0)],
    ['Gótico', (s) => mathStyle(s, 0x1D56C, 0x1D586, 0)],
    ['Contorno', (s) => mathStyle(s, 0x1D538, 0x1D552, 0x1D7D8, { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' })],
    ['Monoespaçado', (s) => mathStyle(s, 0x1D670, 0x1D68A, 0x1D7F6)],
    ['Largura total', (s) => mathStyle(s, 0xFF21, 0xFF41, 0xFF10).replace(/ /g, '　')],
    ['Círculos', (s) => mathStyle(s, 0x24B6, 0x24D0, 0, { 0: '⓪', 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨' })],
    ['Quadrados', (s) => mathStyle(s.toUpperCase(), 0x1F130, 0, 0)],
    ['Versalete', (s) => s.replace(/[a-z]/g, (c) => SMALLCAPS[c.charCodeAt(0) - 97])],
    ['Riscado', (s) => Array.from(s).map((c) => c + '̶').join('')],
    ['Sublinhado', (s) => Array.from(s).map((c) => c + '̲').join('')],
    ['De cabeça para baixo', (s) => Array.from(s).map((c) => UPSIDE[c] || c).reverse().join('')],
  ];

  const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.' };
  const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

  const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nulla gravida orci a odio nullam varius turpis et commodo pharetra est eros bibendum elit nec luctus magna felis sollicitudin mauris integer in mauris eu nibh euismod gravida duis ac tellus et risus vulputate vehicula donec lobortis risus a elit etiam tempor ut ullamcorper ligula eu tempor congue eros est euismod turpis id tincidunt sapien risus a quam maecenas fermentum consequat mi donec fermentum pellentesque malesuada nulla a mi duis sapien sem aliquet nec commodo eget consequat quis neque aliquam faucibus elit ut dictum aliquet felis nisl adipiscing sapien sed malesuada diam lacus eget erat cras mollis scelerisque nunc nullam arcu aliquam consequat curabitur augue lorem dapibus quis laoreet et pretium ac nisi aenean magna nisl mollis quis molestie eu feugiat in orci in hac habitasse platea dictumst'.split(' ');

  // ---------- número por extenso (pt-BR) ----------
  const EXT_U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const EXT_D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const EXT_C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const EXT_S = [null, null, ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões'], ['quatrilhão', 'quatrilhões'], ['quintilhão', 'quintilhões']];
  function trio(n) {
    if (n === 100) return 'cem';
    const parts = [];
    const c = Math.floor(n / 100), r = n % 100;
    if (c) parts.push(EXT_C[c]);
    if (r) parts.push(r < 20 ? EXT_U[r] : EXT_D[Math.floor(r / 10)] + (r % 10 ? ' e ' + EXT_U[r % 10] : ''));
    return parts.join(' e ');
  }
  /** Inteiro (string de dígitos) por extenso. */
  function intExtenso(digits) {
    digits = digits.replace(/^0+/, '');
    if (!digits) return 'zero';
    const groups = [];
    for (let i = digits.length; i > 0; i -= 3) groups.push(parseInt(digits.slice(Math.max(0, i - 3), i), 10));
    if (groups.length > EXT_S.length) throw new Error('Número grande demais (máx. 21 dígitos).');
    const words = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (!g) continue;
      let w;
      if (i === 0) w = trio(g);
      else if (i === 1) w = g === 1 ? 'mil' : trio(g) + ' mil';
      else w = trio(g) + ' ' + EXT_S[i][g === 1 ? 0 : 1];
      words.push({ w, g, i });
    }
    return words.map((x, k) => {
      if (k === 0) return x.w;
      const last = k === words.length - 1;
      const joinE = last && (x.g < 100 || x.g % 100 === 0);
      return (joinE ? ' e ' : last ? ' ' : ', ') + x.w;
    }).join('');
  }
  function extenso(raw, moeda) {
    let s = String(raw).trim().replace(/\s/g, '');
    if (!s) return '';
    const neg = s.startsWith('-');
    s = s.replace(/^[-+]/, '').replace(/^R\$/i, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234.567 (milhar pt-BR)
    if (!/^\d*\.?\d*$/.test(s) || s === '.') throw new Error('Digite um número válido, ex.: 1.234,56');
    const [ip = '', dp = ''] = s.split('.');
    const intDigits = ip.replace(/^0+/, '') || '0';
    let out;
    if (moeda) {
      const cents = parseInt((dp + '00').slice(0, 2), 10);
      const parts = [];
      if (intDigits !== '0') {
        const words = intExtenso(intDigits);
        const exactBig = intDigits.length > 6 && /0{6}$/.test(intDigits);
        parts.push(words + (exactBig ? ' de' : '') + (intDigits === '1' ? ' real' : ' reais'));
      }
      if (cents) parts.push(intExtenso(String(cents)) + (cents === 1 ? ' centavo' : ' centavos'));
      if (!parts.length) parts.push('zero real');
      out = parts.join(' e ');
    } else {
      out = intExtenso(intDigits);
      const dec = dp.replace(/0+$/, '');
      if (dec) {
        const names = ['décimo', 'centésimo', 'milésimo', 'décimo de milésimo', 'centésimo de milésimo', 'milionésimo'];
        if (dec.length <= names.length) {
          const n = parseInt(dec, 10);
          let unit = names[dec.length - 1];
          if (n !== 1) unit = unit.replace(/^(\S+)/, '$1s');
          out += ' vírgula ' + intExtenso(dec) + ' (' + intExtenso(dec) + ' ' + unit + ')';
        } else out += ' vírgula ' + Array.from(dec).map((d) => d === '0' ? 'zero' : EXT_U[d]).join(' ');
      }
    }
    return (neg ? 'menos ' : '') + out;
  }

  // ---------- CPF / CNPJ ----------
  const onlyDigits = (s) => String(s).replace(/\D/g, '');
  function cpfDV(base) {
    let s = 0;
    for (let i = 0; i < 9; i++) s += +base[i] * (10 - i);
    const d1 = (s * 10) % 11 % 10;
    s = 0;
    for (let i = 0; i < 9; i++) s += +base[i] * (11 - i);
    s += d1 * 2;
    const d2 = (s * 10) % 11 % 10;
    return '' + d1 + d2;
  }
  function cpfValid(v) {
    const d = onlyDigits(v);
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    return cpfDV(d.slice(0, 9)) === d.slice(9);
  }
  const cpfMask = (d) => d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  function genCPF(uf) {
    let b = '';
    for (let i = 0; i < 8; i++) b += randInt(0, 9);
    b += uf != null && uf !== '' ? uf : randInt(0, 9);
    return b + cpfDV(b);
  }
  // CNPJ: suporta o formato alfanumérico (IN RFB 2.229/2024), valor = código ASCII − 48
  const cnpjVal = (c) => c.charCodeAt(0) - 48;
  function cnpjDV(base) {
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], w2 = [6, ...w1];
    const calc = (str, w) => { let s = 0; for (let i = 0; i < w.length; i++) s += cnpjVal(str[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = calc(base, w1);
    const d2 = calc(base + d1, w2);
    return '' + d1 + d2;
  }
  function cnpjValid(v) {
    const c = String(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (c.length !== 14 || !/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\w)\1+$/.test(c)) return false;
    return cnpjDV(c.slice(0, 12)) === c.slice(12);
  }
  const cnpjMask = (d) => d.replace(/(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})/, '$1.$2.$3/$4-$5');
  function genCNPJ(alfa) {
    const chars = alfa ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '0123456789';
    let b = '';
    for (let i = 0; i < 8; i++) b += chars[randInt(0, chars.length - 1)];
    b += '0001';
    return b + cnpjDV(b);
  }
  function luhn(v) {
    const d = onlyDigits(v);
    if (d.length < 12) return false;
    let s = 0;
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i];
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      s += n;
    }
    return s % 10 === 0;
  }
  function cardBrand(d) {
    if (/^4/.test(d)) return 'Visa';
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return 'Mastercard';
    if (/^3[47]/.test(d)) return 'American Express';
    if (/^(4011|4312|4389|4514|4576|5041|5066|5090|6277|6362|6363|650|6516|6550)/.test(d)) return 'Elo';
    if (/^(606282|3841)/.test(d)) return 'Hipercard';
    if (/^3(0[0-5]|[68])/.test(d)) return 'Diners Club';
    if (/^6(011|5)/.test(d)) return 'Discover';
    if (/^35/.test(d)) return 'JCB';
    return 'Desconhecida';
  }

  // ---------- base64 / hash ----------
  const b64enc = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
  const b64dec = (s) => { s = s.trim().replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };

  function md5(str) {
    const bytes = new TextEncoder().encode(str);
    const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
    const len = bytes.length, nBlocks = ((len + 8) >> 6) + 1;
    const M = new Uint32Array(nBlocks * 16);
    for (let i = 0; i < len; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
    M[len >> 2] |= 0x80 << ((len % 4) * 8);
    M[nBlocks * 16 - 2] = (len * 8) >>> 0;
    M[nBlocks * 16 - 1] = Math.floor(len / 0x20000000);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let blk = 0; blk < nBlocks; blk++) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const s = S[(i >> 4) * 4 + (i % 4)];
        F = (F + A + K[i] + M[blk * 16 + g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    return [a0, b0, c0, d0].map((x) => Array.from({ length: 4 }, (_, i) => ((x >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }
  async function sha(algo, str) {
    const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- cores ----------
  function hexToRgb(hex) {
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const n = parseInt(hex, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hh = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > .5 ? d / (2 - max - min) : d / (max + min);
      hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh *= 60;
    }
    return [Math.round(hh), Math.round(s * 100), Math.round(l * 100)];
  }
  function hslToRgb(hh, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
  }

  // ---------- datas ----------
  const parseDate = (v) => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  function ymdDiff(a, b) {
    let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate();
    if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
  }
  function easter(y) { // algoritmo de Meeus/Jones/Butcher
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
    const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  /** Feriados nacionais (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023) e pontos facultativos móveis. */
  function holidays(y, facultativos = false) {
    const E = easter(y), rel = (n) => { const d = new Date(E); d.setDate(d.getDate() + n); return d; };
    const list = [[new Date(y, 0, 1), 'Confraternização Universal'], [rel(-2), 'Sexta-feira Santa'], [new Date(y, 3, 21), 'Tiradentes'], [new Date(y, 4, 1), 'Dia do Trabalho'],
      [new Date(y, 8, 7), 'Independência do Brasil'], [new Date(y, 9, 12), 'Nossa Senhora Aparecida'], [new Date(y, 10, 2), 'Finados'], [new Date(y, 10, 15), 'Proclamação da República'],
      [new Date(y, 11, 25), 'Natal']];
    if (y >= 2024) list.push([new Date(y, 10, 20), 'Dia Nacional de Zumbi e da Consciência Negra']);
    if (facultativos) list.push([rel(-48), 'Carnaval (ponto facultativo)'], [rel(-47), 'Carnaval (ponto facultativo)'], [rel(-46), 'Quarta-feira de Cinzas (até 14h, facultativo)'], [rel(60), 'Corpus Christi (ponto facultativo)']);
    return list.sort((a, b) => a[0] - b[0]);
  }
  const dkey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const plural = (n, s, p) => `${fmt(n, 0)} ${n === 1 ? s : p}`;

  // ---------- unidades ----------
  const UNITS = {
    Comprimento: { base: 'm', u: { km: 1000, m: 1, cm: .01, mm: .001, 'µm': 1e-6, mi: 1609.344, jd: .9144, pé: .3048, pol: .0254, 'milha náutica': 1852 } },
    Massa: { base: 'kg', u: { t: 1000, kg: 1, g: .001, mg: 1e-6, lb: .45359237, oz: .028349523125, arroba: 15 } },
    Área: { base: 'm²', u: { 'km²': 1e6, 'm²': 1, 'cm²': 1e-4, hectare: 1e4, 'alqueire paulista': 24200, acre: 4046.8564224, 'pé²': .09290304 } },
    Volume: { base: 'L', u: { 'm³': 1000, L: 1, mL: .001, 'galão (EUA)': 3.785411784, 'xícara (240 mL)': .24, 'colher sopa (15 mL)': .015 } },
    Velocidade: { base: 'm/s', u: { 'm/s': 1, 'km/h': 1 / 3.6, mph: .44704, nó: .514444 } },
    Dados: { base: 'B', u: { bit: .125, B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 } },
    Tempo: { base: 's', u: { ms: .001, s: 1, min: 60, h: 3600, dia: 86400, semana: 604800, mês: 2629746, ano: 31556952 } },
    Temperatura: { temp: true, u: { '°C': 1, '°F': 1, K: 1 } },
  };
  function convTemp(v, from, to) {
    const c = from === '°C' ? v : from === '°F' ? (v - 32) * 5 / 9 : v - 273.15;
    return to === '°C' ? c : to === '°F' ? c * 9 / 5 + 32 : c + 273.15;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = h('script', { src, onload: res, onerror: () => rej(new Error('Falha ao carregar biblioteca')) });
      document.head.append(s);
    });
  }

  // ==========================================================
  // Categorias
  // ==========================================================
  const CATEGORIES = [
    { id: 'texto', name: 'Texto', icon: 'type', color: '#6366f1', desc: 'Contar, converter, inverter, limpar e comparar textos.' },
    { id: 'geradores', name: 'Geradores', icon: 'sparkles', color: '#0ea5e9', desc: 'Senhas, CPF, CNPJ, UUID, QR Code, Pix e sorteios.' },
    { id: 'validadores', name: 'Validadores', icon: 'badge-check', color: '#10b981', desc: 'Valide documentos, cartões, e-mails e expressões regulares.' },
    { id: 'consultas', name: 'Consultas', icon: 'search-check', color: '#14b8a6', desc: 'CEP, CNPJ, cotação de moedas e feriados em tempo real.' },
    { id: 'conversores', name: 'Conversores', icon: 'repeat', color: '#f59e0b', desc: 'Unidades, cores, bases, Base64, imagens, CSV e JSON.' },
    { id: 'calculadoras', name: 'Calculadoras', icon: 'calculator', color: '#ec4899', desc: 'Porcentagem, juros, financiamento, datas, horas e mais.' },
    { id: 'dev', name: 'Desenvolvedor', icon: 'code', color: '#8b5cf6', desc: 'JSON, hash, JWT, HTML, Markdown e meta tags de SEO.' },
    { id: 'tempo', name: 'Tempo e produtividade', icon: 'clock', color: '#84cc16', desc: 'Cronômetro, Pomodoro, relógio mundial, notas e leitura em voz.' },
  ];

  // ==========================================================
  // Ferramentas
  // ==========================================================
  const T = [];
  const add = (t) => T.push(t);

  // ---------------- TEXTO ----------------
  add({ id: 'inverter-texto', name: 'Inverter texto', cat: 'texto', icon: 'arrow-left-right', desc: 'Inverta letras, palavras ou linhas de qualquer texto.', keys: 'reverso espelho contrario de tras para frente',
    render(root) {
      let mode;
      textTool(root, (s) => {
        if (mode.value === 'letras') return Array.from(s).reverse().join('');
        if (mode.value === 'palavras') return s.split('\n').map((l) => l.split(/(\s+)/).reverse().join('')).join('\n');
        if (mode.value === 'linhas') return s.split('\n').reverse().join('\n');
        if (mode.value === 'cada') return s.split('\n').map((l) => l.split(/(\s+)/).map((w) => Array.from(w).reverse().join('')).join('')).join('\n');
        return Array.from(s).map((c) => UPSIDE[c] || UPSIDE[c.toLowerCase()] || c).reverse().join('');
      }, { sample: 'Gooners: ferramentas que resolvem!', prefill: true, controls: (run) => (mode = sel([['letras', 'Inverter letras'], ['palavras', 'Inverter ordem das palavras'], ['cada', 'Inverter cada palavra'], ['linhas', 'Inverter ordem das linhas'], ['cabeca', 'De cabeça para baixo']], { onchange: run })) });
    } });

  add({ id: 'contador-caracteres', name: 'Contador de caracteres', cat: 'texto', icon: 'hash', desc: 'Conte caracteres, palavras, linhas, frases e tempo de leitura.', keys: 'contar palavras letras tamanho texto twitter redacao',
    render(root) {
      const input = area({ placeholder: 'Cole seu texto aqui…', style: 'min-height:220px' });
      const m = h('div', { class: 'metrics' });
      const top = h('div');
      const limits = [['Tweet / X', 280], ['SMS', 160], ['Meta description', 160], ['Título SEO', 60], ['Bio Instagram', 150]];
      function run() {
        const s = input.value;
        const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
        const sentences = (s.match(/[^.!?…]+[.!?…]+/g) || []).length || (s.trim() ? 1 : 0);
        const vals = [
          ['Caracteres', Array.from(s).length], ['Sem espaços', Array.from(s.replace(/\s/g, '')).length], ['Palavras', words.length],
          ['Linhas', s ? s.split('\n').length : 0], ['Parágrafos', s.split(/\n\s*\n/).filter((p) => p.trim()).length], ['Frases', s.trim() ? sentences : 0],
          ['Leitura', Math.max(0, Math.ceil(words.length / 200)) + ' min'], ['Fala', Math.max(0, Math.ceil(words.length / 130)) + ' min'],
        ];
        m.replaceChildren(...vals.map(([k, v]) => h('div', { class: 'metric' }, h('b', null, typeof v === 'number' ? fmt(v, 0) : v), h('span', null, k))));
        const freq = {};
        words.forEach((w) => { w = w.toLowerCase(); if (w.length > 3) freq[w] = (freq[w] || 0) + 1; });
        const list = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const len = Array.from(s).length;
        top.replaceChildren(
          h('div', { class: 'cols-2' },
            h('div', null, h('p', { class: 'hint' }, 'Limites populares'), h('div', { class: 'result-list', style: 'margin-top:8px' },
              limits.map(([n, l]) => h('div', { class: 'result-item' }, h('span', null, n), h('span', { class: 'badge ' + (len <= l ? 'ok' : 'bad') }, `${len}/${l}`))))),
            h('div', null, h('p', { class: 'hint' }, 'Palavras mais frequentes'), h('div', { class: 'result-list', style: 'margin-top:8px' },
              list.length ? list.map(([w, c]) => h('div', { class: 'result-item' }, h('span', null, w), h('b', null, c + '×'))) : h('p', { class: 'hint' }, '—')))));
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, input, m, top));
      run(); setTimeout(() => input.focus(), 50);
    } });

  add({ id: 'maiusculas-minusculas', name: 'Maiúsculas e minúsculas', cat: 'texto', icon: 'case-sensitive', desc: 'MAIÚSCULAS, minúsculas, Título, Frase, aLtErNaDo e mais.', keys: 'caixa alta baixa capitalizar upper lower case camel snake',
    render(root) {
      let mode;
      const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'para', 'por', 'com', 'na', 'no', 'nas', 'nos', 'um', 'uma']);
      textTool(root, (s) => {
        switch (mode.value) {
          case 'upper': return s.toLocaleUpperCase('pt-BR');
          case 'lower': return s.toLocaleLowerCase('pt-BR');
          case 'title': return s.toLocaleLowerCase('pt-BR').replace(/[\p{L}\p{N}]+/gu, (w, i) => (i > 0 && small.has(w) ? w : w[0].toLocaleUpperCase('pt-BR') + w.slice(1)));
          case 'sentence': return s.toLocaleLowerCase('pt-BR').replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, p, c) => p + c.toLocaleUpperCase('pt-BR'));
          case 'alt': { let i = 0; return Array.from(s).map((c) => /\p{L}/u.test(c) ? (i++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c).join(''); }
          case 'invert': return Array.from(s).map((c) => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('');
          case 'camel': return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
          case 'pascal': return stripAccents(s).toLowerCase().replace(/(^|[^a-z0-9]+)(.)/g, (_, __, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
          case 'snake': return slugify(s, '_');
          case 'kebab': return slugify(s, '-');
          case 'constant': return slugify(s, '_').toUpperCase();
          default: return s;
        }
      }, { sample: 'proteção de dados e direito digital no brasil', prefill: true, controls: (run) => (mode = sel([['upper', 'MAIÚSCULAS'], ['lower', 'minúsculas'], ['title', 'Título (Primeira Letra)'], ['sentence', 'Frase (início maiúsculo)'], ['alt', 'aLtErNaDo'], ['invert', 'iNVERTER cAIXA'], ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case'], ['kebab', 'kebab-case'], ['constant', 'CONSTANT_CASE']], { onchange: run })) });
    } });

  add({ id: 'letras-diferentes', name: 'Letras diferentes', cat: 'texto', icon: 'wand-sparkles', desc: 'Gere textos estilizados para Instagram, WhatsApp, Discord e bio.', keys: 'fontes estilizadas negrito italico unicode bio instagram nick',
    render(root) {
      const input = inp({ value: 'Gooners', placeholder: 'Digite seu texto' });
      const list = h('div', { class: 'result-list styled-list' });
      const run = () => list.replaceChildren(...STYLES.map(([n, f]) => resultItem(n, f(input.value || 'Gooners'))));
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, field('Seu texto', input), list));
      run(); setTimeout(() => input.select(), 50);
    } });

  add({ id: 'remover-acentos', name: 'Remover acentos', cat: 'texto', icon: 'remove-formatting', desc: 'Remove acentos e cedilha, mantendo o restante do texto.', keys: 'acentuacao diacriticos cedilha normalizar',
    render(root) { textTool(root, (s) => stripAccents(s).replace(/ç/g, 'c').replace(/Ç/g, 'C'), { sample: 'Ação, coração, pão e informação jurídica', prefill: true }); } });

  add({ id: 'gerador-slug', name: 'Gerador de slug / URL amigável', cat: 'texto', icon: 'link', desc: 'Transforme títulos em URLs amigáveis para SEO.', keys: 'url amigavel seo permalink',
    render(root) {
      let sep;
      textTool(root, (s) => s.split('\n').map((l) => slugify(l, sep.value)).join('\n'), { sample: 'Proteção Patrimonial: O Guia Completo de 2026!', prefill: true, controls: (run) => (sep = sel([['-', 'Separador: hífen (-)'], ['_', 'Separador: underline (_)'], ['.', 'Separador: ponto (.)']], { onchange: run })) });
    } });

  add({ id: 'ordenar-linhas', name: 'Ordenar e limpar linhas', cat: 'texto', icon: 'arrow-down-a-z', desc: 'Ordene, embaralhe, remova duplicadas e linhas vazias.', keys: 'ordem alfabetica duplicadas unicas embaralhar lista',
    render(root) {
      let mode, dedupe, empty, trim;
      textTool(root, (s) => {
        let lines = s.split('\n');
        if (trim.on) lines = lines.map((l) => l.trim());
        if (empty.on) lines = lines.filter((l) => l.trim());
        if (dedupe.on) lines = [...new Set(lines)];
        const coll = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
        switch (mode.value) {
          case 'az': lines.sort(coll.compare); break;
          case 'za': lines.sort((a, b) => coll.compare(b, a)); break;
          case 'len': lines.sort((a, b) => a.length - b.length); break;
          case 'lenr': lines.sort((a, b) => b.length - a.length); break;
          case 'rev': lines.reverse(); break;
          case 'shuffle': lines = shuffle(lines); break;
        }
        return lines.join('\n');
      }, { sample: 'banana\nAbacaxi\nmaçã\n\nbanana\nuva\nlaranja\nUva', prefill: true, controls: (run) => {
        mode = sel([['none', 'Manter ordem'], ['az', 'A → Z'], ['za', 'Z → A'], ['len', 'Menor → maior'], ['lenr', 'Maior → menor'], ['rev', 'Inverter ordem'], ['shuffle', 'Embaralhar']], { onchange: run });
        dedupe = check('Remover duplicadas', true); empty = check('Remover linhas vazias', true); trim = check('Aparar espaços', true);
        [dedupe, empty, trim].forEach((c) => c.input.addEventListener('change', run));
        return h('div', { class: 'row' }, mode, h('div', { class: 'checks auto' }, dedupe.el, empty.el, trim.el));
      } });
    } });

  add({ id: 'remover-espacos', name: 'Remover espaços e quebras', cat: 'texto', icon: 'space', desc: 'Remova espaços duplos, quebras de linha e tabulações.', keys: 'espacos extras quebra de linha limpar texto pdf',
    render(root) {
      let mode;
      textTool(root, (s) => {
        if (mode.value === 'dup') return s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
        if (mode.value === 'lines') return s.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
        if (mode.value === 'pdf') return s.replace(/-\n(\p{Ll})/gu, '$1').replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/[ \t]+/g, ' ').trim();
        return s.replace(/\s+/g, '');
      }, { sample: 'Texto   copiado\nde um PDF   com\nquebras de li-\nnha estranhas.\n\nNovo parágrafo.', prefill: true, controls: (run) => (mode = sel([['dup', 'Remover espaços duplicados'], ['lines', 'Juntar tudo em uma linha'], ['pdf', 'Corrigir texto colado de PDF'], ['all', 'Remover todos os espaços']], { onchange: run })) });
    } });

  add({ id: 'localizar-substituir', name: 'Localizar e substituir', cat: 'texto', icon: 'replace', desc: 'Substitua palavras ou padrões (com suporte a regex).', keys: 'replace trocar palavras regex find',
    render(root) {
      const find = inp({ placeholder: 'Localizar' }), repl = inp({ placeholder: 'Substituir por' });
      const rx = check('Expressão regular'), cs = check('Diferenciar maiúsculas');
      let info;
      const tool = textTool(root, (s) => {
        if (!find.value) { info.textContent = ''; return s; }
        const pattern = rx.on ? find.value : find.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(pattern, cs.on ? 'g' : 'gi');
        const n = (s.match(re) || []).length;
        info.textContent = `${n} ocorrência(s) substituída(s)`;
        return s.replace(re, rx.on ? repl.value : () => repl.value);
      }, { controls: () => {
        info = h('p', { class: 'hint' });
        return h('div', { class: 'stack' }, h('div', { class: 'row' }, find, repl), h('div', { class: 'checks' }, rx.el, cs.el), info);
      } });
      [find, repl].forEach((e) => e.addEventListener('input', tool.run));
      [rx, cs].forEach((c) => c.input.addEventListener('change', tool.run));
    } });

  add({ id: 'comparar-textos', name: 'Comparar textos (diff)', cat: 'texto', icon: 'git-compare', desc: 'Veja linha a linha o que mudou entre duas versões.', keys: 'diferenca diff versoes contrato comparar',
    render(root) {
      const a = area({ placeholder: 'Texto original', value: 'Cláusula 1 — O contratante pagará R$ 1.000.\nCláusula 2 — Prazo de 12 meses.\nCláusula 3 — Foro de São Paulo.' });
      const b = area({ placeholder: 'Texto modificado', value: 'Cláusula 1 — O contratante pagará R$ 1.500.\nCláusula 2 — Prazo de 12 meses.\nCláusula 3 — Foro de São Paulo.\nCláusula 4 — Multa de 10%.' });
      const out = h('div', { class: 'diff' }), sum = h('p', { class: 'hint' });
      function run() {
        const A = a.value.split('\n').slice(0, 3000), B = b.value.split('\n').slice(0, 3000);
        const n = A.length, m = B.length;
        const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        const rows = []; let i = 0, j = 0, ad = 0, de = 0;
        while (i < n && j < m) {
          if (A[i] === B[j]) { rows.push(['eq', A[i]]); i++; j++; }
          else if (L[i + 1][j] >= L[i][j + 1]) { rows.push(['del', A[i++]]); de++; }
          else { rows.push(['add', B[j++]]); ad++; }
        }
        while (i < n) { rows.push(['del', A[i++]]); de++; }
        while (j < m) { rows.push(['add', B[j++]]); ad++; }
        out.replaceChildren(...rows.map(([c, t]) => h('div', { class: c }, t || ' ')));
        sum.innerHTML = `<span class="badge ok">+${ad} adicionada(s)</span> <span class="badge bad">−${de} removida(s)</span>`;
      }
      a.addEventListener('input', run); b.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'cols-2' }, field('Original', a), field('Modificado', b)), sum, out));
      run();
    } });

  add({ id: 'lorem-ipsum', name: 'Gerador de Lorem Ipsum', cat: 'texto', icon: 'pilcrow', desc: 'Texto de preenchimento para layouts e protótipos.', keys: 'texto aleatorio placeholder dummy',
    render(root) {
      const count = inp({ type: 'number', value: 3, min: 1, max: 100 });
      const unit = sel([['p', 'Parágrafos'], ['f', 'Frases'], ['w', 'Palavras']]);
      const start = check('Começar com “Lorem ipsum…”', true);
      const out = area({ readOnly: true, style: 'min-height:260px' });
      const word = () => LOREM[randInt(0, LOREM.length - 1)];
      const sentence = () => { const w = Array.from({ length: randInt(7, 16) }, word); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(' ') + (randInt(0, 6) ? '.' : '?'); };
      const para = () => Array.from({ length: randInt(4, 7) }, sentence).join(' ');
      function run() {
        const n = Math.min(100, Math.max(1, parseInt(count.value, 10) || 1));
        let t = unit.value === 'p' ? Array.from({ length: n }, para).join('\n\n') : unit.value === 'f' ? Array.from({ length: n }, sentence).join(' ') : Array.from({ length: n }, word).join(' ');
        if (start.on) {
          const intro = 'Lorem ipsum dolor sit amet'.split(' ').slice(0, unit.value === 'w' ? Math.min(n, 5) : 5);
          const rest = t.split(' ');
          t = intro.concat(rest.slice(intro.length)).join(' ');
        }
        out.value = t;
      }
      [count, unit].forEach((e) => e.addEventListener('input', run)); start.input.addEventListener('change', run);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Quantidade', count), field('Tipo', unit), h('div', { class: 'auto' }, start.el)),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: run }, 'Gerar novamente'), copyBtn(() => out.value)), out));
      run();
    } });

  add({ id: 'numero-por-extenso', name: 'Número por extenso', cat: 'texto', icon: 'spell-check', desc: 'Escreva números e valores em reais por extenso, ideal para cheques e contratos.', keys: 'extenso cheque contrato valor reais escrever numero',
    render(root) {
      const input = inp({ value: '1.234.567,89', placeholder: 'Ex.: 1.500,00', inputmode: 'decimal' });
      const mode = sel([['moeda', 'Valor em reais (R$)'], ['num', 'Número']]);
      const upper = check('Em maiúsculas');
      const out = h('div', { class: 'out', style: 'font-family:inherit;font-size:1.1rem' });
      function run() {
        try { let t = extenso(input.value, mode.value === 'moeda'); if (upper.on) t = t.toUpperCase(); out.textContent = t || '—'; }
        catch (e) { out.textContent = '⚠ ' + e.message; }
      }
      input.addEventListener('input', run); mode.addEventListener('change', run); upper.input.addEventListener('change', run);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Número', input), field('Formato', mode), h('div', { class: 'auto' }, upper.el)), out,
        h('div', { class: 'toolbar' }, copyBtn(() => out.textContent))));
      run(); setTimeout(() => input.select(), 50);
    } });

  // ---------------- GERADORES ----------------
  add({ id: 'gerador-senha', name: 'Gerador de senha forte', cat: 'geradores', icon: 'key-round', desc: 'Senhas seguras com criptografia do navegador e medidor de força.', keys: 'password segura aleatoria forte',
    render(root) {
      const len = inp({ type: 'range', min: 6, max: 64, value: 16 });
      const lenLabel = h('b');
      const sets = { upper: check('A-Z', true), lower: check('a-z', true), digits: check('0-9', true), sym: check('!@#$', true), amb: check('Evitar ambíguos (Il1O0)') };
      const qty = sel([['1', '1 senha'], ['5', '5 senhas'], ['10', '10 senhas']]);
      const list = h('div', { class: 'result-list' });
      const meter = h('i'), strength = h('span', { class: 'badge' });
      function gen() {
        let pool = '';
        const groups = [];
        const add = (on, s) => { if (on) { if (sets.amb.on) s = s.replace(/[Il1O0o]/g, ''); pool += s; groups.push(s); } };
        add(sets.upper.on, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'); add(sets.lower.on, 'abcdefghijklmnopqrstuvwxyz'); add(sets.digits.on, '0123456789'); add(sets.sym.on, '!@#$%&*()-_=+[]{};:,.?/');
        lenLabel.textContent = len.value;
        if (!pool) { list.replaceChildren(h('p', { class: 'hint' }, 'Selecione ao menos um tipo de caractere.')); return; }
        const L = +len.value;
        const one = () => {
          const chars = groups.map((g) => g[randInt(0, g.length - 1)]);
          while (chars.length < L) chars.push(pool[randInt(0, pool.length - 1)]);
          return shuffle(chars).slice(0, L).join('');
        };
        list.replaceChildren(...Array.from({ length: +qty.value }, () => resultItem(null, one())));
        const bits = Math.round(L * Math.log2(pool.length));
        const [lab, cls, pct, col] = bits < 40 ? ['Fraca', 'bad', 25, 'var(--bad)'] : bits < 64 ? ['Média', 'warn', 50, 'var(--warn)'] : bits < 90 ? ['Forte', 'ok', 78, 'var(--ok)'] : ['Muito forte', 'ok', 100, 'var(--ok)'];
        strength.className = 'badge ' + cls; strength.textContent = `${lab} · ~${bits} bits de entropia`;
        meter.style.width = pct + '%'; meter.style.background = col;
      }
      len.addEventListener('input', gen); qty.addEventListener('change', gen);
      Object.values(sets).forEach((c) => c.input.addEventListener('change', gen));
      root.append(h('div', { class: 'stack' },
        h('label', { class: 'f' }, h('span', null, 'Tamanho: ', lenLabel, ' caracteres'), len),
        h('div', { class: 'checks' }, Object.values(sets).map((c) => c.el)),
        h('div', { class: 'row' }, qty, h('button', { class: 'btn auto', onclick: gen }, '↻ Gerar')),
        h('div', { class: 'meter' }, meter), strength, list,
        h('p', { class: 'hint' }, '🔒 Geradas localmente com crypto.getRandomValues — nada é enviado pela internet.')));
      gen();
    } });

  add({ id: 'gerador-cpf', name: 'Gerador de CPF', cat: 'geradores', icon: 'id-card', desc: 'Gere CPFs válidos para testes de software, por estado.', keys: 'cpf teste dev valido fake',
    render(root) {
      const ufs = [['', 'Qualquer região'], ['0', 'RS'], ['1', 'DF, GO, MS, MT, TO'], ['2', 'AC, AM, AP, PA, RO, RR'], ['3', 'CE, MA, PI'], ['4', 'AL, PB, PE, RN'], ['5', 'BA, SE'], ['6', 'MG'], ['7', 'ES, RJ'], ['8', 'SP'], ['9', 'PR, SC']];
      const uf = sel(ufs), mask = check('Com pontuação', true), qty = sel([['1', '1 CPF'], ['5', '5 CPFs'], ['20', '20 CPFs']]);
      const list = h('div', { class: 'result-list' });
      const gen = () => list.replaceChildren(...Array.from({ length: +qty.value }, () => { const c = genCPF(uf.value); return resultItem(null, mask.on ? cpfMask(c) : c); }));
      uf.addEventListener('change', gen); qty.addEventListener('change', gen); mask.input.addEventListener('change', gen);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Região fiscal', uf), field('Quantidade', qty), h('div', { class: 'auto' }, mask.el), h('button', { class: 'btn auto', onclick: gen }, '↻ Gerar')),
        list, h('p', { class: 'hint' }, '⚠ Números matematicamente válidos, destinados exclusivamente a testes. Não use para fraudes ou cadastros reais.')));
      gen();
    } });

  add({ id: 'gerador-cnpj', name: 'Gerador de CNPJ', cat: 'geradores', icon: 'building-2', desc: 'Gere CNPJs válidos (numéricos ou alfanuméricos) para testes.', keys: 'cnpj teste empresa dev alfanumerico',
    render(root) {
      const mask = check('Com pontuação', true), alfa = check('Formato alfanumérico (novo)'), qty = sel([['1', '1 CNPJ'], ['5', '5 CNPJs'], ['20', '20 CNPJs']]);
      const list = h('div', { class: 'result-list' });
      const gen = () => list.replaceChildren(...Array.from({ length: +qty.value }, () => { const c = genCNPJ(alfa.on); return resultItem(null, mask.on ? cnpjMask(c) : c); }));
      [mask, alfa].forEach((c) => c.input.addEventListener('change', gen)); qty.addEventListener('change', gen);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Quantidade', qty), h('div', { class: 'checks auto' }, mask.el, alfa.el), h('button', { class: 'btn auto', onclick: gen }, '↻ Gerar')),
        list, h('p', { class: 'hint' }, '⚠ Apenas para testes de sistemas. O CNPJ alfanumérico segue a IN RFB nº 2.229/2024.')));
      gen();
    } });

  add({ id: 'gerador-uuid', name: 'Gerador de UUID / GUID', cat: 'geradores', icon: 'fingerprint', desc: 'Identificadores únicos UUID v4 e v7 (ordenável por tempo).', keys: 'guid uuid v4 v7 identificador unico',
    render(root) {
      const ver = sel([['4', 'UUID v4 (aleatório)'], ['7', 'UUID v7 (ordenado por tempo)']]);
      const qty = sel([['1', '1'], ['5', '5'], ['10', '10'], ['50', '50']]);
      const up = check('Maiúsculas'), nohy = check('Sem hífens');
      const list = h('div', { class: 'result-list' });
      function v7() {
        const b = crypto.getRandomValues(new Uint8Array(16));
        const ts = BigInt(Date.now());
        for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
        b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
        const x = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
        return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
      }
      const v4 = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
      function gen() {
        list.replaceChildren(...Array.from({ length: +qty.value }, () => { let u = ver.value === '7' ? v7() : v4(); if (nohy.on) u = u.replace(/-/g, ''); if (up.on) u = u.toUpperCase(); return resultItem(null, u); }));
      }
      [ver, qty].forEach((e) => e.addEventListener('change', gen)); [up, nohy].forEach((c) => c.input.addEventListener('change', gen));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Versão', ver), field('Quantidade', qty), h('div', { class: 'checks auto' }, up.el, nohy.el), h('button', { class: 'btn auto', onclick: gen }, '↻ Gerar')),
        list, h('div', { class: 'toolbar' }, copyBtn(() => Array.from(list.querySelectorAll('.v'), (e) => e.textContent).join('\n'), 'Copiar todos'))));
      gen();
    } });

  add({ id: 'sorteador-numeros', name: 'Sorteador de números', cat: 'geradores', icon: 'dices', desc: 'Sorteie números aleatórios em um intervalo, com ou sem repetição.', keys: 'sorteio aleatorio random rifa bingo loteria',
    render(root) {
      const min = inp({ type: 'number', value: 1 }), max = inp({ type: 'number', value: 60 }), qty = inp({ type: 'number', value: 6, min: 1, max: 1000 });
      const norep = check('Sem repetição', true), sort = check('Ordenar', true);
      const out = h('div', { class: 'out big-out' }, '—');
      function gen() {
        const a = Math.ceil(+min.value), b = Math.floor(+max.value), n = Math.min(1000, Math.max(1, +qty.value | 0));
        if (!(b >= a)) { out.textContent = 'Intervalo inválido'; return; }
        let r;
        if (norep.on) {
          if (n > b - a + 1) { out.textContent = 'Quantidade maior que o intervalo'; return; }
          const set = new Set(); while (set.size < n) set.add(randInt(a, b)); r = [...set];
        } else r = Array.from({ length: n }, () => randInt(a, b));
        if (sort.on) r.sort((x, y) => x - y);
        out.textContent = r.join('  ·  ');
        out.classList.remove('spin'); void out.offsetWidth; out.classList.add('spin');
      }
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Mínimo', min), field('Máximo', max), field('Quantidade', qty)),
        h('div', { class: 'checks' }, norep.el, sort.el), h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: gen }, '🎲 Sortear'),
          h('button', { class: 'btn btn-ghost', onclick: () => { min.value = 1; max.value = 60; qty.value = 6; gen(); } }, 'Mega-Sena'),
          h('button', { class: 'btn btn-ghost', onclick: () => { min.value = 1; max.value = 25; qty.value = 15; gen(); } }, 'Lotofácil'),
          h('button', { class: 'btn btn-ghost', onclick: () => { min.value = 1; max.value = 80; qty.value = 5; gen(); } }, 'Quina'),
          copyBtn(() => out.textContent)), out));
    } });

  add({ id: 'sorteador-nomes', name: 'Sorteador de nomes e times', cat: 'geradores', icon: 'users', desc: 'Sorteie vencedores de uma lista ou divida pessoas em times.', keys: 'sorteio amigo secreto times equipes grupos lista',
    render(root) {
      const names = area({ value: 'Ana\nBruno\nCarla\nDiego\nElisa\nFelipe\nGabriela\nHeitor', placeholder: 'Um nome por linha' });
      const mode = sel([['win', 'Sortear vencedor(es)'], ['teams', 'Dividir em times'], ['order', 'Ordem aleatória']]);
      const n = inp({ type: 'number', value: 1, min: 1 });
      const out = h('div', { class: 'result-list' });
      function go() {
        const list = shuffle(names.value.split('\n').map((s) => s.trim()).filter(Boolean));
        const k = Math.max(1, +n.value | 0);
        if (!list.length) { out.replaceChildren(h('p', { class: 'hint' }, 'Adicione nomes.')); return; }
        if (mode.value === 'win') out.replaceChildren(...list.slice(0, k).map((x, i) => h('div', { class: 'result-item' }, h('span', { class: 'k' }, `${i + 1}º`), h('b', { style: 'flex:1' }, x))));
        else if (mode.value === 'order') out.replaceChildren(...list.map((x, i) => h('div', { class: 'result-item' }, h('span', { class: 'k' }, `${i + 1}º`), h('span', { style: 'flex:1' }, x))));
        else {
          const teams = Array.from({ length: Math.min(k < 2 ? 2 : k, list.length) }, () => []);
          list.forEach((x, i) => teams[i % teams.length].push(x));
          out.replaceChildren(...teams.map((t, i) => h('div', { class: 'result-item' }, h('span', { class: 'k' }, `Time ${i + 1}`), h('span', { style: 'flex:1' }, t.join(', ')))));
        }
        out.classList.remove('spin'); void out.offsetWidth; out.classList.add('spin');
      }
      const nLabel = h('span', null, 'Quantidade');
      mode.addEventListener('change', () => { nLabel.textContent = mode.value === 'teams' ? 'Número de times' : 'Quantidade'; n.value = mode.value === 'teams' ? 2 : 1; });
      root.append(h('div', { class: 'cols-2' }, field('Participantes (um por linha)', names),
        h('div', { class: 'stack' }, field('Modo', mode), h('label', { class: 'f' }, nLabel, n), h('button', { class: 'btn', onclick: go }, '🎉 Sortear'), out)));
    } });

  add({ id: 'cara-ou-coroa', name: 'Cara ou coroa & dados', cat: 'geradores', icon: 'coins', desc: 'Jogue moedas e dados virtuais (D4, D6, D8, D10, D12, D20).', keys: 'moeda dado rpg d20 aleatorio',
    render(root) {
      const out = h('div', { class: 'dice' }, '🪙'), label = h('p', { class: 'big-out', style: 'padding:6px' }, 'Clique para jogar');
      const hist = h('p', { class: 'hint', style: 'text-align:center' });
      const history = [];
      const play = (fn) => () => { const [ico, txt] = fn(); out.textContent = ico; label.textContent = txt; out.classList.remove('spin'); void out.offsetWidth; out.classList.add('spin'); history.unshift(txt); hist.textContent = 'Últimos: ' + history.slice(0, 10).join(' · '); };
      const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      root.append(h('div', { class: 'stack' }, out, label,
        h('div', { class: 'toolbar', style: 'justify-content:center' },
          h('button', { class: 'btn', onclick: play(() => randInt(0, 1) ? ['🙂', 'Cara'] : ['👑', 'Coroa']) }, '🪙 Moeda'),
          ...[4, 6, 8, 10, 12, 20, 100].map((d) => h('button', { class: 'btn btn-ghost', onclick: play(() => { const r = randInt(1, d); return [d === 6 ? faces[r - 1] : '🎲', `D${d}: ${r}`]; }) }, 'D' + d))), hist));
    } });

  add({ id: 'gerador-qrcode', name: 'Gerador de QR Code', cat: 'geradores', icon: 'qr-code', desc: 'Crie QR Codes para links, textos, Wi-Fi e WhatsApp e baixe em PNG.', keys: 'qr code qrcode wifi whatsapp link',
    render(root) {
      const type = sel([['text', 'Texto / Link'], ['wifi', 'Rede Wi-Fi'], ['wa', 'WhatsApp'], ['email', 'E-mail']]);
      const fields = h('div', { class: 'stack' });
      const size = sel([['256', '256 px'], ['384', '384 px'], ['512', '512 px'], ['1024', '1024 px']], { value: '384' });
      const dark = inp({ type: 'color', value: '#0b0d17', style: 'height:44px;padding:4px' });
      const out = h('div', { class: 'qr-out' }, h('p', { style: 'color:#555' }, 'Carregando gerador…'));
      const f = {};
      function build() {
        fields.replaceChildren();
        const mk = (k, label, attrs = {}) => { f[k] = inp({ placeholder: label, ...attrs }); f[k].addEventListener('input', draw); fields.append(field(label, f[k])); };
        if (type.value === 'text') mk('t', 'Texto ou URL', { value: 'https://monolito123.github.io/Gooners/' });
        if (type.value === 'wifi') { mk('ssid', 'Nome da rede (SSID)'); mk('pw', 'Senha'); }
        if (type.value === 'wa') { mk('tel', 'Telefone com DDI e DDD (ex.: 5511999999999)'); mk('msg', 'Mensagem (opcional)'); }
        if (type.value === 'email') { mk('to', 'E-mail'); mk('sub', 'Assunto'); }
        draw();
      }
      const payload = () => {
        const v = (k) => (f[k] && f[k].value) || '';
        const wesc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
        if (type.value === 'wifi') return `WIFI:T:${v('pw') ? 'WPA' : 'nopass'};S:${wesc(v('ssid'))};P:${wesc(v('pw'))};;`;
        if (type.value === 'wa') return `https://wa.me/${onlyDigits(v('tel'))}${v('msg') ? '?text=' + encodeURIComponent(v('msg')) : ''}`;
        if (type.value === 'email') return `mailto:${v('to')}${v('sub') ? '?subject=' + encodeURIComponent(v('sub')) : ''}`;
        return v('t');
      };
      function draw() {
        if (!window.QRCode) return;
        const text = payload();
        out.replaceChildren();
        if (!text) { out.append(h('p', { style: 'color:#555' }, 'Preencha os campos')); return; }
        try { new window.QRCode(out, { text, width: +size.value, height: +size.value, colorDark: dark.value, colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); }
        catch { out.replaceChildren(h('p', { style: 'color:#a00' }, 'Texto longo demais para um QR Code.')); }
      }
      function download() {
        const c = out.querySelector('canvas'); if (!c) return;
        h('a', { href: c.toDataURL('image/png'), download: 'qrcode-gooners.png' }).click();
      }
      type.addEventListener('change', build); size.addEventListener('change', draw); dark.addEventListener('input', draw);
      root.append(h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, field('Tipo', type), fields, h('div', { class: 'row' }, field('Tamanho', size), field('Cor', dark)),
        h('button', { class: 'btn', onclick: download }, '⬇ Baixar PNG')), out));
      build();
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(draw).catch((e) => out.replaceChildren(h('p', { style: 'color:#a00' }, e.message)));
    } });

  // ---------------- VALIDADORES ----------------
  add({ id: 'validador-cpf-cnpj', name: 'Validador de CPF e CNPJ', cat: 'validadores', icon: 'badge-check', desc: 'Confira dígitos verificadores de CPF e CNPJ (inclusive alfanumérico), em lote.', keys: 'validar verificar cpf cnpj digito',
    render(root) {
      const input = area({ placeholder: 'Um documento por linha', value: '529.982.247-25\n111.111.111-11\n11.222.333/0001-81\n12.ABC.345/01DE-35' });
      const out = h('div', { class: 'result-list' });
      function run() {
        out.replaceChildren(...input.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const c = l.toUpperCase().replace(/[^0-9A-Z]/g, '');
          let type = '?', ok = false, fmtd = l;
          if (c.length === 11 && /^\d+$/.test(c)) { type = 'CPF'; ok = cpfValid(c); fmtd = cpfMask(c); }
          else if (c.length === 14) { type = 'CNPJ'; ok = cnpjValid(c); fmtd = cnpjMask(c); }
          return h('div', { class: 'result-item' }, h('span', { class: 'k' }, type), h('code', { style: 'flex:1' }, fmtd), h('span', { class: 'badge ' + (ok ? 'ok' : 'bad') }, ok ? '✓ Válido' : '✗ Inválido'));
        }));
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'cols-2' }, field('Documentos', input), h('div', null, h('p', { class: 'hint', style: 'margin-bottom:8px' }, 'Resultado'), out)));
      run();
    } });

  add({ id: 'validador-cartao', name: 'Validador de cartão de crédito', cat: 'validadores', icon: 'credit-card', desc: 'Verifique o algoritmo de Luhn e identifique a bandeira.', keys: 'cartao credito luhn bandeira visa master elo',
    render(root) {
      const input = inp({ placeholder: '0000 0000 0000 0000', inputmode: 'numeric', value: '4111 1111 1111 1111' });
      const out = h('div', { class: 'result-list' });
      function run() {
        const d = onlyDigits(input.value);
        input.value = d.replace(/(.{4})/g, '$1 ').trim();
        const ok = luhn(d);
        out.replaceChildren(
          h('div', { class: 'result-item' }, h('span', { class: 'k' }, 'Bandeira'), h('b', { style: 'flex:1' }, d ? cardBrand(d) : '—')),
          h('div', { class: 'result-item' }, h('span', { class: 'k' }, 'Dígitos'), h('span', { style: 'flex:1' }, d.length)),
          h('div', { class: 'result-item' }, h('span', { class: 'k' }, 'Luhn'), h('span', { class: 'badge ' + (ok ? 'ok' : 'bad') }, ok ? '✓ Número consistente' : '✗ Número inválido')));
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, field('Número do cartão', input), out, h('p', { class: 'hint' }, '🔒 Verificação apenas matemática e local. Nunca informe dados de cartão em sites desconhecidos.')));
      run();
    } });

  add({ id: 'validador-email', name: 'Validador de e-mails em lote', cat: 'validadores', icon: 'at-sign', desc: 'Valide a sintaxe de listas de e-mail, remova duplicados e extraia de textos.', keys: 'email extrair lista mailing validar',
    render(root) {
      const input = area({ placeholder: 'Cole e-mails ou qualquer texto contendo e-mails', value: 'felipe@gooners.com.br, joao@@exemplo, maria.silva@empresa.com.br\nfulano@ dominio.com' });
      const mode = sel([['validate', 'Validar cada item (separados por vírgula, ; ou linha)'], ['extract', 'Extrair e-mails de um texto']]);
      const out = h('div', { class: 'result-list' }), info = h('p', { class: 'hint' });
      const re = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
      function run() {
        let items;
        if (mode.value === 'extract') items = [...new Set((input.value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase()))];
        else items = input.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        const valid = items.filter((e) => re.test(e) && !e.includes('..'));
        info.textContent = `${valid.length} válido(s) de ${items.length}`;
        out.replaceChildren(...items.map((e) => { const ok = valid.includes(e); return h('div', { class: 'result-item' }, h('code', { style: 'flex:1' }, e), h('span', { class: 'badge ' + (ok ? 'ok' : 'bad') }, ok ? '✓' : '✗')); }));
        out._valid = valid;
      }
      input.addEventListener('input', run); mode.addEventListener('change', run);
      root.append(h('div', { class: 'stack' }, mode, input, h('div', { class: 'toolbar' }, info, h('span', { class: 'spacer' }), copyBtn(() => out._valid.join('\n'), 'Copiar válidos')), out));
      run();
    } });

  add({ id: 'testador-regex', name: 'Testador de expressão regular', cat: 'validadores', icon: 'regex', desc: 'Teste regex com destaque de correspondências e grupos.', keys: 'regex regexp expressao regular padrao dev',
    render(root) {
      const pat = inp({ class: 'inp mono', value: '(\\d{3})\\.(\\d{3})\\.(\\d{3})-(\\d{2})' }), flags = inp({ class: 'inp mono', value: 'g', style: 'max-width:110px' });
      const text = area({ value: 'CPFs: 529.982.247-25 e 123.456.789-09; telefone (11) 99999-0000.' });
      const view = h('div', { class: 'out', style: 'font-family:var(--mono)' }), groups = h('div', { class: 'result-list' }), info = h('p', { class: 'hint' });
      function run() {
        let re;
        try { re = new RegExp(pat.value, flags.value.includes('g') ? flags.value : flags.value + 'g'); }
        catch (e) { info.innerHTML = `<span class="badge bad">${esc(e.message)}</span>`; view.textContent = text.value; groups.replaceChildren(); return; }
        const ms = pat.value ? [...text.value.matchAll(re)].slice(0, 500) : [];
        let html = '', last = 0;
        ms.forEach((m) => { if (m[0] === '') return; html += esc(text.value.slice(last, m.index)) + '<mark class="m">' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; });
        view.innerHTML = html + esc(text.value.slice(last));
        info.innerHTML = `<span class="badge ${ms.length ? 'ok' : 'warn'}">${ms.length} correspondência(s)</span>`;
        groups.replaceChildren(...ms.slice(0, 30).map((m, i) => h('div', { class: 'result-item' }, h('span', { class: 'k' }, `#${i + 1} @${m.index}`),
          h('code', { style: 'flex:1' }, m[0] + (m.length > 1 ? '   ⟶   ' + m.slice(1).map((g, j) => `$${j + 1}=${g ?? '∅'}`).join('  ') : '')))));
      }
      [pat, flags, text].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Padrão', pat), h('label', { class: 'f auto' }, 'Flags', flags)), field('Texto de teste', text), info, view, groups));
      run();
    } });

  // ---------------- CONVERSORES ----------------
  add({ id: 'base64', name: 'Codificar / decodificar Base64', cat: 'conversores', icon: 'binary', desc: 'Converta textos (UTF-8) e arquivos para Base64 e vice-versa.', keys: 'base64 encode decode codificar arquivo imagem',
    render(root) {
      let mode;
      const tool = textTool(root, (s) => (mode.value === 'enc' ? b64enc(s) : b64dec(s)), { sample: 'Olá, Gooners! ✨', prefill: true, controls: (run) => {
        mode = sel([['enc', 'Texto → Base64'], ['dec', 'Base64 → Texto']], { onchange: run });
        const file = h('input', { type: 'file', class: 'inp', onchange: (e) => {
          const fl = e.target.files[0]; if (!fl) return;
          const r = new FileReader();
          r.onload = () => { tool.output.value = r.result; toast('Arquivo convertido em Data URL'); };
          r.readAsDataURL(fl);
        } });
        return h('div', { class: 'row' }, field('Modo', mode), field('…ou converter um arquivo', file));
      } });
    } });

  add({ id: 'url-encode', name: 'Codificar / decodificar URL', cat: 'conversores', icon: 'percent', desc: 'Percent-encoding de URLs e parâmetros de consulta.', keys: 'url encode decode uri percent escape',
    render(root) {
      let mode;
      textTool(root, (s) => (mode.value === 'enc' ? encodeURIComponent(s) : mode.value === 'encu' ? encodeURI(s) : decodeURIComponent(s.replace(/\+/g, ' '))), { sample: 'https://monolito123.github.io/Gooners/busca?q=proteção patrimonial&uf=SP', prefill: true, controls: (run) => (mode = sel([['enc', 'Codificar componente (encodeURIComponent)'], ['encu', 'Codificar URL completa (encodeURI)'], ['dec', 'Decodificar']], { onchange: run })) });
    } });

  add({ id: 'texto-binario', name: 'Texto ↔ binário / hexadecimal', cat: 'conversores', icon: 'cpu', desc: 'Converta texto para binário, hexadecimal, octal ou decimal (UTF-8).', keys: 'binario hex ascii bytes utf8',
    render(root) {
      let mode;
      textTool(root, (s) => {
        const [dir, base] = mode.value.split(':');
        const b = +base, pad = { 2: 8, 8: 3, 16: 2, 10: 0 }[b];
        if (dir === 'to') return Array.from(new TextEncoder().encode(s), (x) => x.toString(b).padStart(pad, '0')).join(' ');
        const parts = s.trim().split(/[\s,]+/).filter(Boolean);
        const bytes = parts.map((p) => { const v = parseInt(p, b); if (isNaN(v) || v > 255) throw new Error(`Valor inválido: ${p}`); return v; });
        return new TextDecoder().decode(new Uint8Array(bytes));
      }, { sample: 'Gooners', prefill: true, controls: (run) => (mode = sel([['to:2', 'Texto → Binário'], ['to:16', 'Texto → Hexadecimal'], ['to:8', 'Texto → Octal'], ['to:10', 'Texto → Decimal'], ['from:2', 'Binário → Texto'], ['from:16', 'Hexadecimal → Texto'], ['from:8', 'Octal → Texto'], ['from:10', 'Decimal → Texto']], { onchange: run })) });
    } });

  add({ id: 'bases-numericas', name: 'Conversor de bases numéricas', cat: 'conversores', icon: 'sigma', desc: 'Decimal, binário, octal, hexadecimal e qualquer base de 2 a 36.', keys: 'binario decimal hexadecimal octal base',
    render(root) {
      const bases = [[2, 'Binário'], [8, 'Octal'], [10, 'Decimal'], [16, 'Hexadecimal'], [36, 'Base 36']];
      const inputs = {};
      const custom = inp({ type: 'number', value: 3, min: 2, max: 36, style: 'max-width:90px' });
      const customOut = inp({ class: 'inp mono' });
      const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
      const toBig = (s, b) => { s = s.trim().toLowerCase().replace(/^0[xbo]/, ''); if (!s) return null; let n = 0n; for (const ch of s) { const d = digits.indexOf(ch); if (d < 0 || d >= b) throw 0; n = n * BigInt(b) + BigInt(d); } return n; };
      function from(srcBase, val) {
        let n;
        try { n = toBig(val, srcBase); } catch { inputs[srcBase].style.borderColor = 'var(--bad)'; return; }
        inputs[srcBase].style.borderColor = '';
        for (const [b] of bases) if (b !== srcBase) inputs[b].value = n == null ? '' : n.toString(b).toUpperCase();
        const cb = Math.min(36, Math.max(2, +custom.value | 0));
        customOut.value = n == null ? '' : n.toString(cb).toUpperCase();
      }
      root.append(h('div', { class: 'stack' }, ...bases.map(([b, n]) => { inputs[b] = inp({ class: 'inp mono', placeholder: n }); inputs[b].addEventListener('input', () => from(b, inputs[b].value)); return field(`${n} (base ${b})`, inputs[b]); }),
        h('div', { class: 'row' }, h('label', { class: 'f auto' }, 'Base personalizada', custom), field('Resultado', customOut))));
      custom.addEventListener('input', () => from(10, inputs[10].value));
      inputs[10].value = '2026'; from(10, '2026');
    } });

  add({ id: 'conversor-unidades', name: 'Conversor de unidades', cat: 'conversores', icon: 'ruler', desc: 'Comprimento, massa, área, volume, velocidade, dados, tempo e temperatura.', keys: 'metro quilo litro celsius fahrenheit hectare alqueire byte unidade medida',
    render(root) {
      const cat = sel(Object.keys(UNITS)), val = inp({ type: 'number', value: 1 }), from = sel([]), to = sel([]);
      const out = h('div', { class: 'out big-out' }), table = h('div', { class: 'result-list' });
      function fill() {
        const u = Object.keys(UNITS[cat.value].u);
        from.replaceChildren(...u.map((x) => h('option', { value: x }, x)));
        to.replaceChildren(...u.map((x) => h('option', { value: x }, x)));
        to.selectedIndex = Math.min(1, u.length - 1);
        run();
      }
      const conv = (v, a, b) => { const c = UNITS[cat.value]; return c.temp ? convTemp(v, a, b) : v * c.u[a] / c.u[b]; };
      function run() {
        const v = parseFloat(val.value);
        if (isNaN(v)) { out.textContent = '—'; return; }
        out.textContent = `${fmt(v, 6)} ${from.value} = ${fmt(conv(v, from.value, to.value), 8)} ${to.value}`;
        table.replaceChildren(...Object.keys(UNITS[cat.value].u).filter((x) => x !== from.value).map((x) => resultItem(x, fmt(conv(v, from.value, x), 10))));
      }
      cat.addEventListener('change', fill); [val, from, to].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Grandeza', cat), field('Valor', val), field('De', from),
        h('button', { class: 'btn btn-ghost auto', onclick: () => { const t = from.value; from.value = to.value; to.value = t; run(); } }, '⇄'), field('Para', to)), out, table));
      fill();
    } });

  add({ id: 'conversor-cores', name: 'Conversor de cores', cat: 'conversores', icon: 'palette', desc: 'HEX, RGB e HSL com seletor visual, contraste e paleta de tons.', keys: 'cor hex rgb hsl paleta css contraste',
    render(root) {
      const picker = inp({ type: 'color', value: '#7c5cff', style: 'height:56px;padding:4px' });
      const hex = inp({ class: 'inp mono' }), rgb = inp({ class: 'inp mono' }), hsl = inp({ class: 'inp mono' });
      const sw = h('div', { class: 'swatches' }), contrast = h('div', { class: 'result-list' });
      const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      function set(r, g, b, src) {
        const hx = rgbToHex(r, g, b), [H, S, L] = rgbToHsl(r, g, b);
        if (src !== 'hex') hex.value = hx.toUpperCase();
        if (src !== 'rgb') rgb.value = `rgb(${r}, ${g}, ${b})`;
        if (src !== 'hsl') hsl.value = `hsl(${H}, ${S}%, ${L}%)`;
        if (src !== 'picker') picker.value = hx;
        sw.replaceChildren(...[95, 85, 72, 60, 50, 40, 30, 20, 10].map((l) => { const c = rgbToHex(...hslToRgb(H, S, l)); return h('div', { class: 'swatch', style: `background:${c};color:${l > 55 ? '#000' : '#fff'}`, title: 'Copiar', onclick: () => copy(c) }, c); }));
        const L1 = lum(r, g, b);
        contrast.replaceChildren(...[['Texto branco', 1], ['Texto preto', 0]].map(([n, w]) => {
          const L2 = w ? 1 : 0, ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
          return h('div', { class: 'result-item', style: `background:${hx};color:${w ? '#fff' : '#000'}` }, h('b', { style: 'flex:1' }, n), h('span', { class: 'badge ' + (ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'warn' : 'bad') }, `${ratio.toFixed(2)}:1 ${ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA grande' : 'Reprovado'}`));
        }));
      }
      picker.addEventListener('input', () => set(...hexToRgb(picker.value), 'picker'));
      hex.addEventListener('input', () => { const c = hexToRgb(hex.value); if (c) set(...c, 'hex'); });
      rgb.addEventListener('input', () => { const m = rgb.value.match(/(\d+)\D+(\d+)\D+(\d+)/); if (m) set(...m.slice(1, 4).map((x) => Math.min(255, +x)), 'rgb'); });
      hsl.addEventListener('input', () => { const m = hsl.value.match(/(\d+)\D+(\d+)\D+(\d+)/); if (m) set(...hslToRgb(+m[1], +m[2], +m[3]), 'hsl'); });
      root.append(h('div', { class: 'stack' }, picker, h('div', { class: 'row' }, field('HEX', hex), field('RGB', rgb), field('HSL', hsl)),
        h('p', { class: 'hint' }, 'Tons (clique para copiar)'), sw, h('p', { class: 'hint' }, 'Contraste WCAG'), contrast));
      set(124, 92, 255);
    } });

  add({ id: 'codigo-morse', name: 'Tradutor de código Morse', cat: 'conversores', icon: 'radio', desc: 'Converta texto em Morse e Morse em texto — e ouça o som.', keys: 'morse telegrafo sos audio',
    render(root) {
      let mode;
      const tool = textTool(root, (s) => {
        if (mode.value === 'to') return stripAccents(s).toUpperCase().split(/\n/).map((l) => l.split(/\s+/).filter(Boolean).map((w) => Array.from(w).map((c) => MORSE[c] || '').filter(Boolean).join(' ')).join(' / ')).join('\n');
        return s.trim().split(/\s*\/\s*|\s{3,}/).map((w) => w.split(/\s+/).map((c) => MORSE_REV[c.replace(/[—–_]/g, '-').replace(/[•·]/g, '.')] || '').join('')).join(' ');
      }, { sample: 'SOS Gooners', prefill: true, controls: (run) => {
        mode = sel([['to', 'Texto → Morse'], ['from', 'Morse → Texto']], { onchange: run });
        return h('div', { class: 'row' }, mode, h('button', { class: 'btn btn-ghost auto', onclick: play }, '🔊 Ouvir'));
      } });
      function play() {
        const code = mode.value === 'to' ? tool.output.value : tool.input.value;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.frequency.value = 650; osc.connect(g); g.connect(ctx.destination); g.gain.value = 0;
        const u = .08; let t = ctx.currentTime + .05;
        for (const c of code) {
          if (c === '.' || c === '-') { g.gain.setValueAtTime(.3, t); t += c === '.' ? u : 3 * u; g.gain.setValueAtTime(0, t); t += u; }
          else if (c === ' ') t += 2 * u; else if (c === '/') t += 4 * u;
        }
        osc.start(); osc.stop(t + .1); osc.onended = () => ctx.close();
      }
    } });

  add({ id: 'timestamp-unix', name: 'Conversor de timestamp Unix', cat: 'conversores', icon: 'clock', desc: 'Converta timestamps Unix (s/ms) em datas legíveis e vice-versa.', keys: 'epoch unix timestamp data hora iso',
    render(root) {
      const now = h('div', { class: 'out big-out' });
      const ts = inp({ class: 'inp mono', value: String(Math.floor(Date.now() / 1000)) });
      const dt = inp({ type: 'datetime-local', step: 1 });
      const out = h('div', { class: 'result-list' });
      const tick = setInterval(() => { if (!now.isConnected) return clearInterval(tick); now.textContent = Math.floor(Date.now() / 1000); }, 1000);
      now.textContent = Math.floor(Date.now() / 1000);
      function show(d) {
        if (isNaN(d)) { out.replaceChildren(h('p', { class: 'hint' }, 'Data inválida')); return; }
        out.replaceChildren(resultItem('Local', d.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'medium' })), resultItem('UTC', d.toUTCString()), resultItem('ISO 8601', d.toISOString()),
          resultItem('Segundos', Math.floor(d / 1000)), resultItem('Milissegundos', +d), resultItem('Relativo', rel(d)));
      }
      const rel = (d) => { const s = Math.round((d - Date.now()) / 1000), r = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }); const a = Math.abs(s);
        return a < 60 ? r.format(s, 'second') : a < 3600 ? r.format(Math.round(s / 60), 'minute') : a < 86400 ? r.format(Math.round(s / 3600), 'hour') : a < 2592000 ? r.format(Math.round(s / 86400), 'day') : a < 31536000 ? r.format(Math.round(s / 2592000), 'month') : r.format(Math.round(s / 31536000), 'year'); };
      ts.addEventListener('input', () => { const n = +ts.value.trim(); show(new Date(ts.value.trim().length > 11 ? n : n * 1000)); });
      dt.addEventListener('input', () => { const d = new Date(dt.value); ts.value = Math.floor(d / 1000); show(d); });
      root.append(h('div', { class: 'stack' }, h('p', { class: 'hint', style: 'text-align:center' }, 'Timestamp atual'), now,
        h('div', { class: 'row' }, field('Timestamp (s ou ms)', ts), field('…ou escolha uma data', dt)), out));
      ts.dispatchEvent(new Event('input'));
    } });

  // ---------------- CALCULADORAS ----------------
  add({ id: 'calculadora-porcentagem', name: 'Calculadora de porcentagem', cat: 'calculadoras', icon: 'badge-percent', desc: 'X% de Y, variação percentual, aumentos e descontos.', keys: 'porcentagem percentual desconto aumento variacao',
    render(root) {
      const block = (title, a, b, calc, la, lb) => {
        const x = inp({ value: a, inputmode: 'decimal' }), y = inp({ value: b, inputmode: 'decimal' }), r = h('div', { class: 'out big-out', style: 'font-size:1.4rem;padding:14px' });
        const run = () => { const vx = num(x.value), vy = num(y.value); r.textContent = isNaN(vx) || isNaN(vy) ? '—' : calc(vx, vy); };
        x.addEventListener('input', run); y.addEventListener('input', run); run();
        return h('div', { class: 'card', style: 'padding:16px;box-shadow:none' }, h('b', null, title), h('div', { class: 'row', style: 'margin:10px 0' }, field(la, x), field(lb, y)), r);
      };
      root.append(h('div', { class: 'cols-2' },
        block('Quanto é X% de Y?', '15', '2.500', (x, y) => fmt(x / 100 * y, 4), 'X (%)', 'Y'),
        block('X é quantos % de Y?', '450', '3.000', (x, y) => y ? fmt(x / y * 100, 4) + '%' : '—', 'X', 'Y'),
        block('Variação de X para Y', '1.200', '1.500', (x, y) => x ? (y >= x ? '+' : '') + fmt((y - x) / x * 100, 4) + '%' : '—', 'Valor inicial', 'Valor final'),
        block('Aplicar aumento/desconto', '1.000', '-10', (x, y) => fmt(x * (1 + y / 100), 4), 'Valor', '% (use − para desconto)')));
    } });

  add({ id: 'calculadora-idade', name: 'Calculadora de idade', cat: 'calculadoras', icon: 'cake', desc: 'Idade exata em anos, meses e dias, e contagem para o próximo aniversário.', keys: 'idade aniversario nascimento anos',
    render(root) {
      const birth = inp({ type: 'date', value: '1990-05-15' }), ref = inp({ type: 'date', value: todayISO() });
      const out = h('div', { class: 'metrics' }), big = h('div', { class: 'out big-out' });
      function run() {
        const a = parseDate(birth.value), b = parseDate(ref.value);
        if (!a || !b || a > b) { big.textContent = 'Informe datas válidas'; out.replaceChildren(); return; }
        const { y, m, d } = ymdDiff(a, b);
        big.textContent = `${plural(y, 'ano', 'anos')}, ${plural(m, 'mês', 'meses')} e ${plural(d, 'dia', 'dias')}`;
        const days = Math.round((b - a) / 864e5);
        let next = new Date(b.getFullYear(), a.getMonth(), a.getDate());
        if (next < b) next = new Date(b.getFullYear() + 1, a.getMonth(), a.getDate());
        const toNext = Math.round((next - b) / 864e5);
        const signs = ['Capricórnio', 'Aquário', 'Peixes', 'Áries', 'Touro', 'Gêmeos', 'Câncer', 'Leão', 'Virgem', 'Libra', 'Escorpião', 'Sagitário', 'Capricórnio'];
        const cut = [20, 19, 20, 20, 21, 21, 22, 23, 23, 23, 22, 22];
        const sign = signs[a.getDate() >= cut[a.getMonth()] ? a.getMonth() + 1 : a.getMonth()];
        out.replaceChildren(...[[fmt(days, 0), 'dias vividos'], [fmt(days / 7, 0), 'semanas'], [fmt(y * 12 + m, 0), 'meses'], [fmt(days * 24, 0), 'horas (aprox.)'],
          [toNext === 0 ? '🎉 Hoje!' : toNext, 'dias p/ aniversário'], [a.toLocaleDateString('pt-BR', { weekday: 'long' }), 'dia em que nasceu'], [sign, 'signo']].map(([v, k]) => h('div', { class: 'metric' }, h('b', null, v), h('span', null, k))));
      }
      [birth, ref].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Data de nascimento', birth), field('Calcular na data', ref)), big, out));
      run();
    } });

  add({ id: 'diferenca-datas', name: 'Diferença entre datas e prazos', cat: 'calculadoras', icon: 'calendar-range', desc: 'Dias corridos e úteis entre datas, ou some dias a uma data (prazos).', keys: 'datas dias uteis prazo corridos calendario somar dias',
    render(root) {
      const a = inp({ type: 'date', value: todayISO() }), b = inp({ type: 'date' });
      const d0 = new Date(); d0.setDate(d0.getDate() + 30); b.value = new Date(d0 - d0.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      const out = h('div', { class: 'metrics' });
      const base = inp({ type: 'date', value: todayISO() }), n = inp({ type: 'number', value: 15 }), kind = sel([['c', 'Dias corridos'], ['u', 'Dias úteis']]);
      const out2 = h('div', { class: 'out big-out', style: 'font-size:1.3rem' });
      const fer = check('Descontar feriados nacionais', true), fac = check('Incluir Carnaval e Corpus Christi');
      const hcache = {};
      const isHoliday = (d) => { const y = d.getFullYear(), k = y + ':' + fac.on; if (!hcache[k]) hcache[k] = new Set(holidays(y, fac.on).map((x) => dkey(x[0]))); return hcache[k].has(dkey(d)); };
      const isBiz = (d) => d.getDay() % 6 !== 0 && !(fer.on && isHoliday(d));
      function run() {
        const x = parseDate(a.value), y = parseDate(b.value);
        if (!x || !y) return;
        const [s, e] = x <= y ? [x, y] : [y, x];
        const days = Math.round((e - s) / 864e5);
        let biz = 0; for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) if (isBiz(d)) biz++;
        const { y: yy, m, d } = ymdDiff(s, e);
        out.replaceChildren(...[[fmt(days, 0), 'dias corridos'], [fmt(biz, 0), fer.on ? 'dias úteis (sem feriados)' : 'dias úteis (seg–sex)'], [fmt(days / 7, 1), 'semanas'], [`${yy}a ${m}m ${d}d`, 'anos/meses/dias']].map(([v, k]) => h('div', { class: 'metric' }, h('b', null, v), h('span', null, k))));
      }
      function run2() {
        const d = parseDate(base.value); let k = parseInt(n.value, 10);
        if (!d || isNaN(k)) return;
        const step = k < 0 ? -1 : 1; k = Math.abs(k);
        if (kind.value === 'c') d.setDate(d.getDate() + step * k);
        else while (k > 0) { d.setDate(d.getDate() + step); if (isBiz(d)) k--; }
        out2.textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      }
      [a, b].forEach((e) => e.addEventListener('input', run)); [base, n, kind].forEach((e) => e.addEventListener('input', run2));
      [fer, fac].forEach((c) => c.input.addEventListener('change', () => { run(); run2(); }));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'checks' }, fer.el, fac.el), h('b', null, 'Diferença entre duas datas'), h('div', { class: 'row' }, field('Data inicial', a), field('Data final', b)), out,
        h('hr', { style: 'border:0;border-top:1px solid var(--border);width:100%' }),
        h('b', null, 'Somar/subtrair dias (contagem de prazo)'), h('div', { class: 'row' }, field('A partir de', base), field('Dias (negativo subtrai)', n), field('Tipo', kind)), out2,
        h('p', { class: 'hint' }, 'Feriados estaduais, municipais e suspensões forenses não são considerados. Para prazos processuais (CPC, art. 219), confira o calendário do tribunal.')));
      run(); run2();
    } });

  add({ id: 'regra-de-tres', name: 'Regra de três', cat: 'calculadoras', icon: 'divide', desc: 'Regra de três simples, direta e inversa.', keys: 'proporcao regra de tres matematica',
    render(root) {
      const A = inp({ value: '2', inputmode: 'decimal' }), B = inp({ value: '10', inputmode: 'decimal' }), C = inp({ value: '5', inputmode: 'decimal' });
      const kind = sel([['d', 'Diretamente proporcional'], ['i', 'Inversamente proporcional']]);
      const X = h('div', { class: 'out big-out' });
      const run = () => { const a = num(A.value), b = num(B.value), c = num(C.value); const x = kind.value === 'd' ? b * c / a : a * b / c; X.textContent = isFinite(x) ? 'X = ' + fmt(x, 6) : '—'; };
      [A, B, C, kind].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, kind, h('div', { class: 'row' }, field('Se A', A), field('corresponde a B', B)), h('div', { class: 'row' }, field('então C', C), field('corresponde a', inp({ value: 'X', disabled: true }))), X));
      run();
    } });

  add({ id: 'juros-compostos', name: 'Calculadora de juros compostos', cat: 'calculadoras', icon: 'trending-up', desc: 'Simule investimentos com aporte inicial, aportes mensais e taxa de juros.', keys: 'investimento juros compostos rendimento aporte poupanca',
    render(root) {
      const ini = inp({ value: '10.000', inputmode: 'decimal' }), mon = inp({ value: '500', inputmode: 'decimal' }), rate = inp({ value: '10', inputmode: 'decimal' });
      const per = sel([['a', '% ao ano'], ['m', '% ao mês']]), months = inp({ type: 'number', value: 120 });
      const out = h('div', { class: 'metrics' }), chart = h('div', { style: 'display:flex;align-items:flex-end;gap:2px;height:160px;padding:8px;border-radius:12px;background:var(--surface-2)' });
      function run() {
        const P = num(ini.value) || 0, A = num(mon.value) || 0, r0 = (num(rate.value) || 0) / 100, n = Math.min(1200, Math.max(1, +months.value | 0));
        const i = per.value === 'a' ? (1 + r0) ** (1 / 12) - 1 : r0;
        let bal = P; const pts = [];
        for (let k = 1; k <= n; k++) { bal = bal * (1 + i) + A; pts.push(bal); }
        const invested = P + A * n;
        out.replaceChildren(...[[brl(bal), 'Montante final'], [brl(invested), 'Total investido'], [brl(bal - invested), 'Juros ganhos'], [fmt(i * 100, 4) + '%', 'Taxa mensal equiv.']].map(([v, k]) => h('div', { class: 'metric' }, h('b', { style: 'font-size:1.15rem' }, v), h('span', null, k))));
        const step = Math.max(1, Math.ceil(n / 60)), max = bal || 1;
        chart.replaceChildren(...pts.filter((_, k) => k % step === step - 1 || k === n - 1).map((v, k, arr) => {
          const inv = P + A * Math.min(n, (k + 1) * step);
          return h('div', { title: brl(v), style: `flex:1;height:${(v / max) * 100}%;background:linear-gradient(to top, var(--accent) ${(inv / v) * 100}%, var(--accent-2) ${(inv / v) * 100}%);border-radius:3px 3px 0 0;min-width:2px` });
        }));
      }
      [ini, mon, rate, per, months].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Valor inicial (R$)', ini), field('Aporte mensal (R$)', mon), field('Taxa de juros', rate), field('Período da taxa', per), field('Prazo (meses)', months)),
        out, chart, h('p', { class: 'hint' }, 'Roxo = valor investido · Azul = juros acumulados. Simulação sem impostos ou taxas.')));
      run();
    } });

  add({ id: 'calculadora-imc', name: 'Calculadora de IMC', cat: 'calculadoras', icon: 'heart-pulse', desc: 'Índice de massa corporal com faixa de classificação da OMS.', keys: 'imc peso altura saude massa corporal',
    render(root) {
      const w = inp({ value: '75', inputmode: 'decimal' }), ht = inp({ value: '1,78', inputmode: 'decimal' });
      const out = h('div', { class: 'out big-out' }), cls = h('div', { style: 'text-align:center' });
      function run() {
        let hh = num(ht.value); if (hh > 3) hh /= 100;
        const imc = num(w.value) / (hh * hh);
        if (!isFinite(imc) || imc <= 0) { out.textContent = '—'; cls.replaceChildren(); return; }
        out.textContent = 'IMC ' + fmt(imc, 1);
        const [t, c] = imc < 18.5 ? ['Abaixo do peso', 'warn'] : imc < 25 ? ['Peso normal', 'ok'] : imc < 30 ? ['Sobrepeso', 'warn'] : imc < 35 ? ['Obesidade grau I', 'bad'] : imc < 40 ? ['Obesidade grau II', 'bad'] : ['Obesidade grau III', 'bad'];
        cls.replaceChildren(h('span', { class: 'badge ' + c }, t), h('p', { class: 'hint' }, `Peso saudável para sua altura: ${fmt(18.5 * hh * hh, 1)} a ${fmt(24.9 * hh * hh, 1)} kg`));
      }
      [w, ht].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Peso (kg)', w), field('Altura (m)', ht)), out, cls, h('p', { class: 'hint' }, 'O IMC é um indicador geral e não substitui avaliação médica.')));
      run();
    } });

  // ---------------- DEV ----------------
  add({ id: 'formatador-json', name: 'Formatador e validador JSON', cat: 'dev', icon: 'braces', desc: 'Formate, minifique, valide e ordene chaves de JSON.', keys: 'json pretty print minify validar beautify',
    render(root) {
      let mode, indent;
      const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
      const tool = textTool(root, (s) => {
        if (!s.trim()) return '';
        let v;
        try { v = JSON.parse(s); } catch (e) { throw new Error('JSON inválido — ' + e.message); }
        if (mode.value === 'sort') v = sortKeys(v);
        return mode.value === 'min' ? JSON.stringify(v) : JSON.stringify(v, null, indent.value === 't' ? '\t' : +indent.value);
      }, { sample: '{"empresa":"Gooners","ferramentas":42,"categorias":["texto","dev"],"ativo":true,"meta":{"z":1,"a":2}}', prefill: true, controls: (run) => {
        mode = sel([['fmt', 'Formatar'], ['min', 'Minificar'], ['sort', 'Formatar e ordenar chaves']], { onchange: run });
        indent = sel([['2', '2 espaços'], ['4', '4 espaços'], ['t', 'Tabulação']], { onchange: run });
        return h('div', { class: 'row' }, mode, indent);
      } });
      tool.input.classList.add('mono'); tool.output.classList.add('mono');
    } });

  add({ id: 'gerador-hash', name: 'Gerador de hash (MD5, SHA)', cat: 'dev', icon: 'lock', desc: 'Calcule MD5, SHA-1, SHA-256, SHA-384 e SHA-512 de textos.', keys: 'hash md5 sha256 sha1 checksum criptografia',
    render(root) {
      const input = area({ value: 'Gooners', placeholder: 'Texto' });
      const out = h('div', { class: 'result-list' });
      async function run() {
        const s = input.value;
        const rows = [['MD5', md5(s)]];
        for (const a of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) rows.push([a, crypto.subtle ? await sha(a, s) : 'Requer HTTPS']);
        if (s !== input.value) return;
        out.replaceChildren(...rows.map(([k, v]) => resultItem(k, v)));
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, input, out, h('p', { class: 'hint' }, 'MD5 e SHA-1 não são seguros para senhas; prefira bcrypt/Argon2 em produção.')));
      run();
    } });

  add({ id: 'decodificador-jwt', name: 'Decodificador de JWT', cat: 'dev', icon: 'key-square', desc: 'Inspecione header, payload e expiração de tokens JWT.', keys: 'jwt token json web token decode bearer',
    render(root) {
      const sample = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ikdvb25lcnMiLCJpYXQiOjE3NjAwMDAwMDAsImV4cCI6MTk5MDAwMDAwMH0.c2lnbmF0dXJl';
      const input = area({ class: 'inp mono', value: sample, style: 'min-height:110px' });
      const hd = h('pre', { class: 'out' }), pl = h('pre', { class: 'out' }), info = h('div', { class: 'toolbar' });
      function run() {
        const parts = input.value.trim().replace(/^Bearer\s+/i, '').split('.');
        try {
          if (parts.length < 2) throw new Error('Token deve ter 3 partes separadas por ponto');
          const H = JSON.parse(b64dec(parts[0])), P = JSON.parse(b64dec(parts[1]));
          hd.textContent = JSON.stringify(H, null, 2); pl.textContent = JSON.stringify(P, null, 2);
          const badges = [];
          if (P.exp) { const exp = new Date(P.exp * 1000); badges.push(h('span', { class: 'badge ' + (exp > new Date() ? 'ok' : 'bad') }, (exp > new Date() ? 'Válido até ' : 'Expirou em ') + exp.toLocaleString('pt-BR'))); }
          if (P.iat) badges.push(h('span', { class: 'badge warn' }, 'Emitido em ' + new Date(P.iat * 1000).toLocaleString('pt-BR')));
          badges.push(h('span', { class: 'badge warn' }, 'Assinatura não verificada'));
          info.replaceChildren(...badges);
        } catch (e) { hd.textContent = pl.textContent = ''; info.replaceChildren(h('span', { class: 'badge bad' }, '⚠ ' + e.message)); }
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, field('Token JWT', input), info, h('div', { class: 'cols-2' }, field('Header', hd), field('Payload', pl))));
      run();
    } });

  add({ id: 'escapar-html', name: 'Escapar / desescapar HTML', cat: 'dev', icon: 'code-xml', desc: 'Converta caracteres especiais em entidades HTML e vice-versa.', keys: 'html entities escape unescape entidades',
    render(root) {
      let mode;
      textTool(root, (s) => { if (mode.value === 'enc') return esc(s); const t = document.createElement('textarea'); t.innerHTML = s; return t.value; },
        { sample: '<p class="x">Tom & Jerry — "olá"</p>', prefill: true, controls: (run) => (mode = sel([['enc', 'Escapar (texto → entidades)'], ['dec', 'Desescapar (entidades → texto)']], { onchange: run })) });
    } });

  // ---------------- TEMPO ----------------
  add({ id: 'cronometro', name: 'Cronômetro online', cat: 'tempo', icon: 'timer', desc: 'Cronômetro preciso com voltas (laps).', keys: 'cronometro stopwatch tempo voltas',
    render(root) {
      const clock = h('div', { class: 'clock' }, '00:00.00'), laps = h('div', { class: 'result-list' });
      let start = 0, acc = 0, raf = 0, running = false, lapN = 0, lastLap = 0;
      const f = (ms) => { const m = Math.floor(ms / 6e4), s = Math.floor(ms / 1e3) % 60, c = Math.floor(ms / 10) % 100, hh = Math.floor(m / 60); return (hh ? hh + ':' : '') + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0'); };
      const now = () => acc + (running ? performance.now() - start : 0);
      const loop = () => { if (!clock.isConnected) return; clock.textContent = f(now()); raf = requestAnimationFrame(loop); };
      const btn = h('button', { class: 'btn', onclick: () => { if (running) { acc = now(); running = false; cancelAnimationFrame(raf); btn.textContent = '▶ Continuar'; } else { start = performance.now(); running = true; loop(); btn.textContent = '⏸ Pausar'; } } }, '▶ Iniciar');
      root.append(h('div', { class: 'stack' }, clock, h('div', { class: 'toolbar', style: 'justify-content:center' }, btn,
        h('button', { class: 'btn btn-ghost', onclick: () => { if (!now()) return; const t = now(); lapN++; laps.prepend(h('div', { class: 'result-item' }, h('span', { class: 'k' }, 'Volta ' + lapN), h('code', { style: 'flex:1' }, f(t - lastLap)), h('code', null, f(t)))); lastLap = t; } }, '⚑ Volta'),
        h('button', { class: 'btn btn-ghost', onclick: () => { running = false; acc = 0; lapN = 0; lastLap = 0; cancelAnimationFrame(raf); clock.textContent = f(0); laps.replaceChildren(); btn.textContent = '▶ Iniciar'; } }, '↺ Zerar')), laps));
    } });

  add({ id: 'timer-pomodoro', name: 'Timer e Pomodoro', cat: 'tempo', icon: 'alarm-clock', desc: 'Contagem regressiva com alarme sonoro e ciclos Pomodoro.', keys: 'timer temporizador pomodoro contagem regressiva alarme foco',
    render(root) {
      const mins = inp({ type: 'number', value: 25, min: 0 }), secs = inp({ type: 'number', value: 0, min: 0, max: 59 });
      const clock = h('div', { class: 'clock' }), status = h('p', { class: 'hint', style: 'text-align:center' });
      let end = 0, left = 25 * 60e3, timer = 0;
      const f = (ms) => { const t = Math.ceil(ms / 1000); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
      const show = () => { clock.textContent = f(left); document.title = timer ? `${f(left)} · Gooners` : document.title; };
      function beep() {
        try { const ctx = new AudioContext(); [0, .35, .7].forEach((d) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.3, ctx.currentTime + d); g.gain.setValueAtTime(0, ctx.currentTime + d + .2); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .25); }); } catch {}
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
      function stop() { clearInterval(timer); timer = 0; startBtn.textContent = '▶ Iniciar'; }
      const startBtn = h('button', { class: 'btn', onclick: () => {
        if (timer) { stop(); return; }
        if (left <= 0) left = ((+mins.value || 0) * 60 + (+secs.value || 0)) * 1000;
        end = Date.now() + left; startBtn.textContent = '⏸ Pausar';
        timer = setInterval(() => { if (!clock.isConnected) return stop(); left = Math.max(0, end - Date.now()); show(); if (!left) { stop(); beep(); status.textContent = '⏰ Tempo esgotado!'; } }, 200);
      } }, '▶ Iniciar');
      const set = (m) => { stop(); mins.value = m; secs.value = 0; left = m * 60e3; status.textContent = ''; show(); };
      [mins, secs].forEach((e) => e.addEventListener('input', () => { stop(); left = ((+mins.value || 0) * 60 + (+secs.value || 0)) * 1000; show(); }));
      root.append(h('div', { class: 'stack' }, clock, status, h('div', { class: 'toolbar', style: 'justify-content:center' }, startBtn, h('button', { class: 'btn btn-ghost', onclick: () => set(+mins.value || 0) }, '↺ Reiniciar')),
        h('div', { class: 'toolbar', style: 'justify-content:center' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => set(25) }, '🍅 Foco 25 min'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => set(5) }, '☕ Pausa 5 min'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => set(15) }, '🛋 Pausa longa 15 min')),
        h('div', { class: 'row' }, field('Minutos', mins), field('Segundos', secs))));
      show();
    } });

  add({ id: 'relogio-mundial', name: 'Relógio mundial e fusos', cat: 'tempo', icon: 'globe', desc: 'Horário atual em cidades e centros financeiros do mundo.', keys: 'fuso horario relogio mundial timezone hora',
    render(root) {
      const zones = [['São Paulo', 'America/Sao_Paulo'], ['Manaus', 'America/Manaus'], ['Nova York', 'America/New_York'], ['Miami', 'America/New_York'], ['Londres', 'Europe/London'], ['Lisboa', 'Europe/Lisbon'], ['Zurique', 'Europe/Zurich'], ['Luxemburgo', 'Europe/Luxembourg'], ['Dubai', 'Asia/Dubai'], ['Singapura', 'Asia/Singapore'], ['Hong Kong', 'Asia/Hong_Kong'], ['Tóquio', 'Asia/Tokyo'], ['Ilhas Cayman', 'America/Cayman'], ['Ilhas Virgens Brit.', 'America/Tortola'], ['Panamá', 'America/Panama'], ['Sydney', 'Australia/Sydney']];
      const grid = h('div', { class: 'metrics' });
      function tick() {
        if (!grid.isConnected && grid._init) return clearInterval(iv);
        grid._init = true;
        const now = new Date();
        grid.replaceChildren(...zones.map(([n, z]) => {
          const t = now.toLocaleTimeString('pt-BR', { timeZone: z, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const d = now.toLocaleDateString('pt-BR', { timeZone: z, weekday: 'short', day: '2-digit', month: 'short' });
          const hr = +now.toLocaleString('en-US', { timeZone: z, hour: 'numeric', hour12: false }) % 24;
          return h('div', { class: 'metric' }, h('span', null, (hr >= 6 && hr < 18 ? '☀️ ' : '🌙 ') + n), h('b', { style: 'font-family:var(--mono);font-size:1.3rem' }, t), h('span', null, d));
        }));
      }
      const iv = setInterval(tick, 1000);
      root.append(grid); tick();
    } });

  // ---------------- NOVAS FERRAMENTAS ----------------
  const getJSON = async (url, ms = 12000) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw new Error(r.status === 404 ? 'Não encontrado' : 'Serviço indisponível (HTTP ' + r.status + ')'); return await r.json(); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'Tempo de resposta esgotado' : e.message); } finally { clearTimeout(t); }
  };
  const loading = (el, msg = 'Consultando…') => el.replaceChildren(h('p', { class: 'hint' }, msg));
  const errorBox = (el, msg) => el.replaceChildren(h('span', { class: 'badge bad' }, msg));
  const download = (name, content, type = 'text/plain') => { const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type })); h('a', { href: url, download: name }).click(); setTimeout(() => URL.revokeObjectURL(url), 2000); };

  // Pix — BR Code estático (Manual de Padrões para Iniciação do Pix, BCB)
  function crc16(str) {
    let crc = 0xffff;
    for (const b of new TextEncoder().encode(str)) { crc ^= b << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  const emv = (id, v) => id + String(v.length).padStart(2, '0') + v;
  const pixClean = (s, max) => stripAccents(s).replace(/[^A-Za-z0-9 .\-]/g, '').toUpperCase().slice(0, max).trim();
  function pixPayload({ key, name, city, amount, txid, desc }) {
    const mai = emv('00', 'br.gov.bcb.pix') + emv('01', key) + (desc ? emv('02', desc.slice(0, 40)) : '');
    let p = emv('00', '01') + emv('26', mai) + emv('52', '0000') + emv('53', '986') + (amount > 0 ? emv('54', amount.toFixed(2)) : '') +
      emv('58', 'BR') + emv('59', pixClean(name, 25) || 'RECEBEDOR') + emv('60', pixClean(city, 15) || 'BRASIL') + emv('62', emv('05', (txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) + '6304';
    return p + crc16(p);
  }
  function pixKey(type, raw) {
    const v = raw.trim();
    if (type === 'cpf') return onlyDigits(v);
    if (type === 'tel') { const d = onlyDigits(v); return '+' + (d.startsWith('55') && d.length >= 12 ? d : '55' + d); }
    if (type === 'email') return v.toLowerCase();
    return v;
  }
  add({ id: 'gerador-pix', name: 'Gerador de QR Code Pix', cat: 'geradores', icon: 'banknote', desc: 'Crie QR Code Pix e Pix Copia e Cola com valor, para receber pagamentos.', keys: 'pix qr code copia e cola cobranca pagamento brcode chave',
    render(root) {
      const type = sel([['cpf', 'CPF/CNPJ'], ['tel', 'Celular'], ['email', 'E-mail'], ['aleat', 'Chave aleatória']]);
      const key = inp({ placeholder: 'Sua chave Pix' }), name = inp({ placeholder: 'Nome do recebedor', maxLength: 25 }), city = inp({ placeholder: 'Cidade', maxLength: 15, value: 'São Paulo' });
      const amount = inp({ placeholder: '0,00 (opcional)', inputmode: 'decimal' }), txid = inp({ placeholder: 'Identificador (opcional)', maxLength: 25 }), desc = inp({ placeholder: 'Descrição (opcional)', maxLength: 40 });
      const code = area({ readOnly: true, class: 'inp mono', style: 'min-height:110px' });
      const qr = h('div', { class: 'qr-out' }, h('p', { style: 'color:#555' }, 'Preencha a chave Pix'));
      function draw() {
        if (!key.value.trim()) { code.value = ''; qr.replaceChildren(h('p', { style: 'color:#555' }, 'Preencha a chave Pix')); return; }
        code.value = pixPayload({ key: pixKey(type.value, key.value), name: name.value, city: city.value, amount: num(amount.value) || 0, txid: txid.value, desc: desc.value });
        if (!window.QRCode) return;
        qr.replaceChildren();
        new window.QRCode(qr, { text: code.value, width: 300, height: 300, correctLevel: window.QRCode.CorrectLevel.M });
      }
      [type, key, name, city, amount, txid, desc].forEach((e) => e.addEventListener('input', draw));
      root.append(h('div', { class: 'cols-2' },
        h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Tipo de chave', type), field('Chave Pix', key)), h('div', { class: 'row' }, field('Nome do recebedor', name), field('Cidade', city)),
          h('div', { class: 'row' }, field('Valor (R$)', amount), field('Identificador', txid)), field('Descrição', desc), field('Pix Copia e Cola', code),
          h('div', { class: 'toolbar' }, copyBtn(() => code.value, 'Copiar código'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { const c = qr.querySelector('canvas'); if (c) h('a', { href: c.toDataURL('image/png'), download: 'qrcode-pix.png' }).click(); } }, 'Baixar QR Code'))),
        h('div', { class: 'stack' }, qr, h('p', { class: 'hint' }, 'O código é gerado no seu navegador seguindo o padrão BR Code do Banco Central. Confira os dados no app do banco antes de confirmar o pagamento.'))));
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(draw).catch(() => {});
    } });

  add({ id: 'consulta-cep', name: 'Consulta CEP', cat: 'consultas', icon: 'map-pin', desc: 'Busque o endereço pelo CEP ou descubra o CEP pelo endereço.', keys: 'cep endereco correios logradouro buscar cep viacep',
    render(root) {
      const cep = inp({ placeholder: '00000-000', inputmode: 'numeric', value: '01310-100', maxLength: 9 });
      const uf = sel(['SP', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SE', 'TO']);
      const city = inp({ placeholder: 'Cidade', value: 'São Paulo' }), street = inp({ placeholder: 'Rua (mín. 3 letras)', value: 'Paulista' });
      const out = h('div', { class: 'result-list' }), out2 = h('div', { class: 'result-list' });
      async function byCep() {
        const d = onlyDigits(cep.value); cep.value = d.replace(/^(\d{5})(\d)/, '$1-$2');
        if (d.length !== 8) return errorBox(out, 'Digite um CEP com 8 dígitos');
        loading(out);
        try {
          const j = await getJSON(`https://viacep.com.br/ws/${d}/json/`);
          if (j.erro) return errorBox(out, 'CEP não encontrado');
          out.replaceChildren(...[['CEP', j.cep], ['Logradouro', j.logradouro], ['Complemento', j.complemento], ['Bairro', j.bairro], ['Cidade', j.localidade], ['UF', j.uf + (j.estado ? ' — ' + j.estado : '')], ['DDD', j.ddd], ['IBGE', j.ibge]].filter((x) => x[1]).map(([k, v]) => resultItem(k, v)),
            h('a', { class: 'btn btn-sm btn-ghost', target: '_blank', rel: 'noopener', href: 'https://www.google.com/maps/search/' + encodeURIComponent(`${j.logradouro}, ${j.bairro}, ${j.localidade} - ${j.uf}, ${j.cep}`) }, 'Ver no mapa'));
        } catch (e) { errorBox(out, e.message); }
      }
      async function byAddr() {
        if (city.value.trim().length < 3 || street.value.trim().length < 3) return errorBox(out2, 'Informe cidade e rua com pelo menos 3 letras');
        loading(out2);
        try {
          const j = await getJSON(`https://viacep.com.br/ws/${uf.value}/${encodeURIComponent(city.value.trim())}/${encodeURIComponent(street.value.trim())}/json/`);
          if (!j.length) return errorBox(out2, 'Nenhum endereço encontrado');
          out2.replaceChildren(...j.slice(0, 50).map((x) => resultItem(x.cep, `${x.logradouro}${x.complemento ? ' (' + x.complemento + ')' : ''} — ${x.bairro}, ${x.localidade}/${x.uf}`)));
        } catch (e) { errorBox(out2, e.message); }
      }
      cep.addEventListener('keydown', (e) => e.key === 'Enter' && byCep());
      root.append(h('div', { class: 'stack' },
        h('b', null, 'Buscar endereço pelo CEP'), h('div', { class: 'row' }, field('CEP', cep), h('button', { class: 'btn auto', onclick: byCep }, 'Consultar')), out,
        h('hr', { class: 'sep' }), h('b', null, 'Descobrir CEP pelo endereço'),
        h('div', { class: 'row' }, h('label', { class: 'f auto' }, 'UF', uf), field('Cidade', city), field('Rua', street), h('button', { class: 'btn auto', onclick: byAddr }, 'Buscar')), out2,
        h('p', { class: 'hint' }, 'Dados fornecidos pelo serviço público ViaCEP.')));
      byCep();
    } });

  add({ id: 'consulta-cnpj', name: 'Consulta CNPJ', cat: 'consultas', icon: 'building', desc: 'Razão social, situação cadastral, atividades, endereço e sócios de empresas.', keys: 'cnpj empresa receita federal razao social socios qsa situacao cadastral',
    render(root) {
      const input = inp({ placeholder: '00.000.000/0000-00', value: '00.000.000/0001-91' });
      const out = h('div', { class: 'stack' });
      async function go() {
        const d = onlyDigits(input.value);
        if (d.length !== 14) return errorBox(out, 'Digite um CNPJ com 14 dígitos');
        if (!cnpjValid(d)) return errorBox(out, 'CNPJ com dígitos verificadores inválidos');
        input.value = cnpjMask(d); loading(out, 'Consultando a base pública da Receita Federal…');
        try {
          const j = await getJSON(`https://brasilapi.com.br/api/cnpj/v1/${d}`, 20000);
          const sit = (j.descricao_situacao_cadastral || '').toUpperCase();
          const addr = [j.descricao_tipo_de_logradouro, j.logradouro, j.numero, j.complemento, j.bairro, `${j.municipio}/${j.uf}`, j.cep && String(j.cep).replace(/^(\d{5})/, '$1-')].filter(Boolean).join(', ');
          out.replaceChildren(
            h('div', { class: 'toolbar' }, h('span', { class: 'badge ' + (sit === 'ATIVA' ? 'ok' : 'bad') }, sit || '—'), j.porte ? h('span', { class: 'badge warn' }, j.porte) : null, j.opcao_pelo_simples ? h('span', { class: 'badge ok' }, 'Optante do Simples') : null),
            h('div', { class: 'result-list' }, ...[['Razão social', j.razao_social], ['Nome fantasia', j.nome_fantasia], ['CNPJ', cnpjMask(d)], ['Abertura', j.data_inicio_atividade && new Date(j.data_inicio_atividade + 'T12:00').toLocaleDateString('pt-BR')],
              ['Natureza jurídica', j.natureza_juridica], ['Capital social', j.capital_social != null ? brl(j.capital_social) : ''], ['Atividade principal', j.cnae_fiscal && `${j.cnae_fiscal} — ${j.cnae_fiscal_descricao}`],
              ['Endereço', addr], ['Telefone', j.ddd_telefone_1], ['E-mail', j.email]].filter((x) => x[1]).map(([k, v]) => resultItem(k, v))),
            j.cnaes_secundarios && j.cnaes_secundarios.filter((c) => c.codigo).length ? h('details', { class: 'more' }, h('summary', null, `Atividades secundárias (${j.cnaes_secundarios.filter((c) => c.codigo).length})`), h('ul', null, j.cnaes_secundarios.filter((c) => c.codigo).map((c) => h('li', null, `${c.codigo} — ${c.descricao}`)))) : null,
            j.qsa && j.qsa.length ? h('div', { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': 'Quadro de sócios' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Sócio / administrador'), h('th', null, 'Qualificação'), h('th', null, 'Entrada'))),
              h('tbody', null, j.qsa.map((q) => h('tr', null, h('td', null, q.nome_socio), h('td', null, q.qualificacao_socio), h('td', null, q.data_entrada_sociedade ? new Date(q.data_entrada_sociedade + 'T12:00').toLocaleDateString('pt-BR') : '—')))))) : null,
            h('p', { class: 'hint' }, 'Dados públicos do CNPJ (Receita Federal) via BrasilAPI. Podem ter alguns dias de defasagem.'));
        } catch (e) { errorBox(out, e.message); }
      }
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('CNPJ', input), h('button', { class: 'btn auto', onclick: go }, 'Consultar')), out));
      go();
    } });

  add({ id: 'conversor-moedas', name: 'Conversor de moedas', cat: 'consultas', icon: 'circle-dollar-sign', desc: 'Cotação atualizada do dólar, euro e mais de 150 moedas, com conversão instantânea.', keys: 'cotacao dolar euro moeda cambio real libra bitcoin conversao',
    render(root) {
      const COMMON = ['BRL', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'ARS', 'CAD', 'AUD', 'MXN', 'CLP', 'UYU', 'KYD', 'AED', 'SGD'];
      const amount = inp({ value: '1.000', inputmode: 'decimal' }), from = sel(COMMON, { value: 'USD' }), to = sel(COMMON, { value: 'BRL' });
      const out = h('div', { class: 'out big-out' }, '…'), info = h('p', { class: 'hint' }), table = h('div', { class: 'metrics' });
      let rates = null, base = '';
      const names = new Intl.DisplayNames(['pt-BR'], { type: 'currency' });
      async function load(b) {
        if (base === b && rates) return;
        loading(table, 'Buscando cotações…');
        try { const j = await getJSON(`https://open.er-api.com/v6/latest/${b}`); rates = j.rates; info.textContent = 'Atualizado em ' + new Date(j.time_last_update_unix * 1000).toLocaleString('pt-BR') + ' · fonte: ExchangeRate-API (referência, sem spread bancário/IOF)'; }
        catch { const j = await getJSON(`https://api.frankfurter.dev/v1/latest?base=${b}`); rates = { ...j.rates, [b]: 1 }; info.textContent = 'Atualizado em ' + new Date(j.date).toLocaleDateString('pt-BR') + ' · fonte: Banco Central Europeu (Frankfurter)'; }
        base = b;
        const all = Object.keys(rates).sort();
        [from, to].forEach((s) => { const v = s.value; if (s.options.length < 20) { s.replaceChildren(...all.map((c) => h('option', { value: c }, c + ' — ' + (names.of(c) || c)))); s.value = v; } });
      }
      async function run() {
        try { await load(from.value); } catch (e) { out.textContent = '—'; return errorBox(table, 'Não foi possível obter as cotações agora'); }
        const v = num(amount.value) || 0, r = rates[to.value];
        const f = (n, c) => { try { return n.toLocaleString('pt-BR', { style: 'currency', currency: c, maximumFractionDigits: n < 1 ? 6 : 2 }); } catch { return fmt(n, 4) + ' ' + c; } };
        out.textContent = r ? `${f(v, from.value)} = ${f(v * r, to.value)}` : 'Moeda indisponível';
        table.replaceChildren(...COMMON.filter((c) => c !== from.value && rates[c]).map((c) => h('div', { class: 'metric' }, h('b', { style: 'font-size:1.05rem' }, f(rates[c], c)), h('span', null, `1 ${from.value} em ${c}`))));
      }
      [amount, from, to].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Valor', amount), field('De', from), h('button', { class: 'btn btn-ghost auto', 'aria-label': 'Inverter moedas', onclick: () => { const t = from.value; from.value = to.value; to.value = t; run(); } }, '⇄'), field('Para', to)), out, info, table));
      run();
    } });

  add({ id: 'feriados-nacionais', name: 'Feriados nacionais', cat: 'consultas', icon: 'calendar', desc: 'Calendário de feriados nacionais e pontos facultativos de qualquer ano.', keys: 'feriado feriados calendario carnaval pascoa corpus christi ano',
    render(root) {
      const year = inp({ type: 'number', value: new Date().getFullYear(), min: 1950, max: 2200 }), fac = check('Incluir pontos facultativos', true);
      const out = h('div', { class: 'result-list' });
      function run() {
        const y = +year.value; if (!(y > 1900 && y < 2300)) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        out.replaceChildren(...holidays(y, fac.on).map(([d, n]) => {
          const days = Math.round((d - today) / 864e5);
          return h('div', { class: 'result-item' }, h('span', { class: 'k' }, d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })), h('span', { style: 'flex:1' }, n, h('small', { class: 'hint', style: 'display:block' }, d.toLocaleDateString('pt-BR', { weekday: 'long' }))),
            h('span', { class: 'badge ' + (days < 0 ? '' : days === 0 ? 'ok' : 'warn') }, days < 0 ? 'passou' : days === 0 ? 'hoje' : `em ${days} dia${days > 1 ? 's' : ''}`));
        }));
      }
      year.addEventListener('input', run); fac.input.addEventListener('change', run);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Ano', year), h('div', { class: 'auto' }, fac.el)), out, h('p', { class: 'hint' }, 'Datas móveis calculadas a partir da Páscoa. Feriados estaduais e municipais variam conforme a localidade.')));
      run();
    } });

  add({ id: 'link-whatsapp', name: 'Gerador de link do WhatsApp', cat: 'geradores', icon: 'message-circle', desc: 'Crie links wa.me com mensagem pronta para sites, bio e anúncios.', keys: 'whatsapp link wa.me mensagem zap botao',
    render(root) {
      const tel = inp({ placeholder: '(11) 99999-9999', inputmode: 'tel' }), msg = area({ placeholder: 'Mensagem (opcional)', value: 'Olá! Vim pelo site e gostaria de mais informações.', style: 'min-height:100px' });
      const ddi = inp({ value: '55', style: 'max-width:80px', inputmode: 'numeric' }), out = inp({ readOnly: true, class: 'inp mono' }), html = area({ readOnly: true, class: 'inp mono', style: 'min-height:70px' });
      function run() {
        const d = onlyDigits(tel.value);
        out.value = d ? `https://wa.me/${onlyDigits(ddi.value)}${d}${msg.value ? '?text=' + encodeURIComponent(msg.value) : ''}` : '';
        html.value = out.value ? `<a href="${out.value}" target="_blank" rel="noopener">Fale conosco no WhatsApp</a>` : '';
      }
      [tel, msg, ddi].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, h('label', { class: 'f auto' }, 'DDI', ddi), field('Telefone com DDD', tel)), field('Mensagem', msg), field('Link gerado', out),
        h('div', { class: 'toolbar' }, copyBtn(() => out.value, 'Copiar link'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => out.value && window.open(out.value, '_blank', 'noopener') }, 'Testar link')), field('Código HTML para o site', html)));
      run();
    } });

  add({ id: 'gerador-dados-teste', name: 'Gerador de pessoas fictícias', cat: 'geradores', icon: 'contact', desc: 'Dados fictícios completos (nome, CPF, e-mail, telefone, endereço) para testes de sistemas.', keys: 'dados falsos fake pessoa teste mock nome cpf endereco json',
    render(root) {
      const F = ['Ana', 'Beatriz', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Larissa', 'Mariana', 'Natália', 'Patrícia', 'Rafaela', 'Sofia', 'Valentina'];
      const M = ['Arthur', 'Bernardo', 'Carlos', 'Davi', 'Eduardo', 'Felipe', 'Gustavo', 'Heitor', 'Igor', 'João', 'Lucas', 'Matheus', 'Nicolas', 'Otávio', 'Pedro', 'Rafael', 'Thiago'];
      const L = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Barbosa', 'Rocha'];
      const ST = ['Rua das Flores', 'Avenida Brasil', 'Rua São João', 'Rua XV de Novembro', 'Avenida Paulista', 'Rua do Comércio', 'Rua Sete de Setembro', 'Avenida Atlântica'];
      const CT = [['São Paulo', 'SP', '11'], ['Rio de Janeiro', 'RJ', '21'], ['Belo Horizonte', 'MG', '31'], ['Curitiba', 'PR', '41'], ['Porto Alegre', 'RS', '51'], ['Salvador', 'BA', '71'], ['Recife', 'PE', '81'], ['Brasília', 'DF', '61'], ['Fortaleza', 'CE', '85']];
      const pick = (a) => a[randInt(0, a.length - 1)];
      const qty = sel([['1', '1 pessoa'], ['5', '5 pessoas'], ['20', '20 pessoas']]), fmtSel = sel([['cards', 'Visualizar'], ['json', 'JSON'], ['csv', 'CSV']]);
      const out = h('div', { class: 'stack' });
      let data = [];
      function person() {
        const fem = randInt(0, 1), first = pick(fem ? F : M), last = `${pick(L)} ${pick(L)}`, [city, uf, ddd] = pick(CT);
        const b = new Date(randInt(1950, 2006), randInt(0, 11), randInt(1, 28));
        return { nome: `${first} ${last}`, cpf: cpfMask(genCPF()), nascimento: b.toLocaleDateString('pt-BR'), sexo: fem ? 'Feminino' : 'Masculino',
          email: `${slugify(first, '.')}.${slugify(last.split(' ')[1], '')}${randInt(1, 99)}@exemplo.com`, celular: `(${ddd}) 9${randInt(1000, 9999)}-${randInt(1000, 9999)}`,
          cep: `${randInt(10000, 99999)}-${String(randInt(0, 999)).padStart(3, '0')}`, endereco: `${pick(ST)}, ${randInt(1, 3000)}`, cidade: city, uf };
      }
      function show() {
        if (fmtSel.value === 'json') { const t = area({ readOnly: true, class: 'inp mono', value: JSON.stringify(data, null, 2), style: 'min-height:300px' }); out.replaceChildren(t, h('div', { class: 'toolbar' }, copyBtn(() => t.value), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => download('pessoas.json', t.value, 'application/json') }, 'Baixar .json'))); return; }
        if (fmtSel.value === 'csv') { const keys = Object.keys(data[0]); const csv = [keys.join(';'), ...data.map((p) => keys.map((k) => p[k]).join(';'))].join('\n'); const t = area({ readOnly: true, class: 'inp mono', value: csv, style: 'min-height:240px' }); out.replaceChildren(t, h('div', { class: 'toolbar' }, copyBtn(() => t.value), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => download('pessoas.csv', '﻿' + csv, 'text/csv') }, 'Baixar .csv'))); return; }
        out.replaceChildren(...data.map((p) => h('div', { class: 'card-sub' }, h('b', null, p.nome), h('div', { class: 'result-list', style: 'margin-top:10px' }, Object.entries(p).filter(([k]) => k !== 'nome').map(([k, v]) => resultItem(k, v))))));
      }
      const gen = () => { data = Array.from({ length: +qty.value }, person); show(); };
      qty.addEventListener('change', gen); fmtSel.addEventListener('change', show);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Quantidade', qty), field('Formato', fmtSel), h('button', { class: 'btn auto', onclick: gen }, 'Gerar')), out,
        h('p', { class: 'hint' }, 'Todos os dados são aleatórios e fictícios, para uso exclusivo em testes de software. O CPF é matematicamente válido, mas não pertence a uma pessoa real conhecida.')));
      gen();
    } });

  add({ id: 'conversor-imagem', name: 'Conversor e compressor de imagens', cat: 'conversores', icon: 'image', desc: 'Converta entre PNG, JPG e WebP, redimensione e reduza o tamanho de imagens.', keys: 'imagem foto converter png jpg webp comprimir reduzir redimensionar tamanho',
    render(root) {
      const file = h('input', { type: 'file', accept: 'image/*', class: 'inp' }), fmtSel = sel([['image/webp', 'WebP'], ['image/jpeg', 'JPG'], ['image/png', 'PNG']]);
      const q = inp({ type: 'range', min: 10, max: 100, value: 80 }), qv = h('b', null, '80%'), maxW = inp({ type: 'number', placeholder: 'Original', min: 16 });
      const prev = h('div', { class: 'img-prev' }, h('p', { class: 'hint' }, 'Selecione ou arraste uma imagem')), info = h('div', { class: 'metrics' });
      let img = null, srcSize = 0, outBlob = null, srcName = 'imagem';
      function load(f) {
        if (!f || !f.type.startsWith('image/')) return;
        srcSize = f.size; srcName = f.name.replace(/\.[^.]+$/, '');
        const im = new Image(); im.onload = () => { img = im; run(); }; im.src = URL.createObjectURL(f);
      }
      function run() {
        qv.textContent = q.value + '%';
        if (!img) return;
        let w = img.naturalWidth, hh = img.naturalHeight; const mw = +maxW.value;
        if (mw && mw < w) { hh = Math.round(hh * mw / w); w = mw; }
        const c = h('canvas', { width: w, height: hh }); const ctx = c.getContext('2d');
        if (fmtSel.value === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); }
        ctx.drawImage(img, 0, 0, w, hh);
        c.toBlob((b) => {
          outBlob = b; const url = URL.createObjectURL(b);
          prev.replaceChildren(h('img', { src: url, alt: 'Pré-visualização' }));
          const kb = (n) => n > 1048576 ? fmt(n / 1048576, 2) + ' MB' : fmt(n / 1024, 1) + ' KB';
          const diff = srcSize ? Math.round((1 - b.size / srcSize) * 100) : 0;
          info.replaceChildren(...[[kb(srcSize), 'original'], [kb(b.size), 'resultado'], [(diff >= 0 ? '−' : '+') + Math.abs(diff) + '%', 'variação'], [`${w}×${hh}`, 'pixels']].map(([v, k]) => h('div', { class: 'metric' }, h('b', { style: 'font-size:1.2rem' }, v), h('span', null, k))));
        }, fmtSel.value, +q.value / 100);
      }
      file.addEventListener('change', () => load(file.files[0]));
      prev.addEventListener('dragover', (e) => { e.preventDefault(); prev.classList.add('drag'); });
      prev.addEventListener('dragleave', () => prev.classList.remove('drag'));
      prev.addEventListener('drop', (e) => { e.preventDefault(); prev.classList.remove('drag'); load(e.dataTransfer.files[0]); });
      [fmtSel, q, maxW].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, field('Imagem', file), field('Formato de saída', fmtSel), h('label', { class: 'f' }, h('span', null, 'Qualidade: ', qv), q), field('Largura máxima (px)', maxW),
        h('button', { class: 'btn', onclick: () => outBlob && download(`${srcName}-gooners.${{ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[fmtSel.value]}`, outBlob) }, 'Baixar imagem'), info,
        h('p', { class: 'hint' }, 'A imagem é processada no seu dispositivo e não é enviada para nenhum servidor. A qualidade não se aplica ao PNG.')), prev));
    } });

  add({ id: 'csv-json', name: 'Conversor CSV ↔ JSON', cat: 'conversores', icon: 'sheet', desc: 'Converta planilhas CSV em JSON e JSON em CSV, com detecção de separador.', keys: 'csv json planilha excel converter tabela',
    render(root) {
      let mode;
      function parseCSV(text) {
        const first = text.split('\n')[0] || '';
        const delim = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
        const rows = []; let row = [], cur = '', q = false;
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
          else if (c === '"') q = true; else if (c === delim) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
        }
        if (cur || row.length) { row.push(cur); rows.push(row); }
        const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
        return body.map((r) => Object.fromEntries(head.map((k, j) => [k.trim(), r[j] ?? ''])));
      }
      const csvCell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[";,\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const tool = textTool(root, (s) => {
        if (!s.trim()) return '';
        if (mode.value === 'c2j') return JSON.stringify(parseCSV(s), null, 2);
        let arr = JSON.parse(s); if (!Array.isArray(arr)) arr = [arr];
        const keys = [...new Set(arr.flatMap((o) => Object.keys(o)))];
        return [keys.join(';'), ...arr.map((o) => keys.map((k) => csvCell(o[k])).join(';'))].join('\n');
      }, { sample: 'nome;cidade;valor\nAna;São Paulo;1500\n"Silva, João";Rio de Janeiro;2300', prefill: true, controls: (run) => (mode = sel([['c2j', 'CSV → JSON'], ['j2c', 'JSON → CSV']], { onchange: run })) });
      tool.input.classList.add('mono'); tool.output.classList.add('mono');
    } });

  add({ id: 'numeros-romanos', name: 'Conversor de números romanos', cat: 'conversores', icon: 'landmark', desc: 'Converta números arábicos em romanos e vice-versa (1 a 3.999).', keys: 'romano romanos algarismos converter xiv mmxxvi',
    render(root) {
      const MAP = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
      const toR = (n) => MAP.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
      const fromR = (r) => { r = r.toUpperCase().trim(); let i = 0, n = 0; for (const [v, sym] of MAP) while (r.startsWith(sym, i)) { n += v; i += sym.length; } return i === r.length && toR(n) === r ? n : NaN; };
      const a = inp({ value: new Date().getFullYear(), inputmode: 'numeric' }), r = inp({ class: 'inp mono' });
      a.addEventListener('input', () => { const n = parseInt(a.value, 10); r.value = n > 0 && n < 4000 ? toR(n) : ''; });
      r.addEventListener('input', () => { const n = fromR(r.value); a.value = isNaN(n) ? '' : n; r.style.borderColor = r.value && isNaN(n) ? 'var(--bad)' : ''; });
      root.append(h('div', { class: 'row' }, field('Número', a), field('Romano', r)));
      a.dispatchEvent(new Event('input'));
    } });

  add({ id: 'calculadora-financiamento', name: 'Simulador de financiamento', cat: 'calculadoras', icon: 'landmark', desc: 'Simule parcelas pelas tabelas Price e SAC, com juros totais e tabela de amortização.', keys: 'financiamento emprestimo parcela price sac amortizacao imovel veiculo juros',
    render(root) {
      const pv = inp({ value: '300.000', inputmode: 'decimal' }), down = inp({ value: '60.000', inputmode: 'decimal' }), rate = inp({ value: '11,5', inputmode: 'decimal' }), per = sel([['a', '% ao ano'], ['m', '% ao mês']]);
      const n = inp({ type: 'number', value: 360 }), sys = sel([['price', 'Tabela Price (parcelas fixas)'], ['sac', 'SAC (amortização constante)']]);
      const out = h('div', { class: 'metrics' }), table = h('div', { class: 'table-wrap', style: 'max-height:380px;overflow:auto', tabindex: 0, role: 'region', 'aria-label': 'Tabela de amortização' });
      function run() {
        const P = Math.max(0, (num(pv.value) || 0) - (num(down.value) || 0)), N = Math.min(600, Math.max(1, +n.value | 0)), r0 = (num(rate.value) || 0) / 100;
        const i = per.value === 'a' ? (1 + r0) ** (1 / 12) - 1 : r0;
        const rows = []; let bal = P, tj = 0;
        for (let k = 1; k <= N; k++) {
          const j = bal * i, am = sys.value === 'sac' ? P / N : (i ? P * i / (1 - (1 + i) ** -N) : P / N) - j;
          bal = Math.max(0, bal - am); tj += j; rows.push([k, am + j, am, j, bal]);
        }
        out.replaceChildren(...[[brl(P), 'Valor financiado'], [brl(rows[0][1]), sys.value === 'sac' ? '1ª parcela' : 'Parcela'], ...(sys.value === 'sac' ? [[brl(rows[N - 1][1]), 'Última parcela']] : []), [brl(tj), 'Total de juros'], [brl(P + tj), 'Total pago'], [fmt(i * 100, 4) + '%', 'Taxa mensal']]
          .map(([v, k]) => h('div', { class: 'metric' }, h('b', { style: 'font-size:1.1rem' }, v), h('span', null, k))));
        table.replaceChildren(h('table', { class: 't' }, h('thead', null, h('tr', null, ['Mês', 'Parcela', 'Amortização', 'Juros', 'Saldo'].map((x) => h('th', null, x)))),
          h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r[0]), ...r.slice(1).map((v) => h('td', null, brl(v))))))));
      }
      [pv, down, rate, per, n, sys].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Valor do bem (R$)', pv), field('Entrada (R$)', down), field('Taxa de juros', rate), field('Período', per)),
        h('div', { class: 'row' }, field('Prazo (meses)', n), field('Sistema', sys)), out, table, h('p', { class: 'hint' }, 'Simulação sem seguros (MIP/DFI), taxas administrativas, IOF ou correção monetária (TR/IPCA). O Custo Efetivo Total (CET) do banco será maior.')));
      run();
    } });

  add({ id: 'calculadora-horas', name: 'Calculadora de horas', cat: 'calculadoras', icon: 'hourglass', desc: 'Some e subtraia horas e minutos, calcule banco de horas e intervalos entre horários.', keys: 'horas minutos somar banco de horas ponto jornada trabalho intervalo',
    render(root) {
      const list = area({ value: '08:30\n07:45\n-01:00\n09:15', placeholder: 'Uma duração por linha (use − para subtrair)', class: 'inp mono' });
      const out = h('div', { class: 'metrics' }), a = inp({ type: 'time', value: '08:00' }), b = inp({ type: 'time', value: '17:30' }), lunch = inp({ type: 'number', value: 60, min: 0 }), out2 = h('div', { class: 'out big-out' });
      const pm = (s) => { const m = s.trim().match(/^([-+])?\s*(\d+)(?::(\d{1,2}))?$/); if (!m) return null; return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)); };
      const hm = (t) => (t < 0 ? '−' : '') + Math.floor(Math.abs(t) / 60) + 'h' + String(Math.abs(t) % 60).padStart(2, '0');
      function run() {
        const vals = list.value.split('\n').filter((l) => l.trim()).map(pm), bad = vals.filter((v) => v === null).length, tot = vals.reduce((s, v) => s + (v || 0), 0);
        out.replaceChildren(...[[hm(tot), 'total'], [fmt(tot / 60, 2), 'horas decimais'], [fmt(tot, 0), 'minutos'], [bad ? bad + ' inválida(s)' : vals.length, 'linhas']].map(([v, k]) => h('div', { class: 'metric' }, h('b', null, v), h('span', null, k))));
        const [ah, am] = a.value.split(':').map(Number), [bh, bm] = b.value.split(':').map(Number);
        let d = bh * 60 + bm - (ah * 60 + am); if (d < 0) d += 1440; d -= +lunch.value || 0;
        out2.textContent = 'Jornada: ' + hm(d);
      }
      [list, a, b, lunch].forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'stack' }, field('Somar durações (hh:mm)', list), out, h('hr', { class: 'sep' }), h('b', null, 'Horas trabalhadas entre dois horários'),
        h('div', { class: 'row' }, field('Entrada', a), field('Saída', b), field('Intervalo (min)', lunch)), out2));
      run();
    } });

  add({ id: 'estatistica', name: 'Calculadora de média e estatística', cat: 'calculadoras', icon: 'chart-column', desc: 'Média, mediana, moda, desvio padrão, variância e quartis de uma lista de números.', keys: 'media mediana moda desvio padrao variancia estatistica notas quartil',
    render(root) {
      const input = area({ value: '7,5 8 6,5 9 10 8 7 5,5', placeholder: 'Números separados por espaço, linha ou ponto e vírgula', style: 'min-height:110px' }), out = h('div', { class: 'metrics' });
      function run() {
        const xs = input.value.split(/[\s;]+/).map((x) => num(x)).filter((x) => isFinite(x)).sort((a, b) => a - b), n = xs.length;
        if (!n) return out.replaceChildren(h('p', { class: 'hint' }, 'Digite ao menos um número.'));
        const sum = xs.reduce((a, b) => a + b, 0), mean = sum / n, q = (p) => { const i = (n - 1) * p, lo = Math.floor(i); return xs[lo] + (xs[Math.ceil(i)] - xs[lo]) * (i - lo); };
        const freq = {}; xs.forEach((x) => (freq[x] = (freq[x] || 0) + 1)); const mf = Math.max(...Object.values(freq)), modes = Object.keys(freq).filter((k) => freq[k] === mf);
        const ss = xs.reduce((a, x) => a + (x - mean) ** 2, 0);
        out.replaceChildren(...[[n, 'quantidade'], [fmt(sum, 4), 'soma'], [fmt(mean, 4), 'média'], [fmt(q(.5), 4), 'mediana'], [mf > 1 ? modes.map((m) => fmt(+m, 4)).join(', ') : '—', 'moda'],
          [fmt(xs[0], 4), 'mínimo'], [fmt(xs[n - 1], 4), 'máximo'], [fmt(xs[n - 1] - xs[0], 4), 'amplitude'], [fmt(q(.25), 4) + ' / ' + fmt(q(.75), 4), 'Q1 / Q3'],
          [n > 1 ? fmt(Math.sqrt(ss / (n - 1)), 4) : '—', 'desvio padrão (amostra)'], [fmt(Math.sqrt(ss / n), 4), 'desvio padrão (pop.)'], [n > 1 ? fmt(ss / (n - 1), 4) : '—', 'variância (amostra)']]
          .map(([v, k]) => h('div', { class: 'metric' }, h('b', { style: 'font-size:1.2rem' }, v), h('span', null, k))));
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, field('Valores', input), out)); run();
    } });

  add({ id: 'markdown-html', name: 'Editor Markdown com preview', cat: 'dev', icon: 'file-code', desc: 'Escreva em Markdown, veja a prévia ao vivo e exporte o HTML.', keys: 'markdown md html editor preview readme converter',
    render(root) {
      const input = area({ class: 'inp mono', style: 'min-height:320px', value: '# Título\n\nTexto com **negrito**, *itálico* e [link](https://monolito123.github.io/Gooners/).\n\n- Item 1\n- Item 2\n\n| Coluna | Valor |\n|---|---|\n| A | 1 |\n\n```js\nconsole.log("Gooners");\n```' });
      const frame = h('iframe', { class: 'md-frame', sandbox: '', title: 'Pré-visualização' }); let html = '';
      function run() {
        if (!window.marked) return;
        html = window.marked.parse(input.value);
        frame.srcdoc = `<style>body{font:15px/1.6 system-ui,sans-serif;padding:16px;color:#1f2937}pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}img{max-width:100%}</style>${html}`;
      }
      input.addEventListener('input', run);
      root.append(h('div', { class: 'stack' }, h('div', { class: 'cols-2' }, field('Markdown', input), h('label', { class: 'f' }, 'Pré-visualização', frame)),
        h('div', { class: 'toolbar' }, copyBtn(() => html, 'Copiar HTML'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => download('documento.md', input.value) }, 'Baixar .md'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => download('documento.html', `<!doctype html><meta charset="utf-8">${html}`, 'text/html') }, 'Baixar .html'))));
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js').then(run).catch((e) => toast(e.message));
    } });

  add({ id: 'gerador-meta-tags', name: 'Gerador de meta tags SEO', cat: 'dev', icon: 'tags', desc: 'Gere title, description, Open Graph e Twitter Card com prévia do Google e das redes.', keys: 'seo meta tags open graph og twitter card google snippet title description',
    render(root) {
      const f = { title: inp({ value: 'Gooners — Ferramentas online grátis' }), desc: area({ value: 'Dezenas de ferramentas online gratuitas: texto, geradores, validadores, conversores e calculadoras. Tudo no navegador, sem cadastro.', style: 'min-height:80px' }),
        url: inp({ value: 'https://monolito123.github.io/Gooners/' }), img: inp({ placeholder: 'https://…/imagem-1200x630.jpg' }), site: inp({ value: 'Gooners' }), tw: inp({ placeholder: '@usuario' }) };
      const counters = { title: h('span', { class: 'badge' }), desc: h('span', { class: 'badge' }) };
      const preview = h('div', { class: 'serp' }), code = area({ readOnly: true, class: 'inp mono', style: 'min-height:260px' });
      const lim = (el, n, lo, hi) => { el.textContent = `${n} caracteres`; el.className = 'badge ' + (n >= lo && n <= hi ? 'ok' : 'warn'); };
      function run() {
        const v = Object.fromEntries(Object.entries(f).map(([k, e]) => [k, e.value.trim()]));
        lim(counters.title, v.title.length, 30, 60); lim(counters.desc, v.desc.length, 70, 160);
        let host = v.url; try { const u = new URL(v.url); host = u.host + u.pathname.replace(/\/$/, '').replace(/\//g, ' › '); } catch {}
        preview.replaceChildren(h('div', { class: 'serp-url' }, host), h('div', { class: 'serp-title' }, v.title.length > 60 ? v.title.slice(0, 57) + '…' : v.title), h('div', { class: 'serp-desc' }, v.desc.length > 160 ? v.desc.slice(0, 157) + '…' : v.desc));
        const e = (s) => esc(s);
        code.value = [`<title>${e(v.title)}</title>`, `<meta name="description" content="${e(v.desc)}">`, v.url && `<link rel="canonical" href="${e(v.url)}">`, '', `<meta property="og:type" content="website">`, `<meta property="og:title" content="${e(v.title)}">`,
          `<meta property="og:description" content="${e(v.desc)}">`, v.url && `<meta property="og:url" content="${e(v.url)}">`, v.img && `<meta property="og:image" content="${e(v.img)}">`, v.site && `<meta property="og:site_name" content="${e(v.site)}">`, `<meta property="og:locale" content="pt_BR">`, '',
          `<meta name="twitter:card" content="${v.img ? 'summary_large_image' : 'summary'}">`, v.tw && `<meta name="twitter:site" content="${e(v.tw)}">`, `<meta name="twitter:title" content="${e(v.title)}">`, `<meta name="twitter:description" content="${e(v.desc)}">`, v.img && `<meta name="twitter:image" content="${e(v.img)}">`]
          .filter((x) => x !== '' && x != null && x !== false || x === '').join('\n').replace(/\n{3,}/g, '\n\n');
      }
      Object.values(f).forEach((e) => e.addEventListener('input', run));
      root.append(h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, h('label', { class: 'f' }, h('span', null, 'Título ', counters.title), f.title), h('label', { class: 'f' }, h('span', null, 'Descrição ', counters.desc), f.desc),
        field('URL canônica', f.url), field('Imagem de compartilhamento (1200×630)', f.img), h('div', { class: 'row' }, field('Nome do site', f.site), field('Twitter/X', f.tw))),
        h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Prévia no Google'), preview, field('Código para o <head>', code), copyBtn(() => code.value, 'Copiar código'))));
      run();
    } });

  add({ id: 'texto-em-voz', name: 'Ler texto em voz alta', cat: 'tempo', icon: 'volume-2', desc: 'Converta texto em fala com as vozes em português do seu dispositivo.', keys: 'texto para voz tts falar narrar audio leitura acessibilidade',
    render(root) {
      const input = area({ value: 'Olá! Este é o leitor de texto do Gooners. Cole qualquer texto e clique em ouvir.' });
      const voice = sel([]), rate = inp({ type: 'range', min: .5, max: 2, step: .1, value: 1 }), pitch = inp({ type: 'range', min: .5, max: 2, step: .1, value: 1 });
      const ss = window.speechSynthesis;
      if (!ss) { root.append(h('p', { class: 'badge bad' }, 'Seu navegador não oferece síntese de voz.')); return; }
      function fill() { const vs = ss.getVoices().sort((a, b) => (b.lang.startsWith('pt') - a.lang.startsWith('pt'))); voice.replaceChildren(...vs.map((v, i) => h('option', { value: i }, `${v.name} (${v.lang})`))); voice._v = vs; }
      fill(); ss.onvoiceschanged = fill;
      const speak = () => { ss.cancel(); const u = new SpeechSynthesisUtterance(input.value); const v = voice._v && voice._v[voice.value]; if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'pt-BR'; u.rate = +rate.value; u.pitch = +pitch.value; ss.speak(u); };
      root.append(h('div', { class: 'stack' }, input, h('div', { class: 'row' }, field('Voz', voice), field('Velocidade', rate), field('Tom', pitch)),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: speak }, 'Ouvir'), h('button', { class: 'btn btn-ghost', onclick: () => (ss.paused ? ss.resume() : ss.pause()) }, 'Pausar / continuar'), h('button', { class: 'btn btn-ghost', onclick: () => ss.cancel() }, 'Parar'))));
    } });

  add({ id: 'bloco-de-notas', name: 'Bloco de notas online', cat: 'tempo', icon: 'notebook-pen', desc: 'Anotações salvas automaticamente no seu navegador, com várias notas e exportação.', keys: 'bloco de notas anotacoes notepad rascunho texto salvar',
    render(root) {
      const KEY = 'gooners:notes';
      const loadN = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
      const saveN = () => { try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch {} };
      let notes = loadN(); if (!notes.length) notes = [{ id: Date.now(), text: 'Minha primeira nota\n\nTudo que você escrever aqui fica salvo neste navegador.', t: Date.now() }];
      let cur = notes[0].id;
      const list = h('div', { class: 'notes-list' }), ed = area({ style: 'min-height:340px' }), status = h('p', { class: 'hint' });
      const title = (n) => (n.text.split('\n')[0] || 'Nota sem título').slice(0, 40);
      function renderList() {
        list.replaceChildren(...notes.sort((a, b) => b.t - a.t).map((n) => h('button', { class: 'note-item' + (n.id === cur ? ' on' : ''), onclick: () => { cur = n.id; open(); } }, h('b', null, title(n)), h('small', null, new Date(n.t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })))));
      }
      const note = () => notes.find((n) => n.id === cur);
      function open() { ed.value = note().text; renderList(); stat(); }
      const stat = () => { const w = (ed.value.match(/\S+/g) || []).length; status.textContent = `${w} palavra(s) · ${ed.value.length} caractere(s) · salvo automaticamente`; };
      ed.addEventListener('input', () => { const n = note(); n.text = ed.value; n.t = Date.now(); saveN(); stat(); clearTimeout(ed._t); ed._t = setTimeout(renderList, 400); });
      root.append(h('div', { class: 'notes' }, h('div', { class: 'stack' }, h('button', { class: 'btn', onclick: () => { const n = { id: Date.now(), text: '', t: Date.now() }; notes.unshift(n); cur = n.id; saveN(); open(); ed.focus(); } }, '+ Nova nota'), list),
        h('div', { class: 'stack' }, ed, status, h('div', { class: 'toolbar' }, copyBtn(() => ed.value), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => download(slugify(title(note())) + '.txt', ed.value) }, 'Baixar .txt'),
          h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm btn-danger', onclick: () => { if (!confirm('Excluir esta nota?')) return; notes = notes.filter((n) => n.id !== cur); if (!notes.length) notes = [{ id: Date.now(), text: '', t: Date.now() }]; cur = notes[0].id; saveN(); open(); } }, 'Excluir')))));
      open();
    } });

  // Export
  window.Gooners = { TOOLS: T, CATEGORIES, h, copy, toast, esc, stripAccents, _test: { extenso, cpfValid, cnpjValid, genCPF, genCNPJ, md5, luhn, pixPayload, crc16, holidays, easter } };
})();
