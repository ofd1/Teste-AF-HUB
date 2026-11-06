// Efeitos criados a partir do inventário dos plugins do usuário (scanner .aex): Sapphire, Continuum (BCC),
// Red Giant Universe e outros que ainda não tinham equivalente. São recriações próprias (mesma ideia visual e
// mesmos nomes de controle), agrupadas em famílias com vários modos — cada plugin importado escolhe o seu modo.
import { frag, num, ang, col, bool, sel, pos, rgb, rad } from './common.js';

const VORO = `
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
vec3 voro(vec2 x) { // F1, F2, id
  vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = hash2(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash(n + g); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
float plasma(vec2 p, float t) { return 0.5 + 0.25 * (sin(p.x * 3.1 + t) + sin(p.y * 2.7 - t * 1.3) + sin((p.x + p.y) * 2.3 + t * 0.7) + sin(length(p) * 4.0 - t)) * 0.5; }
`;

// --------------------------------------------------------------------- 1) TRANSIÇÕES: wipes e dissolves
const WIPE_MODES = ['Linear', 'Relógio (clock)', 'Círculo (iris)', 'Retângulo', 'Estrela', 'Losango', 'Xadrez (checker)', 'Listras', 'Cunha (wedge)', 'Cunha dupla',
  'Quatro cunhas', 'Anéis', 'Pontos', 'Bolhas / nuvens', 'Células', 'Difuso (pixels)', 'Luma (pelo brilho)', 'Plasma', 'Moiré', 'Trama (weave)', 'Pontilhado', 'Grade', 'Persianas (blinds)', 'Estática', 'Espiral', 'Flux'];
const WIPE = frag(`${VORO}
uniform sampler2D u_tex2; uniform float u_mode, u_pct, u_ang, u_soft, u_bw, u_freq, u_inv, u_glow, u_dist, u_blurAmt, u_seed, u_asp;
uniform vec2 u_c; uniform vec3 u_bcol;
float field(vec2 c, vec4 s) {
  float m = u_mode; vec2 q = c - u_c; q.x *= u_asp; float d = length(q), th = atan(q.y, q.x);
  vec2 dir = vec2(cos(u_ang), sin(u_ang));
  float lin = dot(c - 0.5, dir) / (abs(dir.x) * 0.5 + abs(dir.y) * 0.5 + 1e-4) * 0.5 + 0.5;
  float maxd = length(max(u_c, 1.0 - u_c) * vec2(u_asp, 1.0)) + 1e-4;
  vec2 g = c * u_freq * vec2(u_asp, 1.0); vec2 cell = floor(g); vec2 fc = fract(g);
  if (m < 1.5) return lin;
  if (m < 2.5) return fract((th - u_ang) / 6.28318 + 1.0);
  if (m < 3.5) return d / maxd;
  if (m < 4.5) return max(abs(q.x) / (max(u_c.x, 1.0 - u_c.x) * u_asp + 1e-4), abs(q.y) / (max(u_c.y, 1.0 - u_c.y) + 1e-4));
  if (m < 5.5) return d * (0.75 + 0.25 * cos(5.0 * (th - u_ang))) / maxd;
  if (m < 6.5) return (abs(q.x) + abs(q.y)) / (maxd * 1.42);
  if (m < 7.5) { float ch = mod(cell.x + cell.y, 2.0); return ch * 0.5 + 0.5 * dot(fc, abs(dir)) / (abs(dir.x) + abs(dir.y)); }
  if (m < 8.5) { float a = dot(c, vec2(-dir.y, dir.x)) * u_freq; return mod(floor(a), 2.0) < 0.5 ? lin : 1.0 - lin; }
  if (m < 9.5) return abs(mod(th - u_ang + 3.14159, 6.28318) - 3.14159) / 3.14159;
  if (m < 10.5) return abs(abs(mod(th - u_ang + 3.14159, 6.28318) - 3.14159) - 1.5708) / 1.5708;
  if (m < 11.5) return fract((th - u_ang) * 4.0 / 6.28318);
  if (m < 12.5) return fract(d * u_freq * 0.5);
  if (m < 13.5) return length(fc - 0.5) * 1.414;
  if (m < 14.5) return fbm(c * u_freq * 0.6 + u_seed, 5);
  if (m < 15.5) { vec3 v = voro(g * 0.5 + u_seed); return v.z * 0.7 + v.x * 0.3; }
  if (m < 16.5) return hash(floor(v_uv / max(u_texel, vec2(1e-5))) + u_seed);
  if (m < 17.5) return luma(unpre(s).rgb);
  if (m < 18.5) return plasma(c * u_freq * 0.5, u_seed);
  if (m < 19.5) return 0.5 + 0.5 * sin(d * u_freq * 12.0) * sin(c.x * u_freq * 9.0);
  if (m < 20.5) { float w = mod(cell.x + cell.y, 2.0) < 0.5 ? fc.x : fc.y; return w; }
  if (m < 21.5) return hash(cell + u_seed);
  if (m < 22.5) return max(abs(fc.x - 0.5), abs(fc.y - 0.5)) * 2.0;
  if (m < 23.5) return fract(lin * u_freq);
  if (m < 24.5) return hash(floor(v_uv / max(u_texel, vec2(1e-5)) / 3.0) + floor(u_time * 24.0));
  if (m < 25.5) return fract(d / maxd * u_freq * 0.25 + th / 6.28318);
  return fbm(c * u_freq * 0.4 + vec2(fbm(c * 3.0 + u_seed, 3)) * 2.0, 4);
}
void main() {
  vec2 c = contentUV(v_uv);
  vec4 s0 = texture2D(u_tex, v_uv);
  float f = field(c, s0); if (u_inv > 0.5) f = 1.0 - f;
  float t = u_pct * (1.0 + 2.0 * u_soft) - u_soft;                 // 0% = tudo visível, 100% = nada
  float band = 1.0 - smoothstep(0.0, u_soft + u_bw + 0.02, abs(f - t));
  vec2 uv = v_uv + (vec2(vnoise(c * 9.0 + u_seed), vnoise(c * 9.0 + 7.0 + u_seed)) - 0.5) * u_dist * band * 0.15;
  vec4 s = mix(texture2D(u_tex, uv), texture2D(u_tex2, uv), clamp(band * u_blurAmt, 0.0, 1.0));
  float k = smoothstep(t - u_soft - 1e-4, t + u_soft + 1e-4, f);
  float border = u_bw > 0.0 ? (1.0 - smoothstep(0.0, u_bw, abs(f - t))) : 0.0;
  vec3 rc = unpre(s).rgb; float a = s.a * k;
  rc += u_bcol * band * u_glow;
  vec4 o = pre(vec4(clamp(rc, 0.0, 1.0), a));
  o = mix(o, vec4(u_bcol, 1.0) * s.a, border * step(0.001, u_pct) * step(u_pct, 0.999));
  gl_FragColor = o;
}`);

