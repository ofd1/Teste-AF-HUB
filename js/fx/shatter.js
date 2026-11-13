// Shatter (como o Shatter do After Effects) e Time Slice.
// Shatter: a camada é dividida em cacos 3D (vidro, quadrados, triângulos, tijolos, hexágonos, quebra-cabeça, Voronoi, teia radial…) que explodem a partir de uma
// esfera de força em 3D, com rotação, gravidade, perspectiva de câmera e motion blur de obturador.
import { frag, num, ang, bool, sel, pos, col, rgb, rad, hash1 } from './common.js';

const SHARD_VERT = `
precision highp float;
attribute vec2 a_pos; attribute vec2 a_cen; attribute vec3 a_rnd; attribute vec4 a_ext; // a_ext: face (1 frente, 0 lateral, -1 verso) + normal local
uniform float u_t, u_depth, u_asp, u_rand, u_spin, u_grav, u_gdir, u_ginc, u_focal, u_zpush, u_visc, u_mass, u_tumble;
uniform vec4 u_f1, u_f2;          // força: x, y, profundidade, intensidade
uniform float u_r1[16], u_r2[16], u_th[16]; // raio de cada força ao longo do tempo (raio animado = onda de quebra)
uniform float u_nh, u_f2on;
uniform vec4 u_rect;
varying vec2 v_src; varying float v_shade; varying float v_broken; varying float v_spec; varying float v_age; varying float v_side;
vec3 rot(vec3 p, vec3 a, float ang) {
  float c = cos(ang), s = sin(ang);
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}
// instante em que a esfera de força alcança o caco (−1 = nunca)
float hitTime(float dist, float which) {
  float prevR = 0.0, prevT = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= u_nh) break;
    float r = which < 0.5 ? u_r1[i] : u_r2[i];
    float t = u_th[i];
    if (r >= dist) {
      if (i == 0) return t;
      return mix(prevT, t, clamp((dist - prevR) / max(r - prevR, 1e-5), 0.0, 1.0));
    }
    prevR = r; prevT = t;
  }
  return -1.0;
}
void main() {
  vec3 c = vec3((a_cen.x - 0.5) * u_asp, a_cen.y - 0.5, 0.0);
  // frente em z = 0 (camada inteira fica idêntica antes de quebrar); verso e laterais vão para trás (espessura)
  float face = a_ext.x;
  float zl = face > 0.5 ? 0.0 : (face < -0.5 ? -u_depth : -u_depth * a_ext.w);
  vec3 lp = vec3((a_pos.x - a_cen.x) * u_asp, a_pos.y - a_cen.y, zl);
  vec3 rn = a_rnd * 2.0 - 1.0;
  float now = u_th[int(max(u_nh - 1.0, 0.0))];
  vec3 vel = vec3(0.0);
  float tb = 1e9;
  float rnow1 = 0.0, rnow2 = 0.0;
  for (int i = 0; i < 16; i++) { if (float(i) < u_nh) { rnow1 = u_r1[i]; rnow2 = u_r2[i]; } }
  for (int f = 0; f < 2; f++) {
    vec4 F = f == 0 ? u_f1 : u_f2;
    if (f == 1 && u_f2on < 0.5) break;
    vec3 fp = vec3((F.x - 0.5) * u_asp, F.y - 0.5, -F.z);
    vec3 d = c - fp;
    float dist = length(d);
    float h = hitTime(dist, float(f));
    if (h < 0.0) continue;
    float R = max(f == 0 ? rnow1 : rnow2, 1e-4);
    float k = clamp(1.0 - dist / R, 0.0, 1.0);
    tb = min(tb, h + (1.0 - k) * 0.05);
    vel += normalize(d + vec3(0.0, 0.0, 1e-3)) * (0.35 + k) * F.w;
  }
  float broken = tb < 1e8 ? 1.0 : 0.0;
  float t = broken > 0.5 ? max(0.0, now - tb) : 0.0;
  float strengthSum = max(length(vel), 1e-4);
  vel += (rn * u_rand * 1.6 + vec3(0.0, 0.0, u_zpush * (0.5 + a_rnd.z))) * strengthSum * 0.6;
  vel *= 0.075 * (1.0 + (a_rnd.z - 0.5) * u_mass * 2.0);
  // viscosidade (atrito do ar) e gravidade com direção e inclinação, como no AE
  float travel = u_visc > 0.001 ? (1.0 - exp(-u_visc * 4.0 * t)) / (u_visc * 4.0) : t;
  vec3 g = vec3(sin(u_gdir) * cos(u_ginc), cos(u_gdir) * cos(u_ginc), sin(u_ginc)) * u_grav * 0.05;
  vec3 p = c + vel * travel + 0.5 * g * t * t * broken;
  vec3 axis = rn;
  if (u_tumble > 7.5) axis = vec3(0.0, rn.y, rn.z);
  else if (u_tumble > 6.5) axis = vec3(rn.x, 0.0, rn.z);
  else if (u_tumble > 5.5) axis = vec3(rn.x, rn.y, 0.0);
  else if (u_tumble > 4.5) axis = vec3(0.0, 0.0, 1.0);
  else if (u_tumble > 3.5) axis = vec3(0.0, 1.0, 0.0);
  else if (u_tumble > 2.5) axis = vec3(1.0, 0.0, 0.0);
  axis = normalize(axis + vec3(1e-4));
  float spinOn = u_tumble > 1.5 && u_tumble < 2.5 ? 0.0 : 1.0;
  float ang = u_spin * travel * (0.4 + a_rnd.x) * (a_rnd.y > 0.5 ? 1.0 : -1.0) * 4.0 * spinOn;
  vec3 wp = p + rot(lp, axis, ang);
  vec3 n0 = face > 0.5 ? vec3(0.0, 0.0, 1.0) : (face < -0.5 ? vec3(0.0, 0.0, -1.0) : vec3(a_ext.y, a_ext.z, 0.0));
  vec3 n = rot(n0, axis, ang);
  float zc = u_focal - wp.z;
  float s = u_focal / max(zc, 0.02);
  vec2 sp = wp.xy * s;
  vec2 cu = vec2(sp.x / u_asp + 0.5, sp.y + 0.5);
  vec2 uv = u_rect.xy + cu * u_rect.zw;
  float zn = clamp((zc - 0.03) / (u_focal + 8.0), 0.0, 1.0) * 2.0 - 1.0;
  bool hide = zc < 0.03 || (face < 0.5 && (u_depth < 1e-5 || broken < 0.5)); // sem espessura (ou inteiro): só a frente
  gl_Position = hide ? vec4(9.0, 9.0, 9.0, 1.0) : vec4(uv * 2.0 - 1.0, zn, 1.0);
  v_src = u_rect.xy + a_pos * u_rect.zw;
  vec3 L = normalize(vec3(-0.4, -0.6, 1.0));
  v_side = abs(face) < 0.5 ? 1.0 : 0.0;
  v_shade = v_side > 0.5 ? 0.15 + 0.85 * max(dot(n, L), 0.0) : abs(n.z);
  v_spec = pow(max(0.0, dot(n, normalize(vec3(-0.4, -0.6, 1.0)))), 24.0);
  v_broken = broken;
  v_age = t;
}`;

