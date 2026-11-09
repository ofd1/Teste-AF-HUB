// Efeitos com os controles tirados dos .ffx/.aep do usuário (nome, opções e padrões gravados nos presets):
//  • BallPoint (PSSBLPNT) — desenha a imagem com traços de caneta que seguem as bordas (Stroke Angle/Cross Angle,
//    Stroke Count, Stroke Width, Edge Tracking, Ink Color/Use Original, Paint On, Blending Mode).
//  • CC Radial ScaleWipe / CC Scale Wipe (nativos do AE).
//  • BCC Three Strip — emulação do Technicolor de três tiras + correção de cor e Mix with Original.
//  • BCC Ripple Dissolve — ondas que saem do centro, com luz, enquanto a camada se dissolve.
import { frag, num, ang, col, bool, sel, pos, rgb, rad, cuv } from './common.js';

const BALLPOINT = frag(`
uniform float u_sp, u_wid, u_edge, u_ang, u_cross, u_seed, u_det, u_energy, u_useOrig, u_paintOn, u_blend, u_trim;
uniform vec3 u_ink;
float L(vec2 uv) { return luma(unpre(texture2D(u_tex, uv)).rgb); }
// uma família de traços: linhas paralelas na direção dir, quebradas em segmentos com leve tremor de mão
float strokes(vec2 px, vec2 dir, float sp, float wid, float seed) {
  vec2 n = vec2(-dir.y, dir.x);
  float along = dot(px, dir), across = dot(px, n);
  float row = floor(across / sp);
  float seg = floor((along + hash1(row + seed) * 400.0) / (sp * 30.0));
  float jit = (vnoise(vec2(along / (sp * 6.0), row + seed)) - 0.5) * sp * 0.35;
  float d = abs(fract((across + jit) / sp) - 0.5) * sp;
  float on = step(hash(vec2(row, seg) + seed), u_trim); // Trim Segments: parte dos traços some
  return on * (1.0 - smoothstep(wid * 0.5 - 0.6, wid * 0.5 + 0.6, d));
}
void main() {
  vec4 s = unpre(texture2D(u_tex, v_uv));
  vec2 px = v_uv * u_size;
  vec2 e = u_texel * max(1.0, u_det);
  // direção da borda (Detail Radius = escala em que a borda é medida)
  float gx = L(v_uv + vec2(e.x, 0.0)) - L(v_uv - vec2(e.x, 0.0));
  float gy = L(v_uv + vec2(0.0, e.y)) - L(v_uv - vec2(0.0, e.y));
  float gm = length(vec2(gx, gy));
  vec2 base = vec2(cos(u_ang), sin(u_ang));
  vec2 tang = gm > 1e-4 ? normalize(vec2(-gy, gx)) : base;
  vec2 dir = normalize(mix(base, tang, clamp(u_edge * min(1.0, gm * 8.0), 0.0, 1.0)) + 1e-5);
  float tone = 1.0 - luma(s.rgb);                        // escuro = mais tinta
  float cov = clamp(tone * u_energy * 0.6 + gm * 3.0, 0.0, 1.0); // Coverage Energy
  float a1 = strokes(px, dir, u_sp, u_wid, u_seed) * smoothstep(0.08, 0.35, cov);
  vec2 d2 = vec2(cos(u_ang + u_cross + PI * 0.5), sin(u_ang + u_cross + PI * 0.5));
  float a2 = strokes(px, normalize(mix(d2, vec2(-dir.y, dir.x), u_edge * 0.5)), u_sp * 1.15, u_wid, u_seed + 7.0) * smoothstep(0.6, 0.95, cov);
  float ink = clamp(max(a1, a2), 0.0, 1.0) * s.a;
  vec3 ic = u_useOrig > 0.5 ? s.rgb : u_ink;
  vec4 bg = u_paintOn < 1.5 ? vec4(0.0) : u_paintOn < 2.5 ? vec4(s.rgb, s.a) : u_paintOn < 3.5 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
  vec3 o; float oa;
  if (u_blend < 1.5) { o = max(bg.rgb, ic); }        // Max
  else if (u_blend < 2.5) { o = min(bg.a > 0.0 ? bg.rgb : vec3(1.0), ic); } // Min
  else if (u_blend < 3.5) { o = bg.rgb + ic; }       // Add
  else if (u_blend < 4.5) { o = (bg.a > 0.0 ? bg.rgb : vec3(1.0)) * ic; } // Multiply
  else { o = bg.rgb; }                               // Cutout: traços recortam o fundo
  if (u_blend > 4.5) { oa = bg.a * (1.0 - ink); gl_FragColor = pre(vec4(o, oa)); return; }
  vec3 rgbo = mix(bg.rgb, clamp(o, 0.0, 1.0), ink);
  oa = max(bg.a, ink);
  gl_FragColor = pre(vec4(oa > 0.0 ? (bg.rgb * bg.a * (1.0 - ink) + clamp(o, 0.0, 1.0) * ink) / oa : rgbo, oa));
}`);

