import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haldPixels, haldToCube, haldIsNeutral, encodeCube, HALD_SIZE, HALD_N } from '../js/fx/lut.js';

const f = ([r, g, b]) => [Math.min(1, r * 1.2), g ** 1.5, 1 - b]; // "CC" de teste

test('imagem de captura tem todas as 64³ cores, vermelho mais rápido', () => {
  const px = haldPixels();
  assert.equal(px.length, HALD_SIZE * HALD_SIZE * 4);
  assert.deepEqual([...px.slice(4, 7)], [4, 0, 0]);
  assert.deepEqual([...px.slice(HALD_N * 4, HALD_N * 4 + 3)], [0, 4, 0]);
  assert.deepEqual([...px.slice(HALD_N * HALD_N * 4, HALD_N * HALD_N * 4 + 3)], [0, 0, 4]);
  assert.ok(haldIsNeutral(px));
});

test('captura vira LUT que reproduz a CC', () => {
  const px = haldPixels();
  for (let i = 0; i < px.length; i += 4) { const o = f([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]); for (let c = 0; c < 3; c++) px[i + c] = Math.round(o[c] * 255); }
  assert.ok(!haldIsNeutral(px));
  const cube = haldToCube(px, HALD_SIZE, HALD_SIZE);
  const enc = encodeCube(cube); const bin = Buffer.from(enc.b64, 'base64'); const n = enc.size;
  for (const [r, g, b] of [[0, 0, 0], [n - 1, 0, 5], [7, 20, 31], [n - 1, n - 1, n - 1]]) {
    const exp = f([r / (n - 1), g / (n - 1), b / (n - 1)]); const i = ((b * n + g) * n + r) * 3;
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(bin[i + c] / 255 - exp[c]) < 0.03, `${r},${g},${b} canal ${c}`);
  }
  assert.throws(() => haldToCube(px, 256, 256), /512×512/);
});
