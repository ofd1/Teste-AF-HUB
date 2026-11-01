// Gerenciador de mídia: imagens, vídeos (com dois decodificadores para frame blending) e sincronização.
import { blendFrames, sourceRate, sourceTime, speedEffect, wantsInterp, vectorBlur } from './timing.js';
import { valueAt } from './anim.js';

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

// iPhone (Safari) só decodifica vídeos que estão na página e que já foram "liberados" por um toque.
let host = null;
function videoHost() {
  if (!host && typeof document !== 'undefined') {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(host);
  }
  return host;
}
const allVideos = new Set();
function unlockVideos() {
  for (const v of allVideos) {
    if (v.dataset.unlocked || !v.paused) continue;
    v.dataset.unlocked = '1';
    const t = v.currentTime;
    const p = v.play();
    if (p) p.then(() => { v.pause(); v.currentTime = t; }).catch(() => { delete v.dataset.unlocked; });
  }
}
if (typeof document !== 'undefined') {
  for (const ev of ['touchend', 'pointerup', 'click']) document.addEventListener(ev, unlockVideos, { capture: true, passive: true });
}

// durante a exportação o cache de quadros pausa (o iPhone tem poucos decodificadores de vídeo)
let exportBusy = false;
export function setExporting(b) { exportBusy = b; }

