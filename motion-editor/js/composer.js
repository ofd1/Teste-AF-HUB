// Painel "Composer" (no estilo do Animation Composer): biblioteca de animações prontas — entradas, saídas, transições
// entre clipes, animações de texto, elementos (formas) e impactos — com prévia animada, busca, favoritos e duração.
// Abre também pelos plugins "de painel" importados (.aex de Animation Composer, AEJuice Pack Manager, Motion Bro…).
import { LAYER_FACTORIES, createProject } from './state.js';
import { applyPreset, BUILTIN_PRESETS, stretchPreset } from './presets.js';
import { renderFrame } from './renderer.js';
import { toast, storage } from './ui.js';
import { escapeHtml } from './util.js';
import { MO_TEXT, MO_INOUT, MO_ELEMENTS, MO_LOGO, shiftShapeKeys } from './mograph.js';

const FAV_KEY = 'motionframe.composerFavs';
const CATS = ['Motion design', 'Mograph texto', 'Mograph formas', 'Logo reveal', 'Entradas', 'Saídas', 'Transições', 'Texto', 'Elementos', 'Impacto'];

// ---------------------------------------------------------------- definições (tempo normalizado 0..1)
// tr: { prop: [mode, [[u, valor, ease], ...]] }   fx: [[tipo, { param: [[u, valor, ease]] | constante }]]
const ENTRADAS = (W, H) => [
  ['Fade', { opacity: ['abs', [[0, 0], [1, 100]]] }],
  ['Deslizar da esquerda', { position: ['rel', [[0, [-W * 0.7, 0], 'easeOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0], [0.4, 100]]] }],
  ['Deslizar da direita', { position: ['rel', [[0, [W * 0.7, 0], 'easeOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0], [0.4, 100]]] }],
  ['Deslizar de cima', { position: ['rel', [[0, [0, -H * 0.5], 'easeOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0], [0.4, 100]]] }],
  ['Deslizar de baixo', { position: ['rel', [[0, [0, H * 0.5], 'easeOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0], [0.4, 100]]] }],
  ['Zoom in', { scale: ['abs', [[0, [0, 0], 'easeOut'], [1, [100, 100]]]], opacity: ['abs', [[0, 0], [0.3, 100]]] }],
  ['Zoom out', { scale: ['abs', [[0, [170, 170], 'easeOut'], [1, [100, 100]]]], opacity: ['abs', [[0, 0], [0.5, 100]]] }],
  ['Pop (estourar)', { scale: ['abs', [[0, [0, 0], 'easeOut'], [0.6, [118, 118], 'easeInOut'], [0.8, [94, 94], 'easeInOut'], [1, [100, 100]]]] }],
  ['Girar e entrar', { rotation: ['abs', [[0, -180, 'easeOut'], [1, 0]]], scale: ['abs', [[0, [0, 0], 'easeOut'], [1, [100, 100]]]] }],
  ['Esticar', { scale: ['abs', [[0, [0, 100], 'easeOut'], [0.7, [108, 96], 'easeInOut'], [1, [100, 100]]]] }],
  ['Cair com quique', { position: ['rel', [[0, [0, -H * 0.6], 'easeIn'], [0.6, [0, 0], 'easeOut'], [0.8, [0, -H * 0.05], 'easeIn'], [1, [0, 0]]]] }],
  ['Balançar', { rotation: ['abs', [[0, -25, 'easeInOut'], [0.4, 14, 'easeInOut'], [0.7, -6, 'easeInOut'], [1, 0]]], opacity: ['abs', [[0, 0], [0.25, 100]]] }],
  ['Desfoque', { opacity: ['abs', [[0, 0], [0.6, 100]]] }, [['blur', { radius: [[0, 80, 'easeOut'], [1, 0]] }]]],
  ['Zoom blur', { scale: ['abs', [[0, [135, 135], 'easeOut'], [1, [100, 100]]]] }, [['radialBlur', { amount: [[0, 70, 'easeOut'], [1, 0]] }]]],
  ['Glitch', {}, [['rgbSplit', { amount: [[0, 70, 'easeOut'], [1, 0]] }], ['glitch', { amount: [[0, 80, 'easeOut'], [1, 0]] }]]],
  ['Flash', {}, [['exposure', { exposure: [[0, 3.5, 'easeOut'], [1, 0]] }]]],
  ['Revelar (wipe)', {}, [['pkWipe', { mode: 1, soft: 6, pct: [[0, 100, 'easeOut'], [1, 0]] }]]],
  ['Íris (círculo)', {}, [['pkWipe', { mode: 3, invert: true, soft: 4, pct: [[0, 100, 'easeOut'], [1, 0]] }]]],
  ['Relógio', {}, [['pkWipe', { mode: 2, soft: 3, pct: [[0, 100, 'easeInOut'], [1, 0]] }]]],
  ['Pixels (dissolver)', {}, [['pkWipe', { mode: 16, soft: 30, pct: [[0, 100, 'linear'], [1, 0]] }]]],
];

// transições: [nome, parte da saída (clipe A), parte da entrada (clipe B)]
const TRANSICOES = (W) => [
  ['Zoom através', [{ scale: ['abs', [[0, [100, 100], 'easeIn'], [1, [320, 320]]]] }, [['radialBlur', { amount: [[0, 0, 'easeIn'], [1, 80]] }]]], [{ scale: ['abs', [[0, [40, 40], 'easeOut'], [1, [100, 100]]]] }, [['radialBlur', { amount: [[0, 80, 'easeOut'], [1, 0]] }]]]],
  ['Whip pan ←', [{ position: ['rel', [[0, [0, 0], 'easeIn'], [1, [-W, 0]]]] }, [['dirBlur', { angle: 90, length: [[0, 0, 'easeIn'], [1, 160]] }]]], [{ position: ['rel', [[0, [W, 0], 'easeOut'], [1, [0, 0]]]] }, [['dirBlur', { angle: 90, length: [[0, 160, 'easeOut'], [1, 0]] }]]]],
  ['Whip pan →', [{ position: ['rel', [[0, [0, 0], 'easeIn'], [1, [W, 0]]]] }, [['dirBlur', { angle: 90, length: [[0, 0, 'easeIn'], [1, 160]] }]]], [{ position: ['rel', [[0, [-W, 0], 'easeOut'], [1, [0, 0]]]] }, [['dirBlur', { angle: 90, length: [[0, 160, 'easeOut'], [1, 0]] }]]]],
  ['Giro', [{ rotation: ['abs', [[0, 0, 'easeIn'], [1, 180]]], scale: ['abs', [[0, [100, 100], 'easeIn'], [1, [160, 160]]]] }, [['radialBlur', { mode: 2, amount: [[0, 0, 'easeIn'], [1, 60]] }]]], [{ rotation: ['abs', [[0, -180, 'easeOut'], [1, 0]]], scale: ['abs', [[0, [160, 160], 'easeOut'], [1, [100, 100]]]] }, [['radialBlur', { mode: 2, amount: [[0, 60, 'easeOut'], [1, 0]] }]]]],
  ['Flash branco', [{}, [['exposure', { exposure: [[0, 0, 'easeIn'], [1, 4]] }]]], [{}, [['exposure', { exposure: [[0, 4, 'easeOut'], [1, 0]] }]]]],
  ['Glitch', [{}, [['rgbSplit', { amount: [[0, 0, 'easeIn'], [1, 90]] }], ['glitch', { amount: [[0, 0, 'easeIn'], [1, 100]] }]]], [{}, [['rgbSplit', { amount: [[0, 90, 'easeOut'], [1, 0]] }], ['glitch', { amount: [[0, 100, 'easeOut'], [1, 0]] }]]]],
  ['Desfoque', [{}, [['blur', { radius: [[0, 0, 'easeIn'], [1, 90]] }]]], [{}, [['blur', { radius: [[0, 90, 'easeOut'], [1, 0]] }]]]],
  ['Wipe linear', [{}, [['pkWipe', { mode: 1, soft: 3, pct: [[0, 0, 'easeInOut'], [1, 100]] }]]], null],
  ['Estrela', [{}, [['pkWipe', { mode: 5, soft: 2, pct: [[0, 0, 'easeInOut'], [1, 100]] }]]], null],
  ['Íris', [{}, [['pkWipe', { mode: 3, soft: 2, pct: [[0, 0, 'easeInOut'], [1, 100]] }]]], null],
  ['Relógio', [{}, [['pkWipe', { mode: 2, soft: 2, pct: [[0, 0, 'linear'], [1, 100]] }]]], null],
  ['Xadrez', [{}, [['pkWipe', { mode: 7, soft: 1, freq: 6, pct: [[0, 0, 'linear'], [1, 100]] }]]], null],
  ['Bolhas', [{}, [['pkWipe', { mode: 14, soft: 8, pct: [[0, 0, 'linear'], [1, 100]] }]]], null],
  ['Luz (wipe com brilho)', [{}, [['pkWipe', { mode: 14, soft: 15, glow: 3, pct: [[0, 0, 'linear'], [1, 100]] }]]], null],
  ['Dissolver', [{ opacity: ['abs', [[0, 100, 'linear'], [1, 0]]] }, []], null],
];

// texto: animadores de texto (como os presets de texto do AE)
const sel = (o) => ({ type: 'range', based: 1, shape: 1, smooth: 100, start: { value: 0, keys: [] }, end: { value: 100, keys: [] }, ...o });
const TEXTOS = (fs) => [
  ['Máquina de escrever', (d) => [{ props: { opacity: A(0) }, selectors: [sel({ smooth: 0, start: K2(0, 0, d, 100, 'linear') })] }]],
  ['Letras subindo', (d) => [{ props: { opacity: A(0), position: A([0, fs * 0.8]) }, selectors: [sel({ start: K2(0, 0, d, 100, 'easeOut') })] }]],
  ['Palavra por palavra', (d) => [{ props: { opacity: A(0), position: A([0, fs * 0.4]) }, selectors: [sel({ based: 3, start: K2(0, 0, d, 100, 'linear') })] }]],
  ['Pop por letra', (d) => [{ props: { scale: A([0, 0]) }, selectors: [sel({ shape: 3, start: K2(0, 0, d, 100, 'easeOut') })] }]],
  ['Desfoque por letra', (d) => [{ props: { opacity: A(0), blur: A([24, 24]) }, selectors: [sel({ start: K2(0, 0, d, 100, 'easeOut') })] }]],
  ['Letras aleatórias', (d) => [{ props: { opacity: A(0) }, selectors: [sel({ smooth: 0, randomize: true, seed: 7, start: K2(0, 0, d, 100, 'linear') })] }]],
  ['Abrir espaçamento', (d) => [{ props: { opacity: K2(0, 0, d * 0.6, 100, 'easeOut'), tracking: K2(0, 600, d, 0, 'easeOut') }, selectors: [] }]],
  ['Girar letras', (d) => [{ props: { rotation: A(-90), opacity: A(0) }, selectors: [sel({ start: K2(0, 0, d, 100, 'easeOut') })] }]],
  ['Ondular (contínuo)', () => [{ props: { position: A([0, fs * 0.25]) }, selectors: [{ type: 'wiggly', based: 1, mode: 1, max: A(100), min: A(-100), freq: A(2), correlation: A(70) }] }]],
];
const A = (v) => ({ value: v, keys: [] });
const K2 = (t0, v0, t1, v1, ease = 'easeOut') => ({ value: v0, keys: [{ t: t0, v: v0, ease }, { t: t1, v: v1, ease: 'linear' }] });

// elementos: camadas novas (formas) já animadas
const ELEMENTOS = [
  ['Anel expandindo', (P, d) => { const l = LAYER_FACTORIES.ellipse(P); l.props.fill = 'rgba(0,0,0,0)'; l.props.strokeWidth = Math.round(P.width * 0.012); l.props.strokeColor = '#ffffff'; key(l, 'scale', [[0, [0, 0], 'easeOut'], [d, [260, 260]]]); key(l, 'opacity', [[0, 100], [d * 0.5, 100, 'easeIn'], [d, 0]]); return l; }],
  ['Círculo pop', (P, d) => { const l = LAYER_FACTORIES.ellipse(P); l.props.fill = '#7c5cff'; key(l, 'scale', [[0, [0, 0], 'easeOut'], [d * 0.35, [115, 115], 'easeInOut'], [d * 0.5, [100, 100], 'easeIn'], [d, [0, 0]]]); return l; }],
  ['Barra passando', (P, d) => { const l = LAYER_FACTORIES.rect(P); l.props.width = Math.round(P.width * 0.35); l.props.height = P.height * 1.2; l.props.radius = 0; l.props.fill = '#ffffff'; key(l, 'position', [[0, [-P.width * 0.3, P.height / 2], 'easeInOut'], [d, [P.width * 1.3, P.height / 2]]]); return l; }],
  ['Cortina (cobre e abre)', (P, d) => { const l = LAYER_FACTORIES.solid(P); l.props.fill = '#111111'; key(l, 'position', [[0, [-P.width / 2, P.height / 2], 'easeInOut'], [d * 0.5, [P.width / 2, P.height / 2], 'easeInOut'], [d, [P.width * 1.5, P.height / 2]]]); return l; }],
  ['Flash de tela', (P, d) => { const l = LAYER_FACTORIES.solid(P); l.props.fill = '#ffffff'; key(l, 'opacity', [[0, 100, 'easeOut'], [d, 0]]); return l; }],
  ['Linha crescendo', (P, d) => { const l = LAYER_FACTORIES.rect(P); l.props.width = Math.round(P.width * 0.7); l.props.height = Math.max(4, Math.round(P.width * 0.008)); l.props.radius = 4; l.props.fill = '#ffffff'; key(l, 'scale', [[0, [0, 100], 'easeOut'], [d * 0.5, [100, 100], 'easeIn'], [d, [0, 100]]]); return l; }],
];
function key(l, prop, list) { l.transform[prop].keys = list.map(([t, v, ease]) => ({ t, v, ease: ease || 'linear' })); l.transform[prop].value = list[0][1]; }

// ---------------------------------------------------------------- conversão para presets do MotionFrame
const MIRROR = { easeOut: 'easeIn', easeIn: 'easeOut', expoOut: 'expoIn', expoIn: 'expoOut', elastic: 'backIn', back: 'backIn', backIn: 'back', bounce: 'easeIn' };
const mirrorEase = (e) => MIRROR[e] || e || 'linear';
function toPreset(name, tr, fx, d, out = false) {
  const conv = (keys) => {
    let ks = keys.map(([u, v, ease]) => ({ u, v, ease: ease || 'easeInOut' }));
    // saída = entrada espelhada no tempo: o trecho i-1→i vira o trecho de volta, com a curva espelhada
    if (out) { const n = keys.length; ks = keys.map((_, j) => { const i = n - 1 - j; return { u: 1 - keys[i][0], v: keys[i][1], ease: i > 0 ? mirrorEase(keys[i - 1][2] || 'easeInOut') : 'linear' }; }); }
    return ks.map((k) => ({ t: +(k.u * d).toFixed(4), v: k.v, ease: k.ease }));
  };
  const transform = Object.fromEntries(Object.entries(tr || {}).map(([p, [mode, keys]]) => [p, { mode, keys: conv(keys) }]));
  const effects = (fx || []).map(([type, params]) => ({ type, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) && Array.isArray(v[0]) ? { keys: conv(v) } : v])) }));
  return { name, anchor: out ? 'end' : 'playhead', duration: d, transform, effects };
}

export function composerItems(W = 1080, H = 1920) {
  const items = [];
  for (const [name, tr, fx] of ENTRADAS(W, H)) {
    items.push({ id: `in:${name}`, cat: 'Entradas', name, kind: 'in', dur: 0.6, make: (d) => toPreset(name, tr, fx, d) });
    items.push({ id: `out:${name}`, cat: 'Saídas', name, kind: 'out', dur: 0.6, make: (d) => toPreset(name, tr, fx, d, true) });
  }
  for (const [name, a, b] of TRANSICOES(W)) items.push({ id: `tr:${name}`, cat: 'Transições', name, kind: 'trans', dur: 0.5, make: (d) => ({ a: { ...toPreset(name, a[0], a[1], d / (b ? 2 : 1)), anchor: 'end' }, b: b ? toPreset(name, b[0], b[1], d / 2) : null }) });
  for (const p of BUILTIN_PRESETS.filter((x) => x.category === 'Transições')) items.push({ id: `trb:${p.name}`, cat: 'Transições', name: p.name, kind: 'fx', dur: p.duration || 0.5, make: (d) => stretchPreset(p, d / (p.duration || d)) });
  for (const [name, mk] of TEXTOS(100)) items.push({ id: `tx:${name}`, cat: 'Texto', name, kind: 'text', dur: 1, mk });
  // pacote de motion design (mograph.js)
  for (const [name, tr, fx] of MO_INOUT(W, H)) {
    items.push({ id: `mdin:${name}`, cat: 'Motion design', name: `▶ ${name}`, kind: 'in', dur: 0.7, make: (d) => toPreset(name, tr, fx, d) });
    items.push({ id: `mdout:${name}`, cat: 'Motion design', name: `◀ ${name} (saída)`, kind: 'out', dur: 0.6, make: (d) => toPreset(name, tr, fx, d, true) });
  }
  for (const [name, fn] of MO_TEXT) items.push({ id: `mt:${name}`, cat: 'Mograph texto', name, kind: 'text', dur: 1, mk: (d, fs = 100) => fn(d, fs) });
  for (const [name, mk] of MO_ELEMENTS) items.push({ id: `me:${name}`, cat: 'Mograph formas', name, kind: 'element', dur: 1, mk });
  for (const [name, tr, fx] of MO_LOGO(W)) items.push({ id: `lg:${name}`, cat: 'Logo reveal', name, kind: 'in', dur: 1.2, make: (d) => toPreset(name, tr, fx, d) });
  for (const [name, mk] of ELEMENTOS) items.push({ id: `el:${name}`, cat: 'Elementos', name, kind: 'element', dur: 0.8, mk });
  for (const p of BUILTIN_PRESETS.filter((x) => /Shakes|Glows|Velocity/.test(x.category))) items.push({ id: `fx:${p.name}`, cat: 'Impacto', name: p.name, kind: 'fx', dur: p.duration || 0.6, native: true, make: (d) => (p.duration ? stretchPreset(p, d / p.duration) : p) });
  return items;
}

// ---------------------------------------------------------------- aplicar
/** Aplica o item. ctx: { store }. Retorna mensagem para o usuário. */
export function applyComposerItem(item0, dur, store) {
  const P = store.project, t = store.time;
  const item = composerItems(P.width, P.height).find((x) => x.id === item0.id) || item0; // deslocamentos no tamanho da composição
  if (item.kind === 'element') {
    const made = item.mk(P, dur);
    const list = Array.isArray(made) ? made : [made];
    // várias camadas (templates com texto): adiciona de baixo para cima
    for (const l of [...list].reverse()) {
      if (!Array.isArray(made)) l.name = item.name;
      for (const p of Object.values(l.transform)) for (const k of p.keys) k.t = +(k.t + t).toFixed(4);
      if (l.type === 'shape') shiftShapeKeys(l.props.shapes, t);
      l.inPoint = t; l.outPoint = Math.min(P.duration, t + dur);
      store.addLayer(l);
    }
    return `“${item.name}” adicionado em ${t.toFixed(2)} s.`;
  }
  let layer = store.layer();
  if (item.kind === 'text') {
    if (!layer || layer.type !== 'text') { layer = LAYER_FACTORIES.text(P); layer.inPoint = t; layer.outPoint = Math.min(P.duration, t + Math.max(3, dur + 1)); store.addLayer(layer); }
    const anims = item.mk(dur * 1, layer.props.fontSize || 100).map((an) => shiftAnim(an, layer.inPoint));
    layer.props.animators = [...(layer.props.animators || []), ...anims];
    store.commit('structure');
    return `Animação de texto “${item.name}” aplicada em “${layer.name}”.`;
  }
  if (!layer) return 'Selecione uma camada na timeline primeiro.';
  if (item.kind === 'in') { applyPreset(layer, item.make(dur), layer.inPoint); store.commit('structure'); return `Entrada “${item.name}” no início de “${layer.name}”.`; }
  if (item.kind === 'out') { applyPreset(layer, item.make(dur), layer.outPoint); store.commit('structure'); return `Saída “${item.name}” no fim de “${layer.name}”.`; }
  if (item.kind === 'fx') { applyPreset(layer, item.make(dur), t); store.commit('structure'); return `“${item.name}” aplicado em ${t.toFixed(2)} s.`; }
  // transição: o clipe selecionado é o que sai; o que entra é o que começa no fim dele (corte)
  const { a, b } = item.make(dur);
  const next = store.layers.find((x) => x !== layer && Math.abs(x.inPoint - layer.outPoint) < 0.15 && x.type !== 'audio');
  applyPreset(layer, a, layer.outPoint);
  if (b && next) applyPreset(next, b, next.inPoint);
  store.commit('structure');
  return next ? `Transição “${item.name}” entre “${layer.name}” e “${next.name}”.` : `Transição “${item.name}” no fim de “${layer.name}” (não achei clipe começando logo depois — a parte de entrada não foi aplicada).`;
}
function shiftAnim(an, t0) {
  const sh = (p) => (p && p.keys ? { ...p, keys: p.keys.map((k) => ({ ...k, t: +(k.t + t0).toFixed(4) })) } : p);
  return { ...an, props: Object.fromEntries(Object.entries(an.props).map(([k, v]) => [k, sh(v)])), selectors: (an.selectors || []).map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, sh(v)]))) };
}

// ---------------------------------------------------------------- prévia
const PW = 320, PH = 180;
function previewProject(item, dur) {
  const P = createProject(PW, PH); P.duration = dur + 1.2; P.fps = 30; P.background = '#15151c';
  const bg = LAYER_FACTORIES.solid(P); bg.props.fill = '#15151c'; bg.inPoint = 0; bg.outPoint = P.duration;
  const card = (fill, label) => {
    const r = LAYER_FACTORIES.rect(P); r.props.width = 200; r.props.height = 120; r.props.radius = 14; r.props.fill = fill;
    const tx = LAYER_FACTORIES.text(P); tx.props.text = label; tx.props.fontSize = 34; tx.props.color = '#ffffff';
    const g = LAYER_FACTORIES.group(P, [tx, r]); g.inPoint = r.inPoint = tx.inPoint = 0; g.outPoint = r.outPoint = tx.outPoint = P.duration;
    return g;
  };
  const s0 = 0.3;
  if (item.kind === 'element') {
    const made = item.mk(P, dur), list = Array.isArray(made) ? made : [made];
    for (const l of list) {
      for (const p of Object.values(l.transform)) for (const k of p.keys) k.t += s0;
      if (l.type === 'shape') { if (!Array.isArray(made)) l.transform.position = { value: [PW / 2, PH / 2], keys: [] }; shiftShapeKeys(l.props.shapes, s0); }
      l.inPoint = s0; l.outPoint = s0 + dur;
    }
    P.layers = [...list, bg]; return P;
  }
  if (item.kind === 'text') {
    const tx = LAYER_FACTORIES.text(P); tx.props.text = 'MOTION'; tx.props.fontSize = 56; tx.inPoint = 0; tx.outPoint = P.duration;
    tx.props.animators = item.mk(dur, 56).map((an) => shiftAnim(an, s0)); P.layers = [tx, bg]; return P;
  }
  if (item.kind === 'trans') {
    const A1 = card('#3d6cff', 'A'), B1 = card('#ff7a3d', 'B');
    const cut = s0 + dur / 2;
    A1.outPoint = cut; B1.inPoint = cut;
    const { a, b } = item.make(dur);
    applyPreset(A1, a, cut);
    if (b) applyPreset(B1, b, cut);
    P.layers = [A1, B1, bg]; return P;
  }
  const c = card('#7c5cff', 'Aa');
  if (item.kind === 'out') { c.outPoint = s0 + dur; applyPreset(c, item.make(dur), c.outPoint); }
  else applyPreset(c, item.make(dur), s0);
  P.layers = [c, bg];
  return P;
}

// ---------------------------------------------------------------- painel
export class ComposerPanel {
  constructor(root, store, hooks = {}) {
    this.root = root; this.store = store; this.hooks = hooks;
    this.cat = 'Motion design'; this.q = ''; this.sel = null; this.dur = null;
    this.favs = new Set(storage.get(FAV_KEY, []));
    this.items = composerItems();
    this.raf = 0; this.thumbs = new Map(); this.ready = false; // monta na primeira vez que o painel abre
  }

  list() {
    const q = this.q.trim().toLowerCase();
    return this.items.filter((it) => (this.cat === '★' ? this.favs.has(it.id) : it.cat === this.cat) && (!q || `${it.name} ${it.cat}`.toLowerCase().includes(q)));
  }

  render() {
    const list = this.list();
    if (!this.sel || !list.includes(this.sel)) this.sel = list[0] || null;
    const it = this.sel, dur = this.dur ?? it?.dur ?? 0.6;
    this.root.innerHTML = `
      <div class="composer">
        <div class="cmp-preview" style="position:relative;background:#15151c;border-radius:10px;overflow:hidden;aspect-ratio:16/9">
          <canvas width="${PW}" height="${PH}" style="width:100%;height:100%;display:block"></canvas>
          <div style="position:absolute;left:8px;top:6px;font-size:12px;color:#fff9">${it ? escapeHtml(`${it.cat} · ${it.name}`) : ''}</div>
        </div>
        <div class="cmp-bar" style="display:flex;gap:8px;align-items:center;margin:8px 0">
          <label style="flex:1;display:flex;gap:6px;align-items:center;font-size:12px">Duração <input type="range" min="0.15" max="3" step="0.05" value="${dur}" data-c="dur" style="flex:1"> <b data-c="durv">${dur.toFixed(2)} s</b></label>
          <button class="primary" data-c="apply" ${it ? '' : 'disabled'}>Aplicar</button>
          <button data-c="fav" title="Favoritar" ${it ? '' : 'disabled'}>${it && this.favs.has(it.id) ? '★' : '☆'}</button>
        </div>
        <p class="muted" style="font-size:11px;margin:0 0 6px">${it ? HINT[it.kind] : ''}</p>
        <input type="search" class="fx-search" data-c="q" placeholder="Buscar animação…" value="${escapeHtml(this.q)}">
        <div class="chips">${['★', ...CATS].map((c) => `<button class="chip ${c === this.cat ? 'on' : ''}" data-cat="${c}">${c === '★' ? '★ Favoritos' : c}</button>`).join('')}</div>
        <div class="fx-grid cmp-grid">${list.map((x) => `<button class="fx-tile cmp-tile ${x === it ? 'on' : ''}" data-id="${escapeHtml(x.id)}" style="${x === it ? 'outline:2px solid var(--accent,#2d8cf0)' : ''}">
          <canvas width="160" height="90" data-thumb="${escapeHtml(x.id)}" style="width:100%;border-radius:6px;background:#15151c"></canvas>
          <span class="fx-name">${this.favs.has(x.id) ? '★ ' : ''}${escapeHtml(x.name)}</span></button>`).join('')}</div>
        ${list.length ? '' : '<div class="empty-note">Nada aqui ainda.</div>'}
      </div>`;
    const r = this.root;
    r.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat; this.dur = null; this.sel = null; this.render(); }));
    r.querySelectorAll('[data-id]').forEach((b) => {
      b.addEventListener('click', () => { this.sel = this.items.find((x) => x.id === b.dataset.id); this.dur = null; this.render(); });
      b.addEventListener('dblclick', () => this.apply());
    });
    const q = r.querySelector('[data-c="q"]');
    q.addEventListener('input', () => { this.q = q.value; this.render(); const n = this.root.querySelector('[data-c="q"]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    const ds = r.querySelector('[data-c="dur"]');
    ds.addEventListener('input', () => { this.dur = +ds.value; r.querySelector('[data-c="durv"]').textContent = `${this.dur.toFixed(2)} s`; this.startPreview(); });
    r.querySelector('[data-c="apply"]').addEventListener('click', () => this.apply());
    r.querySelector('[data-c="fav"]').addEventListener('click', () => { if (!it) return; if (this.favs.has(it.id)) this.favs.delete(it.id); else this.favs.add(it.id); storage.set(FAV_KEY, [...this.favs]); this.render(); });
    this.startPreview();
    this.drawThumbs();
  }

  apply() {
    if (!this.sel) return;
    try { toast(applyComposerItem(this.sel, this.dur ?? this.sel.dur, this.store), 'ok', 3500); this.hooks.onApplied?.(); } catch (e) { toast(`Não deu para aplicar: ${e.message}`, 'error'); }
  }

  startPreview() {
    if (!this.ready) { this.ready = true; this.render(); return; }
    cancelAnimationFrame(this.raf);
    const it = this.sel; const cv = this.root.querySelector('.cmp-preview canvas');
    if (!it || !cv) return;
    const dur = this.dur ?? it.dur;
    let P; try { P = previewProject(it, dur); } catch (e) { console.warn(e); return; }
    const ctx = cv.getContext('2d'); const t0 = performance.now();
    const loop = () => {
      if (!cv.isConnected) return;
      const t = ((performance.now() - t0) / 1000) % P.duration;
      if (cv.offsetParent !== null) { try { renderFrame(ctx, P, t, 1, {}); } catch { /* segue */ } } // painel escondido: não gasta
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Miniaturas estáticas (meio da animação), desenhadas aos poucos para não travar. */
  drawThumbs() {
    const canvases = [...this.root.querySelectorAll('[data-thumb]')];
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < canvases.length && performance.now() - t0 < 12) {
        const cv = canvases[i++]; if (!cv.isConnected) return;
        const it = this.items.find((x) => x.id === cv.dataset.thumb);
        const cached = this.thumbs.get(it.id);
        const g = cv.getContext('2d');
        if (cached) { g.drawImage(cached, 0, 0, 160, 90); continue; }
        try {
          const P = previewProject(it, it.dur);
          const tmp = document.createElement('canvas'); tmp.width = PW; tmp.height = PH;
          renderFrame(tmp.getContext('2d'), P, 0.3 + it.dur * (it.kind === 'out' ? 0.6 : it.kind === 'trans' ? 0.3 : 0.45), 1, {});
          this.thumbs.set(it.id, tmp); g.drawImage(tmp, 0, 0, 160, 90);
        } catch { /* sem miniatura */ }
      }
      if (i < canvases.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

const HINT = {
  in: 'Entrada: aplicada no começo da camada selecionada.',
  out: 'Saída: aplicada no fim da camada selecionada.',
  trans: 'Transição: selecione o clipe que sai; o clipe que começa logo depois dele recebe a entrada.',
  text: 'Texto: aplicada no texto selecionado (ou cria um texto novo no cursor).',
  element: 'Elemento: cria uma forma animada no cursor da timeline.',
  fx: 'Aplicado na camada selecionada, no cursor da timeline.',
};

/** Plugins "de painel" (extensões do AE que abrem uma janela, não um efeito): abrem este painel. */
export const PANEL_PLUGINS = /Animation Composer|AEJuice|Pack Manager|Motion ?Bro|Motion ?Factory|FX ?Console|Flow\b|Overlord|Ease ?Copy|Copy Ease|Shifter/i;
