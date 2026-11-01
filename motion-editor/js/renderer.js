// Composição dos quadros: conteúdo das camadas (Canvas 2D) → efeitos (WebGL) → transformações,
// motion blur, echo e camadas de ajuste.
import { valueAt } from './anim.js';
import { EFFECT_MAP, makeCanvas } from './effects.js';
import { getGL } from './gl.js';
import { getImage, videoFrames } from './media.js';
import { flowInterpolate } from './flow.js';
import { layerTime } from './timing.js';

const contentCanvases = new Map();
let accumCanvas = null;
let snapshotCanvas = null;
let project = null; // projeto em renderização (para tamanho de camadas de ajuste)
let renderOpts = { final: false }; // final=true na exportação (quadros em resolução total)

function poolCanvas(id, w, h) {
  let c = contentCanvases.get(id);
  if (!c) { c = makeCanvas(w, h); contentCanvases.set(id, c); }
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
  if (layer.type === 'adjustment') return { w: proj?.width || 1080, h: proj?.height || 1920 };
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

function drawContent(ctx, layer, w, h, extra) {
  const p = layer.props;
  switch (layer.type) {
    case 'text': {
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
      if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, w, h);
      break;
    }
    case 'video': {
      const src = extra?.videoSource;
      if (src) ctx.drawImage(src, 0, 0, w, h);
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
  for (const [k, p] of Object.entries(fx.params)) out[k] = valueAt(p, t);
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
    anchor: valueAt(tr.anchor, lt),
  };
}

/** Renderiza conteúdo + efeitos. O resultado deve ser desenhado imediatamente (canvas WebGL é reutilizado). */
function renderLayerImage(layer, t, scale, extra) {
  const lt = layerTime(layer, t);
  const { w, h } = contentSize(layer);
  const active = layer.effects.filter((fx) => fx.enabled && EFFECT_MAP[fx.type]?.render);
  const evaluated = active.map((fx) => ({ def: EFFECT_MAP[fx.type], p: evalParams(fx, lt) }));
  let pad = 2;
  for (const { def, p } of evaluated) pad += def.pad ? Math.max(0, def.pad(p, { w, h })) : 0;
  pad = Math.ceil(Math.min(pad * scale, 4096));

  const W = Math.ceil(w * scale + pad * 2), H = Math.ceil(h * scale + pad * 2);
  const vf = layer.type === 'video' ? videoFrames(layer, lt, project?.fps || 30, renderOpts.final) : null;
  const paint = (id, source) => {
    const canvas = poolCanvas(id, W, H);
    const cx = canvas.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, W, H);
    cx.translate(pad, pad);
    cx.scale(scale, scale);
    drawContent(cx, layer, w, h, { ...extra, videoSource: source });
    return canvas;
  };
  const canvas = paint(layer.id, vf?.a);

  const gl = evaluated.length || vf?.b ? getGL() : null;
  if (!gl) {
    if (vf?.b) { // sem WebGL: mistura simples
      const cx = canvas.getContext('2d');
      cx.globalAlpha = vf.f;
      cx.drawImage(paint(`${layer.id}#b`, vf.b), 0, 0);
      cx.globalAlpha = 1;
    }
    return { src: canvas, sw: W, sh: H, pad, w, h };
  }

  let tex = gl.upload(canvas);
  if (vf?.b) {
    // Twixtor: quadro intermediário por fluxo óptico
    const texB = gl.upload(paint(`${layer.id}#b`, vf.b));
    try { tex = flowInterpolate(gl, tex, texB, vf.f, renderOpts.final ? 'final' : 'preview'); } catch (e) { console.warn('fluxo óptico falhou', e); }
  }
  const rect = [pad / tex.w, pad / tex.h, (w * scale) / tex.w, (h * scale) / tex.h];
  gl.env = { u_time: lt, u_scale: scale, u_rect: rect };
  const env = { gl, t: lt, scale, pad, w, h, W: tex.w, H: tex.h, rect, layer };
  for (const { def, p } of evaluated) {
    try { tex = def.render(tex, p, env) || tex; } catch (e) { console.warn('efeito falhou', def.type, e); }
  }
  const out = gl.toCanvas(tex);
  gl.releaseAll();
  return { src: out, sw: tex.w, sh: tex.h, pad, w, h };
}

function drawLayerImage(ctx, img, m, scale, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = m.opacity * alpha;
  ctx.translate(m.x * scale, m.y * scale);
  ctx.rotate((m.rot * Math.PI) / 180);
  ctx.scale(m.sx, m.sy);
  ctx.drawImage(img.src, 0, 0, img.sw, img.sh, -(img.w / 2 + m.anchor[0]) * scale - img.pad, -(img.h / 2 + m.anchor[1]) * scale - img.pad, img.sw, img.sh);
  ctx.restore();
}

function findFx(layer, type) {
  return layer.effects.find((fx) => fx.enabled && fx.type === type) || null;
}

export function renderLayer(ctx, layer, t, scale, extra, fps = 30) {
  const m = layerTransform(layer, t);
  const echo = findFx(layer, 'echo');
  const mb = findFx(layer, 'motionBlur');
  ctx.save();
  ctx.globalCompositeOperation = layer.blend || 'source-over';

  const drawEchoes = () => {
    const p = evalParams(echo, layerTime(layer, t));
    for (let k = Math.round(p.count); k >= 1; k--) {
      const te = t + k * p.time;
      if (te < layer.inPoint || te > layer.outPoint) continue;
      const img = renderLayerImage(layer, te, scale, extra);
      drawLayerImage(ctx, img, layerTransform(layer, te), scale, p.start * p.decay ** k);
    }
  };
  if (echo && evalParams(echo, t).behind) drawEchoes();

  if (m.opacity > 0.001 || mb) {
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
      ac.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const tau = t + shutter * (i / (n - 1) - 0.5);
        drawLayerImage(ac, img, layerTransform(layer, tau), scale, 1 / n);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(accumCanvas, 0, 0);
    } else {
      drawLayerImage(ctx, img, m, scale);
    }
  }

  if (echo && !evalParams(echo, t).behind) drawEchoes();
  ctx.restore();
}

export function renderFrame(ctx, proj, t, scale = 1, opts = {}) {
  project = proj;
  renderOpts = { final: !!opts.final };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = proj.background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = proj.layers.length - 1; i >= 0; i--) {
    const l = proj.layers[i];
    if (!l.visible || l.type === 'audio' || t < l.inPoint || t >= l.outPoint) continue;
    if (l.type === 'adjustment') {
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
      continue;
    }
    renderLayer(ctx, l, t, scale, null, proj.fps);
  }
  ctx.restore();
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
    if (!l.visible || l.locked || l.type === 'audio' || l.type === 'adjustment' || t < l.inPoint || t >= l.outPoint) continue;
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