const SHARD_FRAG = `
precision highp float;
uniform sampler2D u_tex; uniform float u_front, u_render, u_opacity, u_shade, u_ambient, u_specAmt, u_life, u_sideMode;
uniform vec3 u_color, u_sideColor;
varying vec2 v_src; varying float v_shade; varying float v_broken; varying float v_spec; varying float v_age; varying float v_side;
void main() {
  if (u_render > 1.5 && u_render < 2.5 && v_broken > 0.5) discard;  // só a camada
  if (u_render > 2.5 && v_broken < 0.5) discard;                     // só os cacos
  vec4 c = texture2D(u_tex, v_src);
  if (u_front < 1.5) c = vec4(u_color, 1.0) * c.a;                   // Cor
  else if (u_front > 2.5) c.rgb *= u_color;                           // Camada tingida
  if (v_side > 0.5) {                                                 // laterais (espessura do caco)
    if (u_sideMode < 1.5) c = vec4(u_sideColor, 1.0) * max(c.a, 0.0);
    else if (u_sideMode > 2.5) c.rgb *= 0.45;
    if (c.a < 0.02) discard;
  }
  if (v_broken > 0.5) {
    float lit = mix(1.0, u_ambient + (1.0 - u_ambient) * (0.35 + 0.8 * v_shade), u_shade);
    c.rgb = c.rgb * lit + vec3(v_spec * u_specAmt) * c.a;
    c *= u_opacity * (u_life > 0.0 ? clamp(1.0 - v_age / u_life, 0.0, 1.0) : 1.0);
  }
  gl_FragColor = clamp(c, 0.0, 1.0);
}`;

