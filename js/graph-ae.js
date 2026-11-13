// Graph Editor como o do After Effects: mostra TODOS os keyframes da propriedade ao longo do tempo.
//  • Velocidade (Speed Graph): curva da velocidade (unidades/s). Cada keyframe tem alça de entrada e de saída:
//    a distância horizontal é a Influência (%) e a altura é a Velocidade — igual ao AE.
//  • Valor (Value Graph): curva do valor; as alças são os pontos de controle da Bézier (propriedades de 1 dimensão).
// Alças unidas (Continuous Bezier) mantêm a mesma velocidade dos dois lados; "Separar alças" deixa mexer cada lado.
// Modelo: o trecho a→b usa ease 'bezier' com a.outInf, b.inInf e a.bz = [y1, y2] (alças normalizadas, como o AE importado).
import { curveOf, rawValueAt } from './anim.js';
import { resolveProp } from './state.js';

const MODE_KEY = 'motionframe.graphMode';
let mode = (() => { try { return localStorage.getItem(MODE_KEY) || 'speed'; } catch { return 'speed'; } })();
export const graphMode = () => mode;
export function setGraphMode(m) { mode = m; try { localStorage.setItem(MODE_KEY, m); } catch { /* sem espaço */ } }

const W = 340, H = 210, L = 40, R = 10, T = 12, B = 20;
const sel = { propRef: null, idx: 0 };

const isNum = (v) => typeof v === 'number' || (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number'));
const dims = (v) => (Array.isArray(v) ? v.length : 1);
function delta(a, b) { // variação de a até b (com sinal em 1D, módulo em 2D/3D)
  if (typeof a.v === 'number') return b.v - a.v;
  return Math.hypot(...a.v.map((x, i) => (b.v[i] ?? x) - x));
}

/** Alças normalizadas do trecho a→b (converte Easy Ease, Linear, curvas… para Bézier do AE). */
export function segOf(a, b) {
  if (a.ease === 'bezier' && !Array.isArray(a.bzv)) return { o: a.outInf ?? 1 / 3, i: b.inInf ?? 1 / 3, y1: a.bz?.[0] ?? 0, y2: a.bz?.[1] ?? 1 };
  const c = curveOf(a, b);
  if ((a.ease || 'linear') === 'linear' || (c[0] === 0 && c[1] === 0 && c[2] === 1 && c[3] === 1)) return { o: 1 / 3, i: 1 / 3, y1: 1 / 3, y2: 2 / 3 };
  return { o: Math.max(0.01, c[0]), i: Math.max(0.01, 1 - c[2]), y1: c[1], y2: c[3] };
}
export function setSeg(a, b, s) {
  a.ease = 'bezier'; delete a.bzv; delete a.curve;
  a.outInf = +Math.max(0.001, Math.min(1, s.o)).toFixed(5); b.inInf = +Math.max(0.001, Math.min(1, s.i)).toFixed(5);
  a.bz = [+s.y1.toFixed(5), +s.y2.toFixed(5)];
}
/** Velocidades (unidades/s) de saída de a e de entrada em b no trecho a→b. */
export function segSpeeds(a, b) {
  const s = segOf(a, b), dt = Math.max(1e-6, b.t - a.t), dv = delta(a, b);
  return { out: (s.y1 / s.o) * (dv / dt), in: ((1 - s.y2) / s.i) * (dv / dt), s, dt, dv };
}
/** Define velocidade/influência de um lado do trecho (como o diálogo Keyframe Velocity do AE). */
export function setSide(a, b, side, speed, inf) {
  const { s, dt, dv } = segSpeeds(a, b);
  if (Math.abs(dv) < 1e-9) { if (inf != null) { if (side === 'out') s.o = inf; else s.i = inf; } setSeg(a, b, s); return; }
  if (side === 'out') { if (inf != null) s.o = inf; if (speed != null) s.y1 = (speed * s.o * dt) / dv; }
  else { if (inf != null) s.i = inf; if (speed != null) s.y2 = 1 - (speed * s.i * dt) / dv; }
  setSeg(a, b, s);
}

function target(store) {
  const s = store.selectedKeys[0];
  if (!s) return null;
  const all = [...(store.layers || []), ...(store.project.layers || [])];
  const find = (ls) => { for (const l of ls) { if (l.id === s.layerId) return l; const k = l.props?.layers && find(l.props.layers); if (k) return k; } return null; };
  const layer = find(all);
  const prop = layer ? resolveProp(layer, s.path) : null;
  if (!prop || !prop.keys?.length || !isNum(prop.keys[0].v)) return null;
  if (sel.propRef !== prop) { sel.propRef = prop; sel.idx = Math.max(0, prop.keys.indexOf(s.key)); }
  sel.idx = Math.min(sel.idx, prop.keys.length - 1);
  return { layer, prop, path: s.path };
}

function valAt(prop, t) { return rawValueAt(prop, t); }
function speedAt(prop, t, oneD) {
  const h = 1 / 600, a = valAt(prop, t - h), b = valAt(prop, t + h);
  if (typeof a === 'number') return (b - a) / (2 * h);
  const m = Math.hypot(...a.map((x, i) => b[i] - x)) / (2 * h);
  return oneD ? m : m;
}

/** Geometria do gráfico (faixas de tempo e de valor/velocidade). */
function layout(prop, m) {
  const ks = prop.keys, t0 = ks[0].t, t1 = ks[ks.length - 1].t, span = Math.max(0.2, t1 - t0);
  const ta = t0 - span * 0.06, tb = t1 + span * 0.06;
  const one = typeof ks[0].v === 'number', N = 160;
  const series = [];
  if (m === 'speed') {
    const pts = [];
    for (let i = 0; i <= N; i++) { const t = ta + ((tb - ta) * i) / N; pts.push([t, speedAt(prop, Math.min(t1 - 1e-4, Math.max(t0 + 1e-4, t)), one)]); }
    series.push({ pts, cls: 'g-curve' });
  } else {
    for (let d = 0; d < dims(ks[0].v); d++) {
      const pts = [];
      for (let i = 0; i <= N; i++) { const t = ta + ((tb - ta) * i) / N, v = valAt(prop, t); pts.push([t, one ? v : v[d]]); }
      series.push({ pts, cls: one ? 'g-curve' : `g-curve g-d${d}` });
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const [, y] of s.pts) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  // alças entram na escala
  for (const h of handles(prop, m)) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); }
  if (m === 'speed' && !one) lo = Math.min(lo, 0);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const X = (t) => L + ((t - ta) / (tb - ta)) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const iX = (x) => ta + ((x - L) / (W - L - R)) * (tb - ta), iY = (y) => lo + (1 - (y - T) / (H - T - B)) * (hi - lo);
  return { series, X, Y, iX, iY, lo, hi, ta, tb, one };
}