const RSCALEWIPE = frag(`
uniform float u_comp, u_rev; uniform vec2 u_c;
void main() {
  vec2 asp = vec2(u_size.x / u_size.y, 1.0);
  vec2 d = (v_uv - u_c) * asp;
  float r = length(d);
  float rmax = length(max(u_c, 1.0 - u_c) * asp);  // distância até o canto mais longe
  float R = u_comp * rmax;                 // raio do buraco (Completion 100 = tela inteira)
  // fora do buraco a imagem inteira é comprimida para fora: a borda do buraco mostra o centro (escala radial)
  float k = r > R ? (r - R) / max(1e-4, rmax - R) * rmax : 0.0;
  vec2 src = u_c + (r > 1e-5 ? d / r : vec2(0.0)) * k / asp;
  vec4 c = u_comp <= 0.0 ? texture2D(u_tex, v_uv) : samp(src);
  float hole = smoothstep(R - 0.004, R + 0.004, r);
  gl_FragColor = c * (u_rev > 0.5 ? 1.0 - hole : hole);
}`);

const SCALEWIPE = frag(`
uniform float u_str; uniform vec2 u_c, u_dir;
void main() {
  vec2 asp = vec2(u_size.x / u_size.y, 1.0);
  vec2 d = (v_uv - u_c) * asp;
  float t = dot(d, u_dir);                 // distância além da linha que passa pelo centro
  vec2 uv = v_uv;
  if (t > 0.0) uv = v_uv - u_dir / asp * t * (u_str / (1.0 + u_str)); // estica os pixels da linha na direção
  gl_FragColor = samp(uv);
}`);

const THREESTRIP = frag(`
uniform vec3 u_int, u_rgb; uniform float u_hue, u_sat, u_bri, u_con, u_gam, u_temp, u_cm, u_mix, u_op;
void main() {
  vec4 c0 = unpre(texture2D(u_tex, v_uv));
  vec3 c = c0.rgb;
  // três tiras: cada canal ganha a diferença para a média dos outros dois (Red/Green/Blue Intensity)
  vec3 m = vec3(c.r - (c.g + c.b) * 0.5, c.g - (c.r + c.b) * 0.5, c.b - (c.r + c.g) * 0.5);
  c = c + m * u_int;
  // Hue (graus), Saturation, Brightness, Contrast, Gamma
  vec3 h = rgb2hsv(clamp(c, 0.0, 1.0)); h.x = fract(h.x + u_hue / 360.0); h.y = clamp(h.y * (1.0 + u_sat / 100.0), 0.0, 1.0);
  c = hsv2rgb(h);
  c = c + u_bri / 100.0;
  c = (c - 0.5) * (1.0 + u_con / 100.0) + 0.5;
  c = pow(max(c, 0.0), vec3(1.0 / max(0.05, 1.0 + u_gam / 100.0)));
  // Temperature (+ quente), Cyan/Magenta, Red/Green/Blue
  c += vec3(u_temp, 0.0, -u_temp) * 0.005 + vec3(u_cm * 0.0025, -u_cm * 0.005, u_cm * 0.0025) + u_rgb * 0.004;
  c = mix(c0.rgb, clamp(c, 0.0, 1.0), (1.0 - u_mix) * u_op);
  gl_FragColor = pre(vec4(c, c0.a));
}`);

