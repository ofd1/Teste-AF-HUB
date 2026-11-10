// Desfoques e luz: Gaussian/Directional/Radial blur, motion blur (estilo RSMB), Glow, Deep Glow,
// Light Rays (estilo CC Light Rays / Shine / S_Rays), Lens Flare, Light Leaks, Strobe.
import { frag, num, ang, col, bool, sel, pos, rad, cuv, rgb } from './common.js';

const DIR_BLUR = frag(`
uniform vec2 u_vec;
void main() {
  vec4 a = vec4(0.0);
  for (int i = 0; i < 32; i++) { float f = float(i) / 31.0 - 0.5; a += samp(v_uv + u_vec * f); }
  gl_FragColor = a / 32.0;
}`);

const RADIAL_BLUR = frag(`
uniform vec2 u_center; uniform float u_amount; uniform float u_mode;
void main() {
  vec4 a = vec4(0.0);
  vec2 d = (v_uv - u_center) * u_size;
  for (int i = 0; i < 48; i++) {
    float f = float(i) / 47.0;
    vec2 dd;
    if (u_mode < 1.5) dd = d * (1.0 - u_amount * f);
    else { float an = u_amount * (f - 0.5); dd = mat2(cos(an), sin(an), -sin(an), cos(an)) * d; }
    a += samp(u_center + dd / u_size);
  }
  gl_FragColor = a / 48.0;
}`);

const THRESH = frag(`
uniform float u_thr; uniform vec3 u_color; uniform float u_useColor; uniform float u_knee;
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv));
  float l = luma(c.rgb);
  // joelho do limiar: largo = brilho suave sem recorte (BCC Film Glow); estreito = só os realces
  float kn = u_knee > 0.0 ? u_knee : 0.15;
  float k = smoothstep(u_thr - kn / 3.0, u_thr + kn * 2.0 / 3.0, l);
  vec3 cc = mix(c.rgb, u_color * max(l, 0.35) * 1.4, u_useColor);
  gl_FragColor = pre(vec4(cc, c.a * k));
}`);

const GLOW_COMP = frag(`
uniform sampler2D u_tex2; uniform float u_amount;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec4 g = texture2D(u_tex2, v_uv) * u_amount;
  gl_FragColor = fixpre(s + g);
}`);

// Deep Glow: composição com Blend Mode (Screen/Add), aberração cromática do glow, Tint (Standard/Overlay/Soft Light) e Source Opacity
const DG_COMP = frag(`
uniform sampler2D u_tex2; uniform float u_amount; uniform float u_add; uniform float u_ca; uniform float u_cach;
uniform vec3 u_tint; uniform float u_tmode; uniform float u_tmix; uniform float u_srcop;
void main() {
  vec4 s = texture2D(u_tex, v_uv) * u_srcop;
  vec2 d = (v_uv - 0.5) * u_ca * 8.0;
  vec4 g = texture2D(u_tex2, v_uv);
  if (u_ca > 0.0) {
    vec4 ga = texture2D(u_tex2, v_uv + d), gb = texture2D(u_tex2, v_uv - d);
    if (u_cach < 0.5) { g.r = ga.r; g.g = gb.g; } else if (u_cach < 1.5) { g.r = ga.r; g.b = gb.b; } else { g.g = ga.g; g.b = gb.b; }
  }
  g *= u_amount;
  if (u_tmode > 0.5) {
    float l = dot(g.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 t;
    if (u_tmode < 1.5) t = u_tint * l * 1.6;
    else if (u_tmode < 2.5) t = mix(2.0 * g.rgb * u_tint, 1.0 - 2.0 * (1.0 - clamp(g.rgb, 0.0, 1.0)) * (1.0 - u_tint), step(0.5, g.rgb)) ;
    else t = (1.0 - 2.0 * u_tint) * g.rgb * g.rgb + 2.0 * u_tint * g.rgb;
    g.rgb = mix(g.rgb, t, u_tmix);
  }
  vec3 o = u_add > 0.5 ? s.rgb + g.rgb : s.rgb + g.rgb - s.rgb * clamp(g.rgb, 0.0, 1.0);
  gl_FragColor = fixpre(vec4(o, max(s.a, clamp(max(g.a, max(g.r, max(g.g, g.b))), 0.0, 1.0))));
}`);

