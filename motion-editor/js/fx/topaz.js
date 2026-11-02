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

// "IA desenhado" (como os upscalers neurais): filtro Kuwahara de 4 setores — cada pixel vira a média do setor
// mais uniforme ao redor. Some com os pixels quadrados e o ruído, deixa áreas lisas "pintadas" e mantém as bordas.
const KUWAHARA = frag(`
uniform float u_r, u_amt;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 m[4]; vec3 s2[4]; float ws[4];
  for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s2[k] = vec3(0.0); ws[k] = 0.0; }
  vec2 st = u_texel * u_r / 3.0;
  for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j));
    float g = exp(-dot(o, o) / 8.0);          // amostras gaussianas (sem bordas duras de bloco)
    o *= st;
    vec3 a = texture2D(u_tex, v_uv + vec2(-o.x, -o.y)).rgb; m[0] += a * g; s2[0] += a * a * g; ws[0] += g;
    vec3 b = texture2D(u_tex, v_uv + vec2( o.x, -o.y)).rgb; m[1] += b * g; s2[1] += b * b * g; ws[1] += g;
    vec3 d = texture2D(u_tex, v_uv + vec2(-o.x,  o.y)).rgb; m[2] += d * g; s2[2] += d * d * g; ws[2] += g;
    vec3 e = texture2D(u_tex, v_uv + vec2( o.x,  o.y)).rgb; m[3] += e * g; s2[3] += e * e * g; ws[3] += g;
  }
  // Kuwahara generalizado: mistura os setores pesando pela uniformidade (1/variância^q) — liso e sem blocos
  vec3 acc = vec3(0.0); float wt = 0.0;
  for (int k = 0; k < 4; k++) {
    vec3 mu = m[k] / ws[k]; vec3 v = max(s2[k] / ws[k] - mu * mu, 0.0);
    float w = 1.0 / (1.0 + pow((v.r + v.g + v.b) * 255.0, 2.0));
    acc += mu * w; wt += w;
  }
  gl_FragColor = vec4(mix(c.rgb, acc / wt, u_amt), c.a);
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

// Upscale com reconstrução direcional (estilo EASU/Lanczos adaptativo às bordas): amostra a imagem na resolução
// ORIGINAL do vídeo e reconstrói em N× com o núcleo esticado ao longo das bordas (sem serrilhado nem borrão),
// com anti-ringing (limita aos vizinhos mais próximos).
const UPSCALE = frag(`
uniform vec2 u_nat; uniform float u_edge;
float lz(float x) { x = abs(x); if (x < 1e-4) return 1.0; if (x >= 2.0) return 0.0; float px = 3.14159265 * x; return 2.0 * sin(px) * sin(px * 0.5) / (px * px); }
void main() {
  vec2 pos = v_uv * u_nat - 0.5;
  vec2 b = floor(pos), f = pos - b;
  vec2 it = 1.0 / u_nat;
  // gradiente (estrutura da borda) no ponto, a partir de 4×4 vizinhos
  float l[16];
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) l[j * 4 + i] = luma(texture2D(u_tex, (b + vec2(float(i) - 0.5, float(j) - 0.5)) * it).rgb);
  float gx = (l[6] + l[10] - l[5] - l[9]) * 0.5 + (l[7] + l[11] - l[4] - l[8]) * 0.25;
  float gy = (l[9] + l[10] - l[5] - l[6]) * 0.5 + (l[13] + l[14] - l[1] - l[2]) * 0.25;
  vec2 g = vec2(gx, gy);
  float gl2 = length(g);
  vec2 dir = gl2 > 1e-5 ? g / gl2 : vec2(1.0, 0.0);
  float str = clamp(gl2 * 6.0, 0.0, 1.0) * u_edge;
  vec3 acc = vec3(0.0); float ws = 0.0; float aa = 0.0;
  vec3 mn = vec3(1e3), mx = vec3(-1e3);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i) - 1.0, float(j) - 1.0);
    vec2 d = o - f;
    // eixo across = direção do gradiente (mantém nitidez); along = ao longo da borda (núcleo mais longo, suaviza o serrilhado)
    vec2 r = vec2(dot(d, dir), dot(d, vec2(-dir.y, dir.x)) * (1.0 - 0.5 * str));
    float w = lz(r.x) * lz(r.y);
    vec4 c = texture2D(u_tex, (b + o + 0.5) * it);
    acc += c.rgb * w; aa += c.a * w; ws += w;
    if (o.x > -0.5 && o.x < 1.5 && o.y > -0.5 && o.y < 1.5) { mn = min(mn, c.rgb); mx = max(mx, c.rgb); }
  }
  vec3 o = acc / max(ws, 1e-4);
  o = clamp(o, mn, mx);
  gl_FragColor = vec4(o, clamp(aa / max(ws, 1e-4), 0.0, 1.0));
}`);

// ---- Proteus do Topaz 7 (calibrado com um print real: Fix compression 100, Improve detail 100, Sharpen 20…) ----
// 1) Fix compression: guided filter (alisa blocos e manchas sem criar "manchas pintadas" como o bilateral)
const SQ = frag(`void main() { vec4 c = texture2D(u_tex, v_uv); gl_FragColor = vec4(c.rgb * c.rgb, c.a); }`);
const GUIDE_A = frag(`
uniform sampler2D u_m2; uniform float u_eps, u_wantB;
void main() {
  vec3 m = texture2D(u_tex, v_uv).rgb, m2 = texture2D(u_m2, v_uv).rgb;
  vec3 v = max(m2 - m * m, 0.0), A = v / (v + u_eps);
  gl_FragColor = vec4(u_wantB > 0.5 ? m - A * m : A, 1.0);
}`);
const GUIDE_OUT = frag(`
uniform sampler2D u_a, u_b; uniform float u_amt;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 o = texture2D(u_a, v_uv).rgb * c.rgb + texture2D(u_b, v_uv).rgb;
  gl_FragColor = vec4(mix(c.rgb, clamp(o, 0.0, c.a), u_amt), c.a);
}`);
// 2) Improve detail / Sharpen / Dehalo: ganho por faixa de frequência (medido no Topaz: fino ×5, médio ×1,9, grosso ×1,2),
//    preso aos vizinhos ± halo (borda nítida sem auréola); 3) textura fina só onde já há textura (cabelo, barba, grama)
const BANDS = frag(`
uniform sampler2D u_b1, u_b2, u_b3; uniform vec3 u_g; uniform float u_halo, u_tex2, u_seed, u_px;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 b1 = texture2D(u_b1, v_uv).rgb, b2 = texture2D(u_b2, v_uv).rgb, b3 = texture2D(u_b3, v_uv).rgb;
  vec3 o = b3 + (b2 - b3) * u_g.x + (b1 - b2) * u_g.y + (c.rgb - b1) * u_g.z;
  vec3 mn = c.rgb, mx = c.rgb;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec3 q = texture2D(u_tex, v_uv + vec2(float(i), float(j)) * u_texel).rgb; mn = min(mn, q); mx = max(mx, q); }
  o = clamp(o, mn - u_halo, mx + u_halo);
  if (u_tex2 > 0.0) {
    float e = abs(luma(b1 - b3));
    float w = clamp((e - 0.012) / 0.03, 0.0, 1.0);
    vec2 pp = floor(v_uv / u_texel / max(1.0, u_px * 0.6));
    float n = (hash(pp + u_seed) + hash(pp * 1.31 + 7.0 + u_seed) - 1.0) * 1.7;
    o += n * w * u_tex2 * (0.4 + luma(o));
  }
  gl_FragColor = vec4(clamp(o, 0.0, c.a), c.a);
}`);

/** Valores "automáticos" de cada modelo (como os presets da Topaz). Proteus = manual. */
export const TOPAZ_MODELS = [
  ['Proteus (manual)', null],
  ['Artemis – ruído e compressão', { upscale: 2,  revertCompression: 60, recoverDetails: 45, sharpen: 40, reduceNoise: 40, dehalo: 35, antialiasDeblur: 35, aiSmooth: 55, recoverOriginal: 0, addNoise: 0 }],
  // Iris calibrado com um print real do Topaz 7 (Fix compression 100, Improve detail 100, Sharpen 20, Reduce noise 10, Dehalo 6, Anti-alias −40, Recover detail 20)
  ['Iris – rostos e pele', { upscale: 2, revertCompression: 100, recoverDetails: 100, sharpen: 20, reduceNoise: 10, dehalo: 6, antialiasDeblur: -40, aiSmooth: 0, recoverOriginal: 20, addNoise: 0 }],
  ['Gaia – fonte boa / alta qualidade', { upscale: 2,  revertCompression: 25, recoverDetails: 60, sharpen: 40, reduceNoise: 15, dehalo: 40, antialiasDeblur: 35, aiSmooth: 35, recoverOriginal: 0, addNoise: 0 }],
  ['Nyx – só remover ruído', { revertCompression: 30, recoverDetails: 15, sharpen: 10, reduceNoise: 75, dehalo: 20, antialiasDeblur: 5, aiSmooth: 60, recoverOriginal: 0, addNoise: 0 }],
  ['Rhea – detalhe máximo (4×)', { upscale: 3,  revertCompression: 50, recoverDetails: 80, sharpen: 55, reduceNoise: 30, dehalo: 55, antialiasDeblur: 55, aiSmooth: 70, recoverOriginal: 0, addNoise: 2 }],
];
export const TOPAZ_KEYS = ['revertCompression', 'recoverDetails', 'sharpen', 'reduceNoise', 'dehalo', 'antialiasDeblur', 'aiSmooth', 'recoverOriginal', 'addNoise'];

export default [
  {
    type: 'topaz', label: 'Aprimorar vídeo (estilo Topaz Video AI)', category: 'Cor', plugin: 'Topaz Video AI (Proteus / Artemis / Iris / Gaia / Nyx / Rhea)',
    description: 'Mesmos controles do Proteus manual da Topaz: tira blocos de compressão e ruído, recupera detalhes e nitidez sem halo — ótimo para clipes baixados do TikTok/Instagram ampliados para 1080p. Escolha um modelo (valores automáticos) ou Proteus para ajustar tudo. Recriação com algoritmos na GPU (não as redes neurais da Topaz).',
    params: [
      sel('model', 'Modelo', TOPAZ_MODELS.map(([n]) => n), 2),
      sel('upscale', 'Upscale (reconstruir a partir do vídeo original)', ['Desligado', '2×', '4×', '8×'], 2), num('edgeAware', 'Upscale – seguir bordas %', 80, 0, 100),
      num('revertCompression', 'Fix compression', 55, 0, 100), num('recoverDetails', 'Improve detail', 30, 0, 100),
      num('sharpen', 'Sharpen (nitidez)', 25, 0, 100), num('reduceNoise', 'Reduce Noise (ruído)', 40, 0, 100),
      num('dehalo', 'Dehalo', 30, 0, 100), num('antialiasDeblur', 'Anti-alias / deblur (− suaviza, + desfoque)', 20, -100, 100),
      num('aiSmooth', 'Suavização IA (visual “desenhado”, sem pixels quadrados)', 55, 0, 100),
      num('recoverOriginal', 'Recover detail (misturar original)', 0, 0, 100), num('addNoise', 'Add noise (grão)', 0, 0, 100), sel('focusFix', 'Focus fix', ['Off', 'Normal', 'Strong'], 1), num('grainSize', 'Tamanho do grão', 1.5, 1, 6, 0.1),
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
      // Upscale: volta à grade de pixels do vídeo original e reconstrói N× com o filtro direcional
      const up = [0, 1, 2, 4, 8][(p.upscale || (m && m.upscale) || 1)] || 0;
      if (up >= 2 && pxs > 1.15) {
        const nw = Math.max(8, Math.round(src.w / pxs)), nh = Math.max(8, Math.round(src.h / pxs));
        let nat = gl.copy(src, nw, nh);
        if (pxs > 2.2) nat = gl.copy(gl.blur(src, pxs * 0.22), nw, nh); // anti-alias ao voltar para a grade original
        const tw = Math.min(nw * up, src.w * 2), th = Math.min(nh * up, src.h * 2);
        const big = gl.pass(UPSCALE, { u_tex: nat, u_nat: [nw, nh], u_edge: (p.edgeAware ?? 80) / 100 }, tw, th);
        out = tw === src.w && th === src.h ? big : gl.copy(big, src.w, src.h);
      }
      const rc = v('revertCompression'), rn = v('reduceNoise');
      // Fix compression: guided filter (raio acompanha o pixel do vídeo original)
      if (rc > 0.01) {
        const sg = 1.6 * pxs;
        const m = gl.blur(out, sg), m2 = gl.blur(gl.pass(SQ, { u_tex: out }), sg);
        const eps = 0.0009 * (0.5 + rc);
        const A = gl.blur(gl.pass(GUIDE_A, { u_tex: m, u_m2: m2, u_eps: eps, u_wantB: 0 }), sg);
        const B = gl.blur(gl.pass(GUIDE_A, { u_tex: m, u_m2: m2, u_eps: eps, u_wantB: 1 }), sg);
        out = gl.pass(GUIDE_OUT, { u_tex: out, u_a: A, u_b: B, u_amt: Math.min(1, rc) });
      }
      if (rn > 0.01) out = gl.pass(BILAT, { u_tex: out, u_rad: 3 * pxs, u_sigR: 0.05 + rn * 0.12, u_amt: Math.min(1, rn * 1.1), u_flat: 0.3 });
      // suavização "IA" antiga (opcional): Kuwahara
      const ai = (m ? m.aiSmooth : p.aiSmooth ?? 0) / 100;
      if (ai > 0.01) {
        out = gl.pass(KUWAHARA, { u_tex: out, u_r: 1.2 * pxs, u_amt: Math.min(1, ai * 1.2) });
        out = gl.pass(KUWAHARA, { u_tex: out, u_r: 2.0 * pxs, u_amt: ai * 0.6 });
      }
      const det = v('recoverDetails'), sh = v('sharpen'), aa = Math.max(-1, Math.min(1, v('antialiasDeblur'))), dh = v('dehalo');
      // Anti-alias (negativo): suaviza serrilhado antes de realçar
      if (aa < -0.01) out = gl.mix(out, gl.blur(out, 0.45 * pxs), -aa * 0.6);
      const ff = [0, 0, 0.15, 0.3][(p.focusFix | 0) || 1] || 0;
      if (det + sh + Math.max(0, aa) + ff > 0.01) {
        const g = [1 + 0.06 * det + Math.max(0, aa) * 0.35 + ff, 1 + 1.9 * det + 0.8 * sh + ff * 0.5, 1 + 2.1 * det + 0.3 * sh];
        const halo = 0.003 + 0.01 * (1 - dh);
        const iters = det > 0.5 ? 2 : 1;
        for (let it = 0; it < iters; it++) {
          const gi = iters === 2 ? g.map((x) => 1 + (x - 1) * 0.72) : g;
          const b1 = gl.blur(out, 0.875 * pxs), b2 = gl.blur(out, 1.75 * pxs), b3 = gl.blur(out, 3.5 * pxs);
          out = gl.pass(BANDS, { u_tex: out, u_b1: b1, u_b2: b2, u_b3: b3, u_g: gi, u_halo: halo, u_tex2: it === iters - 1 ? 0.08 * det : 0, u_seed: Math.floor(env.t * 30) % 61, u_px: pxs });
        }
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
