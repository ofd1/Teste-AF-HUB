import { Store, LAYER_FACTORIES, RESOLUTIONS, createProject } from './state.js';
import { compDialog } from './comp-dialog.js';
import { renderFrame, hitTest, layerCorners, forgetLayer } from './renderer.js';
import { prepare, pauseAll, setMediaListener, videoThumb, ensureCaches, setCacheListener, cacheStatus, detectFps } from './media.js';
import { loadAudio, playAudio, stopAudio, detectBeats } from './audio.js';
import { valueAt, setValue, setKey } from './anim.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Library } from './library.js';
import { FxBrowser } from './fx-browser.js';
import { KeyTools } from './keytools.js';
import { deleteKeys } from './keyframes.js';
import { createEffectInstance } from './presets.js';
import { exportDialog } from './exporter.js';
import { getEffectDef } from './effects.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { formatTime, uid, deepClone } from './util.js';
import { putMedia, getMedia, pruneMedia } from './idb.js';
import { saveFile, registerServiceWorker } from './platform.js';
import { getGL } from './gl.js';
import { trackPoint, applyTrack } from './tracker.js';

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
// "Auto": nítido (resolução cheia) parado, ½ tocando para manter a fluidez
const curQuality = () => (qualitySel.value === 'auto' ? (store.playing ? 0.5 : 1) : parseFloat(qualitySel.value));
let quality = curQuality();
setMediaListener(() => { dirty = true; });

