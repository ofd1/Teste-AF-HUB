import { flatLayers } from './state.js';
// Operações em lote sobre keyframes: selecionar todos, esticar/comprimir, inverter, mover, easing.
// Seleção = array de { layerId, path, key } (key = referência ao objeto keyframe).

import { sortKeys } from './anim.js';
import { resolveProp } from './state.js';

/** Lista todas as propriedades animáveis da camada: [{ path, prop }] */
export function animProps(layer) {
  const out = [];
  for (const [k, p] of Object.entries(layer.transform)) out.push({ path: `transform.${k}`, prop: p });
  for (const fx of layer.effects) for (const [k, p] of Object.entries(fx.params)) out.push({ path: `fx:${fx.id}.${k}`, prop: p });
  return out;
}

/** Seleciona todos os keyframes das camadas informadas. */
export function selectAll(layers) {
  const sel = [];
  for (const layer of layers) {
    for (const { path, prop } of animProps(layer)) for (const key of prop.keys) sel.push({ layerId: layer.id, path, key });
  }
  return sel;
}

export function selectionRange(sel) {
  if (!sel.length) return null;
  let a = Infinity, b = -Infinity;
  for (const s of sel) { a = Math.min(a, s.key.t); b = Math.max(b, s.key.t); }
  return [a, b];
}

/** Guarda os tempos originais (para esticar de forma não destrutiva durante o arraste). */
export function snapshotTimes(sel) {
  return sel.map((s) => s.key.t);
}

/**
 * Estica/comprime os keyframes selecionados.
 * factor 2 = dobra a duração; anchor: 'first' | 'last' | número (tempo).
 */
export function stretchKeys(project, sel, factor, anchor = 'first', base = snapshotTimes(sel)) {
  if (!sel.length) return;
  const lo = Math.min(...base), hi = Math.max(...base);
  const pivot = anchor === 'first' ? lo : anchor === 'last' ? hi : anchor;
  const fps = project.fps;
  sel.forEach((s, i) => {
    const t = pivot + (base[i] - pivot) * factor;
    s.key.t = Math.max(0, Math.round(t * fps * 1000) / (fps * 1000));
  });
  resort(project, sel);
}

/** Inverte a ordem temporal dos keyframes selecionados (por propriedade, mantendo o intervalo). */
export function reverseKeys(project, sel) {
  const [lo, hi] = selectionRange(sel) || [0, 0];
  for (const s of sel) s.key.t = lo + hi - s.key.t;
  resort(project, sel);
}

export function shiftKeys(project, sel, dt) {
  for (const s of sel) s.key.t = Math.max(0, s.key.t + dt);
  resort(project, sel);
}

export function setEase(sel, ease, influence) {
  for (const s of sel) {
    s.key.ease = ease;
    if (influence != null) { s.key.outInf = influence; s.key.inInf = influence; }
  }
}

export function deleteKeys(project, sel) {
  const byProp = new Map();
  for (const s of sel) {
    const layer = flatLayers(project.layers).find((l) => l.id === s.layerId);
    const prop = resolveProp(layer, s.path);
    if (!prop) continue;
    if (!byProp.has(prop)) byProp.set(prop, new Set());
    byProp.get(prop).add(s.key);
  }
  for (const [prop, keys] of byProp) {
    const remaining = prop.keys.filter((kk) => !keys.has(kk));
    if (!remaining.length && prop.keys.length) prop.value = prop.keys[0].v;
    prop.keys = remaining;
  }
}

function resort(project, sel) {
  const seen = new Set();
  for (const s of sel) {
    const id = `${s.layerId}|${s.path}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const layer = flatLayers(project.layers).find((l) => l.id === s.layerId);
    const prop = resolveProp(layer, s.path);
    if (prop) sortKeys(prop);
  }
}
