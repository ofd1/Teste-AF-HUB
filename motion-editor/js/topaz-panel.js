// Painel "Topaz" (estilo Topaz Video AI): Aprimoramento (modelos + controles do Proteus), Interpolação de quadros
// (Apollo/Chronos: câmera lenta, fps, quadros duplicados), Estabilização e Saída.
import { createEffectInstance } from './presets.js';
import { migrateTopazFx } from './fx/topaz.js';
import { TZ_MODELS, FI_MODELS, topazValues } from './fx/topaz.js';
import { estimateFromImage } from './topaz-estimate.js';
import { renderFrame } from './renderer.js';
import { getVideo } from './media.js';
import { evalParams } from './renderer.js';
import { stabilizeLayer } from './stabilize.js';
import { valueAt } from './anim.js';
import { escapeHtml } from './util.js';
import { toast, pickFiles } from './ui.js';

/** Preset salvo pelo Topaz Video (.json em …\\Topaz Video AI\\presets): aprimoramento + interpolação. */
export function topazPresetToSettings(json) {
  const st = json?.settings || {};
  const e = st.enhance || {}, sm = st.slowmo || {};
  if (!e.model && !sm.model) throw new Error('não parece um preset do Topaz Video');
  return {
    name: json.name || 'Topaz',
    enhance: e.active ? { compression: e.compress ?? 0, details: e.detail ?? 0, sharpen: e.sharpen ?? 0, noise: e.denoise ?? 0, dehalo: e.dehalo ?? 0, aa: e.deblur ?? 0, addNoise: Math.min(10, e.addNoise ?? 0), recoverOriginal: e.recoverOriginalDetailValue ?? 0, grainAmount: Math.min(10, e.grain ?? 0), grainSize: Math.max(1, Math.min(5, e.grainSize ?? 1.5)), focusFix: ({ Off: 1, Normal: 2, Strong: 3 })[e.focusFixLevel] || 1, model: e.model, auto: e.auto === 'Auto' || e.auto === true, quality: e.videoType ?? null } : null,
    dedupe: !!(sm.active && sm.duplicate), dupSens: sm.duplicateThreshold != null ? Math.round(sm.duplicateThreshold * (sm.duplicateThreshold <= 1 ? 100 : 1)) : null, slowmo: sm.active ? Math.max(1, sm.factor || 1) : 1, interp: !!sm.active, fiModel: sm.model || null,
  };
}

// sliders do plugin (chave do efeito, nome no plugin, ajuda)
const SLIDERS = [
  ['compression', 'Fix Compression', 'Tira blocos e borrões de compressão (TikTok/IG/WhatsApp).'],
  ['details', 'Improve Detail', 'Recupera textura (cabelo, pele, tecido).'],
  ['sharpen', 'Sharpen', 'Nitidez adaptativa, sem serrilhado.'],
  ['noise', 'Reduce Noise', 'Remove ruído preservando as bordas.'],
  ['largeGrain', 'Reduce Large Grain', 'Grão grosso de filme/ISO alto (Nyx).'],
  ['dehalo', 'Dehalo', 'Tira halos claros/escuros nas bordas.'],
  ['aa', 'Anti-Alias/Deblur', 'Negativo suaviza serrilhado; positivo tira desfoque.'],
];
const AUTO_KEY = { compression: 'c', details: 'd', sharpen: 's', noise: 'n', dehalo: 'h', aa: 'a' };
const MODEL_BY_NAME = (n) => { const s = String(n || '').toLowerCase(); const code = s.slice(0, 3); return ({ pro: 1, pra: 1, iri: 2, nyx: 3, nxf: 10, ahq: 4, amq: 4, alq: 4, aaa: 9, thm: 5, thd: 5, thf: 5, dtd: 6, dtv: 12, ddv: 11, gcg: 14, ghq: 14, rhe: 15 })[code] || (s.includes('halo') && s.startsWith('a') ? 8 : 1); };
const SLOWMO = [[1, 'Desligada'], [2, '2× (50%)'], [4, '4× (25%)'], [8, '8× (12,5%)'], [16, '16× (6,25%)']];

