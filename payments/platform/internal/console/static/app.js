// goonersPAY web console. Signs in with a partner API key, kept in this page's memory only
// (a reload asks for it again), and calls the API on this same origin. Every function of the
// API has a screen; the money screens follow docs/06: one number first, prices before
// commitment, one primary action per card, calm errors that say what happened, what it means
// for the money and what to do next.
import * as verify from './verify.js';

// ---------------------------------------------------------------- state and API

const S = { key: '', env: '', merchants: load('gp.merchants', []), merchant: load('gp.merchant', null), flash: null, timers: [] };

function load(k, d) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
}
function save(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: the console still works, it just forgets */
  }
}

class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.detail || body.title)) || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function api(method, path, body) {
  const headers = { Authorization: 'Bearer ' + S.key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST') headers['Idempotency-Key'] = crypto.randomUUID();
  let r;
  try {
    r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { title: 'Sem conexão' });
  }
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

/** What happened, what it means for the money, what to do next. */
function explain(e) {
  const d = (e.body && e.body.detail) || e.message || '';
  switch (e.status) {
    case 0: return ['Sem conexão com a plataforma.', 'Nada foi enviado. Confira a rede e tente de novo.'];
    case 401: return ['A chave de API foi recusada.', 'Nada mudou. Confira a chave e entre de novo.'];
    case 403:
      if (e.body && e.body.code === 'address_refused') return ['Endereço recusado pela verificação de sanções.', 'Nada foi enviado. A tentativa fica registrada para a equipe de compliance.'];
      return ['Esta chave não tem permissão para isso.', `Peça uma chave com o escopo ${d}.`];
    case 404: return ['Não encontrado.', d || 'Confira o identificador.'];
    case 409: return ['Não foi possível agora.', d];
    case 410: return ['Expirou.', 'Peça uma nova cotação; o preço anterior não vale mais.'];
    case 422:
      if (e.body && e.body.code === 'travel_rule_rejected') return ['A instituição de destino recusou a transferência.', 'Nada foi enviado. Confira com o destinatário o nome e a conta informados. ' + d];
      if (/insufficient funds|holds less than/.test(d)) return ['Saldo insuficiente.', 'Nada foi cobrado. Use um valor menor ou receba antes.'];
      if (/suitability|profile/.test(d)) return ['Falta o perfil de investidor.', 'Responda o questionário de perfil antes de investir.'];
      return ['Algo no pedido não confere.', d];
    case 503: return ['Um parceiro não respondeu.', 'Nenhum dinheiro saiu. Tente de novo em instantes. ' + d];
    default: return ['A plataforma não concluiu o pedido.', `Nada foi cobrado. ${d} (HTTP ${e.status})`];
  }
}

// ---------------------------------------------------------------- DOM helpers

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...kids);
const field = (label, input) => h('div', {}, h('label', { for: input.id }, label), input);
let uid = 0;
const input = (props) => h('input', { id: 'f' + ++uid, ...props });
const select = (options, props) => h('select', { id: 'f' + ++uid, ...props }, options.map(([v, l]) => h('option', { value: v }, l)));
const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
const badge = (text, tone) => h('span', { class: 'badge ' + (tone || '') }, text);

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (c) => brlFmt.format((c || 0) / 100);
const amountFmt = (s, code) => `${s} ${code}`;
const price = (s) => 'R$ ' + Number(s).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: Number(s) >= 100 ? 2 : 4 });
function relDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function qr(text) {
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR Code' });
  if (!globalThis.qrcode) return box;
  const q = globalThis.qrcode(0, 'M');
  globalThis.qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  q.addData(text, 'Byte');
  q.make();
  const svg = new DOMParser().parseFromString(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), 'image/svg+xml').documentElement;
  box.append(document.importNode(svg, true));
  return box;
}

function copyButton(text, label = 'Copiar') {
  return h('button', { type: 'button', onclick: async (ev) => {
    try {
      await navigator.clipboard.writeText(text);
      ev.target.textContent = 'Copiado ✓';
    } catch {
      ev.target.textContent = 'Selecione e copie';
    }
  } }, label);
}

function flash(kind, title, detail) {
  S.flash = { kind, title, detail };
  const slot = document.getElementById('flash');
  if (slot) slot.replaceChildren(banner());
}
function banner() {
  if (!S.flash) return '';
  const f = S.flash;
  S.flash = null;
  return h('div', { class: 'banner ' + f.kind, role: f.kind === 'error' ? 'alert' : 'status' }, h('strong', {}, f.title), ' ', f.detail || '');
}

/** Runs an action with its button disabled; shows the outcome as a calm banner. */
async function act(btn, fn, ok) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (ok) flash('success', ok, '');
    return r;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const [t, d] = explain(e);
    flash('error', t, d);
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function countdown(expiresAt, el, onEnd) {
  const tick = () => {
    const s = Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 1000));
    el.textContent = s > 0 ? `Válida por ${s} s` : 'Cotação expirada: peça outra';
    if (s === 0) {
      clearInterval(t);
      onEnd && onEnd();
    }
  };
  const t = setInterval(tick, 1000);
  S.timers.push(t);
  tick();
}

function needMerchant() {
  return card('Escolha um lojista', h('p', { class: 'muted' }, 'Esta tela trabalha com um lojista de cada vez.'),
    h('a', { class: 'button primary', href: '#/merchants' }, 'Escolher ou cadastrar lojista'));
}

// ---------------------------------------------------------------- views

const views = {};
const nav = [
  ['Dinheiro', [['overview', 'Visão geral'], ['charge', 'Cobrar'], ['payments', 'Pagamentos e estornos'], ['payouts', 'Sacar por Pix'], ['statements', 'Extratos verificados']]],
  ['Ativos', [['crypto', 'Cripto'], ['international', 'Contas internacionais'], ['investments', 'Investimentos B3']]],
  ['Operação', [['merchants', 'Lojistas'], ['devices', 'Terminais e aparelhos'], ['disputes', 'Contestações'], ['risk', 'Análise de risco'], ['compliance', 'Compliance'], ['webhooks', 'Webhooks'], ['transparency', 'Raiz pública']]],
];

views.overview = async () => {
  if (!S.merchant) return onboarding();
  const m = S.merchant;
  const [bal, entries, holdings] = await Promise.all([
    api('GET', `/v1/accounts/${m.account_id}/balance`),
    api('GET', `/v1/accounts/${m.account_id}/entries?limit=10`),
    api('GET', `/v1/holdings?merchant_id=${m.id}`).catch(() => ({ data: [] })),
  ]);
  const pending = bal.pending_by_date || [];
  return [
    h('div', { class: 'grid' },
      card('Disponível agora', h('div', { class: 'hero money pos' }, brl(bal.available)),
        h('p', { class: 'muted' }, `Atualizado ${new Date(bal.as_of).toLocaleTimeString('pt-BR')}`),
        h('div', { class: 'actions' }, h('a', { class: 'button primary', href: '#/payouts' }, 'Sacar por Pix'))),
      card('A receber', h('div', { class: 'big money' }, brl(bal.pending)),
        pending.length ? h('ul', { class: 'small' }, pending.slice(0, 5).map((d) => h('li', {}, `${relDay(d.date)}: ${brl(d.amount)}`))) : h('p', { class: 'muted' }, 'Nada a receber.'),
        bal.held ? h('p', { class: 'small' }, badge('Retido para análise', 'warn'), ' ', brl(bal.held)) : null,
        bal.reserved ? h('p', { class: 'small muted' }, `Reserva: ${brl(bal.reserved)}`) : null),
      card('Outros ativos', holdings.data.length
        ? h('ul', {}, holdings.data.map((x) => h('li', {}, amountFmt(x.amount, x.asset), x.value_brl != null ? h('span', { class: 'muted' }, ` ≈ ${brl(x.value_brl)}`) : '')))
        : h('p', { class: 'muted' }, 'Só reais por enquanto.'),
        h('div', { class: 'actions' }, h('a', { class: 'button', href: '#/crypto' }, 'Cripto'), h('a', { class: 'button', href: '#/international' }, 'Internacional'), h('a', { class: 'button', href: '#/investments' }, 'B3')))),
    card('Movimentações recentes', entriesTable(entries.data || [])),
  ];
};