// --------------------------------------------------------------------- 2) TEXTURAS / GERADORES
const TEX_MODES = ['Plasma', 'Células', 'Moiré', 'Trama (weave)', 'Manchas (spots)', 'Loops', 'Flux', 'Neurônios', 'Espiral cromática', 'Dobrada (folded)', 'Micro', 'Ruído em relevo',
  'Grade', 'Grunge', 'Céu noturno (estrelas)', 'Gradiente linear', 'Gradiente radial', 'Gradiente 3 cores', 'Fundo suave', 'Fundo fractal', 'Espectro (spectralicious)', 'Nuvens',
  'Mármore', 'Granito', 'Pedra', 'Madeira', 'Aço escovado', 'Tijolo', 'Lua', 'Caustics (água)'];
const TEX = frag(`${VORO}
uniform float u_mode, u_tsc, u_speed, u_evo, u_con, u_op, u_blend, u_ang, u_asp;
uniform vec3 u_c1, u_c2, u_c3; uniform vec2 u_cen;
vec3 pal(float v) { v = clamp((v - 0.5) * u_con + 0.5, 0.0, 1.0); return v < 0.5 ? mix(u_c1, u_c2, v * 2.0) : mix(u_c2, u_c3, v * 2.0 - 1.0); }
void main() {
  vec4 s = texture2D(u_tex, v_uv); vec3 src = unpre(s).rgb;
  vec2 c = contentUV(v_uv); vec2 p = (c - 0.5) * vec2(u_asp, 1.0) * u_tsc; float t = u_time * u_speed + u_evo; float m = u_mode; float v = 0.0; vec3 o;
  float d = length(p), th = atan(p.y, p.x);
  if (m < 1.5) v = plasma(p, t);
  else if (m < 2.5) { vec3 w = voro(p + t * 0.1); v = w.y - w.x; v = smoothstep(0.0, 0.25, v); }
  else if (m < 3.5) v = 0.5 + 0.5 * sin(d * 30.0 + t) * sin(p.x * 25.0 - t * 0.5);
  else if (m < 4.5) { vec2 g = fract(p * 2.0) - 0.5, id = floor(p * 2.0); v = mod(id.x + id.y, 2.0) < 0.5 ? smoothstep(0.1, 0.0, abs(g.x) - 0.35) : smoothstep(0.1, 0.0, abs(g.y) - 0.35); v *= 0.6 + 0.4 * sin((mod(id.x + id.y, 2.0) < 0.5 ? g.y : g.x) * 6.28); }
  else if (m < 5.5) { vec3 w = voro(p * 1.5 + t * 0.05); v = 1.0 - smoothstep(0.0, 0.5, w.x) + w.z * 0.3; }
  else if (m < 6.5) v = 0.5 + 0.5 * sin(d * 18.0 - t * 2.0 + sin(th * 3.0) * 2.0);
  else if (m < 7.5) { vec2 q = p + vec2(fbm(p + t * 0.1, 4), fbm(p + 5.2 - t * 0.1, 4)) * 2.0; v = fbm(q, 5); }
  else if (m < 8.5) { vec3 w = voro(p * 2.0 + t * 0.05); v = pow(1.0 - smoothstep(0.0, 0.08, w.y - w.x), 2.0); }
  else if (m < 9.5) { float a = th + d * 6.0 - t; o = 0.5 + 0.5 * cos(a + vec3(0.0, 2.1, 4.2)); v = -1.0; }
  else if (m < 10.5) v = abs(sin(fbm(p * 1.5 + t * 0.1, 4) * 12.0));
  else if (m < 11.5) v = fbm(p * 6.0 + t * 0.2, 6);
  else if (m < 12.5) { float e = 0.01; float h0 = fbm(p * 3.0 + t * 0.1, 5), h1 = fbm(p * 3.0 + vec2(e, 0.0) + t * 0.1, 5); v = 0.5 + (h1 - h0) * 40.0; }
  else if (m < 13.5) { vec2 g = abs(fract(p * 2.0) - 0.5); v = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y)); }
  else if (m < 14.5) v = smoothstep(0.35, 0.8, fbm(p * 4.0 + t * 0.05, 6)) * (0.6 + 0.4 * hash(floor(c * 400.0)));
  else if (m < 15.5) { float st = pow(hash(floor(c * vec2(u_asp, 1.0) * 220.0 * u_tsc)), 60.0) * (0.6 + 0.4 * sin(t * 3.0 + hash(floor(c * 333.0)) * 30.0)); o = mix(u_c1, u_c3, st); o += u_c2 * fbm(p * 1.5, 4) * 0.25; v = -1.0; }
  else if (m < 16.5) { vec2 dir = vec2(cos(u_ang), sin(u_ang)); v = dot(c - 0.5, dir) / (abs(dir.x) * 0.5 + abs(dir.y) * 0.5 + 1e-4) * 0.5 + 0.5; }
  else if (m < 17.5) v = length((c - u_cen) * vec2(u_asp, 1.0)) / 0.7;
  else if (m < 18.5) { v = c.y; }
  else if (m < 19.5) { v = 0.5 + 0.5 * sin(c.x * 3.0 + t * 0.4) * cos(c.y * 2.0 - t * 0.3); }
  else if (m < 20.5) v = fbm(p * 0.8 + vec2(fbm(p * 0.8 + t * 0.05, 4)) * 1.5, 6);
  else if (m < 21.5) { o = 0.5 + 0.5 * cos(6.28318 * (c.x * u_tsc * 0.25 + t * 0.1) + vec3(0.0, 2.1, 4.2)); v = -1.0; }
  else if (m < 22.5) v = fbm(p + t * 0.05, 6);
  else if (m < 23.5) v = 0.5 + 0.5 * sin(p.x * 3.0 + fbm(p * 2.0, 6) * 9.0);
  else if (m < 24.5) v = fbm(p * 8.0, 6) * 0.6 + hash(floor(c * 600.0)) * 0.4;
  else if (m < 25.5) { vec3 w = voro(p * 2.0); v = w.x * 0.6 + fbm(p * 5.0, 5) * 0.4; }
  else if (m < 26.5) v = fract((p.y + fbm(p * vec2(0.5, 3.0), 4) * 0.6) * 6.0);
  else if (m < 27.5) v = 0.55 + 0.45 * fbm(p * vec2(60.0, 1.0), 4);
  else if (m < 28.5) { vec2 b = p * vec2(1.0, 2.0); b.x += mod(floor(b.y), 2.0) * 0.5; vec2 f = fract(b); v = smoothstep(0.0, 0.05, f.x) * smoothstep(0.0, 0.05, f.y) * smoothstep(1.0, 0.95, f.x) * smoothstep(1.0, 0.95, f.y) * (0.7 + 0.3 * hash(floor(b))); }
  else if (m < 29.5) { float r = length((c - u_cen) * vec2(u_asp, 1.0)); float disk = 1.0 - smoothstep(0.18, 0.185, r); v = disk * (0.75 + 0.25 * fbm(p * 3.0, 5)); }
  else { vec2 q = p * 3.0; float k = 0.0; for (int i = 0; i < 3; i++) { vec3 w = voro(q + t * 0.3 * float(i + 1)); k += 1.0 - smoothstep(0.0, 0.12, w.y - w.x); q *= 1.7; } v = k / 3.0; }
  if (v >= 0.0) o = pal(v);
  vec3 r;
  if (u_blend < 1.5) r = o;                                 // substituir
  else if (u_blend < 2.5) r = src * o;                      // multiplicar
  else if (u_blend < 3.5) r = 1.0 - (1.0 - src) * (1.0 - o); // tela
  else if (u_blend < 4.5) r = src + o;                      // adicionar
  else r = mix(2.0 * src * o, 1.0 - 2.0 * (1.0 - src) * (1.0 - o), step(0.5, src)); // sobrepor
  float a = u_blend < 1.5 ? 1.0 : s.a;
  vec3 res = mix(src, r, u_op);
  gl_FragColor = pre(vec4(clamp(res, 0.0, 1.0), mix(s.a, a, u_op)));
}`);

