// Painel de ferramentas de keyframes: selecionar todos, esticar/comprimir, easing em lote, inverter.
import { selectAll, selectionRange, snapshotTimes, stretchKeys, reverseKeys, shiftKeys, setEase, deleteKeys } from './keyframes.js';
import { formatTime } from './util.js';
import { graphHtml, bindGraph } from './graph.js';
import { toast } from './ui.js';

const EASE_BUTTONS = [
  ['linear', 'Linear', null], ['easeInOut', 'Easy Ease', null], ['easeIn', 'Ease In', null], ['easeOut', 'Ease Out', null],
  ['bezier', 'Velocity forte', 0.9], ['bezier', 'Velocity suave', 0.6], ['back', 'Overshoot', null], ['hold', 'Hold', null],
];

export class KeyTools {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.multi = false;
    this.anchor = 'first';
    this.base = null;
    store.on((kind) => { if (!['time', 'preview', 'keyspreview'].includes(kind)) this.render(); });
    this.render();
  }

  selectAllLayer() {
    const layer = this.store.layer();
    const layers = layer ? [layer] : this.store.layers;
    this.store.setKeySelection(selectAll(layers));
    return this.store.selectedKeys.length;
  }

  selectAllProject() {
    this.store.setKeySelection(selectAll(this.store.layers));
  }

  render() {
    if (!this.root.isConnected) return;
    const { store } = this;
    const sel = store.selectedKeys;
    const range = selectionRange(sel);
    const layers = new Set(sel.map((s) => s.layerId)).size;
    const fps = store.project.fps;
    this.stopGraph?.();
    this.root.innerHTML = `
      ${graphHtml(store)}
      <div class="kt-info">${sel.length ? `<b>${sel.length}</b> keyframe(s) em ${layers} camada(s) · ${formatTime(range[0], fps)} → ${formatTime(range[1], fps)} (${(range[1] - range[0]).toFixed(2)}s)` : 'Nenhum keyframe selecionado. Toque nos ◆ da timeline ou use “Selecionar todos”.'}</div>
      <div class="kt-row">
        <button data-act="all-layer" class="primary">◆◆ Selecionar todos${store.layer() ? ' (camada)' : ''}</button>
        <button data-act="all-project">Todos do projeto</button>
        <button data-act="clear" ${sel.length ? '' : 'disabled'}>Limpar</button>
      </div>
      <label class="row toggle-row"><span>Seleção múltipla (toque adiciona)</span><label class="switch"><input type="checkbox" data-act="multi" ${this.multi ? 'checked' : ''}><i></i></label></label>
      <h4>⟷ Esticar comprimento</h4>
      <div class="stretch ${sel.length > 1 ? '' : 'disabled'}">
        <input type="range" data-act="stretch" min="-100" max="100" step="1" value="0" ${sel.length > 1 ? '' : 'disabled'}>
        <div class="stretch-labels"><span>¼×</span><span class="stretch-val">100%</span><span>4×</span></div>
        <div class="kt-row">
          <label class="row inline"><span>Âncora</span><select data-act="anchor">
            <option value="first" ${this.anchor === 'first' ? 'selected' : ''}>Primeiro keyframe</option>
            <option value="playhead" ${this.anchor === 'playhead' ? 'selected' : ''}>Playhead</option>
            <option value="last" ${this.anchor === 'last' ? 'selected' : ''}>Último keyframe</option>
          </select></label>
          <label class="row inline"><span>Duração (s)</span><input type="number" inputmode="decimal" data-act="duration" step="0.01" min="0.01" value="${range ? (range[1] - range[0]).toFixed(2) : ''}" ${sel.length > 1 ? '' : 'disabled'}></label>
        </div>
        <div class="kt-row"><button data-act="x05" ${sel.length > 1 ? '' : 'disabled'}>½×</button><button data-act="x075" ${sel.length > 1 ? '' : 'disabled'}>0,75×</button><button data-act="x15" ${sel.length > 1 ? '' : 'disabled'}>1,5×</button><button data-act="x2" ${sel.length > 1 ? '' : 'disabled'}>2×</button></div>
      </div>
      <h4>Interpolação</h4>
      <div class="ease-grid">${EASE_BUTTONS.map(([e, l, inf], i) => `<button data-ease="${i}" ${sel.length ? '' : 'disabled'}><svg viewBox="0 0 40 24">${curve(e, inf)}</svg>${l}</button>`).join('')}</div>
      <h4>Outros</h4>
      <div class="kt-row">
        <button data-act="reverse" ${sel.length > 1 ? '' : 'disabled'}>⇄ Inverter</button>
        <button data-act="to-playhead" ${sel.length ? '' : 'disabled'}>⇥ Mover p/ playhead</button>
        <button data-act="delete" class="danger" ${sel.length ? '' : 'disabled'}>Excluir</button>
      </div>`;
    this.bind();
  }

  bind() {
    const { store } = this;
    const r = this.root;
    this.stopGraph = bindGraph(r, store, { toast });
    const sel = () => store.selectedKeys;
    const on = (act, fn, ev = 'click') => r.querySelector(`[data-act="${act}"]`)?.addEventListener(ev, fn);
    on('all-layer', () => this.selectAllLayer());
    on('all-project', () => this.selectAllProject());
    on('clear', () => store.setKeySelection([]));
    on('multi', (e) => { this.multi = e.target.checked; }, 'change');
    on('anchor', (e) => { this.anchor = e.target.value; }, 'change');
    const anchor = () => (this.anchor === 'playhead' ? store.time : this.anchor);
    const slider = r.querySelector('[data-act="stretch"]');
    const label = r.querySelector('.stretch-val');
    slider?.addEventListener('input', () => {
      if (!this.base) this.base = snapshotTimes(sel());
      const f = 2 ** (slider.value / 50);
      label.textContent = `${Math.round(f * 100)}%`;
      stretchKeys(store.project, sel(), f, anchor(), this.base);
      store.emit('keyspreview');
      store.emit('preview');
    });
    slider?.addEventListener('change', () => { this.base = null; store.commit(); });
    const scaleBy = (f) => { stretchKeys(store.project, sel(), f, anchor()); store.commit(); };
    on('x05', () => scaleBy(0.5));
    on('x075', () => scaleBy(0.75));
    on('x15', () => scaleBy(1.5));
    on('x2', () => scaleBy(2));
    on('duration', (e) => {
      const range = selectionRange(sel());
      const cur = range[1] - range[0];
      const want = parseFloat(e.target.value);
      if (cur > 0 && want > 0) scaleBy(want / cur);
    }, 'change');
    r.querySelectorAll('[data-ease]').forEach((b) => b.addEventListener('click', () => {
      const [e, , inf] = EASE_BUTTONS[+b.dataset.ease];
      setEase(sel(), e, inf);
      store.commit();
    }));
    on('reverse', () => { reverseKeys(store.project, sel()); store.commit(); });
    on('to-playhead', () => { const [a] = selectionRange(sel()); shiftKeys(store.project, sel(), store.time - a); store.commit(); });
    on('delete', () => { deleteKeys(store.project, sel()); store.selectedKeys = []; store.commit(); });
  }
}

function curve(ease, inf) {
  const pts = {
    linear: 'M2 22 L38 2', easeInOut: 'M2 22 C14 22 26 2 38 2', easeIn: 'M2 22 C14 22 38 2 38 2', easeOut: 'M2 22 C2 22 26 2 38 2',
    back: 'M2 22 C12 22 22 -6 38 2', hold: 'M2 22 L38 22 L38 2',
  };
  const d = ease === 'bezier' ? `M2 22 C${2 + 36 * inf} 22 ${38 - 36 * inf} 2 38 2` : pts[ease];
  return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2"/>`;
}
