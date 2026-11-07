import { describe, expect, it } from 'vitest';
import { ensureDocument, extractCode, stitchContinuation } from '../../src/appBuilder/extractCode.ts';
import { detectAppIntent } from '../../src/appBuilder/intent.ts';
import { buildEditPrompt, editFits } from '../../src/appBuilder/prompts.ts';
import { buildSandboxDocument } from '../../src/appBuilder/sandboxDoc.ts';

const DOC = '<!DOCTYPE html>\n<html><head><title>X</title></head><body><button>Hi</button></body></html>';

describe('extractCode', () => {
  it('finds a complete html block', () => {
    const r = extractCode(`Sure!\n\n\`\`\`html\n${DOC}\n\`\`\`\n\nEnjoy.`);
    expect(r).toEqual({ code: DOC, complete: true, found: true });
  });

  it('returns the partial code of an unterminated block while streaming', () => {
    const r = extractCode('Here you go:\n```html\n<!DOCTYPE html>\n<html><body><canvas id="c"></canvas>');
    expect(r.found).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.code).toContain('<canvas id="c">');
  });

  it('merges separate CSS and JS blocks into the HTML', () => {
    const answer = '```html\n<html><head></head><body><div id="a"></div></body></html>\n```\n```css\nbody{color:red}\n```\n```javascript\nconsole.log(1)\n```';
    const { code } = extractCode(answer);
    expect(code).toContain('<style>\nbody{color:red}\n</style>\n</head>');
    expect(code).toContain('<script>\nconsole.log(1)\n</script>\n</body>');
  });

  it('accepts a bare document without fences', () => {
    const r = extractCode(`Here:\n${DOC}\nThanks`);
    expect(r.code).toBe(DOC);
    expect(r.complete).toBe(true);
  });

  it('ignores answers without HTML', () => {
    expect(extractCode('```python\nprint(1)\n```').found).toBe(false);
    expect(extractCode('Just text').found).toBe(false);
  });

  it('wraps fragments into a document', () => {
    expect(ensureDocument('<p>hi</p>')).toMatch(/^<!DOCTYPE html>[\s\S]*<body>\n<p>hi<\/p>\n<\/body>/);
    expect(ensureDocument(DOC)).toBe(DOC);
  });
});

describe('detectAppIntent', () => {
  it.each([
    'Build a calculator',
    'Create a Pong game',
    'can you make me a simple todo app?',
    'Crie um jogo da velha',
    'faça uma calculadora de IMC',
    'quero um site de portfólio com tema escuro',
    'Write an HTML page with a clock',
  ])('detects "%s"', (text) => expect(detectAppIntent(text)).toBe(true));

  it.each(['What is the capital of France?', 'Explique o que é WebGPU', 'Write a poem about the sea', 'make it shorter'])('ignores "%s"', (text) =>
    expect(detectAppIntent(text)).toBe(false),
  );
});

describe('edit prompts', () => {
  it('embeds the current code and checks the context budget', () => {
    expect(buildEditPrompt('add a reset button', DOC)).toContain(DOC);
    expect(editFits(DOC, 4096, 2500)).toBe(true);
    expect(editFits('x'.repeat(9000), 4096, 2500)).toBe(false);
  });
});

describe('sandbox document', () => {
  it('injects an offline CSP, the bridge and Tailwind; strips the Tailwind CDN', () => {
    const html = buildSandboxDocument('<html><head><script src="https://cdn.tailwindcss.com"></script></head><body></body></html>', {
      channel: 'c1',
      tailwind: '/*tw*/',
    });
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('__goonersSandbox');
    expect(html).toContain('/*tw*/');
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('__goonersSandbox'));
  });

  it('allows the network on request and resolves asset:// references', () => {
    const html = buildSandboxDocument('<img src="asset://logo-1">', { channel: 'c', allowNetwork: true, assets: { 'logo-1': 'data:image/png;base64,AA' } });
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).toContain('src="data:image/png;base64,AA"');
  });

  it('cannot be broken out of by a closing script tag in injected code', () => {
    const html = buildSandboxDocument('<p></p>', { channel: 'x', tailwind: 'a="</script><b>"' });
    expect(html).toContain('a="<\\/script><b>"');
  });
});

describe('extractCode with split files from small models', () => {
  const answer = [
    'Here is the app:',
    '```html',
    '<!DOCTYPE html><html><head><title>Red</title><link rel="stylesheet" href="styles.css"></head>',
    '<body><button class="red">Hello</button><script src="script.js"></script></body></html>',
    '```',
    '```css',
    '.red { background: red; }',
    '```',
    '```javascript',
    "document.querySelector('.red').onclick = () => alert('hi');",
    '```',
  ].join('\n');

  it('inlines styles.css and script.js and drops the dead references', () => {
    const { code } = extractCode(answer);
    expect(code).not.toMatch(/href="styles\.css"|src="script\.js"/);
    expect(code).toContain('<style>\n.red { background: red; }\n</style>\n</head>');
    expect(code).toContain("<script>\ndocument.querySelector('.red').onclick = () => alert('hi');\n</script>\n</body>");
  });

  it('gives the same result on repeated calls (no regex state leaks)', () => {
    expect(extractCode(answer).code).toBe(extractCode(answer).code);
  });

  it('keeps CDN scripts and inline scripts as they are', () => {
    const doc = '```html\n<html><head><script src="https://cdn.example.com/x.js"></script></head><body><script>run()</script></body></html>\n```\n```js\nextra()\n```';
    const { code } = extractCode(doc);
    expect(code).toContain('src="https://cdn.example.com/x.js"');
    expect(code).not.toContain('extra()');
  });
});

describe('stitchContinuation', () => {
  const first = '```html\n<!DOCTYPE html>\n<html><body>\n<button id="b">+</button>\n<script>\n  const people = 1;\n  function calc';

  it('appends the continuation and drops a reopened fence', () => {
    const joined = stitchContinuation(first, '```html\nulate() { return people; }\n</script>\n</body></html>\n```');
    expect(joined).toBe(`${first}ulate() { return people; }\n</script>\n</body></html>\n\`\`\``);
    const code = extractCode(joined);
    expect(code.complete).toBe(true);
    expect(code.code).toContain('function calculate() { return people; }');
  });

  it('removes text the model repeated from the end of the previous part', () => {
    const joined = stitchContinuation(first, '  const people = 1;\n  function calculate() {}\n</script></body></html>\n```');
    expect(joined.match(/const people/g)).toHaveLength(1);
    expect(joined).toContain('function calculate() {}');
  });

  it('keeps a restarted document instead of gluing two documents', () => {
    const joined = stitchContinuation(first, '<!DOCTYPE html>\n<html><body>new</body></html>\n```');
    expect(extractCode(joined)).toMatchObject({ complete: true, code: '<!DOCTYPE html>\n<html><body>new</body></html>' });
  });
});
