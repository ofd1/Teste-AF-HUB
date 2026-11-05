// Recriação no estilo Topaz Video AI (algoritmos clássicos na GPU, não as redes neurais da Topaz):
// - "Enhance" com o layout do plugin do After Effects (Topaz Video AI.aex): AI Model, Input Quality, Output Resolution,
//   Parameters (Auto / Relative to auto / Manual), Fix Compression, Improve Detail, Sharpen, Reduce Noise,
//   Reduce Large Grain (Nyx), Dehalo, Anti-Alias/Deblur, Recover Original Details, Add Noise, Grain (Amount/Size).
// - "Estabilizar" (correção de câmera calculada pela análise do vídeo, modo Auto-crop ou Full frame).
import { frag, num, sel, bool, rad, cuv } from './common.js';
import IRIS_NET from './iris-weights.js';
import { runNet } from './irisnet.js';

// Dione: desentrelaça (média com as linhas vizinhas onde as duas metades do quadro não batem — "pente")
const DEINT = frag(`
uniform float u_amt;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec4 up = texture2D(u_tex, v_uv - vec2(0.0, u_texel.y)), dn = texture2D(u_tex, v_uv + vec2(0.0, u_texel.y));
  vec4 avg = (up + dn) * 0.5;
  float comb = length((c.rgb - up.rgb) * (c.rgb - dn.rgb)); // positivo forte = linha destoa das duas vizinhas
  float k = smoothstep(0.002, 0.02, comb) * u_amt;
  gl_FragColor = mix(c, avg, k);
}`);

// redução de ruído / compressão: bilateral (preserva bordas) — o raio acompanha o tamanho do pixel original do vídeo
const BILAT = frag(`
uniform float u_rad, u_sigR, u_amt, u_flat;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 s = texture2D(u_tex, v_uv + o * u_texel * u_rad / 3.0).rgb;
    vec3 d = s - c.rgb;
    float w = exp(-dot(o, o) / 9.0) * exp(-dot(d, d) / (u_sigR * u_sigR + 1e-5));
    acc += s * w; ws += w;
  }
  vec3 sm = acc / ws;
  // "revert compression" atua mais nas áreas lisas (onde aparecem blocos e banding)
  float detail = length(c.rgb - sm) * 6.0;
  float k = u_amt * mix(1.0, 1.0 - smoothstep(0.05, 0.6, detail), u_flat);
  gl_FragColor = vec4(mix(c.rgb, sm, k), c.a);
}`);

// "IA desenhado" (como os upscalers neurais): filtro Kuwahara de 4 setores — cada pixel vira a média do setor
// mais uniforme ao redor. Some com os pixels quadrados e o ruído, deixa áreas lisas "pintadas" e mantém as bordas.
const KUWAHARA = frag(`
uniform float u_r, u_amt;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 m[4]; vec3 s2[4]; float ws[4];
  for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s2[k] = vec3(0.0); ws[k] = 0.0; }
  vec2 st = u_texel * u_r / 3.0;
  for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j));
    float g = exp(-dot(o, o) / 8.0);          // amostras gaussianas (sem bordas duras de bloco)
    o *= st;
    vec3 a = texture2D(u_tex, v_uv + vec2(-o.x, -o.y)).rgb; m[0] += a * g; s2[0] += a * a * g; ws[0] += g;
    vec3 b = texture2D(u_tex, v_uv + vec2( o.x, -o.y)).rgb; m[1] += b * g; s2[1] += b * b * g; ws[1] += g;
    vec3 d = texture2D(u_tex, v_uv + vec2(-o.x,  o.y)).rgb; m[2] += d * g; s2[2] += d * d * g; ws[2] += g;
    vec3 e = texture2D(u_tex, v_uv + vec2( o.x,  o.y)).rgb; m[3] += e * g; s2[3] += e * e * g; ws[3] += g;
  }
  // Kuwahara generalizado: mistura os setores pesando pela uniformidade (1/variância^q) — liso e sem blocos
  vec3 acc = vec3(0.0); float wt = 0.0;
  for (int k = 0; k < 4; k++) {
    vec3 mu = m[k] / ws[k]; vec3 v = max(s2[k] / ws[k] - mu * mu, 0.0);
    float w = 1.0 / (1.0 + pow((v.r + v.g + v.b) * 255.0, 2.0));
    acc += mu * w; wt += w;
  }
  gl_FragColor = vec4(mix(c.rgb, acc / wt, u_amt), c.a);
}`);

const GRAIN = frag(`
uniform float u_amt, u_gsize, u_seed; uniform sampler2D u_orig; uniform float u_orig_mix;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec2 p = floor(v_uv / (u_texel * max(u_gsize, 1.0)));
  float g = (hash(p + u_seed) + hash(p * 1.37 + u_seed * 0.71) - 1.0);
  float l = luma(c.rgb);
  vec3 o = c.rgb + g * u_amt * (0.35 + 0.65 * (1.0 - abs(l - 0.5) * 2.0)) * c.a;
  o = mix(o, texture2D(u_orig, v_uv).rgb, u_orig_mix);
  gl_FragColor = vec4(clamp(o, 0.0, c.a), c.a);
}`);

