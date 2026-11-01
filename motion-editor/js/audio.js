// Áudio: camadas de música com reprodução sincronizada (WebAudio), forma de onda e mixagem offline.
const buffers = new Map(); // src -> AudioBuffer
const peaksCache = new Map();
let ctx = null;
let playing = [];

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export async function loadAudio(src) {
  if (buffers.has(src)) return buffers.get(src);
  const data = await (await fetch(src)).arrayBuffer();
  const buf = await audioCtx().decodeAudioData(data);
  buffers.set(src, buf);
  return buf;
}

export function audioBuffer(src) { return buffers.get(src) || null; }

/** Picos normalizados (para desenhar a forma de onda). */
export function peaks(src, buckets = 2000) {
  const key = `${src}|${buckets}`;
  if (peaksCache.has(key)) return peaksCache.get(key);
  const buf = buffers.get(src);
  if (!buf) return null;
  const ch = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / buckets));
  const out = new Float32Array(Math.ceil(ch.length / step));
  for (let i = 0, j = 0; i < ch.length; i += step, j++) {
    let m = 0;
    for (let k = i; k < Math.min(i + step, ch.length); k += 4) m = Math.max(m, Math.abs(ch[k]));
    out[j] = m;
  }
  peaksCache.set(key, { data: out, duration: buf.duration });
  return peaksCache.get(key);
}

function audioLayers(project) {
  return project.layers.filter((l) => l.type === 'audio' && l.visible && !l.props.muted && buffers.has(l.props.src));
}

/** Inicia a reprodução de todas as camadas de áudio a partir do tempo t. */
export function playAudio(project, t) {
  stopAudio();
  const ac = audioCtx();
  if (ac.state === 'suspended') ac.resume();
  const now = ac.currentTime + 0.03;
  for (const l of audioLayers(project)) {
    if (t >= l.outPoint) continue;
    const buf = buffers.get(l.props.src);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.value = (l.props.volume ?? 100) / 100;
    src.connect(gain).connect(ac.destination);
    const startAt = Math.max(0, l.inPoint - t);
    const offset = (l.props.sourceStart || 0) + Math.max(0, t - l.inPoint);
    const dur = l.outPoint - Math.max(t, l.inPoint);
    if (offset >= buf.duration) continue;
    src.start(now + startAt, offset, dur);
    playing.push(src);
  }
}

export function stopAudio() {
  for (const s of playing) { try { s.stop(); } catch { /* já parado */ } }
  playing = [];
}

/** Mixa o áudio do projeto (para exportação). */
export async function renderMix(project, sampleRate = 48000) {
  const layers = audioLayers(project);
  if (!layers.length) return null;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oac = new OAC(2, Math.ceil(project.duration * sampleRate), sampleRate);
  for (const l of layers) {
    const buf = buffers.get(l.props.src);
    const src = oac.createBufferSource();
    src.buffer = buf;
    const gain = oac.createGain();
    gain.gain.value = (l.props.volume ?? 100) / 100;
    src.connect(gain).connect(oac.destination);
    const offset = l.props.sourceStart || 0;
    if (offset < buf.duration) src.start(Math.max(0, l.inPoint), offset, Math.max(0, l.outPoint - l.inPoint));
  }
  return oac.startRendering();
}

/**
 * Detecção simples de batidas (fluxo de energia). Retorna tempos (s) no arquivo de áudio.
 * sensitivity 0..1 (maior = mais marcadores).
 */
export function detectBeats(src, sensitivity = 0.5) {
  const buf = buffers.get(src);
  if (!buf) return [];
  return detectBeatsFromSamples(buf.getChannelData(0), buf.sampleRate, sensitivity);
}

export function detectBeatsFromSamples(ch, sampleRate, sensitivity = 0.5) {
  const win = 1024;
  const n = Math.floor(ch.length / win);
  const energy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * win; j < (i + 1) * win; j++) e += ch[j] * ch[j];
    energy[i] = e / win;
  }
  const hist = 43; // ~1 s de histórico
  const k = 1.6 - sensitivity * 0.6;
  const minGap = Math.round((0.22 * sampleRate) / win);
  const out = [];
  let last = -minGap;
  for (let i = 1; i < n - 1; i++) {
    let avg = 0;
    const a = Math.max(0, i - hist);
    for (let j = a; j < i; j++) avg += energy[j];
    avg /= Math.max(1, i - a);
    const isPeak = energy[i] > energy[i - 1] && energy[i] >= energy[i + 1];
    if (isPeak && energy[i] > avg * k && energy[i] > 1e-4 && i - last >= minGap) {
      out.push((i * win) / sampleRate);
      last = i;
    }
  }
  return out;
}
