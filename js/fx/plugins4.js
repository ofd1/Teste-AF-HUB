// Mais recriações de Sapphire e BCC: S_FilmDamage / BCC Film Damage, S_Bokeh / BCC Bokeh, S_Zap / BCC Lightning,
// S_Aurora, S_GlowEdges / BCC Glow Edges, BCC Cartoon Look, S_Unmult / BCC Unmult, S_Clouds / BCC Fast Fog,
// S_Sparkles / BCC Sparkles.
import { frag, num, ang, bool, sel, pos, col, rgb, rad, cuv } from './common.js';

const FILMDMG = frag(`
uniform float u_scr, u_dust, u_flick, u_jit, u_grain, u_sepia, u_seed, u_fr;
void main() {
  float f = floor(u_time * u_fr) + u_seed * 17.0;
  vec2 uv = v_uv + vec2(0.0, (hash1(f * 1.37) - 0.5) * u_jit * u_texel.y);
  vec4 s = texture2D(u_tex, uv);
  vec3 c = unpre(s).rgb;
  vec2 cu = contentUV(v_uv);
  // riscos verticais
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (hash1(fi * 3.3 + floor(f / 6.0)) > u_scr * 1.2) continue;
    float x = hash1(fi * 9.1 + floor(f / 9.0) * 0.37) + (hash1(f + fi) - 0.5) * 0.004;
    float w = 0.0008 + 0.0018 * hash1(fi * 1.7);
    float line = smoothstep(w, 0.0, abs(cu.x - x)) * (0.5 + 0.5 * vnoise(vec2(cu.y * 30.0, f + fi)));
    c = mix(c, hash1(fi * 5.0) > 0.4 ? vec3(0.9) : vec3(0.08), line * 0.8);
  }
  // poeira e cabelos (mudam a cada quadro)
  vec2 g = cu * vec2(28.0, 50.0);
  vec2 cell = floor(g);
  float h = hash1(dot(cell, vec2(12.7, 71.3)) + f * 3.1);
  if (h > 1.0 - u_dust * 0.04) {
    vec2 q = fract(g) - 0.5 + (vec2(hash1(h * 7.0), hash1(h * 11.0)) - 0.5) * 0.6;
    float blob = smoothstep(0.18, 0.05, length(q * vec2(1.0, 0.56)) + vnoise(q * 9.0 + h * 40.0) * 0.12);
    c = mix(c, hash1(h * 3.0) > 0.5 ? vec3(0.02) : vec3(0.95), blob * 0.9);
  }
  c *= 1.0 + (hash1(f * 0.71) - 0.5) * u_flick * 0.45;
  c += (hash1(dot(floor(v_uv / u_texel), vec2(1.0, 157.0)) + f * 0.013) - 0.5) * u_grain * 0.3;
  float l = luma(c);
  c = mix(c, vec3(l * 1.07, l * 0.92, l * 0.72), u_sepia);
  gl_FragColor = pre(vec4(clamp(c, 0.0, 1.0), unpre(s).a));
}`);

const HI = frag(`
uniform float u_thr;
void main() { vec4 c = texture2D(u_tex, v_uv); float l = luma(c.rgb / max(c.a, 1e-4)); gl_FragColor = c * smoothstep(u_thr, u_thr + 0.08, l); }`);

const BOKEH = frag(`
uniform sampler2D u_tex2; uniform float u_r, u_sides, u_amt;
void main() {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = 1; j <= 3; j++) {
    for (int i = 0; i < 20; i++) {
      float a = float(i) / 20.0 * 6.2831853 + float(j) * 0.37;
      float rr = u_r * float(j) / 3.0;
      if (u_sides > 2.5) { float s = 6.2831853 / u_sides; rr *= cos(3.14159265 / u_sides) / cos(mod(a, s) - s * 0.5); }
      acc += texture2D(u_tex2, v_uv + vec2(cos(a), sin(a)) * rr * u_texel); ws += 1.0;
    }
  }
  acc += texture2D(u_tex2, v_uv); ws += 1.0;
  vec4 b = acc / ws * u_amt * 6.0;
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = fixpre(s + vec4(b.rgb, 0.0));
}`);