const RAYS = frag(`
uniform vec2 u_center; uniform float u_len; uniform float u_int; uniform vec3 u_color; uniform float u_thr;
void main() {
  vec2 d = v_uv - u_center;
  vec3 a = vec3(0.0); float ak = 0.0;
  float w = 1.0, ws = 0.0;
  for (int i = 0; i < 56; i++) {
    float f = float(i) / 55.0;
    vec4 c = unpre(samp(u_center + d * (1.0 - u_len * f)));
    float k = smoothstep(u_thr, u_thr + 0.2, luma(c.rgb)) * c.a;
    a += c.rgb * k * w; ak += k * w; ws += w; w *= 0.965;
  }
  a = a / ws * u_color * u_int; ak = ak / ws * u_int;
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = fixpre(s + vec4(a, ak * 0.6));
}`);

const FLARE = frag(`
uniform vec2 u_pos, u_ax; uniform float u_bright, u_fsize, u_streak, u_glow, u_halo, u_rays, u_raysN, u_ghosts, u_ghostN, u_chroma, u_dirt, u_flick, u_sides, u_seed;
uniform vec3 u_color, u_c2, u_scol;
float polyD(vec2 p, float n) {
  if (n < 2.5) return length(p);
  float a = atan(p.y, p.x), s = 6.2831853 / n;
  return cos(floor(0.5 + a / s) * s - a) * length(p);
}
void main() {
  vec2 px = v_uv * u_size, lp = u_pos * u_size, cp = u_ax * u_size;
  vec2 dv = px - lp;
  float r = length(dv) / u_fsize, an = atan(dv.y, dv.x);
  // núcleo (glow) — pico forte + cauda longa como no Optical Flares
  vec3 col = u_color * (exp(-r * r * 9.0) * 2.2 + 0.03 / (r + 0.03) + exp(-r * 1.8) * 0.25) * u_glow;
  // starburst (raios finos de comprimentos variados)
  float sb = pow(max(0.0, cos(an * u_raysN)), 28.0) * (0.55 + 0.9 * vnoise(vec2(an * u_raysN * 0.8, u_seed)));
  sb += pow(max(0.0, cos(an * u_raysN * 2.0 + 1.3)), 70.0) * 0.6 * vnoise(vec2(an * 31.0, u_seed + 7.0));
  col += mix(u_color, vec3(1.0), 0.45) * sb * exp(-r * 1.7) * u_rays * 1.3;
  // streak anamórfico (linha horizontal fina + véu largo)
  float sx = abs(dv.x) / u_fsize, sy = abs(dv.y) / u_fsize;
  col += u_scol * (exp(-sy * 140.0) * exp(-sx * 0.55) + exp(-sy * 22.0) * exp(-sx * 2.2) * 0.3) * u_streak;
  // halo com aberração cromática
  float hr = 1.45, hw = 12.0;
  vec3 ring = vec3(exp(-pow((r - hr * (1.0 - 0.05 * u_chroma)) * hw, 2.0)), exp(-pow((r - hr) * hw, 2.0)), exp(-pow((r - hr * (1.0 + 0.05 * u_chroma)) * hw, 2.0)));
  col += ring * mix(vec3(1.0), u_c2, 0.5) * u_halo * 0.2;
  // ghosts (íris poligonais) ao longo do eixo luz → centro
  vec2 axis = cp - lp;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= u_ghostN) break;
    float fi = float(i) + u_seed * 13.0;
    float k = 0.25 + 1.9 * hash1(fi * 7.13);
    vec2 gp = lp + axis * k;
    float gr = u_fsize * (0.035 + 0.2 * pow(hash1(fi * 3.1 + 1.0), 2.0));
    vec2 q = px - gp;
    vec3 gd = vec3(polyD(q / (1.0 - 0.05 * u_chroma), u_sides), polyD(q, u_sides), polyD(q / (1.0 + 0.05 * u_chroma), u_sides)) / gr;
    vec3 fill = smoothstep(vec3(1.0), vec3(0.8), gd) * 0.1 + smoothstep(vec3(1.0), vec3(0.93), gd) * smoothstep(vec3(0.7), vec3(0.93), gd) * 0.14;
    vec3 gc = mix(u_c2, hsv2rgb(vec3(fract(hash1(fi * 5.7) * 0.6 + 0.45), 0.6, 1.0)), 0.5);
    col += fill * gc * u_ghosts * (0.6 + 0.8 * hash1(fi * 9.1));
  }
  // sujeira de lente revelada pela luz
  float dirt = smoothstep(0.58, 0.85, fbm(contentUV(v_uv) * vec2(7.0, 4.0) + u_seed, 4)) + smoothstep(0.75, 0.95, vnoise(contentUV(v_uv) * 38.0 + u_seed)) * 0.6;
  col += u_color * dirt * exp(-r * 0.7) * u_dirt * 0.9;
  col *= u_bright * (1.0 + u_flick * (vnoise(vec2(u_time * 14.0, u_seed)) - 0.5) * 1.2);
  vec4 s = texture2D(u_tex, v_uv);
  gl_FragColor = fixpre(s + vec4(col, 0.0));
}`);

