/**
 * Builds the `srcdoc` for the live preview iframe. The iframe is sandboxed without
 * allow-same-origin (opaque origin: no access to this app's storage, cookies or DOM), and a
 * CSP blocks every network request by default, so generated apps run fully offline.
 * Injected helpers: Tailwind (bundled, offline), a console/error bridge, an in-memory
 * localStorage shim (synced to the parent), and `asset://name` image references.
 */
import { ensureDocument } from './extractCode.ts';

export const BRIDGE_TAG = '__goonersSandbox';

export interface SandboxOptions {
  /** Unique id so the parent only accepts messages from the current preview. */
  channel: string;
  /** Source of @tailwindcss/browser, injected inline when present. */
  tailwind?: string;
  allowNetwork?: boolean;
  /** asset name → data: URL */
  assets?: Record<string, string>;
  /** Previous localStorage contents of this app, restored on reload. */
  storage?: Record<string, string>;
}

const OFFLINE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline' blob: data:; " +
  "img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; worker-src blob: data:; " +
  "frame-src 'none'; form-action 'none'; base-uri 'none'";

function bridge(channel: string, storage: Record<string, string>): string {
  return `(function(){
var CH=${JSON.stringify(channel)},TAG=${JSON.stringify(BRIDGE_TAG)};
function send(type,data){try{parent.postMessage({tag:TAG,channel:CH,type:type,data:data},'*')}catch(e){}}
function fmt(v){try{if(v instanceof Error)return v.stack||v.message;if(typeof v==='object'&&v!==null)return JSON.stringify(v).slice(0,2000);return String(v)}catch(e){return String(v)}}
['log','info','warn','error','debug'].forEach(function(level){var orig=console[level];console[level]=function(){send('console',{level:level,args:Array.prototype.slice.call(arguments).map(fmt)});if(orig)orig.apply(console,arguments)}});
addEventListener('error',function(e){send('console',{level:'error',args:[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')]})});
addEventListener('unhandledrejection',function(e){send('console',{level:'error',args:['Unhandled rejection: '+fmt(e.reason)]})});
document.addEventListener('securitypolicyviolation',function(e){send('console',{level:'warn',args:['Blocked by the offline sandbox: '+(e.blockedURI||e.violatedDirective)]})});
function store(initial,sync){var m=new Map(Object.entries(initial||{}));function push(){if(sync)send('storage',Object.fromEntries(m))}return{getItem:function(k){k=String(k);return m.has(k)?m.get(k):null},setItem:function(k,v){m.set(String(k),String(v));push()},removeItem:function(k){m.delete(String(k));push()},clear:function(){m.clear();push()},key:function(i){var k=Array.from(m.keys())[i];return k===undefined?null:k},get length(){return m.size}}}
try{window.localStorage.getItem('x')}catch(e){try{Object.defineProperty(window,'localStorage',{value:store(${JSON.stringify(storage)},true),configurable:true})}catch(_){}}
try{window.sessionStorage.getItem('x')}catch(e){try{Object.defineProperty(window,'sessionStorage',{value:store({},false),configurable:true})}catch(_){}}
addEventListener('load',function(){send('ready',{title:document.title})});
})();`;
}

/** Removes Tailwind CDN tags (we inject the bundled build instead). */
function stripTailwindCdn(html: string): string {
  return html
    .replace(/<script[^>]+src=["'][^"']*(cdn\.tailwindcss\.com|@tailwindcss\/browser|tailwindcss)[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link[^>]+href=["'][^"']*tailwind[^"']*["'][^>]*>/gi, '');
}

function replaceAssets(html: string, assets: Record<string, string>): string {
  return html.replace(/asset:\/\/([\w.-]+)/g, (whole, name: string) => assets[name] ?? whole);
}

const escapeScript = (source: string) => source.replace(/<\/script/gi, '<\\/script');

export function buildSandboxDocument(code: string, options: SandboxOptions): string {
  let html = ensureDocument(code.trim() || '<p style="font-family:sans-serif;color:#888">…</p>');
  html = replaceAssets(stripTailwindCdn(html), options.assets ?? {});
  const head = [
    '<meta charset="utf-8">',
    options.allowNetwork ? '' : `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`,
    `<script>${escapeScript(bridge(options.channel, options.storage ?? {}))}</script>`,
    options.tailwind ? `<script>${escapeScript(options.tailwind)}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}\n${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>\n${head}\n</head>`);
  return `<!DOCTYPE html><html><head>${head}</head><body>${html}</body></html>`;
}

export interface SandboxMessage {
  tag: typeof BRIDGE_TAG;
  channel: string;
  type: 'console' | 'storage' | 'ready';
  data: unknown;
}

export function isSandboxMessage(data: unknown, channel: string): data is SandboxMessage {
  return typeof data === 'object' && data !== null && (data as SandboxMessage).tag === BRIDGE_TAG && (data as SandboxMessage).channel === channel;
}
