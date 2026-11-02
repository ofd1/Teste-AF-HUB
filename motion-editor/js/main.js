import { Store, LAYER_FACTORIES, RESOLUTIONS, createProject, flatLayers } from './state.js';
import { compDialog, COMP_PRESETS } from './comp-dialog.js';
import { HomeScreen, saveProjectData, loadProjectData, loadProjectDataAsync, listProjects, allMediaIds, getSettings, settingsDialog } from './projects.js';
import { parseFFX } from './ffx.js';
import { ffxToPreset } from './presets.js';
import { TopazPanel } from './topaz-panel.js';
import { setBgListener, ensureBgModel, bgStatus } from './bgremove.js';
import { setGLLostListener, glLost } from './gl.js';
import { createEffectInstance } from './presets.js';
import { renderFrame, hitTest, layerCorners, forgetLayer } from './renderer.js';
import { prepare, pauseAll, setMediaListener, videoThumb, ensureCaches, setCacheListener, cacheStatus, detectFps, mediaReady } from './media.js';
import { loadAudio, playAudio, stopAudio, detectBeats } from './audio.js';
import { valueAt, setValue, setKey } from './anim.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Library } from './library.js';
import { FxBrowser } from './fx-browser.js';
import { KeyTools } from './keytools.js';
import { deleteKeys } from './keyframes.js';
import { exportDialog } from './exporter.js';
import { getEffectDef } from './effects.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { formatTime, uid, deepClone, escapeHtml } from './util.js';
import { putMedia, getMedia, pruneMedia } from './idb.js';
import { saveFile, registerServiceWorker } from './platform.js';
import { getGL } from './gl.js';
import { TrackerPanel } from './tracker-panel.js';
import { calibrateFromImage, CALIB_LABEL } from './calibrate.js';
import { parseAEP, aepToProject, mainComps } from './aep.js';

const store = new Store();
const AUTOSAVE_KEY = 'motionframe.autosave.v2';

// ------------------------------------------------------------------ prévia
const view = document.getElementById('view');
const overlay = document.getElementById('overlay');
const stage = document.getElementById('stage');
const wrap = document.getElementById('canvasWrap');
const qualitySel = document.getElementById('quality');
const timecode = document.getElementById('timecode');
const ctx = view.getContext('2d');
const octx = overlay.getContext('2d');
let dirty = true;
// "Auto": nítido (resolução cheia) parado; tocando, a resolução se adapta ao que o aparelho aguenta
// (mede o tempo de cada quadro: se passar do tempo do fps, reduz; se sobrar folga, aumenta)
const PLAY_STEPS = [0.33, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
let playStep = 4, renderMs = 0, fastFrames = 0;
const curQuality = () => (qualitySel.value === 'auto' ? (store.playing ? PLAY_STEPS[playStep] : 1) : parseFloat(qualitySel.value));
function adaptQuality(ms) {
  if (!store.playing || qualitySel.value !== 'auto') return;
  renderMs = renderMs ? renderMs * 0.8 + ms * 0.2 : ms;
  const budget = 1000 / Math.min(60, store.project.fps || 30);
  if (renderMs > budget * 1.15 && playStep > 0) { playStep--; renderMs = 0; fastFrames = 0; }
  else if (renderMs < budget * 0.45) { if (++fastFrames > 45 && playStep < PLAY_STEPS.length - 1) { playStep++; fastFrames = 0; renderMs = 0; } }
  else fastFrames = 0;
}
let quality = curQuality();
setMediaListener(() => { dirty = true; });
setBgListener(() => { dirty = true; frameCacheClear(); });

// ---- Renderização estilo After Effects:
// 1) o quadro é desenhado num buffer fora da tela e só aparece pronto (nunca pisca preto nem mostra quadro pela metade);
//    se a GPU cair no meio, a tela continua com o último quadro bom e o quadro é refeito;
// 2) cache de RAM (como o RAM Preview / barra verde do AE): quadros já renderizados ficam guardados e tocam
//    na velocidade real sem renderizar de novo, até você mudar algo no projeto.
const IOS_M = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const FRAME_CACHE_BUDGET = IOS_M ? 90e6 : Math.min(1500e6, ((navigator.deviceMemory || 8) * 1e9) / 6);
const frameCache = new Map(); // chave → { c: canvas, bytes }
let frameCacheBytes = 0;
const backBuf = document.createElement('canvas');
const backCtx = backBuf.getContext('2d');
function frameCacheClear() { frameCache.clear(); frameCacheBytes = 0; }
function frameCachePut(key, src) {
  const bytes = src.width * src.height * 4;
  if (bytes * 3 > FRAME_CACHE_BUDGET) return;
  let e = frameCache.get(key);
  if (!e) {
    // reaproveita o canvas do quadro mais antigo quando o cache enche (sem criar/destruir canvases sem parar)
    let reuse = null;
    while (frameCacheBytes + bytes > FRAME_CACHE_BUDGET && frameCache.size) {
      const [k0, old] = frameCache.entries().next().value;
      frameCache.delete(k0); frameCacheBytes -= old.bytes;
      if (!reuse && old.c.width === src.width && old.c.height === src.height) reuse = old.c;
      else { old.c.width = old.c.height = 1; }
    }
    const c = reuse || document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    e = { c, bytes };
    frameCacheBytes += bytes;
  } else frameCache.delete(key);
  e.c.getContext('2d').drawImage(src, 0, 0);
  frameCache.set(key, e);
}
function frameCacheGet(key) {
  const e = frameCache.get(key);
  if (!e) return null;
  frameCache.delete(key); frameCache.set(key, e); // mais recente
  return e.c;
}
let glLosses = 0, lastEdit = 0, hqMs = 0, hqTimer = 0;
setGLLostListener(() => { glLosses++; dirty = true; frameCacheClear(); if (!setGLLostListener.warned) { setGLLostListener.warned = true; toast('A GPU do aparelho reiniciou; o app recuperou a prévia.', 'warn', 3500); } });
// primeira vez no app: mostra o passo a passo
setTimeout(() => { try { if (!localStorage.getItem('motionframe.helpSeen')) { localStorage.setItem('motionframe.helpSeen', '1'); showHelp(); } } catch { /* sem armazenamento */ } }, 900);

function layoutCanvas() {
  const { width, height } = store.project;
  // só redimensiona se mudou (mudar width/height apaga o canvas → piscava preto)
  const vw = Math.round(width * quality), vh = Math.round(height * quality);
  if (view.width !== vw || view.height !== vh) {
    const keep = view.width > 1 && view.height > 1 ? (() => { const c = document.createElement('canvas'); c.width = view.width; c.height = view.height; c.getContext('2d').drawImage(view, 0, 0); return c; })() : null;
    view.width = vw; view.height = vh;
    if (keep) ctx.drawImage(keep, 0, 0, vw, vh); // mantém o quadro anterior (ampliado) até o novo ficar pronto
  }
  const r = stage.getBoundingClientRect();
  const s = Math.min((r.width - 16) / width, (r.height - 16) / height);
  const cssW = Math.max(40, width * s), cssH = Math.max(40, height * s);
  wrap.style.width = `${cssW}px`;
  wrap.style.height = `${cssH}px`;
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(cssW * dpr);
  overlay.height = Math.round(cssH * dpr);
  dirty = true;
}
new ResizeObserver(layoutCanvas).observe(stage);
// preview ampliado: ocupa a tela toda (no PC também entra em tela cheia do navegador); Esc ou ⛶ volta
const maxBtn = document.getElementById('maxBtn'), maxPlay = document.getElementById('maxPlay');
function setMaxPreview(on) {
  document.body.classList.toggle('preview-max', on);
  maxBtn.textContent = on ? '✕' : '⛶';
  if (on && document.documentElement.requestFullscreen && !/iPhone|iPad/.test(navigator.userAgent)) document.documentElement.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setTimeout(layoutCanvas, 50);
}
maxBtn.addEventListener('click', () => setMaxPreview(!document.body.classList.contains('preview-max')));
maxPlay.addEventListener('click', () => setPlaying(!store.playing));
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('preview-max')) setMaxPreview(false); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('preview-max')) setMaxPreview(false); });
qualitySel.addEventListener('change', () => { quality = curQuality(); layoutCanvas(); });

