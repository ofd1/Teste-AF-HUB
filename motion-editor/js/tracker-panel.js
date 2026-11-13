// Painel Tracker (como o do After Effects): Track Motion / Face Track / Stabilize Motion, Motion Source,
// Current Track, Position/Rotation/Scale, Edit Target, Analyze ◀◀ ◀ ▶ ▶▶, Reset e Apply.
// Os rastros ficam guardados na camada (layer.tracks) e aparecem no preview (caixa + caminho), como no AE.
import { analyzePoint, applyPointTrack, localToComp, compToLocal, releaseAnalysisVideo } from './tracker.js';
import { analyzeFace, faceSamplesToTrack, applyFaceFollow, applyFaceCamera, applyPointCamera, ensureFaceModel, ensureFaceLandmarker, FACE_FEATURES, faceTrackPointNulls } from './facetrack.js';
import { LAYER_FACTORIES, flatLayers } from './state.js';
import { modal, toast } from './ui.js';
import { uid } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class TrackerPanel {
  /** cb: { pick(): Promise<[x,y]>, redraw(), pause(), stabilize(layer), setTime(t) } */
  constructor(store, cb) {
    this.store = store; this.cb = cb;
    this.el = document.createElement('div');
    this.el.className = 'trk-panel';
    this.el.hidden = true;
    document.getElementById('stage').appendChild(this.el);
    this.layer = null; this.track = null; this.busy = false; this.cancel = false;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    store.on((k) => { if (!this.el.hidden && (k === 'structure' || k === 'time')) this.updateStatus(); });
  }

  get fps() { return this.store.project.fps || 30; }
  sources() { return flatLayers(this.store.layers).filter((l) => l.type === 'video'); }

  /** Abre o painel na camada. kind: 'point' | 'face' cria uma trilha nova se a camada ainda não tiver desse tipo. */
  async open(layer, kind) {
    this.cb.pause();
    this.el.hidden = false;
    this.layer = layer;
    layer.tracks = layer.tracks || [];
    this.track = layer.tracks.find((t) => t.kind === kind) || null;
    this.render();
    if (!this.track) await this.newTrack(kind);
    if (kind === 'face') ensureFaceModel().catch(() => {});
  }
  close() { this.cancel = true; this.el.hidden = true; releaseAnalysisVideo(); this.cb.redraw(); }

  async newTrack(kind) {
    const l = this.layer;
    if (!l) return;
    const n = l.tracks.filter((t) => t.kind === kind).length + 1;
    const tr = { id: uid('tk'), kind, name: kind === 'face' ? `Face Track ${n}` : `Tracker ${n}`, samples: [], target: null, position: true, rotation: false, scale: false, applyAs: 'camera', faceFrac: 40, smooth: 45, feature: 1, search: 1 };
    const t = this.snap(this.store.time);
    if (kind === 'point') {
      toast('Toque no ponto que quer rastrear (Track Point). Escolha algo com detalhe: número da camisa, olho, canto.', 'info', 5000);
      const p = await this.cb.pick();
      if (!p) return;
      tr.samples.push({ t, ...compToLocal(l, t, p[0], p[1]), conf: 1 });
    }
    l.tracks.push(tr);
    this.track = tr;
    this.store.commit('change');
    this.render();
  }

  snap(t) { return Math.round(t * this.fps) / this.fps; }
  /** Amostra mais perto do tempo t (para começar a análise de onde o rastro está). */
  near(t) {
    const s = this.track?.samples || [];
    let best = null;
    for (const x of s) if (!best || Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
    return best;
  }
  upsert(s) {
    const arr = this.track.samples, i = arr.findIndex((x) => Math.abs(x.t - s.t) < 0.5 / this.fps);
    if (i >= 0) arr[i] = s; else arr.push(s);
  }

  render() {
    const l = this.layer, tr = this.track;
    const srcs = this.sources();
    const tracks = l?.tracks || [];
    const targetName = this.targetName();
    const isFace = tr?.kind === 'face';
    this.el.innerHTML = `
      <header><b>Tracker</b><button data-a="close" title="Fechar">✕</button></header>
      <div class="trk-btns">
        <button data-a="new-point">Track Motion</button><button data-a="new-face">Face Track</button><button data-a="stab">Stabilize Motion</button>
      </div>
      <label class="trk-row"><span>Motion Source:</span><select data-f="src">${srcs.map((s) => `<option value="${s.id}" ${s === l ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="trk-row"><span>Current Track:</span><select data-f="track">${tracks.map((t) => `<option value="${t.id}" ${t === tr ? 'selected' : ''}>${esc(t.name)}</option>`).join('') || '<option>—</option>'}</select></label>
      ${isFace ? `<label class="trk-row"><span>Track Type:</span><select data-f="detailed"><option value="1" ${tr.detailed !== false ? 'selected' : ''}>Face Tracking (Detailed Features)</option><option value="0" ${tr.detailed === false ? 'selected' : ''}>Face Tracking (Outline Only)</option></select></label>
      <label class="trk-row"><span>Seguir:</span><select data-f="part" ${tr.detailed === false ? 'disabled' : ''}>${FACE_FEATURES.map(([k, n]) => `<option value="${k}" ${(tr.part || 'centro') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="trk-row trk-two"><label>Desloc. X % <input type="number" data-f="offX" step="5" value="${tr.offX || 0}" style="width:64px"></label><label>Y % <input type="number" data-f="offY" step="5" value="${tr.offY || 0}" style="width:64px"></label></div>` : '<div class="trk-row"><span>Track Type:</span><b>Transform</b></div>'}
      <div class="trk-checks">
        <label><input type="checkbox" data-f="position" ${tr?.position ? 'checked' : ''}> Position</label>
        <label title="${isFace ? '' : 'Rotação e escala precisam de face tracking'}"><input type="checkbox" data-f="rotation" ${tr?.rotation ? 'checked' : ''} ${isFace ? '' : 'disabled'}> Rotation</label>
        <label><input type="checkbox" data-f="scale" ${tr?.scale ? 'checked' : ''} ${isFace ? '' : 'disabled'}> Scale</label>
      </div>
      <label class="trk-row"><span>Aplicar como:</span><select data-f="applyAs"><option value="camera" ${tr?.applyAs !== 'follow' ? 'selected' : ''}>🎥 Câmera segue o ponto</option><option value="follow" ${tr?.applyAs === 'follow' ? 'selected' : ''}>Outra camada segue (Edit Target)</option></select></label>
      <div class="trk-row"><span>Motion Target:</span><b class="trk-target">${esc(targetName)}</b></div>
      <div class="trk-row trk-two"><button data-a="target">Edit Target…</button><button data-a="options">Options…</button></div>
      <div class="trk-row trk-two"><button data-a="setpoint">Mover Track Point</button><span class="muted small">${isFace ? 'toque no ponto do rosto a seguir' : 'toque no preview'}</span></div>
      <div class="trk-row trk-analyze"><span>Analyze:</span>
        <button data-a="an" data-d="-all" title="Analisar para trás até o início">◀◀</button>
        <button data-a="an" data-d="-1" title="Um quadro para trás">◀</button>
        <button data-a="an" data-d="1" title="Um quadro para frente">▶</button>
        <button data-a="an" data-d="all" title="Analisar para frente até o fim">▶▶</button>
        <button data-a="stop" title="Parar" ${this.busy ? '' : 'disabled'}>■</button>
      </div>
      <div class="trk-row trk-two"><button data-a="reset">Reset</button><button data-a="apply" class="primary">Apply</button></div>
      ${isFace && tr.detailed !== false ? '<div class="trk-row"><button data-a="points" title="Cria um Null por ponto do rosto (como os Face Track Points do AE)">Face Track Points → Nulls</button></div>' : ''}
      <div class="trk-status muted small"></div>`;
    this.updateStatus();
  }

  /** Ponto tocado → parte do rosto mais perto + deslocamento (em % do rosto, no sentido da cabeça). */
  fitAttach() {
    const tr = this.track, at = tr?.attach;
    if (!at) return;
    const smp = tr.samples.filter((x) => x.ok !== false && x.pts).sort((a, b) => Math.abs(a.t - at.t) - Math.abs(b.t - at.t))[0];
    if (!smp) return;
    const cands = [['centro', [smp.lx, smp.ly]], ...Object.entries(smp.pts)];
    const [part, q] = cands.sort((a, b) => Math.hypot(a[1][0] - at.lx, a[1][1] - at.ly) - Math.hypot(b[1][0] - at.lx, b[1][1] - at.ly))[0];
    const a = ((smp.angle || 0) * Math.PI) / 180, dx = at.lx - q[0], dy = at.ly - q[1];
    const size = smp.lsize || 100;
    tr.part = part;
    tr.offX = Math.round(((dx * Math.cos(a) + dy * Math.sin(a)) / size) * 1000) / 10;
    tr.offY = Math.round(((-dx * Math.sin(a) + dy * Math.cos(a)) / size) * 1000) / 10;
  }

  targetName() {
    const tr = this.track;
    if (!tr) return '—';
    if (tr.applyAs !== 'follow') return `${this.layer?.name || ''} (câmera segue o ponto)`;
    if (!tr.target) return 'Nenhum (escolha em Edit Target)';
    if (tr.target === '__text') return 'Novo texto';
    if (tr.target === '__null') return 'Novo Null';
    return flatLayers(this.store.layers).find((l) => l.id === tr.target)?.name || 'camada apagada';
  }

  updateStatus() {
    const st = this.el.querySelector('.trk-status');
    if (!st) return;
    const s = this.track?.samples || [];
    if (!s.length) { st.textContent = this.track?.kind === 'face' ? 'Clique em ▶▶ para analisar o rosto a partir do playhead.' : 'Defina o Track Point e clique em ▶▶.'; return; }
    const ts = s.map((x) => x.t), a = Math.min(...ts), b = Math.max(...ts);
    const cur = this.near(this.store.time);
    const conf = cur && Math.abs(cur.t - this.store.time) < 0.6 / this.fps ? ` · confiança ${Math.round((cur.conf ?? 1) * 100)}%${cur.ok === false ? ' (rosto perdido)' : ''}` : '';
    st.textContent = `${this.busy ? 'Analisando… ' : ''}${s.length} quadros (${a.toFixed(2)}s – ${b.toFixed(2)}s)${conf}`;
  }

  async onChange(e) {
    const f = e.target.dataset.f;
    if (!f) return;
    if (f === 'src') { const l = this.sources().find((x) => x.id === e.target.value); if (l) { this.layer = l; l.tracks = l.tracks || []; this.track = l.tracks[0] || null; this.render(); this.cb.redraw(); } return; }
    if (f === 'track') { this.track = this.layer.tracks.find((t) => t.id === e.target.value) || this.track; this.render(); this.cb.redraw(); return; }
    if (this.track && ['position', 'rotation', 'scale'].includes(f)) { this.track[f] = e.target.checked; this.store.commit('change'); }
    if (this.track && f === 'detailed') { this.track.detailed = e.target.value === '1'; if (this.track.detailed) ensureFaceLandmarker().catch(() => {}); this.store.commit('change'); this.render(); this.cb.redraw(); }
    if (this.track && f === 'part') { this.track.part = e.target.value; this.store.commit('change'); this.cb.redraw(); }
    if (this.track && f === 'applyAs') { this.track.applyAs = e.target.value; this.store.commit('change'); this.render(); return; }
    if (this.track && (f === 'offX' || f === 'offY')) { this.track[f] = +e.target.value || 0; this.store.commit('change'); this.cb.redraw(); }
  }

  async onClick(e) {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') return this.close();
    if (a === 'stop') {
      this.cancel = true;
      // se a análise estiver presa esperando algo, libera o painel mesmo assim
      setTimeout(() => { if (this.busy) { this.busy = false; window.__mfAnalyzing = false; this.render(); this.cb.redraw(); } }, 1500);
      return;
    }
    if (this.busy) { toast('Analisando… toque em ■ para parar antes de usar outro botão.', 'info', 2500); return; }
    if (a === 'new-point') return this.newTrack('point');
    if (a === 'new-face') { ensureFaceModel().catch(() => {}); return this.newTrack('face'); }
    if (a === 'stab') { this.close(); return this.cb.stabilize(this.layer); }
    if (!this.track) return;
    if (a === 'target') return this.editTarget();
    if (a === 'options') return this.options();
    if (a === 'setpoint' && this.track.kind === 'face') {
      // Face Track com ponto escolhido (como o Track Point): o toque vira "parte do rosto mais perto + deslocamento"
      const p = await this.cb.pick();
      if (!p) return;
      const t = this.snap(this.store.time);
      const loc = compToLocal(this.layer, t, p[0], p[1]);
      this.track.attach = { t, lx: loc.lx, ly: loc.ly };
      if (this.track.detailed === false) this.track.detailed = true;
      this.fitAttach();
      this.store.commit('change'); this.render(); this.cb.redraw();
      toast(this.track.samples.some((x) => x.pts) ? 'Ponto definido: o tracker segue esse lugar do rosto.' : 'Ponto marcado. Agora analise (▶▶): o tracker segue o rosto tocado, nesse lugar.', 'ok', 4000);
      return;
    }
    if (a === 'setpoint') {
      const p = await this.cb.pick();
      if (!p) return;
      const t = this.snap(this.store.time);
      this.upsert({ t, ...compToLocal(this.layer, t, p[0], p[1]), conf: 1 });
      this.cb.redraw(); this.updateStatus();
      return;
    }
    if (a === 'reset') {
      const keep = this.track.kind === 'point' ? this.near(this.store.time) : null;
      this.track.samples = keep ? [{ ...keep, t: this.snap(this.store.time) }] : [];
      this.store.commit('change'); this.cb.redraw(); this.updateStatus();
      return;
    }
    if (a === 'an') return this.analyze(b.dataset.d);
    if (a === 'apply') return this.apply();
    if (a === 'points') {
      try {
        const nulls = faceTrackPointNulls(this.layer, this.track.samples, this.store.project, LAYER_FACTORIES, Math.max(0.05, 1 - (this.track.smooth ?? 45) / 100));
        for (const n of nulls.reverse()) this.store.layers.unshift(n);
        this.store.commit('structure');
        toast(`${nulls.length} Nulls criados (um por ponto do rosto). Parenteie camadas a eles para seguir olhos, boca, queixo…`, 'ok', 5000);
      } catch (err) { toast(`Tracker: ${err.message}`, 'warn', 5000); }
    }
  }

  async editTarget() {
    const tr = this.track, l = this.layer;
    const others = flatLayers(this.store.layers).filter((x) => x !== l && x.type !== 'audio');
    const opts = [['__text', 'Novo texto'], ['__null', 'Novo Null (para parentear outras camadas)'], ...others.map((x) => [x.id, x.name])];
    if (tr.kind === 'face') opts.unshift(['__camera', `Câmera no rosto — reenquadra “${l.name}”`]);
    const cur = tr.kind === 'face' && tr.applyAs === 'camera' ? '__camera' : tr.target;
    const v = await modal('Motion Target', `
      <p class="muted small">Aplicar o movimento a:</p>
      <label class="row"><span>Camada</span><select data-f="t">${opts.map(([id, n]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`,
    [{ label: 'Cancelar', value: null }, { label: 'OK', primary: true, value: (w) => w.querySelector('[data-f="t"]').value }]);
    if (!v) return;
    if (v === '__camera') tr.applyAs = 'camera'; else { tr.applyAs = 'follow'; tr.target = v; }
    this.store.commit('change');
    this.render();
  }

  async options() {
    const tr = this.track, face = tr.kind === 'face';
    const v = await modal('Tracker Options', face ? `
      <label class="row"><span>Suavização %</span><input type="number" data-f="smooth" min="0" max="95" value="${tr.smooth ?? 45}"></label>
      <label class="row"><span>Câmera: tamanho do rosto na tela %</span><input type="number" data-f="faceFrac" min="5" max="100" value="${tr.faceFrac ?? 40}"></label>
      <label class="row"><span>Câmera: intensidade %</span><input type="number" data-f="follow" min="0" max="100" value="${tr.follow ?? 100}"></label>
      <p class="muted small">Na câmera no rosto, “Rotation” endireita a cabeça e “Scale” mantém o rosto do mesmo tamanho.</p>` : `
      <label class="row"><span>Feature Region (tamanho)</span><input type="number" data-f="feature" min="0.4" max="3" step="0.1" value="${tr.feature ?? 1}"></label>
      <label class="row"><span>Search Region (tamanho)</span><input type="number" data-f="search" min="0.4" max="4" step="0.1" value="${tr.search ?? 1}"></label>
      <p class="muted small">Região maior = segue melhor detalhes grandes e movimentos rápidos, mas analisa mais devagar.</p>`,
    [{ label: 'Cancelar', value: null }, { label: 'OK', primary: true, value: (w) => Object.fromEntries([...w.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, +i.value])) }]);
    if (!v) return;
    Object.assign(tr, v);
    this.store.commit('change');
    this.cb.redraw();
  }

  /** Analyze: 'all' / '-all' até o fim/início da camada; '1' / '-1' um quadro. */
  async analyze(d) {
    const l = this.layer, tr = this.track, fps = this.fps;
    const t0 = this.snap(Math.max(l.inPoint, Math.min(this.store.time, l.outPoint - 1 / fps)));
    const dir = d.startsWith('-') ? -1 : 1;
    const end = d.endsWith('all') ? (dir > 0 ? l.outPoint - 1 / fps : l.inPoint) : t0 + dir / fps;
    const n = Math.max(1, Math.round(Math.abs(end - t0) * fps) + 1);
    const times = Array.from({ length: n }, (_, i) => +(t0 + (dir * i) / fps).toFixed(5)).filter((t) => t >= l.inPoint - 1e-6 && t <= l.outPoint);
    if (times.length < 2 && tr.kind === 'point') return;
    const seed = this.near(t0);
    if (tr.kind === 'point' && !seed) { toast('Defina o Track Point primeiro (Mover Track Point).', 'warn'); return; }
    this.busy = true; this.cancel = false; this.render();
    const run = this.run = {};
    let lastT = t0, lastUI = 0;
    window.__mfAnalyzing = true;
    const onFrame = (s) => {
      this.upsert(s); lastT = s.t;
      // a prévia acompanha só ~4×/s (antes re-renderizava todos os efeitos a cada 2 quadros e travava)
      const now = performance.now();
      if (now - lastUI > 250 || times.length < 4) { lastUI = now; this.cb.setTime(s.t); this.cb.redraw(); this.updateStatus(); }
    };
    try {
      if (tr.kind === 'point') {
        await analyzePoint({ layer: l, project: this.store.project, times, start: seed, featureK: tr.feature ?? 1, searchK: tr.search ?? 1, onFrame, isCancelled: () => this.cancel });
      } else {
        let hint = seed && Math.abs(seed.t - t0) < 2 / fps && seed.ok !== false ? seed : null;
        if (!hint && tr.attach) hint = { lx: tr.attach.lx, ly: tr.attach.ly };
        await analyzeFace({ layer: l, project: this.store.project, times, hintLocal: hint, onFrame, isCancelled: () => this.cancel, detailed: tr.detailed !== false });
      }
      this.cb.setTime(lastT);
    } catch (e) {
      toast(`Tracker: ${e.message}`, 'error', 5000);
    } finally {
      if (this.run !== run) return; // outra análise já começou depois do Stop forçado
      this.busy = false; window.__mfAnalyzing = false;
      if (tr.kind === 'face' && tr.attach) this.fitAttach();
      this.store.commit('change');
      this.render(); this.cb.redraw();
    }
  }

  async apply() {
    const l = this.layer, tr = this.track, P = this.store.project;
    if (tr.samples.length < 2) { toast('Analise o movimento antes de aplicar (▶▶).', 'warn'); return; }
    try {
      let n = 0;
      if (tr.applyAs !== 'follow') {
        const follow = Math.max(0, Math.min(1, (tr.follow ?? 100) / 100));
        if (tr.kind === 'face') {
          const track = faceSamplesToTrack(l, tr.samples, Math.max(0.05, 1 - (tr.smooth ?? 45) / 100), { part: tr.part || 'centro', offset: [tr.offX || 0, tr.offY || 0] });
          n = applyFaceCamera(l, track, P, { faceFrac: Math.max(0.05, (tr.faceFrac ?? 40) / 100), follow, level: !!tr.rotation, scale: !!tr.scale });
        } else n = applyPointCamera(l, tr.samples, P, { smoothAmt: Math.max(0.05, 1 - (tr.smooth ?? 45) / 100), follow });
        this.store.selectedLayerId = l.id;
      } else {
        let dims = 'xy';
        if (tr.kind === 'point') {
          const r = await modal('Motion Tracker Apply Options', `<label class="row"><span>Apply Dimensions</span><select data-f="d"><option value="xy">X and Y</option><option value="x">X only</option><option value="y">Y only</option></select></label>`,
            [{ label: 'Cancelar', value: null }, { label: 'OK', primary: true, value: (w) => w.querySelector('[data-f="d"]').value }]);
          if (!r) return;
          dims = r;
        }
        const target = this.resolveTarget();
        if (!target) { await this.editTarget(); if (!this.track.target) return; return this.apply(); }
        if (tr.kind === 'face') {
          const track = faceSamplesToTrack(l, tr.samples, Math.max(0.05, 1 - (tr.smooth ?? 45) / 100), { part: tr.part || 'centro', offset: [tr.offX || 0, tr.offY || 0] });
          if (target._new) target.transform.position.value = (tr.part && tr.part !== 'centro') || tr.offX || tr.offY ? [track[0].x, track[0].y] : [track[0].x, track[0].y - track[0].size * 0.9];
          n = applyFaceFollow(target, track, { position: tr.position, scale: tr.scale, rotation: tr.rotation });
        } else {
          if (target._new) { const s0 = tr.samples.slice().sort((a, b) => a.t - b.t)[0]; target.transform.position.value = localToComp(l, s0.t, s0.lx, s0.ly); }
          n = tr.position ? applyPointTrack(l, target, tr.samples, dims) : 0;
        }
        delete target._new;
        this.store.selectedLayerId = target.id;
      }
      this.store.commit('structure');
      toast(`Apply: ${n} keyframes criados.`, 'ok', 3500);
    } catch (e) { toast(`Tracker: ${e.message}`, 'error', 5000); }
  }

  resolveTarget() {
    const tr = this.track, P = this.store.project, l = this.layer;
    if (!tr.target) return null;
    if (tr.target === '__text' || tr.target === '__null') {
      const t = tr.target === '__text' ? LAYER_FACTORIES.text(P) : LAYER_FACTORIES.null(P);
      if (tr.target === '__text') { t.props.text = 'TEXTO'; t.props.fontSize = 70; }
      t.name = `${tr.target === '__text' ? 'Texto' : 'Null'} · ${tr.name}`;
      t.inPoint = l.inPoint; t.outPoint = l.outPoint; t._new = true;
      this.store.layers.unshift(t);
      tr.target = t.id;
      return t;
    }
    return flatLayers(this.store.layers).find((x) => x.id === tr.target) || null;
  }

  /** Desenha o rastro no preview (como no AE): caminho com pontos por quadro e a caixa no quadro atual. */
  drawOverlay(octx, k, dpr) {
    if (this.el.hidden || !this.layer || !this.track) return;
    const l = this.layer, tr = this.track, t = this.store.time;
    const s = tr.samples.slice().sort((a, b) => a.t - b.t);
    octx.save();
    octx.lineWidth = 1.5 * dpr;
    if (s.length > 1) {
      octx.strokeStyle = 'rgba(255,214,0,0.75)';
      octx.beginPath();
      s.forEach((p, i) => { const [x, y] = localToComp(l, p.t, p.lx, p.ly); if (i) octx.lineTo(x * k, y * k); else octx.moveTo(x * k, y * k); });
      octx.stroke();
      octx.fillStyle = 'rgba(255,214,0,0.9)';
      for (const p of s) { const [x, y] = localToComp(l, p.t, p.lx, p.ly); octx.fillRect(x * k - 1.5 * dpr, y * k - 1.5 * dpr, 3 * dpr, 3 * dpr); }
    }
    const cur = this.near(t);
    if (cur) {
      const [x, y] = localToComp(l, t, cur.lx, cur.ly);
      const exact = Math.abs(cur.t - t) < 0.6 / this.fps;
      const m = l.transform ? Math.abs(localToComp(l, t, cur.lx + 1, cur.ly)[0] - x) || 1 : 1;
      octx.strokeStyle = exact ? (cur.ok === false ? '#e5534b' : '#ffd600') : 'rgba(255,214,0,0.45)';
      octx.translate(x * k, y * k);
      if (tr.kind === 'face') {
        const half = (cur.lsize || 100) * m * k * 0.5;
        octx.rotate(((cur.angle || 0) * Math.PI) / 180);
        octx.strokeRect(-half, -half * 1.2, half * 2, half * 2.4);
        octx.beginPath(); octx.moveTo(-half * 0.45, -half * 0.25); octx.lineTo(half * 0.45, -half * 0.25); octx.stroke(); // linha dos olhos
        if (cur.pts && exact) {
          // pontos do Detailed Features (o escolhido em destaque, com o deslocamento)
          octx.setTransform(1, 0, 0, 1, 0, 0);
          for (const [key, q] of Object.entries(cur.pts)) {
            const [px, py] = localToComp(l, t, q[0], q[1]);
            const selp = key === (tr.part || 'centro');
            octx.fillStyle = selp ? '#ffd600' : 'rgba(80,220,255,0.9)';
            const r = (selp ? 4 : 2.2) * dpr; octx.fillRect(px * k - r, py * k - r, r * 2, r * 2);
          }
          const tk = faceSamplesToTrack(l, [cur, { ...cur, t: cur.t + 1e-3 }], 1, { part: tr.part || 'centro', offset: [tr.offX || 0, tr.offY || 0] })[0];
          if (tk) { octx.strokeStyle = '#ffd600'; octx.beginPath(); octx.arc(tk.x * k, tk.y * k, 7 * dpr, 0, Math.PI * 2); octx.moveTo(tk.x * k - 11 * dpr, tk.y * k); octx.lineTo(tk.x * k + 11 * dpr, tk.y * k); octx.moveTo(tk.x * k, tk.y * k - 11 * dpr); octx.lineTo(tk.x * k, tk.y * k + 11 * dpr); octx.stroke(); }
        }
      } else {
        const vw = this.layer.props.width || this.store.project.width;
        const R = (vw / 28) * (tr.feature ?? 1) * m * k, S = R + (vw / 12) * (tr.search ?? 1) * m * k;
        octx.strokeRect(-R, -R, R * 2, R * 2); // Feature Region
        octx.setLineDash([4 * dpr, 3 * dpr]); octx.strokeRect(-S, -S, S * 2, S * 2); octx.setLineDash([]); // Search Region
        octx.beginPath(); octx.moveTo(-4 * dpr, 0); octx.lineTo(4 * dpr, 0); octx.moveTo(0, -4 * dpr); octx.lineTo(0, 4 * dpr); octx.stroke(); // Attach Point
      }
    }
    octx.restore();
  }
}
