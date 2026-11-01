import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFFX } from '../js/ffx.js';
import { ffxToPreset } from '../js/presets.js';
import { matchEffect } from '../js/import-map.js';
import { anim, valueAt } from '../js/anim.js';
import { selectAll, stretchKeys, reverseKeys, selectionRange } from '../js/keyframes.js';
import { sourceTime, integrateSpeed, layerTime, blendFrames } from '../js/timing.js';
import { createEffectInstance } from '../js/presets.js';
import { detectBeatsFromSamples } from '../js/audio.js';
import { EFFECTS } from '../js/effects.js';
import { pluginsFFX } from './fixtures.mjs';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('identifica plugins de terceiros e converte', () => {
  const preset = ffxToPreset(parseFFX(pluginsFFX().buffer, { fps: 30 }));
  const byMn = Object.fromEntries(preset.report.effects.map((e) => [e.matchName, e]));
  assert.equal(byMn['Twixtor Pro'].status, 'plugin');
  assert.equal(byMn['Twixtor Pro'].mappedTo, 'Velocidade (estilo Twixtor)');
  assert.equal(byMn.PEDG.plugin, 'Deep Glow');
  assert.equal(byMn.S_Shake.vendor, 'Sapphire');
  assert.equal(byMn['VIDEOCOPILOT Twitch'].plugin, 'Twitch');
  assert.equal(byMn['BCC Glow'].vendor, 'BCC');
  assert.equal(byMn.RSMB.plugin, 'ReelSmart Motion Blur');
  assert.equal(byMn['CC Radial Blur'].status, 'native');
  assert.equal(byMn['Element 3D'].status, 'unsupported');

  const fx = Object.fromEntries(preset.effects.map((e) => [e.matchName, e]));
  assert.equal(fx['Twixtor Pro'].type, 'twixtor');
  assert.deepEqual(fx['Twixtor Pro'].params.speed.keys.map((k) => k.v), [100, 20, 100]);
  assert.equal(fx['Twixtor Pro'].params.frameBlend, true);
  assert.equal(fx.PEDG.params.radius, 300);
  assert.equal(fx.PEDG.params.threshold, 40);
  assert.equal(fx.S_Shake.params.amount, 10.5); // amplitude 0.3 × 35 (escala calibrada com presets reais)
  assert.equal(fx.S_Shake.params.frequency, 12);
  assert.equal(fx['VIDEOCOPILOT Twitch'].params.slide, true);
  assert.equal(fx.RSMB.params.amount, 100);
  assert.equal(fx['CC Radial Blur'].params.amount, 40);
  assert.equal(fx['Element 3D'].type, 'generic');
  assert.ok(preset.report.plugins.includes('Twixtor'));
});

test('regras de palavra-chave e nomes de exibição', () => {
  assert.equal(matchEffect('XYZ Super Glow FX').def.type, 'glow');
  assert.equal(matchEffect('XYZ Super Glow FX').kind, 'approx');
  assert.equal(matchEffect('uni.Glow').rule.plugin, 'Universe Glow');
  assert.equal(matchEffect('S_BlurMoCurves').def.type, 'blurMoCurves'); // zoom blur (Z Dist), confirmado em preset real
  assert.equal(matchEffect('ADBE Wave Warp').kind, 'native');
  assert.equal(matchEffect('Plugin estranho 123'), null);
});

test('todo efeito tem parâmetros com default válido', () => {
  for (const e of EFFECTS) {
    const inst = createEffectInstance(e.type);
    for (const pd of e.params) assert.notEqual(inst.params[pd.key].value, undefined, `${e.type}.${pd.key}`);
    assert.ok(e.render || e.transform || e.temporal || e.sourceSpeed || e.sourceRemap || e.timeWarp, e.type);
  }
});

function makeLayer() {
  return {
    id: 'L1', inPoint: 0, outPoint: 10, type: 'video', props: { sourceStart: 0, speed: 1 },
    transform: {
      position: anim([0, 0], [{ t: 1, v: [0, 0], ease: 'linear' }, { t: 2, v: [100, 0], ease: 'linear' }]),
      scale: anim([100, 100]), rotation: anim(0), anchor: anim([0, 0]),
      opacity: anim(100, [{ t: 1, v: 0, ease: 'linear' }, { t: 3, v: 100, ease: 'linear' }]),
    },
    effects: [],
  };
}

test('selecionar todos e esticar keyframes', () => {
  const layer = makeLayer();
  const project = { fps: 30, layers: [layer] };
  const sel = selectAll([layer]);
  assert.equal(sel.length, 4);
  assert.deepEqual(selectionRange(sel), [1, 3]);
  const base = sel.map((s) => s.key.t);
  stretchKeys(project, sel, 2, 'first', base);
  assert.deepEqual(selectionRange(sel), [1, 5]);
  near(valueAt(layer.transform.position, 2)[0], 50);
  stretchKeys(project, sel, 0.5, 'first', base); // não destrutivo: relativo ao original
  assert.deepEqual(selectionRange(sel), [1, 2]);
  reverseKeys(project, sel);
  near(valueAt(layer.transform.opacity, 1), 100);
  near(valueAt(layer.transform.opacity, 2), 0);
});

