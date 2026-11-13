// Tracker de ponto (como o Track Point do After Effects): segue um pedaço da imagem quadro a quadro
// por casamento de blocos (SAD) com refinamento sub-pixel e atualização lenta do modelo.
import { sourceTime } from './timing.js';
import { contentSize, layerTransform, toLayerSpace } from './renderer.js';
import { valueAt, sortKeys } from './anim.js';
import { setExporting } from './media.js';

const AW = 360; // largura de análise (px)

export function loadVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => res(v);
    setTimeout(() => { if (v.readyState >= 1) res(v); }, 5000);
    v.onerror = () => rej(new Error('não foi possível abrir o vídeo'));
    v.src = src;
  });
}

export function seek(v, t) {
  return new Promise((res) => {
    // espera o quadro ser realmente apresentado (requestVideoFrameCallback) — sem isso, às vezes vem o quadro anterior
    let shown = !('requestVideoFrameCallback' in v);
    let seeked = false;
    const finish = () => { if (seeked && shown) { clearTimeout(to); res(); } };
    if (!shown) v.requestVideoFrameCallback(() => { shown = true; finish(); });
    const done = () => { v.removeEventListener('seeked', done); seeked = true; setTimeout(() => { shown = true; finish(); }, 120); finish(); };
    const to = setTimeout(() => { seeked = true; shown = true; finish(); }, 3000);
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t + 1) - 0.001));
  });
}

/**
 * Fonte de quadros para análise: lê o vídeo em ordem com o decodificador de hardware (WebCodecs, como a exportação)
 * — bem mais rápido e leve que "pular" o <video> a cada quadro. Sem suporte, cai na busca normal.
 */
