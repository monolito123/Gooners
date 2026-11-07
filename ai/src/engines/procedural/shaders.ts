/** GLSL ES 3.00 sources for the procedural scene and image-animation engines. */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

export const SCENE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uSeed;
uniform int uMode;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uSpeed, uComplexity, uWarp, uGlow, uGrain;
vec2 so;
${COMMON}
float fbm(vec2 p) {
  float v = 0., a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  int oct = 3 + int(uComplexity * 4.);
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    v += a * noise(p);
    p = r * p * 2.02 + 17.;
    a *= .5;
  }
  return v;
}
vec3 pal(float t) {
  t = clamp(t, 0., 1.) * 3.;
  if (t < 1.) return mix(uC0, uC1, smoothstep(0., 1., t));
  if (t < 2.) return mix(uC1, uC2, smoothstep(0., 1., t - 1.));
  return mix(uC2, uC3, smoothstep(0., 1., t - 2.));
}

vec3 nebula(vec2 uv, float t) {
  vec2 p = uv * 2.5 + so;
  vec2 q = vec2(fbm(p + t * .05), fbm(p + vec2(5.2, 1.3) - t * .04));
  vec2 r = vec2(fbm(p + 3. * q * (.6 + uWarp) + vec2(1.7, 9.2) + t * .08), fbm(p + 3. * q + vec2(8.3, 2.8) - t * .06));
  float f = fbm(p + 4. * r);
  vec3 col = pal(f * f * 1.5 + .12 * length(q));
  col = mix(col, pal(.95), smoothstep(.55, .95, length(r) * f) * uGlow * .6);
  vec2 g = uv * 60. + so * 10.;
  vec2 id = floor(g);
  float h = hash12(id);
  vec2 st = fract(g) - .5;
  float star = smoothstep(.07, 0., length(st - (hash22(id) - .5) * .6)) * step(.985, h) * (.6 + .4 * sin(t * 3. + h * 50.));
  return col + star * pal(1.);
}

vec3 plasma(vec2 uv, float t) {
  vec2 p = uv * (2. + uComplexity * 4.) + so;
  float v = sin(p.x + t) + sin(p.y * 1.3 - t * .8) + sin((p.x + p.y + t) * .7)
          + sin(length(p + vec2(sin(t * .3), cos(t * .4)) * 2.) * 1.5 - t);
  v += uWarp * fbm(p * .7 + t * .2) * 2.;
  return pal(.5 + .5 * sin(v * 1.2));
}

vec3 tunnel(vec2 uv, float t) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float z = .35 / max(r, .001) + t * 1.2;
  float ang = a / 3.14159 * (3. + floor(uComplexity * 5.)) + t * .15 + uWarp * sin(z * .5);
  float stripes = .5 + .5 * sin(z * 6.) * sin(ang * 6.28318);
  float n = fbm(vec2(ang * 2., z * .6) + so);
  float v = smoothstep(.15, .95, mix(stripes, n, .45));
  vec3 col = pal(v * v);
  col *= smoothstep(0., .5, r) * 1.15;
  col += pal(1.) * pow(max(0., 1. - r * 2.5), 3.) * uGlow;
  return col;
}

vec3 synthwave(vec2 uv, float t) {
  vec3 col = mix(pal(.12), pal(.45), smoothstep(-.1, .6, uv.y));
  vec2 sp = uv - vec2(0., .18);
  float sr = length(sp);
  float sun = smoothstep(.3, .29, sr);
  float cut = uv.y < .16 ? step(.45, fract((uv.y - .16) * 18. - t * .4)) : 1.;
  vec3 sunCol = mix(pal(.98), pal(.68), smoothstep(.3, -.25, sp.y));
  col = mix(col, sunCol, sun * cut);
  col += pal(.8) * exp(-sr * 5.) * .35 * uGlow;
  float m = .02 + .08 * fbm(vec2(uv.x * 3. + so.x, 1.));
  if (uv.y < m && uv.y > 0.) col = mix(col, pal(.04), .92);
  if (uv.y < 0.) {
    float depth = 1. / max(-uv.y, .015);
    vec2 g = vec2(uv.x * depth, depth + t * 3.) * .5;
    vec2 gl = abs(fract(g) - .5) / fwidth(g);
    float line = 1. - min(min(gl.x, gl.y), 1.);
    col = pal(.06) + line * pal(.78) * (1.2 + uGlow) * smoothstep(60., 2., depth);
    col += pal(.6) * exp(-abs(uv.y) * 25.) * .6;
  }
  return col;
}

