// Efeitos usados pelos presets de CC/edit reais: Looks (estilo Magic Bullet Looks), Sharpen
// (S_Sharpen / Unsharp Mask / BCC Unsharp), 4-Color Gradient, Warp (ADBE WRPMESH), Flicker (S_Flicker),
// Photo Filter e Colorista (lift/gamma/gain).
import { frag, colorFrag, num, ang, col, bool, sel, pos, rgb, noise1 } from './common.js';

const SHARPEN = frag(`
uniform sampler2D u_tex2; uniform float u_amount; uniform float u_thr; uniform float u_luma;
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv));
  vec3 b = unpre(texture2D(u_tex2, v_uv)).rgb;
  vec3 d = c.rgb - b;
  if (u_luma > 0.5) d = vec3(luma(d));
  float m = smoothstep(u_thr, u_thr + 0.02, abs(luma(d)) + (u_thr <= 0.0 ? 1.0 : 0.0));
  gl_FragColor = pre(vec4(clamp(c.rgb + d * u_amount * m, 0.0, 1.0), c.a));
}`);

const BLEND_GLSL = `
vec3 blendMode(vec3 a, vec3 b, float m) {
  if (m < 1.5) return b;                                  // nenhum (só o gradiente)
  if (m < 2.5) return b;                                  // normal
  if (m < 3.5) return min(a + b, 1.0);                    // adicionar
  if (m < 4.5) return a * b;                              // multiplicar
  if (m < 5.5) return 1.0 - (1.0 - a) * (1.0 - b);        // tela
  if (m < 6.5) return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a)); // sobrepor
  if (m < 7.5) return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b)); // luz suave
  if (m < 8.5) return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, b)); // luz direta
  if (m < 9.5) return min(a / max(1.0 - b, 0.001), 1.0); // subexpor cor
  if (m < 10.5) return 1.0 - min((1.0 - a) / max(b, 0.001), 1.0); // superexpor cor
  if (m < 11.5) return min(a, b);
  if (m < 12.5) return max(a, b);
  if (m < 13.5) return abs(a - b);
  if (m < 14.5) return a + b - 2.0 * a * b;
  return b;
}`;

const FOURCOLOR = frag(`${BLEND_GLSL}
uniform vec2 u_p1, u_p2, u_p3, u_p4; uniform vec3 u_c1, u_c2, u_c3, u_c4; uniform float u_blend; uniform float u_op; uniform float u_mode; uniform vec2 u_asp;
void main() {
  vec4 s = unpre(texture2D(u_tex, v_uv));
  vec2 c = contentUV(v_uv) * u_asp;
  float k = 1.0 + (100.0 - u_blend) / 25.0;
  float w1 = 1.0 / pow(dot(c - u_p1 * u_asp, c - u_p1 * u_asp) + 1e-4, k);
  float w2 = 1.0 / pow(dot(c - u_p2 * u_asp, c - u_p2 * u_asp) + 1e-4, k);
  float w3 = 1.0 / pow(dot(c - u_p3 * u_asp, c - u_p3 * u_asp) + 1e-4, k);
  float w4 = 1.0 / pow(dot(c - u_p4 * u_asp, c - u_p4 * u_asp) + 1e-4, k);
  vec3 g = (u_c1 * w1 + u_c2 * w2 + u_c3 * w3 + u_c4 * w4) / (w1 + w2 + w3 + w4);
  if (u_mode < 1.5) { gl_FragColor = pre(vec4(mix(s.rgb, g, u_op), mix(s.a, 1.0, u_op))); return; }
  gl_FragColor = pre(vec4(mix(s.rgb, blendMode(s.rgb, g, u_mode), u_op), s.a));
}`);

const WARP = frag(`
uniform float u_style; uniform float u_axis; uniform float u_b; uniform float u_hd; uniform float u_vd;
void main() {
  vec2 p = contentUV(v_uv) * 2.0 - 1.0;
  if (u_axis > 1.5) p = p.yx;
  // distorção de perspectiva (inversa aproximada)
  p.x /= (1.0 + u_hd * p.y);
  p.y /= (1.0 + u_vd * p.x);
  float b = u_b, x = p.x, y = p.y;
  vec2 q = p;
  if (u_style < 1.5) q.y = y + b * (1.0 - x * x);                                  // Arco
  else if (u_style < 2.5) q.y = y + b * (1.0 - x * x) * (y + 1.0) * 0.5;           // Arco inferior
  else if (u_style < 3.5) q.y = y + b * (1.0 - x * x) * (1.0 - y) * 0.5;           // Arco superior
  else if (u_style < 4.5) q.y = y + b * (1.0 - x * x) * 0.85;                      // Arqueado
  else if (u_style < 5.5) q.y = y / (1.0 + b * (1.0 - x * x));                     // Bojo
  else if (u_style < 6.5) q.y = y > 0.0 ? y / (1.0 + b * (1.0 - x * x)) : y;       // Concha inferior
  else if (u_style < 7.5) q.y = y < 0.0 ? y / (1.0 + b * (1.0 - x * x)) : y;       // Concha superior
  else if (u_style < 8.5) q.y = y + b * 0.5 * sin(x * PI);                         // Bandeira
  else if (u_style < 9.5) q.y = y + b * 0.5 * sin(x * PI) * cos(y * PI * 0.5);     // Onda
  else if (u_style < 10.5) q.y = y + b * 0.5 * sin(x * PI) * y;                    // Peixe
  else if (u_style < 11.5) q.y = y + b * x;                                        // Elevar
  else if (u_style < 12.5) q = p * (1.0 - b * 0.5 * max(0.0, 1.0 - dot(p, p)));   // Olho de peixe
  else if (u_style < 13.5) q = p / (1.0 + b * max(0.0, 1.0 - dot(p, p)));          // Inflar
  else if (u_style < 14.5) { float a = b * PI * max(0.0, 1.0 - length(p)); q = mat2(cos(a), sin(a), -sin(a), cos(a)) * p; } // Torcer
  else q.x = x * (1.0 + b * (1.0 - y * y));                                         // Comprimir
  if (u_axis > 1.5) q = q.yx;
  vec2 uv = fromContent((q + 1.0) * 0.5);
  gl_FragColor = (abs(q.x) > 1.0 || abs(q.y) > 1.0) ? vec4(0.0) : texture2D(u_tex, uv);
}`);

const FLICKER = colorFrag('uniform vec3 u_m;', 'r *= u_m;');

const PHOTOFILTER = colorFrag('uniform vec3 u_color; uniform float u_density; uniform float u_preserve;', `
  vec3 f = r * u_color;
  if (u_preserve > 0.5) f *= luma(r) / max(luma(f), 0.0001);
  r = mix(r, f, u_density);`);

const LGG = colorFrag('uniform vec3 u_lift, u_gamma, u_gain; uniform float u_sat;', `
  r = u_gain * (r + u_lift * (1.0 - r));
  r = pow(max(r, 0.0), 1.0 / max(u_gamma, vec3(0.01)));
  r = mix(vec3(luma(r)), r, u_sat);`);

