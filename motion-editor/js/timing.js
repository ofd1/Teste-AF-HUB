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

/** Propriedade de velocidade (%) do efeito de tempo (Twixtor: o próprio parâmetro; Topaz FI: vem do Slowmo). */
export function speedProp(fx) {
  const def = EFFECT_MAP[fx.type];
  return def?.speedProp ? def.speedProp(fx) : fx.params.speed;
}

/** Quadros duplicados: liga pela camada (painel Topaz) ou pelo Frame Interpolation com Remove Duplicates. */
export function dedupeOf(layer) {
  if (layer.props?.dedupe) return { sens: layer.props.dupSens ?? 20 };
  const fi = layer.effects?.find((f) => f.enabled && f.type === 'topazFI' && f.params.removeDup?.value);
  return fi ? { sens: fi.params.sensitivity?.value ?? 10 } : null;
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
export function remapEffect(layer) {
  return layer.effects.find((fx) => fx.enabled && EFFECT_MAP[fx.type]?.sourceRemap) || null;
}

export function sourceTimeRaw(layer, t) {
  const lt = layerTime(layer, t);
  // Time Remap (AE): o valor é diretamente o segundo do arquivo
  const rm = remapEffect(layer);
  if (rm) return valueAt(rm.params.time, lt);
  const start = layer.props.sourceStart || 0;
  const rate = layer.props.speed ?? 1;
  const fx = speedEffect(layer);
  const local = fx ? integrateSpeed(speedProp(fx), layer.inPoint, lt) : lt - layer.inPoint;
  return start + local * rate;
}

/**
 * Tempo do conteúdo de uma pré-comp (grupo) no tempo de composição t — como no AE:
 * - mover a pré-comp na timeline leva o conteúdo junto (o conteúdo é relativo ao início dela);
 * - aparar o começo não desloca o conteúdo (props.sourceStart, igual ao vídeo);
 * - Velocidade (Twixtor) e Time Remap na pré-comp mudam o tempo de tudo que está dentro.
 * As camadas de dentro guardam tempos "absolutos" de quando foram agrupadas; contentStart é esse ponto zero.
 */
export function ensureGroupTime(g) {
  const p = g.props;
  if (p.contentStart == null) { p.contentStart = g.inPoint; p.sourceStart = 0; } // grupos antigos: mesmo resultado de antes
}
export function groupContentTime(g, t) {
  ensureGroupTime(g);
  return g.props.contentStart + Math.max(0, sourceTimeRaw(g, t)); // reverse antes do começo: segura o 1º quadro (igual ao vídeo)
}
export const groupHasTimeFx = (g) => !!(speedEffect(g) || remapEffect(g));

/**
 * Todas as camadas (inclusive de dentro das pré-comps) com o tempo local de cada uma no tempo de composição t
 * e o fator de velocidade herdado das pré-comps (k). Camadas de pré-comp fora do intervalo recebem t = NaN.
 */
export function timedLayers(layers, t, k = 1, out = []) {
  for (const l of layers || []) {
    out.push({ l, t, k });
    if (l.type === 'group') {
      const on = t >= l.inPoint && t < l.outPoint;
      timedLayers(l.props.layers, on ? groupContentTime(l, t) : NaN, on ? k * sourceRate(l, t) : k, out);
    }
  }
  return out;
}

/** Velocidade instantânea da mídia (1 = normal) — usada como playbackRate na prévia. */
export function sourceRate(layer, t) {
  const rm = remapEffect(layer);
  if (rm) { const h = 1 / 120; return (valueAt(rm.params.time, t + h) - valueAt(rm.params.time, t - h)) / (2 * h); }
  const fx = speedEffect(layer);
  const rate = layer.props.speed ?? 1;
  return fx ? (valueAt(speedProp(fx), t) / 100) * rate : rate;
}

/** Quadros para frame blending: { a, b, f } em segundos de mídia. */
/** Interpolação de quadros ligada? (Twixtor com frame blending ou "Suavizar movimento" da camada). */
export function wantsInterp(layer, t) {
  if (layer.props.interpolate) return true;
  const rm = remapEffect(layer);
  if (rm) return !!valueAt(rm.params.frameBlend, t);
  const fx = speedEffect(layer);
  if (fx && EFFECT_MAP[fx.type]?.alwaysBlend) return true;
  return !!(fx && valueAt(fx.params.frameBlend, t));
}

/** Quadros de origem para o tempo t (no fps real do vídeo): { a, b, f } em segundos de mídia. */
/** Motion blur por vetores do Twixtor (%), 0 quando desligado. */
export function vectorBlur(layer, t) {
  const fx = speedEffect(layer);
  return fx?.params.motionBlur ? valueAt(fx.params.motionBlur, t) || 0 : 0;
}

export function blendFrames(layer, t, fps) {
  const st = sourceTime(layer, t);
  const sfps = layer.props.sourceFps || fps;
  const fr = st * sfps;
  const i = Math.floor(fr);
  const f = fr - i;
  // motion blur por vetores precisa sempre do quadro seguinte (para medir o movimento)
  if (vectorBlur(layer, t) > 0) return { a: (i + 0.01) / sfps, b: (i + 1.01) / sfps, f: wantsInterp(layer, t) ? f : 0 };
  if (!wantsInterp(layer, t)) return { a: (Math.floor(st * sfps + 1e-6) + 0.01) / sfps, b: null, f: 0 };
  // +1% do quadro: buscar exatamente na borda faz alguns navegadores entregarem o quadro anterior
  if (f < 0.02 || f > 0.98) return { a: (Math.round(fr) + 0.01) / sfps, b: null, f: 0 };
  return { a: (i + 0.01) / sfps, b: (i + 1.01) / sfps, f };
}

/** Duração de mídia necessária para cobrir [inPoint, outPoint]. */
export function sourceSpan(layer) {
  return sourceTime(layer, layer.outPoint) - (layer.props.sourceStart || 0);
}
