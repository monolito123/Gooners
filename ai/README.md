# Gooners AI

Estúdio de IA multimodal que roda **100% no navegador**: chat com LLM, geração de imagens, vídeos e apps com prévia ao vivo. Não há backend, chave de API nem inferência na nuvem. Os modelos são baixados uma única vez do Hugging Face, ficam no IndexedDB e funcionam **offline** depois disso.

Publicado em `/ai/` junto com o restante do site (https://monolito123.github.io/Gooners/ai/).

## Modos

| Modo | Motor | O que faz |
|---|---|---|
| **Chat** | WebLLM (MLC, 4 bits) no WebGPU; Transformers.js + ONNX Runtime WASM na CPU como alternativa | Streaming token a token, Markdown com realce de sintaxe, raciocínio `<think>` recolhível, histórico no `localStorage`, métricas (tok/s, TTFT, tokens). Detecta pedidos de app ("crie uma calculadora") e oferece abrir no App Builder. |
| **Estúdio de Imagem** | SD-Turbo (ONNX fp16, ONNX Runtime Web/WebGPU) ou motor procedural (shaders WebGL2) | Texto → imagem em 1–4 passos, img2img a partir da galeria, semente fixa ou aleatória. O motor procedural não baixa nada: interpreta o prompt (português e inglês) em cena, paleta, detalhe e brilho, e pode usar o LLM carregado para escolher os parâmetros. |
| **Gerador de Vídeo** | Shaders WebGL2, efeitos sobre imagens, SD-Turbo quadro a quadro; codificação com ffmpeg.wasm | Cenas animadas a partir do prompt; animação de imagens (Ken Burns, ondas, paralaxe, glitch, caleidoscópio, VHS); difusão em loop contínuo, transição entre dois prompts ou zoom infinito (img2img realimentado). Exporta MP4 (H.264), WebM (VP8) ou GIF com paleta otimizada. |
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

Imagem: **SD-Turbo** (`schmuell/sd-turbo-ort-web`): codificador de texto, UNet e VAE em fp16, 2,6 GB de download e cerca de 3 GB de memória de GPU. É o menor modelo de difusão de qualidade que roda no navegador hoje. Não existe versão de 4 bits dele para a web, por isso o motor procedural é a opção instantânea e sem download. O download é retomável (HTTP Range) e é feito em blocos de 16 MB no IndexedDB.

## Arquitetura

```
src/
  engines/
    TextEngine.ts        fachada do texto: WebLLM (worker) ou Transformers.js (worker), progresso, métricas
    webllm.worker.ts     WebWorkerMLCEngineHandler (WebGPU)
    wasmText.worker.ts   Transformers.js na CPU, cache próprio no IndexedDB
    ImageEngine.ts       fachada do SD-Turbo: download → carga → geração (quadros em streaming)
    image.worker.ts      pipeline de difusão no ONNX Runtime Web (WebGPU)
    sd/                  tokenizador CLIP (BPE), agendador Euler "trailing", conversões de tensor
    procedural/          interpretação do prompt, shaders GLSL e renderizador WebGL2
    VideoSynthesizer.ts  geração de quadros (shader, efeito sobre imagem, difusão)
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

- **Pesos dos modelos**: IndexedDB. O WebLLM usa `cacheBackend: 'indexeddb'`; o SD-Turbo e os modelos de CPU usam o `blobStore` próprio. O IndexedDB foi escolhido em vez do Cache Storage porque os outros service workers do site (raiz e `/messenger/`) limpavam caches alheios. Eles foram corrigidos para apagar só os próprios, mas o IndexedDB continua sendo o lugar certo para gigabytes de pesos.
- **App**: o `sw.js` gerado no build guarda todo o JavaScript, CSS e os workers na primeira visita. Os dois runtimes grandes (ONNX Runtime, 27 MB, e ffmpeg, 32 MB) são guardados no primeiro uso ou pelo botão **Armazenamento → Guardar tudo agora**.
- Depois de carregar um modelo uma vez, chat e App Builder funcionam sem internet. As imagens e vídeos procedurais nunca precisam de rede.
- **Configurações → Armazenamento** mostra o espaço usado e a cota, lista cada modelo, a galeria, as conversas e o cache offline (com exclusão individual), pede armazenamento persistente e apaga tudo.

### Segurança do App Builder

O código gerado roda num `iframe` com `sandbox="allow-scripts …"` **sem** `allow-same-origin`: origem opaca, sem acesso ao IndexedDB, às conversas ou ao DOM do app. Uma CSP injetada bloqueia qualquer requisição de rede (há um botão para liberar). O Tailwind é injetado a partir do pacote `@tailwindcss/browser`, sem CDN. Uma ponte por `postMessage` repassa o console e um `localStorage` em memória, salvo por projeto. A saída do chat passa pelo DOMPurify, e HTML cru do modelo aparece como texto.

## Requisitos

- WebGPU: Chrome/Edge 113+ (Windows, macOS, ChromeOS), Chrome 121+ no Android, Safari 26+, Firefox 141+ no Windows. Sem WebGPU, o app avisa e oferece o modo CPU (modelos pequenos via WASM) e os motores procedurais.
- Memória: de 0,4 a 1,6 GB de VRAM para os modelos de texto; cerca de 3 GB para o SD-Turbo.

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
GOONERS_E2E_MODELS=1 npm run test:e2e   # também baixa o SmolLM2 135M (CPU) e conversa com ele
npm run check:sd     # roda o pipeline do SD-Turbo (tokenizador, agendador, fp16) na CPU com onnxruntime-node
                     # e grava txt2img.png e img2img.png em sd-check/ (baixa 2,6 GB na primeira vez)
```

O workflow `.github/workflows/ai.yml` roda tipos, testes unitários, build e testes ponta a ponta. O `pages.yml` gera o app (com cache pelo hash das fontes) e o publica em `/ai/`.

## Limitações conhecidas

- Modelos de 0,5 a 1,5 B parâmetros erram fatos e geram apps simples; o Qwen2.5 Coder 1.5B é o mais confiável no App Builder.
- A janela de contexto é de 4k tokens: em conversas longas as mensagens mais antigas saem do contexto, e apps muito grandes são regenerados em vez de editados.
- O SD-Turbo gera em 512×512 e exige `shader-f16` e cerca de 3 GB de VRAM.
- O ONNX Runtime usa uma thread na CPU porque o GitHub Pages não envia os cabeçalhos COOP/COEP necessários para `SharedArrayBuffer`. Isso só afeta o modo CPU.