// "Looks": um único efeito com as ferramentas do Magic Bullet Looks (Colorista, Mojo II, Curves, Haze…).
const LOOKS = frag(`
uniform float u_svl[7], u_svs[7]; uniform float u_svon;
float curve7(float x, float c[7]) { x = clamp(x, 0.0, 1.0) * 6.0; float r = c[6]; for (int i = 0; i < 6; i++) { if (x >= float(i) && x < float(i + 1)) r = mix(c[i], c[i + 1], x - float(i)); } return r; }
uniform float u_mtint; uniform float u_2s; uniform float u_exp, u_sat, u_hue, u_con, u_fade, u_mojo, u_cool, u_skin, u_punch, u_bleach, u_vig, u_vsize, u_strength, u_temp, u_tint, u_fdens;
uniform vec3 u_filter, u_lift, u_gamma, u_gain, u_mixr, u_mixg, u_mixb; uniform float u_mixamt;
uniform vec3 u_hsl[8];
uniform vec2 u_curve[4]; uniform float u_ncurve;
uniform float u_spexp, u_spsize, u_spsoft, u_spasp, u_spinv, u_grexp, u_grang, u_groff, u_grsoft;
uniform vec2 u_imgasp;
uniform float u_lkc, u_lkpiv, u_lkcomp; uniform vec2 u_spc, u_grp1, u_grp2; uniform float u_gr2; uniform vec3 u_spcol, u_grcol;
float hueCenter(int i) {
  if (i == 0) return 0.0; if (i == 1) return 30.0; if (i == 2) return 60.0; if (i == 3) return 120.0;
  if (i == 4) return 180.0; if (i == 5) return 240.0; if (i == 6) return 275.0; return 315.0;
}
vec3 srgbLin(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 srgbGam(vec3 l) { l = max(l, 0.0); return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
float curveDy(float x) {
  float px = 0.0, py = 0.0;
  for (int i = 0; i < 5; i++) {
    float nx = 1.0, ny = 0.0;
    if (i < 4 && float(i) < u_ncurve) { nx = u_curve[i].x; ny = u_curve[i].y; }
    if (x <= nx) { float t = clamp((x - px) / max(nx - px, 1e-4), 0.0, 1.0); t = t * t * (3.0 - 2.0 * t); return mix(py, ny, t); }
    px = nx; py = ny;
  }
  return 0.0;
}
void main() {
  vec4 c0 = unpre(texture2D(u_tex, v_uv));
  vec3 r = c0.rgb;
  // exposição (luz linear) e filtro de cor (Warm/Cool)
  vec3 lin = pow(max(r, 0.0), vec3(2.2)) * pow(2.0, u_exp);
  // Contrast do Looks: curva de potência em torno do Pivot (o brilho do pivot não muda), em luz linear
  if (u_lkc != 0.0) { float pv = pow(max(u_lkpiv, 0.01), 2.2); lin = pv * pow(max(lin, 0.0) / pv, vec3(max(0.05, 1.0 + u_lkc))) * pow(2.0, u_lkcomp); }
  vec2 cuv = contentUV(v_uv);
  // Spot Exposure: luz numa elipse suave, tingida pela cor da ferramenta
  if (u_spexp != 0.0) {
    // como no Looks: centro, raio e "spread" (faixa de suavização) em meias-larguras da imagem, com proporção
    vec2 dd = (cuv - u_spc) * u_imgasp * 2.0; dd.x /= max(u_spasp, 0.05);
    float m = 1.0 - smoothstep(u_spsize, u_spsize + max(u_spsoft, 0.001), length(dd));
    if (u_spinv > 0.5) m = 1.0 - m;
    // Looks clareia com "ombro": ganho total nos escuros, realces chegam ao branco sem estourar (medido no tutorial)
    vec3 gv = mix(vec3(1.0), pow(2.0, u_spexp) * u_spcol, m);
    // (em luz linear sRGB de verdade, com o trecho linear perto do preto: os escuros sobem mais, como no Looks)
    vec3 sl = srgbLin(pow(max(lin, 0.0), vec3(1.0 / 2.2))), lc = clamp(sl, 0.0, 1.0);
    sl = mix(sl * gv, lc * gv / (1.0 + (gv - 1.0) * lc * 0.65), step(1.0, gv));
    lin = pow(srgbGam(sl), vec3(2.2));
  }
  // Gradient Exposure: exposição em degradê na direção do ângulo
  if (u_gr2 > 0.5) {
    // Looks “Grad Exposure”: de Ponto 1 (efeito total) até Ponto 2 (nenhum); Stops × Color Balance agem como
    // um filtro de luz (cor preta = escurece, como um filtro ND degradê), Falloff controla a curva
    vec2 d = (u_grp1 - u_grp2) * u_imgasp, q = (cuv - u_grp2) * u_imgasp;
    float t = clamp(dot(q, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
    float m = pow(t * t * (3.0 - 2.0 * t), 0.5 / max(u_grsoft, 0.05));
    lin *= mix(vec3(1.0), pow(2.0, u_grexp) * u_grcol, m);
  } else if (u_grexp != 0.0) {
    float a = radians(u_grang);
    float g = dot(cuv - 0.5, vec2(sin(a), -cos(a))) + u_groff;
    float m = smoothstep(-u_grsoft * 0.5, u_grsoft * 0.5, g);
    lin *= mix(vec3(1.0), pow(2.0, u_grexp) * mix(vec3(1.0), u_grcol, min(1.0, abs(u_grexp))), m);
  }
  // filtro fotográfico (Warming/Cooling): age na luz linear como uma gelatina na lente — a cor mostrada
  // no Looks é a transmissão da gelatina, que é bem mais forte que a cor sugere (≈ cubo da transmissão)
  vec3 fl = lin * pow(max(u_filter, vec3(0.001)), vec3(3.0));
  fl *= luma(lin) / max(luma(fl), 0.0001);
  lin = mix(lin, fl, u_fdens);
  r = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  // temperatura / tint
  r += vec3(u_temp, u_temp * 0.15, -u_temp) * 0.09 + vec3(u_tint * 0.05, -u_tint * 0.07, u_tint * 0.05);
  // Channel Mixer do Looks
  if (u_mixamt > 0.0) r = mix(r, max(vec3(dot(r, u_mixr), dot(r, u_mixg), dot(r, u_mixb)), 0.0), u_mixamt);
  // Colorista 3 vias
  r = u_gain * (r + u_lift * (1.0 - r));
  r = pow(max(r, 0.0), 1.0 / max(u_gamma, vec3(0.01)));
  // HSL por cor (vermelho, laranja, amarelo, verde, ciano, azul, roxo, magenta)
  vec3 hv = rgb2hsv(clamp(r, 0.0, 1.0));
  float hdeg = hv.x * 360.0;
  vec3 adj = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float d = abs(mod(hdeg - hueCenter(i) + 180.0, 360.0) - 180.0);
    float w = clamp(1.0 - d / 40.0, 0.0, 1.0);
    adj += u_hsl[i] * w * w * (3.0 - 2.0 * w);
  }
  adj *= smoothstep(0.02, 0.15, hv.y);
  hv.x = fract(hv.x + u_hue + adj.x * 0.6 / 360.0);
  hv.y = clamp(hv.y * (1.0 + adj.y / 100.0), 0.0, 1.0);
  hv.z = clamp(hv.z * (1.0 + adj.z / 100.0 * 0.6), 0.0, 1.0);
  r = hsv2rgb(hv);
  // Two Strip (Technicolor de 2 tiras): verde e azul viram um registro só
  if (u_2s > 0.001) {
    // o Two Strip do Looks não apaga os azuis: mistura parcial dos registros + saturação mantida
    vec3 ts = vec3(r.r, mix(r.g, (r.g + r.b) * 0.5, 0.6), mix(r.b, (r.g + r.b) * 0.5, 0.45));
    float s0 = max(r.r, max(r.g, r.b)) - min(r.r, min(r.g, r.b)), s1 = max(ts.r, max(ts.g, ts.b)) - min(ts.r, min(ts.g, ts.b));
    float lt = luma(ts);
    ts = vec3(lt) + (ts - vec3(lt)) * clamp(s0 / max(s1, 1e-3), 1.0, 1.6);
    r = mix(r, ts, u_2s);
  }
  // Mojo II: sombras/meios-tons para teal, pele para laranja
  float l = luma(r);
  float skin = smoothstep(22.0, 6.0, abs(mod(hv.x * 360.0 - 28.0 + 180.0, 360.0) - 180.0)) * smoothstep(0.1, 0.35, hv.y);
  // Mojo II (manual do Looks): esquenta os realces e esfria as sombras, destacando a pele — sem mudar o contraste geral
  float hiW = smoothstep(0.2, 0.85, l);
  // teal & orange de verdade: as matizes "frias" (verde, ciano, azul, roxo) são puxadas para verde-água (~185°)
  // e as quentes (vermelho, laranja, amarelo) para laranja-pele (~28°). É isso que deixa grama e fundo ciano.
  if (u_mojo > 0.001) {
    vec3 mh = rgb2hsv(clamp(r, 0.0, 1.0));
    float hd = mh.x * 360.0;
    float warmSide = 1.0 - smoothstep(70.0, 95.0, hd) + smoothstep(310.0, 335.0, hd);
    // Mojo Tint (manual): positivo = frios mais azuis (azul royal/verde-água), negativo = mais quentes
    float target = warmSide > 0.5 ? 28.0 : 185.0 + 30.0 * u_mtint;
    float dh = mod(target - hd + 540.0, 360.0) - 180.0;
    float k = u_mojo * (warmSide > 0.5 ? 0.45 * u_skin : 0.6 * u_cool) * smoothstep(0.04, 0.2, mh.y);
    mh.x = fract((hd + dh * clamp(k, 0.0, 0.9)) / 360.0);
    // pele mais rica; o fundo frio vira teal mantendo a cor (antes perdia até 36% e ficava cinza)
    mh.y = clamp(mh.y * (warmSide > 0.5 ? 1.0 + 0.35 * u_mojo * min(u_skin, 1.6) : 1.0 + 0.05 * u_mojo), 0.0, 1.0);
    r = hsv2rgb(mh);
  }
  vec3 cool = r + vec3(-0.055, 0.008, 0.06) * (1.0 - hiW) * (1.0 - skin * 0.8);
  vec3 warmH = r * mix(vec3(1.0), vec3(1.10, 1.02, 0.84), max(hiW, skin * 0.8));
  r = mix(r, cool, u_mojo * u_cool);
  r = mix(r, warmH, u_mojo * (0.6 + 0.4 * skin) * u_skin);
  // Mojo (manual da Maxon): "aumenta o contraste, esquenta realces e esfria sombras preservando a pele"
  r = mix(r, r * r * (3.0 - 2.0 * r), u_mojo * 0.5);
  // Punch It (manual): contraste nas SOMBRAS — empurra as sombras para o preto, preservando a pele
  float shw = (1.0 - smoothstep(0.0, 0.55, luma(r))) * (1.0 - skin * 0.6);
  r = mix(r, r * r * 1.4, clamp(u_punch * shw * 0.8, 0.0, 1.0));
  r = max(r, 0.0);
  // Bleach It (manual): menos saturação quanto maior (negativo = mais saturação), com leve contraste prateado
  float bl = luma(r);
  // no Mojo II a pele fica protegida do Bleach: o fundo perde a cor, o rosto continua com tom de pele
  float skinB = smoothstep(26.0, 8.0, abs(mod(rgb2hsv(clamp(r, 0.0, 1.0)).x * 360.0 - 28.0 + 180.0, 360.0) - 180.0)) * smoothstep(0.08, 0.3, rgb2hsv(clamp(r, 0.0, 1.0)).y);
  r = mix(vec3(bl), r, 1.0 - 0.6 * u_bleach * (u_bleach > 0.0 ? 1.0 - 0.6 * max(skin, skinB) : 1.0));
  // bleach bypass de verdade: a prata que fica no filme = cópia P&B em "overlay" → mais escuro e mais contraste
  if (u_bleach > 0.0) {
    vec3 L = vec3(luma(clamp(r, 0.0, 1.0)));
    vec3 ov = mix(2.0 * r * L, 1.0 - 2.0 * (1.0 - r) * (1.0 - L), step(0.5, L));
    r = mix(r, ov, u_bleach * 0.55);
  }
  // contraste, saturação, curva, haze/fade
  // Contraste do Looks: curva de filme (S) em torno do pivô, não uma reta que estoura pretos/brancos
  vec3 cx = clamp(r, 0.0, 1.0);
  vec3 sCurve = mix(cx, cx * cx * (3.0 - 2.0 * cx), clamp(u_con, 0.0, 1.0) * 1.2);
  r = u_con >= 0.0 ? sCurve + (r - cx) : (r - 0.45) * (1.0 + u_con) + 0.45;
  r = mix(vec3(luma(r)), r, u_sat);
  // Colorista: curvas Saturação × Luminância e Saturação × Saturação (7 pontos, 0 = neutro, −1 = sem cor)
  if (u_svon > 0.5) {
    float lw = luma(r), sw = max(r.r, max(r.g, r.b)) - min(r.r, min(r.g, r.b));
    r = mix(vec3(lw), r, max(0.0, 1.0 + curve7(lw, u_svl)) * max(0.0, 1.0 + curve7(sw, u_svs)));
  }
  r += vec3(curveDy(clamp(r.r, 0.0, 1.0)), curveDy(clamp(r.g, 0.0, 1.0)), curveDy(clamp(r.b, 0.0, 1.0)));
  r = mix(r, vec3(0.08) + r * 0.86, u_fade);
  // vinheta
  vec2 cu = contentUV(v_uv) - 0.5;
  r *= 1.0 - smoothstep(u_vsize, u_vsize + 0.5, length(cu) * 1.4142) * u_vig;
  r = clamp(r, 0.0, 1.0);
  gl_FragColor = pre(vec4(mix(c0.rgb, r, u_strength), c0.a));
}`);

