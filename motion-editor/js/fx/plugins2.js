// Plugins de After Effects populares em edits (recriações):
// Tracery (aescripts — blob tracking), Glitchify (Cinema Spice), Datamosh 2 (aescripts), VC Reflect (Video Copilot),
// Quick Chromatic Aberration 2, S_Halftone (Sapphire) e Universe Holomatrix (Red Giant).
import { frag, num, ang, bool, sel, col, rgb, rad, hash1 } from './common.js';

// ---------------------------------------------------------------- Tracery: caixas e linhas em pontos rastreados
const TRACERY_MIX = frag(`
uniform sampler2D u_ov, u_mask; uniform float u_mode, u_alpha; uniform vec3 u_tint;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float m = texture2D(u_mask, v_uv).a;
  vec3 r = c.rgb;
  if (u_mode > 1.5 && u_mode < 2.5) r = mix(r, vec3(c.a) - r, m);                 // inverter
  else if (u_mode > 2.5 && u_mode < 3.5) r = mix(r, vec3(luma(r)), m);             // preto e branco
  else if (u_mode > 3.5) r = mix(r, u_tint * luma(r) * 1.6 * c.a, m * 0.85);       // tingir
  vec4 o = texture2D(u_ov, v_uv);
  gl_FragColor = u_alpha > 0.5 ? o : vec4(o.rgb + vec3(r) * (1.0 - o.a), max(c.a, o.a)); // Alpha Layer: só os gráficos
}`);

const trCanvas = typeof document !== 'undefined' ? { a: document.createElement('canvas'), ov: document.createElement('canvas'), mk: document.createElement('canvas') } : null;

/** Acha manchas (claras, escuras ou de uma cor) numa grade pequena e devolve caixas em uv. */
function findBlobs(src, p) {
  const gw = [192, 144, 96, 72, 48, 32][(p.quality || 3) - 1] || 96, gh = Math.max(8, Math.round((gw * src.height) / src.width));
  const c = trCanvas.a; c.width = gw; c.height = gh;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, gw, gh);
  if (p.blurStrength > 0) x.filter = `blur(${(p.blurStrength * gw) / 400}px)`;
  x.drawImage(src, 0, 0, gw, gh);
  x.filter = 'none';
  const d = x.getImageData(0, 0, gw, gh).data;
  const on = new Uint8Array(gw * gh);
  const th = p.threshold / 100, key = p.trackColor;
  for (let i = 0; i < gw * gh; i++) {
    const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, a = d[i * 4 + 3] / 255;
    if (a < 0.5) continue;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (p.track === 1) on[i] = l > th ? 1 : 0;
    else if (p.track === 2) on[i] = l < 1 - th ? 1 : 0;
    else on[i] = Math.hypot(r - key[0], g - key[1], b - key[2]) < th * 1.2 ? 1 : 0; // Key Color: Threshold = tolerância (0 = nada)
  }
  // componentes conectados (4 vizinhos)
  const seen = new Uint8Array(gw * gh), boxes = [];
  for (let i = 0; i < gw * gh; i++) {
    if (!on[i] || seen[i]) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, n = 0;
    const st = [i]; seen[i] = 1;
    while (st.length) {
      const k = st.pop(), px = k % gw, py = (k / gw) | 0;
      n++; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      for (const q of [k - 1, k + 1, k - gw, k + gw]) {
        if (q < 0 || q >= gw * gh || seen[q] || !on[q]) continue;
        if ((q === k - 1 && px === 0) || (q === k + 1 && px === gw - 1)) continue;
        seen[q] = 1; st.push(q);
      }
    }
    if (n >= p.minSize) boxes.push({ x: x0 / gw, y: y0 / gh, w: (x1 - x0 + 1) / gw, h: (y1 - y0 + 1) / gh, n });
  }
  boxes.sort((a, b) => b.n - a.n);
  return boxes.slice(0, Math.round(p.maxBlobs));
}