export async function frameSource(src, { onMode } = {}) {
  const T = (pr, ms, v = 'timeout') => Promise.race([pr, new Promise((r) => setTimeout(() => r(v), ms))]);
  const v = await T(analysisVideo(src), 8000, null);
  if (!v) throw new Error('não consegui abrir o vídeo para analisar');
  // no documento (escondido): alguns navegadores/drivers só decodificam e avisam quadros de vídeos que estão na página
  if (!v.isConnected) { v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1'; document.body.appendChild(v); }
  let blob = null, SR = null;
  try { blob = await T(fetch(src).then((r) => r.blob()), 6000, null); SR = (await import('./seqreader.js')).SeqReader; } catch { SR = null; }
  const fps = 30;
  // modo "player": toca o vídeo e para no quadro certo (requestVideoFrameCallback) — funciona em qualquer PC onde a prévia toca
  const playTo = (st) => new Promise((res) => {
    const done = () => { try { v.pause(); } catch { /* ok */ } clearTimeout(to); res(true); };
    const to = setTimeout(() => res(false), 3000);
    if (!('requestVideoFrameCallback' in v) || st < v.currentTime - 0.5 / fps || st > v.currentTime + 2) {
      seek(v, st).then(done);
      return;
    }
    if (Math.abs(v.currentTime - st) < 0.5 / fps) { done(); return; }
    const step = (_now, meta) => { if (meta.mediaTime >= st - 0.6 / fps) done(); else v.requestVideoFrameCallback(step); };
    v.requestVideoFrameCallback(step);
    v.play().catch(() => seek(v, st).then(done));
  });
  const modes = {
    hw: async () => (SR && blob ? T(SR.open(blob), 5000, null) : null),
    sw: async () => (SR && blob ? T(SR.open(blob, { soft: true }), 5000, null) : null),
  };
  let mode = null, rd = null;
  const api = {
    v, w: v.videoWidth || 1080, h: v.videoHeight || 1920, get mode() { return mode; },
    async draw(ctx, st, w, h) {
      // 1º quadro: testa os leitores na ordem (hardware → software → player) e fica com o que responder
      while (true) {
        if (!mode) {
          for (const m of ['hw', 'sw']) {
            if (rd) { rd.close(); rd = null; }
            rd = await modes[m]().catch(() => null);
            if (rd && rd !== 'timeout') {
              const c = await T(rd.frameAt(st), 3000).catch(() => null);
              if (c && c !== 'timeout') { mode = m; onMode?.(m); ctx.drawImage(c, 0, 0, w, h); return; }
              rd.close?.();
            }
            rd = null;
          }
          mode = 'player'; onMode?.(mode);
        }
        if (mode === 'player') {
          await playTo(st);
          ctx.drawImage(v, 0, 0, w, h);
          return;
        }
        const c = await T(rd.frameAt(st), 2500).catch(() => null);
        if (c && c !== 'timeout') { ctx.drawImage(c, 0, 0, w, h); return; }
        // travou no meio: passa para o próximo método
        rd.close(); rd = null;
        if (mode === 'hw') { rd = await modes.sw().catch(() => null); if (rd && rd !== 'timeout') { mode = 'sw'; onMode?.(mode); continue; } rd = null; }
        mode = 'player'; onMode?.(mode);
      }
    },
    close() { rd?.close?.(); rd = null; try { v.pause(); } catch { /* ok */ } },
  };
  return api;
}
/** Devolve o controle ao navegador (a tela não congela durante a análise). */
export const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export function grayFrame(v, ctx, w, h) {
  if (v) ctx.drawImage(v, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  return g;
}

function patch(g, w, h, cx, cy, r) {
  const n = r * 2 + 1;
  const out = new Float32Array(n * n);
  for (let y = -r, k = 0; y <= r; y++) for (let x = -r; x <= r; x++, k++) {
    const px = Math.min(w - 1, Math.max(0, Math.round(cx + x))), py = Math.min(h - 1, Math.max(0, Math.round(cy + y)));
    out[k] = g[py * w + px];
  }
  return out;
}

function sad(g, w, h, tpl, cx, cy, r, best) {
  let s = 0;
  for (let y = -r, k = 0; y <= r; y++) {
    const py = Math.min(h - 1, Math.max(0, cy + y)) * w;
    for (let x = -r; x <= r; x++, k++) {
      s += Math.abs(g[py + Math.min(w - 1, Math.max(0, cx + x))] - tpl[k]);
      if (s > best) return s; // poda
    }
  }
  return s;
}

/**
 * Rastreia um ponto (em coordenadas da composição) numa camada de vídeo de t0 a t1.
 * Retorna [{ t, x, y }] em coordenadas da composição.
 */
export async function trackPoint(opts) {
  setExporting(true); // pausa o cache de quadros durante a análise
  try { return await trackImpl(opts); } finally { setExporting(false); }
}

async function trackImpl({ layer, project, t0, t1, point, onProgress, isCancelled }) {
  const v = await loadVideo(layer.props.src);
  const vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const aw = Math.min(AW, vw), ah = Math.round((aw * vh) / vw);
  const c = document.createElement('canvas');
  c.width = aw; c.height = ah;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const { w, h } = contentSize(layer, project);
  // composição → conteúdo da camada → pixels de análise
  const lp = toLayerSpace(layer, t0, point[0], point[1]);
  let x = ((lp.x + w / 2) / w) * aw, y = ((lp.y + h / 2) / h) * ah;
  const R = Math.max(7, Math.round(aw / 28)); // meio tamanho do modelo (~13 px)
  const S = Math.max(12, Math.round(aw / 12)); // raio de busca (~30 px por quadro)
  const fps = project.fps;
  const times = [];
  for (let t = t0; t <= t1 + 1e-6; t += 1 / fps) times.push(+t.toFixed(5));
  await seek(v, sourceTime(layer, t0) + 0.3 / project.fps);
  let g = grayFrame(v, ctx, aw, ah);
  let tpl = patch(g, aw, ah, x, y, R);
  const ref = tpl.slice();
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (isCancelled?.()) break;
    const t = times[i];
    if (i > 0) {
      await seek(v, sourceTime(layer, t) + 0.3 / project.fps); // dentro do quadro
      g = grayFrame(v, ctx, aw, ah);
      const cx0 = Math.round(x), cy0 = Math.round(y);
      let best = Infinity, bx = cx0, by = cy0;
      for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) {
        const s = sad(g, aw, ah, tpl, cx0 + dx, cy0 + dy, R, best);
        if (s < best) { best = s; bx = cx0 + dx; by = cy0 + dy; }
      }
      // sub-pixel (parábola)
      const cxm = sad(g, aw, ah, tpl, bx - 1, by, R, Infinity), cxp = sad(g, aw, ah, tpl, bx + 1, by, R, Infinity);
      const cym = sad(g, aw, ah, tpl, bx, by - 1, R, Infinity), cyp = sad(g, aw, ah, tpl, bx, by + 1, R, Infinity);
      const ox = Math.max(-0.5, Math.min(0.5, (cxm - cxp) / (2 * (cxm + cxp - 2 * best) || 1)));
      const oy = Math.max(-0.5, Math.min(0.5, (cym - cyp) / (2 * (cym + cyp - 2 * best) || 1)));
      x = bx + ox; y = by + oy;
      // atualiza o modelo devagar, ancorado no original (evita "escorregar")
      const now = patch(g, aw, ah, x, y, R);
      for (let k = 0; k < tpl.length; k++) tpl[k] = tpl[k] * 0.8 + now[k] * 0.12 + ref[k] * 0.08;
    }
    // pixels de análise → espaço da camada → composição
    const lx = (x / aw) * w - w / 2, ly = (y / ah) * h - h / 2;
    const m = layerTransform(layer, t);
    const r = (m.rot * Math.PI) / 180;
    const sx = (lx - m.anchor[0]) * m.sx, sy = (ly - m.anchor[1]) * m.sy;
    out.push({ t, x: m.x + sx * Math.cos(r) - sy * Math.sin(r), y: m.y + sx * Math.sin(r) + sy * Math.cos(r) });
    onProgress?.((i + 1) / times.length);
  }
  v.removeAttribute('src');
  v.load();
  return out;
}

