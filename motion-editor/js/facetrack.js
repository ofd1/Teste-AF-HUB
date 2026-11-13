// Face tracking: detecta o rosto em cada quadro (MediaPipe Face Detector / BlazeFace, tudo no aparelho) e gera
// keyframes de posição, escala e rotação (pela linha dos olhos). Dois usos:
//  - "Seguir o rosto": outra camada (texto, emoji, efeito) acompanha o rosto;
//  - "Câmera no rosto": o próprio vídeo é reenquadrado para manter o rosto centralizado e do mesmo tamanho.
import { sourceTime } from './timing.js';
import { contentSize, layerTransform, toLayerSpace } from './renderer.js';
import { valueAt, sortKeys } from './anim.js';
import { setExporting } from './media.js';
import { frameSource, yieldUI } from './tracker.js';

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
let detPromise = null;

/** Carrega o detector de rosto (uma vez). */
export function ensureFaceModel() {
  if (!detPromise) {
    detPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import(`${BASE}vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: `${BASE}models/blaze_face_short_range.tflite`, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.4 });
      return FaceDetector.createFromOptions(fileset, opts('CPU')); // CPU: não disputa a GPU com a prévia (antes travava/caía)
    })();
    detPromise.catch(() => { detPromise = null; });
  }
  return detPromise;
}

// Face Tracking (Detailed Features) como no After Effects: pontos do rosto pelo MediaPipe Face Landmarker (478 pontos).
// [chave, nome, índices dos landmarks (média)]
export const FACE_FEATURES = [
  ['centro', 'Rosto (centro)', null], ['testa', 'Testa', [10]], ['entreOlhos', 'Entre os olhos', [168]],
  ['olhoD', 'Olho direito', [33, 133]], ['olhoE', 'Olho esquerdo', [362, 263]], ['pupilaD', 'Pupila direita', [468]], ['pupilaE', 'Pupila esquerda', [473]],
  ['sobrD', 'Sobrancelha direita', [70, 105, 107]], ['sobrE', 'Sobrancelha esquerda', [300, 334, 336]],
  ['nariz', 'Ponta do nariz', [1]], ['boca', 'Boca', [13, 14]], ['bocaD', 'Canto da boca direito', [61]], ['bocaE', 'Canto da boca esquerdo', [291]],
  ['queixo', 'Queixo', [152]], ['orelhaD', 'Orelha direita', [234]], ['orelhaE', 'Orelha esquerda', [454]],
];
let lmPromise = null;
/** Carrega o Face Landmarker (pontos detalhados). Se não der, o tracker usa o detector simples (Outline). */
export function ensureFaceLandmarker() {
  if (!lmPromise) {
    lmPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import(`${BASE}vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: `${BASE}models/face_landmarker.task`, delegate }, runningMode: 'IMAGE', numFaces: 2, minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4 });
      return FaceLandmarker.createFromOptions(fileset, opts('CPU')); // CPU (WASM SIMD): estável e rápido em 384 px
    })();
    lmPromise.catch(() => { lmPromise = null; });
  }
  return lmPromise;
}

const AW = 384; // largura de análise (o modelo trabalha em 192–256 px; maior só pesa)

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
 * Analisa o rosto quadro a quadro em `times` (em ordem de análise: para frente ou para trás).
 * hintLocal = ponto no conteúdo da camada para escolher o rosto (ou o último rosto rastreado).
 * Devolve amostras cruas no espaço da camada: [{ t, lx, ly, lsize, angle, ok }].
 */