// ---------------------------------------------------------------- Glitchify
const GLITCHIFY = frag(`
uniform float u_amt, u_ev, u_blocks, u_rgb, u_chs, u_sort, u_jump, u_bsize;
float h1(float n) { return fract(sin(n * 91.345 + u_ev * 17.13) * 47453.5453); }
vec4 S(vec2 uv) { return texture2D(u_tex, clamp(uv, vec2(0.0), vec2(1.0))); }
void main() {
  vec2 uv = v_uv;
  // transform glitch: o quadro todo pula
  uv.x += (h1(1.0) - 0.5) * 0.08 * u_jump * u_amt;
  // block shift: faixas e blocos deslocados
  vec2 cell = floor(uv * vec2(u_bsize * 0.6, u_bsize));
  float hb = h1(cell.y * 7.0 + cell.x * 0.13);
  if (hb < 0.35 * u_amt * u_blocks) uv.x += (h1(cell.y + 3.0) - 0.5) * 0.25 * u_amt;
  float hr = h1(floor(uv.y * u_bsize * 3.0) + 11.0);
  if (hr < 0.12 * u_amt * u_blocks) uv.x += (h1(floor(uv.y * 40.0)) - 0.5) * 0.1;
  // channel scale + RGB split
  vec2 cc = uv - 0.5;
  float sc = u_chs * u_amt * 0.04;
  vec2 off = vec2(u_rgb * u_amt * 0.02 * (h1(5.0) > 0.5 ? 1.0 : -1.0), 0.0);
  vec4 r = S(0.5 + cc * (1.0 + sc) + off), g = S(uv), b = S(0.5 + cc * (1.0 - sc) - off);
  vec4 o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  // pixel sort vertical em colunas sorteadas
  float colH = h1(floor(uv.x * 60.0) + 21.0);
  if (colH < 0.3 * u_amt * u_sort) {
    for (int i = 1; i <= 12; i++) {
      vec4 s = S(uv - vec2(0.0, float(i) * 0.012 * u_amt));
      if (luma(s.rgb) > luma(o.rgb)) o = mix(o, s, 0.75);
    }
  }
  gl_FragColor = o;
}`);

// ---------------------------------------------------------------- Datamosh 2 (blocos de compressão arrastados)
const DATAMOSH = frag(`
uniform float u_amt, u_t, u_block, u_smear, u_seed;
void main() {
  vec2 px = v_uv * u_size;
  vec2 cell = floor(px / max(u_block, 2.0));
  float h = vnoise(cell * 0.37 + vec2(u_t * 0.7, u_seed));
  float on = step(1.0 - u_amt, h);
  vec2 dir = (vec2(vnoise(cell * 0.21 + u_t), vnoise(cell * 0.29 - u_t + 9.0)) - 0.5) * 2.0;
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 10; i++) {
    float k = float(i) / 9.0;
    vec2 q = (px - dir * u_smear * k * on) / u_size;
    float w = 1.0 - k * 0.5; acc += texture2D(u_tex, clamp(q, vec2(0.0), vec2(1.0))) * w; ws += w;
  }
  vec4 c = acc / ws;
  // "bleed" de cor do bloco (macro-bloco com a cor média)
  vec4 blk = texture2D(u_tex, (cell + 0.5) * max(u_block, 2.0) / u_size);
  gl_FragColor = mix(c, mix(c, blk, 0.55), on * u_amt);
}`);

// ---------------------------------------------------------------- VC Reflect
const REFLECT = frag(`
uniform float u_pos, u_op, u_fall, u_angle, u_blur;
void main() {
  vec2 cu = contentUV(v_uv);
  float horizon = u_pos + (cu.x - 0.5) * tan(u_angle);
  vec4 c = texture2D(u_tex, v_uv);
  if (cu.y <= horizon) { gl_FragColor = c; return; }
  float d = cu.y - horizon;
  vec2 q = vec2(cu.x, horizon - d);
  vec4 r = vec4(0.0);
  for (int i = -2; i <= 2; i++) r += (q.y < 0.0 ? vec4(0.0) : texture2D(u_tex, fromContent(q + vec2(float(i) * u_blur * d * 0.02, 0.0)))) / 5.0;
  float f = u_op * clamp(1.0 - d / max(u_fall, 0.01), 0.0, 1.0);
  gl_FragColor = r * f + c * (1.0 - r.a * f);
}`);

