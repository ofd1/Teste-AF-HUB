// Motor WebGL para efeitos (funciona em Android e iPhone — Safari não suporta ctx.filter).
// Convenções: todas as texturas são alfa pré-multiplicado; uv (0,0) = canto superior esquerdo.

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
uniform float u_flip;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  vec2 p = a_pos;
  if (u_flip > 0.5) p.y = -p.y;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const PRELUDE = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_size;      // tamanho da saída em px
uniform vec2 u_texel;     // 1 / tamanho da entrada
uniform vec4 u_rect;      // retângulo do conteúdo (sem padding) em uv: x, y, w, h
uniform float u_time;
uniform float u_scale;
const float PI = 3.14159265;
vec4 unpre(vec4 c) { return c.a > 0.0001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 pre(vec4 c) { return vec4(c.rgb * c.a, c.a); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec4 samp(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture2D(u_tex, uv); }
vec2 contentUV(vec2 uv) { return (uv - u_rect.xy) / u_rect.zw; }      // 0..1 dentro do conteúdo
vec2 fromContent(vec2 c) { return u_rect.xy + c * u_rect.zw; }
`;

const COPY = `${PRELUDE}
uniform float u_alpha;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * u_alpha; }`;

const BLUR = `${PRELUDE}
uniform vec2 u_dir;     // direção em texels
uniform float u_sigma;  // em texels
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float step = max(1.0, u_sigma * 3.0 / 12.0);
  for (int i = -12; i <= 12; i++) {
    float x = float(i) * step;
    float w = exp(-(x * x) / (2.0 * u_sigma * u_sigma + 1e-5));
    acc += samp(v_uv + u_dir * u_texel * x) * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}`;

const ADD = `${PRELUDE}
uniform sampler2D u_tex2;
uniform float u_amount;
void main() { gl_FragColor = min(texture2D(u_tex, v_uv) + texture2D(u_tex2, v_uv) * u_amount, vec4(1.0)); }`;

const MIX = `${PRELUDE}
uniform sampler2D u_tex2;
uniform float u_amount;
void main() { gl_FragColor = mix(texture2D(u_tex, v_uv), texture2D(u_tex2, v_uv), u_amount); }`;

export class GLEngine {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 16;
    const opts = { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false };
    this.gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
    if (!this.gl) throw new Error('WebGL indisponível');
    const gl = this.gl;
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.programs = new Map();
    this.pool = [];
    this.live = [];
    const buf = gl.createBuffer();
    this.quad = buf;
    this.meshes = new Map();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.env = {};
  }

  program(frag) {
    let p = this.programs.get(frag);
    if (p) return p;
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Link: ${gl.getProgramInfoLog(prog)}`);
    p = { prog, locs: new Map() };
    this.programs.set(frag, p);
    return p;
  }

  loc(p, name) {
    if (!p.locs.has(name)) p.locs.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.locs.get(name);
  }

  acquire(w, h) {
    w = Math.max(1, Math.min(this.maxSize, Math.round(w)));
    h = Math.max(1, Math.min(this.maxSize, Math.round(h)));
    const i = this.pool.findIndex((t) => t.w === w && t.h === h);
    let t;
    if (i >= 0) t = this.pool.splice(i, 1)[0];
    else {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.texParams();
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      t = { tex, fbo, w, h };
    }
    this.live.push(t);
    return t;
  }

  texParams() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Libera todas as texturas usadas desde o último releaseAll (fim de cada camada). */
  releaseAll() {
    this.pool.push(...this.live);
    this.live = [];
    if (this.pool.length > 40) {
      const gl = this.gl;
      for (const t of this.pool.splice(0, this.pool.length - 40)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    }
  }

  upload(source, w = source.width, h = source.height) {
    const gl = this.gl;
    const t = this.acquire(w, h);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }

  /** Executa um fragment shader. inputs: { u_tex: target, u_tex2: target, u_x: number|array }. */
  pass(frag, inputs = {}, w, h, out) {
    const gl = this.gl;
    const src = inputs.u_tex;
    w = w ?? src.w; h = h ?? src.h;
    const target = out === 'screen' ? null : out || this.acquire(w, h);
    const p = this.program(frag);
    gl.useProgram(p.prog);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (this.canvas.width < w || this.canvas.height < h) {
        this.canvas.width = Math.max(this.canvas.width, Math.ceil(w));
        this.canvas.height = Math.max(this.canvas.height, Math.ceil(h));
      }
      gl.viewport(0, this.canvas.height - h, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    let unit = 0;
    const env = { u_size: [w, h], u_time: 0, u_scale: 1, u_rect: [0, 0, 1, 1], ...this.env, u_flip: target ? 0 : 1 };
    const all = { ...env, ...inputs };
    if (src) all.u_texel = [1 / src.w, 1 / src.h];
    for (const [name, v] of Object.entries(all)) {
      const l = this.loc(p, name);
      if (l === null) continue;
      if (v && v.tex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v.tex);
        gl.uniform1i(l, unit++);
      } else if (v && v.vec3) gl.uniform3fv(l, v.vec3); // vetor de vec3 (ex.: uniform vec3 u_hsl[8])
      else if (v && v.vec2) gl.uniform2fv(l, v.vec2);
      else if (v && v.f1) gl.uniform1fv(l, v.f1);
      else if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
      else if (Array.isArray(v)) {
        if (v.length === 2) gl.uniform2fv(l, v);
        else if (v.length === 3) gl.uniform3fv(l, v);
        else if (v.length === 4) gl.uniform4fv(l, v);
      }
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return target;
  }

  /**
   * Desenha geometria (triângulos) num alvo novo — usado por efeitos 3D como o Shatter.
   * build() → { data: Float32Array, attribs: [[nome, tamanho], …] } (intercalado); fica em cache por `key`.
   */
  mesh(key, build, vert, frag, uniforms, w, h) {
    const gl = this.gl;
    let m = this.meshes.get(key);
    if (!m) {
      const g = build();
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW);
      const stride = g.attribs.reduce((n, [, s]) => n + s, 0);
      m = { buf, attribs: g.attribs, stride, count: g.data.length / stride };
      if (this.meshes.size > 6) { const [k0, old] = this.meshes.entries().next().value; gl.deleteBuffer(old.buf); this.meshes.delete(k0); }
      this.meshes.set(key, m);
    }
    const pkey = vert + frag;
    let p = this.programs.get(pkey);
    if (!p) {
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
      m.attribs.forEach(([name], i) => gl.bindAttribLocation(prog, i, name));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Link: ${gl.getProgramInfoLog(prog)}`);
      p = { prog, locs: new Map() };
      this.programs.set(pkey, p);
    }
    const target = this.acquire(w, h);
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let unit = 0;
    for (const [name, v] of Object.entries({ ...this.env, ...uniforms })) {
      const l = this.loc(p, name);
      if (l === null) continue;
      if (v && v.tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex); gl.uniform1i(l, unit++); }
      else if (v && v.f1) gl.uniform1fv(l, v.f1);
      else if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
      else if (Array.isArray(v)) [null, null, gl.uniform2fv, gl.uniform3fv, gl.uniform4fv][v.length]?.call(gl, l, v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    let off = 0;
    m.attribs.forEach(([, size], i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, size, gl.FLOAT, false, m.stride * 4, off * 4);
      off += size;
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    gl.disable(gl.BLEND);
    for (let i = 1; i < m.attribs.length; i++) gl.disableVertexAttribArray(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    return target;
  }

  copy(src, w, h, alpha = 1) { return this.pass(COPY, { u_tex: src, u_alpha: alpha }, w, h); }

  /** Desfoque gaussiano separável (sigma em px). dims: 1 ambos, 2 horizontal, 3 vertical. */
  blur(src, sigma, dims = 1) {
    if (sigma < 0.3) return src;
    // reduz em etapas de 2× (filtro passa-baixa correto), desfoca na escala reduzida e amplia em etapas
    let f = 1;
    while (sigma / f > 8 && f < 16) f *= 2;
    const chain = [src];
    let t = src;
    for (let k = 2; k <= f; k *= 2) {
      t = this.copy(t, Math.max(1, Math.round(src.w / k)), Math.max(1, Math.round(src.h / k)));
      chain.push(t);
    }
    const s = sigma / f;
    if (dims !== 3) t = this.pass(BLUR, { u_tex: t, u_dir: [1, 0], u_sigma: s });
    if (dims !== 2) t = this.pass(BLUR, { u_tex: t, u_dir: [0, 1], u_sigma: s });
    for (let i = chain.length - 2; i >= 0; i--) {
      t = this.copy(t, chain[i].w, chain[i].h);
      if (i > 0) {
        // suaviza as etapas intermediárias (a última ampliação 2× bilinear já fica suave)
        if (dims !== 3) t = this.pass(BLUR, { u_tex: t, u_dir: [1, 0], u_sigma: 1.2 });
        if (dims !== 2) t = this.pass(BLUR, { u_tex: t, u_dir: [0, 1], u_sigma: 1.2 });
      }
    }
    return t;
  }

  add(a, b, amount = 1) { return this.pass(ADD, { u_tex: a, u_tex2: b, u_amount: amount }); }
  mix(a, b, amount) { return this.pass(MIX, { u_tex: a, u_tex2: b, u_amount: amount }); }

  /** Desenha a textura no canvas WebGL e devolve [canvas, w, h] para drawImage imediato. */
  toCanvas(t) {
    this.pass(COPY, { u_tex: t, u_alpha: 1 }, t.w, t.h, 'screen');
    return this.canvas;
  }
}

let engine = null;
let failed = false;
export function getGL() {
  if (engine || failed) return engine;
  try { engine = new GLEngine(); } catch (e) { failed = true; console.warn('WebGL indisponível — efeitos desativados', e); }
  return engine;
}
