import { sortKeys } from './anim.js';
import { resolveProp } from './state.js';
import { getEffectDef } from './effects.js';
import { escapeHtml, formatTime } from './util.js';

const NAME_W = 190;
const TRANSFORM_LABELS = { position: 'Posição', scale: 'Escala', rotation: 'Rotação', opacity: 'Opacidade', anchor: 'Ponto de ancoragem' };
const ICONS = { text: 'T', rect: '▭', ellipse: '◯', solid: '■', image: '🖼', video: '🎞' };

export class Timeline {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.zoom = 1;
    this.expanded = new Set();
    root.innerHTML = `
      <div class="tl-scroll">
        <div class="tl-content">
          <div class="tl-ruler-row"><div class="tl-corner"><span class="tl-time"></span></div><canvas class="tl-ruler"></canvas></div>
          <div class="tl-rows"></div>
          <div class="tl-playhead"><div class="tl-playhead-cap"></div></div>
        </div>
      </div>`;
    this.scroll = root.querySelector('.tl-scroll');
    this.content = root.querySelector('.tl-content');
    this.rows = root.querySelector('.tl-rows');
    this.ruler = root.querySelector('.tl-ruler');
    this.playhead = root.querySelector('.tl-playhead');
    this.timeLabel = root.querySelector('.tl-time');

