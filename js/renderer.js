// Composição dos quadros: conteúdo das camadas (Canvas 2D) → efeitos (WebGL) → transformações,
// motion blur, echo e camadas de ajuste.
import { valueAt, exprContext } from './anim.js';
import { drawAnimatedText, animatorPad } from './textanim.js';
import { EFFECT_MAP, makeCanvas } from './effects.js';
import { getGL } from './gl.js';
import { getImage, videoFrames } from './media.js';
import { computeFlow, interpWithFlow, interpBidirectional, flowMotionBlur } from './flow.js';
import { layerTime, vectorBlur, sourceRate, groupContentTime, groupHasTimeFx, speedEffect, remapEffect } from './timing.js';
import { localMatrix, cameraFor, apply as apply3, mul as mul4, invert as inv4, dofBlur } from './three-d.js';

const contentCanvases = new Map();
let accumCanvas = null;
let snapshotCanvas = null;
let project = null; // projeto em renderização (para tamanho de camadas de ajuste)
const groupCache = new Map(); // conteúdo de pré-comps já desenhado (só na exportação)
const GROUP_CACHE_MAX = 8, GROUP_CACHE_BYTES = (typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent)) ? 36e6 : 160e6;
/** Limpa caches da exportação (chamar no início e no fim de cada exportação). */
export function resetRenderCaches() { for (const c of groupCache.values()) { c.width = 0; c.height = 0; } groupCache.clear(); }
let renderOpts = { final: false }; // final=true na exportação (quadros em resolução total)

// Memória: as telas de cada camada ficam guardadas para o próximo quadro, mas só até um limite. As que não
// foram usadas no quadro atual são liberadas quando o total passa disso (antes ficavam para sempre: projetos
// com dezenas de camadas 4K passavam de 2 GB e o navegador travava no PC e no celular).
const IOS_R = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
const CANVAS_BUDGET = IOS_R ? 120e6 : 400e6;
let frameNo = 0;
function trimCanvases() {
  let total = 0;
  for (const c of contentCanvases.values()) total += c.width * c.height * 4;
  if (total <= CANVAS_BUDGET) return;
  const old = [...contentCanvases.entries()].filter(([, c]) => c._used !== frameNo).sort((a, b) => (a[1]._used || 0) - (b[1]._used || 0));
  for (const [id, c] of old) {
    if (total <= CANVAS_BUDGET * 0.7) break;
    total -= c.width * c.height * 4;
    c.width = 0; c.height = 0; // devolve a memória na hora
    contentCanvases.delete(id);
  }
}

function poolCanvas(id, w, h) {
  let c = contentCanvases.get(id);
  if (!c) { c = makeCanvas(w, h); contentCanvases.set(id, c); }
  c._used = frameNo;
  if (c.width !== Math.ceil(w) || c.height !== Math.ceil(h)) { c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); }
  return c;
}

const textCtx = () => {
  if (!textCtx.c) textCtx.c = makeCanvas(4, 4).getContext('2d');
  return textCtx.c;
};
const fontOf = (p) => `${p.italic ? 'italic ' : ''}${p.fontWeight || 400} ${p.fontSize}px ${p.fontFamily}`;

export function contentSize(layer, proj = project) {
  const p = layer.props;
  if (layer.type === 'adjustment' || layer.type === 'group' || layer.type === 'camera') return { w: proj?.width || 1080, h: proj?.height || 1920 };
  if (layer.type === 'text') {
    const ctx = textCtx();
    ctx.font = fontOf(p);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${p.letterSpacing || 0}px`;
    const lines = String(p.text).split('\n');
    const w = Math.max(1, ...lines.map((s) => ctx.measureText(s).width)) + (p.strokeWidth || 0) * 2 + 8;
    const h = lines.length * p.fontSize * p.lineHeight + (p.strokeWidth || 0) * 2 + 8;
    return { w, h };
  }
  return { w: p.width || 100, h: p.height || 100 };
}

/** Desenha a mídia na caixa da camada; fit 'cover' recorta sem distorcer (mídia substituta de outro tamanho). */
function drawFit(ctx, src, sw, sh, w, h, fit) {
  if (fit !== 'cover' || !sw || !sh) { ctx.drawImage(src, 0, 0, w, h); return; }
  const k = Math.max(w / sw, h / sh), cw = w / k, ch = h / k;
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
}

function drawContent(ctx, layer, w, h, extra) {
  const p = layer.props;
  switch (layer.type) {
    case 'text': {
      if (p.animators?.length) { drawAnimatedText(ctx, p, w, h, extra?.lt ?? 0, fontOf(p)); break; }
      ctx.font = fontOf(p);
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${p.letterSpacing || 0}px`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = p.align;
      const lines = String(p.text).split('\n');
      const lh = p.fontSize * p.lineHeight;
      const x = p.align === 'left' ? 4 + (p.strokeWidth || 0) : p.align === 'right' ? w - 4 - (p.strokeWidth || 0) : w / 2;
      lines.forEach((line, i) => {
        const y = h / 2 + (i - (lines.length - 1) / 2) * lh;
        if (p.strokeWidth > 0) {
          ctx.lineJoin = 'round';
          ctx.strokeStyle = p.strokeColor;
          ctx.lineWidth = p.strokeWidth * 2;
          ctx.strokeText(line, x, y);
        }
        ctx.fillStyle = p.color;
        ctx.fillText(line, x, y);
      });
      break;
    }
    case 'rect':
    case 'solid': {
      ctx.beginPath();
      if (ctx.roundRect && p.radius) ctx.roundRect(0, 0, w, h, Math.min(p.radius, w / 2, h / 2));
      else ctx.rect(0, 0, w, h);
      ctx.fillStyle = p.fill;
      ctx.fill();
      if (p.strokeWidth > 0) { ctx.strokeStyle = p.strokeColor; ctx.lineWidth = p.strokeWidth; ctx.stroke(); }
      break;
    }
    case 'shape': {
      ctx.save();
      ctx.translate(w / 2, h / 2); // origem da camada de formas = centro (como o (0,0) do AE)
      drawShapeItems(ctx, p.shapes || [], extra?.lt ?? 0);
      ctx.restore();
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = p.fill;
      ctx.fill();
      if (p.strokeWidth > 0) { ctx.strokeStyle = p.strokeColor; ctx.lineWidth = p.strokeWidth; ctx.stroke(); }
      break;
    }
    case 'image': {
      const img = getImage(p.src);
      if (img.complete && img.naturalWidth) drawFit(ctx, img, img.naturalWidth, img.naturalHeight, w, h, p.fit);
      break;
    }
    case 'video': {
      const src = extra?.videoSource;
      if (src) drawFit(ctx, src, src.videoWidth || src.width, src.videoHeight || src.height, w, h, p.fit);
      break;
    }
    case 'adjustment':
      if (extra?.snapshot) ctx.drawImage(extra.snapshot, 0, 0, w, h);
      break;
    default:
  }
}

export function evalParams(fx, t) {
  const out = {};
  // efeitos salvos por versões antigas não têm os parâmetros novos: usa o padrão do efeito (nunca undefined/NaN,
  // que deixava a imagem preta — ex.: shake vertical sem "Bordas Y")
  const def = EFFECT_MAP[fx.type];
  if (def) for (const pd of def.params) if (pd.default !== undefined) out[pd.key] = Array.isArray(pd.default) ? pd.default.slice() : pd.default;
  for (const [k, p] of Object.entries(fx.params)) { const v = valueAt(p, t); if (v !== undefined && !(typeof v === 'number' && !Number.isFinite(v))) out[k] = v; }
  return out;
}

