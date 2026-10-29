// Compiles ../proto/sma.proto into static protobuf code (no eval, CSP-safe; works in Node,
// browsers and the Android WebView): src/schema.static.js + src/schema.static.d.ts.
// Run after editing the .proto:   npm run gen:schema            (or: node scripts/gen-schema.mjs <outDir>)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const outDir = process.argv[2] ?? here('../src');
const bin = (name) => here(`../node_modules/.bin/${name}`);
const proto = here('../../proto/sma.proto');
const pbjs = (out, extra) =>
  execFileSync(bin('pbjs'), ['-t', 'static-module', '-w', 'es6', '--no-service', '--no-delimited', '--no-beautify', ...extra, '-o', out, proto], { stdio: 'inherit' });

// pbts reads the JSDoc of a commented build; the shipped JS has no comments.
const tmp = mkdtempSync(join(tmpdir(), 'sma-pb-'));
try {
  pbjs(join(tmp, 'schema.js'), []);
  execFileSync(bin('pbts'), ['--no-comments', '-o', join(outDir, 'schema.static.d.ts'), join(tmp, 'schema.js')], { stdio: 'inherit' });
  pbjs(join(outDir, 'schema.static.js'), ['--no-comments']);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`wrote ${outDir}/schema.static.js and schema.static.d.ts`);
