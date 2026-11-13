// "Element 3D" do MotionFrame — recriação do plugin da Video Copilot com raymarching em WebGL:
// texto 3D extrudado (com chanfro), logo/PNG da própria camada extrudado, cubo, esfera, toro, cilindro e cápsula,
// materiais (plástico, cromo, ouro, metal escovado, vidro fumê, fosco, neon), luz direcional + ambiente + rim light,
// reflexo de estúdio ou do próprio vídeo, anel de réplicas (Group/Replicator) e giro automático.
import { frag, num, ang, sel, pos, col, rgb, rad, cuv } from './common.js';
import { getModel, textureUrl } from '../model3d.js';
import { getImage } from '../media.js';

const E3D = frag(`
uniform vec2 u_c; uniform float u_S, u_dc, u_kind, u_depth, u_bevel, u_A, u_mw, u_s1, u_s2, u_s3, u_count, u_ring;
uniform vec3 u_r0, u_r1, u_r2; uniform vec4 u_mr; uniform float u_marg;
uniform sampler2D u_f1, u_f2, u_f3, u_mask, u_env;
uniform vec3 u_col, u_ldir, u_lcol, u_rimc;
uniform float u_metal, u_gloss, u_refl, u_envMode, u_emis, u_glass, u_lint, u_amb, u_rim, u_comp;
uniform float u_texMode; uniform sampler2D u_dtex; uniform vec4 u_er; uniform float u_brad;

float field2(vec2 xy) {
  vec2 q = abs(xy) - vec2(0.5 * u_mw, 0.5 * u_mw * u_A);
  float db = length(max(q, 0.0));
  if (db > 0.0) return db + u_marg;
  vec2 tuv = u_mr.xy + u_mr.zw * vec2(xy.x / u_mw + 0.5, 0.5 - xy.y / (u_mw * u_A));
  float a3 = texture2D(u_f3, tuv).a;
  if (a3 < 0.02) return u_s3 * 1.5;
  if (a3 > 0.98) return -u_s3 * 1.5;
  float a2 = texture2D(u_f2, tuv).a;
  if (a2 < 0.02) return u_s2 * 1.5;
  if (a2 > 0.98) return -u_s2 * 1.5;
  float a1 = texture2D(u_f1, tuv).a;
  return clamp((0.5 - a1) * 2.5 * u_s1, -1.25 * u_s1, 1.25 * u_s1);
}

vec3 toObj(vec3 p) {
  p = vec3(dot(u_r0, p), dot(u_r1, p), dot(u_r2, p));
  if (u_count > 1.5) {
    float sec = 6.2831853 / u_count;
    float a = atan(p.x, p.z);
    a = mod(a + sec * 0.5, sec) - sec * 0.5;
    float l = length(p.xz);
    p.xz = l * vec2(sin(a), cos(a));
    p.z -= u_ring;
  }
  return p;
}

float sdObj(vec3 p) {
  float b = u_bevel;
  if (u_kind < 1.5 && u_kind > 0.5) { vec3 q = abs(p) - vec3(0.5 - b); return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - b; }
  if (u_kind < 2.5 && u_kind > 0.5) return length(p) - 0.5;
  if (u_kind < 3.5 && u_kind > 0.5) { vec2 q = vec2(length(p.xy) - 0.36, p.z); return length(q) - 0.14; }
  if (u_kind < 4.5 && u_kind > 0.5) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(0.4 - b, 0.5 - b); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - b; }
  if (u_kind < 5.5 && u_kind > 0.5) { p.y -= clamp(p.y, -0.28, 0.28); return length(p) - 0.22; }
  // extrusão do campo 2D (texto ou alfa da camada) com chanfro arredondado
  float d2 = field2(p.xy);
  vec2 w = vec2(d2 + b, abs(p.z) - u_depth * 0.5 + b);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - b;
}
float map(vec3 p) { return sdObj(toObj(p)); }

vec3 studio(vec3 r, float rough) {
  float y = r.y;
  vec3 c = mix(vec3(0.1), vec3(0.95), smoothstep(-0.5, 0.9, y));
  c += vec3(0.75) * smoothstep(0.55 - rough * 0.3, 1.0, dot(r, normalize(vec3(0.15, 0.25, -1.0))));
  float w = 0.03 + rough * 0.25;
  c += vec3(3.0) * smoothstep(1.0 - w - 0.04, 1.0 - w * 0.3, dot(r, normalize(vec3(-0.65, 0.55, -0.55))));
  c += vec3(2.2, 2.1, 2.0) * smoothstep(1.0 - w - 0.06, 1.0 - w * 0.3, dot(r, normalize(vec3(0.75, 0.25, -0.45))));
  c += vec3(1.2) * exp(-abs(y + 0.05) * (40.0 - rough * 30.0)) * 0.8;
  return c;
}

void main() {
  vec4 s = texture2D(u_tex, v_uv);
  vec2 q = (v_uv - u_c) * u_size / u_S; q.y = -q.y;
  vec3 ro = vec3(0.0, 0.0, -u_dc);
  vec3 rd = normalize(vec3(q, u_dc));
  // esfera que envolve o objeto: raio que não passa nela nem entra no laço (o objeto costuma ocupar pouco da tela)
  float bb = dot(ro, rd), cc = dot(ro, ro) - u_brad * u_brad, disc = bb * bb - cc;
  if (disc < 0.0) { gl_FragColor = u_comp > 0.5 ? vec4(0.0) : s; return; }
  float sq = sqrt(disc);
  float t = max(0.0, -bb - sq), tmax = -bb + sq;
  float best = 1e9, bt = -1.0, pixk = 1.0 / (u_S * u_dc);
  bool hit = false;
  for (int i = 0; i < 120; i++) {
    float d = map(ro + rd * t);
    float pix = t * pixk;
    float r = d / pix;
    if (r < best) { best = r; bt = t; }
    if (d < pix * 0.25) { hit = true; break; }
    t += d * 0.85;
    if (t > tmax) break;
  }
  float cov = hit ? 1.0 : clamp(1.0 - best, 0.0, 1.0);
  if (cov <= 0.0) { gl_FragColor = u_comp > 0.5 ? vec4(0.0) : s; return; }
  t = hit ? t : bt;
  vec3 p = ro + rd * t;
  float e = max(t * pixk, 0.0015);
  vec2 k = vec2(1.0, -1.0);
  vec3 n = normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
  vec3 po = toObj(p);
  vec3 base = u_col;
  if (u_kind > 5.5 && po.z < -u_depth * 0.5 + u_bevel + 0.01) {
    vec2 tuv = u_mr.xy + u_mr.zw * vec2(po.x / u_mw + 0.5, 0.5 - po.y / (u_mw * u_A));
    vec4 m = unpre(texture2D(u_mask, tuv));
    base = mix(base, m.rgb, step(0.05, m.a));
  } else if (u_texMode > 1.5) {
    // mapa difuso projetado de frente (texto: a caixa do texto inteira; primitivas: o cubo unitário)
    vec2 pu = u_kind < 0.5 ? vec2(po.x / u_mw + 0.5, 0.5 - po.y / (u_mw * u_A)) : vec2(po.x + 0.5, 0.5 - po.y);
    pu = clamp(pu, 0.0, 1.0);
    vec4 m = u_texMode > 2.5 ? unpre(texture2D(u_tex, u_er.xy + u_er.zw * pu)) : unpre(texture2D(u_dtex, pu));
    base = mix(base, m.rgb, step(0.02, m.a));
  }
  vec3 v = -rd, L = normalize(u_ldir), H = normalize(L + v);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), mix(6.0, 420.0, u_gloss)) * mix(0.3, 3.0, u_gloss);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 r = reflect(rd, n);
  vec3 env = studio(r, 1.0 - u_gloss);
  if (u_envMode > 0.5) env = mix(env, unpre(texture2D(u_env, vec2(0.5 + r.x * 0.45, 0.5 - r.y * 0.45))).rgb * 1.6, 0.85);
  float ao = clamp(map(p + n * 0.06) / 0.06, 0.0, 1.0) * 0.45 + 0.55;
  vec3 c = base * (u_amb + diff * u_lint * u_lcol) * (1.0 - u_metal);
  c += env * mix(vec3(0.04 + fres * 0.6), base, u_metal) * u_refl;
  c *= ao;
  c += spec * u_lint * u_lcol * mix(vec3(1.0), base, u_metal);
  c += u_rimc * fres * u_rim;
  c += base * u_emis * (0.6 + 0.8 * fres);
  float oa = mix(1.0, mix(0.35, 1.0, fres), u_glass) * cov;
  vec4 o = vec4(clamp(c, 0.0, 1.0) * oa, oa);
  gl_FragColor = u_comp > 0.5 ? o : o + s * (1.0 - o.a);
}`);

