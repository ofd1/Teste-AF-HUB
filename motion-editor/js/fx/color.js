// Correção de cor: Exposure, Brilho/Contraste, Matiz/Saturação, Levels, Color Grade (Lumetri / Looks),
// Vibrance, Tint, Preto e branco, Inverter, Fill, Gradiente, Posterize, Threshold.
import { colorFrag, num, ang, col, bool, rgb } from './common.js';

// Como no AE: exposição e offset em luz linear (gama 2.2), depois correção de gama.
const EXPOSURE = colorFrag('uniform float u_exp, u_off, u_gamma;', `
  vec3 lin = pow(max(r, 0.0), vec3(2.2)) * pow(2.0, u_exp) + u_off;
  r = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  r = pow(max(r, 0.0), vec3(1.0 / max(u_gamma, 0.01)));`);

// Brilho e contraste "moderno" do AE: preserva preto e branco (curva), não soma um valor fixo.
const BC = colorFrag('uniform float u_b, u_c;', `
  r = clamp(r, 0.0, 1.0);
  r = u_b >= 0.0 ? pow(r, vec3(1.0 / (1.0 + u_b))) : pow(r, vec3(1.0 - u_b));
  vec3 s = r * r * (3.0 - 2.0 * r);
  r = u_c >= 0.0 ? mix(r, s, u_c) : mix(r, vec3(0.5), -u_c * 0.5);`);

const HUESAT = colorFrag('uniform float u_h, u_s, u_l, u_colorize; uniform vec3 u_ccol;', `
  vec3 h = rgb2hsv(r);
  h.x = fract(h.x + u_h);
  h.y = clamp(h.y * u_s, 0.0, 1.0);
  r = hsv2rgb(h);
  if (u_colorize > 0.5) r = hsv2rgb(vec3(rgb2hsv(u_ccol).x, rgb2hsv(u_ccol).y * u_s, luma(c.rgb)));
  r = u_l >= 0.0 ? mix(r, vec3(1.0), u_l) : r * (1.0 + u_l);`);

const LEVELS = colorFrag('uniform float u_ib, u_iw, u_g, u_ob, u_ow;', `
  r = clamp((r - u_ib) / max(u_iw - u_ib, 0.001), 0.0, 1.0);
  r = pow(r, vec3(1.0 / max(u_g, 0.01)));
  r = u_ob + r * (u_ow - u_ob);`);

const GRADE = colorFrag('uniform float u_temp, u_tint, u_exp, u_con, u_hi, u_sh, u_wh, u_bl, u_sat, u_vib, u_fade;', `
  r *= pow(2.0, u_exp);
  r += vec3(u_temp, 0.0, -u_temp) * 0.12 + vec3(u_tint * 0.06, -u_tint * 0.1, u_tint * 0.06);
  float l = luma(r);
  float sh = 1.0 - smoothstep(0.0, 0.55, l), hi = smoothstep(0.45, 1.0, l);
  r += sh * u_sh * 0.25 + hi * u_hi * 0.25;
  r = (r - u_bl * 0.1) / max(1.0 - u_wh * 0.15 - u_bl * 0.1, 0.1);
  r = (r - 0.45) * (1.0 + u_con) + 0.45;
  float s = rgb2hsv(clamp(r, 0.0, 1.0)).y;
  r = mix(vec3(luma(r)), r, 1.0 + u_sat + u_vib * (1.0 - s));
  r = mix(r, vec3(0.12) + r * 0.82, u_fade);`);

const VIBRANCE = colorFrag('uniform float u_vib, u_sat;', `
  float s = rgb2hsv(r).y;
  r = mix(vec3(luma(r)), r, 1.0 + u_sat + u_vib * (1.0 - s) * 1.5);`);

const TINT = colorFrag('uniform vec3 u_black, u_white; uniform float u_amount;', `
  r = mix(r, mix(u_black, u_white, luma(r)), u_amount);`);

const BW = colorFrag('uniform float u_amount;', 'r = mix(r, vec3(luma(r)), u_amount);');
const INVERT = colorFrag('uniform float u_blend;', 'r = mix(1.0 - r, r, u_blend);');
const FILL = colorFrag('uniform vec3 u_color; uniform float u_amount;', 'r = mix(r, u_color, u_amount);');

const RAMP = colorFrag('uniform vec3 u_start, u_end; uniform vec2 u_dir; uniform float u_blend; uniform float u_radial;', `
  vec2 cc = contentUV(v_uv) - 0.5;
  float f = u_radial > 0.5 ? clamp(length(cc) * 2.0, 0.0, 1.0) : clamp(dot(cc, u_dir) / (abs(u_dir.x) * 0.5 + abs(u_dir.y) * 0.5 + 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  r = mix(mix(u_start, u_end, f), r, u_blend);`);

const POSTERIZE = colorFrag('uniform float u_levels;', 'r = floor(r * u_levels) / max(u_levels - 1.0, 1.0);');
const THRESHOLD = colorFrag('uniform float u_level;', 'r = vec3(step(u_level, luma(r)));');

const fx = (frag, uniforms) => (src, p, env) => env.gl.pass(frag, { u_tex: src, ...uniforms(p, env) });