function drawOverlay() {
  const k = overlay.width / store.project.width;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  trackerPanel.drawOverlay(octx, k, window.devicePixelRatio || 1);
  const layer = store.layer();
  // prévia limpa: a caixa só aparece enquanto você arrasta/redimensiona a camada
  if (!gesture?.moved) return;
  if (!layer || store.playing || !layer.visible || layer.type === 'audio' || layer.type === 'adjustment' || store.time < layer.inPoint || store.time >= layer.outPoint) return;
  const pts = layerCorners(layer, store.time, store.project);
  const dpr = window.devicePixelRatio || 1;
  octx.strokeStyle = '#2d8ceb';
  octx.lineWidth = 1 * dpr;
  octx.beginPath();
  pts.forEach(([x, y], i) => (i ? octx.lineTo(x * k, y * k) : octx.moveTo(x * k, y * k)));
  octx.closePath();
  octx.stroke();
  octx.setLineDash([]);
}

let lastFrame = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (store.playing && !store.exporting) {
    let t = store.time + dt;
    if (t >= store.project.duration) { t = 0; playAudio(store.project, 0); }
    store.time = t;
    store.emit('time');
  }
  if ((dirty || store.playing) && !store.exporting) {
    prepare(store.project, store.time, { playing: store.playing });
    if (curQuality() !== quality) { quality = curQuality(); layoutCanvas(); }
    const fps = store.project.fps || 30, fi = Math.round(store.time * fps + 1e-6);
    // Resolução adaptativa (como no AE): parado, enquanto você arrasta/mexe num projeto pesado, o quadro sai em
    // rascunho; quando para de mexer, sai o quadro nítido (e vai para o cache).
    const interacting = performance.now() - lastEdit < 380;
    const draftK = !store.playing && qualitySel.value === 'auto' && interacting && hqMs > 140 ? Math.max(0.3, Math.min(0.8, Math.sqrt(90 / hqMs))) : 1;
    const key = `${fi}|${quality}|${store.playing ? 'p' : 'hq'}`;
    const cached = (store.playing && frameCacheGet(`${fi}|${quality}|hq`)) || frameCacheGet(key);
    if (cached) {
      ctx.drawImage(cached, 0, 0, view.width, view.height);
    } else {
      const r0 = performance.now(), lost0 = glLosses;
      const bw = Math.max(1, Math.round(view.width * draftK)), bh = Math.max(1, Math.round(view.height * draftK));
      if (backBuf.width !== bw || backBuf.height !== bh) { backBuf.width = bw; backBuf.height = bh; }
      let ok = true;
      const tt = store.playing ? fi / fps : store.time;
      try { renderFrame(backCtx, viewProject(), tt, quality * draftK, { hq: !store.playing && draftK === 1 }); } catch (e) { ok = false; console.warn('quadro falhou', e); }
      const ms = performance.now() - r0;
      if (ok && glLosses === lost0 && !glLost()) {
        ctx.drawImage(backBuf, 0, 0, view.width, view.height);
        if (draftK < 1) { clearTimeout(hqTimer); hqTimer = setTimeout(() => { dirty = true; }, 400); }
        else {
          if (!store.playing) hqMs = hqMs ? hqMs * 0.5 + ms * 0.5 : ms;
          if (mediaReady(viewProject(), tt, store.playing)) frameCachePut(key, backBuf);
        }
        adaptQuality(ms);
      } else setTimeout(() => { dirty = true; }, 60); // GPU caiu: mantém o último quadro bom e refaz este
    }
    drawOverlay();
    timecode.textContent = formatTime(store.time, store.project.fps).slice(1);
    dirty = false;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// cache de quadros para Velocidade/Twixtor (prévia suave e reverse)
const cachePill = document.createElement('div');
cachePill.className = 'cache-pill';
stage.appendChild(cachePill);
let lastCacheSt = null;
setCacheListener(() => {
  const st = cacheStatus();
  if (lastCacheSt != null && st == null) frameCacheClear(); // cache do Twixtor ficou pronto: quadros interpolados mudam
  lastCacheSt = st;
  cachePill.textContent = st == null ? '' : `Preparando quadros… ${st}%`;
  cachePill.classList.toggle('show', st != null);
  dirty = true;
});
let cacheTimer = 0;
function scheduleCaches() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => { if (!store.exporting) ensureCaches(store.project); }, 600);
}

store.on((kind) => {
  dirty = true;
  if (kind !== 'time' && kind !== 'selection' && kind !== 'keys') frameCacheClear();
  if (kind !== 'selection' && !store.playing) lastEdit = performance.now();
  if (kind === 'structure' || kind === 'change') scheduleCaches();
  if (kind === 'structure' || kind === 'change') autosave();
  if (kind === 'selection' || kind === 'structure') { renderToolbar(); onSelectionChanged(); updateTitle(); }
  else if (kind === 'change') renderToolbar();
});

const playBtn = document.querySelector('[data-cmd="play"]');
function setPlaying(p) {
  const mp = document.getElementById('maxPlay'); if (mp) mp.textContent = p ? '❚❚' : '▶';
  if (p === store.playing) return;
  store.playing = p;
  playBtn.textContent = p ? '❚❚' : '▶';
  lastFrame = performance.now();
  if (p) playAudio(store.project, store.time);
  else { stopAudio(); pauseAll(); store.setTime(store.time); }
  dirty = true;
}

// ---- gestos na prévia: 1 dedo move, 2 dedos escala + rotação
const pointers = new Map();
let gesture = null;
let trackPick = null; // callback quando o tracker espera o toque no ponto
overlay.addEventListener('pointerdown', (e) => {
  overlay.setPointerCapture(e.pointerId);
  const r = overlay.getBoundingClientRect();
  const toComp = (ev) => [((ev.clientX - r.left) / r.width) * store.project.width, ((ev.clientY - r.top) / r.height) * store.project.height];
  if (trackPick) { const cb = trackPick; trackPick = null; cb(toComp(e)); return; }
  pointers.set(e.pointerId, toComp(e));
  if (pointers.size === 1) {
    const [x, y] = toComp(e);
    let layer = store.layer();
    const hit = hitTest(viewProject(), store.time, x, y);
    if (hit && (!layer || hit.id !== layer.id)) { store.select(hit.id); layer = hit; }
    if (!layer || layer.type === 'audio' || layer.type === 'adjustment') { gesture = null; return; }
    gesture = { layer, toComp, start: [x, y], pos: valueAt(layer.transform.position, store.time), moved: false };
  } else if (pointers.size === 2 && gesture) {
    const [a, b] = [...pointers.values()];
    gesture.pinch = { d0: Math.hypot(b[0] - a[0], b[1] - a[1]), a0: Math.atan2(b[1] - a[1], b[0] - a[0]), s0: valueAt(gesture.layer.transform.scale, store.time), r0: valueAt(gesture.layer.transform.rotation, store.time) };
  }
});
overlay.addEventListener('pointermove', (e) => {
  if (!gesture || !pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, gesture.toComp(e));
  const { layer } = gesture;
  if (pointers.size >= 2 && gesture.pinch) {
    const [a, b] = [...pointers.values()];
    const { d0, a0, s0, r0 } = gesture.pinch;
    const f = Math.hypot(b[0] - a[0], b[1] - a[1]) / (d0 || 1);
    setValue(layer.transform.scale, store.time, [Math.round(s0[0] * f * 10) / 10, Math.round(s0[1] * f * 10) / 10]);
    setValue(layer.transform.rotation, store.time, Math.round((r0 + ((Math.atan2(b[1] - a[1], b[0] - a[0]) - a0) * 180) / Math.PI) * 10) / 10);
    gesture.moved = true;
  } else if (pointers.size === 1) {
    const [x, y] = pointers.get(e.pointerId);
    if (Math.hypot(x - gesture.start[0], y - gesture.start[1]) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    setValue(layer.transform.position, store.time, [Math.round(gesture.pos[0] + x - gesture.start[0]), Math.round(gesture.pos[1] + y - gesture.start[1])]);
  }
  store.emit('preview');
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && gesture) {
    const moved = gesture.moved;
    gesture = null;
    if (moved) store.commit();
    dirty = true;
  }
};
overlay.addEventListener('pointerup', endPointer);
overlay.addEventListener('pointercancel', endPointer);

// ------------------------------------------------------------------ sheet (painel inferior / lateral)
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheetTitle');
const TITLES = { effects: 'Efeitos', browser: 'Adicionar efeito', props: 'Ajustes da camada', presets: 'Presets', keys: 'Keyframes e gráfico', topaz: 'Topaz (melhorar vídeo)', add: 'Adicionar camada' };
const desktop = window.matchMedia('(min-width: 1100px)');
const appEl = document.querySelector('.app');
let sheetPane = null;
let sheetBackTo = null;

function openSheet(name, backTo = null) {
  if (sheetPane !== name) sheet.querySelector('.sheet-body').scrollTop = 0;
  sheetPane = name;
  sheetBackTo = backTo;
  document.querySelectorAll('.sheet .pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  sheetTitle.textContent = TITLES[name] || '';
  sheet.classList.add('open');
  appEl.classList.toggle('docked', !desktop.matches);
  sheet.classList.toggle('has-back', !!backTo);
  sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() {
  if (desktop.matches) { openSheet(store.layer() ? 'effects' : 'presets'); return; }
  sheetPane = null;
  sheet.classList.remove('open');
  appEl.classList.remove('docked');
  sheet.setAttribute('aria-hidden', 'true');
}
document.getElementById('sheetClose').addEventListener('click', closeSheet);
document.getElementById('sheetBack').addEventListener('click', () => sheetBackTo && openSheet(sheetBackTo));
(() => {
  // arrastar a alça para baixo fecha o painel (mobile)
  let y0 = null;
  for (const el of [document.getElementById('sheetGrip'), sheet.querySelector('.sheet-head')]) {
    el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 != null && e.touches[0].clientY - y0 > 0) sheet.style.transform = `translateY(${e.touches[0].clientY - y0}px)`; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const dy = (e.changedTouches[0]?.clientY ?? y0) - y0;
      sheet.style.transform = '';
      if (dy > 80) closeSheet();
      y0 = null;
    });
  }
})();

