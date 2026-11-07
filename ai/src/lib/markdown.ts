/** Markdown → sanitized HTML for model output, with syntax highlighting and code actions. */
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked, type Tokens } from 'marked';
import { splitReasoning } from './reasoning.ts';

export { splitReasoning };

const languages = { bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, markdown, php, python, ruby, rust, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(languages)) hljs.registerLanguage(name, lang);
hljs.registerAliases(['html', 'svg', 'htm'], { languageName: 'xml' });
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['rs'], { languageName: 'rust' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });
hljs.registerAliases(['kt'], { languageName: 'kotlin' });

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export interface MarkdownLabels {
  copy: string;
  preview: string;
  reasoning: string;
}

const PREVIEWABLE = new Set(['html', 'htm', 'xml', 'svg']);

function createMarked(labels: MarkdownLabels): Marked {
  return new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }: Tokens.Code): string {
        const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        let body: string;
        try {
          body = language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
        } catch {
          body = escapeHtml(text);
        }
        const looksLikePage = /<(!doctype|html|body|canvas|div|svg)\b/i.test(text);
        const runnable = PREVIEWABLE.has(language) && looksLikePage;
        return (
          `<div class="code-block"><div class="code-head"><span class="lang">${escapeHtml(language || 'text')}</span>` +
          (runnable ? `<button type="button" class="run" data-action="preview">▶ ${escapeHtml(labels.preview)}</button>` : '') +
          `<button type="button" data-action="copy">${escapeHtml(labels.copy)}</button></div>` +
          `<pre><code class="hljs">${body}</code></pre></div>`
        );
      },
      // Raw HTML in a chat answer is shown as text, never interpreted.
      html({ text }: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(text);
      },
    },
  });
}

let purifyConfigured = false;
function configurePurify(): void {
  if (purifyConfigured) return;
  purifyConfigured = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

const cache = new Map<string, Marked>();

export function renderMarkdown(content: string, labels: MarkdownLabels): string {
  configurePurify();
  const key = `${labels.copy}|${labels.preview}`;
  let marked = cache.get(key);
  if (!marked) {
    marked = createMarked(labels);
    cache.set(key, marked);
  }
  const { reasoning, answer, thinking } = splitReasoning(content);
  let html = '';
  if (reasoning !== null) {
    html += `<details class="think"${thinking ? ' open' : ''}><summary>${escapeHtml(labels.reasoning)}</summary>${marked.parse(reasoning, { async: false })}</details>`;
  }
  html += marked.parse(answer, { async: false });
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'iframe'], FORBID_ATTR: ['style'] });
}
