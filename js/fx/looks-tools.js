// Ferramentas do Magic Bullet Looks como efeitos separados (Subject, Matte, Lens, Camera, Post), na ordem do Looks.
// Cada ferramenta é configurável e animável. As que o efeito "Looks" já recria (Diffusion, Haze, Edge Softness, Mojo,
// Spot Exposure, Lens Vignette, Chromatic Aberration…) usam a mesma implementação calibrada; as de cor simples usam o
// shader LOOKTOOL abaixo (um modo por ferramenta).
import { frag, num, ang, bool, sel, pos, col, rgb, rad } from './common.js';
import { EFFECT_MAP } from '../effects.js';

const LOOKTOOL = frag(`
uniform float u_mode, u_a, u_b, u_c, u_d, u_e; uniform vec3 u_c1, u_c2, u_c3; uniform float u_str;
vec3 rgb2hsvL(vec3 c) { vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x); }
vec3 hsv2rgbL(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
float lu(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGam(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = unpre(s).rgb, o = c;
  float m = u_mode;
  if (m < 1.5) {                       // 1 Brightness & Contrast (aditivo / não linear)
    o = (c - 0.5) * (1.0 + u_b) + 0.5 + u_a;
  } else if (m < 2.5) {                // 2 Color Balance HLS (matiz, luminosidade, saturação globais)
    vec3 h = rgb2hsvL(c); h.x = fract(h.x + u_a / 360.0); h.y = clamp(h.y * (1.0 + u_c), 0.0, 1.0); o = hsv2rgbL(h); o = u_b >= 0.0 ? mix(o, vec3(1.0), u_b) : o * (1.0 + u_b);
  } else if (m < 3.5) {                // 3 Exposure (stops, luz linear) + contraste em torno do pivô + gama dos meios-tons
    vec3 l = toLin(c) * exp2(u_a); float pv = max(1e-3, pow(u_c, 2.2)); l = pv * pow(max(l / pv, 0.0), vec3(1.0 + u_b)); o = pow(clamp(toGam(l), 0.0, 4.0), vec3(1.0 / max(u_d, 0.05)));
  } else if (m < 4.5) {                // 4 Saturation + Vibrance (mais nas cores com menos saturação)
    float L = lu(c), sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    o = mix(vec3(L), c, u_a * (1.0 + u_b * (1.0 - sat)));
  } else if (m < 5.5) {                // 5 Color Balance (Warm/Cool, Green/Magenta) em luz linear
    vec3 l = toLin(c); l *= exp2(vec3(-u_a - u_b, u_b, u_a) * 0.5); o = toGam(l);
  } else if (m < 6.5) {                // 6 Shadows & Highlights: levanta/esmaga as pontas
    float L = lu(c); float sh = 1.0 - smoothstep(0.0, 0.5, L), hi = smoothstep(0.5, 1.0, L);
    o = c + u_a * sh * (1.0 - c) * 0.6 + u_b * hi * c * 0.6;
  } else if (m < 7.5) {                // 7 Color Tune: matiz, saturação, brilho, escala de cor e lift dos escuros
    vec3 h = rgb2hsvL(c); h.x = fract(h.x + u_a / 360.0); h.y = clamp(h.y * u_b, 0.0, 1.0); o = hsv2rgbL(h) * u_c * u_c1 + u_d * (1.0 - lu(c));
  } else if (m < 8.5) {                // 8 Selective Color: ciano/magenta/amarelo/preto dentro de uma faixa de matiz
    vec3 h = rgb2hsvL(c); float d = abs(mod(h.x * 360.0 - u_e + 180.0, 360.0) - 180.0); float w = (1.0 - smoothstep(20.0, 45.0, d)) * smoothstep(0.05, 0.25, h.y);
    o = clamp(c - vec3(u_a, u_b, u_c) * 0.5 * w - u_d * 0.5 * w * c, 0.0, 1.0);
  } else if (m < 9.5) {                // 9 Gradient Map: luminosidade → degradê de 2 cores (com repetições)
    float L = fract(lu(c) * max(1.0, u_a) * 0.9999); o = mix(c, mix(u_c1, u_c2, L), u_b);
  } else if (m < 10.5) {               // 10 Film Stock: split tone (sombras teal, realces quentes) + fade
    float L = lu(c); vec3 st = mix(u_c1, u_c2, smoothstep(0.15, 0.85, L)); o = mix(c, c * st * 2.0, u_a); o = mix(o, vec3(0.06) + o * 0.9, u_b);
  } else if (m < 11.5) {               // 11 Bleach Bypass (prata retida): cópia P&B em overlay
    vec3 L = vec3(lu(c)); vec3 ov = mix(2.0 * c * L, 1.0 - 2.0 * (1.0 - c) * (1.0 - L), step(0.5, L)); o = mix(c, mix(ov, L * 0.6 + ov * 0.4, u_b), u_a);
  } else if (m < 12.5) {               // 12 Cross Process: curvas opostas por canal
    vec3 x = c; o = vec3(smoothstep(0.0, 1.0, x.r) * 1.08, x.g + 0.08 * sin(x.g * 3.14159), x.b * 0.75 + 0.12); o = mix(c, o, u_a);
  } else if (m < 13.5) {               // 13 Faded Film: pretos levantados, brancos comprimidos, cor mais fraca
    o = vec3(u_a * 0.25) + c * (1.0 - u_a * 0.25 - u_b * 0.2); o = mix(vec3(lu(o)), o, 1.0 - u_c * 0.5);
  } else if (m < 14.5) {               // 14 Colorize: luminosidade × cor
    o = mix(c, lu(c) * u_c1 * 1.6, u_a);
  } else if (m < 15.5) {               // 15 Film Print: curva de cópia (contraste, realces quentes, sombras densas)
    vec3 x = clamp(c, 0.0, 1.0); vec3 sc = x * x * (3.0 - 2.0 * x); o = mix(c, sc * vec3(1.04, 1.0, 0.94) - vec3(0.0, 0.0, 0.02) * (1.0 - x), u_a);
  } else if (m < 16.5) {               // 16 Teal & Orange
    vec3 h = rgb2hsvL(c); float warm = 1.0 - smoothstep(60.0, 100.0, h.x * 360.0) + smoothstep(320.0, 345.0, h.x * 360.0);
    vec3 tgt = mix(vec3(0.0, 0.5, 0.55), vec3(1.0, 0.55, 0.25), warm) * lu(c) * 1.8; o = mix(c, mix(c, tgt, 0.5), u_a);
  } else if (m < 17.5) {               // 17 Looks Light: ganho por canal em stops (luz linear ou no valor)
    o = u_b > 0.5 ? c * exp2(u_c1) : toGam(toLin(c) * exp2(u_c1));
  } else if (m < 18.5) {               // 18 S Curve: contraste, ponto médio, brilho, preto e branco
    vec3 x = clamp((c - u_c) / max(u_d - u_c, 1e-3), 0.0, 1.0); vec3 s1 = x * x * (3.0 - 2.0 * x); vec3 sc = mix(x, s1, clamp(u_a, 0.0, 2.0)); o = sc + (u_b - 0.5);
  } else if (m < 19.5) {               // 19 Scanlines
    float y = gl_FragCoord.y / max(u_a, 1.0); o = c * (1.0 - u_b * step(0.5, fract(y)));
  } else if (m < 20.5) {               // 20 Solarize: inverte acima do limiar
    o = mix(c, vec3(1.0) - c, step(vec3(u_a), c));
  } else if (m < 21.5) {               // 21 Shadows/Mids/Highs Tint (3-Way Color): cor nas três faixas
    float L = lu(c); float sh = 1.0 - smoothstep(0.0, 0.45, L), hi = smoothstep(0.55, 1.0, L), mi = 1.0 - sh - hi;
    o = c + ((u_c1 - 0.5) * sh + (u_c2 - 0.5) * mi + (u_c3 - 0.5) * hi) * u_a;
  } else if (m < 22.5) {               // 22 Shadows & Highlights do Looks: curva na luminância, cor escala junto (escuros perdem cor)
    float L = clamp(lu(c), 0.0, 1.0), q = 1.0 - L;
    float f = clamp(L + u_a * u_c * L * q * q * q * q + u_b * 1.03 * L * L * L * L * q, 0.0, 1.0);
    o = mix(c * (f / max(L, 1e-4)), c + (f - L), 0.35);
  }
  o = clamp(o, 0.0, 1.0);
  gl_FragColor = pre(vec4(mix(c, o, u_str), unpre(s).a));
}`);

