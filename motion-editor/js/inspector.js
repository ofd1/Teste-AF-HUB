// Painéis de propriedades (mode 'props') e de efeitos (mode 'effects').
import { valueAt, isAnimated, setValue, toggleKey, toggleStopwatch, keyIndexAt, prevKeyTime, nextKeyTime } from './anim.js';
import { resolveProp } from './state.js';
import { getEffectDef } from './effects.js';
import { escapeHtml, hexToRgba, rgbaToHex } from './util.js';

const TRANSFORM_DEFS = [
  { key: 'position', label: 'Posição', kind: 'point', step: 1 },
  { key: 'scale', label: 'Escala %', kind: 'point', step: 1 },
  { key: 'rotation', label: 'Rotação', kind: 'angle' },
  { key: 'opacity', label: 'Opacidade %', kind: 'number', min: 0, max: 100, step: 1 },
  { key: 'anchor', label: 'Ancoragem', kind: 'point', step: 1 },
];

const BLENDS = { 'source-over': 'Normal', screen: 'Tela (Screen)', lighter: 'Adicionar (Add)', multiply: 'Multiplicar', overlay: 'Sobrepor', 'soft-light': 'Luz suave', 'hard-light': 'Luz direta', 'color-dodge': 'Subexpor cor', difference: 'Diferença', color: 'Cor', luminosity: 'Luminosidade' };
const FONTS = ['Inter, system-ui, sans-serif', 'Impact, "Arial Black", sans-serif', '"Arial Black", sans-serif', 'Georgia, serif', '"Courier New", monospace', '"Trebuchet MS", sans-serif', '"Brush Script MT", cursive'];
const TYPE_NAMES = { text: 'Texto', rect: 'Retângulo', ellipse: 'Elipse', solid: 'Sólido', image: 'Imagem', video: 'Vídeo', audio: 'Áudio', adjustment: 'Camada de ajuste' };

export class Inspector {
  constructor(root, store, mode, hooks = {}) {
    this.root = root;
    this.store = store;
    this.mode = mode;
    this.hooks = hooks;
    this.collapsed = new Set();
    this.binds = [];
    store.on((kind) => {
      if (kind === 'time' || kind === 'preview') this.refresh();
      else if (kind !== 'keys' && kind !== 'keyspreview') this.render();
    });
    this.render();
  }

  render() {
    if (!this.root.isConnected) return;
    const active = document.activeElement;
    const focusId = this.root.contains(active) ? active.dataset.fid : null;
    const layer = this.store.layer();
    this.binds = [];
    if (!layer) {
      this.root.innerHTML = '<div class="empty-note">Selecione uma camada na timeline.</div>';
      return;
    }
    this.root.innerHTML = this.mode === 'effects' ? this.effectsHtml(layer) : this.propsHtml(layer);
    this.bind(layer);
    this.refresh();
    if (focusId) this.root.querySelector(`[data-fid="${focusId}"]`)?.focus();
  }

  section(id, title, body) {
    const c = this.collapsed.has(id);
    return `<section class="insp-sec ${c ? 'collapsed' : ''}"><h4 data-toggle="${id}">${c ? '▸' : '▾'} ${title}</h4><div class="insp-body">${body}</div></section>`;
  }

