// Marcas d'água das edits (aba Transições → "Marcas d'água"): outro com @ do perfil e a marca 3D "FULL"
// preenchida com os clipes. São camadas normais (dá para editar tudo depois) marcadas com wmId: aplicar de
// novo a mesma marca substitui a anterior — é assim que o painel "edita" a marca já colocada.
// Obs.: são outros genéricos (sem logo/marca registrada de rede social).
import { LAYER_FACTORIES } from './state.js';
import { createEffectInstance } from './presets.js';
import { TEXT_UNITS } from './mograph.js';
import { shiftAnim } from './composer.js';

const K = (pairs, t0) => ({ value: pairs[0][1], keys: pairs.map(([t, v, ease]) => ({ t: +(t0 + t).toFixed(4), v, ...(ease ? { ease } : {}) })) });
const fxk = (pairs, t0) => ({ keys: pairs.map(([t, v, ease]) => ({ t, v, ...(ease ? { ease } : {}) })) });
function fx(type, params, t0) {
  const ps = {};
  for (const [k, v] of Object.entries(params)) ps[k] = Array.isArray(v) && Array.isArray(v[0]) ? fxk(v) : v;
  return createEffectInstance(type, ps, t0);
}
const place = (l, x, y) => { l.transform.position.value = [x, y]; return l; };
const typeAnims = (d, fs, t0) => {
  const tw = TEXT_UNITS.find((u) => u[0] === 'Máquina de escrever');
  return tw ? tw[2](d, fs).map((a) => shiftAnim(a, t0)) : [];
};

export const MATERIAL_NAMES = ['Plástico', 'Cromo', 'Ouro', 'Metal escovado', 'Vidro fumê', 'Fosco', 'Neon'];

