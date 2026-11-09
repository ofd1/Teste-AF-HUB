// Continuum (BCC) com os controles da documentação oficial da Boris FX (borisfx.com/documentation/continuum/…)
// e os índices/valores gravados nos .ffx do usuário. Todos têm "Mix with Original" (como no BCC).
//  • BCC Directional Blur — Blur Amount, Angle (0 = direita), Thin, Spread, Blur Threshold, Maximum Deviation,
//    Displace Pixels, Apply Mode/Apply Mix, Mix with Original.
//  • BCC Lens Blur — Iris Scale, Iris Shape (círculo ou 3–16 lâminas), Curvature, Rotation, Scale X/Y, Gamma,
//    Highlight Boost/Threshold, Boost Mode, Mix.
//  • BCC Unsharp Mask — Radius, Amount, Threshold (0–255: mudanças menores que isso não acontecem), Output Channels,
//    Reduce Flicker (1-2-1, 2-3-2, 1-1-1), Mix.
//  • BCC Magic Sharp — 4 passes (Fine/Small/Medium/Coarse, cada um ~2× o anterior), Sharpen Amount/Threshold/Radius,
//    Noise Suppression, canais (Luma/Chroma/R/G/B) e faixas (Highlight/Midtone/Shadow), Mix.
//  • BCC Glow (BCC+ Glow) — Blend Add/Screen, Brightness, Blur X/Y, Color, Matte Position/Range/Blur, Glow Under Source, Mix.
//  • BCC Blur — Horizontal/Vertical Blur, Lock Blur, Channels, Mix.
//  • BCC Temporal Blur — média de quadros: Amount (Frames), Frame Separation, Frame Offset, Blur Direction, Blur Shape, Mix.
import { frag, num, ang, col, bool, sel, rgb, rad } from './common.js';

// modos de aplicação do BCC (os mais usados; índices iguais ao popup "Apply Mode")
const APPLY = `
vec3 bccApply(vec3 s, vec3 e, float m) {
  if (m < 1.5) return e;                                   // Normal
  if (m < 2.5) return max(s, e);                           // Lighten
  if (m < 3.5) return min(s, e);                           // Darken
  if (m < 4.5) return s * e;                               // Multiply
  if (m < 5.5) return 1.0 - (1.0 - s) * (1.0 - e);         // Screen
  if (m < 6.5) return abs(s - e);                          // Difference
  if (m < 12.5) return e;
  if (m < 13.5) return s + e;                              // Add
  if (m < 14.5) return s - e;                              // Subtract
  if (m < 15.5) return mix(2.0 * s * e, 1.0 - 2.0 * (1.0 - s) * (1.0 - e), step(0.5, s)); // Overlay
  return e;
}`;

const DIRBLUR = frag(`${APPLY}
uniform vec2 u_vec, u_shift; uniform float u_n, u_spread, u_thr, u_dev, u_mode, u_amix, u_mix;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec4 a = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= u_n) break;
    float f = u_n > 1.0 ? float(i) / (u_n - 1.0) - 0.5 : 0.0;
    float w = 1.0 + u_spread * abs(f) * 4.0;                // Spread: pontos mais longe pesam mais
    a += samp(v_uv + u_shift + u_vec * f) * w; ws += w;
  }
  a /= max(ws, 1e-4);
  vec4 su = unpre(s), au = unpre(a);
  // Blur Threshold: diferença menor que o limiar mantém a fonte; maior é reduzida pelo limiar. Maximum Deviation limita a mudança.
  vec3 d = au.rgb - su.rgb;
  vec3 dd = sign(d) * max(abs(d) - u_thr, 0.0);
  dd = clamp(dd, -u_dev, u_dev);
  vec3 e = su.rgb + dd;
  vec3 o = mix(su.rgb, bccApply(su.rgb, e, u_mode), u_amix);
  float oa = mix(s.a, a.a, u_amix);
  vec4 r = pre(vec4(clamp(o, 0.0, 1.0), oa));
  gl_FragColor = mix(r, s, u_mix);
}`);

