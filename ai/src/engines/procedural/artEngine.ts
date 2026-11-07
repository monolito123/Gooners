/**
 * Turns a free-text prompt (English or Portuguese) into parameters for the procedural shader
 * engine: scene type, a 4-colour palette, motion speed, detail, distortion, glow and grain.
 * Deterministic: the same prompt and seed always give the same picture.
 */
import { hashString, mulberry32 } from '../../lib/prng.ts';

export const SCENE_MODES = [
  'nebula',
  'plasma',
  'tunnel',
  'synthwave',
  'ocean',
  'kaleidoscope',
  'lava',
  'starfield',
  'fractal',
  'rain',
  'aurora',
  'crystal',
] as const;
export type SceneMode = (typeof SCENE_MODES)[number];

export type Palette = [string, string, string, string];

export interface SceneSpec {
  mode: SceneMode;
  palette: Palette;
  /** Motion multiplier, 0.2–2.5. */
  speed: number;
  /** Detail level, 0–1. */
  complexity: number;
  /** Distortion, 0–1. */
  warp: number;
  /** Bloom/highlights, 0–1. */
  glow: number;
  /** Film grain, 0–1. */
  grain: number;
  seed: number;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ');
}

const MODE_WORDS: Record<SceneMode, string[]> = {
  nebula: ['space', 'galaxy', 'nebula', 'cosmos', 'cosmic', 'universe', 'smoke', 'cloud', 'clouds', 'mist', 'fog', 'espaco', 'galaxia', 'nebulosa', 'cosmico', 'universo', 'fumaca', 'nuvem', 'nuvens', 'neblina', 'nevoa'],
  plasma: ['plasma', 'psychedelic', 'trippy', 'groovy', 'energy', 'psicodelico', 'psicodelia', 'energia', 'hippie'],
  tunnel: ['tunnel', 'portal', 'wormhole', 'vortex', 'hyperspace', 'tunel', 'vortice', 'buraco', 'hiperespaco', 'spiral', 'espiral'],
  synthwave: ['synthwave', 'retro', '80s', 'outrun', 'vaporwave', 'retrowave', 'grid', 'arcade', 'oitenta'],
  ocean: ['ocean', 'sea', 'wave', 'waves', 'beach', 'water', 'lake', 'river', 'surf', 'mar', 'oceano', 'onda', 'ondas', 'praia', 'agua', 'lago', 'rio'],
  kaleidoscope: ['kaleidoscope', 'mandala', 'symmetry', 'symmetric', 'sacred', 'geometry', 'caleidoscopio', 'simetria', 'simetrico', 'geometria', 'sagrada'],
  lava: ['lava', 'magma', 'volcano', 'lamp', 'blob', 'blobs', 'liquid', 'molten', 'slime', 'vulcao', 'liquido', 'derretido', 'gosma', 'luminaria'],
  starfield: ['stars', 'star', 'starfield', 'warp', 'hyperdrive', 'lightspeed', 'estrelas', 'estrela', 'dobra', 'velocidade'],
  fractal: ['fractal', 'fractals', 'julia', 'mandelbrot', 'infinite', 'recursion', 'infinito', 'recursao', 'fractais'],
  rain: ['rain', 'matrix', 'code', 'hacker', 'digital', 'data', 'terminal', 'chuva', 'codigo', 'dados', 'binary', 'binario'],
  aurora: ['aurora', 'borealis', 'northern', 'lights', 'polar', 'boreal', 'ribbons', 'luzes'],
  crystal: ['crystal', 'crystals', 'ice', 'diamond', 'glass', 'prism', 'cells', 'mosaic', 'stained', 'cristal', 'cristais', 'gelo', 'diamante', 'vidro', 'prisma', 'celulas', 'mosaico', 'vitral'],
};