const ACC = frag(`
uniform sampler2D u_tex2; uniform float u_w, u_first;
void main() { gl_FragColor = (u_first > 0.5 ? vec4(0.0) : texture2D(u_tex, v_uv)) + texture2D(u_tex2, v_uv) * u_w; }`);

const OVER = frag(`
uniform sampler2D u_tex2;
void main() { vec4 a = texture2D(u_tex, v_uv), b = texture2D(u_tex2, v_uv); gl_FragColor = b + a * (1.0 - b.a); }`);

// ---------------------------------------------------------------- geometria dos cacos
// Cada caco é um polígono (no espaço "aspecto": x 0..asp, y 0..1). Ele vira: frente (triangulada), verso e
// laterais (a espessura — "Extrusion Depth" do Shatter do AE).

/** Corta um polígono convexo pelo semiplano a·p ≤ c (Sutherland–Hodgman). */
function clipHalf(poly, ax, ay, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = ax * p[0] + ay * p[1] - c, dq = ax * q[0] + ay * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const k = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
  }
  return out;
}
const clipRect = (poly, asp) => clipHalf(clipHalf(clipHalf(clipHalf(poly, -1, 0, 0), 1, 0, asp), 0, -1, 0), 0, 1, 1);
const area2 = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };

/** Triangulação por orelhas (polígonos simples, inclusive côncavos como as peças de quebra-cabeça). */
function earcut(P) {
  const pts = area2(P) < 0 ? P.slice().reverse() : P.slice();
  const idx = pts.map((_, i) => i), tris = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const A = pts[ia], B = pts[ib], C = pts[ic];
      if (cross(A, B, C) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(pts[j], A, B, C)) { ok = false; break; } }
      if (!ok) continue;
      tris.push([A, B, C]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break; // polígono degenerado: termina em leque
  }
  if (idx.length >= 3) for (let i = 1; i < idx.length - 1; i++) tris.push([pts[idx[0]], pts[idx[i]], pts[idx[i + 1]]]);
  return tris;
}

