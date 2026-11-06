// Interpolação de quadros por fluxo óptico (como o "Motion Weighted Blend" do Twixtor).
// Estima o movimento entre os quadros A e B por busca de blocos em pirâmide (grosso → fino),
// com refinamento sub-pixel, e gera o quadro intermediário deformando A e B ao longo do movimento.
import { PRELUDE } from './gl.js';

const FLOW_GLSL = `
vec2 decodeFlow(vec4 c) {
  vec2 hi = vec2(c.r, c.b) * 255.0, lo = vec2(c.g, c.a) * 255.0;
  return (hi * 256.0 + lo) / 65535.0 * 256.0 - 128.0;
}
vec4 encodeFlow(vec2 f) {
  vec2 v = floor(clamp((f + 128.0) / 256.0, 0.0, 1.0) * 65535.0 + 0.5);
  vec2 hi = floor(v / 256.0), lo = v - hi * 256.0;
  return vec4(hi.x / 255.0, lo.x / 255.0, hi.y / 255.0, lo.y / 255.0);
}`;

const DOWN = `${PRELUDE}
void main() {
  // média 2×2 para reduzir sem serrilhado
  vec2 o = u_texel * 0.5;
  vec4 c = (texture2D(u_tex, v_uv + vec2(-o.x, -o.y)) + texture2D(u_tex, v_uv + vec2(o.x, -o.y)) + texture2D(u_tex, v_uv + vec2(-o.x, o.y)) + texture2D(u_tex, v_uv + vec2(o.x, o.y))) * 0.25;
  gl_FragColor = vec4(c.rgb, 1.0); // mantém a cor (casamento de blocos por RGB é mais robusto)
}`;

const SEARCH = `${PRELUDE}${FLOW_GLSL}
uniform sampler2D u_b; uniform sampler2D u_prev; uniform float u_hasPrev; uniform float u_R;
float cost(vec2 uv, vec2 d) {
  float s = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j)) * u_texel;
    vec3 e = abs(texture2D(u_tex, uv + o).rgb - texture2D(u_b, uv + o + d * u_texel).rgb);
    s += e.r + e.g + e.b;
  }
  return s;
}
void main() {
  vec2 init = u_hasPrev > 0.5 ? decodeFlow(texture2D(u_prev, v_uv)) * 2.0 : vec2(0.0);
  vec2 best = init; float bc = 1e9;
  for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
    if (abs(float(i)) > u_R || abs(float(j)) > u_R) continue;
    vec2 d = init + vec2(float(i), float(j));
    float c = cost(v_uv, d) + 0.08 * length(vec2(float(i), float(j))); // regularização: prefere o movimento vizinho em áreas lisas
    if (c < bc) { bc = c; best = d; }
  }
  // candidato "parado" (corrige objetos pequenos arrastados pelo movimento do nível grosso)
  if (u_hasPrev > 0.5) {
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 d = vec2(float(i), float(j));
      float c = cost(v_uv, d) + 0.08 * length(d);
      if (c < bc) { bc = c; best = d; }
    }
  }
  // refinamento sub-pixel (parábola)
  float cx0 = cost(v_uv, best - vec2(1.0, 0.0)), cx1 = cost(v_uv, best + vec2(1.0, 0.0));
  float cy0 = cost(v_uv, best - vec2(0.0, 1.0)), cy1 = cost(v_uv, best + vec2(0.0, 1.0));
  float dx = clamp((cx0 - cx1) / (2.0 * (cx0 + cx1 - 2.0 * bc) + 1e-4), -0.5, 0.5);
  float dy = clamp((cy0 - cy1) / (2.0 * (cy0 + cy1 - 2.0 * bc) + 1e-4), -0.5, 0.5);
  gl_FragColor = encodeFlow(best + vec2(dx, dy));
}`;