// The ledger's journal types in the words a merchant uses; anything new falls back to its code.
const ENTRY = {
  card_capture: 'Venda no cartão', card_capture_reversal: 'Venda no cartão desfeita', pix_received: 'Pix recebido', refund: 'Estorno', pix_refund_send: 'Estorno por Pix',
  pix_refund_confirm: 'Estorno por Pix confirmado', pix_refund_returned: 'Estorno por Pix devolvido', pix_med_return: 'Devolução Pix (MED)', chargeback: 'Contestação',
  chargeback_won: 'Contestação ganha', payout_send: 'Saque por Pix', payout_confirm: 'Saque confirmado', payout_returned: 'Saque devolvido', scheme_settlement: 'Liquidação da bandeira',
  crypto_settle: 'Pagamento em cripto', crypto_deposit: 'Depósito em cripto', crypto_sale: 'Venda de cripto', crypto_withdrawal: 'Envio de cripto',
  crypto_withdrawal_reversed: 'Envio de cripto devolvido', conversion: 'Conversão', fx_credit: 'Recebido do exterior', international_payout: 'Pagamento no exterior',
  international_payout_reversed: 'Pagamento no exterior devolvido', investment_buy: 'Compra na B3', investment_settlement: 'Liquidação na B3',
};

function entriesTable(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'Ainda não há movimentações.');
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'O quê'), h('th', { class: 'num' }, 'Valor'))),
    h('tbody', {}, rows.map((e) => h('tr', {},
      h('td', {}, new Date(e.posted_at).toLocaleString('pt-BR')),
      h('td', {}, ENTRY[e.type] || String(e.type).replaceAll('_', ' ')),
      h('td', { class: 'num ' + (e.direction === 'credit' ? 'pos' : '') }, (e.direction === 'credit' ? '+' : '−') + brl(e.amount)))))));
}

function progress(done, total) {
  const bar = h('span');
  bar.style.width = `${Math.round((100 * done) / total)}%`;
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemin': 0, 'aria-valuemax': total }, bar);
}

function onboarding() {
  // A short list of what is left keeps the setup moving (the open tasks pull for completion).
  const steps = [
    ['Cadastre o primeiro lojista', S.merchants.length > 0, '#/merchants'],
    ['Crie um terminal ou pareie um celular', !!load('gp.did.terminal', false), '#/devices'],
    ['Faça a primeira cobrança', !!load('gp.did.charge', false), '#/charge'],
    ['Receba os eventos por webhook', !!load('gp.did.webhook', false), '#/webhooks'],
  ];
  const done = steps.filter((s) => s[1]).length;
  return card('Comece por aqui',
    progress(done, steps.length),
    h('p', { class: 'muted' }, `${done} de ${steps.length} passos`),
    h('ol', { class: 'steps' }, steps.map(([t, ok, href]) => h('li', { class: ok ? 'done' : '' }, ok ? t : h('a', { href }, t)))));
}

views.merchants = async () => {
  const open = input({ placeholder: 'mer_…' });
  const list = card('Seus lojistas', S.merchants.length
    ? h('ul', {}, S.merchants.map((m) => h('li', {}, h('button', { type: 'button', onclick: () => choose(m) }, `${m.trade_name} · ${m.id}`), S.merchant?.id === m.id ? ' ' : '', S.merchant?.id === m.id ? badge('em uso', 'ok') : '')))
    : h('p', { class: 'muted' }, 'Nenhum ainda. Cadastre um abaixo ou abra pelo ID.'),
    h('div', { class: 'row' }, field('Abrir pelo ID', open), h('div', {}, h('button', { type: 'button', onclick: async (ev) => {
      const m = await act(ev.target, () => api('GET', `/v1/merchants/${open.value.trim()}`));
      if (m) choose(m);
    } }, 'Abrir'))));
  const f = {
    doc: input({ placeholder: '12.345.678/0001-95', inputmode: 'numeric' }), legal: input({}), trade: input({}),
    mcc: input({ value: '5812', inputmode: 'numeric' }), city: input({ value: 'São Paulo' }),
    tier: select([['A', 'A (menor risco)'], ['B', 'B'], ['C', 'C']]), instant: select([['true', 'Sim'], ['false', 'Não']]),
  };
  const create = card('Cadastrar lojista',
    h('div', { class: 'row' }, field('CNPJ', f.doc), field('Razão social', f.legal), field('Nome fantasia', f.trade)),
    h('div', { class: 'row' }, field('MCC', f.mcc), field('Cidade', f.city), field('Faixa de risco', f.tier), field('Receber na hora', f.instant)),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
      const m = await act(ev.target, () => api('POST', '/v1/merchants', {
        legal: { document: { type: 'cnpj', number: f.doc.value.replace(/\D/g, '') }, legal_name: f.legal.value, trade_name: f.trade.value, mcc: f.mcc.value, city: f.city.value },
        plan: { CreditBps: 319, DebitBps: 137, InstallmentBps: 499, PixBps: 0, Tier: f.tier.value, Instant: f.instant.value === 'true' },
      }), 'Lojista cadastrado.');
      if (m) choose(m);
    } }, 'Cadastrar')));
  return [list, create];
};

function choose(m) {
  const slim = { id: m.id, account_id: m.account_id, trade_name: m.trade_name || m.legal?.trade_name || m.id };
  S.merchant = slim;
  S.merchants = [slim, ...S.merchants.filter((x) => x.id !== slim.id)].slice(0, 20);
  save('gp.merchant', slim);
  save('gp.merchants', S.merchants);
  location.hash = '#/overview';
  render();
}

views.devices = async () => {
  if (!S.merchant) return needMerchant();
  const out = h('div', { class: 'stack' });
  const type = select([['mpoc_cots', 'Celular (MPoC / Tap to Pay)'], ['pos', 'Maquininha (POS)']]);
  const revokeId = input({ placeholder: 'T…' });
  const reason = input({ placeholder: 'aparelho perdido' });
  return [
    card('Parear um celular', h('p', { class: 'muted' }, 'Gere um código de uso único (15 minutos) e digite-o no app goonersPAY do novo aparelho.'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
        const c = await act(ev.target, () => api('POST', `/v1/merchants/${S.merchant.id}/enrollment-codes`));
        if (c) {
          save('gp.did.terminal', true);
          out.replaceChildren(h('p', { class: 'hero mono' }, c.code), qr(c.code), h('p', { class: 'muted' }, `Vale até ${new Date(c.expires_at).toLocaleTimeString('pt-BR')}`));
        }
      } }, 'Gerar código')), out),
    card('Registrar terminal', field('Tipo', type), h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async (ev) => {
      const t = await act(ev.target, () => api('POST', '/v1/terminals', { merchant_id: S.merchant.id, type: type.value }), 'Terminal registrado.');
      if (t) {
        save('gp.did.terminal', true);
        flash('success', 'Terminal registrado:', t.terminal_id);
      }
    } }, 'Registrar'))),
    card('Revogar terminal', h('p', { class: 'muted' }, 'Revogar é definitivo: o terminal não autoriza mais nenhuma venda.'),
      h('div', { class: 'row' }, field('Terminal', revokeId), field('Motivo', reason)),
      h('div', { class: 'actions' }, h('button', { class: 'danger', type: 'button', onclick: (ev) => act(ev.target, () => api('POST', `/v1/terminals/${revokeId.value.trim()}/revoke`, { reason: reason.value }), 'Terminal revogado.') }, 'Revogar'))),
  ];
};

