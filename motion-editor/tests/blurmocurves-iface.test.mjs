import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFFX } from '../js/ffx.js';
import { ffxToPreset } from '../js/presets.js';

test('S_BlurMoCurves: Shutter Shift, Exposure Bias, Brightness e Effect vêm do .ffx', () => {
  const b = readFileSync(new URL('./fixtures/ffx/Shakes/Main Shakey.ffx', import.meta.url));
  const pr = ffxToPreset(parseFFX(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), { fps: 30 }));
  const fx = pr.effects.find((e) => e.type === 'blurMoCurves');
  assert.ok(fx, 'blurMoCurves importado');
  const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
  assert.equal(typeof v(fx.params.shutterShift), 'number');
  assert.equal(v(fx.params.bias), 0.5);
  assert.equal(v(fx.params.brightness), 1);
});