/** Aplica o rastreio na posição da camada alvo (mantém a distância inicial entre a camada e o ponto). */
export function applyTrack(target, track) {
  if (!track.length) return 0;
  const pos = target.transform.position;
  const base = valueAt(pos, track[0].t);
  const ox = base[0] - track[0].x, oy = base[1] - track[0].y;
  const t0 = track[0].t, t1 = track[track.length - 1].t;
  pos.keys = pos.keys.filter((k) => k.t < t0 - 1e-4 || k.t > t1 + 1e-4);
  for (const p of track) pos.keys.push({ t: p.t, v: [Math.round((p.x + ox) * 10) / 10, Math.round((p.y + oy) * 10) / 10], ease: 'linear' });
  sortKeys(pos);
  return track.length;
}

// ---------------------------------------------------------------- análise passo a passo (painel Tracker estilo AE)
let cachedVid = null;
/** Vídeo de análise reaproveitado entre cliques de Analyze (abrir de novo a cada passo de 1 quadro é lento). */
export async function analysisVideo(src) {
  if (cachedVid && cachedVid.src0 === src) return cachedVid.v;
  releaseAnalysisVideo();
  const v = await loadVideo(src);
  cachedVid = { src0: src, v };
  return v;
}
export function releaseAnalysisVideo() {
  if (!cachedVid) return;
  cachedVid.v.removeAttribute('src'); cachedVid.v.load(); cachedVid.v.remove();
  cachedVid = null;
}

/**
 * Track Point do AE, em qualquer direção: `times` em ordem de análise (para frente ou para trás). start = ponto no
 * espaço do conteúdo da camada (px, centro = 0). Devolve [{ t, lx, ly, conf }] e chama onFrame a cada quadro.
 * featureK = tamanho da região do modelo (1 = padrão), searchK = tamanho da busca.
 */
