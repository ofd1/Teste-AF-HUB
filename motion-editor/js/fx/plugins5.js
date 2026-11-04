// Efeitos encontrados nos projetos do usuário que ainda faltavam: Bevel Alpha, Crop Edges, Color Key,
// Change To Color (AE), CC Ball Action, S_WarpFishEye e S_TimeWarpRGB (Sapphire).
import { frag, num, ang, bool, sel, col, pos, rgb, rad, hash1 } from './common.js';

// Bevel Alpha (AE): chanfro nas bordas do alfa, iluminado por uma luz direcional
const BEVEL = frag(`
uniform float u_th, u_int; uniform vec2 u_light; uniform vec3 u_lcol;
float A(vec2 p) { return texture2D(u_tex, p).a; }
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  if (s.a < 0.002) { gl_FragColor = s; return; }
  vec2 g = vec2(0.0); float inside = 1.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    vec2 d = vec2(cos(a), sin(a));
    float v = A(v_uv + d * u_th * u_texel);
    g += d * v;
    inside = min(inside, v);
  }
  // normal aponta para fora da forma (contra o gradiente do alfa); só existe perto da borda
  vec2 n = -g / 6.0;
  float edge = clamp(length(n) * 1.5, 0.0, 1.0) * (1.0 - inside * 0.0);
  float l = dot(normalize(n + 1e-5), u_light) * edge;
  vec3 c = unpre(s).rgb;
  c += u_lcol * max(l, 0.0) * u_int;      // lado iluminado
  c *= 1.0 - max(-l, 0.0) * u_int * 0.8;   // lado na sombra
  gl_FragColor = pre(vec4(clamp(c, 0.0, 1.0), s.a));
}`);

const CROP = frag(`
uniform vec4 u_crop;
void main() {
  vec2 c = contentUV(v_uv);
  bool out_ = c.x < u_crop.x || c.y < u_crop.y || c.x > 1.0 - u_crop.z || c.y > 1.0 - u_crop.w;
  gl_FragColor = out_ ? vec4(0.0) : texture2D(u_tex, v_uv);
}`);

const CKEY = frag(`
uniform vec3 u_key; uniform float u_tol, u_feather; uniform float u_thin;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = unpre(s).rgb;
  float d = max(max(abs(c.r - u_key.r), abs(c.g - u_key.g)), abs(c.b - u_key.b));
  float k = smoothstep(u_tol, u_tol + max(u_feather, 0.002), d);
  gl_FragColor = s * k;
}`);

// Change To Color: troca a cor "De" pela cor "Para" mantendo a luz e a textura da imagem
const CHG = frag(`
uniform vec3 u_from, u_to; uniform float u_hueTol, u_lumTol, u_satTol, u_soft, u_mode;
vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b), l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h = mx == c.r ? (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float h2r(float p, float q, float t) { t = fract(t); if (t < 1.0/6.0) return p + (q - p) * 6.0 * t; if (t < 0.5) return q; if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }
vec3 hsl2rgb(vec3 h) { if (h.y < 1e-5) return vec3(h.z); float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y, p = 2.0 * h.z - q; return vec3(h2r(p, q, h.x + 1.0/3.0), h2r(p, q, h.x), h2r(p, q, h.x - 1.0/3.0)); }
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = unpre(s).rgb, hc = rgb2hsl(c), hf = rgb2hsl(u_from), ht = rgb2hsl(u_to);
  float dh = abs(hc.x - hf.x); dh = min(dh, 1.0 - dh);
  float m = 1.0 - smoothstep(u_hueTol, u_hueTol + u_soft * 0.25 + 1e-3, dh);
  m *= 1.0 - smoothstep(u_lumTol, u_lumTol + u_soft * 0.5 + 1e-3, abs(hc.z - hf.z));
  m *= 1.0 - smoothstep(u_satTol, u_satTol + u_soft * 0.5 + 1e-3, abs(hc.y - hf.y));
  vec3 o;
  if (u_mode < 1.5) o = hsl2rgb(vec3(hc.x + (ht.x - hf.x), hc.y, hc.z));                                  // Hue
  else if (u_mode < 2.5) o = hsl2rgb(vec3(hc.x + (ht.x - hf.x), hc.y, clamp(hc.z + ht.z - hf.z, 0.0, 1.0))); // Hue & Lightness
  else if (u_mode < 3.5) o = hsl2rgb(vec3(hc.x + (ht.x - hf.x), clamp(hc.y + ht.y - hf.y, 0.0, 1.0), clamp(hc.z + ht.z - hf.z, 0.0, 1.0)));
  else o = hsl2rgb(vec3(ht.x, ht.y, hc.z));                                                                 // Colorize
  gl_FragColor = pre(vec4(mix(c, clamp(o, 0.0, 1.0), m), s.a));
}`);

