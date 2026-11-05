import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEffect, IMPORT_RULES } from '../js/import-map.js';
import { EFFECT_MAP } from '../js/effects.js';
import { UTILITY_PLUGINS } from '../js/import-map-pk.js';

test('plugins do inventário reconhecidos com o modo certo', () => {
  const cases = [['S_WipeStar', 'pkWipe', 5], ['S_TexturePlasma', 'pkTexture', 1], ['S_BleachBypass', 'pkColor', 12], ['S_Crosshatch', 'pkStylize', 6], ['S_HyperPush', 'pkDistort', 1],
    ['S_LaserBeam', 'pkLight', 2], ['BCC3Rain', 'pkLight', 3], ['Universe_Transitions_Clock_Wipe', 'pkWipe', 2], ['BCC_KELVIN', 'pkColor', 16]];
  for (const [mn, to, mode] of cases) { const m = matchEffect(mn); assert.ok(m, mn); assert.equal(m.def.type, to, mn); assert.equal(m.rule.set.mode, mode, mn); }
});

test('toda regra aponta para efeito que existe, e o modo existe', () => {
  for (const r of IMPORT_RULES) if (r.vendor === 'Plugins do usuário') {
    const d = EFFECT_MAP[r.to]; assert.ok(d, r.to);
    if (r.set.mode) assert.ok(r.set.mode <= d.params.find((p) => p.key === 'mode').options.length, `${r.to} ${r.set.mode}`);
  }
  assert.ok(UTILITY_PLUGINS.test('AEJuice Pack Manager 4'));
});
