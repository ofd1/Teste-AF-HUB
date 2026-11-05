import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ffxToPreset, setPluginLookup, upgradeGenericEffects, upgradeLayerEffects, createEffectInstance } from '../js/presets.js';

const parsed = (mn = 'ZZ Quuxify', nm = 'Quuxify') => ({ name: 'Teste', format: 'ffx', warnings: [], matchNames: [mn], properties: [],
  effects: [{ matchName: mn, name: nm, params: [{ name: 'Radius', type: 'number', value: [80], keyframes: [] }, { name: 'Exposure', type: 'number', value: [1.5], keyframes: [] }] }] });
const plugin = { name: 'Quuxify', matchName: 'ZZ Quuxify', category: 'ZZ Plugins', effect: 'deepGlow', set: {} };

test('plugin desconhecido vira "Controles importados" e guarda o original', () => {
  setPluginLookup(null);
  const p = ffxToPreset(parsed());
  assert.equal(p.effects[0].type, 'generic'); assert.ok(p.effects[0].rawFx);
});

test('instalado depois: preset da biblioteca é convertido de novo, com os valores do .ffx', () => {
  setPluginLookup(null);
  const p = ffxToPreset(parsed());
  setPluginLookup((mn) => (mn === 'ZZ Quuxify' ? plugin : null));
  assert.equal(upgradeGenericEffects(p.effects), 1);
  assert.equal(p.effects[0].type, 'deepGlow'); assert.equal(p.effects[0].label, 'Quuxify');
  assert.equal(p.effects[0].params.radius, 80); assert.equal(p.effects[0].params.exposure, 1.5);
});

test('instalado depois: efeito já aplicado na camada também muda', () => {
  setPluginLookup(null);
  const p = ffxToPreset(parsed());
  const layer = { effects: [createEffectInstance('generic', p.effects[0].params, 0, { label: p.effects[0].label, defs: p.effects[0].defs, rawFx: p.effects[0].rawFx, ffxT0: 0 })] };
  setPluginLookup((mn) => (mn === 'ZZ Quuxify' ? plugin : null));
  assert.equal(upgradeLayerEffects(layer), 1);
  assert.equal(layer.effects[0].type, 'deepGlow'); assert.equal(layer.effects[0].params.radius.value, 80);
});

test('instalado antes: importação do .ffx já usa o plugin', () => {
  setPluginLookup((mn) => (mn === 'ZZ Quuxify' ? plugin : null));
  const p = ffxToPreset(parsed());
  assert.equal(p.effects[0].type, 'deepGlow'); assert.equal(p.report.effects[0].installedPlugin, 'Quuxify');
  setPluginLookup(null);
});

test('plugin instalado vence palpite por palavra-chave', () => {
  setPluginLookup((mn) => (mn === 'ZZ SuperGlow' ? { ...plugin, name: 'Super Glow', matchName: 'ZZ SuperGlow' } : null));
  assert.equal(ffxToPreset(parsed('ZZ SuperGlow', 'Super Glow')).effects[0].type, 'deepGlow');
  setPluginLookup(null);
  assert.equal(ffxToPreset(parsed('ZZ SuperGlow', 'Super Glow')).effects[0].type, 'glow');
});
