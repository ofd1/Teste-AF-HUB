// Efeitos com os MESMOS controles do plugin original (documentação oficial da Boris FX / Sapphire para AE):
//  • S_WarpChroma — separa a imagem em faixas do espectro; o vermelho recebe a transformação "From", o azul a "To"
//    e as outras cores ficam no meio (Steps amostras). Warp Amount escala as duas transformações (0 = imagem intacta).
//  • S_TimeSlice — fatias orientadas por Slice Direction; cada fatia mostra um quadro relativo entre −N/2 e +N/2
//    (+ Frame Offset). Interp Frames liga a mistura entre os dois quadros inteiros mais próximos.
import { frag, num, ang, col, bool, sel, pos, rgb, rad, noise1 } from './common.js';

const WARPCHROMA = frag(`
uniform float u_steps, u_fz, u_frot, u_tz, u_trot, u_amt, u_bright, u_wb, u_wx, u_wy, u_asp;
uniform vec2 u_c, u_fs, u_ts; uniform vec3 u_c1, u_c2, u_c3, u_csum;
float wrap1(float x, float m) { if (m < 1.5) return x; if (m < 2.5) return fract(x); float f = mod(x, 2.0); return f > 1.0 ? 2.0 - f : f; }
vec4 S(vec2 c) {
  c = vec2(wrap1(c.x, u_wx), wrap1(c.y, u_wy));
  return (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) ? vec4(0.0) : texture2D(u_tex, fromContent(c));
}
vec3 specCol(float t) { return t < 0.5 ? mix(u_c1, u_c2, t * 2.0) : mix(u_c2, u_c3, t * 2.0 - 1.0); }
void main() {
  vec2 cc = contentUV(v_uv);
  vec3 acc = vec3(0.0), wsum = vec3(0.0); float aacc = 0.0, n = 0.0;
  for (int i = 0; i < 100; i++) {
    if (float(i) >= u_steps) break;
    float t = u_steps > 1.0 ? float(i) / (u_steps - 1.0) : 0.0;
    // transformação interpolada entre From (t=0, vermelho) e To (t=1, azul), escalada pelo Warp Amount
    float z = exp(log(max(mix(u_fz, u_tz, t), 1e-3)) * u_amt);
    float r = radians(mix(u_frot, u_trot, t)) * u_amt;
    vec2 sh = mix(u_fs, u_ts, t) * u_amt;
    vec2 p = (cc - u_c) * vec2(u_asp, 1.0);
    p = vec2(cos(r) * p.x + sin(r) * p.y, -sin(r) * p.x + cos(r) * p.y) * z; // Z Dist maior = afasta (imagem menor)
    vec2 q = u_c + p / vec2(u_asp, 1.0) - sh;
    vec4 s = S(q);
    vec3 w = specCol(t);
    acc += unpre(s).rgb * s.a * w; wsum += w; aacc += s.a; n += 1.0;
  }
  // White Balance ligado: região sem distorção fica com a cor original. Desligado: tingida pela soma das 3 cores
  // (com as cores padrão vermelho+verde+azul = branco, também fica igual ao original)
  vec3 o = acc / max(wsum, vec3(1e-4)) * (u_wb > 0.5 ? vec3(1.0) : u_csum) * u_bright;
  float a = aacc / max(n, 1.0);
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(min(clamp(o, 0.0, 1.0), vec3(a)), a); // pré-multiplicado
}`);


