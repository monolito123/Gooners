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
    // The player decodes its frames asynchronously: wait until one has been drawn.
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      if (!c) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) return true;
      return false;
    }, null, { timeout: 10_000 });
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

  test('chats with the free cloud model (Pollinations, no key) and shows its reasoning', async () => {
    const { context, page, errors } = await openApp('chat');
    const requests = [];
    await context.route('https://text.pollinations.ai/**', async (route) => {
      const req = route.request();
      requests.push({ url: req.url(), headers: req.headers(), body: req.postDataJSON?.() });
      const sse = [
        { choices: [{ delta: { reasoning: 'The user greets me.' } }] },
        { choices: [{ delta: { content: 'Hello from the **cloud**!' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6 } },
      ];
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n' });
    });
    await page.getByRole('button', { name: 'Use a free cloud model' }).click();
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 10_000 });
    await page.locator('footer').getByText('cloud', { exact: true }).waitFor();
    await page.getByRole('textbox').first().fill('hi');
    await page.keyboard.press('Enter');
    await page.locator('.md').last().getByText('Hello from the cloud!').waitFor();
    await page.locator('.md details.think').getByText('The user greets me.').waitFor({ state: 'attached' });
    const chat = requests.find((r) => r.url.endsWith('/openai'));
    assert.ok(chat, 'chat request sent');
    assert.equal(chat.body.model, 'openai');
    assert.equal(chat.body.stream, true);
    assert.equal(chat.headers.authorization, undefined, 'no key is sent to a no-key provider');
    assert.equal(chat.body.messages.at(-1).content, 'hi');
    assert.equal(chat.body.max_tokens, 1024 + 4096, 'room for reasoning on top of the answer budget');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('App Builder continues an app that was cut off by the output limit', async () => {
    const { context, page, errors } = await openApp('builder');
    const bodies = [];
    const parts = [
      '```html\n<!DOCTYPE html>\n<html><head><title>Counter</title></head><body>\n<h1 id="n">0</h1>\n<button id="plus">Plus</button>\n<script>\n  let n = 0;\n  document.getElementById(',
      '```html\n  let n = 0;\n  document.getElementById(\'plus\').onclick = () => { document.getElementById(\'n\').textContent = ++n; };\n</script>\n<button id="reset">Reset</button>\n</body></html>\n```',
    ];
    await context.route('https://text.pollinations.ai/openai', async (route) => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      const i = bodies.length - 1;
      const events = [{ choices: [{ delta: { content: parts[i] } }] }, { choices: [{ delta: {}, finish_reason: i === 0 ? 'length' : 'stop' }] }];
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n' });
    });
    await page.getByRole('button', { name: 'Use a free cloud model' }).click();
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 10_000 });
    await page.getByPlaceholder('Describe the app to build…').fill('A counter');
    await page.getByTestId('builder-submit').click();
    const frame = page.frameLocator('iframe').first();
    await frame.getByRole('button', { name: 'Reset' }).waitFor({ timeout: 20_000 });
    await frame.getByRole('button', { name: 'Plus' }).click();
    await frame.getByRole('button', { name: 'Plus' }).click();
    await frame.locator('#n').getByText('2').waitFor();
    assert.equal(bodies.length, 2, 'one continuation request');
    assert.equal(bodies[0].reasoning_effort, 'low');
    const turns = bodies[1].messages;
    assert.deepEqual(turns.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(turns[2].content, parts[0]);
    assert.match(turns[3].content, /cut off/);
    const code = await page.evaluate(() => JSON.parse(localStorage.getItem('gooners-ai:projects')).state.projects[0].versions.at(-1).code);
    assert.equal(code.match(/let n = 0/g).length, 1, 'the repeated line was dropped');
    assert.equal(await page.getByText(/hit the token limit/).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('uses an OpenRouter key only with OpenRouter and lists free models', async () => {
    const { context, page, errors } = await openApp('chat');
    const seen = [];
    await context.route('https://openrouter.ai/api/v1/**', async (route) => {
      const req = route.request();
      seen.push({ url: req.url(), auth: req.headers().authorization, body: req.method() === 'POST' ? req.postDataJSON() : null });
      if (req.url().endsWith('/models')) {
        await route.fulfill({
          json: {
            data: [
              { id: 'paid/model', name: 'Paid model', context_length: 32000, pricing: { prompt: '0.001', completion: '0.002' } },
              { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', context_length: 65536, pricing: { prompt: '0', completion: '0' } },
            ],
          },
        });
      } else if (req.postDataJSON().max_tokens > 4096) {
        // This model caps its output: the app must retry with the plain budget.
        await route.fulfill({ status: 400, json: { error: { message: 'max_tokens must be at most 4096', code: 400 } } });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'Answer from OpenRouter' } }] })}\n\ndata: [DONE]\n\n` });
      }
    });
    await page.getByRole('button', { name: 'More cloud models' }).click();
    await page.getByRole('radio', { name: 'Cloud' }).waitFor();
    await page.getByRole('button', { name: /^OpenRouter/ }).click();
    await page.getByText('Add a key (or connect) to use these models.').waitFor();
    await page.getByPlaceholder('sk-or-v1-…').fill('sk-or-v1-test');
    const row = page.getByText('Llama 3.3 70B (free)');
    await row.waitFor();
    assert.equal(await page.getByText('Paid model').count(), 0, 'free-only filter is on by default');
    await page.getByRole('button', { name: 'Use', exact: true }).first().click();
    await page.locator('[data-model-status="ready"]').waitFor({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('textbox').first().fill('ping');
    await page.keyboard.press('Enter');
    await page.locator('.md').last().getByText('Answer from OpenRouter').waitFor();
    const attempts = seen.filter((r) => r.url.endsWith('/chat/completions'));
    assert.deepEqual(attempts.map((r) => r.body.max_tokens), [1024 + 4096, 1024], 'retried with the plain budget after a 400');
    const chat = attempts.at(-1);
    assert.equal(chat.auth, 'Bearer sk-or-v1-test');
    assert.equal(chat.body.model, 'meta-llama/llama-3.3-70b-instruct:free');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gooners-ai:settings')).state);
    assert.equal(stored.cloudKeys.openrouter, 'sk-or-v1-test');
    assert.equal(stored.chatModelId, 'cloud:openrouter:meta-llama/llama-3.3-70b-instruct:free');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('connects OpenRouter with one click (OAuth PKCE) and stores the key', async () => {
    const { context, page, errors } = await openApp('chat');
    let exchange;
    await context.route('https://openrouter.ai/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname === '/auth') {
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/);
        const back = new URL(url.searchParams.get('callback_url'));
        back.searchParams.set('code', 'test-code');
        await route.fulfill({ status: 302, headers: { location: back.toString() } });
      } else if (url.pathname === '/api/v1/auth/keys') {
        exchange = req.postDataJSON();
        await route.fulfill({ json: { key: 'sk-or-v1-from-oauth' } });
      } else if (url.pathname === '/api/v1/models') {
        await route.fulfill({ json: { data: [{ id: 'openrouter/free', name: 'Free models router', context_length: 200000, pricing: { prompt: '0', completion: '0' } }] } });
      } else await route.fulfill({ status: 404, body: '' });
    });
    await page.getByRole('button', { name: 'More cloud models' }).click();
    await page.getByRole('button', { name: /^OpenRouter/ }).click();
    await page.getByRole('button', { name: 'Connect with OpenRouter' }).click();
    await page.getByText('OpenRouter connected: free models are ready to use').waitFor();
    assert.equal(exchange.code, 'test-code');
    assert.equal(exchange.code_challenge_method, 'S256');
    assert.match(exchange.code_verifier, /^[\w-]{43}$/);
    assert.equal(new URL(page.url()).search, '', 'the code is removed from the address bar');
    await page.getByRole('radio', { name: 'Cloud' }).waitFor();
    await page.getByText('Free models router').waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gooners-ai:settings')).state);
    assert.equal(stored.cloudKeys.openrouter, 'sk-or-v1-from-oauth');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('adds a model from Hugging Face by repository name', async () => {
    const { context, page, errors } = await openApp('chat');
    await context.route('https://huggingface.co/api/models/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/acme/Tiny-Chat-abliterated-ONNX')) {
        await route.fulfill({
          json: {
            id: 'acme/Tiny-Chat-abliterated-ONNX',
            sha: '0123456789abcdef',
            library_name: 'transformers.js',
            siblings: [
              { rfilename: 'config.json', size: 700 },
              { rfilename: 'onnx/model.onnx', size: 900_000_000 },
              { rfilename: 'onnx/model_quantized.onnx', size: 250_000_000 },
              { rfilename: 'onnx/model_q4.onnx', size: 300_000_000 },
            ],
          },
        });
      } else if (url.includes('/acme/Tiny-Chat-GGUF')) {
        await route.fulfill({ json: { id: 'acme/Tiny-Chat-GGUF', sha: 'x', siblings: [{ rfilename: 'tiny.Q4_K_M.gguf', size: 1 }] } });
      } else await route.fulfill({ status: 404, json: { error: 'Repository not found' } });
    });
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.getByRole('radio', { name: 'Models' }).click();
    const input = page.getByLabel('Add a model from Hugging Face');
    await input.fill('https://huggingface.co/acme/Tiny-Chat-GGUF');
    await page.getByRole('button', { name: 'Find' }).click();
    await page.getByText(/GGUF files \(for llama\.cpp\)/).waitFor();
    await input.fill('acme/Tiny-Chat-abliterated-ONNX');
    await page.getByRole('button', { name: 'Find' }).click();
    await page.getByText('ONNX model: runs on the CPU with Transformers.js (q8).').waitFor();
    await page.getByRole('button', { name: 'Add model', exact: true }).click();
    await page.getByText('Models you added').waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gooners-ai:settings')).state.customModels);
    assert.equal(stored.length, 1);
    assert.deepEqual(
      { id: stored[0].id, backend: stored[0].backend, repo: stored[0].repo, dtype: stored[0].dtype, revision: stored[0].revision, uncensored: stored[0].tags.includes('uncensored') },
      { id: 'wasm:acme/Tiny-Chat-abliterated-ONNX', backend: 'wasm', repo: 'acme/Tiny-Chat-abliterated-ONNX', dtype: 'q8', revision: '0123456789abcdef', uncensored: true },
    );
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('backs up models to a folder and restores them', async () => {
    const { context, page, errors } = await openApp('image');
    // Stand in for the folder picker with the origin-private file system (same handle API).
    await context.addInitScript(() => {
      window.showDirectoryPicker = () => navigator.storage.getDirectory();
    });
    await page.reload();
    // One gallery image (blob store) and one WebLLM-format record.
    await page.getByRole('radio', { name: 'Abstract art' }).click();
    await page.getByPlaceholder(/synthwave/).fill('teal geometric waves');
    await page.getByRole('button', { name: /^Generate$/ }).click();
    await page.locator('figure img').first().waitFor({ timeout: 30_000 });
    const bytes = [1, 2, 3, 250, 251, 252];
    const shard = 'https://huggingface.co/mlc-ai/Test-MLC/resolve/main/params_shard_0.bin';
    const webllm = (action, data) =>
      page.evaluate(
        ([action, url, data]) =>
          new Promise((resolve, reject) => {
            const req = indexedDB.open('webllm/model', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('urls', { keyPath: 'url' });
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const tx = req.result.transaction('urls', 'readwrite');
              const store = tx.objectStore('urls');
              const r = action === 'put' ? store.put({ url, data: new Uint8Array(data).buffer }) : action === 'delete' ? store.delete(url) : store.get(url);
              tx.oncomplete = () => {
                req.result.close();
                resolve(action === 'get' && r.result ? [...new Uint8Array(r.result.data)] : null);
              };
            };
          }),
        [action, shard, data],
      );
    await webllm('put', bytes);

    await page.getByRole('button', { name: /Storage/ }).first().click();
    const block = page.getByTestId('permanent-storage');
    await block.getByText('Permanent storage').waitFor();
    await block.getByText('Include images and videos').click();
    await block.getByRole('button', { name: 'Back up to a folder' }).click();
    await page.getByText('Backup complete (2 files)').waitFor();
    const manifest = await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('gooners-ai-models');
      return JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text());
    });
    assert.equal(manifest.app, 'gooners-ai');
    assert.deepEqual(manifest.entries.map((e) => e.kind).sort(), ['blob', 'webllm']);

    await webllm('delete');
    assert.equal(await webllm('get'), null);
    await block.getByRole('button', { name: 'Restore from a folder' }).click();
    await page.getByText('Restored 2 files; the models are ready to load').waitFor();
    assert.deepEqual(await webllm('get'), bytes);
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
