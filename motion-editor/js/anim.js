// Propriedades animáveis, keyframes e easing.
// AnimProp = { value, keys: [{ t, v, ease }] }  — ease = interpolação de saída do keyframe.

export const EASES = {
  linear: 'Linear',
  easeInOut: 'Easy Ease',
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  back: 'Overshoot',
  bounce: 'Quicar',
  hold: 'Congelar (Hold)',
  bezier: 'Bézier (AE)',
  curve: 'Gráfico personalizado',
};

export function anim(value, keys = []) {
  return { value: clone(value), keys: keys.map((k) => ({ ...k, v: clone(k.v) })) };
}

export function clone(v) {
  return Array.isArray(v) ? v.slice() : v;
}

export function isAnimated(p) {
  return !!(p && p.keys && p.keys.length);
}

// ---- curvas ----
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) return sy(t);
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

const curves = {
  linear: (x) => x,
  easeInOut: cubicBezier(0.33, 0, 0.67, 1),
  easeIn: cubicBezier(0.33, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.67, 1),
  back: cubicBezier(0.34, 1.56, 0.64, 1),
  bounce: (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  },
};

const bezierCache = new Map();
function easeFn(key, next) {
  const e = key.ease || 'linear';
  if (e === 'curve' && Array.isArray(key.curve)) {
    // gráfico personalizado (como no Alight Motion): curva cúbica com 2 alças; y pode passar de 0..1 (overshoot)
    const [x1, y1, x2, y2] = key.curve;
    const id = `c:${key.curve.map((v) => (+v).toFixed(4)).join(',')}`;
    if (!bezierCache.has(id)) bezierCache.set(id, cubicBezier(clamp01(x1), y1, clamp01(x2), y2));
    return bezierCache.get(id);
  }
  if (e === 'bezier') {
    // influências estilo AE (0..1). Velocidade 0 => tangente horizontal.
    const o = clamp01(key.outInf ?? 0.333);
    const i = clamp01(next?.inInf ?? 0.333);
    // bz: altura das alças vinda das velocidades do AE (pode passar de 0..1 = overshoot)
    const y1 = Array.isArray(key.bz) ? key.bz[0] : 0, y2 = Array.isArray(key.bz) ? key.bz[1] : 1;
    const id = `${o.toFixed(3)}:${i.toFixed(3)}:${y1.toFixed(4)}:${y2.toFixed(4)}`;
    if (!bezierCache.has(id)) bezierCache.set(id, cubicBezier(o, y1, 1 - i, y2));
    return bezierCache.get(id);
  }
  return curves[e] || curves.linear;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function lerp(a, b, f) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * f;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((av, i) => lerp(av, b[i] ?? av, f));
  return f < 1 ? a : b; // booleanos, strings, selects
}

export function valueAt(p, t) {
  if (!p || typeof p !== 'object' || !('value' in p)) return p;
  const keys = p.keys;
  if (!keys || !keys.length) return p.value;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      if (a.ease === 'hold') return a.v;
      const span = b.t - a.t || 1e-9;
      const f = easeFn(a, b)((t - a.t) / span);
      return lerp(a.v, b.v, f);
    }
  }
  return last.v;
}

const EPS = 1e-4;

export function keyIndexAt(p, t) {
  if (!p?.keys) return -1;
  return p.keys.findIndex((k) => Math.abs(k.t - t) < EPS);
}

export function setKey(p, t, v, ease) {
  const i = keyIndexAt(p, t);
  if (i >= 0) {
    p.keys[i].v = clone(v);
    if (ease) p.keys[i].ease = ease;
  } else {
    p.keys.push({ t, v: clone(v), ease: ease || 'linear' });
    sortKeys(p);
  }
}

export function sortKeys(p) {
  p.keys.sort((a, b) => a.t - b.t);
}

export function removeKeyAt(p, t) {
  const i = keyIndexAt(p, t);
  if (i >= 0) p.keys.splice(i, 1);
  if (!p.keys.length) p.value = clone(valueAt({ value: p.value, keys: [] }, t));
}

/** Edita valor no tempo t respeitando o modo de animação (como no AE). */
export function setValue(p, t, v) {
  if (isAnimated(p)) setKey(p, t, v);
  else p.value = clone(v);
}

/** Liga/desliga o cronômetro (stopwatch). */
export function toggleStopwatch(p, t) {
  if (isAnimated(p)) {
    p.value = clone(valueAt(p, t));
    p.keys = [];
  } else {
    p.keys = [{ t, v: clone(p.value), ease: 'linear' }];
  }
}

/** Liga/desliga keyframe no tempo t. */
export function toggleKey(p, t) {
  const i = keyIndexAt(p, t);
  if (i >= 0) {
    const v = valueAt(p, t);
    p.keys.splice(i, 1);
    if (!p.keys.length) p.value = clone(v);
  } else {
    setKey(p, t, valueAt(p, t));
  }
}

export function prevKeyTime(p, t) {
  let best = null;
  for (const k of p?.keys || []) if (k.t < t - EPS) best = k.t;
  return best;
}

export function nextKeyTime(p, t) {
  for (const k of p?.keys || []) if (k.t > t + EPS) return k.t;
  return null;
}

/** Curva (x1,y1,x2,y2) equivalente ao easing atual do keyframe — ponto de partida do editor de gráfico. */
export function curveOf(key, next) {
  if (!key) return [0, 0, 1, 1];
  switch (key.ease) {
    case 'curve': return key.curve?.slice() || [0, 0, 1, 1];
    case 'easeInOut': return [0.33, 0, 0.67, 1];
    case 'easeIn': return [0.33, 0, 1, 1];
    case 'easeOut': return [0, 0, 0.67, 1];
    case 'back': return [0.34, 1.56, 0.64, 1];
    case 'bezier': return [clamp01(key.outInf ?? 0.333), Array.isArray(key.bz) ? key.bz[0] : 0, 1 - clamp01(next?.inInf ?? 0.333), Array.isArray(key.bz) ? key.bz[1] : 1];
    default: return [0, 0, 1, 1];
  }
}

/** Avalia a curva (para desenhar o gráfico): x 0..1 → y. */
export function evalCurve(c, x) {
  return cubicBezier(clamp01(c[0]), c[1], clamp01(c[2]), c[3])(x);
}
