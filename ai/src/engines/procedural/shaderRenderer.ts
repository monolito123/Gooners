/**
 * WebGL2 renderer for procedural scenes and image effects. Runs on any GPU with WebGL2 (no
 * model download), used for instant images, shader animations and animating still images.
 */
import { IMAGE_EFFECTS, IMAGE_FRAGMENT, type ImageEffect, SCENE_FRAGMENT, VERTEX } from './shaders.ts';
import { SCENE_MODES, type SceneSpec } from './artEngine.ts';

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  program: WebGLProgram;
  uniforms: Uniforms;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class ShaderRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private scene?: Program;
  private effect?: Program;
  private texture?: WebGLTexture;
  private textureSource?: TexImageSource;
  private textureAspect = 1;
  private lost = false;

  constructor(width: number, height: number, canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.scene = undefined;
      this.effect = undefined;
      this.texture = undefined;
      this.textureSource = undefined;
    });
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  setSize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private compile(fragment: string, names: string[]): Program {
    const gl = this.gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader compile error: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link error: ${gl.getProgramInfoLog(program)}`);
    const uniforms: Uniforms = {};
    for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }

  private draw(p: Program): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(p.program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Draws one frame of a procedural scene at `time` seconds. */
  renderScene(spec: SceneSpec, time: number): void {
    if (this.lost) throw new Error('The WebGL context was lost; try again');
    const gl = this.gl;
    this.scene ??= this.compile(SCENE_FRAGMENT, [
      'uRes', 'uTime', 'uSeed', 'uMode', 'uC0', 'uC1', 'uC2', 'uC3', 'uSpeed', 'uComplexity', 'uWarp', 'uGlow', 'uGrain',
    ]);
    const u = this.scene.uniforms;
    gl.useProgram(this.scene.program);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uSeed, spec.seed % 10007);
    gl.uniform1i(u.uMode, SCENE_MODES.indexOf(spec.mode));
    spec.palette.forEach((hex, i) => gl.uniform3fv(u[`uC${i}`], hexToRgb(hex)));
    gl.uniform1f(u.uSpeed, spec.speed);
    gl.uniform1f(u.uComplexity, spec.complexity);
    gl.uniform1f(u.uWarp, spec.warp);
    gl.uniform1f(u.uGlow, spec.glow);
    gl.uniform1f(u.uGrain, spec.grain);
    this.draw(this.scene);
  }

  /** Draws `image` with an animated effect; `progress` runs 0→1 over the clip. */
  renderImageEffect(image: TexImageSource, effect: ImageEffect, time: number, progress: number, strength: number): void {
    if (this.lost) throw new Error('The WebGL context was lost; try again');
    const gl = this.gl;
    this.effect ??= this.compile(IMAGE_FRAGMENT, ['uImage', 'uRes', 'uImgAspect', 'uTime', 'uProgress', 'uStrength', 'uEffect']);
    if (this.textureSource !== image) {
      this.texture ??= gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      // UNPACK_FLIP_Y is ignored for ImageBitmap uploads, so copy bitmaps to a canvas first.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image instanceof ImageBitmap ? bitmapToCanvas(image) : image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const size = sourceSize(image);
      this.textureAspect = size.width / Math.max(1, size.height);
      this.textureSource = image;
    }
    const u = this.effect.uniforms;
    gl.useProgram(this.effect.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture!);
    gl.uniform1i(u.uImage, 0);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uImgAspect, this.textureAspect);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uProgress, progress);
    gl.uniform1f(u.uStrength, strength);
    gl.uniform1i(u.uEffect, IMAGE_EFFECTS.indexOf(effect));
    this.draw(this.effect);
  }

  toBlob(type = 'image/png', quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the frame'))), type, quality),
    );
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function bitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas;
}

function sourceSize(source: TexImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight };
  return { width: source.width, height: source.height };
}

/** Renders a still procedural image (sampled at a seed-dependent moment of the animation). */
export async function renderProceduralImage(spec: SceneSpec, width: number, height: number): Promise<Blob> {
  const renderer = new ShaderRenderer(width, height);
  try {
    renderer.renderScene(spec, 7 + (spec.seed % 97) * 0.37);
    return await renderer.toBlob('image/png');
  } finally {
    renderer.dispose();
  }
}
