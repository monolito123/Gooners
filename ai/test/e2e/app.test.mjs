// End-to-end tests of the production build in headless Chromium.
// Run: npm run build && npm run test:e2e   (GOONERS_E2E_MODELS=1 also downloads a CPU model and chats)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { serve } from './server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DIST = join(import.meta.dirname, '../../dist');
let server;
let base;
let browser;

const SETTINGS = { state: { language: 'en', gpuWarningDismissed: true }, version: 1 };

async function openApp(hash = 'chat', init) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await context.addInitScript(
    ([settings, extra]) => {
      // Init scripts also run inside the sandboxed preview iframe, which has no storage.
      if (window.top !== window) return;
      if (!localStorage.getItem('gooners-ai:settings')) localStorage.setItem('gooners-ai:settings', JSON.stringify(settings));
      for (const [k, v] of Object.entries(extra ?? {})) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
    },
    [SETTINGS, init],
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}#${hash}`, { waitUntil: 'load' });
  return { context, page, errors };
}

before(async () => {
  ({ server, url: base } = await serve(DIST));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

describe('Gooners AI (production build)', () => {
  test('renders every mode without errors', async () => {
    const { context, page, errors } = await openApp('chat');
    await page.getByRole('heading', { name: /Private AI/ }).waitFor();
    for (const name of ['Image Studio', 'Video Generator', 'App Builder', 'Chat']) {
      await page.getByRole('navigation').getByRole('button', { name: new RegExp(name) }).click();
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.getByRole('dialog').getByText('Temperature').waitFor();
    await page.getByRole('radio', { name: 'Storage' }).click();
    await page.getByText('Storage used by this site').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('generates a procedural image and saves it to the gallery', async () => {
    const { context, page, errors } = await openApp('image');
    await page.getByRole('radio', { name: 'Abstract art' }).click();
    await page.getByPlaceholder(/synthwave/).fill('neon synthwave sunset over a calm ocean');
    await page.getByRole('button', { name: /^Generate$/ }).click();
    const img = page.locator('figure img').first();
    await img.waitFor({ timeout: 30_000 });
    const size = await img.evaluate((el) => (el.complete ? el.naturalWidth : 0));
    assert.ok(size >= 512, `image width ${size}`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('renders a shader video and encodes GIF and MP4 with ffmpeg.wasm', async () => {
    const { context, page, errors } = await openApp('video');
    await page.getByRole('radio', { name: 'Abstract' }).click();
    await page.getByPlaceholder(/aurora/).fill('aurora over a frozen lake, slow');
    await page.getByRole('radio', { name: '12' }).click();
    const duration = page.getByLabel('Duration');
    await duration.focus();
    await duration.press('Home');
    await page.getByRole('button', { name: /Render 12 frames/ }).click();
    const gif = page.getByRole('button', { name: 'GIF', exact: true });
    await gif.waitFor({ timeout: 60_000 });
    await gif.click();
    await page.getByRole('button', { name: /Download GIF/ }).waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'MP4', exact: true }).click();
    await page.getByRole('button', { name: /Download MP4/ }).waitFor({ timeout: 120_000 });
    const duration2 = await page.locator('video[src^="blob:"]').first().evaluate(
      (v) => new Promise((resolve) => (v.readyState >= 1 ? resolve(v.duration) : v.addEventListener('loadedmetadata', () => resolve(v.duration)))),
    );
    assert.ok(duration2 > 0.5 && duration2 < 2, `mp4 duration ${duration2}`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('animating an image keeps it upright', async () => {
    const { context, page, errors } = await openApp('image');
    await page.getByRole('radio', { name: 'Abstract art' }).click();
    await page.getByLabel('Scene type').selectOption('synthwave');
    await page.getByPlaceholder(/synthwave/).fill('synthwave sunset');
    await page.getByRole('button', { name: /^Generate$/ }).click();
    const img = page.locator('figure img').first();
    await img.waitFor({ timeout: 30_000 });
    // Brightness of the top half minus the bottom half (synthwave: bright sky over a dark floor).
    const balance = (el) => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(el, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let top = 0;
      let bottom = 0;
      for (let i = 0; i < d.length; i += 4) (i / 4 < 32 * 64 ? (top += d[i] + d[i + 1] + d[i + 2]) : (bottom += d[i] + d[i + 1] + d[i + 2]));
      return top - bottom;
    };
    const original = await img.evaluate(balance);
    await page.locator('figure').first().getByRole('button', { name: 'Animate in Video Generator' }).click();
    await page.getByRole('radio', { name: '12' }).click();
    const duration = page.getByLabel('Duration');
    await duration.focus();
    await duration.press('Home');
    await page.getByTestId('video-render').click();
    await page.getByRole('button', { name: 'MP4', exact: true }).waitFor({ timeout: 60_000 });
    const animated = await page.locator('canvas').first().evaluate(balance);
    assert.ok(original > 0, `original top brighter (${original})`);
    assert.ok(animated > 0, `animated frame still has the bright half on top (${animated})`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('runs an app in the offline sandbox with console bridge and storage shim', async () => {
    const code = `<!DOCTYPE html><html><head><title>Counter</title></head><body class="bg-slate-900 text-white">
<h1 id="t" class="text-3xl font-bold p-4">Counter 0</h1><button id="b" class="px-4 py-2">+1</button>
<script>
let n = Number(localStorage.getItem('n') || 0);
const t = document.getElementById('t');
t.textContent = 'Counter ' + n;
document.getElementById('b').onclick = () => { n++; localStorage.setItem('n', n); t.textContent = 'Counter ' + n; };
console.log('hello from sandbox');
fetch('https://example.com/').catch(() => console.warn('fetch failed'));
try { parent.document.title = 'pwned'; } catch (e) { console.log('parent blocked'); }
</script></body></html>`;
    const project = { id: 'p_test', title: 'Counter', createdAt: 1, updatedAt: 1, versions: [{ id: 'v1', prompt: 'counter', code, createdAt: 1 }], code, storage: { n: '41' }, assetIds: [] };
    const { context, page, errors } = await openApp('builder', {
      'gooners-ai:projects': JSON.stringify({ state: { projects: [project], activeId: 'p_test' }, version: 1 }),
    });
    const frame = page.frameLocator('iframe[title="Counter"]');
    await frame.getByText('Counter 41').waitFor({ timeout: 20_000 });
    await frame.getByRole('button', { name: '+1' }).click();
    await frame.getByText('Counter 42').waitFor();
    const weight = await frame.locator('#t').evaluate((el) => getComputedStyle(el).fontWeight);
    assert.equal(weight, '700', 'Tailwind classes are applied offline');
    await page.getByRole('button', { name: 'Console' }).click();
    const log = page.getByRole('log');
    await log.getByText('hello from sandbox').waitFor();
    await log.getByText('parent blocked').waitFor();
    await log.getByText(/Blocked by the offline sandbox|fetch failed/).first().waitFor();
    assert.notEqual(await page.title(), 'pwned');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gooners-ai:projects')).state.projects[0].storage.n);
    assert.equal(stored, '42', 'app storage persisted through the bridge');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('opens and works offline after the first visit', async () => {
    const { context, page } = await openApp('chat');
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30_000 });
    await page.locator('footer').getByText('offline-ready').waitFor({ timeout: 30_000 });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('heading', { name: /Private AI/ }).waitFor();
    await page.locator('footer [data-connectivity="offline"]').waitFor();
    await page.getByRole('navigation').getByRole('button', { name: /Image Studio/ }).click();
    await page.getByRole('radio', { name: 'Abstract art' }).click();
    await page.getByPlaceholder(/synthwave/).fill('crystal cave, glowing');
    await page.getByRole('button', { name: /^Generate$/ }).click();
    await page.locator('figure img').first().waitFor({ timeout: 30_000 });
    await context.close();
  });

  test('App Builder submit works with no project and no model (starts the model download)', async () => {
    const { context, page, errors } = await openApp('builder');
    await page.getByPlaceholder('Describe the app to build…').fill('A counter with a big plus button');
    const submit = page.getByTestId('builder-submit');
    assert.equal(await submit.isEnabled(), true, 'submit is enabled before any model is loaded');
    await submit.click();
    await page.locator('[data-model-status="loading"]').waitFor({ timeout: 20_000 });
    await page.getByText('Loading the coding model').waitFor();
    const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('gooners-ai:projects')).state.projects);
    assert.equal(projects.length, 1, 'a project was created');
    assert.match(projects[0].title, /counter/i);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.locator('[data-model-status="idle"]').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('defaults to a real diffusion model that runs without WebGPU', async () => {
    const { context, page, errors } = await openApp('image');
    await page.getByLabel('Image model').waitFor();
    assert.equal(await page.getByLabel('Image model').inputValue(), 'sdxs-fp32');
    await page.getByText('CPU · WASM').first().waitFor();
    await page.getByPlaceholder(/street market/).fill('a red apple on a wooden table');
    await page.getByTestId('image-generate').getByText(/Download model \(1\.\d GB\) & generate/).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('generates real images and an AI video with SDXS on the CPU', { skip: !process.env.GOONERS_E2E_MODELS, timeout: 1_800_000 }, async () => {
    const { context, page, errors } = await openApp('image');
    await page.getByPlaceholder(/street market/).fill('a red sports car on a coastal road at sunset, photo');
    await page.getByTestId('image-generate').click();
    await page.locator('figure img').first().waitFor({ timeout: 1_500_000 });
    const caption = await page.locator('figure').first().innerText();
    assert.match(caption, /SDXS/);
    assert.match(caption, /512×512/);
    // Reuse the downloaded model for a 1-second "camera" video (one diffusion pass).
    await page.getByRole('navigation').getByRole('button', { name: /Video Generator/ }).click();
    await page.getByPlaceholder(/lighthouse/).fill('a lighthouse on a cliff at sunset, waves crashing');
    await page.getByRole('radio', { name: 'Camera' }).click();
    await page.getByRole('radio', { name: '12' }).click();
    const duration = page.getByLabel('Duration');
    await duration.focus();
    await duration.press('Home');
    await page.getByTestId('video-render').click();
    await page.getByRole('button', { name: 'MP4', exact: true }).waitFor({ timeout: 600_000 });
    await page.getByRole('button', { name: 'MP4', exact: true }).click();
    await page.getByRole('button', { name: /Download MP4/ }).waitFor({ timeout: 120_000 });
    await page.screenshot({ path: process.env.GOONERS_E2E_SHOTS ? `${process.env.GOONERS_E2E_SHOTS}/ai-video.png` : '/dev/null' }).catch(() => undefined);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('builds an app with a real coding model on the CPU', { skip: !process.env.GOONERS_E2E_MODELS, timeout: 1_800_000 }, async () => {
    const { context, page, errors } = await openApp('builder');
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('gooners-ai:settings'));
      Object.assign(s.state, { appMaxTokens: 600 });
      localStorage.setItem('gooners-ai:settings', JSON.stringify(s));
    });
    await page.reload();
    await page.getByPlaceholder('Describe the app to build…').fill('A page with one big red button labeled "Hello". Keep it very short.');
    await page.getByTestId('builder-submit').click();
    await page.locator('[data-model-status="ready"], [data-model-status="generating"]').first().waitFor({ timeout: 900_000 });
    await page.getByRole('button', { name: /^v1$/ }).waitFor({ timeout: 900_000 });
    // Small models vary; require a working document that shows the requested label.
    const frame = page.frameLocator('iframe').first();
    await frame.getByText(/hello/i).first().waitFor({ timeout: 90_000 });
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('chats with a CPU model downloaded into IndexedDB', { skip: !process.env.GOONERS_E2E_MODELS }, async () => {
    const { context, page } = await openApp('chat');
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('gooners-ai:settings'));
      Object.assign(s.state, { chatModelId: 'wasm:HuggingFaceTB/SmolLM2-135M-Instruct', temperature: 0, maxTokens: 32 });
      localStorage.setItem('gooners-ai:settings', JSON.stringify(s));
    });
    await page.reload();
    await page.getByRole('button', { name: /Download & load/ }).click();
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 600_000 });
    await page.getByRole('textbox').first().fill('What is the capital of France? Answer in one short sentence.');
    await page.keyboard.press('Enter');
    await page.locator('.md').first().waitFor({ timeout: 300_000 });
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 300_000 });
    const answer = await page.locator('.md').last().innerText();
    assert.match(answer, /Paris/);

    // Offline: reload, the model auto-loads from IndexedDB and still answers.
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30_000 });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.locator('footer [data-connectivity="offline"]').waitFor();
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 300_000 });
    await page.getByRole('button', { name: /New chat/ }).click();
    await page.getByRole('textbox').first().fill('What is the capital of Italy? Answer in one short sentence.');
    await page.keyboard.press('Enter');
    await page.locator('.md').first().waitFor({ timeout: 300_000 });
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 300_000 });
    assert.match(await page.locator('.md').last().innerText(), /Rome/);
    await context.close();
  });
});
