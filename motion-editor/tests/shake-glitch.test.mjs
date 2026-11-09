import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS } from '../js/effects.js';

// Regressão: Shift animado em px passando por valores pequenos (ex.: −1,5) era lido como "fração da tela"
// e jogava a imagem ~960 px num único quadro (listras verticais no Main Shakey / pxnoz shakey).
test('S_BlurMoCurves: Shift animado em px nunca vira fração da tela', () => {
  const def = EFFECTS.find((e) => e.type === 'blurMoCurves');
  let u = null;
  const gl = { pass: (f, uni) => { u = uni; return {}; }, blur: (x) => x };
  const base = Object.fromEntries(def.params.map((q) => [q.key, q.default]));
  const env = { gl, w: 360, h: 640, W: 360, H: 640, scale: 1, rect: [0, 0, 1, 1], fps: 30, t: 1.2,
    fx: { params: { shiftY: { value: 0, keys: [{ t: 0, v: -300 }, { t: 0.53, v: 50 }, { t: 0.9, v: -25 }, { t: 1.33, v: 10 }] } } } };
  def.render({}, { ...base, shiftY: -1.5 }, env, { ...base, shiftY: -5.5 });
  assert.ok(Math.abs(u.u_sh1[1] * 640) < 10, `deslocamento ${u.u_sh1[1] * 640}px`);
  // projeto antigo (propriedade inteira em fração) continua convertido
  const old = { ...env, fx: { params: { shiftY: { value: 0.25, keys: [] } } } };
  def.render({}, { ...base, shiftY: 0.25 }, old, { ...base, shiftY: 0.25 });
  assert.ok(Math.abs(u.u_sh1[1] * 640 - 160) < 1);
});
