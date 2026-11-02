// LUT 3D (.cube) — usada pelo Looks (LUTs como Bloodbag, Maxine, Sony SLog…) e por qualquer LUT de cor.
// O WebGL1 não tem textura 3D: o cubo vira uma tira 2D (N fatias de N×N) e a interpolação entre fatias é feita no shader.
import { frag, num } from './common.js';

const LUT = frag(`
uniform sampler2D u_lut; uniform float u_n, u_amt;
vec3 lutAt(vec3 c) {
  c = clamp(c, 0.0, 1.0) * (u_n - 1.0);
  float b0 = floor(c.b), b1 = min(b0 + 1.0, u_n - 1.0), f = c.b - b0;
  vec2 p0 = vec2((b0 * u_n + c.r + 0.5) / (u_n * u_n), (c.g + 0.5) / u_n);
  vec2 p1 = vec2((b1 * u_n + c.r + 0.5) / (u_n * u_n), (c.g + 0.5) / u_n);
  return mix(texture2D(u_lut, p0).rgb, texture2D(u_lut, p1).rgb, f);
}
void main() {
  vec4 s = unpre(texture2D(u_tex, v_uv));
  vec3 o = mix(s.rgb, lutAt(s.rgb), u_amt);
  gl_FragColor = pre(vec4(o, s.a));
}`);

/** Lê um arquivo .cube → { size, data: Float32Array (r mais rápido, depois g, depois b) }. */
export function parseCube(text) {
  let size = 0; let dmin = [0, 0, 0], dmax = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { dmin = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { dmax = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]/.test(up)) continue; // TITLE, LUT_1D_SIZE…
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) vals.push(p[0], p[1], p[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('arquivo .cube sem uma LUT 3D válida');
  const data = new Float32Array(vals.slice(0, size * size * size * 3));
  for (let i = 0; i < data.length; i++) { const c = i % 3; data[i] = (data[i] - dmin[c]) / ((dmax[c] - dmin[c]) || 1); }
  return { size, data };
}

/** Reduz para no máximo 33³ e codifica em base64 (8 bits por canal) para guardar no projeto. */
export function encodeCube({ size, data }, max = 33) {
  const n = Math.min(size, max);
  const out = new Uint8Array(n * n * n * 3);
  const at = (r, g, b, c) => data[((b * size + g) * size + r) * 3 + c];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const s = (i) => Math.round((i * (size - 1)) / (n - 1));
    for (let c = 0; c < 3; c++) out[((b * n + g) * n + r) * 3 + c] = Math.max(0, Math.min(255, Math.round(at(s(r), s(g), s(b), c) * 255)));
  }
  let bin = '';
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return { size: n, b64: btoa(bin) };
}

const cache = new Map();
function lutImage(b64, n) {
  let img = cache.get(b64);
  if (img) return img;
  const bin = atob(b64);
  img = new ImageData(n * n, n);
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const si = ((b * n + g) * n + r) * 3, di = (g * n * n + b * n + r) * 4;
    img.data[di] = bin.charCodeAt(si); img.data[di + 1] = bin.charCodeAt(si + 1); img.data[di + 2] = bin.charCodeAt(si + 2); img.data[di + 3] = 255;
  }
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  cache.set(b64, img);
  return img;
}

export default [
  {
    type: 'lut3d', label: 'LUT (.cube)', category: 'Cor', plugin: 'LUT 3D / Looks LUT / Lumetri Look',
    description: 'Aplica uma LUT 3D importada (.cube). Importe pelo botão de presets: cada arquivo .cube vira um preset.',
    params: [num('amount', 'Intensidade %', 100, 0, 100), { key: 'lut', label: 'LUT', kind: 'hidden', default: '' }, { key: 'lutSize', label: 'Tamanho', kind: 'hidden', default: 0 }],
    render: (src, p, env) => {
      if (!p.lut || !p.lutSize || p.amount <= 0) return src;
      const tex = env.gl.upload(lutImage(p.lut, p.lutSize));
      return env.gl.pass(LUT, { u_tex: src, u_lut: tex, u_n: p.lutSize, u_amt: p.amount / 100 });
    },
  },
];