const ZAP = frag(`
uniform vec2 u_a, u_b; uniform float u_w, u_amp, u_det, u_glow, u_fseed, u_br, u_only;
uniform vec3 u_col;
float boltD(vec2 px, vec2 a, vec2 b, float seed, float amp) {
  vec2 d = b - a; float L = length(d); vec2 dir = d / max(L, 1e-3), nrm = vec2(-dir.y, dir.x);
  float t = clamp(dot(px - a, dir) / max(L, 1e-3), 0.0, 1.0);
  float off = (fbm(vec2(t * u_det, seed), 5) - 0.5) * 2.0 * amp * L * sqrt(sin(3.14159 * t));
  vec2 p = a + d * t + nrm * off;
  return length(px - p);
}
void main() {
  vec2 px = v_uv * u_size;
  float dm = boltD(px, u_a, u_b, u_fseed, u_amp);
  float core = smoothstep(u_w, u_w * 0.3, dm);
  float glow = exp(-dm / (u_w * 6.0)) * 0.7 + exp(-dm / (u_w * 25.0)) * 0.25;
  vec2 d = u_b - u_a;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= u_br) break;
    float fi = float(i) + u_fseed * 3.0;
    float t0 = 0.15 + 0.6 * hash1(fi * 4.1);
    vec2 a2 = u_a + d * t0;
    float an = (hash1(fi * 7.7) - 0.5) * 1.6;
    vec2 d2 = vec2(d.x * cos(an) - d.y * sin(an), d.x * sin(an) + d.y * cos(an)) * (0.2 + 0.3 * hash1(fi * 2.3));
    float db = boltD(px, a2, a2 + d2, fi * 13.0, u_amp * 1.4);
    core = max(core, smoothstep(u_w * 0.6, u_w * 0.15, db) * 0.8);
    glow += exp(-db / (u_w * 5.0)) * 0.35;
  }
  vec3 c = (vec3(core) + u_col * glow * u_glow) * u_col * 0.4 + vec3(core) * 0.7;
  vec4 s = texture2D(u_tex, v_uv);
  vec4 o = vec4(c, 0.0);
  gl_FragColor = u_only > 0.5 ? fixpre(vec4(c, 0.0)) : fixpre(s + o);
}`);

const AURORA = frag(`
uniform float u_int, u_spd, u_h1, u_h2, u_hgt, u_sc, u_only;
void main() {
  vec2 c = contentUV(v_uv);
  float t = u_time * u_spd;
  float n = fbm(vec2(c.x * u_sc * 2.0 + t * 0.15, t * 0.08), 4);
  float y0 = u_hgt + (n - 0.5) * 0.35;
  float dy = c.y - y0;
  float curtain = exp(-max(dy, 0.0) * 18.0) * smoothstep(-0.35, 0.0, dy) * exp(min(dy, 0.0) * 3.5);
  float rays = 0.45 + 0.75 * vnoise(vec2(c.x * 70.0 * u_sc + n * 12.0, t * 0.6));
  float k = clamp(curtain * rays, 0.0, 2.0);
  vec3 col = mix(hsv2rgb(vec3(u_h1, 0.85, 1.0)), hsv2rgb(vec3(u_h2, 0.8, 1.0)), smoothstep(0.0, -0.3, dy));
  vec3 a = col * k * u_int;
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = u_only > 0.5 ? fixpre(vec4(a, 0.0)) : fixpre(s + vec4(a * (1.0 - luma(unpre(s).rgb) * 0.3), 0.0));
}`);

const EDGES = frag(`
uniform float u_thr;
void main() {
  vec2 t = u_texel;
  float tl = luma(texture2D(u_tex, v_uv - t).rgb), br = luma(texture2D(u_tex, v_uv + t).rgb);
  float tr = luma(texture2D(u_tex, v_uv + vec2(t.x, -t.y)).rgb), bl = luma(texture2D(u_tex, v_uv + vec2(-t.x, t.y)).rgb);
  float l = luma(texture2D(u_tex, v_uv - vec2(t.x, 0.0)).rgb), r = luma(texture2D(u_tex, v_uv + vec2(t.x, 0.0)).rgb);
  float u = luma(texture2D(u_tex, v_uv - vec2(0.0, t.y)).rgb), b = luma(texture2D(u_tex, v_uv + vec2(0.0, t.y)).rgb);
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl), gy = (bl + 2.0 * b + br) - (tl + 2.0 * u + tr);
  float e = smoothstep(u_thr, u_thr + 0.15, length(vec2(gx, gy)));
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(unpre(c).rgb * e, e) * c.a;
}`);
const EDGEMIX = frag(`
uniform sampler2D u_tex2, u_tex3; uniform float u_amt, u_useSrc, u_only; uniform vec3 u_col;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec4 e = texture2D(u_tex2, v_uv), g = texture2D(u_tex3, v_uv);
  vec3 tint = mix(u_col * luma(g.rgb / max(g.a, 1e-4)) * g.a, g.rgb, u_useSrc);
  vec3 add = (tint * 2.5 + mix(u_col * e.a, e.rgb, u_useSrc)) * u_amt;
  gl_FragColor = u_only > 0.5 ? fixpre(vec4(add, 0.0)) : fixpre(s + vec4(add, 0.0));
}`);

