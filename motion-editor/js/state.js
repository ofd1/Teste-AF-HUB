import { anim } from './anim.js';
import { uid, deepClone } from './util.js';
import { sourceTime, ensureGroupTime } from './timing.js';
import { migrateTopazFx } from './fx/topaz.js';

export const RESOLUTIONS = {
  '1080x1920': 'Story / Reels 9:16',
  '1920x1080': 'YouTube 16:9',
  '1080x1080': 'Feed 1:1',
  '1080x1350': 'Retrato 4:5',
  '720x1280': '720p 9:16',
};

export function createProject(w = 1080, h = 1920) {
  return { version: 2, width: w, height: h, fps: 30, duration: 10, background: '#000000', layers: [], markers: [] };
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

/** Todas as camadas, incluindo as que estão dentro de grupos. */
export function flatLayers(layers) {
  const out = [];
  for (const l of layers) { out.push(l); if (l.type === 'group') out.push(...flatLayers(l.props.layers || [])); }
  return out;
}

export const LAYER_FACTORIES = {
  group: (p, layers = []) => baseLayer(p, 'group', 'Grupo', { width: p.width, height: p.height, layers }),
  text: (p) => baseLayer(p, 'text', 'Texto', { text: 'Seu texto', fontFamily: 'Inter, system-ui, sans-serif', fontSize: Math.round(p.width / 9), fontWeight: 800, color: '#ffffff', align: 'center', lineHeight: 1.15, strokeColor: '#000000', strokeWidth: 0, letterSpacing: 0 }),
  rect: (p) => baseLayer(p, 'rect', 'Retângulo', { width: Math.round(p.width * 0.5), height: Math.round(p.width * 0.3), radius: 24, fill: '#ff3d71', strokeColor: '#ffffff', strokeWidth: 0 }),
  ellipse: (p) => baseLayer(p, 'ellipse', 'Elipse', { width: Math.round(p.width * 0.4), height: Math.round(p.width * 0.4), fill: '#3d8bff', strokeColor: '#ffffff', strokeWidth: 0 }),
  solid: (p) => baseLayer(p, 'solid', 'Sólido', { width: p.width, height: p.height, fill: '#2b2b48' }),
  image: (p, src, w, h, name) => baseLayer(p, 'image', name || 'Imagem', { src, width: w, height: h }),
  video: (p, src, w, h, name) => baseLayer(p, 'video', name || 'Vídeo', { src, width: w, height: h, sourceStart: 0, speed: 1 }),
  audio: (p, src, name) => baseLayer(p, 'audio', name || 'Áudio', { src, volume: 100, sourceStart: 0, muted: false }),
  adjustment: (p) => baseLayer(p, 'adjustment', 'Ajuste', {}),
  // Null (como no After Effects): invisível, serve de "pai" para outras camadas
  null: (p) => baseLayer(p, 'null', 'Null', { width: 100, height: 100 }),
  // Câmera (como a do AE): dois nós (aponta para o Ponto de Interesse), zoom em px e profundidade de campo
  camera: (p) => {
    const l = baseLayer(p, 'camera', 'Câmera', { twoNode: true, dof: false });
    const zoom = Math.round((p.width * 50) / 36);
    Object.assign(l.transform, { posZ: anim(-zoom), poi: anim([p.width / 2, p.height / 2]), poiZ: anim(0), rotX: anim(0), rotY: anim(0), zoom: anim(zoom), focusDist: anim(zoom), aperture: anim(25), blurLevel: anim(100) });
    return l;
  },
  // Camada de formas (Shape Layer do AE): retângulos, elipses, estrelas e caminhos com preenchimento/contorno
  shape: (p, shapes = []) => baseLayer(p, 'shape', 'Formas', { width: p.width, height: p.height, shapes }),
};

/** Estado global do editor com histórico de desfazer/refazer. */
export class Store {
  constructor() {
    this.project = createProject();
    this.time = 0;
    this.playing = false;
    this.selectedLayerId = null;
    this.selectedKeys = []; // [{ layerId, path, key }]
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
    this.selectedKeys = [];
    this.emit('structure');
  }

  load(project) {
    this.project = project;
    this.undoStack = []; this.redoStack = [];
    this.lastSnapshot = this.snapshot();
    project.markers ||= [];
    for (const l of flatLayers(project.layers || [])) for (const fx of l.effects || []) migrateTopazFx(fx);
    this.scope = [];
    this.selectedLayerId = null;
    this.selectedKeys = [];
    this.setTime(0);
    this.emit('structure');
  }

  /** Pré-composição/grupo aberto (como dar dois cliques numa pré-comp no AE): pilha de ids. */
  get scopeGroups() {
    const out = [];
    let list = this.project.layers;
    for (const id of this.scope || []) { const g = list.find((l) => l.id === id && l.type === 'group'); if (!g) break; out.push(g); list = g.props.layers || (g.props.layers = []); }
    return out;
  }
  /** Lista de camadas que está sendo editada (a do grupo aberto ou a do projeto). */
  get layers() { const g = this.scopeGroups; return g.length ? g[g.length - 1].props.layers : this.project.layers; }
  set layers(v) { const g = this.scopeGroups; if (g.length) g[g.length - 1].props.layers = v; else this.project.layers = v; }
  openGroup(id) {
    const g = this.layers.find((l) => l.id === id && l.type === 'group');
    if (!g) return false;
    this.scope = [...(this.scope || []), id];
    this.selectedLayerId = g.props.layers?.[0]?.id || null; this.selectedKeys = [];
    this.emit('structure');
    return true;
  }
  closeGroup(all = false) {
    if (!this.scope?.length) return;
    const last = this.scope[this.scope.length - 1];
    this.scope = all ? [] : this.scope.slice(0, -1);
    this.selectedLayerId = all ? null : last; this.selectedKeys = [];
    this.emit('structure');
  }

  layer(id = this.selectedLayerId) { return this.layers.find((l) => l.id === id) || null; }

  /** add = Shift/Ctrl/toque longo: liga/desliga a camada na seleção múltipla. */
  select(id, add = false) {
    if (!this.multi) this.multi = new Set();
    if (add) {
      if (!this.multi.size && this.selectedLayerId && this.selectedLayerId !== id) this.multi.add(this.selectedLayerId);
      if (this.multi.has(id) && this.multi.size > 1) {
        this.multi.delete(id);
        if (this.selectedLayerId === id) id = [...this.multi][this.multi.size - 1];
      } else this.multi.add(id);
      if (this.multi.size < 2) this.multi.clear();
    } else this.multi.clear();
    this.selectedLayerId = id;
    this.emit('selection');
  }

  /** Camadas selecionadas (várias, se houver seleção múltipla) no escopo atual. */
  selectedLayers() {
    const ids = this.multi?.size > 1 ? [...this.multi] : [this.selectedLayerId];
    return this.layers.filter((l) => ids.includes(l.id));
  }

  isSelected(id) { return id === this.selectedLayerId || !!this.multi?.has(id); }

  isKeySelected(key) {
    return this.selectedKeys.some((s) => s.key === key);
  }

  setKeySelection(sel) {
    this.selectedKeys = sel;
    this.emit('keys');
  }

  toggleKey(layerId, path, key, additive) {
    const i = this.selectedKeys.findIndex((s) => s.key === key);
    if (additive) {
      if (i >= 0) this.selectedKeys.splice(i, 1);
      else this.selectedKeys.push({ layerId, path, key });
    } else if (i < 0) this.selectedKeys = [{ layerId, path, key }];
    this.emit('keys');
  }

  /** Divide a camada no tempo t (como a tesoura do Alight Motion / Ctrl+Shift+D do AE). */
  splitLayer(id, t) {
    const l = this.layer(id);
    if (!l || t <= l.inPoint + 1e-3 || t >= l.outPoint - 1e-3) return false;
    const copy = deepClone(l);
    copy.id = uid('ly');
    copy.effects.forEach((fx) => { fx.id = uid('fx'); });
    if (l.type === 'video') copy.props.sourceStart = sourceTime(l, t);
    if (l.type === 'group') {
      ensureGroupTime(l); copy.props.contentStart = l.props.contentStart; copy.props.sourceStart = sourceTime(l, t);
      const reid = (ls) => { for (const c of ls || []) { c.id = uid('ly'); c.effects?.forEach((fx) => { fx.id = uid('fx'); }); reid(c.props?.layers); } };
      reid(copy.props.layers); // camadas de dentro da cópia com ids próprios
    }
    if (l.type === 'audio') copy.props.sourceStart = (l.props.sourceStart || 0) + (t - l.inPoint);
    copy.inPoint = t;
    l.outPoint = t;
    const i = this.layers.indexOf(l);
    this.layers.splice(i, 0, copy);
    this.selectedLayerId = copy.id;
    this.commit('structure');
    return true;
  }

  toggleMarker(t) {
    const m = this.project.markers;
    const i = m.findIndex((x) => Math.abs(x - t) < 0.5 / this.project.fps);
    if (i >= 0) m.splice(i, 1); else { m.push(t); m.sort((a, b) => a - b); }
    this.commit();
  }

  setTime(t) {
    const fps = this.project.fps;
    this.time = Math.max(0, Math.min(this.project.duration, Math.round(t * fps) / fps));
    this.emit('time');
  }

  addLayer(layer) {
    this.layers.unshift(layer);
    this.selectedLayerId = layer.id;
    this.commit('structure');
  }

  removeLayer(id) {
    this.layers = this.layers.filter((l) => l.id !== id);
    this.selectedKeys = this.selectedKeys.filter((s) => s.layerId !== id);
    if (this.selectedLayerId === id) this.selectedLayerId = this.layers[0]?.id || null;
    this.commit('structure');
  }

  duplicateLayer(id) {
    const l = this.layer(id);
    if (!l) return;
    const copy = deepClone(l);
    copy.id = uid('ly');
    copy.name = `${l.name} cópia`;
    copy.effects.forEach((fx) => { fx.id = uid('fx'); });
    const i = this.layers.indexOf(l);
    this.layers.splice(i, 0, copy);
    this.selectedLayerId = copy.id;
    this.commit('structure');
  }

  moveLayer(id, dir) {
    const arr = this.layers;
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
