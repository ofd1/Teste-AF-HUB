// Estilizar e transições: Drop Shadow, Contorno, Mosaico, Vinheta, Ruído/Grão, Aberração cromática,
// Prisma (BCC Prism), Glitch (BCC/S_DigitalDamage), VHS, Find Edges, Film Look (S_FilmEffect),
// Linear/Radial Wipe, Venetian Blinds, Block Dissolve.
import { frag, num, ang, col, bool, sel, pos, rad, cuv, rgb } from './common.js';

const SHADOW = frag(`
uniform sampler2D u_tex2; uniform vec2 u_off; uniform vec3 u_color; uniform float u_op; uniform float u_only;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float a = texture2D(u_tex2, v_uv - u_off).a * u_op;
  vec4 sh = vec4(u_color * a, a);
  gl_FragColor = u_only > 0.5 ? sh * (1.0 - s.a) : s + sh * (1.0 - s.a);
}`);

const OUTLINE = frag(`
uniform sampler2D u_tex2; uniform vec3 u_color; uniform float u_only;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float a = smoothstep(0.02, 0.18, texture2D(u_tex2, v_uv).a);
  vec4 o = vec4(u_color * a, a);
  gl_FragColor = u_only > 0.5 ? o * (1.0 - s.a) : s + o * (1.0 - s.a);
}`);

const MOSAIC = frag(`
uniform vec2 u_n; uniform float u_sharp;
void main() {
  vec2 cu = contentUV(v_uv);
  vec2 q = (floor(cu * u_n) + 0.5) / u_n;
  gl_FragColor = texture2D(u_tex, fromContent(q));
}`);

const VIGNETTE = frag(`
uniform float u_amount; uniform float u_size2; uniform float u_feather; uniform vec3 u_color; uniform float u_round;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 cu = contentUV(v_uv) - 0.5;
  vec2 asp = u_round > 0.5 ? vec2(u_rect.z * u_size.x, u_rect.w * u_size.y) / max(u_rect.z * u_size.x, u_rect.w * u_size.y) : vec2(1.0);
  float d = length(cu * asp) * 1.4142;
  float v = smoothstep(u_size2, u_size2 + u_feather, d) * u_amount;
  gl_FragColor = vec4(mix(s.rgb, u_color * s.a, v), s.a);
}`);

const NOISE = frag(`
uniform float u_amount; uniform float u_seed; uniform float u_color; uniform float u_size2;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 px = floor(v_uv * u_size / u_size2);
  float n = hash(px + u_seed) - 0.5;
  vec3 nn = u_color > 0.5 ? vec3(hash(px + u_seed + 1.3), hash(px + u_seed + 2.7), hash(px + u_seed + 4.1)) - 0.5 : vec3(n);
  gl_FragColor = vec4(clamp(s.rgb + nn * u_amount * s.a, 0.0, 1.0), s.a);
}`);

const RGBSPLIT = frag(`
uniform vec2 u_off; uniform float u_mode; uniform vec2 u_c; uniform float u_amt;
void main() {
  vec2 o = u_mode < 1.5 ? u_off : (v_uv - u_c) * u_amt;
  vec4 r = samp(v_uv + o), g = texture2D(u_tex, v_uv), b = samp(v_uv - o);
  gl_FragColor = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
}`);

const PRISM = frag(`
uniform vec2 u_off; uniform float u_mode; uniform vec2 u_c; uniform float u_amt;
void main() {
  vec2 o = u_mode < 1.5 ? u_off : (v_uv - u_c) * u_amt;
  vec3 acc = vec3(0.0), wsum = vec3(0.0); float al = 0.0;
  for (int i = 0; i < 9; i++) {
    float f = float(i) / 8.0;
    vec3 w = clamp(hsv2rgb(vec3(f * 0.8, 1.0, 1.0)), 0.0, 1.0);
    vec4 s = samp(v_uv + o * (f - 0.5) * 2.0);
    acc += s.rgb * w; wsum += w; al = max(al, s.a);
  }
  gl_FragColor = vec4(acc / wsum, al);
}`);

