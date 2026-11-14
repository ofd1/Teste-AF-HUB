// Remoção de fundo por IA (MediaPipe Image Segmenter), tudo no aparelho — nada é enviado para servidores.
// Os arquivos ficam em vendor/mediapipe e só são baixados quando o efeito "Remover fundo" é usado.
const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
export const BG_MODELS = {
  1: { file: 'deeplab_v3.tflite', label: 'Pessoa – corpo inteiro', person: 15 }, // DeepLab v3 (classe 15 = pessoa)
  2: { file: 'selfie_segmenter.tflite', label: 'Pessoa – close / meio corpo', person: 0 },
};

const segmenters = new Map(); // modelo -> { seg, ready, error, promise }
let listener = () => {};
export function setBgListener(fn) { listener = fn; }

/** Carrega o modelo (uma vez). Resolve quando pronto. */
export function ensureBgModel(model = 1) {
  const m = BG_MODELS[model] || BG_MODELS[1];
  let st = segmenters.get(m.file);
  if (st) return st.promise;
  st = { seg: null, ready: false, error: null };
  st.promise = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import(`${BASE}vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: `${BASE}models/${m.file}`, delegate }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
    try { st.seg = await ImageSegmenter.createFromOptions(fileset, opts('GPU')); } catch { st.seg = await ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
    st.ready = true;
    listener();
  })().catch((e) => { st.error = e; console.warn('remover fundo: modelo não carregou', e); listener(); });
  segmenters.set(m.file, st);
  return st.promise;
}

export function bgStatus(model = 1) {
  const st = segmenters.get((BG_MODELS[model] || BG_MODELS[1]).file);
  return !st ? 'idle' : st.ready ? 'ready' : st.error ? 'error' : 'loading';
}

// cache de máscaras (mesmo quadro = mesma máscara) e máscara anterior por camada (suavização no tempo)
const cache = new Map();
const MASK_KEEP = typeof navigator !== 'undefined' && /iP(hone|ad|od)|Android/.test(navigator.userAgent) ? 24 : 90;
const prev = new Map();
const work = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * Máscara da pessoa (canvas com alfa) para o canvas de origem, ou null se o modelo ainda não estiver pronto.
 * key identifica o quadro; layerKey + t permitem suavizar a máscara entre quadros vizinhos (menos tremido).
 */
export function personMask(source, { model = 1, key, layerKey, t = 0, smooth = 0.4, fps = 30 }) {
  const m = BG_MODELS[model] || BG_MODELS[1];
  const st = segmenters.get(m.file);
  if (!st?.ready) { ensureBgModel(model); return null; }
  const ck = `${key}|${model}`;
  if (cache.has(ck)) return cache.get(ck);
  // o modelo enxerga um quadrado pequeno (~256 px): imagens verticais/horizontais são divididas em blocos
  // quadrados sobrepostos ao longo do lado maior, e as máscaras são combinadas (o jogador inteiro fica nítido)
  const W = source.width, H = source.height, side = Math.min(W, H), long = Math.max(W, H);
  const n = Math.max(1, Math.ceil(long / side - 0.15));
  const S = 320; // resolução de cada bloco
  const outW = Math.round((W / side) * S), outH = Math.round((H / side) * S);
  const arr = new Float32Array(outW * outH);
  const wsum = new Float32Array(outW * outH);
  work.width = S; work.height = S;
  const wctx = work.getContext('2d');
  for (let k = 0; k < n; k++) {
    const off = n === 1 ? (long - side) / 2 : ((long - side) * k) / (n - 1);
    const sx = W >= H ? off : 0, sy = W >= H ? 0 : off;
    wctx.drawImage(source, sx, sy, side, side, 0, 0, S, S);
    const res = st.seg.segment(work);
    const masks = res.confidenceMasks || [];
    const mk = masks[Math.min(m.person, masks.length - 1)];
    if (!mk) { masks.forEach((x) => x.close()); continue; }
    const mw = mk.width, mh = mk.height, data = mk.getAsFloat32Array();
    const ox = Math.round((sx / side) * S), oy = Math.round((sy / side) * S);
    for (let y = 0; y < S; y++) {
      const my = Math.min(mh - 1, Math.floor((y / S) * mh));
      const ty = oy + y; if (ty < 0 || ty >= outH) continue;
      // peso maior no meio do bloco: emendas sem degrau
      const wy = n > 1 ? 0.15 + Math.min(y, S - 1 - y) / S : 1;
      for (let x = 0; x < S; x++) {
        const tx = ox + x; if (tx < 0 || tx >= outW) continue;
        const v = data[my * mw + Math.min(mw - 1, Math.floor((x / S) * mw))];
        const wx = n > 1 && W >= H ? 0.15 + Math.min(x, S - 1 - x) / S : 1;
        const w = wx * wy;
        arr[ty * outW + tx] += v * w; wsum[ty * outW + tx] += w;
      }
    }
    masks.forEach((x) => x.close());
  }
  for (let i = 0; i < arr.length; i++) arr[i] = wsum[i] > 0 ? arr[i] / wsum[i] : 0;
  const w = outW, h = outH;
  const pv = prev.get(layerKey);
  if (pv && pv.w === w && pv.h === h && Math.abs(pv.t - t) < 2.5 / fps && smooth > 0) {
    for (let i = 0; i < arr.length; i++) arr[i] = arr[i] * (1 - smooth) + pv.arr[i] * smooth;
  }
  prev.set(layerKey, { arr, w, h, t });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < arr.length; i++) { const v = Math.max(0, Math.min(255, arr[i] * 255)); img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  cache.set(ck, c);
  // guarda mais máscaras (pequenas, ~320 px): pré-renderização, play e exportação reaproveitam em vez de rodar a IA de novo
  if (cache.size > MASK_KEEP) { const k0 = cache.keys().next().value, old = cache.get(k0); cache.delete(k0); if (old) { old.width = 0; old.height = 0; } }
  return c;
}

/** Antes de exportar: garante que todos os modelos usados estão carregados. */
export async function prepareBgModels(layers) {
  const models = new Set();
  for (const l of layers) for (const fx of l.effects || []) if (fx.enabled && fx.type === 'bgRemove') models.add(Math.round(fx.params.model?.value ?? 1));
  await Promise.all([...models].map((m) => ensureBgModel(m)));
}
