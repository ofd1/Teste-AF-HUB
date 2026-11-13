// Identificador de fontes (estilo WhatTheFont, feito no aparelho): você marca o texto na imagem e digita o que está
// escrito; o app desenha esse mesmo texto em cada fonte do catálogo (Google Fonts) em vários pesos, compara as formas
// com a referência e devolve as mais parecidas. Para a melhor, ainda ajusta largura (esticar), espaçamento e peso —
// a "fonte ajustada à referência", pronta para usar num texto.
import { GOOGLE_FONTS, ensureFont } from './fonts.js';

const H = 64; // altura de comparação

/** Máscara binária (0/1) do texto num recorte, normalizada para altura H. */
export function refMask(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const lum = (i) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  const bl = border.map(lum).sort((a, b) => a - b)[border.length >> 1];
  const ink = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) if (Math.abs(lum(i) - bl) > 60) { ink[i] = 1; const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return normalize(ink, w, x0, y0, x1, y1);
}
function normalize(ink, w, x0, y0, x1, y1) {
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, W = Math.max(4, Math.round((bw / bh) * H));
  const m = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // média da área (anti-alias) para a redução
    const sx0 = x0 + (x / W) * bw, sx1 = x0 + ((x + 1) / W) * bw, sy0 = y0 + (y / H) * bh, sy1 = y0 + ((y + 1) / H) * bh;
    let s = 0, n = 0;
    for (let yy = Math.floor(sy0); yy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); yy++) for (let xx = Math.floor(sx0); xx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); xx++) { s += ink[yy * w + xx] || 0; n++; }
    m[y * W + x] = s / Math.max(1, n);
  }
  return { m, W, aspect: bw / bh };
}

/** Desenha o texto numa fonte e devolve a máscara normalizada. */
function fontMask(text, family, weight, tracking = 0) {
  const fs = 120, c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `${weight} ${fs}px "${family}"`;
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const tw = widths.reduce((a, b) => a + b, 0) + tracking * fs * Math.max(0, chars.length - 1);
  c.width = Math.ceil(tw + fs); c.height = Math.ceil(fs * 2);
  g.font = `${weight} ${fs}px "${family}"`; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  let x = fs / 2;
  chars.forEach((ch, i) => { g.fillText(ch, x, fs); x += widths[i] + tracking * fs; });
  const w = c.width, h = c.height, d = g.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h); let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 110) { ink[i] = 1; const xx = i % w, yy = (i / w) | 0; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  if (x1 < 0) return null;
  return normalize(ink, w, x0, y0, x1, y1);
}

/** Semelhança de forma (IoU suave) depois de esticar a candidata para a largura da referência. */
function blurMask(m, W) {
  // caixa 3×3 duas vezes: tolera desalinhamentos de 1–2 px (traços parecidos contam como iguais)
  let a = m;
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += a[yy * W + xx]; n++; } }
      o[y * W + x] = s / n;
    }
    a = o;
  }
  return a;
}
function similarity(ref, cand) {
  if (!ref.mb) ref.mb = blurMask(ref.m, ref.W);
  // candidata reamostrada na largura da referência e suavizada igual
  const W = ref.W, cm = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cm[y * W + x] = cand.m[y * cand.W + Math.min(cand.W - 1, Math.floor((x / W) * cand.W))];
  const cb = blurMask(cm, W);
  let inter = 0, uni = 0, i2 = 0, u2 = 0;
  for (let i = 0; i < W * H; i++) { inter += Math.min(ref.mb[i], cb[i]); uni += Math.max(ref.mb[i], cb[i]); i2 += Math.min(ref.m[i], cm[i]); u2 += Math.max(ref.m[i], cm[i]); }
  return uni && u2 ? (inter / uni) * 0.5 + (i2 / u2) * 0.5 : 0;
}
function similarityOld(ref, cand) {
  const W = ref.W; let inter = 0, uni = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = Math.min(cand.W - 1, Math.floor((x / W) * cand.W));
    const a = ref.m[y * W + x], b = cand.m[y * cand.W + cx];
    inter += Math.min(a, b); uni += Math.max(a, b);
  }
  return uni ? inter / uni : 0;
}

