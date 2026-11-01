// Recriação no estilo Topaz Video AI (algoritmos clássicos na GPU, não as redes neurais da Topaz):
// - "Aprimorar" (modelos Proteus/Artemis/Iris/Gaia/Nyx/Rhea) com os mesmos controles do Proteus manual:
//   Revert Compression, Recover Details, Sharpen, Reduce Noise, Dehalo, Anti-alias/Deblur, Recover Original Detail, Add Noise.
// - "Estabilizar" (correção de câmera calculada pela análise do vídeo, modo Auto-crop ou Full frame).
import { frag, num, sel, rad, cuv } from './common.js';

// redução de ruído / compressão: bilateral (preserva bordas) — o raio acompanha o tamanho do pixel original do vídeo
const BILAT = frag(`
uniform float u_rad, u_sigR, u_amt, u_flat;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 s = texture2D(u_tex, v_uv + o * u_texel * u_rad / 3.0).rgb;
    vec3 d = s - c.rgb;
    float w = exp(-dot(o, o) / 9.0) * exp(-dot(d, d) / (u_sigR * u_sigR + 1e-5));
    acc += s * w; ws += w;
  }
  vec3 sm = acc / ws;
  // "revert compression" atua mais nas áreas lisas (onde aparecem blocos e banding)
  float detail = length(c.rgb - sm) * 6.0;
  float k = u_amt * mix(1.0, 1.0 - smoothstep(0.05, 0.6, detail), u_flat);
  gl_FragColor = vec4(mix(c.rgb, sm, k), c.a);
}`);

// detalhe + nitidez: CAS (sharpen adaptativo ao contraste) + realce de alta frequência em 2 escalas, com dehalo
const DETAIL = frag(`
uniform sampler2D u_b1, u_b2; uniform float u_det, u_sharp, u_deblur, u_dehalo, u_px;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec2 t = u_texel * u_px;
  vec3 n = texture2D(u_tex, v_uv + vec2(0.0, -t.y)).rgb, s = texture2D(u_tex, v_uv + vec2(0.0, t.y)).rgb;
  vec3 e = texture2D(u_tex, v_uv + vec2(t.x, 0.0)).rgb, w = texture2D(u_tex, v_uv + vec2(-t.x, 0.0)).rgb;
  vec3 mn = min(c.rgb, min(min(n, s), min(e, w))), mx = max(c.rgb, max(max(n, s), max(e, w)));
  // CAS: amplitude adaptativa (menos nitidez onde já há muito contraste → sem serrilhado)
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 wgt = -amp * mix(0.0, 0.2, u_sharp);
  vec3 cas = (c.rgb + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
  // recuperar detalhes (média frequência) e anti-alias/deblur (baixa frequência, como uma deconvolução suave)
  vec3 b1 = texture2D(u_b1, v_uv).rgb, b2 = texture2D(u_b2, v_uv).rgb;
  vec3 o = cas + (c.rgb - b1) * u_det * 1.4 + (b1 - b2) * u_deblur * 1.1;
  // dehalo: não deixa o realce passar dos vizinhos (halos claros/escuros nas bordas)
  vec3 lo = mn - (1.0 - u_dehalo) * 0.08, hi = mx + (1.0 - u_dehalo) * 0.08;
  o = mix(o, clamp(o, lo, hi), u_dehalo);
  gl_FragColor = vec4(clamp(o, 0.0, c.a), c.a);
}`);

const GRAIN = frag(`
uniform float u_amt, u_gsize, u_seed; uniform sampler2D u_orig; uniform float u_orig_mix;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec2 p = floor(v_uv / (u_texel * max(u_gsize, 1.0)));
  float g = (hash(p + u_seed) + hash(p * 1.37 + u_seed * 0.71) - 1.0);
  float l = luma(c.rgb);
  vec3 o = c.rgb + g * u_amt * (0.35 + 0.65 * (1.0 - abs(l - 0.5) * 2.0)) * c.a;
  o = mix(o, texture2D(u_orig, v_uv).rgb, u_orig_mix);
  gl_FragColor = vec4(clamp(o, 0.0, c.a), c.a);
}`);