export class TopazPanel {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.strength = 60; this.mode = 1; this.jitter = false; this.busy = false;
    store.on((kind) => { if (!['time', 'preview', 'keyspreview'].includes(kind) && !this.dragging) this.render(); });
    this.render();
  }

  get layer() { const l = this.store.layer(); return l && l.type === 'video' ? l : null; }
  fx(type) { return this.layer?.effects.find((f) => f.type === type) || null; }

  render() {
    if (!this.root.isConnected) return;
    const l = this.layer;
    if (!l) { this.root.innerHTML = '<div class="empty-note">Selecione um <b>clipe de vídeo</b> para usar o Topaz (melhorar, câmera lenta, estabilizar).</div>'; return; }
    const tz = this.fx('topaz');
    const pv = (k) => (tz ? valueAt(tz.params[k], this.store.time) : 0);
    void pv;
    const tw = this.fx('twixtor'), fi = this.fx('topazFI');
    const slow = fi ? [1, 2, 4, 8, 16, 32][(fi.params.slowmo.value | 0) - 1] || 1 : tw && !tw.params.speed.keys?.length ? Math.round(100 / Math.max(1, tw.params.speed.value)) : 1;
    const dup = !!(l.props.dedupe || fi?.params.removeDup?.value);
    const sens = Math.round(fi ? fi.params.sensitivity.value : l.props.dupSens ?? 20);
    const st = this.fx('stabilize');
    this.root.innerHTML = `
      <div class="tz-head">✨ <b>Topaz</b> · ${escapeHtml(l.name)} <span class="muted small">(recriação em GPU com os controles do Topaz Video AI)</span></div>

      <section class="tz-sec">
        <button class="wide" data-tz="importPreset">⤒ Importar preset do Topaz (.json)</button>
        <label class="tz-title"><span class="switch"><input type="checkbox" data-tz="enh" ${tz?.enabled ? 'checked' : ''}><i></i></span> <b>Aprimoramento</b> <span class="muted small">— upscale/limpeza</span></label>
        ${tz ? (() => {
          const P = evalParams(tz, this.store.time), V = topazValues(P), m = V.model, mode = P.paramMode || 1;
          const fixed = false; // todos os modelos ajustáveis
          const keys = SLIDERS.filter(([k]) => (m.sliders === 'nyx' ? k !== 'details' : k !== 'largeGrain'));
          const opt = (key, list, cur) => `<select data-tzs="${key}">${list.map((n, i) => `<option value="${i + 1}" ${cur === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
          const sl = ([k, name, help]) => {
            const auto = k === 'largeGrain' ? V.largeGrain : V[AUTO_KEY[k]];
            const ra = mode === 2 && !fixed, man = mode === 3 && !fixed;
            const key = ra ? `ra_${k}` : k, val = ra ? P[`ra_${k}`] ?? 0 : man ? P[k] : auto;
            const min = ra || k === 'aa' ? -100 : 0;
            return `<div class="tz-row ${ra || man ? '' : 'locked'}"><div><b>${name}</b>${ra ? ` <span class="muted small">auto ${Math.round(auto - (P[`ra_${k}`] ?? 0))} → ${Math.round(auto)}</span>` : ''}<span class="muted small"> ${help}</span></div>
              <div class="tz-ctl"><input type="range" min="${min}" max="100" step="1" data-tzp="${key}" value="${Math.round(val)}" ${ra || man ? '' : 'disabled'}><output>${Math.round(val)}</output></div></div>`;
          };
          return `
          <label class="row"><span>AI Model</span>${opt('model', TZ_MODELS.map((x) => x.name), V.modelIndex)}</label>
          <label class="row"><span>Input Quality</span>${opt('inputQuality', ['LQ (baixa)', 'MQ (média)', 'HQ (alta)'], P.inputQuality || 2)}</label>
          <label class="row"><span>Output Resolution</span>${opt('upscale', ['Original', '2x Upscale', '4x Upscale', '8x Upscale (extra)'], P.upscale || 1)}</label>
          ${fixed ? `<p class="muted small">${escapeHtml(m.name)} não tem sliders no plugin: usa os valores automáticos para a Input Quality escolhida.</p>` : `<label class="row"><span>Parameters</span>${opt('paramMode', ['Auto', 'Relative to auto', 'Manual'], mode)}</label>`}
          <div class="kt-row"><button data-tz="estimate">🔍 Estimate Parameters (ler o clipe)</button>${P.estimated ? '<button data-tz="unest">Usar o auto do modelo</button>' : ''}</div>
          ${P.estimated ? `<p class="muted small">Auto estimado do seu clipe neste quadro.</p>` : ''}
          ${keys.map(sl).join('')}
          ${m.sliders === 'nyx' ? `<div class="tz-row"><div><b>Nyx Recover Details</b></div><div class="tz-ctl"><input type="range" min="0" max="100" step="1" data-tzp="nyxRecover" value="${P.nyxRecover || 0}"><output>${Math.round(P.nyxRecover || 0)}</output></div></div>`
            : `<div class="tz-row"><div><b>Recover Original Details</b><span class="muted small"> Mistura um pouco do original (aspecto natural).</span></div><div class="tz-ctl"><input type="range" min="0" max="100" step="1" data-tzp="recoverOriginal" value="${P.recoverOriginal ?? 20}"><output>${Math.round(P.recoverOriginal ?? 20)}</output></div></div>`}
          <div class="tz-row"><div><b>Add Noise</b><span class="muted small"> Ruído antes do realce (evita o “plástico”).</span></div><div class="tz-ctl"><input type="range" min="0" max="10" step="0.1" data-tzp="addNoise" value="${P.addNoise || 0}"><output>${(+P.addNoise || 0).toFixed(1)}</output></div></div>
          <div class="tz-title"><b>Grain</b></div>
          <div class="tz-row"><div><b>Amount</b></div><div class="tz-ctl"><input type="range" min="0" max="10" step="0.1" data-tzp="grainAmount" value="${P.grainAmount || 0}"><output>${(+P.grainAmount || 0).toFixed(1)}</output></div></div>
          <div class="tz-row"><div><b>Size</b></div><div class="tz-ctl"><input type="range" min="1" max="5" step="0.1" data-tzp="grainSize" value="${P.grainSize || 1.5}"><output>${(+P.grainSize || 1.5).toFixed(1)}</output></div></div>
          <label class="row"><span>Focus fix</span>${opt('focusFix', ['Off', 'Normal', 'Strong'], P.focusFix || 1)}</label>`;
        })() + `
          <label class="row"><span>Comparar (antes / depois)</span><button data-tz="compare">${tz.enabled ? 'Ver original' : 'Ver aprimorado'}</button></label>` : ''}
      </section>

      <section class="tz-sec">
        <div class="tz-title"><b>Frame Interpolation</b> <span class="muted small">— Apollo / Chronos / Aion</span></div>
        <label class="row"><span>Suavizar movimento (fluxo óptico)</span><label class="switch"><input type="checkbox" data-tz="interp" ${l.props.interpolate ? 'checked' : ''}><i></i></label></label>
        <label class="row"><span>Slowmo</span><select data-tz="slowmo" ${tw && tw.params.speed.keys?.length ? 'disabled' : ''}>${SLOWMO.map(([v, n]) => `<option value="${v}" ${slow === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="row"><span>Model</span><select data-tz="fimodel">${FI_MODELS.map((n, i) => `<option value="${i + 1}" ${(fi ? fi.params.fiModel.value : l.props.fiModel || 1) === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${tw && tw.params.speed.keys?.length ? '<p class="muted small">Este clipe já tem uma rampa de velocidade (Twixtor) — edite em Efeitos.</p>' : ''}
        <label class="row"><span>Remove Duplicates Frames</span><label class="switch"><input type="checkbox" data-tz="dedupe" ${dup ? 'checked' : ''}><i></i></label></label>
        <div class="tz-row"><div><b>Sensitivity</b><span class="muted small"> Mais alto = considera duplicados também quadros quase iguais.</span></div><div class="tz-ctl"><input type="range" min="0" max="100" step="1" data-tz="sens" value="${sens}"><output>${sens}</output></div></div>
        <p class="muted small">Vídeos baixados do TikTok/IG repetem quadros e “engasgam”: os repetidos são trocados por quadros novos.</p>
        ${tw ? `<label class="row"><span>Motion blur (vetores)</span><input type="range" min="0" max="200" step="1" data-tz="mblur" value="${valueAt(tw.params.motionBlur, this.store.time) || 0}"></label>` : ''}
        <label class="row"><span>FPS do projeto (saída)</span><select data-tz="fps">${[24, 25, 30, 50, 60].map((f) => `<option ${f === this.store.project.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      </section>

      <section class="tz-sec">
        <div class="tz-title"><b>Estabilização</b></div>
        <label class="row"><span>Força</span><input type="range" min="0" max="100" step="1" data-tz="sstrength" value="${this.strength}"></label>
        <label class="row"><span>Modo</span><select data-tz="smode"><option value="1" ${this.mode === 1 ? 'selected' : ''}>Auto-crop (aproxima)</option><option value="2" ${this.mode === 2 ? 'selected' : ''}>Full frame (espelha bordas)</option></select></label>
        <label class="row"><span>Só reduzir tremidas (jitter)</span><label class="switch"><input type="checkbox" data-tz="sjitter" ${this.jitter ? 'checked' : ''}><i></i></label></label>
        <div class="kt-row"><button class="primary" data-tz="stab" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Analisando…' : st ? '↻ Estabilizar de novo' : '◎ Analisar e estabilizar'}</button>${st ? '<button class="danger" data-tz="unstab">Remover</button>' : ''}</div>
        <div class="progress" ${this.busy ? '' : 'hidden'}><div class="bar" data-tz="bar"></div></div>
      </section>

      <section class="tz-sec">
        <div class="tz-title"><b>Saída</b></div>
        <label class="row"><span>Upscale do vídeo (exportação)</span><select data-tz="outscale">${[1, 2, 4, 8].map((v) => `<option value="${v}" ${(this.store.project.exportScale || 1) === v ? 'selected' : ''}>${v === 1 ? '1× (tamanho do projeto)' : `${v}× (${this.store.project.width * v}×${this.store.project.height * v})`}</option>`).join('')}</select></label>
        <p class="muted small">Como no Topaz: o clipe é reconstruído a partir da resolução original (Upscale do Aprimoramento) e exportado maior. O iPhone grava até ~4K; se pedir 8× e não couber, exporta no maior tamanho possível e avisa.</p>
      </section>`;
    this.bind();
  }

  ensureTopaz() {
    let tz = this.fx('topaz');
    if (!tz) { tz = createEffectInstance('topaz', {}); this.layer.effects.unshift(tz); }
    migrateTopazFx(tz);
    return tz;
  }

  setP(tz, k, v) { tz.params[k] = { value: v, keys: [] }; }

  /** Estimate Parameters: mede o quadro atual do clipe (sem efeitos) e guarda como o "Auto". */
  estimate() {
    const l = this.layer, P = this.store.project, tz = this.ensureTopaz();
    const vw = getVideo(l).a.videoWidth || l.props.width || P.width;
    const k = Math.max(0.2, Math.min(1, vw / P.width, 960 / P.width));
    const c = document.createElement('canvas');
    c.width = Math.max(16, Math.round(P.width * k)); c.height = Math.max(16, Math.round(P.height * k));
    const solo = { ...l, effects: [], transform: l.transform };
    renderFrame(c.getContext('2d'), { ...P, layers: [solo] }, this.store.time, k, { final: true });
    const e = estimateFromImage(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    c.width = c.height = 0;
    for (const [key, v] of Object.entries({ est_c: e.c, est_d: e.d, est_s: e.s, est_n: e.n, est_h: e.h, est_a: e.a })) this.setP(tz, key, v);
    this.setP(tz, 'estimated', true);
    return e;
  }

  ensureFI() {
    const l = this.layer;
    let fi = this.fx('topazFI');
    if (!fi) {
      fi = createEffectInstance('topazFI', {});
      this.setP(fi, 'slowmo', 1); // começa sem câmera lenta (só interpolação)
      if (l.props.dedupe) { this.setP(fi, 'removeDup', true); this.setP(fi, 'sensitivity', l.props.dupSens ?? 20); l.props.dedupe = false; }
      l.effects.unshift(fi);
    }
    return fi;
  }

  /** Slowmo: o Frame Interpolation desacelera e o clipe estica na timeline (mesma cena, mais quadros). */
  setSlowmo(x) {
    const l = this.layer, store = this.store;
    const tw = this.fx('twixtor');
    if (tw && !tw.params.speed.keys?.length) l.effects.splice(l.effects.indexOf(tw), 1); // câmera lenta antiga do painel
    const srcDur = (l.outPoint - l.inPoint) / (l.props.slowFactor || 1);
    const fi = this.ensureFI();
    this.setP(fi, 'slowmo', Math.max(1, [1, 2, 4, 8, 16, 32].indexOf(x) + 1));
    l.props.slowFactor = x;
    l.outPoint = l.inPoint + srcDur * x;
    if (l.outPoint > store.project.duration) store.project.duration = Math.min(600, Math.ceil(l.outPoint * 10) / 10);
  }

  bind() {
    const { store } = this;
    const l = this.layer;
    const q = (s) => this.root.querySelector(`[data-tz="${s}"]`);
    q('enh')?.addEventListener('change', (e) => {
      const tz = this.ensureTopaz(); tz.enabled = e.target.checked; store.commit();
      if (e.target.checked) toast('Aprimoramento ligado. Compare com “Ver original”.', 'ok', 2500);
    });
    q('importPreset')?.addEventListener('click', async () => {
      const [f] = await pickFiles('.json,application/json', false);
      if (!f) return;
      try {
        const cfg = topazPresetToSettings(JSON.parse(await f.text()));
        if (cfg.enhance) {
          const tz = this.ensureTopaz(), en = cfg.enhance;
          tz.enabled = true;
          this.setP(tz, 'model', MODEL_BY_NAME(en.model));
          if (en.quality != null) this.setP(tz, 'inputQuality', Math.max(1, Math.min(3, (en.quality | 0) + 1)));
          this.setP(tz, 'paramMode', en.auto ? 1 : 3); // preset com valores salvos = Manual (valores exatos)
          for (const key of ['compression', 'details', 'sharpen', 'noise', 'dehalo', 'aa', 'addNoise', 'recoverOriginal', 'grainAmount', 'grainSize', 'focusFix']) if (en[key] !== undefined) this.setP(tz, key, en[key]);
        }
        if (cfg.interp || cfg.dedupe || cfg.slowmo > 1) {
          const fi = this.ensureFI();
          this.setP(fi, 'removeDup', !!cfg.dedupe);
          if (cfg.dupSens != null) this.setP(fi, 'sensitivity', cfg.dupSens);
          if (cfg.fiModel) this.setP(fi, 'fiModel', Math.max(1, FI_MODELS.findIndex((n) => n.toLowerCase().startsWith(String(cfg.fiModel).slice(0, 3).replace('apo', 'apollo').replace('chr', 'chronos').replace('chf', 'chronos').replace('apf', 'apollo').toLowerCase().slice(0, 4))) + 1));
          if (cfg.slowmo > 1) this.setSlowmo(cfg.slowmo);
        }
        if (cfg.interp) l.props.interpolate = true;
        store.commit();
        toast(`Preset do Topaz “${cfg.name}” aplicado${cfg.enhance ? ` (modelo ${cfg.enhance.model})` : ''}${cfg.dedupe ? ' · remove duplicates' : ''}.`, 'ok', 4000);
      } catch (e) { toast(`Não deu para ler o preset: ${e.message}`, 'error'); }
    });
    this.root.querySelectorAll('[data-tzs]').forEach((sel) => sel.addEventListener('change', () => {
      const tz = this.ensureTopaz(); const k = sel.dataset.tzs;
      const V = topazValues(evalParams(tz, store.time)); // valores que estavam valendo antes da troca
      this.setP(tz, k, +sel.value);
      // trocar para Manual parte dos valores que estavam valendo (como o plugin)
      if (k === 'paramMode' && +sel.value === 3) {
        for (const [key, ak] of Object.entries(AUTO_KEY)) this.setP(tz, key, Math.round(V[ak]));
        this.setP(tz, 'largeGrain', Math.round(V.largeGrain || 50));
      }
      store.commit();
    }));
    q('estimate')?.addEventListener('click', () => {
      try {
        const e = this.estimate();
        store.commit();
        toast(`Estimado: Fix Compression ${e.c}, Improve Detail ${e.d}, Sharpen ${e.s}, Reduce Noise ${e.n}, Dehalo ${e.h}, Anti-Alias/Deblur ${e.a}.`, 'ok', 5000);
      } catch (err) { toast(`Não deu para estimar: ${err.message}`, 'error'); }
    });
    q('unest')?.addEventListener('click', () => { const tz = this.ensureTopaz(); this.setP(tz, 'estimated', false); store.commit(); });
    this.root.querySelectorAll('[data-tzp]').forEach((r) => {
      r.addEventListener('input', () => {
        const tz = this.ensureTopaz(); const k = r.dataset.tzp;
        tz.params[k] = { value: +r.value, keys: [] };
        r.nextElementSibling.textContent = r.step === '0.1' ? (+r.value).toFixed(1) : r.value;
        this.dragging = true; store.emit('preview');
      });
      r.addEventListener('change', () => { this.dragging = false; store.commit(); });
    });
    q('compare')?.addEventListener('click', () => { const tz = this.fx('topaz'); if (tz) { tz.enabled = !tz.enabled; store.commit(); } });
    q('outscale')?.addEventListener('change', (e) => {
      store.project.exportScale = +e.target.value;
      const tz = this.ensureTopaz(); if (+e.target.value > 1) { this.setP(tz, 'upscale', [1, 1, 2, 3, 3, 4, 4, 4, 4][+e.target.value]); tz.enabled = true; }
      store.commit(); toast(`Exportação em ${e.target.value}× — escolhida também na janela Exportar.`, 'ok', 2500);
    });
    q('interp')?.addEventListener('change', (e) => { l.props.interpolate = e.target.checked; store.commit(); });
    q('dedupe')?.addEventListener('change', (e) => {
      const fi = this.fx('topazFI');
      if (fi) this.setP(fi, 'removeDup', e.target.checked); else l.props.dedupe = e.target.checked;
      if (!e.target.checked) l.props.dedupe = false;
      store.commit(); if (e.target.checked) toast('Preparando quadros para achar os duplicados…', 'info', 2500);
    });
    const sens = q('sens');
    sens?.addEventListener('input', () => { sens.nextElementSibling.textContent = sens.value; });
    sens?.addEventListener('change', () => { const fi = this.fx('topazFI'); if (fi) this.setP(fi, 'sensitivity', +sens.value); else l.props.dupSens = +sens.value; store.commit(); });
    q('fimodel')?.addEventListener('change', (e) => { const fi = this.ensureFI(); this.setP(fi, 'fiModel', +e.target.value); store.commit(); });
    q('slowmo')?.addEventListener('change', (e) => { this.setSlowmo(+e.target.value); store.commit(); });
    q('mblur')?.addEventListener('change', (e) => { const tw = this.fx('twixtor'); if (tw) { tw.params.motionBlur = { value: +e.target.value, keys: [] }; store.commit(); } });
    q('fps')?.addEventListener('change', (e) => { store.project.fps = +e.target.value; store.commit('structure'); toast(`Projeto em ${e.target.value} fps. Ligue “Suavizar movimento” para criar os quadros extras.`, 'ok', 3500); });
    q('sstrength')?.addEventListener('change', (e) => { this.strength = +e.target.value; });
    q('smode')?.addEventListener('change', (e) => { this.mode = +e.target.value; const st = this.fx('stabilize'); if (st) { st.params.mode.value = this.mode; store.commit(); } });
    q('sjitter')?.addEventListener('change', (e) => { this.jitter = e.target.checked; });
    q('unstab')?.addEventListener('click', () => { const st = this.fx('stabilize'); if (st) { l.effects.splice(l.effects.indexOf(st), 1); store.commit(); } });
    q('stab')?.addEventListener('click', async () => {
      this.busy = true; this.render();
      try {
        const r = await stabilizeLayer({ layer: l, project: store.project, strength: this.strength, mode: this.mode, jitter: this.jitter, onProgress: (f) => { const b = this.root.querySelector('[data-tz="bar"]'); if (b) b.style.width = `${Math.round(f * 100)}%`; } });
        toast(`Estabilizado: ${r.frames} quadros analisados${this.mode === 1 ? `, zoom ${r.zoom.toFixed(0)}%` : ''}.`, 'ok', 4000);
      } catch (e) { toast(`Não foi possível estabilizar: ${e.message}`, 'error'); }
      this.busy = false;
      store.commit();
    });
  }
}
