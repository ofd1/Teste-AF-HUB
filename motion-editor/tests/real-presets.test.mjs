// Testes com presets .ffx reais do After Effects (arquivos de teste em tests/fixtures/ffx — não vão para o app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFFX } from '../js/ffx.js';
import { ffxToPreset, createEffectInstance, applyPreset } from '../js/presets.js';
import { anim, valueAt } from '../js/anim.js';
import { sourceTime } from '../js/timing.js';

const load = (rel) => {
  const b = readFileSync(new URL(`./fixtures/ffx/${rel}`, import.meta.url));
  const parsed = parseFFX(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), { fps: 30 });
  return { parsed, preset: ffxToPreset(parsed) };
};
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const types = (p) => p.effects.map((e) => e.type);

const EXPECTED = {
  'Shakes/Sonhei Shake.ffx': ['twitch', 'exposure'],
  'Shakes/ZAZ Shake.ffx': ['motionTile', 'dirBlur', 'shake', 'twitch', 'tint'], // o motion blur do S_Shake agora é do próprio shake
  'Velocity & Reverse/Sonhei Reverse.ffx': ['twixtor', 'blurMoCurves'],
  'CC (Color Correction)/Sonhei CC.ffx': ['looks', 'looks', 'sharpen', 'fourColor', 'levels', 'filmLook', 'sharpen', 'looks', 'exposure'],
  'CC (Color Correction)/Sonhei New CC.ffx': ['looks', 'looks', 'sharpen'],
  'CC (Color Correction)/Galego CC.ffx': ['looks', 'glow', 'sharpen', 'flicker', 'levels', 'filmLook', 'filmDamage', 'hueSat', 'brightnessContrast'],
  'CC (Color Correction)/FTB Main CC.ffx': ['looks', 'sharpen', 'sharpen', 'hueSat', 'sharpen', 'looks', 'glow', 'looks', 'looks'], // Optical Diffusion → glow
  'CC (Color Correction)/FTB AEP CC.ffx': ['looks', 'glow', 'fourColor', 'looks', 'hueSat', 'looks', 'looks', 'brightnessContrast'],
  'CC (Color Correction)/ZAZ Reverse Dark CC.ffx': ['looks', 'glow', 'sharpen', 'filmLook', 'filmDamage', 'hueSat', 'brightnessContrast'],
  'Warp/ZAZ Warp.ffx': ['motionTile', 'warp'],
};

test('todos os presets reais convertem sem efeitos sem equivalente', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    const { parsed, preset } = load(file);
    assert.equal(parsed.format, 'RIFX/FaFX', file);
    assert.deepEqual(types(preset), expected, file);
    assert.ok(preset.report.effects.every((e) => e.status !== 'unsupported'), file);
    assert.ok(!parsed.effects.some((e) => e.name === 'Utf8'), `${file}: nomes`);
  }
});

test('Sonhei Reverse: Twixtor com rampa até velocidade negativa (reverse)', () => {
  const { preset } = load('Velocity & Reverse/Sonhei Reverse.ffx');
  const tw = preset.effects[0];
  assert.deepEqual(tw.params.speed.keys.map((k) => k.v), [100, 270, 25, -530]);
  assert.equal(tw.params.speed.keys[2].ease, 'bezier');
  assert.equal(tw.params.frameBlend, true);
  const zoom = preset.effects[1];
  assert.deepEqual(zoom.params.zDist.keys.map((k) => +k.v.toFixed(2)), [1.1, 0.8, 1.1]); // Z Dist animado = zoom de câmera
  assert.deepEqual(zoom.params.center.map((v) => +v.toFixed(3)), [0.5, 0.667]);
  assert.equal(zoom.params.shutter, 1);
  assert.equal(zoom.params.wrap, 3);
  // aplicado num vídeo, o tempo da mídia avança e depois volta (reverse)
  const layer = {
    id: 'v', type: 'video', inPoint: 0, outPoint: 4, props: { sourceStart: 3, speed: 1 },
    transform: { position: anim([0, 0]), scale: anim([100, 100]), rotation: anim(0), opacity: anim(100), anchor: anim([0, 0]) }, effects: [],
  };
  applyPreset(layer, preset, 0);
  const a = sourceTime(layer, 0.5), b = sourceTime(layer, 1.5), c = sourceTime(layer, 2.2);
  assert.ok(b > a && c < b, `reverse: ${a} ${b} ${c}`);
});

