import { valueAt, isAnimated, setValue, toggleKey, toggleStopwatch, keyIndexAt, prevKeyTime, nextKeyTime, EASES, removeKeyAt } from './anim.js';
import { resolveProp } from './state.js';
import { EFFECTS, getEffectDef } from './effects.js';
import { createEffectInstance } from './presets.js';
import { escapeHtml, hexToRgba, rgbaToHex, formatTime } from './util.js';

const TRANSFORM_DEFS = [
  { key: 'position', label: 'Posição', kind: 'point', step: 1 },
  { key: 'scale', label: 'Escala %', kind: 'point', step: 1 },
  { key: 'rotation', label: 'Rotação', kind: 'angle' },
  { key: 'opacity', label: 'Opacidade %', kind: 'number', min: 0, max: 100, step: 1 },
  { key: 'anchor', label: 'Ancoragem', kind: 'point', step: 1 },
];

const BLENDS = { 'source-over': 'Normal', screen: 'Tela', multiply: 'Multiplicar', overlay: 'Sobrepor', lighter: 'Adicionar', 'soft-light': 'Luz suave', 'hard-light': 'Luz direta', difference: 'Diferença', color: 'Cor', luminosity: 'Luminosidade' };
const FONTS = ['Inter, system-ui, sans-serif', 'Georgia, serif', '"Courier New", monospace', 'Impact, sans-serif', '"Trebuchet MS", sans-serif', '"Brush Script MT", cursive', 'Arial Black, sans-serif'];