// --------------------------------------------------------------------- 3) COR
const COLOR_MODES = ['Gamma (por canal)', 'Monocromático', 'Tritone', 'Quadtone', 'Posterizar suave', 'Solarizar', 'Limiar suave', 'Pseudocor (arco-íris)', 'Cor mais próxima (paleta)',
  'Trocar canais', 'Limitar croma', 'Bleach Bypass', 'Vintage 2 tiras', 'Vintage 3 tiras', 'Visão de cachorro', 'Temperatura (Kelvin)', 'Alto contraste', 'Baixo contraste',
  'Saturação seletiva (manter 1 cor)', 'Fluorescente', 'Polarizador', 'Revelação (develop)', 'Superexposição', 'Inverter + solarizar', 'Cores seguras (broadcast)', 'Mix de tons (multitone)', 'Tom suave (pele)'];
const COLOROPS = frag(`
uniform float u_mode, u_amt, u_lvl, u_hue, u_range, u_temp, u_perm; uniform vec3 u_c1, u_c2, u_c3, u_c4, u_gam;
vec3 nearest(vec3 c) { vec3 best = u_c1; float bd = distance(c, u_c1); float d;
  d = distance(c, u_c2); if (d < bd) { bd = d; best = u_c2; } d = distance(c, u_c3); if (d < bd) { bd = d; best = u_c3; } d = distance(c, u_c4); if (d < bd) { best = u_c4; } return best; }
void main() {
  vec4 s = texture2D(u_tex, v_uv); vec3 c = unpre(s).rgb, o = c; float L = luma(c); float m = u_mode;
  if (m < 1.5) o = pow(max(c, 0.0), 1.0 / max(u_gam, vec3(0.01)));
  else if (m < 2.5) o = L * u_c1 * 1.2;
  else if (m < 3.5) o = L < 0.5 ? mix(u_c1, u_c2, L * 2.0) : mix(u_c2, u_c3, L * 2.0 - 1.0);
  else if (m < 4.5) { float x = L * 3.0; o = x < 1.0 ? mix(u_c1, u_c2, x) : (x < 2.0 ? mix(u_c2, u_c3, x - 1.0) : mix(u_c3, u_c4, x - 2.0)); }
  else if (m < 5.5) { vec3 q = c * u_lvl; o = (floor(q) + smoothstep(0.35, 0.65, fract(q))) / u_lvl; }
  else if (m < 6.5) o = mix(c, 1.0 - c, smoothstep(u_lvl / 10.0 - 0.05, u_lvl / 10.0 + 0.05, c));
  else if (m < 7.5) o = vec3(smoothstep(u_lvl / 10.0 - 0.06, u_lvl / 10.0 + 0.06, L));
  else if (m < 8.5) o = hsv2rgb(vec3(fract(L * u_lvl * 0.2 + u_hue / 360.0), 0.9, 1.0));
  else if (m < 9.5) o = nearest(c);
  else if (m < 10.5) { float k = u_perm; o = k < 1.5 ? c.gbr : (k < 2.5 ? c.brg : (k < 3.5 ? c.rbg : (k < 4.5 ? c.bgr : c.grb))); }
  else if (m < 11.5) { vec3 h = rgb2hsv(c); h.y = min(h.y, u_lvl / 10.0); o = hsv2rgb(h); }
  else if (m < 12.5) { vec3 ov = mix(2.0 * c * L, 1.0 - 2.0 * (1.0 - c) * (1.0 - L), step(0.5, L)); o = mix(c, ov, 0.7); o = mix(vec3(luma(o)), o, 0.55); }
  else if (m < 13.5) { float rg = c.r, cy = (c.g + c.b) * 0.5; o = vec3(rg, cy, cy * 0.95); }
  else if (m < 14.5) { o = vec3(c.r, (c.g * 0.8 + c.r * 0.2), c.b * 0.9 + c.g * 0.1); o = mix(vec3(luma(o)), o, 1.15); }
  else if (m < 15.5) { float y = (c.r + c.g) * 0.5; o = vec3(y, y, c.b); }
  else if (m < 16.5) { float k = u_temp / 100.0; o = c * vec3(1.0 + 0.25 * k, 1.0 + 0.05 * k, 1.0 - 0.3 * k); }
  else if (m < 17.5) { o = smoothstep(0.08, 0.92, c); o = smoothstep(0.0, 1.0, o); }
  else if (m < 18.5) o = 0.15 + c * 0.7;
  else if (m < 19.5) { vec3 h = rgb2hsv(c); float dh = abs(mod(h.x * 360.0 - u_hue + 180.0, 360.0) - 180.0); float keep = 1.0 - smoothstep(u_range, u_range + 20.0, dh); o = mix(vec3(L), c, keep); }
  else if (m < 20.5) { vec3 h = rgb2hsv(c); h.y = min(1.0, h.y * 1.8); h.z = min(1.0, h.z * 1.15); o = hsv2rgb(h); o = mix(o, o * vec3(0.9, 1.1, 1.2), 0.3); }
  else if (m < 21.5) { o = c * vec3(0.92, 1.0, 1.08); o = mix(vec3(luma(o)), o, 1.25); o = pow(o, vec3(1.1)); }
  else if (m < 22.5) { o = pow(c, vec3(0.85)); o = mix(vec3(luma(o)), o, 1.2); o = smoothstep(0.02, 0.98, o); }
  else if (m < 23.5) o = 1.0 - exp(-c * (1.0 + u_lvl));
  else if (m < 24.5) o = 1.0 - abs(1.0 - 2.0 * c);
  else if (m < 25.5) { o = clamp(c, 16.0 / 255.0, 235.0 / 255.0); vec3 h = rgb2hsv(o); h.y = min(h.y, 0.85); o = hsv2rgb(h); }
  else if (m < 26.5) { vec3 t1 = L * u_c1, t2 = L * u_c2; o = mix(t1, t2, smoothstep(0.3, 0.7, L)) * 1.4; o = mix(c, o, 0.6); }
  else { vec3 b = vec3(0.0); float w = 0.0; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) { vec3 n = unpre(texture2D(u_tex, v_uv + vec2(float(i), float(j)) * u_texel * 2.0)).rgb; float ww = exp(-dot(n - c, n - c) * 40.0); b += n * ww; w += ww; } o = b / w; }
  o = mix(c, o, u_amt);
  gl_FragColor = pre(vec4(clamp(o, 0.0, 1.0), s.a));
}`);