// suavização do campo de movimento guiada pela imagem (bilateral): não mistura movimento entre objetos diferentes
const SMOOTH = `${PRELUDE}${FLOW_GLSL}
uniform sampler2D u_img;
void main() {
  vec3 ci = texture2D(u_img, v_uv).rgb;
  vec2 acc = vec2(0.0); float ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 uv = v_uv + vec2(float(i), float(j)) * u_texel;
    vec2 f = decodeFlow(texture2D(u_tex, uv));
    vec3 dc = texture2D(u_img, uv).rgb - ci;
    float w = exp(-dot(dc, dc) * 40.0) * exp(-float(i * i + j * j) * 0.2);
    acc += f * w; ws += w;
  }
  gl_FragColor = encodeFlow(acc / ws);
}`;

// interpolação bidirecional (A→B e B→A) com verificação de consistência: onde o movimento não é confiável
// (oclusão, borrão), mistura os quadros sem deformar — evita "rasgos" e tremidas quadro a quadro
const INTERP2 = `${PRELUDE}${FLOW_GLSL}
uniform sampler2D u_b; uniform sampler2D u_fab; uniform sampler2D u_fba; uniform float u_f; uniform vec2 u_ftexel; uniform vec2 u_fsize;
vec2 fab(vec2 uv) { return decodeFlow(texture2D(u_fab, uv)) * u_ftexel; }
vec2 fba(vec2 uv) { return decodeFlow(texture2D(u_fba, uv)) * u_ftexel; }
void main() {
  float f = u_f;
  // ponto de origem em A (2 iterações de ponto fixo) e em B
  vec2 da = fab(v_uv); da = fab(v_uv - da * f); da = fab(v_uv - da * f);
  vec2 db = fba(v_uv); db = fba(v_uv - db * (1.0 - f)); db = fba(v_uv - db * (1.0 - f));
  vec2 pa = v_uv - da * f, pb = v_uv - db * (1.0 - f);
  vec4 ca = texture2D(u_tex, pa), cb = texture2D(u_b, pb);
  // consistência ida-e-volta, em pixels do fluxo
  float ea = length((fab(pa) + fba(pa + fab(pa))) * u_fsize);
  float eb = length((fba(pb) + fab(pb + fba(pb))) * u_fsize);
  float wa = (1.0 - f) / (1.0 + ea * ea * 0.5), wb = f / (1.0 + eb * eb * 0.5);
  vec4 warped = (ca * wa + cb * wb) / max(wa + wb, 1e-4);
  // quando nenhum lado é confiável, cai para a mistura simples (como o frame blend do Twixtor)
  float trust = clamp(1.0 - min(ea, eb) / 3.0, 0.0, 1.0);
  vec4 blend = mix(texture2D(u_tex, v_uv), texture2D(u_b, v_uv), f);
  gl_FragColor = mix(blend, warped, trust);
}`;

const INTERP = `${PRELUDE}${FLOW_GLSL}
uniform sampler2D u_b; uniform sampler2D u_flow; uniform float u_f; uniform vec2 u_ftexel;
void main() {
  // fluxo A→B em uv; um passo de ponto fixo para amostrar o fluxo na origem do pixel
  vec2 f0 = decodeFlow(texture2D(u_flow, v_uv)) * u_ftexel;
  vec2 fa = decodeFlow(texture2D(u_flow, v_uv - f0 * u_f)) * u_ftexel;
  vec2 fb = decodeFlow(texture2D(u_flow, v_uv + f0 * (1.0 - u_f))) * u_ftexel;
  vec4 ca = texture2D(u_tex, v_uv - fa * u_f);
  vec4 cb = texture2D(u_b, v_uv + fb * (1.0 - u_f));
  // oclusões: quando A e B discordam, usa o quadro mais próximo no tempo
  float d = length(ca.rgb - cb.rgb) + abs(ca.a - cb.a);
  float w = mix(u_f, step(0.5, u_f), smoothstep(0.12, 0.35, d));
  gl_FragColor = mix(ca, cb, w);
}`;

