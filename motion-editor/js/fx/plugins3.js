// Mais efeitos de Sapphire e BCC muito usados em edits (recriações):
// BCC Cross Glow, BCC Rays Streaky, BCC Light Wrap, S_GlowRainbow, S_EdgeRays, S_Swish3D/S_SwishPan,
// S_JpegDamage, S_Streaks e S_Feedback.
import { frag, num, ang, bool, sel, pos, col, rgb, rad, cuv } from './common.js';

const HI = frag(`
uniform float u_thr, u_soft;
void main() { vec4 c = texture2D(u_tex, v_uv); float l = luma(c.rgb / max(c.a, 1e-4)); gl_FragColor = c * smoothstep(u_thr, u_thr + max(u_soft, 0.02), l); }`);
const LINE = frag(`
uniform vec2 u_dir; uniform float u_len;
void main() {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -24; i <= 24; i++) { float k = float(i) / 24.0; float w = pow(1.0 - abs(k), 2.5); acc += texture2D(u_tex, v_uv + u_dir * k * u_len) * w; ws += w; }
  gl_FragColor = acc / ws;
}`);
const ADDC = frag(`
uniform sampler2D u_tex2; uniform float u_amount; uniform vec3 u_col;
void main() { vec4 a = texture2D(u_tex, v_uv); vec3 b = texture2D(u_tex2, v_uv).rgb * u_col * u_amount; gl_FragColor = vec4(a.rgb + b * (1.0 - a.rgb * 0.35), max(a.a, min(1.0, luma(b)))); }`);

// raios a partir de um centro (amostras em direção ao centro), com modulação de "fiapos" (streaky)
const RADIAL = frag(`
uniform vec2 u_c; uniform float u_len, u_streak, u_seed;
void main() {
  vec2 d = v_uv - u_c;
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 40; i++) {
    float k = float(i) / 39.0;
    float w = 1.0 - k;
    acc += texture2D(u_tex, u_c + d * (1.0 - k * u_len)) * w; ws += w;
  }
  float a = atan(d.y, d.x);
  float s = mix(1.0, 0.25 + 1.5 * vnoise(vec2(a * 24.0, u_seed)) * vnoise(vec2(a * 61.0, u_seed + 3.0)), u_streak);
  gl_FragColor = acc / ws * s;
}`);

const SOBEL = frag(`
void main() {
  vec2 t = u_texel;
  float tl = luma(texture2D(u_tex, v_uv + vec2(-t.x, -t.y)).rgb), tr = luma(texture2D(u_tex, v_uv + vec2(t.x, -t.y)).rgb);
  float bl = luma(texture2D(u_tex, v_uv + vec2(-t.x, t.y)).rgb), br = luma(texture2D(u_tex, v_uv + vec2(t.x, t.y)).rgb);
  float l = luma(texture2D(u_tex, v_uv + vec2(-t.x, 0.0)).rgb), r = luma(texture2D(u_tex, v_uv + vec2(t.x, 0.0)).rgb);
  float u = luma(texture2D(u_tex, v_uv + vec2(0.0, -t.y)).rgb), b = luma(texture2D(u_tex, v_uv + vec2(0.0, t.y)).rgb);
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl), gy = (bl + 2.0 * b + br) - (tl + 2.0 * u + tr);
  float e = clamp(length(vec2(gx, gy)) * 1.5, 0.0, 1.0);
  gl_FragColor = vec4(texture2D(u_tex, v_uv).rgb * e + e * 0.15, e);
}`);

const RAINBOW = frag(`
uniform sampler2D u_tex2; uniform float u_amount, u_t, u_spread;
void main() {
  vec4 a = texture2D(u_tex, v_uv);
  vec3 g = texture2D(u_tex2, v_uv).rgb;
  float h = fract(length(v_uv - 0.5) * u_spread + u_t * 0.15 + luma(g) * 0.5);
  vec3 rb = hsv2rgb(vec3(h, 0.85, 1.0));
  vec3 o = a.rgb + g * rb * u_amount * 1.6;
  gl_FragColor = vec4(min(o, vec3(max(a.a, 1.0))), max(a.a, min(1.0, luma(g) * u_amount)));
}`);