// --------------------------------------------------------------------- 4) ESTILIZAR
const STY_MODES = ['Relevo (emboss)', 'Relevo brilhante', 'Relevo de vidro', 'Esboço (sketch)', 'Gravura (etching)', 'Hachura (crosshatch)', 'Olho de mosca – quadrado', 'Olho de mosca – hexágono',
  'Olho de mosca – círculos', 'Zebra', 'Zebra colorida', 'Colorir bordas', 'Bordas em direção', 'Passa-banda (band pass)', 'Difuso (espalhar)', 'Pincel (pintura)', 'Scatterize', 'Névoa (frost)',
  'Halo', 'Seda (silk)', 'Rede (net)', 'Linhas de varredura', 'Desalinhamento (RGB)', 'Mosaico de vidro', 'Bloom alto contraste'];
const STY = frag(`${VORO}
uniform float u_mode, u_amt, u_sz, u_ang, u_freq, u_seed; uniform vec3 u_c1, u_c2;
vec3 tx(vec2 uv) { return unpre(texture2D(u_tex, uv)).rgb; }
void main() {
  vec4 s = texture2D(u_tex, v_uv); vec3 c = unpre(s).rgb, o = c; float m = u_mode; vec2 px = u_texel * max(u_sz, 0.5); vec2 dir = vec2(cos(u_ang), sin(u_ang));
  vec2 cc = contentUV(v_uv);
  float gx = luma(tx(v_uv + vec2(px.x, 0.0))) - luma(tx(v_uv - vec2(px.x, 0.0)));
  float gy = luma(tx(v_uv + vec2(0.0, px.y))) - luma(tx(v_uv - vec2(0.0, px.y)));
  float e = length(vec2(gx, gy));
  if (m < 1.5) o = vec3(0.5 + dot(vec2(gx, gy), dir) * 2.0);
  else if (m < 2.5) { vec3 n = normalize(vec3(-gx * 4.0, -gy * 4.0, 1.0)); float l = max(dot(n, normalize(vec3(dir, 0.8))), 0.0); o = c * (0.4 + 0.8 * l) + pow(l, 24.0) * 0.8; }
  else if (m < 3.5) { o = tx(v_uv + vec2(gx, gy) * px * 30.0) * 1.05 + pow(max(dot(normalize(vec3(-gx, -gy, 0.2)), vec3(dir, 0.5)), 0.0), 16.0) * 0.4; }
  else if (m < 4.5) o = vec3(1.0 - smoothstep(0.02, 0.2, e * 3.0));
  else if (m < 5.5) { float L = luma(c); float ln = sin((cc.x * dir.x + cc.y * dir.y) * u_freq * 300.0) * 0.5 + 0.5; o = vec3(step(ln, L * 1.1)); }
  else if (m < 6.5) { float L = luma(c); vec2 q = v_uv / u_texel / max(u_sz, 1.0); float h1 = step(0.5, fract((q.x + q.y) * 0.25)), h2 = step(0.5, fract((q.x - q.y) * 0.25)); o = vec3(1.0); if (L < 0.75) o *= h1; if (L < 0.45) o *= h2; if (L < 0.2) o *= 0.0; o = mix(o, o * c / max(L, 0.01) * 0.5 + 0.5 * o, 0.0); }
  else if (m < 9.5) {
    vec2 g = cc * u_freq * vec2(u_sz * 0.0 + 1.0, 1.0); vec2 id, f;
    if (m < 7.5) { id = floor(g); f = fract(g) - 0.5; }
    else if (m < 8.5) { vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5; vec2 a = mod(g, r) - h, b = mod(g - h, r) - h; vec2 gg = dot(a, a) < dot(b, b) ? a : b; id = floor(g - gg + 0.5); f = gg; }
    else { id = floor(g); f = fract(g) - 0.5; }
    vec2 suv = fromContent((id + 0.5) / u_freq + f / u_freq * 1.8);
    o = tx(suv) * (1.0 - smoothstep(0.42, 0.5, length(f)) * (m > 8.5 ? 1.0 : 0.25));
  }
  else if (m < 10.5) { float z = sin((dot(cc, dir.yx * vec2(1.0, -1.0)) + luma(c) * 0.3) * u_freq * 60.0); o = vec3(step(0.0, z)); }
  else if (m < 11.5) { float z = sin((dot(cc, dir.yx * vec2(1.0, -1.0)) + luma(c) * 0.3) * u_freq * 60.0); o = mix(u_c1, u_c2, step(0.0, z)) * (0.4 + luma(c)); }
  else if (m < 12.5) o = c + hsv2rgb(vec3(fract(atan(gy, gx) / 6.28318), 1.0, 1.0)) * smoothstep(0.02, 0.2, e * 3.0);
  else if (m < 13.5) o = vec3(smoothstep(0.0, 0.15, abs(dot(vec2(gx, gy), dir)) * 3.0)) * u_c1;
  else if (m < 14.5) { vec3 b = unpre(texture2D(u_tex, v_uv + px * 2.0)).rgb; o = clamp((c - b) * 4.0 + 0.5, 0.0, 1.0); }
  else if (m < 15.5) o = tx(v_uv + (vec2(hash(v_uv * 731.0 + u_seed), hash(v_uv * 377.0 + u_seed)) - 0.5) * px * 8.0);
  else if (m < 16.5) { vec3 acc = vec3(0.0); for (int i = -3; i <= 3; i++) acc += tx(v_uv + dir * float(i) * px * 1.5 + vec2(-dir.y, dir.x) * vnoise(v_uv * 200.0) * px * 2.0); o = acc / 7.0; }
  else if (m < 17.5) { vec3 w = voro(cc * u_freq * 4.0 + u_seed); o = tx(fromContent((floor(cc * u_freq * 4.0) + w.z) / (u_freq * 4.0))); o = mix(c, o, step(0.5, hash(floor(cc * 300.0) + u_seed))); }
  else if (m < 18.5) { vec3 b = vec3(0.0); for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) b += tx(v_uv + vec2(float(i), float(j)) * px * 3.0); b /= 25.0; o = mix(b, vec3(1.0), 0.18) + c * 0.15; }
  else if (m < 19.5) { vec3 b = vec3(0.0); for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) b += tx(v_uv + vec2(float(i), float(j)) * px * 4.0); b /= 25.0; o = max(c, b * smoothstep(0.5, 0.9, luma(b)) * 1.4 * u_c1); }
  else if (m < 20.5) { vec3 b = vec3(0.0); for (int i = -3; i <= 3; i++) b += tx(v_uv + dir * float(i) * px * 4.0); b /= 7.0; o = max(c, b * 0.6 + c * 0.4); }
  else if (m < 21.5) { vec3 b = vec3(0.0); for (int i = -3; i <= 3; i++) { b += tx(v_uv + vec2(float(i), 0.0) * px * 4.0) + tx(v_uv + vec2(0.0, float(i)) * px * 4.0); } b /= 14.0; o = max(c, b * smoothstep(0.55, 1.0, luma(b)) * 1.3); }
  else if (m < 22.5) o = c * (1.0 - 0.5 * step(0.5, fract(v_uv.y / u_texel.y / max(u_sz, 1.0) * 0.5)));
  else if (m < 23.5) o = vec3(tx(v_uv + dir * px * 4.0).r, c.g, tx(v_uv - dir * px * 4.0).b);
  else if (m < 24.5) { vec3 w = voro(cc * u_freq * 3.0); o = tx(v_uv + (vec2(w.z, fract(w.z * 7.0)) - 0.5) * px * 20.0) * (0.85 + 0.15 * smoothstep(0.0, 0.08, w.y - w.x)); }
  else { vec3 b = vec3(0.0); for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) b += tx(v_uv + vec2(float(i), float(j)) * px * 5.0); b /= 25.0; o = smoothstep(0.1, 0.9, c) + b * smoothstep(0.6, 1.0, luma(b)); }
  o = mix(c, o, u_amt);
  gl_FragColor = pre(vec4(clamp(o, 0.0, 1.0), s.a));
}`);

