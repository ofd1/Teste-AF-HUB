// Gerenciador de mídia: imagens, vídeos (com dois decodificadores para frame blending) e sincronização.
import { blendFrames, sourceRate, sourceTime, speedEffect, wantsInterp, vectorBlur, remapEffect, speedProp, dedupeOf, timedLayers } from './timing.js';
import { valueAt } from './anim.js';
import { flatLayers } from './state.js';

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
const allVideos = new Set(); // só os vídeos de reprodução (prévia); cache/miniaturas nunca são "tocados"
function unlockVideos() {
  for (const v of allVideos) {
    if (v.dataset.unlocked || !v.paused || v.seeking) continue;
    v.dataset.unlocked = '1';
    const t = v.currentTime, gen = v._seekGen || 0;
    const p = v.play();
    // só devolve a posição se ninguém buscou outro quadro enquanto isso (antes isso estragava buscas em andamento)
    if (p) p.then(() => { v.pause(); if ((v._seekGen || 0) === gen) v.currentTime = t; }).catch(() => { delete v.dataset.unlocked; });
  }
}
if (typeof document !== 'undefined') {
  for (const ev of ['touchend', 'click']) document.addEventListener(ev, unlockVideos, { capture: true, passive: true });
}
function releaseVideo(v) {
  allVideos.delete(v);
  v.removeAttribute('src');
  v.load();
  v.remove();
}

// Arquivo original por trás de cada blob: URL. O leitor sequencial precisa do Blob; antes ele fazia fetch(src).blob(),
// que cria uma CÓPIA do arquivo inteiro na memória a cada cache/exportação (vídeo de 500 MB = +500 MB toda vez que o
// cache andava com o cursor) — no .exe isso enchia a memória e o editor caía ao "procurar quadros"/renderizar.
// O navegador já mantém o Blob vivo enquanto a URL existe, então guardar a referência não gasta nada a mais.
const blobOf = new Map();
if (typeof URL !== 'undefined' && URL.createObjectURL && !URL.__mfPatched) {
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o) => { const u = create(o); if (o instanceof Blob) blobOf.set(u, o); return u; };
  URL.revokeObjectURL = (u) => { blobOf.delete(u); revoke(u); };
  URL.__mfPatched = true;
}
const fetched = new Map(); // src → Promise<Blob> (URLs que não vieram de createObjectURL: baixa uma vez só)
export function srcBlob(src) {
  const b = blobOf.get(src);
  if (b) return Promise.resolve(b);
  if (!fetched.has(src)) {
    const pr = fetch(src).then((r) => r.blob());
    pr.catch(() => fetched.delete(src));
    fetched.set(src, pr);
    while (fetched.size > 4) fetched.delete(fetched.keys().next().value);
  }
  return fetched.get(src);
}

// durante a exportação o cache de quadros pausa (o iPhone tem poucos decodificadores de vídeo)
let exportBusy = false;
// leitores sequenciais da exportação, um por arquivo (fechados quando a exportação termina)
const readers = new Map();
function readerFor(src) {
  if (!src || typeof VideoDecoder === 'undefined') return Promise.resolve(null);
  if (!readers.has(src)) readers.set(src, (async () => { try { const blob = await srcBlob(src); const { SeqReader } = await import('./seqreader.js'); const r = await SeqReader.open(blob); if (r) r.onEvict = freeReaderFrame; return r; } catch { return null; } })());
  return readers.get(src);
}
// Quadro decodificado que saiu da lista do leitor (exportação). Cada quadro é uma tela do tamanho do vídeo; antes elas
// ficavam esperando o coletor de lixo — no .exe (heap grande, coletor preguiçoso) centenas de telas de 8–33 MB se
// acumulavam e a memória de vídeo estourava no meio da renderização. Agora é liberada assim que ninguém usa.
const zero = (c) => { c.width = 0; c.height = 0; };
function inUse(c) { for (const e of videos.values()) { if (e.last === c) return true; if (e.snaps) for (const x of e.snaps.values()) if (x === c) return true; } return false; }
function freeReaderFrame(c) { if (inUse(c)) c._dead = true; else zero(c); }
function dropSnap(e, old) { if ((!old._rd || old._dead) && old !== e.last) zero(old); }