function onSelectionChanged() {
  if (!store.layer() && ['effects', 'props'].includes(sheetPane)) {
    if (desktop.matches) openSheet('presets'); else closeSheet();
  } else if (desktop.matches && store.layer() && (sheetPane === 'presets' || sheetPane === 'add' || !sheetPane)) openSheet('effects');
}

// ------------------------------------------------------------------ painéis
let keyTools = null;
const timeline = new Timeline(document.getElementById('timeline'), store, {
  onUserScrub: () => setPlaying(false),
  onPreview: () => { dirty = true; },
  videoThumb: (src) => videoThumb(src),
  multiSelect: () => keyTools?.multi,
  onKeyTap: () => { if (sheetPane !== 'keys') openSheet('keys'); },
});
new Inspector(document.getElementById('effectsPanel'), store, 'effects', {
  browse: () => openSheet('browser', 'effects'),
  duplicateEffect: (layer, fx) => {
    const copy = deepClone(fx);
    copy.id = uid('fx');
    layer.effects.splice(layer.effects.indexOf(fx) + 1, 0, copy);
  },
  savePreset: () => library.saveLayer(),
});
new Inspector(document.getElementById('propsPanel'), store, 'props', {
  speed: (layer) => { ensureSpeedEffect(layer); openSheet('effects'); },
  beats: (layer) => addBeatMarkers(layer),
  track: (layer) => openTracker(layer, 'point'),
  faceTrack: (layer) => openTracker(layer, 'face'),
  replace: (layer) => replaceLayerMedia(layer),
});
const library = new Library(document.getElementById('library'), store, {
  onApplied: () => { if (!desktop.matches) closeSheet(); },
  openAEP: (f) => { closeSheet(); return openAEPFlow(f); }, // .aep escolhido em Presets abre como projeto
});
new FxBrowser(document.getElementById('fxBrowser'), (type) => {
  let layer = store.layer();
  if (!layer) {
    layer = LAYER_FACTORIES.adjustment(store.project);
    layer.name = `Ajuste · ${getEffectDef(type).label}`;
    store.layers.unshift(layer);
    store.selectedLayerId = layer.id;
  }
  if ((getEffectDef(type).sourceSpeed || getEffectDef(type).sourceRemap) && layer.type !== 'video') toast('Velocidade (estilo Twixtor) só altera camadas de vídeo.', 'warn', 4000);
  const inst = createEffectInstance(type);
  getEffectDef(type).init?.(inst, layer);
  layer.effects.push(inst);
  store.commit('structure');
  openSheet('effects');
  toast(`${getEffectDef(type).label} adicionado em ${layer.name}`, 'ok', 2000);
});
keyTools = new KeyTools(document.getElementById('keyTools'), store);
new TopazPanel(document.getElementById('topazPanel'), store);

// ---- tracker (painel estilo After Effects)
const trackerPanel = new TrackerPanel(store, {
  pick: () => { if (!desktop.matches) closeSheet(); return new Promise((res) => { trackPick = res; }); },
  redraw: () => { dirty = true; },
  pause: () => setPlaying(false),
  setTime: (t) => store.setTime(t),
  stabilize: (layer) => { store.selectedLayerId = layer.id; store.emit('selection'); openSheet('topaz'); toast('Stabilize Motion: ajuste em “Estabilização” no painel Topaz.', 'info', 4000); },
});
function openTracker(layer, kind) {
  if (layer.type !== 'video') { toast('O tracker funciona em camadas de vídeo.', 'warn'); return; }
  if (!desktop.matches) closeSheet();
  trackerPanel.open(layer, kind);
}

/**
 * Substitui a mídia de uma camada (vídeo, foto ou áudio) mantendo tudo o resto: posição, escala, rotação, keyframes,
 * efeitos, máscaras, tempo e modo de mesclagem. A nova mídia preenche a mesma caixa sem distorcer.
 */
async function replaceLayerMedia(layer) {
  const [f] = await pickFiles(layer.type === 'audio' ? 'audio/*,.mp3,.wav,.m4a' : 'video/*,image/*', false);
  if (!f) return;
  const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name);
  const isAudio = f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);
  const mediaId = uid('m');
  putMedia(mediaId, f);
  const src = URL.createObjectURL(f);
  const old = layer.props || {};
  const box = { width: old.width || old.aeMedia?.width || store.project.width, height: old.height || old.aeMedia?.height || store.project.height };
  if (isAudio) layer.props = { ...old, src, mediaId, sourceStart: 0, aeMedia: undefined };
  else {
    const keep = { ...old };
    delete keep.aeMedia; delete keep.replacedFrom;
    layer.props = { ...keep, src, mediaId, width: box.width, height: box.height, fit: 'cover', sourceStart: 0, ...(isVideo ? { speed: old.speed || 1, volume: old.volume ?? 100 } : {}) };
    if (!isVideo) { delete layer.props.sourceFps; delete layer.props.hasAudio; }
  }
  layer.type = isAudio ? 'audio' : isVideo ? 'video' : 'image';
  layer.name = f.name.replace(/\.[^.]+$/, '');
  if (isVideo) {
    detectFps(src).then((fps) => { if (fps) { layer.props.sourceFps = fps; store.commit(); } });
    loadAudio(src).then(() => { layer.props.hasAudio = true; store.emit('change'); }).catch(() => { layer.props.hasAudio = false; });
  }
  if (isAudio) await loadAudio(src).catch(() => {});
  store.commit('structure');
  ensureCaches?.(store.project);
  toast(`Mídia substituída — efeitos, keyframes e ajustes mantidos ✓`, 'ok', 3000);
}

function ensureSpeedEffect(layer) {
  if (!layer || layer.type !== 'video') { toast('Selecione uma camada de vídeo.', 'warn'); return; }
  if (!layer.effects.some((fx) => fx.type === 'twixtor')) {
    layer.effects.unshift(createEffectInstance('twixtor', { speed: 100 }));
    store.commit();
  }
}

async function addBeatMarkers(layer) {
  try {
    await loadAudio(layer.props.src);
    const beats = detectBeats(layer.props.src, 0.5);
    const start = layer.props.sourceStart || 0;
    const fps = store.project.fps;
    const times = beats.map((b) => layer.inPoint + (b - start)).filter((t) => t >= layer.inPoint && t <= layer.outPoint && t <= store.project.duration);
    store.project.markers = [...new Set([...(store.project.markers || []), ...times.map((t) => Math.round(t * fps) / fps)])].sort((a, b) => a - b);
    store.commit();
    toast(`${times.length} batidas marcadas na timeline.`, 'ok');
  } catch (e) {
    toast(`Não foi possível analisar o áudio: ${e.message}`, 'error');
  }
}

const ADD_ITEMS = [
  ['media', '🎞', 'Vídeo / Imagem'], ['audio', '♪', 'Áudio / Música'], ['text', 'T', 'Texto'], ['adjustment', '◐', 'Camada de ajuste'],
  ['rect', '▭', 'Retângulo'], ['ellipse', '◯', 'Elipse'], ['solid', '■', 'Sólido / cor'],
];
const addMenu = document.getElementById('addMenu');
addMenu.innerHTML = `<div class="add-grid">${ADD_ITEMS.map(([k, i, l]) => `<button data-add="${k}"><span class="ai">${i}</span>${l}</button>`).join('')}</div>
  <p class="muted small">Dica: camadas de ajuste aplicam efeitos (shake, glow, CC…) em tudo que está abaixo — como no After Effects.</p>`;
addMenu.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.add;
  if (k === 'media') commands['add-media']();
  else if (k === 'audio') commands['add-audio']();
  else { addLayer(k); if (!desktop.matches) closeSheet(); }
}));

