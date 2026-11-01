// Timeline estilo Alight Motion: playhead fixo no centro, arrastar para navegar, pinça para zoom,
// clipes com miniaturas/forma de onda, keyframes com seleção múltipla e arraste em grupo.
import { sortKeys } from './anim.js';
import { resolveProp } from './state.js';
import { getEffectDef } from './effects.js';
import { animProps } from './keyframes.js';
import { peaks } from './audio.js';
import { escapeHtml, formatTime } from './util.js';

const TRANSFORM_LABELS = { position: 'Posição', scale: 'Escala', rotation: 'Rotação', opacity: 'Opacidade', anchor: 'Ancoragem' };
const ICONS = { text: 'T', rect: '▭', ellipse: '◯', solid: '■', image: '🖼', video: '🎞', audio: '♪', adjustment: '◐' };
const COLORS = { text: '#7c5cff', rect: '#ff5c8a', ellipse: '#3d8bff', solid: '#5a5a7a', image: '#1fb58f', video: '#1f8fb5', audio: '#d9822b', adjustment: '#a855f7' };

export class Timeline {
  constructor(root, store, hooks = {}) {
    this.root = root;
    this.store = store;
    this.hooks = hooks;
    this.pps = 120; // pixels por segundo
    this.expanded = new Set();
    this.thumbs = new Map();
    this.programmatic = false;
    root.innerHTML = `
      <div class="tl">
        <div class="tl-scroll">
          <div class="tl-inner">
            <div class="tl-ruler-wrap"><canvas class="tl-ruler"></canvas></div>
            <div class="tl-rows"></div>
          </div>
        </div>
        <div class="tl-playhead"></div>
        <div class="tl-zoom"><button data-z="-" aria-label="Afastar">−</button><button data-z="+" aria-label="Aproximar">＋</button></div>
      </div>`;
    this.scroll = root.querySelector('.tl-scroll');
    this.inner = root.querySelector('.tl-inner');
    this.rows = root.querySelector('.tl-rows');
    this.ruler = root.querySelector('.tl-ruler');
    root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => this.setZoom(this.pps * (b.dataset.z === '+' ? 1.5 : 1 / 1.5))));

    store.on((kind) => {
      if (kind === 'time') this.syncScroll();
      else if (kind !== 'preview') this.render();
    });
    new ResizeObserver(() => this.render()).observe(this.scroll);

    this.scroll.addEventListener('scroll', () => {
      this.drawRuler();
      if (this.programmatic) { this.programmatic = false; return; }
      if (this.store.playing) this.hooks.onUserScrub?.();
      this.store.setTime(this.scroll.scrollLeft / this.pps);
    }, { passive: true });

    this.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.bindPinch();
    this.render();
  }

  get half() { return this.scroll.clientWidth / 2; }
  tToX(t) { return this.half + t * this.pps; }

  setZoom(pps) {
    this.pps = Math.max(8, Math.min(2400, pps));
    this.render();
  }

  bindPinch() {
    let d0 = 0, p0 = 0;
    const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    this.scroll.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e); p0 = this.pps; } }, { passive: true });
    this.scroll.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      this.setZoom(p0 * (dist(e) / d0));
    }, { passive: false });
    this.scroll.addEventListener('touchend', () => { d0 = 0; });
  }

  syncScroll() {
    const x = this.store.time * this.pps;
    if (Math.abs(this.scroll.scrollLeft - x) > 0.5) {
      this.programmatic = true;
      this.scroll.scrollLeft = x;
    }
    this.drawRuler();
  }

  render() {
    const { project } = this.store;
    const w = project.duration * this.pps + this.half * 2;
    this.inner.style.width = `${w}px`;
    const html = [];
    for (const m of project.markers || []) html.push(`<div class="tl-marker" style="left:${this.tToX(m)}px"></div>`);
    if (!project.layers.length) html.push('<div class="tl-empty">Toque em <b>＋ Camada</b> para adicionar vídeo, áudio, texto ou formas.</div>');
    for (const layer of project.layers) html.push(this.layerRow(layer));
    this.rows.innerHTML = html.join('');
    this.bindRows();
    this.syncScroll();
    this.drawWaveforms();
  }

  layerRow(layer) {
    const { store } = this;
    const sel = layer.id === store.selectedLayerId;
    const open = sel && this.expanded.has(layer.id);
    const props = this.propsOf(layer);
    const left = this.tToX(layer.inPoint);
    const width = Math.max(6, (layer.outPoint - layer.inPoint) * this.pps);
    const thumb = this.thumbFor(layer);
    const times = new Map();
    for (const { prop } of props) for (const k of prop.keys) {
      const key = k.t.toFixed(4);
      if (!times.has(key)) times.set(key, { t: k.t, sel: false });
      if (store.isKeySelected(k)) times.get(key).sel = true;
    }
    let out = `
      <div class="tl-row ${sel ? 'sel' : ''} ${layer.visible ? '' : 'off'}" data-layer="${layer.id}">
        <div class="clip t-${layer.type}" data-act="clip" style="left:${left}px;width:${width}px;--c:${COLORS[layer.type] || '#666'};${thumb ? `background-image:url('${thumb}')` : ''}">
          ${layer.type === 'audio' ? '<canvas class="wave"></canvas>' : ''}
          <span class="clip-label">${props.length && sel ? `<button class="exp" data-act="expand" aria-label="Mostrar propriedades">${open ? '▾' : '▸'}</button>` : ''}<span class="ico">${ICONS[layer.type] || '?'}</span>${escapeHtml(layer.name)}${layer.effects.length ? ` <i class="fxb">fx${layer.effects.length}</i>` : ''}</span>
          ${sel ? '<div class="handle l" data-act="trim-in"></div><div class="handle r" data-act="trim-out"></div>' : ''}
        </div>
        ${sel && !open ? [...times.values()].map((k) => `<span class="kf agg ${k.sel ? 'sel' : ''}" data-act="aggkey" data-t="${k.t}" style="left:${this.tToX(k.t)}px"></span>`).join('') : ''}
      </div>`;
    if (open) {
      for (const { path, label, prop } of props) {
        out += `<div class="tl-row prop" data-layer="${layer.id}"><span class="prop-label">${escapeHtml(label)}</span>
          ${prop.keys.map((k) => `<span class="kf ${k.ease === 'hold' ? 'hold' : ''} ${k.ease !== 'linear' && k.ease !== 'hold' ? 'ease' : ''} ${store.isKeySelected(k) ? 'sel' : ''}" data-act="key" data-path="${path}" data-t="${k.t}" style="left:${this.tToX(k.t)}px" title="${formatTime(k.t, store.project.fps)}"></span>`).join('')}
        </div>`;
      }
    }
    return out;
  }

  propsOf(layer) {
    const out = [];
    for (const { path, prop } of animProps(layer)) {
      if (!prop.keys.length) continue;
      let label;
      if (path.startsWith('transform.')) label = TRANSFORM_LABELS[path.slice(10)] || path;
      else {
        const [, fxId, key] = /^fx:([^.]+)\.(.+)$/.exec(path);
        const fx = layer.effects.find((f) => f.id === fxId);
        const def = fx.type === 'generic' ? { label: fx.label, params: fx.defs || [] } : getEffectDef(fx.type);
        label = `${fx.label || def.label} › ${def.params.find((p) => p.key === key)?.label || key}`;
      }
      out.push({ path, label, prop });
    }
    return out;
  }

  thumbFor(layer) {
    if (layer.type === 'image') return layer.props.src;
    if (layer.type !== 'video') return null;
    const src = layer.props.src;
    if (this.thumbs.has(src)) return this.thumbs.get(src);
    this.thumbs.set(src, null);
    this.hooks.videoThumb?.(src).then((url) => { this.thumbs.set(src, url); this.render(); }).catch(() => {});
    return null;
  }

  drawWaveforms() {
    this.rows.querySelectorAll('.tl-row').forEach((row) => {
      const c = row.querySelector('canvas.wave');
      if (!c) return;
      const layer = this.store.layer(row.dataset.layer);
      const pk = peaks(layer.props.src);
      if (!pk) return;
      const clip = c.parentElement;
      const w = Math.min(4000, clip.clientWidth), h = clip.clientHeight;
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = 'rgba(255,255,255,0.55)';
      const start = layer.props.sourceStart || 0;
      const dur = layer.outPoint - layer.inPoint;
      for (let i = 0; i < w; i++) {
        const st = start + (i / w) * dur;
        const v = pk.data[Math.floor((st / pk.duration) * pk.data.length)] || 0;
        const bh = Math.max(1, v * h * 0.9);
        x.fillRect(i, (h - bh) / 2, 1, bh);
      }
    });
  }

  drawRuler() {
    const { duration, fps } = this.store.project;
    const dpr = window.devicePixelRatio || 1;
    const vw = this.scroll.clientWidth;
    const c = this.ruler;
    if (c.width !== Math.round(vw * dpr)) { c.width = Math.round(vw * dpr); c.height = Math.round(22 * dpr); c.style.width = `${vw}px`; }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, vw, 22);
    const sl = this.scroll.scrollLeft;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => s * this.pps >= 56) || 60;
    const t0 = Math.max(0, Math.floor((sl - this.half) / this.pps / step) * step);
    const t1 = Math.min(duration, (sl + vw) / this.pps);
    x.font = '10px system-ui, sans-serif';
    x.fillStyle = '#8b8ba3';
    x.strokeStyle = '#4a4a62';
    for (let i = 0; t0 + i * step <= t1 + 1e-6; i++) {
      const t = t0 + i * step;
      const px = Math.round(this.half + t * this.pps - sl) + 0.5;
      x.beginPath(); x.moveTo(px, 12); x.lineTo(px, 22); x.stroke();
      const label = step < 1 ? `${Math.floor(t + 1e-6)}:${String(Math.round(((t + 1e-6) % 1) * fps) % fps).padStart(2, '0')}` : `${Math.round(t)}s`;
      x.fillText(label, px + 3, 10);
    }
    x.fillStyle = '#ffb547';
    for (const m of this.store.project.markers || []) {
      const px = this.half + m * this.pps - sl;
      if (px < -5 || px > vw + 5) continue;
      x.beginPath(); x.moveTo(px - 4, 14); x.lineTo(px + 4, 14); x.lineTo(px, 21); x.fill();
    }
  }

  bindRows() {
    this.rows.querySelectorAll('.tl-row').forEach((row) => {
      row.addEventListener('pointerdown', (e) => this.onDown(e, row));
    });
  }

  snapTimes(exceptLayer) {
    const { project } = this.store;
    const out = [this.store.time, 0, project.duration, ...(project.markers || [])];
    for (const l of project.layers) if (l !== exceptLayer) out.push(l.inPoint, l.outPoint);
    return out;
  }

  snap(t, candidates) {
    const tol = 8 / this.pps;
    let best = t, bd = tol;
    for (const c of candidates) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  onDown(e, row) {
    const { store } = this;
    const target = e.target.closest('[data-act]');
    const act = target?.dataset.act;
    const layer = store.layer(row.dataset.layer);
    if (!layer || !act) return;
    const fps = store.project.fps;
    const frame = (t) => Math.round(t * fps) / fps;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey || !!this.hooks.multiSelect?.();

    if (act === 'expand') {
      e.stopPropagation();
      if (this.expanded.has(layer.id)) this.expanded.delete(layer.id); else this.expanded.add(layer.id);
      this.render();
      return;
    }

    if (act === 'clip' && layer.id !== store.selectedLayerId) {
      // primeiro toque só seleciona (arrastar continua rolando a timeline)
      const x0 = e.clientX, y0 = e.clientY;
      const up = (ev) => {
        row.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) store.select(layer.id);
      };
      row.addEventListener('pointerup', up);
      return;
    }

    e.preventDefault();
    row.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let moved = false;

    if (act === 'key' || act === 'aggkey') {
      const t0 = parseFloat(target.dataset.t);
      let keys;
      if (act === 'key') {
        const prop = resolveProp(layer, target.dataset.path);
        const key = prop.keys.find((k) => Math.abs(k.t - t0) < 1e-4);
        keys = [{ layerId: layer.id, path: target.dataset.path, key }];
      } else {
        keys = animProps(layer).flatMap(({ path, prop }) => prop.keys.filter((k) => Math.abs(k.t - t0) < 1e-4).map((key) => ({ layerId: layer.id, path, key })));
      }
      const allSel = keys.every((k) => store.isKeySelected(k.key));
      if (additive) {
        if (allSel) store.selectedKeys = store.selectedKeys.filter((s) => !keys.some((k) => k.key === s.key));
        else store.selectedKeys = [...store.selectedKeys, ...keys.filter((k) => !store.isKeySelected(k.key))];
      } else if (!allSel) {
        store.selectedKeys = keys;
        this.rows.querySelectorAll('.kf.sel').forEach((el) => el.classList.remove('sel'));
      }
      target.classList.toggle('sel', store.selectedKeys.some((s) => keys.some((k) => k.key === s.key)));
      const sel = store.selectedKeys;
      const base = sel.map((s) => s.key.t);
      row.onpointermove = (ev) => {
        if (Math.abs(ev.clientX - x0) > 3) moved = true;
        if (!moved || !sel.length) return;
        let d = frame((ev.clientX - x0) / this.pps);
        const minT = Math.min(...base);
        if (minT + d < 0) d = -minT;
        sel.forEach((s, i) => { s.key.t = +(base[i] + d).toFixed(5); });
        this.rows.querySelectorAll('.kf.sel').forEach((el) => { el.style.left = `${this.tToX(parseFloat(el.dataset.t) + d)}px`; });
        this.hooks.onPreview?.();
      };
      row.onpointerup = () => {
        row.onpointermove = null;
        row.onpointerup = null;
        if (moved) {
          const props = new Set(sel.map((s) => resolveProp(store.layer(s.layerId), s.path)));
          for (const p of props) {
            if (!p) continue;
            p.keys = p.keys.filter((k) => store.isKeySelected(k) || !p.keys.some((o) => o !== k && store.isKeySelected(o) && Math.abs(o.t - k.t) < 1e-4));
            sortKeys(p);
          }
          store.commit();
        } else {
          if (!additive) store.setTime(t0);
          store.emit('keys');
        }
      };
      return;
    }

    const in0 = layer.inPoint, out0 = layer.outPoint, src0 = layer.props.sourceStart || 0;
    const clip = row.querySelector('.clip');
    const candidates = this.snapTimes(layer);
    let shifted = 0;
    row.onpointermove = (ev) => {
      const dt = (ev.clientX - x0) / this.pps;
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (!moved) return;
      if (act === 'clip') {
        const len = out0 - in0;
        let ni = frame(in0 + dt);
        const sIn = this.snap(ni, candidates), sOut = this.snap(ni + len, candidates);
        if (sIn !== ni) ni = sIn; else if (sOut !== ni + len) ni = sOut - len;
        ni = Math.max(-len + 1 / fps, Math.min(store.project.duration - 1 / fps, ni));
        const delta = ni - in0 - shifted;
        shifted += delta;
        layer.inPoint = ni;
        layer.outPoint = ni + len;
        for (const { prop } of animProps(layer)) for (const k of prop.keys) k.t = +(k.t + delta).toFixed(5);
      } else if (act === 'trim-in') {
        let ni = Math.max(0, Math.min(layer.outPoint - 1 / fps, this.snap(frame(in0 + dt), candidates)));
        if (layer.type === 'video' || layer.type === 'audio') {
          const rate = layer.type === 'video' ? (layer.props.speed ?? 1) : 1;
          const ns = src0 + (ni - in0) * rate;
          if (ns < 0) ni = in0 - src0 / rate;
          layer.props.sourceStart = Math.max(0, src0 + (ni - in0) * rate);
        }
        layer.inPoint = ni;
      } else if (act === 'trim-out') {
        layer.outPoint = Math.min(store.project.duration, Math.max(layer.inPoint + 1 / fps, this.snap(frame(out0 + dt), candidates)));
      }
      clip.style.left = `${this.tToX(layer.inPoint)}px`;
      clip.style.width = `${Math.max(6, (layer.outPoint - layer.inPoint) * this.pps)}px`;
      this.hooks.onPreview?.();
    };
    row.onpointerup = () => {
      row.onpointermove = null;
      row.onpointerup = null;
      if (moved) store.commit();
    };
  }
}