export let SH_K = 0.6;
export const setShK = (k) => { SH_K = k; };
const defaultsOf = (type) => {
  const d = EFFECT_MAP[type];
  const out = {};
  for (const p of d?.params || []) out[p.key] = Array.isArray(p.default) ? p.default.slice() : p.default;
  return out;
};
/** Ferramenta que usa a implementação de outro efeito (mesmo resultado calibrado), com parâmetros traduzidos. */
function via(type, map) {
  return {
    pad: (p, ctx) => EFFECT_MAP[type]?.pad?.({ ...defaultsOf(type), ...map(p) }, ctx) || 0,
    render: (src, p, env) => {
      const def = EFFECT_MAP[type];
      if (!def?.render) return src;
      const q = { ...defaultsOf(type), ...map(p) };
      const out = def.render(src, q, env);
      const k = (p.str ?? 100) / 100;
      return k < 0.999 && out && out !== src ? env.gl.mix(src, out, Math.max(0, k)) : out;
    },
  };
}
/** Ferramenta de cor do shader LOOKTOOL. */
function lt(mode, map) {
  return {
    render: (src, p, env) => {
      const u = map(p);
      return env.gl.pass(LOOKTOOL, { u_tex: src, u_mode: mode, u_a: u.a ?? 0, u_b: u.b ?? 0, u_c: u.c ?? 0, u_d: u.d ?? 0, u_e: u.e ?? 0, u_c1: u.c1 || [1, 1, 1], u_c2: u.c2 || [1, 1, 1], u_c3: u.c3 || [1, 1, 1], u_str: (p.str ?? 100) / 100 });
    },
  };
}
const STR = num('str', 'Strength %', 100, 0, 100);
const tool = (type, label, cat, desc, params, impl) => ({ type, label, category: `Looks · ${cat}`, plugin: `Magic Bullet Looks – ${label}`, description: desc, params: [STR, ...params], ...impl });
const HUES = [['Red', 'Vermelho'], ['Orange', 'Laranja'], ['Yellow', 'Amarelo'], ['Green', 'Verde'], ['Aqua', 'Ciano'], ['Blue', 'Azul'], ['Purple', 'Roxo'], ['Magenta', 'Magenta']];

