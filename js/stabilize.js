// Estabilização (como a do Topaz Video AI / Warp Stabilizer): mede o movimento global da câmera entre quadros
// (translação + rotação a partir de 4 regiões), suaviza o caminho da câmera e grava a correção como keyframes
// no efeito "Estabilizar".
import { loadVideo, seek, grayFrame } from './tracker.js';
import { sourceTime } from './timing.js';
import { contentSize } from './renderer.js';
import { createEffectInstance } from './presets.js';
import { setExporting } from './media.js';

const AW = 192; // largura de análise

function sad(a, b, w, h, x0, y0, bw, bh, dx, dy, best) {
  let s = 0;
  for (let y = y0; y < y0 + bh; y += 2) {
    const yb = Math.min(h - 1, Math.max(0, y + dy));
    for (let x = x0; x < x0 + bw; x += 2) {
      const xb = Math.min(w - 1, Math.max(0, x + dx));
      s += Math.abs(a[y * w + x] - b[yb * w + xb]);
      if (s > best) return s;
    }
  }
  return s;
}

function half(g, w, h) {
  const w2 = w >> 1, h2 = h >> 1, o = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const i = (y * 2) * w + x * 2;
    o[y * w2 + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1]) / 4;
  }
  return o;
}

/** Deslocamento de um bloco: busca grossa em meia resolução e refinamento fino (pega tremidas grandes). */
function blockShift2(a, b, a2, b2, w, h, x0, y0, bw, bh, R) {
  const w2 = w >> 1, h2 = h >> 1;
  const [cx, cy] = blockShift(a2, b2, w2, h2, x0 >> 1, y0 >> 1, bw >> 1, bh >> 1, R, 0, 0);
  return blockShift(a, b, w, h, x0, y0, bw, bh, 3, Math.round(cx * 2), Math.round(cy * 2));
}

/** Deslocamento de um bloco entre dois quadros (busca + sub-pixel), centrado em (ix, iy). */
function blockShift(a, b, w, h, x0, y0, bw, bh, R, ix = 0, iy = 0) {
  let best = Infinity, bx = ix, by = iy;
  for (let dy = iy - R; dy <= iy + R; dy++) for (let dx = ix - R; dx <= ix + R; dx++) {
    const s = sad(a, b, w, h, x0, y0, bw, bh, dx, dy, best);
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  const c = (dx, dy) => sad(a, b, w, h, x0, y0, bw, bh, dx, dy, Infinity);
  const cx0 = c(bx - 1, by), cx1 = c(bx + 1, by), cy0 = c(bx, by - 1), cy1 = c(bx, by + 1);
  const sx = Math.max(-0.5, Math.min(0.5, (cx0 - cx1) / (2 * (cx0 + cx1 - 2 * best) || 1)));
  const sy = Math.max(-0.5, Math.min(0.5, (cy0 - cy1) / (2 * (cy0 + cy1 - 2 * best) || 1)));
  return [bx + sx, by + sy];
}

function gaussSmooth(arr, sigma) {
  if (sigma < 0.5) return arr.slice();
  const r = Math.ceil(sigma * 3), out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(arr.length - 1, Math.max(0, i + k));
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      s += arr[j] * w; ws += w;
    }
    out[i] = s / ws;
  }
  return out;
}

/**
 * Analisa e estabiliza a camada de vídeo. strength 0..100 (suavização do caminho), mode 1 auto-crop / 2 full frame.
 * jitter=true: só remove tremidas rápidas (mantém o movimento de câmera intencional).
 */
export async function stabilizeLayer(opts) {
  // pausa o cache de quadros enquanto analisa (dois decodificadores no mesmo vídeo deixam tudo muito lento)
  setExporting(true);
  try { return await analyze(opts); } finally { setExporting(false); }
}

