import { valueAt } from './anim.js';
import { EFFECT_MAP, makeCanvas } from './effects.js';

// Cache de mídia (imagens / vídeos) por src
const media = new Map();

export function getMedia(layer, onReady) {
  const src = layer.props.src;
  if (!src) return null;
  let m = media.get(src);
  if (!m) {
    if (layer.type === 'video') {
      const v = document.createElement('video');
      v.src = src; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      v.addEventListener('loadeddata', () => onReady?.(), { once: true });
      v.addEventListener('seeked', () => onReady?.());
      m = { el: v, kind: 'video' };
    } else {
      const img = new Image();
      img.onload = () => onReady?.();
      img.src = src;
      m = { el: img, kind: 'image' };
    }
    media.set(src, m);
  }
  return m;
}

/** Sincroniza vídeos com o tempo da timeline. */
export function syncVideos(project, t, playing) {
  for (const l of project.layers) {
    if (l.type !== 'video') continue;
    const m = media.get(l.props.src);
    if (!m) continue;
    const v = m.el;
    const local = t - l.inPoint;
    const active = l.visible && t >= l.inPoint && t < l.outPoint;
    if (!active || !playing) {
      if (!v.paused) v.pause();
      if (active && Math.abs(v.currentTime - local) > 0.03 && v.readyState >= 1) v.currentTime = Math.max(0, local);
    } else {
      if (Math.abs(v.currentTime - local) > 0.25) v.currentTime = Math.max(0, local);
      if (v.paused) v.play().catch(() => {});
    }
  }
}

const textMetricsCanvas = () => {
  if (!textMetricsCanvas.c) textMetricsCanvas.c = makeCanvas(4, 4).getContext('2d');
  return textMetricsCanvas.c;
};

function fontOf(p) { return `${p.fontWeight || 400} ${p.fontSize}px ${p.fontFamily}`; }