const LENSBLUR = frag(`
uniform float u_r, u_sides, u_curv, u_rot, u_boost, u_hthr, u_gamma, u_bmode, u_mix; uniform vec2 u_sxy;
float inIris(vec2 p) { // 1 dentro da íris (polígono de N lâminas arredondado pela curvatura)
  float r = length(p);
  if (u_sides < 2.5) return step(r, 1.0);
  float a = atan(p.y, p.x) - u_rot, seg = 2.0 * PI / u_sides;
  float poly = cos(PI / u_sides) / cos(mod(a, seg) - seg * 0.5);
  float lim = mix(poly, 1.0, clamp(u_curv, 0.0, 1.0));
  if (u_curv < 0.0) lim = poly * (1.0 + u_curv * 0.3);
  return step(r, lim);
}
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 96; i++) {
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / 96.0);
    float th = fi * 2.39996323;
    vec2 p = vec2(cos(th), sin(th)) * rr;
    if (inIris(p) < 0.5) continue;
    vec4 c = texture2D(u_tex, v_uv + p * u_sxy * u_r * u_texel);
    vec3 cu = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    float l = u_bmode > 2.5 ? luma(cu) : max(cu.r, max(cu.g, cu.b));
    // Highlight Boost: realces acima do Highlight Threshold ficam mais fortes (viram bolinhas de bokeh)
    float w = 1.0 + u_boost * smoothstep(u_hthr, 1.0, l) * 8.0;
    vec3 v = pow(max(cu, 0.0), vec3(u_gamma));
    if (u_bmode > 1.5 && u_bmode < 2.5) v = mix(vec3(luma(v)), v, 1.25);   // RGB Glow: realça saturação
    if (u_bmode > 2.5 && u_bmode < 3.5) v = mix(v, vec3(1.0), smoothstep(u_hthr, 1.0, l) * u_boost); // Luma Boost to White
    acc += vec4(v * c.a, c.a) * w; ws += w;
  }
  acc /= max(ws, 1e-4);
  vec3 o = acc.a > 0.0 ? pow(acc.rgb / acc.a, vec3(1.0 / u_gamma)) * acc.a : vec3(0.0);
  gl_FragColor = mix(fixpre(vec4(o, acc.a)), s, u_mix);
}`);

const UNSHARP = frag(`
uniform sampler2D u_tex2; uniform float u_amt, u_thr, u_mix, u_ch;
void main() {
  vec4 s = texture2D(u_tex, v_uv), b = texture2D(u_tex2, v_uv);
  vec4 su = unpre(s), bu = unpre(b);
  vec4 d = (su - bu) * u_amt;
  // Threshold: pixels cuja mudança seria menor que o limiar não mudam
  vec4 o = su + d * step(u_thr, abs(d));
  vec4 r = su;
  if (u_ch < 1.5) r = o;                          // RGBA
  else if (u_ch < 2.5) r.rgb = o.rgb;             // RGB
  else if (u_ch < 3.5) r.a = o.a;                 // Alpha
  else if (u_ch < 4.5) r.r = o.r; else if (u_ch < 5.5) r.g = o.g; else if (u_ch < 6.5) r.b = o.b;
  else if (u_ch < 7.5) r.rg = o.rg; else if (u_ch < 8.5) r.rb = o.rb; else r.gb = o.gb;
  gl_FragColor = mix(pre(clamp(r, 0.0, 1.0)), s, u_mix);
}`);

const FLICKER = frag(`
uniform vec3 u_w;
void main() { // Reduce Flicker: média vertical ponderada (como o Reduce Flicker do AE)
  vec2 e = vec2(0.0, u_texel.y);
  gl_FragColor = (texture2D(u_tex, v_uv - e) * u_w.x + texture2D(u_tex, v_uv) * u_w.y + texture2D(u_tex, v_uv + e) * u_w.z) / (u_w.x + u_w.y + u_w.z);
}`);

