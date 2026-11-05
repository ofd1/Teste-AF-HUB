import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topazValues, migrateTopazFx, TZ_MODELS } from '../js/fx/topaz.js';
import { matchEffect } from '../js/import-map.js';
import { ffxToPreset } from '../js/presets.js';
import { estimateFromImage } from '../js/topaz-estimate.js';

test('ordem dos modelos igual ao popup do plugin do AE', () => {
  assert.deepEqual(TZ_MODELS.slice(0, 7).map((m) => m.name.split(' (')[0]), ['Proteus', 'Iris', 'Nyx', 'Artemis', 'Themis', 'Dione Robust', 'Dione Robust Dehalo']);
});

test('Auto / Relative to auto / Manual', () => {
  const base = { model: 1, inputQuality: 2, compression: 80, details: 10, sharpen: 5, noise: 0, dehalo: 0, aa: -30, ra_compression: 20, ra_sharpen: -100 };
  const a = topazValues({ ...base, paramMode: 1 }), r = topazValues({ ...base, paramMode: 2 }), m = topazValues({ ...base, paramMode: 3 });
  assert.equal(r.c, Math.min(100, a.c + 20)); assert.equal(r.s, 0);
  assert.equal(m.c, 80); assert.equal(m.a, -30);
  // no MotionFrame todos os modelos aceitam Manual (inclusive Artemis, que no plugin é só Auto)
  const art = topazValues({ ...base, model: 4, paramMode: 3, inputQuality: 1 });
  assert.equal(art.c, 80);
  assert.ok(topazValues({ ...base, model: 4, inputQuality: 1 }).n > topazValues({ ...base, model: 4, inputQuality: 3 }).n);
});

test('efeito antigo migra para o layout do plugin', () => {
  const fx = { type: 'topaz', params: { model: { value: 2, keys: [] }, revertCompression: { value: 33, keys: [] }, addNoise: { value: 20, keys: [] } } };
  assert.ok(migrateTopazFx(fx));
  assert.equal(fx.params.model.value, 4); // Artemis antigo → Artemis
  assert.equal(fx.params.compression.value, 33);
  assert.equal(fx.params.addNoise.value, 2);
});

test('importa Topaz Video AI › Enhance e Frame Interpolation do .ffx', () => {
  const P = (name, v, type = 'number') => ({ name, type, value: [v], keyframes: [] });
  const parsed = { name: 'tz', format: 'ffx', warnings: [], matchNames: [], properties: [], effects: [
    { matchName: 'AE_Enhance', name: 'Enhance', params: [P('AI Model', 3, 'popup'), P('Input Quality', 1, 'popup'), P('Input Quality', 1, 'popup'), P('Output Resolution', 2, 'popup'), P('Output Resolution', 2, 'popup'), P('Parameters', 3, 'popup'),
      P('Fix Compression', 0.8), P('Fix Compression', 0.1), P('Improve Detail', 0.6), P('Improve Detail', 0), P('Sharpen', 0.2), P('Sharpen', 0), P('Anti-Alias/Deblur', -0.4), P('Anti-Alias/Deblur', 0), P('Recover Original Details', 0.2), P('Add Noise', 0.02), P('Amount', 0.03), P('Size', 2)] },
    { matchName: 'AEFrameInterpolation', name: 'Frame Interpolation', params: [P('Slowmo', 3, 'popup'), P('Model', 4, 'popup'), P('Remove Duplicates Frames', 1, 'checkbox'), P('Sensitivity', 0.25)] },
  ] };
  assert.equal(matchEffect('AE_Enhance', 'Enhance').def.type, 'topaz');
  const pr = ffxToPreset(parsed);
  const [e, f] = pr.effects;
  assert.equal(e.type, 'topaz'); assert.equal(e.params.model, 2); assert.equal(e.params.inputQuality, 1); assert.equal(e.params.upscale, 2); assert.equal(e.params.paramMode, 3);
  assert.equal(e.params.compression, 80); assert.equal(e.params.ra_compression, 10); assert.equal(e.params.aa, -40);
  assert.equal(e.params.recoverOriginal, 20); assert.equal(e.params.addNoise, 2); assert.equal(e.params.grainAmount, 3); assert.equal(e.params.grainSize, 2);
  assert.equal(f.type, 'topazFI'); assert.equal(f.params.slowmo, 3); assert.equal(f.params.fiModel, 3); assert.equal(f.params.removeDup, true); assert.equal(f.params.sensitivity, 25);
});

test('estimador: imagem com ruído pede mais Reduce Noise que imagem limpa', () => {
  const mk = (noise) => {
    const W = 160, H = 120, d = new Uint8ClampedArray(W * H * 4);
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 60 + x * 0.8 + (x > 80 ? 60 : 0) + rnd() * noise; const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    return { width: W, height: H, data: d };
  };
  const clean = estimateFromImage(mk(0)), noisy = estimateFromImage(mk(40));
  assert.ok(noisy.n > clean.n + 20, `${noisy.n} vs ${clean.n}`);
});