const RIPPLEDISS = frag(`
uniform float u_p, u_rad, u_h, u_ww, u_wInc, u_spd, u_ph, u_light, u_lw, u_lang, u_lel, u_mode, u_dissolve;
uniform vec2 u_c; uniform vec3 u_lc;
void main() {
  vec2 px = v_uv * u_size, c = u_c * u_size;
  vec2 d = px - c; float r = length(d);
  float front = u_p * u_rad * 2.0;                          // as ondas avançam com o Percent Done
  float w = u_ww * (1.0 + u_wInc / 100.0 * u_p);            // Wave Width cresce (Width Percent Increase)
  float env = smoothstep(front, front - w * 3.0, r) * smoothstep(0.0, w, r) * (1.0 - u_p * 0.6);
  float ph = (r - front) / max(1.0, w) * 2.0 * PI + u_ph + u_p * u_spd;
  float wave = sin(ph) * env;
  vec2 n = r > 1e-3 ? d / r : vec2(0.0);
  vec2 uv = (px - n * wave * u_h * 0.35) / u_size;           // Height = deslocamento das ondas
  vec4 s = samp(uv);
  // luz nas cristas: inclinação da onda vista da Light Angle/Elevation
  float slope = cos(ph) * env;
  vec2 ld = vec2(cos(u_lang), sin(u_lang));
  float li = max(0.0, slope * dot(n, ld) * cos(u_lel) + sin(u_lel) * 0.0) * u_light;
  li *= smoothstep(0.0, u_lw / 50.0, abs(slope));
  vec3 lc = u_lc * li * s.a;
  vec3 o = u_mode > 0.5 ? s.rgb + lc : mix(s.rgb, lc, clamp(li, 0.0, 1.0) * s.a);
  // dissolve: a camada some de dentro para fora acompanhando a onda (revela o que está embaixo)
  float k = 1.0 - smoothstep(front - w * u_dissolve, front, r) ;
  float a = 1.0 - clamp(u_p * 1.2 - 0.1, 0.0, 1.0) * (0.5 + 0.5 * k);
  gl_FragColor = fixpre(vec4(o, s.a) * a);
}`);

