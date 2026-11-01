// Painel "Topaz" (estilo Topaz Video AI): Aprimoramento (modelos + controles do Proteus), Interpolação de quadros
// (Apollo/Chronos: câmera lenta, fps, quadros duplicados), Estabilização e Saída.
import { createEffectInstance } from './presets.js';
import { TOPAZ_MODELS, TOPAZ_KEYS } from './fx/topaz.js';
import { stabilizeLayer } from './stabilize.js';
import { valueAt } from './anim.js';
import { escapeHtml } from './util.js';
import { toast } from './ui.js';

const LABELS = {
  revertCompression: ['Revert Compression', 'Tira blocos e borrões de compressão (vídeos do TikTok/IG/WhatsApp).'],
  recoverDetails: ['Recover Details', 'Recupera textura (cabelo, grama, camisa).'],
  sharpen: ['Sharpen', 'Nitidez adaptativa, sem serrilhado.'],
  reduceNoise: ['Reduce Noise', 'Remove ruído/granulado preservando as bordas.'],
  dehalo: ['Dehalo', 'Evita halos claros/escuros em volta das bordas.'],
  antialiasDeblur: ['Anti-alias / Deblur', 'Tira desfoque leve e serrilhado de vídeos ampliados.'],
  recoverOriginal: ['Recover Original Detail', 'Mistura um pouco do original (aspecto natural).'],
  addNoise: ['Add Noise', 'Grão fino para parecer filmado (esconde o “plástico”).'],
};
const SLOWMO = [[1, 'Desligada'], [2, '2× (50%)'], [4, '4× (25%)'], [8, '8× (12,5%)']];

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
    const model = tz ? pv('model') : 2;
    const auto = TOPAZ_MODELS[model - 1]?.[1];
    const tw = this.fx('twixtor');
    const slow = tw && !tw.params.speed.keys?.length ? Math.round(100 / Math.max(1, tw.params.speed.value)) : 1;
    const st = this.fx('stabilize');
    this.root.innerHTML = `
      <div class="tz-head">✨ <b>Topaz</b> · ${escapeHtml(l.name)} <span class="muted small">(recriação em GPU com os controles do Topaz Video AI)</span></div>

      <section class="tz-sec">
        <label class="tz-title"><span class="switch"><input type="checkbox" data-tz="enh" ${tz?.enabled ? 'checked' : ''}><i></i></span> <b>Aprimoramento</b> <span class="muted small">— upscale/limpeza</span></label>
        ${tz ? `
          <label class="row"><span>Modelo de IA</span><select data-tz="model">${TOPAZ_MODELS.map(([n], i) => `<option value="${i + 1}" ${model === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          ${auto ? '<p class="muted small">Valores automáticos do modelo. Toque em “Ajustar manualmente” para mexer (vira Proteus).</p><button class="wide" data-tz="manual">Ajustar manualmente (Proteus)</button>' : ''}
          ${TOPAZ_KEYS.map((k) => `<div class="tz-row ${auto ? 'locked' : ''}"><div><b>${LABELS[k][0]}</b><span class="muted small"> ${LABELS[k][1]}</span></div>
            <div class="tz-ctl"><input type="range" min="0" max="100" step="1" data-tzp="${k}" value="${auto ? auto[k] : pv(k)}" ${auto ? 'disabled' : ''}><output>${auto ? auto[k] : Math.round(pv(k))}</output></div></div>`).join('')}
          <label class="row"><span>Comparar (antes / depois)</span><button data-tz="compare">${tz.enabled ? 'Ver original' : 'Ver aprimorado'}</button></label>` : ''}
      </section>

      <section class="tz-sec">
        <div class="tz-title"><b>Interpolação de quadros</b> <span class="muted small">— estilo Apollo / Chronos</span></div>
        <label class="row"><span>Suavizar movimento (fluxo óptico)</span><label class="switch"><input type="checkbox" data-tz="interp" ${l.props.interpolate ? 'checked' : ''}><i></i></label></label>
        <label class="row"><span>Câmera lenta</span><select data-tz="slowmo" ${tw && tw.params.speed.keys?.length ? 'disabled' : ''}>${SLOWMO.map(([v, n]) => `<option value="${v}" ${slow === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${tw && tw.params.speed.keys?.length ? '<p class="muted small">Este clipe já tem uma rampa de velocidade (Twixtor) — edite em Efeitos.</p>' : ''}
        <label class="row"><span>Substituir quadros duplicados</span><label class="switch"><input type="checkbox" data-tz="dedupe" ${l.props.dedupe ? 'checked' : ''}><i></i></label></label>
        <p class="muted small">Vídeos baixados do TikTok/IG repetem quadros e “engasgam”. Isso detecta os repetidos e cria quadros novos no lugar.</p>
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
        <p class="muted small">Na exportação, escolha <b>150%</b> ou <b>200% (upscale)</b> em Resolução para gerar o vídeo maior (ex.: 1080×1920 → 2160×3840). O Aprimoramento recupera os detalhes na resolução de saída.</p>
      </section>`;
    this.bind();
  }

  ensureTopaz() {
    let tz = this.fx('topaz');
    if (!tz) { tz = createEffectInstance('topaz', {}); this.layer.effects.unshift(tz); }
    return tz;
  }

  bind() {
    const { store } = this;
    const l = this.layer;
    const q = (s) => this.root.querySelector(`[data-tz="${s}"]`);
    q('enh')?.addEventListener('change', (e) => {
      const tz = this.ensureTopaz(); tz.enabled = e.target.checked; store.commit();
      if (e.target.checked) toast('Aprimoramento ligado. Compare com “Ver original”.', 'ok', 2500);
    });
    q('model')?.addEventListener('change', (e) => { const tz = this.ensureTopaz(); tz.params.model.value = +e.target.value; tz.params.model.keys = []; store.commit(); });
    q('manual')?.addEventListener('click', () => {
      const tz = this.ensureTopaz();
      const auto = TOPAZ_MODELS[tz.params.model.value - 1]?.[1];
      if (auto) for (const k of TOPAZ_KEYS) { tz.params[k].value = auto[k]; tz.params[k].keys = []; }
      tz.params.model.value = 1;
      store.commit();
    });
    this.root.querySelectorAll('[data-tzp]').forEach((r) => {
      r.addEventListener('input', () => {
        const tz = this.ensureTopaz(); const k = r.dataset.tzp;
        tz.params[k].value = +r.value; tz.params[k].keys = [];
        r.nextElementSibling.textContent = r.value;
        this.dragging = true; store.emit('preview');
      });
      r.addEventListener('change', () => { this.dragging = false; store.commit(); });
    });
    q('compare')?.addEventListener('click', () => { const tz = this.fx('topaz'); if (tz) { tz.enabled = !tz.enabled; store.commit(); } });
    q('interp')?.addEventListener('change', (e) => { l.props.interpolate = e.target.checked; store.commit(); });
    q('dedupe')?.addEventListener('change', (e) => { l.props.dedupe = e.target.checked; store.commit(); if (e.target.checked) toast('Preparando quadros para achar os duplicados…', 'info', 2500); });
    q('slowmo')?.addEventListener('change', (e) => {
      const x = +e.target.value;
      let tw = this.fx('twixtor');
      // a câmera lenta estica o clipe na timeline (como no Topaz: mesma cena, mais quadros)
      const srcDur = (l.outPoint - l.inPoint) / (l.props.slowFactor || 1);
      if (x === 1) { if (tw) l.effects.splice(l.effects.indexOf(tw), 1); }
      else {
        if (!tw) { tw = createEffectInstance('twixtor', {}); l.effects.unshift(tw); }
        tw.params.speed = { value: 100 / x, keys: [] };
        tw.params.frameBlend = { value: true, keys: [] };
      }
      l.props.slowFactor = x;
      l.outPoint = l.inPoint + srcDur * x;
      if (l.outPoint > store.project.duration) store.project.duration = Math.min(600, Math.ceil(l.outPoint * 10) / 10);
      store.commit();
    });
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