// ------------------------------------------------------------------ toolbar contextual
const toolbar = document.getElementById('toolbar');
const TYPE_LABEL = { video: 'Vídeo', image: 'Foto', audio: 'Áudio', text: 'Texto', adjustment: 'Camada de ajuste', group: 'Grupo', rect: 'Forma', ellipse: 'Forma', solid: 'Sólido' };
const hintBar = document.createElement('div');
hintBar.className = 'hint-bar';
toolbar.before(hintBar);
function renderToolbar() {
  const layer = store.layer();
  const t = layer?.type;
  const many = store.selectedLayers().length;
  const items = many > 1
    ? [
      ['deselect', '✕', 'Limpar seleção'], ['sep'],
      ['group', '⊞', `Pré-compor (${many})`, true], ['props', '☰', `Ajustar ${many} juntas`, true], ['presets', '★', 'Preset em todas'], ['effects', '✦', 'Efeitos'],
      ['dup', '⧉', 'Duplicar'], ['del', '🗑', `Excluir ${many}`],
    ]
    : layer
    ? [
      ...(store.scope?.length ? [['close-group', '◀', 'Sair do grupo', true]] : []),
      ['deselect', '✕', 'Fechar'], ['sep'],
      ...(t === 'group' ? [['open-group', '📂', 'Abrir grupo', true]] : []),
      ['effects', '✦', 'Efeitos', true], ['presets', '★', 'Presets'],
      ...(t === 'video' ? [['speed', '⏱', 'Velocidade', true], ['topaz', '✨', 'Topaz', true]] : []),
      ...(t === 'video' || t === 'audio' ? [['sound', '🔊', 'Som']] : []),
      ...(t === 'video' || t === 'image' ? [['bg-remove', '✂︎', 'Tirar fundo']] : []),
      ['calibrate', '🎯', 'Calibrar CC'], ['props', '☰', 'Propriedades'], ['keys', '📈', 'Keyframes / gráfico'],
      ['split', '✂', 'Dividir'], ['dup', '⧉', 'Duplicar'],
      t === 'group' ? ['ungroup', '⊟', 'Desagrupar'] : ['group', '⊞', 'Agrupar'],
      ['up', '▲', 'Subir'], ['down', '▼', 'Descer'],
      ['toggle-visible', layer.visible ? '👁' : '◌', layer.visible ? 'Ocultar' : 'Mostrar'], ['del', '🗑', 'Excluir'],
    ]
    : [
      ...(store.scope?.length ? [['close-group', '◀', 'Sair do grupo', true]] : []),
      ['add-media', '🎞', 'Vídeo / Foto', true], ['add-audio', '♪', 'Música'], ['add-text', 'T', 'Texto'], ['add', '＋', 'Mais camadas'],
      ['presets', '★', 'Presets'], ['add-adjustment', '◐', 'Ajuste (CC)'], ['group', '⊞', 'Agrupar'], ['import-ffx', '⤒', 'Importar .ffx'], ['comp', '⚙', 'Composição'],
    ];
  toolbar.innerHTML = items.map(([cmd, icon, label, hot]) => (cmd === 'sep' ? '<span class="tool sep"></span>' : `<button class="tool ${hot ? 'hot' : ''}" data-cmd="${cmd}"><span class="ti">${icon}</span><span class="tl">${label}</span></button>`)).join('');
  toolbar.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));
  // faixa de ajuda: diz o que está selecionado e o próximo passo
  hintBar.hidden = !getSettings().showTips;
  if (!store.project.layers.length) hintBar.innerHTML = '👋 Comece tocando em <b>Vídeo / Foto</b> para importar seu clipe.';
  else if (!layer) hintBar.innerHTML = 'Toque numa camada (na timeline ou na prévia) para editar. Arraste a régua azul para mudar o tempo.';
  else if (many > 1) hintBar.innerHTML = `<b>${many} camadas selecionadas</b> — mudanças em Propriedades valem para todas · Pré-compor junta em um grupo · Shift/Ctrl+clique (ou toque longo) adiciona/remove`;
  else hintBar.innerHTML = `<b>${escapeHtml(layer.name)}</b> · ${TYPE_LABEL[t] || t}${layer.effects.length ? ` · ${layer.effects.length} efeito(s)` : ''} — ${t === 'video' ? 'use <b>Presets</b> para CC/shake/reverse ou <b>Velocidade</b> para câmera lenta' : t === 'group' ? 'efeitos e presets valem para o grupo inteiro' : 'use <b>Efeitos</b> ou <b>Presets</b>'}`;
}

// ------------------------------------------------------------------ mídia
function addLayer(type) {
  const l = LAYER_FACTORIES[type](store.project);
  l.inPoint = 0;
  l.outPoint = store.project.duration;
  store.addLayer(l);
}

async function importMedia(files) {
  for (const f of files) {
    const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name);
    const isAudio = f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);
    const isImage = f.type.startsWith('image/');
    if (!isVideo && !isAudio && !isImage) continue;
    const mediaId = uid('m');
    putMedia(mediaId, f);
    const src = URL.createObjectURL(f);
    const name = f.name.replace(/\.[^.]+$/, '');
    const { width, height } = store.project;
    if (isAudio) {
      const l = LAYER_FACTORIES.audio(store.project, src, name);
      l.props.mediaId = mediaId;
      try {
        const buf = await loadAudio(src);
        if (!store.project.layers.some((x) => x.type === 'audio' || x.type === 'video')) store.project.duration = Math.min(600, Math.max(1, Math.ceil(buf.duration * 10) / 10));
        l.inPoint = 0;
        l.outPoint = Math.min(store.project.duration, buf.duration);
      } catch { toast(`Não foi possível decodificar ${f.name}`, 'error'); continue; }
      store.addLayer(l);
      continue;
    }
    const dims = await new Promise((res) => {
      if (isVideo) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.onloadedmetadata = () => res({ w: v.videoWidth || 1080, h: v.videoHeight || 1920, d: v.duration });
        v.onerror = () => res(null);
        v.src = src;
      } else {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res(null);
        img.src = src;
      }
    });
    if (!dims) { toast(`Formato não suportado: ${f.name}`, 'error'); continue; }
    const fit = Math.max(width / dims.w, height / dims.h); // preenche a tela
    const l = LAYER_FACTORIES[isVideo ? 'video' : 'image'](store.project, src, Math.round(dims.w * fit), Math.round(dims.h * fit), name);
    l.props.mediaId = mediaId;
    if (isVideo) {
      detectFps(src).then((f) => { if (f) { l.props.sourceFps = f; store.commit(); } });
      // o vídeo já vem com o som dele (some sozinho quando tiver Velocidade/Twixtor)
      l.props.volume = 100;
      loadAudio(src).then(() => { l.props.hasAudio = true; store.emit('change'); }).catch(() => { l.props.hasAudio = false; });
    }
    const hasContent = store.project.layers.some((x) => x.type === 'video' || x.type === 'audio');
    l.inPoint = hasContent ? store.time : 0;
    if (isVideo && Number.isFinite(dims.d)) {
      if (!hasContent) store.project.duration = Math.min(600, Math.max(1, Math.ceil(dims.d * 10) / 10));
      l.outPoint = Math.min(store.project.duration, l.inPoint + dims.d);
    } else l.outPoint = Math.min(store.project.duration, l.inPoint + 3);
    store.addLayer(l);
  }
  if (!desktop.matches) closeSheet();
}

async function relinkMedia(project) {
  const keep = new Set();
  for (const l of flatLayers(project.layers)) {
    if (!l.props.mediaId) continue;
    keep.add(l.props.mediaId);
    const blob = await getMedia(l.props.mediaId);
    if (blob) {
      l.props.src = URL.createObjectURL(blob);
      if (l.type === 'audio') await loadAudio(l.props.src).catch(() => {});
      // vídeos importados antes do som existir no app: detecta e liga o áudio agora
      if (l.type === 'video' && l.props.hasAudio !== false) loadAudio(l.props.src).then(() => { if (!l.props.hasAudio) { l.props.hasAudio = true; if (l.props.volume == null) l.props.volume = 100; } }).catch(() => { l.props.hasAudio = false; });
    } else l.missing = true;
  }
  for (const id of allMediaIds()) keep.add(id); // não apaga mídias de outros projetos
  pruneMedia(keep);
}

// ------------------------------------------------------------------ projeto
async function saveProject() {
  const data = JSON.stringify({ ...store.project, layers: store.project.layers.map((l) => ({ ...l, props: { ...l.props, src: l.props.src?.startsWith('blob:') ? null : l.props.src } })) });
  await saveFile(`projeto-${Date.now()}.motionframe.json`, new Blob([data], { type: 'application/json' }));
  if (store.project.layers.some((l) => l.props.mediaId)) toast('Vídeos e áudios ficam salvos neste aparelho; o .json guarda a edição.', 'warn', 5000);
}