// ---------------------------------------------------------------- Quick Chromatic Aberration 2
const QCA = frag(`
uniform float u_amt, u_spread; uniform vec2 u_c;
void main() {
  vec2 d = v_uv - u_c;
  vec4 acc = vec4(0.0); vec3 ws = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float k = float(i) / 8.0;                      // 0..1 ao longo do espectro (vermelho → azul)
    float s = (k - 0.5) * u_amt * (1.0 + length(d) * 2.0);
    vec4 t = texture2D(u_tex, u_c + d * (1.0 + s * u_spread));
    vec3 w = vec3(1.0 - smoothstep(0.0, 0.5, k), 1.0 - abs(k - 0.5) * 2.0, smoothstep(0.5, 1.0, k)) + 0.05;
    acc.rgb += t.rgb * w; acc.a += t.a; ws += w;
  }
  gl_FragColor = vec4(acc.rgb / ws, acc.a / 9.0);
}`);

// ---------------------------------------------------------------- S_Halftone
const HALFTONE = frag(`
uniform float u_cell, u_ang, u_color, u_soft, u_mix;
float dotAt(vec2 px, float a, float v) {
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * px / u_cell;
  vec2 f = fract(p) - 0.5;
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.56;
  return 1.0 - smoothstep(r - u_soft, r + u_soft, length(f));
}
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 u = c.rgb / max(c.a, 1e-4);
  vec2 px = v_uv * u_size;
  vec3 o;
  if (u_color > 0.5) {
    vec3 cmy = 1.0 - u;
    float k = min(cmy.r, min(cmy.g, cmy.b));
    vec3 ink = vec3(dotAt(px, u_ang + 0.26, cmy.r), dotAt(px, u_ang + 1.31, cmy.g), dotAt(px, u_ang, cmy.b));
    o = (1.0 - ink) * (1.0 - dotAt(px, u_ang + 0.79, k) * 0.9);
  } else o = vec3(1.0 - dotAt(px, u_ang, 1.0 - luma(u)));
  gl_FragColor = vec4(mix(u, o, u_mix) * c.a, c.a);
}`);

// ---------------------------------------------------------------- Universe Holomatrix
const HOLO = frag(`
uniform float u_amt, u_t, u_lines, u_glitch, u_rgb; uniform vec3 u_col;
void main() {
  vec2 uv = v_uv;
  float band = step(0.93, fract(sin(floor(uv.y * 30.0 + u_t * 7.0) * 12.9898) * 43758.5453));
  uv.x += band * u_glitch * 0.03 * (fract(u_t * 13.0) - 0.5);
  vec4 c = texture2D(u_tex, uv);
  vec4 r = texture2D(u_tex, uv + vec2(u_rgb * 0.006, 0.0)), b = texture2D(u_tex, uv - vec2(u_rgb * 0.006, 0.0));
  vec3 x = vec3(r.r, c.g, b.b);
  float l = luma(x);
  vec3 holo = u_col * (0.25 + l * 1.4);
  float scan = 0.75 + 0.25 * sin((uv.y * u_size.y / max(u_lines, 1.0)) * 6.2831 + u_t * 10.0);
  float flick = 0.9 + 0.1 * sin(u_t * 47.0) * sin(u_t * 13.0);
  vec3 o = mix(x, holo * scan * flick, u_amt);
  gl_FragColor = vec4(o * c.a, c.a * mix(1.0, 0.85 + 0.15 * scan, u_amt));
}`);