export default [
  // ------------------------------------------------------------ SUBJECT
  tool('lkColorRanges', 'Color Ranges', 'Subject', 'Matiz, saturação e luminosidade em 8 faixas de cor (vermelho, laranja, amarelo, verde, ciano, azul, roxo, magenta).',
    HUES.flatMap(([k, n]) => [num(`h${k}`, `${n} – matiz`, 0, -100, 100), num(`s${k}`, `${n} – saturação`, 0, -100, 100), num(`l${k}`, `${n} – luminosidade`, 0, -100, 100)]),
    via('looks', (p) => Object.fromEntries(HUES.flatMap(([k]) => [[`hsl${k}H`, p[`h${k}`]], [`hsl${k}S`, p[`s${k}`]], [`hsl${k}L`, p[`l${k}`]]])))),
  tool('lkBrightCon', 'Brightness & Contrast', 'Subject', 'Brilho e contraste com resposta aditiva.', [num('bright', 'Brightness', 0, -1, 1, 0.01), num('con', 'Contrast', 0, -1, 2, 0.01)], lt(1, (p) => ({ a: p.bright, b: p.con }))),
  tool('lkHLS', 'Color Balance HLS', 'Subject', 'Matiz, luminosidade e saturação globais.', [ang('hue', 'Hue', 0), num('light', 'Lightness', 0, -1, 1, 0.01), num('sat', 'Saturation', 0, -1, 2, 0.01)], lt(2, (p) => ({ a: p.hue, b: p.light, c: p.sat }))),
  tool('lkExposure', 'Exposure', 'Subject', 'Exposição em stops (luz linear), contraste em torno de um pivô e gama dos meios-tons.',
    [num('stops', 'Exposure (stops)', 0, -5, 5, 0.01), num('con', 'Contrast', 0, -1, 2, 0.01), num('pivot', 'Contrast pivot %', 50, 1, 99), num('gamma', 'Midtone gamma', 1, 0.2, 3, 0.01)], lt(3, (p) => ({ a: p.stops, b: p.con, c: p.pivot / 100, d: p.gamma }))),
  tool('lkSaturation', 'Saturation', 'Subject', 'Saturação e vibrance (mais nas cores que têm menos).', [num('sat', 'Saturation %', 100, 0, 300), num('vib', 'Vibrance', 0, -1, 1, 0.01)], lt(4, (p) => ({ a: p.sat / 100, b: p.vib }))),
  tool('lkColorBalance', 'Color Balance', 'Subject', 'Balanço de branco: quente contra frio, verde contra magenta.', [num('warm', 'Warm / Cool (stops)', 0, -2, 2, 0.01), num('tint', 'Green / Magenta', 0, -2, 2, 0.01)], lt(5, (p) => ({ a: p.warm, b: p.tint }))),
  // Shadows/Highlights do Looks, medido no tutorial: curva na luminância y = x + S·k·x(1−x)⁴ + H·1,03·x⁴(1−x) (k=0,6),
  // a cor escala junto com a luz (os escuros perdem um pouco de cor, como no Looks).
  tool('lkShadowsHighs', 'Shadows & Highlights', 'Subject', 'Levanta ou esmaga os escuros e os claros separadamente.', [num('shadows', 'Shadows', 0, -1, 1, 0.01), num('highs', 'Highlights', 0, -1, 1, 0.01)],
    lt(22, (p) => ({ a: p.shadows, b: p.highs, c: SH_K }))),
  tool('lk3Way', '3-Way Color', 'Subject', 'Lift, gamma e gain por canal (como os três discos de um corretor de cor).',
    [col('lift', 'Lift (sombras)', [0.5, 0.5, 0.5, 1]), col('gamma', 'Gamma (meios-tons)', [0.5, 0.5, 0.5, 1]), col('gain', 'Gain (realces)', [0.5, 0.5, 0.5, 1]), num('amt', 'Intensidade', 1, 0, 3, 0.01)],
    lt(21, (p) => ({ a: p.amt, c1: rgb(p.lift), c2: rgb(p.gamma), c3: rgb(p.gain) }))),
  tool('lkColorTune', 'Color Tune', 'Subject', 'Matiz, saturação, brilho, escala de cor e lift dos escuros.',
    [ang('hue', 'Hue', 0), num('sat', 'Saturation', 1, 0, 3, 0.01), num('bright', 'Brightness', 1, 0, 3, 0.01), col('scale', 'Color scale', [1, 1, 1, 1]), num('lift', 'Lift darks', 0, -0.5, 0.5, 0.01)],
    lt(7, (p) => ({ a: p.hue, b: p.sat, c: p.bright, c1: rgb(p.scale), d: p.lift }))),
  tool('lkHueCurves', 'Hue Curves', 'Subject', 'Gira as matizes conforme a posição na roda de cor.', HUES.map(([k, n]) => num(`h${k}`, `${n} – girar`, 0, -100, 100)), via('looks', (p) => Object.fromEntries(HUES.map(([k]) => [`hsl${k}H`, p[`h${k}`]])))),
  tool('lkSatCurves', 'Saturation Curves', 'Subject', 'Satura ou tira a cor por matiz.', HUES.map(([k, n]) => num(`s${k}`, `${n} – saturação`, 0, -100, 100)), via('looks', (p) => Object.fromEntries(HUES.map(([k]) => [`hsl${k}S`, p[`s${k}`]])))),
  tool('lkSelective', 'Selective Color', 'Subject', 'Ciano, magenta, amarelo e preto dentro de uma faixa de matiz.',
    [ang('range', 'Faixa de matiz (centro)', 0), num('cyan', 'Cyan', 0, -1, 1, 0.01), num('magenta', 'Magenta', 0, -1, 1, 0.01), num('yellow', 'Yellow', 0, -1, 1, 0.01), num('black', 'Black', 0, -1, 1, 0.01)],
    lt(8, (p) => ({ a: p.cyan, b: p.magenta, c: p.yellow, d: p.black, e: ((p.range % 360) + 360) % 360 }))),
  tool('lkChannelMixer', 'Channel Mixer', 'Subject', 'Mistura os canais de entrada em cada canal de saída.',
    [num('rr', 'Red ← R', 1, -2, 2, 0.01), num('rg', 'Red ← G', 0, -2, 2, 0.01), num('rb', 'Red ← B', 0, -2, 2, 0.01), num('gr', 'Green ← R', 0, -2, 2, 0.01), num('gg', 'Green ← G', 1, -2, 2, 0.01), num('gb', 'Green ← B', 0, -2, 2, 0.01), num('br', 'Blue ← R', 0, -2, 2, 0.01), num('bg', 'Blue ← G', 0, -2, 2, 0.01), num('bb', 'Blue ← B', 1, -2, 2, 0.01)],
    via('looks', (p) => ({ mixR: [p.rr, p.rg, p.rb], mixG: [p.gr, p.gg, p.gb], mixB: [p.br, p.bg, p.bb], mixAmt: 1 }))),
  tool('lkSpotExposure', 'Spot Exposure', 'Subject', 'Clareia ou escurece uma área redonda (rosto, sujeito).',
    [num('stops', 'Exposure (stops)', 0.5, -4, 4, 0.01), pos('center', 'Centro'), num('size', 'Tamanho %', 50, 1, 200), num('soft', 'Suavidade %', 50, 0, 100), bool('invert', 'Inverter (fora da área)', false)],
    via('looks', (p) => ({ spotExposure: p.stops, spotCenter: p.center, spotSize: p.size, spotSoft: p.soft, spotInvert: p.invert }))),
  // ------------------------------------------------------------ MATTE
  tool('lkGradient', 'Gradient', 'Matte', 'Filtro graduado: exposição/cor forte no início, some no fim.',
    [num('stops', 'Exposure (stops)', -1, -4, 4, 0.01), col('color', 'Cor', [1, 1, 1, 1]), pos('p1', 'Início', [0.5, 0]), pos('p2', 'Fim', [0.5, 0.5]), num('soft', 'Falloff', 0.5, 0.01, 2, 0.01)],
    via('looks', (p) => ({ gradTwoPoint: true, gradExposure: p.stops, gradColor: p.color, gradP1: p.p1, gradP2: p.p2, gradSoft: p.soft }))),
  tool('lkPhotoFilter', 'Photo Filter', 'Matte', 'Filtro fotográfico colorido com densidade.', [col('color', 'Cor', [1, 0.6, 0.2, 1]), num('density', 'Density %', 25, 0, 100)], via('photoFilter', (p) => ({ color: p.color, density: p.density }))),
  tool('lkTempTint', 'Temperature & Tint', 'Matte', 'Quente/frio e verde/magenta em luz linear.', [num('temp', 'Temperature', 0, -100, 100), num('tint', 'Tint', 0, -100, 100)], via('looks', (p) => ({ temperature: p.temp, tint: p.tint }))),
  tool('lkTint', 'Tint', 'Matte', 'Mapeia a imagem entre duas cores.', [col('black', 'Preto →', [0, 0, 0, 1]), col('white', 'Branco →', [1, 1, 1, 1]), num('amount', 'Quantidade %', 100, 0, 100)], via('tint', (p) => ({ black: p.black, white: p.white, amount: p.amount }))),
  tool('lkTritone', 'Tritone', 'Matte', 'Cores de sombras, meios-tons e realces.', [col('sh', 'Sombras', [0.1, 0.1, 0.25, 1]), col('mid', 'Meios-tons', [0.5, 0.45, 0.4, 1]), col('hi', 'Realces', [1, 0.95, 0.85, 1]), num('mix', 'Mistura %', 100, 0, 100)],
    via('tritone', (p) => ({ shadows: p.sh, midtones: p.mid, highlights: p.hi, mix: p.mix }))),
  tool('lkGradientMap', 'Gradient Map', 'Matte', 'A luminosidade vira um degradê de duas cores (pode repetir).', [col('c1', 'Cor 1', [0.05, 0.1, 0.3, 1]), col('c2', 'Cor 2', [1, 0.7, 0.3, 1]), num('reps', 'Repetições', 1, 1, 10, 1), num('mix', 'Mistura %', 100, 0, 100)],
    lt(9, (p) => ({ a: p.reps, b: p.mix / 100, c1: rgb(p.c1), c2: rgb(p.c2) }))),
  tool('lkColorWash', 'Color Wash', 'Matte', 'Quatro cores lavadas sobre a imagem a partir de quatro pontos.',
    [col('c1', 'Cor 1', [1, 0.5, 0.2, 1]), col('c2', 'Cor 2', [0.2, 0.5, 1, 1]), col('c3', 'Cor 3', [1, 0.2, 0.6, 1]), col('c4', 'Cor 4', [0.2, 1, 0.7, 1]), num('opacity', 'Opacidade %', 30, 0, 100)],
    via('fourColor', (p) => ({ c1: p.c1, c2: p.c2, c3: p.c3, c4: p.c4, opacity: p.opacity, mode: 7 }))),
  // ------------------------------------------------------------ LENS
  tool('lkLensVignette', 'Lens Vignette', 'Lens', 'Queda de luz ótica nos cantos (negativo clareia as bordas).', [num('amount', 'Amount %', 50, -100, 100), num('size', 'Size %', 50, 1, 100)],
    via('looks', (p) => ({ vignette: Math.max(0, p.amount), vignetteSize: p.size, exposure: p.amount < 0 ? -p.amount / 300 : 0 }))),
  tool('lkDiffusion', 'Diffusion', 'Lens', 'Realces “florescem” suavemente, como um filtro de difusão.', [num('amount', 'Glow %', 40, 0, 150), num('radius', 'Size', 60, 1, 600), num('threshold', 'Threshold %', 60, 0, 100), col('tint', 'Tint', [1, 1, 1, 1])],
    via('looks', (p) => ({ diffusion: p.amount * 0.6, diffusionRadius: p.radius, diffusionThreshold: p.threshold, diffusionTint: p.tint || [1, 1, 1, 1] }))), // ×0,6: medido no tutorial (Optical Diffusion 30 / 250)
  tool('lkEdgeSoftness', 'Edge Softness', 'Lens', 'Desfoque que aumenta em direção às bordas do quadro.', [num('blur', 'Blur', 4, 0, 100, 0.1), num('size', 'Área nítida %', 100, 0, 400), num('soft', 'Spread %', 50, 1, 400), pos('center', 'Centro')],
    via('looks', (p) => ({ edgeBlur: p.blur, edgeSize: p.size, edgeSoft: p.soft, edgeCenter: p.center }))),
  tool('lkHaze', 'Haze/Flare', 'Lens', 'Luz que entra pelas laterais e se espalha pela imagem (Looks Haze/Flare).', [num('exposure', 'Exposure', 0, -6, 4, 0.01), num('spill', 'Spillage', 50, 0, 100), num('soft', 'Softness', 60, 0, 100), num('reach', 'Reach', 50, 0, 100), col('tint', 'Cor', [1, 0.92, 0.82, 1])],
    via('looks', (p) => ({ hazeExposure: p.exposure, hazeSpill: p.spill, hazeSoftness: p.soft, hazeReach: p.reach, hazeTint: p.tint }))),
  tool('lkChroma', 'Chromatic Aberration', 'Lens', 'Franjas de cor que crescem em direção às bordas.', [num('amount', 'Amount (px)', 3, 0, 20, 0.1)], via('looks', (p) => ({ chroma: p.amount }))),
  tool('lkAnamorphic', 'Anamorphic Flare', 'Lens', 'Riscos horizontais longos saindo dos realces, como lente anamórfica.', [num('size', 'Size', 300, 0, 1000), num('boost', 'Boost', 1, 0, 5, 0.01), num('threshold', 'Threshold %', 70, 0, 100), col('color', 'Cor', [0.35, 0.6, 1, 1])],
    via('looks', (p) => ({ anamSize: p.size, anamBoost: p.boost, anamThreshold: p.threshold, anamColor: p.color }))),
  tool('lkGlow', 'Glow', 'Lens', 'Brilho largo e suave das áreas claras (glow, difusão, halação).', [num('radius', 'Radius (px)', 120, 1, 1500), num('exposure', 'Intensidade', 0.6, 0, 6, 0.01), num('threshold', 'Threshold %', 50, 0, 100), col('tint', 'Cor', [1, 1, 1, 1])],
    via('deepGlow', (p) => ({ radius: p.radius, exposure: p.exposure, threshold: p.threshold, tint: p.tint, useTint: Math.min(...rgb(p.tint)) < 0.97, knee: 50 }))),
  tool('lkBulge', 'Bulge', 'Lens', 'Distorção barril: estufa a partir de um centro.', [pos('center', 'Centro'), num('radius', 'Raio', 500, 1, 3000), num('amount', 'Força', 0.5, 0, 1, 0.01)], via('bulge', (p) => ({ center: p.center, radius: p.radius, strength: p.amount }))),
  tool('lkPinch', 'Pinch', 'Lens', 'Distorção almofada: puxa para um centro.', [pos('center', 'Centro'), num('radius', 'Raio', 500, 1, 3000), num('amount', 'Força', 0.5, 0, 1, 0.01)], via('bulge', (p) => ({ center: p.center, radius: p.radius, strength: -p.amount }))),
  tool('lkUnsharp', 'Unsharp Mask', 'Lens', 'Nitidez de detalhes finos com máscara de desfoque.', [num('amount', 'Amount %', 80, 0, 500), num('radius', 'Radius', 2, 0.3, 100, 0.1), num('threshold', 'Threshold', 0, 0, 255)],
    via('sharpen', (p) => ({ amount: p.amount, radius: p.radius, threshold: p.threshold }))),
  // ------------------------------------------------------------ CAMERA
  tool('lkFilmStock', 'Film Stock', 'Camera', 'O visual do negativo: split tone (sombras teal, realces quentes) e fade.', [col('sh', 'Sombras', [0.42, 0.52, 0.55, 1]), col('hi', 'Realces', [0.56, 0.5, 0.44, 1]), num('split', 'Split tone %', 60, 0, 100), num('fade', 'Fade %', 20, 0, 100)],
    lt(10, (p) => ({ a: p.split / 100, b: p.fade / 100, c1: rgb(p.sh), c2: rgb(p.hi) }))),
  tool('lkLooksBleach', 'Looks Bleach Bypass', 'Camera', 'Pula o branqueamento do negativo/cópia, como o Magic Bullet Looks mede.', [num('amount', 'Amount %', 50, -100, 100)], via('looks', (p) => ({ bleach: p.amount }))),
  tool('lkMojo', 'Mojo Grade', 'Camera', 'Pele quente contra fundo frio, com punch, bleach e fade (Mojo II).',
    [num('mojo', 'Mojo %', 50, 0, 100), num('cool', 'Cool it %', 50, 0, 100), num('skin', 'Warm skin %', 50, 0, 100), num('punch', 'Punch %', 0, 0, 100), num('bleach', 'Bleach %', 0, -100, 100), num('fade', 'Fade %', 0, 0, 100), num('mtint', 'Mojo Tint', 0, -100, 100),
      num('exposure', 'Exposure (stops)', 0, -3, 3, 0.01), num('temp', 'Cool / Warm', 0, -100, 100), num('tint', 'Green / Magenta', 0, -100, 100)],
    via('looks', (p) => ({ mojo: p.mojo, mojoCool: p.cool, mojoSkin: p.skin, punch: p.punch, bleach: p.bleach, fade: p.fade * 0.5, mojoTint: p.mtint, exposure: p.exposure || 0, temperature: p.temp || 0, tint: p.tint || 0 }))),
  tool('lkBleachBypass', 'Bleach Bypass', 'Camera', 'Prata retida: contraste alto e cor apagada.', [num('amount', 'Amount %', 60, 0, 100), num('desat', 'Dessaturação %', 40, 0, 100)], lt(11, (p) => ({ a: p.amount / 100, b: p.desat / 100 }))),
  tool('lkCrossProcess', 'Cross Process', 'Camera', 'Curvas de revelação cruzada (verdes/amarelos fortes, azuis levantados).', [num('amount', 'Amount %', 60, 0, 100)], lt(12, (p) => ({ a: p.amount / 100 }))),
  tool('lkFadedFilm', 'Faded Film', 'Camera', 'Pretos levantados, brancos comprimidos e cor desbotada.', [num('lift', 'Fade dos pretos %', 40, 0, 100), num('crush', 'Compressão dos brancos %', 30, 0, 100), num('fadeColor', 'Desbotar cor %', 30, 0, 100)],
    lt(13, (p) => ({ a: p.lift / 100, b: p.crush / 100, c: p.fadeColor / 100 }))),
  tool('lkBW', 'Black & White', 'Camera', 'Monocromático com pesos dos canais.', [num('amount', 'Amount %', 100, 0, 100)], via('blackWhite', (p) => ({ amount: p.amount }))),
  tool('lkColorize', 'Colorize', 'Camera', 'Pinta a imagem com uma cor, mantendo a luz.', [col('color', 'Cor', [1, 0.7, 0.4, 1]), num('amount', 'Amount %', 60, 0, 100)], lt(14, (p) => ({ a: p.amount / 100, c1: rgb(p.color) }))),
  tool('lkFilmPrint', 'Film Print', 'Camera', 'Curva de cópia de cinema: contraste, realces quentes, sombras densas.', [num('amount', 'Amount %', 60, 0, 100)], lt(15, (p) => ({ a: p.amount / 100 }))),
  tool('lkTealOrange', 'Teal & Orange', 'Camera', 'Sombras e fundo verde-água, pele e realces laranja.', [num('amount', 'Amount %', 50, 0, 100)], lt(16, (p) => ({ a: p.amount / 100 }))),
  tool('lkLooksLight', 'Looks Light', 'Camera', 'Ganho de luz por canal em stops (Lightflex, Color Blend, Warm/Cool).', [num('r', 'Red (stops)', 0, -3, 3, 0.01), num('g', 'Green (stops)', 0, -3, 3, 0.01), num('b', 'Blue (stops)', 0, -3, 3, 0.01), bool('encoded', 'Nos valores codificados (não linear)', false)],
    lt(17, (p) => ({ c1: [p.r, p.g, p.b], b: p.encoded ? 1 : 0 }))),
  tool('lkLookTable', 'Look Table', 'Camera', 'LUT de cor (importe um .cube em Presets → Importar).', [num('amount', 'Amount %', 100, 0, 100)], via('lut3d', (p) => ({ amount: p.amount }))),
  // ------------------------------------------------------------ POST
  tool('lkSCurve', 'S Curve', 'Post', 'Curva em S com ponto médio, brilho e pontos de preto e branco.', [num('con', 'Contrast', 0.5, 0, 2, 0.01), num('bright', 'Brightness', 0.5, 0, 1, 0.01), num('black', 'Black point', 0, 0, 0.5, 0.01), num('white', 'White point', 1, 0.5, 1, 0.01)],
    lt(18, (p) => ({ a: p.con, b: p.bright, c: p.black, d: p.white }))),
  tool('lkVignette', 'Vignette', 'Post', 'Vinheta com forma e cor.', [num('amount', 'Amount %', 50, 0, 100), num('size', 'Size %', 60, 0, 100), num('feather', 'Feather %', 50, 0, 100), col('color', 'Cor', [0, 0, 0, 1])],
    via('vignette', (p) => ({ amount: p.amount, size: p.size, feather: p.feather, color: p.color }))),
  tool('lkGrain', 'Grain', 'Post', 'Grão de filme (tamanho e intensidade).', [num('amount', 'Amount', 20, 0, 100), num('size', 'Size', 1.5, 0.5, 6, 0.1)], via('noise', (p) => ({ amount: p.amount, size: p.size, animated: true }))),
  tool('lkScanlines', 'Scanlines', 'Post', 'Linhas escuras periódicas.', [num('spacing', 'Espaçamento (px)', 3, 1, 40, 0.5), num('dark', 'Escurecer %', 35, 0, 100)], lt(19, (p) => ({ a: p.spacing, b: p.dark / 100 }))),
  tool('lkPosterize', 'Posterize', 'Post', 'Arredonda cada canal para poucos níveis.', [num('levels', 'Levels', 6, 2, 64, 1)], via('posterize', (p) => ({ levels: p.levels }))),
  tool('lkSolarize', 'Solarize', 'Post', 'Inverte os canais acima de um limiar.', [num('threshold', 'Threshold %', 50, 0, 100)], lt(20, (p) => ({ a: p.threshold / 100 }))),
];

void rad; void sel;