async function openProject() {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format?.startsWith('motionframe-preset') || data.preset || data.presets) { library.importFiles([f]); openSheet('presets'); return; }
    if (!Array.isArray(data.layers) || !data.width) throw new Error('arquivo não é um projeto');
    await relinkMedia(data);
    data.layers = data.layers.filter((l) => !l.missing);
    store.load(data);
    updateTitle();
    layoutCanvas();
    toast('Projeto aberto.', 'ok');
  } catch (e) {
    toast(`Erro ao abrir: ${e.message}`, 'error');
  }
}

async function compSettings() {
  const p = store.project;
  const res = await compDialog({ mode: 'edit', project: p, resolution: qualitySel.value });
  if (!res) return;
  applyResolution(res.resolution);
  const sx = res.width / p.width, sy = res.height / p.height;
  if (sx !== 1 || sy !== 1) {
    // como no AE: a âncora define para onde o conteúdo "cresce"; opcionalmente escala as camadas
    const [ax, ay] = res.anchor;
    const dx = (res.width - p.width) * ax, dy = (res.height - p.height) * ay;
    const k = Math.min(sx, sy);
    for (const l of p.layers) {
      const pos = l.transform.position;
      const mv = (v) => (res.scaleLayers ? [v[0] * sx, v[1] * sy] : [v[0] + dx, v[1] + dy]);
      pos.value = mv(pos.value);
      pos.keys.forEach((kk) => { kk.v = mv(kk.v); });
      if (res.scaleLayers && l.type !== 'solid' && l.type !== 'adjustment') {
        const sc = l.transform.scale;
        sc.value = sc.value.map((v) => v * k);
        sc.keys.forEach((kk) => { kk.v = kk.v.map((v) => v * k); });
      }
      if (l.type === 'solid') { l.props.width = res.width; l.props.height = res.height; }
    }
  }
  const oldDur = p.duration;
  Object.assign(p, { name: res.name, width: res.width, height: res.height, fps: res.fps, duration: res.duration, background: res.background, startTC: res.startTC });
  for (const l of p.layers) {
    if (l.outPoint >= oldDur - 1e-3 && l.type !== 'video' && l.type !== 'audio') l.outPoint = p.duration;
    l.outPoint = Math.min(l.outPoint, p.duration);
  }
  store.setTime(Math.min(store.time, p.duration));
  store.commit('structure');
  updateTitle();
  layoutCanvas();
}

function applyResolution(r) {
  if (r && [...qualitySel.options].some((o) => o.value === r)) { qualitySel.value = r; quality = curQuality(); layoutCanvas(); }
}

async function newComposition() {
  const res = await compDialog({ mode: 'new', project: store.project, hasContent: store.project.layers.length > 0, resolution: qualitySel.value });
  if (!res) return;
  const p = createProject(res.width, res.height);
  Object.assign(p, { name: res.name, fps: res.fps, duration: res.duration, background: res.background, startTC: res.startTC });
  store.load(p);
  applyResolution(res.resolution);
  updateTitle();
  layoutCanvas();
  toast(`Composição “${res.name}” criada: ${res.width}×${res.height}, ${res.fps} fps, ${res.duration.toFixed(2)}s.`, 'ok');
}

/** Com uma pré-comp/grupo aberto, a prévia mostra só o conteúdo dele (como no AE). */
function viewProject() { return store.scope?.length ? { ...store.project, layers: store.layers } : store.project; }

function updateTitle() {
  const g = store.scopeGroups || [];
  document.getElementById('projTitle').textContent = g.length ? `${store.project.name || 'Meu edit'} › ${g.map((x) => x.name).join(' › ')}` : store.project.name || 'Meu edit';
}

async function showAccount() {
  const { formatCode, logout } = await import('./access.js');
  const a = window.__mfAccess || {};
  const r = await modal('Conta e acesso', `
    <p>${a.name ? `Acesso de <b>${escapeHtml(a.name)}</b>` : 'Acesso liberado'} neste aparelho${a.exp ? ` · válido até ${new Date(a.exp * 1000).toLocaleDateString('pt-BR')}` : ' · sem data de validade'}.</p>
    <p class="muted small">Código do aparelho: <code>${a.code ? formatCode(a.code) : '—'}</code></p>
    <p class="muted small">Cada token funciona só neste aparelho. Ao sair, será preciso colar o token de novo.</p>`,
  [{ label: 'Fechar', value: null }, { label: 'Sair deste aparelho', danger: true, value: 'out' }]);
  if (r === 'out') { logout(); location.reload(); }
}

async function showMenu() {
  const res = await modal('Menu', `<div class="menu-list">
    <button data-m="home">⌂ Meus projetos</button>
    <button data-m="account">🔑 Conta e acesso</button>
    <button data-m="help">❓ Como usar (passo a passo)</button>
    <button data-m="new">✚ Nova composição (projeto)</button>
    <button data-m="open">📂 Abrir projeto (.json)</button>
    <button data-m="save">💾 Salvar projeto (.json)</button>
    <button data-m="comp">⚙ Configurações da composição</button>
    <button data-m="ffx">⤒ Importar preset .ffx do After Effects</button>
    <button data-m="aep">Ae Abrir projeto .aep do After Effects</button>
    ${flatLayers(store.project.layers).some((l) => l.props?.aeMedia) ? '<button data-m="relink">🔗 Conectar vídeos/fotos do projeto do AE</button><button data-m="relinksub">🔁 Usar outros vídeos/fotos no lugar dos que faltam</button>' : ''}
    <button data-m="about">ⓘ Sobre os efeitos e plugins</button>
  </div>`, [{ label: 'Fechar', value: null }], {
    onMount: (w, close) => w.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => close(b.dataset.m))),
  });
  if (res === 'help') showHelp();
  if (res === 'home') goHome();
  if (res === 'new') commands.new();
  if (res === 'open') openProject();
  if (res === 'save') saveProject();
  if (res === 'comp') compSettings();
  if (res === 'ffx') commands['import-ffx']();
  if (res === 'aep') openAEPFlow();
  if (res === 'account') showAccount();
  if (res === 'relink') relinkAEMedia();
  if (res === 'relinksub') relinkAEMedia({ substitute: true });
  if (res === 'about') {
    modal('Sobre', `<p>O MotionFrame recria efeitos famosos do After Effects e de plugins populares em edits (Twixtor, Deep Glow, Twitch, Sapphire, BCC, RSMB, Optical Flares…). São <b>recriações próprias</b> com a mesma função e parâmetros parecidos — não são os plugins originais.</p>
      <p>Ao importar um <b>.ffx</b>, o app identifica efeitos nativos do AE e plugins de terceiros e converte para o efeito equivalente, mantendo valores e keyframes sempre que possível.</p>
      <p class="muted small">WebGL: ${getGL() ? 'ativo' : 'indisponível — efeitos desativados'}.</p>`);
  }
}

function showHelp() {
  modal('Como usar', `<ol class="help-steps">
    <li><b>Importe o clipe:</b> toque em <b>🎞 Vídeo / Foto</b>. O vídeo já vem com o som (ajuste em <b>🔊 Som</b>).</li>
    <li><b>Selecione a camada</b> tocando nela na timeline (embaixo) ou na prévia. A faixa acima dos botões diz o que está selecionado.</li>
    <li><b>Presets</b> (★): CC, shakes, reverse, shatter… Ligue <b>⇔ Sincronizar com a duração da camada</b> para o preset ocupar o clipe inteiro.</li>
    <li><b>Efeitos</b> (✦): mais de 75 efeitos do After Effects e de plugins. Em cada efeito, o ◆ cria keyframes. Use <b>⎘ Copiar</b> / <b>📋 Colar</b> para levar efeitos a outra camada e <b>★ Salvar preset</b> para guardar.</li>
    <li><b>Velocidade</b> (⏱, estilo Twixtor) e <b>Time Remap</b> para câmera lenta, congelar e reverse.</li>
    <li><b>Tirar fundo</b> (✂︎) recorta o jogador com IA, no próprio aparelho.</li>
    <li><b>Agrupar</b> (⊞) junta camadas para aplicar efeitos/animações em todas de uma vez.</li>
    <li><b>Timeline:</b> arraste a régua azul para mudar o tempo; arraste a timeline livremente para navegar; pinça para zoom.</li>
    <li><b>Exportar:</b> no fim, toque em <b>Salvar / Compartilhar</b> → Salvar vídeo (Fotos), Arquivos, TikTok…</li>
  </ol>`, [{ label: 'Entendi', value: null, primary: true }]);
}