vec3 ocean(vec2 uv, float t) {
  float horizon = .08;
  vec3 col;
  if (uv.y > horizon) {
    float h = uv.y - horizon;
    col = mix(pal(.75), pal(.32), smoothstep(0., .5, h));
    float clouds = fbm(vec2(uv.x * 2. + t * .03, h * 6.) + so);
    col = mix(col, pal(.95), smoothstep(.55, .85, clouds) * .55 * (1. - h));
    col += pal(1.) * exp(-length(uv - vec2(.25, horizon + .12)) * 8.) * uGlow;
  } else {
    float d = horizon - uv.y;
    float depth = 1. / (d + .03);
    vec2 p = vec2(uv.x * depth, depth * 1.5);
    float w = 0., amp = .5, fr = 1.;
    for (int i = 0; i < 5; i++) {
      w += amp * sin(p.x * fr * 1.3 + p.y * fr * 2. - t * (1.5 + fr * .3) + float(i) * 1.7 + so.x);
      w += amp * .5 * sin(p.y * fr * 3.1 + t * 1.1 * fr);
      fr *= 1.8;
      amp *= .5;
    }
    w += uWarp * fbm(p * .4 + t * .1);
    col = mix(pal(.12), pal(.45), .5 + .25 * w);
    col += pal(.95) * smoothstep(.75, 1.2, w) * max(0., 1. - d * 1.5) * .7;
    col += pal(1.) * exp(-abs(uv.x - .25) * 12.) * smoothstep(0., .3, .3 - d) * (.5 + .5 * sin(w * 6.)) * .5 * uGlow;
    col = mix(col, pal(.6), exp(-d * 30.) * .5);
  }
  return col;
}

vec3 kaleidoscope(vec2 uv, float t) {
  float n = 6. + floor(uComplexity * 8.);
  float a = atan(uv.y, uv.x) + t * .1;
  float r = length(uv);
  float seg = 6.28318 / n;
  a = abs(mod(a, seg) - seg * .5);
  vec2 p = vec2(cos(a), sin(a)) * r * 3. + so;
  float f = fbm(p + vec2(t * .2, -t * .15));
  float g = smoothstep(.2, .8, fbm(p * 2. - f * 2. * (.5 + uWarp) + t * .1));
  vec3 col = pal(g);
  col += pal(1.) * smoothstep(.03, 0., abs(fract(r * 4. - t * .3) - .5) - .46) * .3 * uGlow;
  return col * smoothstep(1.4, .2, r);
}

vec3 lava(vec2 uv, float t) {
  float v = 0.;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t * .3 * (1. + fi * .13) + fi * 2.1 + so.x), cos(t * .25 * (1. + fi * .17) + fi * 1.3 + so.y)) * vec2(.75, .45);
    vec2 d = uv - c;
    v += (.035 + .02 * fract(fi * .37)) / max(dot(d, d), 1e-4);
  }
  v += uWarp * fbm(uv * 3. + t * .2) * .6;
  float f = smoothstep(.6, 2.2, v);
  return pal(f * .92) + pal(1.) * smoothstep(.9, 1., f) * uGlow * .5;
}

vec3 starfield(vec2 uv, float t) {
  vec3 col = pal(.03) * (1. - length(uv) * .5);
  col += pal(.35) * fbm(uv * 2. + so + t * .02) * .3;
  for (int layer = 0; layer < 5; layer++) {
    float fl = float(layer);
    float depth = fract(t * .12 + fl * .2);
    float scale = mix(24., .6, depth);
    float fade = depth * smoothstep(1., .85, depth);
    vec2 g = uv * scale + fl * 31.7 + so;
    vec2 id = floor(g);
    vec2 f = fract(g) - .5;
    vec2 o = hash22(id) - .5;
    float h = hash12(id + 3.1);
    float d = length(f - o * .7);
    col += (.018 / max(d, 1e-3)) * fade * step(.55, h) * mix(pal(.7), pal(1.), h);
  }
  return col;
}