  propsHtml(layer) {
    const p = layer.props;
    const f = (label, input) => `<label class="row"><span>${label}</span>${input}</label>`;
    const num = (k, step = 1, min = '', max = '') => `<input type="number" inputmode="decimal" data-prop="${k}" data-fid="p-${k}" step="${step}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} value="${p[k] ?? 0}">`;
    const color = (k) => `<input type="color" data-prop="${k}" value="${p[k]}">`;
    const rows = [
      f('Nome', `<input type="text" data-layer="name" data-fid="l-name" value="${escapeHtml(layer.name)}">`),
    ];
    if (layer.type !== 'audio') rows.push(f('Mesclagem', `<select data-layer="blend">${Object.entries(BLENDS).map(([k, l]) => `<option value="${k}" ${layer.blend === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`));
    switch (layer.type) {
      case 'text':
        rows.push(`<textarea data-prop="text" data-fid="p-text" rows="2">${escapeHtml(p.text)}</textarea>`);
        rows.push(f('Fonte', `<select data-prop="fontFamily">${FONTS.map((x) => `<option value='${x}' ${p.fontFamily === x ? 'selected' : ''}>${x.split(',')[0].replace(/"/g, '')}</option>`).join('')}</select>`));
        rows.push(f('Tamanho', num('fontSize', 1, 1)));
        rows.push(f('Peso', `<select data-prop="fontWeight">${[300, 400, 600, 800, 900].map((w) => `<option ${+p.fontWeight === w ? 'selected' : ''}>${w}</option>`).join('')}</select>`));
        rows.push(f('Cor', color('color')));
        rows.push(f('Alinhamento', `<select data-prop="align">${['left', 'center', 'right'].map((a) => `<option value="${a}" ${p.align === a ? 'selected' : ''}>${{ left: 'Esquerda', center: 'Centro', right: 'Direita' }[a]}</option>`).join('')}</select>`));
        rows.push(f('Espaçamento', num('letterSpacing', 0.5)));
        rows.push(f('Contorno', num('strokeWidth', 0.5, 0)));
        rows.push(f('Cor contorno', color('strokeColor')));
        break;
      case 'video':
        rows.push(f('Início no vídeo (s)', num('sourceStart', 0.01, 0)));
        rows.push(f('Velocidade base ×', num('speed', 0.05, 0.05, 16)));
        rows.push('<button class="wide" data-hook="speed">⏱ Rampa de velocidade (estilo Twixtor)</button>');
        rows.push(f('Largura', num('width', 1, 1)), f('Altura', num('height', 1, 1)));
        break;
      case 'audio':
        rows.push(f('Volume %', num('volume', 1, 0, 200)));
        rows.push(f('Início no áudio (s)', num('sourceStart', 0.01, 0)));
        rows.push(f('Mudo', `<input type="checkbox" data-prop="muted" ${p.muted ? 'checked' : ''}>`));
        rows.push('<button class="wide" data-hook="beats">♪ Detectar batidas → marcadores</button>');
        break;
      case 'adjustment':
        rows.push('<div class="note">Efeitos desta camada são aplicados em tudo que está abaixo dela (como no After Effects).</div>');
        break;
      default:
        rows.push(f('Largura', num('width', 1, 1)), f('Altura', num('height', 1, 1)));
        if ('fill' in p) rows.push(f('Cor', color('fill')));
        if (layer.type === 'rect') rows.push(f('Raio', num('radius', 1, 0)));
        if ('strokeWidth' in p) rows.push(f('Contorno', num('strokeWidth', 0.5, 0)), f('Cor contorno', color('strokeColor')));
    }
    rows.push(f('Entrada (s)', `<input type="number" inputmode="decimal" data-layer="inPoint" step="0.01" value="${layer.inPoint.toFixed(2)}">`));
    rows.push(f('Saída (s)', `<input type="number" inputmode="decimal" data-layer="outPoint" step="0.01" value="${layer.outPoint.toFixed(2)}">`));
    let html = this.section('layer', TYPE_NAMES[layer.type] || 'Camada', rows.join(''));
    if (layer.type !== 'audio') html += this.section('transform', 'Transformar', TRANSFORM_DEFS.map((d) => this.propRow(`transform.${d.key}`, d)).join(''));
    return html;
  }

  effectsHtml(layer) {
    const cards = layer.effects.map((fx, i) => {
      const generic = fx.type === 'generic';
      const def = generic ? { label: fx.label, params: fx.defs || [] } : getEffectDef(fx.type);
      const c = this.collapsed.has(fx.id);
      const badge = fx.matchName ? `<span class="badge ${generic ? 'warn' : ''}" title="${escapeHtml(fx.matchName)}">${generic ? 'AE • sem render' : 'AE'}</span>` : '';
      return `<div class="fx-card ${fx.enabled ? '' : 'off'} ${c ? 'collapsed' : ''}" data-fx="${fx.id}">
        <div class="fx-head">
          <label class="switch"><input type="checkbox" data-fxact="enable" ${fx.enabled ? 'checked' : ''}><i></i></label>
          <span class="fx-title" data-fxact="collapse">${escapeHtml(fx.label || def.label)}</span>${badge}
          <span class="fx-tools"><button data-fxact="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button data-fxact="down" ${i === layer.effects.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button><button data-fxact="dup" aria-label="Duplicar">⧉</button><button data-fxact="del" class="danger" aria-label="Remover">✕</button></span>
        </div>
        <div class="fx-body">
          ${def.plugin ? `<div class="plugin-note">Recriação estilo <b>${escapeHtml(def.plugin)}</b></div>` : ''}
          ${def.description ? `<div class="desc">${escapeHtml(def.description)}</div>` : ''}
          ${generic ? '<div class="note">Efeito do AE sem equivalente: controles importados (editáveis e animáveis) sem alterar a imagem.</div>' : ''}
          ${def.params.map((pd) => this.propRow(`fx:${fx.id}.${pd.key}`, pd)).join('')}
        </div>
      </div>`;
    });
    return `<button class="wide primary add-fx" data-hook="browse">＋ Adicionar efeito</button>${cards.join('') || '<div class="empty-note">Nenhum efeito nesta camada ainda.</div>'}`;
  }

  propRow(path, d) {
    const fid = path.replace(/[^a-z0-9]/gi, '_');
    let inputs;
    switch (d.kind) {
      case 'point': inputs = `<input type="number" inputmode="decimal" data-i="0" data-fid="${fid}_0" step="${d.step || 1}"><input type="number" inputmode="decimal" data-i="1" data-fid="${fid}_1" step="${d.step || 1}">`; break;
      case 'pos': inputs = `<input type="number" inputmode="decimal" data-i="0" data-fid="${fid}_0" step="1" title="X %"><input type="number" inputmode="decimal" data-i="1" data-fid="${fid}_1" step="1" title="Y %">`; break;
      case 'color': inputs = '<input type="color" data-i="c">'; break;
      case 'bool': inputs = '<label class="switch"><input type="checkbox" data-i="b"><i></i></label>'; break;
      case 'select': inputs = `<select data-i="s">${(d.options || []).map((o, i) => `<option value="${i + 1}">${escapeHtml(o)}</option>`).join('')}</select>`; break;
      case 'angle': inputs = `<input type="number" inputmode="decimal" data-i="n" data-fid="${fid}" step="1"><span class="unit">°</span>`; break;
      default: {
        const hasRange = d.max !== undefined && d.min !== undefined;
        inputs = `${hasRange ? `<input type="range" data-i="r" min="${d.min}" max="${d.max}" step="${d.step ?? 0.1}">` : ''}<input type="number" inputmode="decimal" class="num" data-i="n" data-fid="${fid}" step="${d.step ?? 0.1}">`;
      }
    }
    return `<div class="prop-row" data-path="${path}" data-kind="${d.kind}">
      <span class="plabel" data-pact="scrub">${escapeHtml(d.label)}</span>
      <span class="pinputs">${inputs}</span>
      <span class="kfnav"><button data-pact="prev" aria-label="Keyframe anterior">‹</button><button data-pact="key" class="kbtn" aria-label="Keyframe">◆</button><button data-pact="next" aria-label="Próximo keyframe">›</button></span>
    </div>`;
  }

  bind(layer) {
    const { store } = this;
    const root = this.root;
    root.querySelectorAll('[data-toggle]').forEach((h) => h.addEventListener('click', () => {
      const id = h.dataset.toggle;
      if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
      this.render();
    }));
    root.querySelectorAll('[data-hook]').forEach((b) => b.addEventListener('click', () => this.hooks[b.dataset.hook]?.(layer)));

    root.querySelectorAll('[data-prop]').forEach((el) => {
      const k = el.dataset.prop;
      const apply = () => {
        let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? parseFloat(el.value) : el.value;
        if (el.type === 'number' && !Number.isFinite(v)) return;
        if (k === 'fontWeight') v = +v;
        layer.props[k] = v;
        store.emit('preview');
      };
      el.addEventListener('input', apply);
      el.addEventListener('change', () => { apply(); store.commit(); });
    });
    root.querySelectorAll('[data-layer]').forEach((el) => {
      const k = el.dataset.layer;
      el.addEventListener('change', () => {
        let v = el.value;
        if (k === 'inPoint' || k === 'outPoint') {
          v = Math.max(0, Math.min(store.project.duration, parseFloat(v) || 0));
          if (k === 'inPoint' && v >= layer.outPoint) v = layer.outPoint - 1 / store.project.fps;
          if (k === 'outPoint' && v <= layer.inPoint) v = layer.inPoint + 1 / store.project.fps;
        }
        layer[k] = v;
        store.commit();
      });
    });

    root.querySelectorAll('.fx-card').forEach((card) => {
      const fx = layer.effects.find((e) => e.id === card.dataset.fx);
      card.querySelectorAll('[data-fxact]').forEach((el) => {
        const act = el.dataset.fxact;
        el.addEventListener(act === 'enable' ? 'change' : 'click', () => {
          const i = layer.effects.indexOf(fx);
          if (act === 'enable') fx.enabled = el.checked;
          if (act === 'collapse') { if (this.collapsed.has(fx.id)) this.collapsed.delete(fx.id); else this.collapsed.add(fx.id); this.render(); return; }
          if (act === 'del') layer.effects.splice(i, 1);
          if (act === 'dup') this.hooks.duplicateEffect?.(layer, fx);
          if (act === 'up' && i > 0) [layer.effects[i - 1], layer.effects[i]] = [layer.effects[i], layer.effects[i - 1]];
          if (act === 'down' && i < layer.effects.length - 1) [layer.effects[i + 1], layer.effects[i]] = [layer.effects[i], layer.effects[i + 1]];
          store.commit();
        });
      });
    });

    root.querySelectorAll('.prop-row').forEach((row) => this.bindPropRow(layer, row));
  }

  bindPropRow(layer, row) {
    const { store } = this;
    const kind = row.dataset.kind;
    const prop = resolveProp(layer, row.dataset.path);
    if (!prop) return;
    const read = () => {
      const cur = valueAt(prop, store.time);
      if (kind === 'point') return [0, 1].map((i) => { const v = parseFloat(row.querySelector(`[data-i="${i}"]`).value); return Number.isFinite(v) ? v : cur[i]; });
      if (kind === 'pos') return [0, 1].map((i) => { const v = parseFloat(row.querySelector(`[data-i="${i}"]`).value); return Number.isFinite(v) ? v / 100 : cur[i]; });
      if (kind === 'color') return hexToRgba(row.querySelector('[data-i="c"]').value, cur?.[3] ?? 1);
      if (kind === 'bool') return row.querySelector('[data-i="b"]').checked;
      if (kind === 'select') return +row.querySelector('[data-i="s"]').value;
      const v = parseFloat(row.querySelector('[data-i="n"]').value);
      return Number.isFinite(v) ? v : cur;
    };
    const write = (v, commit) => {
      setValue(prop, store.time, v);
      if (commit) store.commit(); else store.emit('preview');
    };
    row.querySelectorAll('[data-i]').forEach((el) => {
      if (el.dataset.i === 'r') {
        el.addEventListener('input', () => { row.querySelector('[data-i="n"]').value = el.value; write(parseFloat(el.value)); });
        el.addEventListener('change', () => store.commit());
        return;
      }
      el.addEventListener('input', () => write(read()));
      el.addEventListener('change', () => write(read(), true));
    });
    row.querySelectorAll('[data-pact]').forEach((el) => {
      const act = el.dataset.pact;
      if (act === 'scrub') {
        if (!['number', 'angle', 'point'].includes(kind)) return;
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          const x0 = e.clientX;
          const v0 = valueAt(prop, store.time);
          let moved = false;
          el.onpointermove = (ev) => {
            const d = (ev.clientX - x0) * (ev.shiftKey ? 0.1 : 1) * (kind === 'point' ? 1 : 0.5);
            if (Math.abs(ev.clientX - x0) > 2) moved = true;
            write(Array.isArray(v0) ? v0.map((x) => x + d) : v0 + d);
          };
          el.onpointerup = () => { el.onpointermove = null; if (moved) store.commit(); };
        });
        return;
      }
      el.addEventListener('click', () => {
        const t = store.time;
        if (act === 'key') { if (isAnimated(prop)) toggleKey(prop, t); else toggleStopwatch(prop, t); }
        if (act === 'prev') { const pt = prevKeyTime(prop, t); if (pt != null) store.setTime(pt); return; }
        if (act === 'next') { const nt = nextKeyTime(prop, t); if (nt != null) store.setTime(nt); return; }
        store.commit();
      });
    });
    this.binds.push({ row, prop, kind });
  }

  refresh() {
    const t = this.store.time;
    for (const { row, prop, kind } of this.binds) {
      const v = valueAt(prop, t);
      const set = (sel, val) => {
        const el = row.querySelector(sel);
        if (el && document.activeElement !== el) el.value = val;
      };
      if (kind === 'point') { set('[data-i="0"]', round(v[0])); set('[data-i="1"]', round(v[1])); }
      else if (kind === 'pos') { set('[data-i="0"]', round(v[0] * 100)); set('[data-i="1"]', round(v[1] * 100)); }
      else if (kind === 'color') set('[data-i="c"]', rgbaToHex(v));
      else if (kind === 'bool') { const el = row.querySelector('[data-i="b"]'); if (el) el.checked = !!v; }
      else if (kind === 'select') set('[data-i="s"]', Math.round(v));
      else { set('[data-i="n"]', round(v)); set('[data-i="r"]', v); }
      row.classList.toggle('animated', isAnimated(prop));
      row.classList.toggle('on-key', keyIndexAt(prop, t) >= 0);
    }
  }
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