/** Transformação da camada (px da comp) incluindo efeitos de movimento (shake, twitch, transform). */
export function layerTransform(layer, t) {
  const lt = layerTime(layer, t);
  const tr = layer.transform;
  const pos = valueAt(tr.position, lt);
  const sc = valueAt(tr.scale, lt);
  const extra = { dx: 0, dy: 0, rot: 0, scale: 1, opacity: 1 };
  for (const fx of layer.effects) {
    if (!fx.enabled) continue;
    const def = EFFECT_MAP[fx.type];
    if (!def?.transform) continue;
    const r = def.transform(evalParams(fx, lt), { t: lt });
    extra.dx += r.dx || 0; extra.dy += r.dy || 0; extra.rot += r.rot || 0;
    extra.scale *= r.scale ?? 1; extra.opacity *= r.opacity ?? 1;
  }
  return {
    x: pos[0] + extra.dx,
    y: pos[1] + extra.dy,
    sx: (sc[0] / 100) * extra.scale,
    sy: (sc[1] / 100) * extra.scale,
    rot: valueAt(tr.rotation, lt) + extra.rot,
    opacity: Math.max(0, Math.min(1, (valueAt(tr.opacity, lt) / 100) * extra.opacity)),
    anchor: aeTextAnchor(layer, valueAt(tr.anchor, lt)),
  };
}

/** Texto vindo do AE: a âncora fica na linha de base (início, meio ou fim conforme o alinhamento), não no centro da caixa. */
function aeTextAnchor(layer, a) {
  if (layer.type !== 'text' || !layer.props.aeBaseline) return a;
  const p = layer.props, { w } = contentSize(layer);
  const lines = String(p.text).split('\n').length, lh = p.fontSize * p.lineHeight;
  const ax = p.align === 'left' ? -(w / 2 - 4) : p.align === 'right' ? w / 2 - 4 : 0;
  return [a[0] + ax, a[1] - ((lines - 1) / 2) * lh + p.fontSize * 0.33];
}

// ---------------------------------------------------------------- formas (Shape Layer do AE)
const V = (a, t, d) => (a == null ? d : valueAt(a, t) ?? d);
function shapePath(it, t) {
  const p = new Path2D();
  if (it.t === 'rect') {
    const [sw, sh] = V(it.size, t, [100, 100]), [x, y] = V(it.position, t, [0, 0]), rr = Math.min(V(it.round, t, 0), sw / 2, sh / 2);
    if (rr > 0 && p.roundRect) p.roundRect(x - sw / 2, y - sh / 2, sw, sh, rr); else p.rect(x - sw / 2, y - sh / 2, sw, sh);
  } else if (it.t === 'ellipse') {
    const [sw, sh] = V(it.size, t, [100, 100]), [x, y] = V(it.position, t, [0, 0]);
    p.ellipse(x, y, Math.abs(sw) / 2, Math.abs(sh) / 2, 0, 0, Math.PI * 2);
  } else if (it.t === 'star') {
    const n = Math.max(3, Math.round(V(it.points, t, 5))), [x, y] = V(it.position, t, [0, 0]), rot = (V(it.rotation, t, 0) * Math.PI) / 180;
    const ro = V(it.outer, t, 100), ri = V(it.inner, t, 50), star = (it.kind || 1) === 1;
    const steps = star ? n * 2 : n;
    for (let i = 0; i < steps; i++) {
      const r = star && i % 2 ? ri : ro, a = -Math.PI / 2 + rot + (i * Math.PI * 2) / steps;
      if (i) p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else p.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    p.closePath();
  } else if (it.t === 'path') {
    const sh = pathAt(it.path, t);
    if (sh) tracePath(p, sh);
  }
  return p;
}
/** Caminho animado: interpola os pontos entre os keyframes (quando têm o mesmo número de pontos). */
export function pathAt(path, t) {
  const S = path?.shapes || [];
  if (!S.length) return null;
  const T = path.times || [];
  if (S.length === 1 || !T.length || t <= T[0]) return S[0];
  if (t >= T[T.length - 1]) return S[Math.min(S.length, T.length) - 1];
  for (let i = 0; i < T.length - 1 && i + 1 < S.length; i++) {
    if (t >= T[i] && t < T[i + 1]) {
      const a = S[i], b = S[i + 1], f = (t - T[i]) / (T[i + 1] - T[i] || 1);
      if (a.pts.length !== b.pts.length) return f < 0.5 ? a : b;
      return { closed: a.closed, pts: a.pts.map((q, k) => [q[0] + (b.pts[k][0] - q[0]) * f, q[1] + (b.pts[k][1] - q[1]) * f]) };
    }
  }
  return S[S.length - 1];
}
export function tracePath(p, sh) {
  const P = sh.pts, n = Math.floor(P.length / 3);
  if (!n) return;
  p.moveTo(P[0][0], P[0][1]);
  for (let i = 0; i < n; i++) {
    const nx = (i + 1) % n;
    if (nx === 0 && !sh.closed) break;
    const o = P[i * 3 + 1], inn = P[i * 3 + 2], v = P[nx * 3];
    p.bezierCurveTo(o[0], o[1], inn[0], inn[1], v[0], v[1]);
  }
  if (sh.closed) p.closePath();
}
// Trim Paths (AE): pontos ao longo do contorno de cada forma (polilinha) para cortar Start/End/Offset
function shapePoly(it, t) {
  const out = [];
  if (it.t === 'rect') {
    const [sw, sh] = V(it.size, t, [100, 100]), [x, y] = V(it.position, t, [0, 0]);
    // como no AE: começa no meio do lado de cima e anda no sentido horário
    out.push([x, y - sh / 2], [x + sw / 2, y - sh / 2], [x + sw / 2, y + sh / 2], [x - sw / 2, y + sh / 2], [x - sw / 2, y - sh / 2], [x, y - sh / 2]);
    return { pts: out, closed: false };
  }
  if (it.t === 'ellipse') {
    const [sw, sh] = V(it.size, t, [100, 100]), [x, y] = V(it.position, t, [0, 0]);
    for (let i = 0; i <= 96; i++) { const a = -Math.PI / 2 + (i / 96) * Math.PI * 2; out.push([x + Math.cos(a) * sw / 2, y + Math.sin(a) * sh / 2]); }
    return { pts: out, closed: false };
  }
  if (it.t === 'star') {
    const n = Math.max(3, Math.round(V(it.points, t, 5))), [x, y] = V(it.position, t, [0, 0]), rot = (V(it.rotation, t, 0) * Math.PI) / 180;
    const ro = V(it.outer, t, 100), ri = V(it.inner, t, 50), star = (it.kind || 1) === 1, steps = star ? n * 2 : n;
    for (let i = 0; i <= steps; i++) { const r = star && i % 2 ? ri : ro, a = -Math.PI / 2 + rot + (i * Math.PI * 2) / steps; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    return { pts: out, closed: false };
  }
  if (it.t === 'path') {
    const sh = pathAt(it.path, t); if (!sh) return null;
    const P = sh.pts, n = Math.floor(P.length / 3); if (!n) return null;
    out.push(P[0]);
    for (let i = 0; i < n; i++) {
      const nx = (i + 1) % n; if (nx === 0 && !sh.closed) break;
      const a = P[i * 3], o = P[i * 3 + 1], inn = P[i * 3 + 2], b = P[nx * 3];
      for (let k = 1; k <= 24; k++) { const u = k / 24, m = 1 - u; out.push([m * m * m * a[0] + 3 * m * m * u * o[0] + 3 * m * u * u * inn[0] + u * u * u * b[0], m * m * m * a[1] + 3 * m * m * u * o[1] + 3 * m * u * u * inn[1] + u * u * u * b[1]]); }
    }
    return { pts: out, closed: false };
  }
  return null;
}
function trimmedPath(it, t, trim) {
  const poly = shapePoly(it, t);
  const P = new Path2D();
  if (!poly || poly.pts.length < 2) return P;
  const pts = poly.pts, cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1]; if (L <= 0) return P;
  let s = Math.max(0, Math.min(100, V(trim.start, t, 0))) / 100, e = Math.max(0, Math.min(100, V(trim.end, t, 100))) / 100;
  if (s > e) [s, e] = [e, s];
  if (e - s < 1e-4) return P;
  const off = (((V(trim.offset, t, 0) / 360) % 1) + 1) % 1;
  const at = (d) => { if (d > L + 1e-9) d -= L; else if (d < 0) d += L; d = Math.max(0, Math.min(L, d)); let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const f = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; };
  const d0 = (s + off) * L, d1 = (e + off) * L;
  // offset pode empurrar o trecho para além do fim do contorno: desenha em duas partes (sem ligar o fim ao começo)
  const seg = (a0, a1) => { const n = Math.max(2, Math.ceil(((a1 - a0) / L) * pts.length * 1.5)); for (let k = 0; k <= n; k++) { const q = at(a0 + ((a1 - a0) * k) / n); if (k) P.lineTo(q[0], q[1]); else P.moveTo(q[0], q[1]); } };
  if (d1 <= L + 1e-9) seg(d0, d1);
  else if (d0 >= L) seg(d0 - L, d1 - L);
  else { seg(d0, L); seg(0, d1 - L); }
  return P;
}
const css3 = (c, a = 1) => `rgba(${Math.round((c?.[0] ?? 1) * 255)},${Math.round((c?.[1] ?? 1) * 255)},${Math.round((c?.[2] ?? 1) * 255)},${a})`;
function drawShapeItems(ctx, items, t) {
  // Repetidor (Repeater do AE): copia tudo o que está ACIMA dele no grupo, acumulando o deslocamento a cada cópia
  const ri = items.findIndex((x) => x.t === 'repeater');
  if (ri >= 0) {
    const rp = items[ri];
    const n = Math.max(0, Math.min(200, Math.round(V(rp.copies, t, 3)))), off = V(rp.offset, t, 0);
    const [px, py] = V(rp.position, t, [100, 0]), [sx, sy] = V(rp.scale, t, [100, 100]), rot = V(rp.rotation, t, 0), [ax, ay] = V(rp.anchor, t, [0, 0]);
    const o0 = V(rp.startOpacity, t, 100) / 100, o1 = V(rp.endOpacity, t, 100) / 100;
    const above = items.slice(0, ri);
    // como no AE: a cópia de cima é a última (composite "Acima"); desenha da última para a primeira por baixo
    for (let c = n - 1; c >= 0; c--) {
      const k = c + off;
      ctx.save();
      ctx.translate(px * k, py * k);
      ctx.translate(ax, ay); ctx.rotate((rot * k * Math.PI) / 180); ctx.scale(Math.pow(sx / 100, k), Math.pow(sy / 100, k)); ctx.translate(-ax, -ay);
      ctx.globalAlpha *= Math.max(0, Math.min(1, n > 1 ? o0 + (o1 - o0) * (c / (n - 1)) : o0));
      drawShapeItems(ctx, above, t);
      ctx.restore();
    }
    drawShapeItems(ctx, items.slice(ri + 1), t);
    return;
  }
  // como no AE: preenchimento/contorno valem para as formas ACIMA deles no mesmo grupo; a lista é desenhada de baixo para cima
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.t === 'group') {
      const tr = it.tr || {};
      ctx.save();
      const [px, py] = V(tr.position, t, [0, 0]), [ax, ay] = V(tr.anchor, t, [0, 0]), [sx, sy] = V(tr.scale, t, [100, 100]);
      ctx.translate(px, py); ctx.rotate((V(tr.rotation, t, 0) * Math.PI) / 180); ctx.scale(sx / 100, sy / 100); ctx.translate(-ax, -ay);
      ctx.globalAlpha *= Math.max(0, Math.min(1, V(tr.opacity, t, 100) / 100));
      drawShapeItems(ctx, it.items || [], t);
      ctx.restore();
    } else if (it.t === 'fill' || it.t === 'stroke') {
      const above = items.slice(0, k).filter((x) => ['rect', 'ellipse', 'star', 'path'].includes(x.t));
      if (!above.length) continue;
      const path = new Path2D();
      // Trim Paths acima do contorno/preenchimento (no mesmo grupo) cortam cada forma
      const trim = items.slice(0, k).find((x) => x.t === 'trim');
      for (const sItem of above) path.addPath(trim ? trimmedPath(sItem, t, trim) : shapePath(sItem, t));
      const op = Math.max(0, Math.min(1, V(it.opacity, t, 100) / 100));
      if (it.t === 'fill') { ctx.fillStyle = css3(V(it.color, t, [1, 0, 0]), op); ctx.fill(path, it.rule === 2 ? 'evenodd' : 'nonzero'); }
      else {
        ctx.strokeStyle = css3(V(it.color, t, [1, 1, 1]), op); ctx.lineWidth = Math.max(0, V(it.width, t, 2));
        ctx.lineCap = ['butt', 'butt', 'round', 'square'][it.cap || 1] || 'butt'; ctx.lineJoin = ['miter', 'miter', 'round', 'bevel'][it.join || 1] || 'miter';
        if (ctx.lineWidth > 0) ctx.stroke(path);
      }
    }
  }
}

