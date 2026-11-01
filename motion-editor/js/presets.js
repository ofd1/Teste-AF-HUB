// Presets: formato próprio (JSON), biblioteca nativa, conversão de .ffx e aplicação em camadas.
//
// Preset = {
//   id, name, category, source: 'builtin'|'ffx'|'user', anchor: 'playhead'|'end', duration,
//   transform: { position|scale|rotation|opacity: { mode:'abs'|'rel', value?, keys?:[{t,v,ease,inInf?,outInf?}] } },
//   effects: [{ type, label?, matchName?, defs?, params: { key: value | { keys:[...] } } }],
//   report?: {...}   // relatório de importação FFX
// }

import { anim, valueAt, sortKeys } from './anim.js';
import { EFFECT_MAP, getEffectDef, matchEffect } from './effects.js';
import { uid } from './util.js';

export const PRESET_FORMAT = 'motionframe-preset@1';

const k = (t, v, ease = 'easeInOut') => ({ t, v, ease });

export const BUILTIN_PRESETS = [
  // Entradas
  { name: 'Fade In', category: 'Entrada', transform: { opacity: { mode: 'abs', keys: [k(0, 0, 'easeOut'), k(0.5, 100)] } } },
  { name: 'Subir (Slide Up)', category: 'Entrada', transform: { position: { mode: 'rel', keys: [k(0, [0, 220], 'back'), k(0.7, [0, 0])] }, opacity: { mode: 'abs', keys: [k(0, 0, 'linear'), k(0.3, 100)] } } },
  { name: 'Da esquerda', category: 'Entrada', transform: { position: { mode: 'rel', keys: [k(0, [-600, 0], 'easeOut'), k(0.6, [0, 0])] } } },
  { name: 'Pop', category: 'Entrada', transform: { scale: { mode: 'abs', keys: [k(0, [0, 0], 'back'), k(0.45, [100, 100])] }, opacity: { mode: 'abs', keys: [k(0, 0, 'linear'), k(0.15, 100)] } } },
  { name: 'Zoom In', category: 'Entrada', transform: { scale: { mode: 'abs', keys: [k(0, [300, 300], 'easeOut'), k(0.6, [100, 100])] }, opacity: { mode: 'abs', keys: [k(0, 0, 'linear'), k(0.3, 100)] } } },
  { name: 'Girar e entrar', category: 'Entrada', transform: { rotation: { mode: 'rel', keys: [k(0, -180, 'easeOut'), k(0.7, 0)] }, scale: { mode: 'abs', keys: [k(0, [0, 0], 'easeOut'), k(0.7, [100, 100])] } } },
  { name: 'Quicar', category: 'Entrada', transform: { position: { mode: 'rel', keys: [k(0, [0, -700], 'bounce'), k(1, [0, 0])] } } },
  { name: 'Desfoque de entrada', category: 'Entrada', transform: { opacity: { mode: 'abs', keys: [k(0, 0, 'easeOut'), k(0.5, 100)] } }, effects: [{ type: 'blur', params: { radius: { keys: [k(0, 60, 'easeOut'), k(0.6, 0)] } } }] },
  // Saídas
  { name: 'Fade Out', category: 'Saída', anchor: 'end', transform: { opacity: { mode: 'abs', keys: [k(0, 100, 'easeIn'), k(0.5, 0)] } } },
  { name: 'Encolher', category: 'Saída', anchor: 'end', transform: { scale: { mode: 'abs', keys: [k(0, [100, 100], 'easeIn'), k(0.4, [0, 0])] } } },
  { name: 'Sair por cima', category: 'Saída', anchor: 'end', transform: { position: { mode: 'rel', keys: [k(0, [0, 0], 'easeIn'), k(0.5, [0, -900])] } } },
  // Ênfase
  { name: 'Pulsar', category: 'Ênfase', transform: { scale: { mode: 'abs', keys: [k(0, [100, 100]), k(0.25, [115, 115]), k(0.5, [100, 100]), k(0.75, [115, 115]), k(1, [100, 100])] } } },
  { name: 'Balançar', category: 'Ênfase', transform: { rotation: { mode: 'rel', keys: [k(0, 0), k(0.2, 12), k(0.4, -10), k(0.6, 6), k(0.8, -3), k(1, 0)] } } },
  { name: 'Piscar (Flicker)', category: 'Ênfase', transform: { opacity: { mode: 'abs', keys: [k(0, 100, 'hold'), k(0.08, 20, 'hold'), k(0.16, 100, 'hold'), k(0.3, 40, 'hold'), k(0.36, 100, 'hold')] } } },
  { name: 'Tremor de câmera', category: 'Ênfase', effects: [{ type: 'shake', params: { frequency: 10, amount: 18, rotation: 1.5 } }] },
  // Efeitos / looks
  { name: 'Glow neon', category: 'Look', effects: [{ type: 'glow', params: { threshold: 20, radius: 30, intensity: 2, useColor: true, color: [0.2, 0.9, 1, 1] } }] },
  { name: 'Glow pulsante', category: 'Look', effects: [{ type: 'glow', params: { threshold: 30, radius: { keys: [k(0, 10), k(0.5, 45), k(1, 10)] }, intensity: 1.6 } }] },
  { name: 'Glitch RGB', category: 'Look', effects: [{ type: 'rgbSplit', params: { amount: { keys: [k(0, 0, 'hold'), k(0.1, 18, 'hold'), k(0.18, 4, 'hold'), k(0.3, 25, 'hold'), k(0.4, 0, 'hold')] } } }, { type: 'shake', params: { frequency: 20, amount: 6, rotation: 0 } }] },
  { name: 'Vintage', category: 'Look', effects: [{ type: 'tint', params: { black: [0.15, 0.08, 0.05, 1], white: [1, 0.93, 0.78, 1], amount: 70 } }, { type: 'noise', params: { amount: 18 } }, { type: 'vignette', params: { amount: 65 } }] },
  { name: 'Sombra suave', category: 'Look', effects: [{ type: 'dropShadow', params: { opacity: 60, distance: 18, softness: 30 } }] },
  { name: 'Preto e branco', category: 'Look', effects: [{ type: 'blackWhite', params: {} }, { type: 'brightnessContrast', params: { contrast: 25 } }] },
  { name: 'Pixelar', category: 'Look', effects: [{ type: 'mosaic', params: { hBlocks: { keys: [k(0, 4, 'easeIn'), k(0.8, 120)] }, vBlocks: { keys: [k(0, 4, 'easeIn'), k(0.8, 120)] } } }] },
].map((p, i) => ({ id: `builtin_${i}`, source: 'builtin', anchor: 'playhead', ...p, duration: presetDuration(p) }));

