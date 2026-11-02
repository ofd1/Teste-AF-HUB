// Mais efeitos do After Effects e de plugins populares em edits:
// Time Remap, Keylight (chroma key), Pixel Sorter, Starglow / S_Glint, CC Light Sweep, Camera Lens Blur,
// Curves, Tritone / CC Toner, Ripple (CC Ripple Pulse), Polar Coordinates, Offset, Fractal Noise.
import { frag, num, ang, bool, sel, pos, col, rgb, rad, cuv } from './common.js';

const KEY = frag(`
uniform vec3 u_key; uniform float u_tol, u_soft, u_spill, u_show;
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv));
  // distância de cor no plano de crominância (como o Keylight: separa a cor da tela, não o brilho)
  vec3 yuvC = vec3(luma(c.rgb), c.b - luma(c.rgb), c.r - luma(c.rgb));
  vec3 yuvK = vec3(luma(u_key), u_key.b - luma(u_key), u_key.r - luma(u_key));
  float d = length(yuvC.yz - yuvK.yz) * 2.0;
  float a = smoothstep(u_tol, u_tol + u_soft, d);
  // remove o "vazamento" verde/azul das bordas
  vec3 r = c.rgb;
  float lim = (r.r + r.b) * 0.5;
  if (u_key.g >= u_key.r && u_key.g >= u_key.b) r.g = mix(r.g, min(r.g, lim), u_spill);
  else if (u_key.b >= u_key.r) r.b = mix(r.b, min(r.b, (r.r + r.g) * 0.5), u_spill);
  if (u_show > 0.5) { gl_FragColor = vec4(vec3(a), 1.0) * c.a; return; }
  gl_FragColor = pre(vec4(r, c.a * a));
}`);

// Pixel Sorter (aproximação em tempo real): arrasta os pixels mais claros que o limiar na direção escolhida
const PSORT = frag(`
uniform vec2 u_dir; uniform float u_len, u_lo, u_hi;
void main() {
  vec4 base = texture2D(u_tex, v_uv);
  float lb = luma(base.rgb / max(base.a, 1e-4));
  vec4 best = base; float bl = lb;
  if (lb < u_lo || lb > u_hi) { gl_FragColor = base; return; }
  for (int i = 1; i <= 48; i++) {
    float k = float(i) / 48.0;
    vec2 uv = v_uv - u_dir * k * u_len;
    vec4 s = texture2D(u_tex, uv);
    float l = luma(s.rgb / max(s.a, 1e-4));
    if (l < u_lo || l > u_hi) break; // o "intervalo" termina onde sai do limiar
    if (l > bl) { bl = l; best = s; }
  }
  gl_FragColor = mix(base, best, 0.85);
}`);

const BRIGHT = frag(`
uniform float u_thr;
void main() { vec4 c = texture2D(u_tex, v_uv); float l = luma(c.rgb / max(c.a, 1e-4)); gl_FragColor = c * smoothstep(u_thr, u_thr + 0.12, l); }`);
const STREAK = frag(`
uniform vec2 u_dir; uniform float u_len;
void main() {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -24; i <= 24; i++) {
    float k = float(i) / 24.0;
    float w = pow(1.0 - abs(k), 2.0);
    acc += texture2D(u_tex, v_uv + u_dir * k * u_len) * w; ws += w;
  }
  gl_FragColor = acc / ws;
}`);
const ADDC = frag(`
uniform sampler2D u_tex2; uniform float u_amount; uniform vec3 u_col;
void main() { vec4 a = texture2D(u_tex, v_uv), b = texture2D(u_tex2, v_uv); gl_FragColor = vec4(min(a.rgb + b.rgb * u_col * u_amount, vec3(max(a.a, 1.0))), max(a.a, min(1.0, luma(b.rgb) * u_amount))); }`);

const SWEEP = frag(`
uniform vec2 u_c; uniform float u_dirA, u_width, u_int, u_shape; uniform vec3 u_col;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec2 d = (v_uv - u_c) * u_size;
  float x = dot(d, vec2(cos(u_dirA), sin(u_dirA)));
  float w = max(u_width, 1.0);
  float f = u_shape < 1.5 ? max(0.0, 1.0 - abs(x) / w) : u_shape < 2.5 ? exp(-x * x / (w * w * 0.3)) : step(abs(x), w * 0.5);
  gl_FragColor = vec4(c.rgb + u_col * f * u_int * c.a, c.a);
}`);

