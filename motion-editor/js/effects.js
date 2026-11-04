// Registro de efeitos do app (renderização via WebGL — ver js/gl.js e js/fx/*).
// O mapeamento de efeitos/plugins do After Effects fica em js/import-map.js.
import blurLight from './fx/blur-light.js';
import color from './fx/color.js';
import distort from './fx/distort.js';
import stylize from './fx/stylize.js';
import motion from './fx/motion.js';
import extra from './fx/extra.js';
import shatter from './fx/shatter.js';
import ai from './fx/ai.js';
import more from './fx/more.js';
import topaz from './fx/topaz.js';
import plugins2 from './fx/plugins2.js';
import plugins3 from './fx/plugins3.js';
import element3d from './fx/element3d.js';
import plugins4 from './fx/plugins4.js';
import lut from './fx/lut.js';
import plugins5 from './fx/plugins5.js';
import looksTools from './fx/looks-tools.js';

export const EFFECTS = [...blurLight, ...color, ...extra, ...distort, ...stylize, ...motion, ...shatter, ...ai, ...more, ...topaz, ...plugins2, ...plugins3, ...plugins4, ...element3d, ...lut, ...plugins5, ...looksTools];
// Como no AE (Compositing Options): todo efeito que altera a imagem tem "Opacidade do efeito", animável.
for (const e of EFFECTS) {
  if (e.render && !e.params.some((p) => p.key === 'fxOpacity')) {
    e.params.push({ key: 'fxOpacity', label: 'Opacidade do efeito %', kind: 'number', default: 100, min: 0, max: 100, step: 1, advanced: true });
  }
}
export const EFFECT_MAP = Object.fromEntries(EFFECTS.map((e) => [e.type, e]));
export const CATEGORIES = ['Luz e brilho', 'Movimento', 'Tempo', 'Desfoque', 'Estilizar', 'Distorção', 'Cor', '3D', 'Transições'];

/** Efeito para parâmetros importados que não têm renderização equivalente. */
export const GENERIC_EFFECT = { type: 'generic', label: 'Controles importados', category: 'Importado', params: [] };

export function getEffectDef(type) {
  return EFFECT_MAP[type] || GENERIC_EFFECT;
}

let canvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
export function setCanvasFactory(fn) { canvasFactory = fn; }
export function makeCanvas(w, h) {
  return canvasFactory(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}
