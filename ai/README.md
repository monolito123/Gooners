# Gooners AI

Estúdio de IA multimodal que roda **100% no navegador**: chat com LLM, geração de imagens, vídeos e apps com prévia ao vivo. Não há backend: os modelos são baixados uma única vez do Hugging Face, ficam no IndexedDB (com armazenamento permanente e backup numa pasta) e funcionam **offline** depois disso. Quem não tem GPU ou não quer baixar nada pode usar, se quiser, modelos na nuvem: grátis e sem conta (Pollinations) ou com a própria chave do OpenRouter, Hugging Face, Groq ou de um servidor local (Ollama, LM Studio).

Publicado em `/ai/` junto com o restante do site (https://monolito123.github.io/Gooners/ai/).

## Modos

| Modo | Motor | O que faz |
|---|---|---|
| **Chat** | WebLLM (MLC, 4 bits) no WebGPU; Transformers.js + ONNX Runtime WASM na CPU como alternativa; modelos na nuvem opcionais | Streaming token a token, Markdown com realce de sintaxe, raciocínio `<think>` recolhível, histórico no `localStorage`, métricas (tok/s, TTFT, tokens). Detecta pedidos de app ("crie uma calculadora") e oferece abrir no App Builder. |
| **Estúdio de Imagem** | Modelos de difusão no ONNX Runtime Web: SDXS (fp16 no WebGPU, ou fp32 em qualquer GPU e até na CPU via WebAssembly) e SD-Turbo; "Nuvem (grátis)" pelo Pollinations; motor procedural (shaders WebGL2) como "Arte abstrata" | Texto → imagem de qualquer prompt, em qualquer navegador. O primeiro "Gerar" baixa e carrega o modelo sozinho. Semente fixa ou aleatória, várias imagens por vez, img2img a partir da galeria (SD-Turbo). |
| **Gerador de Vídeo** | Quadros-chave pintados pelo modelo de difusão e interpolados; efeitos sobre imagens; shaders; codificação com ffmpeg.wasm | **Vídeo com IA** a partir do prompt: *Fluxo* (a cena evolui por um passeio no espaço latente enquanto a câmera avança), *Loop* contínuo, *Câmera* (pan/zoom/paralaxe sobre uma imagem gerada) e *Zoom onírico* (img2img realimentado, com SD-Turbo). Também anima imagens da galeria e gera cenas abstratas. Exporta MP4 (H.264), WebM (VP8) ou GIF; sem ffmpeg, grava WebM pelo MediaRecorder. |
| **App Builder** | O mesmo LLM, com prompt de sistema para gerar um único HTML | Editor CodeMirror + prévia em iframe isolado, atualizada enquanto o código é gerado. Edições iterativas ("adicione um botão de reiniciar"), versões, continuação automática quando a resposta é cortada pelo limite de saída, console do app, tela cheia, download do `.html` e imagens da galeria via `asset://nome`. |

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

**Adicionar modelos do Hugging Face** (Configurações → Modelos): cole o nome ou o link de um repositório (por exemplo `onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX`) e clique em **Buscar**. O app lê a lista de arquivos pela API do Hub e:

- **repositório MLC** (`mlc-chat-config.json`): compara a arquitetura (`model_type`, camadas, dimensões, vocabulário) com a dos modelos oficiais do WebLLM de mesma quantização e roda os novos pesos com a biblioteca WebGPU compatível. Serve para fine-tunes e versões *abliterated* de Llama, Qwen, Gemma, Phi, SmolLM etc.;
- **repositório ONNX** (Transformers.js): roda na CPU com o menor arquivo de 4 ou 8 bits disponível, contando os blocos de dados externos;
- **GGUF** (llama.cpp) ou arquitetura sem biblioteca compatível: explica por que não dá e sugere procurar uma versão `-MLC` ou `-ONNX`.

O repositório fica fixado no commit atual, e o modelo entra na lista com o selo "sem censura" quando o nome indica (abliterated, uncensored…). Os modelos adicionados aparecem na lista, podem ser apagados (pesos e entrada) e sobrevivem a recargas. Para casos especiais, **Avançado** ainda aceita a URL dos pesos e da biblioteca `.wasm` à mão.

### Modelos na nuvem (opcional)

Em **Configurações → Nuvem** (ou "Usar um modelo gratuito na nuvem" na tela do chat), sempre desligados até a pessoa escolher:

| Provedor | Chave | Observações |
|---|---|---|
| **Pollinations** | Não precisa | Grátis e sem conta: texto (GPT-OSS 20B, com raciocínio) e imagens. É o botão de um clique. |
| **OpenRouter** | Chave `sk-or-…` ou **Conectar com o OpenRouter** (OAuth PKCE, sem copiar e colar) | Centenas de modelos, dezenas gratuitos (`:free` e o roteador `openrouter/free`); o filtro "Só modelos gratuitos" vem ligado. |
| **Hugging Face** | Token `hf_…` | Inference Providers pelo roteador compatível com OpenAI. |
| **Groq** | Chave `gsk_…` | Muito rápido, com cota gratuita. |
| **Servidor compatível com OpenAI** | Opcional | Ollama, LM Studio, llama.cpp ou vLLM na própria máquina ou na rede (no Ollama, `OLLAMA_ORIGINS=*`). |

As chaves ficam só no `localStorage` deste navegador e só são enviadas ao provedor a que pertencem. Modelos que raciocinam contam o raciocínio no limite de saída, então o app reserva espaço extra para ele; no Pollinations, cujo plano gratuito corta a saída em cerca de 1.500 tokens, o app pede raciocínio curto (`reasoning_effort: low`). As respostas chegam por streaming (SSE), com raciocínio recolhível, tok/s e TTFT na barra de telemetria (com o selo NUVEM). Nos modelos na nuvem, as mensagens saem do aparelho e valem os termos do provedor; o app avisa isso antes.

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
    cloud.ts             provedores na nuvem (OpenAI-compatível, SSE, OAuth do OpenRouter, imagens do Pollinations)
    hfImport.ts          "Adicionar do Hugging Face": detecção MLC/ONNX/GGUF e escolha da biblioteca WebGPU
  appBuilder/            extração de código do streaming, detecção de intenção, prompts, documento do sandbox
  components/            Sidebar, ChatArea, MessageBubble, ImageStudio, VideoStudio, AppBuilder, AppSandbox,
                         ModelLoadingModal, SettingsModal, StoragePanel, TelemetryBar, WebGPUWarning…
  state/                 zustand: configurações, conversas e projetos (localStorage), galeria (IndexedDB)
  lib/                   blobStore (IndexedDB em blocos, downloads retomáveis), backup/restauração em pasta, RPC tipado de workers,
                         Markdown seguro (marked + highlight.js + DOMPurify), detecção de WebGPU, i18n
build/                   gerador do service worker (sw.js) com a lista de arquivos do build
```

Toda a inferência roda em Web Workers, então a interface não trava durante downloads e gerações.

### Armazenamento e offline

- **Pesos dos modelos**: IndexedDB. O WebLLM usa `cacheBackend: 'indexeddb'`; os modelos de imagem e os de CPU usam o `blobStore` próprio. O IndexedDB foi escolhido em vez do Cache Storage porque os outros service workers do site (raiz e `/messenger/`) limpavam caches alheios. Eles foram corrigidos para apagar só os próprios, mas o IndexedDB continua sendo o lugar certo para gigabytes de pesos.
- **App**: o `sw.js` gerado no build guarda todo o JavaScript, CSS e os workers na primeira visita. Os dois runtimes grandes (ONNX Runtime, 27 MB, e ffmpeg, 32 MB) são guardados no primeiro uso ou pelo botão **Armazenamento → Guardar tudo agora**.
- Depois de carregar um modelo uma vez, chat e App Builder funcionam sem internet. As imagens e vídeos procedurais nunca precisam de rede.
- **Armazenamento permanente**: ao baixar o primeiro modelo, o app pede `navigator.storage.persist()`, para que o navegador não apague os pesos quando faltar espaço. **Instalar o app** (PWA, pela barra lateral ou pelo painel) costuma conceder isso automaticamente. O painel mostra se o armazenamento já é permanente.
- **Backup numa pasta** (Chrome, Edge, Opera e Brave no computador, pela File System Access API): **Fazer backup numa pasta** copia todos os modelos baixados (WebLLM, CPU e imagem), e opcionalmente a galeria, para `gooners-ai-models/` na pasta escolhida, com um `manifest.json`. **Restaurar de uma pasta** os devolve ao IndexedDB, sem baixar de novo, depois de limpar os dados do site ou em outro perfil.
- **Configurações → Armazenamento** mostra o espaço usado e a cota, lista cada modelo, a galeria, as conversas e o cache offline (com exclusão individual) e apaga tudo.

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
                     # extração de código, intenção, contexto, catálogo, motor procedural, sandbox,
                     # SSE e listas de modelos da nuvem, importador do Hugging Face
npm run build        # dist/ estático (base relativa: funciona em qualquer subcaminho)
npm run test:e2e     # Playwright sobre o build: todos os modos, imagem procedural, vídeo + ffmpeg (GIF/MP4),
                     # sandbox (console, storage, rede bloqueada), recarga offline pelo service worker,
                     # chat na nuvem (Pollinations e OpenRouter, com respostas simuladas), importador do
                     # Hugging Face e backup/restauração dos modelos numa pasta
GOONERS_E2E_MODELS=1 npm run test:e2e   # também baixa modelos reais: SDXS fp32 (imagem e vídeo com IA na CPU),
                                        # Qwen2.5 Coder 0.5B (App Builder) e SmolLM2 135M (chat online e offline)
npm run check:sd -- sdxs-fp32   # roda o pipeline de difusão (tokenizador, agendador, fp16/fp32, img2img) na CPU
                                # com onnxruntime-node e grava txt2img.png e img2img.png em sd-check/
                                # (modelos: sdxs, sdxs-fp32, sd-turbo; baixa na primeira vez)
```

O workflow `.github/workflows/ai.yml` roda tipos, testes unitários, build e testes ponta a ponta. O `pages.yml` gera o app (com cache pelo hash das fontes) e o publica em `/ai/`.

## Limitações conhecidas

- O backup em pasta precisa da File System Access API (navegadores Chromium no computador); no Firefox, no Safari e no celular, o armazenamento permanente e a instalação do app são a proteção disponível.
- Modelos de 0,5 a 1,5 B parâmetros erram fatos e geram apps simples; o Qwen2.5 Coder 1.5B é o mais confiável no App Builder.
- A janela de contexto é de 4k tokens: em conversas longas as mensagens mais antigas saem do contexto, e apps muito grandes são regenerados em vez de editados.
- As imagens são de 512×512. O SD-Turbo exige `shader-f16` e cerca de 3 GB de VRAM; o SDXS fp32 roda em qualquer aparelho, mas leva de 10 a 30 s por imagem na CPU.
- Licenças dos modelos de imagem: SDXS sob OpenRAIL++-M (com restrições de uso), SD-Turbo sob a licença não comercial da Stability AI. Os modelos sem censura não têm filtros: o uso é responsabilidade de quem usa.
- O ONNX Runtime usa uma thread na CPU porque o GitHub Pages não envia os cabeçalhos COOP/COEP necessários para `SharedArrayBuffer`. Isso só afeta o modo CPU.
