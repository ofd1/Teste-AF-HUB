// Fundos animados e partículas (no estilo dos fundos "live" do Frameify): neve, chuva, confete, vaga-lumes, bolhas,
// pétalas, folhas, brasas, aurora, synthwave, warp, lava, ondas e película. Tudo procedural na GPU (sem imagens),
// em loop contínuo, com modo Sobre a camada / Atrás da camada / Fundo (substitui).
import { num, col, sel, frag, rgb } from './common.js';

const CAT = 'Fundos animados';
const COMMON = `
uniform float u_mode; uniform float u_speed; uniform float u_amount; uniform float u_psize; uniform float u_seed; uniform float u_op;
uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_bg;
vec2 P() { vec2 c = contentUV(v_uv); float asp = (u_rect.z * u_size.x) / max(1.0, u_rect.w * u_size.y); return vec2(c.x * asp, c.y); }
float ASP() { return (u_rect.z * u_size.x) / max(1.0, u_rect.w * u_size.y); }
float T() { return u_time * u_speed + u_seed * 13.17; }
vec2 h2(vec2 p) { return vec2(hash(p), hash(p + 17.31)); }
// compõe o desenho (cor pré-multiplicada fx) com a camada
void outp(vec4 fx) {
  fx *= u_op;
  vec4 s = texture2D(u_tex, v_uv);
  vec2 c = contentUV(v_uv);
  float inside = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
  fx *= inside;
  if (u_mode < 1.5) gl_FragColor = fx + s * (1.0 - fx.a);                       // sobre a camada
  else if (u_mode < 2.5) gl_FragColor = s + fx * (1.0 - s.a);                   // atrás da camada
  else { vec4 b = vec4(u_bg, 1.0) * inside; gl_FragColor = fx + b * (1.0 - fx.a); } // fundo (substitui)
}
`;
const sh = (body) => frag(COMMON + body);

// partículas em grade (uma por célula, várias camadas de profundidade). dir = direção do movimento por segundo.
const PART = (shape) => sh(`
uniform vec2 u_dir; uniform float u_sway; uniform float u_spin;
${shape}
void main() {
  vec2 p = P(); float t = T();
  vec4 acc = vec4(0.0);
  for (int L = 0; L < 4; L++) {
    float fl = float(L);
    float depth = 1.0 - fl * 0.22;                       // camadas do fundo: menores e mais lentas
    float dens = u_amount * (0.6 + fl * 0.55);
    vec2 q = p * dens + vec2(fl * 7.13, fl * 3.71);
    q -= u_dir * t * depth * dens * 0.25;
    vec2 cell = floor(q), f = fract(q) - 0.5;
    vec2 rnd = h2(cell + fl * 31.0);
    if (rnd.x > 0.85) continue;                          // células vazias (distribuição natural)
    vec2 o = (rnd - 0.5) * 0.5;
    o.x += sin(t * (0.6 + rnd.y) * 1.7 + rnd.x * 6.28) * u_sway * 0.18;
    vec2 d = (f - o) / max(0.02, u_psize * depth * (0.55 + rnd.y * 0.6) * 0.18);
    float ang = (t * (rnd.x - 0.5) * 4.0 + rnd.y * 6.28) * u_spin;
    float cs = cos(ang), sn = sin(ang);
    d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    vec4 c = shapeAt(d, rnd, depth, t);
    acc = c + acc * (1.0 - c.a);
  }
  outp(acc);
}`);

const SNOW = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) { float a = smoothstep(1.0, 0.2, length(d)) * (0.55 + 0.45 * depth); return vec4(u_c1 * a, a); }`);
const RAIN = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) { d.y *= 0.09; d.x *= 4.0; float a = smoothstep(1.0, 0.0, length(d)) * 0.7 * depth; return vec4(u_c1 * a, a); }`);
const CONFETTI = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) {
  float flip = abs(sin(t * 3.0 * (0.5 + r.x) + r.y * 9.0));
  vec2 b = abs(d) - vec2(0.9, 0.5 * flip + 0.08);
  float a = 1.0 - smoothstep(-0.05, 0.08, max(b.x, b.y));
  vec3 c = hsv2rgb(vec3(fract(r.x * 3.7 + r.y), 0.75, 1.0)) * (0.75 + 0.25 * flip);
  return vec4(c * a, a); }`);
const PETALS = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) {
  d.x *= 1.7; d.y += 0.25 * d.x * d.x; float a = smoothstep(1.0, 0.75, length(d));
  vec3 c = mix(u_c1, u_c2, r.y) * (0.8 + 0.2 * smoothstep(1.0, 0.0, length(d)));
  return vec4(c * a, a); }`);