// ---------------------------------------------------------------- S_Glow (Sapphire › Lighting)
// Limiar pelo brilho → só as áreas claras espalham; larguras X/Y e por canal (vermelho, verde, azul) mudam a cor
// com a distância; Combine junta com a fonte. Atmosphere: ruído "empoeirado" no brilho.
const SG_TH = frag(`
uniform float u_thr; uniform vec3 u_tadd;
void main() {
  vec4 s = texture2D(u_tex, v_uv); vec3 c = unpre(s).rgb;
  float L = max(c.r, max(c.g, c.b));
  float th = u_thr + dot(max(1.0 - abs(c - u_tadd) * 3.0, 0.0), vec3(0.333)) * length(u_tadd) * 0.6; // Threshold Add Color
  float k = smoothstep(th, th + 0.08, L);
  gl_FragColor = vec4(c * k * s.a, s.a * k);
}`);
const SG_COMB = frag(`
uniform sampler2D u_r, u_g, u_b, u_r2, u_g2, u_b2;
uniform float u_bright, u_mode, u_under, u_srcop, u_atm, u_afreq, u_adet, u_aseed, u_aspeed, u_showth;
uniform vec3 u_col;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 g = vec3(texture2D(u_r, v_uv).r, texture2D(u_g, v_uv).g, texture2D(u_b, v_uv).b) * 0.65
         + vec3(texture2D(u_r2, v_uv).r, texture2D(u_g2, v_uv).g, texture2D(u_b2, v_uv).b) * 0.55;
  g *= u_col * u_bright;
  if (u_atm > 0.0) { vec2 c = contentUV(v_uv) * u_afreq * 6.0; float n = fbm(c + vec2(u_aseed * 13.0, u_time * u_aspeed * 0.2), 5); n = mix(n, fbm(c * 3.0 + u_aseed, 3), u_adet); g *= max(0.0, 1.0 + (n - 0.5) * 2.0 * u_atm); }
  vec3 src = s.rgb * u_srcop; float sa = s.a * u_srcop;
  vec3 o;
  if (u_mode < 1.5) o = src * (1.0 + g);                              // Mult
  else if (u_mode < 2.5) o = src + g;                                 // Add
  else if (u_mode < 3.5) o = 1.0 - (1.0 - src) * (1.0 - g);           // Screen
  else if (u_mode < 4.5) o = abs(src - g);                            // Difference
  else o = mix(2.0 * src * g, 1.0 - 2.0 * (1.0 - src) * (1.0 - g), step(0.5, src)); // Overlay
  if (u_under > 0.0) o = mix(o, src + g * (1.0 - sa), u_under);       // Glow Under Source
  float a = clamp(max(sa, max(g.r, max(g.g, g.b))), 0.0, 1.0);
  gl_FragColor = vec4(min(clamp(o, 0.0, 1.0), vec3(a)), a);
}`);

// ---------------------------------------------------------------- S_HueSatBright (Sapphire › Adjust)
const SHSB = frag(`
uniform float u_hue, u_pl, u_sat, u_bright, u_off; uniform vec3 u_cscale;
void main() {
  vec4 s = texture2D(u_tex, v_uv); vec3 c = unpre(s).rgb, o = c;
  float L0 = luma(c);
  // rotação de matiz no ciclo vermelho → verde → azul (em voltas), em torno do eixo cinza
  float a = u_hue * 6.2831853, ca = cos(a), sa = sin(a), k = 0.57735;
  vec3 ax = vec3(k);
  o = o * ca + cross(ax, o) * sa + ax * dot(ax, o) * (1.0 - ca);
  if (u_pl > 0.5) o += L0 - luma(o);
  o = mix(vec3(luma(o)), o, u_sat);
  o *= u_bright * u_cscale;
  o += u_off * (1.0 - clamp(o, 0.0, 1.0)) * 0.5; // Offset Darks: soma cinza nos escuros (negativo = mais contraste)
  gl_FragColor = pre(vec4(clamp(o, 0.0, 1.0), s.a));
}`);

// ---------------------------------------------------------------- S_Flicker (Sapphire › Time)
const SFLICK = frag(`uniform vec3 u_m; void main() { vec4 s = texture2D(u_tex, v_uv); vec3 c = unpre(s).rgb * u_m; gl_FragColor = pre(vec4(clamp(c, 0.0, 1.0), s.a)); }`);

const glowPx = (w, env) => (w > 4 ? w : w * env.h * 0.12) * env.scale; // Glow Width: número pequeno = fração do quadro; grande = px

