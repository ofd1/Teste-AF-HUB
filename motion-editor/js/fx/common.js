// Utilitários compartilhados pelos módulos de efeitos.
import { PRELUDE } from '../gl.js';

export const rad = (d) => (d * Math.PI) / 180;

// Construtores de parâmetros
export const num = (key, label, def, min, max, step = 1, extra = {}) => ({ key, label, kind: 'number', default: def, min, max, step, ...extra });
export const ang = (key, label, def = 0) => ({ key, label, kind: 'angle', default: def });
export const col = (key, label, def = [1, 1, 1, 1]) => ({ key, label, kind: 'color', default: def });
export const bool = (key, label, def = false) => ({ key, label, kind: 'bool', default: def });
export const sel = (key, label, options, def = 1) => ({ key, label, kind: 'select', options, default: def });
/** Ponto relativo ao conteúdo da camada (0..1). */
export const pos = (key, label, def = [0.5, 0.5]) => ({ key, label, kind: 'pos', default: def });

export const GLSL_EXTRA = `
vec4 fixpre(vec4 c) { c = clamp(c, 0.0, 1.0); c.a = max(c.a, max(c.r, max(c.g, c.b))); return c; }
`;

/** Monta o fragment shader completo. */
export const frag = (body) => `${PRELUDE}${GLSL_EXTRA}${body}`;

/** Efeito de cor por pixel: o corpo manipula vec3 r (cor não pré-multiplicada) e float a. */
export const colorFrag = (uniforms, body) => frag(`${uniforms}
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv));
  vec3 r = c.rgb;
  float a = c.a;
  ${body}
  gl_FragColor = pre(vec4(clamp(r, 0.0, 1.0), clamp(a, 0.0, 1.0)));
}`);

/** Converte ponto do conteúdo (0..1) para uv da textura com padding. */
export function cuv(env, p) {
  const [x, y, w, h] = env.rect;
  return [x + p[0] * w, y + p[1] * h];
}

export const rgb = (c) => [c[0], c[1], c[2]];

/** Ruído 1D suave determinístico em JS (para efeitos de transformação). */
export function hash1(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash1(i + seed * 101.3) * (1 - u) + hash1(i + 1 + seed * 101.3) * u) * 2 - 1;
}