export async function analyzeFace({ layer, project, times, hintLocal, onFrame, isCancelled, detailed = true }) {
  let lm = null;
  if (detailed) { try { lm = await ensureFaceLandmarker(); } catch { lm = null; } }
  const det = lm ? null : await ensureFaceModel();
  setExporting(true);
  const fs = await frameSource(layer.props.src);
  try {
    const vw = fs.w, vh = fs.h;
    const aw = Math.min(AW, vw), ah = Math.round((aw * vh) / vw);
    const c = document.createElement('canvas');
    c.width = aw; c.height = ah;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const { w, h } = contentSize(layer, project);
    const fps = project.fps;
    const hint = hintLocal ? [((hintLocal.lx + w / 2) / w) * aw, ((hintLocal.ly + h / 2) / h) * ah] : null;
    let prev = hintLocal?.lsize ? { cx: hint[0], cy: hint[1], size: (hintLocal.lsize / w) * aw, angle: hintLocal.angle || 0 } : null;
    const out = [];
    for (let i = 0; i < times.length; i++) {
      if (isCancelled?.()) break;
      const t = times[i];
      await fs.draw(ctx, sourceTime(layer, t) + 0.3 / fps, aw, ah);
      let smp;
      if (lm) {
        // Detailed Features: escolhe o rosto mais perto do anterior (ou do toque / o maior) e guarda os pontos nomeados
        const faces = (lm.detect(c).faceLandmarks || []).map((pts) => {
          let x0 = 1, x1 = 0, y0 = 1, y1 = 0; for (const q of pts) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
          return { pts, cx: ((x0 + x1) / 2) * aw, cy: ((y0 + y1) / 2) * ah, size: (x1 - x0) * aw };
        });
        const sc = (f) => (prev ? Math.hypot(f.cx - prev.cx, f.cy - prev.cy) : hint ? Math.hypot(f.cx - hint[0], f.cy - hint[1]) : -f.size);
        const f = faces.sort((a, b) => sc(a) - sc(b))[0];
        if (f) {
          const L = (i) => f.pts[i] || f.pts[0];
          const angle = (Math.atan2((L(263).y - L(33).y) * ah, (L(263).x - L(33).x) * aw) * 180) / Math.PI;
          prev = { cx: f.cx, cy: f.cy, size: f.size, angle };
          const pts = {};
          for (const [key, , idx] of FACE_FEATURES) {
            if (!idx) continue;
            const x = idx.reduce((s2, i) => s2 + L(i).x, 0) / idx.length, y = idx.reduce((s2, i) => s2 + L(i).y, 0) / idx.length;
            pts[key] = [+(x * w - w / 2).toFixed(2), +(y * h - h / 2).toFixed(2)];
          }
          smp = { t, ok: true, conf: 1, pts };
        } else smp = { t, ok: false, conf: 0 };
      } else {
      const res = det.detect(c);
      const d = pick(res.detections || [], prev, hint);
      if (d) {
        const b = d.boundingBox, k = d.keypoints || [];
        let angle = prev ? prev.angle : 0;
        // keypoints normalizados: 0 = olho direito, 1 = olho esquerdo (da pessoa)
        if (k.length >= 2) angle = (Math.atan2((k[1].y - k[0].y) * ah, (k[1].x - k[0].x) * aw) * 180) / Math.PI;
        prev = { cx: b.originX + b.width / 2, cy: b.originY + b.height / 2, size: b.width, angle };
        smp = { t, ok: true, conf: d.categories?.[0]?.score ?? 1 };
      } else smp = { t, ok: false, conf: 0 };
      }
      const P = prev || { cx: aw / 2, cy: ah / 2, size: aw / 4, angle: 0 };
      Object.assign(smp, { lx: (P.cx / aw) * w - w / 2, ly: (P.cy / ah) * h - h / 2, lsize: (P.size / aw) * w, angle: P.angle });
      out.push(smp);
      onFrame?.(smp, (i + 1) / times.length);
      await yieldUI();
    }
    return out;
  } finally { fs.close(); setExporting(false); }
}

/** Amostras cruas (espaço da camada) → rastro suavizado em coordenadas da composição (formato de trackFace). */
export function faceSamplesToTrack(layer, samples, smoothAmt = 0.45, { part = 'centro', offset = [0, 0] } = {}) {
  // ponto seguido (Attach Point): parte escolhida do rosto (Detailed Features) + deslocamento em % do tamanho do rosto,
  // girando junto com a cabeça — como mover o ponto de anexação no AE
  const at = (r) => {
    const q = part !== 'centro' && r.pts?.[part] ? r.pts[part] : [r.lx, r.ly];
    const a = ((r.angle || 0) * Math.PI) / 180, ox = (offset[0] / 100) * r.lsize, oy = (offset[1] / 100) * r.lsize;
    return [q[0] + ox * Math.cos(a) - oy * Math.sin(a), q[1] + ox * Math.sin(a) + oy * Math.cos(a)];
  };
  const raw = samples.slice().sort((a, b) => a.t - b.t).map((r) => { const [cx, cy] = at(r); return { ...r, cx, cy, size: r.lsize }; });
  if (!raw.some((r) => r.ok)) throw new Error('nenhum rosto encontrado nesse trecho');
  const first = raw.find((r) => r.ok);
  for (const r of raw) { if (r.ok) break; Object.assign(r, { cx: first.cx, cy: first.cy, size: first.size, angle: first.angle }); }
  const sm = smoothAmt < 1 ? smooth(raw, smoothAmt) : raw;
  return sm.map((r) => {
    const m = layerTransform(layer, r.t), rr = (m.rot * Math.PI) / 180;
    const sx = (r.cx - m.anchor[0]) * m.sx, sy = (r.cy - m.anchor[1]) * m.sy;
    return { t: r.t, x: m.x + sx * Math.cos(rr) - sy * Math.sin(rr), y: m.y + sx * Math.sin(rr) + sy * Math.cos(rr), size: r.size * m.sx, angle: r.angle + m.rot, lx: r.cx, ly: r.cy, lsize: r.size };
  });
}