function keysOf(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.keys) ? v.keys : [];
}

export function presetDuration(p) {
  let d = 0;
  for (const tr of Object.values(p.transform || {})) for (const kk of keysOf(tr)) d = Math.max(d, kk.t);
  for (const fx of p.effects || []) for (const v of Object.values(fx.params || {})) for (const kk of keysOf(v)) d = Math.max(d, kk.t);
  return d;
}

// ------------------------------------------------------------------ FFX → preset

const TRANSFORM_MAP = {
  'ADBE Position': { prop: 'position', mode: 'rel' },
  'ADBE Position_0': { prop: 'position', mode: 'rel', dim: 0 },
  'ADBE Position_1': { prop: 'position', mode: 'rel', dim: 1 },
  'ADBE Scale': { prop: 'scale', mode: 'abs' },
  'ADBE Rotate Z': { prop: 'rotation', mode: 'abs' },
  'ADBE Rotate Z Plus': { prop: 'rotation', mode: 'abs' },
  'ADBE Opacity': { prop: 'opacity', mode: 'abs' },
};

function ffxEase(kf) {
  if (kf.interp === 3) return { ease: 'hold' };
  if (kf.interp === 2) return { ease: 'bezier', outInf: kf.outInf, inInf: kf.inInf };
  return { ease: 'linear' };
}

