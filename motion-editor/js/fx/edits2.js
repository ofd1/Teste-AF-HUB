// Efeitos vistos nas edits que não existiam no app: low poly (triângulos chapados, Edit 8) e glow de texto/outro.
import { num, frag, bool, col, sel, rgb } from './common.js';

const LOWPOLY = frag(`
uniform float u_cell, u_amt, u_gray, u_facet;
vec2 J(vec2 c) { return c + (vec2(hash(c), hash(c + 17.3)) - 0.5) * 0.7; }
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float cs = max(4.0, u_cell * u_scale * min(1.0, u_size.x / 1080.0) / max(u_scale, 1e-3) * u_scale);
  vec2 g = v_uv * u_size / cs, i = floor(g), f = fract(g);
  vec2 a = J(i), b = f.x > f.y ? J(i + vec2(1.0, 0.0)) : J(i + vec2(0.0, 1.0)), d = J(i + vec2(1.0));
  vec2 cen = (a + b + d) / 3.0;
  vec4 c = texture2D(u_tex, clamp(cen * cs / u_size, u_rect.xy + 0.002, u_rect.xy + u_rect.zw - 0.002));
  float id = hash(cen * 3.1 + (f.x > f.y ? 0.5 : 0.0));
  vec3 rgb = c.rgb * (1.0 + (id - 0.5) * u_facet);
  rgb = mix(rgb, vec3(dot(rgb, vec3(0.299, 0.587, 0.114))), u_gray);
  gl_FragColor = mix(s, vec4(clamp(rgb, 0.0, c.a), c.a), u_amt);
}`);

const LIGHTBARS = frag(`
uniform float u_shape, u_count, u_int, u_soft, u_scroll, u_amt; uniform vec3 u_col;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 c = contentUV(v_uv);
  float m;
  if (u_shape < 1.5) {
    // barras verticais de luz (refletores), com pontas mais claras no alto e embaixo
    float x = fract(c.x * u_count + u_scroll * u_time);
    float bar = smoothstep(0.5 - 0.5 * u_soft, 0.5, 1.0 - abs(x - 0.5) * 2.0 * (1.0 - u_soft * 0.5));
    m = bar * (0.55 + 0.45 * pow(abs(c.y - 0.5) * 2.0, 0.7));
  } else {
    // degradê de luz vindo de baixo
    m = smoothstep(1.0 - 0.6 * u_soft - 0.2, 1.0, c.y + 0.25);
  }
  vec3 add = u_col * m * u_int * u_amt;
  gl_FragColor = vec4(clamp(s.rgb + add * s.a, 0.0, 1.0), s.a);
}`);

export default [
  {
    type: 'lightBars', label: 'Barras de luz / Degradê de luz', category: 'Luz e brilho',
    description: 'Flash de luz das edits: barras verticais de refletor (amarelas) ou degradê de luz subindo de baixo (ciano).',
    params: [sel('shape', 'Forma', ['Barras verticais', 'Degradê de baixo'], 1), col('color', 'Cor', [1, 0.9, 0.25, 1]), num('intensity', 'Intensidade', 1.5, 0, 6, 0.05),
      num('count', 'Nº de barras', 7, 1, 40, 1), num('softness', 'Suavidade %', 60, 0, 100), num('scroll', 'Movimento (barras/s)', 0, -10, 10, 0.1), num('amount', 'Mistura %', 100, 0, 100)],
    render: (src, p, env) => env.gl.pass(LIGHTBARS, { u_tex: src, u_shape: p.shape | 0 || 1, u_col: rgb(p.color || [1, 0.9, 0.25, 1]), u_int: p.intensity ?? 1.5, u_count: p.count ?? 7, u_soft: (p.softness ?? 60) / 100, u_scroll: p.scroll || 0, u_amt: (p.amount ?? 100) / 100 }),
  },
  {
    type: 'lowPoly', label: 'Low Poly (triângulos)', category: 'Estilizar',
    description: 'Divide a imagem em triângulos chapados (visual de cristal / polígonos) — usado como flash de transição nas edits.',
    params: [num('cell', 'Tamanho dos triângulos (px)', 90, 6, 600), num('amount', 'Mistura %', 100, 0, 100), num('facet', 'Facetas (contraste) %', 60, 0, 200), bool('gray', 'Preto e branco', true)],
    render: (src, p, env) => env.gl.pass(LOWPOLY, { u_tex: src, u_cell: p.cell ?? 90, u_amt: (p.amount ?? 100) / 100, u_facet: (p.facet ?? 60) / 100, u_gray: p.gray ? 1 : 0 }),
  },
];