views.charge = async () => {
  if (!S.merchant) return needMerchant();
  const amount = input({ inputmode: 'decimal', placeholder: '129,90', autofocus: true });
  const method = select([['pix', 'Pix'], ['USDT/tron', 'USDT (Tron)'], ['USDT/ethereum', 'USDT (Ethereum)'], ['USDC/polygon', 'USDC (Polygon)'], ['BTC/bitcoin', 'Bitcoin'], ['ETH/ethereum', 'Ether']]);
  // Cripto: who pays, when the customer agrees to say (the travel rule's originator; docs/09 §6.6).
  const payerName = input({ placeholder: 'opcional', autocomplete: 'off' });
  const payerDoc = input({ inputmode: 'numeric', placeholder: 'opcional', autocomplete: 'off' });
  const payerRow = h('div', { class: 'row', hidden: true }, field('Nome do cliente', payerName), field('CPF ou CNPJ do cliente', payerDoc));
  method.addEventListener('change', () => { payerRow.hidden = method.value === 'pix'; });
  const out = h('div', { class: 'stack' });
  const cents = () => Math.round(parseFloat(amount.value.replace(/\./g, '').replace(',', '.')) * 100);
  return [card('Nova cobrança',
    h('div', { class: 'row' }, field('Valor (R$)', amount), field('Forma', method)), payerRow,
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
      const n = cents();
      if (!(n > 0)) return flash('error', 'Valor inválido.', 'Digite o valor em reais, por exemplo 129,90.');
      const isPix = method.value === 'pix';
      const [asset, network] = method.value.split('/');
      const pi = await act(ev.target, async () => {
        const created = await api('POST', '/v1/payment-intents', { merchant_id: S.merchant.id, amount: n, channel: isPix ? 'pix' : 'crypto' });
        const confirm = isPix ? { payment_method_type: 'pix' } : { payment_method_type: 'crypto', asset, network };
        const doc = payerDoc.value.replace(/\D/g, '');
        if (!isPix && payerName.value.trim() && doc) confirm.payer = { type: doc.length === 14 ? 'legal' : 'natural', name: payerName.value.trim(), document: doc, country: 'BR' };
        return api('POST', `/v1/payment-intents/${created.id}/confirm`, confirm);
      });
      if (pi) {
        save('gp.did.charge', true);
        showCharge(out, pi);
      }
    } }, 'Cobrar')), out)];
};

function showCharge(out, pi) {
  const a = pi.next_action || {};
  const status = h('p', { 'aria-live': 'polite' }, badge('Aguardando o pagamento', 'warn'));
  const body = [h('p', { class: 'hero money' }, brl(pi.amount)), status];
  if (a.type === 'pix_qr') body.push(qr(a.br_code), h('p', { class: 'small mono' }, a.br_code), copyButton(a.br_code, 'Copiar Pix copia e cola'));
  if (a.type === 'crypto_transfer') {
    const timer = h('span', { class: 'muted' });
    countdown(a.expires_at, timer);
    body.push(qr(a.uri || a.address), kv([['Envie exatamente', `${a.amount} ${a.asset}`], ['Rede', a.network], ['Endereço', a.address], ['Memo', a.memo], ['Cotação', `${price(a.price)} por ${a.asset}`]]),
      h('p', {}, timer), copyButton(a.address, 'Copiar endereço'));
    if (S.env !== 'production') {
      body.push(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: (ev) => act(ev.target, () => api('POST', `/v1/sandbox/crypto/payments/${pi.id}`)) }, 'Simular pagamento (sandbox)'),
        h('button', { type: 'button', onclick: (ev) => act(ev.target, () => api('POST', `/v1/sandbox/crypto/payments/${pi.id}`, { from: a.network === 'ethereum' || a.network === 'polygon' ? '0x0000000000000000000000000000000000000bad' : 'TSanctionedTestAddressForSandbox12' })) },
          'Simular remetente sancionado')));
    }
  }
  out.replaceChildren(card(null, ...body));
  const poll = setInterval(async () => {
    try {
      const now = await api('GET', `/v1/payment-intents/${pi.id}`);
      if (now.status === 'captured') {
        clearInterval(poll);
        status.replaceChildren(badge('Pago ✓', 'ok'), ' ', now.receipt ? 'Recibo emitido.' : '');
      } else if (now.status === 'canceled' || now.status === 'failed') {
        clearInterval(poll);
        status.replaceChildren(badge('Não concluído', 'bad'), ' A cobrança expirou ou foi cancelada; nenhum valor entrou.');
      } else if (now.status === 'processing' && pi.channel === 'crypto') {
        status.replaceChildren(badge('Em verificação', 'warn'), ' O pagamento chegou e passa por uma verificação de segurança. O valor entra assim que ela terminar; acompanhe em Pagamentos.');
      }
    } catch {
      /* keep polling */
    }
  }, 2000);
  S.timers.push(poll);
}

views.payments = async () => {
  const id = input({ placeholder: 'pi_…' });
  const out = h('div', { class: 'stack' });
  const show = (pi) => {
    const refund = input({ inputmode: 'decimal', placeholder: 'valor (vazio: total)' });
    out.replaceChildren(card(`Pagamento ${pi.id}`,
      kv([['Situação', pi.status], ['Valor', brl(pi.amount)], ['Capturado', brl(pi.amount_captured)], ['Estornado', brl(pi.amount_refunded)], ['Canal', pi.channel],
        ['Lojista', pi.merchant_id], ['Criado', new Date(pi.created_at).toLocaleString('pt-BR')], ['Recibo (Nostr)', pi.receipt?.nostr_event_id]]),
      h('details', {}, h('summary', {}, 'Detalhes técnicos'), h('pre', { class: 'mono small' }, JSON.stringify(pi, null, 2))),
      h('div', { class: 'row' }, field('Estornar (R$)', refund)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: async (ev) => {
          const v = refund.value.trim() ? Math.round(parseFloat(refund.value.replace(',', '.')) * 100) : undefined;
          if (await act(ev.target, () => api('POST', '/v1/refunds', { payment_intent_id: pi.id, amount: v }), 'Estorno enviado.')) show(await api('GET', `/v1/payment-intents/${pi.id}`));
        } }, 'Estornar'),
        h('button', { class: 'danger', type: 'button', onclick: async (ev) => {
          const r = await act(ev.target, () => api('POST', `/v1/payment-intents/${pi.id}/cancel`), 'Pagamento cancelado.');
          if (r) show(r);
        } }, 'Cancelar pagamento'))));
  };
  return [card('Buscar pagamento', h('div', { class: 'row' }, field('ID', id), h('div', {}, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
    const pi = await act(ev.target, () => api('GET', `/v1/payment-intents/${id.value.trim()}`));
    if (pi) show(pi);
  } }, 'Buscar')))), out];
};

