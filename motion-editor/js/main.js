import { Store, LAYER_FACTORIES, RESOLUTIONS, createProject, flatLayers } from './state.js';
import { compDialog, COMP_PRESETS } from './comp-dialog.js';
import { HomeScreen, saveBackup, saveProjectData, loadProjectData, loadProjectDataAsync, listProjects, allMediaIds, getSettings, setSettings, settingsDialog } from './projects.js';
import { parseFFX } from './ffx.js';
import { ffxToPreset } from './presets.js';
import { TopazPanel } from './topaz-panel.js';
import { setBgListener, ensureBgModel, bgStatus } from './bgremove.js';
import { setGLLostListener, glLost } from './gl.js';
import { createEffectInstance, setPluginLookup, upgradeLayerEffects } from './presets.js';
import { renderFrame, hitTest, layerCorners, forgetLayer } from './renderer.js';
import { prepare, pauseAll, setMediaListener, videoThumb, ensureCaches, setCacheListener, cacheStatus, cacheVersion, detectFps, mediaReady, framesDrawable } from './media.js';
import { loadAudio, playAudio, stopAudio, detectBeats } from './audio.js';
import { valueAt, setValue, setKey, anim } from './anim.js';
import { setThreeD } from './three-d.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Library } from './library.js';
import { FxBrowser } from './fx-browser.js';
import { ComposerPanel } from './composer.js';
import { findInstalled } from './plugins-installed.js';
import { KeyTools } from './keytools.js';
import { deleteKeys, animProps, setEase } from './keyframes.js';
import { sourceTime, ensureGroupTime } from './timing.js';
import { exportDialog } from './exporter.js';
import { probeMp4, needsProxy, proxySupported, makeProxy } from './proxy.js';
import { keepAwake as keepScreenOn } from './platform.js';
import { getEffectDef } from './effects.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { formatTime, formatSimple, uid, deepClone, escapeHtml } from './util.js';
import { putMedia, getMedia, pruneMedia, flushMedia, pendingMediaCount, ensurePersistentStorage } from './idb.js';
import { saveFile, registerServiceWorker } from './platform.js';
import { getGL } from './gl.js';
import { TrackerPanel } from './tracker-panel.js';
import { calibrateFromImage, CALIB_LABEL } from './calibrate.js';
import { parseAEP, aepToProject, mainComps } from './aep.js';
import { xmlToProject } from './xml-import.js';
import { ico, iconize } from './icons.js';
import { translateDOM, getLang, setLang } from './i18n.js';
import { EFFECTS } from './effects.js';
import { importFonts, loadSavedFonts, isFontFile, userFonts, removeFont, ensureFont, onFontsChange } from './fonts.js';

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
// Prévia leve (como CapCut/Alight Motion): nunca renderiza mais pixels do que a tela mostra, e tocando fica em até 720p.
// A exportação não usa isto (sai sempre na resolução escolhida).
let dispQ = 1;
const playCap = () => Math.min(1, 720 / Math.max(1, Math.min(store.project.width, store.project.height)));
const curQuality = () => (qualitySel.value === 'auto'
  ? (store.playing ? Math.min(PLAY_STEPS[playStep], dispQ, playCap()) : dispQ)
  : Math.min(parseFloat(qualitySel.value), qualitySel.value === '1' ? 1 : dispQ));
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
const DRAFT_MS = IOS_M || /Android|Mobi/i.test(navigator.userAgent) ? 45 : 110;
let glLosses = 0, lastEdit = 0, hqMs = 0, hqTimer = 0, holdSince = 0;
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
  // pixels na tela, com densidade até 2× (telas 3× do iPhone não mostram diferença numa prévia pequena)
  if (r.width > 40) dispQ = Math.max(0.25, Math.min(1, s * Math.min(2, window.devicePixelRatio || 1)));
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
  maxBtn.innerHTML = ico(on ? 'close' : 'max');
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
const playClock = { t0: 0, wall0: 0, last: 0 };
function loop(now) {
  lastFrame = now;
  if (store.playing && !store.exporting) {
    // relógio de verdade (como CapCut): o som nunca espera a imagem; se um quadro pesado atrasa, a prévia pula
    // quadros em vez de ficar lenta e dessincronizar do som
    if (Math.abs(store.time - playClock.last) > 0.02) { playClock.t0 = store.time; playClock.wall0 = now; playAudio(store.project, store.time); } // alguém mudou o tempo (scrub)
    let t = playClock.t0 + (now - playClock.wall0) / 1000;
    if (t >= store.project.duration) { t = 0; playClock.t0 = 0; playClock.wall0 = now; playAudio(store.project, 0); }
    store.time = t; playClock.last = t;
    store.emit('time');
  }
  if ((dirty || store.playing) && !store.exporting) {
    // janela do cache de quadros (Time Slice/Echo em clipe longo) acompanha o cursor
    if (now - lastEnsure > 1000) { lastEnsure = now; ensureCaches(store.project, store.time); }
    prepare(store.project, store.time, { playing: store.playing });
    if (curQuality() !== quality) { quality = curQuality(); layoutCanvas(); }
    const fps = store.project.fps || 30, fi = Math.round(store.time * fps + 1e-6);
    // Resolução adaptativa (como no AE): parado, enquanto você arrasta/mexe num projeto pesado, o quadro sai em
    // rascunho; quando para de mexer, sai o quadro nítido (e vai para o cache).
    // celular/tablet: entra em rascunho mais cedo (o scrub não trava); PC só em projetos pesados
    const interacting = performance.now() - lastEdit < 380;
    const draftK = !store.playing && qualitySel.value === 'auto' && interacting && hqMs > DRAFT_MS ? Math.max(0.3, Math.min(0.8, Math.sqrt((DRAFT_MS * 0.65) / hqMs))) : 1;
    const key = `${fi}|${quality}|${store.playing ? 'p' : 'hq'}`;
    const cached = (store.playing && frameCacheGet(`${fi}|${quality}|hq`)) || frameCacheGet(key);
    const tq = store.playing ? fi / fps : store.time;
    const hold = !cached && !framesDrawable(viewProject(), tq) && performance.now() - (holdSince ||= performance.now()) < 900;
    if (cached) {
      holdSince = 0;
      ctx.drawImage(cached, 0, 0, view.width, view.height);
    } else if (hold) {
      // vídeo ainda buscando/decodificando: segura o último quadro bom (como o AE) — nunca pisca preto
      requestAnimationFrame(() => { dirty = true; });
    } else {
      holdSince = 0;
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
    timecode.textContent = document.body.classList.contains('ui-simple') ? `${formatSimple(store.time)} / ${formatSimple(store.project.duration)}` : formatTime(store.time, store.project.fps).slice(1);
    dirty = false;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// cache de quadros para Velocidade/Twixtor (prévia suave e reverse)
const cachePill = document.createElement('div');
cachePill.className = 'cache-pill';
stage.appendChild(cachePill);
let lastCacheSt = null, lastCacheVer = 0, lastEnsure = 0;
setCacheListener(() => {
  const st = cacheStatus();
  if (cacheVersion() !== lastCacheVer) { lastCacheVer = cacheVersion(); frameCacheClear(); } // cache novo pronto: quadros mudam
  lastCacheSt = st;
  cachePill.textContent = st == null ? '' : `Preparando quadros… ${st}%`;
  cachePill.classList.toggle('show', st != null);
  dirty = true;
});
let cacheTimer = 0;
function scheduleCaches() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => { if (!store.exporting) ensureCaches(store.project, store.time); }, 600);
}

// fontes do Google usadas nos textos: carrega ao abrir o projeto; quando chegam, redesenha
onFontsChange(() => { frameCacheClear(); dirty = true; });
// ícones de linha no lugar dos símbolos/emoji em toda a interface (inclusive painéis e janelas criados depois)
iconize(document.body);
translateDOM(document.body, EFFECTS);
document.documentElement.lang = getLang() === 'en' ? 'en' : 'pt-BR';
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'characterData') { if (m.target.parentElement) translateDOM(m.target.parentElement, EFFECTS); continue; }
    for (const n of m.addedNodes) if (n.nodeType === 1) { iconize(n.matches?.('button') ? n.parentElement : n); translateDOM(n.parentElement || n, EFFECTS); }
      else if (n.nodeType === 3 && n.parentElement) translateDOM(n.parentElement, EFFECTS);
  }
}).observe(document.body, { childList: true, subtree: true, characterData: true });
const stageEmpty = document.getElementById('stageEmpty');
stageEmpty.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));
store.on((kind) => {
  if (kind === 'structure') stageEmpty.hidden = !!store.project.layers.length || !!store.scope?.length;
  if (kind === 'structure') for (const l of flatLayers(store.project.layers)) if (l.type === 'text') ensureFont(l.props.fontFamily);
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
  const mp = document.getElementById('maxPlay'); if (mp) mp.innerHTML = ico(p ? 'pause' : 'play');
  if (p === store.playing) return;
  store.playing = p;
  playBtn.innerHTML = ico(p ? 'pause' : 'play');
  lastFrame = performance.now();
  if (p) { playClock.t0 = playClock.last = store.time; playClock.wall0 = performance.now(); playAudio(store.project, store.time); }
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
const TITLES = { composer: 'Composer · animações prontas', effects: 'Efeitos da camada', browser: 'Adicionar efeito', props: 'Propriedades', presets: 'Presets', keys: 'Keyframes e gráfico', topaz: 'Topaz', add: 'Adicionar camada', tracker: 'Tracker' };
const desktop = window.matchMedia('(min-width: 1100px)');
const appEl = document.querySelector('.app');
let sheetPane = null;
let sheetBackTo = null;

// ---- PC: painéis encaixados no canto (como os do After Effects). Vários abertos ao mesmo tempo, empilhados;
// cada um pode ser minimizado (só o título) ou fechado, e reaberto pela barra de painéis no topo da coluna.
const DOCK_KEY = 'motionframe.dock';
const DOCK_PANES = ['props', 'effects', 'presets', 'composer', 'keys', 'topaz', 'tracker', 'browser', 'add'];
const DOCK_BAR = [['props', '☰', 'Propriedades'], ['effects', '✦', 'Efeitos'], ['presets', '★', 'Presets'], ['composer', '❖', 'Composer'], ['keys', '📈', 'Keyframes'], ['topaz', '✨', 'Topaz'], ['tracker', '⌖', 'Tracker']];
const dock = (() => { const d = storage.get(DOCK_KEY, null); return d && Array.isArray(d.open) ? { open: d.open.filter((x) => DOCK_PANES.includes(x)), min: d.min || [] } : { open: ['effects', 'props', 'presets'], min: ['presets'] }; })();
const saveDock = () => storage.set(DOCK_KEY, { open: dock.open.filter((x) => x !== 'browser' && x !== 'add' && x !== 'tracker'), min: dock.min });
function renderDock() {
  const on = desktop.matches;
  appEl.classList.toggle('dock-mode', on);
  document.querySelectorAll('.sheet .pane').forEach((p) => {
    const n = p.dataset.pane;
    if (!p.querySelector(':scope > .dock-head')) {
      const h = document.createElement('div');
      h.className = 'dock-head';
      h.innerHTML = `<button class="dock-min" title="Minimizar / abrir">${ico('minimize')}</button><span class="dock-title"></span><button class="dock-x" title="Fechar o painel">${ico('close')}</button>`;
      h.querySelector('.dock-min').addEventListener('click', () => toggleDockMin(n));
      h.querySelector('.dock-title').addEventListener('click', () => toggleDockMin(n));
      h.querySelector('.dock-x').addEventListener('click', () => closeDockPane(n));
      p.prepend(h);
    }
    p.querySelector('.dock-title').textContent = TITLES[n] || n;
    p.classList.toggle('dock-open', on && dock.open.includes(n));
    p.classList.toggle('dock-min', on && dock.min.includes(n));
    p.classList.toggle('dock-focus', on && sheetPane === n);
    if (on) p.style.order = String(dock.open.indexOf(n));
  });
  const bar = document.getElementById('dockBar');
  bar.innerHTML = DOCK_BAR.map(([n, i, l]) => `<button data-dock="${n}" class="${dock.open.includes(n) ? 'on' : ''}" title="${dock.open.includes(n) ? 'Fechar' : 'Abrir'} ${l}">${ico(i)} ${l}</button>`).join('');
  bar.querySelectorAll('[data-dock]').forEach((x) => x.addEventListener('click', () => {
    const n = x.dataset.dock;
    if (dock.open.includes(n)) closeDockPane(n); else openSheet(n);
  }));
}
function toggleDockMin(n) {
  dock.min = dock.min.includes(n) ? dock.min.filter((x) => x !== n) : [...dock.min, n];
  saveDock(); renderDock();
}
function closeDockPane(n) {
  dock.open = dock.open.filter((x) => x !== n);
  if (n === 'tracker' && !trackerPanel.el.hidden) trackerPanel.close();
  if (sheetPane === n) sheetPane = dock.open[0] || null;
  saveDock(); renderDock();
}
desktop.addEventListener?.('change', () => { renderDock(); if (desktop.matches) sheet.classList.add('open'); });
renderDock();
if (desktop.matches) sheet.classList.add('open');
// arrastar a borda esquerda da coluna muda a largura dos painéis (fica salvo)
(() => {
  const h = document.createElement('div'); h.className = 'dock-resize'; sheet.appendChild(h);
  const set = (w) => appEl.style.setProperty('--dock-w', `${Math.round(Math.max(300, Math.min(760, w)))}px`);
  const saved = storage.get('motionframe.dockW', 0); if (saved) set(saved);
  h.addEventListener('pointerdown', (e) => {
    h.setPointerCapture(e.pointerId);
    const mv = (ev) => { set(window.innerWidth - ev.clientX); layoutCanvas(); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); storage.set('motionframe.dockW', parseInt(getComputedStyle(appEl).getPropertyValue('--dock-w'), 10) || 400); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
  });
})();

function openSheet(name, backTo = null) {
  if (name === 'composer') setTimeout(() => composer.startPreview(), 0); // o Composer só monta (e anima) quando aberto
  if (desktop.matches) {
    // PC: abre (ou traz de volta) o painel no canto, sem fechar os outros
    if (!dock.open.includes(name)) dock.open.unshift(name);
    dock.min = dock.min.filter((x) => x !== name);
    sheetPane = name;
    sheet.classList.add('open');
    saveDock(); renderDock();
    requestAnimationFrame(() => document.querySelector(`.sheet .pane[data-pane="${name}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return;
  }
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
  if (desktop.matches) { if (sheetPane === 'browser' || sheetPane === 'add') closeDockPane(sheetPane); return; }
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
  if (desktop.matches) return; // PC: os painéis ficam onde você deixou (como no After Effects)
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
  importAex: (files) => { openSheet('browser'); return fxBrowser.importAex(files); }, // .aex vira efeito em Efeitos › Meus plugins
});
// Plugins .aex instalados: a importação de .ffx usa esses plugins, e quem já estava como "Controles importados"
// (no projeto aberto e nos presets da biblioteca) é convertido de novo quando um plugin novo é instalado.
setPluginLookup(findInstalled);
window.addEventListener('aex-plugins-changed', () => {
  let n = 0;
  const walk = (layers) => { for (const l of layers || []) { if (l.effects) n += upgradeLayerEffects(l); walk(l.props?.layers); } };
  walk(store.project?.layers);
  const np = library.upgradePlugins();
  if (n) store.commit('structure');
  if (n || np) toast(`Plugins instalados: ${n ? `${n} efeito(s) do projeto` : ''}${n && np ? ' e ' : ''}${np ? `${np} preset(s) da biblioteca` : ''} agora usam o efeito equivalente.`, 'ok', 6000);
});
const fxBrowser = new FxBrowser(document.getElementById('fxBrowser'), (type, extra = null) => {
  let layer = store.layer();
  if (!layer) {
    layer = LAYER_FACTORIES.adjustment(store.project);
    layer.name = `Ajuste · ${extra?.label || getEffectDef(type).label}`;
    store.layers.unshift(layer);
    store.selectedLayerId = layer.id;
  }
  if ((getEffectDef(type).sourceSpeed || getEffectDef(type).sourceRemap) && !TIMED.has(layer.type)) toast('Velocidade / Time Remap mudam vídeos e pré-comps/grupos (o conteúdo de dentro). Pré-componha esta camada para mudar a velocidade dela.', 'warn', 5000);
  if (layer.type === 'group') ensureGroupTime(layer);
  const inst = createEffectInstance(type, extra?.params || {});
  if (extra?.label) inst.label = extra.label; // plugin .aex instalado: aparece com o nome do plugin
  getEffectDef(type).init?.(inst, layer);
  layer.effects.push(inst);
  store.commit('structure');
  openSheet('effects');
  toast(`${extra?.label || getEffectDef(type).label} adicionado em ${layer.name}`, 'ok', 2000);
});
keyTools = new KeyTools(document.getElementById('keyTools'), store);
new TopazPanel(document.getElementById('topazPanel'), store);
const composer = new ComposerPanel(document.getElementById('composerPanel'), store, { onApplied: () => { if (!desktop.matches) closeSheet(); } });
window.addEventListener('open-composer', () => openSheet('composer'));
window.addEventListener('app-updated', () => toast('Versão nova do MotionFrame instalada. Volte para a tela inicial (⌂) para usar.', 'ok', 8000));
if (dock.open.includes('composer')) setTimeout(() => composer.startPreview(), 300);

// ---- tracker (painel estilo After Effects)
const trackerPanel = new TrackerPanel(store, {
  pick: () => { if (!desktop.matches) closeSheet(); return new Promise((res) => { trackPick = res; });
{ const tc = trackerPanel.close.bind(trackerPanel); trackerPanel.close = () => { tc(); if (dock.open.includes('tracker')) closeDockPane('tracker'); }; } },
  redraw: () => { dirty = true; },
  pause: () => setPlaying(false),
  setTime: (t) => store.setTime(t),
  stabilize: (layer) => { store.selectedLayerId = layer.id; store.emit('selection'); openSheet('topaz'); toast('Stabilize Motion: ajuste em “Estabilização” no painel Topaz.', 'info', 4000); },
});
function openTracker(layer, kind) {
  if (layer.type !== 'video') { toast('O tracker funciona em camadas de vídeo.', 'warn'); return; }
  if (!desktop.matches) closeSheet();
  else { document.getElementById('trackerDock').appendChild(trackerPanel.el); openSheet('tracker'); }
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
  layer.missing = false; // religa camada offline
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

// camadas com tempo próprio: vídeo e pré-comp/grupo (velocidade/Time Remap mudam o conteúdo de dentro, como no AE)
const TIMED = new Set(['video', 'group']);
function ensureSpeedEffect(layer) {
  if (!layer || !TIMED.has(layer.type)) { toast('Selecione um vídeo ou uma pré-comp/grupo.', 'warn'); return; }
  if (layer.type === 'group') ensureGroupTime(layer);
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
  ['camera', '🎥', 'Câmera 3D'], ['null', '✛', 'Null (pai/controle)'],
];
const addMenu = document.getElementById('addMenu');
addMenu.innerHTML = `<div class="add-grid">${ADD_ITEMS.map(([k, i, l]) => `<button data-add="${k}"><span class="ai">${ico(i)}</span>${l}</button>`).join('')}</div>
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
// explicação de cada botão (aparece ao parar o mouse em cima, no PC)
const TIPS = {
  'add-media': 'Importar vídeo ou foto do aparelho (Ctrl+I)', 'add-audio': 'Adicionar música', 'add-text': 'Nova camada de texto (Ctrl+Alt+Shift+T)', add: 'Sólido, formas, ajuste, Null, câmera…',
  presets: 'Presets prontos: CC, shakes, transições… e os .ffx que você importar', 'add-adjustment': 'Camada de ajuste: efeitos nela valem para tudo que está embaixo (Ctrl+Alt+Y)',
  group: 'Pré-compor: junta as camadas selecionadas numa composição (Ctrl+Shift+C)', 'import-ffx': 'Importar preset do After Effects (.ffx), Frameify, Looks…', comp: 'Tamanho, fps e duração da composição (Ctrl+K)',
  effects: 'Efeitos aplicados na camada selecionada', props: 'Posição, escala, rotação, opacidade, cor, texto…', keys: 'Keyframes e editor de gráfico (easing)',
  split: 'Cortar a camada no playhead (Ctrl+Shift+D)', dup: 'Duplicar a camada (Ctrl+D)', 'copy-layer': 'Copiar a camada com efeitos e keyframes (Ctrl+C)', 'paste-layer': 'Colar a camada copiada, também em outro projeto (Ctrl+V)', up: 'Subir a camada (Ctrl+])', down: 'Descer a camada (Ctrl+[)', del: 'Excluir (Delete)',
  'toggle-visible': 'Esconder/mostrar a camada', speed: 'Câmera lenta, rampas de velocidade (Twixtor)', topaz: 'Melhorar qualidade, câmera lenta por IA, estabilizar (Topaz)',
  freeze: 'Congelar o quadro atual', 'time-reverse': 'Tocar a camada ao contrário', 'bg-remove': 'Tirar o fundo (recorte automático)', calibrate: 'Copiar a cor de uma imagem de referência',
  sound: 'Volume e som da camada', ungroup: 'Desfazer a pré-composição', 'open-group': 'Entrar na pré-composição para editar', 'close-group': 'Voltar para a composição principal',
  deselect: 'Tirar a seleção (F2)', sequence: 'Colocar as camadas uma depois da outra',
};
/** Modo da interface: 'simple' (estilo app de celular, padrão) ou 'ae' (After Effects). */
function applyUIMode() {
  document.body.classList.toggle('ui-simple', getSettings().uiMode !== 'ae');
}
let toolbarMore = false; // modo simples: "Mais" mostra as ferramentas avançadas

/** Barra do modo simples: poucas ferramentas com nomes do dia a dia; o resto fica em "Mais". */
function simpleItems(layer, t, many) {
  if (many > 1) return [['deselect', '✕', 'Fechar'], ['sep'], ['presets', '★', 'Preset em todas', true], ['effects', '✦', 'Efeitos'], ['props', '☰', 'Ajustar juntas'], ['group', '⊞', 'Juntar em grupo'], ['dup', '⧉', 'Duplicar'], ['copy-layer', '⎘', 'Copiar'], ['del', '🗑', 'Excluir']];
  if (layer) {
    const main = [
      ...(store.scope?.length ? [['close-group', '◀', 'Sair do grupo', true]] : []),
      ['deselect', '✕', 'Fechar'], ['sep'],
      ...(t === 'group' ? [['open-group', '📂', 'Abrir grupo', true]] : []),
      ['presets', '★', 'Presets', true], ['effects', '✦', 'Efeitos', true],
      ...(t === 'video' || t === 'group' ? [['speed', '⏱', 'Velocidade', true]] : []),
      ['props', '☰', 'Editar'], ['keys', '📈', 'Animar'],
      ...(t === 'video' || t === 'audio' ? [['sound', '🔊', 'Volume']] : []),
      ['split', '✂', 'Dividir'], ['dup', '⧉', 'Duplicar'], ['copy-layer', '⎘', 'Copiar'], ...(layerClipboard.length ? [['paste-layer', '📋', 'Colar']] : []), ['del', '🗑', 'Excluir'],
      ['more', '⋯', 'Mais'],
    ];
    if (!toolbarMore) return main;
    return [
      ['composer', '❖', 'Animações prontas'],
      ...(t === 'video' || t === 'group' ? [['time-reverse', '⇆', 'Reverse'], ['freeze', '❄', 'Congelar quadro'], ['time-remap', '⏱', 'Controle de tempo']] : []),
      ...(t === 'video' ? [['topaz', '✨', 'Melhorar qualidade']] : []),
      ...(t === 'video' || t === 'image' ? [['bg-remove', '✂︎', 'Tirar fundo']] : []),
      ['calibrate', '🎯', 'Igualar cor'],
      t === 'group' ? ['ungroup', '⊟', 'Desfazer grupo'] : ['group', '⊞', 'Juntar em grupo'],
      ['up', '▲', 'Para frente'], ['down', '▼', 'Para trás'],
      ['toggle-visible', layer.visible ? '👁' : '◌', layer.visible ? 'Ocultar' : 'Mostrar']];
  }
  const main = [
    ...(store.scope?.length ? [['close-group', '◀', 'Sair do grupo', true]] : []),
    ['add-media', '🎞', 'Vídeo / Foto', true], ['add-audio', '♪', 'Música'], ['add-text', 'T', 'Texto'], ['presets', '★', 'Presets'], ['add', '＋', 'Mais camadas'],
    ...(layerClipboard.length ? [['paste-layer', '📋', 'Colar camada']] : []),
    ['more', '⋯', 'Mais'],
  ];
  if (!toolbarMore) return main;
  return [ ['composer', '❖', 'Animações prontas'], ['logo-anim', '✦', 'Animar logo'], ['font-id', '🔤', 'Identificar fonte'], ['add-adjustment', '◐', 'Camada de cor'], ['group', '⊞', 'Agrupar'], ['import-ffx', '⤒', 'Importar .ffx'], ['marker', '▾', 'Marcar batida'], ['comp', '⚙', 'Tamanho e FPS']];
}

function renderToolbar() {
  const layer = store.layer();
  const t = layer?.type;
  const many = store.selectedLayers().length;
  applyUIMode();
  const simple = document.body.classList.contains('ui-simple');
  const items = simple ? simpleItems(layer, t, many) : many > 1
    ? [
      ['deselect', '✕', 'Limpar seleção'], ['sep'],
      ['group', '⊞', `Pré-compor (${many})`, true], ['props', '☰', `Ajustar ${many} juntas`, true], ['presets', '★', 'Preset em todas'], ['effects', '✦', 'Efeitos'],
      ['sequence', '⇶', 'Sequenciar'], ['dup', '⧉', 'Duplicar'], ['copy-layer', '⎘', 'Copiar'], ['del', '🗑', `Excluir ${many}`],
    ]
    : layer
    ? [
      ...(store.scope?.length ? [['close-group', '◀', 'Sair do grupo', true]] : []),
      ['deselect', '✕', 'Fechar'], ['sep'],
      ...(t === 'group' ? [['open-group', '📂', 'Abrir grupo', true]] : []),
      ['effects', '✦', 'Efeitos', true], ['presets', '★', 'Presets'], ['composer', '❖', 'Composer'],
      ...(t === 'video' || t === 'group' ? [['speed', '⏱', 'Velocidade', true], ...(t === 'video' ? [['topaz', '✨', 'Topaz', true]] : []), ['freeze', '❄', 'Congelar quadro'], ['time-reverse', '⇆', 'Inverter (reverse)'], ['time-remap', '⏱', 'Time Remap']] : []),
      ...(t === 'video' || t === 'audio' ? [['sound', '🔊', 'Som']] : []),
      ...(t === 'video' || t === 'image' ? [['bg-remove', '✂︎', 'Tirar fundo']] : []),
      ['calibrate', '🎯', 'Calibrar CC'], ['props', '☰', 'Propriedades'], ['keys', '📈', 'Keyframes / gráfico'],
      ['split', '✂', 'Dividir'], ['dup', '⧉', 'Duplicar'], ['copy-layer', '⎘', 'Copiar camada'], ...(layerClipboard.length ? [['paste-layer', '📋', 'Colar camada']] : []),
      t === 'group' ? ['ungroup', '⊟', 'Desagrupar'] : ['group', '⊞', 'Pré-compor'],
      ['up', '▲', 'Subir'], ['down', '▼', 'Descer'],
      ['toggle-visible', layer.visible ? '👁' : '◌', layer.visible ? 'Ocultar' : 'Mostrar'], ['del', '🗑', 'Excluir'],
    ]
    : [
      ...(store.scope?.length ? [['close-group', '◀', 'Sair do grupo', true]] : []),
      ['add-media', '🎞', 'Vídeo / Foto', true], ['add-audio', '♪', 'Música'], ['add-text', 'T', 'Texto'], ['add', '＋', 'Mais camadas'],
      ['presets', '★', 'Presets'], ['composer', '❖', 'Composer'], ['add-adjustment', '◐', 'Ajuste (CC)'], ...(layerClipboard.length ? [['paste-layer', '📋', 'Colar camada']] : []), ['logo-anim', '✦', 'Animar logo'], ['font-id', '🔤', 'Identificar fonte'], ['group', '⊞', 'Agrupar'], ['import-ffx', '⤒', 'Importar .ffx'], ['comp', '⚙', 'Composição'],
    ];
  toolbar.innerHTML = items.map(([cmd, icon, label, hot]) => (cmd === 'sep' ? '<span class="tool sep"></span>' : `<button class="tool ${hot ? 'hot' : ''}" data-cmd="${cmd}" title="${escapeHtml(TIPS[cmd] || label)}"><span class="ti">${ico(icon)}</span><span class="tl">${label}</span></button>`)).join('');
  toolbar.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));
  // faixa de ajuda: diz o que está selecionado e o próximo passo
  hintBar.hidden = !getSettings().showTips;
  if (!store.project.layers.length) hintBar.innerHTML = 'Comece tocando em <b>Vídeo / Foto</b> para importar seu clipe.';
  else if (!layer) hintBar.innerHTML = simple ? 'Toque num clipe para editar. Arraste a linha azul para andar no vídeo.' : 'Toque numa camada (na timeline ou na prévia) para editar. Arraste a régua azul para mudar o tempo.';
  else if (many > 1) hintBar.innerHTML = `<b>${many} camadas selecionadas</b> — mudanças em Propriedades valem para todas · Pré-compor junta em um grupo · Shift/Ctrl+clique (ou toque longo) adiciona/remove`;
  else hintBar.innerHTML = `<b>${escapeHtml(layer.name)}</b> · ${TYPE_LABEL[t] || t}${layer.effects.length ? ` · ${layer.effects.length} efeito(s)` : ''} — ${t === 'video' ? 'use <b>Presets</b> para CC/shake/reverse ou <b>Velocidade</b> para câmera lenta' : t === 'group' ? 'efeitos e presets valem para o grupo inteiro' : 'use <b>Efeitos</b> ou <b>Presets</b>'}`;
}

// ------------------------------------------------------------------ mídia
function addLayer(type) {
  const l = LAYER_FACTORIES[type](store.project);
  l.inPoint = 0;
  l.outPoint = store.project.duration;
  if (type === 'camera') {
    // a câmera só enxerga camadas 3D (como no AE): oferece transformar as camadas visuais em 3D
    const visual = store.layers.filter((x) => !['audio', 'adjustment', 'camera', 'null'].includes(x.type));
    const flat = visual.filter((x) => !x.threeD);
    store.addLayer(l);
    if (flat.length) {
      modal('Câmera 3D', `<p>A câmera só afeta <b>camadas 3D</b>. Transformar as ${flat.length} camada(s) desta composição em 3D agora?</p><p class="muted small">Dá para ligar/desligar depois em cada camada (“Camada 3D”). Use Posição Z para dar profundidade (parallax).</p>`,
        [{ label: 'Agora não', value: false }, { label: 'Tornar 3D', primary: true, value: true }]).then((ok) => {
        if (!ok) return;
        for (const x of flat) setThreeD(x, true, anim);
        store.commit('structure');
      });
    }
    return;
  }
  store.addLayer(l);
}

/**
 * Vídeo pesado (4K / centenas de MB): oferece a cópia otimizada 1080p feita no aparelho — no iPhone o Safari
 * trava com o original (memória). Retorna o arquivo a usar (o proxy ou o original).
 */
async function maybeProxy(f) {
  let info = null;
  try { info = await probeMp4(f); } catch { info = null; }
  const w = info ? (info.video.rotation % 180 ? info.video.height : info.video.width) : 0, h = info ? (info.video.rotation % 180 ? info.video.width : info.video.height) : 0;
  if (!info || !needsProxy(f, w, h)) return f;
  const mb = Math.round(f.size / 1048576), dur = info.video.table.n ? (info.video.table.dts[info.video.table.n - 1] / info.video.timescale) : 0;
  if (!(await proxySupported(info))) {
    toast(`“${f.name}” é pesado (${mb} MB, ${w}×${h}) e este aparelho não consegue otimizar o formato. Se travar, exporte o vídeo em 1080p na galeria antes de importar.`, 'warn', 10000);
    return f;
  }
  const go = await modal('Vídeo pesado', `<p><b>${escapeHtml(f.name)}</b> tem <b>${mb} MB</b> (${w}×${h}, ${Math.round(dur / 60 * 10) / 10} min). Vídeos assim deixam o Safari do iPhone sem memória e o app fecha.</p>
    <p>Criar uma <b>cópia otimizada em 1080p</b> para editar? Fica leve (~${Math.max(1, Math.round(dur * 1.05))} MB), com o mesmo som, e exporta normalmente em 1080p. Leva alguns minutos com o app aberto.</p>`,
  [{ label: 'Usar o original', value: false }, { label: 'Otimizar (recomendado)', primary: true, value: true }]);
  if (!go) return f;
  const ctl = new AbortController();
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal"><header><h2>Otimizando vídeo…</h2></header><div class="modal-body"><div class="progress"><div class="bar"></div></div><p class="muted small prog-text">Preparando…</p><p class="muted small">Deixe o app aberto na tela.</p></div><footer><button class="danger">Cancelar</button></footer></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('button').onclick = () => ctl.abort();
  keepScreenOn(true);
  const t0 = performance.now();
  try {
    const px = await makeProxy(f, { signal: ctl.signal, onProgress: (x) => {
      wrap.querySelector('.bar').style.width = `${Math.round(x * 100)}%`;
      const el = (performance.now() - t0) / 1000, left = x > 0.02 ? el / x - el : 0;
      wrap.querySelector('.prog-text').textContent = `${Math.round(x * 100)}%${left ? ` · faltam ~${left > 90 ? `${Math.round(left / 60)} min` : `${Math.round(left)} s`}` : ''}`;
    } });
    toast(`Cópia otimizada pronta: ${Math.round(px.size / 1048576)} MB (antes ${mb} MB).`, 'ok', 6000);
    return px;
  } catch (e) {
    if (String(e?.message || e) !== 'cancelado') toast(`Não deu para otimizar (${e?.message || e}). Usando o original.`, 'warn', 8000);
    return f;
  } finally { wrap.remove(); keepScreenOn(false); }
}

async function importMedia(files) {
  ensurePersistentStorage();
  for (let f of files) {
    const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name);
    if (isVideo && /\.(mp4|mov|m4v)$/i.test(f.name)) f = await maybeProxy(f);
    const isAudio = f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);
    const isImage = f.type.startsWith('image/');
    if (!isVideo && !isAudio && !isImage) continue;
    const mediaId = uid('m');
    // vídeo grande: confere o espaço antes e avisa se não der para guardar (senão o projeto reabre com "mídia não encontrada")
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota && f.size > (est.quota - (est.usage || 0)) * 0.95) toast(`Pouco espaço para guardar “${f.name}” (${Math.round(f.size / 1048576)} MB) no aparelho. Ele funciona agora, mas pode não reabrir depois — libere espaço ou use um arquivo menor.`, 'warn', 9000);
    } catch { /* sem estimativa */ }
    putMedia(mediaId, f).then((ok) => { if (!ok) toast(`Não deu para guardar “${f.name}” no aparelho (falta de espaço?). O vídeo funciona agora, mas some ao fechar o app.`, 'warn', 9000); });
    const src = URL.createObjectURL(f);
    const name = f.name.replace(/\.[^.]+$/, '');
    const { width, height } = store.project;
    if (isAudio) {
      const l = LAYER_FACTORIES.audio(store.project, src, name);
      l.props.mediaId = mediaId; l.props.fileName = f.name;
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
    l.props.mediaId = mediaId; l.props.fileName = f.name;
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

/** Camadas offline (mídia que sumiu do aparelho): escolha os arquivos originais e o app religa pelo nome. */
async function relinkOfflineMedia() {
  const off = flatLayers(store.project.layers).filter((l) => l.missing);
  if (!off.length) { toast('Nenhuma mídia offline neste projeto.', 'ok'); return; }
  const files = await pickFiles('video/*,image/*,audio/*', true);
  if (!files.length) return;
  const base = (s) => String(s || '').replace(/^⚠\s*/, '').replace(/\.[^.]+$/, '').toLowerCase().trim();
  const left = [...files];
  let n = 0;
  for (const l of off) {
    let i = left.findIndex((f) => base(f.name) === base(l.props.fileName || l.name));
    if (i < 0 && off.length === 1 && left.length === 1) i = 0; // 1 camada e 1 arquivo: liga direto
    if (i < 0) continue;
    const [f] = left.splice(i, 1);
    const id = uid('m'); putMedia(id, f);
    l.props.mediaId = id; l.props.src = URL.createObjectURL(f); l.props.fileName = f.name; l.missing = false; n++;
  }
  store.commit('structure');
  const rest = flatLayers(store.project.layers).filter((l) => l.missing).length;
  toast(`${n} mídia(s) religada(s).${rest ? ` Faltam ${rest}: escolha os arquivos com o mesmo nome da camada, ou use Substituir mídia em cada camada.` : ''}`, n ? 'ok' : 'warn', 7000);
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
      l.missing = false;
    } else l.missing = true; // fica no projeto como "mídia offline" (como no AE): dá para trocar por Substituir mídia
  }
}

/** Apaga só mídias que nenhum projeto usa (chamado ao excluir projeto). Na dúvida, não apaga nada. */
async function cleanUnusedMedia() {
  const ids = await allMediaIds();
  if (ids) pruneMedia(ids);
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

function showApps() {
  const base = new URL('downloads/', location.href).href;
  modal('Baixar o MotionFrame', `
    <p><b>💻 Windows (.exe)</b> — o editor completo num programa. Abre numa janela própria (usa o Edge/Chrome do PC, com aceleração da placa de vídeo) e funciona sem internet.</p>
    <p><a class="btn primary" href="${base}MotionFrame.exe" download>Baixar MotionFrame.exe</a></p>
    <p class="muted small">O Windows pode avisar “aplicativo não reconhecido” (o programa não tem assinatura paga): clique em <i>Mais informações → Executar assim mesmo</i>. Deixe a janela preta aberta enquanto usa; feche-a para sair. O PC tem um código de aparelho próprio: peça um token para ele em 🔑 Conta e acesso.</p>
    <p><b>🤖 Android (.apk)</b></p>
    <p><a class="btn primary" href="${base}MotionFrame.apk" download>Baixar MotionFrame.apk</a></p>
    <p class="muted small">Ao abrir o .apk, o Android pede para permitir “instalar apps desta fonte”. O app instalado também tem código de aparelho próprio.</p>
    <p><b>🍎 iPhone</b> — use pelo Safari: toque em Compartilhar → <i>Adicionar à Tela de Início</i> (vira um app em tela cheia). Um .ipa instalável exige conta de desenvolvedor da Apple (veja “IPA” na ajuda).</p>`,
  [{ label: 'Fechar', value: null }]);
}

async function showMenu() {
  const res = await modal('Menu', `<div class="menu-list">
    <button data-m="ui">🎚 Interface: ${getSettings().uiMode === 'ae' ? 'Avançada (After Effects) → trocar para Simples' : 'Simples → trocar para Avançada (After Effects)'}</button>
    <button data-m="home">⌂ Meus projetos</button>
    <button data-m="account">🔑 Conta e acesso</button>
    <button data-m="apps">⬇ Baixar o app (PC Windows / Android)</button>
    <button data-m="help">❓ Como usar (passo a passo)</button>
    <button data-m="new">✚ Nova composição (projeto)</button>
    <button data-m="open">📂 Abrir projeto (.json)</button>
    <button data-m="save">💾 Salvar projeto (.json)</button>
    <button data-m="comp">⚙ Configurações da composição</button>
    <button data-m="ffx">⤒ Importar preset .ffx do After Effects</button>
    <button data-m="aep">Ae Abrir projeto .aep do After Effects</button>
    <button data-m="xml">⇄ Importar XML (Alight Motion / Premiere / Final Cut / DaVinci)</button>
    <button data-m="lang">🌐 Idioma / Language: ${getLang() === 'en' ? 'English' : 'Português'}</button>
    <button data-m="font">🔤 Importar fontes (.ttf / .otf / .woff)</button>
    <button data-m="keys">⌨ Atalhos de teclado (After Effects)</button>
    ${flatLayers(store.project.layers).some((l) => l.missing) ? '<button data-m="relinkOffline">⚠ Religar mídias offline (escolher os arquivos originais)</button>' : ''}
    ${flatLayers(store.project.layers).some((l) => l.props?.aeMedia) ? '<button data-m="relink">🔗 Conectar vídeos/fotos do projeto do AE</button><button data-m="relinksub">🔁 Usar outros vídeos/fotos no lugar dos que faltam</button>' : ''}
    <button data-m="about">ⓘ Sobre os efeitos e plugins</button>
  </div>`, [{ label: 'Fechar', value: null }], {
    onMount: (w, close) => w.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => close(b.dataset.m))),
  });
  if (res === 'help') showHelp();
  if (res === 'ui') commands['ui-mode']();
  if (res === 'home') goHome();
  if (res === 'new') commands.new();
  if (res === 'open') openProject();
  if (res === 'save') saveProject();
  if (res === 'comp') compSettings();
  if (res === 'ffx') commands['import-ffx']();
  if (res === 'aep') openAEPFlow();
  if (res === 'xml') openXMLFlow();
  if (res === 'lang') setLang(getLang() === 'en' ? 'pt' : 'en');
  if (res === 'font') importFontsFlow();
  if (res === 'keys') showShortcuts();
  if (res === 'account') showAccount();
  if (res === 'apps') showApps();
  if (res === 'relinkOffline') relinkOfflineMedia();
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
  // camada(s) já selecionada(s) na timeline: pré-compõe direto (1 camada também, como no AE)
  if (chosen.length >= 1 && (chosen.length >= 2 || chosen[0].type !== 'audio')) {
    const one = chosen.length === 1, fxN = one ? chosen[0].effects.length : 0;
    const res = await modal('Pré-compor', `<p class="muted small">${one ? `A camada “${escapeHtml(chosen[0].name)}” vira` : `${chosen.length} camadas selecionadas viram`} uma pré-composição: dá para mover, animar e pôr efeitos/presets nela inteira. Toque duas vezes para abrir.</p>
      <label class="row"><span>Nome</span><input type="text" data-f="name" value="${one ? escapeHtml(chosen[0].name) + ' Comp 1' : 'Pré-comp ' + (p.layers.filter((l) => l.type === 'group').length + 1)}"></label>
      ${fxN ? `<label class="row"><span>Efeitos (${fxN})</span><select data-f="fx"><option value="move">Mover para dentro da pré-comp</option><option value="leave">Deixar na pré-comp (por fora)</option></select></label>` : ''}`,
    [{ label: 'Cancelar', value: null }, { label: 'Pré-compor', primary: true, value: (w) => ({ name: w.querySelector('[data-f="name"]').value.trim() || 'Pré-comp', fx: w.querySelector('[data-f="fx"]')?.value || 'move' }) }]);
    if (res == null) return;
    makeGroup(chosen.map((l) => l.id), res.name, res.fx === 'leave');
    return;
  }
  const candidates = p.layers.filter((l) => l.type !== 'audio');
  if (!candidates.length) { toast('Adicione uma camada primeiro.', 'warn'); return; }
  const ids = await modal('Agrupar camadas', `
    <p class="muted small">Escolha as camadas. Elas viram um <b>grupo</b> (como a pré-composição do After Effects): você move, anima e aplica efeitos/presets no grupo inteiro. Para editar cada camada de novo, use <b>Desagrupar</b>.</p>
    <div class="group-list">${candidates.map((l) => `<label class="group-item"><input type="checkbox" value="${l.id}" ${l.id === sel ? 'checked' : ''}> <span>${escapeHtml(l.name)}</span> <em class="muted small">${l.type}</em></label>`).join('')}</div>
    <label class="row"><span>Nome do grupo</span><input type="text" data-f="name" value="Grupo ${p.layers.filter((l) => l.type === 'group').length + 1}"></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Agrupar', primary: true, value: (w) => ({ ids: [...w.querySelectorAll('.group-item input:checked')].map((i) => i.value), name: w.querySelector('[data-f="name"]').value.trim() }) }]);
  if (!ids) return;
  if (!ids.ids.length) { toast('Marque pelo menos 1 camada.', 'warn'); return; }
  makeGroup(ids.ids, ids.name);
}

function makeGroup(idList, name, leaveFx = false) {
  const p = { layers: store.layers };
  const ids = { ids: idList, name };
  const kids = p.layers.filter((l) => ids.ids.includes(l.id));
  const at = p.layers.indexOf(kids[0]);
  const g = LAYER_FACTORIES.group(store.project, kids);
  g.name = ids.name || 'Grupo';
  g.inPoint = Math.min(...kids.map((l) => l.inPoint));
  g.outPoint = Math.max(...kids.map((l) => l.outPoint));
  if (leaveFx && kids.length === 1) { g.effects = kids[0].effects; kids[0].effects = []; }
  const rest = p.layers.filter((l) => !ids.ids.includes(l.id));
  rest.splice(Math.min(at, rest.length), 0, g);
  store.layers = rest;
  store.multi?.clear();
  store.selectedLayerId = g.id;
  store.commit('structure');
  toast(kids.length === 1 ? `Pré-composição “${g.name}” criada.` : `${kids.length} camadas agrupadas em “${g.name}”.`, 'ok');
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
// ------------------------------------------------------------------ assistentes do AE
/** Move a camada no tempo (entrada, saída e keyframes juntos), como arrastar o clipe na timeline. */
function shiftLayer(l, delta) {
  l.inPoint = +(l.inPoint + delta).toFixed(5); l.outPoint = +(l.outPoint + delta).toFixed(5);
  for (const { prop } of animProps(l)) for (const k of prop.keys || []) k.t = +(k.t + delta).toFixed(5);
}
/** Keyframe Assistant › Sequence Layers: coloca as camadas selecionadas uma depois da outra (sobreposição opcional). */
async function sequenceLayers() {
  const sel = store.selectedLayers();
  if (sel.length < 2) { toast('Selecione 2 ou mais camadas (Shift/Ctrl+clique ou toque longo).', 'warn'); return; }
  const v = await modal('Sequenciar camadas', `<p class="muted small">Como o “Sequence Layers” do AE: na ordem da timeline (de cima para baixo), cada camada começa quando a anterior termina.</p>
    <label class="row"><span>Sobreposição (s)</span><input type="number" data-f="ov" value="0" step="0.05" min="0"></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Sequenciar', primary: true, value: (w) => Math.max(0, +w.querySelector('[data-f="ov"]').value || 0) }]);
  if (v == null) return;
  const order = store.layers.filter((l) => sel.includes(l));
  let t = Math.min(...order.map((l) => l.inPoint));
  for (const l of order) { shiftLayer(l, t - l.inPoint); t = l.outPoint - v; }
  store.commit('structure');
  toast(`${order.length} camadas em sequência.`, 'ok');
}
/** Layer › Time › Freeze Frame: congela o quadro do playhead (Time Remap com valor fixo). */
function freezeFrame(l) {
  if (!l || !TIMED.has(l.type)) return;
  if (l.type === 'group') ensureGroupTime(l);
  l.effects = l.effects.filter((fx) => fx.type !== 'timeRemap' && fx.type !== 'twixtor');
  const fx = createEffectInstance('timeRemap');
  fx.params.time = { value: +sourceTime(l, Math.max(l.inPoint, Math.min(store.time, l.outPoint))).toFixed(4), keys: [] };
  l.effects.unshift(fx);
  store.commit('structure');
  toast('Quadro congelado (Time Remap). Para voltar, remova o efeito Time Remap.', 'ok', 3500);
}
/** Layer › Time › Time-Reverse Layer: toca a camada de trás para frente (Time Remap do fim ao começo). */
function timeReverse(l) {
  if (!l || !TIMED.has(l.type)) return;
  if (l.type === 'group') ensureGroupTime(l);
  l.effects = l.effects.filter((fx) => fx.type !== 'timeRemap');
  const fx = createEffectInstance('timeRemap');
  const a = +sourceTime(l, l.inPoint).toFixed(4), b = +sourceTime(l, l.outPoint).toFixed(4);
  fx.params.time = { value: b, keys: [{ t: l.inPoint, v: b, ease: 'linear' }, { t: l.outPoint, v: a, ease: 'linear' }] };
  l.effects.unshift(fx);
  store.commit('structure');
  toast('Camada invertida (reverse).', 'ok');
}

const commands = {
  'open-any': async () => { const files = await pickFiles('.ffx,.aep,.xml,.fcpxml,.json,.rgx,.cube,.aex,.ttf,.otf,.woff,.woff2,video/*,image/*,audio/*'); if (files.length) routeFiles(files); },
  menu: showMenu,
  more: async () => {
    // modo simples: as ferramentas avançadas aparecem numa grade (como o "Mais" dos apps de celular)
    const layer = store.layer();
    toolbarMore = true; const items = simpleItems(layer, layer?.type, store.selectedLayers().length); toolbarMore = false;
    const cmd = await modal('Mais ferramentas', `<div class="more-grid">${items.filter((i) => i[0] !== 'sep').map(([c, icon, label]) => `<button data-mc="${c}"><span class="ti">${ico(icon)}</span><span>${escapeHtml(label)}</span></button>`).join('')}</div>
      <button class="wide" data-mc="ui-mode" style="margin-top:10px">🎚 Usar a interface avançada (After Effects)</button>`, [{ label: 'Fechar', value: null }], {
      onMount: (w, close) => w.querySelectorAll('[data-mc]').forEach((b) => b.addEventListener('click', () => close(b.dataset.mc))),
    });
    if (cmd) commands[cmd]?.();
  },
  'ui-mode': () => { const s0 = getSettings(); setSettings({ ...s0, uiMode: s0.uiMode === 'ae' ? 'simple' : 'ae' }); toolbarMore = false; renderToolbar(); timeline.render(); toast(getSettings().uiMode === 'ae' ? 'Interface avançada (After Effects) ligada.' : 'Interface simples ligada.', 'ok'); },
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
  composer: () => openSheet('composer'),
  'logo-anim': () => animateLogoFlow(),
  'font-id': async () => { const { fontIdDialog } = await import('./fontid-ui.js'); await fontIdDialog(store, { toast }); renderToolbar(); },
  props: () => openSheet('props'),
  keys: () => openSheet('keys'),
  speed: () => { ensureSpeedEffect(store.layer()); openSheet('effects'); },
  split: () => { if (!store.layer() || !store.splitLayer(store.selectedLayerId, store.time)) toast('Posicione o playhead dentro da camada para dividir.', 'warn'); },
  'copy-layer': () => copyLayers(false),
  'paste-layer': () => pasteLayers(),
  dup: () => { const list = store.selectedLayers(); store.multi?.clear(); for (const l of list) store.duplicateLayer(l.id); },
  up: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, -1),
  down: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, 1),
  'toggle-visible': () => { const l = store.layer(); if (l) { l.visible = !l.visible; store.commit(); } },
  del: deleteSelection,
  group: groupLayers,
  sequence: () => sequenceLayers(),
  freeze: () => freezeFrame(store.layer()),
  'time-reverse': () => timeReverse(store.layer()),
  'time-remap': () => { addTimeRemap(); openSheet('effects'); },
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