// ---------------------------------------------------------------- máscaras (como as do AE: Add, Subtract, Intersect, inverter, feather)
function applyMasks(cx, layer, t, scale, pad, W, H) {
  const masks = (layer.masks || []).filter((m) => m.mode !== 0 && m.path);
  if (!masks.length) return;
  const mc = poolCanvas(`${layer.id}__mask`, W, H), m = mc.getContext('2d');
  m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.filter = 'none'; m.clearRect(0, 0, W, H);
  if (masks[0].mode === 2 || masks[0].mode === 3) { m.fillStyle = '#fff'; m.fillRect(0, 0, W, H); }
  const tmp = poolCanvas(`${layer.id}__mask2`, W, H), q = tmp.getContext('2d');
  for (const mk of masks) {
    const sh = pathAt(mk.path, t);
    if (!sh) continue;
    q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, W, H);
    const fe = V(mk.feather, t, [0, 0]); const f = Math.max(fe[0] || 0, fe[1] || 0) * scale;
    q.filter = f > 0.5 ? `blur(${f / 2}px)` : 'none';
    q.translate(pad, pad); q.scale(scale, scale);
    const path = new Path2D(); tracePath(path, sh);
    q.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, V(mk.opacity, t, 100) / 100))})`;
    if (mk.inverted) { q.setTransform(1, 0, 0, 1, 0, 0); q.fillRect(0, 0, W, H); q.translate(pad, pad); q.scale(scale, scale); q.globalCompositeOperation = 'destination-out'; q.fillStyle = '#fff'; }
    q.fill(path);
    q.filter = 'none';
    m.globalCompositeOperation = mk.mode === 2 ? 'destination-out' : mk.mode === 3 ? 'destination-in' : mk.mode === 5 ? 'lighten' : mk.mode === 4 ? 'darken' : 'source-over';
    m.drawImage(tmp, 0, 0);
  }
  cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mc, 0, 0); cx.restore();
}

// ---------------------------------------------------------------- parentesco (pai/filho) e Null
let layerIndex = new Map();
function indexLayers(layers) { layerIndex = new Map(); const add = (ls) => { for (const l of ls) { layerIndex.set(l.id, l); if (l.type === 'group') add(l.props.layers || []); } }; add(layers); }
function applyParents(c, layer, t, scale) {
  const chain = [];
  let p = layer.parent ? layerIndex.get(layer.parent) : null;
  while (p && chain.length < 12) { chain.unshift(p); p = p.parent ? layerIndex.get(p.parent) : null; }
  for (const P of chain) {
    const m = layerTransform(P, t), { w, h } = contentSize(P);
    c.translate(m.x * scale, m.y * scale); c.rotate((m.rot * Math.PI) / 180); c.scale(m.sx, m.sy);
    c.translate(-(w / 2 + m.anchor[0]) * scale, -(h / 2 + m.anchor[1]) * scale);
  }
}

/** Renderiza conteúdo + efeitos. O resultado deve ser desenhado imediatamente (canvas WebGL é reutilizado). */
/**
 * Resolução útil da camada: se ela aparece encolhida (ex.: vídeo 4K a 28% numa composição 1080), não adianta
 * desenhá-la e processar os efeitos no tamanho original — só gasta memória e trava. k ≤ 1 (com 15% de folga).
 */
function layerResK(layer, t) {
  if (layer.type === 'adjustment' || layer.type === 'audio') return 1;
  const m = layerTransform(layer, t);
  let s = Math.max(Math.abs(m.sx), Math.abs(m.sy));
  let p = layer.parent ? layerIndex.get(layer.parent) : null;
  for (let i = 0; p && i < 8; i++) { const pm = layerTransform(p, t); s *= Math.max(Math.abs(pm.sx), Math.abs(pm.sy)); p = p.parent ? layerIndex.get(p.parent) : null; }
  if (!(s > 0) || s >= 0.87) return 1;
  return Math.max(0.05, Math.min(1, s * 1.15));
}

function renderLayerImage(layer, t, scale0, extra) {
  const resK0 = layerResK(layer, t);
  const lt = layerTime(layer, t);
  const { w, h } = contentSize(layer);
  const active = layer.effects.filter((fx) => fx.enabled && EFFECT_MAP[fx.type]?.render);
  const fps = project?.fps || 30;
  const evaluated = active.map((fx) => {
    const def = EFFECT_MAP[fx.type];
    const p = evalParams(fx, lt);
    // efeitos de "motion blur por curva" (S_BlurMoCurves) precisam do valor um obturador atrás
    const prev = def.usesPrev ? evalParams(fx, lt - (p.shutter ?? 1) / fps) : null;
    return { def, p, prev, fx };
  });
  let pad = 2 + (layer.type === 'text' && layer.props.animators?.length ? animatorPad(layer.props) : 0);
  for (const { def, p } of evaluated) pad += def.pad ? Math.max(0, def.pad(p, { w, h, layer })) : 0;
  if (!Number.isFinite(pad)) pad = 2; // nunca NaN (deixava a camada preta)
  // Orçamento de pixels por camada (como o AE baixa a resolução da prévia): uma textura de 4000×5000 derruba a GPU
  // e deixa o preview preto. Se a camada + margem passar do limite, ela é processada numa resolução menor e
  // ampliada na hora de compor (o mesmo k do layerResK).
  const gmax = Math.min(getGL()?.maxSize || 4096, renderOpts.final ? 8192 : 4096);
  const budget = renderOpts.final ? (IOS_R ? 9e6 : 24e6) : (IOS_R ? 3.2e6 : 7e6);
  let scale = scale0 * resK0;
  for (let i = 0; i < 4; i++) {
    const pp = Math.min(pad * scale, 2048), Wt = w * scale + pp * 2, Ht = h * scale + pp * 2;
    const f = Math.min(1, Math.sqrt(budget / Math.max(1, Wt * Ht)), gmax / Math.max(1, Wt, Ht));
    if (f > 0.995) break;
    scale *= f * 0.98;
  }
  const kAll = scale / (scale0 || 1);
  pad = Math.ceil(Math.min(pad * scale, 2048));

  let W = Math.ceil(w * scale + pad * 2), H = Math.ceil(h * scale + pad * 2);
  if (!Number.isFinite(W) || !Number.isFinite(H) || W < 1 || H < 1) { W = Math.max(1, Math.ceil(w * scale) || 1); H = Math.max(1, Math.ceil(h * scale) || 1); }
  let vf = layer.type === 'video' ? videoFrames(layer, lt, project?.fps || 30, renderOpts.final && !extra?.offTime) : null;
  // pré-comp: o conteúdo segue o tempo da pré-comp (mover/aparar/velocidade/Time Remap, como no AE)
  let gtA = t, gtB = t;
  if (layer.type === 'group') {
    const ct = groupContentTime(layer, t);
    gtA = gtB = ct;
    const tfx = groupHasTimeFx(layer) ? (speedEffect(layer) || remapEffect(layer)) : null;
    const blend = tfx && (tfx.params.frameBlend?.value ?? true);
    if (blend) { // câmera lenta na pré-comp: quadro intermediário por fluxo óptico entre dois quadros do conteúdo (como o Twixtor)
      const f0 = Math.floor(ct * fps + 1e-6) / fps, fr = (ct - f0) * fps;
      if (fr > 0.02 && fr < 0.98) { gtA = f0; gtB = f0 + 1 / fps; vf = { a: null, b: true, f: fr }; }
    }
  }
  const paint = (id, source, tt = gtA) => {
    const canvas = poolCanvas(id, W, H);
    const cx = canvas.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, W, H);
    if (layer.type === 'group') {
      // exportação: o conteúdo da pré-comp num instante já desenhado é reaproveitado (Twixtor/Time Remap na pré-comp
      // com mistura de quadros pede os mesmos quadros do conteúdo várias vezes — em câmera lenta, 4× ou mais)
      const ck = renderOpts.final ? `${layer.id}|${tt.toFixed(5)}|${W}x${H}|${pad}|${scale.toFixed(4)}` : null;
      const hit = ck && groupCache.get(ck);
      if (hit) { groupCache.delete(ck); groupCache.set(ck, hit); cx.drawImage(hit, 0, 0); return canvas; }
      // grupo (pré-composição): desenha as camadas filhas como uma composição própria
      cx.setTransform(1, 0, 0, 1, pad, pad);
      drawLayerList(cx, layer.props.layers || [], tt, scale, fps);
      if (ck) {
        cx.setTransform(1, 0, 0, 1, 0, 0);
        let keep = null;
        const bytesOf = () => [...groupCache.values()].reduce((n, c) => n + c.width * c.height * 4, 0);
        while (groupCache.size && (groupCache.size >= GROUP_CACHE_MAX || bytesOf() + W * H * 4 > GROUP_CACHE_BYTES)) {
          const [k0, old] = groupCache.entries().next().value; groupCache.delete(k0);
          if (!keep) keep = old; else { old.width = 0; old.height = 0; }
        }
        if (!keep) keep = makeCanvas(W, H);
        if (keep.width !== W || keep.height !== H) { keep.width = W; keep.height = H; }
        const kx = keep.getContext('2d'); kx.clearRect(0, 0, W, H); kx.drawImage(canvas, 0, 0);
        groupCache.set(ck, keep);
      }
      return canvas;
    }
    cx.translate(pad, pad);
    cx.scale(scale, scale);
    drawContent(cx, layer, w, h, { ...extra, videoSource: source, lt });
    if (layer.masks?.length) applyMasks(cx, layer, lt, scale, pad, W, H);
    return canvas;
  };
  const canvas = paint(layer.id, vf?.a);
  // pré-comp em câmera lenta: o 2º quadro é desenhado já (as camadas de dentro usam a GPU e liberariam a textura do 1º)
  const canvasB = layer.type === 'group' && vf?.b ? paint(`${layer.id}#b`, null, gtB) : null;

  const gl = evaluated.length || vf?.b ? getGL() : null;
  if (!gl) {
    if (vf?.b) { // sem WebGL: mistura simples
      const cx = canvas.getContext('2d');
      cx.globalAlpha = vf.f;
      cx.drawImage(canvasB || paint(`${layer.id}#b`, vf.b, gtB), 0, 0);
      cx.globalAlpha = 1;
    }
    return { src: canvas, sw: W, sh: H, pad, w, h, k: kAll };
  }

  let tex = gl.upload(canvas);
  if (vf?.b) {
    // Twixtor: quadro intermediário por fluxo óptico
    const texB = gl.upload(canvasB || paint(`${layer.id}#b`, vf.b, gtB));
    try {
      // modelo do Topaz Frame Interpolation: Apollo/Aion = fluxo nos dois sentidos, Chronos = um sentido, Fast = fluxo leve
      const fim = layer.effects.find((f) => f.enabled && f.type === 'topazFI')?.params.fiModel?.value | 0;
      const fast = fim === 2 || fim === 4;
      const hq = (renderOpts.final || renderOpts.hq) && !fast;
      const flow = computeFlow(gl, tex, texB, hq ? 'final' : 'preview');
      const mbAmt = vectorBlur(layer, lt);
      if (hq && fim !== 3 && layer.type !== 'group' && vf.f > 0.001 && vf.f < 0.999) tex = interpBidirectional(gl, tex, texB, flow, computeFlow(gl, texB, tex, 'final'), vf.f);
      else tex = interpWithFlow(gl, tex, texB, flow, vf.f);
      if (mbAmt > 0) {
        // obturador de 180° (0,5 quadro) × quadros de origem avançados por quadro de saída
        const sfps = layer.props.sourceFps || fps;
        const len = Math.abs(sourceRate(layer, lt)) * (sfps / fps) * 0.5 * (mbAmt / 100);
        tex = flowMotionBlur(gl, tex, flow, Math.min(len, 6));
      }
    } catch (e) { console.warn('fluxo óptico falhou', e); }
  }
  const rect = [pad / tex.w, pad / tex.h, (w * scale) / tex.w, (h * scale) / tex.h];
  gl.env = { u_time: lt, u_scale: scale, u_rect: rect };
  const env = { gl, t: lt, scale, pad, w, h, W: tex.w, H: tex.h, rect, layer, fps, srcCanvas: canvas, final: renderOpts.final, srcW: vf?.a ? vf.a.videoWidth || vf.a.width : layer.type === 'image' ? getImage(layer.props.src)?.naturalWidth : 0 };
  const tex0 = tex;
  for (const { def, p, prev, fx } of evaluated) {
    try {
      const input = tex;
      tex = def.render(input, p, { ...env, fx, paramsAt: (tt) => evalParams(fx, tt) }, prev) || input;
      // Opacidade do efeito (AE: Compositing Options → Effect Opacity)
      const op = p.fxOpacity ?? 100;
      if (op < 99.95 && tex !== input) tex = gl.mix(input, tex, Math.max(0, op) / 100);
      // a entrada do efeito já foi usada: volta ao pool (pilhas de efeitos pesados ocupavam centenas de MB de vídeo)
      if (tex !== input && input !== tex0 && !def.keepInput) gl.release(input);
    } catch (e) { console.warn('efeito falhou', def.type, e); }
  }
  if (gl.gl.isContextLost()) return { src: canvas, sw: W, sh: H, pad, w, h, k: kAll }; // GPU caiu: mostra sem efeitos em vez de preto
  const out = gl.toCanvas(tex);
  gl.releaseAll();
  return { src: out, sw: tex.w, sh: tex.h, pad, w, h, k: kAll };
}

