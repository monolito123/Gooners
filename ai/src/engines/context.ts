/** Keeps a conversation inside the model's context window. */
import type { ChatTurn } from './textTypes.ts';

/** Conservative token estimate (≈3 characters per token across English, Portuguese and code). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3) + 4;
}

/**
 * Returns the system prompt plus the most recent turns that fit in `contextWindow` while
 * leaving `reserve` tokens for the answer. If the newest message alone does not fit, its
 * beginning is cut.
 */
export function fitToContext(messages: ChatTurn[], contextWindow: number, reserve: number): ChatTurn[] {
  const budget = Math.max(256, contextWindow - reserve - 32);
  const system = messages[0]?.role === 'system' ? messages[0] : undefined;
  const rest = system ? messages.slice(1) : messages.slice();
  let used = system ? estimateTokens(system.content) : 0;
  const kept: ChatTurn[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const turn = rest[i];
    const cost = estimateTokens(turn.content);
    if (used + cost <= budget) {
      kept.unshift(turn);
      used += cost;
      continue;
    }
    if (kept.length === 0) {
      const chars = Math.max(200, (budget - used) * 3);
      kept.unshift({ ...turn, content: `…${turn.content.slice(-chars)}` });
    }
    break;
  }
  // Chat templates expect the first non-system turn to come from the user.
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return system ? [system, ...kept] : kept;
}
