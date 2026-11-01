import { Store, LAYER_FACTORIES, RESOLUTIONS, createProject, resolveProp } from './state.js';
import { renderFrame, syncVideos, hitTest, layerCorners, getMedia } from './renderer.js';
import { valueAt, setValue, removeKeyAt } from './anim.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Library } from './library.js';
import { exportDialog } from './exporter.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { formatTime, download } from './util.js';

const store = new Store();
const AUTOSAVE_KEY = 'motionframe.autosave.v1';

// ------------------------------------------------------------------ preview
const view = document.getElementById('view');
const overlay = document.getElementById('overlay');
const stage = document.getElementById('stage');
const wrap = document.getElementById('canvasWrap');
const qualitySel = document.getElementById('quality');
const timecode = document.getElementById('timecode');
const loopBox = document.getElementById('loop');
const ctx = view.getContext('2d');
const octx = overlay.getContext('2d');
let dirty = true;
let quality = parseFloat(qualitySel.value);

function layoutCanvas() {
  const { width, height } = store.project;
  view.width = Math.round(width * quality);
  view.height = Math.round(height * quality);
  const r = stage.getBoundingClientRect();
  const s = Math.min((r.width - 24) / width, (r.height - 24) / height);
  const cssW = Math.max(40, width * s), cssH = Math.max(40, height * s);
  wrap.style.width = `${cssW}px`;
  wrap.style.height = `${cssH}px`;
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(cssW * dpr);
  overlay.height = Math.round(cssH * dpr);
  dirty = true;
}
new ResizeObserver(layoutCanvas).observe(stage);
qualitySel.addEventListener('change', () => { quality = parseFloat(qualitySel.value); layoutCanvas(); });

function drawOverlay() {
  const { width } = store.project;
  const k = overlay.width / width;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const layer = store.layer();
  if (!layer || store.playing || !layer.visible || store.time < layer.inPoint || store.time >= layer.outPoint) return;
  const pts = layerCorners(layer, store.time);
  octx.strokeStyle = '#7c5cff';
  octx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  octx.setLineDash([6, 4]);
  octx.beginPath();
  pts.forEach(([x, y], i) => (i ? octx.lineTo(x * k, y * k) : octx.moveTo(x * k, y * k)));
  octx.closePath();
  octx.stroke();
  octx.setLineDash([]);
  const p = valueAt(layer.transform.position, store.time);
  octx.fillStyle = '#7c5cff';
  octx.beginPath();
  octx.arc(p[0] * k, p[1] * k, 4 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
  octx.fill();
}

let lastFrame = performance.now();
function loop(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (store.playing && !store.exporting) {
    let t = store.time + dt;
    if (t >= store.project.duration) {
      if (loopBox.checked) t = 0;
      else { t = store.project.duration; setPlaying(false); }
    }
    store.time = t;
    store.emit('time');
  }
  if (dirty || store.playing) {
    syncVideos(store.project, store.time, store.playing);
    renderFrame(ctx, store.project, store.time, quality, () => { dirty = true; });
    drawOverlay();
    timecode.textContent = `${formatTime(store.time, store.project.fps)} / ${formatTime(store.project.duration, store.project.fps)}`;
    dirty = false;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

store.on((kind) => {
  dirty = true;
  if (kind === 'structure' || kind === 'change') autosave();
});

const playBtn = document.querySelector('[data-cmd="play"]');
function setPlaying(p) {
  store.playing = p;
  if (!p) store.setTime(store.time);
  playBtn.textContent = p ? '❚❚' : '▶';
  lastFrame = performance.now();
  dirty = true;
}

// arrastar camadas no preview
overlay.addEventListener('pointerdown', (e) => {
  const r = overlay.getBoundingClientRect();
  const toComp = (ev) => [((ev.clientX - r.left) / r.width) * store.project.width, ((ev.clientY - r.top) / r.height) * store.project.height];
  const [x, y] = toComp(e);
  const hit = hitTest(store.project, store.time, x, y);
  if (!hit) { if (store.selectedLayerId) store.select(null); return; }
  if (hit.id !== store.selectedLayerId) store.select(hit.id);
  const prop = hit.transform.position;
  const start = valueAt(prop, store.time);
  overlay.setPointerCapture(e.pointerId);
  let moved = false;
  overlay.onpointermove = (ev) => {
    const [nx, ny] = toComp(ev);
    if (Math.hypot(nx - x, ny - y) > 2) moved = true;
    if (!moved) return;
    setValue(prop, store.time, [Math.round(start[0] + nx - x), Math.round(start[1] + ny - y)]);
    store.emit('preview');
  };
  overlay.onpointerup = () => {
    overlay.onpointermove = null;
    if (moved) store.commit();
  };
});

// ------------------------------------------------------------------ painéis
const timeline = new Timeline(document.getElementById('timeline'), store);
new Inspector(document.getElementById('inspector'), store);
const library = new Library(document.getElementById('library'), store);

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
  if (tab === 'timeline') timeline.render();
}));

function showTab(tab) {
  document.querySelector(`[data-tab="${tab}"]`)?.click();
}