/** Alças de todos os keyframes (no espaço tempo × velocidade ou tempo × valor). */
function handles(prop, m) {
  const ks = prop.keys, out = [], one = typeof ks[0].v === 'number';
  for (let k = 0; k < ks.length - 1; k++) {
    const a = ks[k], b = ks[k + 1];
    if (a.ease === 'hold') continue;
    const sp = segSpeeds(a, b);
    if (m === 'speed') {
      out.push({ k, side: 'out', x0: a.t, y0: sp.out, t: a.t + sp.s.o * sp.dt, y: sp.out });
      out.push({ k: k + 1, side: 'in', x0: b.t, y0: sp.in, t: b.t - sp.s.i * sp.dt, y: sp.in });
    } else if (one) {
      out.push({ k, side: 'out', x0: a.t, y0: a.v, t: a.t + sp.s.o * sp.dt, y: a.v + sp.s.y1 * sp.dv });
      out.push({ k: k + 1, side: 'in', x0: b.t, y0: b.v, t: b.t - sp.s.i * sp.dt, y: a.v + sp.s.y2 * sp.dv });
    }
  }
  return out;
}

function fmt(v) { const a = Math.abs(v); return a >= 1000 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); }

function svgInner(prop, m) {
  const g = layout(prop, m), ks = prop.keys;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = g.lo + (g.hi - g.lo) * f, y = g.Y(v); return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" class="g-grid"/><text x="${L - 4}" y="${y + 3}" class="g-lbl" text-anchor="end">${fmt(v)}</text>`; }).join('');
  const zero = m === 'speed' && g.lo < 0 && g.hi > 0 ? `<line x1="${L}" y1="${g.Y(0)}" x2="${W - R}" y2="${g.Y(0)}" class="g-zero"/>` : '';
  const curves = g.series.map((s) => `<path class="${s.cls}" d="${s.pts.map(([t, v], i) => `${i ? 'L' : 'M'}${g.X(t).toFixed(1)} ${g.Y(v).toFixed(1)}`).join('')}"/>`).join('');
  const hs = handles(prop, m).filter((h) => h.k === sel.idx || (m === 'value' && false));
  const arms = hs.map((h) => `<line x1="${g.X(h.x0)}" y1="${g.Y(h.y0)}" x2="${g.X(h.t)}" y2="${g.Y(h.y)}" class="g-arm2"/><circle cx="${g.X(h.t)}" cy="${g.Y(h.y)}" r="7" class="g-handle2" data-hk="${h.k}" data-hs="${h.side}"/>`).join('');
  const dots = ks.map((k, i) => {
    let y;
    if (m === 'speed') { const hh = handles(prop, m).find((h) => h.k === i); y = hh ? hh.y0 : 0; }
    else y = typeof k.v === 'number' ? k.v : k.v[0];
    return `<rect x="${g.X(k.t) - 5}" y="${g.Y(y) - 5}" width="10" height="10" transform="rotate(45 ${g.X(k.t)} ${g.Y(y)})" class="g-key ${i === sel.idx ? 'on' : ''}" data-key="${i}"/>`;
  }).join('');
  return `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" class="g-box"/>${grid}${zero}${curves}${arms}${dots}
    <text x="${L}" y="${H - 5}" class="g-lbl">${g.ta.toFixed(2)}s</text><text x="${W - R}" y="${H - 5}" class="g-lbl" text-anchor="end">${g.tb.toFixed(2)}s</text>
    <text x="${W - R - 2}" y="${T + 10}" class="g-lbl" text-anchor="end">${m === 'speed' ? 'velocidade /s' : 'valor'}</text>`;
}

