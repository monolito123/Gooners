// Live smoke test: two fresh browsers use a deployed copy of the app with its default
// public Nostr relays (onboarding, invite, messages both ways, delivery receipts).
// It posts a handful of small encrypted test events to those relays, so run it by hand:
//   node test/live-smoke.mjs [url]        (default: the GitHub Pages deployment)
// Set HTTPS_PROXY to route the browsers through a proxy.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL_ = process.argv[2] ?? 'https://monolito123.github.io/Gooners/messenger/';
const PASS = 'senha-de-teste-longa';
const T = 60_000;

const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {});
const errors = [];
const step = (s) => console.log(`✔ ${s}`);

async function newUser(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(URL_, { timeout: T });
  await page.getByRole('button', { name: 'Criar conta' }).click({ timeout: T });
  await page.getByLabel('Seu nome').fill(name);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const words = await page.locator('.words li').allTextContents();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Já anotei' }).click();
  for (const label of await page.locator('.field > label').allTextContents()) {
    await page.getByLabel(label, { exact: true }).fill(words[Number(label.match(/\d+/)[0]) - 1]);
  }
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByLabel('Repita a senha').fill(PASS);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Conversas').waitFor({ timeout: T });
  return page;
}

const send = async (page, text) => {
  await page.locator('.composer').fill(text);
  await page.getByRole('button', { name: 'Enviar' }).click();
};
const bubble = (page, text) => page.locator('.msg', { hasText: text });

try {
  const tag = Math.random().toString(36).slice(2, 7);
  const [alice, bob] = await Promise.all([newUser(`Alice ${tag}`), newUser(`Bruno ${tag}`)]);
  step(`two accounts created on ${URL_}`);
  await alice.waitForFunction(() => /^[1-9]/.test(document.querySelector('.dot')?.textContent ?? ''), null, { timeout: T });
  step(`Alice connected to relays: ${await alice.locator('.dot').textContent()}`);

  await bob.evaluate(() => (location.hash = '#/invite'));
  const link = (await bob.locator('.linkbox').textContent()).trim();
  assert.ok(link.startsWith(URL_), `invite points at the deployment: ${link.slice(0, 60)}`);
  await bob.evaluate(() => (location.hash = '#/'));
  step('Bob published his invite card');

  await alice.evaluate(() => (location.hash = '#/add'));
  await alice.getByLabel('Link ou código do convite').fill(link);
  await alice.getByRole('button', { name: 'Adicionar contato' }).click();
  await alice.locator('.chattitle', { hasText: 'Bruno' }).waitFor({ timeout: T });
  step('Alice fetched and verified Bob’s card from the public relays');

  await send(alice, `olá do teste ao vivo ${tag}`);
  await bob.locator('a.row', { hasText: 'Alice' }).waitFor({ timeout: T });
  await bob.locator('a.row', { hasText: 'Alice' }).click();
  await bubble(bob, `olá do teste ao vivo ${tag}`).waitFor({ timeout: T });
  step('first message delivered through public relays');

  await bubble(alice, `olá do teste ao vivo ${tag}`).locator('.meta', { hasText: '✓✓' }).waitFor({ timeout: T });
  step('delivery receipt came back');

  await send(bob, `resposta ${tag}`);
  await bubble(alice, `resposta ${tag}`).waitFor({ timeout: T });
  step('reply delivered');

  assert.deepEqual(errors, []);
  console.log('\nLIVE SMOKE TEST PASSED');
} catch (e) {
  console.error('\nLIVE SMOKE TEST FAILED:', e.message, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
