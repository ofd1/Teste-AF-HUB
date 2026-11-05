// Efeitos dos packs de edit enviados pelo usuário: Luma Key (AE), S_WipeLine e S_EdgeDetect (Sapphire),
// BCC Textured Wipe e BCC ML Depth Estimation (mapa de profundidade aproximado, sem a rede neural da BCC).
import { frag, num, ang, bool, sel, col, rgb, rad } from './common.js';

const LUMAKEY = frag(`
uniform float u_type, u_thr, u_tol, u_soft;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float L = luma(unpre(s).rgb);
  float k;
  if (u_type < 1.5) k = smoothstep(u_thr - u_soft, u_thr + u_soft + 1e-4, L);          // tira os mais escuros
  else if (u_type < 2.5) k = 1.0 - smoothstep(u_thr - u_soft - 1e-4, u_thr + u_soft, L); // tira os mais claros
  else { float d = abs(L - u_thr); k = smoothstep(u_tol, u_tol + u_soft + 1e-4, d); if (u_type > 3.5) k = 1.0 - k; } // similares / diferentes
  gl_FragColor = s * k;
}`);

// S_WipeLine: linha de transição reta (em ângulo) com borda irregular por ruído e borda/glow colorido opcional
const WIPELINE = frag(`
uniform float u_pct, u_ang, u_bw, u_namp, u_nfreq, u_nspeed, u_bop, u_glow, u_gw, u_dir;
uniform vec3 u_bcol, u_gcol;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 c = contentUV(v_uv) - 0.5;
  vec2 d = vec2(cos(u_ang), sin(u_ang));
  float along = dot(c, d) / (abs(d.x) * 0.5 + abs(d.y) * 0.5 + 1e-4) * 0.5 + 0.5; // 0..1 ao longo da direção
  vec2 pp = vec2(-d.y, d.x);
  float across = dot(c, pp) * u_nfreq;
  float n = (vnoise(vec2(across, u_time * u_nspeed)) - 0.5) * 2.0 + (vnoise(vec2(across * 2.7, u_time * u_nspeed * 1.7 + 9.0)) - 0.5);
  float edge = (u_dir > 1.5 ? 1.0 - along : along) + n * u_namp * 0.04;
  float t = u_pct;
  float keep = step(t, edge);
  vec4 o = s * keep;
  float bd = abs(edge - t);
  if (u_bw > 0.0) o = mix(o, vec4(u_bcol, 1.0) * s.a, (1.0 - smoothstep(0.0, u_bw, bd)) * u_bop * step(0.001, t) * step(t, 0.999));
  if (u_glow > 0.0) o.rgb += u_gcol * exp(-bd / max(u_gw, 1e-3)) * u_glow * s.a * step(0.001, t) * step(t, 0.999);
  gl_FragColor = o;
}`);

// S_EdgeDetect: gradiente (Sobel) com peso por canal, limiar e brilho → bordas claras sobre preto
const EDGEDET = frag(`
uniform vec3 u_w; uniform float u_thr, u_bright, u_mix;
float g(vec2 o) { vec3 c = unpre(texture2D(u_tex, v_uv + o * u_texel)).rgb; return dot(c, u_w) / max(u_w.r + u_w.g + u_w.b, 1e-3); }
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float gx = -g(vec2(-1,-1)) - 2.0*g(vec2(-1,0)) - g(vec2(-1,1)) + g(vec2(1,-1)) + 2.0*g(vec2(1,0)) + g(vec2(1,1));
  float gy = -g(vec2(-1,-1)) - 2.0*g(vec2(0,-1)) - g(vec2(1,-1)) + g(vec2(-1,1)) + 2.0*g(vec2(0,1)) + g(vec2(1,1));
  float e = length(vec2(gx, gy));
  e = smoothstep(u_thr, u_thr + 0.15, e) * u_bright;
  vec3 col = mix(unpre(s).rgb, vec3(e), u_mix);
  gl_FragColor = pre(vec4(clamp(col, 0.0, 1.0), s.a));
}`);

// BCC Textured Wipe: some primeiro onde a "textura" (luminância da própria camada) é mais escura
const TEXWIPE = frag(`
uniform sampler2D u_tex2; uniform float u_amt, u_soft, u_inv;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float L = luma(unpre(texture2D(u_tex2, v_uv)).rgb);
  if (u_inv > 0.5) L = 1.0 - L;
  float k = smoothstep(u_amt - u_soft, u_amt + u_soft + 1e-4, L);
  gl_FragColor = s * k;
}`);

// Mapa de profundidade aproximado: luminância suavizada (o que está em foco/iluminado vem para frente) +
// posição vertical (o chão de baixo está mais perto), com os "guias" de longe/perto da BCC
const DEPTH = frag(`
uniform sampler2D u_tex2; uniform float u_mode, u_gamma, u_far, u_near, u_bright, u_con, u_mix;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 cu = contentUV(v_uv);
  float L = luma(unpre(texture2D(u_tex2, v_uv)).rgb);
  float center = 1.0 - smoothstep(0.15, 0.75, length((cu - vec2(0.5, 0.55)) * vec2(1.0, 0.8)));
  float d = clamp(0.45 * L + 0.3 * cu.y + 0.35 * center - 0.1, 0.0, 1.0);
  d = pow(d, max(u_gamma, 0.05));
  d = mix(u_far, u_near, d);
  d = (d - 0.5) * (1.0 + u_con) + 0.5 + u_bright;
  vec3 o = u_mode < 1.5 ? vec3(d) : unpre(s).rgb * mix(0.35, 1.0, d);
  gl_FragColor = pre(vec4(mix(unpre(s).rgb, clamp(o, 0.0, 1.0), u_mix), s.a));
}`);