vec3 fractal(vec2 uv, float t) {
  vec2 c = vec2(-.745, .186) + .035 * vec2(cos(t * .15 + so.x), sin(t * .13 + so.y));
  vec2 z = rot(t * .03) * uv * 1.6;
  int maxIt = 60 + int(uComplexity * 120.);
  float it = 0.;
  for (int i = 0; i < 180; i++) {
    if (i >= maxIt) break;
    z = vec2(z.x * z.x - z.y * z.y, 2. * z.x * z.y) + c;
    if (dot(z, z) > 64.) break;
    it += 1.;
  }
  if (it >= float(maxIt)) return pal(0.);
  float sm = it - log2(log2(dot(z, z))) + 4.;
  return pal(fract(sm / float(maxIt) * 2. + t * .02)) * (1. + uGlow * .3);
}

vec3 rain(vec2 uv, float t) {
  float cols = 30. + uComplexity * 50.;
  float x = floor((uv.x + 2.) * cols * .5);
  float speed = .5 + hash12(vec2(x, so.x)) * 1.5;
  float y = uv.y * cols * .5 + t * speed * 8. + hash12(vec2(x, 7.)) * 100.;
  float cell = floor(y);
  float glyph = step(.45, hash12(vec2(x, cell + floor(t * 4. * hash12(vec2(x, cell))))));
  vec2 f = vec2(fract((uv.x + 2.) * cols * .5), fract(y));
  float box = step(.15, f.x) * step(f.x, .85) * step(.1, f.y) * step(f.y, .9);
  float trail = pow(fract(-y * .05 + hash12(vec2(x, 1.))), 3.);
  vec3 col = pal(.04) + glyph * box * trail * pal(.7);
  return col + box * glyph * smoothstep(.96, 1., trail) * pal(1.) * (.5 + uGlow);
}

vec3 aurora(vec2 uv, float t) {
  vec3 col = mix(pal(.02), pal(.14), smoothstep(-.6, .6, uv.y));
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float x = uv.x * (1.2 + fi * .2) + so.x + fi * 1.3;
    float curve = .1 * fi - .12 + .28 * fbm(vec2(x * .8 + t * .08, fi * 3.));
    float d = uv.y - curve;
    float band = exp(-max(d, 0.) * (6. + fi * 2.)) * smoothstep(-.02, .02, d);
    float rays = .6 + .4 * fbm(vec2(x * 6., t * .3 + fi));
    col += pal(.5 + .12 * fi) * band * rays * (.45 + uGlow * .4) / (1. + fi * .4);
  }
  vec2 g = uv * 80.;
  float h = hash12(floor(g) + so);
  return col + step(.993, h) * smoothstep(.5, 0., length(fract(g) - .5)) * .8;
}

