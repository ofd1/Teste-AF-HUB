// Painéis de propriedades (mode 'props') e de efeitos (mode 'effects').
import { valueAt, isAnimated, setValue, toggleKey, toggleStopwatch, keyIndexAt, prevKeyTime, nextKeyTime } from './anim.js';
import { resolveProp } from './state.js';
import { getEffectDef } from './effects.js';
import { escapeHtml, hexToRgba, rgbaToHex, deepClone, uid } from './util.js';
import { toast } from './ui.js';

const TRANSFORM_DEFS = [
  { key: 'position', label: 'Posição', kind: 'point', step: 1 },
  { key: 'scale', label: 'Escala %', kind: 'point', step: 1 },
  { key: 'rotation', label: 'Rotação', kind: 'angle' },
  { key: 'opacity', label: 'Opacidade %', kind: 'number', min: 0, max: 100, step: 1 },
  { key: 'anchor', label: 'Ancoragem', kind: 'point', step: 1 },
];

// modos de mesclagem na ordem do After Effects (os que o navegador desenha de verdade)
const BLENDS = {
  'source-over': 'Normal', darken: 'Escurecer (Darken)', multiply: 'Multiplicar', 'color-burn': 'Superexpor cor (Color Burn)',
  lighten: 'Clarear (Lighten)', screen: 'Tela (Screen)', 'color-dodge': 'Subexpor cor (Color Dodge)', lighter: 'Adicionar (Add)',
  overlay: 'Sobrepor (Overlay)', 'soft-light': 'Luz suave', 'hard-light': 'Luz direta', difference: 'Diferença', exclusion: 'Exclusão',
  hue: 'Matiz', saturation: 'Saturação', color: 'Cor', luminosity: 'Luminosidade',
};
// estilos de opacidade de um toque (como os do Alight Motion)
const OP_STYLES = [
  ['fadeIn', '◐ Fade in'], ['fadeOut', '◑ Fade out'], ['fadeInOut', '◒ Fade in + out'], ['flash', '⚡ Flash'],
  ['blink', '◌ Piscar'], ['strobe', '▦ Strobe'], ['pulse', '◍ Pulsar'], ['flicker', '✳ Cintilar'], ['clear', '✕ Limpar'],
];
const FONTS = ['Inter, system-ui, sans-serif', 'Impact, "Arial Black", sans-serif', '"Arial Black", sans-serif', 'Georgia, serif', '"Courier New", monospace', '"Trebuchet MS", sans-serif', '"Brush Script MT", cursive'];
const TYPE_NAMES = { text: 'Texto', rect: 'Retângulo', ellipse: 'Elipse', solid: 'Sólido', image: 'Imagem', video: 'Vídeo', audio: 'Áudio', adjustment: 'Camada de ajuste' };

// área de transferência de efeitos (vale entre camadas e entre projetos neste aparelho)
let clipboard = null;
function fxClipboard() {
  if (!clipboard) { try { clipboard = JSON.parse(localStorage.getItem('motionframe.fxClipboard') || '[]'); } catch { clipboard = []; } }
  return clipboard;
}
function setFxClipboard(list) {
  clipboard = deepClone(list);
  try { localStorage.setItem('motionframe.fxClipboard', JSON.stringify(clipboard)); } catch { /* sem espaço */ }
}

