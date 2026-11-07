/**
 * Generates dist/sw.js after the bundle is written. The worker precaches every small build
 * file (the app shell, all JS chunks and workers) so the app opens offline after one visit,
 * and caches the large runtimes (ONNX Runtime and ffmpeg .wasm) the first time they are used.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/** Files above this size are cached on first use instead of at install time. */
const LAZY_THRESHOLD = 12 * 1024 * 1024;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'gooners-ai-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const hash = createHash('sha256');
      const shell: string[] = ['./'];
      const lazy: string[] = [];
      for (const file of walk(outDir).sort()) {
        const rel = relative(outDir, file).split(sep).join('/');
        if (rel === 'sw.js' || rel.endsWith('.map')) continue;
        const size = statSync(file).size;
        hash.update(rel).update(readFileSync(file));
        (size > LAZY_THRESHOLD ? lazy : shell).push(rel);
      }
      const version = hash.digest('hex').slice(0, 16);
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      const sw = template
        .replace('__VERSION__', version)
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__LAZY__', JSON.stringify(lazy));
      writeFileSync(join(outDir, 'sw.js'), sw);
      config.logger.info(`sw.js: ${shell.length} precached files, ${lazy.length} cached on first use (version ${version})`);
    },
  };
}
