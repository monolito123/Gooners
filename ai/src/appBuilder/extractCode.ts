/**
 * Pulls a runnable HTML document out of a model answer, including while it is still streaming
 * (unterminated code fence) and when the model splits HTML, CSS and JS into separate blocks.
 */

export interface ExtractedCode {
  code: string;
  /** The closing fence (or </html>) has been seen. */
  complete: boolean;
  found: boolean;
}

interface Block {
  lang: string;
  body: string;
  closed: boolean;
}

const FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n/g;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(text))) {
    const fence = match[2];
    const lang = match[3].toLowerCase();
    const start = match.index + match[0].length;
    const closeRe = new RegExp(`\\n[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(?=\\n|$)`, 'g');
    closeRe.lastIndex = start - 1;
    const close = closeRe.exec(text);
    if (close) {
      blocks.push({ lang, body: text.slice(start, close.index), closed: true });
      FENCE.lastIndex = close.index + close[0].length;
    } else {
      blocks.push({ lang, body: text.slice(start), closed: false });
      break;
    }
  }
  return blocks;
}

const HTML_LANGS = new Set(['html', 'htm', 'xhtml', 'xml', 'svg', '']);
const CSS_LANGS = new Set(['css', 'scss']);
const JS_LANGS = new Set(['js', 'javascript', 'jsx', 'mjs']);

function looksLikeHtml(body: string): boolean {
  return /<(!doctype|html|head|body|div|main|section|canvas|button|h1|style|script)\b/i.test(body);
}

/** Merges separate CSS/JS blocks into the HTML document. */
function merge(html: string, css: string[], js: string[]): string {
  let doc = html;
  if (css.length) {
    const style = `<style>\n${css.join('\n\n')}\n</style>`;
    doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${style}\n</head>`) : `${style}\n${doc}`;
  }
  if (js.length) {
    const script = `<script>\n${js.join('\n\n')}\n</script>`;
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}\n</body>`) : `${doc}\n${script}`;
  }
  return doc;
}

export function extractCode(text: string): ExtractedCode {
  const blocks = parseBlocks(text);
  const htmlBlocks = blocks.filter((b) => HTML_LANGS.has(b.lang) && looksLikeHtml(b.body));
  if (htmlBlocks.length) {
    // Prefer the longest complete document; while streaming, the last (open) block.
    const open = htmlBlocks.find((b) => !b.closed);
    const best = open ?? htmlBlocks.reduce((a, b) => (b.body.length > a.body.length ? b : a));
    const css = blocks.filter((b) => CSS_LANGS.has(b.lang) && b.closed).map((b) => b.body);
    const js = blocks.filter((b) => JS_LANGS.has(b.lang) && b.closed).map((b) => b.body);
    const hasInline = (tag: string) => new RegExp(`<${tag}[\\s>]`, 'i').test(best.body);
    const code = merge(best.body, hasInline('style') && css.length === 0 ? [] : css, js.length && !hasInline('script') ? js : []);
    return { code: code.trimEnd(), complete: best.closed, found: true };
  }
  // No fence: a bare document in the answer.
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start >= 0) {
    const end = text.search(/<\/html>/i);
    const complete = end >= 0;
    return { code: text.slice(start, complete ? end + 7 : undefined).trimEnd(), complete, found: true };
  }
  return { code: '', complete: false, found: false };
}

/** Wraps a fragment (no <html>) into a full document. */
export function ensureDocument(code: string, title = 'App'): string {
  if (/<html[\s>]/i.test(code)) return code;
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n</head>\n<body>\n${code}\n</body>\n</html>`;
}
