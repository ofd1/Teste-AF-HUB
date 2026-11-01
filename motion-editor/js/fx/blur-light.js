// Desfoques e luz: Gaussian/Directional/Radial blur, motion blur (estilo RSMB), Glow, Deep Glow,
// Light Rays (estilo CC Light Rays / Shine / S_Rays), Lens Flare, Light Leaks, Strobe.
import { frag, num, ang, col, bool, sel, pos, rad, cuv, rgb } from './common.js';

const DIR_BLUR = frag(`
uniform vec2 u_vec;
void main() {
  vec4 a = vec4(0.0);
  for (int i = 0; i < 32; i++) { float f = float(i) / 31.0 - 0.5; a += samp(v_uv + u_vec * f); }
  gl_FragColor = a / 32.0;
}`);

const RADIAL_BLUR = frag(`
uniform vec2 u_center; uniform float u_amount; uniform float u_mode;
void main() {
  vec4 a = vec4(0.0);
  vec2 d = (v_uv - u_center) * u_size;
  for (int i = 0; i < 48; i++) {
    float f = float(i) / 47.0;
    vec2 dd;
    if (u_mode < 1.5) dd = d * (1.0 - u_amount * f);
    else { float an = u_amount * (f - 0.5); dd = mat2(cos(an), sin(an), -sin(an), cos(an)) * d; }
    a += samp(u_center + dd / u_size);
  }
  gl_FragColor = a / 48.0;
}`);

const THRESH = frag(`
uniform float u_thr; uniform vec3 u_color; uniform float u_useColor;
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv));
  float l = luma(c.rgb);
  float k = smoothstep(u_thr - 0.05, u_thr + 0.1, l);
  vec3 cc = mix(c.rgb, u_color * max(l, 0.35) * 1.4, u_useColor);
  gl_FragColor = pre(vec4(cc, c.a * k));
}`);

const GLOW_COMP = frag(`
uniform sampler2D u_tex2; uniform float u_amount;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec4 g = texture2D(u_tex2, v_uv) * u_amount;
  gl_FragColor = fixpre(s + g);
}`);

const RAYS = frag(`
uniform vec2 u_center; uniform float u_len; uniform float u_int; uniform vec3 u_color; uniform float u_thr;
void main() {
  vec2 d = v_uv - u_center;
  vec3 a = vec3(0.0); float ak = 0.0;
  float w = 1.0, ws = 0.0;
  for (int i = 0; i < 56; i++) {
    float f = float(i) / 55.0;
    vec4 c = unpre(samp(u_center + d * (1.0 - u_len * f)));
    float k = smoothstep(u_thr, u_thr + 0.2, luma(c.rgb)) * c.a;
    a += c.rgb * k * w; ak += k * w; ws += w; w *= 0.965;
  }
  a = a / ws * u_color * u_int; ak = ak / ws * u_int;
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = fixpre(s + vec4(a, ak * 0.6));
}`);

const FLARE = frag(`
uniform vec2 u_pos; uniform float u_bright; uniform vec3 u_color; uniform float u_fsize; uniform float u_streak;
void main() {
  vec2 px = v_uv * u_size, lp = u_pos * u_size;
  vec2 c = (u_rect.xy + u_rect.zw * 0.5) * u_size;
  float d = length(px - lp) / u_fsize;
  vec3 col = u_color * (exp(-d * d * 6.0) * 1.6 + 0.04 / (d + 0.04));
  float sy = abs(px.y - lp.y) / u_fsize, sx = abs(px.x - lp.x) / u_fsize;
  col += mix(u_color, vec3(0.5, 0.7, 1.0), 0.5) * exp(-sy * 80.0) * exp(-sx * 0.9) * u_streak;
  vec2 axis = c - lp;
  for (int i = 1; i < 7; i++) {
    float f = float(i) * 0.38 - 0.2;
    vec2 gp = lp + axis * 2.0 * f;
    float gr = u_fsize * (0.06 + 0.05 * hash1(float(i) * 3.1));
    float gd = length(px - gp) / gr;
    col += hsv2rgb(vec3(fract(0.13 * float(i) + 0.5), 0.55, 1.0)) * (smoothstep(1.0, 0.6, gd) * 0.15 + exp(-gd * gd * 3.0) * 0.05);
  }
  float rd = abs(length(px - lp) - u_fsize * 1.4) / u_fsize;
  col += vec3(0.6, 0.8, 1.0) * exp(-rd * rd * 600.0) * 0.12;
  col *= u_bright;
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = fixpre(s + vec4(col, 0.0));
}`);

