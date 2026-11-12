// Distorção: Wave Warp, Turbulent Displace, Bulge/CC Lens, Twirl, Optics Compensation, Mirror,
// CC Kaleida, Motion Tile.
import { frag, num, ang, bool, sel, pos, rad, cuv } from './common.js';

const WAVE = frag(`
uniform vec2 u_d; uniform float u_h; uniform float u_w; uniform float u_phase; uniform float u_type;
float wave(float x) {
  if (u_type < 1.5) return sin(x);
  if (u_type < 2.5) return sign(sin(x));
  if (u_type < 3.5) return asin(sin(x)) * 2.0 / PI;
  return fract(x / (2.0 * PI)) * 2.0 - 1.0;
}
void main() {
  vec2 px = v_uv * u_size;
  vec2 n = vec2(-u_d.y, u_d.x);
  float ph = dot(px, u_d) / u_w * 2.0 * PI - u_phase;
  vec2 q = px - n * u_h * wave(ph);
  gl_FragColor = samp(q / u_size);
}`);

const TURB = frag(`
uniform float u_amount; uniform float u_sz; uniform float u_evo; uniform float u_cx;
void main() {
  vec2 px = v_uv * u_size;
  vec2 p = px / u_sz;
  int oct = int(u_cx);
  vec2 d = vec2(fbm(p + vec2(u_evo, 0.0), oct), fbm(p + vec2(17.3, u_evo * 0.7), oct)) - 0.5;
  gl_FragColor = samp((px + d * 2.0 * u_amount) / u_size);
}`);

const BULGE = frag(`
uniform vec2 u_c; uniform float u_r; uniform float u_h;
void main() {
  vec2 px = v_uv * u_size, c = u_c * u_size;
  vec2 d = px - c;
  float r = length(d) / u_r;
  if (r < 1.0) {
    float k = 1.0 - r;
    d *= u_h >= 0.0 ? (1.0 - u_h * k * k * 0.9) : (1.0 - u_h * k * 0.9);
  }
  gl_FragColor = samp((c + d) / u_size);
}`);

const TWIRL = frag(`
uniform vec2 u_c; uniform float u_r; uniform float u_a;
void main() {
  vec2 px = v_uv * u_size, c = u_c * u_size;
  vec2 d = px - c;
  float r = length(d) / u_r;
  if (r < 1.0) { float an = -u_a * (1.0 - r) * (1.0 - r); d = mat2(cos(an), sin(an), -sin(an), cos(an)) * d; }
  gl_FragColor = samp((c + d) / u_size);
}`);

const OPTICS = frag(`
uniform vec2 u_c; uniform float u_k;
void main() {
  vec2 asp = vec2(u_rect.z * u_size.x, u_rect.w * u_size.y);
  vec2 d = (v_uv - u_c) * u_size / max(asp.x, asp.y);
  float r2 = dot(d, d);
  vec2 q = u_c + d * (1.0 + u_k * r2) * max(asp.x, asp.y) / u_size;
  gl_FragColor = samp(q);
}`);

const MIRROR = frag(`
uniform vec2 u_c; uniform vec2 u_n;
void main() {
  vec2 px = v_uv * u_size, c = u_c * u_size;
  float s = dot(px - c, u_n);
  if (s > 0.0) px -= 2.0 * s * u_n;
  gl_FragColor = samp(px / u_size);
}`);

const KALEIDA = frag(`
uniform vec2 u_c; uniform float u_seg; uniform float u_rot; uniform float u_zoom;
void main() {
  vec2 px = v_uv * u_size, c = u_c * u_size;
  vec2 d = px - c;
  float r = length(d) / u_zoom;
  float a = atan(d.y, d.x) + u_rot;
  float seg = 2.0 * PI / u_seg;
  a = mod(a, seg);
  if (a > seg * 0.5) a = seg - a;
  a -= u_rot;
  gl_FragColor = samp((c + vec2(cos(a), sin(a)) * r) / u_size);
}`);

const TILE = frag(`
uniform vec2 u_out; uniform float u_mirror; uniform vec2 u_phase;
void main() {
  vec2 cu = contentUV(v_uv);
  if (abs(cu.x - 0.5) > u_out.x * 0.5 || abs(cu.y - 0.5) > u_out.y * 0.5) { gl_FragColor = vec4(0.0); return; }
  cu += u_phase;
  if (u_mirror > 0.5) { vec2 m = mod(cu, 2.0); cu = vec2(m.x > 1.0 ? 2.0 - m.x : m.x, m.y > 1.0 ? 2.0 - m.y : m.y); }
  else cu = fract(cu);
  vec2 e = u_texel / u_rect.zw;
  cu = clamp(cu, e * 0.5, 1.0 - e * 0.5);
  gl_FragColor = texture2D(u_tex, fromContent(cu));
}`);

