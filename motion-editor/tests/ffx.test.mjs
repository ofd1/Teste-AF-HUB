import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFFX } from '../js/ffx.js';
import { ffxToPreset, applyPreset, createEffectInstance, layerToPreset, BUILTIN_PRESETS } from '../js/presets.js';
import { anim, valueAt } from '../js/anim.js';
import { blurGlowFFX, pseudoControlsFFX, animationFFX } from './fixtures.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('lê efeitos nativos, parâmetros e keyframes', () => {
  const parsed = parseFFX(blurGlowFFX().buffer, { fps: 30 });
  assert.equal(parsed.format, 'RIFX/FaFX');
  assert.deepEqual(parsed.effects.map((e) => e.matchName), ['ADBE Gaussian Blur 2', 'ADBE Glo2', 'ADBE Drop Shadow']);
  const blur = parsed.effects[0];
  assert.equal(blur.name, 'Gaussian Blur');
  const blurriness = blur.params.find((p) => p.index === 1);
  assert.equal(blurriness.name, 'Blurriness');
  assert.equal(blurriness.type, 'slider');
  assert.equal(blurriness.keyframes.length, 2);
  near(blurriness.keyframes[1].t, 0.5);
  assert.deepEqual(blurriness.keyframes.map((k) => k.v[0]), [40, 0]);
  assert.equal(blur.params.find((p) => p.index === 2).options[1], 'Horizontal');
  assert.ok(parsed.matchNames.includes('ADBE Glo2'));
});

test('converte para preset com efeitos mapeados', () => {
  const preset = ffxToPreset(parseFFX(blurGlowFFX().buffer));
  assert.deepEqual(preset.effects.map((e) => e.type), ['blur', 'glow', 'dropShadow']);
  assert.ok(preset.report.effects.every((e) => e.status === 'native'));
  const blur = preset.effects[0].params.radius;
  assert.equal(blur.keys.length, 2);
  assert.equal(blur.keys[0].ease, 'bezier');
  const glow = preset.effects[1].params;
  assert.equal(glow.threshold, 55);
  assert.equal(glow.radius, 32);
  near(glow.intensity, 1.8);
  const sh = preset.effects[2].params;
  near(sh.opacity, 50);
  assert.deepEqual(sh.color.map((c) => +c.toFixed(3)), [0.078, 0.157, 0.784, 1]);
  near(preset.duration, 0.5);
});

test('pseudo-efeitos viram controles genéricos', () => {
  const preset = ffxToPreset(parseFFX(pseudoControlsFFX().buffer));
  assert.equal(preset.effects.length, 1);
  const fx = preset.effects[0];
  assert.equal(fx.type, 'generic');
  assert.equal(fx.label, 'Rig de Controle');
  assert.deepEqual(fx.defs.map((d) => d.kind), ['number', 'color', 'angle', 'bool', 'point']);
  assert.equal(fx.params.p1, 12.5);
  assert.equal(fx.params.p4, true);
  assert.deepEqual(fx.params.p5, [960, 540]);
  assert.equal(preset.report.effects[0].status, 'unsupported');
});

test('preset de animação: transform + expressão', () => {
  const parsed = parseFFX(animationFFX().buffer, { fps: 30 });
  const preset = ffxToPreset(parsed);
  assert.deepEqual(Object.keys(preset.transform).sort(), ['opacity', 'rotation', 'scale']);
  assert.deepEqual(preset.transform.opacity.keys.map((k) => k.v), [0, 100]);
  assert.deepEqual(preset.transform.scale.keys[1].v, [120, 120]);
  assert.ok(preset.report.warnings.some((w) => w.includes('Expressão')));
  assert.equal(preset.effects[0].type, 'tint');
  assert.equal(preset.effects[0].params.amount, 80);
});

test('aplica preset em camada no tempo do playhead', () => {
  const layer = {
    inPoint: 0, outPoint: 5,
    transform: { position: anim([500, 500]), scale: anim([100, 100]), rotation: anim(0), opacity: anim(100), anchor: anim([0, 0]) },
    effects: [],
  };
  const preset = ffxToPreset(parseFFX(animationFFX().buffer));
  applyPreset(layer, preset, 1);
  near(valueAt(layer.transform.opacity, 1), 0);
  near(valueAt(layer.transform.opacity, 1.4), 100);
  assert.equal(layer.effects[0].type, 'tint');

  const slide = BUILTIN_PRESETS.find((p) => p.name.startsWith('Subir'));
  applyPreset(layer, slide, 2);
  assert.deepEqual(valueAt(layer.transform.position, 2), [500, 720]);
  assert.deepEqual(valueAt(layer.transform.position, 3), [500, 500]);

  const back = layerToPreset(layer, 'Meu');
  assert.ok(back.transform.position.keys.length >= 2);
  assert.equal(back.effects[0].type, 'tint');
});

test('arquivo inválido e truncado', () => {
  assert.throws(() => { throw new Error(parseFFX(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer).warnings[0]); }, /RIFF/);
  const full = blurGlowFFX();
  const cut = full.slice(0, Math.floor(full.length * 0.6));
  const parsed = parseFFX(cut.buffer);
  assert.ok(parsed.warnings.some((w) => w.includes('truncado')));
  assert.ok(parsed.effects.length >= 1);
});

test('instância de efeito usa defaults', () => {
  const fx = createEffectInstance('glow', { radius: 10 });
  assert.equal(fx.params.radius.value, 10);
  assert.equal(fx.params.threshold.value, 50);
});