const GLITCH = frag(`
uniform float u_amount; uniform float u_block; uniform float u_frame; uniform float u_shift; uniform float u_rgb; uniform float u_seed;
void main() {
  vec2 px = v_uv * u_size;
  float by = floor(px.y / u_block);
  float bx = floor(px.x / (u_block * 4.0));
  float r = hash(vec2(by, u_frame + u_seed));
  vec2 uv = v_uv;
  float hit = step(r, u_amount);
  uv.x += hit * (hash(vec2(by + 7.0, u_frame)) - 0.5) * 2.0 * u_shift;
  float blk = step(hash(vec2(bx, by + u_frame * 3.0 + u_seed)), u_amount * 0.25);
  uv += blk * (vec2(hash(vec2(bx, u_frame)), hash(vec2(by, u_frame + 1.0))) - 0.5) * u_shift * 0.6;
  float rs = (hit + blk) * u_rgb + u_rgb * 0.15;
  vec4 c = samp(uv), cr = samp(uv + vec2(rs, 0.0)), cb = samp(uv - vec2(rs, 0.0));
  gl_FragColor = vec4(cr.r, c.g, cb.b, max(c.a, max(cr.a, cb.a)));
}`);

const VHS = frag(`
uniform float u_amount; uniform float u_lines; uniform float u_noise; uniform float u_chroma; uniform float u_jitter; uniform float u_seed;
void main() {
  vec2 px = v_uv * u_size;
  float t = u_time + u_seed;
  float j = (vnoise(vec2(px.y * 0.03, t * 6.0)) - 0.5) * u_jitter + (hash(vec2(floor(px.y / 3.0), floor(t * 24.0))) - 0.5) * u_jitter * 0.3;
  float band = smoothstep(0.98, 1.0, sin(v_uv.y * 3.0 - t * 2.0)) * u_jitter * 3.0;
  vec2 uv = v_uv + vec2((j + band) / u_size.x, 0.0);
  vec4 c = samp(uv);
  vec4 cr = samp(uv + vec2(u_chroma / u_size.x, 0.0)), cb = samp(uv - vec2(u_chroma / u_size.x, 0.0));
  vec3 col = vec3(cr.r, c.g, cb.b);
  float a = max(c.a, max(cr.a, cb.a));
  col = mix(col, vec3(luma(col)) * vec3(1.05, 1.0, 0.92), 0.2 * u_amount);
  col *= 1.0 - u_lines * 0.35 * (0.5 + 0.5 * sin(px.y * PI * 0.5));
  col += (hash(px + floor(t * 30.0)) - 0.5) * u_noise * a;
  gl_FragColor = vec4(mix(c.rgb, clamp(col, 0.0, 1.0), u_amount), a);
}`);

const EDGES = frag(`
uniform float u_invert; uniform float u_blend;
void main() {
  vec2 e = u_texel;
  float tl = luma(texture2D(u_tex, v_uv + e * vec2(-1., -1.)).rgb), t = luma(texture2D(u_tex, v_uv + e * vec2(0., -1.)).rgb), tr = luma(texture2D(u_tex, v_uv + e * vec2(1., -1.)).rgb);
  float l = luma(texture2D(u_tex, v_uv + e * vec2(-1., 0.)).rgb), r = luma(texture2D(u_tex, v_uv + e * vec2(1., 0.)).rgb);
  float bl = luma(texture2D(u_tex, v_uv + e * vec2(-1., 1.)).rgb), b = luma(texture2D(u_tex, v_uv + e * vec2(0., 1.)).rgb), br = luma(texture2D(u_tex, v_uv + e * vec2(1., 1.)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br, gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float g = clamp(length(vec2(gx, gy)) * 2.0, 0.0, 1.0);
  vec4 s = texture2D(u_tex, v_uv);
  vec3 ed = u_invert > 0.5 ? vec3(g) : vec3(1.0 - g);
  gl_FragColor = vec4(mix(ed * s.a, s.rgb, u_blend), s.a);
}`);