const THEMES: { words: string[]; palette: Palette }[] = [
  { words: ['sunset', 'dusk', 'por do sol', 'entardecer', 'crepusculo', 'golden hour'], palette: ['#1a0b2e', '#7b2869', '#ff6b6b', '#ffd166'] },
  { words: ['ocean', 'sea', 'oceano', 'mar', 'underwater', 'submarino', 'deep'], palette: ['#03045e', '#0077b6', '#00b4d8', '#caf0f8'] },
  { words: ['forest', 'jungle', 'nature', 'floresta', 'selva', 'mata', 'natureza', 'leaf', 'folha'], palette: ['#081c15', '#1b4332', '#52b788', '#d8f3dc'] },
  { words: ['fire', 'flame', 'inferno', 'burning', 'fogo', 'chama', 'chamas', 'queimando', 'lava', 'magma', 'volcano', 'vulcao'], palette: ['#140000', '#9d0208', '#f48c06', '#ffba08'] },
  { words: ['ice', 'snow', 'frozen', 'winter', 'frost', 'gelo', 'neve', 'congelado', 'inverno', 'geada', 'artic', 'artico'], palette: ['#0b132b', '#3a506b', '#5bc0be', '#e0fbfc'] },
  { words: ['neon', 'cyberpunk', 'synthwave', 'vaporwave', 'outrun', 'cyber', 'arcade'], palette: ['#0d0221', '#ff2bd6', '#22e6ff', '#f9f871'] },
  { words: ['space', 'galaxy', 'cosmos', 'universe', 'espaco', 'galaxia', 'universo', 'nebula', 'nebulosa'], palette: ['#03001c', '#301e67', '#5b8fb9', '#b6eada'] },
  { words: ['gold', 'golden', 'luxury', 'royal', 'ouro', 'dourado', 'luxo', 'real'], palette: ['#1b1300', '#7a5c00', '#d4a017', '#fff3b0'] },
  { words: ['matrix', 'hacker', 'terminal', 'toxic', 'radioactive', 'toxico', 'radioativo'], palette: ['#000a00', '#003b00', '#00ff41', '#d1ffd6'] },
  { words: ['candy', 'pastel', 'dream', 'dreamy', 'cute', 'kawaii', 'sonho', 'doce', 'fofo'], palette: ['#2b1e3f', '#f4a7bb', '#a0e7e5', '#fbe7c6'] },
  { words: ['desert', 'sand', 'dune', 'deserto', 'areia', 'duna', 'sahara'], palette: ['#2d1e12', '#a0522d', '#e9a66c', '#f7e0b5'] },
  { words: ['blood', 'horror', 'demon', 'hell', 'sangue', 'terror', 'demonio', 'inferno'], palette: ['#050000', '#3d0000', '#950101', '#ff2e2e'] },
  { words: ['noir', 'monochrome', 'black and white', 'grayscale', 'preto e branco', 'monocromatico', 'cinza'], palette: ['#000000', '#3a3a3a', '#9a9a9a', '#ffffff'] },
  { words: ['rainbow', 'pride', 'colorful', 'arco iris', 'arco-iris', 'colorido', 'multicolor'], palette: ['#ff0080', '#ffbf00', '#00ff9f', '#0080ff'] },
  { words: ['autumn', 'fall', 'outono'], palette: ['#2b0f0e', '#8c2f39', '#e36414', '#f6aa1c'] },
  { words: ['spring', 'flowers', 'floral', 'primavera', 'flores', 'cherry', 'sakura'], palette: ['#1f2d16', '#4e9f3d', '#f49cbb', '#fff1e6'] },
  { words: ['night', 'midnight', 'moon', 'noite', 'meia noite', 'lua', 'lunar'], palette: ['#000814', '#001d3d', '#003566', '#ffc300'] },
  { words: ['aurora', 'borealis', 'northern lights', 'aurora boreal'], palette: ['#020916', '#0b3d2e', '#2de1c2', '#b388ff'] },
  { words: ['electric', 'lightning', 'storm', 'thunder', 'eletrico', 'raio', 'tempestade', 'trovao'], palette: ['#05010f', '#2a0a6b', '#6d5dfc', '#e0f7ff'] },
];