// estabilização: desloca/gira/aproxima a imagem; Full frame espelha as bordas, Auto-crop aproxima
const STAB = frag(`
uniform vec2 u_c, u_sh; uniform float u_r, u_s, u_full;
void main() {
  vec2 px = (v_uv - u_c) * u_size - u_sh * u_rect.zw * u_size;
  px = mat2(cos(u_r), -sin(u_r), sin(u_r), cos(u_r)) * px / u_s;
  vec2 cu = contentUV(u_c + px / u_size);
  if (u_full > 0.5) { vec2 m = mod(cu, 2.0); cu = vec2(m.x > 1.0 ? 2.0 - m.x : m.x, m.y > 1.0 ? 2.0 - m.y : m.y); }
  else if (cu.x < 0.0 || cu.y < 0.0 || cu.x > 1.0 || cu.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec2 e = u_texel / u_rect.zw * 0.75;
  gl_FragColor = texture2D(u_tex, fromContent(clamp(cu, e, 1.0 - e)));
}`);

// Upscale com reconstrução direcional (estilo EASU/Lanczos adaptativo às bordas): amostra a imagem na resolução
// ORIGINAL do vídeo e reconstrói em N× com o núcleo esticado ao longo das bordas (sem serrilhado nem borrão),
// com anti-ringing (limita aos vizinhos mais próximos).
const UPSCALE = frag(`
uniform vec2 u_nat; uniform float u_edge;
float lz(float x) { x = abs(x); if (x < 1e-4) return 1.0; if (x >= 2.0) return 0.0; float px = 3.14159265 * x; return 2.0 * sin(px) * sin(px * 0.5) / (px * px); }
void main() {
  vec2 pos = v_uv * u_nat - 0.5;
  vec2 b = floor(pos), f = pos - b;
  vec2 it = 1.0 / u_nat;
  // gradiente (estrutura da borda) no ponto, a partir de 4×4 vizinhos
  float l[16];
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) l[j * 4 + i] = luma(texture2D(u_tex, (b + vec2(float(i) - 0.5, float(j) - 0.5)) * it).rgb);
  float gx = (l[6] + l[10] - l[5] - l[9]) * 0.5 + (l[7] + l[11] - l[4] - l[8]) * 0.25;
  float gy = (l[9] + l[10] - l[5] - l[6]) * 0.5 + (l[13] + l[14] - l[1] - l[2]) * 0.25;
  vec2 g = vec2(gx, gy);
  float gl2 = length(g);
  vec2 dir = gl2 > 1e-5 ? g / gl2 : vec2(1.0, 0.0);
  float str = clamp(gl2 * 6.0, 0.0, 1.0) * u_edge;
  vec3 acc = vec3(0.0); float ws = 0.0; float aa = 0.0;
  vec3 mn = vec3(1e3), mx = vec3(-1e3);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i) - 1.0, float(j) - 1.0);
    vec2 d = o - f;
    // eixo across = direção do gradiente (mantém nitidez); along = ao longo da borda (núcleo mais longo, suaviza o serrilhado)
    vec2 r = vec2(dot(d, dir), dot(d, vec2(-dir.y, dir.x)) * (1.0 - 0.5 * str));
    float w = lz(r.x) * lz(r.y);
    vec4 c = texture2D(u_tex, (b + o + 0.5) * it);
    acc += c.rgb * w; aa += c.a * w; ws += w;
    if (o.x > -0.5 && o.x < 1.5 && o.y > -0.5 && o.y < 1.5) { mn = min(mn, c.rgb); mx = max(mx, c.rgb); }
  }
  vec3 o = acc / max(ws, 1e-4);
  o = clamp(o, mn, mx);
  gl_FragColor = vec4(o, clamp(aa / max(ws, 1e-4), 0.0, 1.0));
}`);