const VBLUR = `${PRELUDE}${FLOW_GLSL}
uniform sampler2D u_flow; uniform vec2 u_ftexel; uniform float u_len, u_n;
void main() {
  vec2 f = decodeFlow(texture2D(u_flow, v_uv)) * u_ftexel * u_len;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= u_n) break;
    float k = u_n > 1.0 ? float(i) / (u_n - 1.0) - 0.5 : 0.0;
    acc += texture2D(u_tex, v_uv + f * k);
  }
  gl_FragColor = acc / u_n;
}`;

/** Campo de fluxo óptico A→B (texturas do GLEngine). quality: 'preview' (1/8) ou 'final' (1/4). */
export function computeFlow(gl, texA, texB, quality = 'final') {
  const base = quality === 'final' ? 2 : 8;
  const levels = [32, 16, 8, 4, 2].filter((s) => s >= base);
  const radii = { 32: 4, 16: 2, 8: 1, 4: 1, 2: 1 };
  const W = texA.w, H = texA.h;
  const pyrA = {}, pyrB = {};
  let la = texA, lb = texB;
  for (let s = 2; s <= 32; s *= 2) {
    const w = Math.max(4, Math.round(W / s)), h = Math.max(4, Math.round(H / s));
    la = gl.pass(DOWN, { u_tex: la }, w, h);
    lb = gl.pass(DOWN, { u_tex: lb }, w, h);
    pyrA[s] = la; pyrB[s] = lb;
  }
  let flow = null;
  for (const s of levels) {
    flow = gl.pass(SEARCH, { u_tex: pyrA[s], u_b: pyrB[s], u_prev: flow || pyrA[s], u_hasPrev: flow ? 1 : 0, u_R: radii[s] }, pyrA[s].w, pyrA[s].h);
  }
  const guide = pyrA[base];
  flow = gl.pass(SMOOTH, { u_tex: flow, u_img: guide });
  flow = gl.pass(SMOOTH, { u_tex: flow, u_img: guide });
  return flow;
}

/** Quadro intermediário a partir de um fluxo já calculado. */
export function interpWithFlow(gl, texA, texB, flow, f) {
  if (f <= 0.001) return texA;
  if (f >= 0.999) return texB;
  return gl.pass(INTERP, { u_tex: texA, u_b: texB, u_flow: flow, u_f: f, u_ftexel: [1 / flow.w, 1 / flow.h] }, texA.w, texA.h);
}

/** Motion blur por vetores (estilo RSMB / Twixtor Pro): borra ao longo do movimento. len = fração do fluxo entre quadros. */
export function flowMotionBlur(gl, tex, flow, len) {
  if (len < 0.05) return tex;
  const n = Math.min(24, Math.max(4, Math.ceil(len * 10)));
  return gl.pass(VBLUR, { u_tex: tex, u_flow: flow, u_ftexel: [1 / flow.w, 1 / flow.h], u_len: len, u_n: n });
}

/**
 * Gera o quadro intermediário entre A e B (texturas do GLEngine) na fração f (0..1).
 * quality: 'preview' (fluxo em 1/8) ou 'final' (fluxo em 1/4).
 */
export function flowInterpolate(gl, texA, texB, f, quality = 'final') {
  if (f <= 0.001) return texA;
  if (f >= 0.999) return texB;
  if (quality !== 'final') return interpWithFlow(gl, texA, texB, computeFlow(gl, texA, texB, quality), f);
  return interpBidirectional(gl, texA, texB, computeFlow(gl, texA, texB, quality), computeFlow(gl, texB, texA, quality), f);
}

/** Quadro intermediário com fluxos A→B e B→A (qualidade de exportação). */
export function interpBidirectional(gl, texA, texB, fab, fba, f) {
  if (f <= 0.001) return texA;
  if (f >= 0.999) return texB;
  return gl.pass(INTERP2, { u_tex: texA, u_b: texB, u_fab: fab, u_fba: fba, u_f: f, u_ftexel: [1 / fab.w, 1 / fab.h], u_fsize: [fab.w, fab.h] }, texA.w, texA.h);
}