function convertValue(raw, kind, conv) {
  if (!raw || !raw.length) return undefined;
  let v;
  switch (kind) {
    case 'color': {
      const [a, r, g, b] = raw.length >= 4 ? raw : [1, raw[0], raw[1], raw[2]];
      const s = Math.max(a, r, g, b) > 1 ? 255 : 1;
      v = [r / s, g / s, b / s, 1];
      break;
    }
    case 'bool': v = raw[0] >= 0.5; break;
    case 'point': v = [raw[0] || 0, raw[1] || 0]; break;
    default: v = raw[0];
  }
  return conv && typeof v === 'number' ? conv(v) : v;
}

function convertProp(src, kind, conv) {
  if (src.keyframes?.length) {
    return {
      keys: src.keyframes.map((kf) => ({ t: kf.t, v: convertValue(kf.v, kind, conv), ...ffxEase(kf) })).filter((x) => x.v !== undefined),
    };
  }
  return convertValue(src.value, kind, conv);
}

function findParam(params, mapping) {
  if (!mapping) return null;
  const norm = (s) => (s || '').toLowerCase().trim();
  for (const n of mapping.names || []) {
    const hit = params.find((p) => norm(p.name) === n);
    if (hit) return hit;
  }
  for (const n of mapping.names || []) {
    const hit = params.find((p) => norm(p.name).includes(n));
    if (hit) return hit;
  }
  if (mapping.index != null) return params.find((p) => p.index === mapping.index) || null;
  return null;
}

const kindFromFfx = (t) => ({ color: 'color', angle: 'angle', checkbox: 'bool', point: 'point', point3d: 'point', popup: 'select' }[t] || 'number');

export function ffxToPreset(parsed) {
  const preset = {
    id: uid('ffx'), name: parsed.name || 'Preset FFX', category: 'Importado (FFX)', source: 'ffx', anchor: 'playhead',
    transform: {}, effects: [],
    report: { format: parsed.format, effects: [], properties: [], warnings: parsed.warnings.slice(), matchNames: parsed.matchNames },
  };

  for (const fx of parsed.effects) {
    const m = matchEffect(fx.matchName, fx.name);
    const rep = { matchName: fx.matchName, name: fx.name || fx.matchName, status: 'unsupported', mapped: [], params: fx.params.map((p) => ({ name: p.name, type: p.type, value: p.value, keys: p.keyframes.length })) };
    if (m) {
      const def = m.def;
      const inst = { type: def.type, label: fx.name && fx.name !== fx.matchName ? fx.name : undefined, matchName: fx.matchName, params: {} };
      for (const pd of def.params) {
        const mapping = def.ffx?.map?.[pd.key];
        const src = findParam(fx.params, mapping);
        if (src) {
          const v = convertProp(src, pd.kind, mapping.fromAE);
          if (v !== undefined) {
            inst.params[pd.key] = v;
            rep.mapped.push(`${src.name || src.matchName} → ${pd.label}${src.keyframes.length ? ` (${src.keyframes.length} keyframes)` : ''}`);
          }
        }
      }
      if (def.type === 'glow' && inst.params.color !== undefined) inst.params.useColor = true;
      rep.status = m.exact ? 'native' : 'approx';
      rep.mappedTo = def.label;
      preset.effects.push(inst);
    } else {
      // mantém como controles editáveis (sem renderização)
      const defs = [];
      const params = {};
      fx.params.forEach((p, i) => {
        const key = `p${p.index >= 0 ? p.index : i}`;
        const kind = kindFromFfx(p.type);
        const d = { key, label: p.name || p.matchName, kind, default: kind === 'color' ? [1, 1, 1, 1] : kind === 'bool' ? false : kind === 'point' ? [0, 0] : 0 };
        if (kind === 'select') { d.kind = 'number'; d.options = p.options; }
        if (p.min !== undefined && Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min) { d.min = p.min; d.max = p.max; }
        defs.push(d);
        const v = convertProp(p, d.kind);
        if (v !== undefined) params[key] = v;
      });
      preset.effects.push({ type: 'generic', label: fx.name || fx.matchName, matchName: fx.matchName, defs, params });
    }
    preset.report.effects.push(rep);
  }

  // propriedades soltas (transform, etc.)
  const posDims = {};
  for (const p of parsed.properties) {
    const map = TRANSFORM_MAP[p.matchName];
    const rep = { matchName: p.matchName, name: p.name || p.matchName, keys: p.keyframes.length, status: map ? 'native' : 'unsupported' };
    preset.report.properties.push(rep);
    if (!map) continue;
    if (map.dim !== undefined) { posDims[map.dim] = p; continue; }
    preset.transform[map.prop] = transformFromFfx(map, p);
  }
  if (posDims[0] || posDims[1]) preset.transform.position = mergeSeparated(posDims[0], posDims[1]);

  preset.duration = presetDuration(preset);
  return preset;
}