const CARTOON = frag(`
uniform sampler2D u_tex2; uniform float u_lv, u_lines, u_lw, u_sat;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = unpre(texture2D(u_tex2, v_uv)).rgb;
  float l = luma(c);
  float q = floor(l * u_lv + 0.5) / u_lv;
  c = c * (q / max(l, 1e-3));
  c = mix(vec3(luma(c)), c, u_sat);
  vec2 t = u_texel * u_lw;
  float gx = luma(texture2D(u_tex2, v_uv + vec2(t.x, 0.0)).rgb) - luma(texture2D(u_tex2, v_uv - vec2(t.x, 0.0)).rgb);
  float gy = luma(texture2D(u_tex2, v_uv + vec2(0.0, t.y)).rgb) - luma(texture2D(u_tex2, v_uv - vec2(0.0, t.y)).rgb);
  float e = smoothstep(0.06, 0.16, length(vec2(gx, gy)));
  c *= 1.0 - e * u_lines;
  gl_FragColor = pre(vec4(clamp(c, 0.0, 1.0), unpre(s).a));
}`);

const UNMULT = frag(`
uniform float u_blk, u_gam;
void main() {
  vec4 s = unpre(texture2D(u_tex, v_uv));
  float m = max(s.r, max(s.g, s.b));
  float a = pow(clamp((m - u_blk) / max(1.0 - u_blk, 1e-3), 0.0, 1.0), u_gam) * s.a;
  vec3 c = m > 1e-4 ? s.rgb / m : vec3(0.0);
  gl_FragColor = vec4(c * a, a);
}`);

const CLOUDS = frag(`
uniform float u_den, u_spd, u_sc, u_hor, u_only, u_soft; uniform vec3 u_col;
void main() {
  vec2 c = contentUV(v_uv);
  float t = u_time * u_spd;
  float n = fbm(c * u_sc * vec2(3.0, 5.0) + vec2(t * 0.25, t * 0.05), 5);
  n = mix(n, fbm(c * u_sc * 9.0 - vec2(t * 0.4, 0.0) + 3.0, 4), 0.35);
  float d = smoothstep(0.35 + 0.15 * (1.0 - u_soft), 0.75, n) * u_den;
  d *= mix(1.0, smoothstep(0.0, 1.0, c.y + 0.2), u_hor);
  vec4 s = texture2D(u_tex, v_uv);
  vec3 fc = u_col * (0.85 + 0.3 * n);
  if (u_only > 0.5) { gl_FragColor = vec4(fc * clamp(d, 0.0, 1.0), clamp(d, 0.0, 1.0)); return; }
  vec3 o = mix(unpre(s).rgb, fc, clamp(d, 0.0, 1.0));
  gl_FragColor = pre(vec4(o, max(s.a, clamp(d, 0.0, 1.0))));
}`);

const SPARK = frag(`
uniform float u_cell, u_thr, u_len, u_amt, u_tw, u_rays, u_rot; uniform vec3 u_col;
void main() {
  vec2 px = v_uv * u_size;
  vec2 g = px / u_cell;
  vec2 base = floor(g);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = base + vec2(float(i), float(j));
    float h = hash1(dot(cell, vec2(17.3, 91.7)));
    vec2 sp = (cell + vec2(hash1(h * 13.0), hash1(h * 29.0))) * u_cell;
    vec4 sc = texture2D(u_tex, sp / u_size);
    float lum = luma(sc.rgb / max(sc.a, 1e-4));
    if (lum < u_thr) continue;
    float tw = 0.5 + 0.5 * sin(u_time * u_tw * (2.0 + 4.0 * h) + h * 40.0);
    float k = (lum - u_thr) / max(1.0 - u_thr, 0.05) * tw;
    vec2 d = px - sp;
    float an = atan(d.y, d.x) + u_rot, r = length(d) / (u_len * (0.5 + h));
    float star = pow(max(0.0, cos(an * u_rays * 0.5)), 60.0) * exp(-r * 2.5) + exp(-r * r * 60.0) * 1.5;
    acc += mix(u_col, sc.rgb / max(sc.a, 1e-4), 0.3) * star * k;
  }
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = fixpre(s + vec4(acc * u_amt, 0.0));
}`);


