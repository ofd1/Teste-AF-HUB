// Face tracking: detecta o rosto em cada quadro (MediaPipe Face Detector / BlazeFace, tudo no aparelho) e gera
// keyframes de posição, escala e rotação (pela linha dos olhos). Dois usos:
//  - "Seguir o rosto": outra camada (texto, emoji, efeito) acompanha o rosto;
//  - "Câmera no rosto": o próprio vídeo é reenquadrado para manter o rosto centralizado e do mesmo tamanho.
import { sourceTime } from './timing.js';
import { contentSize, layerTransform } from './renderer.js';
import { valueAt, sortKeys } from './anim.js';
import { setExporting } from './media.js';
import { loadVideo, seek } from './tracker.js';

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
let detPromise = null;

/** Carrega o detector de rosto (uma vez). */
export function ensureFaceModel() {
  if (!detPromise) {
    detPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import(`${BASE}vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: `${BASE}models/blaze_face_short_range.tflite`, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.4 });
      try { return await FaceDetector.createFromOptions(fileset, opts('GPU')); } catch { return FaceDetector.createFromOptions(fileset, opts('CPU')); }
    })();
    detPromise.catch(() => { detPromise = null; });
  }
  return detPromise;
}

const AW = 512; // largura de análise

/** Escolhe o rosto: o maior no primeiro quadro (ou o mais perto do toque); depois o mais perto do anterior. */
function pick(dets, prev, hint) {
  if (!dets.length) return null;
  const score = (d) => {
    const b = d.boundingBox, cx = b.originX + b.width / 2, cy = b.originY + b.height / 2;
    if (prev) return Math.hypot(cx - prev.cx, cy - prev.cy) - b.width * 0.1;
    if (hint) return Math.hypot(cx - hint[0], cy - hint[1]);
    return -b.width * b.height;
  };
  return dets.slice().sort((a, b) => score(a) - score(b))[0];
}

/**
 * Rastreia o rosto numa camada de vídeo de t0 a t1. hint = ponto (pixels de análise) para escolher entre vários rostos.
 * Retorna [{ t, x, y, size, angle, lx, ly }] — x/y em coordenadas da composição, lx/ly no espaço da camada.
 */
export async function trackFace({ layer, project, t0, t1, hintComp, onProgress, isCancelled }) {
  const det = await ensureFaceModel();
  setExporting(true);
  try {
    const v = await loadVideo(layer.props.src);
    const vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
    const aw = Math.min(AW, vw), ah = Math.round((aw * vh) / vw);
    const c = document.createElement('canvas');
    c.width = aw; c.height = ah;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const { w, h } = contentSize(layer, project);
    const fps = project.fps;
    const raw = [];
    let prev = null;
    let hint = null;
    if (hintComp) {
      const m = layerTransform(layer, t0), r = (-m.rot * Math.PI) / 180, dx = hintComp[0] - m.x, dy = hintComp[1] - m.y;
      const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / (m.sx || 1) + m.anchor[0], ly = (dx * Math.sin(r) + dy * Math.cos(r)) / (m.sy || 1) + m.anchor[1];
      hint = [((lx + w / 2) / w) * aw, ((ly + h / 2) / h) * ah];
    }
    const n = Math.max(1, Math.round((t1 - t0) * fps) + 1);
    for (let i = 0; i < n; i++) {
      if (isCancelled?.()) break;
      const t = +(t0 + i / fps).toFixed(5);
      await seek(v, sourceTime(layer, t) + 0.3 / fps);
      ctx.drawImage(v, 0, 0, aw, ah);
      const res = det.detect(c);
      const d = pick(res.detections || [], prev, hint);
      if (d) {
        const b = d.boundingBox, k = d.keypoints || [];
        let angle = prev ? prev.angle : 0;
        // keypoints normalizados: 0 = olho direito, 1 = olho esquerdo (da pessoa)
        if (k.length >= 2) angle = (Math.atan2((k[1].y - k[0].y) * ah, (k[1].x - k[0].x) * aw) * 180) / Math.PI;
        prev = { cx: b.originX + b.width / 2, cy: b.originY + b.height / 2, size: b.width, angle };
        raw.push({ t, ...prev, ok: true });
      } else raw.push({ t, ...(prev || { cx: aw / 2, cy: ah / 2, size: aw / 4, angle: 0 }), ok: false });
      onProgress?.((i + 1) / n);
    }
    v.removeAttribute('src');
    v.load();
    if (!raw.some((r) => r.ok)) throw new Error('nenhum rosto encontrado nesse trecho');
    // preenche o começo sem rosto com a primeira detecção e suaviza (tira o tremido do detector)
    const first = raw.find((r) => r.ok);
    for (const r of raw) { if (r.ok) break; Object.assign(r, { cx: first.cx, cy: first.cy, size: first.size, angle: first.angle }); }
    const sm = smooth(raw);
    // pixels de análise → espaço da camada → composição
    return sm.map((r) => {
      const lx = (r.cx / aw) * w - w / 2, ly = (r.cy / ah) * h - h / 2;
      const m = layerTransform(layer, r.t), rr = (m.rot * Math.PI) / 180;
      const sx = (lx - m.anchor[0]) * m.sx, sy = (ly - m.anchor[1]) * m.sy;
      return { t: r.t, x: m.x + sx * Math.cos(rr) - sy * Math.sin(rr), y: m.y + sx * Math.sin(rr) + sy * Math.cos(rr), size: (r.size / aw) * w * m.sx, angle: r.angle + m.rot, lx, ly, lsize: (r.size / aw) * w };
    });
  } finally { setExporting(false); }
}

/** Suavização de ida e volta (sem atraso): média exponencial nos dois sentidos. */
function smooth(arr, a = 0.45) {
  const keys = ['cx', 'cy', 'size', 'angle'];
  const f = arr.map((r) => ({ ...r }));
  for (let i = 1; i < f.length; i++) for (const k of keys) f[i][k] = f[i - 1][k] + (f[i][k] - f[i - 1][k]) * a;
  for (let i = f.length - 2; i >= 0; i--) for (const k of keys) f[i][k] = f[i + 1][k] + (f[i][k] - f[i + 1][k]) * a;
  return f;
}

const setKeys = (prop, t0, t1, list) => {
  prop.keys = (prop.keys || []).filter((k) => k.t < t0 - 1e-4 || k.t > t1 + 1e-4);
  for (const [t, v] of list) prop.keys.push({ t, v, ease: 'linear' });
  sortKeys(prop);
};

/** Outra camada segue o rosto (mantém a distância e o tamanho relativos do primeiro quadro). */
export function applyFaceFollow(target, track, { position = true, scale = true, rotation = true } = {}) {
  if (!track.length) return 0;
  const t0 = track[0].t, t1 = track[track.length - 1].t, f0 = track[0];
  const tr = target.transform;
  if (position) {
    const base = valueAt(tr.position, t0);
    // a posição acompanha o centro do rosto; com escala, a distância inicial cresce junto com o rosto
    setKeys(tr.position, t0, t1, track.map((p) => { const k = scale ? p.size / f0.size : 1; return [p.t, [Math.round((p.x + (base[0] - f0.x) * k) * 10) / 10, Math.round((p.y + (base[1] - f0.y) * k) * 10) / 10]]; }));
  }
  if (scale) {
    const s0 = valueAt(tr.scale, t0);
    setKeys(tr.scale, t0, t1, track.map((p) => { const k = p.size / f0.size; return [p.t, [Math.round(s0[0] * k * 10) / 10, Math.round(s0[1] * k * 10) / 10]]; }));
  }
  if (rotation) {
    const r0 = valueAt(tr.rotation, t0);
    setKeys(tr.rotation, t0, t1, track.map((p) => [p.t, Math.round((r0 + p.angle - f0.angle) * 100) / 100]));
  }
  return track.length;
}

/**
 * "Câmera no rosto": reenquadra o próprio vídeo — âncora no rosto, posição no ponto escolhido da tela,
 * escala para o rosto ficar do tamanho `faceFrac` da largura da composição, e (opcional) endireita a cabeça.
 */
export function applyFaceCamera(layer, track, project, { faceFrac = 0.4, center = [0.5, 0.42], level = false, follow = 1 } = {}) {
  if (!track.length) return 0;
  const t0 = track[0].t, t1 = track[track.length - 1].t;
  const tr = layer.transform;
  const s0 = valueAt(tr.scale, t0), p0 = valueAt(tr.position, t0), a0 = valueAt(tr.anchor, t0), r0 = valueAt(tr.rotation, t0);
  const cx = project.width * center[0], cy = project.height * center[1];
  const mean = track.reduce((s, p) => s + p.lsize, 0) / track.length;
  setKeys(tr.anchor, t0, t1, track.map((p) => [p.t, [Math.round((a0[0] + (p.lx - a0[0]) * follow) * 10) / 10, Math.round((a0[1] + (p.ly - a0[1]) * follow) * 10) / 10]]));
  setKeys(tr.position, t0, t1, track.map((p) => [p.t, [Math.round((p0[0] + (cx - p0[0]) * follow) * 10) / 10, Math.round((p0[1] + (cy - p0[1]) * follow) * 10) / 10]]));
  setKeys(tr.scale, t0, t1, track.map((p) => {
    const want = ((project.width * faceFrac) / Math.max(1, p.lsize * 0.6 + mean * 0.4)) * 100;
    const v = s0[0] + (want - s0[0]) * follow;
    return [p.t, [Math.round(v * 10) / 10, Math.round(v * (s0[1] / (s0[0] || 1)) * 10) / 10]];
  }));
  if (level) setKeys(tr.rotation, t0, t1, track.map((p) => [p.t, Math.round((r0 - (p.angle - r0)) * 100) / 100]));
  return track.length;
}