export function setExporting(b) {
  exportBusy = b;
  if (!b) {
    for (const r of readers.values()) r.then((x) => x?.close()).catch(() => {});
    readers.clear();
    for (const e of videos.values()) { if (e.snaps) for (const [k, c] of [...e.snaps]) if (c._rd) { e.snaps.delete(k); zero(c); } if (e.last?._rd) { zero(e.last); e.last = null; } }
  }
  // exportação começando: cancela caches ainda sendo montados (cada um prende um decodificador de vídeo; no iPhone
  // isso podia travar a busca de quadros da exportação). Eles são refeitos depois.
  if (b) for (const m of [caches, pendingCaches]) for (const [id, c] of m) if (!c.ready) { c.cancelled = true; m.delete(id); }
}

function makeVideo(src, playback = false) {
  const v = document.createElement('video');
  if (playback) allVideos.add(v);
  videoHost()?.appendChild(v);
  v.src = src;
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.addEventListener('loadeddata', () => onChange());
  v.addEventListener('seeked', () => {
    // scrub: guarda o quadro que acabou de chegar (cópia leve) para mostrar enquanto a próxima busca roda —
    // o clipe acompanha o playhead em vez de congelar/piscar preto
    if (v.readyState >= 2 && v.videoWidth) {
      const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.max(2, Math.round(v.videoWidth * k)), h = Math.max(2, Math.round(v.videoHeight * k));
      const c = v._scrub || (v._scrub = document.createElement('canvas'));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      try { c.getContext('2d').drawImage(v, 0, 0, w, h); v._scrubT = v.currentTime; } catch { /* ignore */ }
    }
    // busca "a mais recente vence": enquanto o vídeo buscava, o playhead andou — vai direto para o último pedido
    if (v._pending != null) { const t = v._pending; v._pending = null; if (Math.abs(v.currentTime - t) > 0.001) { v.currentTime = t; return; } }
    onChange();
  });
  return v;
}

function dropVideoEntry(e) {
  for (const v of [e.a, e.b]) if (v) { try { v.pause(); releaseVideo(v); } catch { /* já liberado */ } if (v._scrub) { v._scrub.width = 0; v._scrub.height = 0; } }
  if (e.snaps) { for (const c of e.snaps.values()) if (!c._rd) { c.width = 0; c.height = 0; } e.snaps.clear(); }
  if (e.last && !e.last._rd) { e.last.width = 0; e.last.height = 0; }
  e.last = null;
}
/** Libera vídeos de camadas que não existem mais no projeto (apagadas, divididas, trocadas, outro projeto aberto).
 *  Antes ficavam para sempre: em sessões longas a memória de vídeo enchia e o editor caía depois de alguns minutos. */
export function pruneMedia(project) {
  const ids = new Set();
  const walk = (ls) => { for (const l of ls || []) { ids.add(l.id); if (l.props?.layers) walk(l.props.layers); } };
  walk(project?.layers);
  for (const [id, e] of videos) if (!ids.has(id)) { dropVideoEntry(e); videos.delete(id); }
}

export function getVideo(layer, needB = false) {
  const src = layer.props.src;
  let e = videos.get(layer.id);
  // mídia trocada: libera os <video> antigos (antes só pausava — cada um continuava prendendo um decodificador e memória)
  if (e && e.src !== src) { dropVideoEntry(e); videos.delete(layer.id); e = null; }
  if (!e) { e = { src, a: makeVideo(src, true), b: null, snaps: new Map() }; videos.set(layer.id, e); }
  if (needB && !e.b) e.b = makeVideo(src, true);
  return e;
}

