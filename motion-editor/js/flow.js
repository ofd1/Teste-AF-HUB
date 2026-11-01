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

/**
 * Gera o quadro intermediário entre A e B (texturas do GLEngine) na fração f (0..1).
 * quality: 'preview' (fluxo em 1/8) ou 'final' (fluxo em 1/4).
 */
export function flowInterpolate(gl, texA, texB, f, quality = 'final') {
  if (f <= 0.001) return texA;
  if (f >= 0.999) return texB;
  const base = quality === 'final' ? 4 : 8;
  const levels = [32, 16, 8, 4].filter((s) => s >= base);
  const radii = { 32: 4, 16: 2, 8: 1, 4: 1 };
  const W = texA.w, H = texA.h;
  // pirâmide de luminância (reduções 2× sucessivas)
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
  return gl.pass(INTERP, { u_tex: texA, u_b: texB, u_flow: flow, u_f: f, u_ftexel: [1 / flow.w, 1 / flow.h] }, W, H);
}