// ---- Proteus do Topaz 7 (calibrado com um print real: Fix compression 100, Improve detail 100, Sharpen 20…) ----
// 1) Fix compression: guided filter (alisa blocos e manchas sem criar "manchas pintadas" como o bilateral)
const SQ = frag(`void main() { vec4 c = texture2D(u_tex, v_uv); gl_FragColor = vec4(c.rgb * c.rgb, c.a); }`);
const GUIDE_A = frag(`
uniform sampler2D u_m2; uniform float u_eps, u_wantB;
void main() {
  vec3 m = texture2D(u_tex, v_uv).rgb, m2 = texture2D(u_m2, v_uv).rgb;
  vec3 v = max(m2 - m * m, 0.0), A = v / (v + u_eps);
  gl_FragColor = vec4(u_wantB > 0.5 ? m - A * m : A, 1.0);
}`);
const GUIDE_OUT = frag(`
uniform sampler2D u_a, u_b; uniform float u_amt;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 o = texture2D(u_a, v_uv).rgb * c.rgb + texture2D(u_b, v_uv).rgb;
  gl_FragColor = vec4(mix(c.rgb, clamp(o, 0.0, c.a), u_amt), c.a);
}`);
// 2) Improve detail / Sharpen / Dehalo: ganho por faixa de frequência (medido no Topaz: fino ×5, médio ×1,9, grosso ×1,2),
//    preso aos vizinhos ± halo (borda nítida sem auréola); 3) textura fina só onde já há textura (cabelo, barba, grama)
const BANDS = frag(`
uniform sampler2D u_b1, u_b2, u_b3; uniform vec3 u_g; uniform float u_halo, u_tex2, u_seed, u_px;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 b1 = texture2D(u_b1, v_uv).rgb, b2 = texture2D(u_b2, v_uv).rgb, b3 = texture2D(u_b3, v_uv).rgb;
  vec3 o = b3 + (b2 - b3) * u_g.x + (b1 - b2) * u_g.y + (c.rgb - b1) * u_g.z;
  vec3 mn = c.rgb, mx = c.rgb;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec3 q = texture2D(u_tex, v_uv + vec2(float(i), float(j)) * u_texel).rgb; mn = min(mn, q); mx = max(mx, q); }
  o = clamp(o, mn - u_halo, mx + u_halo);
  if (u_tex2 > 0.0) {
    float e = abs(luma(b1 - b3));
    float w = clamp((e - 0.012) / 0.03, 0.0, 1.0);
    vec2 pp = floor(v_uv / u_texel / max(1.0, u_px * 0.6));
    float n = (hash(pp + u_seed) + hash(pp * 1.31 + 7.0 + u_seed) - 1.0) * 1.7;
    o += n * w * u_tex2 * (0.4 + luma(o));
  }
  gl_FragColor = vec4(clamp(o, 0.0, c.a), c.a);
}`);

// Suavização ao longo das bordas (contorno liso, sem serrilhado nem pontinhos): tensor de estrutura → direção da borda
const TENSOR = frag(`
void main() {
  vec2 t = u_texel;
  float tl = luma(texture2D(u_tex, v_uv - t).rgb), br = luma(texture2D(u_tex, v_uv + t).rgb);
  float tr = luma(texture2D(u_tex, v_uv + vec2(t.x, -t.y)).rgb), bl = luma(texture2D(u_tex, v_uv + vec2(-t.x, t.y)).rgb);
  float l = luma(texture2D(u_tex, v_uv - vec2(t.x, 0.0)).rgb), r = luma(texture2D(u_tex, v_uv + vec2(t.x, 0.0)).rgb);
  float u = luma(texture2D(u_tex, v_uv - vec2(0.0, t.y)).rgb), b = luma(texture2D(u_tex, v_uv + vec2(0.0, t.y)).rgb);
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl), gy = (bl + 2.0 * b + br) - (tl + 2.0 * u + tr);
  gl_FragColor = vec4(gx * gx / 16.0, gy * gy / 16.0, gx * gy / 32.0 + 0.5, 1.0);
}`);
const ESMOOTH = frag(`
uniform sampler2D u_j; uniform float u_amt, u_len;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 J = texture2D(u_j, v_uv).rgb;
  float j11 = J.r * 16.0, j22 = J.g * 16.0, j12 = (J.b - 0.5) * 32.0;
  float ang = 0.5 * atan(2.0 * j12, j11 - j22 + 1e-9);
  vec2 tg = vec2(-sin(ang), cos(ang));
  float coh = sqrt((j11 - j22) * (j11 - j22) + 4.0 * j12 * j12) / (j11 + j22 + 1e-6);
  float w = clamp(coh, 0.0, 1.0) * clamp(sqrt(j11 + j22) / 0.15, 0.0, 1.0) * u_amt;
  vec4 acc = c; float ws = 1.0;
  for (int k = -2; k <= 2; k++) {
    if (k == 0) continue;
    float fk = float(k), wk = exp(-fk * fk / 4.0);
    acc += texture2D(u_tex, v_uv + tg * fk * u_len * 0.5 * u_texel) * wk; ws += wk;
  }
  gl_FragColor = mix(c, acc / ws, clamp(w, 0.0, 1.0));
}`);