function layoutCanvas() {
  const { width, height } = store.project;
  view.width = Math.round(width * quality);
  view.height = Math.round(height * quality);
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
qualitySel.addEventListener('change', () => { quality = curQuality(); layoutCanvas(); });

function drawOverlay() {
  const k = overlay.width / store.project.width;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
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
    renderFrame(ctx, store.project, store.time, quality, { hq: !store.playing });
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
setCacheListener(() => {
  const st = cacheStatus();
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
  if (kind === 'structure' || kind === 'change') scheduleCaches();
  if (kind === 'structure' || kind === 'change') autosave();
  if (kind === 'selection' || kind === 'structure') { renderToolbar(); onSelectionChanged(); }
  else if (kind === 'change') renderToolbar();
});

const playBtn = document.querySelector('[data-cmd="play"]');
function setPlaying(p) {
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
    const hit = hitTest(store.project, store.time, x, y);
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
const TITLES = { effects: 'Efeitos', browser: 'Adicionar efeito', props: 'Ajustes da camada', presets: 'Presets', keys: 'Keyframes', add: 'Adicionar camada' };
const desktop = window.matchMedia('(min-width: 1100px)');
let sheetPane = null;
let sheetBackTo = null;

function openSheet(name, backTo = null) {
  if (sheetPane !== name) sheet.querySelector('.sheet-body').scrollTop = 0;
  sheetPane = name;
  sheetBackTo = backTo;
  document.querySelectorAll('.sheet .pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  sheetTitle.textContent = TITLES[name] || '';
  sheet.classList.add('open');
  sheet.classList.toggle('has-back', !!backTo);
  sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() {
  if (desktop.matches) { openSheet(store.layer() ? 'effects' : 'presets'); return; }
  sheetPane = null;
  sheet.classList.remove('open');
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
});
new Inspector(document.getElementById('effectsPanel'), store, 'effects', {
  browse: () => openSheet('browser', 'effects'),
  duplicateEffect: (layer, fx) => {
    const copy = deepClone(fx);
    copy.id = uid('fx');
    layer.effects.splice(layer.effects.indexOf(fx) + 1, 0, copy);
  },
});
new Inspector(document.getElementById('propsPanel'), store, 'props', {
  speed: (layer) => { ensureSpeedEffect(layer); openSheet('effects'); },
  beats: (layer) => addBeatMarkers(layer),
  track: (layer) => startTrack(layer),
});
const library = new Library(document.getElementById('library'), store, {
  onApplied: () => { if (!desktop.matches) closeSheet(); },
});
new FxBrowser(document.getElementById('fxBrowser'), (type) => {
  let layer = store.layer();
  if (!layer) {
    layer = LAYER_FACTORIES.adjustment(store.project);
    layer.name = `Ajuste · ${getEffectDef(type).label}`;
    store.project.layers.unshift(layer);
    store.selectedLayerId = layer.id;
  }
  if (getEffectDef(type).sourceSpeed && layer.type !== 'video') toast('Velocidade (estilo Twixtor) só altera camadas de vídeo.', 'warn', 4000);
  layer.effects.push(createEffectInstance(type));
  store.commit('structure');
  openSheet('effects');
  toast(`${getEffectDef(type).label} adicionado em ${layer.name}`, 'ok', 2000);
});
keyTools = new KeyTools(document.getElementById('keyTools'), store);

// ---- tracker
function drawTrackMarker(pt) {
  const k = overlay.width / store.project.width, dpr = window.devicePixelRatio || 1;
  octx.strokeStyle = '#2d8ceb'; octx.lineWidth = 2 * dpr;
  octx.strokeRect(pt[0] * k - 14 * dpr, pt[1] * k - 14 * dpr, 28 * dpr, 28 * dpr);
  octx.beginPath(); octx.moveTo(pt[0] * k - 22 * dpr, pt[1] * k); octx.lineTo(pt[0] * k + 22 * dpr, pt[1] * k);
  octx.moveTo(pt[0] * k, pt[1] * k - 22 * dpr); octx.lineTo(pt[0] * k, pt[1] * k + 22 * dpr); octx.stroke();
}

async function startTrack(layer) {
  if (layer.type !== 'video') { toast('O tracker funciona em camadas de vídeo.', 'warn'); return; }
  setPlaying(false);
  if (!desktop.matches) closeSheet();
  toast('Toque no ponto que quer seguir. Escolha algo com detalhe (número da camisa, rosto, canto) — áreas lisas ou listradas escorregam.', 'info', 6000);
  const point = await new Promise((res) => { trackPick = res; });
  drawTrackMarker(point);
  const others = store.project.layers.filter((l) => l !== layer && l.type !== 'audio');
  const t0 = Math.max(store.time, layer.inPoint);
  const res = await modal('Rastrear movimento', `
    <p class="muted small">Do playhead (${t0.toFixed(2)}s) até o fim do clipe (${layer.outPoint.toFixed(2)}s).</p>
    <label class="row"><span>Camada que vai seguir</span><select data-f="target">
      <option value="__text">Novo texto</option>
      ${others.map((l) => `<option value="${l.id}">${l.name.replace(/</g, '&lt;')}</option>`).join('')}
    </select></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Rastrear', primary: true, value: (w) => w.querySelector('[data-f="target"]').value }]);
  dirty = true;
  if (!res) return;
  let target = store.project.layers.find((l) => l.id === res);
  if (!target) {
    target = LAYER_FACTORIES.text(store.project);
    target.props.text = 'TEXTO'; target.props.fontSize = 70;
    target.transform.position.value = [point[0], point[1] - 160];
    target.inPoint = t0; target.outPoint = layer.outPoint;
    store.project.layers.unshift(target);
  }
  let cancelled = false;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = '<div class="modal"><header><h2>Rastreando…</h2></header><div class="modal-body"><div class="progress"><div class="bar"></div></div></div><footer><button class="danger">Cancelar</button></footer></div>';
  document.body.appendChild(wrap);
  wrap.querySelector('button').onclick = () => { cancelled = true; };
  try {
    const track = await trackPoint({ layer, project: store.project, t0, t1: layer.outPoint - 1 / store.project.fps, point,
      onProgress: (f) => { wrap.querySelector('.bar').style.width = `${Math.round(f * 100)}%`; }, isCancelled: () => cancelled });
    const n = applyTrack(target, track);
    store.selectedLayerId = target.id;
    store.commit('structure');
    toast(`${n} quadros rastreados → “${target.name}” segue o ponto.`, 'ok', 4000);
  } catch (e) {
    toast(`Falha no tracker: ${e.message}`, 'error');
  } finally {
    wrap.remove();
  }
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
function renderToolbar() {
  const layer = store.layer();
  const items = layer
    ? [
      ['deselect', '✕', 'Fechar'], ['sep'],
      ['effects', '✦', 'Efeitos', true], ['presets', '★', 'Presets'], ['props', '☰', 'Ajustes'], ['keys', '◆', 'Keyframes'],
      ...(layer.type === 'video' ? [['speed', '⏱', 'Velocidade', true]] : []),
      ['split', '✂', 'Dividir'], ['dup', '⧉', 'Duplicar'], ['up', '▲', 'Subir'], ['down', '▼', 'Descer'],
      ['toggle-visible', layer.visible ? '👁' : '◌', layer.visible ? 'Ocultar' : 'Mostrar'], ['del', '🗑', 'Excluir'],
    ]
    : [
      ['add', '＋', 'Camada', true], ['add-media', '🎞', 'Mídia'], ['add-audio', '♪', 'Áudio'], ['add-text', 'T', 'Texto'],
      ['add-adjustment', '◐', 'Ajuste'], ['browse-fx', '✦', 'Efeitos'], ['presets', '★', 'Presets'], ['import-ffx', '⤒', '.ffx'], ['comp', '⚙', 'Projeto'],
    ];
  toolbar.innerHTML = items.map(([cmd, icon, label, hot]) => (cmd === 'sep' ? '<span class="tool sep"></span>' : `<button class="tool ${hot ? 'hot' : ''}" data-cmd="${cmd}"><span class="ti">${icon}</span><span class="tl">${label}</span></button>`)).join('');
  toolbar.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));
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
    if (isVideo) detectFps(src).then((f) => { if (f) { l.props.sourceFps = f; store.commit(); } });
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
  for (const l of project.layers) {
    if (!l.props.mediaId) continue;
    keep.add(l.props.mediaId);
    const blob = await getMedia(l.props.mediaId);
    if (blob) {
      l.props.src = URL.createObjectURL(blob);
      if (l.type === 'audio') await loadAudio(l.props.src).catch(() => {});
    } else l.missing = true;
  }
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

function updateTitle() {
  document.getElementById('projTitle').textContent = store.project.name || 'Meu edit';
}

async function showMenu() {
  const res = await modal('Menu', `<div class="menu-list">
    <button data-m="new">✚ Nova composição (projeto)</button>
    <button data-m="open">📂 Abrir projeto (.json)</button>
    <button data-m="save">💾 Salvar projeto (.json)</button>
    <button data-m="comp">⚙ Configurações da composição</button>
    <button data-m="ffx">⤒ Importar preset .ffx do After Effects</button>
    <button data-m="about">ⓘ Sobre os efeitos e plugins</button>
  </div>`, [{ label: 'Fechar', value: null }], {
    onMount: (w, close) => w.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => close(b.dataset.m))),
  });
  if (res === 'new') commands.new();
  if (res === 'open') openProject();
  if (res === 'save') saveProject();
  if (res === 'comp') compSettings();
  if (res === 'ffx') commands['import-ffx']();
  if (res === 'about') {
    modal('Sobre', `<p>O MotionFrame recria efeitos famosos do After Effects e de plugins populares em edits (Twixtor, Deep Glow, Twitch, Sapphire, BCC, RSMB, Optical Flares…). São <b>recriações próprias</b> com a mesma função e parâmetros parecidos — não são os plugins originais.</p>
      <p>Ao importar um <b>.ffx</b>, o app identifica efeitos nativos do AE e plugins de terceiros e converte para o efeito equivalente, mantendo valores e keyframes sempre que possível.</p>
      <p class="muted small">WebGL: ${getGL() ? 'ativo' : 'indisponível — efeitos desativados'}.</p>`);
  }
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

function deleteSelection() {
  if (store.selectedKeys.length) {
    deleteKeys(store.project, store.selectedKeys);
    store.selectedKeys = [];
    store.commit();
    return;
  }
  const layer = store.layer();
  if (layer) { forgetLayer(layer.id); store.removeLayer(layer.id); }
}

const frame = () => 1 / store.project.fps;
const commands = {
  menu: showMenu,
  new: newComposition,
  undo: () => store.undo(),
  redo: () => store.redo(),
  add: () => openSheet('add'),
  'add-text': () => addLayer('text'),
  'add-adjustment': () => { addLayer('adjustment'); openSheet('browser', 'effects'); },
  'add-media': async () => importMedia(await pickFiles('video/*,image/*')),
  'add-audio': async () => importMedia(await pickFiles('audio/*,.mp3,.wav,.m4a,.aac,.ogg')),
  'import-ffx': async () => {
    const files = await pickFiles('.ffx,.json,application/octet-stream');
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
  dup: () => store.selectedLayerId && store.duplicateLayer(store.selectedLayerId),
  up: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, -1),
  down: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, 1),
  'toggle-visible': () => { const l = store.layer(); if (l) { l.visible = !l.visible; store.commit(); } },
  del: deleteSelection,
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
  const presets = files.filter((f) => /\.(ffx|json)$/i.test(f.name));
  const media = files.filter((f) => !/\.(ffx|json)$/i.test(f.name));
  if (presets.length) { openSheet('presets'); library.importFiles(presets); }
  if (media.length) importMedia(media);
});

// ------------------------------------------------------------------ autosave
let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = { ...store.project, layers: store.project.layers.map((l) => (l.props.mediaId ? { ...l, props: { ...l.props, src: null } } : l)) };
    storage.set(AUTOSAVE_KEY, p);
  }, 700);
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

(async () => {
  const saved = storage.get(AUTOSAVE_KEY, null);
  if (saved && Array.isArray(saved.layers)) {
    await relinkMedia(saved);
    const missing = saved.layers.filter((l) => l.missing);
    saved.layers = saved.layers.filter((l) => !l.missing);
    if (missing.length) toast(`${missing.length} mídia(s) não encontrada(s) neste aparelho.`, 'warn');
    store.load(saved);
  } else {
    store.load(demoProject());
    store.setTime(1.5);
  }
  updateTitle();
  renderToolbar();
  layoutCanvas();
  if (desktop.matches) openSheet('presets');
  registerServiceWorker();
  timeline.render();
})();

// Acesso para automação/testes (Playwright) e depuração no console.
window.motionframe = { store, openSheet };