const MAGIC = frag(`
uniform sampler2D u_b1, u_b2, u_b3, u_b4;
uniform vec4 u_pass; uniform float u_amt, u_thr, u_noise, u_luma, u_chroma, u_mix; uniform vec3 u_rgbS, u_rng, u_rngS; uniform float u_hr, u_mhr, u_mlr, u_sr, u_rangeOn;
vec3 U(sampler2D t) { vec4 c = texture2D(t, v_uv); return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
vec3 band(vec3 d) {
  // Noise Suppression: tira a nitidez de detalhes muito pequenos; Sharpen Threshold: menos nitidez em bordas já fortes
  float m = length(d);
  float k = smoothstep(u_noise * 0.01, u_noise * 0.03 + 1e-4, m);
  float lim = 1.0 / (1.0 + max(0.0, m - u_thr * 0.01) * 12.0);
  return d * k * lim;
}
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 b1 = U(u_b1), b2 = U(u_b2), b3 = U(u_b3), b4 = U(u_b4);
  vec3 d = band(c - b1) * u_pass.x + band(b1 - b2) * u_pass.y + band(b2 - b3) * u_pass.z + band(b3 - b4) * u_pass.w;
  // canais: luma / croma e R, G, B
  float dl = luma(d);
  d = vec3(dl) * u_luma + (d - vec3(dl)) * u_chroma;
  d *= u_rgbS;
  // faixas: Highlight / Midtone / Shadow (entre níveis vizinhos o pixel pertence aos dois proporcionalmente)
  float l = luma(c), g = 1.0;
  if (u_rangeOn > 0.5) {
    float sh = 1.0 - smoothstep(u_sr, u_mlr, l), hi = smoothstep(u_mhr, u_hr, l), mid = clamp(1.0 - sh - hi, 0.0, 1.0);
    g = sh * u_rngS.z + mid * u_rngS.y + hi * u_rngS.x;
  }
  vec3 o = c + d * u_amt * g;
  gl_FragColor = mix(pre(vec4(clamp(o, 0.0, 1.0), s.a)), s, u_mix);
}`);

const GLOW_TH = frag(`
uniform float u_pos, u_rng;
void main() { // matte do glow: Position = nível de brilho, Range = largura da faixa
  vec4 c = texture2D(u_tex, v_uv); vec3 u = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float l = luma(u);
  float k = smoothstep(u_pos - u_rng * 0.5, u_pos + u_rng * 0.5, l);
  gl_FragColor = vec4(u * k * c.a, c.a * k);
}`);
const GLOW_COMB = frag(`
uniform sampler2D u_tex2; uniform float u_bright, u_screen, u_under, u_mix; uniform vec3 u_col;
void main() {
  vec4 s = texture2D(u_tex, v_uv), g = texture2D(u_tex2, v_uv);
  vec3 gc = g.rgb * u_col * u_bright;
  vec3 o = u_screen > 0.5 ? s.rgb + gc - s.rgb * clamp(gc, 0.0, 1.0) : s.rgb + gc;
  if (u_under > 0.5) o = s.rgb + gc * (1.0 - s.a);           // Glow Under Source: o glow só aparece atrás
  vec4 r = fixpre(vec4(o, max(s.a, clamp(g.a * u_bright, 0.0, 1.0))));
  gl_FragColor = mix(r, s, u_mix);
}`);

const MIXCH = frag(`
uniform sampler2D u_tex2; uniform float u_mix, u_ch;
void main() {
  vec4 s = texture2D(u_tex, v_uv), b = texture2D(u_tex2, v_uv), r = s;
  if (u_ch < 1.5) r = b; else if (u_ch < 2.5) r = vec4(b.rgb, s.a); else if (u_ch < 3.5) r = vec4(s.rgb, b.a);
  else if (u_ch < 4.5) r.r = b.r; else if (u_ch < 5.5) r.g = b.g; else if (u_ch < 6.5) r.b = b.b;
  else if (u_ch < 7.5) r.rg = b.rg; else if (u_ch < 8.5) r.rb = b.rb; else r.gb = b.gb;
  gl_FragColor = mix(r, s, u_mix);
}`);

const CHANNELS = ['RGBA', 'RGB', 'Alpha', 'Red', 'Green', 'Blue', 'Red and Green', 'Red and Blue', 'Green and Blue'];
const APPLY_MODES = ['Normal', 'Lighten', 'Darken', 'Multiply', 'Screen', 'Difference', 'Lighter', 'Darker', 'Scale Multiply', 'Scale Screen', 'Difference X 2', 'Difference X 4', 'Add', 'Subtract', 'Overlay'];
const mixP = () => num('mix', 'Mix with Original', 0, 0, 100);