export async function analyzePoint({ layer, project, times, start, featureK = 1, searchK = 1, onFrame, isCancelled, onMode }) {
  setExporting(true);
  const fs = await frameSource(layer.props.src, { onMode });
  try {
    const vw = fs.w, vh = fs.h;
    const aw = Math.min(AW, vw), ah = Math.round((aw * vh) / vw);
    const c = document.createElement('canvas'); c.width = aw; c.height = ah;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const { w, h } = contentSize(layer, project);
    let x = ((start.lx + w / 2) / w) * aw, y = ((start.ly + h / 2) / h) * ah;
    const R = Math.max(5, Math.round((aw / 28) * featureK)), S = Math.max(8, Math.round((aw / 12) * searchK));
    const fps = project.fps;
    await fs.draw(ctx, sourceTime(layer, times[0]) + 0.3 / fps, aw, ah);
    let g = grayFrame(null, ctx, aw, ah);
    const tpl = patch(g, aw, ah, x, y, R), ref = tpl.slice();
    const out = [];
    let vx = 0, vy = 0; // velocidade: a busca começa onde o ponto deve estar (movimento rápido não perde o ponto)
    const emit = (t, conf) => { const s = { t, lx: (x / aw) * w - w / 2, ly: (y / ah) * h - h / 2, conf }; out.push(s); onFrame?.(s, out.length / times.length, c); };
    emit(times[0], 1);
    for (let i = 1; i < times.length; i++) {
      if (isCancelled?.()) break;
      await fs.draw(ctx, sourceTime(layer, times[i]) + 0.3 / fps, aw, ah);
      g = grayFrame(null, ctx, aw, ah);
      const cx0 = Math.round(x + vx), cy0 = Math.round(y + vy);
      // busca em 2 etapas (grossa de 3 em 3 px, depois fina): ~6× mais rápida que a busca completa
      let best = Infinity, bx = cx0, by = cy0;
      for (let dy = -S; dy <= S; dy += 3) for (let dx = -S; dx <= S; dx += 3) {
        const s2 = sad(g, aw, ah, tpl, cx0 + dx, cy0 + dy, R, best);
        if (s2 < best) { best = s2; bx = cx0 + dx; by = cy0 + dy; }
      }
      const gx = bx, gy = by;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const s2 = sad(g, aw, ah, tpl, gx + dx, gy + dy, R, best);
        if (s2 < best) { best = s2; bx = gx + dx; by = gy + dy; }
      }
      const cxm = sad(g, aw, ah, tpl, bx - 1, by, R, Infinity), cxp = sad(g, aw, ah, tpl, bx + 1, by, R, Infinity);
      const cym = sad(g, aw, ah, tpl, bx, by - 1, R, Infinity), cyp = sad(g, aw, ah, tpl, bx, by + 1, R, Infinity);
      const nx = bx + Math.max(-0.5, Math.min(0.5, (cxm - cxp) / (2 * (cxm + cxp - 2 * best) || 1)));
      const ny = by + Math.max(-0.5, Math.min(0.5, (cym - cyp) / (2 * (cym + cyp - 2 * best) || 1)));
      vx = (nx - x) * 0.7; vy = (ny - y) * 0.7; x = nx; y = ny;
      const now = patch(g, aw, ah, x, y, R);
      for (let k = 0; k < tpl.length; k++) tpl[k] = tpl[k] * 0.8 + now[k] * 0.12 + ref[k] * 0.08;
      // confiança como no AE: 100% = idêntico ao modelo
      emit(times[i], Math.max(0, 1 - best / (tpl.length * 60)));
      await yieldUI();
    }
    return out;
  } finally { fs.close(); setExporting(false); }
}

/** Ponto do conteúdo da camada (px, centro = 0) → composição, no tempo t. */
export function localToComp(layer, t, lx, ly) {
  const m = layerTransform(layer, t), r = (m.rot * Math.PI) / 180;
  const sx = (lx - m.anchor[0]) * m.sx, sy = (ly - m.anchor[1]) * m.sy;
  return [m.x + sx * Math.cos(r) - sy * Math.sin(r), m.y + sx * Math.sin(r) + sy * Math.cos(r)];
}
/** Composição → conteúdo da camada (px, centro = 0). */
export function compToLocal(layer, t, x, y) {
  const p = toLayerSpace(layer, t, x, y);
  return { lx: p.x, ly: p.y };
}

/** Aplica um rastro de ponto (no espaço da camada de origem) à posição do alvo. dims: 'xy' | 'x' | 'y'. */
export function applyPointTrack(source, target, samples, dims = 'xy') {
  const s = samples.slice().sort((a, b) => a.t - b.t);
  if (!s.length) return 0;
  const pts = s.map((p) => { const [x, y] = localToComp(source, p.t, p.lx, p.ly); return { t: p.t, x, y }; });
  const pos = target.transform.position;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const base = valueAt(pos, t0);
  const ox = base[0] - pts[0].x, oy = base[1] - pts[0].y;
  pos.keys = (pos.keys || []).filter((k) => k.t < t0 - 1e-4 || k.t > t1 + 1e-4);
  for (const p of pts) {
    const cur = valueAt(pos, p.t);
    pos.keys.push({ t: p.t, v: [dims === 'y' ? cur[0] : Math.round((p.x + ox) * 10) / 10, dims === 'x' ? cur[1] : Math.round((p.y + oy) * 10) / 10], ease: 'linear' });
  }
  sortKeys(pos);
  return pts.length;
}