const WRAP = frag(`
uniform sampler2D u_tex2; uniform float u_amt;
void main() {
  vec4 c = texture2D(u_tex, v_uv), b = texture2D(u_tex2, v_uv);
  float edge = clamp((1.0 - b.a) * c.a * 2.5, 0.0, 1.0);          // perto da borda do recorte
  vec3 light = b.rgb / max(b.a, 1e-3);
  gl_FragColor = vec4(mix(c.rgb, light * c.a, edge * u_amt), c.a);
}`);

const SWISH = frag(`
uniform vec2 u_sh0, u_sh1; uniform float u_n, u_mode;
vec2 wrap2(vec2 cu) { if (u_mode > 1.5) { vec2 m = mod(cu, 2.0); return vec2(m.x > 1.0 ? 2.0 - m.x : m.x, m.y > 1.0 ? 2.0 - m.y : m.y); } return fract(cu); }
void main() {
  vec4 acc = vec4(0.0);
  float n = max(1.0, u_n);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n) break;
    float f = n > 1.0 ? float(i) / (n - 1.0) : 1.0;
    vec2 cu = wrap2(contentUV(v_uv) - mix(u_sh0, u_sh1, f));
    acc += texture2D(u_tex, fromContent(clamp(cu, u_texel, 1.0 - u_texel)));
  }
  gl_FragColor = acc / n;
}`);

const JPEG = frag(`
uniform float u_amt, u_block, u_t, u_seed;
void main() {
  vec2 px = v_uv * u_size;
  vec2 cell = floor(px / u_block);
  vec2 cuv0 = (cell + 0.5) * u_block / u_size;
  vec4 c = texture2D(u_tex, v_uv);
  vec4 avg = texture2D(u_tex, cuv0);
  // chroma do bloco (subamostragem) + luma quantizada em degraus (compressão pesada)
  float l = luma(c.rgb);
  float q = mix(64.0, 4.0, u_amt);
  float lq = floor(l * q + 0.5) / q;
  vec3 chroma = avg.rgb - luma(avg.rgb);
  vec3 o = clamp(vec3(lq) + chroma, 0.0, 1.0);
  // alguns blocos "quebram": repetem/deslocam o bloco vizinho
  float h = fract(sin(dot(cell + floor(u_t * 6.0) + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
  if (h < u_amt * 0.12) o = texture2D(u_tex, cuv0 + vec2((h * 7.0 - 0.4) * u_block * 3.0 / u_size.x, 0.0)).rgb;
  gl_FragColor = vec4(mix(c.rgb, o * c.a, u_amt), c.a);
}`);

const FEEDBACK = frag(`
uniform vec2 u_c; uniform float u_zoom, u_rot, u_count, u_decay;
void main() {
  vec4 acc = vec4(0.0); float w = 1.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= u_count) break;
    float s = pow(u_zoom, float(i)); float a = u_rot * float(i);
    vec2 d = (v_uv - u_c) * u_size;
    d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d / s;
    vec2 q = u_c + d / u_size;
    vec4 c = (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? vec4(0.0) : texture2D(u_tex, q);
    acc = acc + c * w * (1.0 - acc.a);
    w *= u_decay;
  }
  gl_FragColor = acc;
}`);