/** Cria os keyframes de opacidade de um estilo pronto, no início/fim da camada. */
export function applyOpacityStyle(layer, style, dur, fps = 30) {
  const op = layer.transform.opacity;
  const a = layer.inPoint, b = layer.outPoint, d = Math.max(1 / fps, Math.min(dur, (b - a) / 2));
  const k = (t, v, ease = 'easeInOut') => ({ t: +t.toFixed(4), v, ease });
  const base = 100;
  let keys = [];
  switch (style) {
    case 'fadeIn': keys = [k(a, 0), k(a + d, base)]; break;
    case 'fadeOut': keys = [k(b - d, base), k(b - 1 / fps, 0)]; break;
    case 'fadeInOut': keys = [k(a, 0), k(a + d, base), k(b - d, base), k(b - 1 / fps, 0)]; break;
    case 'flash': keys = [k(a, base, 'linear'), k(a + 1 / fps, 0, 'easeOut'), k(a + d, base)]; break;
    case 'blink': for (let t = a, on = true; t < b; t += d, on = !on) keys.push(k(t, on ? base : 0, 'hold')); break;
    case 'strobe': for (let t = a, on = true; t < b; t += 2 / fps, on = !on) keys.push(k(t, on ? base : 0, 'hold')); break;
    case 'pulse': for (let t = a, i = 0; t <= b; t += d, i++) keys.push(k(t, i % 2 ? 35 : base)); break;
    case 'flicker': { let s = 7; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280); for (let t = a; t < b; t += 1 / fps * (1 + Math.floor(rnd() * 3))) keys.push(k(t, rnd() < 0.3 ? 15 + rnd() * 30 : base, 'hold')); break; }
    case 'clear': op.keys = []; op.value = base; return;
    default: return;
  }
  op.keys = keys;
  op.value = keys[0]?.v ?? base;
}

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
        rows.push(f('Suavizar movimento', `<label class="switch"><input type="checkbox" data-prop="interpolate" ${p.interpolate ? 'checked' : ''}><i></i></label>`));
        rows.push('<div class="note muted">Interpolação de quadros por fluxo óptico: cria quadros intermediários (ex.: vídeo 30 fps exportado a 60 fps fica fluido).</div>');
        rows.push(f('FPS do vídeo', num('sourceFps', 0.001, 1, 240)));
        rows.push('<button class="wide" data-hook="speed">⏱ Rampa de velocidade (estilo Twixtor)</button>');
        rows.push('<button class="wide" data-hook="track">◎ Rastrear movimento (tracker)</button>');
        rows.push(f('Largura', num('width', 1, 1)), f('Altura', num('height', 1, 1)));
        break;
      case 'audio':
        rows.push(f('Início no áudio (s)', num('sourceStart', 0.01, 0)));
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
    if (layer.type === 'audio' || layer.type === 'video') {
      const sr = [];
      if (layer.type === 'video' && !p.hasAudio) sr.push('<div class="note muted">Este vídeo não tem faixa de áudio (ou ainda está carregando).</div>');
      if (layer.type === 'video' && p.hasAudio && layer.effects.some((fx) => fx.enabled && (fx.type === 'twixtor' || fx.type === 'timeRemap'))) sr.push('<div class="note">Com Velocidade/Twixtor ou Time Remap o som do vídeo fica desligado (como no After Effects). Use uma camada de música.</div>');
      sr.push(f('Volume %', `<input type="range" data-prop="volume" min="0" max="200" step="1" value="${p.volume ?? 100}"><input type="number" class="num" data-prop="volume" min="0" max="200" step="1" value="${p.volume ?? 100}">`));
      sr.push(f('Mudo', `<label class="switch"><input type="checkbox" data-prop="muted" ${p.muted ? 'checked' : ''}><i></i></label>`));
      sr.push(f('Fade in (s)', num('fadeIn', 0.05, 0, 30)));
      sr.push(f('Fade out (s)', num('fadeOut', 0.05, 0, 30)));
      html += `<div data-section="sound">${this.section('sound', '🔊 Som', sr.join(''))}</div>`;
    }
    if (layer.type !== 'audio') {
      // Mesclagem e opacidade (Alight Motion): modo, opacidade e estilos prontos
      const op = Math.round(valueAt(layer.transform.opacity, this.store.time) ?? 100);
      html += this.section('blendop', '◐ Mesclagem e opacidade', [
        f('Modo', `<select data-layer="blend">${Object.entries(BLENDS).map(([k, l]) => `<option value="${k}" ${layer.blend === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`),
        f('Opacidade %', `<input type="range" data-opacity min="0" max="100" step="1" value="${op}"><input type="number" class="num" data-opacity min="0" max="100" step="1" value="${op}">`),
        f('Duração do estilo (s)', `<input type="number" class="num" data-opdur min="0.05" max="10" step="0.05" value="${this.opDur ?? 0.4}">`),
        `<div class="op-styles">${OP_STYLES.map(([k, l]) => `<button data-opstyle="${k}">${l}</button>`).join('')}</div>`,
      ].join(''));
      html += this.section('transform', 'Transformar', TRANSFORM_DEFS.map((d) => this.propRow(`transform.${d.key}`, d)).join(''));
    }
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
          <span class="fx-tools"><button data-fxact="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button data-fxact="down" ${i === layer.effects.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button><button data-fxact="copy" aria-label="Copiar este efeito" title="Copiar este efeito">⎘</button><button data-fxact="dup" aria-label="Duplicar">⧉</button><button data-fxact="del" class="danger" aria-label="Remover">✕</button></span>
        </div>
        <div class="fx-body">
          ${def.plugin ? `<div class="plugin-note">Recriação estilo <b>${escapeHtml(def.plugin)}</b></div>` : ''}
          ${def.description ? `<div class="desc">${escapeHtml(def.description)}</div>` : ''}
          ${generic ? '<div class="note">Efeito do AE sem equivalente: controles importados (editáveis e animáveis) sem alterar a imagem.</div>' : ''}
          ${def.params.filter((pd) => !pd.advanced && pd.kind !== 'hidden').map((pd) => this.propRow(`fx:${fx.id}.${pd.key}`, pd)).join('')}
          ${def.params.some((pd) => pd.advanced) ? `<details class="adv"><summary>Avançado</summary>${def.params.filter((pd) => pd.advanced && pd.kind !== 'hidden').map((pd) => this.propRow(`fx:${fx.id}.${pd.key}`, pd)).join('')}</details>` : ''}
        </div>
      </div>`;
    });
    const clip = fxClipboard();
    return `<button class="wide primary add-fx" data-hook="browse">＋ Adicionar efeito</button>
      <div class="fx-clip">
        <button data-clip="copy" ${layer.effects.length ? '' : 'disabled'}>⎘ Copiar efeitos</button>
        <button data-clip="paste" ${clip.length ? '' : 'disabled'}>📋 Colar ${clip.length ? `(${clip.length})` : 'efeitos'}</button>
        <button data-clip="save" ${layer.effects.length ? '' : 'disabled'}>★ Salvar preset</button>
      </div>
      ${cards.join('') || '<div class="empty-note">Nenhum efeito nesta camada ainda. Toque em “＋ Adicionar efeito” ou aplique um preset.</div>'}`;
  }

  propRow(path, d) {
    const fid = path.replace(/[^a-z0-9]/gi, '_');
    let inputs;
    switch (d.kind) {
      case 'point': inputs = `<input type="number" inputmode="decimal" data-i="0" data-fid="${fid}_0" step="${d.step || 1}"><input type="number" inputmode="decimal" data-i="1" data-fid="${fid}_1" step="${d.step || 1}">`; break;
      case 'point3': inputs = [0, 1, 2].map((i) => `<input type="number" inputmode="decimal" data-i="${i}" data-fid="${fid}_${i}" step="0.01">`).join(''); break;
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
        let v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? parseFloat(el.value) : el.value;
        if ((el.type === 'number' || el.type === 'range') && !Number.isFinite(v)) return;
        root.querySelectorAll(`[data-prop="${k}"]`).forEach((o) => { if (o !== el && o.type !== 'checkbox') o.value = v; });
        if (k === 'fontWeight') v = +v;
        layer.props[k] = v;
        store.emit('preview');
      };
      el.addEventListener('input', apply);
      el.addEventListener('change', () => { apply(); store.commit(); });
    });
    // opacidade direta (keyframe se a opacidade já estiver animada)
    root.querySelectorAll('[data-opacity]').forEach((el) => el.addEventListener('input', () => {
      setValue(layer.transform.opacity, store.time, Math.max(0, Math.min(100, +el.value || 0)));
      root.querySelectorAll('[data-opacity]').forEach((x) => { if (x !== el) x.value = el.value; });
      store.emit('preview');
    }));
    root.querySelectorAll('[data-opacity]').forEach((el) => el.addEventListener('change', () => store.commit()));
    root.querySelector('[data-opdur]')?.addEventListener('change', (e) => { this.opDur = Math.max(0.05, +e.target.value || 0.4); });
    root.querySelectorAll('[data-opstyle]').forEach((b) => b.addEventListener('click', () => {
      applyOpacityStyle(layer, b.dataset.opstyle, this.opDur ?? 0.4, store.project.fps);
      store.commit();
    }));
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

    root.querySelectorAll('[data-clip]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.clip;
      if (act === 'copy') {
        setFxClipboard(layer.effects);
        toast(`${layer.effects.length} efeito(s) copiado(s). Selecione outra camada e toque em Colar.`, 'ok');
        this.render();
      } else if (act === 'paste') {
        const list = fxClipboard();
        for (const fx of list) layer.effects.push({ ...deepClone(fx), id: uid('fx') });
        store.commit();
        toast(`${list.length} efeito(s) colado(s) em ${layer.name}.`, 'ok');
      } else if (act === 'save') this.hooks.savePreset?.(layer);
    }));
    root.querySelectorAll('.fx-card').forEach((card) => {
      const fx = layer.effects.find((e) => e.id === card.dataset.fx);
      card.querySelectorAll('[data-fxact]').forEach((el) => {
        const act = el.dataset.fxact;
        el.addEventListener(act === 'enable' ? 'change' : 'click', () => {
          const i = layer.effects.indexOf(fx);
          if (act === 'enable') fx.enabled = el.checked;
          if (act === 'collapse') { if (this.collapsed.has(fx.id)) this.collapsed.delete(fx.id); else this.collapsed.add(fx.id); this.render(); return; }
          if (act === 'copy') { setFxClipboard([fx]); toast(`“${fx.label || getEffectDef(fx.type).label}” copiado. Selecione outra camada e toque em Colar.`, 'ok'); this.render(); return; }
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
      if (kind === 'point3') return [0, 1, 2].map((i) => { const v = parseFloat(row.querySelector(`[data-i="${i}"]`).value); return Number.isFinite(v) ? v : cur[i]; });
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
      if (kind === 'point3') [0, 1, 2].forEach((i) => set(`[data-i="${i}"]`, round(v[i])));
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