// desfoque de lente (bokeh em disco, realça pontos de luz como no Camera Lens Blur)
const LENS = frag(`
uniform float u_r, u_gain;
void main() {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int ring = 0; ring <= 4; ring++) {
    float rr = float(ring) / 4.0;
    int n = ring == 0 ? 1 : ring * 8;
    for (int k = 0; k < 32; k++) {
      if (k >= n) break;
      float a = 6.2831853 * float(k) / float(n) + float(ring) * 0.37;
      vec4 s = texture2D(u_tex, v_uv + vec2(cos(a), sin(a)) * rr * u_r * u_texel);
      float w = 1.0 + u_gain * pow(luma(s.rgb), 4.0) * 8.0;
      acc += s * w; ws += w;
    }
  }
  gl_FragColor = acc / ws;
}`);

// Curves do AE importado: tabelas (RGB, R, G, B) com 17 pontos cada, interpoladas suavemente
const CURVES_LUT = frag(`
uniform float u_m[17], u_r[17], u_g[17], u_b[17];
float lut(float x, int ch) {
  float f = clamp(x, 0.0, 1.0) * 16.0; int i = int(floor(f)); float t = f - float(i);
  float a = 0.0, b = 0.0;
  for (int k = 0; k < 17; k++) {
    float v = ch == 0 ? u_m[k] : ch == 1 ? u_r[k] : ch == 2 ? u_g[k] : u_b[k];
    if (k == i) a = v; if (k == i + 1) b = v;
  }
  if (i >= 16) return a;
  return mix(a, b, t);
}
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv)); vec3 r = c.rgb;
  r = vec3(lut(r.r, 0), lut(r.g, 0), lut(r.b, 0));
  r = vec3(lut(r.r, 1), lut(r.g, 2), lut(r.b, 3));
  gl_FragColor = vec4(r * c.a, c.a);
}`);
const CURVES = frag(`
uniform vec2 u_p[3]; uniform float u_ch;
float curve(float x) {
  vec2 a = vec2(0.0), b = u_p[0];
  if (x > u_p[0].x) { a = u_p[0]; b = u_p[1]; }
  if (x > u_p[1].x) { a = u_p[1]; b = u_p[2]; }
  if (x > u_p[2].x) { a = u_p[2]; b = vec2(1.0); }
  float t = clamp((x - a.x) / max(b.x - a.x, 1e-4), 0.0, 1.0);
  return mix(a.y, b.y, t * t * (3.0 - 2.0 * t));
}
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv)); vec3 r = c.rgb;
  if (u_ch < 1.5) r = vec3(curve(r.r), curve(r.g), curve(r.b));
  else if (u_ch < 2.5) r.r = curve(r.r); else if (u_ch < 3.5) r.g = curve(r.g); else r.b = curve(r.b);
  gl_FragColor = pre(vec4(clamp(r, 0.0, 1.0), c.a));
}`);

const TRITONE = frag(`
uniform vec3 u_s, u_m, u_h; uniform float u_mix;
void main() {
  vec4 c = unpre(texture2D(u_tex, v_uv));
  float l = luma(c.rgb);
  vec3 t = l < 0.5 ? mix(u_s, u_m, l * 2.0) : mix(u_m, u_h, (l - 0.5) * 2.0);
  gl_FragColor = pre(vec4(mix(c.rgb, t, u_mix), c.a));
}`);

const RIPPLE = frag(`
uniform vec2 u_c; uniform float u_amp, u_wl, u_phase, u_rad;
void main() {
  vec2 px = (v_uv - u_c) * u_size;
  float d = length(px);
  float fall = u_rad > 0.0 ? max(0.0, 1.0 - d / u_rad) : 1.0;
  float o = sin(d / max(u_wl, 1.0) * 6.2831853 - u_phase) * u_amp * fall;
  vec2 dir = d > 0.001 ? px / d : vec2(0.0);
  gl_FragColor = samp((u_c * u_size + px + dir * o) / u_size);
}`);