// estabilização: desloca/gira/aproxima a imagem; Full frame espelha as bordas, Auto-crop aproxima
const STAB = frag(`
uniform vec2 u_c, u_sh; uniform float u_r, u_s, u_full;
void main() {
  vec2 px = (v_uv - u_c) * u_size - u_sh * u_rect.zw * u_size;
  px = mat2(cos(u_r), -sin(u_r), sin(u_r), cos(u_r)) * px / u_s;
  vec2 cu = contentUV(u_c + px / u_size);
  if (u_full > 0.5) { vec2 m = mod(cu, 2.0); cu = vec2(m.x > 1.0 ? 2.0 - m.x : m.x, m.y > 1.0 ? 2.0 - m.y : m.y); }
  else if (cu.x < 0.0 || cu.y < 0.0 || cu.x > 1.0 || cu.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec2 e = u_texel / u_rect.zw * 0.75;
  gl_FragColor = texture2D(u_tex, fromContent(clamp(cu, e, 1.0 - e)));
}`);

/** Valores "automáticos" de cada modelo (como os presets da Topaz). Proteus = manual. */
export const TOPAZ_MODELS = [
  ['Proteus (manual)', null],
  ['Artemis – ruído e compressão', { revertCompression: 55, recoverDetails: 30, sharpen: 25, reduceNoise: 40, dehalo: 30, antialiasDeblur: 20, recoverOriginal: 0, addNoise: 0 }],
  ['Iris – rostos e pele', { revertCompression: 45, recoverDetails: 40, sharpen: 30, reduceNoise: 35, dehalo: 45, antialiasDeblur: 25, recoverOriginal: 10, addNoise: 2 }],
  ['Gaia – fonte boa / alta qualidade', { revertCompression: 15, recoverDetails: 55, sharpen: 35, reduceNoise: 10, dehalo: 40, antialiasDeblur: 30, recoverOriginal: 0, addNoise: 0 }],
  ['Nyx – só remover ruído', { revertCompression: 20, recoverDetails: 10, sharpen: 5, reduceNoise: 75, dehalo: 20, antialiasDeblur: 0, recoverOriginal: 0, addNoise: 0 }],
  ['Rhea – detalhe máximo (4×)', { revertCompression: 40, recoverDetails: 75, sharpen: 45, reduceNoise: 25, dehalo: 55, antialiasDeblur: 45, recoverOriginal: 0, addNoise: 3 }],
];
export const TOPAZ_KEYS = ['revertCompression', 'recoverDetails', 'sharpen', 'reduceNoise', 'dehalo', 'antialiasDeblur', 'recoverOriginal', 'addNoise'];

