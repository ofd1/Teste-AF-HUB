// Gerenciador de mídia: imagens, vídeos (com dois decodificadores para frame blending) e sincronização.
import { blendFrames, sourceRate } from './timing.js';

const images = new Map();
const videos = new Map(); // layerId -> { src, a: HTMLVideoElement, b: HTMLVideoElement|null, frame }
let onChange = () => {};
export function setMediaListener(fn) { onChange = fn; }

export function getImage(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => onChange();
    img.src = src;
    images.set(src, img);
  }
  return img;
}

function makeVideo(src) {
  const v = document.createElement('video');
  v.src = src;
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.addEventListener('loadeddata', () => onChange());
  v.addEventListener('seeked', () => onChange());
  return v;
}

export function getVideo(layer, needB = false) {
  const src = layer.props.src;
  let e = videos.get(layer.id);
  if (e && e.src !== src) { e.a.pause(); e.b?.pause(); e = null; }
  if (!e) { e = { src, a: makeVideo(src), b: null }; videos.set(layer.id, e); }
  if (needB && !e.b) e.b = makeVideo(src);
  return e;
}

function seek(v, time) {
  if (!v || v.readyState < 1) return waitMeta(v).then(() => seek(v, time));
  const target = Math.max(0, Math.min(time, (v.duration || time + 1) - 0.001));
  if (Math.abs(v.currentTime - target) < 0.001 && !v.seeking) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 3000);
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}

function waitMeta(v) {
  if (!v || v.readyState >= 1) return Promise.resolve();
  return new Promise((res) => {
    v.addEventListener('loadedmetadata', res, { once: true });
    setTimeout(res, 4000);
  });
}

function activeVideos(project, t) {
  return project.layers.filter((l) => l.type === 'video' && l.visible && t >= l.inPoint && t < l.outPoint && l.props.src);
}

/**
 * Prepara os vídeos para o tempo t.
 * exact=true (exportação): busca o quadro exato e aguarda (await).
 * exact=false (prévia): reprodução nativa com playbackRate quando tocando; busca quando pausado.
 */
export function prepare(project, t, { exact = false, playing = false } = {}) {
  const jobs = [];
  const active = new Set(activeVideos(project, t).map((l) => l.id));
  for (const [id, e] of videos) {
    if (!active.has(id)) {
      if (!e.a.paused) e.a.pause();
      if (e.b && !e.b.paused) e.b.pause();
    }
  }
  for (const l of activeVideos(project, t)) {
    const fr = blendFrames(l, t, project.fps);
    const e = getVideo(l, fr.b !== null);
    e.frame = fr;
    if (exact || !playing) {
      if (!e.a.paused) e.a.pause();
      jobs.push(seek(e.a, fr.a));
      if (fr.b !== null) jobs.push(seek(e.b, fr.b));
    } else {
      const rate = sourceRate(l, t);
      const v = e.a;
      if (rate < 0.07 || rate > 16) {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - fr.a) > 0.04) seek(v, fr.a);
      } else {
        if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
        if (Math.abs(v.currentTime - fr.a) > 0.25 * Math.max(1, rate)) v.currentTime = fr.a;
        if (v.paused) v.play().catch(() => {});
      }
      e.frame = { a: fr.a, b: null, f: 0 };
    }
  }
  return Promise.all(jobs);
}

export function pauseAll() {
  for (const e of videos.values()) { e.a.pause(); e.b?.pause(); }
}

/** Desenha o quadro de vídeo (com frame blending se disponível). */
export function drawVideo(ctx, layer, w, h) {
  const e = getVideo(layer);
  const fr = e.frame || { b: null, f: 0 };
  if (e.a.readyState < 2) return false;
  ctx.drawImage(e.a, 0, 0, w, h);
  if (fr.b !== null && e.b && e.b.readyState >= 2) {
    ctx.globalAlpha = fr.f;
    ctx.drawImage(e.b, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  return true;
}

export function videoDuration(layer) {
  return videos.get(layer.id)?.a.duration || 0;
}

/** Miniatura do vídeo (para a timeline). */
export async function videoThumb(src, time = 0.1, h = 60) {
  const v = makeVideo(src);
  await waitMeta(v);
  await seek(v, Math.min(time, (v.duration || 1) / 2));
  const c = document.createElement('canvas');
  c.height = h;
  c.width = Math.max(1, Math.round((v.videoWidth / v.videoHeight || 1.7) * h));
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  v.removeAttribute('src');
  v.load();
  return c.toDataURL('image/jpeg', 0.6);
}