export const HSL_COLORS = [['Red', 'vermelho'], ['Orange', 'laranja'], ['Yellow', 'amarelo'], ['Green', 'verde'], ['Aqua', 'ciano'], ['Blue', 'azul'], ['Purple', 'roxo'], ['Magenta', 'magenta']];
const adv = (p) => ({ ...p, advanced: true });

const EDGE_SOFT = frag(`
uniform sampler2D u_tex2; uniform float u_esize, u_soft, u_asp; uniform vec2 u_ec, u_imgasp;
void main() {
  // Edge Softness (manual do Looks): nítido dentro do raio, desfoque total depois do "spread"; centro e proporção
  vec2 cu = (contentUV(v_uv) - u_ec) * u_imgasp * 2.0; cu.x /= max(u_asp, 0.05);
  float m = smoothstep(u_esize, u_esize + max(u_soft, 0.001), length(cu));
  gl_FragColor = mix(texture2D(u_tex, v_uv), texture2D(u_tex2, v_uv), m);
}`);
// Optical Diffusion (filtro de difusão na lente, tipo Pro-Mist): a luz das áreas claras "vaza" suavemente
const OPTDIFF = frag(`
uniform sampler2D u_tex2; uniform float u_dens, u_hl, u_glow;
void main() {
  vec4 c = texture2D(u_tex, v_uv), b = texture2D(u_tex2, v_uv);
  // Optical Diffusion do Looks espalha luz também nas sombras (visual “leitoso”, pretos lavados — ZAZ Dark)
  float w = min(1.0, u_dens * 1.5) * mix(1.0, smoothstep(0.2, 0.9, luma(b.rgb)), u_hl * 0.6);
  vec3 lifted = max(c.rgb, mix(c.rgb, b.rgb, 0.85));      // a difusão clareia, nunca escurece os detalhes
  vec3 o = mix(c.rgb, lifted, w) + b.rgb * u_glow * smoothstep(0.5, 1.0, luma(b.rgb));
  gl_FragColor = vec4(min(o, vec3(c.a)), c.a);
}`);
const TINTMUL = frag(`uniform vec3 u_c; void main() { vec4 c = texture2D(u_tex, v_uv); gl_FragColor = vec4(c.rgb * u_c, c.a); }`);
const THRESH = frag(`
uniform float u_thr;
void main() { vec4 c = unpre(texture2D(u_tex, v_uv)); gl_FragColor = pre(vec4(c.rgb, c.a * smoothstep(u_thr - 0.1, u_thr + 0.15, luma(c.rgb)))); }`);
const SCREEN_ADD = frag(`
uniform sampler2D u_tex2; uniform float u_amount;
void main() { vec4 s = texture2D(u_tex, v_uv); vec4 g = texture2D(u_tex2, v_uv) * u_amount; gl_FragColor = vec4(s.rgb + g.rgb * (s.a - s.rgb), s.a); }`);
// Anamorphic Flare (Looks): riscos horizontais saindo dos realces
const ANAM_HI = frag(`
uniform float u_thr, u_soft;
void main() { vec4 c = texture2D(u_tex, v_uv); float l = luma(c.rgb / max(c.a, 1e-4)); gl_FragColor = c * smoothstep(u_thr, u_thr + max(u_soft, 0.02), l); }`);
const ANAM_STREAK = frag(`
uniform float u_len;
void main() {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -32; i <= 32; i++) { float k = float(i) / 32.0; float w = exp(-abs(k) * 3.0); acc += texture2D(u_tex, v_uv + vec2(k * u_len * u_texel.x, 0.0)) * w; ws += w; }
  gl_FragColor = acc / ws;
}`);
const ANAM_ADD = frag(`
uniform sampler2D u_tex2; uniform float u_boost; uniform vec3 u_col;
void main() { vec4 a = texture2D(u_tex, v_uv); vec3 f = texture2D(u_tex2, v_uv).rgb * u_col * u_boost; gl_FragColor = vec4(min(a.rgb + f * a.a, vec3(a.a)), a.a); }`);
// Lens Distortion (Looks): barril (+) / almofada (−), "Flatten" empurra a distorção para as bordas
const LENSD = frag(`
uniform float u_k, u_flat;
void main() {
  vec2 cu = contentUV(v_uv) - 0.5;
  float r2 = dot(cu, cu) * 2.0;
  float f = 1.0 + u_k * pow(r2, 1.0 + u_flat * 2.0);
  // almofada (k<0) puxa as bordas para dentro: compensa para o quadro continuar cheio (sem barras pretas)
  float fill = u_k < 0.0 ? 1.0 + u_k : 1.0;
  vec2 q = cu * fill / max(f, 0.05) + 0.5;
  gl_FragColor = (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? vec4(0.0) : texture2D(u_tex, fromContent(q));
}`);
// Haze/Flare (Looks): a luz das faixas laterais do quadro (Spillage = largura de cada faixa) reflete para dentro
// da imagem (Reach = até onde vai), espalhada na vertical (Softness) — o véu leitoso das lentes antigas.
// u_tex2 = imagem reduzida e borrada na vertical (as faixas são lidas dela).
const HAZE = frag(`
uniform sampler2D u_tex2; uniform float u_exp, u_spill, u_reach; uniform vec3 u_tintc;
vec3 strip(float x0, float x1, float y) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) { float x = mix(x0, x1, (float(i) + 0.5) / 6.0); acc += texture2D(u_tex2, fromContent(vec2(x, y))).rgb; }
  return acc / 6.0;
}
void main() {
  vec4 a = texture2D(u_tex, v_uv);
  vec2 c = contentUV(v_uv);
  vec3 L = strip(0.0, u_spill, c.y), R = strip(1.0 - u_spill, 1.0, c.y);
  L = pow(L, vec3(2.2)); R = pow(R, vec3(2.2));
  float wl = exp(-c.x / max(u_reach, 0.01)), wr = exp(-(1.0 - c.x) / max(u_reach, 0.01));
  vec3 h = (L * wl + R * wr) * u_tintc * u_exp;
  vec3 lin = pow(a.rgb / max(a.a, 1e-4), vec3(2.2));
  vec3 o = pow(lin + h * (1.0 - min(lin, 1.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(clamp(o, 0.0, 1.0) * a.a, a.a);
}`);
const RADIAL_SPLIT = frag(`
uniform float u_amt;
void main() {
  vec2 o = (v_uv - (u_rect.xy + u_rect.zw * 0.5)) * u_amt;
  vec4 r = samp(v_uv + o), g = texture2D(u_tex, v_uv), b = samp(v_uv - o);
  gl_FragColor = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
}`);

