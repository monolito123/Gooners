/** Prompts that make small local code models produce one self-contained HTML file. */
import { estimateTokens } from '../engines/context.ts';

export const APP_SYSTEM_PROMPT = `You are an expert front-end engineer inside an offline app builder.
Write ONE complete, self-contained HTML file for the user's request:
- Put CSS in a <style> tag and JavaScript in a <script> tag inside the same file.
- Tailwind CSS classes are available (Tailwind is preloaded; do not add a CDN link).
- No external files, CDNs, images from the internet, fonts or network requests: everything must work offline.
- Use plain JavaScript (no frameworks, no imports, no build step). Make it responsive with a polished dark design.
- Make every feature actually work. Use <canvas> and requestAnimationFrame for games.
Answer with a single \`\`\`html code block containing the full file, then at most one short sentence.`;

export interface AppAsset {
  name: string;
  description: string;
}

function assetNote(assets: AppAsset[]): string {
  if (!assets.length) return '';
  const list = assets.map((a) => `- asset://${a.name} (${a.description})`).join('\n');
  return `\n\nYou may use these local images by their exact URL, e.g. <img src="asset://${assets[0].name}">:\n${list}`;
}

export function buildCreatePrompt(request: string, assets: AppAsset[] = []): string {
  return `${request.trim()}${assetNote(assets)}`;
}

export function buildEditPrompt(request: string, currentCode: string, assets: AppAsset[] = []): string {
  return `Here is the current app:\n\n\`\`\`html\n${currentCode.trim()}\n\`\`\`\n\nChange it as follows: ${request.trim()}${assetNote(assets)}\n\nReturn the complete updated file in one \`\`\`html code block.`;
}

/** Whether an edit prompt (code + answer) fits the context window. */
export function editFits(currentCode: string, contextWindow: number, maxTokens: number): boolean {
  return estimateTokens(APP_SYSTEM_PROMPT) + estimateTokens(currentCode) + 200 + maxTokens <= contextWindow;
}

/** Asks the model to finish an answer that was cut off by the output limit. */
export function buildContinuePrompt(previous: string): string {
  return `Your answer was cut off by the output limit. Continue the code exactly where it stopped, right after these last characters:\n<<<\n${previous.slice(-240)}\n>>>\nOutput only the remaining code, without repeating anything and without explanations, and close the code block with \`\`\`.`;
}