export default [
  {
    type: 'lumaKey', label: 'Luma Key', category: 'Chave', plugin: 'Luma Key (After Effects)',
    description: 'Deixa transparente pela luminosidade (anime o Threshold para uma transição que vai “apagando” os tons).',
    params: [sel('type', 'Key Type', ['Key Out Darker', 'Key Out Brighter', 'Key Out Similar', 'Key Out Dissimilar'], 1), num('threshold', 'Threshold', 0, 0, 255, 1), num('tolerance', 'Tolerance', 0, 0, 255, 1), num('feather', 'Edge Feather', 0, 0, 50, 0.1)],
    render: (src, p, env) => env.gl.pass(LUMAKEY, { u_tex: src, u_type: p.type, u_thr: p.threshold / 255, u_tol: p.tolerance / 255, u_soft: Math.max(0.002, p.feather / 255) }),
  },
  {
    type: 'wipeLine', label: 'Wipe Line (S_WipeLine)', category: 'Transições', plugin: 'S_WipeLine (Sapphire)',
    description: 'Transição de limpeza reta em ângulo, com borda irregular (ruído), borda colorida e glow.',
    params: [
      num('pct', 'Wipe Percent', 50, 0, 100, 0.1), ang('angle', 'Angle', 0), sel('dir', 'Transition Dir', ['Para frente', 'Para trás'], 1),
      num('noiseAmp', 'Noise Amp', 1, 0, 10, 0.01), num('noiseFreq', 'Noise Freq', 16, 0, 200, 0.1), num('noiseSpeed', 'Noise Speed', 2, 0, 20, 0.1),
      num('borderW', 'Border Width', 0, 0, 1, 0.001), col('borderColor', 'Border Color', [1, 0.75, 0, 1]), num('borderOp', 'Border Opacity', 1, 0, 1, 0.01),
      num('glow', 'Border Glow', 0, 0, 5, 0.01), num('glowW', 'Glow Width', 24, 0, 500, 0.5), col('glowColor', 'Glow Color', [1, 1, 1, 1]),
    ],
    render: (src, p, env) => env.gl.pass(WIPELINE, {
      u_tex: src, u_pct: p.pct / 100, u_ang: rad(p.angle), u_dir: p.dir, u_namp: p.noiseAmp, u_nfreq: p.noiseFreq, u_nspeed: p.noiseSpeed,
      u_bw: p.borderW * 0.2, u_bcol: rgb(p.borderColor), u_bop: p.borderOp, u_glow: p.glow, u_gw: (p.glowW / Math.max(env.w, env.h)) * 0.5, u_gcol: rgb(p.glowColor),
    }),
  },
  {
    type: 'edgeDetect', label: 'Edge Detect (S_EdgeDetect)', category: 'Estilizar', plugin: 'S_EdgeDetect (Sapphire)',
    description: 'Bordas da imagem (contornos claros sobre preto), com peso por canal e limiar.',
    params: [num('threshold', 'Threshold', 0.1, 0, 1, 0.01), num('bright', 'Brightness', 1, 0, 10, 0.01), num('wr', 'Weight Red', 1, 0, 5, 0.01), num('wg', 'Weight Green', 1, 0, 5, 0.01), num('wb', 'Weight Blue', 1, 0, 5, 0.01), num('mix', 'Mix %', 100, 0, 100)],
    render: (src, p, env) => env.gl.pass(EDGEDET, { u_tex: src, u_w: [p.wr, p.wg, p.wb], u_thr: p.threshold * 0.3, u_bright: p.bright, u_mix: p.mix / 100 }),
  },
  {
    type: 'texturedWipe', label: 'Textured Wipe (BCC)', category: 'Transições', plugin: 'BCC Textured Wipe',
    description: 'Transição que some primeiro nas partes mais escuras da imagem (textura), com borda suave.',
    params: [num('amount', 'Wipe Amount %', 50, 0, 100, 0.1), num('softness', 'Softness', 20, 0, 100, 0.1), num('blur', 'Suavizar textura (px)', 8, 0, 100, 0.5), bool('invert', 'Inverter', false)],
    render: (src, p, env) => {
      const tx = p.blur > 0.3 ? env.gl.blur(src, p.blur * env.scale) : src;
      return env.gl.pass(TEXWIPE, { u_tex: src, u_tex2: tx, u_amt: p.amount / 100, u_soft: (p.softness / 100) * 0.25, u_inv: p.invert });
    },
  },
  {
    type: 'depthMap', label: 'Depth Map (BCC ML Depth)', category: 'Estilizar', plugin: 'BCC ML Depth Estimation',
    description: 'Mapa de profundidade APROXIMADO (o original usa uma rede neural): perto = claro, longe = escuro. Use como base de foco/parallax.',
    params: [sel('mode', 'Output', ['Mapa de profundidade', 'Escurecer o fundo'], 1), num('far', 'Level Far', 0, 0, 100), num('near', 'Level Near', 100, 0, 100), num('gamma', 'Gamma', 1, 0.1, 4, 0.01), num('bright', 'Brightness', 0, -1, 1, 0.01), num('contrast', 'Contrast', 0, -1, 2, 0.01), num('mix', 'Intensity %', 100, 0, 100)],
    render: (src, p, env) => {
      const b = env.gl.blur(src, 12 * env.scale);
      return env.gl.pass(DEPTH, { u_tex: src, u_tex2: b, u_mode: p.mode, u_far: p.far / 100, u_near: p.near / 100, u_gamma: p.gamma, u_bright: p.bright, u_con: p.contrast, u_mix: p.mix / 100 });
    },
  },
];

void sel;
