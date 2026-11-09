import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEffect } from '../js/import-map.js';
import { EFFECTS } from '../js/effects.js';

test('efeitos dos presets do usuário têm equivalente com os controles do plugin', () => {
  const cases = { PSSBLPNT: 'ballpoint', 'CC Radial ScaleWipe': 'ccRadialScaleWipe', 'CC Scale Wipe': 'ccScaleWipe', BCC_THREESTRIP: 'bccThreeStrip', 'BCC Ripple Dissolve': 'bccRippleDissolve', PEDG2: 'deepGlow' };
  for (const [mn, type] of Object.entries(cases)) assert.equal(matchEffect(mn)?.def?.type, type, mn);
  const bp = EFFECTS.find((e) => e.type === 'ballpoint');
  for (const k of ['Stroke Count', 'Stroke Width', 'Edge Tracking', 'Paint On', 'Blending Mode']) assert.ok(bp.params.some((p) => p.label === k), k);
});