views.payouts = async () => {
  if (!S.merchant) return needMerchant();
  const amount = input({ inputmode: 'decimal', placeholder: '150,00' });
  const keyType = select([['cnpj', 'CNPJ'], ['cpf', 'CPF'], ['email', 'E-mail'], ['phone', 'Telefone'], ['evp', 'Aleatória']]);
  const key = input({});
  const out = h('div');
  return [card('Sacar por Pix', h('p', { class: 'muted' }, 'Você vê a tarifa e o valor que chega antes de confirmar.'),
    h('div', { class: 'row' }, field('Valor (R$)', amount), field('Tipo de chave', keyType), field('Chave Pix', key)),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
      const q = await act(ev.target, () => api('POST', '/v1/payouts/quotes', { account_id: S.merchant.account_id, amount: Math.round(parseFloat(amount.value.replace(',', '.')) * 100),
        destination: { type: 'pix', key_type: keyType.value, key: key.value.trim() } }));
      if (!q) return;
      const timer = h('span', { class: 'muted' });
      out.replaceChildren(card('Confira antes de confirmar', kv([['Saque', brl(q.amount)], ['Tarifa', brl(q.fee_total)], ['Chega na conta', brl(q.net_to_destination)]]), h('p', {}, timer),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev2) => {
          const p = await act(ev2.target, () => api('POST', '/v1/payouts', { quote_id: q.id }));
          if (p) out.replaceChildren(card('Saque enviado', kv([['Valor', brl(p.amount)], ['Situação', p.status], ['E2E', p.end_to_end_id]])));
        } }, 'Confirmar saque'), h('button', { type: 'button', onclick: () => out.replaceChildren() }, 'Desistir'))));
      if (q.expires_at) countdown(q.expires_at, timer);
    } }, 'Simular saque'))), out];
};

views.statements = async () => {
  if (!S.merchant) return needMerchant();
  const keys = input({ placeholder: 'chaves publicadas da plataforma (hex), separadas por vírgula; vazio no sandbox' });
  const out = h('div', { class: 'stack' });
  const list = await api('GET', `/v1/settlements?merchant_id=${S.merchant.id}`);
  const rows = list.data || [];
  return [card('Extratos diários', h('p', { class: 'muted' }, 'Cada extrato é assinado pela goonersPAY e conferido aqui, no seu navegador, contra a raiz pública do dia. Nada do que a API diz além dos eventos assinados é levado em conta.'),
    field('Chaves da plataforma', keys),
    rows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Dia'), h('th', { class: 'num' }, 'Vendas'), h('th', { class: 'num' }, 'Líquido'), h('th', {}))),
      h('tbody', {}, rows.map((s) => h('tr', {}, h('td', {}, s.date), h('td', { class: 'num' }, s.transaction_count), h('td', { class: 'num' }, brl(s.net)),
        h('td', {}, h('button', { type: 'button', onclick: async (ev) => {
          const r = await act(ev.target, async () => {
            const [st, root] = await Promise.all([api('GET', `/v1/settlements/${s.id}/statement`), fetch(`/v1/transparency/${s.date}`).then((x) => x.json())]);
            const pk = keys.value.split(',').map((k) => k.trim()).filter((k) => k.length === 64);
            return { s, st, ...(await verify.verifyStatement(st, root.event, S.merchant.id, pk)) };
          });
          if (r) out.replaceChildren(statementView(r));
        } }, 'Conferir')))))))
      : h('p', { class: 'muted' }, 'O extrato de um dia sai depois da 1h do dia seguinte.')), out];
};

function statementView({ s, statement, check, signers }) {
  const items = [['Assinado pela goonersPAY', check.statementSigned], ['É deste lojista', check.forThisMerchant], ['Totais batem com as vendas', check.totalsAddUp],
    ['Resumo (hash) confere', check.commitmentMatches], ['Raiz pública do dia assinada', check.rootSigned], ['Incluído na raiz pública', check.inPublicRoot]];
  return card(`Extrato de ${statement.date}`,
    h('p', {}, check.ok ? badge('Conferido ✓', 'ok') : badge('Não conferiu', 'bad'), ' ', check.ok ? 'Este extrato está na raiz pública do dia.' : 'Não use este extrato; fale com o suporte.'),
    h('ul', {}, items.map(([t, ok]) => h('li', { class: 'check' }, h('span', { class: 'mark ' + (ok ? 'pos' : 'neg') }, ok ? '✓' : '✗'), t))),
    kv([['Bruto', brl(statement.totals.gross)], ['Tarifas', brl(statement.totals.fees)], ['Líquido', brl(statement.totals.net)], ['Assinatura do extrato', signers.statement], ['Assinatura da raiz', signers.root]]),
    h('h3', {}, 'Vendas'), h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, statement.lines.map((l) => {
      const cell = h('td', {});
      cell.append(h('button', { type: 'button', onclick: async (ev) => {
        const p = await act(ev.target, () => api('GET', `/v1/settlements/${s.id}/proofs/${l.receipt_event_id}`));
        if (p) cell.replaceChildren((await verify.receiptIncluded(statement, p)) ? badge('Recibo incluído ✓', 'ok') : badge('Prova não confere', 'bad'));
      } }, 'Provar recibo'));
      return h('tr', {}, h('td', { class: 'num' }, brl(l.amount)), h('td', { class: 'num muted' }, `tarifa ${brl(l.fee)}`), cell);
    })))));
}

views.disputes = async () => {
  const status = select([['', 'Todas'], ['evidence_required', 'Aguardando defesa'], ['represented', 'Defesa enviada'], ['won', 'Ganhas'], ['lost', 'Perdidas']]);
  const out = h('div');
  const load_ = async () => {
    const l = await api('GET', '/v1/disputes' + (status.value ? `?status=${status.value}` : ''));
    out.replaceChildren(l.data.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Contestação'), h('th', {}, 'Motivo'), h('th', { class: 'num' }, 'Valor'), h('th', {}, 'Prazo'), h('th', {}))),
      h('tbody', {}, l.data.map((d) => h('tr', {}, h('td', {}, d.id, h('br'), badge(d.status, d.status === 'won' ? 'ok' : d.status === 'lost' ? 'bad' : 'warn')), h('td', {}, `${d.scheme} ${d.reason_code} (${d.category})`),
        h('td', { class: 'num' }, brl(d.amount)), h('td', {}, d.evidence_due_at ? new Date(d.evidence_due_at).toLocaleDateString('pt-BR') : '—'), h('td', {}, disputeActions(d)))))))
      : h('p', { class: 'muted' }, 'Nenhuma contestação.'));
  };
  status.addEventListener('change', load_);
  await load_();
  return card('Contestações (chargebacks)', field('Situação', status), out);
};

function disputeActions(d) {
  if (d.status !== 'evidence_required') return '';
  const text = h('textarea', { id: 'f' + ++uid, placeholder: 'Explique a venda: o cliente estava presente, recebeu o produto…' });
  return h('details', {}, h('summary', {}, 'Responder'), field('Defesa', text), h('div', { class: 'actions' },
    h('button', { class: 'primary', type: 'button', onclick: (ev) => act(ev.target, () => api('POST', `/v1/disputes/${d.id}/evidence`, { explanation: text.value, use_auto_evidence: true, submit: true }), 'Defesa enviada.') }, 'Enviar defesa'),
    h('button', { class: 'danger', type: 'button', onclick: (ev) => act(ev.target, () => api('POST', `/v1/disputes/${d.id}/accept`), 'Contestação aceita.') }, 'Aceitar')));
}