// S_WarpFishEye: lente olho de peixe (Amount > 0 estufa, < 0 encolhe), bordas repetidas/espelhadas
const FISH = frag(`
uniform float u_amt; uniform vec2 u_c, u_wrap; uniform float u_asp;
float wr(float v, float m) { if (m > 2.5) { float k = mod(v, 2.0); return k > 1.0 ? 2.0 - k : k; } if (m > 1.5) return fract(v); return v; }
void main() {
  vec2 cu = contentUV(v_uv);
  vec2 d = (cu - u_c) * vec2(u_asp, 1.0);
  float r = length(d);
  float k = u_amt >= 0.0 ? pow(r / 0.6, u_amt * 1.2) : pow(r / 0.6, u_amt * 0.6);
  vec2 su = u_c + d * clamp(k, 0.0, 6.0) / vec2(u_asp, 1.0);
  if ((u_wrap.x < 1.5 && (su.x < 0.0 || su.x > 1.0)) || (u_wrap.y < 1.5 && (su.y < 0.0 || su.y > 1.0))) { gl_FragColor = vec4(0.0); return; }
  vec2 e = u_texel / u_rect.zw;
  su = clamp(vec2(wr(su.x, u_wrap.x), wr(su.y, u_wrap.y)), e, 1.0 - e);
  gl_FragColor = texture2D(u_tex, fromContent(su));
}`);

// CC Ball Action: a imagem vira uma grade de bolinhas 3D, que podem se espalhar (Scatter) e girar
const BALL_VERT = `
precision highp float;
attribute vec2 a_cell; attribute vec2 a_corner; attribute vec3 a_rnd;
uniform vec4 u_rect; uniform vec2 u_px; uniform float u_r, u_scatter, u_twist, u_rot, u_asp;
varying vec2 v_cell; varying vec2 v_q;
void main() {
  vec2 c = a_cell;
  vec2 rn = a_rnd.xy * 2.0 - 1.0;
  vec2 pc = (c - 0.5) * vec2(u_asp, 1.0);
  float a = u_rot + u_twist * length(pc) * 2.0;
  pc = mat2(cos(a), sin(a), -sin(a), cos(a)) * pc;
  vec2 p = pc / vec2(u_asp, 1.0) + 0.5 + rn * u_scatter * u_px;
  vec2 v = p + a_corner * u_r * u_px;
  gl_Position = vec4((u_rect.xy + v * u_rect.zw) * 2.0 - 1.0, 0.0, 1.0);
  v_cell = u_rect.xy + c * u_rect.zw; v_q = a_corner;
}`;
const BALL_FRAG = `
precision highp float;
uniform sampler2D u_tex;
varying vec2 v_cell; varying vec2 v_q;
void main() {
  float r2 = dot(v_q, v_q);
  if (r2 > 1.0) discard;
  vec4 c = texture2D(u_tex, v_cell);
  if (c.a < 0.01) discard;
  vec3 n = vec3(v_q, sqrt(1.0 - r2));
  float l = 0.35 + 0.75 * max(dot(n, normalize(vec3(-0.5, -0.6, 0.8))), 0.0);
  float sp = pow(max(dot(n, normalize(vec3(-0.3, -0.4, 1.0))), 0.0), 30.0) * 0.5;
  float edge = smoothstep(1.0, 0.85, r2);
  gl_FragColor = vec4(c.rgb * l + vec3(sp) * c.a, c.a) * edge;
}`;

