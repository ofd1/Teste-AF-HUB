// Timeline no estilo After Effects: coluna de camadas, régua de tempo e indicador de tempo (CTI) azul arrastável.
// A rolagem é livre (não muda o tempo), então nunca "puxa de volta". Pinça/Ctrl+roda dão zoom.
import { ensureGroupTime } from './timing.js';
import { sortKeys } from './anim.js';
import { resolveProp } from './state.js';
import { getEffectDef } from './effects.js';
import { animProps } from './keyframes.js';
import { peaks } from './audio.js';
import { escapeHtml, formatTime, formatSimple, isSimpleUI } from './util.js';

const TRANSFORM_LABELS = { position: 'Posição', scale: 'Escala', rotation: 'Rotação', opacity: 'Opacidade', anchor: 'Ponto de ancoragem', posZ: 'Posição Z', rotX: 'Rotação X', rotY: 'Rotação Y', poi: 'Ponto de interesse', poiZ: 'Ponto de interesse Z', zoom: 'Zoom', focusDist: 'Distância de foco', aperture: 'Abertura', blurLevel: 'Nível de desfoque' };
const ICONS = { camera: '🎥', null: '✛', text: 'T', rect: '▭', ellipse: '◯', solid: '■', image: '▣', video: '▶', audio: '♪', adjustment: '◐' };
// cores de rótulo no estilo AE
// interface simples: cores por tipo, fáceis de reconhecer (vídeo azul, texto rosa, áudio verde, efeito amarelo…)
const TYPE_COLOR = { video: '#2f7fe0', image: '#5b6ee8', text: '#d14fb4', rect: '#e08a2f', ellipse: '#e08a2f', shape: '#e08a2f', solid: '#7a7f8c', audio: '#2fae6b', adjustment: '#d6b22e', group: '#8a63d2', camera: '#8a8f99', null: '#8a8f99' };
const TYPE_ICON = { video: '▶', image: '▣', text: 'T', rect: '◆', ellipse: '●', shape: '✦', solid: '■', audio: '♪', adjustment: '✺', group: '⊞', camera: '🎥', null: '✛' };
const TYPE_NAME = { video: 'Vídeo', image: 'Foto', text: 'Texto', rect: 'Forma', ellipse: 'Forma', shape: 'Forma', solid: 'Cor', audio: 'Áudio', adjustment: 'Ajuste', group: 'Grupo', camera: 'Câmera', null: 'Controle' };
const LABELS = { camera: '#a8a8a8', null: '#c97a3a', text: '#b53838', rect: '#c9b85a', ellipse: '#c9b85a', solid: '#8f8f8f', image: '#7086c4', video: '#4f9b95', audio: '#b98a4f', adjustment: '#8b84c2' };

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
        <div class="tl-zoom"><button data-z="fit" aria-label="Ver o vídeo inteiro" title="Ver o vídeo inteiro">⤢</button><button data-z="-" aria-label="Afastar">−</button><button data-z="+" aria-label="Aproximar">＋</button></div>
      </div>`;
    this.scroll = root.querySelector('.tl-scroll');
    this.firmScroll();
    this.inner = root.querySelector('.tl-inner');
    this.rows = root.querySelector('.tl-rows');
    this.ruler = root.querySelector('.tl-ruler');
    this.rulerWrap = root.querySelector('.tl-ruler-wrap');
    this.cti = root.querySelector('.tl-cti');
    this.tc = root.querySelector('.tl-tc');
    root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => (b.dataset.z === 'fit' ? this.fit() : this.setZoom(this.pps * (b.dataset.z === '+' ? 1.5 : 1 / 1.5)))));
    // dois toques num grupo/pré-comp = abrir (como no AE)
    root.addEventListener('dblclick', (e) => {
      const row = e.target.closest?.('.tl-row.layer');
      const l = row && this.store.layer(row.dataset.layer);
      if (l?.type === 'group') { this.store.openGroup(l.id); }
    });

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

  get names() { return isSimpleUI() ? (this.scroll.clientWidth < 600 ? 74 : 132) : (this.scroll.clientWidth < 600 ? 116 : 190); }
  tToX(t) { return t * this.pps; } // relativo à área de trilhas
  xToT(clientX) {
    const r = this.scroll.getBoundingClientRect();
    return (clientX - r.left + this.scroll.scrollLeft - this.names) / this.pps;
  }

  /** Zoom para o vídeo inteiro caber na largura visível. */
  fit() {
    const vw = this.scroll.clientWidth - this.names - 34;
    if (vw < 40) return;
    this.pps = Math.max(6, Math.min(2400, vw / Math.max(0.5, this.store.project.duration)));
    this.render();
    this.scroll.scrollLeft = 0;
    this.drawRuler();
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
    // projeto aberto agora: começa vendo o vídeo inteiro (dá para aproximar com a pinça ou ＋)
    if (this._pid !== project.id && this.scroll.clientWidth > 0) {
      this._pid = project.id;
      const vw = this.scroll.clientWidth - this.names - 34;
      if (vw > 40) this.pps = Math.max(6, Math.min(400, vw / Math.max(0.5, project.duration)));
    }
    const N = this.names;
    const trackW = project.duration * this.pps + 60;
    this.inner.style.setProperty('--names', `${N}px`);
    this.inner.style.width = `${N + trackW}px`;
    const html = [];
    html.push(`<div class="tl-markers">${(project.markers || []).map((m) => `<i style="left:${N + this.tToX(m)}px"></i>`).join('')}</div>`);
    const layers = this.store.layers;
    if (!layers.length) html.push('<div class="tl-empty">Toque em <b>＋ Camada</b> para adicionar vídeo, áudio, texto ou formas.</div>');
    layers.forEach((layer, i) => html.push(this.layerRows(layer, i + 1, trackW)));
    if (layers.length && isSimpleUI()) html.push('<div class="tl-addrow"><button data-act="add-layer">＋ Adicionar camada</button></div>');
    this.rows.innerHTML = html.join('');
    this.bindRows();
    this.updateCTI(false);
    this.drawWaveforms();
  }

  /**
   * Rolagem "firme" da timeline: 1:1 com o dedo, sem inércia nem elástico, travando no eixo do primeiro movimento
   * (horizontal = tempo, vertical = camadas). Clipes, alças, keyframes e régua continuam com o próprio arrasto.
   */
  firmScroll() {
    const sc = this.scroll;
    sc.style.touchAction = 'none';
    let pan = null;
    const interactive = (el) => el.closest('.handle, .kf, .tl-cti, .tl-ruler-wrap, button, input, select, textarea, .tl-row.sel .clip, .plabel');
    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || interactive(e.target)) return;
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, axis: null };
    });
    sc.addEventListener('pointermove', (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.axis) {
        if (Math.hypot(dx, dy) < 6) return;
        pan.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        try { sc.setPointerCapture(e.pointerId); } catch { /* ok */ }
      }
      if (pan.axis === 'x') sc.scrollLeft = pan.sl - dx; else sc.scrollTop = pan.st - dy;
      pan.moved = true;
    });
    const end = (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      if (pan.moved) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; sc.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => sc.removeEventListener('click', stop, { capture: true }), 50); }
      pan = null;
    };
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
    this.marquee();
  }

  /**
   * Seleção por arrasto (como no AE): botão esquerdo numa área vazia da timeline + arrastar desenha um retângulo;
   * tudo que ele toca é selecionado — camadas (clipes) e keyframes. Shift/Ctrl soma à seleção atual.
   */
  marquee() {
    const sc = this.scroll, store = this.store;
    let m = null;
    const empty = (el) => !el.closest('.clip, .kf, .handle, .tl-cti, .tl-ruler-wrap, .tl-name, button, input, select, textarea, .tl-add');
    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !empty(e.target)) return;
      if (!e.target.closest('.tl-track, .tl-inner, .tl-rows') && e.target !== sc) return;
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      m = { id: e.pointerId, x: e.clientX, y: e.clientY, add, keys0: add ? store.selectedKeys.slice() : [], multi0: add ? new Set(store.selectedLayers().map((l) => l.id)) : new Set(), box: null };
      e.preventDefault();
    });
    sc.addEventListener('pointermove', (e) => {
      if (!m || e.pointerId !== m.id) return;
      if (!m.box) {
        if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < 5) return;
        try { sc.setPointerCapture(e.pointerId); } catch { /* ok */ }
        m.box = document.createElement('div'); m.box.className = 'tl-marquee'; document.body.appendChild(m.box);
      }
      const x0 = Math.min(m.x, e.clientX), y0 = Math.min(m.y, e.clientY), x1 = Math.max(m.x, e.clientX), y1 = Math.max(m.y, e.clientY);
      Object.assign(m.box.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      // rola sozinho perto da borda
      const r = sc.getBoundingClientRect();
      if (e.clientX > r.right - 24) sc.scrollLeft += 12; else if (e.clientX < r.left + this.names + 24) sc.scrollLeft -= 12;
      if (e.clientY > r.bottom - 20) sc.scrollTop += 10; else if (e.clientY < r.top + 20) sc.scrollTop -= 10;
      const hit = (el) => { const b = el.getBoundingClientRect(); return b.right >= x0 && b.left <= x1 && b.bottom >= y0 && b.top <= y1; };
      const ids = new Set(m.multi0);
      sc.querySelectorAll('.clip').forEach((c) => { const row = c.closest('[data-layer]'); if (row && hit(c)) ids.add(row.dataset.layer); });
      const keys = m.keys0.slice();
      sc.querySelectorAll('.kf').forEach((k) => {
        if (!hit(k)) return;
        const row = k.closest('[data-layer]'), layer = row && store.layer(row.dataset.layer);
        if (!layer) return;
        const t0 = parseFloat(k.dataset.t);
        const list = k.dataset.act === 'key'
          ? [{ layerId: layer.id, path: k.dataset.path, key: resolveProp(layer, k.dataset.path)?.keys.find((kk) => Math.abs(kk.t - t0) < 1e-4) }]
          : animProps(layer).flatMap(({ path, prop }) => prop.keys.filter((kk) => Math.abs(kk.t - t0) < 1e-4).map((key) => ({ layerId: layer.id, path, key })));
        for (const it of list) if (it.key && !keys.some((s) => s.key === it.key)) keys.push(it);
        ids.add(layer.id);
      });
      m.sel = { ids, keys };
    });
    const end = (e) => {
      if (!m || e.pointerId !== m.id) return;
      const box = m.box, sel = m.sel;
      box?.remove();
      if (!box && !m.add) { store.setKeySelection([]); } // clique simples no vazio: limpa a seleção de keyframes
      if (sel) {
        const ids = [...sel.ids];
        if (!store.multi) store.multi = new Set();
        store.multi = ids.length > 1 ? new Set(ids) : new Set();
        if (ids.length) store.selectedLayerId = ids.includes(store.selectedLayerId) ? store.selectedLayerId : ids[ids.length - 1];
        store.selectedKeys = sel.keys;
        store.emit('selection'); store.emit('keys');
        const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        sc.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => sc.removeEventListener('click', stop, { capture: true }), 50);
      }
      m = null;
    };
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
  }

  layerRows(layer, num, trackW) {
    const { store } = this;
    const sel = store.isSelected(layer.id);
    const props = this.propsOf(layer);
    const open = !isSimpleUI() && this.expanded.has(layer.id); // modo simples: sem as linhas de propriedade do AE (keyframes ficam no clipe)
    const left = this.tToX(layer.inPoint);
    const width = Math.max(4, (layer.outPoint - layer.inPoint) * this.pps);
    const thumb = this.thumbFor(layer);
    const simple = isSimpleUI();
    const color = (simple ? TYPE_COLOR[layer.type] : LABELS[layer.type]) || '#888';
    const dur = layer.outPoint - layer.inPoint;
    const label = layer.type === 'text' && layer.props.text && simple ? String(layer.props.text).replace(/\s+/g, ' ').slice(0, 40) : layer.name;
    const times = new Map();
    for (const { prop } of props) for (const k of prop.keys) {
      const key = k.t.toFixed(4);
      if (!times.has(key)) times.set(key, { t: k.t, sel: false });
      if (store.isKeySelected(k)) times.get(key).sel = true;
    }
    let out = `
      <div class="tl-row layer ${sel ? 'sel' : ''} ${layer.visible ? '' : 'off'}" data-layer="${layer.id}">
        <div class="tl-name" data-act="name">
          ${simple ? `<span class="tbadge" style="--c:${color}" title="${TYPE_NAME[layer.type] || layer.type}">${TYPE_ICON[layer.type] || '•'}</span><span class="tnm">${escapeHtml(TYPE_NAME[layer.type] || '')}</span>` : ''}
          <button class="tw" data-act="expand" aria-label="Propriedades">${props.length || layer.effects.length ? (open ? '▾' : '▸') : ''}</button>
          <button class="eye" data-act="eye" aria-label="Visibilidade">${layer.visible ? '◉' : '○'}</button>
          <span class="lbl" style="background:${color}"></span>
          <span class="num">${num}</span>
          <span class="nm">${layer.missing ? '<span title="Mídia offline: não encontrada neste aparelho. Use Substituir mídia." style="color:#f5a623">⚠ </span>' : ''}${escapeHtml(layer.name)}</span>
        </div>
        <div class="tl-track" style="width:${trackW}px">
          <div class="clip" data-act="clip" style="left:${left}px;width:${width}px;--c:${color};${thumb ? `background-image:url('${thumb}')` : ''}">
            ${layer.type === 'audio' ? '<canvas class="wave"></canvas>' : ''}
            ${layer.effects.length ? `<span class="fxb">fx</span>` : ''}
            <span class="cn">${simple ? '' : `${ICONS[layer.type] || ''} `}${escapeHtml(label)}</span>
            ${sel && simple ? `<span class="dur">${dur < 10 ? dur.toFixed(1) : Math.round(dur)}s</span>` : ''}
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
    this.tc.textContent = isSimpleUI() ? formatSimple(time) : `0:${formatTime(time, fps)}`;
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
      const label = isSimpleUI() ? (step < 1 ? `${(+t.toFixed(2))}s` : `${Math.round(t)}s`) : step < 1 ? `${Math.floor(t + 1e-6)}:${String(Math.round(((t + 1e-6) % 1) * fps) % fps).padStart(2, '0')}f` : `${Math.round(t)}s`;
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
      if (isSimpleUI()) { // agulha branca com bolinha (fácil de achar e de pegar)
        x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, 9, 6, 0, Math.PI * 2); x.fill();
        x.fillRect(cx - 1, 9, 2, 15);
      } else {
        x.fillStyle = '#2d8ceb';
        x.beginPath(); x.moveTo(cx - 6, 0); x.lineTo(cx + 6, 0); x.lineTo(cx + 6, 12); x.lineTo(cx, 18); x.lineTo(cx - 6, 12); x.fill();
      }
    }
  }

  bindRows() {
    this.rows.querySelectorAll('.tl-row').forEach((row) => {
      row.addEventListener('pointerdown', (e) => this.onDown(e, row));
    });
    this.rows.querySelector('[data-act="add-layer"]')?.addEventListener('click', () => this.hooks.onAdd?.());
  }

  snapTimes(exceptLayer) {
    const { project } = this.store;
    const out = [this.store.time, 0, project.duration, ...(project.markers || [])];
    for (const l of this.store.layers) if (l !== exceptLayer) out.push(l.inPoint, l.outPoint);
    return out;
  }

  snap(t, candidates) {
    const tol = 8 / this.pps;
    let best = t, bd = tol;
    for (const c of candidates) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    if (best !== t) this.lastSnap = best;
    return best;
  }

  /** Linha amarela + vibração curta quando o clipe encaixa (como no CapCut). */
  showSnap(t) {
    let g = this.snapGuide;
    if (!g) { g = this.snapGuide = document.createElement('div'); g.className = 'tl-snap'; }
    const host = this.scroll.querySelector('.tl-inner') || this.scroll;
    if (g.parentNode !== host) host.appendChild(g);
    if (t == null) { g.style.display = 'none'; this.snapShown = null; return; }
    g.style.display = 'block'; g.style.left = `${this.names + this.tToX(t)}px`;
    if (this.snapShown !== t) { this.snapShown = t; try { navigator.vibrate?.(8); } catch { /* ok */ } }
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
        } else if (additive || longPress) store.select(layer.id, true);
        else if (layer.id !== store.selectedLayerId || store.multi?.size) store.select(layer.id);
      };
      // toque longo no nome = seleção múltipla (celular)
      let longPress = false;
      const lp = setTimeout(() => { longPress = true; navigator.vibrate?.(15); }, 450);
      row.addEventListener('pointerup', () => clearTimeout(lp), { once: true });
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
      this.lastSnap = null;
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
        if (layer.type === 'group') ensureGroupTime(layer);
        if (layer.type === 'video' || layer.type === 'audio' || layer.type === 'group') {
          const rate = layer.type === 'audio' ? 1 : (layer.props.speed ?? 1);
          if (src0 + (ni - in0) * rate < 0) ni = in0 - src0 / rate;
          layer.props.sourceStart = Math.max(0, src0 + (ni - in0) * rate);
        }
        layer.inPoint = ni;
      } else if (act === 'trim-out') {
        layer.outPoint = Math.min(store.project.duration, Math.max(layer.inPoint + 1 / fps, this.snap(frame(out0 + dt), candidates)));
      }
      clip.style.left = `${this.tToX(layer.inPoint)}px`;
      clip.style.width = `${Math.max(4, (layer.outPoint - layer.inPoint) * this.pps)}px`;
      this.showSnap(this.lastSnap);
      this.hooks.onPreview?.();
    };
    row.onpointerup = () => {
      this.showSnap(null);
      row.onpointermove = null;
      row.onpointerup = null;
      if (moved) store.commit();
    };
  }
}
