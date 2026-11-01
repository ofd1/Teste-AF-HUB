// Shatter (como o Shatter do After Effects) e Time Slice.
// Shatter: a camada é dividida em cacos (vidro, quadrados, triângulos, tijolos) que explodem a partir de uma
// esfera de força em 3D, com rotação, gravidade, perspectiva de câmera e motion blur de obturador.
import { frag, num, ang, bool, sel, pos, col, rgb, rad, hash1 } from './common.js';

const SHARD_VERT = `
precision highp float;
attribute vec2 a_pos; attribute vec2 a_cen; attribute vec3 a_rnd;
uniform float u_t, u_asp, u_rand, u_spin, u_grav, u_gdir, u_ginc, u_focal, u_zpush, u_visc, u_mass, u_tumble;
uniform vec4 u_f1, u_f2;          // força: x, y, profundidade, intensidade
uniform float u_r1[16], u_r2[16], u_th[16]; // raio de cada força ao longo do tempo (raio animado = onda de quebra)
uniform float u_nh, u_f2on;
uniform vec4 u_rect;
varying vec2 v_src; varying float v_shade; varying float v_broken; varying float v_spec; varying float v_age;
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
  vec3 lp = vec3((a_pos.x - a_cen.x) * u_asp, a_pos.y - a_cen.y, 0.0);
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
  vec3 n = rot(vec3(0.0, 0.0, 1.0), axis, ang);
  float zc = u_focal - wp.z;
  float s = u_focal / max(zc, 0.02);
  vec2 sp = wp.xy * s;
  vec2 cu = vec2(sp.x / u_asp + 0.5, sp.y + 0.5);
  vec2 uv = u_rect.xy + cu * u_rect.zw;
  gl_Position = zc < 0.03 ? vec4(9.0, 9.0, 9.0, 1.0) : vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  v_src = u_rect.xy + a_pos * u_rect.zw;
  v_shade = abs(n.z);
  v_spec = pow(max(0.0, dot(n, normalize(vec3(-0.4, -0.6, 1.0)))), 24.0);
  v_broken = broken;
  v_age = t;
}`;

