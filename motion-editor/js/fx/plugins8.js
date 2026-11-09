// Efeitos com os MESMOS controles do plugin original (documentação oficial da Boris FX / Sapphire para AE):
//  • S_WarpChroma — separa a imagem em faixas do espectro; o vermelho recebe a transformação "From", o azul a "To"
//    e as outras cores ficam no meio (Steps amostras). Warp Amount escala as duas transformações (0 = imagem intacta).
//  • S_TimeSlice — fatias orientadas por Slice Direction; cada fatia mostra um quadro relativo entre −N/2 e +N/2
//    (+ Frame Offset). Interp Frames liga a mistura entre os dois quadros inteiros mais próximos.
import { frag, num, ang, col, bool, sel, pos, rgb, rad } from './common.js';

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

const asp = (env) => (env.rect ? (env.rect[2] * env.w) / Math.max(1, env.rect[3] * env.h) : 16 / 9);

export default [
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
    description: 'Como o S_TimeSlice do Sapphire: a camada vira fatias na direção escolhida e cada fatia mostra um quadro diferente (de −metade a +metade do número de fatias, mais o Frame Offset). Interp Frames suaviza misturando os quadros vizinhos.',
    params: [ang('direction', 'Slice Direction', 90), num('number', 'Slice Number', 12, 1, 500, 1), num('offset', 'Frame Offset', 0, -100, 100, 0.01), bool('interp', 'Interp Frames', false)],
    temporal: 'sTimeSlice',
  },
];