export class Inspector {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.collapsed = new Set();
    store.on((kind) => {
      if (kind === 'time' || kind === 'preview') this.refresh();
      else this.render();
    });
    this.render();
  }

  render() {
    const active = document.activeElement;
    const focusId = this.root.contains(active) ? active.dataset.fid : null;
    const layer = this.store.layer();
    this.binds = [];
    if (!layer) {
      this.root.innerHTML = `<div class="empty-note">Selecione uma camada para editar propriedades, keyframes e efeitos.<br><br>Dica: importe um <b>.ffx</b> do After Effects na aba <b>Presets</b>.</div>`;
      return;
    }
    const parts = [];
    parts.push(this.keyPanel(layer));
    parts.push(this.section('layer', 'Camada', this.layerSection(layer)));
    parts.push(this.section('transform', 'Transformar', TRANSFORM_DEFS.map((d) => this.propRow(layer, `transform.${d.key}`, d)).join('')));
    parts.push(this.section('effects', `Efeitos (${layer.effects.length})`, this.effectsSection(layer)));
    this.root.innerHTML = parts.join('');
    this.bind(layer);
    this.refresh();
    if (focusId) this.root.querySelector(`[data-fid="${focusId}"]`)?.focus();
  }

  section(id, title, body) {
    const c = this.collapsed.has(id);
    return `<section class="insp-sec ${c ? 'collapsed' : ''}" data-sec="${id}"><h3 data-toggle="${id}">${c ? '▸' : '▾'} ${title}</h3><div class="insp-body">${body}</div></section>`;
  }

  keyPanel(layer) {
    const s = this.store.selectedKey;
    if (!s || s.layerId !== layer.id) return '';
    const prop = resolveProp(layer, s.path);
    const i = keyIndexAt(prop, s.t);
    if (i < 0) return '';
    const key = prop.keys[i];
    return `<div class="key-panel">
      <div class="key-title">◆ Keyframe em ${formatTime(key.t, this.store.project.fps)}</div>
      <label class="row"><span>Interpolação</span><select data-key="ease">${Object.entries(EASES).map(([k, l]) => `<option value="${k}" ${key.ease === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${key.ease === 'bezier' ? `<label class="row"><span>Influência saída %</span><input type="number" data-key="outInf" min="1" max="100" value="${Math.round((key.outInf ?? 0.333) * 100)}"></label>` : ''}
      <div class="btns"><button data-key="all">Aplicar a todos</button><button data-key="del" class="danger">Excluir</button></div>
    </div>`;
  }

  layerSection(layer) {
    const p = layer.props;
    const f = (k, label, input) => `<label class="row"><span>${label}</span>${input}</label>`;
    const num = (k, step = 1, min = '') => `<input type="number" data-prop="${k}" data-fid="p-${k}" step="${step}" ${min !== '' ? `min="${min}"` : ''} value="${p[k]}">`;
    const color = (k) => `<input type="color" data-prop="${k}" value="${p[k]}">`;
    const rows = [
      f('name', 'Nome', `<input type="text" data-layer="name" data-fid="l-name" value="${escapeHtml(layer.name)}">`),
      f('blend', 'Mesclagem', `<select data-layer="blend">${Object.entries(BLENDS).map(([k, l]) => `<option value="${k}" ${layer.blend === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`),
    ];
    if (layer.type === 'text') {
      rows.push(`<textarea data-prop="text" data-fid="p-text" rows="3">${escapeHtml(p.text)}</textarea>`);
      rows.push(f('font', 'Fonte', `<select data-prop="fontFamily">${FONTS.map((x) => `<option value='${x}' ${p.fontFamily === x ? 'selected' : ''}>${x.split(',')[0].replace(/"/g, '')}</option>`).join('')}</select>`));
      rows.push(f('fs', 'Tamanho', num('fontSize', 1, 1)));
      rows.push(f('fw', 'Peso', `<select data-prop="fontWeight">${[300, 400, 600, 800, 900].map((w) => `<option ${+p.fontWeight === w ? 'selected' : ''}>${w}</option>`).join('')}</select>`));
      rows.push(f('c', 'Cor', color('color')));
      rows.push(f('al', 'Alinhamento', `<select data-prop="align">${['left', 'center', 'right'].map((a) => `<option value="${a}" ${p.align === a ? 'selected' : ''}>${{ left: 'Esquerda', center: 'Centro', right: 'Direita' }[a]}</option>`).join('')}</select>`));
      rows.push(f('lh', 'Entrelinha', num('lineHeight', 0.05, 0.5)));
      rows.push(f('ls', 'Espaçamento', num('letterSpacing', 0.5)));
      rows.push(f('sw', 'Contorno', num('strokeWidth', 0.5, 0)));
      rows.push(f('sc', 'Cor contorno', color('strokeColor')));
    } else {
      rows.push(f('w', 'Largura', num('width', 1, 1)));
      rows.push(f('h', 'Altura', num('height', 1, 1)));
      if ('fill' in p) rows.push(f('fill', 'Cor', color('fill')));
      if (layer.type === 'rect') rows.push(f('r', 'Raio', num('radius', 1, 0)));
      if ('strokeWidth' in p) { rows.push(f('sw', 'Contorno', num('strokeWidth', 0.5, 0))); rows.push(f('sc', 'Cor contorno', color('strokeColor'))); }
    }
    rows.push(f('in', 'Entrada (s)', `<input type="number" data-layer="inPoint" step="0.1" value="${layer.inPoint.toFixed(2)}">`));
    rows.push(f('out', 'Saída (s)', `<input type="number" data-layer="outPoint" step="0.1" value="${layer.outPoint.toFixed(2)}">`));
    return rows.join('');
  }

  effectsSection(layer) {
    const cards = layer.effects.map((fx, i) => {
      const generic = fx.type === 'generic';
      const def = generic ? { label: fx.label, params: fx.defs || [] } : getEffectDef(fx.type);
      const c = this.collapsed.has(fx.id);
      const badge = fx.matchName ? `<span class="badge ${generic ? 'warn' : ''}" title="${escapeHtml(fx.matchName)}">${generic ? 'AE • sem render' : 'AE'}</span>` : '';
      return `<div class="fx-card ${fx.enabled ? '' : 'off'} ${c ? 'collapsed' : ''}" data-fx="${fx.id}">
        <div class="fx-head">
          <input type="checkbox" data-fxact="enable" ${fx.enabled ? 'checked' : ''} title="Ativar">
          <span class="fx-title" data-fxact="collapse">${c ? '▸' : '▾'} ${escapeHtml(fx.label || def.label)}</span>${badge}
          <span class="fx-tools"><button data-fxact="up" ${i === 0 ? 'disabled' : ''}>↑</button><button data-fxact="down" ${i === layer.effects.length - 1 ? 'disabled' : ''}>↓</button><button data-fxact="del" class="danger">✕</button></span>
        </div>
        <div class="fx-body">
          ${generic ? '<div class="note">Efeito do AE sem equivalente nativo: os controles foram importados (editáveis e animáveis) mas não alteram a imagem.</div>' : ''}
          ${def.params.map((pd) => this.propRow(layer, `fx:${fx.id}.${pd.key}`, pd)).join('')}
        </div>
      </div>`;
    });
    const groups = {};
    for (const e of EFFECTS) (groups[e.category] ||= []).push(e);
    const add = `<select class="fx-add" data-fid="fx-add"><option value="">+ Adicionar efeito…</option>${Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map((e) => `<option value="${e.type}">${e.label}</option>`).join('')}</optgroup>`).join('')}</select>`;
    return cards.join('') + add;
  }

  propRow(layer, path, d) {
    const fid = path.replace(/[^a-z0-9]/gi, '_');
    let inputs;
    switch (d.kind) {
      case 'point': inputs = `<input type="number" data-i="0" data-fid="${fid}_0" step="${d.step || 1}"><input type="number" data-i="1" data-fid="${fid}_1" step="${d.step || 1}">`; break;
      case 'color': inputs = '<input type="color" data-i="c">'; break;
      case 'bool': inputs = '<input type="checkbox" data-i="b">'; break;
      case 'angle': inputs = `<input type="number" data-i="n" data-fid="${fid}" step="1"><span class="unit">°</span>`; break;
      default:
        if (d.options) inputs = `<select data-i="s">${d.options.map((o, i) => `<option value="${i + 1}">${escapeHtml(o)}</option>`).join('')}</select>`;
        else inputs = `<input type="number" data-i="n" data-fid="${fid}" step="${d.step ?? 0.1}" ${d.min !== undefined ? `min="${d.min}"` : ''} ${d.max !== undefined ? `max="${d.max}"` : ''}>${d.max !== undefined && d.max - (d.min ?? 0) <= 1000 ? `<input type="range" data-i="r" min="${d.min ?? 0}" max="${d.max}" step="${d.step ?? 0.1}">` : ''}`;
    }
    return `<div class="prop-row" data-path="${path}" data-kind="${d.kind}">
      <button class="sw" data-pact="stopwatch" title="Cronômetro (animar)">⏱</button>
      <span class="plabel" data-pact="scrub" title="Arraste para ajustar">${escapeHtml(d.label)}</span>
      <span class="pinputs">${inputs}</span>
      <span class="kfnav"><button data-pact="prev" title="Keyframe anterior">‹</button><button data-pact="key" class="kbtn" title="Adicionar/remover keyframe">◆</button><button data-pact="next" title="Próximo keyframe">›</button></span>
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

    // keyframe selecionado
    const s = store.selectedKey;
    if (s) {
      const prop = resolveProp(layer, s.path);
      const key = prop?.keys[keyIndexAt(prop, s.t)];
      root.querySelectorAll('[data-key]').forEach((el) => {
        const act = el.dataset.key;
        const handler = () => {
          if (!key) return;
          if (act === 'ease') key.ease = el.value;
          if (act === 'outInf') { key.outInf = Math.max(0.01, Math.min(1, el.value / 100)); }
          if (act === 'all') prop.keys.forEach((k) => { k.ease = key.ease; k.outInf = key.outInf; k.inInf = key.inInf; });
          if (act === 'del') { removeKeyAt(prop, key.t); store.selectedKey = null; }
          store.commit();
        };
        el.addEventListener(el.tagName === 'BUTTON' ? 'click' : 'change', handler);
      });
    }

    // props de camada
    root.querySelectorAll('[data-prop]').forEach((el) => {
      const k = el.dataset.prop;
      const apply = () => {
        const v = el.type === 'number' ? parseFloat(el.value) : el.value;
        if (el.type === 'number' && !Number.isFinite(v)) return;
        layer.props[k] = el.tagName === 'SELECT' && k === 'fontWeight' ? +v : v;
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

    // efeitos
    root.querySelectorAll('.fx-card').forEach((card) => {
      const fx = layer.effects.find((e) => e.id === card.dataset.fx);
      card.querySelectorAll('[data-fxact]').forEach((el) => {
        const act = el.dataset.fxact;
        el.addEventListener(act === 'enable' ? 'change' : 'click', () => {
          const i = layer.effects.indexOf(fx);
          if (act === 'enable') fx.enabled = el.checked;
          if (act === 'collapse') { if (this.collapsed.has(fx.id)) this.collapsed.delete(fx.id); else this.collapsed.add(fx.id); this.render(); return; }
          if (act === 'del') layer.effects.splice(i, 1);
          if (act === 'up' && i > 0) [layer.effects[i - 1], layer.effects[i]] = [layer.effects[i], layer.effects[i - 1]];
          if (act === 'down' && i < layer.effects.length - 1) [layer.effects[i + 1], layer.effects[i]] = [layer.effects[i], layer.effects[i + 1]];
          store.commit();
        });
      });
    });
    root.querySelector('.fx-add')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      layer.effects.push(createEffectInstance(e.target.value));
      store.commit();
    });

    // linhas de propriedade animável
    root.querySelectorAll('.prop-row').forEach((row) => this.bindPropRow(layer, row));
  }

  bindPropRow(layer, row) {
    const { store } = this;
    const path = row.dataset.path;
    const kind = row.dataset.kind;
    const prop = resolveProp(layer, path);
    if (!prop) return;

    const read = () => {
      const cur = valueAt(prop, store.time);
      if (kind === 'point') return [0, 1].map((i) => { const v = parseFloat(row.querySelector(`[data-i="${i}"]`).value); return Number.isFinite(v) ? v : cur[i]; });
      if (kind === 'color') return hexToRgba(row.querySelector('[data-i="c"]').value, cur?.[3] ?? 1);
      if (kind === 'bool') return row.querySelector('[data-i="b"]').checked;
      const sel = row.querySelector('[data-i="s"]');
      if (sel) return +sel.value;
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
        if (kind !== 'number' && kind !== 'angle' && kind !== 'point') return;
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          const x0 = e.clientX;
          const v0 = valueAt(prop, store.time);
          let moved = false;
          el.onpointermove = (ev) => {
            const d = (ev.clientX - x0) * (ev.shiftKey ? 0.1 : 1) * (kind === 'point' ? 1 : 0.5);
            if (Math.abs(ev.clientX - x0) > 1) moved = true;
            write(Array.isArray(v0) ? v0.map((x, i) => (i === 0 || !ev.altKey ? x + d : x)) : v0 + d);
          };
          el.onpointerup = () => { el.onpointermove = null; if (moved) store.commit(); };
        });
        return;
      }
      el.addEventListener('click', () => {
        const t = store.time;
        if (act === 'stopwatch') toggleStopwatch(prop, t);
        if (act === 'key') toggleKey(prop, t);
        if (act === 'prev') { const pt = prevKeyTime(prop, t); if (pt != null) store.setTime(pt); return; }
        if (act === 'next') { const nt = nextKeyTime(prop, t); if (nt != null) store.setTime(nt); return; }
        store.commit();
      });
    });
    this.binds.push({ row, prop, kind });
  }

  /** Atualiza valores exibidos (tempo mudou / preview) sem recriar o DOM. */
  refresh() {
    const t = this.store.time;
    for (const { row, prop, kind } of this.binds || []) {
      const v = valueAt(prop, t);
      const set = (sel, val) => {
        const el = row.querySelector(sel);
        if (el && document.activeElement !== el) el.value = val;
      };
      if (kind === 'point') { set('[data-i="0"]', round(v[0])); set('[data-i="1"]', round(v[1])); }
      else if (kind === 'color') set('[data-i="c"]', rgbaToHex(v));
      else if (kind === 'bool') { const el = row.querySelector('[data-i="b"]'); if (el) el.checked = !!v; }
      else { set('[data-i="n"]', round(v)); set('[data-i="r"]', v); set('[data-i="s"]', Math.round(v)); }
      const animated = isAnimated(prop);
      row.classList.toggle('animated', animated);
      row.classList.toggle('on-key', keyIndexAt(prop, t) >= 0);
    }
  }
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