/** Curva do encaixe do quebra-cabeça (u ao longo da aresta, v para fora), amostrada por Catmull-Rom. */
const KNOB = [[0, 0], [0.34, 0], [0.4, 0.07], [0.36, 0.17], [0.41, 0.26], [0.5, 0.29], [0.59, 0.26], [0.64, 0.17], [0.6, 0.07], [0.66, 0], [1, 0]];
function knobPath(shift, scale) {
  const P = KNOB.map(([u, v], i) => [i === 0 || i === KNOB.length - 1 ? u : u + shift, v * scale]);
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const steps = i === 0 || i === P.length - 2 ? 1 : 4;
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

/** Polígonos de cada padrão (espaço aspecto). */
function shardPolygons(pattern, reps, asp, seed, center) {
  const rnd = (i, k) => hash1(i * 17.31 + k * 3.7 + seed * 11.1);
  const polys = [];
  // células quadradas; "Repetições" ≈ quantos cacos cabem no lado menor (como no AE)
  const short = Math.max(2, Math.round(reps * 0.56));
  const cs0 = Math.min(asp, 1) / short;
  const rows = Math.max(2, Math.round(1 / cs0)), cs = 1 / rows;
  const cols = Math.max(2, Math.round(asp / cs)), cw = asp / cols;
  if (pattern === 1 || pattern === 2 || pattern === 3) {
    // grade (vidro = vértices tremidos, compartilhados → trincas que se encaixam)
    const jit = pattern === 1 ? 0.42 : 0;
    const V = (i, j) => {
      const id = j * (cols + 1) + i;
      const jx = i === 0 || i === cols ? 0 : (rnd(id, 1) - 0.5) * jit, jy = j === 0 || j === rows ? 0 : (rnd(id, 2) - 0.5) * jit;
      return [(i + jx) * cw, (j + jy) * cs];
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      if (pattern === 2) polys.push([a, b, c, d]);
      else if (pattern === 3) { const m = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4]; polys.push([a, b, m], [b, c, m], [c, d, m], [d, a, m]); }
      else if (rnd(j * cols + i, 9) > 0.5) polys.push([a, b, c], [a, c, d]); else polys.push([a, b, d], [b, c, d]);
    }
  } else if (pattern === 4 || pattern === 9) {
    // tijolos (meia peça de deslocamento por fileira) / tábuas (compridas e finas, comprimentos variados)
    const rh = pattern === 9 ? cs * 0.6 : cs, nr = Math.ceil(1 / rh);
    for (let j = 0; j < nr; j++) {
      const y0 = j * rh, y1 = Math.min(1, y0 + rh);
      let x = pattern === 4 ? (j % 2 ? -cw : 0) : -rnd(j, 3) * cw * 3;
      let k = 0;
      while (x < asp) {
        const len = pattern === 4 ? cw * 2 : cw * (2.5 + rnd(j * 97 + k, 4) * 4);
        const x0 = Math.max(0, x), x1 = Math.min(asp, x + len);
        if (x1 - x0 > 1e-4) polys.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
        x += len; k++;
      }
    }
  } else if (pattern === 5) {
    // hexágonos (colmeia)
    const r = cs * 0.62, hw = Math.sqrt(3) * r;
    for (let j = -1; j * r * 1.5 < 1 + r; j++) for (let i = -1; i * hw < asp + hw; i++) {
      const cx = i * hw + (j % 2 ? hw / 2 : 0), cy = j * r * 1.5;
      const h = Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 6 + (k * Math.PI) / 3; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
      const c = clipRect(h, asp);
      if (c.length >= 3 && Math.abs(area2(c)) > 1e-7) polys.push(c);
    }
  } else if (pattern === 6) {
    // quebra-cabeça: arestas internas com encaixe (macho/fêmea), compartilhadas entre as peças vizinhas
    const pr = Math.max(2, Math.round(rows * 0.5)), pc = Math.max(2, Math.round(asp * pr));
    const pw = asp / pc, ph = 1 / pr;
    const P = (i, j) => [i * pw, j * ph];
    const edge = (A, B, id, straight) => {
      if (straight) return [A, B];
      const sign = rnd(id, 11) > 0.5 ? 1 : -1, shift = (rnd(id, 12) - 0.5) * 0.08;
      const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), nx = -dy / len, ny2 = dx / len;
      return knobPath(shift, sign * (0.9 + rnd(id, 13) * 0.2)).map(([u, v]) => [A[0] + dx * u + nx * v * len, A[1] + dy * u + ny2 * v * len]);
    };
    const H = (i, j) => edge(P(i, j), P(i + 1, j), 1000 + j * 997 + i, j === 0 || j === pr); // horizontal: esquerda→direita
    const Vv = (i, j) => edge(P(i, j), P(i, j + 1), 5000 + j * 991 + i, i === 0 || i === pc); // vertical: cima→baixo
    for (let j = 0; j < pr; j++) for (let i = 0; i < pc; i++) {
      const top = H(i, j), right = Vv(i + 1, j), bottom = H(i, j + 1).slice().reverse(), left = Vv(i, j).slice().reverse();
      polys.push([...top.slice(0, -1), ...right.slice(0, -1), ...bottom.slice(0, -1), ...left.slice(0, -1)]);
    }
  } else if (pattern === 7) {
    // vidro realista (células de Voronoi): cacos irregulares de tamanhos variados
    const seeds = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const id = j * cols + i; seeds.push([(i + 0.1 + rnd(id, 1) * 0.8) * cw, (j + 0.1 + rnd(id, 2) * 0.8) * cs, i, j]); }
    for (const s0 of seeds) {
      let poly = [[s0[0] - cw * 3, s0[1] - cs * 3], [s0[0] + cw * 3, s0[1] - cs * 3], [s0[0] + cw * 3, s0[1] + cs * 3], [s0[0] - cw * 3, s0[1] + cs * 3]];
      for (const s1 of seeds) {
        if (s1 === s0 || Math.abs(s1[2] - s0[2]) > 2 || Math.abs(s1[3] - s0[3]) > 2) continue;
        const ax = s1[0] - s0[0], ay = s1[1] - s0[1];
        poly = clipHalf(poly, ax, ay, (ax * (s0[0] + s1[0]) + ay * (s0[1] + s1[1])) / 2);
        if (poly.length < 3) break;
      }
      poly = clipRect(poly, asp);
      if (poly.length >= 3 && Math.abs(area2(poly)) > 1e-7) polys.push(poly);
    }
  } else if (pattern === 8) {
    // teia radial (vidro atingido por um impacto): anéis e raios a partir do ponto da Força 1
    const cx = center[0] * asp, cy = center[1];
    const far = Math.max(...[[0, 0], [asp, 0], [0, 1], [asp, 1]].map(([x, y]) => Math.hypot(x - cx, y - cy))) * 1.15;
    const nS = Math.max(8, Math.round(reps * 0.9)), nR = Math.max(4, Math.round(reps * 0.45));
    const ringR = (k) => (k === 0 ? 0 : far * Math.pow(k / nR, 1.6));
    const ang = (k, i) => ((i + (k === 0 ? 0 : (rnd(k * 131 + (i % nS), 3) - 0.5) * 0.5)) / nS) * Math.PI * 2;
    const pt = (k, i) => { const r = ringR(k) * (k ? 1 + (rnd(k * 71 + (i % nS), 4) - 0.5) * 0.18 : 0); const a = ang(k, i); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
    for (let k = 0; k < nR; k++) for (let i = 0; i < nS; i++) {
      const q = k === 0 ? [pt(0, 0), pt(1, i), pt(1, i + 1)] : [pt(k, i), pt(k + 1, i), pt(k + 1, i + 1), pt(k, i + 1)];
      const c = clipRect(q, asp);
      if (c.length >= 3 && Math.abs(area2(c)) > 1e-7) polys.push(c);
    }
  } else if (pattern === 10) {
    // octógonos e quadrados
    const sz = cs * 1.4, cut = sz * 0.2929;
    for (let j = -1; j * sz < 1 + sz; j++) for (let i = -1; i * sz < asp + sz; i++) {
      const x = i * sz, y = j * sz;
      const oct = [[x + cut, y], [x + sz - cut, y], [x + sz, y + cut], [x + sz, y + sz - cut], [x + sz - cut, y + sz], [x + cut, y + sz], [x, y + sz - cut], [x, y + cut]];
      const sq = [[x + sz - cut, y + sz], [x + sz, y + sz - cut], [x + sz + cut, y + sz], [x + sz, y + sz + cut]];
      for (const g of [oct, sq]) { const c = clipRect(g, asp); if (c.length >= 3 && Math.abs(area2(c)) > 1e-7) polys.push(c); }
    }
  }
  return polys;
}