export function contentSize(layer) {
  const p = layer.props;
  if (layer.type === 'text') {
    const ctx = textMetricsCanvas();
    ctx.font = fontOf(p);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${p.letterSpacing || 0}px`;
    const lines = String(p.text).split('\n');
    const w = Math.max(1, ...lines.map((s) => ctx.measureText(s).width)) + (p.strokeWidth || 0) * 2 + 8;
    const h = lines.length * p.fontSize * p.lineHeight + (p.strokeWidth || 0) * 2 + 8;
    return { w, h };
  }
  return { w: p.width || 100, h: p.height || 100 };
}

function drawContent(ctx, layer, w, h, onReady) {
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
    case 'image':
    case 'video': {
      const m = getMedia(layer, onReady);
      if (m && (m.kind === 'image' ? m.el.complete && m.el.naturalWidth : m.el.readyState >= 2)) ctx.drawImage(m.el, 0, 0, w, h);
      else { ctx.fillStyle = '#333'; ctx.fillRect(0, 0, w, h); }
      break;
    }
    default:
  }
}

export function evalParams(fx, t) {
  const out = {};
  for (const [k, p] of Object.entries(fx.params)) out[k] = valueAt(p, t);
  return out;
}

/** Matriz de transformação da camada (em px da comp) — usada para desenhar e para hit-test. */
export function layerTransform(layer, t) {
  const tr = layer.transform;
  const pos = valueAt(tr.position, t);
  const sc = valueAt(tr.scale, t);
  const extra = { dx: 0, dy: 0, rot: 0, scale: 1, opacity: 1 };
  for (const fx of layer.effects) {
    if (!fx.enabled) continue;
    const def = EFFECT_MAP[fx.type];
    if (!def?.transform) continue;
    const r = def.transform(evalParams(fx, t), { t });
    extra.dx += r.dx || 0; extra.dy += r.dy || 0; extra.rot += r.rot || 0;
    extra.scale *= r.scale ?? 1; extra.opacity *= r.opacity ?? 1;
  }
  return {
    x: pos[0] + extra.dx,
    y: pos[1] + extra.dy,
    sx: (sc[0] / 100) * extra.scale,
    sy: (sc[1] / 100) * extra.scale,
    rot: valueAt(tr.rotation, t) + extra.rot,
    opacity: Math.max(0, Math.min(1, (valueAt(tr.opacity, t) / 100) * extra.opacity)),
    anchor: valueAt(tr.anchor, t),
  };
}

export function renderLayer(ctx, layer, t, scale, onReady) {
  const { w, h } = contentSize(layer);
  const m = layerTransform(layer, t);
  if (m.opacity <= 0.001) return;

  const active = layer.effects.filter((fx) => fx.enabled && EFFECT_MAP[fx.type]?.render);
  const evaluated = active.map((fx) => ({ def: EFFECT_MAP[fx.type], p: evalParams(fx, t) }));
  let pad = 2;
  for (const { def, p } of evaluated) pad += def.pad ? Math.max(0, def.pad(p)) : 0;
  pad = Math.min(Math.ceil(pad * scale), 2000);

  let off = makeCanvas(w * scale + pad * 2, h * scale + pad * 2);
  const ox = off.getContext('2d');
  ox.translate(pad, pad);
  ox.scale(scale, scale);
  drawContent(ox, layer, w, h, onReady);

  const env = { t, scale, pad, w, h };
  for (const { def, p } of evaluated) {
    try { off = def.render(off, p, env) || off; } catch (e) { console.warn('efeito falhou', def.type, e); }
  }

  ctx.save();
  ctx.globalAlpha = m.opacity;
  ctx.globalCompositeOperation = layer.blend || 'source-over';
  ctx.translate(m.x * scale, m.y * scale);
  ctx.rotate((m.rot * Math.PI) / 180);
  ctx.scale(m.sx, m.sy);
  ctx.drawImage(off, -(w / 2 + m.anchor[0]) * scale - pad, -(h / 2 + m.anchor[1]) * scale - pad);
  ctx.restore();
}

export function renderFrame(ctx, project, t, scale = 1, onReady) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = project.background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = project.layers.length - 1; i >= 0; i--) {
    const l = project.layers[i];
    if (!l.visible || t < l.inPoint || t >= l.outPoint) continue;
    renderLayer(ctx, l, t, scale, onReady);
  }
  ctx.restore();
}

/** Converte um ponto da comp para o espaço local da camada (centro = 0,0). */
export function toLayerSpace(layer, t, x, y) {
  const m = layerTransform(layer, t);
  let dx = x - m.x, dy = y - m.y;
  const r = (-m.rot * Math.PI) / 180;
  const rx = dx * Math.cos(r) - dy * Math.sin(r);
  const ry = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: rx / (m.sx || 1e-6) + m.anchor[0], y: ry / (m.sy || 1e-6) + m.anchor[1] };
}

export function hitTest(project, t, x, y) {
  for (const l of project.layers) {
    if (!l.visible || l.locked || t < l.inPoint || t >= l.outPoint) continue;
    const { w, h } = contentSize(l);
    const p = toLayerSpace(l, t, x, y);
    if (Math.abs(p.x) <= w / 2 && Math.abs(p.y) <= h / 2) return l;
  }
  return null;
}

/** Cantos da camada em coordenadas da comp (para desenhar a caixa de seleção). */
export function layerCorners(layer, t) {
  const { w, h } = contentSize(layer);
  const m = layerTransform(layer, t);
  const r = (m.rot * Math.PI) / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cx, cy]) => {
    const lx = (cx * w) / 2 - m.anchor[0], ly = (cy * h) / 2 - m.anchor[1];
    const sx = lx * m.sx, sy = ly * m.sy;
    return [m.x + sx * Math.cos(r) - sy * Math.sin(r), m.y + sx * Math.sin(r) + sy * Math.cos(r)];
  });
}