function buildBalls(nx, ny, seed) {
  const out = new Float32Array(nx * ny * 6 * 7);
  let o = 0;
  const C = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = j * nx + i, cx = (i + 0.5) / nx, cy = (j + 0.5) / ny;
    const r1 = hash1(id * 1.731 + seed * 7.1), r2 = hash1(id * 3.917 + seed * 1.3 + 5.2), r3 = hash1(id * 0.613 + seed);
    for (const [ax, ay] of C) { out[o++] = cx; out[o++] = cy; out[o++] = ax; out[o++] = ay; out[o++] = r1; out[o++] = r2; out[o++] = r3; }
  }
  return { data: out, attribs: [['a_cell', 2], ['a_corner', 2], ['a_rnd', 3]] };
}

// S_Sharpen: soma das faixas de detalhe (cada uma com seu ganho) + unsharp de raio largo; luma e croma separados
const SSHARP = frag(`
uniform sampler2D u_b0, u_b1, u_b2, u_b3, u_bw; uniform vec4 u_sc; uniform float u_amp, u_thr, u_luma, u_chroma, u_op;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = unpre(s).rgb;
  vec3 a0 = unpre(texture2D(u_b0, v_uv)).rgb, a1 = unpre(texture2D(u_b1, v_uv)).rgb, a2 = unpre(texture2D(u_b2, v_uv)).rgb, a3 = unpre(texture2D(u_b3, v_uv)).rgb;
  vec3 aw = unpre(texture2D(u_bw, v_uv)).rgb;
  vec3 d = (c - a0) * u_sc.x + (a0 - a1) * u_sc.y + (a1 - a2) * u_sc.z + (a2 - a3) * u_sc.w + (c - aw) * u_amp;
  // Edge Threshold: ignora diferenças muito pequenas (ruído/grão)
  d *= smoothstep(u_thr, u_thr * 3.0 + 0.002, abs(luma(c - a1)) + abs(luma(c - aw)) * 0.5);
  float dl = luma(d);
  vec3 dc = d - vec3(dl);
  vec3 o = c + (vec3(dl) * u_luma + dc * u_chroma) * u_op;
  gl_FragColor = pre(vec4(clamp(o, 0.0, 1.0), s.a));
}`);