export default [
  {
    type: 'crossGlow', label: 'BCC Cross Glow', category: 'Luz e brilho', plugin: 'BCC Cross Glow',
    description: 'Brilho em cruz/estrela saindo das luzes, com glow suave em volta (Boris FX).',
    params: [num('threshold', 'Limiar %', 80, 0, 100), num('length', 'Comprimento dos raios', 120, 1, 800), num('amount', 'Intensidade', 0.8, 0, 6, 0.05), ang('angle', 'Ângulo', 0), num('glow', 'Glow suave', 40, 0, 300), col('color', 'Cor', [1, 0.95, 0.85, 1])],
    pad: (p) => p.length,
    render: (src, p, env) => {
      const { gl } = env;
      const hi = gl.pass(HI, { u_tex: src, u_thr: p.threshold / 100, u_soft: 0.12 });
      let out = src;
      for (let i = 0; i < 2; i++) {
        const a = rad(p.angle) + (Math.PI / 2) * i;
        const s = gl.pass(LINE, { u_tex: hi, u_dir: [Math.cos(a) / env.W, Math.sin(a) / env.H], u_len: p.length * env.scale });
        out = gl.pass(ADDC, { u_tex: out, u_tex2: s, u_amount: p.amount, u_col: rgb(p.color) });
      }
      if (p.glow > 0) out = gl.pass(ADDC, { u_tex: out, u_tex2: gl.blur(hi, p.glow * 0.4 * env.scale), u_amount: p.amount * 0.6, u_col: rgb(p.color) });
      return out;
    },
  },
  {
    type: 'raysStreaky', label: 'BCC Rays Streaky', category: 'Luz e brilho', plugin: 'BCC Rays Streaky / S_Rays',
    description: 'Raios volumétricos com “fiapos” saindo de um ponto (luz de estádio, refletor).',
    params: [pos('center', 'Centro', [0.5, 0.2]), num('length', 'Comprimento %', 60, 1, 100), num('intensity', 'Intensidade', 1.6, 0, 8, 0.05), num('threshold', 'Limiar %', 45, 0, 100), num('streak', 'Fiapos %', 70, 0, 100), col('color', 'Cor', [1, 0.95, 0.85, 1]), num('seed', 'Semente', 1, 0, 999)],
    render: (src, p, env) => {
      const { gl } = env;
      const hi = gl.pass(HI, { u_tex: src, u_thr: p.threshold / 100, u_soft: 0.2 });
      const r = gl.pass(RADIAL, { u_tex: hi, u_c: cuv(env, p.center), u_len: p.length / 100, u_streak: p.streak / 100, u_seed: p.seed });
      return gl.pass(ADDC, { u_tex: src, u_tex2: r, u_amount: p.intensity, u_col: rgb(p.color) });
    },
  },
  {
    type: 'lightWrap', label: 'BCC Light Wrap', category: 'Luz e brilho', plugin: 'BCC Light Wrap',
    description: 'Envolve as bordas do recorte (ex.: jogador sem fundo) com a luz/cor ao redor — integra a pessoa ao fundo.',
    params: [num('width', 'Largura (px)', 18, 1, 200), num('intensity', 'Intensidade %', 70, 0, 100)],
    pad: (p) => p.width,
    render: (src, p, env) => env.gl.pass(WRAP, { u_tex: src, u_tex2: env.gl.blur(src, p.width * env.scale), u_amt: p.intensity / 100 }),
  },
  {
    type: 'glowRainbow', label: 'S_GlowRainbow', category: 'Luz e brilho', plugin: 'S_GlowRainbow (Sapphire)',
    description: 'Glow com as cores do arco-íris girando em volta das luzes.',
    params: [num('threshold', 'Limiar %', 55, 0, 100), num('radius', 'Largura', 120, 1, 800), num('amount', 'Brilho', 1, 0, 5, 0.05), num('spread', 'Espalhamento das cores', 3, 0.1, 20, 0.1)],
    pad: (p) => p.radius,
    render: (src, p, env) => {
      const hi = env.gl.pass(HI, { u_tex: src, u_thr: p.threshold / 100, u_soft: 0.2 });
      return env.gl.pass(RAINBOW, { u_tex: src, u_tex2: env.gl.blur(hi, p.radius * 0.5 * env.scale), u_amount: p.amount, u_t: env.t, u_spread: p.spread });
    },
  },
  {
    type: 'edgeRays', label: 'S_EdgeRays', category: 'Luz e brilho', plugin: 'S_EdgeRays (Sapphire)',
    description: 'Raios de luz saindo das bordas/contornos da imagem (silhueta do jogador brilhando).',
    params: [pos('center', 'Centro', [0.5, 0.45]), num('length', 'Comprimento %', 40, 1, 100), num('amount', 'Brilho', 1.4, 0, 6, 0.05), col('color', 'Cor', [1, 0.9, 0.7, 1])],
    render: (src, p, env) => {
      const e = env.gl.pass(SOBEL, { u_tex: src });
      const r = env.gl.pass(RADIAL, { u_tex: e, u_c: cuv(env, p.center), u_len: p.length / 100, u_streak: 0.3, u_seed: 1 });
      return env.gl.pass(ADDC, { u_tex: src, u_tex2: r, u_amount: p.amount, u_col: rgb(p.color) });
    },
  },
  {
    type: 'swish', label: 'S_Swish3D / S_SwishPan (whip pan)', category: 'Transições', plugin: 'S_Swish3D / S_SwishPan (Sapphire)',
    description: 'Transição “chicote”: a imagem desliza com motion blur forte. Anime “Progresso” de 0 a 100% (rápido no meio).',
    params: [num('progress', 'Progresso %', 0, -200, 200, 0.5), ang('angle', 'Direção', 0), num('distance', 'Distância (% da tela)', 100, 0, 400), num('shutter', 'Motion blur (quadros)', 1.5, 0, 4, 0.05), sel('edges', 'Bordas', ['Repetir', 'Espelhar'], 1)],
    usesPrev: true,
    render: (src, p, env, prev) => {
      const q = prev || p;
      const a = rad(p.angle), d = (v) => (v / 100) * (p.distance / 100);
      const s0 = [Math.cos(a) * d(q.progress), Math.sin(a) * d(q.progress)], s1 = [Math.cos(a) * d(p.progress), Math.sin(a) * d(p.progress)];
      const movePx = Math.hypot((s1[0] - s0[0]) * env.w, (s1[1] - s0[1]) * env.h) * env.scale;
      const n = p.shutter > 0 ? Math.max(1, Math.min(env.final ? 64 : 28, Math.ceil(movePx / 2))) : 1;
      if (Math.abs(p.progress) < 0.01 && n === 1) return src;
      return env.gl.pass(SWISH, { u_tex: src, u_sh0: s0, u_sh1: s1, u_n: n, u_mode: p.edges });
    },
  },
  {
    type: 'jpegDamage', label: 'S_JpegDamage', category: 'Estilizar', plugin: 'S_JpegDamage (Sapphire) / JPEG Glitch',
    description: 'Compressão JPEG estourada: blocos 8×8, cor “borrada” por bloco, degraus e blocos quebrados.',
    params: [num('amount', 'Dano %', 60, 0, 100), num('block', 'Tamanho do bloco (px)', 12, 4, 80, 1), num('seed', 'Semente', 1, 0, 999)],
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(JPEG, { u_tex: src, u_amt: p.amount / 100, u_block: Math.max(2, p.block * env.scale), u_t: env.t, u_seed: p.seed })),
  },
  {
    type: 'streaks', label: 'S_Streaks', category: 'Luz e brilho', plugin: 'S_Streaks (Sapphire)',
    description: 'Riscos de luz numa direção a partir das partes claras (faróis, refletores, reflexos na camisa).',
    params: [num('threshold', 'Limiar %', 65, 0, 100), num('length', 'Comprimento', 300, 1, 1500), ang('angle', 'Ângulo', 0), num('amount', 'Brilho', 1.3, 0, 6, 0.05), col('color', 'Cor', [1, 1, 1, 1])],
    pad: (p) => p.length * 0.5,
    render: (src, p, env) => {
      const hi = env.gl.pass(HI, { u_tex: src, u_thr: p.threshold / 100, u_soft: 0.1 });
      const a = rad(p.angle);
      const s = env.gl.pass(LINE, { u_tex: env.gl.pass(LINE, { u_tex: hi, u_dir: [Math.cos(a) / env.W, Math.sin(a) / env.H], u_len: p.length * env.scale * 0.4 }), u_dir: [Math.cos(a) / env.W, Math.sin(a) / env.H], u_len: p.length * env.scale });
      return env.gl.pass(ADDC, { u_tex: src, u_tex2: s, u_amount: p.amount, u_col: rgb(p.color) });
    },
  },
  {
    type: 'feedback', label: 'S_Feedback', category: 'Distorção', plugin: 'S_Feedback (Sapphire)',
    description: 'Eco de zoom (“túnel”): cópias da imagem cada vez maiores/menores e giradas, como um loop de câmera.',
    params: [pos('center', 'Centro', [0.5, 0.5]), num('zoom', 'Zoom por cópia', 0.85, 0.3, 1.5, 0.005), ang('rotate', 'Giro por cópia', 0), num('count', 'Cópias', 6, 1, 16, 1), num('decay', 'Decaimento', 0.8, 0, 1, 0.01)],
    render: (src, p, env) => env.gl.pass(FEEDBACK, { u_tex: src, u_c: cuv(env, p.center), u_zoom: p.zoom, u_rot: rad(p.rotate), u_count: p.count, u_decay: p.decay }),
  },
];
