// Tracker de ponto (como o Track Point do After Effects): segue um pedaço da imagem quadro a quadro
// por casamento de blocos (SAD) com refinamento sub-pixel e atualização lenta do modelo.
import { sourceTime } from './timing.js';
import { contentSize, layerTransform, toLayerSpace } from './renderer.js';
import { valueAt, sortKeys } from './anim.js';

const AW = 360; // largura de análise (px)

function loadVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => res(v);
    v.onerror = () => rej(new Error('não foi possível abrir o vídeo'));
    v.src = src;
  });
}

function seek(v, t) {
  return new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 3000);
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t + 1) - 0.001));
  });
}

function grayFrame(v, ctx, w, h) {
  ctx.drawImage(v, 0, 0, w, h);
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
export async function trackPoint({ layer, project, t0, t1, point, onProgress, isCancelled }) {
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
  await seek(v, sourceTime(layer, t0));
  let g = grayFrame(v, ctx, aw, ah);
  let tpl = patch(g, aw, ah, x, y, R);
  const ref = tpl.slice();
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (isCancelled?.()) break;
    const t = times[i];
    if (i > 0) {
      await seek(v, sourceTime(layer, t));
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