// Modelo importado (OBJ/GLB): malha de triângulos com profundidade, mesma câmera/luz/material do raymarch.
const MESH_VERT = `
precision highp float;
attribute vec3 a_p; attribute vec3 a_n; attribute vec2 a_t;
uniform vec3 u_r0, u_r1, u_r2; uniform vec2 u_c, u_size; uniform float u_S, u_dc, u_flipY;
varying vec3 v_n; varying vec3 v_p; varying vec2 v_t;
void main() {
  vec3 q = vec3(a_p.x, a_p.y * u_flipY, a_p.z);
  vec3 p = vec3(dot(vec3(u_r0.x, u_r1.x, u_r2.x), q), dot(vec3(u_r0.y, u_r1.y, u_r2.y), q), dot(vec3(u_r0.z, u_r1.z, u_r2.z), q));
  vec3 nn = vec3(a_n.x, a_n.y * u_flipY, a_n.z);
  v_n = vec3(dot(vec3(u_r0.x, u_r1.x, u_r2.x), nn), dot(vec3(u_r0.y, u_r1.y, u_r2.y), nn), dot(vec3(u_r0.z, u_r1.z, u_r2.z), nn));
  v_p = p; v_t = a_t;
  float w = max(0.02, (p.z + u_dc) / u_dc);
  vec2 o = vec2(p.x, -p.y) * 2.0 * u_S / u_size;
  float zn = clamp((p.z + u_dc) / (u_dc + 4.0), 0.0, 1.0);
  gl_Position = vec4((u_c * 2.0 - 1.0) * w + o, (zn * 2.0 - 1.0) * w, w);
}`;
const MESH_FRAG = `
precision highp float;
varying vec3 v_n; varying vec3 v_p; varying vec2 v_t;
uniform sampler2D u_dtex, u_env, u_tex; uniform vec4 u_er;
uniform vec3 u_col, u_ldir, u_lcol, u_rimc;
uniform float u_metal, u_gloss, u_refl, u_envMode, u_emis, u_glass, u_lint, u_amb, u_rim, u_dc, u_texMode;
vec4 unpre(vec4 c) { return c.a > 0.0001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec3 studio(vec3 r, float rough) {
  float y = r.y;
  vec3 c = mix(vec3(0.1), vec3(0.95), smoothstep(-0.5, 0.9, y));
  c += vec3(0.75) * smoothstep(0.55 - rough * 0.3, 1.0, dot(r, normalize(vec3(0.15, 0.25, -1.0))));
  float w = 0.03 + rough * 0.25;
  c += vec3(3.0) * smoothstep(1.0 - w - 0.04, 1.0 - w * 0.3, dot(r, normalize(vec3(-0.65, 0.55, -0.55))));
  c += vec3(2.2, 2.1, 2.0) * smoothstep(1.0 - w - 0.06, 1.0 - w * 0.3, dot(r, normalize(vec3(0.75, 0.25, -0.45))));
  c += vec3(1.2) * exp(-abs(y + 0.05) * (40.0 - rough * 30.0)) * 0.8;
  return c;
}
void main() {
  vec3 rd = normalize(v_p - vec3(0.0, 0.0, -u_dc));
  vec3 n = normalize(v_n);
  if (dot(n, rd) > 0.0) n = -n; // faces sem orientação consistente: ilumina os dois lados
  vec3 base = u_col;
  if (u_texMode > 1.5) {
    vec4 m = u_texMode > 2.5 ? unpre(texture2D(u_tex, u_er.xy + u_er.zw * fract(v_t))) : unpre(texture2D(u_dtex, fract(v_t)));
    base = mix(base, m.rgb, step(0.02, m.a));
  }
  vec3 v = -rd, L = normalize(u_ldir), H = normalize(L + v);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), mix(6.0, 420.0, u_gloss)) * mix(0.3, 3.0, u_gloss);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 r = reflect(rd, n);
  vec3 env = studio(r, 1.0 - u_gloss);
  if (u_envMode > 0.5) env = mix(env, unpre(texture2D(u_env, vec2(0.5 + r.x * 0.45, 0.5 - r.y * 0.45))).rgb * 1.6, 0.85);
  vec3 c = base * (u_amb + diff * u_lint * u_lcol) * (1.0 - u_metal);
  c += env * mix(vec3(0.04 + fres * 0.6), base, u_metal) * u_refl;
  c += spec * u_lint * u_lcol * mix(vec3(1.0), base, u_metal);
  c += u_rimc * fres * u_rim;
  c += base * u_emis * (0.6 + 0.8 * fres);
  float oa = mix(1.0, mix(0.35, 1.0, fres), u_glass);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * oa, oa);
}`;
const OVER = frag(`uniform sampler2D u_obj; uniform float u_comp;
void main() { vec4 s = texture2D(u_tex, v_uv); vec4 o = texture2D(u_obj, v_uv); gl_FragColor = u_comp > 0.5 ? o : o + s * (1.0 - o.a); }`);

