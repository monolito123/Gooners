import { describe, expect, it } from 'vitest';
import { cloudImageUrl, cloudModelId, cloudModelInfo, findProvider, parseModelList, parseSse } from '../../src/engines/cloud.ts';
import { type HfRepoInfo, type OfficialRecord, candidateRecords, mlcModelInfo, onnxModelInfo, parseRepoId, sameArchitecture } from '../../src/engines/hfImport.ts';
import { isUsable } from '../../src/engines/models.ts';

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('parseSse', () => {
  it('parses data lines split across chunks and stops at [DONE]', async () => {
    const events = await collect(
      parseSse(stream([': OPENROUTER PROCESSING\n\n', 'data: {"choices":[{"delta":{"content":"He', 'llo"}}]}\r\n\n', 'data: {"x":1}\n\ndata: [DONE]\n\n', 'data: {"after":true}\n'])),
    );
    expect(events).toEqual([{ choices: [{ delta: { content: 'Hello' } }] }, { x: 1 }]);
  });

  it('skips lines that are not JSON', async () => {
    expect(await collect(parseSse(stream(['data: nope\n', 'event: ping\n', 'data: {"ok":1}\n'])))).toEqual([{ ok: 1 }]);
  });
});

describe('parseModelList', () => {
  it('marks OpenRouter free models and lists them first', () => {
    const list = parseModelList('openrouter', {
      data: [
        { id: 'openai/gpt-x', name: 'GPT X', context_length: 128000, pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'meta/llama:free', name: 'Llama free', context_length: 8192, pricing: { prompt: '0', completion: '0' } },
        { id: 'openrouter/free', name: 'Free router', context_length: 200000, pricing: { prompt: '0', completion: '0' } },
        { id: 'img/only', name: 'Image', architecture: { output_modalities: ['image'] } },
      ],
    });
    expect(list.map((m) => [m.id, m.free])).toEqual([
      ['openrouter/free', true],
      ['meta/llama:free', true],
      ['openai/gpt-x', false],
    ]);
    expect(list[0].contextWindow).toBe(200000);
  });

  it('reads the Pollinations array format', () => {
    const list = parseModelList('pollinations', [
      { name: 'openai', description: 'GPT-OSS', output_modalities: ['text'] },
      { name: 'tts', output_modalities: ['audio'] },
    ]);
    expect(list).toEqual([{ id: 'openai', label: 'openai · GPT-OSS', contextWindow: 32768, free: true }]);
  });

  it('never marks models of other providers as free and tolerates bad bodies', () => {
    expect(parseModelList('groq', { data: [{ id: 'llama-3.1-8b-instant', context_window: 131072 }] })).toEqual([
      { id: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant', contextWindow: 131072, free: false },
    ]);
    expect(parseModelList('custom', null)).toEqual([]);
    expect(parseModelList('custom', { data: 'x' })).toEqual([]);
  });
});

describe('cloud catalog entries', () => {
  it('builds a usable cloud model without downloads', () => {
    const info = cloudModelInfo('openrouter', { id: 'openrouter/free', label: 'Free router', contextWindow: 1_000_000, free: true });
    expect(info.id).toBe(cloudModelId('openrouter', 'openrouter/free'));
    expect(info.backend).toBe('cloud');
    expect(info.downloadMB).toBe(0);
    expect(info.contextWindow).toBeLessThanOrEqual(131072);
    expect(info.cloud).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    expect(isUsable(info, { supported: false, hasF16: false } as never)).toBe(true);
  });

  it('only OpenRouter, Hugging Face and Groq need a key', () => {
    expect(findProvider('pollinations').needsKey).toBe(false);
    expect(findProvider('custom').needsKey).toBe(false);
    expect(findProvider('openrouter').needsKey).toBe(true);
  });

  it('encodes the prompt in the image URL', () => {
    const url = new URL(cloudImageUrl('a cat / on "mars"?', { width: 768, height: 512, seed: 7, model: 'flux' }));
    expect(url.hostname).toBe('image.pollinations.ai');
    expect(decodeURIComponent(url.pathname)).toBe('/prompt/a cat / on "mars"?');
    expect(url.searchParams.get('width')).toBe('768');
    expect(url.searchParams.get('seed')).toBe('7');
    expect(url.searchParams.get('model')).toBe('flux');
  });
});

describe('Hugging Face import', () => {
  it('parses repo ids and links', () => {
    expect(parseRepoId('Sandoche/Llama-3.2-1B-Instruct-abliterated-q4f16_1-MLC')).toBe('Sandoche/Llama-3.2-1B-Instruct-abliterated-q4f16_1-MLC');
    expect(parseRepoId(' https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/main/onnx ')).toBe('onnx-community/Qwen3-0.6B-ONNX');
    expect(parseRepoId('https://huggingface.co/models/a/b/')).toBe('a/b');
    expect(parseRepoId('not a repo')).toBeNull();
    expect(parseRepoId('a/b/c')).toBeNull();
  });

  const qwen = { model_type: 'qwen3', quantization: 'q4f16_1', model_config: { hidden_size: 1024, num_hidden_layers: 28, num_attention_heads: 16, num_key_value_heads: 8, intermediate_size: 3072, vocab_size: 151936, head_dim: 128 } };

  it('matches architectures by shape', () => {
    expect(sameArchitecture(qwen, structuredClone(qwen))).toBe(true);
    expect(sameArchitecture(qwen, { ...qwen, model_config: { ...qwen.model_config, num_hidden_layers: 36 } })).toBe(false);
    expect(sameArchitecture(qwen, { ...qwen, model_type: 'llama' })).toBe(false);
    expect(sameArchitecture({ model_type: 'qwen3', model_config: { hidden_size: 1 } }, { model_type: 'qwen3', model_config: { hidden_size: 1 } })).toBe(false);
  });

  const records: OfficialRecord[] = [
    { model: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC', model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', model_lib: 'llama.wasm', vram_required_MB: 879 },
    { model: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC', model_id: 'Qwen3-0.6B-q4f16_1-MLC', model_lib: 'qwen3.wasm', vram_required_MB: 1403.3, overrides: { context_window_size: 4096 } },
    { model: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f32_1-MLC', model_id: 'Qwen3-0.6B-q4f32_1-MLC', model_lib: 'qwen3-32.wasm' },
    { model: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC', model_id: 'Qwen3-0.6B-q4f16_1-MLC-1k', model_lib: 'qwen3-1k.wasm' },
  ];

  it('tries official libraries with the same quantization, likeliest first', () => {
    const ids = candidateRecords(records, qwen, 'Jay0628/Qwen3-0.6B-abliterated-q4f16_1-MLC').map((r) => r.model_id);
    expect(ids).toEqual(['Qwen3-0.6B-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC']);
  });

  it('builds an MLC entry pinned to the commit', () => {
    const info: HfRepoInfo = {
      id: 'Jay0628/Qwen3-0.6B-abliterated-q4f16_1-MLC',
      sha: 'abc123',
      siblings: [
        { rfilename: 'params_shard_0.bin', size: 200 * 2 ** 20 },
        { rfilename: 'params_shard_1.bin', size: 135 * 2 ** 20 },
        { rfilename: 'tensor-cache.json', size: 2 ** 20 },
        { rfilename: 'README.md', size: 50 * 2 ** 20 },
      ],
    };
    const model = mlcModelInfo(info, qwen, records[1]);
    expect(model).toMatchObject({
      id: 'hf--Jay0628--Qwen3-0.6B-abliterated-q4f16_1-MLC',
      backend: 'webgpu',
      label: 'Qwen3-0.6B-abliterated',
      downloadMB: 336,
      vramMB: 1403,
      contextWindow: 4096,
      requiresF16: true,
      mlc: { modelUrl: 'https://huggingface.co/Jay0628/Qwen3-0.6B-abliterated-q4f16_1-MLC/resolve/abc123/', libFrom: 'Qwen3-0.6B-q4f16_1-MLC' },
    });
    expect(model.tags).toContain('uncensored');
  });

  it('picks the smallest CPU quantization of an ONNX repo, counting external data', () => {
    const info: HfRepoInfo = {
      id: 'onnx-community/Some-Model-ONNX',
      sha: 'def456',
      siblings: [
        { rfilename: 'onnx/model.onnx', size: 2000 },
        { rfilename: 'onnx/model_fp16.onnx', size: 1000 },
        { rfilename: 'onnx/model_q4.onnx', size: 100 },
        { rfilename: 'onnx/model_q4.onnx_data', size: 900 },
        { rfilename: 'onnx/model_quantized.onnx', size: 600 },
        { rfilename: 'tokenizer.json', size: 10 },
      ],
    };
    const model = onnxModelInfo(info)!;
    expect(model).toMatchObject({ id: 'wasm:onnx-community/Some-Model-ONNX', backend: 'wasm', dtype: 'q8', revision: 'def456', repo: 'onnx-community/Some-Model-ONNX' });
    expect(model.externalData).toBeUndefined();
    expect(model.tags).not.toContain('uncensored');

    const withData = onnxModelInfo({ ...info, siblings: info.siblings.filter((s) => s.rfilename !== 'onnx/model_quantized.onnx') })!;
    expect(withData).toMatchObject({ dtype: 'q4', externalData: 1 });
    expect(onnxModelInfo({ ...info, siblings: [{ rfilename: 'model.gguf', size: 1 }] })).toBeNull();
  });
});