const LEAK = frag(`
uniform float u_int; uniform float u_speed; uniform float u_hue; uniform float u_seed; uniform float u_mode;
void main() {
  vec2 c = contentUV(v_uv);
  float t = u_time * u_speed + u_seed * 7.0;
  float n = fbm(c * 1.4 + vec2(t * 0.35, -t * 0.22), 4);
  float n2 = fbm(c * 2.2 - vec2(t * 0.2, t * 0.12) + 5.0, 4);
  vec3 lc = hsv2rgb(vec3(fract(u_hue + n2 * 0.18), 0.75, 1.0)) * smoothstep(0.38, 0.85, n) * u_int;
  vec4 s = texture2D(u_tex, v_uv);
  if (u_mode > 1.5) { gl_FragColor = fixpre(s + vec4(lc, 0.0)); return; }
  gl_FragColor = vec4(s.rgb + lc * (s.a - s.rgb), s.a);
}`);

const STROBE = frag(`
uniform vec3 u_color; uniform float u_mode; uniform float u_blend;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  if (u_mode < 1.5) gl_FragColor = vec4(mix(s.rgb, u_color * s.a, u_blend), s.a);
  else if (u_mode < 2.5) gl_FragColor = s * (1.0 - u_blend);
  else gl_FragColor = fixpre(s + vec4(u_color * u_blend, u_blend));
}`);

function glowLayers(gl, th, radius, levels) {
  let acc = null;
  for (const f of levels) {
    const b = gl.blur(th, Math.max(0.5, radius * f));
    acc = acc ? gl.add(acc, b, 1) : b;
  }
  return acc;
}