const COLORS: Record<string, string> = {
  red: '#ff3b3b', vermelho: '#ff3b3b', vermelha: '#ff3b3b', crimson: '#c1121f', carmesim: '#c1121f',
  orange: '#ff8c1a', laranja: '#ff8c1a',
  yellow: '#ffd60a', amarelo: '#ffd60a', amarela: '#ffd60a',
  green: '#2ecc71', verde: '#2ecc71', lime: '#b6ff3b', lima: '#b6ff3b', emerald: '#10b981', esmeralda: '#10b981',
  blue: '#3a86ff', azul: '#3a86ff', navy: '#14213d', marinho: '#14213d',
  cyan: '#22e6ff', ciano: '#22e6ff', turquoise: '#2ec4b6', turquesa: '#2ec4b6', teal: '#14b8a6',
  purple: '#9b5de5', roxo: '#9b5de5', roxa: '#9b5de5', violet: '#7f5af0', violeta: '#7f5af0', lilac: '#c8a2c8', lilas: '#c8a2c8',
  pink: '#ff4fa3', rosa: '#ff4fa3', magenta: '#ff2bd6',
  white: '#f8f9fa', branco: '#f8f9fa', branca: '#f8f9fa',
  black: '#050505', preto: '#050505', preta: '#050505',
  gold: '#d4a017', dourado: '#d4a017', silver: '#c0c7d0', prata: '#c0c7d0', prateado: '#c0c7d0',
  brown: '#8b5a2b', marrom: '#8b5a2b',
};

const SLOW = ['slow', 'calm', 'peaceful', 'serene', 'zen', 'relax', 'relaxing', 'gentle', 'lento', 'lenta', 'calmo', 'calma', 'tranquilo', 'tranquila', 'sereno', 'suave', 'relaxante'];
const FAST = ['fast', 'energetic', 'chaos', 'chaotic', 'intense', 'explosion', 'hyper', 'frantic', 'rapido', 'rapida', 'energetico', 'caos', 'caotico', 'intenso', 'explosao', 'frenetico', 'acelerado'];
const SIMPLE = ['minimal', 'minimalist', 'simple', 'clean', 'flat', 'minimalista', 'simples', 'limpo'];
const DETAILED = ['detailed', 'intricate', 'complex', 'ornate', 'hd', '4k', '8k', 'detalhado', 'complexo', 'intrincado', 'rebuscado'];
const GLOW = ['glow', 'glowing', 'neon', 'luminous', 'shining', 'bright', 'brilho', 'brilhante', 'luminoso', 'neon', 'radiante'];
const DARK = ['dark', 'gloomy', 'moody', 'escuro', 'sombrio', 'obscuro'];
const WARP = ['distorted', 'warped', 'twisted', 'liquid', 'fluid', 'melting', 'distorcido', 'torcido', 'fluido', 'derretendo', 'ondulado'];
const GRAIN = ['film', 'grain', 'grainy', 'vintage', 'analog', 'vhs', 'retro', 'granulado', 'analogico', 'antigo'];

function countHits(text: string, tokens: Set<string>, words: string[]): number {
  let n = 0;
  for (const w of words) if (w.includes(' ') ? text.includes(w) : tokens.has(w)) n++;
  return n;
}

function hexToHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** A dark-to-light palette built around explicitly named colours. */
function paletteFromColors(colors: string[]): Palette {
  const [h0, s0] = hexToHsl(colors[0]);
  const base = hslToHex(h0, Math.min(0.6, s0), 0.06);
  const c1 = colors[0];
  const c2 = colors[1] ?? hslToHex((h0 + 40) % 360, Math.max(0.6, s0), 0.6);
  const [h2, s2] = hexToHsl(c2);
  const c3 = colors[2] ?? hslToHex(h2, Math.min(1, s2 * 0.6), 0.88);
  return [base, c1, c2, c3];
}

/** Harmonious random palette from a seed (analogous / triadic / complementary). */
export function seededPalette(seed: number): Palette {
  const rand = mulberry32(seed);
  const h = rand() * 360;
  const scheme = Math.floor(rand() * 3);
  const offsets = scheme === 0 ? [0, 25, 50] : scheme === 1 ? [0, 120, 240] : [0, 180, 30];
  return [
    hslToHex(h, 0.55, 0.05),
    hslToHex((h + offsets[0]) % 360, 0.75, 0.38),
    hslToHex((h + offsets[1]) % 360, 0.85, 0.58),
    hslToHex((h + offsets[2]) % 360, 0.9, 0.85),
  ];
}