test('ZAZ Shake: efeitos sincronizados no mesmo tempo', () => {
  const { preset } = load('Shakes/ZAZ Shake.ffx');
  const peak = (type, key) => { const k = preset.effects.find((e) => e.type === type).params[key].keys; return k.reduce((m, x) => (x.v > m.v ? x : m)).t; };
  near(peak('shake', 'amount'), 1.933, 0.05);
  near(peak('dirBlur', 'length'), 1.933, 0.05);
  near(peak('twitch', 'amount'), 1.9, 0.05);
  near(peak('tint', 'amount'), 1.933, 0.05);
  assert.equal(preset.effects.find((e) => e.type === 'motionTile').params.mirror, true);
});

test('CC: Looks decodificado e Gradiente de 4 cores', () => {
  const { parsed, preset } = load('CC (Color Correction)/FTB AEP CC.ffx');
  assert.deepEqual(parsed.effects.filter((e) => /^MB/.test(e.matchName)).map((e) => e.name), ['Magic Bullet Looks', 'Looks 3', 'Magic Bullet Looks 2', 'Looks']);
  const looks = preset.effects.filter((e) => e.type === 'looks');
  assert.deepEqual(looks.map((l) => l.params.strength), [50, 100, 75, 90]);
  assert.ok(looks[0].params.mojo > 0 && looks[0].params.vignette > 0 && looks[0].params.optDensity > 0);
  const g = preset.effects.find((e) => e.type === 'fourColor').params;
  assert.equal(g.mode, 7); // Soft Light
  assert.equal(g.opacity, 5);

  const dark = load('CC (Color Correction)/ZAZ Reverse Dark CC.ffx').preset.effects[0].params;
  assert.equal(dark.saturation, 75.5); // Hue/Sat 65% do Looks (luz linear) ≈ 75,5% na tela
  assert.equal(dark.mojo, 100); // Mojo II = 100 no Looks original
  assert.equal(dark.bleach, 50); // Bleach It 50 (manual: menos saturação)

  const de = load('CC (Color Correction)/FTB Main CC.ffx'); // salvo num After Effects em alemão
  const um = de.preset.effects.find((e) => e.matchName === 'ADBE Unsharp Mask2');
  assert.equal(um.params.amount, 50);
  assert.equal(um.params.radius, 1);
});

test('Warp e Motion Tile', () => {
  const { preset } = load('Warp/ZAZ Warp.ffx');
  assert.deepEqual(preset.effects[0].params, { outW: 300, outH: 300, mirror: true });
  assert.deepEqual(preset.effects[1].params, { style: 8, axis: 1, bend: 3, hDist: 1, vDist: 1 });
});

test('instâncias de efeito criadas a partir dos presets reais são válidas', () => {
  for (const file of Object.keys(EXPECTED)) {
    const { preset } = load(file);
    for (const fx of preset.effects) {
      const inst = createEffectInstance(fx.type, fx.params);
      for (const [k, p] of Object.entries(inst.params)) {
        const v = valueAt(p, 1);
        const ok = typeof v === 'boolean' || (Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v));
        assert.ok(ok, `${file} ${fx.type}.${k}=${v}`);
      }
    }
  }
});

test('Looks: Colorista HSL por cor, temperatura e curvas vêm do arquivo', () => {
  const sn = load('CC (Color Correction)/Sonhei New CC.ffx').preset.effects.filter((e) => e.type === 'looks').map((e) => e.params);
  // ordem do Looks3.aex: matizes R..M (13-20), saturações (21-28), luminâncias (29-36)
  assert.equal(sn[0].hslBlueS, -50);
  assert.equal(sn[0].hslPurpleH, 50);
  assert.equal(sn[0].temperature, -15);
  assert.equal(Math.round(sn[1].saturation), 40); // Colorista Saturation 40%
  assert.equal(sn[1].mixAmt, 0.7); // Channel Mixer com Strength 70%
  const ftb = load('CC (Color Correction)/FTB AEP CC.ffx').preset.effects.filter((e) => e.type === 'looks').map((e) => e.params);
  assert.deepEqual([ftb[1].curve1x, ftb[1].curve1y].map((v) => +v.toFixed(3)), [0.292, 0.065]); // ponto livre da curva (entrada, ajuste)
  assert.ok(ftb[0].mojo > 30 && ftb[0].bleach > 70) // Mojo 36 + Bleach It 85;
});