// estilos do Optical Flares: cor do núcleo, cor secundária (halo/ghosts), cor do streak e multiplicadores
const FLARE_STYLES = [null,
  {},
  { color: [0.62, 0.8, 1], c2: [0.3, 0.55, 1], scol: [0.25, 0.5, 1], streak: 2.6, rays: 0.3, ghosts: 0.7, halo: 0.6 },
  { color: [1, 0.72, 0.38], c2: [1, 0.5, 0.2], scol: [1, 0.6, 0.3], streak: 0.4, rays: 1.5, halo: 0.6 },
  { color: [0.6, 0.35, 1], c2: [0.1, 1, 0.9], scol: [0.7, 0.35, 1], streak: 1.6, ghosts: 1.3, halo: 1.2 },
  { color: [1, 1, 1], c2: [0.9, 0.95, 1], scol: [1, 1, 1], glow: 1.6, rays: 0.2, ghosts: 0.25, halo: 0.4, streak: 0 },
  { color: [1, 0.86, 0.7], c2: [1, 0.6, 0.3], scol: [1, 0.75, 0.5], halo: 1.3, ghosts: 1.5, rays: 0.6, streak: 0.6 },
  { color: [0.6, 1, 0.92], c2: [0.2, 0.9, 0.8], scol: [0.3, 0.9, 1], streak: 1.2, rays: 0.8 },
];

const LEAK = frag(`
uniform float u_int; uniform float u_speed; uniform float u_hue; uniform float u_seed; uniform float u_mode;
void main() {
  vec2 c = contentUV(v_uv);
  float t = u_time * u_speed + u_seed * 7.0;
  float n = fbm(c * 1.4 + vec2(t * 0.35, -t * 0.22), 4);
  float n2 = fbm(c * 2.2 - vec2(t * 0.2, t * 0.12) + 5.0, 4);
  vec3 lc = hsv2rgb(vec3(fract(u_hue + n2 * 0.18), 0.75, 1.0)) * smoothstep(0.38, 0.85, n) * u_int;
  vec4 s = texture2D(u_tex, v_uv);
  if (u_mode > 1.5) { gl_FragColor = fixpre(s + vec4(lc, 0.0)); return; }
  gl_FragColor = vec4(s.rgb + lc * (s.a - s.rgb), s.a);
}`);

const STROBE = frag(`
uniform vec3 u_color; uniform float u_mode; uniform float u_blend;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  if (u_mode < 1.5) gl_FragColor = vec4(mix(s.rgb, u_color * s.a, u_blend), s.a);
  else if (u_mode < 2.5) gl_FragColor = s * (1.0 - u_blend);
  else gl_FragColor = fixpre(s + vec4(u_color * u_blend, u_blend));
}`);

function glowLayers(gl, th, radius, levels) {
  let acc = null;
  for (const f of levels) {
    const b = gl.blur(th, Math.max(0.5, radius * f));
    acc = acc ? gl.add(acc, b, 1) : b;
  }
  return acc;
}