const FONTS = ['900 Fpx Impact, "Arial Black", sans-serif', '900 Fpx "Arial Black", "Helvetica Neue", sans-serif', 'bold Fpx Georgia, "Times New Roman", serif', 'bold Fpx "Courier New", monospace', 'italic 900 Fpx "Arial Black", "Helvetica Neue", sans-serif', '200 Fpx "Helvetica Neue", Arial, sans-serif'];
// [metal, brilho×, reflexo×, emissivo, vidro, cor fixa?]
const MATERIALS = [
  null,
  { metal: 0, gloss: 1, refl: 0.6 }, // Plástico
  { metal: 1, gloss: 1.3, refl: 1.2, color: [0.95, 0.96, 0.98] }, // Cromo
  { metal: 1, gloss: 1.1, refl: 1.1, color: [1, 0.76, 0.33] }, // Ouro
  { metal: 0.85, gloss: 0.45, refl: 0.9 }, // Metal escovado
  { metal: 0.2, gloss: 1.4, refl: 1.3, glass: 1, color: [0.08, 0.09, 0.11] }, // Vidro fumê
  { metal: 0, gloss: 0.15, refl: 0.05 }, // Fosco
  { metal: 0, gloss: 0.8, refl: 0.3, emis: 1.2 }, // Neon
];

