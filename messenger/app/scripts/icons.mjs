// Renders public/icon.svg to the PNG icons the PWA manifest and Android launcher need.
// Dev-time only (uses the Playwright Chromium available in the dev environment):
//   node scripts/icons.mjs [androidResDir]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const svg = readFileSync(here('../public/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

/** full: rounded-square icon; maskable: full-bleed background with the glyph in the 80% safe zone. */
async function render(size, mode) {
  const inner = mode === 'full' ? svg : svg.replace('rx="112"', 'rx="0"');
  const scale = mode === 'foreground' ? 0.62 : mode === 'maskable' ? 0.8 : 1;
  const bg = mode === 'foreground' ? 'transparent' : mode === 'maskable' ? '#0f172a' : 'transparent';
  const glyph = mode === 'foreground' ? inner.replace(/<rect[^>]*\/>/, '') : inner;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">
    <div style="width:${size * scale}px;height:${size * scale}px">${glyph.replace('<svg ', `<svg width="${size * scale}" height="${size * scale}" `)}</div></div></body></html>`);
  return page.screenshot({ omitBackground: bg === 'transparent', type: 'png' });
}

writeFileSync(here('../public/icon-192.png'), await render(192, 'full'));
writeFileSync(here('../public/icon-512.png'), await render(512, 'full'));
writeFileSync(here('../public/icon-maskable-512.png'), await render(512, 'maskable'));

const res = process.argv[2];
if (res) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = `${res}/mipmap-${d}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/ic_launcher.png`, await render(Math.round(48 * k), 'full'));
    writeFileSync(`${dir}/ic_launcher_round.png`, await render(Math.round(48 * k), 'full'));
    writeFileSync(`${dir}/ic_launcher_foreground.png`, await render(Math.round(108 * k), 'foreground'));
  }
}
if (res) {
  // Launch splash screens: same sizes as Capacitor's defaults, icon centred on the brand colour.
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = `${res}/${dir}/splash.png`;
    if (!existsSync(file)) continue;
    const png = readFileSync(file);
    const w = png.readUInt32BE(16);
    const hgt = png.readUInt32BE(20);
    const side = Math.round(Math.min(w, hgt) * 0.32);
    await page.setViewportSize({ width: w, height: hgt });
    await page.setContent(`<html><body style="margin:0;background:#0f172a;display:grid;place-items:center;height:${hgt}px">${svg.replace('<svg ', `<svg width="${side}" height="${side}" `)}</body></html>`);
    writeFileSync(file, await page.screenshot({ type: 'png' }));
  }
}
await browser.close();
console.log('icons written');