function transformFromFfx(map, p) {
  const fix = (v) => {
    if (map.prop === 'position') return [v[0] || 0, v[1] || 0];
    if (map.prop === 'scale') return [v[0] ?? 100, v[1] ?? v[0] ?? 100];
    return v[0];
  };
  if (p.keyframes.length) {
    let keys = p.keyframes.map((kf) => ({ t: kf.t, v: fix(kf.v), ...ffxEase(kf) }));
    if (map.mode === 'rel') {
      const base = keys[keys.length - 1].v; // movimento relativo ao valor final (posição de repouso)
      keys = keys.map((kk) => ({ ...kk, v: kk.v.map((x, i) => x - base[i]) }));
    }
    return { mode: map.mode, keys };
  }
  if (map.mode === 'rel') return { mode: 'rel', value: [0, 0] };
  return { mode: 'abs', value: fix(p.value) };
}

function mergeSeparated(px, py) {
  const toProp = (p) => {
    if (!p) return { value: 0, keys: [] };
    if (!p.keyframes.length) return { value: p.value[0] || 0, keys: [] };
    const last = p.keyframes[p.keyframes.length - 1].v[0];
    return { value: 0, keys: p.keyframes.map((kf) => ({ t: kf.t, v: kf.v[0] - last, ...ffxEase(kf) })) };
  };
  const ax = toProp(px), ay = toProp(py);
  const times = [...new Set([...ax.keys, ...ay.keys].map((x) => x.t))].sort((a, b) => a - b);
  if (!times.length) return { mode: 'rel', value: [0, 0] };
  return {
    mode: 'rel',
    keys: times.map((t) => {
      const src = ax.keys.find((x) => x.t === t) || ay.keys.find((x) => x.t === t);
      return { t, v: [ax.keys.length ? valueAt(ax, t) : 0, ay.keys.length ? valueAt(ay, t) : 0], ease: src.ease, inInf: src.inInf, outInf: src.outInf };
    }),
  };
}

// ------------------------------------------------------------------ aplicar preset

function toAnimProp(v, t0, fallback) {
  if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.keys)) {
    const keys = v.keys.map((kk) => ({ ...kk, t: +(t0 + kk.t).toFixed(4) }));
    return anim(keys[0]?.v ?? fallback, keys);
  }
  return anim(v === undefined ? fallback : v);
}

export function createEffectInstance(type, params = {}, t0 = 0, extra = {}) {
  const def = type === 'generic' ? { params: extra.defs || [] } : getEffectDef(type);
  const inst = { id: uid('fx'), type, enabled: true, params: {}, ...extra };
  for (const pd of def.params) inst.params[pd.key] = toAnimProp(params[pd.key], t0, pd.default);
  return inst;
}

