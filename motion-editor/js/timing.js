// Mapeamento de tempo (puro, testável): Posterize Time, velocidade estilo Twixtor e tempo da mídia.
import { valueAt } from './anim.js';
import { EFFECT_MAP } from './effects.js';

/** Tempo efetivo da camada após efeitos de "time warp" (ex.: Posterize Time). */
export function layerTime(layer, t) {
  let out = t;
  for (const fx of layer.effects) {
    if (!fx.enabled) continue;
    const def = EFFECT_MAP[fx.type];
    if (def?.timeWarp) out = def.timeWarp(out, evalFx(fx, out));
  }
  return out;
}

function evalFx(fx, t) {
  const o = {};
  for (const [k, p] of Object.entries(fx.params)) o[k] = valueAt(p, t);
  return o;
}

export function speedEffect(layer) {
  return layer.effects.find((fx) => fx.enabled && EFFECT_MAP[fx.type]?.sourceSpeed) || null;
}

/** Integra a velocidade (%) de inPoint até t → segundos de mídia consumidos. */
export function integrateSpeed(prop, from, to, step = 1 / 120) {
  if (to <= from) return 0;
  if (!prop.keys?.length) return ((to - from) * prop.value) / 100;
  let acc = 0;
  let a = from;
  let va = valueAt(prop, a);
  while (a < to - 1e-9) {
    const b = Math.min(to, a + step);
    const vb = valueAt(prop, b);
    acc += ((va + vb) / 2) * (b - a);
    a = b; va = vb;
  }
  return acc / 100;
}

/** Tempo (s) dentro do arquivo de mídia para o tempo de composição t. */
export function sourceTime(layer, t) {
  return Math.max(0, sourceTimeRaw(layer, t));
}

/** Como sourceTime, sem limitar em 0 (negativo = o reverse pediria vídeo antes do início do arquivo). */
export function sourceTimeRaw(layer, t) {
  const lt = layerTime(layer, t);
  const start = layer.props.sourceStart || 0;
  const rate = layer.props.speed ?? 1;
  const fx = speedEffect(layer);
  const local = fx ? integrateSpeed(fx.params.speed, layer.inPoint, lt) : lt - layer.inPoint;
  return start + local * rate;
}

/** Velocidade instantânea da mídia (1 = normal) — usada como playbackRate na prévia. */
export function sourceRate(layer, t) {
  const fx = speedEffect(layer);
  const rate = layer.props.speed ?? 1;
  return fx ? (valueAt(fx.params.speed, t) / 100) * rate : rate;
}

/** Quadros para frame blending: { a, b, f } em segundos de mídia. */
export function blendFrames(layer, t, fps) {
  const st = sourceTime(layer, t);
  const fx = speedEffect(layer);
  if (!fx || !valueAt(fx.params.frameBlend, t)) return { a: st, b: null, f: 0 };
  const fr = st * fps;
  const i = Math.floor(fr);
  const f = fr - i;
  if (f < 0.02 || f > 0.98) return { a: Math.round(fr) / fps, b: null, f: 0 };
  return { a: (i + 0.0001) / fps, b: (i + 1.0001) / fps, f };
}

/** Duração de mídia necessária para cobrir [inPoint, outPoint]. */
export function sourceSpan(layer) {
  return sourceTime(layer, layer.outPoint) - (layer.props.sourceStart || 0);
}