function keyPanel(prop) {
  const ks = prop.keys, i = sel.idx, k = ks[i];
  const inS = i > 0 && ks[i - 1].ease !== 'hold' ? segSpeeds(ks[i - 1], k) : null, outS = i < ks.length - 1 && k.ease !== 'hold' ? segSpeeds(k, ks[i + 1]) : null;
  const f = (v) => (v == null ? '' : (+v).toFixed(2));
  return `<div class="g-vel">
    <div><b>Entrada</b><label>Velocidade <input type="number" step="any" data-vel="in-speed" value="${f(inS?.in)}" ${inS ? '' : 'disabled'}></label><label>Influência % <input type="number" step="any" min="0.1" max="100" data-vel="in-inf" value="${inS ? f(inS.s.i * 100) : ''}" ${inS ? '' : 'disabled'}></label></div>
    <div><b>Saída</b><label>Velocidade <input type="number" step="any" data-vel="out-speed" value="${f(outS?.out)}" ${outS ? '' : 'disabled'}></label><label>Influência % <input type="number" step="any" min="0.1" max="100" data-vel="out-inf" value="${outS ? f(outS.s.o * 100) : ''}" ${outS ? '' : 'disabled'}></label></div>
  </div>`;
}

export function aeGraphHtml(store, m) {
  const tg = target(store);
  if (!tg) return '<div class="graph-empty">📈 <b>Graph Editor</b>: toque num keyframe ◆ de uma propriedade numérica (posição, escala, rotação, opacidade, parâmetro de efeito…) para ver todos os keyframes dela.</div>';
  const { prop } = tg;
  const one = typeof prop.keys[0].v === 'number';
  return `<div class="graph ae">
    <div class="graph-head"><b>📈 ${m === 'speed' ? 'Gráfico de velocidade' : 'Gráfico de valor'}</b><span class="muted small">${prop.keys.length} keyframes · ◆ ${sel.idx + 1}</span></div>
    <svg class="graph-svg" viewBox="0 0 ${W} ${H}" data-aegraph>${svgInner(prop, m)}</svg>
    ${m === 'value' && !one ? '<div class="muted small" style="margin:4px 0">Propriedade com várias dimensões: as alças ficam no gráfico de velocidade (como no AE).</div>' : ''}
    ${keyPanel(prop)}
    <div class="kt-row g-acts">
      <button data-gk="easy" title="F9">Easy Ease</button><button data-gk="in">Easy Ease In</button><button data-gk="out">Easy Ease Out</button>
      <button data-gk="linear">Linear</button><button data-gk="all" title="aplica Easy Ease em todos os keyframes da propriedade">Easy Ease em todos</button>
      <button data-gk="split" class="${prop.keys[sel.idx]?.split ? 'on' : ''}">${prop.keys[sel.idx]?.split ? 'Alças separadas' : 'Alças unidas'}</button>
    </div>
  </div>`;
}