views.risk = async () => {
  const status = select([['open', 'Abertas'], ['released', 'Liberadas'], ['fraud', 'Fraude confirmada']]);
  const out = h('div');
  const load_ = async () => {
    const l = await api('GET', `/v1/risk/reviews?status=${status.value}`);
    out.replaceChildren(l.data.length ? h('div', { class: 'stack' }, l.data.map((r) => {
      const note = input({ placeholder: 'o que você verificou (obrigatório)' });
      return card(`${r.action === 'decline_freeze' ? 'Terminal congelado' : 'Venda retida'} · ${brl(r.amount)}`,
        kv([['Lojista', r.merchant_id], ['Terminal', r.terminal_id], ['Pagamento', r.payment_intent_id], ['Celular', `${r.device.level} ${r.device.signals.join(', ')}`],
          ['Plataforma', `${r.server.level} ${r.server.signals.join(', ')}`], ['Quando', new Date(r.created_at).toLocaleString('pt-BR')]]),
        r.status === 'open' ? [field('Nota', note), h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'button', onclick: async (ev) => (await act(ev.target, () => api('POST', `/v1/risk/reviews/${r.id}/resolve`, { resolution: 'release', note: note.value }), 'Liberado.')) && load_() }, 'Liberar (venda legítima)'),
          h('button', { class: 'danger', type: 'button', onclick: async (ev) => (await act(ev.target, () => api('POST', `/v1/risk/reviews/${r.id}/resolve`, { resolution: 'fraud', note: note.value }), 'Fraude registrada.')) && load_() }, 'Confirmar fraude'))]
          : kv([['Decisão', r.status], ['Por', r.reviewed_by], ['Nota', r.note]]));
    })) : h('p', { class: 'muted' }, 'Nada para analisar.'));
  };
  status.addEventListener('change', load_);
  await load_();
  return card('Análise de risco', h('p', { class: 'muted' }, 'Vendas que o escudo antifraude aprovou mas reteve, e terminais que ele congelou.'), field('Mostrar', status), out);
};

// ---- conversions (crypto and foreign currency share the quote → confirm flow)

function conversionForm(assetsList, title, note) {
  const side = select([['buy', 'Comprar (reais → ativo)'], ['sell', 'Vender (ativo → reais)']]);
  const asset = select(assetsList.map((a) => [a, a]));
  const amount = input({ inputmode: 'decimal', placeholder: 'em reais para comprar; no ativo para vender' });
  const out = h('div');
  return card(title, note ? h('p', { class: 'muted' }, note) : null,
    h('div', { class: 'row' }, field('Operação', side), field('Ativo', asset), field('Quantia', amount)),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
      const v = amount.value.replace(',', '.').trim();
      const body = { merchant_id: S.merchant.id, side: side.value, asset: asset.value };
      if (side.value === 'buy') body.brl_amount = Math.round(parseFloat(v) * 100);
      else body.amount = v;
      const q = await act(ev.target, () => api('POST', '/v1/conversions', body));
      if (!q) return;
      const timer = h('span', { class: 'muted' });
      const confirm = h('button', { class: 'primary', type: 'button', onclick: async (ev2) => {
        const x = await act(ev2.target, () => api('POST', `/v1/conversions/${q.id}/execute`), 'Conversão concluída.');
        if (x) out.replaceChildren(card('Concluído', kv([['Ativo', `${x.amount} ${x.asset}`], ['Total', brl(x.total)]])));
      } }, 'Confirmar');
      out.replaceChildren(card('Confira antes de confirmar', kv([
        [q.side === 'buy' ? 'Você recebe' : 'Você vende', `${q.amount} ${q.asset}`], ['Preço', price(q.price)], ['Valor', brl(q.brl_units)], ['Tarifa', brl(q.fee)],
        ['IOF', q.tax ? brl(q.tax) : null], [q.side === 'buy' ? 'Sai da conta' : 'Entra na conta', brl(q.total)], ['Onde', q.venue]]),
        h('p', {}, timer), h('div', { class: 'actions' }, confirm, h('button', { type: 'button', onclick: () => out.replaceChildren() }, 'Desistir'))));
      countdown(q.expires_at, timer, () => { confirm.disabled = true; });
    } }, 'Cotar')), out);
}

views.crypto = async () => {
  if (!S.merchant) return needMerchant();
  const [markets, holdings] = await Promise.all([api('GET', '/v1/crypto/markets'), api('GET', `/v1/holdings?merchant_id=${S.merchant.id}`)]);
  const w = { asset: select([['BTC', 'BTC'], ['ETH', 'ETH'], ['USDT', 'USDT'], ['USDC', 'USDC']]), network: select([['bitcoin', 'bitcoin'], ['ethereum', 'ethereum'], ['tron', 'tron'], ['polygon', 'polygon'], ['solana', 'solana']]),
    address: input({}), memo: input({ placeholder: 'opcional' }), amount: input({ inputmode: 'decimal' }),
    kind: select([['wallet', 'Carteira sem corretora (autocustódia)'], ['exchange', 'Conta em outra corretora']]),
    owner: select([['self', 'O próprio lojista'], ['third', 'Outra pessoa ou empresa']]), ownerName: input({}), ownerDoc: input({ inputmode: 'numeric', placeholder: 'CPF ou CNPJ' }),
    vaspName: input({ placeholder: 'razão social da corretora' }), vaspLEI: input({ placeholder: 'opcional, 20 caracteres' }), vaspCountry: input({ value: 'BR', maxlength: 2 }) };
  const ownerRow = h('div', { class: 'row', hidden: true }, field('Nome do titular', w.ownerName), field('Documento do titular', w.ownerDoc));
  const vaspRow = h('div', { class: 'row', hidden: true }, field('Corretora de destino', w.vaspName), field('LEI da corretora', w.vaspLEI), field('País', w.vaspCountry));
  w.owner.addEventListener('change', () => { ownerRow.hidden = w.owner.value === 'self'; });
  w.kind.addEventListener('change', () => { vaspRow.hidden = w.kind.value !== 'exchange'; });
  const withdrawal = () => {
    const body = { merchant_id: S.merchant.id, asset: w.asset.value, network: w.network.value, address: w.address.value.trim(), memo: w.memo.value.trim(),
      amount: w.amount.value.replace(',', '.'), destination_type: w.kind.value };
    if (w.owner.value === 'third') {
      const doc = w.ownerDoc.value.replace(/\D/g, '');
      body.beneficiary = { type: doc.length === 14 ? 'legal' : 'natural', name: w.ownerName.value.trim(), document: doc || undefined, country: 'BR' };
    }
    if (w.kind.value === 'exchange') body.beneficiary_vasp = { name: w.vaspName.value.trim(), lei: w.vaspLEI.value.trim() || undefined, country: w.vaspCountry.value.trim().toUpperCase() };
    return api('POST', '/v1/crypto/withdrawals', body);
  };
  return [
    card('Mercados', h('p', { class: 'muted' }, 'O melhor preço entre as corretoras conectadas, em reais.'), h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Ativo'), h('th', { class: 'num' }, 'Vender a'), h('th', { class: 'num' }, 'Comprar a'), h('th', {}, 'Redes'))),
      h('tbody', {}, markets.data.map((m) => h('tr', {}, h('td', {}, `${m.asset} · ${m.name}`), h('td', { class: 'num' }, m.bid ? price(m.bid) : '—', h('br'), h('span', { class: 'muted small' }, m.bid_venue || '')),
        h('td', { class: 'num' }, m.ask ? price(m.ask) : '—', h('br'), h('span', { class: 'muted small' }, m.ask_venue || '')), h('td', {}, m.networks.join(', ')))))))),
    card('Saldos', holdings.data.filter((x) => x.kind === 'crypto').length ? h('ul', {}, holdings.data.filter((x) => x.kind === 'crypto').map((x) => h('li', {}, `${x.amount} ${x.asset}`, x.value_brl != null ? h('span', { class: 'muted' }, ` ≈ ${brl(x.value_brl)}`) : '')))
      : h('p', { class: 'muted' }, 'Sem cripto ainda.')),
    conversionForm(['BTC', 'ETH', 'USDT', 'USDC'], 'Comprar ou vender cripto', 'Preço firme por 30 segundos; se o mercado andar mais de 1% antes da confirmação, a operação é recusada e nada é cobrado.'),
    card('Enviar cripto', h('p', { class: 'muted' }, 'Envio para fora da plataforma é definitivo. Confira a rede e o endereço; a taxa da rede é descontada do seu saldo. Todo endereço passa pela verificação de sanções, e a identificação de quem envia e de quem recebe segue com a transferência (regra de viagem).'),
      h('div', { class: 'row' }, field('Ativo', w.asset), field('Rede', w.network), field('Quantia', w.amount)), h('div', { class: 'row' }, field('Endereço', w.address), field('Memo/tag', w.memo), field('Destino', w.kind)),
      vaspRow, h('div', { class: 'row' }, field('Titular do destino', w.owner)), ownerRow,
      h('div', { class: 'actions' }, h('button', { class: 'danger', type: 'button', onclick: async (ev) => {
        const r = await act(ev.target, withdrawal);
        if (r) flash('success', 'Envio solicitado.', r.travel_rule ? (r.travel_rule.status === 'accepted' ? 'A corretora de destino aceitou os dados da regra de viagem.' : 'A declaração do titular ficou registrada.') : '');
      } }, 'Enviar'))),
  ];
};