const LEAVES = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) {
  float yy = clamp(d.y, -1.0, 1.0); float hw = 0.42 * sqrt(max(0.0, 1.0 - yy * yy)) * (1.0 - 0.35 * yy);
  float a = smoothstep(0.0, 0.06, hw - abs(d.x - 0.12 * yy * yy)) * step(abs(d.y), 1.0);
  a = max(a, (1.0 - smoothstep(0.0, 0.04, abs(d.x))) * step(1.0, d.y) * step(d.y, 1.25));
  float vein = 1.0 - smoothstep(0.0, 0.05, abs(d.x)) * 0.35;
  vec3 c = mix(u_c1, u_c2, r.x) * vein * (0.75 + 0.25 * depth);
  return vec4(c * a, a); }`);
const BUBBLES = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) {
  float l = length(d); float ring = smoothstep(1.0, 0.86, l) * smoothstep(0.62, 0.92, l);
  float hl = smoothstep(0.35, 0.0, length(d - vec2(-0.35, -0.38)));
  float a = clamp(ring * 0.75 + hl * 0.8 + smoothstep(1.0, 0.0, l) * 0.08, 0.0, 1.0) * (0.6 + 0.4 * depth);
  return vec4(mix(u_c1, vec3(1.0), hl) * a, a); }`);