export const SAPPHIRE_EXACT = [
  {
    type: 'sGlow', label: 'S_Glow', category: 'Luz e brilho', plugin: 'Sapphire S_Glow',
    description: 'Como o S_Glow do Sapphire: só o que passa do Threshold brilha; larguras por eixo e por cor (vermelho/verde/azul) e Combine.',
    params: [
      num('brightness', 'Brightness', 1, 0, 20, 0.01), col('color', 'Color', [1, 1, 1, 1]), num('threshold', 'Threshold', 0.5, 0, 1, 0.01), col('thAdd', 'Threshold Add Color', [0, 0, 0, 1]),
      num('width', 'Glow Width', 0.4, 0, 500, 0.01), num('wx', 'Width X', 1, 0, 5, 0.01), num('wy', 'Width Y', 1, 0, 5, 0.01),
      num('wr', 'Width Red', 1, 0, 5, 0.01), num('wg', 'Width Green', 1.2, 0, 5, 0.01), num('wb', 'Width Blue', 1.4, 0, 5, 0.01),
      sel('combine', 'Combine', ['Mult', 'Add', 'Screen', 'Difference', 'Overlay'], 3), num('under', 'Glow Under Source', 0, 0, 1, 0.01), num('srcOp', 'Source Opacity', 1, 0, 1, 0.01),
      num('atmAmp', 'Atmosphere Amp', 0, 0, 5, 0.01), num('atmFreq', 'Atmosphere Freq', 1, 0.1, 20, 0.01), num('atmDetail', 'Atmosphere Detail', 0.6, 0, 1, 0.01), num('atmSeed', 'Atmosphere Seed', 0.123, 0, 100, 0.001), num('atmSpeed', 'Atmosphere Speed', 1, -10, 10, 0.01),
    ],
    pad: (p) => Math.min(600, (p.width > 4 ? p.width : p.width * 230) * Math.max(p.wx, p.wy, p.wr, p.wg, p.wb) * 1.5),
    render: (src, p, env) => {
      const gl = env.gl;
      const th = gl.pass(SG_TH, { u_tex: src, u_thr: p.threshold, u_tadd: rgb(p.thAdd) });
      const base = glowPx(p.width, env);
      // Mesmo resultado com ~2,5× menos trabalho na GPU: desfoques iguais são feitos uma vez só, as reduções da
      // imagem limiarizada são compartilhadas, o desfoque X+Y sai numa pirâmide só (Width X = Width Y) e os
      // desfoques ficam na metade da resolução (o Combine os amplia com filtro bilinear — diferença ≤ 1–3/255).
      const memo = new Map(), pyr = [th];
      const bl = (k) => {
        const sx = base * k * p.wx, sy = base * k * p.wy, key = `${sx.toFixed(3)}|${sy.toFixed(3)}`;
        let t = memo.get(key);
        if (!t) {
          t = Math.abs(sx - sy) < 1e-6 ? gl.blur(th, sx, 1, true, pyr) : ((h) => gl.blur(h, sy * h.h / th.h, 3, true))(gl.blur(th, sx, 2, true, pyr));
          memo.set(key, t);
        }
        return t;
      };
      const r = bl(p.wr * 0.5), g = bl(p.wg * 0.5), b = bl(p.wb * 0.5), r2 = bl(p.wr * 1.4), g2 = bl(p.wg * 1.4), b2 = bl(p.wb * 1.4);
      return gl.pass(SG_COMB, { u_tex: src, u_r: r, u_g: g, u_b: b, u_r2: r2, u_g2: g2, u_b2: b2, u_bright: p.brightness, u_col: rgb(p.color), u_mode: p.combine, u_under: p.under, u_srcop: p.srcOp,
        u_atm: p.atmAmp, u_afreq: p.atmFreq, u_adet: p.atmDetail, u_aseed: p.atmSeed, u_aspeed: p.atmSpeed });
    },
  },
  {
    type: 'sHueSatBright', label: 'S_HueSatBright', category: 'Cor', plugin: 'Sapphire S_HueSatBright',
    description: 'Como o S_HueSatBright do Sapphire: gira a matiz (em voltas), satura, dá brilho, escala cada cor e desloca os escuros.',
    params: [num('hue', 'Hue Shift', 0, -1, 1, 0.001), bool('pl', 'Preserve Luma', false), num('sat', 'Saturation', 1, -2, 8, 0.01), num('bright', 'Brightness', 1, 0, 5, 0.01),
      col('scale', 'Scale Colors', [1, 1, 1, 1]), num('off', 'Offset Darks', 0, -8, 2, 0.01)],
    render: (src, p, env) => env.gl.pass(SHSB, { u_tex: src, u_hue: p.hue, u_pl: p.pl ? 1 : 0, u_sat: p.sat, u_bright: p.bright, u_cscale: rgb(p.scale), u_off: p.off }),
  },
  {
    type: 'sFlicker', label: 'S_Flicker', category: 'Luz e brilho', plugin: 'Sapphire S_Flicker',
    description: 'Como o S_Flicker do Sapphire: ganho por quadro = aleatório suave (brilho e por cor) + onda, por canal.',
    params: [num('amp', 'Amplitude', 0.2, 0, 5, 0.01), num('lumaAmp', 'Rand Luma Amp', 1, 0, 5, 0.01), num('colorAmp', 'Rand Color Amp', 0, 0, 5, 0.01), num('freq', 'Rand Freq', 30, 0, 120, 0.1),
      num('waveAmp', 'Wave Amp', 0, 0, 5, 0.01), num('waveFreq', 'Wave Freq', 5, 0, 60, 0.01), num('phR', 'Wave R Phase', 0, -10, 10, 0.01), num('phG', 'Wave G Phase', 0, -10, 10, 0.01), num('phB', 'Wave B Phase', 0, -10, 10, 0.01),
      num('ampR', 'Red Amp', 1, 0, 5, 0.01), num('ampG', 'Green Amp', 1, 0, 5, 0.01), num('ampB', 'Blue Amp', 1, 0, 5, 0.01), num('bright', 'Brightness', 1, 0, 5, 0.01), num('seed', 'Seed', 0.123, 0, 100, 0.001)],
    render: (src, p, env) => {
      const t = env.t, f = t * p.freq * 0.25, sd = p.seed * 97;
      const L = noise1(f, sd) * p.lumaAmp;
      const ch = (i, ph, a) => 1 + p.amp * a * (L + noise1(f, sd + 5 + i * 7) * p.colorAmp + p.waveAmp * Math.sin(2 * Math.PI * (t * p.waveFreq + ph)));
      const m = [ch(0, p.phR, p.ampR), ch(1, p.phG, p.ampG), ch(2, p.phB, p.ampB)].map((x) => Math.max(0, x) * p.bright);
      return env.gl.pass(SFLICK, { u_tex: src, u_m: m });
    },
  },
];