views.international = async () => {
  if (!S.merchant) return needMerchant();
  const accts = await api('GET', `/v1/international/accounts?merchant_id=${S.merchant.id}`);
  const p = { currency: select([['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP']]), amount: input({ inputmode: 'decimal' }), reference: input({ maxlength: 35 }),
    name: input({}), type: select([['business', 'Empresa'], ['private', 'Pessoa']]), country: input({ maxlength: 2, placeholder: 'US' }),
    iban: input({ placeholder: 'EUR/GBP' }), bic: input({}), routing: input({ placeholder: 'ABA (USD)' }), account: input({}), sort: input({ placeholder: 'GBP' }) };
  const credit = { currency: select([['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP']]), amount: input({ value: '100.00' }) };
  return [
    h('div', { class: 'grid' }, accts.data.map((a) => card(`Conta em ${a.currency}`, h('div', { class: 'hero money' }, `${a.amount} ${a.currency}`),
      h('h3', {}, 'Para receber do exterior'), kv([['Titular', a.receive.holder], ['Banco', a.receive.bank], ['IBAN', a.receive.iban], ['BIC/SWIFT', a.receive.bic], ['Routing (ABA)', a.receive.routing_number],
        ['Conta', a.receive.account_number], ['Sort code', a.receive.sort_code], ['Referência (obrigatória)', a.receive.reference]]), copyButton(a.receive.reference, 'Copiar referência')))),
    conversionForm(['USD', 'EUR', 'GBP'], 'Converter reais e moedas', 'A cotação mostra o IOF à parte: 3,5% quando reais vão para a conta no exterior, 0,38% quando a moeda volta para reais.'),
    card('Pagar no exterior', h('div', { class: 'row' }, field('Moeda', p.currency), field('Valor', p.amount), field('Referência', p.reference)),
      h('div', { class: 'row' }, field('Beneficiário', p.name), field('Tipo', p.type), field('País', p.country)),
      h('div', { class: 'row' }, field('IBAN', p.iban), field('BIC', p.bic), field('Routing', p.routing), field('Conta', p.account), field('Sort code', p.sort)),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: (ev) => act(ev.target, () => api('POST', '/v1/international/payouts', {
        merchant_id: S.merchant.id, currency: p.currency.value, amount: p.amount.value.replace(',', '.'), reference: p.reference.value,
        beneficiary: { name: p.name.value, type: p.type.value, country: p.country.value.toUpperCase(), iban: p.iban.value, bic: p.bic.value, routing_number: p.routing.value, account_number: p.account.value, sort_code: p.sort.value },
      }), 'Pagamento enviado.') }, 'Enviar pagamento'))),
    S.env !== 'production' ? card('Sandbox: receber do exterior', h('div', { class: 'row' }, field('Moeda', credit.currency), field('Valor', credit.amount)),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async (ev) => (await act(ev.target, () => api('POST', '/v1/sandbox/international/credits', { merchant_id: S.merchant.id, currency: credit.currency.value, amount: credit.amount.value, payer: 'Cliente no exterior' }), 'Crédito recebido.')) && render() }, 'Simular crédito'))) : null,
  ];
};

views.investments = async () => {
  if (!S.merchant) return needMerchant();
  const prof = await api('GET', `/v1/investments/profile?merchant_id=${S.merchant.id}`).catch(() => null);
  const pf = await api('GET', `/v1/investments/positions?merchant_id=${S.merchant.id}`);
  const q = (name, opts) => {
    const sel = select(opts.map((o, i) => [String(i), o]), { name });
    sel.value = String(prof?.answers?.[name] ?? 0); // the answers on file, so a change starts from them
    return sel;
  };
  const answers = { horizon: q('horizon', ['Menos de 1 ano', '1 a 3 anos', 'Mais de 3 anos']), tolerance: q('tolerance', ['Não aceito perder', 'Aceito alguma perda', 'Aceito grandes oscilações']),
    experience: q('experience', ['Nenhuma', 'Alguma', 'Ampla']) };
  const o = { ticker: input({ placeholder: 'PETR4, BOVA11, HGLG11…', autocapitalize: 'characters' }), side: select([['buy', 'Comprar'], ['sell', 'Vender']]), qty: input({ inputmode: 'numeric', value: '100' }) };
  const quoteOut = h('div', { class: 'small muted' });
  return [
    card('Perfil de investidor', prof ? h('p', {}, 'Seu perfil: ', badge(prof.profile, prof.profile === 'conservador' ? 'warn' : 'ok')) : h('p', { class: 'muted' }, 'Responda para investir (Resolução CVM 30).'),
      h('div', { class: 'row' }, field('Por quanto tempo o dinheiro pode ficar investido?', answers.horizon), field('Quanto de perda você aceita?', answers.tolerance), field('Experiência com renda variável', answers.experience)),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async (ev) => (await act(ev.target, () => api('PUT', '/v1/investments/profile', { merchant_id: S.merchant.id,
        answers: { horizon: +answers.horizon.value, tolerance: +answers.tolerance.value, experience: +answers.experience.value } }), 'Perfil salvo.')) && render() }, 'Salvar perfil'))),
    card('Ordem na B3', h('p', { class: 'muted' }, 'Ações negociam em lotes de 100; o que sobrar vai ao mercado fracionário (ex.: PETR4F). A compra sai da conta agora; a venda entra em D+2.'),
      h('div', { class: 'row' }, field('Ticker', o.ticker), field('Operação', o.side), field('Quantidade', o.qty)), quoteOut,
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: async (ev) => {
          const x = await act(ev.target, () => api('GET', `/v1/investments/quotes/${encodeURIComponent(o.ticker.value.trim().toUpperCase())}`));
          if (x) quoteOut.textContent = `${x.ticker} · ${x.name}: ${price(x.last)} (lote ${x.lot}). Estimativa para ${o.qty.value}: ${brl(Math.round(Number(x.last) * 100 * Number(o.qty.value)))} mais taxas da B3. ${x.market_open ? 'Pregão aberto.' : 'Pregão fechado.'}`;
        } }, 'Cotar'),
        h('button', { class: 'primary', type: 'button', onclick: async (ev) => (await act(ev.target, () => api('POST', '/v1/investments/orders', { merchant_id: S.merchant.id, ticker: o.ticker.value.trim().toUpperCase(),
          side: o.side.value, quantity: parseInt(o.qty.value, 10) }), 'Ordem executada.')) && render() }, 'Enviar ordem'))),
    card('Carteira', pf.positions.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Ativo'), h('th', { class: 'num' }, 'Qtd.'), h('th', { class: 'num' }, 'Custo'), h('th', { class: 'num' }, 'Valor'), h('th', { class: 'num' }, 'Resultado'))),
      h('tbody', {}, pf.positions.map((p) => h('tr', {}, h('td', {}, p.ticker, h('br'), h('span', { class: 'muted small' }, p.name || '')), h('td', { class: 'num' }, p.quantity), h('td', { class: 'num' }, brl(p.cost)),
        h('td', { class: 'num' }, p.value != null ? brl(p.value) : '—'), h('td', { class: 'num ' + ((p.result || 0) >= 0 ? 'pos' : 'neg') }, p.result != null ? brl(p.result) : '—'))))))
      : h('p', { class: 'muted' }, 'Sem posições.'),
      pf.orders.length ? [h('h3', {}, 'Ordens'), h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, pf.orders.map((x) => h('tr', {}, h('td', {}, `${x.side === 'buy' ? 'Compra' : 'Venda'} ${x.quantity} ${x.ticker}`),
        h('td', { class: 'num' }, brl(x.total)), h('td', {}, x.status === 'settled' ? badge('liquidada', 'ok') : badge(`liquida ${relDay(x.settles_on)}`, 'warn')))))))] : null),
  ];
};

