// Aba "Transições" (no estilo do CapCut): grade com prévia animada, duração, aplicar no corte e exportar .ffx.
// Traz as transições recriadas das edits de referência + as básicas do Composer.
import { createProject, LAYER_FACTORIES } from './state.js';
import { applyPreset, stretchPreset, presetDuration } from './presets.js';
import { renderFrame } from './renderer.js';
import { composerItems } from './composer.js';
import { EDIT_TRANSITIONS } from './edit-transitions.js';
import { escapeHtml } from './util.js';
import { toast, storage } from './ui.js';
import { getImage } from './media.js';
import { WATERMARKS } from './watermarks.js';

const WM_CAT = 'Marcas d’água';
const MY_CAT = 'Meus efeitos (AE)';
const OV_CAT = 'Overlays das edits';

/** Preset importado (.ffx do AE, Frameify…) usado como transição: camada de ajuste por cima do corte, como no AE. */
function adjOverCut(P, item, cut, d) {
  const adj = LAYER_FACTORIES.adjustment(P);
  adj.name = `Transição · ${item.name}`;
  adj.inPoint = Math.max(0, cut - d / 2); adj.outPoint = Math.min(P.duration, cut + d / 2);
  const d0 = item.preset.duration || presetDuration(item.preset) || d;
  applyPreset(adj, { ...stretchPreset(item.preset, d / d0), anchor: 'playhead' }, adj.inPoint);
  return adj;
}
const WM_KEY = (id) => `motionframe.wm.${id}`;

const PW = 180, PH = 240; // prévia vertical (formato das edits)
const DUR_KEY = 'motionframe.transDur';

let samples = null;
function sampleImages() {
  if (samples) return samples;
  const mk = (c1, c2, label, stripe) => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 480;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 360, 480); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 360, 480);
    g.globalAlpha = 0.18; g.fillStyle = '#fff';
    for (let i = -480; i < 480; i += 46) { g.save(); g.translate(i, 0); g.rotate(stripe); g.fillRect(0, -50, 16, 700); g.restore(); }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(180, 250, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '800 150px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 180, 250);
    g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 26; i++) { g.beginPath(); g.arc((i * 97) % 360, 30 + ((i * 53) % 420), 3 + (i % 4), 0, Math.PI * 2); g.fill(); }
    return c.toDataURL('image/jpeg', 0.85);
  };
  samples = { a: mk('#1f6fe8', '#0b1d47', 'A', 0.4), b: mk('#ff8a2b', '#7a1030', 'B', -0.4) };
  return samples;
}

function previewProject(item, dur, opts) {
  if (item.wm) return previewWM(item, opts);
  const P = createProject(PW, PH); P.duration = dur + 1.0; P.fps = 30; P.background = '#000';
  const s = sampleImages(), cut = 0.5 + dur * 0.4;
  const A = LAYER_FACTORIES.image(P, s.a, PW, PH), B = LAYER_FACTORIES.image(P, s.b, PW, PH);
  for (const l of [A, B]) l.transform.position.value = [PW / 2, PH / 2];
  A.inPoint = 0; A.outPoint = cut; B.inPoint = cut; B.outPoint = P.duration;
  if (item.adj) { P.layers = [adjOverCut(P, item, cut, dur), A, B]; return { P, cut }; }
  const { a, b } = item.make(dur);
  applyPreset(A, a, cut);
  if (b) applyPreset(B, b, cut);
  P.layers = [A, B];
  return { P, cut };
}

function previewWM(item, opts) {
  const P = createProject(PW, PH); P.fps = 30; P.background = '#000';
  const s = sampleImages();
  const A = LAYER_FACTORIES.image(P, s.a, PW, PH), B = LAYER_FACTORIES.image(P, s.b, PW, PH);
  for (const l of [A, B]) l.transform.position.value = [PW / 2, PH / 2];
  if (item.overlay) {
    P.duration = item.dur + 0.6; A.inPoint = 0; A.outPoint = P.duration;
    const ls = item.build(P, opts, 0.3, item.dur, A);
    for (const l of ls) { l.inPoint = 0.3; l.outPoint = 0.3 + item.dur; }
    P.layers = [...ls, A];
    return { P, cut: 0.3 + item.dur * 0.3 };
  }
  if (item.full) {
    P.duration = 3; A.inPoint = 0; A.outPoint = 1.5; B.inPoint = 1.5; B.outPoint = 3;
    P.layers = [...buildWM(item, P, opts, 0, 3), A, B];
  } else {
    P.duration = 0.8 + item.dur; A.inPoint = 0; A.outPoint = 0.8; B.inPoint = 0; B.outPoint = 0;
    P.layers = [...buildWM(item, P, opts, 0.8, item.dur), A];
  }
  return { P, cut: item.full ? 0.7 : 0.8 + item.dur * 0.6 };
}
function buildWM(item, P, opts, t0, d) {
  const ls = item.build(P, opts, t0, d);
  for (const l of ls) { l.inPoint = t0; l.outPoint = t0 + d; l.wmId = item.id; }
  return ls;
}