/** Monta o buffer: frente + verso triangulados e as laterais (cada aresta vira um quad com a normal para fora). */
function buildShards(pattern, reps, asp, seed, center = [0.5, 0.5]) {
  const polys = shardPolygons(pattern, reps, asp, seed, center);
  const out = [];
  polys.forEach((poly0, id) => {
    const poly = area2(poly0) < 0 ? poly0.slice().reverse() : poly0; // anti-horário (y para baixo: horário na tela)
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const cen = [cx / asp, cy];
    const r = [hash1(id * 17.31 + 5 * 3.7 + seed * 11.1), hash1(id * 17.31 + 6 * 3.7 + seed * 11.1), hash1(id * 17.31 + 7 * 3.7 + seed * 11.1)];
    const V = (p, face, nx = 0, ny = 0, back = 0) => out.push(p[0] / asp, p[1], cen[0], cen[1], r[0], r[1], r[2], face, nx, ny, back);
    const tris = earcut(poly);
    for (const t of tris) for (const p of t) V(p, 1);
    for (const t of tris) for (const p of [t[0], t[2], t[1]]) V(p, -1);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      const nx = dy / l, ny = -dx / l; // para fora (polígono com área positiva)
      V(a, 0, nx, ny, 0); V(b, 0, nx, ny, 0); V(b, 0, nx, ny, 1);
      V(a, 0, nx, ny, 0); V(b, 0, nx, ny, 1); V(a, 0, nx, ny, 1);
    }
  });
  return { data: new Float32Array(out), attribs: [['a_pos', 2], ['a_cen', 2], ['a_rnd', 3], ['a_ext', 4]] };
}