// ------------------------------------------------------------------ comandos
function addLayer(type) {
  const l = LAYER_FACTORIES[type](store.project);
  l.inPoint = 0;
  l.outPoint = store.project.duration;
  store.addLayer(l);
}

async function addMedia(files) {
  for (const f of files) {
    const isVideo = f.type.startsWith('video/');
    if (!isVideo && !f.type.startsWith('image/')) continue;
    const src = isVideo ? URL.createObjectURL(f) : await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const dims = await new Promise((res) => {
      if (isVideo) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight, d: v.duration });
        v.onerror = () => res({ w: 1280, h: 720, d: 5 });
        v.src = src;
      } else {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res({ w: 512, h: 512 });
        img.src = src;
      }
    });
    const { width, height, duration } = store.project;
    const fit = Math.min(1, width / dims.w, height / dims.h);
    const l = LAYER_FACTORIES[isVideo ? 'video' : 'image'](store.project, src, Math.round(dims.w * fit), Math.round(dims.h * fit), f.name.replace(/\.[^.]+$/, ''));
    if (isVideo && Number.isFinite(dims.d)) l.outPoint = Math.min(duration, dims.d);
    getMedia(l, () => { dirty = true; });
    store.addLayer(l);
  }
}

function saveProject() {
  const hasVideo = store.project.layers.some((l) => l.type === 'video');
  download(`projeto-${Date.now()}.motionframe.json`, JSON.stringify(store.project), 'application/json');
  if (hasVideo) toast('Atenção: vídeos não são embutidos no arquivo do projeto (apenas imagens).', 'warn', 5000);
}

async function openProject() {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format?.startsWith('motionframe-preset') || data.preset || data.presets) {
      library.importFiles([f]);
      showTab('presets');
      return;
    }
    if (!Array.isArray(data.layers) || !data.width) throw new Error('arquivo não é um projeto MotionFrame');
    store.load(data);
    layoutCanvas();
    toast('Projeto aberto.', 'ok');
  } catch (e) {
    toast(`Erro ao abrir: ${e.message}`, 'error');
  }
}

async function compSettings() {
  const p = store.project;
  const res = await modal('Composição', `
    <label class="row"><span>Formato</span><select data-f="res">${Object.entries(RESOLUTIONS).map(([k, l]) => `<option value="${k}" ${k === `${p.width}x${p.height}` ? 'selected' : ''}>${l} (${k})</option>`).join('')}<option value="custom" ${RESOLUTIONS[`${p.width}x${p.height}`] ? '' : 'selected'}>Personalizado</option></select></label>
    <label class="row"><span>Largura</span><input type="number" data-f="w" value="${p.width}" min="16" max="4096"></label>
    <label class="row"><span>Altura</span><input type="number" data-f="h" value="${p.height}" min="16" max="4096"></label>
    <label class="row"><span>FPS</span><select data-f="fps">${[24, 25, 30, 50, 60].map((f) => `<option ${f === p.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    <label class="row"><span>Duração (s)</span><input type="number" data-f="dur" value="${p.duration}" min="0.5" max="600" step="0.5"></label>
    <label class="row"><span>Fundo</span><input type="color" data-f="bg" value="${p.background}"></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Aplicar', primary: true, value: (w) => ({
    w: +w.querySelector('[data-f="w"]').value, h: +w.querySelector('[data-f="h"]').value,
    fps: +w.querySelector('[data-f="fps"]').value, dur: +w.querySelector('[data-f="dur"]').value, bg: w.querySelector('[data-f="bg"]').value,
  }) }], {
    onMount: (w) => w.querySelector('[data-f="res"]').addEventListener('change', (e) => {
      if (e.target.value === 'custom') return;
      const [a, b] = e.target.value.split('x');
      w.querySelector('[data-f="w"]').value = a;
      w.querySelector('[data-f="h"]').value = b;
    }),
  });
  if (!res) return;
  const sx = res.w / p.width, sy = res.h / p.height;
  if (sx !== 1 || sy !== 1) {
    // reposiciona camadas proporcionalmente
    for (const l of p.layers) {
      const pos = l.transform.position;
      pos.value = [pos.value[0] * sx, pos.value[1] * sy];
      pos.keys.forEach((k) => { k.v = [k.v[0] * sx, k.v[1] * sy]; });
      if (l.type === 'solid') { l.props.width = res.w; l.props.height = res.h; }
    }
  }
  const oldDur = p.duration;
  Object.assign(p, { width: Math.round(res.w), height: Math.round(res.h), fps: res.fps, duration: Math.max(0.5, res.dur), background: res.bg });
  for (const l of p.layers) {
    if (l.outPoint >= oldDur - 1e-3) l.outPoint = p.duration;
    l.outPoint = Math.min(l.outPoint, p.duration);
  }
  store.setTime(Math.min(store.time, p.duration));
  store.commit('structure');
  layoutCanvas();
}

function deleteSelection() {
  const s = store.selectedKey;
  const layer = store.layer();
  if (s && layer && s.layerId === layer.id) {
    const prop = resolveProp(layer, s.path);
    if (prop) { removeKeyAt(prop, s.t); store.selectedKey = null; store.commit(); return; }
  }
  if (layer) store.removeLayer(layer.id);
}

