/** Splits `<think>…</think>` reasoning (Qwen3 / cloud reasoning models) from the visible answer. */
export function splitReasoning(content: string): { reasoning: string | null; answer: string; thinking: boolean } {
  const match = content.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (!match) return { reasoning: null, answer: content, thinking: false };
  return { reasoning: match[1].trim(), answer: content.slice(match[0].length), thinking: match[2] !== '</think>' };
}