function drawLayerImage(ctx, img, m, scale, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = m.opacity * alpha;
  ctx.translate(m.x * scale, m.y * scale);
  ctx.rotate((m.rot * Math.PI) / 180);
  const k = img.k || 1; // camada desenhada em resolução reduzida: amplia de volta na hora de compor
  ctx.scale(m.sx / k, m.sy / k);
  ctx.drawImage(img.src, 0, 0, img.sw, img.sh, -(img.w / 2 + m.anchor[0]) * scale * k - img.pad, -(img.h / 2 + m.anchor[1]) * scale * k - img.pad, img.sw, img.sh);
  ctx.restore();
}

/** Time Slice: cada faixa da camada mostra um tempo diferente. Agrupa as faixas por atraso (poucos renders). */
/**
 * S_TimeSlice (Sapphire): fatias perpendiculares à direção (0° = esquerda→direita, 90° = cima→baixo); a fatia k mostra
 * o quadro relativo k − ⌊N/2⌋ + Frame Offset. Interp Frames: mistura os dois quadros inteiros mais próximos (senão, o mais próximo).
 */
function drawSapphireTimeSlice(ctx, layer, t, scale, extra, p, m, fps) {
  // Sapphire S_TimeSlice: o número do quadro relativo varia de forma CONTÍNUA ao longo da Slice Direction,
  // de −N/2 (início) a +N/2 (fim), + Frame Offset; o quadro atual fica no meio.
  //  • Interp Frames desligado: cada ponto usa o quadro inteiro mais próximo → faixas com bordas visíveis.
  //  • Interp Frames ligado: cada ponto mistura os dois quadros inteiros vizinhos pelo peso exato (sem emendas).
  const { w, h } = contentSize(layer);
  const N = Math.max(1, +p.number || 1), off = +p.offset || 0;
  const th = ((p.direction || 0) * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th);
  const proj = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => x * dx + y * dy);
  const smin = Math.min(...proj), smax = Math.max(...proj), span = Math.max(1e-6, smax - smin);
  const relAt = (s) => -N / 2 + N * s + off;           // s = 0..1 ao longo da direção
  const sOf = (rel) => (rel - off + N / 2) / N;        // inverso
  const P = (s) => { const q = smin + s * span; return [dx * q * scale, dy * q * scale]; }; // ponto (px do conteúdo) na posição s
  const cw = Math.max(1, Math.ceil(w * scale)), ch = Math.max(1, Math.ceil(h * scale));
  const acc = document.createElement('canvas'); acc.width = cw; acc.height = ch;
  const ac = acc.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch;
  const tc = tmp.getContext('2d');
  const f0 = Math.floor(Math.min(relAt(0), relAt(1))) - (p.interp ? 1 : 0), f1 = Math.ceil(Math.max(relAt(0), relAt(1))) + (p.interp ? 1 : 0);
  for (let fr = f0; fr <= f1; fr++) {
    const sc = sOf(fr), hw = p.interp ? 1 / N : 0.5 / N; // meia largura da área desse quadro (em s)
    if (sc + hw < 0 || sc - hw > 1) continue;
    const te = Math.max(layer.inPoint, Math.min(layer.outPoint - 1e-3, t + fr / fps));
    const img = renderLayerImage(layer, te, scale, { ...extra, offTime: Math.abs(te - t) > 1e-6 });
    const kk = img.k || 1;
    tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, cw, ch);
    tc.drawImage(img.src, 0, 0, img.sw, img.sh, -img.pad / kk, -img.pad / kk, img.sw / kk, img.sh / kk);
    // máscara do quadro: faixa dura (sem interp) ou triângulo de peso 0→1→0 (com interp; os pesos somam 1)
    const [ax, ay] = P(sc - hw), [bx, by] = P(sc + hw);
    const g = tc.createLinearGradient(ax, ay, bx, by);
    if (p.interp) { g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
    else { g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,1)'); }
    tc.globalCompositeOperation = 'destination-in';
    tc.fillStyle = g;
    if (p.interp) tc.fillRect(0, 0, cw, ch);
    else {
      // faixa: polígono perpendicular à direção, um pouco sobreposto para não aparecer fresta
      const ex = -dy * (cw + ch) * 2, ey = dx * (cw + ch) * 2, e = 0.5 / Math.max(1, span * scale);
      const [px0, py0] = P(sc - hw - e), [px1, py1] = P(sc + hw + e);
      const ox = sc - hw <= 0 ? -dx * (cw + ch) : 0, oy = sc - hw <= 0 ? -dy * (cw + ch) : 0;
      const qx = sc + hw >= 1 ? dx * (cw + ch) : 0, qy = sc + hw >= 1 ? dy * (cw + ch) : 0;
      tc.beginPath();
      tc.moveTo(px0 + ox - ex, py0 + oy - ey); tc.lineTo(px0 + ox + ex, py0 + oy + ey);
      tc.lineTo(px1 + qx + ex, py1 + qy + ey); tc.lineTo(px1 + qx - ex, py1 + qy - ey); tc.closePath(); tc.fill();
    }
    ac.globalCompositeOperation = p.interp ? 'lighter' : 'source-over';
    ac.drawImage(tmp, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = m.opacity;
  ctx.translate(m.x * scale, m.y * scale); ctx.rotate((m.rot * Math.PI) / 180); ctx.scale(m.sx, m.sy);
  ctx.translate(-(w / 2 + m.anchor[0]) * scale, -(h / 2 + m.anchor[1]) * scale);
  ctx.drawImage(acc, 0, 0, cw, ch, 0, 0, w * scale, h * scale);
  ctx.restore();
}

function drawTimeSlices(ctx, layer, t, scale, extra, p, m, fps) {
  const { w, h } = contentSize(layer);
  const n = Math.max(1, Math.round(p.slices));
  const vertical = p.direction !== 2;
  const size = (vertical ? w : h) / n;
  const rank = [];
  for (let i = 0; i < n; i++) {
    if (p.order === 2) rank.push(Math.abs(i - (n - 1) / 2));
    else if (p.order === 3) rank.push(Math.sin((i + 1) * 12.9898 + p.seed * 78.233) * 43758.5453 % 1);
    else rank.push(i);
  }
  const maxR = Math.max(1e-6, ...rank.map(Math.abs));
  const L = Math.max(2, Math.round(p.levels));
  const groups = new Map();
  rank.forEach((r, i) => {
    const g = Math.round((Math.abs(r) / maxR) * (L - 1));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  });
  const span = (maxR * p.delay) / fps; // atraso máximo (s)
  for (const [g, strips] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    const frac = g / (L - 1);
    const te = Math.max(layer.inPoint, Math.min(layer.outPoint - 1e-3, t - frac * span));
    const img = renderLayerImage(layer, te, scale, { ...extra, offTime: te !== t });
    for (const i of strips) {
      const f = Math.abs(rank[i]) / maxR;
      ctx.save();
      ctx.globalAlpha = m.opacity;
      ctx.translate(m.x * scale, m.y * scale);
      ctx.rotate((m.rot * Math.PI) / 180);
      ctx.scale(m.sx, m.sy);
      ctx.translate(-(w / 2 + m.anchor[0]) * scale, -(h / 2 + m.anchor[1]) * scale);
      ctx.beginPath();
      if (vertical) ctx.rect(Math.floor(i * size * scale), 0, Math.ceil(size * scale) + 1, h * scale);
      else ctx.rect(0, Math.floor(i * size * scale), w * scale, Math.ceil(size * scale) + 1);
      ctx.clip();
      const off = p.offset * f * (i % 2 ? -1 : 1) * scale;
      const st = 1 + (p.stretch / 100) * f;
      if (vertical) { ctx.translate(0, (h * scale) / 2 + off); ctx.scale(1, st); ctx.translate(0, -(h * scale) / 2); }
      else { ctx.translate((w * scale) / 2 + off, 0); ctx.scale(st, 1); ctx.translate(-(w * scale) / 2, 0); }
      const kk = img.k || 1;
      ctx.drawImage(img.src, 0, 0, img.sw, img.sh, -img.pad / kk, -img.pad / kk, img.sw / kk, img.sh / kk);
      ctx.restore();
    }
  }
}

/** S_TimeWarpRGB: vermelho, verde e azul vêm de tempos diferentes da mesma camada (rastro colorido). */
let chA = null, chB = null;
function drawChannelTime(ctx, layer, t, scale, extra, img, m, p, fps) {
  const W = ctx.canvas.width, H = ctx.canvas.height, tf = ctx.getTransform();
  for (const c of [chA, chB]) if (c && (c.width !== W || c.height !== H)) { c.width = W; c.height = H; }
  if (!chA) chA = makeCanvas(W, H);
  if (!chB) chB = makeCanvas(W, H);
  const a = chA.getContext('2d'), b = chB.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over'; a.clearRect(0, 0, W, H);
  // verde primeiro: a imagem do tempo atual já está pronta (o canvas do WebGL é reaproveitado no próximo render)
  for (const [shift, color] of [[0, '#00ff00'], [p.red || 0, '#ff0000'], [p.blue || 0, '#0000ff']]) {
    const tc = Math.max(layer.inPoint, Math.min(layer.outPoint - 1e-4, t + shift / fps));
    const im = shift === 0 ? img : renderLayerImage(layer, tc, scale, { ...extra, offTime: true });
    const mm = shift === 0 ? m : layerTransform(layer, tc);
    b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1; b.clearRect(0, 0, W, H);
    b.setTransform(tf); drawLayerImage(b, im, mm, scale);
    b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'multiply'; b.fillStyle = color; b.fillRect(0, 0, W, H);
    b.globalCompositeOperation = 'destination-in'; b.setTransform(tf); drawLayerImage(b, im, mm, scale);
    a.globalCompositeOperation = 'lighter'; a.drawImage(chB, 0, 0);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(chA, 0, 0); ctx.restore();
}

/** CC Wide Time: média de quadros da camada de (t − passos atrás) a (t + passos à frente). */
let wtA = null;
function drawWideTime(ctx, layer, t, scale, extra, img, m, p, fps) {
  const W = ctx.canvas.width, H = ctx.canvas.height, tf = ctx.getTransform();
  if (!wtA) wtA = makeCanvas(W, H);
  if (wtA.width !== W || wtA.height !== H) { wtA.width = W; wtA.height = H; }
  const a = wtA.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over'; a.clearRect(0, 0, W, H);
  const sub = p.nativeBlur ? 2 : 1, st = Math.max(0.1, p.stepSize || 1) / sub;
  const back = Math.round((p.backward || 0) * sub), fwd = Math.round((p.forward || 0) * sub);
  const offs = [0];
  for (let k = 1; k <= Math.max(back, fwd); k++) { if (k <= back) offs.push(-k * st); if (k <= fwd) offs.push(k * st); }
  const list = offs.slice(0, 40);
  a.globalCompositeOperation = 'lighter';
  for (const o of list) {
    const tc = Math.max(layer.inPoint, Math.min(layer.outPoint - 1e-4, t + o / fps));
    const im = o === 0 ? img : renderLayerImage(layer, tc, scale, { ...extra, offTime: true });
    a.setTransform(tf);
    drawLayerImage(a, im, o === 0 ? m : layerTransform(layer, tc), scale, 1 / list.length);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(wtA, 0, 0); ctx.restore();
}

/** BCC Temporal Blur: média ponderada de quadros vizinhos (Amount em quadros, separação, offset, direção, Gaussian/Flat). */
let tblurCanvas = null;
function drawTemporalBlur(ctx, layer, t, scale, extra, p, fps, baseTf) {
  const amt = p.lockWhole ? Math.round(p.amount) : p.amount;
  const sep = Math.max(1, Math.round(p.separation || 1));
  const half = p.direction === 1 ? amt / 2 : amt;           // Bidirectional: metade para cada lado
  const lo = p.direction === 2 ? 0 : -half, hi = p.direction === 3 ? 0 : half;
  const offs = [];
  for (let k = Math.ceil(lo / sep) * sep; k <= hi + 1e-6; k += sep) offs.push(k);
  if (!offs.includes(0)) offs.push(0);
  // quadro fracionário na ponta (Amount não inteiro): entra com peso parcial
  const frac = (x) => (Math.abs(x) <= half ? 1 : Math.max(0, 1 - (Math.abs(x) - half)));
  const sig = Math.max(0.5, half / 2) * (1 + (p.spread || 0) / 50);
  const ws = offs.map((k) => frac(k) * (p.shape === 2 ? 1 : Math.exp(-(k * k) / (2 * sig * sig))));
  const W = ws.reduce((a, b) => a + b, 0) || 1;
  if (!tblurCanvas) tblurCanvas = makeCanvas(ctx.canvas.width, ctx.canvas.height);
  if (tblurCanvas.width !== ctx.canvas.width || tblurCanvas.height !== ctx.canvas.height) { tblurCanvas.width = ctx.canvas.width; tblurCanvas.height = ctx.canvas.height; }
  const ac = tblurCanvas.getContext('2d');
  ac.setTransform(1, 0, 0, 1, 0, 0); ac.globalCompositeOperation = 'source-over'; ac.globalAlpha = 1; ac.clearRect(0, 0, tblurCanvas.width, tblurCanvas.height);
  ac.setTransform(baseTf);
  if (layer.parent) applyParents(ac, layer, t, scale);
  ac.globalCompositeOperation = 'lighter';
  const mix = (p.mix || 0) / 100;
  offs.forEach((k, i) => {
    const te = Math.max(layer.inPoint, Math.min(layer.outPoint - 1e-3, t + (k + (p.offset || 0)) / fps));
    const img = renderLayerImage(layer, te, scale, { ...extra, offTime: Math.abs(te - t) > 1e-6 });
    const w = (ws[i] / W) * (1 - mix) + (k === 0 ? mix : 0); // Mix with Original: volta ao quadro atual
    if (w > 1e-4) drawLayerImage(ac, img, layerTransform(layer, t), scale, w);
  });
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(tblurCanvas, 0, 0); ctx.restore();
}

function findFx(layer, type) {
  return layer.effects.find((fx) => fx.enabled && fx.type === type) || null;
}

export function renderLayer(ctx, layer, t, scale, extra, fps = 30) {
  if (layer.threeD && cam3d) { ctx.save(); ctx.globalCompositeOperation = layer.blend || 'source-over'; render3D(ctx, layer, t, scale, extra); ctx.restore(); return; }
  const m = layerTransform(layer, t);
  const echo = findFx(layer, 'echo');
  const mb = findFx(layer, 'motionBlur');
  ctx.save();
  ctx.globalCompositeOperation = layer.blend || 'source-over';
  const baseTf = ctx.getTransform();
  if (layer.parent) applyParents(ctx, layer, t, scale);

  const drawEchoes = () => {
    const p = evalParams(echo, layerTime(layer, t));
    for (let k = Math.round(p.count); k >= 1; k--) {
      const te = t + k * p.time;
      if (te < layer.inPoint || te > layer.outPoint) continue;
      const img = renderLayerImage(layer, te, scale, { ...extra, offTime: true });
      drawLayerImage(ctx, img, layerTransform(layer, te), scale, p.start * p.decay ** k);
    }
  };
  if (echo && evalParams(echo, t).behind) drawEchoes();

  const ts = findFx(layer, 'timeSlice');
  const sts = findFx(layer, 'sTimeSlice');
  const tbl = findFx(layer, 'bccTemporalBlur');
  const tbp = tbl ? evalParams(tbl, layerTime(layer, t)) : null;
  if (tbp && tbp.amount > 0.01 && m.opacity > 0.001) {
    drawTemporalBlur(ctx, layer, t, scale, extra, tbp, fps, baseTf);
  } else if (sts && m.opacity > 0.001) {
    drawSapphireTimeSlice(ctx, layer, t, scale, extra, evalParams(sts, layerTime(layer, t)), m, fps);
  } else if (ts && m.opacity > 0.001) {
    drawTimeSlices(ctx, layer, t, scale, extra, evalParams(ts, layerTime(layer, t)), m, fps);
  } else if (m.opacity > 0.001 || mb) {
    const img = renderLayerImage(layer, t, scale, extra);
    const mp = mb ? evalParams(mb, layerTime(layer, t)) : null;
    if (mp && mp.amount > 0) {
      const n = Math.max(2, Math.round(mp.samples));
      const shutter = ((mp.amount / 100) * 0.5) / fps;
      if (!accumCanvas) accumCanvas = makeCanvas(ctx.canvas.width, ctx.canvas.height);
      if (accumCanvas.width !== ctx.canvas.width || accumCanvas.height !== ctx.canvas.height) { accumCanvas.width = ctx.canvas.width; accumCanvas.height = ctx.canvas.height; }
      const ac = accumCanvas.getContext('2d');
      ac.setTransform(1, 0, 0, 1, 0, 0);
      ac.globalCompositeOperation = 'source-over';
      ac.clearRect(0, 0, accumCanvas.width, accumCanvas.height);
      if (layer.parent) applyParents(ac, layer, t, scale);
      ac.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const tau = t + shutter * (i / (n - 1) - 0.5);
        drawLayerImage(ac, img, layerTransform(layer, tau), scale, 1 / n);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(baseTf);
      ctx.drawImage(accumCanvas, 0, 0);
    } else {
      const cw = layer.effects.find((fx) => fx.enabled && EFFECT_MAP[fx.type]?.channelTime);
      const wt = findFx(layer, 'wideTime');
      if (wt) drawWideTime(ctx, layer, t, scale, extra, img, m, evalParams(wt, layerTime(layer, t)), fps);
      else if (cw) drawChannelTime(ctx, layer, t, scale, extra, img, m, evalParams(cw, layerTime(layer, t)), fps);
      else drawLayerImage(ctx, img, m, scale);
    }
  }

  if (echo && !evalParams(echo, t).behind) drawEchoes();
  ctx.restore();
}

/** Track Matte (como no AE): a camada usa a camada de CIMA como máscara (1 alfa, 2 alfa invertido, 3 luma, 4 luma invertida). */
let matteA = null, matteB = null;
function renderWithMatte(ctx, l, matte, t, scale, fps) {
  const W = ctx.canvas.width, H = ctx.canvas.height, tf = ctx.getTransform();
  if (!matteA) { matteA = makeCanvas(W, H); matteB = makeCanvas(W, H); }
  for (const c of [matteA, matteB]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const a = matteA.getContext('2d'), b = matteB.getContext('2d', { willReadFrequently: matte.trackLuma });
  for (const x of [a, b]) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, W, H); x.setTransform(tf); }
  renderLayer(a, l, t, scale, null, fps);
  if (t >= matte.inPoint && t < matte.outPoint) renderLayer(b, matte, t, scale, null, fps);
  const mode = l.trackMatte;
  if (mode === 3 || mode === 4) { // luma → alfa
    b.setTransform(1, 0, 0, 1, 0, 0);
    const img = b.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) d[i + 3] = Math.round((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255));
    b.putImageData(img, 0, 0);
  }
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = mode === 2 || mode === 4 ? 'destination-out' : 'destination-in';
  a.drawImage(matteB, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = l.blend || 'source-over'; ctx.drawImage(matteA, 0, 0); ctx.restore();
}

/** Desenha uma lista de camadas (de baixo para cima), com Null, Track Matte e parentesco. */
// ---------------------------------------------------------------- 3D (camadas 3D + câmera, como no AE)
let cam3d = null; // câmera da composição que está sendo desenhada (null = nenhuma camada 3D)

/** Matriz de mundo (conteúdo da camada → composição em 3D), incluindo a cadeia de pais. */
function worldMatrix(layer, t) {
  let M = localMatrix(layer, layerTransform(layer, t), contentSize(layer), layerTime(layer, t));
  let p = layer.parent ? layerIndex.get(layer.parent) : null;
  for (let i = 0; p && i < 12; i++) {
    M = mul4(localMatrix(p, layerTransform(p, t), contentSize(p), layerTime(p, t)), M);
    p = p.parent ? layerIndex.get(p.parent) : null;
  }
  return M;
}
function parentWorld(layer, t) {
  const p = layer.parent ? layerIndex.get(layer.parent) : null;
  return p ? worldMatrix(p, t) : null;
}
const isActive = (l, t) => l.visible && !l.missing && t >= l.inPoint && t < l.outPoint; // mídia offline (não achada no aparelho) não desenha
function setupCamera(layers, t, W, H) {
  if (!layers.some((l) => l.threeD && isActive(l, t))) return null;
  const cam = layers.find((l) => l.type === 'camera' && isActive(l, t)) || null;
  return cameraFor(cam, W, H, cam ? layerTime(cam, t) : t, cam ? parentWorld(cam, t) : null);
}
/** Distância da camada à câmera (para desenhar de trás para frente). */
function depthOf(l, t) {
  const { w, h } = contentSize(l), m = layerTransform(l, t);
  const c = apply3(cam3d.view, apply3(worldMatrix(l, t), [w / 2 + m.anchor[0], h / 2 + m.anchor[1], 0]));
  return c[2];
}

let src3d = null;
/** Desenha uma camada 3D em perspectiva pela câmera ativa (WebGL; sem WebGL, desenha em 2D). */
function render3D(ctx, layer, t, scale, extra) {
  const m = layerTransform(layer, t);
  if (m.opacity <= 0.001) return;
  const img = renderLayerImage(layer, t, scale, extra);
  const gl = getGL();
  if (!gl) { drawLayerImage(ctx, img, m, scale); return; }
  const k = img.k || 1, s = scale * k;
  const x0 = -img.pad / s, y0 = -img.pad / s, x1 = (img.sw - img.pad) / s, y1 = (img.sh - img.pad) / s;
  const Mw = worldMatrix(layer, t);
  const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => apply3(cam3d.view, apply3(Mw, p)));
  const near = 1;
  if (cs.every((c) => c[2] < near)) return; // atrás da câmera
  const tf = ctx.getTransform(), CW = ctx.canvas.width, CH = ctx.canvas.height;
  const f = 1e6, A = (f + near) / (f - near), B = (-2 * f * near) / (f - near);
  const verts = cs.map(([X, Y, Z]) => {
    const sxZ = ((cam3d.W / 2) * Z + X * cam3d.zoom) * scale, syZ = ((cam3d.H / 2) * Z + Y * cam3d.zoom) * scale; // px do canvas (× Z)
    const px = tf.a * sxZ + tf.c * syZ + tf.e * Z, py = tf.b * sxZ + tf.d * syZ + tf.f * Z;
    return [(2 * px) / CW - Z, (2 * py) / CH - Z, A * Z + B, Z];
  });
  if (!src3d) src3d = makeCanvas(2, 2);
  if (src3d.width !== img.sw || src3d.height !== img.sh) { src3d.width = img.sw; src3d.height = img.sh; }
  const sc = src3d.getContext('2d');
  sc.clearRect(0, 0, img.sw, img.sh);
  sc.drawImage(img.src, 0, 0, img.sw, img.sh, 0, 0, img.sw, img.sh);
  let tex = gl.upload(src3d);
  // profundidade de campo da câmera: desfoque pela distância do centro da camada ao plano de foco
  const zc = (cs[0][2] + cs[1][2] + cs[2][2] + cs[3][2]) / 4;
  const db = dofBlur(cam3d, zc);
  if (db > 0.3) tex = gl.blur(tex, db * s);
  const out = gl.quad3d(tex, verts, [[0, 0], [1, 0], [1, 1], [0, 1]], CW, CH);
  const c = gl.toCanvas(out);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = m.opacity;
  ctx.drawImage(c, 0, 0, out.w, out.h, 0, 0, CW, CH);
  ctx.restore();
  gl.releaseAll();
}

function drawLayerList(ctx, layers, t, scale, fps, onAdjust, compW = project?.width || 1080, compH = project?.height || 1920) {
  const prevCam = cam3d;
  cam3d = setupCamera(layers, t, compW, compH);
  // ordem de desenho: de baixo para cima; camadas 3D seguidas são ordenadas pela distância à câmera (como no AE)
  const order = [];
  for (let i = layers.length - 1; i >= 0; i--) order.push(i);
  if (cam3d) {
    for (let a = 0; a < order.length;) {
      if (!layers[order[a]].threeD) { a++; continue; }
      let b = a;
      while (b < order.length && layers[order[b]].threeD) b++;
      const run = order.slice(a, b).map((i) => [i, isActive(layers[i], t) ? depthOf(layers[i], t) : 0]).sort((x, y) => y[1] - x[1]).map((x) => x[0]);
      order.splice(a, b - a, ...run);
      a = b;
    }
  }
  try {
    for (const i of order) drawListItem(ctx, layers, i, t, scale, fps, onAdjust);
  } finally { cam3d = prevCam; }
}

function drawListItem(ctx, layers, i, t, scale, fps, onAdjust) {
  {
    const l = layers[i];
    if (!l.visible || l.type === 'audio' || l.type === 'null' || l.type === 'camera' || t < l.inPoint || t >= l.outPoint) return;
    if (l.type === 'adjustment') { if (onAdjust) onAdjust(l); return; }
    if (l.trackMatte && layers[i - 1]) { renderWithMatte(ctx, l, layers[i - 1], t, scale, fps); return; }
    ctx.save();
    renderLayer(ctx, l, t, scale, null, fps);
    ctx.restore();
  }
}

export function renderFrame(ctx, proj, t, scale = 1, opts = {}) {
  project = proj;
  exprContext.fps = proj.fps || 30; exprContext.W = proj.width; exprContext.H = proj.height;
  frameNo++;
  renderOpts = { final: !!opts.final, hq: !!opts.hq };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = proj.background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  indexLayers(proj.layers);
  drawLayerList(ctx, proj.layers, t, scale, proj.fps, (l) => {
    {
      if (!snapshotCanvas) snapshotCanvas = makeCanvas(ctx.canvas.width, ctx.canvas.height);
      snapshotCanvas.width = ctx.canvas.width;
      snapshotCanvas.height = ctx.canvas.height;
      snapshotCanvas.getContext('2d').drawImage(ctx.canvas, 0, 0);
      const op = layerTransform(l, t).opacity;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      if (op < 1) { ctx.globalAlpha = 1 - op; ctx.drawImage(snapshotCanvas, 0, 0); ctx.globalAlpha = 1; }
      renderLayer(ctx, l, t, scale, { snapshot: snapshotCanvas }, proj.fps);
    }
  });
  ctx.restore();
  trimCanvases();
  getGL()?.trimPool?.();
}

export function toLayerSpace(layer, t, x, y) {
  const m = layerTransform(layer, t);
  const dx = x - m.x, dy = y - m.y;
  const r = (-m.rot * Math.PI) / 180;
  const rx = dx * Math.cos(r) - dy * Math.sin(r);
  const ry = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: rx / (m.sx || 1e-6) + m.anchor[0], y: ry / (m.sy || 1e-6) + m.anchor[1] };
}