const FILM = frag(`
uniform float u_grain; uniform float u_vig; uniform float u_flicker; uniform float u_warm; uniform float u_scratch; uniform float u_fade;
void main() {
  vec4 s = unpre(texture2D(u_tex, v_uv));
  vec3 c = s.rgb;
  float fr = floor(u_time * 24.0);
  c *= 1.0 + (hash1(fr) - 0.5) * u_flicker;
  c += vec3(u_warm, u_warm * 0.3, -u_warm) * 0.08;
  c = mix(c, vec3(0.1) + c * 0.85, u_fade);
  vec2 px = v_uv * u_size;
  c += (hash(px * 0.7 + fr) - 0.5) * u_grain;
  vec2 cu = contentUV(v_uv) - 0.5;
  c *= 1.0 - smoothstep(0.35, 0.85, length(cu) * 1.4142) * u_vig;
  float sx = hash1(fr * 1.7) ;
  float line = step(0.6, hash1(fr * 3.1)) * smoothstep(1.5, 0.0, abs(px.x - sx * u_size.x)) * u_scratch;
  c += line * 0.5;
  gl_FragColor = pre(vec4(clamp(c, 0.0, 1.0), s.a));
}`);

const LINEAR_WIPE = frag(`
uniform float u_comp; uniform vec2 u_dir; uniform float u_feather;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 px = (contentUV(v_uv) - 0.5) * u_rect.zw * u_size;
  vec2 half_ = u_rect.zw * u_size * 0.5;
  float ext = abs(u_dir.x) * half_.x + abs(u_dir.y) * half_.y + u_feather;
  float pos = dot(px, u_dir);
  float edge = mix(-ext, ext, u_comp);
  float k = smoothstep(edge - u_feather * 0.5 - 0.5, edge + u_feather * 0.5 + 0.5, pos);
  gl_FragColor = s * k;
}`);

const RADIAL_WIPE = frag(`
uniform float u_comp; uniform float u_start; uniform float u_dirn; uniform vec2 u_c; uniform float u_feather;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 d = (v_uv - u_c) * u_size;
  float a = atan(d.x, -d.y) - u_start;
  a = mod(a * u_dirn, 2.0 * PI) / (2.0 * PI);
  float k = smoothstep(u_comp, u_comp + u_feather + 0.0005, a);
  gl_FragColor = s * k;
}`);

const BLINDS = frag(`
uniform float u_comp; uniform vec2 u_dir; uniform float u_w; uniform float u_feather;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float p = fract(dot(v_uv * u_size, u_dir) / u_w);
  float k = smoothstep(u_comp - u_feather, u_comp + u_feather + 0.0001, p);
  gl_FragColor = s * k;
}`);

const DISSOLVE = frag(`
uniform float u_comp; uniform float u_block; uniform float u_seed;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float h = hash(floor(v_uv * u_size / u_block) + u_seed);
  gl_FragColor = s * step(u_comp, h);
}`);

const dirVec = (a) => [Math.sin(rad(a)), -Math.cos(rad(a))];