/** Valores "automáticos" de cada modelo (como os presets da Topaz). Proteus = manual. */
// ---------------------------------------------------------------- modelos (iguais ao plugin "Topaz Video AI › Enhance" do AE)
// Os 7 primeiros estão na mesma ordem do popup "AI Model" do plugin (Select Model|Proteus|Iris|Nyx|Artemis|Themis|
// Dione Robust|Dione Robust Dehalo) — assim o índice de um .ffx/.aep casa direto. Os outros são variantes do app.
// Valores em 0–100 na escala da interface (o plugin guarda 0–1; Anti-Alias/Deblur −100…100).
export const TZ_MODELS = [
  { name: 'Proteus', code: 'prob-4', sliders: 'all' },
  { name: 'Iris', code: 'iris-3', sliders: 'all', face: true },
  { name: 'Nyx', code: 'nyx-3', sliders: 'nyx' },
  { name: 'Artemis', code: 'amq-13', sliders: 'artemis', byQuality: true },
  { name: 'Themis (motion deblur)', code: 'thm-2', sliders: 'none', motionDeblur: 1 },
  { name: 'Dione Robust', code: 'dtd-4', sliders: 'dione', deint: 1 },
  { name: 'Dione Robust Dehalo', code: 'dtds-2', sliders: 'dione', deint: 1, dehalo: 70 },
  { name: 'Artemis - Halo', code: 'amqs-2', sliders: 'artemis', byQuality: true, dehalo: 85 },
  { name: 'Artemis - Aliasing or Moire', code: 'aaa-10', sliders: 'artemis', aliasing: true },
  { name: 'Nyx - Fast', code: 'nxf-1', sliders: 'nyx', fast: true },
  { name: 'Dione DV', code: 'ddv-3', sliders: 'dione', deint: 1 },
  { name: 'Dione TV', code: 'dtv-4', sliders: 'dione', deint: 1, tv: true },
  { name: 'Dione Dehalo', code: 'dtvs-2', sliders: 'dione', deint: 1, dehalo: 70 },
  { name: 'Gaia (fonte boa, app)', code: 'ghq-5', sliders: 'artemis' },
  { name: 'Rhea (detalhe máximo, app)', code: 'rhea-1', sliders: 'all', upscale: 3 },
];
// valores "Auto" de cada modelo (o que o estimador da Topaz costuma dar para clipes de rede social) — LQ / MQ / HQ
const Q3 = (lq, mq, hq) => [lq, mq, hq];
const AUTO = {
  Proteus: Q3({ c: 70, d: 30, s: 25, n: 45, h: 30, a: 15 }, { c: 52, d: 30, s: 22, n: 30, h: 25, a: 10 }, { c: 25, d: 35, s: 20, n: 12, h: 20, a: 5 }),
  // Iris calibrado com um print real do Topaz 7 (Fix compression 100, Improve detail 100, Sharpen 20, Reduce noise 10, Dehalo 6, AA −40)
  Iris: Q3({ c: 100, d: 100, s: 20, n: 20, h: 6, a: -40 }, { c: 100, d: 100, s: 20, n: 10, h: 6, a: -40 }, { c: 60, d: 70, s: 20, n: 5, h: 6, a: -20 }),
  Nyx: Q3({ c: 40, d: 40, s: 10, n: 85, h: 20, a: 5 }, { c: 30, d: 25, s: 10, n: 70, h: 20, a: 5 }, { c: 15, d: 15, s: 8, n: 50, h: 15, a: 0 }),
  Artemis: Q3({ c: 85, d: 35, s: 30, n: 60, h: 40, a: 30 }, { c: 60, d: 45, s: 40, n: 40, h: 35, a: 35 }, { c: 25, d: 55, s: 45, n: 15, h: 30, a: 30 }),
  Themis: Q3({ c: 30, d: 40, s: 50, n: 20, h: 25, a: 90 }, { c: 20, d: 40, s: 50, n: 15, h: 25, a: 90 }, { c: 10, d: 40, s: 45, n: 8, h: 20, a: 85 }),
  Dione: Q3({ c: 50, d: 25, s: 20, n: 60, h: 25, a: 10 }, { c: 35, d: 25, s: 20, n: 45, h: 25, a: 10 }, { c: 20, d: 25, s: 18, n: 30, h: 20, a: 5 }),
  Aliasing: Q3({ c: 45, d: 30, s: 20, n: 35, h: 25, a: -70 }, { c: 40, d: 30, s: 20, n: 30, h: 25, a: -60 }, { c: 25, d: 30, s: 18, n: 20, h: 20, a: -50 }),
  Gaia: Q3({ c: 40, d: 60, s: 40, n: 25, h: 40, a: 35 }, { c: 25, d: 60, s: 40, n: 15, h: 40, a: 35 }, { c: 15, d: 60, s: 40, n: 8, h: 40, a: 35 }),
  Rhea: Q3({ c: 65, d: 80, s: 55, n: 40, h: 55, a: 55 }, { c: 50, d: 80, s: 55, n: 30, h: 55, a: 55 }, { c: 30, d: 80, s: 55, n: 15, h: 55, a: 55 }),
};
function autoFor(m, q) {
  const fam = m.name.startsWith('Iris') ? 'Iris' : m.name.startsWith('Nyx') ? 'Nyx' : m.aliasing ? 'Aliasing' : m.name.startsWith('Artemis') ? 'Artemis'
    : m.name.startsWith('Themis') ? 'Themis' : m.name.startsWith('Dione') ? 'Dione' : m.name.startsWith('Gaia') ? 'Gaia' : m.name.startsWith('Rhea') ? 'Rhea' : 'Proteus';
  const v = { ...AUTO[fam][Math.max(0, Math.min(2, q - 1))] };
  if (m.dehalo) v.h = m.dehalo;
  if (m.tv) { v.n += 10; v.c += 10; }
  if (m.fast) v.n -= 10;
  return v;
}
// modelos antigos do MotionFrame (antes do layout do plugin): Proteus, Artemis, Iris, Gaia, Nyx, Rhea
const LEGACY = [1, 4, 2, 14, 3, 15];
const SL = [['c', 'compression'], ['d', 'details'], ['s', 'sharpen'], ['n', 'noise'], ['h', 'dehalo'], ['a', 'aa']];