export function hitTest(proj, t, x, y) {
  project = proj;
  for (const l of proj.layers) {
    if (!l.visible || l.locked || l.type === 'audio' || l.type === 'adjustment' || l.type === 'camera' || t < l.inPoint || t >= l.outPoint) continue;
    const { w, h } = contentSize(l, proj);
    const p = toLayerSpace(l, t, x, y);
    if (Math.abs(p.x) <= w / 2 && Math.abs(p.y) <= h / 2) return l;
  }
  return null;
}

export function layerCorners(layer, t, proj = project) {
  const { w, h } = contentSize(layer, proj);
  const m = layerTransform(layer, t);
  const r = (m.rot * Math.PI) / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cx, cy]) => {
    const lx = (cx * w) / 2 - m.anchor[0], ly = (cy * h) / 2 - m.anchor[1];
    const sx = lx * m.sx, sy = ly * m.sy;
    return [m.x + sx * Math.cos(r) - sy * Math.sin(r), m.y + sx * Math.sin(r) + sy * Math.cos(r)];
  });
}

export function forgetLayer(id) { contentCanvases.delete(id); }

/**
 * Pick-whip (Pai) do AE: troca o pai da camada sem ela sair do lugar — posição (inclusive keyframes), rotação e
 * escala são convertidas para o espaço do novo pai.
 */