export default [
  {
    type: 'waveWarp', label: 'Wave Warp', category: 'Distorção',
    params: [sel('waveType', 'Tipo de onda', ['Seno', 'Quadrada', 'Triangular', 'Dente de serra']), num('height', 'Altura', 10, -500, 500), num('width', 'Largura', 40, 1, 2000), ang('direction', 'Direção', 90), num('speed', 'Velocidade (ciclos/s)', 1, -20, 20, 0.05), num('phase', 'Fase', 0, -360, 360)],
    pad: (p) => Math.abs(p.height),
    render: (src, p, env) => {
      const a = rad(p.direction);
      return env.gl.pass(WAVE, {
        u_tex: src, u_d: [Math.sin(a), -Math.cos(a)], u_h: p.height * env.scale, u_w: Math.max(1, p.width * env.scale),
        u_phase: env.t * p.speed * 2 * Math.PI + rad(p.phase), u_type: p.waveType,
      });
    },
  },
  {
    type: 'turbulentDisplace', label: 'Turbulent Displace', category: 'Distorção',
    params: [num('amount', 'Quantidade', 30, -500, 500), num('size', 'Tamanho', 80, 2, 1000), num('complexity', 'Complexidade', 2, 1, 6), ang('evolution', 'Evolução', 0), num('evoSpeed', 'Evolução auto (°/s)', 90, -2000, 2000)],
    pad: (p) => Math.abs(p.amount),
    render: (src, p, env) => env.gl.pass(TURB, {
      u_tex: src, u_amount: p.amount * env.scale, u_sz: Math.max(2, p.size * env.scale), u_cx: Math.round(p.complexity),
      u_evo: (p.evolution + p.evoSpeed * env.t) / 360,
    }),
  },
  {
    type: 'bulge', label: 'Bulge / Lente (CC Lens)', category: 'Distorção',
    params: [pos('center', 'Centro'), num('radius', 'Raio', 300, 1, 3000), num('strength', 'Força', 0.6, -1, 1, 0.01)],
    render: (src, p, env) => env.gl.pass(BULGE, { u_tex: src, u_c: cuv(env, p.center), u_r: p.radius * env.scale, u_h: p.strength }),
  },
  {
    type: 'twirl', label: 'Twirl (redemoinho)', category: 'Distorção',
    params: [ang('angle', 'Ângulo', 0), num('radius', 'Raio', 400, 1, 3000), pos('center', 'Centro')],
    render: (src, p, env) => env.gl.pass(TWIRL, { u_tex: src, u_c: cuv(env, p.center), u_r: p.radius * env.scale, u_a: rad(p.angle) }),
  },
  {
    type: 'optics', label: 'Distorção de lente (Optics)', category: 'Distorção',
    params: [num('fov', 'Campo de visão', 40, 0, 180), bool('reverse', 'Inverter (almofada)'), pos('center', 'Centro')],
    render: (src, p, env) => env.gl.pass(OPTICS, { u_tex: src, u_c: cuv(env, p.center), u_k: (p.reverse ? -1 : 1) * (p.fov / 180) * 1.2 }),
  },
  {
    type: 'mirror', label: 'Espelho (Mirror)', category: 'Distorção',
    params: [pos('center', 'Centro'), ang('angle', 'Ângulo', 0)],
    render: (src, p, env) => env.gl.pass(MIRROR, { u_tex: src, u_c: cuv(env, p.center), u_n: [Math.cos(rad(p.angle)), Math.sin(rad(p.angle))] }),
  },
  {
    type: 'kaleida', label: 'Caleidoscópio (CC Kaleida)', category: 'Distorção',
    params: [pos('center', 'Centro'), num('segments', 'Segmentos', 6, 2, 32), ang('rotation', 'Rotação', 0), num('zoom', 'Zoom', 1, 0.1, 10, 0.05)],
    render: (src, p, env) => env.gl.pass(KALEIDA, { u_tex: src, u_c: cuv(env, p.center), u_seg: Math.max(2, Math.round(p.segments)), u_rot: rad(p.rotation), u_zoom: p.zoom }),
  },
  {
    type: 'motionTile', label: 'Motion Tile', category: 'Distorção',
    description: 'Repete as bordas da camada — essencial com shakes e zooms para não aparecer fundo.',
    params: [num('outW', 'Largura de saída %', 200, 100, 600), num('outH', 'Altura de saída %', 200, 100, 600), bool('mirror', 'Bordas espelhadas', true), num('phaseX', 'Deslocamento X %', 0, -100, 100), num('phaseY', 'Deslocamento Y %', 0, -100, 100)],
    // a margem só precisa cobrir o deslocamento de shakes/zooms: limita a 20% para não multiplicar o custo dos efeitos seguintes
    pad: (p, env) => Math.min(Math.max(((p.outW - 100) / 200) * env.w, ((p.outH - 100) / 200) * env.h), 0.2 * Math.max(env.w, env.h)),
    render: (src, p, env) => env.gl.pass(TILE, { u_tex: src, u_out: [p.outW / 100, p.outH / 100], u_mirror: p.mirror, u_phase: [p.phaseX / 100, p.phaseY / 100] }),
  },
];