export default [
  {
    type: 'bccDirBlur', label: 'BCC Directional Blur', category: 'Desfoque', plugin: 'BCC Directional Blur',
    description: 'Como no BCC: desfoque numa direção (Angle 0 = direita). Thin usa menos pontos (visão dupla), Spread dá mais peso aos pontos longe, Blur Threshold preserva detalhes sutis, Displace Pixels também desloca a imagem.',
    params: [num('amount', 'Blur Amount', 20, 0, 1000, 0.1), ang('angle', 'Angle', 0), num('thin', 'Thin', 0, 0, 100), num('spread', 'Spread', 0, 0, 100),
      num('threshold', 'Blur Threshold', 0, 0, 255), num('maxDev', 'Maximum Deviation', 255, 0, 255), bool('displace', 'Displace Pixels', false),
      sel('applyMode', 'Apply Mode', APPLY_MODES, 1), num('applyMix', 'Apply Mix', 100, 0, 100), sel('channels', 'Channels', CHANNELS, 1), mixP()],
    pad: (p) => p.amount * (p.displace ? 2 : 1.1),
    render: (src, p, env) => {
      if (p.amount <= 0 && !p.displace) return src;
      const a = rad(p.angle), L = p.amount * env.scale; // Blur Amount = comprimento total do rastro (px)
      const vx = (Math.cos(a) * L) / env.W, vy = (-Math.sin(a) * L) / env.H;
      const n = Math.max(2, Math.round(Math.min(64, Math.max(6, L / 1.5)) * (1 - (p.thin / 100) * 0.9)));
      const out = env.gl.pass(DIRBLUR, {
        u_tex: src, u_vec: [vx, vy], u_shift: p.displace ? [-vx * 0.5, -vy * 0.5] : [0, 0], u_n: n, u_spread: p.spread / 100,
        u_thr: p.threshold / 255, u_dev: p.maxDev / 255, u_mode: p.applyMode, u_amix: p.applyMix / 100, u_mix: 0,
      });
      return env.gl.pass(MIXCH, { u_tex: src, u_tex2: out, u_mix: p.mix / 100, u_ch: p.channels });
    },
  },
  {
    type: 'bccLensBlur', label: 'BCC Lens Blur', category: 'Desfoque', plugin: 'BCC Lens Blur',
    description: 'Desfoque de lente do BCC: a íris (círculo ou 3–16 lâminas) define a forma do bokeh; Highlight Boost deixa os realces mais fortes.',
    params: [num('irisScale', 'Iris Scale', 10, 0, 200, 0.1), sel('quality', 'Quality', ['Fast', 'Normal', 'Sharp', 'Sharper'], 4), num('scaleX', 'Scale X', 100, 0, 400), num('scaleY', 'Scale Y', 100, 0, 400),
      num('gamma', 'Gamma', 1, 0.1, 5, 0.01), sel('irisShape', 'Iris Shape', ['Circle', '3 Sides', '4 Sides', '5 Sides', '6 Sides', '7 Sides', '8 Sides', '9 Sides', '10 Sides', '11 Sides', '12 Sides', '13 Sides', '14 Sides', '15 Sides', '16 Sides'], 1),
      num('curvature', 'Iris Curvature', 0, -100, 100), ang('irisRot', 'Iris Rotation', 0),
      sel('boostMode', 'Boost/Sup Mode', ['RGB Max', 'RGB Glow', 'Luma Boost to White', 'Luma'], 1), num('boost', 'Highlight Boost', 0, 0, 100), num('hThreshold', 'Highlight Threshold', 70, 0, 100), mixP()],
    pad: (p) => p.irisScale * 2.2 * Math.max(p.scaleX, p.scaleY) / 100,
    render: (src, p, env) => {
      const r = p.irisScale * 2 * env.scale;
      if (r < 0.5) return src;
      return env.gl.pass(LENSBLUR, {
        u_tex: src, u_r: r, u_sides: p.irisShape <= 1 ? 0 : p.irisShape + 1, u_curv: p.curvature / 100, u_rot: rad(p.irisRot), u_boost: p.boost / 100,
        u_hthr: p.hThreshold / 100, u_gamma: Math.min(5, Math.max(0.1, p.gamma > 5 ? p.gamma / 100 : p.gamma)), /* BCC grava Gamma ×100 (200 = 2,0) */ u_bmode: p.boostMode, u_mix: p.mix / 100, u_sxy: [p.scaleX / 100, p.scaleY / 100],
      });
    },
  },
  {
    type: 'bccUnsharp', label: 'BCC Unsharp Mask', category: 'Cor', plugin: 'BCC Unsharp Mask',
    description: 'A imagem é desfocada (Radius) e o desfoque é subtraído da fonte (Amount). Threshold 0–255: mudanças menores que o limiar não acontecem.',
    params: [num('radius', 'Radius', 3, 0, 200, 0.1), num('amount', 'Amount', 1, 0, 500, 0.01), num('threshold', 'Threshold', 0, 0, 255),
      sel('channels', 'Output Channels', CHANNELS, 1), sel('flicker', 'Reduce Flicker', ['Off', '1-2-1', '2-3-2', '1-1-1'], 1), mixP()],
    render: (src, p, env) => {
      let s = src;
      const fw = { 2: [1, 2, 1], 3: [2, 3, 2], 4: [1, 1, 1] }[p.flicker];
      if (fw) s = env.gl.pass(FLICKER, { u_tex: src, u_w: fw });
      if (p.radius <= 0 || p.amount <= 0) return s;
      const b = env.gl.blur(s, Math.max(0.3, p.radius * 0.5 * env.scale));
      // Amount: mesma leitura do Frameify/AE (1 → 4%, 6 → 24%, 50 → 200%)
      return env.gl.pass(UNSHARP, { u_tex: s, u_tex2: b, u_amt: (p.amount * 4) / 100, u_thr: p.threshold / 255, u_mix: p.mix / 100, u_ch: p.channels });
    },
  },
  {
    type: 'bccMagicSharp', label: 'BCC Magic Sharp', category: 'Cor', plugin: 'BCC Magic Sharp',
    description: 'Nitidez em até 4 passes (Fine, Small, Medium, Coarse — cada um com detalhes ~2× maiores), com supressão de ruído, limite para bordas já fortes, ajuste por canal e por faixa de luz.',
    params: [num('amount', 'Sharpen Amount', 15, 0, 200), num('threshold', 'Sharpen Threshold', 5, 0, 100), num('radius', 'Sharpen Radius', 1.4, 0.1, 20, 0.01), num('noise', 'Noise Suppression', 1, 0, 100, 0.1),
      bool('fineOn', 'Fine Pass', true), num('fine', 'Fine Sharpen', 250, 0, 1000), bool('smallOn', 'Small Pass', true), num('small', 'Small Sharpen', 50, 0, 1000),
      bool('medOn', 'Medium Pass', false), num('med', 'Medium Sharpen', 100, 0, 1000), bool('coarseOn', 'Coarse Pass', false), num('coarse', 'Coarse Sharpen', 100, 0, 1000),
      num('lumaS', 'Luma Sharpen', 100, 0, 400), num('chromaS', 'Chroma Sharpen', 100, 0, 400), num('redS', 'Red Sharpen', 100, 0, 400), num('greenS', 'Green Sharpen', 100, 0, 400), num('blueS', 'Blue Sharpen', 100, 0, 400),
      num('hiR', 'Highlight Range', 88, 0, 100), num('mhR', 'Midtone High Range', 64, 0, 100), num('mlR', 'Midtone Low Range', 36, 0, 100), num('shR', 'Shadow Range', 12, 0, 100),
      bool('rangeOn', 'High/Mid/Shad Sharpen On', true), num('hiS', 'Highlight Sharpen', 100, 0, 400), num('midS', 'Midtone Sharpen', 100, 0, 400), num('shS', 'Shadow Sharpen', 100, 0, 400), mixP()],
    render: (src, p, env) => {
      const { gl } = env, r = Math.max(0.3, p.radius * 0.5 * env.scale);
      const b1 = gl.blur(src, r), b2 = gl.blur(src, r * 2), b3 = gl.blur(src, r * 4), b4 = gl.blur(src, r * 8);
      return gl.pass(MAGIC, {
        u_tex: src, u_b1: b1, u_b2: b2, u_b3: b3, u_b4: b4,
        u_pass: [p.fineOn ? p.fine / 100 : 0, p.smallOn ? p.small / 100 : 0, p.medOn ? p.med / 100 : 0, p.coarseOn ? p.coarse / 100 : 0],
        u_amt: p.amount / 15, u_thr: p.threshold, u_noise: p.noise, u_luma: p.lumaS / 100, u_chroma: p.chromaS / 100, u_rgbS: [p.redS / 100, p.greenS / 100, p.blueS / 100],
        u_hr: p.hiR / 100, u_mhr: p.mhR / 100, u_mlr: p.mlR / 100, u_sr: p.shR / 100, u_rangeOn: p.rangeOn ? 1 : 0, u_rngS: [p.hiS / 100, p.midS / 100, p.shS / 100], u_rng: [0, 0, 0], u_mix: p.mix / 100,
      });
    },
  },
  {
    type: 'bccGlow', label: 'BCC Glow', category: 'Luz e brilho', plugin: 'BCC Glow / BCC+ Glow',
    description: 'Glow do BCC: a matte (Position = brilho de onde nasce o glow, Range = faixa) é desfocada (Blur X/Y) e somada (Add) ou em Screen.',
    params: [sel('blend', 'Blend', ['Add', 'Screen'], 2), num('brightness', 'Brightness', 100, 0, 1000), num('blurX', 'Blur X', 80, 0, 1000), num('blurY', 'Blur Y', 80, 0, 1000), bool('gang', 'Blur Gang', true),
      col('color', 'Color', [1, 1, 1, 1]), num('position', 'Matte Position', 60, 0, 100), num('range', 'Matte Range', 40, 0, 100), num('matteBlur', 'Matte Blur', 0, 0, 100),
      bool('under', 'Glow Under Source', false), mixP()],
    pad: (p) => Math.max(p.blurX, p.gang ? p.blurX : p.blurY) * 1.2,
    render: (src, p, env) => {
      const { gl } = env;
      let m = gl.pass(GLOW_TH, { u_tex: src, u_pos: p.position / 100, u_rng: Math.max(0.01, p.range / 100) });
      if (p.matteBlur > 0) m = gl.blur(m, p.matteBlur * env.scale * 0.5);
      const bx = p.blurX * 0.5 * env.scale, by = (p.gang ? p.blurX : p.blurY) * 0.5 * env.scale;
      let g = null;
      for (const f of [0.1, 0.3, 0.6, 1]) { // glow em várias escalas (perfil suave, como o BCC)
        const b = gl.blur(gl.blur(m, Math.max(0.5, bx * f), 2), Math.max(0.5, by * f), 3);
        g = g ? gl.add(g, b, 1) : b;
      }
      return gl.pass(GLOW_COMB, { u_tex: src, u_tex2: g, u_bright: (p.brightness / 100) * 0.5, u_screen: p.blend === 2 ? 1 : 0, u_under: p.under ? 1 : 0, u_col: rgb(p.color), u_mix: p.mix / 100 });
    },
  },
  {
    type: 'bccBlur', label: 'BCC Blur', category: 'Desfoque', plugin: 'BCC Blur',
    description: 'Desfoque horizontal e vertical independentes (Lock Blur usa o horizontal nos dois).',
    params: [num('h', 'Horizontal Blur', 10, 0, 1000, 0.1), num('v', 'Vertical Blur', 10, 0, 1000, 0.1), bool('lock', 'Lock Blur', true), sel('channels', 'Channels', CHANNELS, 1), mixP()],
    pad: (p) => Math.max(p.h, p.lock ? p.h : p.v) * 1.5,
    render: (src, p, env) => {
      const h = p.h * 0.5 * env.scale, v = (p.lock ? p.h : p.v) * 0.5 * env.scale;
      if (h < 0.3 && v < 0.3) return src;
      let b = src;
      if (h >= 0.3) b = env.gl.blur(b, h, 2);
      if (v >= 0.3) b = env.gl.blur(b, v, 3);
      return env.gl.pass(MIXCH, { u_tex: src, u_tex2: b, u_mix: p.mix / 100, u_ch: p.channels });
    },
  },
  {
    type: 'bccTemporalBlur', label: 'BCC Temporal Blur', category: 'Tempo', plugin: 'BCC Temporal Blur',
    description: 'Média de vários quadros (Amount em quadros), para frente, para trás ou nos dois sentidos, com peso Gaussian (mais no quadro atual) ou Flat.',
    params: [num('amount', 'Amount (Frames)', 3, 0, 60, 0.1), bool('lockWhole', 'Lock to Whole Frames', false), num('separation', 'Frame Separation', 1, 1, 30, 1), num('offset', 'Frame Offset', 0, -100, 100, 1),
      sel('direction', 'Blur Direction', ['Bidirectional', 'Later Frames', 'Earlier Frames'], 1), sel('shape', 'Blur Shape', ['Gaussian', 'Flat'], 1), num('spread', 'Spread', 0, 0, 100), mixP()],
    temporal: 'bccTemporalBlur',
  },
];
