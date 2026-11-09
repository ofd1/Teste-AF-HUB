import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segSpeeds, setSide, segOf } from '../js/graph-ae.js';
import { rawValueAt } from '../js/anim.js';

test('Graph Editor: velocidade e influência como no AE (Keyframe Velocity)', () => {
  const a = { t: 0, v: 0, ease: 'linear' }, b = { t: 1, v: 100, ease: 'linear' };
  const p = { value: 0, keys: [a, b] };
  assert.ok(Math.abs(segSpeeds(a, b).out - 100) < 1e-6); // linear: 100 unidades/s
  setSide(a, b, 'out', 0, 1 / 3); setSide(a, b, 'in', 0, 1 / 3); // Easy Ease
  const s = segSpeeds(a, b);
  assert.ok(Math.abs(s.out) < 1e-9 && Math.abs(s.in) < 1e-9);
  assert.ok(Math.abs(rawValueAt(p, 0.5) - 50) < 1e-6);
  assert.ok(rawValueAt(p, 0.1) < 10); // começa devagar
  setSide(a, b, 'out', 0, 0.9); // influência 90% = "velocity" forte
  assert.ok(Math.abs(segOf(a, b).o - 0.9) < 1e-6);
  assert.ok(rawValueAt(p, 0.5) < 50);
  setSide(a, b, 'out', 300, 0.2); // saída rápida
  assert.ok(Math.abs(segSpeeds(a, b).out - 300) < 1e-6);
});
