// Áudio: camadas de música e o som dos vídeos, com reprodução sincronizada (WebAudio), forma de onda e mixagem offline.
import { extractAudioADTS } from './mp4audio.js';
import { flatLayers } from './state.js';
import { speedEffect, groupHasTimeFx, ensureGroupTime } from './timing.js';
const buffers = new Map(); // src -> AudioBuffer
const peaksCache = new Map();
let ctx = null;
let playing = [];

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// iPhone: o Web Audio fica mudo com a chave de silencioso e só "acorda" num toque. Pede a sessão de reprodução
// (iOS 17+) e destrava o áudio no primeiro toque tocando um buffer vazio.
function iosAudioSession() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* sem suporte */ }
}
if (typeof document !== 'undefined') {
  const unlock = () => {
    iosAudioSession();
    const ac = audioCtx();
    if (ac.state !== 'running') ac.resume().catch(() => {});
    try { const b = ac.createBuffer(1, 1, 22050); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); } catch { /* ok */ }
  };
  for (const ev of ['touchend', 'click']) document.addEventListener(ev, unlock, { capture: true, passive: true });
}

const IOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const BIG = 24 * 1024 * 1024;                              // acima disso, tira só a trilha de áudio (sem ler o vídeo todo)
const HUGE = (IOS ? 160 : 1200) * 1024 * 1024;             // sem extração possível, não lê arquivos maiores que isso (crash no iPhone)
const pending = new Map();

export async function loadAudio(src) {
  if (buffers.has(src)) return buffers.get(src);
  if (pending.has(src)) return pending.get(src);
  const job = (async () => {
    const blob = await (await fetch(src)).blob();
    let data = null;
    if (blob.size > BIG) {
      const adts = await extractAudioADTS(blob).catch(() => null);
      if (adts === false) throw new Error('sem trilha de áudio');
      if (adts) data = adts.buffer.slice(adts.byteOffset, adts.byteOffset + adts.byteLength);
      else if (blob.size > HUGE) throw new Error('arquivo grande demais para tirar o som neste aparelho');
    }
    if (!data) data = await blob.arrayBuffer();
    return audioCtx().decodeAudioData(data);
  })();
  pending.set(src, job);
  let buf;
  try { buf = await job; } finally { pending.delete(src); }
  buffers.set(src, buf);
  // terminou de carregar com o vídeo tocando: entra no som agora (antes só tocava depois de pausar e dar play)
  if (playState) { const ps = playState; setTimeout(() => { if (playState === ps) playAudio(ps.project, ps.t0 + (performance.now() - ps.wall0) / 1000); }, 0); }
  return buf;
}

/** Esquece o áudio decodificado que o projeto aberto não usa (ao trocar de projeto o áudio dos outros ficava na memória). */
export function pruneAudio(keep) { for (const k of [...buffers.keys()]) if (!keep.has(k)) buffers.delete(k); }
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

/** Vídeos com velocidade/Twixtor têm o som desligado (como no AE, o áudio não acompanha o remapeamento). */
export function videoAudioActive(l) {
  return l.type === 'video' && l.props.hasAudio && !speedEffect(l) && !l.effects.some((fx) => fx.enabled && fx.type === 'timeRemap');
}

/**
 * Camadas com som, já no tempo da composição: o som de dentro de uma pré-comp acompanha a pré-comp (mover/aparar),
 * como no AE. Pré-comp com Velocidade/Time Remap fica muda (o som não acompanha o remapeamento, igual ao vídeo).
 */