test('velocidade estilo Twixtor integra a curva', () => {
  const layer = makeLayer();
  near(sourceTime(layer, 4), 4);
  layer.effects.push(createEffectInstance('twixtor', { speed: 50 }));
  near(sourceTime(layer, 4), 2);
  layer.effects[0].params.speed = anim(100, [{ t: 0, v: 100, ease: 'linear' }, { t: 2, v: 0, ease: 'linear' }]);
  near(integrateSpeed(layer.effects[0].params.speed, 0, 2), 1, 1e-2);
  near(sourceTime(layer, 5), 1, 1e-2);
  layer.props.sourceStart = 3;
  near(sourceTime(layer, 5), 4, 1e-2);
  layer.effects[0].params.speed = anim(50);
  const b = blendFrames(layer, 1 / 30, 30);
  assert.ok(b.b !== null && Math.abs(b.f - 0.5) < 0.01);
});

test('posterize time quantiza o tempo da camada', () => {
  const layer = makeLayer();
  layer.effects.push(createEffectInstance('posterizeTime', { fps: 4 }));
  near(layerTime(layer, 0.6), 0.5);
  near(layerTime(layer, 0.99), 0.75);
});

test('detecção de batidas encontra pulsos', () => {
  const sr = 44100;
  const ch = new Float32Array(sr * 4);
  for (let b = 0; b < 8; b++) {
    const s = Math.floor((0.25 + b * 0.5) * sr);
    for (let i = 0; i < 2000; i++) ch[s + i] = Math.sin(i * 0.3) * (1 - i / 2000);
  }
  const beats = detectBeatsFromSamples(ch, sr, 0.5);
  assert.ok(beats.length >= 7 && beats.length <= 9, `beats=${beats.length}`);
  near(beats[1] - beats[0], 0.5, 0.05);
});

test('Looks: Spot Exposure, Gradient Exposure e Edge Softness convertidos', async () => {
  const { looksFromTools } = await import('../js/import-map.js');
  const { params, used } = looksFromTools([
    { id: 'spex', enabled: true, values: [0.4, 2.083, -0.741, 1, 0.5, 0.5, 100, 0.545, 0.463, 0.421, 1, 0] },
    { id: 'grex', enabled: true, values: [0, -1.04, 96.6, 0.46, -40.8, 0.5, 100, 0.001, 0.001, 0.001] },
    { id: 'edgs', enabled: true, values: [5.003, 10, 1.962, -1.61, 1.351, 0.634, 1.179] },
  ]);
  assert.equal(params.spotExposure, 0.4);
  assert.deepEqual(params.spotColor, [0.545, 0.463, 0.421, 1]);
  assert.equal(params.gradExposure, 0); // exposição 0 → ignorado
  assert.equal(params.edgeBlur, 5.003);
  assert.ok(Math.abs(params.edgeSize - 135.1) < 0.01);
  assert.ok(used.includes('edgs') && used.includes('spex'));
});

test('presets nativos usam só efeitos/parâmetros existentes (inclui Shatter e Time Slice)', async () => {
  const { BUILTIN_PRESETS } = await import('../js/presets.js');
  const { EFFECT_MAP } = await import('../js/effects.js');
  assert.ok(EFFECT_MAP.shatter && EFFECT_MAP.timeSlice);
  for (const p of BUILTIN_PRESETS) for (const fx of p.effects || []) {
    const def = EFFECT_MAP[fx.type];
    assert.ok(def, `${p.name}: efeito ${fx.type}`);
    for (const k of Object.keys(fx.params || {})) assert.ok(def.params.some((x) => x.key === k), `${p.name}: ${fx.type}.${k}`);
  }
  assert.equal(matchEffect('ADBE Shatter').def.type, 'shatter');
  assert.equal(matchEffect('S_TimeSlice').def.type, 'timeSlice');
});

test('Shatter do AE (APC Shatter) é convertido com raio animado e duas forças', async () => {
  const { readFileSync } = await import('node:fs');
  const b = readFileSync(new URL('../presets/free/Shatter/W Shatter.ffx', import.meta.url));
  const pr = ffxToPreset(parseFFX(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), { fps: 30 }));
  assert.deepEqual(pr.effects.map((e) => e.type), ['fill', 'shatter', 'deepGlow']);
  const sh = pr.effects[1].params;
  assert.equal(sh.radius.keys.length, 2);
  assert.equal(sh.strength, 15);
  assert.equal(sh.force2On, true);
  assert.equal(pr.effects[2].params.useTint, false); // Deep Glow: tint desligado no .ffx
});

test('Time Remap: o valor é o tempo do arquivo (congelar, acelerar e voltar)', async () => {
  const { sourceTime } = await import('../js/timing.js');
  const layer = { id: 'v', type: 'video', inPoint: 0, outPoint: 4, props: { sourceStart: 0, speed: 1 }, effects: [createEffectInstance('timeRemap', { time: { keys: [{ t: 0, v: 1, ease: 'linear' }, { t: 1, v: 1, ease: 'linear' }, { t: 3, v: 0, ease: 'linear' }] } })] };
  assert.equal(sourceTime(layer, 0.5), 1);          // congelado
  assert.ok(Math.abs(sourceTime(layer, 2) - 0.5) < 1e-6); // voltando (reverse)
});

test('gráfico personalizado (curva) nos keyframes, com overshoot', async () => {
  const { anim, valueAt, curveOf } = await import('../js/anim.js');
  const p = anim(0, [{ t: 0, v: 0, ease: 'curve', curve: [0.34, 1.56, 0.64, 1] }, { t: 1, v: 100, ease: 'linear' }]);
  assert.ok(valueAt(p, 0.6) > 100);          // passa do alvo (back) e volta
  assert.equal(valueAt(p, 1), 100);
  assert.deepEqual(curveOf({ ease: 'easeInOut' }), [0.33, 0, 0.67, 1]);
});