export const WATERMARKS = [
  {
    id: 'wm-search', name: 'Outro · barra de pesquisa', dur: 2.4, src: 'final das edits',
    fields: [['text', '@ do perfil', '@seuperfil']],
    build(P, o, t0, d) {
      const W = P.width, H = P.height, cx = W / 2, cy = H / 2;
      const bg = place(LAYER_FACTORIES.solid(P), cx, cy); bg.name = 'Outro · fundo'; bg.props.fill = '#000000';
      bg.transform.opacity = K([[0, 0, 'easeOut'], [0.2, 100]], t0);
      const bw = W * 0.8, bh = W * 0.13;
      const bar = place(LAYER_FACTORIES.rect(P), cx, cy); bar.name = 'Outro · barra'; Object.assign(bar.props, { width: bw, height: bh, radius: bh / 2, fill: '#ffffff', strokeWidth: 0 });
      bar.transform.scale = K([[0.1, [55, 55], 'expoOut'], [0.5, [100, 100]], [d - 0.35, [100, 100], 'easeIn'], [d, [115, 115]]], t0);
      bar.transform.opacity = K([[0.1, 0, 'easeOut'], [0.3, 100]], t0);
      const r = bh * 0.22, mx = cx - bw / 2 + bh * 0.55;
      const lens = place(LAYER_FACTORIES.ellipse(P), mx, cy - r * 0.15); lens.name = 'Outro · lupa'; Object.assign(lens.props, { width: r * 2, height: r * 2, fill: '#ffffff', strokeColor: '#111111', strokeWidth: Math.max(3, r * 0.32) });
      const hdl = place(LAYER_FACTORIES.rect(P), mx + r * 0.95, cy + r * 0.85); hdl.name = 'Outro · cabo'; Object.assign(hdl.props, { width: r * 0.75, height: Math.max(3, r * 0.32), radius: 3, fill: '#111111', strokeWidth: 0 });
      hdl.transform.rotation.value = 45;
      for (const l of [lens, hdl]) l.transform.opacity = K([[0.3, 0], [0.45, 100]], t0);
      const tx = place(LAYER_FACTORIES.text(P), cx + bh * 0.25, cy); tx.name = 'Outro · @'; Object.assign(tx.props, { text: o.text || '@seuperfil', color: '#111111', fontSize: Math.round(bh * 0.42), fontWeight: 700, align: 'center' });
      tx.props.animators = typeAnims(0.75, tx.props.fontSize, t0 + 0.45);
      const cur = place(LAYER_FACTORIES.rect(P), cx + bw / 2 - bh * 0.5, cy); cur.name = 'Outro · cursor'; Object.assign(cur.props, { width: Math.max(2, bh * 0.04), height: bh * 0.5, radius: 1, fill: '#3d7bff', strokeWidth: 0 });
      cur.transform.opacity = K([0.45, 0.75, 1.05, 1.35, 1.65, 1.95].map((t, i) => [t, i % 2 ? 0 : 100, 'hold']), t0);
      const adj = LAYER_FACTORIES.adjustment(P); adj.name = 'Outro · glitch';
      adj.effects.push(fx('glitch', { amount: [[d - 0.6, 0, 'easeIn'], [d - 0.3, 70], [d, 0]], rgb: 14, speed: 24 }, t0));
      adj.effects.push(fx('rgbSplit', { amount: [[0.1, 30, 'expoOut'], [0.45, 0], [d - 0.5, 0, 'easeIn'], [d, 40]] }, t0));
      return [adj, cur, tx, hdl, lens, bar, bg];
    },
  },
  {
    id: 'wm-handle', name: 'Outro · @ com glitch', dur: 2, src: 'final das edits',
    fields: [['text', '@ do perfil', '@seuperfil']],
    build(P, o, t0, d) {
      const W = P.width, H = P.height, cx = W / 2, cy = H / 2;
      const bg = place(LAYER_FACTORIES.solid(P), cx, cy); bg.name = 'Outro · fundo'; bg.props.fill = '#000000';
      bg.transform.opacity = K([[0, 0], [0.12, 100]], t0);
      const tx = place(LAYER_FACTORIES.text(P), cx, cy); tx.name = 'Outro · @'; Object.assign(tx.props, { text: o.text || '@seuperfil', color: '#ffffff', fontSize: Math.round(W / 9), fontWeight: 900, align: 'center' });
      tx.transform.scale = K([[0.05, [160, 160], 'expoOut'], [0.45, [100, 100]], [d, [108, 108]]], t0);
      tx.transform.opacity = K([[0.05, 0], [0.15, 100], [d - 0.15, 100], [d, 0]], t0);
      tx.effects.push(fx('glow', { threshold: 40, radius: 30, intensity: 1.2 }, t0));
      const adj = LAYER_FACTORIES.adjustment(P); adj.name = 'Outro · glitch';
      adj.effects.push(fx('twitch', { amount: [[0.05, 140, 'expoOut'], [0.5, 20], [d - 0.4, 20, 'easeIn'], [d, 160]], speed: 70 }, t0));
      adj.effects.push(fx('rgbSplit', { amount: [[0.05, 40, 'expoOut'], [0.5, 4], [d - 0.4, 4, 'easeIn'], [d, 50]] }, t0));
      return [adj, tx, bg];
    },
  },
  {
    id: 'wm-texto-brilho', name: 'Outro · texto com brilho (Edit 7)', dur: 3.2, src: 'final da Edit 7',
    fields: [['text', 'Texto', 'YOU <3']],
    build(P, o, t0, d) {
      const W = P.width, cx = W / 2, cy = P.height / 2;
      const bg = place(LAYER_FACTORIES.solid(P), cx, cy); bg.name = 'Outro · fundo'; bg.props.fill = '#000000';
      bg.transform.opacity = K([[0, 0, 'easeOut'], [0.25, 100]], t0);
      const tx = place(LAYER_FACTORIES.text(P), cx, cy); tx.name = 'Outro · texto'; Object.assign(tx.props, { text: o.text || 'YOU <3', color: '#ffffff', fontSize: Math.round(W / 11), fontWeight: 800, align: 'center', fontFamily: '"Arial Black", Impact, sans-serif' });
      tx.transform.rotation.value = -6;
      tx.transform.opacity = K([[0.15, 0, 'easeOut'], [0.5, 100], [d - 1.4, 100, 'easeIn'], [d, 0]], t0);
      tx.transform.scale = K([[0.15, [92, 92], 'expoOut'], [0.7, [100, 100]], [d, [104, 104]]], t0);
      tx.effects.push(fx('glow', { threshold: 20, radius: 40, intensity: 1.6 }, t0));
      tx.effects.push(fx('blur', { radius: [[0.15, 16, 'expoOut'], [0.6, 0], [d - 1.2, 0, 'easeIn'], [d, 14]] }, t0));
      return [tx, bg];
    },
  },
  {
    id: 'wm-assinatura', name: 'Marca d’água pequena (assinatura no meio)', dur: 0, full: true, src: 'todas as edits',
    fields: [['text', '@ / assinatura', '@seuperfil'], ['size', 'Tamanho %', 100, [40, 250]], ['opacity', 'Opacidade %', 70, [10, 100]]],
    build(P, o, t0, d) {
      const W = P.width;
      const tx = place(LAYER_FACTORIES.text(P), W / 2, P.height * 0.6); tx.name = `Assinatura · ${o.text || ''}`;
      Object.assign(tx.props, { text: o.text || '@seuperfil', color: '#ffffff', fontSize: Math.round((W / 26) * ((+o.size || 100) / 100)), fontWeight: 800, align: 'center', fontFamily: '"Arial Black", Impact, sans-serif' });
      tx.transform.rotation.value = -4;
      tx.transform.opacity.value = +o.opacity || 70;
      tx.effects.push(fx('dropShadow', { opacity: 60, distance: 2, softness: 4 }, t0));
      return [tx];
    },
  },
  {
    id: 'wm-full3d', name: 'Marca d’água 3D “FULL” (textura dos clipes)', dur: 0, full: true, src: 'edits (marca no meio)',
    fields: [['text', 'Texto', 'FULL'], ['fill', 'Preenchimento', 1, ['Clipes (textura)', 'Branco liso (edit 2)']], ['material', 'Material', 1, MATERIAL_NAMES], ['size', 'Tamanho %', 85, [30, 140]], ['opacity', 'Opacidade %', 100, [10, 100]]],
    build(P, o, t0, d) {
      const adj = LAYER_FACTORIES.adjustment(P); adj.name = `Marca 3D · ${o.text || 'FULL'}`;
      adj.transform.opacity.value = +o.opacity || 100;
      adj.effects.push(fx('element3d', {
        object: 1, text: o.text || 'FULL', font: 1, extrude: 0.38, bevel: 0.03, objSize: (P.width * (+o.size || 85)) / 100,
        material: +o.fill === 2 ? 6 : +o.material || 1, texMode: +o.fill === 2 ? 1 : 3, color: [1, 1, 1, 1], gloss: 75, reflect: 45, envMode: 2, ambient: 45, lightInt: 1.3, rim: 60,
        rotX: [[0, -10, 'easeInOut'], [d / 2, 6, 'easeInOut'], [d, -10]], rotY: [[0, -32, 'easeInOut'], [d, 32]], composite: 1,
      }, t0));
      return [adj];
    },
  },
];