// ------------------------------------------------------------------ atalhos de teclado (os do After Effects)
export const SHORTCUTS = [
  ['Geral', [['Espaço / 0 (numérico)', 'Tocar / pausar'], ['Ctrl+Z / Ctrl+Shift+Z', 'Desfazer / refazer'], ['Ctrl+S', 'Salvar projeto'], ['Ctrl+N', 'Nova composição'], ['Ctrl+K', 'Configurações da composição'], ['Ctrl+I', 'Importar vídeo/foto'], ['Ctrl+M', 'Exportar (fila de render)'], ['~ (til)', 'Ampliar o preview'], ['?', 'Esta lista de atalhos']]],
  ['Camadas', [['Ctrl+Y', 'Novo sólido'], ['Ctrl+Alt+Y', 'Nova camada de ajuste'], ['Ctrl+Alt+Shift+Y', 'Novo Null'], ['Ctrl+Alt+Shift+T', 'Novo texto'], ['Ctrl+Alt+Shift+C', 'Nova câmera 3D'], ['Ctrl+D', 'Duplicar'], ['Ctrl+Shift+D', 'Dividir camada no playhead'], ['Ctrl+Shift+C', 'Pré-compor (1 ou mais camadas)'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copiar / recortar / colar camadas'], ['Delete', 'Excluir'], ['Ctrl+A', 'Selecionar todas as camadas'], ['Ctrl+Shift+A / F2', 'Tirar a seleção'], ['Ctrl+↑ / Ctrl+↓', 'Selecionar camada de cima / de baixo'], ['Ctrl+] / Ctrl+[', 'Subir / descer a camada'], ['Ctrl+Shift+] / Ctrl+Shift+[', 'Trazer para o topo / mandar para o fundo'], ['Ctrl+L', 'Travar / destravar'], ['Ctrl+Alt+F', 'Ajustar à composição'], ['Ctrl+Alt+R', 'Inverter no tempo (reverse)'], ['Ctrl+Alt+T', 'Ativar Time Remap'], ['Ctrl+Shift+E', 'Remover todos os efeitos']]],
  ['Tempo', [['← / →  ou  Page Up / Page Down', 'Voltar / avançar 1 quadro'], ['Shift + ← / →', '10 quadros'], ['Home / End', 'Início / fim da composição'], ['I / O', 'Ir para a entrada / saída da camada'], ['[ / ]', 'Mover a camada para começar / terminar no playhead'], ['Alt+[ / Alt+]', 'Cortar entrada / saída no playhead'], ['J / K', 'Keyframe anterior / próximo'], ['M ou *', 'Marcador'], ['= / -', 'Zoom da timeline']]],
  ['Propriedades e keyframes', [['P / S / R / T / A', 'Mostrar Posição / Escala / Rotação / Opacidade / Ancoragem'], ['U', 'Keyframes da camada'], ['E', 'Efeitos da camada'], ['Alt+Shift+P / S / R / T / A', 'Keyframe em Posição / Escala / Rotação / Opacidade / Ancoragem'], ['Shift+K', 'Keyframe em todas as transformações'], ['F9', 'Easy Ease nos keyframes selecionados'], ['Shift+F9 / Ctrl+Shift+F9', 'Easy Ease In / Out'], ['Ctrl+Alt+A', 'Selecionar todos os keyframes'], ['Esc', 'Tirar seleção de keyframes']]],
];
export function showShortcuts() {
  modal('Atalhos de teclado (After Effects)', SHORTCUTS.map(([g, list]) => `<h3 style="margin:12px 0 6px;font-size:14px">${g}</h3><table class="sc-table">${list.map(([k, d]) => `<tr><td><kbd>${escapeHtml(k)}</kbd></td><td>${escapeHtml(d)}</td></tr>`).join('')}</table>`).join(''), [{ label: 'Fechar', value: null }], { wide: true });
}

// área de transferência de camadas: fica guardada no aparelho (dá para colar em outro projeto)
let layerClipboard = (() => { try { return JSON.parse(localStorage.getItem('motionframe.layerClipboard') || '[]'); } catch { return []; } })();
const saveLayerClipboard = () => { try { localStorage.setItem('motionframe.layerClipboard', JSON.stringify(layerClipboard)); } catch { /* sem espaço: fica só na memória */ } };
const PROP_KEYS = { p: 'position', s: 'scale', r: 'rotation', t: 'opacity', a: 'anchor' };
function revealProp(k) {
  if (!store.layer()) return;
  openSheet('props');
  setTimeout(() => {
    const row = document.querySelector(`#propsPanel .prop-row[data-path="transform.${k}"]`);
    if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); }
  }, 120);
}
function keyOne(k) {
  const l = store.layer();
  if (!l || !l.transform[k]) return;
  setKey(l.transform[k], store.time, valueAt(l.transform[k], store.time), 'easeInOut');
  store.commit();
  toast(`Keyframe: ${({ position: 'Posição', scale: 'Escala', rotation: 'Rotação', opacity: 'Opacidade', anchor: 'Ancoragem' })[k]}`, 'ok', 1200);
}
function jumpKey(dir) {
  const l = store.layer();
  const times = [...new Set((l ? [l] : store.layers).flatMap((x) => animProps(x).flatMap(({ prop }) => (prop.keys || []).map((k) => k.t))))].sort((a, b) => a - b);
  const t = store.time, eps = 1e-4;
  const nt = dir > 0 ? times.find((x) => x > t + eps) : [...times].reverse().find((x) => x < t - eps);
  if (nt != null) { setPlaying(false); store.setTime(nt); }
}
function selectNeighbor(dir) {
  const ls = store.layers;
  if (!ls.length) return;
  const i = ls.findIndex((l) => l.id === store.selectedLayerId);
  const j = i < 0 ? 0 : Math.max(0, Math.min(ls.length - 1, i + dir));
  store.select(ls[j].id);
}
function moveToEdge(top) {
  const l = store.layer();
  if (!l) return;
  const i = store.layers.indexOf(l);
  store.layers.splice(i, 1);
  if (top) store.layers.unshift(l); else store.layers.push(l);
  store.commit('structure');
}
function trimLayer(side) {
  const l = store.layer(), t = store.time, fps = store.project.fps || 30;
  if (!l || t <= l.inPoint - 1e-6 && side === 'out' || t >= l.outPoint && side === 'in') return;
  if (side === 'in') {
    const ni = Math.max(0, Math.min(l.outPoint - 1 / fps, t));
    if (l.type === 'group') ensureGroupTime(l);
    if (l.type === 'video' || l.type === 'audio' || l.type === 'group') { const rate = l.type === 'audio' ? 1 : (l.props.speed ?? 1); l.props.sourceStart = Math.max(0, (l.props.sourceStart || 0) + (ni - l.inPoint) * rate); }
    l.inPoint = ni;
  } else l.outPoint = Math.max(l.inPoint + 1 / fps, Math.min(store.project.duration, t));
  store.commit('structure');
}
function alignLayer(edge) {
  const l = store.layer();
  if (!l) return;
  shiftLayer(l, edge === 'in' ? store.time - l.inPoint : store.time - l.outPoint);
  store.commit('structure');
}
function addTimeRemap() {
  const l = store.layer();
  if (!l || !TIMED.has(l.type)) { toast('Time Remap funciona em vídeos e pré-comps/grupos.', 'warn'); return; }
  if (l.type === 'group') ensureGroupTime(l);
  if (l.effects.some((f) => f.type === 'timeRemap')) { openSheet('effects'); return; }
  const fx = createEffectInstance('timeRemap');
  getEffectDef('timeRemap').init?.(fx, l);
  l.effects.unshift(fx);
  store.commit('structure');
  toast('Time Remap ativado (anime “Tempo do vídeo”).', 'ok');
}
function fitToComp() {
  const l = store.layer();
  if (!l) return;
  const { width: W, height: H } = store.project;
  const w = l.props?.width || W, h = l.props?.height || H, k = Math.max(W / w, H / h) * 100;
  setValue(l.transform.position, store.time, [W / 2, H / 2]); setValue(l.transform.scale, store.time, [k, k]); setValue(l.transform.rotation, store.time, 0);
  store.commit();
}
function copyLayers(cut) {
  const list = store.selectedLayers();
  if (!list.length) return;
  layerClipboard = list.map((l) => deepClone(l));
  saveLayerClipboard();
  if (cut) deleteSelection();
  renderToolbar();
  toast(`${list.length} camada(s) ${cut ? 'recortada(s)' : 'copiada(s)'}.`, 'ok', 1200);
}
function pasteLayers() {
  if (!layerClipboard.length) return;
  const fresh = (l) => { const c = deepClone(l); c.id = uid('ly'); if (c.props?.layers) c.props.layers = c.props.layers.map(fresh); for (const fx of c.effects || []) fx.id = uid('fx'); return c; };
  const copies = layerClipboard.map(fresh);
  const i = Math.max(0, store.layers.findIndex((l) => l.id === store.selectedLayerId));
  store.layers.splice(i, 0, ...copies);
  store.multi?.clear();
  store.selectedLayerId = copies[0].id;
  store.commit('structure');
  toast(`${copies.length} camada(s) colada(s).`, 'ok', 1200);
}

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable || document.querySelector('.modal-wrap')) return;
  const mod = e.ctrlKey || e.metaKey, alt = e.altKey, sh = e.shiftKey;
  const key = e.key.toLowerCase(), code = e.code;
  const go = (fn) => { e.preventDefault(); fn(); };
  if (mod) {
    // camadas novas (Ctrl+Alt+Shift…) primeiro
    if (alt && sh && code === 'KeyY') return go(() => addLayer('null'));
    if (alt && sh && code === 'KeyT') return go(() => commands['add-text']());
    if (alt && sh && code === 'KeyC') return go(() => addLayer('camera'));
    if (alt && code === 'KeyY') return go(() => commands['add-adjustment']());
    if (alt && code === 'KeyA') return go(() => commands['select-all-keys']());
    if (alt && code === 'KeyR') return go(() => timeReverse(store.layer()));
    if (alt && code === 'KeyT') return go(addTimeRemap);
    if (alt && code === 'KeyF') return go(fitToComp);
    if (code === 'KeyZ') return go(() => (sh ? commands.redo : commands.undo)());
    if (code === 'KeyY') return go(() => addLayer('solid'));
    if (code === 'KeyS') return go(() => saveProject());
    if (code === 'KeyN') return go(() => commands.new());
    if (code === 'KeyK') return go(() => commands.comp());
    if (code === 'KeyI') return go(() => commands['add-media']());
    if (code === 'KeyM') return go(() => commands.export());
    if (code === 'KeyD') return go(() => (sh ? commands.split() : commands.dup()));
    if (code === 'KeyK' && sh) return go(() => commands.split());
    if (code === 'KeyC') return go(() => (sh ? groupLayers() : copyLayers(false)));
    if (code === 'KeyX') return go(() => copyLayers(true));
    if (code === 'KeyV') return go(pasteLayers);
    if (code === 'KeyA') return go(() => (sh ? store.select(null) : (store.layers.forEach((l, i) => store.select(l.id, i > 0)))));
    if (code === 'KeyE' && sh) return go(() => { const l = store.layer(); if (l) { l.effects = []; store.commit('structure'); } });
    if (code === 'KeyL') return go(() => { const l = store.layer(); if (l) { l.locked = !l.locked; store.commit('structure'); toast(l.locked ? 'Camada travada.' : 'Camada destravada.', 'ok', 1000); } });
    if (code === 'BracketRight') return go(() => (sh ? moveToEdge(true) : commands.up()));
    if (code === 'BracketLeft') return go(() => (sh ? moveToEdge(false) : commands.down()));
    if (code === 'ArrowUp') return go(() => selectNeighbor(-1));
    if (code === 'ArrowDown') return go(() => selectNeighbor(1));
    if (code === 'ArrowLeft') return go(() => { setPlaying(false); store.setTime(store.time - frame()); });
    if (code === 'ArrowRight') return go(() => { setPlaying(false); store.setTime(store.time + frame()); });
    if (code === 'F9' && sh) return go(() => { setEase(store.selectedKeys, 'easeOut'); store.commit(); });
    return;
  }
  if (alt && sh && PROP_KEYS[key]) return go(() => keyOne(PROP_KEYS[key]));
  if (alt && code === 'BracketLeft') return go(() => trimLayer('in'));
  if (alt && code === 'BracketRight') return go(() => trimLayer('out'));
  if (alt) return;
  switch (code) {
    case 'Space': case 'Numpad0': return go(() => commands.play());
    case 'ArrowLeft': case 'PageUp': return go(() => { setPlaying(false); store.setTime(store.time - frame() * (sh ? 10 : 1)); });
    case 'ArrowRight': case 'PageDown': return go(() => { setPlaying(false); store.setTime(store.time + frame() * (sh ? 10 : 1)); });
    case 'Home': return go(() => commands.start());
    case 'End': return go(() => commands.end());
    case 'Delete': case 'Backspace': return go(deleteSelection);
    case 'BracketLeft': return go(() => alignLayer('in'));
    case 'BracketRight': return go(() => alignLayer('out'));
    case 'Equal': case 'NumpadAdd': return go(() => timeline.setZoom(timeline.pps * 1.5));
    case 'Minus': case 'NumpadSubtract': return go(() => timeline.setZoom(timeline.pps / 1.5));
    case 'NumpadMultiply': return go(() => commands.marker());
    case 'F2': return go(() => store.select(null));
    case 'F9': return go(() => { setEase(store.selectedKeys, 'easeInOut'); store.commit(); });
    case 'Backquote': return go(() => setMaxPreview(!document.body.classList.contains('preview-max')));
    case 'Escape': store.setKeySelection([]); return;
    default:
  }
  if (e.key === '?') return go(showShortcuts);
  if (e.key === '*') return go(() => commands.marker());
  switch (key) {
    case 'i': { const l = store.layer(); if (l) go(() => store.setTime(l.inPoint)); return; }
    case 'o': { const l = store.layer(); if (l) go(() => store.setTime(Math.max(l.inPoint, l.outPoint - frame()))); return; }
    case 'j': return go(() => jumpKey(-1));
    case 'k': return go(() => (sh ? addTransformKey() : jumpKey(1)));
    case 'm': return go(() => commands.marker());
    case 'u': return go(() => commands.keys());
    case 'e': return go(() => openSheet('effects'));
    case 'p': case 's': case 'r': case 't': case 'a': return go(() => revealProp(PROP_KEYS[key]));
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
  routeFiles([...(e.dataTransfer?.files || [])]);
});
/** Abre qualquer arquivo no lugar certo (preset, projeto do AE, XML, fonte ou mídia). */
function routeFiles(files) {
  const fonts = files.filter((f) => isFontFile(f.name));
  const xml = files.filter((f) => /\.(xml|fcpxml)$/i.test(f.name));
  const aep = files.filter((f) => /\.aep$/i.test(f.name));
  const aex = files.filter((f) => /\.aex$/i.test(f.name));
  const presets = files.filter((f) => /\.(ffx|frameify|rgx|cube|json)$/i.test(f.name));
  const media = files.filter((f) => !/\.(ffx|frameify|rgx|cube|json|aex|xml|fcpxml|aep|ttf|otf|woff2?)$/i.test(f.name));
  if (fonts.length) importFontsFlow(fonts);
  if (xml.length) openXMLFlow(xml[0]);
  if (aep.length) openAEPFlow(aep[0]);
  if (aex.length) { openSheet('browser'); fxBrowser.importAex(aex); }
  if (presets.length) { openSheet('presets'); library.importFiles(presets); }
  if (media.length) importMedia(media);
}

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
  if (pendingMediaCount()) await flushMedia(); // mídia importada há pouco ainda gravando
  const data = await loadProjectDataAsync(id);
  if (!data) { toast('Não consegui ler este projeto agora. Ele não foi apagado: tente abrir de novo.', 'error', 6000); home.render(); return; }
  data.id = id;
  await saveBackup(data, true); // versão de segurança de como o projeto estava ao abrir
  await relinkMedia(data);
  const missing = flatLayers(data.layers).filter((l) => l.missing);
  if (missing.length) toast(`${missing.length} mídia(s) não encontrada(s) neste aparelho: as camadas continuam no projeto (marcadas como offline). Toque na camada › Substituir mídia para religar.`, 'warn', 8000);
  store.load(data);
  store.setTime(0);
  home.hide();
  updateTitle(); renderToolbar(); layoutCanvas(); timeline.render();
  if (desktop.matches) { sheet.classList.add('open'); renderDock(); }
}