    store.on((kind) => {
      if (kind === 'time') this.updatePlayhead();
      else if (kind !== 'preview') this.render();
    });
    new ResizeObserver(() => this.render()).observe(this.scroll);
    this.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.bindScrub(this.ruler);
    this.render();
  }

  setZoom(z) {
    this.zoom = Math.max(1, Math.min(40, z));
    this.render();
  }

  get trackWidth() {
    return Math.max(200, (this.scroll.clientWidth - NAME_W - 16) * this.zoom);
  }
  tToX(t) { return (t / this.store.project.duration) * this.trackWidth; }
  xToT(x) { return (x / this.trackWidth) * this.store.project.duration; }

  bindScrub(el) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = el.getBoundingClientRect();
        this.store.setTime(this.xToT(ev.clientX - r.left));
      };
      move(e);
      el.onpointermove = move;
      el.onpointerup = () => { el.onpointermove = null; };
    });
  }

  render() {
    const { project } = this.store;
    const tw = this.trackWidth;
    this.content.style.width = `${NAME_W + tw + 16}px`;
    this.content.style.setProperty('--name-w', `${NAME_W}px`);
    this.drawRuler(tw);

    const html = [];
    if (!project.layers.length) {
      html.push(`<div class="tl-empty">Adicione texto, formas ou mídia pela barra superior.</div>`);
    }
    for (const layer of project.layers) {
      const sel = layer.id === this.store.selectedLayerId;
      const open = this.expanded.has(layer.id);
      const props = this.animatedProps(layer);
      const allKeys = props.flatMap((p) => p.prop.keys.map((k) => k.t));
      html.push(`
        <div class="tl-row layer ${sel ? 'sel' : ''} ${layer.visible ? '' : 'hidden'}" data-layer="${layer.id}">
          <div class="tl-name">
            <button class="tl-exp" data-act="expand" title="Mostrar keyframes">${props.length ? (open ? '▾' : '▸') : ''}</button>
            <button class="tl-eye" data-act="eye" title="Visibilidade">${layer.visible ? '●' : '○'}</button>
            <span class="tl-ico">${ICONS[layer.type] || '?'}</span>
            <span class="tl-label">${escapeHtml(layer.name)}</span>
            ${layer.effects.length ? `<span class="tl-fx" title="${layer.effects.length} efeito(s)">fx</span>` : ''}
          </div>
          <div class="tl-track" style="width:${tw}px">
            <div class="tl-bar" data-act="bar" style="left:${this.tToX(layer.inPoint)}px;width:${Math.max(4, this.tToX(layer.outPoint - layer.inPoint))}px">
              <div class="tl-handle l" data-act="trim-in"></div><div class="tl-handle r" data-act="trim-out"></div>
            </div>
            ${open ? '' : [...new Set(allKeys)].map((t) => `<span class="kf ghost" style="left:${this.tToX(t)}px"></span>`).join('')}
          </div>
        </div>`);
      if (open) {
        for (const { path, label, prop } of props) {
          html.push(`
            <div class="tl-row prop" data-layer="${layer.id}">
              <div class="tl-name sub">${escapeHtml(label)}</div>
              <div class="tl-track" style="width:${tw}px">
                ${prop.keys.map((k) => {
                  const s = this.store.selectedKey;
                  const isSel = s && s.layerId === layer.id && s.path === path && Math.abs(s.t - k.t) < 1e-4;
                  return `<span class="kf ${k.ease === 'hold' ? 'hold' : ''} ${k.ease !== 'linear' && k.ease !== 'hold' ? 'ease' : ''} ${isSel ? 'sel' : ''}" data-act="key" data-path="${path}" data-t="${k.t}" style="left:${this.tToX(k.t)}px" title="${formatTime(k.t, project.fps)}"></span>`;
                }).join('')}
              </div>
            </div>`);
        }
      }
    }
    this.rows.innerHTML = html.join('');
    this.bindRows();
    this.updatePlayhead();
  }

  animatedProps(layer) {
    const out = [];
    for (const [k, p] of Object.entries(layer.transform)) if (p.keys.length) out.push({ path: `transform.${k}`, label: TRANSFORM_LABELS[k] || k, prop: p });
    for (const fx of layer.effects) {
      const def = fx.type === 'generic' ? { label: fx.label, params: fx.defs || [] } : getEffectDef(fx.type);
      for (const pd of def.params) {
        const p = fx.params[pd.key];
        if (p?.keys.length) out.push({ path: `fx:${fx.id}.${pd.key}`, label: `${fx.label || def.label} › ${pd.label}`, prop: p });
      }
    }
    return out;
  }

  drawRuler(tw) {
    const { duration, fps } = this.store.project;
    const dpr = window.devicePixelRatio || 1;
    const c = this.ruler;
    c.style.width = `${tw + 16}px`;
    c.width = (tw + 16) * dpr; c.height = 26 * dpr;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.clearRect(0, 0, tw + 16, 26);
    const pxPerSec = tw / duration;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => s * pxPerSec >= 60) || 60;
    x.fillStyle = getComputedStyle(this.root).getPropertyValue('--muted') || '#888';
    x.strokeStyle = x.fillStyle;
    x.font = '10px system-ui, sans-serif';
    for (let i = 0; i * step <= duration + 1e-6; i++) {
      const t = i * step;
      const px = Math.round(t * pxPerSec) + 0.5;
      x.beginPath(); x.moveTo(px, 16); x.lineTo(px, 26); x.stroke();
      x.fillText(step < 1 ? formatTime(t, fps).slice(3) : `${Math.round(t)}s`, px + 3, 12);
      const minor = step / 5;
      for (let i = 1; i < 5; i++) {
        const mx = Math.round((t + minor * i) * pxPerSec) + 0.5;
        if (t + minor * i > duration) break;
        x.beginPath(); x.moveTo(mx, 21); x.lineTo(mx, 26); x.stroke();
      }
    }
  }

  updatePlayhead() {
    const { time, project } = this.store;
    this.playhead.style.transform = `translateX(${NAME_W + this.tToX(time)}px)`;
    this.timeLabel.textContent = `${formatTime(time, project.fps)}`;
    if (this.store.playing) {
      const x = NAME_W + this.tToX(time);
      const view = this.scroll.scrollLeft + this.scroll.clientWidth;
      if (x > view - 20 || x < this.scroll.scrollLeft + NAME_W) this.scroll.scrollLeft = x - NAME_W - 40;
    }
  }

  bindRows() {
    const { store } = this;
    this.rows.querySelectorAll('.tl-row').forEach((row) => {
      const layerId = row.dataset.layer;
      row.querySelector('.tl-name').addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        const layer = store.layer(layerId);
        if (act === 'expand') {
          if (this.expanded.has(layerId)) this.expanded.delete(layerId); else this.expanded.add(layerId);
          this.render();
          return;
        }
        if (act === 'eye') {
          layer.visible = !layer.visible;
          store.commit();
          return;
        }
        if (store.selectedLayerId !== layerId) store.select(layerId);
      });
      row.querySelector('.tl-name').addEventListener('dblclick', (e) => {
        if (!row.classList.contains('layer') || e.target.closest('button')) return;
        const layer = store.layer(layerId);
        const name = prompt('Nome da camada', layer.name);
        if (name) { layer.name = name; store.commit(); }
      });
      const track = row.querySelector('.tl-track');
      track.addEventListener('pointerdown', (e) => this.onTrackDown(e, layerId, track));
    });
  }

  onTrackDown(e, layerId, track) {
    const { store } = this;
    const target = e.target.closest('[data-act]');
    const act = target?.dataset.act;
    const layer = store.layer(layerId);
    if (!layer) return;
    const startX = e.clientX;
    const fps = store.project.fps;
    const snap = (t) => Math.round(t * fps) / fps;
    const dur = store.project.duration;

    if (!act) {
      // clique na trilha vazia => scrub
      const r = track.getBoundingClientRect();
      store.setTime(this.xToT(e.clientX - r.left));
      if (store.selectedLayerId !== layerId) store.select(layerId);
      return;
    }

    track.setPointerCapture(e.pointerId);
    let moved = false;
    let onMove;

    if (act === 'key') {
      const path = target.dataset.path;
      const t0 = parseFloat(target.dataset.t);
      const prop = resolveProp(layer, path);
      const key = prop?.keys.find((k) => Math.abs(k.t - t0) < 1e-4);
      if (!key) return;
      store.selectedLayerId = layerId;
      store.selectedKey = { layerId, path, t: key.t };
      store.setTime(key.t);
      onMove = (ev) => {
        const dt = this.xToT(ev.clientX - startX);
        if (Math.abs(ev.clientX - startX) > 2) moved = true;
        key.t = Math.max(0, Math.min(dur, snap(t0 + dt)));
        target.style.left = `${this.tToX(key.t)}px`;
        store.selectedKey.t = key.t;
        store.setTime(key.t);
      };
      track.onpointerup = () => {
        track.onpointermove = null;
        if (moved) {
          // evita dois keyframes no mesmo tempo
          prop.keys = prop.keys.filter((k) => k === key || Math.abs(k.t - key.t) > 1e-4);
          sortKeys(prop);
          store.commit();
        } else store.emit('selection');
      };
      track.onpointermove = onMove;
      return;
    }

    const in0 = layer.inPoint, out0 = layer.outPoint;
    const wasSelected = store.selectedLayerId === layerId;
    store.selectedLayerId = layerId;
    onMove = (ev) => {
      const dt = this.xToT(ev.clientX - startX);
      if (Math.abs(ev.clientX - startX) > 2) moved = true;
      if (act === 'bar') {
        const len = out0 - in0;
        const ni = Math.max(-len + 1 / fps, Math.min(dur - 1 / fps, snap(in0 + dt)));
        const shift = ni - in0;
        layer.inPoint = ni;
        layer.outPoint = ni + len;
        // move keyframes junto (como no AE)
        if (this._lastShift === undefined) this._lastShift = 0;
        const delta = shift - this._lastShift;
        this._lastShift = shift;
        this.shiftKeys(layer, delta);
      } else if (act === 'trim-in') {
        layer.inPoint = Math.max(0, Math.min(layer.outPoint - 1 / fps, snap(in0 + dt)));
      } else if (act === 'trim-out') {
        layer.outPoint = Math.min(dur, Math.max(layer.inPoint + 1 / fps, snap(out0 + dt)));
      }
      const bar = track.querySelector('.tl-bar');
      bar.style.left = `${this.tToX(layer.inPoint)}px`;
      bar.style.width = `${Math.max(4, this.tToX(layer.outPoint - layer.inPoint))}px`;
      store.emit('preview');
    };
    track.onpointermove = onMove;
    track.onpointerup = () => {
      track.onpointermove = null;
      this._lastShift = undefined;
      if (moved) store.commit();
      else if (!wasSelected) { store.selectedKey = null; store.emit('selection'); }
    };
  }

  shiftKeys(layer, dt) {
    if (!dt) return;
    const all = [...Object.values(layer.transform), ...layer.effects.flatMap((fx) => Object.values(fx.params))];
    for (const p of all) for (const k of p.keys) k.t = +(k.t + dt).toFixed(5);
  }
}