export function reparent(layer, newParent, proj, t) {
  project = proj;
  indexLayers(proj.layers);
  const oldP = layer.parent ? layerIndex.get(layer.parent) : null;
  const conv = (tt, p) => {
    let w = [p[0], p[1], 0];
    if (oldP) w = apply3(worldMatrix(oldP, tt), w);
    if (newParent) w = apply3(inv4(worldMatrix(newParent, tt)), w);
    return [Math.round(w[0] * 100) / 100, Math.round(w[1] * 100) / 100];
  };
  const chain = (P, tt) => { let r = 0, s = 1; for (let i = 0; P && i < 12; i++) { const m = layerTransform(P, tt); r += m.rot; s *= m.sx; P = P.parent ? layerIndex.get(P.parent) : null; } return { r, s }; };
  const tr = layer.transform;
  if (tr.position.keys?.length) for (const k of tr.position.keys) k.v = conv(k.t, k.v);
  tr.position.value = conv(t, tr.position.value);
  const a = chain(oldP, t), b = chain(newParent, t);
  const dr = a.r - b.r, ks = b.s ? a.s / b.s : 1;
  if (Math.abs(dr) > 1e-6) { if (tr.rotation.keys?.length) for (const k of tr.rotation.keys) k.v += dr; tr.rotation.value += dr; }
  if (Math.abs(ks - 1) > 1e-6) { const f = (v) => v.map((x) => Math.round(x * ks * 100) / 100); if (tr.scale.keys?.length) for (const k of tr.scale.keys) k.v = f(k.v); tr.scale.value = f(tr.scale.value); }
  layer.parent = newParent ? newParent.id : null;
}
/** Diagnóstico: memória dos canvases da renderização (MB). */
export function __canvasStats() {
  const list = [...contentCanvases.values()].map((c) => c.width * c.height * 4);
  return { n: list.length, mb: Math.round(list.reduce((a, b) => a + b, 0) / 1e6), max: Math.round(Math.max(0, ...list) / 1e6), gcache: groupCache.size };
}
