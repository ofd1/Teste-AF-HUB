import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEffect } from '../js/import-map.js';
import { EFFECTS } from '../js/effects.js';

test('BCC: cada efeito usado nos presets tem a versão com os controles reais', () => {
  const cases = { 'BCC3Directional Blur': 'bccDirBlur', BCC6LensBlur: 'bccLensBlur', 'BCC3Unsharp Mask': 'bccUnsharp', 'BCC Magic Sharp': 'bccMagicSharp', 'BCC Glow': 'bccGlow', BCC_BLUR: 'bccBlur', 'BCC3Temporal Blur': 'bccTemporalBlur' };
  for (const [mn, type] of Object.entries(cases)) {
    assert.equal(matchEffect(mn)?.def?.type, type, mn);
    assert.ok(EFFECTS.find((e) => e.type === type).params.some((p) => p.label === 'Mix with Original'), `${type}: Mix with Original`);
  }
});
