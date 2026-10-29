// Renders every ```mermaid block in the docs with the real Mermaid library in headless Chromium.
// A block that fails to parse or render fails the check.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(p);
    } catch {}
  }
  return null;
}

const docsDir = join(here, '..', 'docs');
const blocks = [];
for (const f of readdirSync(docsDir).filter((x) => x.endsWith('.md')).sort()) {
  const text = readFileSync(join(docsDir, f), 'utf8');
  for (const m of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) blocks.push({ file: f, src: m[1], line: text.slice(0, m.index).split('\n').length + 1 });
}

const pw = loadPlaywright();
if (!pw) {
  console.log(`mermaid: SKIP (Playwright not installed), ${blocks.length} diagrams not rendered`);
  process.exit(0);
}

const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }));

let failed = 0;
for (const [i, b] of blocks.entries()) {
  const err = await page.evaluate(async ([src, id]) => {
    try {
      await window.mermaid.parse(src);
      const { svg } = await window.mermaid.render(id, src);
      return svg.includes('<svg') ? null : 'no svg produced';
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  }, [b.src, `d${i}`]);
  if (err) {
    failed++;
    console.log(`  FAIL ${b.file}:${b.line} ${err.split('\n').slice(0, 3).join(' ')}`);
  }
}
await browser.close();
console.log(failed ? `mermaid: ${failed} of ${blocks.length} diagrams failed` : `mermaid: ${blocks.length} diagrams render`);
process.exit(failed ? 1 : 0);