const asp = (env) => (env.rect ? (env.rect[2] * env.w) / Math.max(1, env.rect[3] * env.h) : 16 / 9);

export default [
  ...SAPPHIRE_EXACT,
  {
    type: 'sWarpChroma', label: 'S_WarpChroma', category: 'Distorção', plugin: 'Sapphire S_WarpChroma',
    description: 'Como o S_WarpChroma do Sapphire: cada cor do espectro recebe uma transformação entre From (Color1) e To (Color3). Warp Amount 0 = imagem intacta.',
    params: [
      num('steps', 'Steps', 15, 3, 100, 1), pos('center', 'Center XY', [0.5, 0.5]),
      num('fromZ', 'From Z Dist', 0.85, 0.001, 10, 0.001), ang('fromRot', 'From Rotate', 0), num('fromSX', 'From Shift X', 0, -2, 2, 0.001), num('fromSY', 'From Shift Y', 0, -2, 2, 0.001),
      num('toZ', 'To Z Dist', 1, 0.001, 10, 0.001), ang('toRot', 'To Rotate', 0), num('toSX', 'To Shift X', 0, -2, 2, 0.001), num('toSY', 'To Shift Y', 0, -2, 2, 0.001),
      num('warp', 'Warp Amount', 0.5, 0, 5, 0.001), num('bright', 'Brightness', 1, 0, 5, 0.01),
      col('c1', 'Color1', [1, 0, 0, 1]), col('c2', 'Color2', [0, 1, 0, 1]), col('c3', 'Color3', [0, 0, 1, 1]), bool('wb', 'White Balance', false),
      sel('wrapX', 'Wrap X', ['No', 'Tile', 'Reflect'], 1), sel('wrapY', 'Wrap Y', ['No', 'Tile', 'Reflect'], 1),
    ],
    pad: (p) => Math.min(400, Math.abs(1 - Math.min(p.fromZ, p.toZ)) * 300 * p.warp),
    render: (src, p, env) => env.gl.pass(WARPCHROMA, {
      u_tex: src, u_steps: Math.max(1, Math.round(p.steps)), u_c: p.center, u_fz: p.fromZ, u_frot: p.fromRot, u_fs: [p.fromSX, -p.fromSY], u_tz: p.toZ, u_trot: p.toRot, u_ts: [p.toSX, -p.toSY],
      u_amt: p.warp, u_bright: p.bright, u_c1: rgb(p.c1), u_c2: rgb(p.c2), u_c3: rgb(p.c3), u_csum: [0, 1, 2].map((i) => p.c1[i] + p.c2[i] + p.c3[i]), u_wb: p.wb ? 1 : 0, u_wx: p.wrapX, u_wy: p.wrapY, u_asp: asp(env),
    }),
  },
  {
    type: 'sTimeSlice', label: 'S_TimeSlice', category: 'Tempo', plugin: 'Sapphire S_TimeSlice',
    description: 'Como o S_TimeSlice do Sapphire: o quadro mostrado muda ao longo da Slice Direction, de −Slice Number/2 a +Slice Number/2 (+ Frame Offset), com o quadro atual no meio. Sem Interp Frames cada ponto usa o quadro inteiro mais próximo (faixas com borda); com Interp Frames mistura os dois quadros vizinhos pelo peso exato (passagem contínua, sem emendas).',
    params: [ang('direction', 'Slice Direction', 90), num('number', 'Slice Number', 12, 1, 500, 1), num('offset', 'Frame Offset', 0, -100, 100, 0.01), bool('interp', 'Interp Frames', false)],
    temporal: 'sTimeSlice',
  },
];
