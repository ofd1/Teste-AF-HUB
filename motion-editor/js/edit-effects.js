// Efeitos das edits que NÃO são transição (vão para Presets ★ → "Efeitos das edits"): partículas, brilhos, flickers…
// Keys no formato do preset: { keys: [{ t, v, ease }] } com t a partir do playhead.
const K = (...l) => ({ keys: l.map(([t, v, ease]) => ({ t, v, ...(ease ? { ease } : {}) })) });
const CAT = 'Efeitos das edits';

export const EDIT_EFFECT_PRESETS = [
  { name: 'Partículas brancas (Edit 2)', category: CAT, effects: [{ type: 'bgSnow', params: { mode: 1, amount: 18, size: 0.8, speed: 1.6, opacity: 90 } }] },
  { name: 'Luzes verdes desfocadas (Edit 1)', category: CAT, effects: [{ type: 'bgFireflies', params: { mode: 1, amount: 9, size: 2.6, speed: 0.6, c1: [0.35, 1, 0.2, 1], opacity: 85 } }, { type: 'sGlow', params: { brightness: 1.5, color: [0.4, 1, 0.3, 1], threshold: 0.55, width: 1 } }] },
  { name: 'Brilho neon roxo nos destaques (Edit 9)', category: CAT, effects: [{ type: 'sGlow', params: { brightness: 3, color: [0.75, 0.35, 1, 1], threshold: 0.62, width: 1.4 } }] },
  { name: 'Flicker preto e branco (Edit 8)', category: CAT, anchorStart: true, duration: 0.5, effects: [{ type: 'blackWhite', params: { amount: K([0, 100, 'hold'], [0.1, 0, 'hold'], [0.2, 100, 'hold'], [0.3, 0, 'hold'], [0.4, 100, 'hold'], [0.5, 0]) } }] },
  { name: 'Flicker espelhado P&B (Edit 8)', category: CAT, anchorStart: true, duration: 0.5, transform: { scale: { mode: 'abs', keys: [{ t: 0, v: [-100, 100], ease: 'hold' }, { t: 0.1, v: [100, 100], ease: 'hold' }, { t: 0.2, v: [-100, 100], ease: 'hold' }, { t: 0.3, v: [100, 100], ease: 'hold' }, { t: 0.5, v: [100, 100] }] } }, effects: [{ type: 'blackWhite', params: { amount: K([0, 100, 'hold'], [0.1, 0, 'hold'], [0.2, 100, 'hold'], [0.3, 0, 'hold'], [0.5, 0]) } }] },
  { name: 'Preto e branco súbito (Edit 7)', category: CAT, effects: [{ type: 'blackWhite', params: { amount: 100 } }, { type: 'brightnessContrast', params: { contrast: 15 } }] },
  { name: 'Datamosh contínuo (Edit 9)', category: CAT, effects: [{ type: 'datamosh', params: { amount: 55, block: 18, smear: 260, evolution: 3 } }] },
  { name: 'Barras de luz amarelas (Edit 10)', category: CAT, anchorStart: true, duration: 0.6, effects: [{ type: 'lightBars', params: { shape: 1, color: [1, 0.92, 0.3, 1], intensity: K([0, 4, 'expoOut'], [0.6, 0]), count: 6, softness: 55 } }] },
  { name: 'Luz ciano de baixo (Edit 10)', category: CAT, anchorStart: true, duration: 0.5, effects: [{ type: 'lightBars', params: { shape: 2, color: [0.2, 0.9, 1, 1], intensity: K([0, 4, 'expoOut'], [0.5, 0]), softness: 80 } }] },
  { name: 'Low poly P&B (Edit 8)', category: CAT, anchorStart: true, duration: 0.1, effects: [{ type: 'lowPoly', params: { cell: 140, gray: true, facet: 90, amount: K([0, 100, 'hold'], [0.1, 0]) } }] },
  { name: 'Estouro branco (Edit 4)', category: CAT, anchorStart: true, duration: 0.4, effects: [{ type: 'exposure', params: { exposure: K([0, 3.5, 'expoOut'], [0.4, 0]) } }] },
  { name: 'Duotone verde (Edit 10)', category: CAT, effects: [{ type: 'tint', params: { black: [0.05, 0.3, 0.05, 1], white: [0.6, 1, 0.3, 1], amount: 100 } }] },
  { name: 'Duotone rosa (Edit 10)', category: CAT, effects: [{ type: 'tint', params: { black: [0.35, 0.05, 0.3, 1], white: [1, 0.6, 0.95, 1], amount: 100 } }] },
  { name: 'Duotone roxo/ciano (Edit 3)', category: CAT, effects: [{ type: 'tint', params: { black: [0.45, 0.08, 0.7, 1], white: [0.4, 1, 0.85, 1], amount: 100 } }] },
  { name: 'Ciano posterizado (Edit 10)', category: CAT, effects: [{ type: 'tint', params: { black: [0, 0.2, 0.25, 1], white: [0.55, 1, 0.95, 1], amount: 100 } }, { type: 'posterize', params: { levels: 5 } }] },
  { name: 'Glitch de blocos (Edit 8)', category: CAT, effects: [{ type: 'glitch', params: { amount: 60, block: 70, shift: 20, rgb: 4, speed: 20 } }] },
];
