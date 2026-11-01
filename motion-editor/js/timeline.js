// Timeline no estilo After Effects: coluna de camadas, régua de tempo e indicador de tempo (CTI) azul arrastável.
// A rolagem é livre (não muda o tempo), então nunca "puxa de volta". Pinça/Ctrl+roda dão zoom.
import { sortKeys } from './anim.js';
import { resolveProp } from './state.js';
import { getEffectDef } from './effects.js';
import { animProps } from './keyframes.js';
import { peaks } from './audio.js';
import { escapeHtml, formatTime } from './util.js';

const TRANSFORM_LABELS = { position: 'Posição', scale: 'Escala', rotation: 'Rotação', opacity: 'Opacidade', anchor: 'Ponto de ancoragem' };
const ICONS = { text: 'T', rect: '▭', ellipse: '◯', solid: '■', image: '▣', video: '▶', audio: '♪', adjustment: '◐' };
// cores de rótulo no estilo AE
const LABELS = { text: '#b53838', rect: '#c9b85a', ellipse: '#c9b85a', solid: '#8f8f8f', image: '#7086c4', video: '#4f9b95', audio: '#b98a4f', adjustment: '#8b84c2' };

export class Timeline {
  constructor(root, store, hooks = {}) {
    this.root = root;
    this.store = store;
    this.hooks = hooks;
    this.pps = 110; // pixels por segundo
    this.expanded = new Set();
    this.thumbs = new Map();
    root.innerHTML = `
      <div class="tl ae">
        <div class="tl-scroll">
          <div class="tl-inner">
            <div class="tl-head">
              <div class="tl-corner"><span class="tl-tc">0:00:00:00</span></div>
              <div class="tl-ruler-wrap"><canvas class="tl-ruler"></canvas></div>
            </div>
            <div class="tl-rows"></div>
            <div class="tl-cti"></div>
          </div>
        </div>
        <div class="tl-zoom"><button data-z="-" aria-label="Afastar">−</button><button data-z="+" aria-label="Aproximar">＋</button></div>
      </div>`;
    this.scroll = root.querySelector('.tl-scroll');
    this.inner = root.querySelector('.tl-inner');
    this.rows = root.querySelector('.tl-rows');
    this.ruler = root.querySelector('.tl-ruler');
    this.rulerWrap = root.querySelector('.tl-ruler-wrap');
    this.cti = root.querySelector('.tl-cti');
    this.tc = root.querySelector('.tl-tc');
    root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => this.setZoom(this.pps * (b.dataset.z === '+' ? 1.5 : 1 / 1.5))));

    store.on((kind) => {
      if (kind === 'time') this.updateCTI(true);
      else if (kind !== 'preview') this.render();
    });
    new ResizeObserver(() => this.render()).observe(this.scroll);
    this.scroll.addEventListener('scroll', () => this.drawRuler(), { passive: true });
    this.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.bindScrub();
    this.bindPinch();
    this.render();
  }

  get names() { return this.scroll.clientWidth < 600 ? 116 : 190; }
  tToX(t) { return t * this.pps; } // relativo à área de trilhas
  xToT(clientX) {
    const r = this.scroll.getBoundingClientRect();
    return (clientX - r.left + this.scroll.scrollLeft - this.names) / this.pps;
  }

  setZoom(pps) {
    // mantém o indicador de tempo no mesmo lugar da tela
    const before = this.names + this.store.time * this.pps - this.scroll.scrollLeft;
    this.pps = Math.max(6, Math.min(2400, pps));
    this.render();
    this.scroll.scrollLeft = Math.max(0, this.names + this.store.time * this.pps - before);
    this.drawRuler();
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

  /** Arrastar na régua (ou no indicador azul) muda o tempo — como no AE. */
  bindScrub() {
    const start = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hooks.onUserScrub?.();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => this.store.setTime(Math.max(0, Math.min(this.store.project.duration, this.xToT(ev.clientX))));
      move(e);
      el.onpointermove = move;
      el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; };
    };
    this.rulerWrap.addEventListener('pointerdown', start);
    this.cti.addEventListener('pointerdown', start);
  }

  render() {
    const { project } = this.store;
    const N = this.names;
    const trackW = project.duration * this.pps + 60;
    this.inner.style.setProperty('--names', `${N}px`);
    this.inner.style.width = `${N + trackW}px`;
    const html = [];
    html.push(`<div class="tl-markers">${(project.markers || []).map((m) => `<i style="left:${N + this.tToX(m)}px"></i>`).join('')}</div>`);
    if (!project.layers.length) html.push('<div class="tl-empty">Toque em <b>＋ Camada</b> para adicionar vídeo, áudio, texto ou formas.</div>');
    project.layers.forEach((layer, i) => html.push(this.layerRows(layer, i + 1, trackW)));
    this.rows.innerHTML = html.join('');
    this.bindRows();
    this.updateCTI(false);
    this.drawWaveforms();
  }

  layerRows(layer, num, trackW) {
    const { store } = this;
    const sel = layer.id === store.selectedLayerId;
    const props = this.propsOf(layer);
    const open = this.expanded.has(layer.id);
    const left = this.tToX(layer.inPoint);
    const width = Math.max(4, (layer.outPoint - layer.inPoint) * this.pps);
    const thumb = this.thumbFor(layer);
    const color = LABELS[layer.type] || '#888';
    const times = new Map();
    for (const { prop } of props) for (const k of prop.keys) {
      const key = k.t.toFixed(4);
      if (!times.has(key)) times.set(key, { t: k.t, sel: false });
      if (store.isKeySelected(k)) times.get(key).sel = true;
    }
    let out = `
      <div class="tl-row layer ${sel ? 'sel' : ''} ${layer.visible ? '' : 'off'}" data-layer="${layer.id}">
        <div class="tl-name" data-act="name">
          <button class="tw" data-act="expand" aria-label="Propriedades">${props.length || layer.effects.length ? (open ? '▾' : '▸') : ''}</button>
          <button class="eye" data-act="eye" aria-label="Visibilidade">${layer.visible ? '◉' : '○'}</button>
          <span class="lbl" style="background:${color}"></span>
          <span class="num">${num}</span>
          <span class="nm">${escapeHtml(layer.name)}</span>
        </div>
        <div class="tl-track" style="width:${trackW}px">
          <div class="clip" data-act="clip" style="left:${left}px;width:${width}px;--c:${color};${thumb ? `background-image:url('${thumb}')` : ''}">
            ${layer.type === 'audio' ? '<canvas class="wave"></canvas>' : ''}
            ${layer.effects.length ? `<span class="fxb">fx</span>` : ''}
            ${sel ? '<div class="handle l" data-act="trim-in"></div><div class="handle r" data-act="trim-out"></div>' : ''}
          </div>
          ${!open ? [...times.values()].map((k) => `<span class="kf agg ${k.sel ? 'sel' : ''}" data-act="aggkey" data-t="${k.t}" style="left:${this.tToX(k.t)}px"></span>`).join('') : ''}
        </div>
      </div>`;
    if (open) {
      for (const { path, label, prop } of props) {
        out += `<div class="tl-row prop" data-layer="${layer.id}">
          <div class="tl-name sub"><span class="sw-on">⏱</span><span class="nm">${escapeHtml(label)}</span></div>
          <div class="tl-track" style="width:${trackW}px">
            ${prop.keys.map((k) => `<span class="kf ${k.ease === 'hold' ? 'hold' : ''} ${k.ease !== 'linear' && k.ease !== 'hold' ? 'ease' : ''} ${store.isKeySelected(k) ? 'sel' : ''}" data-act="key" data-path="${path}" data-t="${k.t}" style="left:${this.tToX(k.t)}px" title="${formatTime(k.t, store.project.fps)}"></span>`).join('')}
          </div>
        </div>`;
      }
      if (!props.length) out += `<div class="tl-row prop" data-layer="${layer.id}"><div class="tl-name sub"><span class="nm muted">Sem keyframes — use ◆ nos controles</span></div><div class="tl-track" style="width:${trackW}px"></div></div>`;
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
        if (fx?.type === 'stabilize') continue; // keyframes automáticos da estabilização (um por quadro) não poluem a timeline
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
    this.rows.querySelectorAll('.tl-row.layer').forEach((row) => {
      const c = row.querySelector('canvas.wave');
      if (!c) return;
      const layer = this.store.layer(row.dataset.layer);
      const pk = peaks(layer.props.src);
      if (!pk) return;
      const clip = c.parentElement;
      const w = Math.min(4000, clip.clientWidth), h = clip.clientHeight;
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = 'rgba(255,255,255,0.5)';
      const start = layer.props.sourceStart || 0;
      const dur = layer.outPoint - layer.inPoint;
      for (let i = 0; i < w; i++) {
        const v = pk.data[Math.floor(((start + (i / w) * dur) / pk.duration) * pk.data.length)] || 0;
        const bh = Math.max(1, v * h * 0.9);
        x.fillRect(i, (h - bh) / 2, 1, bh);
      }
    });
  }

  /** Posiciona o indicador de tempo; durante a reprodução, vira a página como no AE. */
  updateCTI(follow) {
    const { time, fps } = { time: this.store.time, fps: this.store.project.fps };
    const x = this.names + this.tToX(time);
    this.cti.style.transform = `translateX(${x}px)`;
    this.tc.textContent = `0:${formatTime(time, fps)}`;
    if (follow && this.store.playing) {
      const left = this.scroll.scrollLeft + this.names, right = this.scroll.scrollLeft + this.scroll.clientWidth - 10;
      if (x > right || x < left) this.scroll.scrollLeft = Math.max(0, x - this.names - 20);
    }
    this.drawRuler();
  }

  drawRuler() {
    const { duration, fps } = this.store.project;
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.max(10, this.scroll.clientWidth - this.names);
    const c = this.ruler;
    if (c.width !== Math.round(vw * dpr)) { c.width = Math.round(vw * dpr); c.height = Math.round(24 * dpr); c.style.width = `${vw}px`; c.style.height = '24px'; }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, vw, 24);
    const sl = this.scroll.scrollLeft;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => s * this.pps >= 50) || 60;
    const t0 = Math.max(0, Math.floor(sl / this.pps / step) * step);
    const t1 = Math.min(duration, (sl + vw) / this.pps);
    x.font = '10px system-ui, sans-serif';
    x.fillStyle = '#9a9a9a';
    x.strokeStyle = '#5a5a5a';
    for (let i = 0; t0 + i * step <= t1 + 1e-6; i++) {
      const t = t0 + i * step;
      const px = Math.round(t * this.pps - sl) + 0.5;
      x.beginPath(); x.moveTo(px, 14); x.lineTo(px, 24); x.stroke();
      const label = step < 1 ? `${Math.floor(t + 1e-6)}:${String(Math.round(((t + 1e-6) % 1) * fps) % fps).padStart(2, '0')}f` : `${Math.round(t)}s`;
      x.fillText(label, px + 3, 11);
    }
    // área além do fim da composição
    const endX = duration * this.pps - sl;
    if (endX < vw) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(Math.max(0, endX), 0, vw, 24); }
    x.fillStyle = '#e8a33d';
    for (const m of this.store.project.markers || []) {
      const px = m * this.pps - sl;
      if (px < -5 || px > vw + 5) continue;
      x.beginPath(); x.moveTo(px - 4, 15); x.lineTo(px + 4, 15); x.lineTo(px, 22); x.fill();
    }
    // cabeça do indicador de tempo (azul, como no AE)
    const cx = this.store.time * this.pps - sl;
    this.cti.style.display = cx < -1 ? 'none' : '';
    if (cx > -8 && cx < vw + 8) {
      x.fillStyle = '#2d8ceb';
      x.beginPath(); x.moveTo(cx - 6, 0); x.lineTo(cx + 6, 0); x.lineTo(cx + 6, 12); x.lineTo(cx, 18); x.lineTo(cx - 6, 12); x.fill();
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

    if (act === 'expand' || act === 'eye' || act === 'name') {
      // um toque na coluna de nomes (sem arrastar) seleciona/abre — arrastar continua rolando
      const x0 = e.clientX, y0 = e.clientY;
      const up = (ev) => {
        row.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) return;
        if (act === 'expand') {
          if (this.expanded.has(layer.id)) this.expanded.delete(layer.id); else this.expanded.add(layer.id);
          if (layer.id !== store.selectedLayerId) store.select(layer.id); else this.render();
        } else if (act === 'eye') {
          layer.visible = !layer.visible;
          store.commit();
        } else if (layer.id !== store.selectedLayerId) store.select(layer.id);
      };
      row.addEventListener('pointerup', up);
      return;
    }

    if (act === 'clip' && layer.id !== store.selectedLayerId) {
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
          this.hooks.onKeyTap?.(); // abre o gráfico do keyframe (como no Alight Motion)
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
          if (src0 + (ni - in0) * rate < 0) ni = in0 - src0 / rate;
          layer.props.sourceStart = Math.max(0, src0 + (ni - in0) * rate);
        }
        layer.inPoint = ni;
      } else if (act === 'trim-out') {
        layer.outPoint = Math.min(store.project.duration, Math.max(layer.inPoint + 1 / fps, this.snap(frame(out0 + dt), candidates)));
      }
      clip.style.left = `${this.tToX(layer.inPoint)}px`;
      clip.style.width = `${Math.max(4, (layer.outPoint - layer.inPoint) * this.pps)}px`;
      this.hooks.onPreview?.();
    };
    row.onpointerup = () => {
      row.onpointermove = null;
      row.onpointerup = null;
      if (moved) store.commit();
    };
  }
}
