// Registro de efeitos do app (renderização via WebGL — ver js/gl.js e js/fx/*).
// O mapeamento de efeitos/plugins do After Effects fica em js/import-map.js.
import blurLight from './fx/blur-light.js';
import color from './fx/color.js';
import distort from './fx/distort.js';
import stylize from './fx/stylize.js';
import motion from './fx/motion.js';

export const EFFECTS = [...blurLight, ...color, ...distort, ...stylize, ...motion];
export const EFFECT_MAP = Object.fromEntries(EFFECTS.map((e) => [e.type, e]));
export const CATEGORIES = ['Luz e brilho', 'Movimento', 'Tempo', 'Desfoque', 'Estilizar', 'Distorção', 'Cor', 'Transições'];

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
