// End-to-end: two real browsers run the built app (dist/) against a local Nostr relay.
//   npm run build && npm run test:e2e
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve } from '../scripts/serve.mjs';
import { startRelay } from './local-relay.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const RELAY_PORT = 17777;
const WEB_PORT = 18080;
const URL_ = `http://localhost:${WEB_PORT}/`;
const RELAY = `ws://localhost:${RELAY_PORT}`;
const PASS = 'senha-de-teste-longa';
const BUCKETS = Array.from({ length: 9 }, (_, i) => 4096 << i);

let relay, server, browser;
const consoleErrors = [];

async function newUser(name) {
  const context = await browser.newContext();
  // Keep tests hermetic: never touch the public default relays, only the local one.
  await context.routeWebSocket(/^wss:\/\//, (ws) => ws.close());
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`${name}: ${e.message}`));
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel('Seu nome').fill(name);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const words = await page.locator('.words li').allTextContents();
  assert.equal(words.length, 24);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Já anotei' }).click();
  for (const label of await page.locator('.field > label').allTextContents()) {
    const n = Number(label.match(/\d+/)[0]);
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]);
  }
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByLabel('Repita a senha').fill(PASS);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Conversas').waitFor({ timeout: 60_000 });
  // Point the account at the local relay (this also republishes the contact card).
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Relays Nostr (um por linha)').fill(RELAY);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Salvo. Seu cartão foi republicado.').waitFor({ timeout: 20_000 });
  await page.evaluate(() => (location.hash = '#/'));
  return { context, page, name };
}

async function openChat(page, name) {
  await page.evaluate(() => (location.hash = '#/'));
  await page.locator('a.row', { hasText: name }).click();
  await page.locator('.composer').waitFor();
}

async function send(page, text) {
  await page.locator('.composer').fill(text);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

const bubble = (page, text) => page.locator('.msg', { hasText: text });

describe('SMA web app end to end', { timeout: 240_000 }, () => {
  before(async () => {
    relay = startRelay(RELAY_PORT);
    server = await serve(WEB_PORT);
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
    server?.close();
    await relay?.close();
  });

  let alice, bob;

  it('onboards two users and exchanges an invite', async () => {
    [alice, bob] = await Promise.all([newUser('Alice Lima'), newUser('Bruno Costa')]);
    await bob.page.evaluate(() => (location.hash = '#/invite'));
    const link = (await bob.page.locator('.linkbox').textContent()).trim();
    assert.match(link, /#c=[A-Za-z0-9_-]+$/);
    assert.ok(link.length < 400, `invite link is short enough for a QR code (${link.length})`);
    assert.equal(await bob.page.locator('canvas.qr').count(), 1);

    await alice.page.evaluate(() => (location.hash = '#/add'));
    await alice.page.getByLabel('Link ou código do convite').fill(link);
    await alice.page.getByRole('button', { name: 'Adicionar contato' }).click();
    await alice.page.locator('.chattitle', { hasText: 'Bruno' }).waitFor({ timeout: 20_000 });
    await bob.page.evaluate(() => (location.hash = '#/'));
  });

  it('delivers the first message, shows the sender by name, and returns a delivery receipt', async () => {
    await send(alice.page, 'Olá Bob, tudo bem? 👋');
    await bob.page.locator('a.row', { hasText: 'Alice' }).waitFor({ timeout: 20_000 });
    await openChat(bob.page, 'Alice');
    await bubble(bob.page, 'Olá Bob, tudo bem? 👋').waitFor();
    await bubble(alice.page, 'Olá Bob').locator('.meta', { hasText: '✓✓' }).waitFor({ timeout: 20_000 });
  });

  it('replies both ways', async () => {
    await send(bob.page, 'Oi Alice! Tudo ótimo.');
    await bubble(alice.page, 'Oi Alice! Tudo ótimo.').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3; i++) {
      await send(alice.page, `ping ${i}`);
      await bubble(bob.page, `ping ${i}`).waitFor({ timeout: 20_000 });
      await send(bob.page, `pong ${i}`);
      await bubble(alice.page, `pong ${i}`).waitFor({ timeout: 20_000 });
    }
  });

  it('shows matching safety numbers on both sides', async () => {
    await alice.page.evaluate(() => (location.hash = '#/'));
    await alice.page.locator('a.row', { hasText: 'Bruno' }).click();
    await alice.page.getByRole('button', { name: 'Informações do contato' }).click();
    const a = (await alice.page.locator('.safety').textContent()).trim();
    await bob.page.getByRole('button', { name: 'Informações do contato' }).click();
    const b = (await bob.page.locator('.safety').textContent()).trim();
    assert.equal(a, b);
    assert.equal(a.length, 60);
  });

  it('delivers while the recipient is offline, and the vault survives a restart', async () => {
    await bob.page.close();
    await openChat(alice.page, 'Bruno');
    await send(alice.page, 'mensagem enquanto você estava fora');
    await bubble(alice.page, 'mensagem enquanto').locator('.meta', { hasText: '✓' }).waitFor({ timeout: 20_000 });

    const page = await bob.context.newPage();
    page.on('pageerror', (e) => consoleErrors.push(`Bob: ${e.message}`));
    await page.goto(URL_);
    await page.getByLabel('Senha').fill('senha errada');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await page.getByText('Senha incorreta.').waitFor({ timeout: 30_000 });
    await page.getByLabel('Senha').fill(PASS);
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await page.getByText('Conversas').waitFor({ timeout: 30_000 });
    await openChat(page, 'Alice');
    await bubble(page, 'pong 2').waitFor(); // history restored from the vault
    await bubble(page, 'mensagem enquanto você estava fora').waitFor({ timeout: 20_000 });
    bob.page = page;
    await send(page, 'voltei');
    await bubble(alice.page, 'voltei').waitFor({ timeout: 20_000 });
  });

  it('the relay only ever saw opaque, bucket-sized frames', () => {
    const frames = relay.events.filter((e) => e.kind === 9259);
    assert.ok(frames.length >= 12, `frames on relay: ${frames.length}`);
    const authors = new Set(frames.map((e) => e.pubkey));
    assert.equal(authors.size, frames.length, 'a fresh key per event');
    for (const e of frames) {
      assert.ok(BUCKETS.includes(Buffer.from(e.content, 'base64url').length), 'bucket size');
      assert.deepEqual(e.tags.map((t) => t[0]).sort(), ['expiration', 'z']);
    }
    // Search the JSON and the decoded binary of every event (cards included) for plaintext.
    const json = JSON.stringify(relay.events);
    const bytes = Buffer.concat(relay.events.map((e) => Buffer.from(e.content, 'base64url')));
    for (const secret of ['Olá Bob, tudo bem?', 'mensagem enquanto você estava fora', 'Alice Lima', 'Bruno Costa', 'Oi Alice! Tudo ótimo.']) {
      assert.ok(!json.includes(secret), `"${secret}" in event JSON`);
      assert.equal(bytes.indexOf(Buffer.from(secret, 'utf8')), -1, `"${secret}" in event bytes`);
    }
  });

  it('logged no errors in either browser', () => {
    const real = consoleErrors.filter((e) => !/wss:\/\/|ERR_|WebSocket/.test(e));
    assert.deepEqual(real, []);
  });
});