const POLAR = frag(`
uniform float u_amt, u_mode;
void main() {
  vec2 cu = contentUV(v_uv);
  vec2 res;
  if (u_mode < 1.5) { // retangular → polar
    vec2 d = cu - 0.5; float r = length(d) * 2.0; float a = atan(d.x, -d.y) / 6.2831853 + 0.5;
    res = vec2(a, r);
  } else {           // polar → retangular
    float a = (cu.x - 0.5) * 6.2831853; float r = cu.y * 0.5;
    res = vec2(0.5 + sin(a) * r, 0.5 - cos(a) * r);
  }
  vec2 q = mix(cu, res, u_amt);
  gl_FragColor = (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? vec4(0.0) : texture2D(u_tex, fromContent(q));
}`);

const OFFSET = frag(`
uniform vec2 u_off; uniform float u_blend;
void main() {
  vec2 cu = fract(contentUV(v_uv) - u_off);
  gl_FragColor = mix(texture2D(u_tex, fromContent(cu)), texture2D(u_tex, v_uv), u_blend);
}`);

const FRACTAL = frag(`
uniform float u_nscale, u_evo, u_contrast, u_bright, u_cx, u_op, u_mode, u_turb;
void main() {
  vec2 p = contentUV(v_uv) * u_size / max(u_nscale, 1.0);
  float n = 0.0, a = 0.5;
  vec2 q = p + vec2(u_evo * 0.7, u_evo * 0.3);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= u_cx) break;
    float v = vnoise(q);
    n += (u_turb > 0.5 ? abs(v * 2.0 - 1.0) : v) * a;
    q = q * 2.03 + vec2(u_evo * 0.11, -u_evo * 0.07); a *= 0.5;
  }
  n = clamp((n - 0.5) * u_contrast + 0.5 + u_bright, 0.0, 1.0);
  vec4 c = texture2D(u_tex, v_uv);
  vec3 o = u_mode < 1.5 ? vec3(n) : u_mode < 2.5 ? c.rgb + vec3(n) * c.a : c.rgb * (1.0 - n) + c.rgb * n * 2.0 * n;
  if (u_mode < 1.5) gl_FragColor = mix(c, vec4(o, 1.0), u_op);
  else gl_FragColor = vec4(mix(c.rgb, min(o, vec3(c.a)), u_op), c.a);
}`);