const SHARD_FRAG = `
precision highp float;
uniform sampler2D u_tex; uniform float u_front, u_render, u_opacity, u_shade, u_ambient, u_specAmt, u_life;
uniform vec3 u_color;
varying vec2 v_src; varying float v_shade; varying float v_broken; varying float v_spec; varying float v_age;
void main() {
  if (u_render > 1.5 && u_render < 2.5 && v_broken > 0.5) discard;  // só a camada
  if (u_render > 2.5 && v_broken < 0.5) discard;                     // só os cacos
  vec4 c = texture2D(u_tex, v_src);
  if (u_front < 1.5) c = vec4(u_color, 1.0) * c.a;                   // Cor
  else if (u_front > 2.5) c.rgb *= u_color;                           // Camada tingida
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

/** Gera os cacos no espaço do conteúdo (0..1). Cada triângulo carrega o centro do seu caco. */
function buildShards(pattern, reps, asp, seed) {
  const cols = Math.max(2, Math.round(reps * Math.min(asp, 1) * 1.0));
  const rows = Math.max(2, Math.round((reps * Math.max(1, 1 / asp))));
  const nx = asp >= 1 ? Math.round(cols * asp) : cols;
  const ny = asp >= 1 ? rows : Math.round(rows);
  const out = [];
  const rnd = (i, k) => hash1(i * 17.31 + k * 3.7 + seed * 11.1);
  const jitter = pattern === 1 ? 0.42 : 0;
  // vértices da grade (compartilhados entre cacos vizinhos, como um vidro trincado)
  const V = (i, j) => {
    const edge = i === 0 || j === 0 || i === nx || j === ny;
    const id = j * (nx + 1) + i;
    const jx = edge && (i === 0 || i === nx) ? 0 : (rnd(id, 1) - 0.5) * jitter;
    const jy = edge && (j === 0 || j === ny) ? 0 : (rnd(id, 2) - 0.5) * jitter;
    let x = (i + jx) / nx, y = (j + jy) / ny;
    if (pattern === 4 && j % 2 === 1 && i > 0 && i < nx) x += 0.5 / nx; // tijolos
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const push = (tri, cen, id) => {
    const r = [rnd(id, 5), rnd(id, 6), rnd(id, 7)];
    for (const v of tri) out.push(v[0], v[1], cen[0], cen[1], r[0], r[1], r[2]);
  };
  const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  let id = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
    const flip = rnd(j * nx + i, 9) > 0.5;
    const t1 = flip ? [a, b, c] : [a, b, d], t2 = flip ? [a, c, d] : [b, c, d];
    if (pattern === 2 || pattern === 4) { // quadrados / tijolos: 1 caco por célula
      const cen = centroid([a, b, c, d]);
      push(t1, cen, id); push(t2, cen, id); id++;
    } else if (pattern === 3) { // triângulos: 4 por célula, a partir do centro
      const m = centroid([a, b, c, d]);
      for (const tri of [[a, b, m], [b, c, m], [c, d, m], [d, a, m]]) { push(tri, centroid(tri), id++); }
    } else { // vidro: triângulos irregulares
      push(t1, centroid(t1), id++); push(t2, centroid(t2), id++);
    }
  }
  return { data: new Float32Array(out), attribs: [['a_pos', 2], ['a_cen', 2], ['a_rnd', 3]] };
}

const PATTERNS = ['Vidro (cacos)', 'Quadrados', 'Triângulos', 'Tijolos'];

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
    description: 'Estilhaça a camada em cacos 3D que explodem a partir da Força 1, com gravidade, rotação, câmera em perspectiva e motion blur. A explosão começa no "Início" (segundos após o começo da camada). Use "Preencher com cor" branca numa silhueta para o shatter branco dos edits.',
    params: [
      sel('render', 'Renderizar', ['Tudo', 'Só a camada', 'Só os cacos'], 1),
      sel('pattern', 'Padrão', PATTERNS, 1), num('repetitions', 'Repetições (tamanho dos cacos)', 22, 3, 80, 1),
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
      const key = `shatter:${pattern}:${reps}:${asp.toFixed(3)}:${seed}`;
      const build = () => buildShards(pattern, reps, asp, seed);
      const front = p.fill ? 1 : p.frontMode ?? 2;
      const base = {
        u_tex: src, u_asp: asp, u_f1: [p.force[0], p.force[1], p.forceDepth, p.strength], u_f2: [p.force2?.[0] ?? 0.5, p.force2?.[1] ?? 0.5, p.force2Depth ?? 0.5, p.strength2 ?? 0],
        u_f2on: !!p.force2On, u_rand: p.randomness, u_spin: p.spin, u_tumble: p.tumble ?? 1, u_visc: p.viscosity || 0, u_mass: (p.massVariance ?? 15) / 100,
        u_grav: p.gravity, u_gdir: rad(p.gravityDir), u_ginc: rad(p.gravityIncl || 0), u_focal: p.cameraDist, u_zpush: p.zPush,
        u_front: front, u_color: rgb(p.fillColor), u_render: p.render, u_opacity: p.opacity / 100,
        u_shade: (p.shade ?? 70) / 100, u_ambient: (p.ambient ?? 25) / 100, u_specAmt: (p.specular ?? 40) / 100 * (p.shade ?? 70) / 100, u_life: p.life, u_rect: env.rect,
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
        const s = gl.mesh(key, build, SHARD_VERT, SHARD_FRAG, { ...base, ...hist(ti), u_t: ti }, src.w, src.h);
        acc = n === 1 ? s : gl.pass(ACC, { u_tex: acc || s, u_tex2: s, u_w: 1 / n, u_first: acc ? 0 : 1 });
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