const BLEND_OPTIONS = ['Nenhum', 'Normal', 'Adicionar', 'Multiplicar', 'Tela', 'Sobrepor', 'Luz suave', 'Luz direta', 'Subexpor cor', 'Superexpor cor', 'Escurecer', 'Clarear', 'Diferença', 'Exclusão'];
export const WARP_STYLES = ['Arco', 'Arco inferior', 'Arco superior', 'Arqueado', 'Bojo', 'Concha inferior', 'Concha superior', 'Bandeira', 'Onda', 'Peixe', 'Elevar', 'Olho de peixe', 'Inflar', 'Torcer', 'Comprimir'] // mesma ordem do AE;

const EFFECTS = [
  {
    type: 'looks', label: 'Looks (CC completo)', category: 'Cor', plugin: 'Magic Bullet Looks',
    description: 'Colorista (3 vias + HSL por cor), Mojo II (teal & orange, Punch, Bleach), curvas, temperatura, haze, vinheta, difusão e aberração. Presets com Magic Bullet Looks são convertidos para cá.',
    params: [
      num('strength', 'Força %', 100, 0, 100), num('exposure', 'Exposição', 0, -3, 3, 0.01),
      num('temperature', 'Temperatura', 0, -100, 100), num('tint', 'Tint', 0, -100, 100),
      num('contrast', 'Contraste', 0, -100, 100), num('saturation', 'Saturação %', 100, 0, 300),
      num('mojo', 'Mojo (teal & orange) %', 0, 0, 100), num('mojoCool', 'Mojo – esfriar %', 50, 0, 100), num('mojoSkin', 'Mojo – pele quente %', 50, 0, 100),
      num('punch', 'Punch %', 0, 0, 100), adv(num('twoStrip', 'Two Strip (Technicolor) %', 0, 0, 100)), num('bleach', 'Bleach %', 0, -100, 100), adv(num('mojoTint', 'Mojo Tint', 0, -100, 100)), { key: 'satLum', label: 'Colorista – Sat × Lum', kind: 'hidden', default: [0, 0, 0, 0, 0, 0, 0] }, { key: 'satSat', label: 'Colorista – Sat × Sat', kind: 'hidden', default: [0, 0, 0, 0, 0, 0, 0] }, num('fade', 'Haze / fade %', 0, 0, 100),
      num('vignette', 'Vinheta %', 0, 0, 100), num('vignetteSize', 'Tamanho da vinheta %', 50, 0, 100),
      num('diffusion', 'Difusão (glow) %', 0, 0, 300), num('diffusionRadius', 'Raio da difusão', 60, 1, 600), num('diffusionThreshold', 'Limiar da difusão %', 60, 0, 100), col('diffusionTint', 'Cor da difusão', [1, 1, 1, 1]),
      num('chroma', 'Aberração cromática', 0, 0, 50, 0.1),
      num('anamSize', 'Anamorphic Flare – tamanho', 0, 0, 1000), num('anamBoost', 'Anamorphic Flare – força', 1, 0, 5, 0.01), num('anamThreshold', 'Anamorphic Flare – limiar %', 70, 0, 100), adv(col('anamColor', 'Anamorphic Flare – cor', [0.35, 0.6, 1, 1])),
      num('hazeExposure', 'Haze/Flare – exposição (stops, -99 = desligado)', -99, -99, 4, 0.05), num('hazeSoftness', 'Haze/Flare – suavidade %', 60, 0, 100), num('hazeSpill', 'Haze/Flare – spillage %', 50, 0, 100), num('hazeReach', 'Haze/Flare – reach %', 50, 0, 100), adv(col('hazeTint', 'Haze/Flare – cor', [1, 0.92, 0.82, 1])),
      adv(num('lensDistort', 'Lens Distortion (+ barril / − almofada)', 0, -100, 100, 0.5)), adv(num('lensFlatten', 'Lens Distortion – flatten %', 0, 0, 100)),
      num('spotExposure', 'Spot Exposure (luz)', 0, -4, 4, 0.01), col('spotColor', 'Spot – cor da luz', [1, 1, 1, 1]), pos('spotCenter', 'Spot – centro', [0.5, 0.5]),
      num('spotSize', 'Spot – raio %', 50, 0, 400), num('spotSoft', 'Spot – spread %', 50, 0, 400), adv(num('spotAspect', 'Spot – proporção', 1, 0.1, 4, 0.01)), adv(bool('spotInvert', 'Spot – inverter', false)),
      num('edgeBlur', 'Edge Softness (desfoque nas bordas)', 0, 0, 100, 0.1), num('edgeSize', 'Edge – raio nítido %', 100, 0, 400), num('edgeSoft', 'Edge – spread %', 50, 0, 400),
      adv(pos('edgeCenter', 'Edge – centro', [0.5, 0.5])), adv(num('edgeAspect', 'Edge – proporção', 1, 0.1, 4, 0.01)),
      num('optDensity', 'Optical Diffusion – densidade %', 0, 0, 100), num('optSize', 'Optical Diffusion – tamanho', 50, 1, 500), num('optHighlights', 'Optical Diffusion – só realces %', 50, 0, 100), num('optGlow', 'Optical Diffusion – glow %', 0, 0, 200),
      adv(num('gradExposure', 'Gradient Exposure', 0, -4, 4, 0.01)), adv(ang('gradAngle', 'Gradient – ângulo', 0)), adv(num('gradOffset', 'Gradient – deslocamento', 0, -1, 1, 0.01)),
      adv(num('gradSoft', 'Gradient – suavidade / Falloff', 0.5, 0.01, 2, 0.01)), adv(col('gradColor', 'Gradient – cor (Color Balance)', [1, 1, 1, 1])),
      adv(num('lkContrast', 'Contrast (Looks) – contraste', 0, -1, 2, 0.005)), adv(num('lkPivot', 'Contrast (Looks) – pivot', 0.5, 0, 1, 0.005)), adv(num('lkComp', 'Contrast (Looks) – exposure compensation', 0, -2, 2, 0.01)),
      adv({ key: 'mixR', label: 'Post · Channel Mixer – Red (R,G,B)', kind: 'point3', default: [1, 0, 0] }), adv({ key: 'mixG', label: 'Post · Channel Mixer – Green (R,G,B)', kind: 'point3', default: [0, 1, 0] }), adv({ key: 'mixB', label: 'Post · Channel Mixer – Blue (R,G,B)', kind: 'point3', default: [0, 0, 1] }), adv(num('mixAmt', 'Post · Channel Mixer – Strength', 0, 0, 1, 0.01)),
      adv(bool('gradTwoPoint', 'Grad Exposure – por 2 pontos (Looks)', false)), adv(pos('gradP1', 'Grad Exposure – Ponto 1 (efeito total)', [0.5, 0])), adv(pos('gradP2', 'Grad Exposure – Ponto 2 (sem efeito)', [0.5, 0.5])),
      adv(col('filter', 'Filtro de cor', [1, 1, 1, 1])), adv(num('filterDensity', 'Densidade do filtro %', 0, 0, 100)), adv(ang('hue', 'Matiz global', 0)),
      adv(num('liftR', 'Sombras R', 0, -0.5, 0.5, 0.005)), adv(num('liftG', 'Sombras G', 0, -0.5, 0.5, 0.005)), adv(num('liftB', 'Sombras B', 0, -0.5, 0.5, 0.005)),
      adv(num('gammaR', 'Meios-tons R', 1, 0.3, 3, 0.01)), adv(num('gammaG', 'Meios-tons G', 1, 0.3, 3, 0.01)), adv(num('gammaB', 'Meios-tons B', 1, 0.3, 3, 0.01)),
      adv(num('gainR', 'Realces R', 1, 0, 3, 0.01)), adv(num('gainG', 'Realces G', 1, 0, 3, 0.01)), adv(num('gainB', 'Realces B', 1, 0, 3, 0.01)),
      ...HSL_COLORS.flatMap(([k, n]) => [
        adv(num(`hsl${k}H`, `HSL ${n} – matiz`, 0, -100, 100)), adv(num(`hsl${k}S`, `HSL ${n} – saturação`, 0, -100, 100)), adv(num(`hsl${k}L`, `HSL ${n} – luminância`, 0, -100, 100)),
      ]),
      ...[1, 2, 3, 4].flatMap((i) => [adv(num(`curve${i}x`, `Curva ponto ${i} – entrada`, -1, -1, 1, 0.001)), adv(num(`curve${i}y`, `Curva ponto ${i} – ajuste`, 0, -0.5, 0.5, 0.001))]),
    ],
    pad: (p) => (p.diffusion > 0 ? p.diffusionRadius * 0.5 : 0),
    render: (src, p, env) => {
      const { gl } = env;
      const s = p.strength / 100;
      const pts = [1, 2, 3, 4].map((i) => [p[`curve${i}x`], p[`curve${i}y`]]).filter(([x]) => x > 0 && x < 1).sort((a, b) => a[0] - b[0]);
      const curve = [0, 1, 2, 3].flatMap((i) => pts[i] || [1, 0]);
      let out = gl.pass(LOOKS, {
        u_tex: src, u_exp: p.exposure, u_sat: p.saturation / 100, u_hue: p.hue / 360, u_con: p.contrast / 100, u_fade: p.fade / 100,
        u_svl: { f1: (p.satLum && p.satLum.length === 7 ? p.satLum : [0, 0, 0, 0, 0, 0, 0]) }, u_svs: { f1: (p.satSat && p.satSat.length === 7 ? p.satSat : [0, 0, 0, 0, 0, 0, 0]) }, u_svon: [...(p.satLum || []), ...(p.satSat || [])].some((x) => Math.abs(x) > 1e-4) ? 1 : 0,
        u_mtint: Math.max(-1, Math.min(1, (p.mojoTint || 0) / 100)), u_2s: Math.max(0, Math.min(1, (p.twoStrip || 0) / 100)), u_mojo: p.mojo / 100, u_cool: (p.mojoCool ?? 50) / 50, u_skin: (p.mojoSkin ?? 50) / 50, u_punch: (p.punch || 0) / 100, u_bleach: (p.bleach || 0) / 100,
        u_temp: (p.temperature || 0) / 100, u_tint: (p.tint || 0) / 100,
        u_vig: p.vignette / 100, u_vsize: p.vignetteSize / 100, u_strength: s,
        u_filter: rgb(p.filter), u_fdens: p.filterDensity / 100,
        u_lift: [p.liftR, p.liftG, p.liftB], u_gamma: [p.gammaR, p.gammaG, p.gammaB], u_gain: [p.gainR, p.gainG, p.gainB],
        u_hsl: { vec3: HSL_COLORS.flatMap(([k]) => [p[`hsl${k}H`] || 0, p[`hsl${k}S`] || 0, p[`hsl${k}L`] || 0]) },
        u_curve: { vec2: curve }, u_ncurve: pts.length,
        u_spexp: p.spotExposure || 0, u_spc: p.spotCenter || [0.5, 0.5], u_spsize: (p.spotSize ?? 50) / 100, u_spsoft: Math.max(0.01, (p.spotSoft ?? 50) / 100), u_spcol: rgb(p.spotColor || [1, 1, 1, 1]),
        u_spasp: p.spotAspect ?? 1, u_spinv: !!p.spotInvert, u_imgasp: [1, env.h / env.w],
        u_grexp: p.gradExposure || 0, u_grang: p.gradAngle || 0, u_groff: p.gradOffset || 0, u_grsoft: Math.max(0.01, p.gradSoft ?? 0.5), u_grcol: rgb(p.gradColor || [1, 1, 1, 1]),
        u_mixr: p.mixR || [1, 0, 0], u_mixg: p.mixG || [0, 1, 0], u_mixb: p.mixB || [0, 0, 1], u_mixamt: (p.mixAmt || 0) * s, u_lkc: p.lkContrast || 0, u_lkpiv: p.lkPivot ?? 0.5, u_lkcomp: p.lkComp || 0, u_gr2: !!p.gradTwoPoint, u_grp1: p.gradP1 || [0.5, 0], u_grp2: p.gradP2 || [0.5, 0.5],
      });
      if (p.edgeBlur * s > 0.05) {
        const b = gl.blur(out, p.edgeBlur * 2 * s * env.scale);
        out = gl.pass(EDGE_SOFT, { u_tex: out, u_tex2: b, u_esize: (p.edgeSize ?? 100) / 100, u_soft: Math.max(0.01, (p.edgeSoft ?? 50) / 100), u_asp: p.edgeAspect ?? 1, u_ec: p.edgeCenter || [0.5, 0.5], u_imgasp: [1, env.h / env.w] });
      }
      if ((p.optDensity || 0) * s > 0.5 || (p.optGlow || 0) * s > 0.5) {
        // tamanho em % da diagonal (como no Looks)
        const sigma = ((p.optSize ?? 50) / 1000) * Math.hypot(env.w, env.h) * 0.25 * env.scale;
        const b = gl.blur(out, Math.max(1, sigma));
        out = gl.pass(OPTDIFF, { u_tex: out, u_tex2: b, u_dens: ((p.optDensity || 0) / 100) * s, u_hl: (p.optHighlights ?? 50) / 100, u_glow: ((p.optGlow || 0) / 100) * s });
      }
      if (p.diffusion * s >= 1) {
        let th = gl.pass(THRESH, { u_tex: out, u_thr: p.diffusionThreshold / 100 });
        const dt = p.diffusionTint || [1, 1, 1, 1];
        if (dt[0] < 0.995 || dt[1] < 0.995 || dt[2] < 0.995) th = gl.pass(TINTMUL, { u_tex: th, u_c: [dt[0], dt[1], dt[2]] });
        const b = gl.blur(th, p.diffusionRadius * 0.5 * env.scale);
        out = gl.pass(SCREEN_ADD, { u_tex: out, u_tex2: b, u_amount: (p.diffusion / 100) * s });
      }
      if ((p.hazeExposure ?? -99) > -20 && s > 0) {
        const small = gl.copy(out, 96, Math.max(16, Math.round(96 * out.h / out.w)));
        const soft = gl.blur(small, Math.max(0.5, ((p.hazeSoftness ?? 60) / 100) * small.h * 0.5 + 1), 3);
        out = gl.pass(HAZE, { u_tex: out, u_tex2: soft, u_exp: Math.pow(2, p.hazeExposure) * 0.4 * s, u_spill: Math.max(0.01, (p.hazeSpill ?? 16) / 100), u_reach: Math.max(0.02, (p.hazeReach ?? 50) / 100 * 0.5), u_tintc: rgb(p.hazeTint || [1, 0.92, 0.82, 1]) });
      }
      if ((p.anamSize || 0) > 0 && s > 0) {
        const hi = gl.pass(ANAM_HI, { u_tex: out, u_thr: (p.anamThreshold ?? 70) / 100, u_soft: 0.15 });
        const st = gl.pass(ANAM_STREAK, { u_tex: gl.pass(ANAM_STREAK, { u_tex: hi, u_len: p.anamSize * env.scale * 0.5 }), u_len: p.anamSize * env.scale });
        out = gl.pass(ANAM_ADD, { u_tex: out, u_tex2: st, u_boost: (p.anamBoost ?? 1) * 1.5 * s, u_col: rgb(p.anamColor || [0.35, 0.6, 1, 1]) });
      }
      if (Math.abs(p.lensDistort || 0) > 0.05) out = gl.pass(LENSD, { u_tex: out, u_k: (p.lensDistort / 100) * 0.35 * s, u_flat: (p.lensFlatten || 0) / 100 });
      if (p.chroma > 0 && s > 0) out = gl.pass(RADIAL_SPLIT, { u_tex: out, u_amt: (p.chroma / 1000) * s });
      return out;
    },
  },
  {
    type: 'sharpen', label: 'Nitidez (Sharpen)', category: 'Cor', plugin: 'S_Sharpen / Unsharp Mask / BCC Unsharp Mask',
    params: [num('amount', 'Quantidade %', 80, 0, 500), num('radius', 'Raio', 2, 0.3, 100, 0.1), num('threshold', 'Limiar', 0, 0, 255), bool('lumaOnly', 'Só luminância', false)],
    render: (src, p, env) => {
      if (p.amount <= 0) return src;
      const b = env.gl.blur(src, Math.max(0.3, p.radius * env.scale));
      return env.gl.pass(SHARPEN, { u_tex: src, u_tex2: b, u_amount: p.amount / 100, u_thr: p.threshold / 255, u_luma: p.lumaOnly });
    },
  },
  {
    type: 'fourColor', label: 'Gradiente de 4 cores', category: 'Cor',
    params: [
      pos('p1', 'Ponto 1', [0.1, 0.1]), col('c1', 'Cor 1', [1, 1, 0, 1]), pos('p2', 'Ponto 2', [0.9, 0.1]), col('c2', 'Cor 2', [0, 1, 0, 1]),
      pos('p3', 'Ponto 3', [0.1, 0.9]), col('c3', 'Cor 3', [1, 0, 1, 1]), pos('p4', 'Ponto 4', [0.9, 0.9]), col('c4', 'Cor 4', [0, 0, 1, 1]),
      num('blend', 'Mistura', 100, 1, 1000), num('opacity', 'Opacidade %', 100, 0, 100), sel('mode', 'Modo de mesclagem', BLEND_OPTIONS, 1),
    ],
    render: (src, p, env) => {
      const asp = env.w > env.h ? [env.w / env.h, 1] : [1, env.h / env.w];
      return env.gl.pass(FOURCOLOR, {
        u_tex: src, u_p1: p.p1, u_p2: p.p2, u_p3: p.p3, u_p4: p.p4, u_c1: rgb(p.c1), u_c2: rgb(p.c2), u_c3: rgb(p.c3), u_c4: rgb(p.c4),
        u_blend: Math.min(100, p.blend), u_op: p.opacity / 100, u_mode: p.mode, u_asp: asp,
      });
    },
  },
  {
    type: 'warp', label: 'Deformar (Warp)', category: 'Distorção',
    params: [sel('style', 'Estilo', WARP_STYLES, 1), sel('axis', 'Eixo', ['Horizontal', 'Vertical'], 1), num('bend', 'Curvar %', 50, -100, 100), num('hDist', 'Distorção horizontal %', 0, -100, 100), num('vDist', 'Distorção vertical %', 0, -100, 100)],
    pad: (p, env) => Math.max(env.w, env.h) * Math.min(0.5, Math.abs(p.bend) / 200),
    render: (src, p, env) => env.gl.pass(WARP, { u_tex: src, u_style: p.style, u_axis: p.axis, u_b: p.bend / 100, u_hd: p.hDist / 100, u_vd: p.vDist / 100 }),
  },
  {
    type: 'flicker', label: 'Flicker (cintilação)', category: 'Luz e brilho', plugin: 'S_Flicker',
    params: [num('amount', 'Amplitude %', 20, 0, 200), num('frequency', 'Frequência (Hz)', 12, 0.1, 60, 0.1), num('colorAmount', 'Variação de cor %', 0, 0, 100), num('brightness', 'Brilho base', 1, 0, 3, 0.01), num('seed', 'Semente', 1, 0, 999)],
    render: (src, p, env) => {
      const f = env.t * p.frequency;
      const a = p.amount / 100, c = (p.colorAmount / 100) * a;
      const base = p.brightness * (1 + noise1(f, p.seed) * a);
      const m = [base * (1 + noise1(f, p.seed + 3) * c), base * (1 + noise1(f, p.seed + 7) * c), base * (1 + noise1(f, p.seed + 11) * c)];
      return env.gl.pass(FLICKER, { u_tex: src, u_m: m });
    },
  },
  {
    type: 'photoFilter', label: 'Filtro de foto', category: 'Cor',
    params: [col('color', 'Cor', [1, 0.6, 0.2, 1]), num('density', 'Densidade %', 25, 0, 100), bool('preserve', 'Preservar luminosidade', true)],
    render: (src, p, env) => env.gl.pass(PHOTOFILTER, { u_tex: src, u_color: rgb(p.color), u_density: p.density / 100, u_preserve: p.preserve }),
  },
  {
    type: 'liftGammaGain', label: 'Colorista (3 vias)', category: 'Cor', plugin: 'Colorista',
    params: [
      num('liftR', 'Sombras R', 0, -0.5, 0.5, 0.005), num('liftG', 'Sombras G', 0, -0.5, 0.5, 0.005), num('liftB', 'Sombras B', 0, -0.5, 0.5, 0.005),
      num('gammaR', 'Meios-tons R', 1, 0.3, 3, 0.01), num('gammaG', 'Meios-tons G', 1, 0.3, 3, 0.01), num('gammaB', 'Meios-tons B', 1, 0.3, 3, 0.01),
      num('gainR', 'Realces R', 1, 0, 3, 0.01), num('gainG', 'Realces G', 1, 0, 3, 0.01), num('gainB', 'Realces B', 1, 0, 3, 0.01),
      num('saturation', 'Saturação %', 100, 0, 300),
    ],
    render: (src, p, env) => env.gl.pass(LGG, { u_tex: src, u_lift: [p.liftR, p.liftG, p.liftB], u_gamma: [p.gammaR, p.gammaG, p.gammaB], u_gain: [p.gainR, p.gainG, p.gainB], u_sat: p.saturation / 100 }),
  },
];