export default [
  {
    type: 'topaz', label: 'Aprimorar vídeo (estilo Topaz Video AI)', category: 'Cor', plugin: 'Topaz Video AI (Proteus / Artemis / Iris / Gaia / Nyx / Rhea)',
    description: 'Mesmos controles do Proteus manual da Topaz: tira blocos de compressão e ruído, recupera detalhes e nitidez sem halo — ótimo para clipes baixados do TikTok/Instagram ampliados para 1080p. Escolha um modelo (valores automáticos) ou Proteus para ajustar tudo. Recriação com algoritmos na GPU (não as redes neurais da Topaz).',
    params: [
      sel('model', 'Modelo', TOPAZ_MODELS.map(([n]) => n), 2),
      num('revertCompression', 'Revert Compression (tirar blocos)', 55, 0, 100), num('recoverDetails', 'Recover Details (detalhes)', 30, 0, 100),
      num('sharpen', 'Sharpen (nitidez)', 25, 0, 100), num('reduceNoise', 'Reduce Noise (ruído)', 40, 0, 100),
      num('dehalo', 'Dehalo (tirar halos)', 30, 0, 100), num('antialiasDeblur', 'Anti-alias / Deblur', 20, 0, 100),
      num('recoverOriginal', 'Recover Original Detail (misturar original)', 0, 0, 100), num('addNoise', 'Add Noise (grão)', 0, 0, 100), num('grainSize', 'Tamanho do grão', 1.5, 1, 6, 0.1),
      num('sourceScale', 'Escala da fonte (0 = automático)', 0, 0, 8, 0.1),
    ],
    render: (src, p, env) => {
      const { gl } = env;
      const m = TOPAZ_MODELS[(p.model || 1) - 1]?.[1];
      const v = (k) => (m ? m[k] : p[k]) / 100;
      // tamanho de um pixel do vídeo original na tela (vídeo 576 px esticado para 1440 = 2,5 px)
      const auto = env.srcW ? env.w / env.srcW : 1.5;
      const pxs = Math.max(1, (p.sourceScale > 0 ? p.sourceScale : auto)) * env.scale;
      let out = src;
      const rc = v('revertCompression'), rn = v('reduceNoise');
      if (rc > 0.01) out = gl.pass(BILAT, { u_tex: out, u_rad: 2.2 * pxs, u_sigR: 0.06 + rc * 0.06, u_amt: Math.min(1, rc * 1.2), u_flat: 0.85 });
      if (rn > 0.01) out = gl.pass(BILAT, { u_tex: out, u_rad: 3 * pxs, u_sigR: 0.05 + rn * 0.12, u_amt: Math.min(1, rn * 1.1), u_flat: 0.3 });
      const det = v('recoverDetails'), sh = v('sharpen'), db = v('antialiasDeblur');
      if (det + sh + db > 0.01) {
        const b1 = gl.blur(out, 0.9 * pxs), b2 = gl.blur(out, 2.4 * pxs);
        out = gl.pass(DETAIL, { u_tex: out, u_b1: b1, u_b2: b2, u_det: det, u_sharp: sh, u_deblur: db, u_dehalo: v('dehalo'), u_px: Math.max(1, pxs * 0.6) });
      }
      const gr = v('addNoise'), ro = v('recoverOriginal');
      if (gr > 0.001 || ro > 0.001) out = gl.pass(GRAIN, { u_tex: out, u_orig: src, u_orig_mix: ro * 0.8, u_amt: gr * 0.18, u_gsize: (p.grainSize || 1.5) * env.scale, u_seed: Math.floor(env.t * 30) % 97 });
      return out;
    },
  },
  {
    type: 'stabilize', label: 'Estabilizar (estilo Topaz)', category: 'Movimento', plugin: 'Topaz Video AI Stabilization / Warp Stabilizer',
    description: 'Correção de câmera tremida. Use o botão “Topaz” › Estabilizar para analisar o vídeo: os valores de correção viram keyframes aqui. Auto-crop aproxima para esconder as bordas; Full frame espelha as bordas e mantém o quadro inteiro.',
    params: [
      num('dx', 'Correção X (px)', 0, -4000, 4000, 0.1), num('dy', 'Correção Y (px)', 0, -4000, 4000, 0.1), num('rot', 'Correção de rotação (°)', 0, -45, 45, 0.01),
      sel('mode', 'Modo', ['Auto-crop (aproxima)', 'Full frame (espelha bordas)'], 1), num('zoom', 'Zoom do auto-crop %', 100, 100, 200, 0.1),
    ],
    render: (src, p, env) => {
      if (Math.abs(p.dx) < 0.01 && Math.abs(p.dy) < 0.01 && Math.abs(p.rot) < 0.001 && p.zoom <= 100.01) return src;
      return env.gl.pass(STAB, { u_tex: src, u_c: cuv(env, [0.5, 0.5]), u_sh: [p.dx / env.w, p.dy / env.h], u_r: rad(-p.rot), u_s: p.mode === 2 ? 1 : p.zoom / 100, u_full: p.mode === 2 });
    },
  },
];