/** Animar logo: escolhe a imagem, separa em peças e abre um projeto novo com a animação montada. */
async function animateLogoFlow() {
  const [f] = await pickFiles('image/*', false);
  if (!f) return;
  try {
    const { splitLogo, buildLogoAnimation } = await import('./logoanim.js');
    const img = await createImageBitmap(f);
    const sp = splitLogo(img);
    if (!sp.pieces.length) throw new Error('não achei a logo na imagem (fundo e logo da mesma cor?)');
    const P = await buildLogoAnimation(sp, { name: `${f.name.replace(/\.[^.]+$/, '')} · logo animada` });
    saveProjectData(P, null);
    await openProjectById(P.id);
    toast(`Logo separada em ${sp.pieces.length} peças (${sp.lines} linha(s)). Toque ▶ — cada peça é uma camada editável.`, 'ok', 6000);
  } catch (e) { toast(`Não deu para animar a logo: ${e.message}`, 'error', 6000); }
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

async function openXMLFlow(file) {
  if (!file) { [file] = await pickFiles('.xml,.fcpxml,.fcpxmld,text/xml,application/xml', false); if (!file) return; }
  const base = file.name.replace(/\.(fcp)?xml$/i, '');
  let res;
  try { res = xmlToProject(await file.text(), base); } catch (e) { toast(`${file.name}: ${e.message}`, 'error', 5000); return; }
  if (!res.project.layers.length) { toast(`${file.name}: a sequência não tem clipes.`, 'warn'); return; }
  const p = res.project;
  p.id = uid('prj');
  saveProjectData(p, null);
  await openProjectById(p.id);
  const go = await modal('Conectar os clipes do XML', `<p>A sequência “${escapeHtml(p.name || base)}” foi montada: <b>${p.layers.length}</b> clipe(s), ${p.width}×${p.height}, ${p.fps}fps, ${p.duration.toFixed(1)}s.</p>
    <p>Ela usa <b>${res.media.length}</b> arquivo(s):</p><ul class="small">${res.media.slice(0, 20).map((m) => `<li>${escapeHtml(m)}</li>`).join('')}${res.media.length > 20 ? '<li>…</li>' : ''}</ul>
    <p class="muted small">Escolha esses arquivos (pode marcar vários): cada um entra no clipe certo pelo nome, com o mesmo corte, tempo e velocidade.${res.notes.length ? '<br>' + res.notes.map(escapeHtml).join('<br>') : ''}</p>`,
  [{ label: 'Depois', value: false }, { label: 'Usar outros vídeos/fotos', value: 'sub' }, { label: 'Escolher arquivos', primary: true, value: true }]);
  if (go === 'sub') await relinkAEMedia({ substitute: true });
  else if (go) await relinkAEMedia();
}

async function importFontsFlow(files) {
  if (!files) files = await pickFiles('.ttf,.otf,.woff,.woff2,font/*', true);
  if (!files?.length) {
    const list = userFonts();
    if (!list.length) return;
    const rm = await modal('Fontes importadas', `<div class="menu-list">${list.map((f) => `<button data-f="${escapeHtml(f.family)}"><span style="font-family:'${escapeHtml(f.family)}'">${escapeHtml(f.family)}</span> <span class="muted small">tocar para remover</span></button>`).join('')}</div>`,
      [{ label: 'Fechar', value: null }], { onMount: (w, close) => w.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => close(b.dataset.f))) });
    if (rm) { await removeFont(rm); toast(`Fonte “${rm}” removida.`, 'ok'); }
    return;
  }
  const { ok, bad } = await importFonts(files);
  if (ok.length) {
    const l = store.layer();
    if (l?.type === 'text' && ok.length === 1) { l.props.fontFamily = `"${ok[0]}", sans-serif`; store.commit(); }
    toast(`Fonte(s) importada(s): ${ok.join(', ')} — escolha em Texto › Fonte.`, 'ok', 4500);
  }
  if (bad.length) toast(`Não deu para ler: ${bad.join(', ')}`, 'warn', 4500);
  store.emit('change');
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
      : { src, mediaId, width: keep.width, height: keep.height, ...(swapped ? { fit: 'cover', replacedFrom: ae.file } : ae.fit ? { fit: ae.fit } : {}), ...(isVideo ? { sourceStart: swapped ? 0 : ae.sourceStart || 0, speed: ae.speed || 1, volume: 100 } : {}) };
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
  if (pendingMediaCount()) { toast('Salvando os vídeos no aparelho…', 'info', 3000); await flushMedia(); }
  saveProjectData(store.project, projectThumb());
  closeSheet();
  home.show();
}