export default [
  {
    type: 'dropShadow', label: 'Sombra projetada', category: 'Estilizar',
    params: [col('color', 'Cor', [0, 0, 0, 1]), num('opacity', 'Opacidade %', 50, 0, 100), ang('angle', 'Direção', 135), num('distance', 'Distância', 12, 0, 500), num('softness', 'Suavidade', 12, 0, 300), bool('only', 'Só a sombra')],
    pad: (p) => p.distance + p.softness * 1.5,
    render: (src, p, env) => {
      const { gl } = env;
      const b = gl.blur(src, p.softness * 0.5 * env.scale);
      return gl.pass(SHADOW, {
        u_tex: src, u_tex2: b, u_color: rgb(p.color), u_op: p.opacity / 100, u_only: p.only,
        u_off: [Math.sin(rad(p.angle)) * p.distance * env.scale / env.W, -Math.cos(rad(p.angle)) * p.distance * env.scale / env.H],
      });
    },
  },
  {
    type: 'outline', label: 'Contorno (Stroke)', category: 'Estilizar',
    params: [num('size', 'Espessura', 8, 0, 200, 0.5), col('color', 'Cor', [1, 1, 1, 1]), bool('only', 'Só o contorno')],
    pad: (p) => p.size * 2,
    render: (src, p, env) => {
      if (p.size <= 0) return src;
      const b = env.gl.blur(src, p.size * 0.55 * env.scale);
      return env.gl.pass(OUTLINE, { u_tex: src, u_tex2: b, u_color: rgb(p.color), u_only: p.only });
    },
  },
  {
    type: 'mosaic', label: 'Mosaico / Pixelar', category: 'Estilizar',
    params: [num('hBlocks', 'Blocos horizontais', 20, 1, 400), num('vBlocks', 'Blocos verticais', 20, 1, 400)],
    render: (src, p, env) => env.gl.pass(MOSAIC, { u_tex: src, u_n: [Math.max(1, p.hBlocks), Math.max(1, p.vBlocks)] }),
  },
  {
    type: 'vignette', label: 'Vinheta', category: 'Estilizar',
    params: [num('amount', 'Quantidade %', 60, 0, 100), num('size', 'Tamanho %', 45, 0, 100), num('feather', 'Suavidade %', 50, 1, 100), col('color', 'Cor', [0, 0, 0, 1]), bool('round', 'Circular', false)],
    render: (src, p, env) => env.gl.pass(VIGNETTE, { u_tex: src, u_amount: p.amount / 100, u_size2: p.size / 100, u_feather: p.feather / 100, u_color: rgb(p.color), u_round: p.round }),
  },
  {
    type: 'noise', label: 'Ruído / Grão', category: 'Estilizar',
    params: [num('amount', 'Quantidade %', 20, 0, 100), num('size', 'Tamanho do grão', 1, 1, 8, 0.5), bool('animated', 'Animado', true), bool('color', 'Colorido')],
    render: (src, p, env) => env.gl.pass(NOISE, { u_tex: src, u_amount: p.amount / 100, u_size2: p.size * env.scale, u_color: p.color, u_seed: p.animated ? Math.floor(env.t * 24) * 0.37 : 0.5 }),
  },
  {
    type: 'rgbSplit', label: 'Aberração cromática (RGB)', category: 'Estilizar', plugin: 'S_WarpChroma / BCC Chromatic Aberration',
    params: [sel('mode', 'Modo', ['Linear', 'Radial']), num('amount', 'Deslocamento', 8, 0, 200, 0.5), ang('angle', 'Ângulo', 90), pos('center', 'Centro (radial)')],
    pad: (p) => p.amount,
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(RGBSPLIT, {
      u_tex: src, u_mode: p.mode, u_c: cuv(env, p.center), u_amt: p.amount / 500,
      u_off: [Math.sin(rad(p.angle)) * p.amount * env.scale / env.W, -Math.cos(rad(p.angle)) * p.amount * env.scale / env.H],
    })),
  },
  {
    type: 'prism', label: 'Prisma (dispersão)', category: 'Estilizar', plugin: 'BCC Prism',
    params: [sel('mode', 'Modo', ['Linear', 'Radial']), num('amount', 'Dispersão', 15, 0, 300, 0.5), ang('angle', 'Ângulo', 90), pos('center', 'Centro (radial)')],
    pad: (p) => p.amount,
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(PRISM, {
      u_tex: src, u_mode: p.mode, u_c: cuv(env, p.center), u_amt: p.amount / 400,
      u_off: [Math.sin(rad(p.angle)) * p.amount * env.scale / env.W, -Math.cos(rad(p.angle)) * p.amount * env.scale / env.H],
    })),
  },
  {
    type: 'glitch', label: 'Glitch digital', category: 'Estilizar', plugin: 'BCC Glitch / S_DigitalDamage',
    params: [num('amount', 'Quantidade %', 30, 0, 100), num('block', 'Tamanho do bloco', 24, 2, 400), num('shift', 'Deslocamento %', 8, 0, 100), num('rgb', 'Separação RGB', 6, 0, 100), num('speed', 'Velocidade (troca/s)', 12, 0, 60), num('seed', 'Semente', 1, 0, 999)],
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(GLITCH, {
      u_tex: src, u_amount: p.amount / 100, u_block: Math.max(2, p.block * env.scale), u_frame: Math.floor(env.t * p.speed), u_shift: p.shift / 100 * env.rect[2],
      u_rgb: p.rgb * env.scale / env.W, u_seed: p.seed,
    })),
  },
  {
    type: 'vhs', label: 'VHS / Retro', category: 'Estilizar', plugin: 'BCC VHS',
    params: [num('amount', 'Quantidade %', 100, 0, 100), num('lines', 'Scanlines %', 40, 0, 100), num('noise', 'Ruído %', 15, 0, 100), num('chroma', 'Sangramento de cor', 6, 0, 60), num('jitter', 'Tremor horizontal', 4, 0, 60), num('seed', 'Semente', 0, 0, 99)],
    render: (src, p, env) => env.gl.pass(VHS, { u_tex: src, u_amount: p.amount / 100, u_lines: p.lines / 100, u_noise: p.noise / 100, u_chroma: p.chroma * env.scale, u_jitter: p.jitter * env.scale, u_seed: p.seed }),
  },
  {
    type: 'findEdges', label: 'Encontrar bordas', category: 'Estilizar',
    params: [bool('invert', 'Inverter', true), num('blend', 'Mesclar com original %', 0, 0, 100)],
    render: (src, p, env) => env.gl.pass(EDGES, { u_tex: src, u_invert: p.invert, u_blend: p.blend / 100 }),
  },
  {
    type: 'filmLook', label: 'Film Look', category: 'Estilizar', plugin: 'S_FilmEffect / FilmConvert',
    params: [num('grain', 'Grão %', 12, 0, 100), num('vignette', 'Vinheta %', 50, 0, 100), num('flicker', 'Cintilação %', 6, 0, 100), num('warmth', 'Calor', 0.4, -1, 1, 0.05), num('scratch', 'Riscos %', 20, 0, 100), num('fade', 'Fade %', 15, 0, 100)],
    render: (src, p, env) => env.gl.pass(FILM, { u_tex: src, u_grain: p.grain / 100, u_vig: p.vignette / 100, u_flicker: p.flicker / 100, u_warm: p.warmth, u_scratch: p.scratch / 100, u_fade: p.fade / 100 }),
  },
  {
    type: 'linearWipe', label: 'Wipe linear', category: 'Transições',
    params: [num('completion', 'Conclusão %', 50, 0, 100), ang('angle', 'Ângulo', 90), num('feather', 'Suavidade', 20, 0, 1000)],
    render: (src, p, env) => env.gl.pass(LINEAR_WIPE, { u_tex: src, u_comp: p.completion / 100, u_dir: dirVec(p.angle), u_feather: p.feather * env.scale }),
  },
  {
    type: 'radialWipe', label: 'Wipe radial', category: 'Transições',
    params: [num('completion', 'Conclusão %', 50, 0, 100), ang('start', 'Ângulo inicial', 0), sel('direction', 'Direção', ['Horário', 'Anti-horário']), pos('center', 'Centro'), num('feather', 'Suavidade %', 2, 0, 50, 0.5)],
    render: (src, p, env) => env.gl.pass(RADIAL_WIPE, { u_tex: src, u_comp: p.completion / 100, u_start: rad(p.start), u_dirn: p.direction === 1 ? 1 : -1, u_c: cuv(env, p.center), u_feather: p.feather / 100 }),
  },
  {
    type: 'blinds', label: 'Persianas (Venetian Blinds)', category: 'Transições',
    params: [num('completion', 'Conclusão %', 50, 0, 100), ang('direction', 'Direção', 0), num('width', 'Largura', 60, 2, 1000), num('feather', 'Suavidade %', 2, 0, 50, 0.5)],
    render: (src, p, env) => env.gl.pass(BLINDS, { u_tex: src, u_comp: p.completion / 100, u_dir: dirVec(p.direction), u_w: Math.max(2, p.width * env.scale), u_feather: p.feather / 100 }),
  },
  {
    type: 'blockDissolve', label: 'Dissolver em blocos', category: 'Transições',
    params: [num('completion', 'Conclusão %', 50, 0, 100), num('block', 'Tamanho do bloco', 24, 1, 400), num('seed', 'Semente', 1, 0, 999)],
    render: (src, p, env) => env.gl.pass(DISSOLVE, { u_tex: src, u_comp: p.completion / 100, u_block: Math.max(1, p.block * env.scale), u_seed: p.seed }),
  },
];