/**
 * Identifica a fonte. canvas = recorte com o texto; text = o que está escrito.
 * onProgress(0..1). Retorna [{ family, weight, score (0..1), stretch, tracking }] da mais parecida para a menos.
 */
export async function identifyFont(canvas, text, { families = GOOGLE_FONTS, onProgress } = {}) {
  const ref = refMask(canvas);
  if (!ref) throw new Error('não achei texto no recorte');
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('digite o texto que aparece na imagem');
  // carrega as fontes (em lotes, sem travar) e confere de verdade se cada peso chegou: compara a largura com a fonte
  // reserva (monospace) — se for igual, a fonte não carregou e não entra na comparação
  const fams = families.filter((f) => !/Script|Vibes|Sacramento|Allura|Yellowtail|Satisfy|Caveat|Dancing|Marck|Indie|Gloria|Shadows|Amatic|Rock Salt|Permanent|Kaushan|Pacifico|Lobster/i.test(f));
  const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];
  const probe = document.createElement('canvas').getContext('2d');
  const loadedW = (f, w) => { probe.font = `${w} 40px monospace`; const a = probe.measureText('UNIBRAS mwil 0123').width; probe.font = `${w} 40px "${f}", monospace`; return Math.abs(probe.measureText('UNIBRAS mwil 0123').width - a) > 0.5; };
  const avail = new Map();
  let done = 0;
  for (let i = 0; i < fams.length; i += 10) {
    await Promise.all(fams.slice(i, i + 10).map(async (f) => {
      await Promise.race([ensureFont(`"${f}"`), new Promise((r) => setTimeout(r, 8000))]);
      await Promise.race([Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 40px "${f}"`).catch(() => null))), new Promise((r) => setTimeout(r, 8000))]);
      const ws = WEIGHTS.filter((w) => loadedW(f, w));
      if (ws.length) avail.set(f, ws);
      done++;
    }));
    onProgress?.((done / fams.length) * 0.55);
  }
  const res = [];
  let k = 0;
  for (const [f, ws] of avail) {
    let best = null;
    for (const wgt of ws) {
      const cand = fontMask(t, f, wgt);
      if (!cand) continue;
      const stretch = ref.aspect / cand.aspect;
      const s = similarity(ref, cand) - 0.3 * Math.abs(Math.log(stretch));
      if (!best || s > best.score) best = { family: f, weight: wgt, score: s, stretch };
    }
    if (best) res.push(best);
    if (++k % 8 === 0) { onProgress?.(0.55 + (k / avail.size) * 0.4); await new Promise((r) => setTimeout(r, 0)); }
  }
  res.sort((a, b) => b.score - a.score);
  // ajuste fino das melhores: espaçamento entre letras e peso que deixam a forma mais igual (sem esticar)
  for (const r of res.slice(0, 6)) {
    let bt = 0, bs = -1;
    for (const tr of [-0.06, -0.03, 0, 0.03, 0.06, 0.1, 0.15, 0.22, 0.3]) {
      const cand = fontMask(t, r.family, r.weight, tr); if (!cand) continue;
      const st = ref.aspect / cand.aspect;
      const s = similarity(ref, cand) - 0.3 * Math.abs(Math.log(st));
      if (s > bs) { bs = s; bt = tr; r.stretch = st; }
    }
    r.tracking = bt; r.score = Math.max(r.score, bs);
  }
  onProgress?.(1);
  res.sort((a, b) => b.score - a.score);
  return res.map((r) => ({ ...r, score: Math.max(0, Math.min(1, r.score)), tracking: r.tracking || 0 }));
}

/** Aplica o resultado num texto: fonte, peso, espaçamento (px) e largura (escala X). */
export function applyFontResult(layer, r) {
  const p = layer.props;
  p.fontFamily = `"${r.family}", sans-serif`;
  p.fontWeight = r.weight;
  p.letterSpacing = Math.round((r.tracking || 0) * p.fontSize * 10) / 10;
  if (Math.abs((r.stretch || 1) - 1) > 0.03) {
    const sc = layer.transform.scale; const v = sc.value || [100, 100];
    sc.value = [Math.round(v[1] * r.stretch * 10) / 10, v[1]]; sc.keys = [];
  }
}