/** Valores finais (0–100 / AA −100…100) que o modelo usa, como o plugin: Auto, Relative to auto (auto + ajuste) ou Manual. */
export function topazValues(p) {
  const legacy = p.revertCompression !== undefined; // efeito salvo antes do layout do plugin
  const mi = legacy ? LEGACY[(p.model || 1) - 1] || 1 : p.model || 1;
  const m = TZ_MODELS[mi - 1] || TZ_MODELS[0];
  const q = p.inputQuality || 2;
  const auto = p.estimated ? { c: p.est_c, d: p.est_d, s: p.est_s, n: p.est_n, h: p.est_h, a: p.est_a } : autoFor(m, q);
  // projetos antigos: Proteus = manual com os sliders antigos; outros modelos = valores do modelo
  const mode = legacy ? (mi === 1 ? 3 : 1) : p.paramMode;
  const man = legacy
    ? { c: p.revertCompression, d: p.recoverDetails, s: p.sharpen, n: p.reduceNoise, h: p.dehalo, a: p.antialiasDeblur }
    : { c: p.compression, d: p.details, s: p.sharpen, n: p.noise, h: p.dehalo, a: p.aa };
  // modelos sem sliders (Artemis, Themis, Dione, Gaia) ficam sempre no Auto, como no plugin
  const fixed = m.sliders === 'none' || m.sliders === 'artemis';
  const out = {};
  for (const [k, key] of SL) {
    let v = auto[k];
    if (!fixed && mode === 2) v += p[`ra_${key}`] ?? 0;
    if (!fixed && mode === 3) v = man[k] ?? v;
    out[k] = Math.max(k === 'a' ? -100 : 0, Math.min(100, v));
  }
  out.model = m; out.modelIndex = mi;
  out.recover = legacy ? p.recoverOriginal ?? 0 : p.recoverOriginal ?? 20;
  out.largeGrain = m.sliders === 'nyx' ? (mode === 3 ? p.largeGrain ?? 50 : (mode === 2 ? auto.d + (p.ra_largeGrain ?? 0) : auto.d)) : 0;
  out.nyxRecover = p.nyxRecover ?? 0;
  out.preNoise = legacy ? (p.addNoise || 0) / 10 : p.addNoise || 0; // 0–10 (%) como o "Add Noise" (0–0,1)
  out.grain = p.grainAmount || 0; out.grainSize = p.grainSize || 1.5;
  return out;
}

export const FI_MODELS = ['Apollo', 'Apollo Fast', 'Chronos', 'Chronos Fast', 'Aion'];
const QUALITY = ['LQ (baixa qualidade)', 'MQ (média)', 'HQ (alta)'];
const isMode = (n) => (v) => (v.paramMode ?? 1) === n;
const notFixed = (v) => !['artemis', 'none'].includes((TZ_MODELS[(v.model || 1) - 1] || {}).sliders);
const isNyx = (v) => (TZ_MODELS[(v.model || 1) - 1] || {}).sliders === 'nyx';

