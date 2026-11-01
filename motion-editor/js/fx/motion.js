// Movimento e tempo: Shake (wiggle / S_Shake / Universe Camera Shake), Twitch, Transformar,
// Velocidade (estilo Twixtor / Timewarp), Posterize Time, Echo.
import { frag, num, ang, bool, sel, pos, rad, cuv, hash1, noise1 } from './common.js';

const TWITCH = frag(`
uniform vec2 u_off; uniform float u_light;
void main() {
  vec4 c = texture2D(u_tex, v_uv), r = samp(v_uv + u_off), b = samp(v_uv - u_off);
  vec4 o = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  o.rgb = o.rgb * (1.0 + u_light) + vec3(u_light * 0.25) * o.a;
  gl_FragColor = clamp(o, 0.0, 1.0);
}`);


// S_BlurMoCurves: transforma a imagem (zoom pela distância Z, rotação, deslocamento) e cria o motion blur
// integrando a transformação entre o início e o fim do obturador.
const BMC = frag(`
uniform vec2 u_c; uniform float u_s0, u_s1, u_r0, u_r1; uniform vec2 u_sh0, u_sh1; uniform float u_n; uniform float u_wrap;
vec2 wrapUV(vec2 cu) {
  if (u_wrap > 2.5) { vec2 m = mod(cu, 2.0); return vec2(m.x > 1.0 ? 2.0 - m.x : m.x, m.y > 1.0 ? 2.0 - m.y : m.y); }
  if (u_wrap > 1.5) return fract(cu);
  return cu;
}
vec4 sampleAt(float s, float r, vec2 sh) {
  vec2 px = (v_uv - u_c) * u_size - sh * u_rect.zw * u_size;
  px = mat2(cos(r), -sin(r), sin(r), cos(r)) * px / s;
  vec2 cu = contentUV(u_c + px / u_size);
  if (u_wrap < 1.5 && (cu.x < 0.0 || cu.y < 0.0 || cu.x > 1.0 || cu.y > 1.0)) return vec4(0.0);
  vec2 e = u_texel / u_rect.zw * 0.75; // meio texel para dentro: sem linha nas emendas
  cu = clamp(wrapUV(cu), e, 1.0 - e);
  return texture2D(u_tex, fromContent(cu));
}
void main() {
  vec4 acc = vec4(0.0);
  float n = max(1.0, u_n);
  for (int i = 0; i < 32; i++) {
    if (float(i) >= n) break;
    float f = n > 1.0 ? float(i) / (n - 1.0) : 1.0;
    acc += sampleAt(mix(u_s0, u_s1, f), mix(u_r0, u_r1, f), mix(u_sh0, u_sh1, f));
  }
  gl_FragColor = acc / n;
}`);

/** Envelope aleatório por "evento" (0..1), estilo Twitch. */
export function twitchEnv(t, p, channel) {
  const ev = t * p.speed;
  const i = Math.floor(ev);
  const f = ev - i;
  if (hash1(i * 13.7 + p.seed * 3.1 + channel * 0.71) >= p.amount / 100) return 0;
  return (1 - f) ** 2 * (0.4 + 0.6 * hash1(i * 7.3 + channel * 1.9 + p.seed));
}

