import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MO_TEXT, MO_INOUT, MO_ELEMENTS, MO_LOGO, buildLogoDemoProject } from '../js/mograph.js';
import { valueAt } from '../js/anim.js';

test('pacote de motion design: listas completas e projeto de logo válido', () => {
  assert.ok(MO_TEXT.length >= 10 && MO_INOUT(1080, 1920).length >= 8 && MO_ELEMENTS.length >= 8 && MO_LOGO(1080).length >= 4);
  const P = buildLogoDemoProject();
  assert.equal(P.width, 1080); assert.equal(P.duration, 6);
  assert.ok(P.layers.length >= 10);
  const names = P.layers.map((l) => l.name);
  for (const n of ['Anel', 'Play', 'Burst', 'Nome', 'Slogan']) assert.ok(names.includes(n), n);
  // anel: Trim Paths desenha de 0 a 100% entre 0,15 s e 1,2 s
  const ring = P.layers.find((l) => l.name === 'Anel');
  const trim = ring.props.shapes[0].items.find((x) => x.t === 'trim');
  assert.equal(valueAt(trim.end, 0.1), 0); assert.equal(valueAt(trim.end, 1.3), 100);
  // explosão: as linhas são caminhos retos com 2 vértices (ponto + 2 alças cada)
  const burst = P.layers.find((l) => l.name === 'Burst');
  assert.equal(burst.props.shapes[0].items[0].path.shapes[0].pts.length, 6);
});

test('curvas novas de motion design', async () => {
  const p = { value: 0, keys: [{ t: 0, v: 0, ease: 'elastic' }, { t: 1, v: 100, ease: 'linear' }] };
  const mid = [0.2, 0.3, 0.4].map((t) => valueAt(p, t));
  assert.ok(mid.some((v) => v > 100), 'elástico passa do alvo (overshoot)');
  const e = { value: 0, keys: [{ t: 0, v: 0, ease: 'expoOut' }, { t: 1, v: 100, ease: 'linear' }] };
  assert.ok(valueAt(e, 0.25) > 75, 'expo: chega rápido e pousa devagar');
});
