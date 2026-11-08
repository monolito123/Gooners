// The receipt claim page (docs/03 §3.2). The QR on the terminal opens /c#k=<claim key>; the
// key stays in the fragment, which the browser never sends anywhere. The page asks the
// platform's NIP-05 file which key signs receipts and which relays carry them, authenticates
// to a relay as the claim key (NIP-42), opens the gift wrap and the seal, checks every
// signature, and shows the receipt. No account, no app, no cookies.

import { publicKey, signEvent, unwrapReceipt } from './nostr.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
};

function fail(title, text) {
  const s = $('status');
  s.className = 'card error';
  s.replaceChildren(el('h2', {}, title), el('p', { class: 'muted' }, text));
}

/** Asks one relay for the gift wraps to the claim key, authenticating when it asks. */
function fetchWrap(url, secret, claimPub, waitMs = 8000) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      resolve(null);
      return;
    }
    const sub = 'claim-' + Math.random().toString(36).slice(2, 10);
    const req = () => ws.send(JSON.stringify(['REQ', sub, { kinds: [1059], '#p': [claimPub] }]));
    let done = false;
    let authPending = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    ws.onerror = () => finish(null);
    ws.onopen = req;
    ws.onmessage = async (m) => {
      let f;
      try {
        f = JSON.parse(m.data);
      } catch {
        return;
      }
      if (f[0] === 'AUTH' && typeof f[1] === 'string') {
        authPending = true;
        const ev = await signEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', url], ['challenge', f[1]]], content: '' }, secret);
        ws.send(JSON.stringify(['AUTH', ev]));
      } else if (f[0] === 'OK' && authPending) {
        authPending = false;
        if (f[2] === true) req();
      } else if (f[0] === 'EVENT' && f[1] === sub) {
        finish(f[2]);
      }
      // CLOSED (auth-required) and EOSE: keep waiting; the relay's AUTH or a live delivery
      // of a receipt published seconds ago arrives before the timeout.
    };
  });
}

const money = (a) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: a.currency || 'BRL' }).format(Number(a.value) / 10 ** (a.exponent ?? 2));
const when = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const cnpj = (d) => (/^\d{14}$/.test(d) ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d);
const brands = { visa: 'Visa', mastercard: 'Mastercard', elo: 'Elo', amex: 'American Express', hipercard: 'Hipercard' };

function methodLine(m = {}, inst = {}) {
  if (m.type === 'pix') return 'Pix';
  if (m.type === 'crypto') return 'Cripto' + (m.asset ? ` (${m.asset})` : '');
  const parts = [brands[m.brand] || m.application_label || 'Cartão'];
  if (m.funding === 'credit') parts.push('crédito');
  if (m.funding === 'debit') parts.push('débito');
  if (m.last4) parts.push('•••• ' + m.last4);
  if (inst.count > 1) parts.push(`em ${inst.count}x`);
  return parts.join(' ');
}

function render(receipt, signer) {
  const c = JSON.parse(receipt.content);
  const auth = c.authorization || {};
  const rows = [
    ['Data', when(auth.approved_at || receipt.created_at * 1000)],
    ['Autorização', auth.code],
    ['NSU', auth.stan],
    ['Terminal', auth.terminal_id],
    ['Pagamento', c.payment_intent_id],
  ].filter(([, v]) => v);
  const download = () => {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `comprovante-${c.receipt_id || receipt.id.slice(0, 12)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const merchant = c.merchant || {};
  $('receipt').replaceChildren(
    el('h1', {}, merchant.name || 'Comprovante'),
    el('p', { class: 'merchant' }, [merchant.cnpj && 'CNPJ ' + cnpj(merchant.cnpj), merchant.address].filter(Boolean).join(' · ') || 'Comprovante de pagamento'),
    el('p', { class: 'amount' }, money(c.amount || {})),
    el('p', { class: 'method' }, methodLine(c.method, c.installments)),
    el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])),
    el('div', { class: 'verified' },
      el('span', { class: 'tick', 'aria-hidden': 'true' }, '✓'),
      el('div', {},
        el('div', {}, 'Assinado pela goonersPAY'),
        el('div', { class: 'muted small' }, `receipts@${location.host}`),
        el('div', { class: 'mono muted' }, receipt.id))),
    el('p', { class: 'fiscal' }, c.fiscal_note || 'Comprovante de pagamento. Não é documento fiscal.'),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: () => window.print() }, 'Imprimir ou salvar em PDF'),
      el('button', { type: 'button', onclick: download }, 'Baixar comprovante assinado')),
  );
  $('status').hidden = true;
  $('receipt').hidden = false;
  document.title = `${money(c.amount || {})} · ${merchant.name || 'Comprovante'}`;
}

async function main() {
  const m = /(?:^#|&)k=([0-9a-fA-F]{64})(?:&|$)/.exec(location.hash);
  if (!m) {
    fail('Link incompleto', 'Este endereço não traz a chave do comprovante. Abra o link completo do QR code da compra.');
    return;
  }
  const secret = m[1].toLowerCase();
  let claimPub;
  try {
    claimPub = publicKey(secret);
  } catch {
    fail('Link inválido', 'A chave deste link não é válida. Confira o QR code da compra.');
    return;
  }
  let signer, relays;
  try {
    const info = await (await fetch('/.well-known/nostr.json?name=receipts', { cache: 'no-store' })).json();
    signer = info.names && info.names.receipts;
    relays = (info.relays && info.relays[signer]) || [];
  } catch {}
  if (!signer || !relays.length) {
    fail('Comprovantes indisponíveis', 'Não foi possível consultar a goonersPAY agora. Tente de novo em instantes.');
    return;
  }
  for (const url of relays) {
    const wrap = await fetchWrap(url, secret, claimPub);
    if (!wrap) continue;
    try {
      const { receipt } = await unwrapReceipt(wrap, secret, signer);
      render(receipt, signer);
      return;
    } catch (e) {
      fail('Comprovante inválido', 'As assinaturas deste comprovante não conferem. Não o use como prova de pagamento.');
      return;
    }
  }
  fail('Comprovante não encontrado', 'Ele pode levar alguns segundos para chegar: tente de novo em instantes. Comprovantes não abertos expiram em 90 dias.');
}

main();