export default [
  {
    type: 'topaz', label: 'Topaz Video AI – Enhance', category: 'Cor', plugin: 'Topaz Video AI (Enhance: Proteus / Iris / Nyx / Artemis / Themis / Dione)',
    description: 'Os mesmos controles do plugin Topaz Video AI do After Effects: AI Model, Input Quality (LQ/MQ/HQ), Output Resolution, Parameters (Auto / Relative to auto / Manual) com Fix Compression, Improve Detail, Sharpen, Reduce Noise, Dehalo, Anti-Alias/Deblur, Recover Original Details, Add Noise e Grain. Use “Estimar parâmetros” no painel ✨ Topaz para o Auto ler o seu clipe. Recriação na GPU (não as redes neurais da Topaz).',
    params: [
      sel('model', 'AI Model', TZ_MODELS.map((m) => m.name), 1),
      sel('inputQuality', 'Input Quality', QUALITY, 2),
      sel('upscale', 'Output Resolution', ['Original', '2x Upscale', '4x Upscale', '8x Upscale (extra)'], 1), num('edgeAware', 'Upscale – seguir bordas %', 80, 0, 100, 1, { advanced: true }),
      sel('paramMode', 'Parameters', ['Auto', 'Relative to auto', 'Manual'], 1),
      // Manual (valores absolutos)
      num('compression', 'Fix Compression', 50, 0, 100, 1, { showIf: (v) => notFixed(v) && isMode(3)(v) }),
      num('details', 'Improve Detail', 50, 0, 100, 1, { showIf: (v) => notFixed(v) && !isNyx(v) && isMode(3)(v) }),
      num('sharpen', 'Sharpen', 50, 0, 100, 1, { showIf: (v) => notFixed(v) && isMode(3)(v) }),
      num('noise', 'Reduce Noise', 50, 0, 100, 1, { showIf: (v) => notFixed(v) && isMode(3)(v) }),
      num('largeGrain', 'Reduce Large Grain', 50, 0, 100, 1, { showIf: (v) => isNyx(v) && isMode(3)(v) }),
      num('dehalo', 'Dehalo', 50, 0, 100, 1, { showIf: (v) => notFixed(v) && isMode(3)(v) }),
      num('aa', 'Anti-Alias/Deblur', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && isMode(3)(v) }),
      // Relative to auto (ajuste somado ao valor automático)
      num('ra_compression', 'Fix Compression (relativo)', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && isMode(2)(v) }),
      num('ra_details', 'Improve Detail (relativo)', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && !isNyx(v) && isMode(2)(v) }),
      num('ra_sharpen', 'Sharpen (relativo)', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && isMode(2)(v) }),
      num('ra_noise', 'Reduce Noise (relativo)', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && isMode(2)(v) }),
      num('ra_largeGrain', 'Reduce Large Grain (relativo)', 0, -100, 100, 1, { showIf: (v) => isNyx(v) && isMode(2)(v) }),
      num('ra_dehalo', 'Dehalo (relativo)', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && isMode(2)(v) }),
      num('ra_aa', 'Anti-Alias/Deblur (relativo)', 0, -100, 100, 1, { showIf: (v) => notFixed(v) && isMode(2)(v) }),
      num('recoverOriginal', 'Recover Original Details', 20, 0, 100, 1, { showIf: (v) => !isNyx(v) }),
      num('nyxRecover', 'Nyx Recover Details', 0, 0, 100, 1, { showIf: isNyx }),
      num('addNoise', 'Add Noise', 0, 0, 10, 0.1),
      num('grainAmount', 'Grain – Amount', 0, 0, 10, 0.1), num('grainSize', 'Grain – Size', 1.5, 1, 5, 0.1),
      num('aiSmooth', 'Suavização IA (visual “desenhado”)', 0, 0, 100, 1, { advanced: true }),
      { ...sel('focusFix', 'Focus fix', ['Off', 'Normal', 'Strong'], 1), advanced: true },
      num('sourceScale', 'Escala da fonte (0 = automático)', 0, 0, 8, 0.1, { advanced: true }),
      // valores do "Estimate Parameters" (análise do clipe)
      ...['est_c', 'est_d', 'est_s', 'est_n', 'est_h', 'est_a'].map((k) => ({ key: k, label: k, kind: 'hidden', default: 0 })),
      { key: 'estimated', label: 'estimated', kind: 'hidden', default: false },
    ],
    render: (src, p, env) => {
      const { gl } = env;
      const V = topazValues(p);
      const m = V.model;
      const v = (k) => V[k] / 100;
      // tamanho de um pixel do vídeo original na tela (vídeo 576 px esticado para 1440 = 2,5 px)
      const auto = env.srcW ? env.w / env.srcW : 1.5;
      const pxs = Math.max(1, (p.sourceScale > 0 ? p.sourceScale : auto)) * env.scale;
      let out = src;
      // Dione: desentrelaçar (linhas pares/ímpares de vídeo de TV/DV) antes de tudo
      if (m.deint) out = gl.pass(DEINT, { u_tex: out, u_amt: 1 });
      // pré-ruído (Add Noise do Proteus/Iris): dá textura para o realce não ficar "plástico"
      if (V.preNoise > 0.01) out = gl.pass(GRAIN, { u_tex: out, u_orig: src, u_orig_mix: 0, u_amt: (V.preNoise / 10) * 0.06, u_gsize: 1.0 * env.scale, u_seed: Math.floor(env.t * 30) % 97 + 13 });
      // Upscale: volta à grade de pixels do vídeo original e reconstrói N× com o filtro direcional
      const up = [0, 1, 2, 4, 8][(p.upscale || m.upscale || 1)] || 0;
      if (up >= 2 && pxs > 1.15) {
        const nw = Math.max(8, Math.round(src.w / pxs)), nh = Math.max(8, Math.round(src.h / pxs));
        let nat = gl.copy(out, nw, nh);
        if (pxs > 2.2) nat = gl.copy(gl.blur(out, pxs * 0.22), nw, nh); // anti-alias ao voltar para a grade original
        const tw = Math.min(nw * up, src.w * 2), th = Math.min(nh * up, src.h * 2);
        const big = gl.pass(UPSCALE, { u_tex: nat, u_nat: [nw, nh], u_edge: (p.edgeAware ?? 80) / 100 }, tw, th);
        out = tw === src.w && th === src.h ? big : gl.copy(big, src.w, src.h);
      }
      // Iris (aprendido): rede treinada com pares reais original → Topaz Iris; roda na escala do treino (1 px do vídeo = 1,6 px)
      if (m.face) {
        const k = IRIS_NET.scale / pxs;
        const cw = Math.max(8, Math.min(4096, Math.round(src.w * k))), ch = Math.max(8, Math.min(4096, Math.round(src.h * k)));
        const same = Math.abs(cw - src.w) < 2 && Math.abs(ch - src.h) < 2;
        let x = same ? out : gl.copy(out, cw, ch);
        x = runNet(gl, IRIS_NET, x, Math.max(0, v('d')));
        out = same ? x : gl.copy(x, src.w, src.h);
        const ro0 = v('recover');
        if (ro0 > 0.001 || V.grain > 0.01) out = gl.pass(GRAIN, { u_tex: out, u_orig: src, u_orig_mix: ro0 * 0.8, u_amt: (V.grain / 10) * 0.12, u_gsize: V.grainSize * env.scale, u_seed: Math.floor(env.t * 30) % 97 });
        return out;
      }
      const rc = v('c'), rn = v('n');
      // Fix compression: guided filter leve (tira blocos sem apagar a trama do tecido)
      if (rc > 0.01) {
        const sg = 0.95 * pxs;
        const m = gl.blur(out, sg), m2 = gl.blur(gl.pass(SQ, { u_tex: out }), sg);
        const eps = 0.000144;
        const A = gl.blur(gl.pass(GUIDE_A, { u_tex: m, u_m2: m2, u_eps: eps, u_wantB: 0 }), sg);
        const B = gl.blur(gl.pass(GUIDE_A, { u_tex: m, u_m2: m2, u_eps: eps, u_wantB: 1 }), sg);
        out = gl.pass(GUIDE_OUT, { u_tex: out, u_a: A, u_b: B, u_amt: Math.min(1, rc) * 0.8 });
      }
      if (rn > 0.12) out = gl.pass(BILAT, { u_tex: out, u_rad: 3 * pxs, u_sigR: 0.05 + rn * 0.12, u_amt: Math.min(1, rn * 1.1), u_flat: 0.3 });
      // Nyx "Reduce Large Grain": grão grosso (filme/ISO alto) — bilateral num raio maior, só nas áreas lisas
      const lg = V.largeGrain / 100;
      if (lg > 0.05) out = gl.pass(BILAT, { u_tex: out, u_rad: 7 * pxs, u_sigR: 0.04 + lg * 0.08, u_amt: Math.min(1, lg), u_flat: 0.7 });
      const ai = (p.aiSmooth ?? 0) / 100;
      if (ai > 0.01) {
        out = gl.pass(KUWAHARA, { u_tex: out, u_r: 1.2 * pxs, u_amt: Math.min(1, ai * 1.2) });
        out = gl.pass(KUWAHARA, { u_tex: out, u_r: 2.0 * pxs, u_amt: ai * 0.6 });
      }
      const det = v('d'), sh = v('s'), aa = Math.max(-1, Math.min(1, v('a'))), dh = v('h');
      const u = Math.max(1, pxs / 1.6);
      const esmooth = (img, amt, len) => {
        if (amt <= 0.01) return img;
        const J = gl.blur(gl.pass(TENSOR, { u_tex: img }), 1.5 * u);
        return gl.pass(ESMOOTH, { u_tex: img, u_j: J, u_amt: amt, u_len: len * u });
      };
      // Anti-alias (negativo) = contorno liso: suavização ao longo da borda antes do realce
      out = esmooth(out, Math.min(1.5, 0.6 + Math.max(0, -aa)), 2);
      const ff = [0, 0, 0.15, 0.3][(p.focusFix | 0) || 1] || 0;
      if (det + sh + Math.max(0, aa) + ff > 0.01) {
        const g = [1 + 0.3 * det + Math.max(0, aa) * 0.35 + ff, 1 + 2.4 * det + 1.0 * sh + ff * 0.5, 1 + 4.2 * det + 1.5 * sh];
        const halo = 0.012 + 0.04 * (1 - dh);
        const b1 = gl.blur(out, 0.5625 * pxs), b2 = gl.blur(out, 1.125 * pxs), b3 = gl.blur(out, 2.25 * pxs);
        out = gl.pass(BANDS, { u_tex: out, u_b1: b1, u_b2: b2, u_b3: b3, u_g: g, u_halo: halo, u_tex2: 0, u_seed: 0, u_px: pxs });
        out = esmooth(out, 0.4, 1.5);
      }
      const ro = m.sliders === 'nyx' ? V.nyxRecover / 100 : v('recover');
      if (V.grain > 0.01 || ro > 0.001) out = gl.pass(GRAIN, { u_tex: out, u_orig: src, u_orig_mix: ro * 0.8, u_amt: (V.grain / 10) * 0.12, u_gsize: V.grainSize * env.scale, u_seed: Math.floor(env.t * 30) % 97 });
      return out;
    },
  },
  {
    type: 'topazFI', label: 'Topaz Video AI – Frame Interpolation', category: 'Tempo', plugin: 'Topaz Video AI Frame Interpolation (Apollo / Chronos / Aion)',
    description: 'Igual ao plugin “Frame Interpolation” da Topaz no AE: Slowmo (câmera lenta com quadros criados por fluxo óptico), AI Model, Remove Duplicate Frames e Sensitivity. Apollo/Aion usam fluxo nos dois sentidos (melhor em movimento rápido/não linear), Chronos em um sentido, os “Fast” são mais leves.',
    params: [
      sel('slowmo', 'Slowmo', ['1x (só interpolar)', '2x', '4x', '8x', '16x', '32x'], 2),
      sel('fiModel', 'Model', FI_MODELS, 1),
      bool('removeDup', 'Remove Duplicates Frames', false),
      num('sensitivity', 'Sensitivity', 10, 0, 100, 1),
    ],
    sourceSpeed: true,
    // velocidade da mídia (%) que o Slowmo dá: 2x = 50%, 4x = 25%…
    speedProp: (fx) => ({ value: 100 / [1, 2, 4, 8, 16, 32][((fx.params.slowmo?.value ?? 2) | 0) - 1 || 0], keys: [] }),
    alwaysBlend: true,
  },
  {
    type: 'stabilize', label: 'Estabilizar (estilo Topaz)', category: 'Movimento', plugin: 'Topaz Video AI Stabilization / Warp Stabilizer',
    description: 'Correção de câmera tremida. Use o botão “Topaz” › Estabilizar para analisar o vídeo: os valores de correção viram keyframes aqui. Auto-crop aproxima para esconder as bordas; Full frame espelha as bordas e mantém o quadro inteiro.',
    params: [
      num('dx', 'Correção X (px)', 0, -4000, 4000, 0.1), num('dy', 'Correção Y (px)', 0, -4000, 4000, 0.1), num('rot', 'Correção de rotação (°)', 0, -45, 45, 0.01),
      sel('mode', 'Modo', ['Auto-crop (aproxima)', 'Full frame (espelha bordas)'], 1), num('zoom', 'Zoom do auto-crop %', 100, 100, 200, 0.1),
    ],
    render: (src, p, env) => {
      if (Math.abs(p.dx) < 0.01 && Math.abs(p.dy) < 0.01 && Math.abs(p.rot) < 0.001 && p.zoom <= 100.01) return src;
      return env.gl.pass(STAB, { u_tex: src, u_c: cuv(env, [0.5, 0.5]), u_sh: [p.dx / env.w, p.dy / env.h], u_r: rad(-p.rot), u_s: p.mode === 2 ? 1 : p.zoom / 100, u_full: p.mode === 2 });
    },
  },
];

/** Converte um efeito "topaz" salvo antes do layout do plugin (sliders antigos) para os parâmetros novos. */
export function migrateTopazFx(fx) {
  const P = fx.params;
  if (fx.type !== 'topaz' || !P.revertCompression) return false;
  const val = (k, d) => (P[k] ? P[k].value : d);
  const oldModel = val('model', 1);
  const mi = LEGACY[oldModel - 1] || 1;
  const keep = (from, to) => { if (P[from]) { P[to] = P[from]; } delete P[from]; };
  keep('revertCompression', 'compression'); keep('recoverDetails', 'details'); keep('reduceNoise', 'noise'); keep('antialiasDeblur', 'aa');
  P.model = { value: mi, keys: [] };
  P.paramMode = { value: mi === 1 ? 3 : 1, keys: [] };
  if (P.addNoise) { P.addNoise = { ...P.addNoise, value: (P.addNoise.value || 0) / 10, keys: (P.addNoise.keys || []).map((k) => ({ ...k, v: k.v / 10 })) }; }
  if (!P.recoverOriginal) P.recoverOriginal = { value: 0, keys: [] };
  return true;
}