function addTransformKey() {
  const layer = store.layer();
  if (!layer) { toast('Selecione uma camada.', 'warn'); return; }
  for (const k of ['position', 'scale', 'rotation', 'opacity']) {
    const p = layer.transform[k];
    setKey(p, store.time, valueAt(p, store.time), 'easeInOut');
  }
  store.commit();
  toast('Keyframe em posição, escala, rotação e opacidade.', 'ok', 1800);
}

// ---- grupos (como a pré-composição do AE): várias camadas viram uma só, com transformação e efeitos próprios
async function groupLayers() {
  const p = { layers: store.layers };
  const sel = store.selectedLayerId;
  const chosen = store.selectedLayers();
  // várias camadas já selecionadas na timeline: pré-compõe direto
  if (chosen.length >= 2) {
    const name = await modal('Pré-compor', `<p class="muted small">${chosen.length} camadas selecionadas viram uma pré-composição (grupo): dá para mover, animar e pôr efeitos/presets nela inteira. Toque duas vezes no grupo para abrir.</p>
      <label class="row"><span>Nome</span><input type="text" data-f="name" value="Pré-comp ${p.layers.filter((l) => l.type === 'group').length + 1}"></label>`,
    [{ label: 'Cancelar', value: null }, { label: 'Pré-compor', primary: true, value: (w) => w.querySelector('[data-f="name"]').value.trim() || 'Pré-comp' }]);
    if (name == null) return;
    makeGroup(chosen.map((l) => l.id), name);
    return;
  }
  const candidates = p.layers.filter((l) => l.type !== 'audio');
  if (candidates.length < 2) { toast('Você precisa de pelo menos 2 camadas para agrupar.', 'warn'); return; }
  const ids = await modal('Agrupar camadas', `
    <p class="muted small">Escolha as camadas. Elas viram um <b>grupo</b> (como a pré-composição do After Effects): você move, anima e aplica efeitos/presets no grupo inteiro. Para editar cada camada de novo, use <b>Desagrupar</b>.</p>
    <div class="group-list">${candidates.map((l) => `<label class="group-item"><input type="checkbox" value="${l.id}" ${l.id === sel ? 'checked' : ''}> <span>${escapeHtml(l.name)}</span> <em class="muted small">${l.type}</em></label>`).join('')}</div>
    <label class="row"><span>Nome do grupo</span><input type="text" data-f="name" value="Grupo ${p.layers.filter((l) => l.type === 'group').length + 1}"></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Agrupar', primary: true, value: (w) => ({ ids: [...w.querySelectorAll('.group-item input:checked')].map((i) => i.value), name: w.querySelector('[data-f="name"]').value.trim() }) }]);
  if (!ids) return;
  if (ids.ids.length < 2) { toast('Marque pelo menos 2 camadas.', 'warn'); return; }
  makeGroup(ids.ids, ids.name);
}

function makeGroup(idList, name) {
  const p = { layers: store.layers };
  const ids = { ids: idList, name };
  const kids = p.layers.filter((l) => ids.ids.includes(l.id));
  const at = p.layers.indexOf(kids[0]);
  const g = LAYER_FACTORIES.group(store.project, kids);
  g.name = ids.name || 'Grupo';
  g.inPoint = Math.min(...kids.map((l) => l.inPoint));
  g.outPoint = Math.max(...kids.map((l) => l.outPoint));
  const rest = p.layers.filter((l) => !ids.ids.includes(l.id));
  rest.splice(Math.min(at, rest.length), 0, g);
  store.layers = rest;
  store.multi?.clear();
  store.selectedLayerId = g.id;
  store.commit('structure');
  toast(`${kids.length} camadas agrupadas em “${g.name}”.`, 'ok');
}

function ungroupLayer() {
  const p = store.project;
  const g = store.layer();
  if (!g || g.type !== 'group') return;
  const i = p.layers.indexOf(g);
  const kids = g.props.layers || [];
  p.layers.splice(i, 1, ...kids);
  store.selectedLayerId = kids[0]?.id || null;
  store.commit('structure');
  if (g.effects.length || g.transform.position.keys.length || g.transform.scale.keys.length) toast('Grupo desfeito. Os efeitos/animações que estavam no grupo foram descartados.', 'warn', 5000);
  else toast('Grupo desfeito.', 'ok');
}

function deleteSelection() {
  if (store.selectedKeys.length) {
    deleteKeys(store.project, store.selectedKeys);
    store.selectedKeys = [];
    store.commit();
    return;
  }
  const list = store.selectedLayers();
  for (const layer of list) { forgetLayer(layer.id); store.removeLayer(layer.id); }
  store.multi?.clear();
}

const frame = () => 1 / store.project.fps;
const commands = {
  menu: showMenu,
  new: () => createProjectFlow(),
  undo: () => store.undo(),
  redo: () => store.redo(),
  add: () => openSheet('add'),
  'add-text': () => addLayer('text'),
  'add-adjustment': () => { addLayer('adjustment'); openSheet('browser', 'effects'); },
  'add-media': async () => importMedia(await pickFiles('video/*,image/*')),
  'add-audio': async () => importMedia(await pickFiles('audio/*,.mp3,.wav,.m4a,.aac,.ogg')),
  'import-ffx': async () => {
    const files = await pickFiles('.ffx,.rgx,.cube,.json,application/octet-stream');
    if (files.length) { openSheet('presets'); library.importFiles(files); }
  },
  'browse-fx': () => openSheet('browser'),
  comp: compSettings,
  export: async () => {
    setPlaying(false);
    const fmt = await exportDialog(store);
    if (fmt === 'project') saveProject();
  },
  play: () => setPlaying(!store.playing),
  start: () => { setPlaying(false); store.setTime(0); },
  end: () => { setPlaying(false); store.setTime(store.project.duration); },
  'add-key': addTransformKey,
  'select-all-keys': () => {
    const n = keyTools.selectAllLayer();
    openSheet('keys');
    toast(n ? `${n} keyframes selecionados.` : 'Nenhum keyframe encontrado.', n ? 'ok' : 'warn', 1800);
  },
  'stretch-keys': () => {
    if (store.selectedKeys.length < 2) keyTools.selectAllLayer();
    openSheet('keys');
    if (store.selectedKeys.length < 2) toast('Selecione pelo menos 2 keyframes para esticar.', 'warn');
  },
  marker: () => store.toggleMarker(store.time),
  deselect: () => { store.select(null); closeSheet(); },
  effects: () => openSheet('effects'),
  presets: () => openSheet('presets'),
  props: () => openSheet('props'),
  keys: () => openSheet('keys'),
  speed: () => { ensureSpeedEffect(store.layer()); openSheet('effects'); },
  split: () => { if (!store.layer() || !store.splitLayer(store.selectedLayerId, store.time)) toast('Posicione o playhead dentro da camada para dividir.', 'warn'); },
  dup: () => { const list = store.selectedLayers(); store.multi?.clear(); for (const l of list) store.duplicateLayer(l.id); },
  up: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, -1),
  down: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, 1),
  'toggle-visible': () => { const l = store.layer(); if (l) { l.visible = !l.visible; store.commit(); } },
  del: deleteSelection,
  group: groupLayers,
  ungroup: ungroupLayer,
  home: () => goHome(),
  'open-group': () => { const l = store.layer(); if (l?.type === 'group' && store.openGroup(l.id)) { updateTitle(); toast(`Dentro de “${l.name}”. Toque em ◀ Sair do grupo para voltar.`, 'info', 3000); } },
  'close-group': () => { store.closeGroup(); updateTitle(); },
  topaz: () => openSheet('topaz'),
  'bg-remove': async () => {
    const l = store.layer();
    if (!l || (l.type !== 'video' && l.type !== 'image')) { toast('Selecione um vídeo ou uma foto.', 'warn'); return; }
    if (!l.effects.some((fx) => fx.type === 'bgRemove')) { l.effects.unshift(createEffectInstance('bgRemove', {})); store.commit(); }
    openSheet('effects');
    if (bgStatus(1) !== 'ready') {
      toast('Baixando o modelo de IA (só na 1ª vez)…', 'info', 2500);
      await ensureBgModel(1);
      toast(bgStatus(1) === 'ready' ? 'Fundo removido ✓ Ajuste em Efeitos › Remover fundo.' : 'Não foi possível carregar o removedor de fundo neste aparelho.', bgStatus(1) === 'ready' ? 'ok' : 'error', 4000);
    }
  },
  calibrate: async () => {
    const l = store.layer();
    if (!l) { toast('Selecione a camada que tem o CC (ex.: a camada de ajuste).', 'warn'); return; }
    const ok = await modal('Calibrar CC com print do After Effects', `<p>Escolha um <b>print do mesmo quadro</b> com o CC aplicado no After Effects (ou de um edit com esse CC).</p>
      <p class="muted small">O app compara com o quadro atual da prévia e cria um ajuste “${escapeHtml(CALIB_LABEL)}” no fim da lista de efeitos, acertando pretos, meios-tons, brancos, cor e saturação. Funciona com qualquer CC importado. Quanto mais parecido o quadro, mais exato.</p>`,
      [{ label: 'Cancelar', value: false }, { label: 'Escolher print', primary: true, value: true }]);
    if (!ok) return;
    const [file] = await pickFiles('image/*', false);
    if (!file) return;
    try {
      const was = store.exporting; store.exporting = true;
      await prepare(store.project, store.time, { exact: true });
      const r = await calibrateFromImage(store, l, file, async (c) => renderFrame(c.getContext('2d'), store.project, store.time, c.width / store.project.width, { final: true }));
      store.exporting = was;
      toast(`CC calibrado ✓ (saturação ${Math.round(r.params.saturation)}%). Ajuste fino em Efeitos › ${CALIB_LABEL}.`, 'ok', 4500);
    } catch (e) { console.error(e); toast('Não foi possível ler o print.', 'error'); }
  },
  sound: () => { openSheet('props'); setTimeout(() => document.querySelector('#propsPanel [data-section="sound"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120); },
};
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.modal-wrap')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') { e.preventDefault(); (e.shiftKey ? commands.redo : commands.undo)(); return; }
  if (mod && key === 'y') { e.preventDefault(); commands.redo(); return; }
  if (mod && key === 's') { e.preventDefault(); saveProject(); return; }
  if (mod && key === 'd') { e.preventDefault(); commands.dup(); return; }
  if (mod && key === 'a') { e.preventDefault(); commands['select-all-keys'](); return; }
  if (mod && e.shiftKey && key === 'k') { e.preventDefault(); commands.split(); return; }
  switch (e.key) {
    case ' ': e.preventDefault(); commands.play(); break;
    case 'ArrowLeft': e.preventDefault(); setPlaying(false); store.setTime(store.time - frame() * (e.shiftKey ? 10 : 1)); break;
    case 'ArrowRight': e.preventDefault(); setPlaying(false); store.setTime(store.time + frame() * (e.shiftKey ? 10 : 1)); break;
    case 'Home': commands.start(); break;
    case 'End': commands.end(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
    case 'k': case 'K': addTransformKey(); break;
    case 'm': case 'M': commands.marker(); break;
    case 'Escape': store.setKeySelection([]); break;
    default:
  }
});

const dropOverlay = document.getElementById('dropOverlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; dropOverlay.classList.add('show'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.classList.remove('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('show');
  const files = [...(e.dataTransfer?.files || [])];
  const presets = files.filter((f) => /\.(ffx|rgx|cube|json)$/i.test(f.name));
  const media = files.filter((f) => !/\.(ffx|rgx|cube|json)$/i.test(f.name));
  if (presets.length) { openSheet('presets'); library.importFiles(presets); }
  if (media.length) importMedia(media);
});

// ------------------------------------------------------------------ autosave
let saveTimer = 0;
function projectThumb() {
  try {
    if (!getSettings().autosaveThumb) return undefined;
    const c = document.createElement('canvas');
    const k = 180 / Math.max(view.width, view.height);
    c.width = Math.max(1, Math.round(view.width * k)); c.height = Math.max(1, Math.round(view.height * k));
    c.getContext('2d').drawImage(view, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.6);
    c.width = c.height = 0;
    return url;
  } catch { return undefined; }
}
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (!home.visible) saveProjectData(store.project, projectThumb()); }, 700);
}

function demoProject() {
  const p = createProject(1080, 1920);
  p.duration = 6;
  p.name = 'Meu edit';
  const bg = LAYER_FACTORIES.solid(p); bg.name = 'Fundo'; bg.props.fill = '#120d2a';
  const circle = LAYER_FACTORIES.ellipse(p); circle.props.width = circle.props.height = 560; circle.props.fill = '#7c5cff';
  circle.transform.position.value = [540, 800];
  circle.effects.push(createEffectInstance('deepGlow', { radius: 220, exposure: 1.2 }));
  circle.transform.scale.keys = [{ t: 0, v: [0, 0], ease: 'back' }, { t: 0.8, v: [100, 100], ease: 'linear' }];
  const title = LAYER_FACTORIES.text(p); title.props.text = 'MOTIONFRAME'; title.props.fontFamily = 'Impact, "Arial Black", sans-serif'; title.props.fontSize = 130;
  title.transform.position.value = [540, 1380];
  title.transform.opacity.keys = [{ t: 0.4, v: 0, ease: 'easeOut' }, { t: 1, v: 100, ease: 'linear' }];
  title.transform.position.keys = [{ t: 0.4, v: [540, 1560], ease: 'bezier', outInf: 0.85, inInf: 0.85 }, { t: 1.1, v: [540, 1380], ease: 'linear' }];
  title.effects.push(createEffectInstance('rgbSplit', { amount: { keys: [{ t: 0.4, v: 30, ease: 'easeOut' }, { t: 1.2, v: 2, ease: 'linear' }] } }));
  const sub = LAYER_FACTORIES.text(p); sub.props.text = 'importe .ffx · efeitos de edit'; sub.props.fontSize = 46; sub.props.fontWeight = 400;
  sub.transform.position.value = [540, 1500];
  sub.transform.opacity.keys = [{ t: 0.9, v: 0, ease: 'easeOut' }, { t: 1.5, v: 100, ease: 'linear' }];
  const adj = LAYER_FACTORIES.adjustment(p); adj.name = 'Ajuste · Shake impacto'; adj.inPoint = 1.1; adj.outPoint = 1.8;
  adj.effects.push(createEffectInstance('shake', { frequency: 16, amount: { keys: [{ t: 1.1, v: 60, ease: 'easeOut' }, { t: 1.6, v: 0, ease: 'linear' }] }, rotation: 3, zoom: 5 }));
  adj.effects.push(createEffectInstance('motionBlur', { amount: 150 }));
  p.layers = [adj, sub, title, circle, bg];
  return p;
}

// ------------------------------------------------------------------ projetos e tela inicial (estilo Alight Motion)
async function openProjectById(id) {
  const data = await loadProjectDataAsync(id);
  if (!data) { toast('Projeto não encontrado.', 'error'); home.render(); return; }
  data.id = id;
  await relinkMedia(data);
  const missing = flatLayers(data.layers).filter((l) => l.missing);
  data.layers = data.layers.filter((l) => !l.missing);
  if (missing.length) toast(`${missing.length} mídia(s) não encontrada(s) neste aparelho.`, 'warn');
  store.load(data);
  store.setTime(0);
  home.hide();
  updateTitle(); renderToolbar(); layoutCanvas(); timeline.render();
  if (desktop.matches) openSheet('presets');
}

async function createProjectFlow() {
  const s = getSettings();
  const pre = COMP_PRESETS.find((x) => x.id === s.compPreset) || COMP_PRESETS[0];
  const res = await compDialog({ mode: 'new', project: { name: `Projeto ${listProjects().length + 1}`, width: pre.w, height: pre.h, fps: pre.fps, duration: 10, background: '#000000' }, resolution: s.quality });
  if (!res) return;
  const p = createProject(res.width, res.height);
  Object.assign(p, { id: uid('prj'), name: res.name === 'Comp 1' ? `Projeto ${listProjects().length + 1}` : res.name, fps: res.fps, duration: res.duration, background: res.background, startTC: res.startTC });
  saveProjectData(p, null);
  applyResolution(res.resolution);
  await openProjectById(p.id);
  toast('Projeto criado. Comece importando um vídeo (🎞 Vídeo / Foto).', 'ok', 3500);
}

async function importProjectFile() {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.layers) || !data.width) throw new Error('arquivo não é um projeto do MotionFrame');
    data.id = uid('prj');
    data.name = data.name || f.name.replace(/\.(motionframe\.)?json$/i, '');
    saveProjectData(data, null);
    await openProjectById(data.id);
    toast('Projeto importado. Reimporte vídeos/áudios que não estavam neste aparelho.', 'ok', 4000);
  } catch (e) { toast(`Não foi possível importar: ${e.message}`, 'error'); }
}

/** Arquivos do After Effects: .ffx (preset) e .aep/.aepx (efeitos e keyframes do projeto viram presets). */
async function importAEFiles() {
  const files = await pickFiles('.ffx,.aep,.aepx,.json,application/octet-stream');
  if (!files.length) return;
  const ffx = files.filter((f) => /\.(ffx|json)$/i.test(f.name));
  const aep = files.filter((f) => /\.aepx?$/i.test(f.name));
  if (home.visible) await ensureSomeProject();
  if (ffx.length) { openSheet('presets'); library.importFiles(ffx); }
  for (const f of aep) await openAEPFlow(f);
}

/** Abre um .aep como projeto novo: escolhe a composição, converte camadas/keyframes/efeitos e pede as mídias. */
async function openAEPFlow(file) {
  if (!file) { [file] = await pickFiles('.aep,application/octet-stream', false); if (!file) return; }
  const base = file.name.replace(/\.aepx?$/i, '');
  let parsed;
  try { parsed = parseAEP(await file.arrayBuffer()); } catch (e) { toast(`${file.name}: ${e.message}`, 'error', 5000); return; }
  const comps = mainComps(parsed).filter((c) => c.layers.some((l) => !l.camera));
  if (!comps.length) { toast(`${file.name}: nenhuma composição com camadas.`, 'error'); return; }
  let compId = comps[0].id;
  if (comps.length > 1) {
    const pick = await modal(`Abrir “${escapeHtml(base)}”`, `<p>Escolha a composição (a principal está primeiro):</p><div class="menu-list">${comps.slice(0, 30).map((c) => `<button data-c="${c.id}">🎬 ${escapeHtml(c.name || 'Comp')} <span class="muted small">${c.width}×${c.height} · ${Math.round(c.fps * 100) / 100}fps · ${c.duration.toFixed(1)}s · ${c.layers.filter((l) => !l.camera).length} camadas${c.usedIn.length ? ' · pré-comp' : ''}</span></button>`).join('')}</div>`,
      [{ label: 'Cancelar', value: null }], { onMount: (w, close) => w.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => close(+b.dataset.c))) });
    if (pick == null) return;
    compId = pick;
  }
  const res = aepToProject(parsed, compId, base);
  const p = res.project;
  p.id = uid('prj');
  saveProjectData(p, null);
  await openProjectById(p.id);
  const extra = [...res.notes, ...(res.unsupported.length ? [`Efeitos sem equivalente: ${res.unsupported.slice(0, 8).join(', ')}.`] : [])];
  if (res.media.length) {
    const go = await modal('Conectar vídeos e fotos', `<p>O projeto usa <b>${res.media.length}</b> arquivo(s) que ficam no computador e não vêm dentro do .aep:</p>
      <ul class="small">${res.media.slice(0, 20).map((m) => `<li>${escapeHtml(m)}</li>`).join('')}${res.media.length > 20 ? '<li>…</li>' : ''}</ul>
      <p class="muted small">Escolha esses arquivos no aparelho (pode selecionar vários). Eles entram no lugar certo, com o mesmo tempo, posição, keyframes e efeitos. Dá para fazer depois em ☰ Menu › Conectar vídeos/fotos.</p>
      ${extra.length ? `<p class="muted small">${extra.map(escapeHtml).join('<br>')}</p>` : ''}
      <p class="muted small"><b>Não tem esses arquivos?</b> Toque em “Usar outros vídeos/fotos”: os que você escolher entram no lugar dos que faltam, em ordem, preenchendo o quadro sem distorcer.</p>`,
      [{ label: 'Depois', value: false }, { label: 'Usar outros vídeos/fotos', value: 'sub' }, { label: 'Escolher arquivos', primary: true, value: true }]);
    if (go === 'sub') await relinkAEMedia({ substitute: true });
    else if (go) await relinkAEMedia();
  } else toast(`Projeto “${base}” aberto ✓${extra.length ? ' — ' + extra[0] : ''}`, 'ok', 5000);
}

/** Troca os espaços reservados das mídias do .aep pelos arquivos escolhidos (casando pelo nome do arquivo). */
const AUD_RE = /\.(mp3|wav|aiff?|m4a|aac|ogg|flac)$/i;
async function relinkAEMedia({ substitute = false } = {}) {
  const files = await pickFiles('video/*,image/*,audio/*');
  if (!files.length) return;
  const used = new Set();
  const saved = new Map();
  const norm = (n) => n.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '');
  const byName = new Map();
  for (const f of files) { byName.set(f.name.toLowerCase(), f); if (!byName.has(norm(f.name))) byName.set(norm(f.name), f); }
  let done = 0;
  const holders = flatLayers(store.project.layers).filter((l) => l.props?.aeMedia);
  for (const l of holders) {
    const ae = l.props.aeMedia;
    let f = byName.get(ae.file.toLowerCase()) || byName.get(norm(ae.file)) || (holders.length === 1 && files.length === 1 ? files[0] : null);
    // substituir: os que não casaram pelo nome recebem os outros arquivos escolhidos, em ordem (sem repetir enquanto der)
    let swapped = false;
    if (!f && substitute && ae.kind !== 'audio' && !AUD_RE.test(ae.file)) {
      const pool = files.filter((x) => !x.type.startsWith('audio/'));
      f = pool.find((x) => !used.has(x)) || pool[done % Math.max(1, pool.length)] || null;
      swapped = !!f;
    }
    if (!f) continue;
    used.add(f);
    // uma cópia por arquivo (antes cada camada guardava outra cópia e o navegador ficava sem memória)
    if (!saved.has(f)) { const id = uid('m'); putMedia(id, f); saved.set(f, { mediaId: id, src: URL.createObjectURL(f) }); }
    const { mediaId, src } = saved.get(f);
    const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name);
    const isAudio = f.type.startsWith('audio/');
    l.type = isAudio ? 'audio' : isVideo ? 'video' : 'image';
    l.name = l.name.replace(/^⚠ /, '');
    const keep = { width: ae.width, height: ae.height };
    l.props = isAudio ? { src, mediaId, volume: 100, sourceStart: ae.sourceStart || 0, muted: false }
      : { src, mediaId, width: keep.width, height: keep.height, ...(swapped ? { fit: 'cover', replacedFrom: ae.file } : {}), ...(isVideo ? { sourceStart: swapped ? 0 : ae.sourceStart || 0, speed: ae.speed || 1, volume: 100 } : {}) };
    if (isVideo) {
      detectFps(src).then((fps) => { if (fps) { l.props.sourceFps = fps; store.commit(); } });
      loadAudio(src).then(() => { l.props.hasAudio = true; store.emit('change'); }).catch(() => { l.props.hasAudio = false; });
    }
    if (isAudio) await loadAudio(src).catch(() => {});
    done++;
  }
  store.commit();
  ensureCaches?.(store.project);
  timeline.render(); renderToolbar();
  const left = flatLayers(store.project.layers).filter((l) => l.props?.aeMedia).length;
  toast(`${done} mídia(s) conectada(s) ✓${left ? ` · faltam ${left} (nomes diferentes? escolha de novo)` : ''}`, left ? 'warn' : 'ok', 5000);
}

async function ensureSomeProject() {
  const list = listProjects();
  if (list.length) await openProjectById(list[0].id);
  else { const p = createProject(1080, 1920); Object.assign(p, { id: uid('prj'), name: 'Projeto 1' }); saveProjectData(p, null); await openProjectById(p.id); }
}

async function goHome() {
  setPlaying(false);
  clearTimeout(saveTimer);
  saveProjectData(store.project, projectThumb());
  closeSheet();
  home.show();
}

const home = new HomeScreen({
  open: (id) => openProjectById(id),
  create: () => createProjectFlow(),
  importProject: () => importProjectFile(),
  importAE: () => importAEFiles(),
  presets: async () => { await ensureSomeProject(); openSheet('presets'); },
  settings: async () => {
    const r = await settingsDialog(COMP_PRESETS);
    if (r?.help) showHelp();
    else if (r?.clear) { ensureCaches({ layers: [] }); toast('Cache de quadros limpo.', 'ok'); }
    else if (r) { applyResolution(getSettings().quality); renderToolbar(); }
  },
  exportJSON: (p) => saveFile(`${(p.name || 'projeto').replace(/[^\w-]+/g, '_')}.motionframe.json`, new Blob([JSON.stringify(p)], { type: 'application/json' })),
});

(async () => {
  // migração: o projeto único das versões anteriores vira o 1º projeto da lista
  const old = storage.get(AUTOSAVE_KEY, null);
  if (old && Array.isArray(old.layers) && !listProjects().length) {
    old.id = old.id || uid('prj');
    old.name = old.name || 'Meu edit';
    saveProjectData(old, null);
  }
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ok */ }
  applyResolution(getSettings().quality);
  store.load(createProject(1080, 1920));
  updateTitle(); renderToolbar(); layoutCanvas();
  registerServiceWorker();
  home.show();
})();

// Acesso para automação/testes (Playwright) e depuração no console.
window.motionframe = { store, openSheet, openProjectById, home, goHome };
