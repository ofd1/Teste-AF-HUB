// Efeitos vistos nas edits que não existiam no app: low poly (triângulos chapados, Edit 8) e glow de texto/outro.
import { num, frag, bool } from './common.js';

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

export default [
  {
    type: 'lowPoly', label: 'Low Poly (triângulos)', category: 'Estilizar',
    description: 'Divide a imagem em triângulos chapados (visual de cristal / polígonos) — usado como flash de transição nas edits.',
    params: [num('cell', 'Tamanho dos triângulos (px)', 90, 6, 600), num('amount', 'Mistura %', 100, 0, 100), num('facet', 'Facetas (contraste) %', 60, 0, 200), bool('gray', 'Preto e branco', true)],
    render: (src, p, env) => env.gl.pass(LOWPOLY, { u_tex: src, u_cell: p.cell ?? 90, u_amt: (p.amount ?? 100) / 100, u_facet: (p.facet ?? 60) / 100, u_gray: p.gray ? 1 : 0 }),
  },
];