// --------------------------------------------------------------------- 5) DISTORÇÃO (e transições de movimento)
const DIS_MODES = ['Hyper Push (empurrar)', 'Hyper Pull (puxar)', 'Zoom infinito', 'Faixas em paralaxe', 'Esticar bordas', 'Deslizar faixas', 'Twister (torcer)', 'Lente – barril', 'Grande angular',
  'Reflexo (espelho embaixo)', 'Deslocamento polar', 'Cilindro', 'Esfera', 'Virar carta (card flip)', 'Cubo', 'Dobrar (fold)', 'Deslizar (slide)', 'Swish pan', 'Crash zoom', 'Cross zoom',
  'Pan and zoom', 'Imagem na imagem (PiP)', 'Enrolar página (curl)', 'Encolher (shrink ray)', 'Carrossel', 'Persiana 3D (blinds)'];
const DIS = frag(`
uniform float u_mode, u_amt, u_pct, u_ang, u_freq, u_asp; uniform vec2 u_c;
vec4 S(vec2 c) { return (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) ? vec4(0.0) : texture2D(u_tex, fromContent(c)); }
void main() {
  vec2 c = contentUV(v_uv); vec2 q = c - u_c; float m = u_mode; float a = u_amt; float t = u_pct; vec2 dir = vec2(cos(u_ang), sin(u_ang)); vec4 o; float d = length(q * vec2(u_asp, 1.0));
  if (m < 1.5) o = S(u_c + q / (1.0 + a * (1.0 - d) * 1.5));
  else if (m < 2.5) o = S(u_c + q * (1.0 + a * (1.0 - d) * 1.5) / (1.0 + a));
  else if (m < 3.5) { float z = exp2(fract(u_time * a * 0.5 + t * 2.0)); vec2 p = q / z; o = S(u_c + p); vec4 o2 = S(u_c + p * 2.0); float inner = step(max(abs(p.x), abs(p.y)), 0.25); o = mix(o, o2, 0.0); o = max(abs(p.x), abs(p.y)) < 0.5 ? S(u_c + p) : S(u_c + p * 0.5); }
  else if (m < 4.5) { float id = floor(dot(c, vec2(-dir.y, dir.x)) * u_freq); float off = (hash(vec2(id, 3.0)) - 0.5) * a * 0.4 * (sin(u_time * 2.0 + id) * 0.5 + 0.5 + t); o = S(c + dir * off); }
  else if (m < 5.5) { vec2 p = clamp(c, vec2(a * 0.25), vec2(1.0 - a * 0.25)); o = S(c.x < a * 0.25 || c.x > 1.0 - a * 0.25 || c.y < a * 0.25 || c.y > 1.0 - a * 0.25 ? p : c); }
  else if (m < 6.5) { float id = floor(dot(c, vec2(-dir.y, dir.x)) * u_freq); float sgn = mod(id, 2.0) < 0.5 ? 1.0 : -1.0; o = S(c + dir * sgn * t * (1.0 + hash(vec2(id, 1.0)) * 0.5)); }
  else if (m < 7.5) { float ang = a * 3.0 * (c.y - 0.5) + t * 6.28; float x = (c.x - 0.5) / max(abs(cos(ang)), 0.05) + 0.5; o = S(vec2(x, c.y)) * (0.6 + 0.4 * abs(cos(ang))); }
  else if (m < 8.5) { float r2 = dot(q * vec2(u_asp, 1.0), q * vec2(u_asp, 1.0)); o = S(u_c + q * (1.0 + a * r2 * 2.0) / (1.0 + a * 0.5)); }
  else if (m < 9.5) { float r2 = dot(q * vec2(u_asp, 1.0), q * vec2(u_asp, 1.0)); o = S(u_c + q * (1.0 - a * r2 * 1.2) / (1.0 - a * 0.25)); }
  else if (m < 10.5) { float h = 1.0 - a * 0.5; if (c.y < h) o = S(vec2(c.x, c.y / h)); else { float yy = 1.0 - (c.y - h) / h; o = S(vec2(c.x, yy)) * (1.0 - (c.y - h) / max(1.0 - h, 1e-3)) * 0.5; } }
  else if (m < 11.5) { float r = d / 0.7, th = atan(q.y, q.x); o = S(vec2(fract(th / 6.28318 + 0.5), r)); o = mix(S(c), o, a); }
  else if (m < 12.5) { float x = q.x * 2.0; float xx = asin(clamp(x * a + x * (1.0 - a) * 0.0, -1.0, 1.0)) / 1.5708 * 0.5 + 0.5; o = abs(x) <= 1.0 ? S(vec2(mix(c.x, xx, a), c.y)) * (1.0 - a * 0.4 * x * x) : vec4(0.0); }
  else if (m < 13.5) { vec2 p = q * 2.0; float r = length(p); if (r > 1.0) o = mix(S(c), vec4(0.0), a); else { float z = sqrt(1.0 - r * r); vec2 uv = p * (asin(r) / max(r, 1e-4)) / 1.5708 * 0.5 + 0.5; o = mix(S(c), S(uv) * (0.5 + 0.5 * z), a); } }
  else if (m < 14.5) { float ang = t * 3.14159; float cs = cos(ang); float x = (c.x - 0.5) / max(abs(cs), 1e-3) + 0.5; o = abs(cs) > 0.01 ? S(vec2(cs < 0.0 ? 1.0 - x : x, c.y)) * (0.5 + 0.5 * abs(cs)) : vec4(0.0); }
  else if (m < 15.5) { float w = 1.0 - t; float x = c.x / max(w, 1e-3); o = c.x < w ? S(vec2(x, c.y)) * (0.6 + 0.4 * w) : vec4(0.0); }
  else if (m < 16.5) { float h = 1.0 - t; float k = abs(c.x - 0.5) * 2.0; o = k < h ? S(vec2((c.x - 0.5) / max(h, 1e-3) + 0.5, c.y)) * (1.0 - t * 0.5) : vec4(0.0); }
  else if (m < 17.5) o = S(c - dir * t);
  else if (m < 18.5) { vec4 acc = vec4(0.0); for (int i = 0; i < 12; i++) acc += S(c - dir * (t + float(i) * 0.012 * a)); o = acc / 12.0; }
  else if (m < 19.5) { vec4 acc = vec4(0.0); float z = 1.0 + t * 3.0 * a; for (int i = 0; i < 12; i++) acc += S(u_c + q / (z * (1.0 + float(i) * 0.02 * t * a))); o = acc / 12.0; }
  else if (m < 20.5) { vec4 acc = vec4(0.0); float z = 1.0 + sin(t * 3.14159) * 2.0 * a; for (int i = 0; i < 12; i++) acc += S(u_c + q / (z * (1.0 + float(i) * 0.015 * sin(t * 3.14159)))); o = acc / 12.0; }
  else if (m < 21.5) { float z = 1.0 + a * t; o = S(u_c + q / z + dir * t * 0.1); }
  else if (m < 22.5) { float sc = max(0.05, 1.0 - a); vec2 p = (c - u_c) / sc + 0.5; o = S(p); }
  else if (m < 23.5) { float x = dot(c - 0.5, dir) + 0.5; float edge = 1.0 - t * 1.2; if (x < edge) o = S(c); else { float k = (x - edge); vec2 r = c - dir * k * 2.0; o = (dot(r - 0.5, dir) + 0.5 > edge - 0.3 * t) ? S(r) * 0.7 + vec4(0.15) * S(r).a : vec4(0.0); } }
  else if (m < 24.5) { float z = max(0.02, 1.0 - t); o = S(u_c + q / z); }
  else if (m < 25.5) { float ang = t * 6.28318; float x = c.x - 0.5; float z = cos(ang); o = S(vec2(x / max(abs(z), 0.05) + 0.5 + sin(ang) * 0.3, c.y)) * (0.5 + 0.5 * abs(z)); }
  else { float id = floor(c.x * u_freq); float f = fract(c.x * u_freq); float w = 1.0 - t; o = abs(f - 0.5) * 2.0 < w ? S(vec2((id + (f - 0.5) / max(w, 1e-3) + 0.5) / u_freq, c.y)) * (0.6 + 0.4 * w) : vec4(0.0); }
  gl_FragColor = o;
}`);