// ---- compliance: held deposits, travel-rule reviews, the travel-rule record, screenings (docs/09 §6)

const caseReason = {
  sanctions_hit: 'Remetente em lista de sanções', screening_failed: 'Verificação de sanções não concluída',
  originator_missing: 'Depósito sem dados de quem enviou', beneficiary_mismatch: 'Beneficiário informado não é o lojista',
  name_match: 'Nome em lista de sanções',
};
const caseHint = {
  sanctions_hit: 'Confira a correspondência. Se confirmada, bloqueie: o valor fica indisponível, não é devolvido, e a comunicação ao MJSP e ao COAF segue o runbook §4.12.',
  screening_failed: 'A verificação não respondeu. A plataforma tenta de novo sozinha a cada 10 minutos; libere à mão só depois de verificar os remetentes.',
  originator_missing: 'Nenhuma instituição enviou os dados de quem pagou e o cliente não se identificou. Pergunte ao lojista quem pagou, ou registre por que não é preciso.',
  beneficiary_mismatch: 'A instituição de origem informou um beneficiário com documento diferente do lojista. Confirme com o lojista antes de encerrar.',
  name_match: 'Um nome informado (quem pagou, quem recebe ou a instituição) coincide com um nome da lista. Homônimos são comuns: compare documento e data de nascimento com a entrada da lista antes de decidir.',
};
const caseStatus = { open: ['Aberto', 'warn'], released: ['Liberado', 'ok'], blocked: ['Bloqueado', 'bad'], closed: ['Encerrado', ''] };
const travelStatus = { accepted: 'Aceita', rejected: 'Recusada', unreachable: 'Sem resposta', self_declared: 'Declaração do titular', received: 'Recebida, aguardando o depósito', matched: 'Recebida e ligada ao depósito', refused: 'Recusada por nós' };

views.compliance = async () => {
  const status = select([['open', 'Abertos'], ['released', 'Liberados'], ['blocked', 'Bloqueados'], ['closed', 'Encerrados'], ['all', 'Todos']]);
  const cases = h('div');
  const loadCases = async () => {
    const l = await api('GET', `/v1/compliance/cases?status=${status.value}`);
    cases.replaceChildren(l.data.length ? h('div', { class: 'stack' }, l.data.map((c) => {
      const note = input({ placeholder: 'o que você verificou e por quê (obrigatório)' });
      const decide = (action, ok) => async (ev) => (await act(ev.target, () => api('POST', `/v1/compliance/cases/${c.id}/decision`, { action, note: note.value }), ok)) && loadCases();
      const [label, tone] = caseStatus[c.status] || [c.status, ''];
      const d = c.detail || {};
      return card(`${caseReason[c.reason] || c.reason}${c.amount ? ' · ' + amountFmt(c.amount, c.asset) : ''}`,
        h('p', {}, badge(label, tone), ' ', c.holds_funds ? 'Valor retido até a decisão.' : 'Revisão: nada foi retido.'),
        c.status === 'open' && caseHint[c.reason] ? h('p', { class: 'muted' }, caseHint[c.reason]) : null,
        kv([['Caso', c.id], ['Lojista', c.merchant_id], ['Pagamento', c.payment_intent_id], ['Transação', d.txid], ['Rede', d.network],
          ['Remetentes', (d.senders || []).join(', ')], ['Correspondências', (d.matches || []).join('; ')], ['Erros', (d.errors || []).join('; ')],
          ['Aberto em', new Date(c.created_at).toLocaleString('pt-BR')]]),
        c.status === 'open' ? [field('Nota', note), h('div', { class: 'actions' }, c.holds_funds ? [
          h('button', { class: 'primary', type: 'button', onclick: decide('release', 'Liberado: o pagamento segue.') }, 'Liberar (falso positivo ou verificado)'),
          h('button', { class: 'danger', type: 'button', onclick: decide('block', 'Bloqueado: o valor fica indisponível. Comunique o MJSP e o COAF (runbook §4.12).') }, 'Bloquear (manter indisponível)'),
        ] : h('button', { class: 'primary', type: 'button', onclick: decide('close', 'Revisão encerrada.') }, 'Encerrar revisão'))]
          : kv([['Decisão', label], ['Por', c.decided_by], ['Nota', c.decision_note], ['Em', c.decided_at && new Date(c.decided_at).toLocaleString('pt-BR')]]));
    })) : h('p', { class: 'muted' }, 'Nenhum caso aqui.'));
  };
  status.addEventListener('change', loadCases);

  const direction = select([['', 'Enviadas e recebidas'], ['outbound', 'Enviadas (saques)'], ['inbound', 'Recebidas (depósitos)']]);
  const travel = h('div');
  const loadTravel = async () => {
    const l = await api('GET', `/v1/travel-rule/messages${direction.value ? '?direction=' + direction.value : ''}`);
    travel.replaceChildren(l.data.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Sentido'), h('th', {}, 'Situação'), h('th', { class: 'num' }, 'Quantia'), h('th', {}, 'Contraparte'))),
      h('tbody', {}, l.data.map((m) => h('tr', {}, h('td', {}, new Date(m.created_at).toLocaleString('pt-BR')), h('td', {}, m.direction === 'outbound' ? 'Enviada' : 'Recebida'),
        h('td', {}, travelStatus[m.status] || m.status, m.reason ? h('br') : null, m.reason ? h('span', { class: 'muted small' }, m.reason) : null),
        h('td', { class: 'num' }, amountFmt(m.amount, m.asset)),
        h('td', {}, m.counterparty && m.counterparty.vasp ? m.counterparty.vasp.name : 'Carteira sem corretora'))))))
      : h('p', { class: 'muted' }, 'Nenhuma mensagem ainda.'));
  };
  direction.addEventListener('change', loadTravel);

  const result = select([['', 'Todas'], ['hit', 'Correspondências'], ['error', 'Não concluídas'], ['clear', 'Sem correspondência']]);
  const screenings = h('div');
  const loadScreenings = async () => {
    const l = await api('GET', `/v1/compliance/screenings?limit=50${result.value ? '&result=' + result.value : ''}`);
    screenings.replaceChildren(l.data.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Para'), h('th', {}, 'Resultado'), h('th', {}, 'Endereço'))),
      h('tbody', {}, l.data.map((x) => h('tr', {}, h('td', {}, new Date(x.created_at).toLocaleString('pt-BR')), h('td', {}, x.purpose === 'withdrawal' ? 'Saque' : 'Remetente de depósito'),
        h('td', {}, badge({ clear: 'Sem correspondência', hit: 'Correspondência', error: 'Não concluída' }[x.result], { clear: 'ok', hit: 'bad', error: 'warn' }[x.result])),
        h('td', { class: 'mono small' }, `${x.network}: ${x.address}`))))))
      : h('p', { class: 'muted' }, 'Nenhuma verificação ainda.'));
  };
  result.addEventListener('change', loadScreenings);
  await Promise.all([loadCases(), loadTravel(), loadScreenings()]);
  return [
    card('Casos de compliance', h('p', { class: 'muted' }, 'Depósitos retidos porque quem enviou está em lista de sanções ou não pôde ser verificado, e revisões da regra de viagem. Cada decisão pede uma nota e fica registrada. Não informe o cliente do motivo.'),
      field('Mostrar', status), cases),
    card('Regra de viagem', h('p', { class: 'muted' }, 'A identificação de quem envia e de quem recebe que acompanhou cada saque, e a que outras instituições enviaram com depósitos.'),
      field('Mostrar', direction), travel),
    card('Verificações de sanções', h('p', { class: 'muted' }, 'Todo endereço de saque e todo remetente de depósito, verificados contra as listas.'), field('Mostrar', result), screenings),
  ];
};

