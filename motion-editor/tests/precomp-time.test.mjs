import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, LAYER_FACTORIES } from '../js/state.js';
import { groupContentTime, timedLayers } from '../js/timing.js';
import { createEffectInstance } from '../js/presets.js';

function setup() {
  const P = createProject(1080, 1920); P.duration = 20;
  const v = LAYER_FACTORIES.video(P, 'x.mp4', 1080, 1920); v.inPoint = 2; v.outPoint = 6;
  const g = LAYER_FACTORIES.group(P, [v]); g.inPoint = 2; g.outPoint = 6;
  P.layers = [g];
  return { P, g, v };
}

test('sem mexer: o conteúdo usa o mesmo tempo de antes', () => {
  const { g } = setup();
  assert.equal(groupContentTime(g, 3), 3);
});

test('mover a pré-comp leva o clip junto (como no AE)', () => {
  const { g } = setup();
  groupContentTime(g, 2); // registra o início do conteúdo
  g.inPoint += 5; g.outPoint += 5; // arrastou a pré-comp 5 s para frente
  assert.equal(groupContentTime(g, 7), 2); // no novo início, aparece o começo do clip
  assert.equal(groupContentTime(g, 9.5), 4.5);
});

test('Velocidade (Twixtor) na pré-comp muda o tempo do conteúdo', () => {
  const { g } = setup();
  g.effects.push(createEffectInstance('twixtor', { speed: 50 }));
  assert.ok(Math.abs(groupContentTime(g, 4) - 3) < 1e-6); // 2 s a 50% = 1 s de conteúdo
});

test('Time Remap na pré-comp: o valor é o segundo do conteúdo', () => {
  const { g } = setup();
  groupContentTime(g, 2);
  g.effects.push(createEffectInstance('timeRemap', { time: { keys: [{ t: 2, v: 3, ease: 'linear' }, { t: 6, v: 0, ease: 'linear' }] } }));
  assert.ok(Math.abs(groupContentTime(g, 2) - 5) < 1e-6); // contentStart 2 + 3
  assert.ok(Math.abs(groupContentTime(g, 6) - 2) < 1e-6); // reverse até o começo
});

test('tempos locais e velocidade herdada para a prévia (vídeos dentro da pré-comp)', () => {
  const { P, g, v } = setup();
  g.effects.push(createEffectInstance('twixtor', { speed: 50 }));
  const row = timedLayers(P.layers, 4).find((x) => x.l === v);
  assert.ok(Math.abs(row.t - 3) < 1e-6); assert.ok(Math.abs(row.k - 0.5) < 1e-6);
  assert.ok(Number.isNaN(timedLayers(P.layers, 10).find((x) => x.l === v).t)); // pré-comp fora do ar
});