export class TransitionsPanel {
  constructor(root, store, hooks = {}) {
    this.root = root; this.store = store; this.hooks = hooks;
    this.cat = 'Das edits'; this.sel = null; this.dur = storage.get(DUR_KEY, null);
    this.items = [...EDIT_TRANSITIONS, ...composerItems().filter((x) => x.kind === 'trans').map((x) => ({ ...x, cat: 'Básicas', src: '' })), ...WATERMARKS.map((x) => ({ ...x, cat: x.overlay ? OV_CAT : WM_CAT, wm: true }))];
    this.thumbs = new Map();
    this.render();
  }

  get item() { return this.items.find((x) => x.id === this.sel) || null; }

  render() {
    const mine = (this.hooks.userPresets?.() || []).map((p) => ({ id: `my:${p.id}`, name: p.name, cat: MY_CAT, src: '', adj: true, preset: p, dur: Math.min(1.5, Math.max(0.2, p.duration || presetDuration(p) || 0.5)) }));
    this.items = [...this.items.filter((x) => !x.adj), ...mine];
    const cats = ['Das edits', OV_CAT, 'Básicas', WM_CAT, ...(mine.length ? [MY_CAT] : [])];
    const list = this.items.filter((x) => x.cat === this.cat);
    const it = this.item;
    const d = this.dur ?? it?.dur ?? 0.5;
    this.root.innerHTML = `
      <div class="tr-panel">
        <div class="tr-top">
          <canvas class="tr-big" width="${PW}" height="${PH}"></canvas>
          <div class="tr-info">
            <b>${it ? escapeHtml(it.name) : 'Escolha uma transição'}</b>
            <span class="muted small">${it ? (it.wm ? (it.overlay ? `${it.needsLayer ? 'Selecione o clipe, ' : ''}coloque o playhead no momento e toque em Aplicar (${it.src}).` : it.full ? 'Fica por cima do vídeo inteiro, com os próprios clipes como textura. Edite aqui e toque em Aplicar de novo para atualizar.' : 'Entra depois do último clipe. Edite o @ e toque em Aplicar de novo para atualizar.') : it.adj ? 'Seu efeito importado (.ffx / preset) numa camada de ajuste por cima do corte — como no After Effects.' : it.src ? `Recriada da ${escapeHtml(it.src)}` : 'Transição básica') : 'Selecione o clipe que SAI (o que entra é o que começa logo depois dele) e toque numa transição.'}</span>
            ${it?.wm ? this.wmFields(it) : `<label class="tr-dur">Duração <input type="range" min="0.15" max="1.5" step="0.05" value="${d}" ${it ? '' : 'disabled'}><output>${d.toFixed(2)} s</output></label>`}
            ${it?.wm ? `<div class="tr-actions"><button class="primary" data-act="wm">${this.wmLayers(it).length ? '↻ Atualizar marca' : 'Aplicar'}</button>${this.wmLayers(it).length ? '<button data-act="wmdel" class="danger">Remover</button>' : ''}</div>` : `<div class="tr-actions">
              <button class="primary" data-act="apply" ${it ? '' : 'disabled'}>Aplicar no corte</button>
              <button data-act="all" ${it ? '' : 'disabled'} title="Aplica em todos os cortes da timeline">Em todos os cortes</button>
              ${it?.cat === 'Das edits' ? '<button data-act="ffx">⤓ .ffx (AE)</button>' : ''}
            </div>`}
          </div>
        </div>
        <div class="chips">${cats.map((c) => `<button class="chip ${c === this.cat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}
          <button class="chip" data-act="ffxall" title="Baixa os .ffx de todas as transições das edits">⤓ Todos os .ffx</button></div>
        <div class="tr-grid">${list.map((x) => `<button class="tr-tile ${x.id === this.sel ? 'on' : ''}" data-id="${x.id}"><canvas width="90" height="120"></canvas><span>${escapeHtml(x.name)}</span></button>`).join('')}</div>
      </div>`;
    this.bind();
    this.drawThumbs();
    this.loop();
  }

  bind() {
    const r = this.root;
    r.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat; this.render(); }));
    r.querySelectorAll('.tr-tile').forEach((b) => b.addEventListener('click', () => { this.sel = b.dataset.id; this.dur = null; this.render(); }));
    const rg = r.querySelector('.tr-dur input');
    rg?.addEventListener('input', () => { this.dur = +rg.value; storage.set(DUR_KEY, this.dur); rg.nextElementSibling.textContent = `${this.dur.toFixed(2)} s`; this.anim = null; });
    r.querySelector('[data-act="apply"]')?.addEventListener('click', () => this.apply(false));
    r.querySelector('[data-act="all"]')?.addEventListener('click', () => this.apply(true));
    r.querySelector('[data-act="ffx"]')?.addEventListener('click', () => this.hooks.exportFFX?.([this.item], this.dur ?? this.item.dur));
    r.querySelectorAll('[data-wmf]').forEach((el) => el.addEventListener('input', () => {
      const o = this.wmOpts(this.item); o[el.dataset.wmf] = el.type === 'text' ? el.value : +el.value;
      storage.set(WM_KEY(this.item.id), o); const out = el.nextElementSibling; if (out?.tagName === 'OUTPUT') out.textContent = el.value; this.anim = null;
    }));
    r.querySelector('[data-act="wm"]')?.addEventListener('click', () => this.applyWM());
    r.querySelector('[data-act="wmdel"]')?.addEventListener('click', () => { this.removeWM(this.item); this.store.commit('structure'); toast('Marca removida.', 'ok'); this.render(); });
    r.querySelector('[data-act="ffxall"]')?.addEventListener('click', () => this.hooks.exportFFX?.(EDIT_TRANSITIONS, null));
  }

  async drawThumbs() {
    // as imagens de exemplo precisam estar carregadas antes de desenhar (senão a miniatura sai preta e fica no cache)
    const s = sampleImages();
    await Promise.all([s.a, s.b].map((src) => { const im = getImage(src); return im.complete && im.naturalWidth ? null : new Promise((r) => { im.addEventListener('load', r, { once: true }); setTimeout(r, 1500); }); }));
    const tiles = [...this.root.querySelectorAll('.tr-tile')];
    let i = 0;
    const step = () => {
      // poucas por quadro: a aba abre na hora mesmo com dezenas de transições
      for (let n = 0; n < 3 && i < tiles.length; n++, i++) {
        const b = tiles[i], it = this.items.find((x) => x.id === b.dataset.id), c = b.querySelector('canvas');
        let img = this.thumbs.get(it.id);
        if (!img) {
          try {
            const { P, cut } = previewProject(it, it.dur, it.wm ? this.wmOpts(it) : null);
            img = document.createElement('canvas'); img.width = PW; img.height = PH;
            renderFrame(img.getContext('2d'), P, cut + 0.02, 1, {});
            this.thumbs.set(it.id, img);
          } catch { continue; }
        }
        c.getContext('2d').drawImage(img, 0, 0, 90, 120);
      }
      if (i < tiles.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Prévia grande em loop da transição escolhida. */
  loop() {
    cancelAnimationFrame(this.raf); clearTimeout(this.idleT);
    const c = this.root.querySelector('.tr-big'); if (!c) return;
    const g = c.getContext('2d');
    const it = this.item;
    if (!it) { g.fillStyle = '#111'; g.fillRect(0, 0, PW, PH); g.fillStyle = '#777'; g.font = '13px system-ui'; g.textAlign = 'center'; g.fillText('prévia', PW / 2, PH / 2); return; }
    const t0 = performance.now();
    const tick = () => {
      if (!this.root.isConnected || !c.isConnected) return;
      // painel fechado/escondido: não renderiza (a prévia 3D pesa) — só confere de vez em quando se voltou
      if (c.offsetParent === null || document.hidden) { this.raf = 0; clearTimeout(this.idleT); this.idleT = setTimeout(tick, 400); return; }
      if (!this.anim) this.anim = previewProject(it, this.dur ?? it.dur, it.wm ? this.wmOpts(it) : null);
      const { P } = this.anim;
      const t = ((performance.now() - t0) / 1000) % P.duration;
      try { renderFrame(g, P, t, 1, {}); } catch { /* prévia */ }
      this.raf = requestAnimationFrame(tick);
    };
    this.anim = null;
    tick();
  }

  // ---------------------------------------------------------------- marcas d'água
  wmLayers(it) { return this.store.project.layers.filter((l) => l.wmId === it.id); }
  wmOpts(it) {
    const cur = this.wmLayers(it).find((l) => l.wmOpts)?.wmOpts;
    const def = Object.fromEntries(it.fields.map(([k, , v]) => [k, v]));
    return { ...def, ...(storage.get(WM_KEY(it.id), null) || cur || {}) };
  }
  wmFields(it) {
    const o = this.wmOpts(it);
    return `<div class="tr-wm">${it.fields.map(([k, label, , opt]) => {
      if (Array.isArray(opt) && typeof opt[0] === 'string') return `<label>${escapeHtml(label)} <select data-wmf="${k}">${opt.map((n, i) => `<option value="${i + 1}" ${+o[k] === i + 1 ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>`;
      if (Array.isArray(opt)) return `<label>${escapeHtml(label)} <input type="range" data-wmf="${k}" min="${opt[0]}" max="${opt[1]}" value="${o[k]}"><output>${o[k]}</output></label>`;
      return `<label>${escapeHtml(label)} <input type="text" data-wmf="${k}" value="${escapeHtml(String(o[k] ?? ''))}" maxlength="40"></label>`;
    }).join('')}</div>`;
  }
  removeWM(it) { const P = this.store.project; P.layers = P.layers.filter((l) => l.wmId !== it.id); }
  applyWM() {
    const it = this.item, st = this.store, P = st.project, o = this.wmOpts(it);
    if (it.overlay) {
      const src = st.layer();
      if (it.needsLayer && (!src || !['video', 'image', 'group'].includes(src.type))) { toast('Selecione o clipe (vídeo) onde o overlay vai entrar e coloque o playhead no momento.', 'warn', 5000); return; }
      const t0 = st.time, d = it.dur;
      const ls = it.build(P, o, t0, d, src);
      for (const l of ls) { l.inPoint = t0; l.outPoint = Math.min(P.duration, t0 + d); }
      const i = src ? Math.max(0, st.layers.indexOf(src)) : 0;
      st.layers.splice(i, 0, ...ls);
      st.selectedLayerId = ls[0].id;
      st.commit('structure');
      toast(`“${it.name}” adicionado em ${t0.toFixed(2)} s ✓ (é uma camada normal: edite em Efeitos/Propriedades)`, 'ok', 4500);
      this.hooks.onApplied?.();
      this.render();
      return;
    }
    const had = this.wmLayers(it).length > 0;
    this.removeWM(it);
    const vis = P.layers.filter((l) => l.type !== 'audio' && !l.wmId);
    const end = vis.length ? Math.max(...vis.map((l) => l.outPoint)) : P.duration;
    let t0 = 0, d = P.duration;
    if (!it.full) { t0 = Math.min(end, P.duration); d = it.dur; P.duration = Math.max(P.duration, +(t0 + d).toFixed(3)); }
    else d = Math.max(0.5, end);
    const ls = buildWM(it, P, o, t0, d);
    ls[0].wmOpts = { ...o };
    // de cima para baixo: a lista já vem na ordem do topo
    P.layers.unshift(...ls);
    st.selectedLayerId = ls[0].id;
    st.commit('structure');
    toast(had ? `“${it.name}” atualizada ✓` : `“${it.name}” aplicada ✓ — para mudar, edite aqui e toque em Atualizar.`, 'ok', 4000);
    this.hooks.onApplied?.();
    this.render();
  }

  apply(all) {
    const it = this.item; if (!it) return;
    const d = this.dur ?? it.dur;
    const st = this.store;
    const vis = st.layers.filter((l) => l.type !== 'audio' && l.type !== 'adjustment');
    const pairs = [];
    if (all) {
      for (const a of vis) { const b = vis.find((x) => x !== a && Math.abs(x.inPoint - a.outPoint) < 0.15); if (b) pairs.push([a, b]); }
    } else {
      let a = st.layer();
      if (!a) {
        // sem seleção: corte mais perto do cursor
        let best = null;
        for (const x of vis) { const b = vis.find((y) => y !== x && Math.abs(y.inPoint - x.outPoint) < 0.15); if (b && (!best || Math.abs(x.outPoint - st.time) < Math.abs(best[0].outPoint - st.time))) best = [x, b]; }
        if (best) pairs.push(best);
      } else {
        const b = vis.find((x) => x !== a && Math.abs(x.inPoint - a.outPoint) < 0.15);
        pairs.push([a, b || null]);
      }
    }
    if (!pairs.length) { toast('Não achei um corte: selecione o clipe que sai (o próximo clipe tem que começar no fim dele).', 'warn', 5000); return; }
    if (it.adj) {
      for (const [a] of pairs) { const adj = adjOverCut(st.project, it, a.outPoint, d); st.project.layers.unshift(adj); }
      st.commit('structure');
      toast(pairs.length > 1 ? `“${it.name}” aplicada em ${pairs.length} cortes ✓` : `“${it.name}” aplicada no corte (camada de ajuste) ✓`, 'ok', 4000);
      this.hooks.onApplied?.();
      return;
    }
    for (const [a, b] of pairs) {
      const { a: pa, b: pb } = it.make(d);
      applyPreset(a, pa, a.outPoint);
      if (pb && b) applyPreset(b, pb, b.inPoint);
    }
    st.commit('structure');
    toast(pairs.length > 1 ? `“${it.name}” aplicada em ${pairs.length} cortes ✓` : pairs[0][1] ? `“${it.name}” entre “${pairs[0][0].name}” e “${pairs[0][1].name}” ✓` : `“${it.name}”: só a saída foi aplicada (nenhum clipe começa logo depois de “${pairs[0][0].name}”).`, 'ok', 4000);
    this.hooks.onApplied?.();
  }
}