const frame = () => 1 / store.project.fps;
const commands = {
  new: async () => {
    const ok = await modal('Novo projeto', '<p>Descartar o projeto atual e começar do zero?</p>', [{ label: 'Cancelar', value: false }, { label: 'Novo projeto', value: true, danger: true }]);
    if (ok) { store.load(createProject(store.project.width, store.project.height)); layoutCanvas(); }
  },
  open: openProject,
  save: saveProject,
  undo: () => store.undo(),
  redo: () => store.redo(),
  'add-text': () => addLayer('text'),
  'add-rect': () => addLayer('rect'),
  'add-ellipse': () => addLayer('ellipse'),
  'add-solid': () => addLayer('solid'),
  'add-media': async () => addMedia(await pickFiles('image/*,video/*')),
  'import-ffx': async () => {
    const files = await pickFiles('.ffx,.json');
    if (files.length) { showTab('presets'); library.importFiles(files); }
  },
  comp: compSettings,
  export: async () => {
    setPlaying(false);
    const fmt = await exportDialog(store);
    if (fmt === 'project') saveProject();
  },
  play: () => setPlaying(!store.playing),
  start: () => store.setTime(0),
  end: () => store.setTime(store.project.duration),
  'prev-frame': () => store.setTime(store.time - frame()),
  'next-frame': () => store.setTime(store.time + frame()),
  dup: () => store.selectedLayerId && store.duplicateLayer(store.selectedLayerId),
  up: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, -1),
  down: () => store.selectedLayerId && store.moveLayer(store.selectedLayerId, 1),
  del: deleteSelection,
  'zoom-in': () => timeline.setZoom(timeline.zoom * 1.5),
  'zoom-out': () => timeline.setZoom(timeline.zoom / 1.5),
};

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]?.()));

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.modal-wrap')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? commands.redo : commands.undo)(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); commands.redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); commands.dup(); return; }
  switch (e.key) {
    case ' ': e.preventDefault(); commands.play(); break;
    case 'ArrowLeft': e.preventDefault(); store.setTime(store.time - frame() * (e.shiftKey ? 10 : 1)); break;
    case 'ArrowRight': e.preventDefault(); store.setTime(store.time + frame() * (e.shiftKey ? 10 : 1)); break;
    case 'Home': commands.start(); break;
    case 'End': commands.end(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
    default:
  }
});

// arrastar e soltar arquivos
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
  const mediaFiles = files.filter((f) => /^(image|video)\//.test(f.type));
  if (presets.length) { showTab('presets'); library.importFiles(presets); }
  if (mediaFiles.length) addMedia(mediaFiles);
});

// ------------------------------------------------------------------ autosave
let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = { ...store.project, layers: store.project.layers.filter((l) => l.type !== 'video') };
    storage.set(AUTOSAVE_KEY, p);
  }, 600);
}

function demoProject() {
  const p = createProject(1080, 1920);
  const s = new Store();
  s.project = p;
  const bg = LAYER_FACTORIES.solid(p); bg.name = 'Fundo'; bg.props.fill = '#1b1440';
  const circle = LAYER_FACTORIES.ellipse(p); circle.props.width = circle.props.height = 640; circle.props.fill = '#7c5cff';
  circle.transform.position.value = [540, 820];
  circle.effects.push({ id: 'fx_demo_glow', type: 'glow', enabled: true, params: {
    threshold: { value: 10, keys: [] }, radius: { value: 60, keys: [] }, intensity: { value: 1.4, keys: [] }, color: { value: [1, 1, 1, 1], keys: [] }, useColor: { value: false, keys: [] },
  } });
  circle.transform.scale.keys = [{ t: 0, v: [0, 0], ease: 'back' }, { t: 0.8, v: [100, 100], ease: 'linear' }];
  const title = LAYER_FACTORIES.text(p); title.props.text = 'MotionFrame'; title.transform.position.value = [540, 1380];
  title.transform.opacity.keys = [{ t: 0.4, v: 0, ease: 'easeOut' }, { t: 1, v: 100, ease: 'linear' }];
  title.transform.position.keys = [{ t: 0.4, v: [540, 1560], ease: 'back' }, { t: 1.1, v: [540, 1380], ease: 'linear' }];
  const sub = LAYER_FACTORIES.text(p); sub.props.text = 'Importe presets .ffx do After Effects'; sub.props.fontSize = 46; sub.props.fontWeight = 400;
  sub.transform.position.value = [540, 1500];
  sub.transform.opacity.keys = [{ t: 0.9, v: 0, ease: 'easeOut' }, { t: 1.5, v: 100, ease: 'linear' }];
  p.layers = [sub, title, circle, bg];
  return p;
}

const saved = storage.get(AUTOSAVE_KEY, null);
store.load(saved && Array.isArray(saved.layers) ? saved : demoProject());
if (!saved) store.setTime(1.5);
layoutCanvas();

if (window.matchMedia('(max-width: 900px)').matches) showTab('timeline');
