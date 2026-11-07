# Gooners AI

Estúdio de IA multimodal que roda **100% no navegador**: chat com LLM, geração de imagens, vídeos e apps com prévia ao vivo. Não há backend, chave de API nem inferência na nuvem. Os modelos são baixados uma única vez do Hugging Face, ficam no IndexedDB e funcionam **offline** depois disso.

Publicado em `/ai/` junto com o restante do site (https://monolito123.github.io/Gooners/ai/).

## Modos

| Modo | Motor | O que faz |
|---|---|---|
| **Chat** | WebLLM (MLC, 4 bits) no WebGPU; Transformers.js + ONNX Runtime WASM na CPU como alternativa | Streaming token a token, Markdown com realce de sintaxe, raciocínio `<think>` recolhível, histórico no `localStorage`, métricas (tok/s, TTFT, tokens). Detecta pedidos de app ("crie uma calculadora") e oferece abrir no App Builder. |
| **Estúdio de Imagem** | Modelos de difusão no ONNX Runtime Web: SDXS (fp16 no WebGPU, ou fp32 em qualquer GPU e até na CPU via WebAssembly) e SD-Turbo; motor procedural (shaders WebGL2) como "Arte abstrata" | Texto → imagem de qualquer prompt, em qualquer navegador. O primeiro "Gerar" baixa e carrega o modelo sozinho. Semente fixa ou aleatória, várias imagens por vez, img2img a partir da galeria (SD-Turbo). |
| **Gerador de Vídeo** | Quadros-chave pintados pelo modelo de difusão e interpolados; efeitos sobre imagens; shaders; codificação com ffmpeg.wasm | **Vídeo com IA** a partir do prompt: *Fluxo* (a cena evolui por um passeio no espaço latente enquanto a câmera avança), *Loop* contínuo, *Câmera* (pan/zoom/paralaxe sobre uma imagem gerada) e *Zoom onírico* (img2img realimentado, com SD-Turbo). Também anima imagens da galeria e gera cenas abstratas. Exporta MP4 (H.264), WebM (VP8) ou GIF; sem ffmpeg, grava WebM pelo MediaRecorder. |
| **App Builder** | O mesmo LLM, com prompt de sistema para gerar um único HTML | Editor CodeMirror + prévia em iframe isolado, atualizada enquanto o código é gerado. Edições iterativas ("adicione um botão de reiniciar"), versões, console do app, tela cheia, download do `.html` e imagens da galeria via `asset://nome`. |

Barra de telemetria: GPU (fornecedor/arquitetura, shader-f16), online/offline e cache offline, modelo e estado, tok/s, TTFT, VRAM estimada, memória JS e armazenamento usado.

## Modelos

Texto (WebGPU, pesos q4f16; em GPUs sem `shader-f16` o app usa automaticamente a variante q4f32):

| Modelo | Download | VRAM | Uso |
|---|---|---|---|
| Llama 3.2 1B Instruct (padrão do chat) | 672 MB | 0,9 GB | Melhor qualidade geral |
| Qwen2.5 Coder 1.5B (padrão do App Builder) | 840 MB | 1,6 GB | Código |
| Qwen2.5 Coder 0.5B | 276 MB | 0,9 GB | Código leve |
| Qwen3 0.6B | 335 MB | 1,4 GB | Raciocínio |
| Gemma 3 1B | 574 MB | 0,7 GB | Bom português (exige shader-f16) |
| Qwen2.5 0.5B Instruct | 276 MB | 0,9 GB | Rápido |
| SmolLM2 360M Instruct | 198 MB | 0,4 GB | Menor de todos (inglês) |
| SmolLM2 360M / 135M, Qwen2.5 0.5B (CPU) | 173–749 MB | – | Sem WebGPU (WASM) |

Também dá para adicionar qualquer modelo compilado com MLC (por exemplo um fine-tune da comunidade) em **Configurações → Modelos → Modelo WebLLM personalizado**, informando a URL dos pesos e a biblioteca `.wasm`.

Modelos sem censura (*abliterated*: a recusa foi removida dos pesos), marcados como "sem censura" na lista:

| Modelo | Onde roda | Download |
|---|---|---|
| Llama 3.2 1B Instruct Abliterated (`Sandoche/…-q4f16_1-MLC`) | WebGPU com shader-f16 | 672 MB |
| Qwen3 0.6B Abliterated (`Jay0628/…-MLC-q4f16_1`) | WebGPU com shader-f16 | 335 MB |
| Qwen2.5 0.5B Instruct Abliterated v3 (`onnx-community/…-ONNX`, q8) | Qualquer aparelho (CPU) | 472 MB |

Os dois primeiros são conversões MLC da comunidade com os mesmos tensores dos modelos oficiais; o app as roda com as bibliotecas WebGPU oficiais do WebLLM (sem os hashes de integridade oficiais, que valem para outros pesos). Conversões MLC antigas publicam `ndarray-cache.json` em vez de `tensor-cache.json`; o worker do WebLLM tenta o nome antigo quando o novo dá 404. Os repositórios de terceiros ficam fixados num commit.

Imagem (download retomável por HTTP Range, em blocos de 16 MB no IndexedDB, repositórios fixados num commit):

| Modelo | Download | Onde roda | Notas |
|---|---|---|---|
| SDXS DreamShaper (fp16) | 0,9 GB | WebGPU com shader-f16 | Padrão nessas GPUs: 1 passo, ~1 s por imagem |
| SDXS DreamShaper (fp32) | 1,9 GB | Qualquer WebGPU **ou a CPU** (WebAssembly) | Padrão sem shader-f16 ou sem WebGPU: 10–30 s por imagem na CPU |
| SD-Turbo | 2,6 GB | WebGPU com shader-f16, ~3 GB de memória | Mais fiel ao prompt, 1–4 passos, img2img |

O SDXS é um modelo de um passo: gera muito bem do zero, mas não faz img2img (desnoising parcial), por isso o "Zoom onírico" e "partir de uma imagem" ficam com o SD-Turbo. O SD-Turbo fp16 não cabe na memória do WebAssembly (o ONNX Runtime converte os pesos para fp32 na CPU), por isso só roda no WebGPU.

## Arquitetura

```
src/
  engines/
    TextEngine.ts        fachada do texto: WebLLM (worker) ou Transformers.js (worker), progresso, métricas
    webllm.worker.ts     WebWorkerMLCEngineHandler (WebGPU)
    wasmText.worker.ts   Transformers.js na CPU, cache próprio no IndexedDB
    ImageEngine.ts       fachada da difusão: escolha do modelo e do dispositivo, download → carga → geração
    image.worker.ts      pipeline de difusão no ONNX Runtime Web (WebGPU ou WASM), tipos lidos do próprio modelo
    sd/                  tokenizador CLIP (BPE), agendador Euler "trailing", conversões de tensor
    procedural/          interpretação do prompt, shaders GLSL e renderizador WebGL2
    VideoSynthesizer.ts  vídeo com IA (quadros-chave + interpolação), efeitos sobre imagem, shaders
    encoder.ts           ffmpeg.wasm (MP4/WebM/GIF) com MediaRecorder como alternativa
    models.ts            catálogo de modelos
  appBuilder/            extração de código do streaming, detecção de intenção, prompts, documento do sandbox
  components/            Sidebar, ChatArea, MessageBubble, ImageStudio, VideoStudio, AppBuilder, AppSandbox,
                         ModelLoadingModal, SettingsModal, StoragePanel, TelemetryBar, WebGPUWarning…
  state/                 zustand: configurações, conversas e projetos (localStorage), galeria (IndexedDB)
  lib/                   blobStore (IndexedDB em blocos, downloads retomáveis), RPC tipado de workers,
                         Markdown seguro (marked + highlight.js + DOMPurify), detecção de WebGPU, i18n
build/                   gerador do service worker (sw.js) com a lista de arquivos do build
```

Toda a inferência roda em Web Workers, então a interface não trava durante downloads e gerações.

### Armazenamento e offline

- **Pesos dos modelos**: IndexedDB. O WebLLM usa `cacheBackend: 'indexeddb'`; os modelos de imagem e os de CPU usam o `blobStore` próprio. O IndexedDB foi escolhido em vez do Cache Storage porque os outros service workers do site (raiz e `/messenger/`) limpavam caches alheios. Eles foram corrigidos para apagar só os próprios, mas o IndexedDB continua sendo o lugar certo para gigabytes de pesos.
- **App**: o `sw.js` gerado no build guarda todo o JavaScript, CSS e os workers na primeira visita. Os dois runtimes grandes (ONNX Runtime, 27 MB, e ffmpeg, 32 MB) são guardados no primeiro uso ou pelo botão **Armazenamento → Guardar tudo agora**.
- Depois de carregar um modelo uma vez, chat e App Builder funcionam sem internet. As imagens e vídeos procedurais nunca precisam de rede.
- **Configurações → Armazenamento** mostra o espaço usado e a cota, lista cada modelo, a galeria, as conversas e o cache offline (com exclusão individual), pede armazenamento persistente e apaga tudo.

### Segurança do App Builder

O código gerado roda num `iframe` com `sandbox="allow-scripts …"` **sem** `allow-same-origin`: origem opaca, sem acesso ao IndexedDB, às conversas ou ao DOM do app. Uma CSP injetada bloqueia qualquer requisição de rede (há um botão para liberar). O Tailwind é injetado a partir do pacote `@tailwindcss/browser`, sem CDN. Uma ponte por `postMessage` repassa o console e um `localStorage` em memória, salvo por projeto. A saída do chat passa pelo DOMPurify, e HTML cru do modelo aparece como texto.

## Requisitos

- WebGPU: Chrome/Edge 113+ (Windows, macOS, ChromeOS), Chrome 121+ no Android, Safari 26+, Firefox 141+ no Windows. Sem WebGPU, o app avisa e oferece o modo CPU (modelos pequenos via WASM) e os motores procedurais.
- Memória: de 0,4 a 1,6 GB de VRAM para os modelos de texto; 1,2 GB para o SDXS fp16 e cerca de 3 GB para o SD-Turbo. O SDXS fp32 na CPU usa cerca de 2 GB de RAM.

## Desenvolvimento

```bash
cd ai
npm ci
npm run dev          # servidor de desenvolvimento (sem service worker)
npm run typecheck
npm test             # testes unitários (vitest): tokenizador CLIP com o vocabulário real, agendador,
                     # extração de código, intenção, contexto, catálogo, motor procedural, sandbox
npm run build        # dist/ estático (base relativa: funciona em qualquer subcaminho)
npm run test:e2e     # Playwright sobre o build: todos os modos, imagem procedural, vídeo + ffmpeg (GIF/MP4),
                     # sandbox (console, storage, rede bloqueada) e recarga offline pelo service worker
GOONERS_E2E_MODELS=1 npm run test:e2e   # também baixa modelos reais: SDXS fp32 (imagem e vídeo com IA na CPU),
                                        # Qwen2.5 Coder 0.5B (App Builder) e SmolLM2 135M (chat online e offline)
npm run check:sd -- sdxs-fp32   # roda o pipeline de difusão (tokenizador, agendador, fp16/fp32, img2img) na CPU
                                # com onnxruntime-node e grava txt2img.png e img2img.png em sd-check/
                                # (modelos: sdxs, sdxs-fp32, sd-turbo; baixa na primeira vez)
```

O workflow `.github/workflows/ai.yml` roda tipos, testes unitários, build e testes ponta a ponta. O `pages.yml` gera o app (com cache pelo hash das fontes) e o publica em `/ai/`.

## Limitações conhecidas

- Modelos de 0,5 a 1,5 B parâmetros erram fatos e geram apps simples; o Qwen2.5 Coder 1.5B é o mais confiável no App Builder.
- A janela de contexto é de 4k tokens: em conversas longas as mensagens mais antigas saem do contexto, e apps muito grandes são regenerados em vez de editados.
- As imagens são de 512×512. O SD-Turbo exige `shader-f16` e cerca de 3 GB de VRAM; o SDXS fp32 roda em qualquer aparelho, mas leva de 10 a 30 s por imagem na CPU.
- Licenças dos modelos de imagem: SDXS sob OpenRAIL++-M (com restrições de uso), SD-Turbo sob a licença não comercial da Stability AI. Os modelos sem censura não têm filtros: o uso é responsabilidade de quem usa.
- O ONNX Runtime usa uma thread na CPU porque o GitHub Pages não envia os cabeçalhos COOP/COEP necessários para `SharedArrayBuffer`. Isso só afeta o modo CPU.