const FIREFLY = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) {
  float blink = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.0 + r.x * 2.0) + r.y * 20.0), 3.0);
  float l = length(d); float a = (smoothstep(0.35, 0.0, l) + smoothstep(1.0, 0.0, l) * 0.35) * blink;
  a = clamp(a, 0.0, 1.0); return vec4(mix(u_c1, vec3(1.0), smoothstep(0.25, 0.0, l)) * a, a); }`);
const EMBERS = PART(`vec4 shapeAt(vec2 d, vec2 r, float depth, float t) {
  float fl = 0.55 + 0.45 * sin(t * 9.0 * (0.6 + r.x) + r.y * 30.0);
  d.y *= 0.55; float l = length(d); float a = clamp(smoothstep(0.5, 0.0, l) + smoothstep(1.0, 0.0, l) * 0.4, 0.0, 1.0) * fl;
  return vec4(mix(u_c2, u_c1, smoothstep(0.6, 0.0, l)) * a, a); }`);

const AURORA = sh(`void main() {
  vec2 p = P(); float t = T() * 0.15; vec4 acc = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.25 + fi * 0.12 + 0.08 * sin(p.x * (1.4 + fi * 0.5) + t * (1.0 + fi * 0.3)) + 0.05 * fbm(vec2(p.x * 2.0 + t, fi), 3);
    float band = exp(-pow((p.y - y) / (0.06 + 0.05 * u_psize), 2.0));
    float curtain = 0.55 + 0.45 * fbm(vec2(p.x * 9.0 + t * 2.0, p.y * 1.5 + fi), 3);
    float a = band * curtain * (0.55 - fi * 0.12) * u_amount * 0.14;
    vec3 c = mix(u_c1, u_c2, fi * 0.5 + 0.25 * sin(p.x * 2.0 + t));
    acc += vec4(c * a, a);
  }
  outp(clamp(acc, 0.0, 1.0));
}`);
const SYNTH = sh(`void main() {
  vec2 c = contentUV(v_uv); float asp = ASP(); float t = T();
  vec4 acc = vec4(0.0);
  float hz = 0.55;
  // sol
  vec2 sp = vec2((c.x - 0.5) * asp, c.y - hz + 0.12);
  float r = 0.24 * u_psize; float sd = length(sp);
  if (c.y < hz && sd < r) {
    float stripe = step(0.0, sin((c.y - hz) * 90.0 + t * 2.0)) + step(c.y, hz - r * 0.55);
    float a = clamp(stripe, 0.0, 1.0);
    vec3 sc = mix(u_c2, u_c1, smoothstep(hz - r * 1.2, hz, c.y));
    acc = vec4(sc * a, a);
  }
  acc += vec4(u_c1, 1.0) * smoothstep(r * 1.6, r, sd) * 0.18 * (1.0 - acc.a);
  // grade em perspectiva
  if (c.y > hz) {
    float z = 1.0 / max(0.001, c.y - hz);
    float gx = (c.x - 0.5) * asp * z * 0.6, gz = z * 0.6 + t * 1.5;
    float lw = 0.04 * z * 0.25;
    float g = max(1.0 - smoothstep(0.0, lw + 0.02, abs(fract(gx * u_amount * 0.5) - 0.5) * 2.0 * 0.5),
                  1.0 - smoothstep(0.0, lw + 0.02, abs(fract(gz * u_amount * 0.25) - 0.5) * 2.0 * 0.5));
    float fade = smoothstep(hz, hz + 0.08, c.y);
    float a = g * fade;
    acc = vec4(u_c2 * a, a) + acc * (1.0 - a);
  }
  float hl = exp(-pow((c.y - hz) * 60.0, 2.0)) * 0.8;
  acc = clamp(acc + vec4(u_c1 * hl, hl), 0.0, 1.0);
  outp(acc);
}`);
const WARP = sh(`void main() {
  vec2 c = contentUV(v_uv) - 0.5; c.x *= ASP(); float t = T();
  float ang = atan(c.y, c.x), rad = length(c);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float n = 60.0 * u_amount * (1.0 + fi * 0.6);
    float id = floor((ang / 6.2832 + 0.5) * n);
    float rnd = hash(vec2(id, fi * 13.0 + u_seed));
    float pos = fract(rnd * 7.0 + t * (0.25 + rnd * 0.5) * (1.0 + fi * 0.3));
    float r0 = pos * pos * 0.9;
    float len = 0.04 + pos * 0.25 * u_psize;
    float along = smoothstep(r0 - len, r0, rad) * (1.0 - smoothstep(r0, r0 + 0.005, rad));
    float across = 1.0 - smoothstep(0.0, 0.5, abs(fract((ang / 6.2832 + 0.5) * n) - 0.5) * 2.0 * (0.5 + rad * 2.0));
    float a = along * across * pos * step(0.55, rnd + 0.4);
    acc += vec4(mix(u_c1, u_c2, rnd) * a, a);
  }
  outp(clamp(acc, 0.0, 1.0));
}`);
const LAVA = sh(`void main() {
  vec2 p = P(); float t = T() * 0.25;
  float f = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 cpos = vec2(0.5 * ASP() + 0.42 * ASP() * sin(t * (0.5 + fi * 0.13) + fi * 2.1), 0.5 + 0.42 * sin(t * (0.37 + fi * 0.11) + fi * 1.3));
    float r = (0.09 + 0.05 * hash1(fi + u_seed)) * u_psize;
    f += r * r / max(1e-4, dot(p - cpos, p - cpos));
  }
  f *= u_amount * 0.1;
  float a = smoothstep(0.8, 1.2, f);
  vec3 c = mix(u_c2, u_c1, smoothstep(1.0, 3.0, f));
  float glow = smoothstep(0.3, 1.0, f) * 0.35;
  outp(vec4(c * max(a, glow), max(a, glow)));
}`);
const OCEAN = sh(`void main() {
  vec2 c = contentUV(v_uv); float t = T(); vec2 p = P();
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float base = 0.42 + fi * 0.12;
    float y = base + 0.025 * u_psize * (sin(p.x * (5.0 - fi * 0.5) + t * (1.2 + fi * 0.25) + fi) + 0.5 * sin(p.x * 11.0 - t * 1.7 + fi * 3.0));
    float a = smoothstep(y - 0.004, y + 0.004, c.y) * min(1.0, u_amount * 0.045);
    float foam = exp(-pow((c.y - y) * 160.0, 2.0)) * 0.5;
    vec3 col = mix(u_c1, u_c2, fi / 4.0);
    vec4 w = vec4(col * a + vec3(foam), clamp(a + foam, 0.0, 1.0));
    acc = w + acc * (1.0 - w.a);
  }
  outp(clamp(acc, 0.0, 1.0));
}`);
const FILM = sh(`void main() {
  vec2 c = contentUV(v_uv); float asp = ASP(); float t = T();
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x0 = (0.18 + fi * 0.32) * asp, w = 0.16 * u_psize;
    float x = c.x * asp - x0;
    if (abs(x) < w * 0.5) {
      float y = c.y + t * (0.08 + fi * 0.04) * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0);
      float edge = step(w * 0.36, abs(x));
      float hole = edge * step(0.5, fract(y * 28.0)) * step(abs(x), w * 0.46) * step(w * 0.39, abs(x));
      float frameLine = (1.0 - edge) * smoothstep(0.012, 0.0, abs(fract(y * 4.0) - 0.0));
      vec3 cl = mix(u_c1, u_c2, step(0.5, 1.0 - edge) * (0.25 + 0.2 * hash(vec2(floor(y * 4.0), fi))));
      float a = (1.0 - hole) * mix(min(1.0, u_amount * 0.03), 1.0, edge);
      cl = mix(cl, vec3(0.0), frameLine);
      acc = vec4(cl * a, a);
    }
  }
  outp(clamp(acc, 0.0, 1.0));
}`);

const base = (extra = []) => [
  sel('mode', 'Modo', ['Sobre a camada', 'Atrás da camada', 'Fundo (substitui)'], 1),
  num('speed', 'Velocidade', 1, 0, 6, 0.05), num('amount', 'Quantidade', 10, 1, 40, 0.5), num('size', 'Tamanho', 1, 0.1, 5, 0.05),
  ...extra, col('bg', 'Cor do fundo (modo Fundo)', [0.04, 0.05, 0.09, 1]), num('opacity', 'Opacidade %', 100, 0, 100), num('seed', 'Semente', 1, 0, 999),
];
const mk = (type, label, shader, defs, uniforms = {}, desc = '') => ({
  type, label, category: CAT, plugin: 'Frameify live backgrounds', description: desc,
  params: base(defs),
  render: (src, p, env) => env.gl.pass(shader, {
    u_tex: src, u_mode: p.mode, u_speed: p.speed, u_amount: p.amount, u_psize: p.size, u_seed: p.seed, u_op: p.opacity / 100,
    u_c1: rgb(p.c1 || [1, 1, 1, 1]), u_c2: rgb(p.c2 || p.c1 || [1, 1, 1, 1]), u_bg: rgb(p.bg), ...(typeof uniforms === 'function' ? uniforms(p) : uniforms),
  }),
});
const c1 = (d, l = 'Cor') => col('c1', l, d), c2 = (d, l = 'Cor 2') => col('c2', l, d);
const dirU = (dir, sway, spin) => (p) => ({ u_dir: [dir[0] + (p.wind || 0) / 100, dir[1]], u_sway: sway, u_spin: spin });

export default [
  mk('bgSnow', 'Neve', SNOW, [c1([1, 1, 1, 1]), num('wind', 'Vento', 0, -100, 100)], dirU([0, -1], 1, 0), 'Flocos em 4 camadas de profundidade, caindo com balanço.'),
  mk('bgRain', 'Chuva', RAIN, [c1([0.7, 0.8, 1, 1]), num('wind', 'Vento', 10, -100, 100)], (p) => ({ u_dir: [(p.wind || 0) / 60, -4], u_sway: 0, u_spin: 0 }), 'Gotas rápidas em riscos (chuva noturna).'),
  mk('bgConfetti', 'Confete', CONFETTI, [num('wind', 'Vento', 0, -100, 100)], dirU([0, -1.2], 1.4, 1), 'Papeizinhos coloridos girando e caindo.'),
  mk('bgPetals', 'Pétalas caindo', PETALS, [c1([1, 0.72, 0.82, 1]), c2([1, 0.9, 0.93, 1]), num('wind', 'Vento', 30, -100, 100)], dirU([0.3, -0.7], 1.6, 0.6)),
  mk('bgLeaves', 'Folhas ao vento', LEAVES, [c1([0.93, 0.55, 0.16, 1]), c2([0.55, 0.7, 0.2, 1]), num('wind', 'Vento', 40, -100, 100)], dirU([0.4, -0.6], 1.6, 0.8)),
  mk('bgBubbles', 'Bolhas', BUBBLES, [c1([0.75, 0.9, 1, 1])], dirU([0, 0.7], 1.2, 0)),
  mk('bgFireflies', 'Vaga-lumes', FIREFLY, [c1([1, 0.92, 0.45, 1])], dirU([0.05, 0.12], 2.2, 0)),
  mk('bgEmbers', 'Brasas / faíscas', EMBERS, [c1([1, 0.85, 0.4, 1]), c2([1, 0.3, 0.05, 1])], dirU([0.05, 1.1], 1.4, 0.2)),
  mk('bgAurora', 'Aurora', AURORA, [c1([0.25, 1, 0.6, 1]), c2([0.55, 0.3, 1, 1])], {}, 'Cortinas de luz em movimento lento.'),
  mk('bgSynthwave', 'Synthwave', SYNTH, [c1([1, 0.75, 0.25, 1], 'Cor do sol'), c2([1, 0.2, 0.75, 1], 'Cor da grade')], {}, 'Sol listrado + grade em perspectiva andando.'),
  mk('bgWarp', 'Warp speed', WARP, [c1([1, 1, 1, 1]), c2([0.5, 0.75, 1, 1])], {}, 'Estrelas esticadas saindo do centro (hiperespaço).'),
  mk('bgLava', 'Lava glow', LAVA, [c1([1, 0.75, 0.2, 1]), c2([0.9, 0.12, 0.25, 1])], {}, 'Bolhas de lava que se juntam e se separam.'),
  mk('bgOcean', 'Ondas do mar', OCEAN, [c1([0.15, 0.55, 0.85, 1]), c2([0.03, 0.15, 0.35, 1])], {}, 'Camadas de ondas com espuma.'),
  mk('bgFilm', 'Película de filme', FILM, [c1([0.08, 0.08, 0.08, 1]), c2([0.9, 0.85, 0.75, 1])], {}, 'Tiras de filme correndo na vertical.'),
];
export const BG_CATEGORY = CAT;