export default [
  {
    type: 'bevelAlpha', label: 'Bevel Alpha (chanfro)', category: 'Estilizar', plugin: 'Bevel Alpha (After Effects)',
    description: 'Chanfro iluminado nas bordas do alfa da camada (texto, PNG recortado), como o Bevel Alpha do AE.',
    params: [num('thickness', 'Espessura da borda', 2, 0, 200, 0.1), ang('angle', 'Ângulo da luz', -60), col('color', 'Cor da luz', [1, 1, 1, 1]), num('intensity', 'Intensidade da luz', 0.4, 0, 1, 0.01)],
    render: (src, p, env) => {
      const a = rad(p.angle);
      return env.gl.pass(BEVEL, { u_tex: src, u_th: Math.max(0.5, p.thickness * env.scale), u_int: p.intensity, u_light: [-Math.cos(a), Math.sin(a)], u_lcol: rgb(p.color) });
    },
  },
  {
    type: 'cropEdges', label: 'Crop Edges (cortar bordas)', category: 'Utilidades', plugin: 'Crop Edges (After Effects)',
    params: [num('amount', 'Corte por borda (px)', 0, 0, 2000, 1), num('left', 'Esquerda extra (px)', 0, 0, 4000), num('top', 'Topo extra (px)', 0, 0, 4000), num('right', 'Direita extra (px)', 0, 0, 4000), num('bottom', 'Base extra (px)', 0, 0, 4000)],
    render: (src, p, env) => env.gl.pass(CROP, { u_tex: src, u_crop: [(p.amount + p.left) / env.w, (p.amount + p.top) / env.h, (p.amount + p.right) / env.w, (p.amount + p.bottom) / env.h] }),
  },
  {
    type: 'colorKey', label: 'Color Key (chave de cor)', category: 'Chave', plugin: 'Color Key (After Effects)',
    params: [col('key', 'Cor da chave', [0, 0, 1, 1]), num('tolerance', 'Tolerância', 0, 0, 255, 1), num('feather', 'Suavizar borda', 0, 0, 50, 0.1)],
    render: (src, p, env) => env.gl.pass(CKEY, { u_tex: src, u_key: rgb(p.key), u_tol: p.tolerance / 255, u_feather: p.feather / 50 * 0.2 + 0.004 }),
  },
  {
    type: 'changeToColor', label: 'Change To Color (trocar cor)', category: 'Cor', plugin: 'Change To Color (After Effects)',
    params: [
      col('from', 'De', [1, 0, 0, 1]), col('to', 'Para', [0, 0, 1, 1]), sel('change', 'Mudar', ['Matiz', 'Matiz e luminosidade', 'Matiz, luminosidade e saturação', 'Colorir'], 1),
      num('hueTol', 'Tolerância – matiz %', 5, 0, 100, 0.1), num('lumTol', 'Tolerância – luminosidade %', 50, 0, 100, 0.1), num('satTol', 'Tolerância – saturação %', 50, 0, 100, 0.1), num('softness', 'Suavidade %', 50, 0, 100, 0.1),
    ],
    render: (src, p, env) => env.gl.pass(CHG, { u_tex: src, u_from: rgb(p.from), u_to: rgb(p.to), u_mode: p.change, u_hueTol: p.hueTol / 100 * 0.5, u_lumTol: p.lumTol / 100, u_satTol: p.satTol / 100, u_soft: p.softness / 100 }),
  },
  {
    type: 'fishEye', label: 'Olho de peixe (S_WarpFishEye)', category: 'Distorção', plugin: 'S_WarpFishEye (Sapphire)',
    params: [num('amount', 'Amount', 0.5, -2, 4, 0.01), pos('center', 'Centro'), sel('wrapX', 'Wrap X', ['Transparente', 'Repetir', 'Espelhar'], 3), sel('wrapY', 'Wrap Y', ['Transparente', 'Repetir', 'Espelhar'], 3)],
    render: (src, p, env) => env.gl.pass(FISH, { u_tex: src, u_amt: p.amount, u_c: p.center || [0.5, 0.5], u_wrap: [p.wrapX ?? 3, p.wrapY ?? 3], u_asp: env.w / env.h }),
  },
  {
    type: 'ballAction', label: 'Ball Action (bolinhas)', category: 'Estilizar', plugin: 'CC Ball Action',
    description: 'Transforma a imagem numa grade de bolinhas 3D com a cor da imagem; Scatter espalha as bolinhas e Twist/Rotação giram a grade.',
    params: [num('scatter', 'Scatter (espalhar)', 0, 0, 2000, 1), num('spacing', 'Grid Spacing', 4, 1, 100, 0.5), num('size', 'Ball Size %', 100, 0, 300, 1), ang('rotation', 'Rotation', 0), ang('twist', 'Twist Angle', 0), num('seed', 'Instability State', 0, 0, 999, 1)],
    pad: (p) => Math.min(600, p.scatter * 0.6),
    render: (src, p, env) => {
      const sp = Math.max(1, p.spacing);
      // limite de bolinhas (memória/tempo): espaçamento mínimo efetivo
      let nx = Math.max(2, Math.round(env.w / sp)), ny = Math.max(2, Math.round(env.h / sp));
      const k = Math.sqrt(Math.min(1, 90000 / (nx * ny)));
      nx = Math.max(2, Math.round(nx * k)); ny = Math.max(2, Math.round(ny * k));
      const cellPx = env.w / nx;
      const key = `balls:${nx}:${ny}:${Math.round(p.seed)}`;
      return env.gl.mesh(key, () => buildBalls(nx, ny, Math.round(p.seed)), BALL_VERT, BALL_FRAG, {
        u_tex: src, u_rect: env.rect, u_px: [1 / env.w, 1 / env.h], u_r: (cellPx / 2) * (p.size / 100), u_scatter: p.scatter, u_twist: rad(p.twist), u_rot: rad(p.rotation), u_asp: env.w / env.h,
      }, src.w, src.h);
    },
  },
  {
    type: 'timeWarpRGB', label: 'Time Warp RGB (canais no tempo)', category: 'Tempo', plugin: 'S_TimeWarpRGB (Sapphire)',
    description: 'Cada canal de cor mostra um momento diferente: vermelho atrasado/adiantado, verde no tempo atual, azul em outro tempo — rastro colorido em movimento.',
    params: [num('red', 'Red Shift Frames', -2, -100, 100, 0.1), num('blue', 'Blue Shift Frames', 2, -100, 100, 0.1)],
    channelTime: true, temporal: 'channelTime',
  },
  {
    type: 'wideTime', label: 'CC Wide Time', category: 'Tempo', plugin: 'CC Wide Time',
    description: 'Mistura vários quadros da própria camada (para trás e para frente no tempo): rastro/eco suave em movimento, como o CC Wide Time.',
    params: [num('forward', 'Forward Steps', 3, 0, 30, 1), num('backward', 'Backward Steps', 3, 0, 30, 1), num('stepSize', 'Distância entre passos (quadros)', 1, 0.1, 10, 0.1), bool('nativeBlur', 'Native Motion Blur (mais amostras)', false)],
    temporal: 'wideTime',
  },
  {
    type: 'sSharpen', label: 'S_Sharpen (nitidez em faixas)', category: 'Cor', plugin: 'S_Sharpen (Sapphire)',
    description: 'Nitidez da Sapphire: separa a imagem em faixas de detalhe (minúsculo, pequeno, médio, grande) e realça cada uma, mais um contraste local de raio grande (Sharpen Width) — o visual "HDR/qualidade" dos edits.',
    params: [
      num('amp', 'Sharpen Amp', 1, 0, 10, 0.01), num('width', 'Sharpen Width (px)', 2, 0.3, 200, 0.1), num('detail', 'Small Detail Size (px)', 2, 0.3, 50, 0.1),
      num('tiny', 'Scale Tiny Details', 1, 0, 5, 0.01), num('small', 'Scale Small Details', 1, 0, 5, 0.01), num('medium', 'Scale Medium Details', 1, 0, 5, 0.01), num('large', 'Scale Large Details', 1, 0, 5, 0.01),
      num('edgeThr', 'Edge Threshold', 0, 0, 1, 0.01), num('luma', 'Sharpen Luma', 1, 0, 5, 0.01), num('chroma', 'Sharpen Chroma', 0, 0, 5, 0.01), num('opacity', 'Opacity', 1, 0, 4, 0.01),
    ],
    pad: (p) => Math.min(100, Math.max(p.width * 0.25, p.detail * 3)) * 2,
    render: (src, p, env) => {
      const { gl } = env, sc = env.scale;
      const d = Math.max(0.3, p.detail) * sc;
      // faixas: original → blur(d/2) → blur(d) → blur(3d) → blur(9d); e o unsharp largo com Sharpen Width
      const b0 = gl.blur(src, d * 0.25), b1 = gl.blur(src, d * 0.5), b2 = gl.blur(src, d * 1.2), b3 = gl.blur(src, d * 3);
      const bw = gl.blur(src, Math.max(0.3, p.width) * sc * 0.25);
      return gl.pass(SSHARP, {
        u_tex: src, u_b0: b0, u_b1: b1, u_b2: b2, u_b3: b3, u_bw: bw,
        u_sc: [p.tiny - 1, p.small - 1, p.medium - 1, p.large - 1], u_amp: p.amp * 0.6, u_thr: p.edgeThr * 0.1, u_luma: p.luma, u_chroma: p.chroma, u_op: 0.8, // Opacity da Sapphire é modo de alfa (2 = Normal), não intensidade
      });
    },
  },
];