export function interpretPrompt(prompt: string, seed = 0): SceneSpec {
  const text = ` ${normalize(prompt)} `;
  const tokens = new Set(text.split(/\s+/).filter(Boolean));
  const promptSeed = hashString(text.trim()) ^ seed;
  const rand = mulberry32(promptSeed);

  let mode: SceneMode | undefined;
  let best = 0;
  for (const m of SCENE_MODES) {
    const score = countHits(text, tokens, MODE_WORDS[m]);
    if (score > best) {
      best = score;
      mode = m;
    }
  }
  mode ??= SCENE_MODES[Math.floor(rand() * SCENE_MODES.length)];

  const named = Array.from(tokens)
    .map((t) => COLORS[t])
    .filter((c): c is string => Boolean(c));
  let palette: Palette | undefined;
  if (named.length >= 1) palette = paletteFromColors(Array.from(new Set(named)));
  if (!palette || named.length === 1) {
    let bestTheme = 0;
    for (const theme of THEMES) {
      const score = countHits(text, tokens, theme.words);
      if (score > bestTheme) {
        bestTheme = score;
        palette = named.length === 1 ? [theme.palette[0], named[0], theme.palette[2], theme.palette[3]] : theme.palette;
      }
    }
  }
  palette ??= seededPalette(promptSeed);

  const has = (words: string[]) => countHits(text, tokens, words) > 0;
  const jitter = () => (rand() - 0.5) * 0.15;
  const speed = (has(SLOW) ? 0.45 : has(FAST) ? 1.9 : 1) + jitter();
  const complexity = Math.min(1, Math.max(0, (has(SIMPLE) ? 0.25 : has(DETAILED) ? 0.95 : 0.6) + jitter()));
  const glow = Math.min(1, Math.max(0, (has(GLOW) ? 0.95 : has(DARK) ? 0.2 : 0.55) + jitter()));
  const warp = Math.min(1, Math.max(0, (has(WARP) ? 0.9 : 0.35) + jitter()));
  const grain = has(GRAIN) ? 0.7 : 0.12;
  if (has(DARK)) palette = [palette[0], palette[1], palette[2], hslToHex(hexToHsl(palette[3])[0], 0.6, 0.6)];

  return { mode, palette, speed, complexity, glow, warp, grain, seed: promptSeed % 100000 };
}

/** Validates/clamps a spec coming from the LLM ("interpret with AI"). */
export function sanitizeSpec(raw: unknown, fallback: SceneSpec): SceneSpec {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const mode = SCENE_MODES.includes(r.mode as SceneMode) ? (r.mode as SceneMode) : fallback.mode;
  const colors = Array.isArray(r.palette) ? r.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) : [];
  const palette: Palette = colors.length >= 4 ? [colors[0], colors[1], colors[2], colors[3]] : fallback.palette;
  return {
    mode,
    palette,
    speed: num(r.speed, fallback.speed, 0.2, 2.5),
    complexity: num(r.complexity, fallback.complexity, 0, 1),
    warp: num(r.warp, fallback.warp, 0, 1),
    glow: num(r.glow, fallback.glow, 0, 1),
    grain: num(r.grain, fallback.grain, 0, 1),
    seed: fallback.seed,
  };
}

export const SCENE_JSON_INSTRUCTIONS = `You convert a picture or animation description into JSON parameters for a shader engine.
Reply with ONLY one JSON object, no prose, with keys:
"mode": one of ${SCENE_MODES.map((m) => `"${m}"`).join(', ')};
"palette": array of 4 hex colours from darkest background to brightest highlight, matching the description;
"speed": number 0.2-2.5 (motion speed); "complexity": 0-1 (detail); "warp": 0-1 (distortion); "glow": 0-1; "grain": 0-1.`;