views.webhooks = async () => {
  const url = input({ placeholder: 'https://seu-sistema.example/webhooks/goonerspay' });
  const out = h('div');
  const rid = input({ placeholder: 'we_…' });
  const since = input({ type: 'datetime-local' });
  return [card('Novo endpoint', h('p', { class: 'muted' }, 'Os eventos chegam assinados (Standard Webhooks). O segredo aparece uma única vez.'), field('URL', url),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
      const w = await act(ev.target, () => api('POST', '/v1/webhook-endpoints', { url: url.value.trim(), events: ['*'] }), 'Endpoint criado.');
      if (w) {
        save('gp.did.webhook', true);
        out.replaceChildren(kv([['ID', w.id], ['Segredo', w.secret]]), copyButton(w.secret, 'Copiar segredo'));
      }
    } }, 'Criar')), out),
  card('Reenviar eventos', h('div', { class: 'row' }, field('Endpoint', rid), field('Desde', since)),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async (ev) => {
      const r = await act(ev.target, () => api('POST', `/v1/webhook-endpoints/${rid.value.trim()}/replay`, { since: new Date(since.value).toISOString(), until: new Date().toISOString() }));
      if (r) flash('success', 'Reenvio agendado:', `${r.replayed} eventos.`);
    } }, 'Reenviar')))];
};

views.transparency = async () => {
  const d = new Date(Date.now() - 86400000);
  const date = input({ type: 'date', value: d.toISOString().slice(0, 10) });
  const out = h('div');
  return [card('Raiz pública do dia', h('p', { class: 'muted' }, 'A raiz de transparência (kind 7715) é pública: qualquer pessoa confere a assinatura.'), field('Dia', date),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: async (ev) => {
      const r = await act(ev.target, () => api('GET', `/v1/transparency/${date.value}`));
      if (r) out.replaceChildren(kv([['Raiz', r.root], ['Folhas', r.tree_size], ['Evento', r.event.id], ['Anterior', r.prev_event_id], ['Assinatura', (await verify.verifyEvent(r.event)) ? '✓ confere' : '✗ não confere']]));
    } }, 'Buscar')), out)];
};

// ---------------------------------------------------------------- shell

function loginView() {
  const key = input({ type: 'password', autocomplete: 'off', placeholder: 'sk_test_… ou sk_live_…', autofocus: true });
  const err = h('div', { id: 'flash' }, banner());
  const go = async (ev) => {
    ev.preventDefault();
    S.key = key.value.trim();
    const ok = await act(ev.submitter || null, async () => {
      // Any authenticated read proves the key; the disputes list needs no merchant.
      await api('GET', '/v1/disputes?limit=1');
      return true;
    });
    if (ok) {
      S.env = S.key.startsWith('sk_live_') ? 'production' : 'sandbox';
      render();
    } else S.key = '';
  };
  return h('div', { class: 'login' }, h('div', { class: 'brand' }, 'gooners', h('b', {}, 'PAY')), h('p', { class: 'muted' }, 'Console do parceiro'), err,
    h('form', { onsubmit: go }, field('Chave de API', key), h('p', { class: 'small muted' }, 'A chave fica só na memória desta aba e some ao recarregar.'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Entrar'))));
}

async function render() {
  S.timers.forEach((t) => clearInterval(t));
  S.timers = [];
  const app = document.getElementById('app');
  if (!S.key) {
    app.replaceChildren(loginView());
    return;
  }
  const route = (location.hash.replace(/^#\//, '') || 'overview').split('?')[0];
  const view = views[route] || views.overview;
  const side = h('nav', { class: 'side', 'aria-label': 'Seções' }, h('div', { class: 'brand' }, 'gooners', h('b', {}, 'PAY')),
    nav.map(([group, items]) => [h('div', { class: 'group' }, group), items.map(([id, label]) => h('a', { href: '#/' + id, 'aria-current': id === route ? 'page' : null }, label))]),
    h('div', { class: 'group' }, 'Conta'),
    h('a', { href: '#/' + route, onclick: (e) => {
      e.preventDefault();
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      save('gp.theme', root.dataset.theme);
    } }, 'Tema claro/escuro'),
    h('a', { href: '#/', onclick: (e) => {
      e.preventDefault();
      S.key = '';
      render();
    } }, 'Sair'));
  const title = nav.flatMap(([, items]) => items).find(([id]) => id === route)?.[1] || 'Visão geral';
  const main = h('main', { id: 'main', tabindex: '-1' },
    h('header', { class: 'top' }, h('button', { class: 'menu-toggle', type: 'button', 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') }, '☰'), h('h1', {}, title),
      h('div', { class: 'who' }, S.env === 'sandbox' ? badge('sandbox', 'warn') : null,
        S.merchant ? h('a', { class: 'button', href: '#/merchants' }, S.merchant.trade_name) : h('a', { class: 'button primary', href: '#/merchants' }, 'Escolher lojista'))),
    h('div', { id: 'flash' }, banner()), h('p', { class: 'loading' }, 'Carregando…'));
  app.replaceChildren(h('div', { class: 'shell' }, side, main));
  try {
    const content = await view();
    main.lastChild.replaceWith(h('div', { class: 'stack' }, content));
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const [t, d] = explain(e);
    main.lastChild.replaceWith(h('div', { class: 'banner error', role: 'alert' }, h('strong', {}, t), ' ', d));
    if (e.status === 401) S.key = '';
  }
  side.classList.remove('open');
}

const theme = load('gp.theme', null);
if (theme) document.documentElement.dataset.theme = theme;
addEventListener('hashchange', render);
render();