const PATTERNS = ['Vidro (cacos)', 'Quadrados', 'Triângulos', 'Tijolos', 'Hexágonos', 'Quebra-cabeça', 'Vidro realista (Voronoi)', 'Teia radial (impacto)', 'Tábuas', 'Octógonos e quadrados'];

// Time Slice: faixas que mostram a camada em tempos diferentes (fatias atrasadas), com deslocamento opcional.
// A composição das fatias é feita no renderer (precisa da camada em outros tempos).
export function timeSliceLayout(p, w, h) {
  const n = Math.max(1, Math.round(p.slices));
  const vertical = p.direction !== 2;
  return { n, vertical, size: (vertical ? w : h) / n };
}

export default [
  {
    type: 'shatter', anchorParam: 'start', label: 'Shatter (estilhaçar)', category: 'Transições', plugin: 'Shatter (After Effects)',
    description: 'Estilhaça a camada em cacos 3D (com espessura opcional — Extrusion Depth) em vários formatos: vidro, quebra-cabeça, hexágonos, vidro realista, teia de impacto, tijolos, tábuas… Os cacos explodem a partir da Força 1, com gravidade, rotação, câmera em perspectiva e motion blur. A explosão começa no "Início" (segundos após o começo da camada). Use "Preencher com cor" branca numa silhueta para o shatter branco dos edits.',
    params: [
      sel('render', 'Renderizar', ['Tudo', 'Só a camada', 'Só os cacos'], 1),
      sel('pattern', 'Padrão', PATTERNS, 1), num('repetitions', 'Repetições (tamanho dos cacos)', 22, 3, 80, 1),
      num('depth', 'Espessura 3D (Extrusion Depth)', 0, 0, 30, 0.1), sel('sideMode', 'Laterais', ['Cor', 'Camada', 'Camada escurecida'], 3), col('sideColor', 'Cor das laterais', [0.85, 0.9, 1, 1]),
      bool('reverse', 'Montar (as peças voltam e se encaixam)', false), num('reverseDur', 'Montar – duração (s)', 1, 0.05, 10, 0.05),
      num('start', 'Início da simulação (s)', 0, -10, 60, 0.01),
      pos('force', 'Força 1 – posição', [0.5, 0.45]), num('forceDepth', 'Força 1 – profundidade', 0.1, -2, 2, 0.01),
      num('radius', 'Força 1 – raio (anime para a onda de quebra)', 0.9, 0, 4, 0.01), num('strength', 'Força 1 – intensidade', 5, -30, 30, 0.1),
      bool('force2On', 'Força 2 – ligada', false), pos('force2', 'Força 2 – posição', [0.5, 0.5]), num('force2Depth', 'Força 2 – profundidade', 0.5, -2, 2, 0.01),
      num('radius2', 'Força 2 – raio', 0.5, 0, 4, 0.01), num('strength2', 'Força 2 – intensidade', 3, -30, 30, 0.1),
      num('randomness', 'Aleatoriedade', 0.4, 0, 2, 0.01), num('spin', 'Velocidade de giro', 0.4, 0, 3, 0.01),
      sel('tumble', 'Eixo de giro', ['Livre', 'Nenhum', 'X', 'Y', 'Z', 'XY', 'XZ', 'YZ'], 1),
      num('viscosity', 'Viscosidade', 0, 0, 1, 0.01), num('massVariance', 'Variação de massa %', 15, 0, 100, 1),
      num('zPush', 'Voar para a câmera', 0.8, -2, 4, 0.01),
      num('gravity', 'Gravidade', 1.5, 0, 20, 0.1), ang('gravityDir', 'Direção da gravidade', 0), num('gravityIncl', 'Inclinação da gravidade', 0, -90, 90, 1),
      sel('frontMode', 'Textura (frente)', ['Cor', 'Camada', 'Camada tingida'], 2), col('fillColor', 'Cor', [1, 1, 1, 1]),
      bool('fill', 'Preencher com cor (atalho)', false), bool('keepOriginal', 'Manter a camada original atrás', false),
      num('opacity', 'Opacidade dos cacos %', 100, 0, 100), num('life', 'Sumir após (s, 0 = nunca)', 0, 0, 10, 0.05),
      num('cameraDist', 'Câmera – distância (Z)', 2.2, 0.5, 10, 0.05),
      num('shade', 'Luz – intensidade %', 70, 0, 100), num('ambient', 'Luz ambiente %', 25, 0, 100), num('specular', 'Reflexo especular %', 40, 0, 200),
      num('shutter', 'Motion blur (quadros)', 1, 0, 4, 0.05), num('samples', 'Amostras do blur', 8, 1, 16, 1), num('seed', 'Semente', 1, 0, 999),
    ],
    render: (src, p, env) => {
      const { gl } = env;
      const fps = env.fps || 30;
      const t0 = (env.layer?.inPoint || 0) + p.start;
      const tt = env.t - t0;
      if (tt < 0 && p.render !== 3) return src;
      if (tt < 0) return gl.pass(ACC, { u_tex: src, u_tex2: src, u_w: 0, u_first: 1 });
      const asp = env.w / env.h;
      const pattern = Math.round(p.pattern), reps = Math.round(p.repetitions), seed = Math.round(p.seed);
      const ctr = pattern === 8 ? [Math.round(p.force[0] * 100) / 100, Math.round(p.force[1] * 100) / 100] : [0.5, 0.5];
      const key = `shatter2:${pattern}:${reps}:${asp.toFixed(3)}:${seed}:${ctr}`;
      const build = () => buildShards(pattern, reps, asp, seed, ctr);
      const front = p.fill ? 1 : p.frontMode ?? 2;
      const base = {
        u_tex: src, u_asp: asp, u_f1: [p.force[0], p.force[1], p.forceDepth, p.strength], u_f2: [p.force2?.[0] ?? 0.5, p.force2?.[1] ?? 0.5, p.force2Depth ?? 0.5, p.strength2 ?? 0],
        u_f2on: !!p.force2On, u_rand: p.randomness, u_spin: p.spin, u_tumble: p.tumble ?? 1, u_visc: p.viscosity || 0, u_mass: (p.massVariance ?? 15) / 100,
        u_grav: p.gravity, u_gdir: rad(p.gravityDir), u_ginc: rad(p.gravityIncl || 0), u_focal: p.cameraDist, u_zpush: p.zPush,
        u_front: front, u_color: rgb(p.fillColor), u_render: p.render, u_opacity: p.opacity / 100,
        u_shade: (p.shade ?? 70) / 100, u_ambient: (p.ambient ?? 25) / 100, u_specAmt: (p.specular ?? 40) / 100 * (p.shade ?? 70) / 100, u_life: p.life, u_rect: env.rect,
        u_depth: Math.max(0, p.depth || 0) / 100, u_sideMode: p.sideMode ?? 3, u_sideColor: rgb(p.sideColor || [0.85, 0.9, 1, 1]),
      };
      // histórico do raio das forças (raio animado → os cacos quebram quando a onda chega, como no AE)
      const hist = (tEnd) => {
        const n = 16, r1 = [], r2 = [], th = [];
        for (let i = 0; i < n; i++) {
          const tl = (tEnd * i) / (n - 1);
          const q = env.paramsAt ? env.paramsAt(t0 + tl) : p;
          r1.push(q.radius); r2.push(q.radius2 ?? 0); th.push(tl);
        }
        return { u_r1: { f1: r1 }, u_r2: { f1: r2 }, u_th: { f1: th }, u_nh: n };
      };
      const n = p.shutter > 0 && tt > 0 ? Math.max(1, Math.round(p.samples)) : 1;
      let acc = null;
      for (let i = 0; i < n; i++) {
        const ti = n === 1 ? tt : Math.max(0, tt - (p.shutter / fps) * (i / (n - 1)));
        const tr = p.reverse ? Math.max(0, (p.reverseDur ?? 1) - ti) : ti; // Montar: as peças voltam ao lugar
        const s = gl.mesh(key, build, SHARD_VERT, SHARD_FRAG, { ...base, ...hist(tr), u_t: tr }, src.w, src.h, { depth: true });
        if (n === 1) acc = s;
        else {
          const prev = acc;
          acc = gl.pass(ACC, { u_tex: prev || s, u_tex2: s, u_w: 1 / n, u_first: prev ? 0 : 1 });
          // motion blur: cada amostra é somada e liberada na hora (antes as 8 amostras ficavam na memória de vídeo
          // até o fim da camada: ~275 MB em 1080p → o iPhone reiniciava a GPU e a exportação parava)
          gl.release(s); if (prev) gl.release(prev);
        }
      }
      return p.keepOriginal ? gl.pass(OVER, { u_tex: src, u_tex2: acc }) : acc;
    },
  },
  {
    type: 'timeSlice', label: 'Time Slice (fatias no tempo)', category: 'Tempo', plugin: 'Time Slice / Time Displacement',
    description: 'Divide a camada em faixas e cada faixa mostra um momento diferente (atrasado), criando o efeito de fatias/degraus. Funciona em camadas de vídeo (o app prepara o cache de quadros).',
    params: [
      num('slices', 'Número de fatias', 12, 2, 80, 1), sel('direction', 'Direção', ['Vertical (colunas)', 'Horizontal (linhas)'], 1),
      num('delay', 'Atraso entre fatias (quadros)', 1, -10, 10, 0.1), sel('order', 'Ordem', ['Da esquerda/topo', 'Do centro', 'Aleatória'], 1),
      num('offset', 'Deslocamento das fatias (px)', 0, -500, 500, 1), num('stretch', 'Esticar fatias %', 0, 0, 300, 1),
      num('levels', 'Tempos diferentes (máx.)', 8, 2, 12, 1), num('seed', 'Semente', 1, 0, 999),
    ],
    temporal: 'timeSlice',
  },
];