export default [
  {
    type: 'timeRemap', label: 'Time Remap (remapear tempo)', category: 'Tempo', plugin: 'Time Remapping (After Effects)',
    description: 'Como o Time Remapping do AE: o valor "Tempo do vídeo" diz qual segundo do arquivo aparece em cada momento. Anime com keyframes para congelar, acelerar, voltar (reverse) ou repetir. Ao adicionar, já vem com 2 keyframes (início e fim) — mova-os ou crie novos.',
    params: [num('time', 'Tempo do vídeo (s)', 0, 0, 3600, 0.01), bool('frameBlend', 'Interpolação (fluxo óptico)', true)],
    sourceRemap: true,
    init: (fx, layer) => {
      const s0 = layer.props.sourceStart || 0, d = (layer.outPoint - layer.inPoint) * (layer.props.speed ?? 1);
      fx.params.time = { value: s0, keys: [{ t: layer.inPoint, v: s0, ease: 'linear' }, { t: layer.outPoint, v: +(s0 + d).toFixed(3), ease: 'linear' }] };
    },
  },
  {
    type: 'keylight', label: 'Keylight (chroma key)', category: 'Estilizar', plugin: 'Keylight 1.2 / Primatte',
    description: 'Remove fundo verde/azul (tela chroma). Escolha a cor da tela e ajuste a tolerância.',
    params: [col('key', 'Cor da tela', [0.1, 0.85, 0.2, 1]), num('tolerance', 'Tolerância', 18, 0, 100), num('softness', 'Suavidade da borda', 12, 0, 100), num('spill', 'Remover vazamento %', 80, 0, 100), bool('showMatte', 'Ver máscara', false)],
    render: (src, p, env) => env.gl.pass(KEY, { u_tex: src, u_key: rgb(p.key), u_tol: p.tolerance / 100, u_soft: Math.max(0.005, p.softness / 100), u_spill: p.spill / 100, u_show: p.showMatte }),
  },
  {
    type: 'pixelSort', label: 'Pixel Sorter', category: 'Estilizar', plugin: 'Pixel Sorter / AE Pixel Sorter',
    description: 'Estica os pixels claros (dentro do limiar) numa direção, como o efeito de “pixel sorting” das edits.',
    params: [ang('angle', 'Direção', 90), num('length', 'Comprimento %', 25, 0, 100), num('low', 'Limiar mínimo %', 45, 0, 100), num('high', 'Limiar máximo %', 100, 0, 100)],
    render: (src, p, env) => {
      if (p.length <= 0) return src;
      const a = rad(p.angle);
      return env.gl.pass(PSORT, { u_tex: src, u_dir: [Math.cos(a), Math.sin(a)], u_len: p.length / 100, u_lo: p.low / 100, u_hi: p.high / 100 });
    },
  },
  {
    type: 'starGlow', label: 'Starglow / S_Glint (estrelas)', category: 'Luz e brilho', plugin: 'Trapcode Starglow / S_Glint',
    description: 'Raios em estrela saindo das partes mais claras (4, 6 ou 8 pontas).',
    params: [num('threshold', 'Limiar %', 70, 0, 100), num('length', 'Comprimento', 60, 1, 400), num('amount', 'Intensidade', 1.2, 0, 6, 0.05), sel('rays', 'Pontas', ['4', '6', '8'], 1), ang('angle', 'Rotação', 45), col('color', 'Cor', [1, 0.95, 0.85, 1])],
    pad: (p) => p.length,
    render: (src, p, env) => {
      const { gl } = env;
      const hi = gl.pass(BRIGHT, { u_tex: src, u_thr: p.threshold / 100 });
      const n = [0, 2, 3, 4][p.rays] || 2;
      let out = src;
      for (let i = 0; i < n; i++) {
        const a = rad(p.angle) + (Math.PI / n) * i;
        const s = gl.pass(STREAK, { u_tex: hi, u_dir: [Math.cos(a) / env.W, Math.sin(a) / env.H], u_len: p.length * env.scale });
        out = gl.pass(ADDC, { u_tex: out, u_tex2: s, u_amount: p.amount, u_col: rgb(p.color) });
      }
      return out;
    },
  },
  {
    type: 'lightSweep', label: 'CC Light Sweep', category: 'Luz e brilho', plugin: 'CC Light Sweep',
    description: 'Faixa de luz que atravessa a imagem (anime o centro para o brilho passar por textos e logos).',
    params: [pos('center', 'Centro', [0.2, 0.5]), ang('direction', 'Direção', 35), sel('shape', 'Forma', ['Linear', 'Suave', 'Dura'], 2), num('width', 'Largura', 60, 1, 800), num('intensity', 'Intensidade', 0.9, 0, 4, 0.05), col('color', 'Cor', [1, 1, 1, 1])],
    render: (src, p, env) => env.gl.pass(SWEEP, { u_tex: src, u_c: cuv(env, p.center), u_dirA: rad(p.direction), u_width: p.width * env.scale, u_int: p.intensity, u_shape: p.shape, u_col: rgb(p.color) }),
  },
  {
    type: 'lensBlur', label: 'Camera Lens Blur (bokeh)', category: 'Desfoque', plugin: 'Camera Lens Blur / S_RackDefocus',
    description: 'Desfoque de lente com bokeh redondo: os pontos de luz viram círculos (anime o raio para foco/desfoque).',
    params: [num('radius', 'Raio do desfoque', 12, 0, 120, 0.5), num('highlights', 'Realce dos pontos de luz', 1, 0, 5, 0.05)],
    pad: (p) => p.radius,
    render: (src, p, env) => (p.radius * env.scale < 0.5 ? src : env.gl.pass(LENS, { u_tex: src, u_r: p.radius * env.scale, u_gain: p.highlights })),
  },
  {
    type: 'curves', label: 'Curves (curvas)', category: 'Cor', plugin: 'Curves (After Effects)',
    description: 'Curva de tons com 3 pontos (sombras, meios-tons, realces) em RGB ou num canal.',
    params: [sel('channel', 'Canal', ['RGB', 'Vermelho', 'Verde', 'Azul'], 1), num('shadows', 'Sombras (25%)', 25, 0, 100), num('mids', 'Meios-tons (50%)', 50, 0, 100), num('highs', 'Realces (75%)', 75, 0, 100),
      { key: 'lut', label: 'Curva do AE', kind: 'hidden', default: null }],
    render: (src, p, env) => {
      // curva exata importada do Curves do After Effects (tabelas de 256 valores reduzidas a 17 pontos por canal)
      if (Array.isArray(p.lut) && p.lut.length === 68) {
        const t = (i) => ({ f1: p.lut.slice(i * 17, i * 17 + 17) });
        return env.gl.pass(CURVES_LUT, { u_tex: src, u_m: t(0), u_r: t(1), u_g: t(2), u_b: t(3) });
      }
      return env.gl.pass(CURVES, { u_tex: src, u_ch: p.channel, u_p: { vec2: [0.25, p.shadows / 100, 0.5, p.mids / 100, 0.75, p.highs / 100] } });
    },
  },
  {
    type: 'tritone', label: 'Tritone / CC Toner', category: 'Cor', plugin: 'Tritone / CC Toner',
    params: [col('shadows', 'Sombras', [0.05, 0.08, 0.2, 1]), col('midtones', 'Meios-tons', [0.55, 0.42, 0.35, 1]), col('highlights', 'Realces', [1, 0.95, 0.85, 1]), num('mix', 'Mistura com o original %', 100, 0, 100)],
    render: (src, p, env) => env.gl.pass(TRITONE, { u_tex: src, u_s: rgb(p.shadows), u_m: rgb(p.midtones), u_h: rgb(p.highlights), u_mix: p.mix / 100 }),
  },
  {
    type: 'ripple', label: 'Ripple (ondas)', category: 'Distorção', plugin: 'Ripple / CC Ripple Pulse',
    params: [pos('center', 'Centro', [0.5, 0.5]), num('amplitude', 'Amplitude', 12, 0, 200), num('wavelength', 'Comprimento de onda', 60, 2, 600), num('speed', 'Velocidade', 2, -20, 20, 0.1), num('radius', 'Raio (0 = tudo)', 0, 0, 3000)],
    render: (src, p, env) => env.gl.pass(RIPPLE, { u_tex: src, u_c: cuv(env, p.center), u_amp: p.amplitude * env.scale, u_wl: p.wavelength * env.scale, u_phase: env.t * p.speed * 6.2831853, u_rad: p.radius * env.scale }),
  },
  {
    type: 'polar', label: 'Polar Coordinates', category: 'Distorção', plugin: 'Polar Coordinates',
    params: [num('amount', 'Interpolação %', 100, 0, 100), sel('mode', 'Conversão', ['Retangular → polar', 'Polar → retangular'], 1)],
    render: (src, p, env) => env.gl.pass(POLAR, { u_tex: src, u_amt: p.amount / 100, u_mode: p.mode }),
  },
  {
    type: 'offset', label: 'Offset (deslocar com repetição)', category: 'Distorção', plugin: 'Offset',
    description: 'Desloca a imagem e repete as bordas (bom para transições de “slide” sem buracos).',
    params: [num('x', 'Deslocamento X %', 0, -400, 400, 0.5), num('y', 'Deslocamento Y %', 0, -400, 400, 0.5), num('blend', 'Mistura com o original %', 0, 0, 100)],
    render: (src, p, env) => env.gl.pass(OFFSET, { u_tex: src, u_off: [p.x / 100, p.y / 100], u_blend: p.blend / 100 }),
  },
  {
    type: 'fractalNoise', label: 'Fractal Noise', category: 'Estilizar', plugin: 'Fractal Noise',
    description: 'Ruído fractal (fumaça, textura, luz). Anime "Evolução". Modo Somar/Overlay para textura sobre o vídeo.',
    params: [sel('mode', 'Modo', ['Substituir', 'Somar', 'Overlay'], 3), bool('turbulent', 'Turbulento', false), num('scale', 'Escala', 120, 4, 2000), num('complexity', 'Complexidade', 6, 1, 8, 1), num('evolution', 'Evolução', 0, -100, 100, 0.01), num('speed', 'Evolução automática /s', 0.3, -10, 10, 0.01), num('contrast', 'Contraste', 1.4, 0, 6, 0.05), num('brightness', 'Brilho', 0, -1, 1, 0.01), num('opacity', 'Opacidade %', 40, 0, 100)],
    render: (src, p, env) => env.gl.pass(FRACTAL, { u_tex: src, u_nscale: p.scale * env.scale, u_evo: p.evolution + env.t * p.speed, u_contrast: p.contrast, u_bright: p.brightness, u_cx: p.complexity, u_op: p.opacity / 100, u_mode: p.mode, u_turb: p.turbulent }),
  },
];
