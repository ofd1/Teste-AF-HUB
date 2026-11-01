import { anim } from './anim.js';
import { uid, deepClone } from './util.js';

export const RESOLUTIONS = {
  '1080x1920': 'Story / Reels 9:16',
  '1920x1080': 'YouTube 16:9',
  '1080x1080': 'Feed 1:1',
  '1080x1350': 'Retrato 4:5',
  '720x1280': '720p 9:16',
};

export function createProject(w = 1080, h = 1920) {
  return { version: 1, width: w, height: h, fps: 30, duration: 6, background: '#101018', layers: [] };
}

function baseLayer(project, type, name, props) {
  return {
    id: uid('ly'), type, name, visible: true, locked: false, blend: 'source-over',
    inPoint: 0, outPoint: project.duration,
    props,
    transform: {
      position: anim([project.width / 2, project.height / 2]),
      scale: anim([100, 100]),
      rotation: anim(0),
      opacity: anim(100),
      anchor: anim([0, 0]),
    },
    effects: [],
  };
}

export const LAYER_FACTORIES = {
  text: (p) => baseLayer(p, 'text', 'Texto', { text: 'Seu texto', fontFamily: 'Inter, system-ui, sans-serif', fontSize: Math.round(p.width / 9), fontWeight: 800, color: '#ffffff', align: 'center', lineHeight: 1.15, strokeColor: '#000000', strokeWidth: 0, letterSpacing: 0 }),
  rect: (p) => baseLayer(p, 'rect', 'Retângulo', { width: Math.round(p.width * 0.5), height: Math.round(p.width * 0.3), radius: 24, fill: '#ff3d71', strokeColor: '#ffffff', strokeWidth: 0 }),
  ellipse: (p) => baseLayer(p, 'ellipse', 'Elipse', { width: Math.round(p.width * 0.4), height: Math.round(p.width * 0.4), fill: '#3d8bff', strokeColor: '#ffffff', strokeWidth: 0 }),
  solid: (p) => baseLayer(p, 'solid', 'Sólido', { width: p.width, height: p.height, fill: '#2b2b48' }),
  image: (p, src, w, h, name) => baseLayer(p, 'image', name || 'Imagem', { src, width: w, height: h }),
  video: (p, src, w, h, name) => baseLayer(p, 'video', name || 'Vídeo', { src, width: w, height: h, muted: true }),
};

/** Estado global do editor com histórico de desfazer/refazer. */
export class Store {
  constructor() {
    this.project = createProject();
    this.time = 0;
    this.playing = false;
    this.selectedLayerId = null;
    this.selectedKey = null; // { layerId, path, t }
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshot = this.snapshot();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'change') { for (const fn of this.listeners) fn(kind); }

  snapshot() { return JSON.stringify(this.project); }

  /** Registra o estado atual como passo de histórico (chamar após cada edição concluída). */
  commit(kind = 'change') {
    const snap = this.snapshot();
    if (snap !== this.lastSnapshot) {
      this.undoStack.push(this.lastSnapshot);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.lastSnapshot = snap;
    }
    this.emit(kind);
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.lastSnapshot);
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.lastSnapshot);
    this.restore(this.redoStack.pop());
  }
  restore(snap) {
    this.project = JSON.parse(snap);
    this.lastSnapshot = snap;
    if (!this.layer()) this.selectedLayerId = null;
    this.selectedKey = null;
    this.emit('structure');
  }

  load(project) {
    this.project = project;
    this.undoStack = []; this.redoStack = [];
    this.lastSnapshot = this.snapshot();
    this.selectedLayerId = project.layers[0]?.id || null;
    this.selectedKey = null;
    this.setTime(0);
    this.emit('structure');
  }

  layer(id = this.selectedLayerId) { return this.project.layers.find((l) => l.id === id) || null; }

  select(id) {
    this.selectedLayerId = id;
    this.selectedKey = null;
    this.emit('selection');
  }

  setTime(t) {
    const fps = this.project.fps;
    this.time = Math.max(0, Math.min(this.project.duration, Math.round(t * fps) / fps));
    this.emit('time');
  }

  addLayer(layer) {
    this.project.layers.unshift(layer);
    this.selectedLayerId = layer.id;
    this.commit('structure');
  }

  removeLayer(id) {
    this.project.layers = this.project.layers.filter((l) => l.id !== id);
    if (this.selectedLayerId === id) this.selectedLayerId = this.project.layers[0]?.id || null;
    this.commit('structure');
  }

  duplicateLayer(id) {
    const l = this.layer(id);
    if (!l) return;
    const copy = deepClone(l);
    copy.id = uid('ly');
    copy.name = `${l.name} cópia`;
    copy.effects.forEach((fx) => { fx.id = uid('fx'); });
    const i = this.project.layers.indexOf(l);
    this.project.layers.splice(i, 0, copy);
    this.selectedLayerId = copy.id;
    this.commit('structure');
  }

  moveLayer(id, dir) {
    const arr = this.project.layers;
    const i = arr.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.commit('structure');
  }
}

/** Resolve uma propriedade animável a partir de um caminho ('transform.position' | 'fx:<id>.<key>'). */
export function resolveProp(layer, path) {
  if (!layer) return null;
  if (path.startsWith('transform.')) return layer.transform[path.slice(10)] || null;
  const m = /^fx:([^.]+)\.(.+)$/.exec(path);
  if (m) return layer.effects.find((e) => e.id === m[1])?.params[m[2]] || null;
  return null;
}