// --------------------------------------------------------------------- 6) LUZ E PARTÍCULAS
const LIGHT_MODES = ['Spotlight', 'Feixe de laser', 'Chuva', 'Neve', 'Fogo', 'Faíscas (sparks)', 'Brilho/glitter', 'Cometa', 'Iluminação das bordas', 'Luz ambiente', 'Luz de palco', 'Ponto central (center spot)',
  'Luz nos olhos/foco', 'Estrelas piscando', 'Partículas (emissor)', 'Raio/zap'];
const LIGHT = frag(`
uniform float u_mode, u_amt, u_sz, u_ang, u_dens, u_speed, u_soft; uniform vec2 u_p1, u_p2; uniform vec3 u_c1, u_c2;
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec4 s = texture2D(u_tex, v_uv); vec3 c = unpre(s).rgb, add = vec3(0.0); float mul = 1.0; float m = u_mode; vec2 cc = contentUV(v_uv); float t = u_time * u_speed;
  vec2 ar = vec2((u_rect.z / u_texel.x) / max(u_rect.w / u_texel.y, 1.0), 1.0);
  if (m < 1.5) { float d = length((cc - u_p1) * ar); float k = 1.0 - smoothstep(u_sz * 0.01, u_sz * 0.01 + u_soft * 0.01 + 1e-3, d); mul = mix(1.0 - u_amt * 0.8, 1.0 + u_amt * 0.4, k); add = u_c1 * k * u_amt * 0.2; }
  else if (m < 2.5) { float d = seg(cc * ar, u_p1 * ar, u_p2 * ar); add = u_c1 * (exp(-d * 400.0 / max(u_sz, 0.1)) * 2.0 + exp(-d * 40.0 / max(u_sz, 0.1)) * 0.6) * u_amt; }
  else if (m < 3.5) { vec2 p = cc * vec2(ar.x * u_dens * 0.6, 1.0); p.x += p.y * u_ang * 0.01; p.y -= t * 2.0; vec2 id = floor(p * vec2(60.0, 4.0)); float r = hash(id); float y = fract(p.y * 4.0 + r * 7.0); float x = fract(p.x * 60.0); add = u_c1 * step(0.97, r) * smoothstep(0.0, 0.1, y) * smoothstep(1.0, 0.3, y) * smoothstep(0.2, 0.0, abs(x - 0.5)) * u_amt; mul = 1.0 - 0.15 * u_amt; }
  else if (m < 4.5) { for (int L = 0; L < 3; L++) { float fl = float(L); vec2 p = cc * vec2(ar.x, 1.0) * (6.0 + fl * 5.0) * u_dens * 0.1; p.y -= t * (0.3 + fl * 0.2); p.x += sin(p.y * 2.0 + fl) * 0.3; vec2 id = floor(p); vec2 f = fract(p) - 0.5 + (vec2(hash(id), hash(id + 3.1)) - 0.5) * 0.6; add += u_c1 * smoothstep(0.08 / (1.0 + fl), 0.0, length(f)) * step(0.5, hash(id + fl)) * u_amt; } }
  else if (m < 5.5) { vec2 p = vec2((cc.x - u_p1.x) * ar.x, 1.0 - cc.y); float n = fbm(vec2(p.x * 6.0, p.y * 3.0 - t * 2.0), 5); float h = (1.0 - p.y / max(u_sz * 0.01, 0.05)) + n * 0.6 - abs(p.x) * 2.0; float k = clamp(h, 0.0, 1.0); add = mix(u_c1, u_c2, k) * smoothstep(0.0, 0.5, k) * u_amt * 1.5; }
  else if (m < 6.5) { for (int i = 0; i < 24; i++) { float fi = float(i); float life = fract(t * 0.7 + hash1(fi)); vec2 v = vec2(hash1(fi * 3.1) - 0.5, hash1(fi * 7.3) * 0.8 + 0.2) * u_dens * 0.02; vec2 pp = u_p1 + vec2(v.x, -v.y) * life * 8.0 + vec2(0.0, 0.5 * life * life); float d = length((cc - pp) * ar); add += u_c1 * exp(-d * 900.0 / max(u_sz, 0.2)) * (1.0 - life) * u_amt * 2.0; } }
  else if (m < 7.5) { float L = luma(c); float g = pow(hash(floor(v_uv / u_texel / 2.0) + floor(t * 12.0)), 80.0 / max(u_dens, 1.0)); add = u_c1 * g * smoothstep(0.4, 0.9, L) * u_amt * 3.0; }
  else if (m < 8.5) { vec2 head = mix(u_p1, u_p2, fract(t * 0.3)); vec2 dirv = normalize(u_p2 - u_p1 + 1e-4); vec2 rel = (cc - head) * ar; float along = -dot(rel, dirv * ar / length(dirv * ar)); float across = length(rel + dirv * ar / length(dirv * ar) * along); add = u_c1 * (exp(-length(rel) * 300.0 / max(u_sz, 0.2)) * 2.0 + step(0.0, along) * exp(-along * 8.0) * exp(-across * 200.0 / max(u_sz, 0.2))) * u_amt; }
  else if (m < 9.5) { float gx = luma(unpre(texture2D(u_tex, v_uv + vec2(u_texel.x * 2.0, 0.0))).rgb) - luma(unpre(texture2D(u_tex, v_uv - vec2(u_texel.x * 2.0, 0.0))).rgb); float gy = luma(unpre(texture2D(u_tex, v_uv + vec2(0.0, u_texel.y * 2.0))).rgb) - luma(unpre(texture2D(u_tex, v_uv - vec2(0.0, u_texel.y * 2.0))).rgb); float e = max(0.0, dot(vec2(gx, gy), vec2(cos(u_ang), sin(u_ang)))); add = u_c1 * e * 6.0 * u_amt; }
  else if (m < 10.5) { mul = 1.0 + u_amt * 0.3; add = u_c1 * 0.08 * u_amt; c = mix(c, c * u_c1 * 1.3, 0.25 * u_amt); }
  else if (m < 11.5) { vec2 d1 = (cc - u_p1) * ar; float beam = exp(-pow(abs(d1.x + d1.y * 0.3 * sin(u_ang)), 2.0) / max(u_sz * 0.0004 * (1.0 + d1.y), 1e-4)); add = u_c1 * beam * u_amt * 0.6 * (0.8 + 0.2 * fbm(cc * 8.0 + t, 3)); mul = 1.0 - 0.4 * u_amt; }
  else if (m < 12.5) { float d = length((cc - u_p1) * ar); float k = 1.0 - smoothstep(u_sz * 0.01, u_sz * 0.01 + u_soft * 0.01 + 1e-3, d); c = mix(vec3(luma(c)) * (1.0 - u_amt * 0.6), c, k); }
  else if (m < 13.5) { float d = length((cc - u_p1) * ar); float k = exp(-d * d / max(u_sz * u_sz * 0.00005, 1e-5)); c = c * (1.0 + k * u_amt * 0.8); add = u_c1 * k * 0.05 * u_amt; }
  else if (m < 14.5) { vec2 g = cc * ar * u_dens; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float r = hash(id); float tw = 0.5 + 0.5 * sin(t * 4.0 + r * 30.0); add = u_c1 * step(0.85, r) * smoothstep(0.06, 0.0, length(f)) * (abs(f.x) < 0.01 || abs(f.y) < 0.01 ? 2.0 : 1.0) * tw * u_amt * 2.0; }
  else if (m < 15.5) { for (int i = 0; i < 32; i++) { float fi = float(i); float life = fract(t * 0.5 + hash1(fi * 1.7)); float an = u_ang + (hash1(fi * 5.1) - 0.5) * 1.2; vec2 pp = u_p1 + vec2(cos(an), -sin(an)) * life * u_dens * 0.01; float d = length((cc - pp) * ar); add += mix(u_c1, u_c2, life) * exp(-d * 600.0 / max(u_sz, 0.2)) * (1.0 - life) * u_amt; } }
  else { vec2 a = u_p1, b = u_p2; float best = 1.0; vec2 prev = a; for (int i = 1; i <= 12; i++) { float f = float(i) / 12.0; vec2 pt = mix(a, b, f) + (i < 12 ? (vec2(hash1(f * 31.0 + floor(t * 15.0)), hash1(f * 17.0 + floor(t * 15.0))) - 0.5) * 0.08 * u_dens * 0.1 : vec2(0.0)); best = min(best, seg(cc * ar, prev * ar, pt * ar)); prev = pt; } add = u_c1 * (exp(-best * 900.0 / max(u_sz, 0.2)) * 2.0 + exp(-best * 60.0) * 0.5) * u_amt; }
  vec3 o = c * mul + add;
  gl_FragColor = pre(vec4(clamp(o, 0.0, 1.0), max(s.a, clamp(luma(add), 0.0, 1.0))));
}`);