// Ajustes do Looks com os mesmos nomes e a mesma ordem das ferramentas do Magic Bullet Looks
// (Subject → Matte → Lens → Camera → Post), para mexer como no MBL do After Effects.
const MBL = [
  ['strength', 'Strength (força do Look) %'],
  ['exposure', 'Subject · Exposure (stops)'], ['spotExposure', 'Subject · Spot Exposure (stops)'], ['spotColor', 'Subject · Spot Exposure – Color Balance'], ['spotCenter', 'Subject · Spot Exposure – Center'],
  ['spotSize', 'Subject · Spot Exposure – Radius %'], ['spotSoft', 'Subject · Spot Exposure – Spread %'], ['spotAspect', 'Subject · Spot Exposure – Aspect'], ['spotInvert', 'Subject · Spot Exposure – Invert'],
  ['lkContrast', 'Subject · Contrast'], ['lkPivot', 'Subject · Contrast – Pivot'], ['lkComp', 'Subject · Contrast – Exposure Compensation'],
  ['gradTwoPoint', 'Subject · Grad Exposure (ligar)'], ['gradExposure', 'Subject · Grad Exposure (stops)'], ['gradP1', 'Subject · Grad Exposure – X1/Y1'], ['gradP2', 'Subject · Grad Exposure – X2/Y2'],
  ['gradSoft', 'Subject · Grad Exposure – Falloff'], ['gradColor', 'Subject · Grad Exposure – Color Balance'],
  ['hazeExposure', 'Matte · Haze/Flare – Exposure (−99 = off)'], ['hazeSoftness', 'Matte · Haze/Flare – Softness %'], ['hazeSpill', 'Matte · Haze/Flare – Spillage %'], ['hazeTint', 'Matte · Haze/Flare – Color'],
  ['diffusion', 'Matte · Diffusion – Glow %'], ['diffusionRadius', 'Matte · Diffusion – Size'], ['diffusionThreshold', 'Matte · Diffusion – Highlights %'],
  ['filter', 'Lens · Warming/Cooling – Color'], ['filterDensity', 'Lens · Warming/Cooling – Strength %'],
  ['optDensity', 'Lens · Optical Diffusion – Density %'], ['optSize', 'Lens · Optical Diffusion – Size'], ['optHighlights', 'Lens · Optical Diffusion – Highlights Only %'], ['optGlow', 'Lens · Optical Diffusion – Glow %'],
  ['vignette', 'Lens · Lens Vignette – Amount %'], ['vignetteSize', 'Lens · Lens Vignette – Size %'],
  ['chroma', 'Lens · Chromatic Aberration'], ['lensDistort', 'Lens · Lens Distortion'], ['lensFlatten', 'Lens · Lens Distortion – Flatten %'],
  ['edgeBlur', 'Lens · Edge Softness – Blur'], ['edgeSize', 'Lens · Edge Softness – Radius %'], ['edgeSoft', 'Lens · Edge Softness – Spread %'], ['edgeCenter', 'Lens · Edge Softness – Center'], ['edgeAspect', 'Lens · Edge Softness – Aspect'],
  ['anamSize', 'Lens · Anamorphic Flare – Size'], ['anamBoost', 'Lens · Anamorphic Flare – Boost'], ['anamThreshold', 'Lens · Anamorphic Flare – Threshold %'], ['anamColor', 'Lens · Anamorphic Flare – Color'],
  ['temperature', 'Camera · Color Temperature'], ['tint', 'Camera · Tint'],
  ['mojo', 'Post · Mojo II – Mojo %'], ['mojoCool', 'Post · Mojo II – Cool It %'], ['mojoSkin', 'Post · Mojo II – Warm Skin %'],
  ['punch', 'Post · Mojo II – Punch It %'], ['bleach', 'Post · Mojo II – Bleach It %'], ['fade', 'Post · Mojo II – Fade It %'],
  ['saturation', 'Post · Hue/Saturation – Saturation %'], ['hue', 'Post · Hue/Saturation – Hue'], ['contrast', 'Post · Contrast (curva S)'],
  ['liftR', 'Post · Colorista – Shadows R'], ['liftG', 'Post · Colorista – Shadows G'], ['liftB', 'Post · Colorista – Shadows B'],
  ['gammaR', 'Post · Colorista – Midtones R'], ['gammaG', 'Post · Colorista – Midtones G'], ['gammaB', 'Post · Colorista – Midtones B'],
  ['gainR', 'Post · Colorista – Highlights R'], ['gainG', 'Post · Colorista – Highlights G'], ['gainB', 'Post · Colorista – Highlights B'],
];
{
  const looks = EFFECTS.find((e) => e.type === 'looks');
  const byKey = new Map(looks.params.map((p) => [p.key, p]));
  const ordered = MBL.filter(([k]) => byKey.has(k)).map(([k, label]) => ({ ...byKey.get(k), label }));
  const used = new Set(MBL.map(([k]) => k));
  const rest = looks.params.filter((p) => !used.has(p.key)).map((p) => ({ ...p, label: p.key.startsWith('hsl') ? `Post · Colorista ${p.label}` : p.key.startsWith('curve') ? `Post · Curves – ${p.label.replace('Curva ', '')}` : p.label }));
  looks.params = [...ordered, ...rest];
  // as ferramentas que o MBL deixa sempre visíveis
  for (const p of looks.params) if (['strength', 'exposure', 'lkContrast', 'mojo', 'punch', 'bleach', 'fade', 'saturation', 'temperature', 'tint', 'diffusion', 'vignette', 'chroma'].includes(p.key)) delete p.advanced;
  looks.description = 'Recriação do Magic Bullet Looks: ajustes com os mesmos nomes das ferramentas do MBL (Subject, Matte, Lens, Camera, Post). Presets .ffx com Looks preenchem tudo sozinhos.';
}

export default EFFECTS;