function audioLayers(project) {
  const out = [];
  const walk = (layers, shift, lo, hi) => {
    for (const l of layers || []) {
      if (l.type === 'group') {
        if (!l.visible || groupHasTimeFx(l)) continue;
        ensureGroupTime(l);
        walk(l.props.layers, shift + l.inPoint - l.props.contentStart - (l.props.sourceStart || 0), Math.max(lo, l.inPoint + shift), Math.min(hi, l.outPoint + shift));
        continue;
      }
      if (!((l.type === 'audio' || videoAudioActive(l)) && l.visible && !l.props.muted && buffers.has(l.props.src) && (l.props.volume ?? 100) > 0)) continue;
      if (shift === 0 && lo === -Infinity && hi === Infinity) { out.push(l); continue; }
      const i0 = l.inPoint + shift, i1 = Math.max(i0, lo), o1 = Math.min(l.outPoint + shift, hi);
      if (o1 <= i1) continue;
      const rate = l.type === 'video' ? (l.props.speed ?? 1) : 1;
      out.push({ type: l.type, id: l.id, inPoint: i1, outPoint: o1, props: { ...l.props, sourceStart: (l.props.sourceStart || 0) + (i1 - i0) * rate } });
    }
  };
  walk(project.layers, 0, -Infinity, Infinity);
  return out;
}

/** Volume com fade in/out (automação de ganho). t0 = instante do contexto em que a camada começa a tocar. */
function scheduleGain(gain, l, ctxStart, fromT) {
  const v = (l.props.volume ?? 100) / 100;
  const fi = Math.max(0, l.props.fadeIn || 0), fo = Math.max(0, l.props.fadeOut || 0);
  const g = gain.gain;
  const at = (tt) => ctxStart + Math.max(0, tt - fromT);
  const level = (tt) => {
    let k = 1;
    if (fi > 0) k = Math.min(k, (tt - l.inPoint) / fi);
    if (fo > 0) k = Math.min(k, (l.outPoint - tt) / fo);
    return v * Math.max(0, Math.min(1, k));
  };
  g.setValueAtTime(level(Math.max(fromT, l.inPoint)), at(Math.max(fromT, l.inPoint)));
  if (fi > 0 && l.inPoint + fi > fromT) g.linearRampToValueAtTime(v, at(l.inPoint + fi));
  if (fo > 0) {
    if (l.outPoint - fo > fromT) g.setValueAtTime(v, at(l.outPoint - fo));
    g.linearRampToValueAtTime(0, at(l.outPoint));
  }
}

/** Inicia a reprodução de todas as camadas de áudio a partir do tempo t. */
let playState = null; // { project, t0, wall0 } enquanto toca: para encaixar sons que terminam de carregar depois do play

export function playAudio(project, t) {
  stopAudio();
  iosAudioSession();
  const ac = audioCtx();
  if (ac.state === 'suspended') ac.resume();
  playState = { project, t0: t, wall0: performance.now() };
  const now = ac.currentTime + 0.03;
  for (const l of audioLayers(project)) {
    // cada camada isolada: um arquivo com problema (velocidade/duração inválida) não cala as outras
    try {
      if (t >= l.outPoint) continue;
      const buf = buffers.get(l.props.src);
      const rate = l.type === 'video' ? (l.props.speed ?? 1) : 1;
      if (!buf || !(rate > 0)) continue;
      const startAt = Math.max(0, l.inPoint - t);
      const offset = Math.max(0, (l.props.sourceStart || 0) + Math.max(0, t - l.inPoint) * rate);
      const dur = (l.outPoint - Math.max(t, l.inPoint)) * rate;
      if (offset >= buf.duration || !(dur > 0)) continue;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const gain = ac.createGain();
      src.connect(gain).connect(ac.destination);
      scheduleGain(gain, l, now, t);
      src.start(now + startAt, offset, dur);
      playing.push(src);
    } catch (e) { console.warn('som da camada falhou', l.id, e); }
  }
}

export function stopAudio() {
  for (const s of playing) { try { s.stop(); } catch { /* já parado */ } }
  playing = [];
  playState = null;
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
    const rate = l.type === 'video' ? (l.props.speed ?? 1) : 1;
    src.playbackRate.value = rate;
    src.connect(gain).connect(oac.destination);
    const offset = l.props.sourceStart || 0;
    scheduleGain(gain, l, 0, 0);
    if (offset < buf.duration) src.start(Math.max(0, l.inPoint), offset, Math.max(0, l.outPoint - l.inPoint) * rate);
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