export default [
  {
    type: 'blur', label: 'Desfoque gaussiano', category: 'Desfoque',
    params: [num('radius', 'Intensidade', 10, 0, 300, 0.5), sel('dims', 'Dimensões', ['Horizontal e vertical', 'Horizontal', 'Vertical'])],
    pad: (p) => p.radius * 1.5,
    render: (src, p, env) => env.gl.blur(src, p.radius * 0.5 * env.scale, p.dims),
  },
  {
    type: 'dirBlur', label: 'Desfoque direcional', category: 'Desfoque',
    params: [ang('angle', 'Direção', 0), num('length', 'Comprimento', 20, 0, 500)],
    pad: (p) => p.length * 0.6,
    render: (src, p, env) => (p.length <= 0 ? src : env.gl.pass(DIR_BLUR, {
      u_tex: src, u_vec: [Math.sin(rad(p.angle)) * p.length * env.scale / env.W, -Math.cos(rad(p.angle)) * p.length * env.scale / env.H],
    })),
  },
  {
    type: 'radialBlur', label: 'Desfoque radial / zoom', category: 'Desfoque', plugin: 'CC Radial Blur',
    params: [sel('mode', 'Tipo', ['Zoom', 'Giro']), num('amount', 'Quantidade', 30, 0, 100, 0.5), pos('center', 'Centro')],
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(RADIAL_BLUR, {
      u_tex: src, u_center: cuv(env, p.center), u_mode: p.mode, u_amount: p.mode === 1 ? p.amount / 220 : rad(p.amount * 0.6),
    })),
  },
  {
    type: 'motionBlur', label: 'Motion blur (estilo RSMB)', category: 'Desfoque', plugin: 'ReelSmart Motion Blur',
    description: 'Desfoque de movimento real calculado a partir da animação da camada (posição, escala, rotação, shakes).',
    params: [num('amount', 'Quantidade %', 100, 0, 400, 1), num('samples', 'Amostras', 12, 2, 32, 1)],
    temporal: 'motionBlur',
  },
  {
    type: 'glow', label: 'Glow (AE)', category: 'Luz e brilho',
    params: [num('threshold', 'Limiar %', 50, 0, 100), num('radius', 'Raio', 25, 0, 300), num('intensity', 'Intensidade', 1.2, 0, 8, 0.05), col('color', 'Cor'), bool('useColor', 'Usar cor')],
    pad: (p) => p.radius * 1.5,
    render: (src, p, env) => {
      const { gl } = env;
      const th = gl.pass(THRESH, { u_tex: src, u_thr: p.threshold / 100, u_color: rgb(p.color), u_useColor: p.useColor });
      const g = gl.blur(th, p.radius * 0.5 * env.scale);
      return gl.pass(GLOW_COMP, { u_tex: src, u_tex2: g, u_amount: p.intensity });
    },
  },
  {
    type: 'deepGlow', label: 'Deep Glow', category: 'Luz e brilho', plugin: 'Deep Glow',
    description: 'Glow físico em várias escalas com decaimento exponencial (sem o “anel” do glow comum). Controles iguais ao Deep Glow: Radius, Exposure, Threshold/Smooth, Blend Mode, Aspect Ratio, Spread, Chromatic Aberration, Tint (Standard/Overlay/Soft Light) e Source Opacity.',
    params: [num('radius', 'Radius', 120, 0, 1500), num('exposure', 'Exposure', 1, 0, 10, 0.05), num('threshold', 'Threshold %', 0, 0, 100),
      num('knee', 'Threshold Smooth %', 15, 1, 100), sel('blendMode', 'Blend Mode', ['Screen', 'Add'], 1),
      num('aspect', 'Aspect Ratio', 1, 0.1, 10, 0.05), num('spread', 'Spread', 33, 0, 100),
      bool('caEnable', 'Chromatic Aberration › Enable', false), sel('caChannels', 'Chromatic Aberration › Channels', ['Red & Green', 'Red & Blue', 'Green & Blue'], 2), num('caAmount', 'Chromatic Aberration › Amount', 0.25, 0, 2, 0.01),
      bool('useTint', 'Tint › Enable', false), col('tint', 'Tint › Color', [1, 0.6, 0.2, 1]), sel('tintMode', 'Tint › Mode', ['Standard', 'Overlay', 'Soft Light'], 1), num('tintMix', 'Tint › Mix %', 100, 0, 100),
      num('iterations', 'Glow Iterations', 6, 1, 8, 1), num('sourceOpacity', 'Source Opacity %', 100, 0, 100)],
    pad: (p) => p.radius * 1.2,
    render: (src, p, env) => {
      const { gl } = env;
      const th = gl.pass(THRESH, { u_tex: src, u_thr: p.threshold / 100, u_color: [1, 1, 1], u_useColor: 0, u_knee: (p.knee ?? 15) / 100 });
      const r = p.radius * 0.5 * env.scale;
      const all = [0.02, 0.06, 0.15, 0.35, 0.7, 1, 1.4, 1.9];
      const n = Math.max(1, Math.min(8, Math.round(p.iterations ?? 6)));
      const levels = all.slice(Math.max(0, 6 - n), Math.max(6, n)).slice(0, n);
      // Spread: 33 = decaimento padrão; mais alto dá peso às camadas largas, mais baixo concentra no núcleo
      const k = ((p.spread ?? 33) - 33) / 33;
      const h = Math.min(1, p.aspect ?? 1), v = Math.min(1, 1 / (p.aspect ?? 1));
      let acc = null, wsum = 0;
      if (Math.abs((p.aspect ?? 1) - 1) < 0.01 && gl.blurSum && !globalThis.__DG_OLD) {
        // todas as iterações numa pirâmide só (mesmo resultado, bem mais leve na exportação)
        acc = gl.blurSum(th, levels.map((f) => ({ sigma: Math.max(0.5, r * f), w: Math.pow(f, k) })));
        wsum = levels.reduce((s2, f) => s2 + Math.pow(f, k), 0);
      } else levels.forEach((f, i) => {
        const w = Math.pow(f, k);
        const b = Math.abs((p.aspect ?? 1) - 1) < 0.01 ? gl.blur(th, Math.max(0.5, r * f)) : gl.blur(gl.blur(th, r * f * h, 2), r * f * v, 3);
        acc = acc ? gl.add(acc, b, w) : (w === 1 ? b : gl.add(b, b, w - 1));
        wsum += w;
      });
      const norm = levels.length / wsum;
      return gl.pass(DG_COMP, {
        u_tex: src, u_tex2: acc, u_amount: p.exposure * 0.45 * norm, u_add: (p.blendMode ?? 2) === 2 ? 1 : 0,
        u_ca: p.caEnable ? (p.caAmount ?? 0.25) * r * 0.08 / Math.max(env.w, env.h) : 0, u_cach: (p.caChannels ?? 2) - 1,
        u_tint: rgb(p.tint), u_tmode: p.useTint ? (p.tintMode ?? 1) : 0, u_tmix: (p.tintMix ?? 100) / 100, u_srcop: (p.sourceOpacity ?? 100) / 100,
      });
    },
  },
  {
    type: 'lightRays', label: 'Raios de luz', category: 'Luz e brilho', plugin: 'CC Light Rays / Shine / S_Rays',
    params: [pos('center', 'Origem'), num('intensity', 'Intensidade', 2, 0, 10, 0.05), num('length', 'Comprimento %', 40, 0, 100), num('threshold', 'Limiar %', 30, 0, 100), col('color', 'Cor', [1, 0.95, 0.85, 1])],
    render: (src, p, env) => env.gl.pass(RAYS, { u_tex: src, u_center: cuv(env, p.center), u_len: p.length / 100, u_int: p.intensity, u_thr: p.threshold / 100, u_color: rgb(p.color) }),
  },
  {
    type: 'lensFlare', label: 'Optical Flares', category: 'Luz e brilho', plugin: 'Optical Flares / S_LensFlare / BCC Lens Flare',
    description: 'Flare de lente completo: brilho, starburst, halo cromático, ghosts poligonais, streak anamórfico, sujeira de lente e estilos prontos.',
    params: [sel('style', 'Estilo', ['Clássico (cor livre)', 'Anamórfico azul', 'Sol quente', 'Sci-fi neon', 'Spotlight branco', 'Cinema 35mm', 'Verde-água'], 1),
      pos('position', 'Posição da luz', [0.25, 0.25]), pos('axis', 'Centro da lente', [0.5, 0.5]),
      num('brightness', 'Brilho %', 100, 0, 400), num('size', 'Escala', 220, 10, 2000), col('color', 'Cor', [1, 0.85, 0.65, 1]),
      num('glow', 'Glow %', 100, 0, 300), num('rays', 'Starburst %', 60, 0, 300), num('raysN', 'Nº de raios', 8, 2, 40, 1),
      num('streak', 'Streak anamórfico', 0.8, 0, 3, 0.05), num('halo', 'Halo %', 100, 0, 300), num('chroma', 'Aberração cromática %', 60, 0, 200),
      num('ghosts', 'Ghosts %', 100, 0, 300), num('ghostN', 'Nº de ghosts', 7, 0, 16, 1), num('sides', 'Lados da íris', 6, 0, 12, 1),
      num('dirt', 'Sujeira de lente %', 0, 0, 200), num('flicker', 'Flicker %', 0, 0, 100), num('seed', 'Semente', 1, 0, 100, 1)],
    render: (src, p, env) => {
      const st = FLARE_STYLES[(p.style | 0) || 1] || FLARE_STYLES[1];
      const c = st.color || rgb(p.color);
      return env.gl.pass(FLARE, {
        u_tex: src, u_pos: cuv(env, p.position), u_ax: cuv(env, p.axis || [0.5, 0.5]), u_bright: p.brightness / 100, u_fsize: p.size * env.scale,
        u_streak: p.streak * (st.streak ?? 1), u_glow: ((p.glow ?? 100) / 100) * (st.glow ?? 1), u_rays: ((p.rays ?? 60) / 100) * (st.rays ?? 1),
        u_raysN: p.raysN ?? 8, u_halo: ((p.halo ?? 100) / 100) * (st.halo ?? 1), u_chroma: (p.chroma ?? 60) / 100,
        u_ghosts: ((p.ghosts ?? 100) / 100) * (st.ghosts ?? 1), u_ghostN: p.ghostN ?? 7, u_sides: p.sides ?? 6,
        u_dirt: (p.dirt ?? 0) / 100, u_flick: (p.flicker ?? 0) / 100, u_seed: p.seed ?? 1,
        u_color: c, u_c2: st.c2 || [0.6, 0.8, 1], u_scol: st.scol || [c[0] * 0.5 + 0.25, c[1] * 0.5 + 0.35, c[2] * 0.5 + 0.5],
      });
    },
  },
  {
    type: 'lightLeak', label: 'Light Leaks', category: 'Luz e brilho', plugin: 'BCC Light Leaks',
    params: [num('intensity', 'Intensidade', 0.8, 0, 3, 0.05), num('speed', 'Velocidade', 0.5, 0, 5, 0.05), num('hue', 'Matiz', 0.05, 0, 1, 0.01), num('seed', 'Semente', 1, 0, 100), sel('mode', 'Modo', ['Só na camada', 'Sobre tudo'])],
    render: (src, p, env) => env.gl.pass(LEAK, { u_tex: src, u_int: p.intensity, u_speed: p.speed, u_hue: p.hue, u_seed: p.seed, u_mode: p.mode }),
  },
  {
    type: 'strobe', label: 'Strobe / Flash', category: 'Luz e brilho',
    params: [col('color', 'Cor'), num('frequency', 'Frequência (Hz)', 6, 0.1, 30, 0.1), num('duration', 'Duração %', 40, 1, 100), num('blend', 'Mistura %', 100, 0, 100), sel('mode', 'Modo', ['Colorir camada', 'Transparente', 'Flash aditivo'])],
    render: (src, p, env) => {
      const on = ((env.t * p.frequency) % 1) < p.duration / 100;
      return on ? env.gl.pass(STROBE, { u_tex: src, u_color: rgb(p.color), u_mode: p.mode, u_blend: p.blend / 100 }) : src;
    },
  },
];