let maskCache = { key: '', canvas: null, mw: 1, A: 1 };
function textMask(text, font) {
  const key = `${text}|${font}`;
  if (maskCache.key === key) return maskCache;
  const W = 1024;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f = FONTS[(font | 0) - 1] || FONTS[0];
  const lines = String(text || ' ').split('\n');
  g.font = f.replace('F', 100);
  const wMax = Math.max(1, ...lines.map((l) => g.measureText(l).width));
  const fs = Math.min(320, (0.6 * W * 100) / wMax);
  const lh = fs * 1.1;
  const H = Math.round(lh * lines.length + 0.32 * W);
  c.width = W; c.height = H;
  g.font = f.replace('F', fs.toFixed(1));
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh));
  const tw = Math.max(...lines.map((l) => g.measureText(l).width));
  maskCache = { key, canvas: c, mw: W / Math.max(1, tw), A: H / W };
  return maskCache;
}

function rotRows(rx, ry, rz) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // R = Rz · Rx · Ry ; linhas de Rᵀ = colunas de R
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  const R = mul(Rz, mul(Rx, Ry));
  return [0, 1, 2].map((j) => [R[0][j], R[1][j], R[2][j]]);
}

function lookParams(p, env, src) {
  const mat = MATERIALS[(p.material | 0) || 1] || MATERIALS[1];
  const la = rad(p.lightAngle ?? 40), lh = rad(p.lightHeight ?? 35);
  return {
    u_col: mat.color ? mat.color : rgb(p.color || [0.85, 0.87, 0.9]),
    u_metal: mat.metal, u_gloss: Math.min(1, ((p.gloss ?? 70) / 100) * mat.gloss), u_refl: ((p.reflect ?? 80) / 100) * mat.refl,
    u_envMode: (p.envMode | 0) === 2 ? 1 : 0, u_env: (p.envMode | 0) === 2 ? env.gl.blur(src, 6 * env.scale) : src,
    u_emis: mat.emis || 0, u_glass: mat.glass || 0,
    u_ldir: [Math.cos(lh) * Math.sin(la), Math.sin(lh), -Math.cos(lh) * Math.cos(la)], u_lcol: rgb(p.lightColor || [1, 1, 1]),
    u_lint: p.lightInt ?? 1.2, u_amb: (p.ambient ?? 22) / 100, u_rimc: rgb(p.rimColor || [0.35, 0.6, 1]), u_rim: (p.rim ?? 40) / 100,
  };
}