function makeVideo(src) {
  const v = document.createElement('video');
  allVideos.add(v);
  videoHost()?.appendChild(v);
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
    const done = () => {
      v.removeEventListener('seeked', done); clearTimeout(to);
      // Safari às vezes termina a busca sem quadro decodificado: espera o quadro (evita tela preta)
      if (v.readyState >= 2) { res(); return; }
      const ok = () => { clearTimeout(t2); v.removeEventListener('canplay', ok); v.removeEventListener('loadeddata', ok); res(); };
      const t2 = setTimeout(ok, 1500);
      v.addEventListener('canplay', ok); v.addEventListener('loadeddata', ok);
    };
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
    // com cache pronto (Twixtor), a prévia lê quadros decodificados: sem busca, suave, inclusive em reverse
    if (!exact && cacheReady(l)) {
      const e = videos.get(l.id);
      if (e && !e.a.paused) e.a.pause();
      continue;
    }
    const fr = blendFrames(l, t, project.fps);
    const e = getVideo(l, fr.b !== null);
    e.frame = fr;
    if (exact) {
      // exportação: um único decodificador por vídeo (o iPhone falha com vários); o quadro B vira uma cópia
      if (!e.a.paused) e.a.pause();
      jobs.push((async () => {
        if (fr.b !== null) {
          await seek(e.a, fr.b);
          e.snapB = snapshot(e.a, e.snapB);
        }
        await seek(e.a, fr.a);
        if (e.a.readyState >= 2) e.last = snapshot(e.a, e.last);
      })());
    } else if (!playing) {
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

function snapshot(v, c) {
  const w = v.videoWidth || 2, h = v.videoHeight || 2;
  if (!c) c = document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  return c;
}

export function pauseAll() {
  for (const e of videos.values()) { e.a.pause(); e.b?.pause(); }
}

/**
 * Quadros do vídeo para o tempo t: { a, b, f, quality }.
 * b != null → o renderizador interpola A→B na fração f por fluxo óptico (estilo Twixtor).
 */
export function videoFrames(layer, t, fps, final = false) {
  const c = caches.get(layer.id);
  if (!final && c?.ready && c.key === cacheKey(layer)) {
    const x = Math.max(0, Math.min(c.frames.length - 1, (sourceTime(layer, t) - c.t0) * c.fps));
    const i = Math.floor(x), f = x - i;
    const blend = wantsInterp(layer, t);
    if (vectorBlur(layer, t) > 0 && i + 1 < c.frames.length) return { a: c.frames[i], b: c.frames[i + 1], f: blend ? f : 0, quality: 'preview' };
    if (!blend || f < 0.02 || i + 1 >= c.frames.length) return { a: c.frames[Math.round(x)], b: null, f: 0 };
    if (f > 0.98) return { a: c.frames[i + 1], b: null, f: 0 };
    return { a: c.frames[i], b: c.frames[i + 1], f, quality: 'preview' };
  }
  const e = getVideo(layer);
  const fr = e.frame || { b: null, f: 0 };
  if (final) {
    // exportação: quadro A do elemento (ou a última cópia boa / cache, nunca preto) e B da cópia
    const a = e.a.readyState >= 2 ? e.a : e.last || (c?.ready ? c.frames[Math.max(0, Math.min(c.frames.length - 1, Math.round((sourceTime(layer, t) - c.t0) * c.fps)))] : null);
    if (!a) return null;
    return { a, b: fr.b !== null && e.snapB ? e.snapB : null, f: fr.f, quality: 'final' };
  }
  if (e.a.readyState < 2) return e.last ? { a: e.last, b: null, f: 0, quality: 'final' } : null;
  return { a: e.a, b: fr.b !== null && e.b && e.b.readyState >= 2 ? e.b : null, f: fr.f, quality: 'final' };
}

/** Compatibilidade: desenha o quadro A (sem interpolação). */
export function drawVideo(ctx, layer, w, h) {
  const e = getVideo(layer);
  if (e.a.readyState < 2) return false;
  ctx.drawImage(e.a, 0, 0, w, h);
  return true;
}

// ------------------------------------------------------------------ cache de quadros (Twixtor)
const caches = new Map(); // layerId -> { key, fps, t0, frames, ready, progress }
let cacheListener = () => {};
export function setCacheListener(fn) { cacheListener = fn; }

function cacheKey(layer) {
  const fx = speedEffect(layer);
  return JSON.stringify([layer.props.src, layer.props.sourceStart || 0, layer.props.speed ?? 1, layer.inPoint, layer.outPoint, fx?.params.speed, fx?.enabled, !!layer.props.interpolate, layer.props.sourceFps]);
}

export function cacheReady(layer) {
  const c = caches.get(layer.id);
  return !!(c?.ready && c.key === cacheKey(layer));
}

export function cacheStatus() {
  const building = [...caches.values()].filter((c) => !c.ready && !c.cancelled);
  if (!building.length) return null;
  return Math.round((building.reduce((n, c) => n + c.progress, 0) / building.length) * 100);
}

/** Garante cache para camadas de vídeo com Velocidade (Twixtor). Chamar após mudanças (debounced). */
export function ensureCaches(project) {
  const ids = new Set();
  for (const l of project.layers) {
    if (l.type !== 'video' || !l.props.src || !(speedEffect(l) || l.props.interpolate || l.effects.some((fx) => fx.enabled && (fx.type === 'timeSlice' || fx.type === 'echo')))) continue;
    ids.add(l.id);
    const c = caches.get(l.id);
    if (c && c.key === cacheKey(l)) continue;
    if (c) c.cancelled = true;
    buildCache(project, l);
  }
  for (const [id, c] of caches) if (!ids.has(id)) { c.cancelled = true; caches.delete(id); }
}

async function buildCache(project, layer) {
  const key = cacheKey(layer);
  const fps = layer.props.sourceFps || project.fps; // quadros no fps real do vídeo
  let lo = Infinity, hi = -Infinity;
  for (let t = layer.inPoint; t <= layer.outPoint + 1e-6; t += 1 / project.fps) {
    const s = sourceTime(layer, t);
    lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  const entry = { key, fps, t0: 0, frames: [], ready: false, progress: 0, cancelled: false };
  caches.set(layer.id, entry);
  cacheListener();
  const v = makeVideo(layer.props.src);
  await waitMeta(v);
  const dur = v.duration || hi + 1;
  lo = Math.max(0, lo - 2 / fps);
  hi = Math.min(dur - 0.001, hi + 2 / fps);
  let n = Math.max(2, Math.ceil((hi - lo) * fps) + 1);
  if (n > 600) { entry.fps = (600 - 1) / (hi - lo); n = 600; }
  entry.t0 = lo;
  // resolução limitada por memória (~160 MB), suficiente para a prévia
  const vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const aspect = vh / vw;
  const w = Math.max(160, Math.min(vw, 720, Math.floor(Math.sqrt(160e6 / (n * 4 * aspect)))));
  const h = Math.round(w * aspect);
  for (let i = 0; i < n; i++) {
    while (exportBusy && !entry.cancelled) await new Promise((r) => setTimeout(r, 250));
    if (entry.cancelled) return;
    await seek(v, lo + (i + 0.01) / entry.fps);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    entry.frames.push(c);
    entry.progress = (i + 1) / n;
    if (i % 6 === 0) cacheListener();
  }
  v.removeAttribute('src');
  v.load();
  if (entry.cancelled) return;
  entry.ready = true;
  cacheListener();
  onChange();
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

/** Detecta o fps real do vídeo (requestVideoFrameCallback). Retorna null se não for possível. */
export function detectFps(src) {
  return new Promise((resolve) => {
    const v = makeVideo(src);
    if (!('requestVideoFrameCallback' in v)) { resolve(null); return; }
    const times = [];
    const done = () => {
      v.pause(); v.removeAttribute('src'); v.load();
      const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0.001).sort((a, b) => a - b);
      if (d.length < 3) { resolve(null); return; }
      const raw = 1 / d[Math.floor(d.length / 2)];
      const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
      resolve(common.reduce((best, c) => (Math.abs(c - raw) < Math.abs(best - raw) ? c : best), common[0]));
    };
    const onFrame = (now, meta) => { times.push(meta.mediaTime); if (times.length < 12) v.requestVideoFrameCallback(onFrame); else done(); };
    v.requestVideoFrameCallback(onFrame);
    v.play().catch(() => resolve(null));
    setTimeout(() => { if (times.length < 12) done(); }, 2500);
  });
}
