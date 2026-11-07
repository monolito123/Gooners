/** Optional: let the loaded text model translate a prompt into shader parameters. */
import { textEngine } from '../TextEngine.ts';
import { SCENE_JSON_INSTRUCTIONS, type SceneSpec, sanitizeSpec } from './artEngine.ts';

export function canUseLLM(): boolean {
  return textEngine.getState().status === 'ready';
}

export async function interpretWithLLM(prompt: string, fallback: SceneSpec): Promise<SceneSpec> {
  if (!canUseLLM()) return fallback;
  try {
    const { text } = await textEngine.generate(
      [
        { role: 'system', content: SCENE_JSON_INSTRUCTIONS },
        { role: 'user', content: prompt },
      ],
      { params: { temperature: 0.2, topP: 0.9, maxTokens: 220 }, onDelta: () => undefined },
    );
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? sanitizeSpec(JSON.parse(json), fallback) : fallback;
  } catch {
    return fallback;
  }
}