function seek(v, time, tries = 0) {
  // sem metadados: espera no máximo 2 vezes (antes repetia para sempre se o aparelho descartasse o vídeo → exportação parada)
  if (!v || v.readyState < 1) return tries >= 2 || !v ? Promise.resolve() : waitMeta(v).then(() => seek(v, time, tries + 1));
  const target = Math.max(0, Math.min(time, (v.duration || time + 1) - 0.001));
  if (Math.abs(v.currentTime - target) < 0.001 && !v.seeking) return Promise.resolve();
  v._seekGen = (v._seekGen || 0) + 1;
  // já buscando (scrub rápido): não empilha buscas — guarda só o destino mais recente
  if (v.seeking && !exportBusy) {
    v._pending = target;
    return new Promise((res) => { const f = () => { if (v._pending == null && !v.seeking) { v.removeEventListener('seeked', f); res(); } }; v.addEventListener('seeked', f); setTimeout(() => { v.removeEventListener('seeked', f); res(); }, 3000); });
  }
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

/** Busca e espera o quadro ser realmente apresentado (o Safari às vezes entrega o quadro anterior logo após 'seeked'). */
/** Guarda o tempo (mediaTime) do último quadro que o vídeo realmente mostrou. */
function trackFrames(v) {
  if (v._trk || !('requestVideoFrameCallback' in v)) return;
  v._trk = true;
  const cb = (now, m) => { v._mt = m.mediaTime; v.requestVideoFrameCallback(cb); };
  v.requestVideoFrameCallback(cb);
}

/**
 * Busca exata (exportação): confere que o quadro mostrado é o pedido (tempo do quadro exibido) e tenta de novo se não
 * for — celulares às vezes terminam a busca ainda com o quadro anterior na tela, o que fazia o clipe "voltar" no vídeo exportado.
 */
async function seekExact(v, time, fps = 30) {
  if (!('requestVideoFrameCallback' in v)) { await seek(v, time); return true; }
  trackFrames(v);
  const tol = 0.75 / fps;
  for (let k = 0; k < 4; k++) {
    const shown = new Promise((r) => v.requestVideoFrameCallback(() => r()));
    if (k === 0) await seek(v, time);
    else { await seek(v, time + (k % 2 ? 0.002 : -0.002)); await seek(v, time); }
    await Promise.race([shown, new Promise((r) => setTimeout(r, 120 + k * 300))]);
    if (v._mt != null && Math.abs(v._mt - time) <= tol) return true;
  }
  return false;
}

function waitMeta(v) {
  if (!v || v.readyState >= 1) return Promise.resolve();
  return new Promise((res) => {
    v.addEventListener('loadedmetadata', res, { once: true });
    setTimeout(res, 4000);
  });
}

/** Vídeos ativos no tempo t, cada um com o seu tempo local (dentro de pré-comps o tempo é o da pré-comp). */
function activeVideos(project, t) {
  return timedLayers(project.layers, t).filter(({ l, t: lt }) => l.type === 'video' && l.visible && lt >= l.inPoint && lt < l.outPoint && l.props.src);
}

/**
 * Prepara os vídeos para o tempo t.
 * exact=true (exportação): busca o quadro exato e aguarda (await).
 * exact=false (prévia): reprodução nativa com playbackRate quando tocando; busca quando pausado.
 */
export function prepare(project, t, { exact = false, playing = false } = {}) {
  const jobs = [];
  const active = new Set(activeVideos(project, t).map(({ l }) => l.id));
  for (const [id, e] of videos) {
    if (!active.has(id)) {
      if (!e.a.paused) e.a.pause();
      if (e.b && !e.b.paused) e.b.pause();
    }
  }
  const t0 = t;
  for (const { l, t: lt, k } of activeVideos(project, t0)) {
    const t = lt; // tempo local da camada (pré-comps)
    // com cache pronto (Twixtor), a prévia lê quadros decodificados: sem busca, suave, inclusive em reverse
    if (!exact && cacheReady(l)) {
      const e = videos.get(l.id);
      if (e && !e.a.paused) e.a.pause();
      continue;
    }
    let fr = blendFrames(l, t, project.fps);
    if (dedupeOf(l)) { const d = dedupeTimes(l, sourceTime(l, t)); if (d) fr = d; }
    const e = getVideo(l, fr.b !== null);
    e.frame = fr;
    if (exact) {
      // exportação: um único decodificador por vídeo (o iPhone falha com vários). Cada quadro de origem é
      // decodificado uma vez, confirmado (requestVideoFrameCallback) e guardado: A e B ficam sempre corretos
      // e a câmera lenta reaproveita os quadros, sem "travadas".
      if (!e.a.paused) e.a.pause();
      if (!e.snaps) e.snaps = new Map();
      jobs.push((async () => {
        // leitor sequencial (WebCodecs): bem mais rápido que buscar o <video> quadro a quadro; se não der, busca normal
        const rd = await readerFor(l.props.src);
        for (const st of [fr.a, fr.b]) {
          if (st === null) continue;
          const key = Math.round(st * 1000);
          if (e.snaps.has(key)) continue;
          if (rd) {
            const c = await rd.frameAt(st).catch(() => null);
            if (c) {
              if (e.snaps.size >= 4) { const [k0, old] = e.snaps.entries().next().value; e.snaps.delete(k0); dropSnap(e, old); }
              c._rd = true; e.snaps.set(key, c); continue;
            }
          }
          await seekExact(e.a, st, l.props.sourceFps || project.fps || 30);
          if (e.a.readyState < 2) continue;
          let c = null;
          if (e.snaps.size >= 4) { const [k0, old] = e.snaps.entries().next().value; e.snaps.delete(k0); if (old._rd) dropSnap(e, old); else c = old; }
          e.snaps.set(key, snapshot(e.a, c));
        }
        const ka = e.snaps.get(Math.round(fr.a * 1000));
        if (ka && ka !== e.last) {
          const prev = e.last; e.last = ka;
          if (prev?._dead && ![...e.snaps.values()].includes(prev)) zero(prev);
        }
      })());
    } else if (!playing) {
      if (!e.a.paused) e.a.pause();
      jobs.push(seek(e.a, fr.a));
      if (fr.b !== null) jobs.push(seek(e.b, fr.b));
    } else {
      const rate = sourceRate(l, t) * k; // pré-comp com velocidade multiplica
      const v = e.a;
      if (rate < 0.07 || rate > 16) {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - fr.a) > 0.04) seek(v, fr.a);
      } else {
        // sincronia suave (como um player): pequena diferença → ajusta a velocidade do vídeo uns % até alcançar o
        // relógio; só pula (busca) se estiver muito longe. Antes qualquer atraso > 0,25 s virava um salto — o clipe
        // "voltava quadros" e travava quando um efeito pesado atrasava o decodificador.
        const drift = v.currentTime - fr.a; // > 0: vídeo adiantado
        if (v.paused || Math.abs(drift) > 1.0 * Math.max(1, rate)) {
          if (Math.abs(drift) > 0.08) v.currentTime = fr.a;
          v.playbackRate = rate;
        } else {
          const corr = Math.abs(drift) < 0.03 ? 0 : Math.max(-0.15, Math.min(0.15, drift * 0.9));
          const want = Math.max(0.0625, rate * (1 - corr));
          if (Math.abs(v.playbackRate - want) > 0.005) v.playbackRate = want;
        }
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

/** Há vídeo tocando "ao vivo" (sem cache de quadros) no tempo t? Durante o play a prévia não mistura quadros do
 *  cache com o vídeo ao vivo (o ao vivo fica alguns ms atrás e a mistura parecia o clipe voltando quadros). */
export function liveVideoAt(project, t) {
  return activeVideos(project, t).some(({ l }) => !cacheReady(l));
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
    if (dedupeOf(layer)) {
      const d = dedupeIndex(c, x);
      if (d) return d.ib === null || d.f < 0.02 ? { a: c.frames[d.ia], b: null, f: 0 } : { a: c.frames[d.ia], b: c.frames[d.ib], f: d.f, quality: 'preview' };
    }
    if (vectorBlur(layer, t) > 0 && i + 1 < c.frames.length) return { a: c.frames[i], b: c.frames[i + 1], f: blend ? f : 0, quality: 'preview' };
    if (!blend || f < 0.02 || i + 1 >= c.frames.length) return { a: c.frames[Math.round(x)], b: null, f: 0 };
    if (f > 0.98) return { a: c.frames[i + 1], b: null, f: 0 };
    return { a: c.frames[i], b: c.frames[i + 1], f, quality: 'preview' };
  }
  const e = getVideo(layer);
  const fr = e.frame || { b: null, f: 0 };
  if (final) {
    // exportação: quadro A do elemento (ou a última cópia boa / cache, nunca preto) e B da cópia
    const sa = e.snaps?.get(Math.round(fr.a * 1000)), sb = fr.b !== null ? e.snaps?.get(Math.round(fr.b * 1000)) : null;
    const a = sa || (e.a.readyState >= 2 ? e.a : null) || e.last || (c?.ready ? c.frames[Math.max(0, Math.min(c.frames.length - 1, Math.round((sourceTime(layer, t) - c.t0) * c.fps)))] : null);
    if (!a) return null;
    return { a, b: sb || null, f: sb ? fr.f : 0, quality: 'final' };
  }
  if (e.a.readyState < 2 || e.a.seeking) {
    const held = e.a._scrub && e.a._scrubT != null ? e.a._scrub : e.last;
    if (held) return { a: held, b: null, f: 0, quality: 'preview' };
    if (e.a.readyState < 2) return null;
  }
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
  const rm = remapEffect(layer);
  return JSON.stringify([dedupeOf(layer)?.sens ?? null, JSON.stringify(rm?.params.time), layer.props.src, layer.props.sourceStart || 0, layer.props.speed ?? 1, layer.inPoint, layer.outPoint, fx ? speedProp(fx) : null, fx?.enabled, !!layer.props.interpolate, layer.props.sourceFps]);
}

const sigCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function frameSignature(c) {
  sigCanvas.width = 24; sigCanvas.height = 24;
  const x = sigCanvas.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data, out = new Uint8Array(576);
  for (let i = 0; i < 576; i++) out[i] = (d[i * 4] + d[i * 4 + 1] * 2 + d[i * 4 + 2]) >> 2;
  return out;
}
function sigDiff(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }

/**
 * "Replace Duplicate Frames" (como no Topaz): com props.dedupe, quadros repetidos são ignorados e o tempo é
 * remapeado entre os quadros únicos vizinhos (a interpolação preenche o buraco). Retorna { ia, ib, f } (índices).
 */
function dedupeIndex(c, x) {
  if (!c.dup?.length) return null;
  const i = Math.floor(x);
  let u0 = Math.min(i, c.frames.length - 1);
  while (u0 > 0 && c.dup[u0]) u0--;
  let u1 = i + 1;
  while (u1 < c.frames.length && c.dup[u1]) u1++;
  if (u1 >= c.frames.length) return { ia: u0, ib: null, f: 0 };
  return { ia: u0, ib: u1, f: Math.max(0, Math.min(1, (x - u0) / (u1 - u0))) };
}

/** Tempos de origem (s) já sem quadros duplicados, para a exportação. null se não se aplica. */
export function dedupeTimes(layer, st) {
  const c = caches.get(layer.id);
  if (!dedupeOf(layer) || !c?.ready || c.key !== cacheKey(layer)) return null;
  const d = dedupeIndex(c, Math.max(0, (st - c.t0) * c.fps));
  if (!d) return null;
  const tt = (k) => c.t0 + (k + 0.5) / c.fps; // meio do quadro (como o cache foi decodificado)
  return { a: tt(d.ia), b: d.ib === null ? null : tt(d.ib), f: d.ib === null ? 0 : d.f };
}

// iPhone/iPad: o Safari tem um teto de memória para TODOS os canvases somados (~384 MB). Passou disso, os canvases
// novos saem PRETOS (prévia e exportação). Por isso o cache é menor no iOS e os quadros antigos são liberados na hora.
const IOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
const CACHE_BUDGET = IOS ? 70e6 : 160e6;
function freeCache(c) {
  for (const f of c.frames || []) { f.width = 0; f.height = 0; } // devolve a memória imediatamente (sem esperar o coletor)
  c.frames = [];
}

export function cacheReady(layer) {
  const c = caches.get(layer.id);
  return !!(c?.ready && c.key === cacheKey(layer));
}

export function cacheStatus() {
  const building = [...caches.values()].filter((c) => !c.ready && !c.cancelled && !c.quiet);
  if (!building.length) return null;
  return Math.round((building.reduce((n, c) => n + c.progress, 0) / building.length) * 100);
}

const TEMPORAL_FX = new Set(['timeSlice', 'sTimeSlice', 'echo', 'bccTemporalBlur', 'wideTime']);
const hasTemporal = (l) => (l.effects || []).some((fx) => fx.enabled && TEMPORAL_FX.has(fx.type));
const WIN = 10; // s de vídeo guardados em volta do cursor quando só efeitos de tempo pedem o cache (clipes longos)

/** Garante cache para camadas de vídeo com Velocidade (Twixtor) e efeitos de tempo (Time Slice, Echo…).
 *  Também para vídeos DENTRO de um grupo/pré-comp que tem o efeito de tempo (antes ficavam sem cache e o Time Slice
 *  mostrava o mesmo quadro em todas as faixas). Clipes longos só com efeito de tempo: janela de 10 s no fps real em volta
 *  do cursor, que acompanha a reprodução (antes o cache inteiro caía para poucos quadros por segundo). */
export function ensureCaches(project, t = null) {
  if (!exportBusy) pruneMedia(project);
  const ids = new Set();
  const need = [];
  const walk = (layers, inTemporalGroup) => {
    for (const l of layers || []) {
      if (l.type === 'group') { walk(l.props?.layers, inTemporalGroup || hasTemporal(l)); continue; }
      if (l.type !== 'video' || !l.props.src) continue;
      const strong = speedEffect(l) || remapEffect(l) || l.props.interpolate || dedupeOf(l);
      if (strong || hasTemporal(l) || inTemporalGroup) need.push({ l, windowed: !strong && !inTemporalGroup });
    }
  };
  walk(project.layers, false);
  for (const { l, windowed } of need) {
    ids.add(l.id);
    let win = null;
    if (windowed && t != null) {
      const a = sourceTime(l, l.inPoint), b = sourceTime(l, l.outPoint);
      if (Math.abs(b - a) > WIN * 1.4) {
        const c0 = sourceTime(l, Math.max(l.inPoint, Math.min(l.outPoint, t)));
        win = [c0 - WIN * 0.3, c0 + WIN * 0.7]; // mais quadros à frente (a reprodução anda para frente)
      }
    }
    const key = cacheKey(l) + (win ? '' : '|full');
    const c = caches.get(l.id), nx = pendingCaches.get(l.id);
    if (c && c.baseKey === key) {
      if (!win || !c.win) continue;
      const cur = sourceTime(l, Math.max(l.inPoint, Math.min(l.outPoint, t)));
      if (cur > c.win[0] + 1 && cur < c.win[1] - 2.5) continue; // ainda dentro da janela
      if (nx && !nx.cancelled && cur > nx.win[0] && cur < nx.win[1] - 1) continue; // janela nova já vindo
    }
    if (nx) { nx.cancelled = true; freeCache(nx); pendingCaches.delete(l.id); }
    // troca de janela: o cache atual continua valendo até o novo ficar pronto (o efeito não some durante a troca)
    const keepOld = c && c.ready && c.baseKey === key && win;
    if (c && !keepOld) { c.cancelled = true; freeCache(c); caches.delete(l.id); }
    buildCache(project, l, { key, win, swap: !!keepOld });
  }
  for (const [id, c] of caches) if (!ids.has(id)) { c.cancelled = true; freeCache(c); caches.delete(id); }
  for (const [id, c] of pendingCaches) if (!ids.has(id)) { c.cancelled = true; freeCache(c); pendingCaches.delete(id); }
}
const pendingCaches = new Map();
let cacheVer = 0;
export const cacheVersion = () => cacheVer;

async function buildCache(project, layer, { key: baseKey = cacheKey(layer) + '|full', win = null, swap = false } = {}) {
  const key = cacheKey(layer);
  const fps = layer.props.sourceFps || project.fps; // quadros no fps real do vídeo
  let lo = Infinity, hi = -Infinity;
  for (let t = layer.inPoint; t <= layer.outPoint + 1e-6; t += 1 / project.fps) {
    const s = sourceTime(layer, t);
    lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  // Sensitivity (Topaz): mais alto = considera duplicados também quadros quase iguais (0,9 ≈ sensibilidade 20)
  const dupThr = 0.15 + (dedupeOf(layer)?.sens ?? 20) * 0.0375;
  if (win) { lo = Math.max(lo, win[0]); hi = Math.min(hi, win[1]); }
  const entry = { key, baseKey, win, fps, t0: 0, frames: [], dup: [], sigs: [], ready: false, progress: 0, cancelled: false, quiet: swap };
  if (swap) pendingCaches.set(layer.id, entry); else caches.set(layer.id, entry);
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
  const w = Math.max(160, Math.min(vw, IOS ? 540 : 720, Math.floor(Math.sqrt(CACHE_BUDGET / (n * 4 * aspect)))));
  const h = Math.round(w * aspect);
  // Leitura sequencial (WebCodecs, no hardware): o arquivo é decodificado em ordem, como um player. Antes cada quadro
  // era uma busca no <video> (decodifica desde o keyframe anterior + espera confirmação): em vídeo de celular dava
  // 1 s ou mais por quadro e o "Preparando quadros" levava vários minutos. Sem suporte, volta para a busca.
  let rd = null, misses = 0;
  if (typeof VideoDecoder !== 'undefined') {
    try {
      const blob = await srcBlob(layer.props.src);
      const { SeqReader } = await import('./seqreader.js');
      rd = await SeqReader.open(blob, { size: [w, h] });
    } catch { rd = null; }
  }
  const done = () => { releaseVideo(v); rd?.close(); };
  // Sem WebCodecs para este vídeo (ex.: HEVC num decodificador que não aceita): captura TOCANDO o vídeo (quase tempo
  // real) em vez de buscar quadro por quadro. Os quadros que o player pular são buscados depois, um a um.
  const pre = !rd && 'requestVideoFrameCallback' in v ? await captureByPlayback(v, lo, hi, entry, n, w, h) : null;
  for (let i = 0; i < n; i++) {
    while (exportBusy && !entry.cancelled) await new Promise((r) => setTimeout(r, 250));
    if (entry.cancelled) { done(); freeCache(entry); return; }
    const tt = lo + (i + 0.5) / entry.fps; // meio do quadro: sem quadros repetidos/voltando no cache
    let src = null, c = pre?.[i] || null;
    if (!c && rd) {
      src = await rd.frameAt(tt).catch(() => null);
      if (!src && ++misses >= 3) { rd.close(); rd = null; } // decodificador falhou: segue pela busca
    }
    if (!c) {
      if (!src) { await seekExact(v, tt, entry.fps); src = v; }
      if (entry.cancelled) { done(); freeCache(entry); return; }
      c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(src, 0, 0, w, h);
    }
    // assinatura pequena do quadro: detecta quadros repetidos (vídeos baixados do TikTok/IG costumam ter)
    const sig = frameSignature(c);
    entry.dup.push(i > 0 && entry.sigs.length && sigDiff(sig, entry.sigs[entry.sigs.length - 1]) < dupThr);
    entry.sigs.push(sig);
    entry.frames.push(c);
    entry.progress = (i + 1) / n;
    if (i % 6 === 0) cacheListener();
  }
  done();
  if (entry.cancelled) return;
  entry.ready = true;
  cacheVer++;
  if (swap) { const old = caches.get(layer.id); if (old && old !== entry) { old.cancelled = true; freeCache(old); } caches.set(layer.id, entry); pendingCaches.delete(layer.id); }
  cacheListener();
  onChange();
}

/** Toca o vídeo mudo do início do trecho até o fim e guarda cada quadro mostrado no(s) espaço(s) do cache cujo instante
 *  (meio do quadro) ele cobre. Devolve um array com n posições (null = quadro pulado pelo player → busca depois). */
async function captureByPlayback(v, lo, hi, entry, n, w, h) {
  const slots = new Array(n).fill(null);
  const fps = entry.fps, mid = (i) => lo + (i + 0.5) / fps;
  try {
    v.muted = true; v.playbackRate = 1;
    await seek(v, Math.max(0, lo));
    let prev = null, prevT = -1, next = 0, step = 1 / 30;
    await new Promise((resolve) => {
      let stall = 0, finished = false;
      const finish = () => { if (finished) return; finished = true; clearTimeout(stall); try { v.pause(); } catch { /* ok */ } resolve(); };
      const arm = () => { clearTimeout(stall); stall = setTimeout(finish, 3000); };
      const put = (upTo) => { // espaços cujo meio está antes de upTo recebem o quadro anterior
        while (next < n && mid(next) < upTo) { if (prev && mid(next) >= prevT) { slots[next] = prev; prev._used = true; } next++; }
      };
      const onFrame = (_now, md) => {
        if (finished) return;
        if (entry.cancelled || exportBusy) { finish(); return; }
        const t = md.mediaTime;
        if (prevT >= 0 && t > prevT) {
          const d = t - prevT;
          if (d < step * 1.2) step = step * 0.7 + d * 0.3; // intervalo típico entre quadros do vídeo
          if (d > step * 1.6) { put(prevT + step); while (next < n && mid(next) < t) next++; } // o player pulou quadros: ficam vazios
          else put(t);
        } else put(t);
        if (prev && !prev._used) { prev.width = 0; prev.height = 0; } // quadro que não caiu em nenhum espaço: libera
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        prev = c; prevT = t;
        entry.progress = Math.min(0.99, next / n);
        if (next % 6 === 0) cacheListener();
        if (t >= hi || next >= n || v.ended) { put(Infinity); finish(); return; }
        arm(); v.requestVideoFrameCallback(onFrame);
      };
      v.addEventListener('ended', () => { put(prevT + step * 1.5); finish(); }, { once: true });
      v.requestVideoFrameCallback(onFrame);
      arm();
      v.play().catch(() => finish());
    });
    // último quadro: só cobre o que estiver até ~1 quadro depois dele
    for (let i = 0; i < n; i++) if (!slots[i] && prev && mid(i) >= prevT && mid(i) < prevT + step * 1.5) { slots[i] = prev; prev._used = true; }
    if (prev && !prev._used) { prev.width = 0; prev.height = 0; }
  } catch { /* segue pela busca */ }
  return slots;
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
  releaseVideo(v);
  return c.toDataURL('image/jpeg', 0.6);
}

/** Detecta o fps real do vídeo (requestVideoFrameCallback). Retorna null se não for possível. */
export function detectFps(src) {
  return new Promise((resolve) => {
    const v = makeVideo(src);
    if (!('requestVideoFrameCallback' in v)) { resolve(null); return; }
    const times = [];
    const done = () => {
      v.pause(); releaseVideo(v);
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

/**
 * A mídia do tempo t já está no quadro certo? (imagens carregadas, vídeos parados no quadro pedido ou com cache
 * decodificado). Só quadros "certos" entram no cache de RAM da prévia — nunca um quadro com vídeo ainda buscando.
 */
export function mediaReady(project, t0, playing = false) {
  const fps = project.fps || 30;
  for (const { l, t } of timedLayers(project.layers, t0)) {
    if (!l.visible || !(t >= l.inPoint && t < l.outPoint) || !l.props?.src) continue; // (t = NaN: pré-comp fora do ar)
    if (l.type === 'image') { const im = images.get(l.props.src); if (!im || !im.complete || !im.naturalWidth) return false; }
    else if (l.type === 'video') {
      if (cacheReady(l)) continue;
      if (exportBusy) return false;
      const e = videos.get(l.id), fr = e?.frame;
      if (!e || !fr || e.a.readyState < 2 || e.a.seeking) return false;
      const tol = playing ? 0.5 / fps : 0.02;
      if (Math.abs(e.a.currentTime - fr.a) > tol && !(e.a.duration && fr.a >= e.a.duration - 0.01)) return false;
      if (!playing && fr.b !== null && (!e.b || e.b.readyState < 2 || e.b.seeking || Math.abs(e.b.currentTime - fr.b) > tol)) return false;
    }
  }
  return true;
}

/**
 * Dá para desenhar o quadro agora sem buracos? (todos os vídeos ativos com quadro decodificado e sem busca em
 * andamento, imagens carregadas). Se não der, a prévia segura o último quadro bom em vez de piscar preto.
 */
export function framesDrawable(project, t0) {
  for (const { l, t } of timedLayers(project.layers, t0)) {
    if (!l.visible || !(t >= l.inPoint && t < l.outPoint) || !l.props?.src) continue; // (t = NaN: pré-comp fora do ar)
    if (l.type === 'image') { const im = images.get(l.props.src); if (im && !im.complete) return false; }
    else if (l.type === 'video') {
      if (cacheReady(l)) continue;
      const e = videos.get(l.id);
      if (!e) return false;
      // buscando mas com um quadro recente guardado: desenha com ele (scrub acompanha); sem nada ainda, segura
      if (e.a.seeking || e.a.readyState < 2) { if (!e.a._scrub && !e.last) return false; continue; }
      if (e.frame?.b != null && e.b && (e.b.readyState < 2 || e.b.seeking)) return false;
    }
  }
  return true;
}