export default [
  {
    type: 'shake', label: 'Shake (tremor)', category: 'Movimento', plugin: 'S_Shake / Universe Camera Shake / wiggle()',
    params: [num('frequency', 'Frequência (Hz)', 8, 0, 60, 0.5), num('amount', 'Amplitude (px)', 20, 0, 1000), num('rotation', 'Rotação (°)', 2, 0, 90, 0.5), num('zoom', 'Zoom %', 0, 0, 100, 0.5), sel('axis', 'Eixo', ['Ambos', 'Horizontal', 'Vertical']), num('seed', 'Semente', 1, 0, 999)],
    transform: (p, env) => {
      const f = env.t * p.frequency;
      return {
        dx: p.axis === 3 ? 0 : noise1(f, p.seed) * p.amount,
        dy: p.axis === 2 ? 0 : noise1(f, p.seed + 17) * p.amount,
        rot: noise1(f, p.seed + 33) * p.rotation,
        scale: 1 + Math.abs(noise1(f * 0.9, p.seed + 51)) * (p.zoom / 100),
      };
    },
  },
  {
    type: 'blurMoCurves', label: 'Zoom com motion blur (BlurMoCurves)', category: 'Movimento', plugin: 'S_BlurMoCurves',
    description: 'Câmera virtual: aproxima/afasta (Distância Z), gira e desloca a imagem, com motion blur calculado pela velocidade do movimento — anime a Distância Z para o zoom de edit.',
    params: [
      pos('center', 'Centro'), num('zDist', 'Distância Z (1 = normal, <1 aproxima)', 1, 0.1, 5, 0.005), ang('rotate', 'Rotação', 0),
      num('shiftX', 'Deslocamento X', 0, -2, 2, 0.005), num('shiftY', 'Deslocamento Y', 0, -2, 2, 0.005),
      num('shutter', 'Duração do obturador (quadros)', 1, 0, 4, 0.05), num('samples', 'Amostras', 16, 1, 32, 1),
      sel('wrap', 'Bordas', ['Transparente', 'Repetir', 'Espelhar'], 3),
    ],
    usesPrev: true,
    render: (src, p, env, prev) => {
      const q = prev || p;
      const moving = Math.abs(q.zDist - p.zDist) > 1e-4 || Math.abs(q.rotate - p.rotate) > 1e-3 || Math.abs(q.shiftX - p.shiftX) > 1e-4 || Math.abs(q.shiftY - p.shiftY) > 1e-4;
      return env.gl.pass(BMC, {
        u_tex: src, u_c: cuv(env, p.center), u_s0: 1 / Math.max(0.01, q.zDist), u_s1: 1 / Math.max(0.01, p.zDist),
        u_r0: rad(q.rotate), u_r1: rad(p.rotate), u_sh0: [q.shiftX, q.shiftY], u_sh1: [p.shiftX, p.shiftY],
        u_n: moving && p.shutter > 0 ? Math.round(p.samples) : 1, u_wrap: p.wrap,
      });
    },
  },
  {
    type: 'twitch', label: 'Twitch', category: 'Movimento', plugin: 'Twitch (Video Copilot)',
    description: 'Eventos aleatórios de blur, cor, luz, escala e deslize — clássico de transições em edits.',
    params: [
      num('amount', 'Quantidade %', 60, 0, 100), num('speed', 'Velocidade (eventos/s)', 10, 0.5, 60, 0.5), num('seed', 'Semente', 1, 0, 999),
      bool('blur', 'Blur', true), num('blurAmt', 'Blur – quantidade', 20, 0, 200),
      bool('color', 'Cor', true), num('colorAmt', 'Cor – deslocamento RGB', 12, 0, 200),
      bool('light', 'Luz', true), num('lightAmt', 'Luz – intensidade %', 60, 0, 300),
      bool('scale', 'Escala', true), num('scaleAmt', 'Escala – %', 15, 0, 200),
      bool('slide', 'Deslize', false), num('slideAmt', 'Deslize – px', 60, 0, 2000),
    ],
    pad: (p) => (p.blur ? p.blurAmt : 0) + (p.color ? p.colorAmt : 0),
    transform: (p, env) => {
      const s = p.scale ? 1 + twitchEnv(env.t, p, 4) * (p.scaleAmt / 100) : 1;
      let dx = 0, dy = 0;
      if (p.slide) {
        const e = twitchEnv(env.t, p, 5);
        const a = hash1(Math.floor(env.t * p.speed) * 3.3 + p.seed) * Math.PI * 2;
        dx = Math.cos(a) * e * p.slideAmt; dy = Math.sin(a) * e * p.slideAmt;
      }
      return { dx, dy, scale: s };
    },
    render: (src, p, env) => {
      const { gl } = env;
      let out = src;
      const eb = p.blur ? twitchEnv(env.t, p, 1) : 0;
      if (eb > 0.01) out = gl.blur(out, eb * p.blurAmt * 0.5 * env.scale);
      const ec = p.color ? twitchEnv(env.t, p, 2) : 0;
      const el = p.light ? twitchEnv(env.t, p, 3) : 0;
      if (ec > 0.01 || el > 0.01) {
        const off = ec * p.colorAmt * env.scale;
        out = gl.pass(TWITCH, { u_tex: out, u_off: [off / env.W, 0], u_light: el * (p.lightAmt / 100) });
      }
      return out;
    },
  },
  {
    type: 'transform', label: 'Transformar (efeito)', category: 'Movimento',
    params: [{ key: 'offset', label: 'Deslocamento', kind: 'point', default: [0, 0] }, num('scale', 'Escala %', 100, 0, 2000), ang('rotation', 'Rotação', 0), num('opacity', 'Opacidade %', 100, 0, 100)],
    transform: (p) => ({ dx: p.offset[0], dy: p.offset[1], scale: p.scale / 100, rot: p.rotation, opacity: p.opacity / 100 }),
  },
  {
    type: 'twixtor', label: 'Velocidade (estilo Twixtor)', category: 'Tempo', plugin: 'Twixtor / Timewarp',
    description: 'Muda a velocidade do vídeo com rampas suaves (anime “Velocidade %” com keyframes). Valores negativos tocam ao contrário (reverse). Frame blending mistura quadros vizinhos. Só afeta camadas de vídeo.',
    params: [num('speed', 'Velocidade % (negativo = reverso)', 50, -1000, 1000, 1), bool('frameBlend', 'Frame blending', true)],
    sourceSpeed: true,
  },
  {
    type: 'posterizeTime', label: 'Posterize Time (stutter)', category: 'Tempo',
    params: [num('fps', 'Quadros por segundo', 8, 1, 60, 1)],
    timeWarp: (t, p) => Math.floor(t * p.fps + 1e-6) / p.fps,
  },
  {
    type: 'echo', label: 'Echo (rastro)', category: 'Tempo',
    params: [num('time', 'Tempo do eco (s)', -0.04, -1, 1, 0.005), num('count', 'Número de ecos', 6, 1, 30, 1), num('start', 'Intensidade inicial', 1, 0, 1, 0.01), num('decay', 'Decaimento', 0.7, 0, 1, 0.01), bool('behind', 'Ecos atrás', true)],
    temporal: 'echo',
  },
];