// S_Hotspots: só as áreas mais claras que o limiar, com a cor original (o resto fica preto)
const HOTSPOTS = frag(`
uniform float u_thr, u_sat, u_bri, u_soft; uniform vec3 u_addc;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = unpre(s).rgb;
  float t = u_thr + dot(u_addc, c) * 0.5;
  float k = smoothstep(t, t + u_soft, luma(c));
  vec3 o = mix(vec3(luma(c)), c, u_sat) * k * u_bri;
  gl_FragColor = vec4(clamp(o, 0.0, 1.0) * s.a, s.a);
}`);
// Minimax do AE: máximo (dilata o claro) ou mínimo (dilata o escuro) num raio, separável
const MINIMAX = frag(`
uniform vec2 u_dir; uniform float u_r, u_mode;
void main() {
  vec4 m = texture2D(u_tex, v_uv);
  for (int i = 1; i <= 40; i++) {
    if (float(i) > u_r) break;
    vec4 a = texture2D(u_tex, v_uv + u_dir * u_texel * float(i)), b = texture2D(u_tex, v_uv - u_dir * u_texel * float(i));
    m = u_mode > 0.5 ? min(m, min(a, b)) : max(m, max(a, b));
  }
  gl_FragColor = m;
}`);
// CC Jaws: a imagem "morde" e some com dentes em zigue-zague
const JAWS = frag(`
uniform float u_comp, u_teeth, u_hgt, u_horiz; uniform vec2 u_c;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 c = contentUV(v_uv);
  float a = u_horiz > 0.5 ? c.y : c.x, b = u_horiz > 0.5 ? c.x : c.y, cb = u_horiz > 0.5 ? u_c.x : u_c.y;
  float tooth = abs(fract(a * u_teeth) - 0.5) * 2.0 * u_hgt;
  float open = u_comp * (1.0 + u_hgt);
  float d = b - cb;
  float edgeTop = -open * cb + tooth * (u_comp > 0.0 ? 1.0 : 0.0);
  float edgeBot = open * (1.0 - cb) - tooth * (u_comp > 0.0 ? 1.0 : 0.0);
  bool gone = d > edgeTop && d < edgeBot && u_comp > 0.001;
  gl_FragColor = gone ? vec4(0.0) : s;
}`);
// Card Wipe: cartões que viram em sequência (escala em X ou Y pelo cosseno do giro)
const CARDS = frag(`
uniform float u_comp, u_rows, u_cols, u_width, u_axis, u_order, u_rnd;
void main() {
  vec2 c = contentUV(v_uv);
  vec2 g = vec2(u_cols, u_rows);
  vec2 cell = floor(c * g), f = fract(c * g);
  float ord = u_order < 1.5 ? cell.x / max(1.0, u_cols - 1.0) : u_order < 2.5 ? cell.y / max(1.0, u_rows - 1.0) : hash1(dot(cell, vec2(7.1, 31.7)) + u_rnd);
  float w = u_width / 100.0;
  float tt = clamp((u_comp * (1.0 + w) - ord * 1.0) / max(w, 0.01), 0.0, 1.0);
  float ang = tt * 3.14159265, k = cos(ang);
  if (abs(k) < 0.02 || tt >= 0.5) { gl_FragColor = vec4(0.0); return; }
  float axisV = u_axis > 1.5 ? f.y : f.x;
  float q = (axisV - 0.5) / k + 0.5;
  if (q < 0.0 || q > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec2 ff = u_axis > 1.5 ? vec2(f.x, q) : vec2(q, f.y);
  vec4 s = texture2D(u_tex, fromContent((cell + ff) / g));
  gl_FragColor = vec4(s.rgb * (0.6 + 0.4 * k), s.a);
}`);
// Polytrace (low poly / plexus): pontos nas bordas, ligados por linhas aos vizinhos, sobre a imagem
const POLY = frag(`
uniform float u_cell, u_thr, u_lw, u_pt, u_amt, u_fill; uniform vec3 u_col;
vec2 vtx(vec2 cell, out float on) {
  float h = hash1(dot(cell, vec2(12.9, 78.2)));
  vec2 p = (cell + 0.2 + 0.6 * vec2(h, hash1(h * 17.0))) * u_cell;
  vec2 uv = p / u_size, t = u_texel * 2.0;
  float gx = luma(texture2D(u_tex, uv + vec2(t.x, 0.0)).rgb) - luma(texture2D(u_tex, uv - vec2(t.x, 0.0)).rgb);
  float gy = luma(texture2D(u_tex, uv + vec2(0.0, t.y)).rgb) - luma(texture2D(u_tex, uv - vec2(0.0, t.y)).rgb);
  on = step(u_thr, length(vec2(gx, gy)) * 4.0) * texture2D(u_tex, uv).a;
  return p;
}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 px = v_uv * u_size, base = floor(px / u_cell);
  float line = 0.0, dot1 = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float on; vec2 a = vtx(base + vec2(float(i), float(j)), on);
    if (on < 0.5) continue;
    dot1 = max(dot1, smoothstep(u_pt, u_pt * 0.5, length(px - a)));
    for (int k = 0; k < 3; k++) {
      vec2 o = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(0.0, 1.0) : vec2(1.0, 1.0);
      float on2; vec2 b = vtx(base + vec2(float(i), float(j)) + o, on2);
      if (on2 > 0.5) line = max(line, smoothstep(u_lw, 0.0, seg(px, a, b)));
    }
  }
  vec3 c = unpre(s).rgb * (1.0 - u_fill);
  vec3 o = mix(unpre(s).rgb, c, step(0.5, u_fill)) + u_col * max(line * 0.8, dot1) * u_amt;
  gl_FragColor = vec4(clamp(o, 0.0, 1.0) * max(s.a, max(line, dot1) * u_amt), max(s.a, max(line, dot1) * u_amt));
}`);
// AutoPaint: pinceladas (Kuwahara anisotrópico simples + textura de tela)
const PAINT = frag(`
uniform float u_r, u_tex2s;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 best = c.rgb; float bv = 1e9;
  for (int q = 0; q < 4; q++) {
    vec2 sg = vec2(q == 0 || q == 2 ? -1.0 : 1.0, q < 2 ? -1.0 : 1.0);
    vec3 m = vec3(0.0), m2 = vec3(0.0);
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      vec3 a = texture2D(u_tex, v_uv + sg * vec2(float(i), float(j)) * u_texel * u_r / 3.0).rgb;
      m += a; m2 += a * a;
    }
    m /= 16.0; vec3 v = m2 / 16.0 - m * m;
    float vv = v.r + v.g + v.b;
    if (vv < bv) { bv = vv; best = m; }
  }
  float canvasTex = (vnoise(v_uv / u_texel * 0.35) - 0.5) * u_tex2s;
  gl_FragColor = vec4(clamp(best + canvasTex, 0.0, c.a), c.a);
}`);

