// Editor de gráfico de keyframes (como o "Gráfico" do Alight Motion): curva de velocidade com 2 alças,
// predefinições, copiar e colar o gráfico entre keyframes. A curva vale do keyframe selecionado até o próximo.
import { curveOf, evalCurve, valueAt, rawValueAt } from './anim.js';
import { aeGraphHtml, bindAeGraph, graphMode, setGraphMode } from './graph-ae.js';
import { resolveProp } from './state.js';

export const CURVE_PRESETS = [
  ['Linear', [0, 0, 1, 1]], ['Suave', [0.33, 0, 0.67, 1]], ['Entrada', [0.42, 0, 1, 1]], ['Saída', [0, 0, 0.58, 1]],
  ['Forte', [0.7, 0, 0.3, 1]], ['Velocity', [0.9, 0, 0.1, 1]], ['Rápido→lento', [0.05, 0.7, 0.1, 1]], ['Lento→rápido', [0.7, 0, 0.95, 0.3]],
  ['Passar (back)', [0.34, 1.56, 0.64, 1]], ['Antecipar', [0.36, -0.55, 0.6, 1]], ['Elástico', [0.5, 1.8, 0.5, 0.75]], ['Degrau suave', [0.95, 0.05, 0.05, 0.95]],
];

const CLIP_KEY = 'motionframe.curveClipboard';
export function curveClipboard() { try { return JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch { return null; } }
function setCurveClipboard(c) { try { localStorage.setItem(CLIP_KEY, JSON.stringify(c)); } catch { /* sem espaço */ } }

const W = 280, H = 220, PAD_X = 14; // área vertical: valor de -0,5 (baixo) a 1,5 (cima) — permite overshoot
const toPx = (x, y) => [PAD_X + x * (W - 2 * PAD_X), H - ((y + 0.5) / 2) * H];
const fromPx = (px, py) => [(px - PAD_X) / (W - 2 * PAD_X), ((H - py) / H) * 2 - 0.5];

function svgPath(c, steps = 48) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const x = i / steps, [px, py] = toPx(x, evalCurve(c, x));
    d += `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  return d;
}
export function miniCurve(c) {
  const p = (x, y) => `${(2 + x * 36).toFixed(1)} ${(22 - y * 18).toFixed(1)}`;
  let d = '';
  for (let i = 0; i <= 20; i++) { const x = i / 20; d += `${i ? 'L' : 'M'}${p(x, evalCurve(c, x))}`; }
  return `<svg viewBox="0 -4 40 30"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

/** Keyframes selecionados que têm um próximo keyframe (onde a curva atua). */
function editable(store) {
  const out = [];
  for (const s of store.selectedKeys) {
    const layer = store.project.layers.find((l) => l.id === s.layerId) || null;
    const prop = layer ? resolveProp(layer, s.path) : null;
    if (!prop) continue;
    const i = prop.keys.indexOf(s.key);
    if (i >= 0 && i < prop.keys.length - 1) out.push({ ...s, prop, next: prop.keys[i + 1] });
  }
  return out;
}

function curveHtml(store) {
  const list = editable(store);
  if (!list.length) {
    return `<div class="graph-empty">📈 <b>Gráfico</b>: toque num keyframe ◆ na timeline (que tenha outro depois dele) para editar a curva de velocidade entre os dois.</div>`;
  }
  const c = curveOf(list[0].key, list[0].next);
  const clip = curveClipboard();
  const [ax, ay] = toPx(0, 0), [bx, by] = toPx(1, 1), [h1x, h1y] = toPx(c[0], c[1]), [h2x, h2y] = toPx(c[2], c[3]);
  return `<div class="graph">
    <div class="graph-head"><b>📈 Gráfico</b><span class="muted small">${list.length} keyframe(s) · arraste as alças</span></div>
    <svg class="graph-svg" viewBox="0 0 ${W} ${H}" data-graph>
      <rect x="${PAD_X}" y="${toPx(0, 1)[1]}" width="${W - 2 * PAD_X}" height="${ay - toPx(0, 1)[1]}" class="g-box"/>
      ${[0.25, 0.5, 0.75].map((g) => `<line x1="${toPx(g, 0)[0]}" y1="${toPx(0, 1.5)[1]}" x2="${toPx(g, 0)[0]}" y2="${toPx(0, -0.5)[1]}" class="g-grid"/>`).join('')}
      <path d="${svgPath(c)}" class="g-curve" data-curve/>
      <line x1="${ax}" y1="${ay}" x2="${h1x}" y2="${h1y}" class="g-arm" data-arm="1"/>
      <line x1="${bx}" y1="${by}" x2="${h2x}" y2="${h2y}" class="g-arm" data-arm="2"/>
      <circle cx="${ax}" cy="${ay}" r="5" class="g-end"/><circle cx="${bx}" cy="${by}" r="5" class="g-end"/>
      <circle cx="${h1x}" cy="${h1y}" r="11" class="g-handle" data-h="1"/>
      <circle cx="${h2x}" cy="${h2y}" r="11" class="g-handle" data-h="2"/>
      <circle r="4" class="g-ball" data-ball cx="${ax}" cy="${ay}"/>
    </svg>
    <div class="graph-vals" data-vals>${c.map((v) => v.toFixed(2)).join(' · ')}</div>
    <div class="graph-presets">${CURVE_PRESETS.map(([n, pc], i) => `<button data-gp="${i}" title="${n}">${miniCurve(pc)}<span>${n}</span></button>`).join('')}</div>
    <div class="kt-row">
      <button data-gact="copy">⎘ Copiar gráfico</button>
      <button data-gact="paste" ${clip ? '' : 'disabled'}>📋 Colar gráfico</button>
      <button data-gact="mirror">⇋ Espelhar</button>
    </div>
  </div>`;
}

/** Liga os controles do gráfico. onChange(final) é chamado ao mexer (final=true ao soltar). */
function bindCurve(root, store, { toast } = {}) {
  const svg = root.querySelector('[data-graph]');
  const list = editable(store);
  if (!svg || !list.length) return;
  let c = curveOf(list[0].key, list[0].next);
  const apply = (final) => {
    for (const s of list) { s.key.ease = 'curve'; s.key.curve = c.map((v) => +v.toFixed(4)); }
    // redesenha só o SVG (sem recriar o painel)
    const [ax, ay] = toPx(0, 0), [bx, by] = toPx(1, 1), [h1x, h1y] = toPx(c[0], c[1]), [h2x, h2y] = toPx(c[2], c[3]);
    svg.querySelector('[data-curve]').setAttribute('d', svgPath(c));
    const a1 = svg.querySelector('[data-arm="1"]'), a2 = svg.querySelector('[data-arm="2"]');
    a1.setAttribute('x1', ax); a1.setAttribute('y1', ay); a1.setAttribute('x2', h1x); a1.setAttribute('y2', h1y);
    a2.setAttribute('x1', bx); a2.setAttribute('y1', by); a2.setAttribute('x2', h2x); a2.setAttribute('y2', h2y);
    const h1 = svg.querySelector('[data-h="1"]'), h2 = svg.querySelector('[data-h="2"]');
    h1.setAttribute('cx', h1x); h1.setAttribute('cy', h1y); h2.setAttribute('cx', h2x); h2.setAttribute('cy', h2y);
    root.querySelector('[data-vals]').textContent = c.map((v) => v.toFixed(2)).join(' · ');
    if (final) store.commit(); else store.emit('preview');
  };
  // bolinha que mostra o movimento com a curva (como a prévia do Alight Motion)
  const ball = svg.querySelector('[data-ball]');
  let raf = 0;
  const t0 = performance.now();
  const tick = (now) => {
    if (!ball.isConnected) return;
    const x = ((now - t0) / 1200) % 1.3;
    const xx = Math.min(1, x);
    const [px, py] = toPx(xx, evalCurve(c, xx));
    ball.setAttribute('cx', px); ball.setAttribute('cy', py);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  let drag = 0;
  const pt = (e) => {
    const r = svg.getBoundingClientRect();
    return fromPx(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  };
  svg.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-h]');
    if (!h) {
      // toque fora: pega a alça mais próxima
      const [x, y] = pt(e);
      drag = Math.hypot(x - c[0], y - c[1]) < Math.hypot(x - c[2], y - c[3]) ? 1 : 2;
    } else drag = +h.dataset.h;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    let [x, y] = pt(e);
    x = Math.max(0, Math.min(1, x)); y = Math.max(-0.5, Math.min(1.5, y));
    if (drag === 1) { c[0] = x; c[1] = y; } else { c[2] = x; c[3] = y; }
    apply(false);
  });
  const end = () => { if (drag) { drag = 0; apply(true); } };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  root.querySelectorAll('[data-gp]').forEach((b) => b.addEventListener('click', () => { c = CURVE_PRESETS[+b.dataset.gp][1].slice(); apply(true); }));
  root.querySelector('[data-gact="copy"]')?.addEventListener('click', () => { setCurveClipboard(c); toast?.('Gráfico copiado. Selecione outros keyframes e toque em Colar gráfico.', 'ok'); store.emit('keys'); });
  root.querySelector('[data-gact="paste"]')?.addEventListener('click', () => { const k = curveClipboard(); if (k) { c = k.slice(); apply(true); } });
  root.querySelector('[data-gact="mirror"]')?.addEventListener('click', () => { c = [1 - c[2], 1 - c[3], 1 - c[0], 1 - c[1]]; apply(true); });
  return () => cancelAnimationFrame(raf);
}

/** Valor atual de exemplo (para mostrar de-para no cabeçalho, se necessário). */
export function sampleValue(prop, t) { return valueAt(prop, t); }

/** Painel do gráfico: abas Velocidade / Valor (Graph Editor do After Effects) e Curva (estilo Alight Motion). */
export function graphHtml(store) {
  const m = graphMode();
  const tabs = `<div class="graph-tabs">${[['speed', 'Velocidade'], ['value', 'Valor'], ['curve', 'Curva']].map(([k, l]) => `<button data-gmode="${k}" class="${m === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `<div class="graph-wrap">${tabs}${m === 'curve' ? curveHtml(store) : aeGraphHtml(store, m)}</div>`;
}

export function bindGraph(root, store, opts = {}) {
  root.querySelectorAll('[data-gmode]').forEach((b) => b.addEventListener('click', () => { setGraphMode(b.dataset.gmode); store.emit('keys'); }));
  return graphMode() === 'curve' ? bindCurve(root, store, opts) : bindAeGraph(root, store, graphMode(), opts);
}