vec3 crystal(vec2 uv, float t) {
  vec2 p = uv * (3. + uComplexity * 6.) + so;
  vec2 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8., cid = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 o = .5 + .4 * sin(t * .5 + 6.2831 * hash22(i + g));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; cid = hash12(i + g); } else if (d < d2) d2 = d;
  }
  float edge = smoothstep(0., .06, d2 - d1);
  vec3 col = pal(cid * .8 + .1) * (.6 + .4 * (1. - d1));
  return mix(pal(1.) * (.6 + uGlow * .6), col, edge);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  so = vec2(fract(uSeed * .1234) * 100., fract(uSeed * .5678) * 100.);
  float t = uTime * uSpeed;
  vec3 col;
  if (uMode == 0) col = nebula(uv, t);
  else if (uMode == 1) col = plasma(uv, t);
  else if (uMode == 2) col = tunnel(uv, t);
  else if (uMode == 3) col = synthwave(uv, t);
  else if (uMode == 4) col = ocean(uv, t);
  else if (uMode == 5) col = kaleidoscope(uv, t);
  else if (uMode == 6) col = lava(uv, t);
  else if (uMode == 7) col = starfield(uv, t);
  else if (uMode == 8) col = fractal(uv, t);
  else if (uMode == 9) col = rain(uv, t);
  else if (uMode == 10) col = aurora(uv, t);
  else col = crystal(uv, t);
  col *= 1. - .3 * dot(uv * .9, uv * .9);
  // Soft roll-off above 1 only, so palettes keep their contrast.
  col = max(col, 0.);
  col = mix(col, 1. - .15 * exp(-(col - .85) / .15), step(.85, col));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.3) * 100.) - .5) * uGrain * .12;
  outColor = vec4(clamp(col, 0., 1.), 1.);
}`;

/** Effects applied to an existing image (animate a generated picture). */
export const IMAGE_EFFECTS = ['kenburns', 'ripple', 'parallax', 'glitch', 'kaleidoscope', 'dream', 'vhs'] as const;
export type ImageEffect = (typeof IMAGE_EFFECTS)[number];

export const IMAGE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform vec2 uRes;
uniform float uImgAspect;
uniform float uTime;
uniform float uProgress;
uniform float uStrength;
uniform int uEffect;
${COMMON}
float fbm(vec2 p) {
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.; a *= .5; }
  return v;
}
vec2 cover(vec2 uv) {
  float canvasAspect = uRes.x / uRes.y;
  vec2 s = canvasAspect > uImgAspect ? vec2(1., uImgAspect / canvasAspect) : vec2(canvasAspect / uImgAspect, 1.);
  return (uv - .5) * s + .5;
}
vec4 tex(vec2 uv) { return texture(uImage, clamp(cover(uv), 0., 1.)); }

void main() {
  vec2 uv = vUv;
  float s = uStrength;
  float t = uTime;
  vec4 col;
  if (uEffect == 0) {
    float z = 1. + uProgress * .25 * s;
    vec2 pan = vec2(sin(uProgress * 1.7), cos(uProgress * 1.3)) * .04 * s;
    col = tex((uv - .5) / z + .5 + pan);
  } else if (uEffect == 1) {
    vec2 d = uv - .5;
    float r = length(d);
    uv += normalize(d + 1e-5) * sin(r * 40. - t * 4.) * .006 * s * smoothstep(.8, 0., r);
    col = tex(uv);
  } else if (uEffect == 2) {
    float lum = dot(tex(uv).rgb, vec3(.299, .587, .114));
    vec2 sway = vec2(sin(t * 1.3), cos(t * .9)) * .018 * s;
    col = tex((uv - .5) / 1.05 + .5 + sway * (lum - .5) * 2.);
  } else if (uEffect == 3) {
    float block = floor(uv.y * 24.);
    float trig = step(.86, hash12(vec2(block, floor(t * 12.))));
    uv.x += (hash12(vec2(block, floor(t * 20.))) - .5) * .12 * s * trig;
    float shift = .006 * s * (1. + trig * 3.);
    col = vec4(tex(uv + vec2(shift, 0)).r, tex(uv).g, tex(uv - vec2(shift, 0)).b, 1.);
  } else if (uEffect == 4) {
    vec2 d = uv - .5;
    float a = atan(d.y, d.x) + t * .15 * s;
    float r = length(d);
    float seg = 6.28318 / 8.;
    a = abs(mod(a, seg) - seg * .5);
    col = tex(vec2(cos(a), sin(a)) * r + .5);
  } else if (uEffect == 5) {
    vec2 w = vec2(fbm(uv * 3. + t * .15), fbm(uv * 3. + 5.2 - t * .12)) - .5;
    col = tex(uv + w * .05 * s);
    col.rgb = mix(col.rgb, col.rgb * vec3(1.05, .98, 1.1), .3);
  } else {
    float line = .92 + .08 * sin(uv.y * uRes.y * 1.5);
    float wob = sin(uv.y * 30. + t * 3.) * .0015 * s;
    col = vec4(tex(uv + vec2(wob + .003 * s, 0)).r, tex(uv + vec2(wob, 0)).g, tex(uv + vec2(wob - .003 * s, 0)).b, 1.);
    col.rgb *= line;
    col.rgb += (hash12(uv * uRes + fract(t) * 91.) - .5) * .08 * s;
  }
  outColor = vec4(col.rgb, 1.);
}`;