export default [
  {
    type: 'tracery', label: 'Tracery (blob tracking)', category: 'Estilizar', plugin: 'Tracery (DRAGOY / aescripts)',
    description: 'O efeito viral de “blob tracking” (recriação do DRAGOY Tracery): acha manchas de uma cor (Key Color) ou claras/escuras a cada quadro e desenha caixas, texto, marcadores, setas e linhas ligando os pontos (Sequencial, Estrela, Todos ou Árvore mínima), retas ou curvas, contínuas ou tracejadas.',
    params: [
      sel('track', 'Rastrear', ['Partes claras', 'Partes escuras', 'Key Color (uma cor)'], 1), col('trackColor', 'Key Color', [1, 0.85, 0.1, 1]),
      num('threshold', 'Threshold %', 70, 0, 100), num('blurStrength', 'Blur Strength', 0, 0, 20, 0.5), sel('quality', 'Detection Quality', ['Extreme', 'High', 'Standard', 'Medium', 'Low', 'Draft'], 3),
      num('maxBlobs', 'Máximo de pontos', 10, 1, 40, 1), num('minSize', 'Tamanho mínimo', 4, 1, 400, 1), bool('showMask', 'Show Mask', false), bool('alphaOnly', 'Só os gráficos (fundo transparente)', false),
      // Bounding boxes
      bool('boxes', 'Bounding Boxes', true), col('boxColor', 'Border Color', [1, 1, 1, 1]), num('lineWidth', 'Border Thickness', 2, 0.25, 12, 0.25),
      col('boxFill', 'Fill Color', [1, 1, 1, 1]), num('boxFillOpacity', 'Fill Opacity %', 0, 0, 100), bool('gaps', 'Enable Gaps (cantos)', false), num('gapSize', 'Gap Size', 0.3, 0, 0.95, 0.01),
      sel('fill', 'Dentro da caixa', ['Nada', 'Inverter', 'Preto e branco', 'Tingir'], 1), col('tint', 'Cor do tingimento', [0.2, 0.9, 1, 1]),
      // Texto
      bool('labels', 'Text', true), col('textColor', 'Text Color', [1, 1, 1, 1]), num('fontScale', 'Font Scale', 1, 0.2, 8, 0.05), num('textOffset', 'Text Vertical Offset', 0, -2, 2, 0.01),
      // Marcadores
      bool('crosshair', 'Center Markers', true), sel('markerType', 'Marker Type', ['Dot', 'Plus', 'Cross'], 2), col('markerColor', 'Marker Color', [1, 1, 1, 1]), num('markerSize', 'Marker Size', 6, 0.5, 60, 0.5), num('markerThickness', 'Marker Line Thickness', 1.5, 0.25, 8, 0.25),
      // Linhas de conexão
      bool('connect', 'Connection Lines', true), sel('connType', 'Connection Type', ['Sequential', 'Star', 'Full', 'MST'], 1), col('color', 'Line Color', [1, 1, 1, 1]),
      num('lineOpacity', 'Line Opacity %', 100, 0, 100), num('connWidth', 'Line Thickness', 2, 0.1, 12, 0.05), num('curvature', 'Curvature', 0, -1, 1, 0.01),
      bool('dashed', 'Dashed Lines', false), num('dashLen', 'Dash Length', 12, 0.5, 200, 0.5), num('gapLen', 'Gap Length', 8, 0.5, 200, 0.5),
      // Setas
      bool('arrows', 'Arrows', false), num('arrowSize', 'Arrow Size', 15, 1, 80, 0.5), num('arrowAngle', 'Arrow Angle', 0.5, 0.05, 1.5, 0.01), num('arrowPos', 'Arrow Position', 0.5, 0, 1, 0.01), bool('arrowFilled', 'Filled Arrows', false),
    ],
    render: (src, p, env) => {
      if (!env.srcCanvas || !trCanvas) return src;
      const { gl } = env;
      const W = src.w, H = src.h, k = Math.max(0.35, env.scale) * (Math.max(W, H) / Math.max(1, env.scale) / 1080);
      const blobs = findBlobs(env.srcCanvas, p);
      const ov = trCanvas.ov, mk = trCanvas.mk;
      ov.width = W; ov.height = H; mk.width = W; mk.height = H;
      const o = ov.getContext('2d'), m = mk.getContext('2d');
      const css = (c, a = 1) => `rgba(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')},${a})`;
      m.fillStyle = '#fff';
      const pts = blobs.map((bx) => ({ ...bx, cx: (bx.x + bx.w / 2) * W, cy: (bx.y + bx.h / 2) * H }));
      // ---- linhas
      if (p.connect && pts.length > 1) {
        const pairs = [];
        const t = p.connType || 1;
        if (t === 1) for (let i = 1; i < pts.length; i++) pairs.push([i - 1, i]);
        else if (t === 2) for (let i = 1; i < pts.length; i++) pairs.push([0, i]);
        else if (t === 3) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) pairs.push([i, j]);
        else { // árvore geradora mínima (Prim)
          const inT = new Set([0]);
          while (inT.size < pts.length) {
            let best = null, bd = Infinity;
            for (const i of inT) pts.forEach((q, j) => { if (!inT.has(j)) { const d = Math.hypot(q.cx - pts[i].cx, q.cy - pts[i].cy); if (d < bd) { bd = d; best = [i, j]; } } });
            pairs.push(best); inT.add(best[1]);
          }
        }
        o.strokeStyle = css(p.color, (p.lineOpacity ?? 100) / 100); o.fillStyle = o.strokeStyle;
        o.lineWidth = Math.max(0.5, (p.connWidth ?? p.lineWidth) * k);
        o.setLineDash(p.dashed ? [Math.max(1, p.dashLen * k), Math.max(1, p.gapLen * k)] : []);
        for (const [a, b] of pairs) {
          const A = pts[a], B = pts[b], dx = B.cx - A.cx, dy = B.cy - A.cy, d = Math.hypot(dx, dy) || 1;
          const mx = (A.cx + B.cx) / 2 - (dy / d) * d * 0.5 * (p.curvature || 0), my = (A.cy + B.cy) / 2 + (dx / d) * d * 0.5 * (p.curvature || 0);
          o.beginPath(); o.moveTo(A.cx, A.cy); o.quadraticCurveTo(mx, my, B.cx, B.cy); o.stroke();
          if (p.arrows) {
            const u = p.arrowPos ?? 0.5, iu = 1 - u;
            const px = iu * iu * A.cx + 2 * iu * u * mx + u * u * B.cx, py = iu * iu * A.cy + 2 * iu * u * my + u * u * B.cy;
            const tx = 2 * iu * (mx - A.cx) + 2 * u * (B.cx - mx), ty = 2 * iu * (my - A.cy) + 2 * u * (B.cy - my), ang = Math.atan2(ty, tx);
            const s = p.arrowSize * k, sp = p.arrowAngle ?? 0.5;
            o.setLineDash([]); o.beginPath();
            o.moveTo(px - Math.cos(ang - sp) * s, py - Math.sin(ang - sp) * s); o.lineTo(px, py); o.lineTo(px - Math.cos(ang + sp) * s, py - Math.sin(ang + sp) * s);
            if (p.arrowFilled) { o.closePath(); o.fill(); } else o.stroke();
            o.setLineDash(p.dashed ? [Math.max(1, p.dashLen * k), Math.max(1, p.gapLen * k)] : []);
          }
        }
        o.setLineDash([]);
      }
      pts.forEach((b, i) => {
        const x = b.x * W, y = b.y * H, w = Math.max(6, b.w * W), h = Math.max(6, b.h * H);
        // ---- caixas (com cantos abertos = Gaps)
        if (p.boxes) {
          if ((p.boxFillOpacity || 0) > 0) { o.fillStyle = css(p.boxFill || [1, 1, 1, 1], p.boxFillOpacity / 100); o.fillRect(x, y, w, h); }
          o.strokeStyle = css(p.boxColor || p.color); o.lineWidth = Math.max(0.5, p.lineWidth * k);
          if (p.gaps) {
            const gx = (w * (1 - p.gapSize)) / 2, gy = (h * (1 - p.gapSize)) / 2;
            o.beginPath();
            for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) { o.moveTo(cx + sx * gx, cy); o.lineTo(cx, cy); o.lineTo(cx, cy + sy * gy); }
            o.stroke();
          } else o.strokeRect(x, y, w, h);
        }
        if (p.fill !== 1) m.fillRect(x, y, w, h);
        // ---- marcadores no centro
        if (p.crosshair) {
          const s = (p.markerSize ?? 6) * k; o.strokeStyle = css(p.markerColor || p.color); o.fillStyle = o.strokeStyle; o.lineWidth = Math.max(0.5, (p.markerThickness ?? 1.5) * k);
          o.beginPath();
          if ((p.markerType || 2) === 1) { o.arc(b.cx, b.cy, s / 2, 0, Math.PI * 2); o.fill(); }
          else if (p.markerType === 3) { o.moveTo(b.cx - s, b.cy - s); o.lineTo(b.cx + s, b.cy + s); o.moveTo(b.cx + s, b.cy - s); o.lineTo(b.cx - s, b.cy + s); o.stroke(); }
          else { o.moveTo(b.cx - s, b.cy); o.lineTo(b.cx + s, b.cy); o.moveTo(b.cx, b.cy - s); o.lineTo(b.cx, b.cy + s); o.stroke(); }
        }
        // ---- texto
        if (p.labels) {
          o.fillStyle = css(p.textColor || p.color);
          o.font = `${Math.max(7, Math.round(11 * k * (p.fontScale ?? 1)))}px ui-monospace, Menlo, monospace`;
          o.fillText(`ID ${String(i + 1).padStart(2, '0')}  ${(b.cx / W).toFixed(3)} ${(b.cy / H).toFixed(3)}`, x, Math.max(10, y - 4 + (p.textOffset || 0) * h));
        }
      });
      if (p.showMask) { // mostra o que está sendo rastreado (como o "Show Mask" do plugin)
        o.globalCompositeOperation = 'destination-over'; o.fillStyle = 'rgba(0,0,0,0.6)'; o.fillRect(0, 0, W, H); o.globalCompositeOperation = 'source-over';
      }
      const tov = gl.upload(ov), tmk = gl.upload(mk);
      return gl.pass(TRACERY_MIX, { u_tex: src, u_ov: tov, u_mask: tmk, u_mode: p.fill, u_tint: rgb(p.tint), u_alpha: p.alphaOnly ? 1 : 0 });
    },
  },
  {
    type: 'glitchify', label: 'Glitchify', category: 'Estilizar', plugin: 'Glitchify (Cinema Spice)',
    description: 'Glitch digital com eventos aleatórios: block shift, RGB split, channel scale, pixel sort e transform glitch — cada um pode ser ligado/desligado.',
    params: [
      num('amount', 'Intensidade %', 70, 0, 100), num('speed', 'Eventos por segundo', 8, 0.5, 30, 0.5), num('probability', 'Chance de glitch %', 60, 0, 100), num('seed', 'Semente', 1, 0, 999),
      bool('blocks', 'Block shift', true), num('blockSize', 'Tamanho dos blocos', 18, 2, 80, 1), bool('rgb', 'RGB split', true), bool('channelScale', 'Channel scale', true),
      bool('pixelSort', 'Pixel sort', true), bool('jump', 'Transform glitch (pulo)', true),
    ],
    render: (src, p, env) => {
      const ev = Math.floor(env.t * p.speed);
      if (hash1(ev * 7.13 + p.seed) > p.probability / 100) return src;
      const amt = (p.amount / 100) * (0.5 + 0.5 * hash1(ev * 3.1 + p.seed * 0.7));
      return env.gl.pass(GLITCHIFY, { u_tex: src, u_amt: amt, u_ev: ev + p.seed * 13, u_blocks: p.blocks, u_rgb: p.rgb, u_chs: p.channelScale, u_sort: p.pixelSort, u_jump: p.jump, u_bsize: p.blockSize });
    },
  },
  {
    type: 'datamosh', label: 'Datamosh 2', category: 'Estilizar', plugin: 'Datamosh 2 (aescripts)',
    description: 'Simula o “datamosh”: macro-blocos de compressão que arrastam e misturam a imagem (pixel bleed). Anime a intensidade nas transições.',
    params: [num('amount', 'Intensidade %', 50, 0, 100), num('block', 'Tamanho do bloco (px)', 16, 4, 96, 1), num('smear', 'Arraste (px)', 60, 0, 600), num('evolution', 'Evolução /s', 1.2, 0, 10, 0.1), num('seed', 'Semente', 1, 0, 999)],
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(DATAMOSH, { u_tex: src, u_amt: p.amount / 100, u_block: p.block * env.scale, u_smear: p.smear * env.scale, u_t: env.t * p.evolution, u_seed: p.seed })),
  },
  {
    type: 'reflect', label: 'VC Reflect (reflexo)', category: 'Distorção', plugin: 'VC Reflect (Video Copilot)',
    description: 'Reflexo espelhado abaixo de uma linha (chão brilhante), com queda suave e desfoque.',
    params: [num('position', 'Linha do reflexo %', 75, 0, 100), ang('angle', 'Inclinação', 0), num('opacity', 'Opacidade %', 60, 0, 100), num('falloff', 'Queda %', 35, 1, 100), num('blur', 'Desfoque', 1, 0, 10, 0.1)],
    render: (src, p, env) => env.gl.pass(REFLECT, { u_tex: src, u_pos: p.position / 100, u_op: p.opacity / 100, u_fall: p.falloff / 100, u_angle: rad(Math.max(-60, Math.min(60, p.angle))), u_blur: p.blur }),
  },
  {
    type: 'qca', label: 'Quick Chromatic Aberration 2', category: 'Estilizar', plugin: 'Quick Chromatic Aberration 2',
    description: 'Aberração cromática suave em espectro (vermelho → azul) a partir do centro, como lentes reais.',
    params: [num('amount', 'Intensidade', 6, 0, 60, 0.1), num('spread', 'Espalhamento', 1, 0.1, 4, 0.05), { key: 'center', label: 'Centro', kind: 'pos', default: [0.5, 0.5] }],
    pad: (p) => p.amount * 2,
    render: (src, p, env) => (p.amount <= 0 ? src : env.gl.pass(QCA, { u_tex: src, u_amt: p.amount / 100, u_spread: p.spread, u_c: [env.rect[0] + p.center[0] * env.rect[2], env.rect[1] + p.center[1] * env.rect[3]] })),
  },
  {
    type: 'halftone', label: 'S_Halftone (meio-tom)', category: 'Estilizar', plugin: 'S_Halftone (Sapphire) / CC Ball Action',
    description: 'Retícula de pontos (jornal/quadrinho), em cor (CMYK) ou preto e branco.',
    params: [num('cell', 'Tamanho do ponto (px)', 10, 2, 80, 0.5), ang('angle', 'Ângulo', 45), sel('mode', 'Modo', ['Preto e branco', 'Cor (CMYK)'], 2), num('softness', 'Suavidade', 0.08, 0, 0.5, 0.01), num('mix', 'Mistura %', 100, 0, 100)],
    render: (src, p, env) => env.gl.pass(HALFTONE, { u_tex: src, u_cell: Math.max(2, p.cell * env.scale), u_ang: rad(p.angle), u_color: p.mode === 2, u_soft: p.softness, u_mix: p.mix / 100 }),
  },
  {
    type: 'holomatrix', label: 'Universe Holomatrix', category: 'Estilizar', plugin: 'Universe Holomatrix (Red Giant)',
    description: 'Visual de holograma: cor neon, linhas de varredura, cintilação, RGB e faixas de glitch.',
    params: [num('amount', 'Intensidade %', 80, 0, 100), col('color', 'Cor', [0.25, 0.85, 1, 1]), num('lines', 'Espaço das linhas (px)', 4, 1, 40, 0.5), num('glitch', 'Glitch', 1, 0, 5, 0.1), num('rgb', 'RGB split', 1, 0, 10, 0.1)],
    render: (src, p, env) => env.gl.pass(HOLO, { u_tex: src, u_amt: p.amount / 100, u_t: env.t, u_lines: p.lines * env.scale, u_glitch: p.glitch, u_rgb: p.rgb, u_col: rgb(p.color) }),
  },
];