function renderModel(src, p, env, model, tm, dtex) {
  const { gl } = env;
  const t = env.t;
  const R = rotRows(rad((p.rotX ?? 0) + (p.spinX || 0) * t), rad((p.rotY ?? 0) + (p.spinY || 0) * t), rad(p.rotZ ?? 0));
  const obj = gl.mesh(`e3dm:${p.modelId}`, () => ({ data: model.geom, attribs: [['a_p', 3], ['a_n', 3], ['a_t', 2]] }), MESH_VERT, MESH_FRAG, {
    ...lookParams(p, env, src),
    u_r0: R[0], u_r1: R[1], u_r2: R[2], u_c: cuv(env, p.position || [0.5, 0.5]), u_size: [src.w, src.h],
    u_S: Math.max(4, (p.objSize ?? 500) * env.scale), u_dc: p.persp ?? 4, u_flipY: 1,
    u_texMode: tm, u_dtex: dtex, u_tex: src, u_er: env.rect,
  }, src.w, src.h, { depth: true });
  return gl.pass(OVER, { u_tex: src, u_obj: obj, u_comp: (p.composite | 0) === 2 ? 1 : 0 });
}

export default [
  {
    type: 'element3d', label: 'Element 3D', category: '3D', plugin: 'Element 3D (Video Copilot)',
    description: 'Objetos 3D de verdade: texto extrudado, logo/PNG da camada, cubo, esfera, toro, cilindro e cápsula, com materiais (cromo, ouro, vidro…), luz, reflexo e anel de réplicas.',
    params: [
      sel('object', 'Objeto', ['Texto 3D', 'Cubo', 'Esfera', 'Toro', 'Cilindro', 'Cápsula', 'Camada extrudada (logo / PNG)', 'Modelo 3D importado (OBJ / GLB)'], 1),
      { key: 'modelId', label: 'Modelo', kind: 'hidden', default: '' }, { key: 'texId', label: 'Textura', kind: 'hidden', default: '' },
      sel('texMode', 'Textura (mapa difuso)', ['Só a cor do material', 'Textura importada (imagem)', 'Clipe / vídeo da camada'], 1),
      { key: 'text', label: 'Texto', kind: 'text', default: 'MOTION' },
      sel('font', 'Fonte', ['Impact', 'Arial Black', 'Georgia', 'Courier', 'Itálico pesado', 'Fina'], 1),
      num('extrude', 'Extrusão', 0.3, 0, 3, 0.01), num('bevel', 'Chanfro (bevel)', 0.025, 0, 0.25, 0.005),
      pos('position', 'Posição'), num('objSize', 'Tamanho (px)', 500, 10, 4000),
      ang('rotX', 'Rotação X', -12), ang('rotY', 'Rotação Y', 22), ang('rotZ', 'Rotação Z', 0),
      num('spinY', 'Giro automático Y (°/s)', 0, -720, 720), num('spinX', 'Giro automático X (°/s)', 0, -720, 720),
      num('persp', 'Distância da câmera', 4, 1.2, 30, 0.1),
      sel('material', 'Material', ['Plástico', 'Cromo', 'Ouro', 'Metal escovado', 'Vidro fumê', 'Fosco', 'Neon (emissivo)'], 2),
      col('color', 'Cor', [0.85, 0.87, 0.9, 1]), num('gloss', 'Brilho %', 70, 0, 100), num('reflect', 'Reflexo %', 80, 0, 200),
      sel('envMode', 'Ambiente (reflexo)', ['Estúdio', 'A própria camada / vídeo'], 1),
      ang('lightAngle', 'Luz – ângulo', 40), num('lightHeight', 'Luz – altura °', 35, -89, 89), num('lightInt', 'Luz – intensidade', 1.2, 0, 5, 0.05),
      col('lightColor', 'Luz – cor', [1, 0.97, 0.92, 1]), num('ambient', 'Luz ambiente %', 22, 0, 100),
      col('rimColor', 'Rim light – cor', [0.35, 0.6, 1, 1]), num('rim', 'Rim light %', 40, 0, 300),
      num('count', 'Réplicas (anel)', 1, 1, 12, 1), num('ring', 'Raio do anel', 1.4, 0, 8, 0.05),
      sel('composite', 'Composição', ['Sobre a camada', 'Só o objeto 3D'], 1),
    ],
    render: (src, p, env) => {
      const { gl } = env;
      let kind = (p.object | 0) || 1;
      const tm = (p.texMode | 0) || 1;
      let dtex = src;
      if (tm === 2) { const u = textureUrl(p.texId); const im = u && getImage(u); if (im?.complete && im.naturalWidth) dtex = gl.upload(im); }
      if (kind === 8) {
        const model = getModel(p.modelId);
        if (model) return renderModel(src, p, env, model, tm === 2 && dtex === src ? 1 : tm, dtex);
        kind = 2; // ainda carregando / sem modelo: mostra um cubo no lugar
      }
      const k = [0, 0, 1, 2, 3, 4, 5, 6][kind];
      let maskT = src, mw = 1, A = (env.rect[3] * src.h) / (env.rect[2] * src.w), mr = env.rect;
      if (k === 0) {
        const m = textMask(p.text ?? 'MOTION', p.font);
        maskT = gl.upload(m.canvas); mw = m.mw; A = m.A; mr = [0, 0, 1, 1];
      }
      const Wm = maskT.w * mr[2];
      const s1 = Wm / 256, s2 = Wm / 64, s3 = Wm / 16;
      const f1 = k === 0 || k === 6 ? gl.blur(maskT, s1) : src;
      const f2 = k === 0 || k === 6 ? gl.blur(maskT, s2) : src;
      const f3 = k === 0 || k === 6 ? gl.blur(maskT, s3) : src;
      const mat = MATERIALS[(p.material | 0) || 1] || MATERIALS[1];
      const t = env.t;
      const R = rotRows(rad((p.rotX ?? 0) + (p.spinX || 0) * t), rad((p.rotY ?? 0) + (p.spinY || 0) * t), rad(p.rotZ ?? 0));
      const la = rad(p.lightAngle ?? 40), lh = rad(p.lightHeight ?? 35);
      const envT = (p.envMode | 0) === 2 ? gl.blur(src, 6 * env.scale) : src;
      const gloss = Math.min(1, ((p.gloss ?? 70) / 100) * mat.gloss);
      return gl.pass(E3D, {
        u_tex: src, u_c: cuv(env, p.position || [0.5, 0.5]), u_S: Math.max(4, (p.objSize ?? 500) * env.scale), u_dc: p.persp ?? 4,
        u_kind: k, u_depth: Math.max(0.002, p.extrude ?? 0.3), u_bevel: Math.min(p.bevel ?? 0.025, k === 0 || k === 6 ? 0.08 : 0.25),
        u_A: A, u_mw: mw, u_mr: mr, u_marg: k === 0 ? (s3 / Wm) * mw : 0.002, u_s1: (s1 / Wm) * mw, u_s2: (s2 / Wm) * mw, u_s3: (s3 / Wm) * mw,
        u_count: Math.max(1, Math.round(p.count ?? 1)), u_ring: (p.count ?? 1) > 1 ? p.ring ?? 1.4 : 0,
        u_r0: R[0], u_r1: R[1], u_r2: R[2],
        u_f1: f1, u_f2: f2, u_f3: f3, u_mask: maskT, u_env: envT,
        u_col: mat.color && kind !== 7 ? mat.color : rgb(p.color || [0.85, 0.87, 0.9]),
        u_metal: k === 6 ? Math.min(mat.metal, 0.25) : mat.metal, u_gloss: gloss, u_refl: ((p.reflect ?? 80) / 100) * mat.refl, u_envMode: (p.envMode | 0) === 2 ? 1 : 0,
        u_emis: mat.emis || 0, u_glass: mat.glass || 0,
        u_ldir: [Math.cos(lh) * Math.sin(la), Math.sin(lh), -Math.cos(lh) * Math.cos(la)], u_lcol: rgb(p.lightColor || [1, 1, 1]),
        u_lint: p.lightInt ?? 1.2, u_amb: (p.ambient ?? 22) / 100, u_rimc: rgb(p.rimColor || [0.35, 0.6, 1]), u_rim: (p.rim ?? 40) / 100,
        u_comp: (p.composite | 0) === 2 || k === 6 ? 1 : 0,
        u_brad: (k === 0 || k === 6 ? 0.5 * Math.hypot(mw, mw * A, Math.max(0.002, p.extrude ?? 0.3)) + 0.05 : 0.95) + ((p.count ?? 1) > 1 ? (p.ring ?? 1.4) : 0),
        u_texMode: tm === 2 && dtex === src ? 1 : tm, u_dtex: dtex, u_er: env.rect,
      });
    },
  },
];