async function analyze({ layer, project, strength = 60, mode = 1, jitter = false, onProgress, isCancelled }) {
  const v = await loadVideo(layer.props.src);
  const vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const aw = Math.min(AW, vw), ah = Math.round((aw * vh) / vw);
  const c = document.createElement('canvas'); c.width = aw; c.height = ah;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const fps = project.fps;
  const times = [];
  for (let t = layer.inPoint; t < layer.outPoint - 1e-6; t += 1 / fps) times.push(t);
  // 4 regiões (cantos internos) para separar translação e rotação
  const bw = Math.round(aw * 0.3), bh = Math.round(ah * 0.22), R = Math.max(6, Math.round(aw / 14));
  const blocks = [[0.12, 0.12], [0.58, 0.12], [0.12, 0.66], [0.58, 0.66]].map(([fx, fy]) => [Math.round(fx * aw), Math.round(fy * ah)]);
  let prev = null, prev2 = null;
  const path = { x: [0], y: [0], r: [0] };
  for (let i = 0; i < times.length; i++) {
    if (isCancelled?.()) break;
    await seek(v, sourceTime(layer, times[i]) + 0.3 / fps); // dentro do quadro (na borda o navegador às vezes devolve o anterior)
    const g = grayFrame(v, ctx, aw, ah);
    const g2 = half(g, aw, ah);
    if (prev) {
      const sh = blocks.map(([x0, y0]) => blockShift2(prev, g, prev2, g2, aw, ah, x0, y0, bw, bh, R));
      // translação = média; rotação = componente tangencial em torno do centro
      const tx = sh.reduce((s, d) => s + d[0], 0) / 4, ty = sh.reduce((s, d) => s + d[1], 0) / 4;
      let rot = 0;
      blocks.forEach(([x0, y0], k) => {
        const px = x0 + bw / 2 - aw / 2, py = y0 + bh / 2 - ah / 2;
        const r2 = px * px + py * py || 1;
        rot += ((sh[k][1] - ty) * px - (sh[k][0] - tx) * py) / r2;
      });
      rot /= 4;
      path.x.push(path.x[i - 1] + tx); path.y.push(path.y[i - 1] + ty); path.r.push(path.r[i - 1] + rot);
    }
    prev = g; prev2 = g2;
    onProgress?.((i + 1) / times.length);
  }
  v.removeAttribute('src'); v.load();
  const n = path.x.length;
  // força → janela de suavização (quadros). jitter: janela curta (só tremida)
  const sigma = jitter ? 1.5 + strength / 25 : 2 + (strength / 100) * fps * 1.2;
  const sx = gaussSmooth(path.x, sigma), sy = gaussSmooth(path.y, sigma), sr = gaussSmooth(path.r, sigma);
  const { w, h } = contentSize(layer, project);
  const k = w / aw; // px da análise → px da camada
  const dx = [], dy = [], dr = [];
  let maxX = 0, maxY = 0, maxR = 0;
  for (let i = 0; i < n; i++) {
    dx.push(-(path.x[i] - sx[i]) * k); dy.push(-(path.y[i] - sy[i]) * k); dr.push(-((path.r[i] - sr[i]) * 180) / Math.PI);
    maxX = Math.max(maxX, Math.abs(dx[i])); maxY = Math.max(maxY, Math.abs(dy[i])); maxR = Math.max(maxR, Math.abs(dr[i]));
  }
  const rotMargin = Math.sin((maxR * Math.PI) / 180) * Math.max(w, h) / Math.min(w, h);
  const zoom = Math.min(160, 100 * (1 + Math.max((2 * maxX) / w, (2 * maxY) / h) + rotMargin) + 0.5);
  let fx = layer.effects.find((f) => f.type === 'stabilize');
  if (!fx) { fx = createEffectInstance('stabilize', {}); layer.effects.unshift(fx); }
  const keys = (arr) => arr.map((val, i) => ({ t: +times[i].toFixed(4), v: +val.toFixed(2), ease: 'linear' }));
  fx.params.dx = { value: 0, keys: keys(dx) };
  fx.params.dy = { value: 0, keys: keys(dy) };
  fx.params.rot = { value: 0, keys: keys(dr) };
  fx.params.mode = { value: mode, keys: [] };
  fx.params.zoom = { value: +zoom.toFixed(1), keys: [] };
  return { frames: n, maxX, maxY, maxR, zoom, path, aw };
}