export function applyPreset(layer, preset, playhead) {
  const dur = preset.duration || presetDuration(preset);
  const t0 = preset.anchor === 'end' ? Math.max(layer.inPoint, layer.outPoint - dur) : playhead;

  for (const [prop, tr] of Object.entries(preset.transform || {})) {
    const target = layer.transform[prop];
    if (!target) continue;
    const base = valueAt(target, t0);
    if (tr.keys?.length) {
      const span = [t0 - 1e-4, t0 + dur + 1e-4];
      target.keys = target.keys.filter((kk) => kk.t < span[0] || kk.t > span[1]);
      for (const kk of tr.keys) {
        let v = kk.v;
        if (tr.mode === 'rel') v = Array.isArray(v) ? v.map((x, i) => x + base[i]) : v + base;
        target.keys.push({ t: +(t0 + kk.t).toFixed(4), v: Array.isArray(v) ? v.slice() : v, ease: kk.ease || 'linear', inInf: kk.inInf, outInf: kk.outInf });
      }
      sortKeys(target);
    } else if (tr.value !== undefined && tr.mode === 'abs') {
      if (target.keys.length) target.keys = [];
      target.value = Array.isArray(tr.value) ? tr.value.slice() : tr.value;
    }
  }

  for (const fx of preset.effects || []) {
    if (fx.type !== 'generic' && !EFFECT_MAP[fx.type]) continue;
    layer.effects.push(createEffectInstance(fx.type, fx.params, t0, {
      ...(fx.label ? { label: fx.label } : {}),
      ...(fx.matchName ? { matchName: fx.matchName } : {}),
      ...(fx.defs ? { defs: fx.defs } : {}),
    }));
  }
  return t0;
}

/** Converte a animação/efeitos de uma camada em preset reutilizável. */
export function layerToPreset(layer, name) {
  let t0 = Infinity;
  const scan = (p) => p.keys.forEach((kk) => { t0 = Math.min(t0, kk.t); });
  Object.values(layer.transform).forEach(scan);
  layer.effects.forEach((fx) => Object.values(fx.params).forEach(scan));
  if (!Number.isFinite(t0)) t0 = 0;

  const rel = (keys) => keys.map((kk) => ({ ...kk, t: +(kk.t - t0).toFixed(4) }));
  const transform = {};
  for (const [prop, p] of Object.entries(layer.transform)) {
    if (!p.keys.length || prop === 'anchor') continue;
    if (prop === 'position') {
      const last = p.keys[p.keys.length - 1].v;
      transform.position = { mode: 'rel', keys: rel(p.keys).map((kk) => ({ ...kk, v: kk.v.map((x, i) => x - last[i]) })) };
    } else transform[prop] = { mode: 'abs', keys: rel(p.keys) };
  }
  const effects = layer.effects.map((fx) => ({
    type: fx.type,
    ...(fx.label ? { label: fx.label } : {}),
    ...(fx.matchName ? { matchName: fx.matchName } : {}),
    ...(fx.defs ? { defs: fx.defs } : {}),
    params: Object.fromEntries(Object.entries(fx.params).map(([key, p]) => [key, p.keys.length ? { keys: rel(p.keys) } : p.value])),
  }));
  const preset = { id: uid('user'), name, category: 'Meus presets', source: 'user', anchor: 'playhead', transform, effects };
  preset.duration = presetDuration(preset);
  return preset;
}

export function serializePreset(p) {
  return JSON.stringify({ format: PRESET_FORMAT, preset: p }, null, 2);
}

export function parsePresetJSON(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.presets || [data.preset || data];
  return list.map((p) => {
    if (!p || typeof p !== 'object' || !p.name) throw new Error('JSON não é um preset válido');
    return { ...p, id: uid('user'), source: p.source === 'ffx' ? 'ffx' : 'user', category: p.category || 'Meus presets', duration: presetDuration(p) };
  });
}