const asp = (env) => (env.rect ? (env.rect[2] * env.w) / Math.max(1, env.rect[3] * env.h) : 16 / 9);
const pass = (F, u) => (src, p, env) => env.gl.pass(F, { u_tex: src, ...u(p, env) });

export const PK_WIPE_MODES = WIPE_MODES, PK_TEX_MODES = TEX_MODES, PK_COLOR_MODES = COLOR_MODES, PK_STY_MODES = STY_MODES, PK_DIS_MODES = DIS_MODES, PK_LIGHT_MODES = LIGHT_MODES;

export default [
  {
    type: 'pkWipe', label: 'Transição – wipe / dissolve', category: 'Transições', plugin: 'Sapphire S_Wipe*/S_Dissolve* · BCC Wipes · Universe Transitions',
    description: 'Some com a camada por um padrão (linear, relógio, íris, estrela, xadrez, bolhas, células, luma…), com borda colorida, brilho, distorção e desfoque na borda.',
    params: [sel('mode', 'Padrão', WIPE_MODES, 1), num('pct', 'Completion %', 0, 0, 100, 0.1), num('soft', 'Softness', 5, 0, 50, 0.1), ang('angle', 'Angle', 0), pos('center', 'Center'),
      num('freq', 'Frequency / escala', 8, 0.5, 60, 0.1), num('border', 'Border width', 0, 0, 20, 0.1), col('borderColor', 'Border / glow color', [1, 0.7, 0.3, 1]), num('glow', 'Edge glow', 0, 0, 5, 0.01),
      num('distort', 'Edge distortion', 0, 0, 5, 0.01), num('edgeBlur', 'Edge blur', 0, 0, 100), num('seed', 'Seed', 0, 0, 1000), bool('invert', 'Invert')],
    render: (src, p, env) => {
      const bl = p.edgeBlur > 0 ? env.gl.blur(src, p.edgeBlur * 0.3 * env.scale) : src;
      return env.gl.pass(WIPE, { u_tex: src, u_tex2: bl, u_mode: p.mode, u_pct: p.pct / 100, u_ang: rad(p.angle), u_soft: p.soft / 100, u_bw: p.border / 100, u_freq: p.freq, u_inv: p.invert ? 1 : 0,
        u_glow: p.glow, u_dist: p.distort, u_blurAmt: p.edgeBlur > 0 ? 1 : 0, u_seed: p.seed * 0.137, u_asp: asp(env), u_c: p.center, u_bcol: rgb(p.borderColor) });
    },
  },
  {
    type: 'pkTexture', label: 'Textura / gerador', category: 'Estilizar', plugin: 'Sapphire S_Texture*/S_Gradient*/S_NightSky · BCC texturas · Universe geradores',
    description: 'Gera texturas e fundos (plasma, células, moiré, nuvens, mármore, madeira, céu estrelado, gradientes, espectro…) e mistura com a camada.',
    params: [sel('mode', 'Textura', TEX_MODES, 1), num('scale', 'Scale', 4, 0.1, 50, 0.1), num('speed', 'Speed', 0.5, -10, 10, 0.01), num('evolution', 'Evolution', 0, -100, 100, 0.01),
      num('contrast', 'Contrast', 1, 0.1, 5, 0.01), col('c1', 'Color 1', [0.05, 0.02, 0.15, 1]), col('c2', 'Color 2', [0.9, 0.3, 0.5, 1]), col('c3', 'Color 3', [1, 0.95, 0.7, 1]),
      ang('angle', 'Angle', 90), pos('center', 'Center'), sel('blend', 'Combine', ['Substituir', 'Multiplicar', 'Tela (screen)', 'Adicionar', 'Sobrepor (overlay)'], 1), num('opacity', 'Mix with source %', 100, 0, 100)],
    render: pass(TEX, (p, env) => ({ u_mode: p.mode, u_tsc: p.scale, u_speed: p.speed, u_evo: p.evolution, u_con: p.contrast, u_op: p.opacity / 100, u_blend: p.blend, u_ang: rad(p.angle), u_asp: asp(env), u_c1: rgb(p.c1), u_c2: rgb(p.c2), u_c3: rgb(p.c3), u_cen: p.center })),
  },
  {
    type: 'pkColor', label: 'Cor – operações (Sapphire/BCC)', category: 'Cor', plugin: 'Sapphire Adjust · BCC Color · Universe Noir',
    description: 'Gamma por canal, mono, tritone/quadtone, posterizar, solarizar, pseudocor, paleta, troca de canais, bleach bypass, vintage technicolor, Kelvin, saturação seletiva…',
    params: [sel('mode', 'Operação', COLOR_MODES, 1), num('amount', 'Mix %', 100, 0, 100), num('level', 'Level / níveis', 5, 0.5, 30, 0.1), ang('hue', 'Hue', 0), num('range', 'Hue range', 25, 1, 180),
      num('temperature', 'Temperature', 0, -100, 100), sel('perm', 'Canais', ['GBR', 'BRG', 'RBG', 'BGR', 'GRB'], 1),
      num('gR', 'Gamma R', 1, 0.1, 5, 0.01), num('gG', 'Gamma G', 1, 0.1, 5, 0.01), num('gB', 'Gamma B', 1, 0.1, 5, 0.01),
      col('c1', 'Color 1 / Dark', [0.05, 0.05, 0.25, 1]), col('c2', 'Color 2 / Mid', [0.8, 0.3, 0.3, 1]), col('c3', 'Color 3 / Bright', [1, 0.95, 0.7, 1]), col('c4', 'Color 4', [1, 1, 1, 1])],
    render: pass(COLOROPS, (p) => ({ u_mode: p.mode, u_amt: p.amount / 100, u_lvl: p.level, u_hue: p.hue, u_range: p.range, u_temp: p.temperature, u_perm: p.perm, u_gam: [p.gR, p.gG, p.gB], u_c1: rgb(p.c1), u_c2: rgb(p.c2), u_c3: rgb(p.c3), u_c4: rgb(p.c4) })),
  },
  {
    type: 'pkStylize', label: 'Estilizar (Sapphire/BCC)', category: 'Estilizar', plugin: 'Sapphire Stylize · BCC Stylize/Lens',
    description: 'Relevos, esboço, gravura, hachura, olho de mosca, zebra, bordas, difuso, pincel, névoa/seda/halo (filtros de lente), varredura, desalinhamento RGB.',
    params: [sel('mode', 'Estilo', STY_MODES, 1), num('amount', 'Mix %', 100, 0, 100), num('size', 'Size / largura', 2, 0.5, 20, 0.1), ang('angle', 'Angle', 45), num('freq', 'Frequency', 20, 1, 200, 0.5),
      num('seed', 'Seed', 0, 0, 1000), col('c1', 'Color 1', [1, 0.8, 0.5, 1]), col('c2', 'Color 2', [0.1, 0.2, 0.5, 1])],
    render: pass(STY, (p, env) => ({ u_mode: p.mode, u_amt: p.amount / 100, u_sz: p.size * env.scale, u_ang: rad(p.angle), u_freq: p.freq, u_seed: p.seed * 0.31, u_c1: rgb(p.c1), u_c2: rgb(p.c2) })),
  },
  {
    type: 'pkDistort', label: 'Distorção / transição de movimento', category: 'Distorção', plugin: 'Sapphire Hyper/InfiniteZoom/StripSlide · BCC Twister/Lens/Swish/Crash Zoom · Universe Transitions',
    description: 'Push/pull, zoom infinito, faixas, twister, lentes, reflexo, cilindro/esfera, card flip, cubo, dobra, slide, swish pan, crash/cross zoom, PiP, curl.',
    params: [sel('mode', 'Tipo', DIS_MODES, 1), num('amount', 'Amount', 0.5, -2, 2, 0.01), num('pct', 'Completion %', 0, 0, 100, 0.1), ang('angle', 'Angle', 0), pos('center', 'Center'), num('freq', 'Strips / frequency', 8, 1, 60, 1)],
    render: pass(DIS, (p, env) => ({ u_mode: p.mode, u_amt: p.amount, u_pct: p.pct / 100, u_ang: rad(p.angle), u_c: p.center, u_freq: p.freq, u_asp: asp(env) })),
  },
  {
    type: 'pkLight', label: 'Luz / partículas (Sapphire/BCC)', category: 'Luz e brilho', plugin: 'Sapphire SpotLight/LaserBeam/UltraZap · BCC Rain/Snow/Fire/Sparks/Glitter/Comet/Particles',
    description: 'Spotlight, laser, chuva, neve, fogo, faíscas, glitter, cometa, luz nas bordas, luz de palco, estrelas, partículas e raios.',
    params: [sel('mode', 'Tipo', LIGHT_MODES, 1), num('amount', 'Intensity', 1, 0, 5, 0.01), num('size', 'Size / width', 20, 0.1, 200, 0.1), num('soft', 'Softness', 20, 0, 200, 0.1), ang('angle', 'Angle', 90),
      num('density', 'Density / speed of spread', 30, 1, 200, 0.5), num('speed', 'Speed', 1, -10, 10, 0.01), pos('p1', 'Point 1 / source', [0.5, 0.5]), pos('p2', 'Point 2 / target', [0.9, 0.2]),
      col('c1', 'Color', [1, 0.85, 0.6, 1]), col('c2', 'Color 2', [1, 0.3, 0.05, 1])],
    render: pass(LIGHT, (p) => ({ u_mode: p.mode, u_amt: p.amount, u_sz: p.size, u_soft: p.soft, u_ang: rad(p.angle), u_dens: p.density, u_speed: p.speed, u_p1: p.p1, u_p2: p.p2, u_c1: rgb(p.c1), u_c2: rgb(p.c2) })),
  },
];