/** Rastreia o rosto de t0 a t1 (atalho usado pelo modo rápido). */
export async function trackFace({ layer, project, t0, t1, hintComp, onProgress, isCancelled }) {
  const fps = project.fps, n = Math.max(1, Math.round((t1 - t0) * fps) + 1);
  const times = Array.from({ length: n }, (_, i) => +(t0 + i / fps).toFixed(5));
  let hintLocal = null;
  if (hintComp) { const p = toLayerSpace(layer, t0, hintComp[0], hintComp[1]); hintLocal = { lx: p.x, ly: p.y }; }
  const s = await analyzeFace({ layer, project, times, hintLocal, onFrame: (_, f) => onProgress?.(f), isCancelled });
  return faceSamplesToTrack(layer, s);
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
export function applyFaceCamera(layer, track, project, { faceFrac = 0.4, center = [0.5, 0.5], level = false, follow = 1, scale = true } = {}) {
  if (!track.length) return 0;
  const t0 = track[0].t, t1 = track[track.length - 1].t;
  const tr = layer.transform;
  const s0 = valueAt(tr.scale, t0), p0 = valueAt(tr.position, t0), a0 = valueAt(tr.anchor, t0), r0 = valueAt(tr.rotation, t0);
  const cx = project.width * center[0], cy = project.height * center[1];
  // câmera segue o ponto escolhido: a âncora vai para o ponto e a posição fica fixa no lugar da tela —
  // o vídeo se move por baixo, como um Stabilize/Track Camera do AE
  setKeys(tr.anchor, t0, t1, track.map((p) => [p.t, [Math.round((a0[0] + (p.lx - a0[0]) * follow) * 10) / 10, Math.round((a0[1] + (p.ly - a0[1]) * follow) * 10) / 10]]));
  setKeys(tr.position, t0, t1, track.map((p) => [p.t, [Math.round((p0[0] + (cx - p0[0]) * follow) * 10) / 10, Math.round((p0[1] + (cy - p0[1]) * follow) * 10) / 10]]));
  if (scale) {
    const mean = track.reduce((s2, p) => s2 + p.lsize, 0) / track.length;
    setKeys(tr.scale, t0, t1, track.map((p) => {
      const want = ((project.width * faceFrac) / Math.max(1, p.lsize * 0.6 + mean * 0.4)) * 100;
      const v = s0[0] + (want - s0[0]) * follow;
      return [p.t, [Math.round(v * 10) / 10, Math.round(v * (s0[1] / (s0[0] || 1)) * 10) / 10]];
    }));
  } else {
    // sem escala: aproxima o suficiente para a borda do vídeo nunca aparecer quando ele se move
    let need = 0;
    const { w, h } = contentSize(layer, project);
    for (const p of track) need = Math.max(need, (Math.abs(p.lx - a0[0]) * 2) / w, (Math.abs(p.ly - a0[1]) * 2) / h);
    const k = 1 + need * follow * 1.05;
    const v = s0[0] * k;
    tr.scale.value = [Math.round(v * 10) / 10, Math.round(s0[1] * k * 10) / 10];
  }
  if (level) setKeys(tr.rotation, t0, t1, track.map((p) => [p.t, Math.round((r0 - (p.angle - r0)) * 100) / 100]));
  return track.length;
}

/** Track Motion com a câmera seguindo o ponto (sem rosto): amostras de ponto → mesmo reenquadramento. */
export function applyPointCamera(layer, samples, project, { smoothAmt = 0.5, follow = 1, center = [0.5, 0.5] } = {}) {
  const raw = samples.slice().sort((a, b) => a.t - b.t).map((r) => ({ ...r, cx: r.lx, cy: r.ly, size: 1, angle: 0 }));
  const sm = smoothAmt < 1 ? smooth(raw, smoothAmt) : raw;
  return applyFaceCamera(layer, sm.map((r) => ({ t: r.t, lx: r.cx, ly: r.cy, lsize: 1, angle: 0 })), project, { follow, center, scale: false });
}

/** Face Track Points (Detailed Features): um Null por ponto do rosto, com keyframes de posição — como no AE. */
export function faceTrackPointNulls(layer, samples, project, LAYER_FACTORIES, smoothAmt = 0.55, keys = null) {
  const ok = samples.filter((r) => r.pts);
  if (!ok.length) throw new Error('rode a análise em "Detailed Features" primeiro');
  const out = [];
  for (const [key, label] of FACE_FEATURES) {
    if (key === 'centro' || (keys && !keys.includes(key))) continue;
    const track = faceSamplesToTrack(layer, samples, smoothAmt, { part: key });
    const n = LAYER_FACTORIES.null(project);
    n.name = `${label} · ${layer.name}`; n.inPoint = layer.inPoint; n.outPoint = layer.outPoint;
    n.transform.position.value = [track[0].x, track[0].y];
    n.transform.position.keys = track.map((p) => ({ t: p.t, v: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10], ease: 'linear' }));
    out.push(n);
  }
  return out;
}