export default [
  {
    type: 'exposure', label: 'Exposição', category: 'Cor',
    params: [num('exposure', 'Exposição', 0, -5, 5, 0.05), num('offset', 'Offset', 0, -0.5, 0.5, 0.005), num('gamma', 'Gama', 1, 0.1, 5, 0.01)],
    render: fx(EXPOSURE, (p) => ({ u_exp: p.exposure, u_off: p.offset, u_gamma: p.gamma })),
  },
  {
    type: 'brightnessContrast', label: 'Brilho e contraste', category: 'Cor',
    params: [num('brightness', 'Brilho', 0, -150, 150), num('contrast', 'Contraste', 0, -100, 100)],
    render: fx(BC, (p) => ({ u_b: p.brightness / 150, u_c: p.contrast / 100 })),
  },
  {
    type: 'hueSat', label: 'Matiz / Saturação', category: 'Cor',
    params: [ang('hue', 'Matiz', 0), num('saturation', 'Saturação', 0, -100, 100), num('lightness', 'Luminosidade', 0, -100, 100), bool('colorize', 'Colorir'), col('colorizeColor', 'Cor (colorir)', [1, 0.3, 0.2, 1])],
    render: fx(HUESAT, (p) => ({ u_h: p.hue / 360, u_s: 1 + p.saturation / 100, u_l: p.lightness / 100, u_colorize: p.colorize, u_ccol: rgb(p.colorizeColor) })),
  },
  {
    type: 'levels', label: 'Níveis (Levels)', category: 'Cor',
    params: [num('inBlack', 'Entrada preto', 0, 0, 255), num('inWhite', 'Entrada branco', 255, 0, 255), num('gamma', 'Gama', 1, 0.1, 5, 0.01), num('outBlack', 'Saída preto', 0, 0, 255), num('outWhite', 'Saída branco', 255, 0, 255)],
    render: fx(LEVELS, (p) => ({ u_ib: p.inBlack / 255, u_iw: p.inWhite / 255, u_g: p.gamma, u_ob: p.outBlack / 255, u_ow: p.outWhite / 255 })),
  },
  {
    type: 'colorGrade', label: 'Color Grade (CC)', category: 'Cor', plugin: 'Lumetri / Magic Bullet Looks',
    params: [
      num('temperature', 'Temperatura', 0, -100, 100), num('tint', 'Tint', 0, -100, 100), num('exposure', 'Exposição', 0, -4, 4, 0.05),
      num('contrast', 'Contraste', 0, -100, 100), num('highlights', 'Realces', 0, -100, 100), num('shadows', 'Sombras', 0, -100, 100),
      num('whites', 'Brancos', 0, -100, 100), num('blacks', 'Pretos', 0, -100, 100), num('saturation', 'Saturação', 0, -100, 100),
      num('vibrance', 'Vibração', 0, -100, 100), num('fade', 'Fade (lavado)', 0, 0, 100),
    ],
    render: fx(GRADE, (p) => ({
      u_temp: p.temperature / 100, u_tint: p.tint / 100, u_exp: p.exposure, u_con: p.contrast / 100, u_hi: p.highlights / 100, u_sh: p.shadows / 100,
      u_wh: p.whites / 100, u_bl: p.blacks / 100, u_sat: p.saturation / 100, u_vib: p.vibrance / 100, u_fade: p.fade / 100,
    })),
  },
  {
    type: 'vibrance', label: 'Vibração', category: 'Cor',
    params: [num('vibrance', 'Vibração', 30, -100, 100), num('saturation', 'Saturação', 0, -100, 100)],
    render: fx(VIBRANCE, (p) => ({ u_vib: p.vibrance / 100, u_sat: p.saturation / 100 })),
  },
  {
    type: 'tint', label: 'Tingir (Tint)', category: 'Cor',
    params: [col('black', 'Mapear preto para', [0, 0, 0, 1]), col('white', 'Mapear branco para', [1, 1, 1, 1]), num('amount', 'Quantidade %', 100, 0, 100)],
    render: fx(TINT, (p) => ({ u_black: rgb(p.black), u_white: rgb(p.white), u_amount: p.amount / 100 })),
  },
  {
    type: 'blackWhite', label: 'Preto e branco', category: 'Cor',
    params: [num('amount', 'Quantidade %', 100, 0, 100)],
    render: fx(BW, (p) => ({ u_amount: p.amount / 100 })),
  },
  {
    type: 'invert', label: 'Inverter', category: 'Cor',
    params: [num('blend', 'Mesclar com original %', 0, 0, 100)],
    render: fx(INVERT, (p) => ({ u_blend: p.blend / 100 })),
  },
  {
    type: 'fill', label: 'Preenchimento (Fill)', category: 'Cor',
    params: [col('color', 'Cor', [1, 0.2, 0.4, 1]), num('opacity', 'Opacidade %', 100, 0, 100)],
    render: fx(FILL, (p) => ({ u_color: rgb(p.color), u_amount: p.opacity / 100 })),
  },
  {
    type: 'ramp', label: 'Gradiente (Ramp)', category: 'Cor',
    params: [col('start', 'Cor inicial', [1, 0.3, 0.5, 1]), col('end', 'Cor final', [0.2, 0.4, 1, 1]), ang('angle', 'Ângulo', 180), bool('radial', 'Radial'), num('blend', 'Mesclar com original %', 0, 0, 100)],
    render: fx(RAMP, (p) => ({ u_start: rgb(p.start), u_end: rgb(p.end), u_dir: [Math.sin((p.angle * Math.PI) / 180), -Math.cos((p.angle * Math.PI) / 180)], u_radial: p.radial, u_blend: p.blend / 100 })),
  },
  {
    type: 'posterize', label: 'Posterizar', category: 'Cor',
    params: [num('levels', 'Níveis', 6, 2, 64)],
    render: fx(POSTERIZE, (p) => ({ u_levels: Math.max(2, p.levels) })),
  },
  {
    type: 'threshold', label: 'Limiar (Threshold)', category: 'Cor',
    params: [num('level', 'Nível', 128, 0, 255)],
    render: fx(THRESHOLD, (p) => ({ u_level: p.level / 255 })),
  },
];
