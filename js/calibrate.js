// Calibração automática de CC por print: compara o quadro atual (com o CC importado) com um print do
// After Effects e cria um Looks de correção (pretos, meios-tons e brancos por canal + saturação).
// Funciona com qualquer CC: o .ffx dá o caminho e o print acerta o resultado final.
import { createEffectInstance } from './presets.js';

export const CALIB_LABEL = 'Calibração (print do AE)';
const N = 320; // lado maior da amostra

function pixelsOf(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/** Corta faixas lisas nas bordas (barras pretas/brancas de prints do celular). */
function trimBorders(d, w, h) {
  const rowFlat = (y) => { let s = 0, s2 = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, l = (d[i] + d[i + 1] + d[i + 2]) / 765; s += l; s2 += l * l; } const m = s / w; return s2 / w - m * m < 0.0006; };
  const colFlat = (x, y0, y1) => { let s = 0, s2 = 0, n = 0; for (let y = y0; y < y1; y++) { const i = (y * w + x) * 4, l = (d[i] + d[i + 1] + d[i + 2]) / 765; s += l; s2 += l * l; n++; } const m = s / n; return s2 / n - m * m < 0.0006; };
  let y0 = 0, y1 = h, x0 = 0, x1 = w;
  while (y0 < h * 0.4 && rowFlat(y0)) y0++;
  while (y1 > h * 0.6 && rowFlat(y1 - 1)) y1--;
  while (x0 < w * 0.4 && colFlat(x0, y0, y1)) x0++;
  while (x1 > w * 0.6 && colFlat(x1 - 1, y0, y1)) x1--;
  return { x0, y0, x1, y1 };
}

function stats(d, w, h, box = { x0: 0, y0: 0, x1: w, y1: h }) {
  const ch = [[], [], []];
  let sat = 0, n = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = (y * w + x) * 4, r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    ch[0].push(r); ch[1].push(g); ch[2].push(b);
    sat += Math.max(r, g, b) - Math.min(r, g, b); n++;
  }
  const pct = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  return { q: ch.map((a) => { a.sort((u, v) => u - v); return [pct(a, 0.03), pct(a, 0.5), pct(a, 0.97)]; }), sat: sat / Math.max(1, n) };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Resolve lift/gain/gamma (mesma fórmula do Looks: gain·(x + lift·(1−x)), depois x^(1/gamma)) para levar (p3,p50,p97) → alvo. */
function solveChannel([a, m, b], [ta, tm, tb]) {
  let gamma = 1, A = 0, B = 1;
  for (let it = 0; it < 8; it++) {
    const ua = ta ** gamma, ub = tb ** gamma;
    B = (ub - ua) / Math.max(1e-3, b - a); A = ua - B * a;
    const mid = clamp(A + B * m, 1e-3, 0.999);
    gamma = clamp(Math.log(mid) / Math.log(clamp(tm, 0.01, 0.99)), 0.4, 2.5);
  }
  const gain = A + B, lift = gain > 1e-3 ? A / gain : 0;
  return { lift: clamp(lift, -0.5, 0.5), gain: clamp(gain, 0.2, 3), gamma };
}

/**
 * Calibra a camada `layer` (ou a camada de ajuste por cima de tudo) para o quadro `t` ficar como o print.
 * render(canvas) desenha o quadro atual do projeto na canvas.
 */
export async function calibrateFromImage(store, layer, file, render) {
  const img = await createImageBitmap(file);
  // remove a calibração anterior para medir o CC "puro"
  layer.effects = layer.effects.filter((fx) => fx.label !== CALIB_LABEL);
  const W = store.project.width, H = store.project.height, k = N / Math.max(W, H);
  const cw = Math.max(16, Math.round(W * k)), chh = Math.max(16, Math.round(H * k));
  const cur = document.createElement('canvas'); cur.width = cw; cur.height = chh;
  await render(cur);
  const od = pixelsOf(cur, cw, chh);
  const ours = stats(od, cw, chh);
  const rk = N / Math.max(img.width, img.height), rw = Math.max(16, Math.round(img.width * rk)), rh = Math.max(16, Math.round(img.height * rk));
  const rd = pixelsOf(img, rw, rh);
  const ref = stats(rd, rw, rh, trimBorders(rd, rw, rh));
  const sol = [0, 1, 2].map((c) => solveChannel(ours.q[c], ref.q[c]));
  // saturação medida DEPOIS da correção de níveis (esticar os níveis já aumenta a cor)
  let ms = 0, mn = 0;
  for (let i = 0; i < od.length; i += 4) {
    const v = [0, 1, 2].map((c) => { const x = od[i + c] / 255, o = sol[c]; return clamp(o.gain * (x + o.lift * (1 - x)), 0, 1) ** (1 / o.gamma); });
    ms += Math.max(...v) - Math.min(...v); mn++;
  }
  const satRatio = ref.sat / Math.max(0.01, ms / Math.max(1, mn));
  const params = {
    strength: 100,
    liftR: sol[0].lift, liftG: sol[1].lift, liftB: sol[2].lift,
    gammaR: sol[0].gamma, gammaG: sol[1].gamma, gammaB: sol[2].gamma,
    gainR: sol[0].gain, gainG: sol[1].gain, gainB: sol[2].gain,
    saturation: clamp(satRatio * 100, 25, 250),
  };
  layer.effects.push(createEffectInstance('looks', params, 0, { label: CALIB_LABEL }));
  store.commit();
  return { ours, ref, params };
}