export default [
  {
    type: 'ballpoint', label: 'BallPoint', category: 'Estilizar', plugin: 'BallPoint (PSSBLPNT)',
    description: 'Desenha a imagem com traços de caneta que seguem as bordas — mesmos controles do plugin BallPoint.',
    params: [
      num('seed', 'Random Seed', 1, 0, 1000, 1), num('detail', 'Detail Radius', 110, 1, 500), num('energy', 'Coverage Energy', 170, 0, 400),
      num('edge', 'Edge Tracking', 29, 0, 100), ang('angle', 'Stroke Angle', 0), ang('cross', 'Cross Angle', 0),
      num('count', 'Stroke Count', 6700, 100, 50000, 10), num('subdiv', 'Subdivision', 111, 1, 400), num('length', 'Stroke Length', 2048, 1, 8192),
      num('width', 'Stroke Width', 20, 1, 200), num('trim', 'Trim Segments', 100, 0, 100), col('ink', 'Ink Color', [0, 0, 0, 1]), bool('useOrig', 'Use Original', true),
      sel('paintOn', 'Paint On', ['Transparent', 'Original Image', 'Black', 'White'], 1), sel('blend', 'Blending Mode', ['Max', 'Min', 'Add', 'Multiply', 'Cutout'], 1),
    ],
    render: (src, p, env) => {
      const area = env.w * env.h * env.scale * env.scale;
      const sp = Math.max(2, Math.sqrt(area / Math.max(100, p.count)) * 1.4); // Stroke Count → espaçamento entre traços
      return env.gl.pass(BALLPOINT, {
        u_tex: src, u_sp: sp, u_wid: Math.max(0.8, Math.min(sp * 0.9, (p.width / 20) * sp * 0.35)), u_edge: p.edge / 100, u_ang: rad(p.angle), u_cross: rad(p.cross),
        u_seed: p.seed, u_det: Math.max(1, p.detail * 0.02 * env.scale), u_energy: p.energy / 100, u_useOrig: p.useOrig ? 1 : 0,
        u_paintOn: p.paintOn, u_blend: p.blend, u_trim: p.trim / 100, u_ink: rgb(p.ink),
      });
    },
  },
  {
    type: 'ccRadialScaleWipe', label: 'CC Radial ScaleWipe', category: 'Transições', plugin: 'CC Radial ScaleWipe (AE)',
    params: [num('completion', 'Completion %', 0, 0, 100), pos('center', 'Center'), bool('reverse', 'Reverse Transition', false)],
    render: (src, p, env) => env.gl.pass(RSCALEWIPE, { u_tex: src, u_comp: p.completion / 100, u_rev: p.reverse ? 1 : 0, u_c: cuv(env, p.center) }),
  },
  {
    type: 'ccScaleWipe', label: 'CC Scale Wipe', category: 'Transições', plugin: 'CC Scale Wipe (AE)',
    params: [num('stretch', 'Stretch', 0, 0, 100, 0.1), pos('center', 'Center'), ang('direction', 'Direction', 0)],
    render: (src, p, env) => {
      const a = rad(p.direction - 90);
      return env.gl.pass(SCALEWIPE, { u_tex: src, u_str: p.stretch, u_c: cuv(env, p.center), u_dir: [Math.cos(a), Math.sin(a)] });
    },
  },
  {
    type: 'bccThreeStrip', label: 'BCC Three Strip', category: 'Cor', plugin: 'BCC+Three Strip',
    description: 'Cor estilo Technicolor de três tiras + Hue, Saturation, Brightness, Contrast, Gamma, Temperature, Cyan/Magenta, RGB e Mix with Original (como no BCC).',
    params: [
      num('opacity', 'Opacity', 100, 0, 100), num('rI', 'Red Intensity', 0, -100, 100), num('gI', 'Green Intensity', 0, -100, 100), num('bI', 'Blue Intensity', 0, -100, 100),
      num('hue', 'Hue', 0, -180, 180), num('sat', 'Saturation', 0, -100, 100), num('bri', 'Brightness', 0, -100, 100), num('con', 'Contrast', 0, -100, 100),
      num('gamma', 'Gamma', 0, -100, 100), num('temp', 'Temperature', 0, -100, 100), num('cm', 'Cyan/Magenta', 0, -100, 100),
      num('red', 'Red', 0, -100, 100), num('green', 'Green', 0, -100, 100), num('blue', 'Blue', 0, -100, 100), num('mix', 'Mix with Original', 0, 0, 100),
    ],
    render: (src, p, env) => env.gl.pass(THREESTRIP, {
      u_tex: src, u_int: [p.rI / 100, p.gI / 100, p.bI / 100], u_rgb: [p.red, p.green, p.blue], u_hue: p.hue, u_sat: p.sat, u_bri: p.bri, u_con: p.con,
      u_gam: p.gamma, u_temp: p.temp, u_cm: p.cm, u_mix: p.mix / 100, u_op: p.opacity / 100,
    }),
  },
  {
    type: 'bccRippleDissolve', label: 'BCC Ripple Dissolve', category: 'Transições', plugin: 'BCC Ripple Dissolve',
    description: 'Ondas saem do centro com luz nas cristas enquanto a camada se dissolve (revela o que está embaixo). Animation Auto usa Dissolve Duration (quadros).',
    params: [
      sel('animation', 'Animation', ['Auto', 'Pct. Done'], 1), num('percent', 'Percent Done', 50, 0, 100), num('duration', 'Dissolve Duration (quadros)', 60, 1, 600, 1),
      num('radiusPeak', 'Radius Peak', 500, 0, 4000), pos('center', 'Center'), num('height', 'Height', 50, 0, 500), num('waveWidth', 'Wave Width', 50, 1, 500),
      num('widthInc', 'Width Percent Increase', 300, 0, 1000), num('speed', 'Speed', 20, -100, 100), num('phase', 'Phase', 0, -360, 360),
      num('light', 'Light Level', 150, 0, 500), col('lightColor', 'Light Color', [1, 1, 1, 1]), num('lightWidth', 'Light Width', 50, 0, 100),
      ang('lightAngle', 'Light Angle', 55), num('lightElev', 'Light Elevation', 75, 0, 90),
      sel('applyMode', 'Apply Mode (luz)', ['Normal', 'Add'], 2),
    ],
    render: (src, p, env) => {
      const pr = p.animation === 1 ? Math.min(1, Math.max(0, (env.t * (env.fps || 30)) / Math.max(1, p.duration))) : p.percent / 100;
      if (pr <= 0) return src;
      return env.gl.pass(RIPPLEDISS, {
        u_tex: src, u_p: pr, u_rad: p.radiusPeak * env.scale, u_h: p.height * env.scale, u_ww: p.waveWidth * env.scale, u_wInc: p.widthInc, u_spd: p.speed * 0.3,
        u_ph: rad(p.phase), u_light: p.light / 100, u_lw: p.lightWidth, u_lang: rad(p.lightAngle), u_lel: rad(p.lightElev), u_mode: p.applyMode === 2 ? 1 : 0,
        u_dissolve: 4, u_c: cuv(env, p.center), u_lc: rgb(p.lightColor),
      });
    },
  },
];