const fr = (env) => env.fps || 24;

export default [
  {
    type: 'filmDamage', label: 'Film Damage', category: 'Estilizar', plugin: 'S_FilmDamage / BCC Film Damage',
    description: 'Filme antigo: riscos, poeira e cabelos que mudam a cada quadro, flicker, tremor de projetor, grão e sépia.',
    params: [num('scratches', 'Riscos %', 40, 0, 100), num('dust', 'Poeira %', 40, 0, 100), num('flicker', 'Flicker %', 30, 0, 100), num('jitter', 'Tremor (px)', 3, 0, 40),
      num('grain', 'Grão %', 25, 0, 100), num('sepia', 'Sépia %', 40, 0, 100), num('fps', 'Quadros/s do dano', 24, 1, 60), num('seed', 'Semente', 1, 0, 100, 1)],
    render: (src, p, env) => env.gl.pass(FILMDMG, { u_tex: src, u_scr: p.scratches / 100, u_dust: p.dust / 100, u_flick: p.flicker / 100, u_jit: p.jitter * env.scale, u_grain: p.grain / 100, u_sepia: p.sepia / 100, u_seed: p.seed, u_fr: p.fps || fr(env) }),
  },
  {
    type: 'bokeh', label: 'Bokeh', category: 'Desfoque', plugin: 'S_Bokeh / BCC Bokeh',
    description: 'Transforma os pontos de luz em discos de bokeh (círculo ou íris poligonal) e desfoca o fundo.',
    params: [num('radius', 'Tamanho do disco', 14, 1, 300), num('threshold', 'Limiar %', 82, 0, 100), num('amount', 'Brilho do bokeh %', 40, 0, 400),
      num('defocus', 'Desfocar imagem %', 40, 0, 100), num('sides', 'Lados da íris (0 = círculo)', 0, 0, 10, 1)],
    pad: (p) => p.radius,
    render: (src, p, env) => {
      const { gl } = env;
      const r = p.radius * env.scale;
      const base = p.defocus > 0 ? gl.mix(src, gl.blur(src, r * 0.45), p.defocus / 100) : src;
      const hi = gl.pass(HI, { u_tex: src, u_thr: p.threshold / 100 });
      return gl.pass(BOKEH, { u_tex: base, u_tex2: hi, u_r: r, u_sides: p.sides, u_amt: p.amount / 100 });
    },
  },
  {
    type: 'zap', label: 'Zap (raio elétrico)', category: 'Luz e brilho', plugin: 'S_Zap / BCC Lightning',
    description: 'Raio elétrico entre dois pontos, com galhos, brilho e nova forma a cada instante.',
    params: [pos('from', 'Início', [0.2, 0.2]), pos('to', 'Fim', [0.8, 0.75]), num('width', 'Espessura (px)', 4, 0.5, 60, 0.5), num('wiggle', 'Zigue-zague %', 12, 0, 60),
      num('detail', 'Detalhe', 6, 1, 20, 0.5), num('glow', 'Brilho', 1.5, 0, 6, 0.05), col('color', 'Cor', [0.55, 0.7, 1, 1]), num('branches', 'Galhos', 2, 0, 4, 1),
      num('speed', 'Mudanças por segundo', 12, 0, 60), bool('only', 'Só o raio', false)],
    render: (src, p, env) => {
      const sz = [src.w, src.h];
      const a = cuv(env, p.from), b = cuv(env, p.to);
      return env.gl.pass(ZAP, { u_tex: src, u_a: [a[0] * sz[0], a[1] * sz[1]], u_b: [b[0] * sz[0], b[1] * sz[1]], u_w: p.width * env.scale, u_amp: p.wiggle / 100,
        u_det: p.detail, u_glow: p.glow, u_col: rgb(p.color), u_br: p.branches, u_fseed: Math.floor(env.t * p.speed) * 1.618 + 0.5, u_only: p.only ? 1 : 0 });
    },
  },
  {
    type: 'aurora', label: 'Aurora', category: 'Luz e brilho', plugin: 'S_Aurora',
    description: 'Aurora boreal procedural: cortinas de luz com raios verticais que ondulam no tempo.',
    params: [num('intensity', 'Intensidade', 1.2, 0, 5, 0.05), num('speed', 'Velocidade', 0.6, 0, 5, 0.05), num('hue1', 'Cor de baixo (matiz)', 0.38, 0, 1, 0.01),
      num('hue2', 'Cor de cima (matiz)', 0.8, 0, 1, 0.01), num('height', 'Altura', 0.45, 0, 1, 0.01), num('scale', 'Escala', 1, 0.2, 5, 0.05), bool('only', 'Só a aurora', false)],
    render: (src, p, env) => env.gl.pass(AURORA, { u_tex: src, u_int: p.intensity, u_spd: p.speed, u_h1: p.hue1, u_h2: p.hue2, u_hgt: p.height, u_sc: p.scale, u_only: p.only ? 1 : 0 }),
  },
  {
    type: 'glowEdges', label: 'Glow Edges', category: 'Luz e brilho', plugin: 'S_GlowEdges / BCC Glow Edges',
    description: 'Contornos neon: detecta as bordas e faz elas brilharem (com a cor do vídeo ou uma cor fixa).',
    params: [num('threshold', 'Limiar das bordas', 0.15, 0, 1, 0.01), num('width', 'Largura do brilho', 12, 0, 200), num('amount', 'Intensidade', 1, 0, 5, 0.05),
      col('color', 'Cor', [0.2, 0.8, 1, 1]), bool('useSrc', 'Usar cores do vídeo', false), bool('only', 'Só as bordas', false)],
    pad: (p) => p.width * 2,
    render: (src, p, env) => {
      const { gl } = env;
      const e = gl.pass(EDGES, { u_tex: src, u_thr: p.threshold });
      const g = gl.blur(e, p.width * env.scale);
      return gl.pass(EDGEMIX, { u_tex: src, u_tex2: e, u_tex3: g, u_amt: p.amount, u_useSrc: p.useSrc ? 1 : 0, u_only: p.only ? 1 : 0, u_col: rgb(p.color) });
    },
  },
  {
    type: 'cartoon', label: 'Cartoon Look', category: 'Estilizar', plugin: 'BCC Cartoon Look / S_Cartooner',
    description: 'Visual de desenho: cores chapadas em níveis, contornos pretos e pele suavizada.',
    params: [num('smooth', 'Suavizar', 3, 0, 30, 0.5), num('levels', 'Níveis de cor', 6, 2, 20, 1), num('lines', 'Contorno %', 85, 0, 100), num('lineWidth', 'Espessura do contorno', 1.5, 0.5, 6, 0.1), num('saturation', 'Saturação %', 120, 0, 300)],
    render: (src, p, env) => {
      const { gl } = env;
      const b = gl.blur(src, p.smooth * env.scale);
      return gl.pass(CARTOON, { u_tex: src, u_tex2: b, u_lv: p.levels, u_lines: p.lines / 100, u_lw: p.lineWidth * env.scale, u_sat: p.saturation / 100 });
    },
  },
  {
    type: 'unmult', label: 'Unmult (preto vira transparente)', category: 'Cor', plugin: 'S_Unmult / BCC Unmult / Red Giant Unmult',
    description: 'Remove o fundo preto de elementos de luz (flares, partículas, fogo) sem escurecer o brilho.',
    params: [num('black', 'Ponto de preto %', 0, 0, 90), num('gamma', 'Gama do alfa', 1, 0.2, 4, 0.05)],
    render: (src, p, env) => env.gl.pass(UNMULT, { u_tex: src, u_blk: p.black / 100, u_gam: p.gamma }),
  },
  {
    type: 'clouds', label: 'Clouds / Fog', category: 'Estilizar', plugin: 'S_Clouds / BCC Fast Fog',
    description: 'Névoa e nuvens procedurais que se movem; pode ficar só no chão (horizonte).',
    params: [num('density', 'Densidade', 0.7, 0, 2, 0.01), num('speed', 'Velocidade', 0.4, 0, 5, 0.05), num('scale', 'Escala', 1, 0.2, 6, 0.05), num('horizon', 'Só embaixo (horizonte) %', 50, 0, 100),
      num('softness', 'Suavidade %', 60, 0, 100), col('color', 'Cor', [0.85, 0.88, 0.92, 1]), bool('only', 'Só a névoa', false)],
    render: (src, p, env) => env.gl.pass(CLOUDS, { u_tex: src, u_den: p.density, u_spd: p.speed, u_sc: p.scale, u_hor: p.horizon / 100, u_soft: p.softness / 100, u_col: rgb(p.color), u_only: p.only ? 1 : 0 }),
  },
  {
    type: 'sparkles', label: 'Sparkles', category: 'Luz e brilho', plugin: 'S_Sparkles / BCC Sparkles',
    description: 'Brilhos em estrela que piscam nos pontos claros da imagem.',
    params: [num('cell', 'Espaçamento (px)', 40, 6, 400), num('threshold', 'Limiar %', 65, 0, 100), num('length', 'Tamanho (px)', 30, 2, 400), num('amount', 'Brilho', 1.2, 0, 5, 0.05),
      num('twinkle', 'Piscar', 3, 0, 20, 0.1), num('rays', 'Raios', 4, 2, 12, 1), ang('rotate', 'Rotação', 0), col('color', 'Cor', [1, 1, 1, 1])],
    pad: (p) => p.length,
    render: (src, p, env) => env.gl.pass(SPARK, { u_tex: src, u_cell: p.cell * env.scale, u_thr: p.threshold / 100, u_len: p.length * env.scale, u_amt: p.amount, u_tw: p.twinkle, u_rays: p.rays, u_rot: rad(p.rotate), u_col: rgb(p.color) }),
  },
  {
    type: 'hotspots', label: 'Hotspots', category: 'Luz e brilho', plugin: 'S_Hotspots (Sapphire)',
    description: 'Mostra só as áreas mais claras que o limiar, com a cor original; o resto fica preto. Use com modo Adicionar/Tela numa cópia para brilho nos realces.',
    params: [num('threshold', 'Threshold', 0.7, 0, 2, 0.01), num('blur', 'Blur Input', 0, 0, 100, 0.5), col('addColor', 'Threshold Add Color', [0, 0, 0, 1]),
      num('saturation', 'Saturation', 1, 0, 4, 0.01), num('brightness', 'Brightness', 1, 0, 10, 0.01), num('soft', 'Suavidade da borda', 0.04, 0, 0.5, 0.005)],
    render: (src, p, env) => {
      const s = p.blur > 0 ? env.gl.blur(src, p.blur * env.scale) : src;
      return env.gl.pass(HOTSPOTS, { u_tex: s, u_thr: p.threshold, u_sat: p.saturation, u_bri: p.brightness, u_soft: Math.max(0.001, p.soft), u_addc: rgb(p.addColor) });
    },
  },
  {
    type: 'minimax', label: 'Minimax', category: 'Estilizar', plugin: 'Minimax (After Effects)',
    params: [sel('operation', 'Operação', ['Máximo (claro cresce)', 'Mínimo (escuro cresce)'], 1), num('radius', 'Raio', 3, 0, 40, 1), sel('direction', 'Direção', ['Horizontal e vertical', 'Só horizontal', 'Só vertical'], 1)],
    render: (src, p, env) => {
      const r = Math.round(p.radius * env.scale); if (r < 1) return src;
      let o = src; const mode = (p.operation | 0) === 2 ? 1 : 0;
      if ((p.direction | 0) !== 3) o = env.gl.pass(MINIMAX, { u_tex: o, u_dir: [1, 0], u_r: r, u_mode: mode });
      if ((p.direction | 0) !== 2) o = env.gl.pass(MINIMAX, { u_tex: o, u_dir: [0, 1], u_r: r, u_mode: mode });
      return o;
    },
  },
  {
    type: 'ccJaws', label: 'CC Jaws', category: 'Transições', plugin: 'CC Jaws (After Effects)',
    params: [num('completion', 'Completion %', 0, 0, 100), pos('center', 'Center', [0.5, 0.5]), sel('direction', 'Direção', ['Vertical (abre para cima/baixo)', 'Horizontal'], 1), num('height', 'Altura dos dentes %', 8, 0, 100), num('width', 'Largura dos dentes %', 10, 1, 100)],
    render: (src, p, env) => env.gl.pass(JAWS, { u_tex: src, u_comp: p.completion / 100, u_c: p.center, u_hgt: p.height / 100, u_teeth: 100 / Math.max(1, p.width), u_horiz: (p.direction | 0) === 2 ? 1 : 0 }),
  },
  {
    type: 'cardWipe', label: 'Card Wipe', category: 'Transições', plugin: 'Card Wipe (After Effects)',
    params: [num('completion', 'Transition Completion %', 0, 0, 100), num('width', 'Transition Width %', 50, 1, 100), num('rows', 'Rows', 1, 1, 100, 1), num('columns', 'Columns', 10, 1, 100, 1),
      sel('axis', 'Flip Axis', ['X', 'Y'], 1), sel('order', 'Flip Order', ['Esquerda → direita', 'Cima → baixo', 'Aleatório'], 1), num('seed', 'Semente', 1, 0, 100, 1)],
    render: (src, p, env) => env.gl.pass(CARDS, { u_tex: src, u_comp: p.completion / 100, u_rows: Math.max(1, p.rows), u_cols: Math.max(1, p.columns), u_width: p.width, u_axis: p.axis, u_order: p.order, u_rnd: p.seed }),
  },
  {
    type: 'polytrace', label: 'Polytrace (low poly)', category: 'Estilizar', plugin: 'Polytrace (Cinema Spice)',
    description: 'Pontos nas bordas da imagem ligados por linhas (visual low-poly / plexus).',
    params: [num('size', 'Size (espaçamento px)', 40, 6, 400), num('threshold', 'Threshold', 0.25, 0, 2, 0.01), num('lineWidth', 'Espessura da linha', 1.5, 0.3, 10, 0.1), num('point', 'Tamanho do ponto', 3, 0, 20, 0.5),
      num('amount', 'Intensidade', 1, 0, 3, 0.05), col('color', 'Cor', [1, 1, 1, 1]), bool('only', 'Esconder a imagem', false)],
    render: (src, p, env) => env.gl.pass(POLY, { u_tex: src, u_cell: Math.max(4, p.size * env.scale), u_thr: p.threshold, u_lw: p.lineWidth * env.scale, u_pt: Math.max(0.1, p.point * env.scale), u_amt: p.amount, u_col: rgb(p.color), u_fill: p.only ? 1 : 0 }),
  },
  {
    type: 'autoPaint', label: 'AutoPaint (pintura)', category: 'Estilizar', plugin: 'S_AutoPaint (Sapphire)',
    description: 'Transforma o vídeo em pintura: pinceladas que mantêm as bordas e textura de tela.',
    params: [num('brush', 'Tamanho do pincel', 8, 1, 60, 0.5), num('frequency', 'Detalhe (Frequency)', 50, 0, 200), num('texture', 'Textura da tela %', 15, 0, 100)],
    render: (src, p, env) => {
      const r = p.brush * env.scale * (1.4 - Math.min(1, p.frequency / 200));
      let o = env.gl.pass(PAINT, { u_tex: src, u_r: r, u_tex2s: 0 });
      return env.gl.pass(PAINT, { u_tex: o, u_r: r * 0.5, u_tex2s: p.texture / 100 * 0.12 });
    },
  },
];
