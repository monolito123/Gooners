import{A as e,H as t,I as n,M as r,N as i,P as a,R as o,T as s,U as c,W as l,X as u,Y as d,_ as f,at as p,ct as ee,d as m,et as h,f as te,g,i as ne,it as re,j as ie,lt as ae,m as oe,p as _,s as se,v as ce,vt as v,x as le,y,z as ue}from"./index-C1d2QJtI.js";import{a as de,i as fe,n as pe,r as me,s as he,t as ge}from"./media-Bw1u4lkm.js";import{a as _e,n as b,o as x,r as ve,s as ye,t as S}from"./artEngine-gp4Vjuhm.js";import{i as C,n as be,t as w}from"./jsx-runtime-DyZJNswf.js";var T={name:`dices`,size:24,node:[[`rect`,{width:`12`,height:`12`,x:`2`,y:`10`,rx:`2`,ry:`2`,key:`6agr2n`}],[`path`,{d:`m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6`,key:`1o487t`}],[`path`,{d:`M6 18h.01`,key:`uhywen`}],[`path`,{d:`M10 14h.01`,key:`ssrbsk`}],[`path`,{d:`M15 6h.01`,key:`cblpky`}],[`path`,{d:`M18 9h.01`,key:`2061c0`}]]};T.node;var xe=v(T),E={name:`lock-open`,size:24,node:[[`rect`,{width:`18`,height:`11`,x:`3`,y:`11`,rx:`2`,ry:`2`,key:`1w4ew1`}],[`path`,{d:`M7 11V7a5 5 0 0 1 9.9-1`,key:`1mm8w8`}]],aliases:[`unlock`]};E.node;var Se=v(E),D={name:`square`,size:24,node:[[`rect`,{width:`18`,height:`18`,x:`3`,y:`3`,rx:`2`,key:`afitv7`}]]};D.node;var Ce=v(D),O=C(be(),1);function k(){return n.getState().status===`ready`}async function we(e,t){if(!k())return t;try{let{text:r}=await n.generate([{role:`system`,content:S},{role:`user`,content:e}],{params:{temperature:.2,topP:.9,maxTokens:220},onDelta:()=>void 0}),i=r.match(/\{[\s\S]*\}/)?.[0];return i?_e(JSON.parse(i),t):t}catch{return t}}var A=`#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`,j=`
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
`,M=`#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uSeed;
uniform int uMode;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uSpeed, uComplexity, uWarp, uGlow, uGrain;
vec2 so;
${j}
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
}`,N=[`kenburns`,`ripple`,`parallax`,`glitch`,`kaleidoscope`,`dream`,`vhs`],P=`#version 300 es
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
${j}
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
}`;function Te(e){let t=Number.parseInt(e.replace(`#`,``),16);return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255]}var F=class{canvas;gl;scene;effect;texture;textureSource;textureAspect=1;lost=!1;constructor(e,t,n){this.canvas=n??document.createElement(`canvas`),this.canvas.width=e,this.canvas.height=t;let r=this.canvas.getContext(`webgl2`,{preserveDrawingBuffer:!0,antialias:!1,premultipliedAlpha:!1});if(!r)throw Error(`WebGL2 is not available in this browser`);this.gl=r,this.canvas.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),this.lost=!0}),this.canvas.addEventListener(`webglcontextrestored`,()=>{this.lost=!1,this.scene=void 0,this.effect=void 0,this.texture=void 0,this.textureSource=void 0});let i=r.createBuffer();r.bindBuffer(r.ARRAY_BUFFER,i),r.bufferData(r.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),r.STATIC_DRAW)}setSize(e,t){this.canvas.width!==e&&(this.canvas.width=e),this.canvas.height!==t&&(this.canvas.height=t)}compile(e,t){let n=this.gl,r=(e,t)=>{let r=n.createShader(e);if(n.shaderSource(r,t),n.compileShader(r),!n.getShaderParameter(r,n.COMPILE_STATUS))throw Error(`Shader compile error: ${n.getShaderInfoLog(r)}`);return r},i=n.createProgram();if(n.attachShader(i,r(n.VERTEX_SHADER,A)),n.attachShader(i,r(n.FRAGMENT_SHADER,e)),n.bindAttribLocation(i,0,`aPos`),n.linkProgram(i),!n.getProgramParameter(i,n.LINK_STATUS))throw Error(`Shader link error: ${n.getProgramInfoLog(i)}`);let a={};for(let e of t)a[e]=n.getUniformLocation(i,e);return{program:i,uniforms:a}}draw(e){let t=this.gl;t.viewport(0,0,this.canvas.width,this.canvas.height),t.useProgram(e.program),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,0,0),t.drawArrays(t.TRIANGLE_STRIP,0,4)}renderScene(e,t){if(this.lost)throw Error(`The WebGL context was lost; try again`);let n=this.gl;this.scene??=this.compile(M,[`uRes`,`uTime`,`uSeed`,`uMode`,`uC0`,`uC1`,`uC2`,`uC3`,`uSpeed`,`uComplexity`,`uWarp`,`uGlow`,`uGrain`]);let r=this.scene.uniforms;n.useProgram(this.scene.program),n.uniform2f(r.uRes,this.canvas.width,this.canvas.height),n.uniform1f(r.uTime,t),n.uniform1f(r.uSeed,e.seed%10007),n.uniform1i(r.uMode,b.indexOf(e.mode)),e.palette.forEach((e,t)=>n.uniform3fv(r[`uC${t}`],Te(e))),n.uniform1f(r.uSpeed,e.speed),n.uniform1f(r.uComplexity,e.complexity),n.uniform1f(r.uWarp,e.warp),n.uniform1f(r.uGlow,e.glow),n.uniform1f(r.uGrain,e.grain),this.draw(this.scene)}renderImageEffect(e,t,n,r,i){if(this.lost)throw Error(`The WebGL context was lost; try again`);let a=this.gl;if(this.effect??=this.compile(P,[`uImage`,`uRes`,`uImgAspect`,`uTime`,`uProgress`,`uStrength`,`uEffect`]),this.textureSource!==e){this.texture??=a.createTexture(),a.bindTexture(a.TEXTURE_2D,this.texture),a.pixelStorei(a.UNPACK_FLIP_Y_WEBGL,!0),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,a.RGBA,a.UNSIGNED_BYTE,e instanceof ImageBitmap?Ee(e):e),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MIN_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MAG_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_S,a.CLAMP_TO_EDGE),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_T,a.CLAMP_TO_EDGE);let t=I(e);this.textureAspect=t.width/Math.max(1,t.height),this.textureSource=e}let o=this.effect.uniforms;a.useProgram(this.effect.program),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.texture),a.uniform1i(o.uImage,0),a.uniform2f(o.uRes,this.canvas.width,this.canvas.height),a.uniform1f(o.uImgAspect,this.textureAspect),a.uniform1f(o.uTime,n),a.uniform1f(o.uProgress,r),a.uniform1f(o.uStrength,i),a.uniform1i(o.uEffect,N.indexOf(t)),this.draw(this.effect)}toBlob(e=`image/png`,t){return new Promise((n,r)=>this.canvas.toBlob(e=>e?n(e):r(Error(`Could not encode the frame`)),e,t))}dispose(){this.gl.getExtension(`WEBGL_lose_context`)?.loseContext()}};function Ee(e){let t=document.createElement(`canvas`);return t.width=e.width,t.height=e.height,t.getContext(`2d`).drawImage(e,0,0),t}function I(e){return e instanceof HTMLImageElement?{width:e.naturalWidth,height:e.naturalHeight}:e instanceof HTMLVideoElement?{width:e.videoWidth,height:e.videoHeight}:`displayWidth`in e?{width:e.displayWidth,height:e.displayHeight}:{width:e.width,height:e.height}}async function De(e,t,n){let r=new F(t,n);try{return r.renderScene(e,7+e.seed%97*.37),await r.toBlob(`image/png`)}finally{r.dispose()}}function L(e){return Math.max(2,Math.min(360,Math.round(e.fps*e.seconds)))}function R(e){if(e?.aborted)throw new DOMException(`Cancelled`,`AbortError`)}var z=()=>new Promise(e=>setTimeout(e,0));async function B(e,t){let n=L(t),r=new F(t.width,t.height),i=[];try{for(let a=0;a<n;a++){R(t.signal),r.renderScene(e,3+a/t.fps);let o=await r.toBlob(`image/png`);i.push(o),t.onFrame?.(o,a,n),a%4==3&&await z()}}finally{r.dispose()}return{frames:i,width:t.width,height:t.height,fps:t.fps}}async function V(e,t,n,r){let i=L(r),a=new F(r.width,r.height),o=[];try{for(let s=0;s<i;s++){R(r.signal),a.renderImageEffect(e,t,s/r.fps,s/(i-1),n);let c=await a.toBlob(`image/png`);o.push(c),r.onFrame?.(c,s,i),s%4==3&&await z()}}finally{a.dispose()}return{frames:o,width:r.width,height:r.height,fps:r.fps}}async function Oe(e,t,n){let r=document.createElement(`canvas`);return r.width=t,r.height=n,r.getContext(`2d`).putImageData(new ImageData(new Uint8ClampedArray(e),t,n),0,0),new Promise((e,t)=>r.toBlob(n=>n?e(n):t(Error(`PNG encoding failed`)),`image/png`))}var H={scale:1.22,rotateDeg:1.5,strength:.5},U=e=>e*e*(3-2*e);function W(e,t,n,r,i,a){e.save(),e.globalAlpha=a,e.translate(n/2,n/2),e.rotate(i*Math.PI/180),e.scale(r,r),e.drawImage(t,-n/2,-n/2,n,n),e.restore()}function G(e){let t=e.width,n=document.createElement(`canvas`);n.width=t,n.height=e.height;let r=n.getContext(`2d`);r.drawImage(e,0,0),r.globalCompositeOperation=`destination-in`;let i=r.createRadialGradient(t/2,t/2,t*.38,t/2,t/2,t*.62);return i.addColorStop(0,`rgba(0,0,0,1)`),i.addColorStop(1,`rgba(0,0,0,0)`),r.fillStyle=i,r.fillRect(0,0,t,t),n}function K(e){return new Promise((t,n)=>e.toBlob(e=>e?t(e):n(Error(`Could not encode the frame`)),`image/png`))}async function ke(e){let{motion:t,fps:n,seconds:r,signal:i}=e,o=Math.max(2,Math.min(360,Math.round(n*r))),s=t===`camera`?1:Math.max(2,Math.min(24,Math.round(e.keyframes))),c=[],l=[];try{if(await a.generate({prompt:e.prompt,seed:e.seed,steps:1,frames:s,mode:t===`dream`?`zoom`:t===`loop`?`loop`:t===`flow`?`morph`:`single`,seedB:e.seed+104729,walk:Math.min(1,.13*(s-1)),radius:.45,zoom:H},t=>{l.push(Oe(t.rgba,t.width,t.height).then(async n=>{c[t.index]=await createImageBitmap(n),e.onKeyframe?.(n,t.index,t.total)}))},i),await Promise.all(l),R(i),t===`camera`){let t=e.effect??`kenburns`;return await V(c[0],t,1,{fps:n,seconds:r,width:512,height:512,signal:i,onFrame:e.onFrame})}let u=c[0].width,d=document.createElement(`canvas`);d.width=u,d.height=u;let f=d.getContext(`2d`);f.imageSmoothingQuality=`high`;let p=t===`loop`?s:s-1,ee=t===`dream`?c.map(G):[],m=[];for(let n=0;n<o;n++){R(i);let r=n/(t===`loop`?o:o-1)*p,a=Math.min(p-1,Math.floor(r)),l=Math.min(1,r-a),h=c[a],te=c[(a+1)%s];if(f.globalAlpha=1,f.fillStyle=`#000`,f.fillRect(0,0,u,u),t===`dream`)W(f,h,u,H.scale**l,H.rotateDeg*l,1),W(f,l<1?ee[(a+1)%s]:te,u,H.scale**(l-1),H.rotateDeg*(l-1),U(l));else{let e=t===`flow`?1+.18*(n/(o-1)):1.02;W(f,h,u,e,0,1),W(f,te,u,e,0,U(l))}let g=await K(d);m.push(g),e.onFrame?.(g,n,o),n%4==3&&await z()}return{frames:m,width:u,height:u,fps:n}}finally{c.forEach(e=>e?.close())}}async function Ae(e,t){let n=await createImageBitmap(e),r=document.createElement(`canvas`);r.width=t,r.height=t;let i=r.getContext(`2d`),a=Math.max(t/n.width,t/n.height),o=n.width*a,s=n.height*a;return i.drawImage(n,(t-o)/2,(t-s)/2,o,s),n.close(),i.getImageData(0,0,t,t).data}var q=w(),je={diffusion:`local`,cloud:`cloud`,procedural:`abstract`},Me={local:`diffusion`,cloud:`cloud`,abstract:`procedural`};function Ne({models:e,model:t,onModel:n}){let r=d();return(0,q.jsxs)(g,{className:`space-y-3 p-4`,children:[(0,q.jsxs)(`div`,{className:`flex gap-2 text-xs text-ink-300`,children:[(0,q.jsx)(re,{className:`mt-0.5 size-3.5 shrink-0 text-neon-amber`}),(0,q.jsx)(`p`,{children:r(`cloudImage.about`)})]}),(0,q.jsx)(_,{label:r(`cloudImage.model`),children:(0,q.jsxs)(`select`,{className:s,value:t??e[0]??``,onChange:e=>n(e.target.value),children:[e.length===0&&(0,q.jsx)(`option`,{value:``,children:`…`}),e.map(e=>(0,q.jsx)(`option`,{value:e,children:e},e))]})})]})}function Pe({spec:e,onChange:t,onReset:n,custom:r}){let i=d();return(0,q.jsxs)(`div`,{className:`space-y-3 rounded-xl border border-ink-600 bg-ink-900/50 p-3`,children:[(0,q.jsxs)(`div`,{className:`flex items-center gap-2`,children:[(0,q.jsx)(`span`,{className:`text-xs font-semibold tracking-wide text-ink-200 uppercase`,children:i(`proc.scene`)}),r&&(0,q.jsxs)(`button`,{type:`button`,onClick:n,className:`ml-auto inline-flex items-center gap-1 text-xs text-ink-400 hover:text-white`,children:[(0,q.jsx)(p,{className:`size-3`}),` `,i(`proc.reset`)]})]}),(0,q.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2`,children:[(0,q.jsx)(`select`,{className:`${s} w-auto py-1.5`,value:e.mode,onChange:n=>t({...e,mode:n.target.value}),"aria-label":i(`proc.mode`),children:b.map(e=>(0,q.jsx)(`option`,{value:e,children:i(`scene.${e}`)},e))}),(0,q.jsx)(`div`,{className:`flex gap-1`,children:e.palette.map((n,r)=>(0,q.jsx)(`input`,{type:`color`,value:n,"aria-label":`${i(`proc.color`)} ${r+1}`,onChange:n=>{let i=[...e.palette];i[r]=n.target.value,t({...e,palette:i})},className:`size-8 cursor-pointer rounded-lg border border-ink-500 bg-transparent p-0.5`},r))})]}),(0,q.jsxs)(`div`,{className:`grid grid-cols-2 gap-x-4 gap-y-3`,children:[(0,q.jsx)(y,{label:i(`proc.detail`),value:e.complexity,min:0,max:1,step:.05,onChange:n=>t({...e,complexity:n}),format:e=>e.toFixed(2)}),(0,q.jsx)(y,{label:i(`proc.warp`),value:e.warp,min:0,max:1,step:.05,onChange:n=>t({...e,warp:n}),format:e=>e.toFixed(2)}),(0,q.jsx)(y,{label:i(`proc.glow`),value:e.glow,min:0,max:1,step:.05,onChange:n=>t({...e,glow:n}),format:e=>e.toFixed(2)}),(0,q.jsx)(y,{label:i(`proc.grain`),value:e.grain,min:0,max:1,step:.05,onChange:n=>t({...e,grain:n}),format:e=>e.toFixed(2)})]})]})}function J(){let n=d(),p=ie(),re=r();e();let v=se(e=>e.assets),_e=i(e=>e.toast),b=h(p.modelId),S=a.device(b),[C,be]=(0,O.useState)(()=>Me[u.getState().imageEngine]??`diffusion`),w=e=>{be(e),u.getState().set({imageEngine:je[e]})},T=u(e=>e.cloudImageModel),[E,D]=(0,O.useState)([]);(0,O.useEffect)(()=>{if(C!==`cloud`||E.length)return;let e=new AbortController;return ue(e.signal).then(D).catch(()=>D([`flux`])),()=>e.abort()},[C,E.length]);let[A,j]=(0,O.useState)(``),[M,N]=(0,O.useState)(x),[P,Te]=(0,O.useState)(!1),[F,Ee]=(0,O.useState)(1),[I,L]=(0,O.useState)(1),[R,z]=(0,O.useState)(768),[B,V]=(0,O.useState)(null),[H,U]=(0,O.useState)(!1),[W,G]=(0,O.useState)(null),[K,ke]=(0,O.useState)(!1),[J,Fe]=(0,O.useState)(!1),[Y,X]=(0,O.useState)(null),[Ie,Le]=(0,O.useState)([]),[Re,Z]=(0,O.useState)(),Q=(0,O.useRef)(null);(0,O.useEffect)(()=>{a.refresh();let e=i.getState().takeHandoff(`image`);e?.purpose===`init`&&(V({assetId:e.assetId,strength:.55}),w(`diffusion`))},[]);let ze=(0,O.useMemo)(()=>ve(A||`abstract`,M),[A,M]),Be=W??ze,Ve=v.filter(e=>e.kind===`image`),$=async(e,t,n,r)=>{let i=await se.getState().add(e,{kind:`image`,prompt:A,engine:t,width:n,height:r});return Le(e=>[i.id,...e].slice(0,8)),i},He=async()=>{if(!A.trim()||J)return;let e=new AbortController;Q.current=e,Fe(!0),X({done:0,total:I});let n=performance.now();try{if(C===`diffusion`){let t=B&&b.img2img?await Ae(await ne(B.assetId),512):void 0,n=0;await a.generate({prompt:A,seed:M,steps:F,frames:I,mode:`single`,init:t?{rgba:t,strength:B.strength}:void 0},e=>{n++,X({done:n,total:I}),Z(e.ms),Oe(e.rgba,e.width,e.height).then(t=>$(t,b.label,e.width,e.height))},e.signal)}else if(C===`cloud`){let t=T&&E.includes(T)?T:E[0];for(let n=0;n<I&&!e.signal.aborted;n++){let r=performance.now(),i=await o(A,{width:R,height:R,seed:M+n,model:t},e.signal);await $(i,`Pollinations${t?` ${t}`:``}`,R,R),X({done:n+1,total:I}),Z(performance.now()-r)}}else{let t=Be;K&&!W&&(t=await we(A,Be));for(let n=0;n<I&&!e.signal.aborted;n++){let e=await De({...t,seed:t.seed+n*7919},R,R);await $(e,`procedural`,R,R),X({done:n+1,total:I})}Z((performance.now()-n)/I)}P||N(x())}catch(e){t(e)||_e(e instanceof Error?e.message:String(e),`error`)}finally{Fe(!1),X(null),Q.current=null}},Ue=e=>{V({assetId:e.id,strength:.55}),w(`diffusion`),!b.img2img&&a.device(h(`sd-turbo`))&&(u.getState().set({imageModelId:`sd-turbo`}),a.select(`sd-turbo`))},We=p.status===`downloading`||p.status===`loading`||p.status===`generating`,Ge=!!A.trim()&&!J&&(C!==`diffusion`||!!S&&!We),Ke=C===`diffusion`&&(p.status===`absent`||p.status===`partial`);return(0,q.jsxs)(`div`,{className:`flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden`,children:[(0,q.jsxs)(`section`,{className:`space-y-4 border-ink-700 p-4 lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r`,children:[(0,q.jsx)(ce,{className:`w-full`,value:C,onChange:w,size:`sm`,options:[{value:`diffusion`,label:n(`image.engine.diffusion`)},{value:`cloud`,label:n(`image.engine.cloud`)},{value:`procedural`,label:n(`image.engine.procedural`)}]}),C===`diffusion`?(0,q.jsx)(fe,{disabled:J}):C===`cloud`?(0,q.jsx)(Ne,{models:E,model:T,onModel:e=>u.getState().set({cloudImageModel:e})}):(0,q.jsx)(`p`,{className:`text-xs text-ink-400`,children:n(`image.procedural.about`)}),(0,q.jsx)(_,{label:n(`image.prompt`),children:(0,q.jsx)(`textarea`,{className:`${s} min-h-24`,value:A,onChange:e=>j(e.target.value),onKeyDown:e=>{e.key===`Enter`&&(e.metaKey||e.ctrlKey)&&He()},placeholder:n(C===`procedural`?`image.prompt.placeholderProc`:`image.prompt.placeholder`)})}),(0,q.jsxs)(`div`,{className:`flex items-end gap-2`,children:[(0,q.jsx)(_,{label:n(`image.seed`),children:(0,q.jsx)(`input`,{className:`${s} font-mono`,type:`number`,value:M,onChange:e=>N(Math.abs(Math.floor(Number(e.target.value)))||0)})}),(0,q.jsx)(oe,{label:n(`image.randomSeed`),className:`mb-0.5 size-10 border border-ink-600`,onClick:()=>N(x()),children:(0,q.jsx)(xe,{className:`size-4`})}),(0,q.jsx)(oe,{label:n(P?`image.unlockSeed`:`image.lockSeed`),active:P,className:`mb-0.5 size-10 border border-ink-600`,onClick:()=>Te(!P),children:P?(0,q.jsx)(ee,{className:`size-4`}):(0,q.jsx)(Se,{className:`size-4`})})]}),(0,q.jsx)(y,{label:n(`image.count`),value:I,min:1,max:4,step:1,onChange:L}),C===`diffusion`?(0,q.jsxs)(q.Fragment,{children:[b.maxSteps>1&&(0,q.jsx)(y,{label:n(`image.steps`),value:Math.min(F,b.maxSteps),min:1,max:b.maxSteps,step:1,onChange:Ee,hint:n(`image.stepsHint`)}),b.img2img?B?(0,q.jsx)(pe,{assetId:B.assetId,onClear:()=>V(null),children:(0,q.jsx)(y,{label:n(`image.strength`),value:B.strength,min:.1,max:1,step:.05,onChange:e=>V({...B,strength:e}),format:e=>e.toFixed(2)})}):(0,q.jsx)(m,{variant:`outline`,size:`sm`,icon:(0,q.jsx)(he,{className:`size-3.5`}),onClick:()=>U(!0),children:n(`image.init`)}):(0,q.jsx)(`p`,{className:`text-xs text-ink-400`,children:n(`image.initNeeds`)})]}):(0,q.jsxs)(q.Fragment,{children:[(0,q.jsx)(_,{group:!0,label:n(`image.size`),children:(0,q.jsx)(ce,{value:String(R),onChange:e=>z(Number(e)),size:`sm`,options:[{value:`512`,label:`512`},{value:`768`,label:`768`},{value:`1024`,label:`1024`},{value:`1536`,label:`1536`}]})}),C===`procedural`&&(0,q.jsxs)(q.Fragment,{children:[(0,q.jsx)(Pe,{spec:Be,custom:W!==null,onChange:G,onReset:()=>G(null)}),(0,q.jsx)(le,{checked:K&&re.status===`ready`,onChange:ke,label:n(`proc.llm`),hint:k()?n(`proc.llmHint`):n(`proc.llmNoModel`)})]})]}),(0,q.jsxs)(`div`,{className:`flex gap-2`,children:[(0,q.jsx)(m,{variant:`primary`,className:`flex-1`,size:`lg`,disabled:!Ge,busy:J,icon:(0,q.jsx)(ye,{className:`size-4.5`}),onClick:()=>void He(),"data-testid":`image-generate`,children:Ke?n(`image.downloadGenerate`,{size:c(p.totalBytes)}):n(`image.generate`)}),J&&(0,q.jsx)(m,{variant:`danger`,size:`lg`,icon:(0,q.jsx)(Ce,{className:`size-4`}),onClick:()=>{Q.current?.abort(),a.cancel()},children:n(`common.stop`)})]}),Y&&p.status!==`downloading`&&p.status!==`loading`&&(0,q.jsx)(f,{value:Y.total?Y.done/Y.total:void 0,indeterminate:Y.done===0,tone:`pink`}),Re!==void 0&&!J&&(0,q.jsx)(`p`,{className:`font-mono text-[11px] text-ink-400`,children:n(`image.lastTime`,{time:l(Re/1e3)})})]}),(0,q.jsxs)(`section`,{className:`min-h-0 flex-1 p-4 lg:overflow-y-auto`,children:[Ve.length===0?(0,q.jsx)(te,{icon:(0,q.jsx)(ae,{className:`size-6`}),title:n(`image.empty.title`),children:n(`image.empty.body`)}):(0,q.jsx)(`div`,{className:`grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4`,children:Ve.map(e=>(0,q.jsx)(ge,{asset:e,highlight:Ie.includes(e.id),onUseAsInit:Ue},e.id))}),J&&C===`cloud`&&(0,q.jsxs)(g,{className:`mt-4 flex items-center gap-3 p-3 text-xs text-ink-300`,children:[(0,q.jsx)(de,{className:`size-4 animate-pulse text-neon-pink`}),n(`cloudImage.working`,{done:Y?.done??0,total:Y?.total??I})]}),J&&C===`diffusion`&&(0,q.jsxs)(g,{className:`mt-4 flex items-center gap-3 p-3 text-xs text-ink-300`,children:[(0,q.jsx)(de,{className:`size-4 animate-pulse text-neon-pink`}),p.status===`downloading`?n(`image.stageDownload`):p.status===`loading`?n(`image.stageLoad`):n(S===`wasm`?`image.workingCpu`:`image.working`,{done:Y?.done??0,total:Y?.total??I})]})]}),(0,q.jsx)(me,{open:H,onClose:()=>U(!1),onPick:Ue})]})}export{Pe as SceneEditor,k as a,xe as c,J as default,N as i,V as n,we as o,B as r,Ce as s,ke as t};