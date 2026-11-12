import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defFromRecipe } from '../js/custom-fx.js';
import { EFFECT_MAP } from '../js/effects.js';

test('Criar efeito: controles expostos, valores fixos e transform combinado', () => {
  const r = { type: 'cfx_t', name: 'Teste', steps: [
    { type: 'glow', values: { radius: 33 }, expose: ['threshold'] },
    { type: 'transform', values: { scale: 120 }, expose: ['offset'] },
  ] };
  const d = defFromRecipe(r);
  assert.equal(d.category, 'Meus efeitos');
  assert.deepEqual(d.params.map((p) => p.key), ['s0_threshold', 's1_offset', 'fxOpacity']);
  assert.equal(d.params[0].default, EFFECT_MAP.glow.params.find((p) => p.key === 'threshold').default);
  assert.equal(typeof d.render, 'function');
  assert.equal(typeof d.transform, 'function');
  const r2 = d.transform({ s0_threshold: 60, s1_offset: [30, -10] }, { t: 0 });
  assert.equal(r2.dx, 30); assert.equal(r2.dy, -10); // controle exposto (animável)
  assert.equal(r2.scale, 1.2); // valor fixo da receita
});
