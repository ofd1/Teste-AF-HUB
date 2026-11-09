import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFFX } from '../js/ffx.js';
import { ffxToPreset } from '../js/presets.js';

test('Deep Glow: todos os controles do plugin vêm do .ffx (Smooth, Blend Mode, Spread, CA, Tint, Iterations)', () => {
  const b = readFileSync(new URL('./fixtures/ffx/Shatter/W Shatter.ffx', import.meta.url));
  const pr = ffxToPreset(parseFFX(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), { fps: 30 }));
  const p = pr.effects.find((e) => e.type === 'deepGlow').params;
  const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
  assert.equal(v(p.knee), 50);
  assert.equal(v(p.blendMode), 1);
  assert.equal(v(p.spread), 33);
  assert.equal(v(p.caChannels), 2);
  assert.equal(v(p.caAmount), 0.25);
  assert.equal(v(p.tintMode), 1);
  assert.equal(v(p.tintMix), 100);
  assert.equal(v(p.iterations), 6);
  assert.equal(v(p.sourceOpacity), 100);
});
