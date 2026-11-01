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

// "Looks": um único efeito com as ferramentas mais usadas do Magic Bullet Looks.
const LOOKS = frag(`
uniform float u_exp, u_sat, u_hue, u_con, u_fade, u_mojo, u_vig, u_vsize, u_strength;
uniform vec3 u_filter, u_lift, u_gamma, u_gain; uniform float u_fdens;
void main() {
  vec4 c0 = unpre(texture2D(u_tex, v_uv));
  vec3 r = c0.rgb;
  r = pow(pow(max(r, 0.0), vec3(2.2)) * pow(2.0, u_exp), vec3(1.0 / 2.2)); // exposição em luz linear
  vec3 f = r * u_filter; f *= luma(r) / max(luma(f), 0.0001); r = mix(r, f, u_fdens);
  r = u_gain * (r + u_lift * (1.0 - r));
  r = pow(max(r, 0.0), 1.0 / max(u_gamma, vec3(0.01)));
  vec3 h = rgb2hsv(clamp(r, 0.0, 1.0)); h.x = fract(h.x + u_hue); r = hsv2rgb(h);
  float l = luma(r);
  // Mojo: sombras azuladas, tons de pele/realces alaranjados
  vec3 teal = vec3(0.0, 0.35, 0.45), orange = vec3(1.0, 0.62, 0.32);
  r = mix(r, mix(r * mix(vec3(1.0), teal * 2.0, 0.5), r * mix(vec3(1.0), orange * 1.4, 0.5), smoothstep(0.15, 0.75, l)), u_mojo);
  r = (r - 0.45) * (1.0 + u_con) + 0.45;
  r = mix(vec3(luma(r)), r, u_sat);
  r = mix(r, vec3(0.08) + r * 0.86, u_fade);
  vec2 cu = contentUV(v_uv) - 0.5;
  r *= 1.0 - smoothstep(u_vsize, u_vsize + 0.5, length(cu) * 1.4142) * u_vig;
  r = clamp(r, 0.0, 1.0);
  gl_FragColor = pre(vec4(mix(c0.rgb, r, u_strength), c0.a));
}`);

const THRESH = frag(`
uniform float u_thr;
void main() { vec4 c = unpre(texture2D(u_tex, v_uv)); gl_FragColor = pre(vec4(c.rgb, c.a * smoothstep(u_thr - 0.1, u_thr + 0.15, luma(c.rgb)))); }`);
const SCREEN_ADD = frag(`
uniform sampler2D u_tex2; uniform float u_amount;
void main() { vec4 s = texture2D(u_tex, v_uv); vec4 g = texture2D(u_tex2, v_uv) * u_amount; gl_FragColor = vec4(s.rgb + g.rgb * (s.a - s.rgb), s.a); }`);
const RADIAL_SPLIT = frag(`
uniform float u_amt;
void main() {
  vec2 o = (v_uv - (u_rect.xy + u_rect.zw * 0.5)) * u_amt;
  vec4 r = samp(v_uv + o), g = texture2D(u_tex, v_uv), b = samp(v_uv - o);
  gl_FragColor = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
}`);

const BLEND_OPTIONS = ['Nenhum', 'Normal', 'Adicionar', 'Multiplicar', 'Tela', 'Sobrepor', 'Luz suave', 'Luz direta', 'Subexpor cor', 'Superexpor cor', 'Escurecer', 'Clarear', 'Diferença', 'Exclusão'];
export const WARP_STYLES = ['Arco', 'Arco inferior', 'Arco superior', 'Arqueado', 'Bojo', 'Concha inferior', 'Concha superior', 'Bandeira', 'Onda', 'Peixe', 'Elevar', 'Olho de peixe', 'Inflar', 'Torcer', 'Comprimir'] // mesma ordem do AE;

export default [
  {
    type: 'looks', label: 'Looks (CC completo)', category: 'Cor', plugin: 'Magic Bullet Looks',
    description: 'Exposição, filtro, Colorista (lift/gamma/gain), Mojo (teal & orange), contraste, saturação, haze, vinheta, difusão e aberração — tudo em um efeito. Presets com Magic Bullet Looks são convertidos para cá.',
    params: [
      num('strength', 'Força %', 100, 0, 100), num('exposure', 'Exposição', 0, -3, 3, 0.01),
      col('filter', 'Filtro de cor', [1, 1, 1, 1]), num('filterDensity', 'Densidade do filtro %', 0, 0, 100),
      num('liftR', 'Sombras R', 0, -0.5, 0.5, 0.005), num('liftG', 'Sombras G', 0, -0.5, 0.5, 0.005), num('liftB', 'Sombras B', 0, -0.5, 0.5, 0.005),
      num('gammaR', 'Meios-tons R', 1, 0.3, 3, 0.01), num('gammaG', 'Meios-tons G', 1, 0.3, 3, 0.01), num('gammaB', 'Meios-tons B', 1, 0.3, 3, 0.01),
      num('gainR', 'Realces R', 1, 0, 3, 0.01), num('gainG', 'Realces G', 1, 0, 3, 0.01), num('gainB', 'Realces B', 1, 0, 3, 0.01),
      ang('hue', 'Matiz', 0), num('saturation', 'Saturação %', 100, 0, 300), num('contrast', 'Contraste', 0, -100, 100),
      num('mojo', 'Mojo (teal & orange) %', 0, 0, 100), num('fade', 'Haze / fade %', 0, 0, 100),
      num('vignette', 'Vinheta %', 0, 0, 100), num('vignetteSize', 'Tamanho da vinheta %', 50, 0, 100),
      num('diffusion', 'Difusão (glow) %', 0, 0, 300), num('diffusionRadius', 'Raio da difusão', 60, 1, 600), num('diffusionThreshold', 'Limiar da difusão %', 60, 0, 100),
      num('chroma', 'Aberração cromática', 0, 0, 50, 0.1),
    ],
    pad: (p) => (p.diffusion > 0 ? p.diffusionRadius * 0.5 : 0),
    render: (src, p, env) => {
      const { gl } = env;
      const s = p.strength / 100;
      let out = gl.pass(LOOKS, {
        u_tex: src, u_exp: p.exposure, u_sat: p.saturation / 100, u_hue: p.hue / 360, u_con: p.contrast / 100, u_fade: p.fade / 100,
        u_mojo: p.mojo / 100, u_vig: p.vignette / 100, u_vsize: p.vignetteSize / 100, u_strength: s,
        u_filter: rgb(p.filter), u_fdens: p.filterDensity / 100,
        u_lift: [p.liftR, p.liftG, p.liftB], u_gamma: [p.gammaR, p.gammaG, p.gammaB], u_gain: [p.gainR, p.gainG, p.gainB],
      });
      if (p.diffusion * s >= 1) {
        const th = gl.pass(THRESH, { u_tex: out, u_thr: p.diffusionThreshold / 100 });
        const b = gl.blur(th, p.diffusionRadius * 0.5 * env.scale);
        out = gl.pass(SCREEN_ADD, { u_tex: out, u_tex2: b, u_amount: (p.diffusion / 100) * s });
      }
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