export function bindAeGraph(root, store, m) {
  const svg = root.querySelector('[data-aegraph]');
  const tg = target(store);
  if (!svg || !tg) return () => {};
  const { prop } = tg, ks = prop.keys;
  const redraw = (final) => {
    svg.innerHTML = svgInner(prop, m);
    if (final) store.commit(); else store.emit('preview');
  };
  const pt = (e) => { const r = svg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  // muda um lado; com alças unidas o outro lado do mesmo keyframe recebe a mesma velocidade (Continuous Bezier)
  const setKeySide = (k, side, speed, inf) => {
    const key = ks[k];
    if (side === 'out' && k < ks.length - 1) setSide(key, ks[k + 1], 'out', speed, inf);
    if (side === 'in' && k > 0) setSide(ks[k - 1], key, 'in', speed, inf);
    if (!key.split && speed != null) {
      if (side === 'out' && k > 0 && ks[k - 1].ease !== 'hold') setSide(ks[k - 1], key, 'in', speed, null);
      if (side === 'in' && k < ks.length - 1 && key.ease !== 'hold') setSide(key, ks[k + 1], 'out', speed, null);
    }
  };
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-hk]'), d = e.target.closest('[data-key]');
    if (h) drag = { k: +h.dataset.hk, side: h.dataset.hs };
    else if (d) {
      sel.idx = +d.dataset.key;
      if (m === 'value' && typeof ks[sel.idx].v === 'number') drag = { k: sel.idx, side: 'key' };
      else { store.emit('keys'); return; }
    } else return;
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const g = layout(prop, m), [x, y] = pt(e), t = g.iX(x), v = g.iY(y), key = ks[drag.k];
    if (drag.side === 'key') { key.v = v; redraw(false); return; }
    const nb = drag.side === 'out' ? ks[drag.k + 1] : ks[drag.k - 1];
    const dt = Math.abs(nb.t - key.t) || 1e-6;
    const inf = Math.max(0.001, Math.min(1, Math.abs(t - key.t) / dt));
    if (m === 'speed') setKeySide(drag.k, drag.side, typeof key.v === 'number' ? v : Math.max(0, v), inf);
    else {
      // gráfico de valor: alça = ponto de controle; velocidade = inclinação da alça
      const slope = (v - key.v) / Math.max(1e-6, inf * dt) * (drag.side === 'out' ? 1 : -1);
      setKeySide(drag.k, drag.side, slope, inf);
    }
    redraw(false);
  });
  const end = () => { if (drag) { drag = null; redraw(true); } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  // campos do Keyframe Velocity
  root.querySelectorAll('[data-vel]').forEach((inp) => inp.addEventListener('change', () => {
    const [side, what] = inp.dataset.vel.split('-'), val = parseFloat(inp.value);
    if (!Number.isFinite(val)) return;
    if (what === 'speed') setKeySide(sel.idx, side, val, null);
    else setKeySide(sel.idx, side, null, Math.max(0.001, Math.min(1, val / 100)));
    store.commit();
  }));
  const ease = (k, inS, outS) => {
    if (inS && k > 0 && ks[k - 1].ease !== 'hold') setSide(ks[k - 1], ks[k], 'in', 0, 1 / 3);
    if (outS && k < ks.length - 1) { if (ks[k].ease === 'hold') ks[k].ease = 'bezier'; setSide(ks[k], ks[k + 1], 'out', 0, 1 / 3); }
  };
  root.querySelector('[data-gk="easy"]')?.addEventListener('click', () => { ease(sel.idx, true, true); store.commit(); });
  root.querySelector('[data-gk="in"]')?.addEventListener('click', () => { ease(sel.idx, true, false); store.commit(); });
  root.querySelector('[data-gk="out"]')?.addEventListener('click', () => { ease(sel.idx, false, true); store.commit(); });
  root.querySelector('[data-gk="all"]')?.addEventListener('click', () => { for (let k = 0; k < ks.length; k++) ease(k, true, true); store.commit(); });
  root.querySelector('[data-gk="linear"]')?.addEventListener('click', () => {
    const k = sel.idx;
    // linear: velocidade constante do trecho, influência 33%
    if (k > 0) { const a = ks[k - 1]; a.ease = 'linear'; delete a.bz; }
    if (k < ks.length - 1) { ks[k].ease = 'linear'; delete ks[k].bz; }
    store.commit();
  });
  root.querySelector('[data-gk="split"]')?.addEventListener('click', () => { const key = ks[sel.idx]; key.split = !key.split; store.commit(); });
  return () => {};
}