export default [
  {
    type: 'blur', label: 'Desfoque gaussiano', category: 'Desfoque',
    params: [num('radius', 'Intensidade', 10, 0, 300, 0.5), sel('dims', 'Dimensões', ['Horizontal e vertical', 'Horizontal', 'Vertical'])],
    pad: (p) => p.radius * 1.5,
    render: (src, p, env) => env.gl.blur(src, p.radius * 0.5 * env.scale, p.dims),
  },
  {
    type: 'dirBlur', label: 'Desfoque direcional', category: 'Desfoque',
    params: [ang('angle', 'Direção', 0), num('length', 'Comprimento', 20, 0, 500)],
    pad: (p) => p.length * 0.6,
    render: (src, p, env) => (p.length <= 0 ? src : env.gl.pass(DIR_BLUR, {
      u_tex: src, u_vec: [Math.sin(rad(p.angle)) * p.length * env.scale / env.W, -Math.cos(rad(p.angle)) * p.length * env.scale / env.H],
    })),
  },
  {
    type: 'radialBlur', label: 'Desfoque radial / zoom', category: 'Desfoque', plugin: 'CC Radial Blur',
    params: [sel('mode', 'Tipo', ['Zoom', 'Giro']), num('amount', 'Quantidade', 30, 0, 100, 0.5), pos('center', 'Centro')],
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(RADIAL_BLUR, {
      u_tex: src, u_center: cuv(env, p.center), u_mode: p.mode, u_amount: p.mode === 1 ? p.amount / 220 : rad(p.amount * 0.6),
    })),
  },
  {
    type: 'motionBlur', label: 'Motion blur (estilo RSMB)', category: 'Desfoque', plugin: 'ReelSmart Motion Blur',
    description: 'Desfoque de movimento real calculado a partir da animação da camada (posição, escala, rotação, shakes).',
    params: [num('amount', 'Quantidade %', 100, 0, 400, 1), num('samples', 'Amostras', 12, 2, 32, 1)],
    temporal: 'motionBlur',
  },
  {
    type: 'glow', label: 'Glow (AE)', category: 'Luz e brilho',
    params: [num('threshold', 'Limiar %', 50, 0, 100), num('radius', 'Raio', 25, 0, 300), num('intensity', 'Intensidade', 1.2, 0, 8, 0.05), col('color', 'Cor'), bool('useColor', 'Usar cor')],
    pad: (p) => p.radius * 1.5,
    render: (src, p, env) => {
      const { gl } = env;
      const th = gl.pass(THRESH, { u_tex: src, u_thr: p.threshold / 100, u_color: rgb(p.color), u_useColor: p.useColor });
      const g = gl.blur(th, p.radius * 0.5 * env.scale);
      return gl.pass(GLOW_COMP, { u_tex: src, u_tex2: g, u_amount: p.intensity });
    },
  },
  {
    type: 'deepGlow', label: 'Deep Glow', category: 'Luz e brilho', plugin: 'Deep Glow',
    description: 'Glow físico em várias escalas com decaimento exponencial (sem o “anel” do glow comum).',
    params: [num('radius', 'Raio', 120, 0, 1500), num('exposure', 'Exposição', 1, 0, 10, 0.05), num('threshold', 'Limiar %', 0, 0, 100), col('tint', 'Cor do tint', [1, 0.6, 0.2, 1]), bool('useTint', 'Usar tint', false), num('aspect', 'Aspecto (H/V)', 1, 0.1, 10, 0.05)],
    pad: (p) => p.radius * 1.2,
    render: (src, p, env) => {
      const { gl } = env;
      const th = gl.pass(THRESH, { u_tex: src, u_thr: p.threshold / 100, u_color: rgb(p.tint), u_useColor: p.useTint ? 0.85 : 0 });
      const r = p.radius * 0.5 * env.scale;
      let acc;
      if (Math.abs(p.aspect - 1) < 0.01) acc = glowLayers(gl, th, r, [0.02, 0.06, 0.15, 0.35, 0.7, 1]);
      else {
        const h = Math.min(1, p.aspect), v = Math.min(1, 1 / p.aspect);
        acc = null;
        for (const f of [0.03, 0.1, 0.3, 0.7, 1]) {
          const b = gl.blur(gl.blur(th, r * f * h, 2), r * f * v, 3);
          acc = acc ? gl.add(acc, b, 1) : b;
        }
      }
      return gl.pass(GLOW_COMP, { u_tex: src, u_tex2: acc, u_amount: p.exposure * 0.45 });
    },
  },
  {
    type: 'lightRays', label: 'Raios de luz', category: 'Luz e brilho', plugin: 'CC Light Rays / Shine / S_Rays',
    params: [pos('center', 'Origem'), num('intensity', 'Intensidade', 2, 0, 10, 0.05), num('length', 'Comprimento %', 40, 0, 100), num('threshold', 'Limiar %', 30, 0, 100), col('color', 'Cor', [1, 0.95, 0.85, 1])],
    render: (src, p, env) => env.gl.pass(RAYS, { u_tex: src, u_center: cuv(env, p.center), u_len: p.length / 100, u_int: p.intensity, u_thr: p.threshold / 100, u_color: rgb(p.color) }),
  },
  {
    type: 'lensFlare', label: 'Lens Flare', category: 'Luz e brilho', plugin: 'Optical Flares / S_LensFlare / BCC Lens Flare',
    params: [pos('position', 'Posição', [0.25, 0.25]), num('brightness', 'Brilho %', 100, 0, 300), num('size', 'Tamanho', 220, 10, 2000), num('streak', 'Streak anamórfico', 0.8, 0, 3, 0.05), col('color', 'Cor', [1, 0.85, 0.65, 1])],
    render: (src, p, env) => env.gl.pass(FLARE, { u_tex: src, u_pos: cuv(env, p.position), u_bright: p.brightness / 100, u_fsize: p.size * env.scale, u_streak: p.streak, u_color: rgb(p.color) }),
  },
  {
    type: 'lightLeak', label: 'Light Leaks', category: 'Luz e brilho', plugin: 'BCC Light Leaks',
    params: [num('intensity', 'Intensidade', 0.8, 0, 3, 0.05), num('speed', 'Velocidade', 0.5, 0, 5, 0.05), num('hue', 'Matiz', 0.05, 0, 1, 0.01), num('seed', 'Semente', 1, 0, 100), sel('mode', 'Modo', ['Só na camada', 'Sobre tudo'])],
    render: (src, p, env) => env.gl.pass(LEAK, { u_tex: src, u_int: p.intensity, u_speed: p.speed, u_hue: p.hue, u_seed: p.seed, u_mode: p.mode }),
  },
  {
    type: 'strobe', label: 'Strobe / Flash', category: 'Luz e brilho',
    params: [col('color', 'Cor'), num('frequency', 'Frequência (Hz)', 6, 0.1, 30, 0.1), num('duration', 'Duração %', 40, 1, 100), num('blend', 'Mistura %', 100, 0, 100), sel('mode', 'Modo', ['Colorir camada', 'Transparente', 'Flash aditivo'])],
    render: (src, p, env) => {
      const on = ((env.t * p.frequency) % 1) < p.duration / 100;
      return on ? env.gl.pass(STROBE, { u_tex: src, u_color: rgb(p.color), u_mode: p.mode, u_blend: p.blend / 100 }) : src;
    },
  },
];