const home = new HomeScreen({
  open: (id) => openProjectById(id),
  afterDelete: () => cleanUnusedMedia(),
  create: () => createProjectFlow(),
  importProject: () => importProjectFile(),
  logoAnim: () => animateLogoFlow(),
  demoLogo: async () => {
    // projeto de exemplo de motion design: logo feita com o pacote MoGraph (formas com Trim Paths, texto cinético, logo reveal)
    const { buildLogoDemoProject } = await import('./mograph.js');
    const p = buildLogoDemoProject();
    saveProjectData(p, null);
    await openProjectById(p.id);
    toast('Projeto de demonstração aberto: toque ▶ para ver a logo animada. Tudo é editável (camadas de forma, texto e efeitos).', 'ok', 5000);
  },
  importAE: () => importAEFiles(),
  presets: async () => { await ensureSomeProject(); openSheet('presets'); },
  plugins: async () => { await ensureSomeProject(); openSheet('browser'); fxBrowser.cat = 'Meus plugins'; fxBrowser.render(); },
  settings: async () => {
    const r = await settingsDialog(COMP_PRESETS);
    home.render(); // (projeto recuperado aparece na lista)
    if (r?.help) showHelp();
    else if (r?.clear) { ensureCaches({ layers: [] }); toast('Cache de quadros limpo.', 'ok'); }
    else if (r) { applyResolution(getSettings().quality); renderToolbar(); timeline.render(); }
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
  applyUIMode();
  store.load(createProject(1080, 1920));
  updateTitle(); renderToolbar(); layoutCanvas();
  registerServiceWorker();
  loadSavedFonts().then(() => { frameCacheClear(); store.emit('change'); }).catch(() => {});
  home.show();
})();

// Acesso para automação/testes (Playwright) e depuração no console.
window.motionframe = { store, openSheet, openProjectById, home, goHome };
