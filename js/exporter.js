// Exportação: MP4 quadro a quadro (WebCodecs + mp4-muxer, com áudio) e fallback em tempo real (MediaRecorder).
import { renderFrame, resetRenderCaches } from './renderer.js';
import { getGL, glLost } from './gl.js';
import { prepare, pauseAll, setExporting } from './media.js';
import { renderMix, stopAudio } from './audio.js';
import { modal, toast } from './ui.js';
import { saveFile, keepAwake } from './platform.js';
import { prepareBgModels } from './bgremove.js';
import { flatLayers } from './state.js';

const withTimeout = (pr, ms, msg) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
/** Bitrate alto pela resolução e fps (~0,35 bit por pixel: 1080×1920 a 30 fps ≈ 22 Mbps, 4K ≈ 87 Mbps). */
export const autoBitrate = (p, scale = 1, fps = p.fps) => Math.round(Math.max(20, Math.min(150, (p.width * scale) * (p.height * scale) * fps * 0.35 / 1e6)));

async function pickVideoCodec(width, height, bitrate, fps) {
  if (!window.VideoEncoder) return null;
  const candidates = [
    ['avc', 'avc1.640034'], ['avc', 'avc1.640033'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.42e034'],
    ['vp9', 'vp09.00.51.08'], ['vp9', 'vp09.00.41.08'], ['av1', 'av01.0.08M.08'],
  ];
  // se o aparelho não aceita o bitrate pedido, tenta valores menores antes de desistir do codificador
  for (const k of [1, 0.6, 0.35]) for (const [mux, codec] of candidates) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const config = { codec, width, height, bitrate: Math.round(bitrate * k), framerate: fps, hardwareAcceleration: hw, bitrateMode: 'variable', latencyMode: 'quality' };
      if (codec.startsWith('avc')) config.avc = { format: 'avc' };
      try {
        const s = await VideoEncoder.isConfigSupported(config);
        if (s.supported) return { mux, config: s.config };
      } catch { /* tenta o próximo */ }
    }
  }
  return null;
}

/** AudioSpecificConfig de 2 bytes do AAC-LC (o que o MP4 espera na caixa esds). */
function aacSpecificConfig(sampleRate, channels) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const idx = Math.max(0, rates.indexOf(sampleRate));
  const v = (2 << 11) | (idx << 7) | (channels << 3);
  return new Uint8Array([v >> 8, v & 255]);
}

async function pickAudioCodec(sampleRate) {
  if (!window.AudioEncoder) return null;
  for (const [mux, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    const config = { codec, sampleRate, numberOfChannels: 2, bitrate: 192000, ...(mux === 'aac' ? { aac: { format: 'aac' } } : {}) };
    try {
      const s = await AudioEncoder.isConfigSupported(config);
      if (s.supported) return { mux, config: s.config };
    } catch { /* próximo */ }
  }
  return null;
}

function progressModal(title, detail) {
  // janela de progresso como a Render Queue do AE: mostra o quadro que acabou de ser renderizado;
  // "Minimizar" vira um cartão no canto e o app continua livre (a exportação usa uma cópia do projeto)
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal"><header><h2>${title}</h2></header><div class="modal-body">
    <div class="exp-pv"><canvas width="320" height="320"></canvas></div>
    <div class="progress"><div class="bar"></div></div><p class="muted small prog-text">${detail}</p>
    </div><footer><button data-x="min">Minimizar</button><button class="danger" data-x="cancel">Cancelar</button></footer></div>`;
  document.body.appendChild(wrap);
  const chip = document.createElement('div');
  chip.className = 'exp-chip'; chip.hidden = true;
  chip.innerHTML = '<canvas width="96" height="96"></canvas><div class="exp-chip-info"><b>Exportando</b><span class="exp-chip-pct">0%</span><div class="progress"><div class="bar"></div></div></div><button aria-label="Cancelar exportação">✕</button>';
  document.body.appendChild(chip);
  const state = { cancelled: false, frac: 0 };
  const big = wrap.querySelector('.exp-pv canvas'), small = chip.querySelector('canvas');
  wrap.querySelector('[data-x="cancel"]').onclick = () => { state.cancelled = true; };
  wrap.querySelector('[data-x="min"]').onclick = () => { wrap.hidden = true; chip.hidden = false; };
  chip.addEventListener('click', (e) => { if (e.target.closest('button')) { state.cancelled = true; return; } chip.hidden = true; wrap.hidden = false; });
  state.set = (f, text) => {
    state.frac = f;
    wrap.querySelector('.bar').style.width = `${Math.round(f * 100)}%`;
    chip.querySelector('.bar').style.width = `${Math.round(f * 100)}%`;
    chip.querySelector('.exp-chip-pct').textContent = `${Math.round(f * 100)}%${text ? ` · ${text.replace(/^Quadro \d+\/\d+ · /, '')}` : ''}`;
    if (text) wrap.querySelector('.prog-text').textContent = text;
  };
  let lastPv = 0;
  /** Prévia do quadro exportado (no máximo ~6 vezes por segundo, para não atrasar a exportação). */
  state.preview = (src) => {
    const now = performance.now();
    if (now - lastPv < 160) return;
    lastPv = now;
    const target = wrap.hidden ? small : big;
    const k = Math.min(target === big ? 320 : 96, 4096) / Math.max(src.width, src.height);
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
    target.getContext('2d').drawImage(src, 0, 0, w, h);
  };
  state.close = () => { wrap.remove(); chip.remove(); };
  return state;
}

/** Exporta MP4 quadro a quadro (preciso: respeita velocidade/Twixtor, motion blur e frame blending). */
/** Maior escala ≤ pedida que o aparelho consegue (limite de canvas do iPhone ~16,7 MP e do codificador). */
export async function fitExportScale(project, scale, fps = 30, bitrate = 16) {
  const MAXPX = 16_700_000;
  let s = Math.min(scale, Math.sqrt(MAXPX / (project.width * project.height)));
  for (let k = 0; k < 12; k++) {
    const w = even(project.width * s), h = even(project.height * s);
    if (!window.VideoEncoder || await pickVideoCodec(w, h, bitrate * 1e6, fps)) return s;
    s *= 0.85;
  }
  return Math.min(scale, 1);
}

export async function exportMP4(store, { scale = 1, bitrate, fpsOverride } = {}) {
  bitrate = bitrate || autoBitrate(store.project, scale, fpsOverride || store.project.fps);
  // cópia do projeto: dá para minimizar e continuar editando sem mudar o vídeo que está saindo
  const project = JSON.parse(JSON.stringify(store.project));
  const fps = fpsOverride || project.fps;
  const width = even(project.width * scale), height = even(project.height * scale);
  const video = await pickVideoCodec(width, height, bitrate * 1e6, fps);
  if (!video) return false;
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');

  let ui = progressModal('Exportando vídeo…', `${width}×${height} · ${fps} fps · ${video.config.codec}`);
  store.exporting = true; setExporting(true); resetRenderCaches();
  try { await prepareBgModels(flatLayers(store.project.layers)); } catch { /* segue sem IA */ }
  stopAudio();
  pauseAll();
  keepAwake(true);
  try {
    const sampleRate = 48000;
    ui.set(0, 'Mixando áudio…');
    const mix = await renderMix(project, sampleRate).catch(() => null);
    const audio = mix ? await pickAudioCodec(sampleRate) : null;
    if (mix && !audio) {
      // aparelho sem codificador de áudio: oferece gravar em tempo real COM som
      ui.close();
      const choice = await modal('Áudio', '<p>Este aparelho não consegue codificar o áudio na exportação quadro a quadro.</p><p><b>Tempo real com som</b>: grava o vídeo tocando (pode perder quadros em efeitos pesados).<br><b>Sem som</b>: exportação precisa, mas muda.</p>', [{ label: 'Sem som', value: 'mute' }, { label: 'Tempo real com som', value: 'rt', primary: true }]);
      if (choice !== 'mute') { store.exporting = false; setExporting(false); keepAwake(false); return false; }
      ui = progressModal('Exportando vídeo (sem som)…', `${width}×${height} · ${fps} fps`);
    }

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: video.mux, width, height, frameRate: fps },
      ...(audio ? { audio: { codec: audio.mux, numberOfChannels: 2, sampleRate } } : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let failure = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
    venc.configure(video.config);

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    const total = Math.max(1, Math.round(project.duration * fps));
    const t0 = performance.now();
    // nunca fica parado num quadro: se o aparelho não entregar o quadro do vídeo em 8 s, segue com o último bom
    const prep = (t) => Promise.race([prepare(project, t, { exact: true }), new Promise((r) => setTimeout(r, 8000))]);
    let nextPrep = prep(0);
    for (let i = 0; i < total; i++) {
      if (ui.cancelled || failure) break;
      const t = i / fps;
      await nextPrep;
      renderFrame(ctx, project, t, width / project.width, { final: true });
      // se a GPU caiu no meio do quadro, recria o contexto e refaz o quadro (antes saía preto até o fim)
      for (let retry = 0; retry < 3 && glLost(); retry++) {
        await new Promise((r) => setTimeout(r, 250));
        getGL();
        renderFrame(ctx, project, t, width / project.width, { final: true });
      }
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      ui.preview?.(canvas);
      // o próximo quadro começa a ser lido do vídeo enquanto este é codificado
      nextPrep = i + 1 < total ? prep((i + 1) / fps) : null;
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // codificador parado (acontece no iPhone com pouca memória): não espera para sempre — avisa e tenta o modo tempo real
      for (const tq = performance.now(); venc.encodeQueueSize > 6 && !failure; ) {
        await new Promise((r) => setTimeout(r, 2));
        if (performance.now() - tq > 15000) { failure = new Error('o codificador de vídeo do aparelho parou de responder'); break; }
      }
      {
        const el = (performance.now() - t0) / 1000;
        const eta = (el / (i + 1)) * (total - i - 1);
        ui.set((i + 1) / total, `Quadro ${i + 1}/${total} · faltam ~${Math.ceil(eta)}s`);
      }
    }
    if (failure) throw failure;
    if (ui.cancelled) { venc.close(); toast('Exportação cancelada.'); return true; }
    await withTimeout(venc.flush(), 30000, 'o codificador de vídeo não terminou');

    if (audio && mix) {
      ui.set(1, 'Codificando áudio…');
      let aerr = null;
      // Safari (bug WebKit 302253) entrega a "description" do AAC no formato errado (caixa esds): o MP4 ficava com
      // uma faixa de áudio que nenhum player toca = vídeo sem som. Usamos sempre o AudioSpecificConfig correto.
      const fixMeta = (meta) => (audio.mux === 'aac' && meta?.decoderConfig ? { ...meta, decoderConfig: { ...meta.decoderConfig, description: aacSpecificConfig(sampleRate, 2) } } : meta);
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, fixMeta(meta)), error: (e) => { aerr = e; } });
      aenc.configure(audio.config);
      const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
      const block = 4096;
      for (let off = 0; off < mix.length; off += block) {
        const n = Math.min(block, mix.length - off);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(off, off + n), 0);
        data.set(R.subarray(off, off + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / sampleRate) * 1e6), data });
        aenc.encode(ad);
        ad.close();
      }
      await withTimeout(aenc.flush(), 30000, 'o codificador de áudio não terminou').catch((e) => { aerr = e; });
      if (aerr) console.warn('áudio falhou', aerr);
    }
    canvas.width = 0; canvas.height = 0; // libera a memória do canvas (o iPhone tem teto de memória para canvases)
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    ui.close();
    store.exporting = false; setExporting(false);
    keepAwake(false);
    if (!audio && mix) toast('Vídeo exportado sem áudio: codec de áudio indisponível neste aparelho.', 'warn', 5000);
    await saveFile(`edit-${Date.now()}.mp4`, blob);
    return true;
  } catch (e) {
    console.error(e);
    toast(`Falha na exportação: ${e.message}`, 'error', 6000);
    return true;
  } finally {
    ui.close();
    resetRenderCaches();
    store.exporting = false; setExporting(false);
    keepAwake(false);
  }
}

/** Fallback: grava em tempo real via MediaRecorder (sem áudio). */
export async function exportRealtime(store, { scale = 1, bitrate } = {}) {
  bitrate = bitrate || autoBitrate(store.project, scale);
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  const mime = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  if (!mime) { toast('Este aparelho não suporta exportação de vídeo no navegador.', 'error'); return; }
  const { project } = store;
  const c = document.createElement('canvas');
  c.width = even(project.width * scale); c.height = even(project.height * scale);
  const ctx = c.getContext('2d');
  // som: a mixagem toca num destino de gravação junto com o vídeo
  const mix = await renderMix(project, 48000).catch(() => null);
  let ac = null, srcNode = null;
  const stream = c.captureStream(project.fps);
  if (mix) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    srcNode = ac.createBufferSource();
    srcNode.buffer = mix;
    srcNode.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate * 1e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ui = progressModal('Gravando (tempo real)…', mix ? 'Gravando vídeo e som em tempo real.' : 'Gravação em tempo real.');
  store.exporting = true; setExporting(true);
  try { await prepareBgModels(flatLayers(store.project.layers)); } catch { /* segue sem IA */ }
  if (ac) await ac.resume().catch(() => {});
  rec.start(250);
  srcNode?.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (ui.cancelled || t >= project.duration) { resolve(); return; }
      prepare(project, t, { playing: true });
      renderFrame(ctx, project, t, c.width / project.width);
      ui.set(t / project.duration);
      requestAnimationFrame(tick);
    };
    tick();
  });
  try { srcNode?.stop(); } catch { /* ok */ }
  ac?.close();
  pauseAll();
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  store.exporting = false; setExporting(false);
  ui.close();
  if (ui.cancelled) return;
  const size = chunks.reduce((n, x) => n + x.size, 0);
  if (!size) { toast('O navegador não gerou dados de vídeo. Tente 50% de resolução.', 'error'); return; }
  await saveFile(`edit-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, new Blob(chunks, { type: mime.split(';')[0] }));
}

export async function exportPNG(store) {
  const { project } = store;
  try { await prepareBgModels(flatLayers(project.layers)); } catch { /* segue sem IA */ }
  const c = document.createElement('canvas');
  c.width = project.width; c.height = project.height;
  await prepare(project, store.time, { exact: true });
  renderFrame(c.getContext('2d'), project, store.time, 1, { final: true });
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await saveFile(`frame-${store.time.toFixed(2)}s.png`, blob);
}

export async function exportDialog(store) {
  // Exportar no estilo CapCut / Alight Motion: resolução, fps e qualidade em botões, com o tamanho estimado do arquivo.
  const P = store.project, short = Math.min(P.width, P.height);
  const RES = [[480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '2K'], [2160, '4K']].filter(([r]) => r <= short * 4);
  const last = (() => { try { return JSON.parse(localStorage.getItem('motionframe.exportPrefs') || 'null'); } catch { return null; } })() || {};
  const st = { res: last.res && RES.some(([r]) => r === last.res) ? last.res : (RES.find(([r]) => r === short)?.[0] || 1080), fps: last.fps || P.fps, q: last.q || 'rec', fmt: 'video' };
  if (P.exportScale > 1) st.res = Math.min(2160, Math.round(short * P.exportScale)); // Topaz upscale escolhido no painel
  const scaleOf = () => st.res / short;
  const QK = { low: 0.5, rec: 1, high: 1.6 };
  const rate = (sc, fps, q) => Math.round(Math.max(4, Math.min(150, P.width * sc * P.height * sc * fps * 0.35 / 1e6 * QK[q])));
  const mbps = () => rate(scaleOf(), st.fps, st.q);
  const sizeMB = () => Math.max(1, Math.round((mbps() * P.duration) / 8 + (P.duration * 0.024)));
  const chips = (key, items) => `<div class="exp-chips" data-k="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const res = await modal('Exportar', `
    <div class="exp-sheet">
      <div class="exp-fmt">${chips('fmt', [['video', 'Vídeo'], ['png', 'Foto (quadro)'], ['project', 'Projeto']])}</div>
      <div class="exp-video">
        <div class="exp-row"><span>Resolução</span>${chips('res', RES.map(([r, l]) => [r, l + (r > short ? ' ✦' : '')]))}</div>
        <div class="exp-row"><span>Quadros por segundo</span>${chips('fps', [24, 25, 30, 50, 60].map((f) => [f, String(f)]))}</div>
        <div class="exp-row"><span>Qualidade</span>${chips('q', [['low', 'Menor'], ['rec', 'Recomendada'], ['high', 'Maior']])}</div>
        <p class="muted small exp-info"></p>
        <p class="muted small">✦ acima do tamanho do projeto: a imagem é ampliada (use o Topaz para ampliar com detalhe). Edits com shake/grão pedem qualidade Recomendada ou Maior.</p>
      </div>
    </div>`,
  [{ label: 'Cancelar', value: null }, { label: 'Exportar', primary: true, value: () => ({ ...st }) }], { onMount: (w) => {
    const info = w.querySelector('.exp-info');
    const upd = () => {
      w.querySelectorAll('.exp-chips').forEach((g) => g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(st[g.dataset.k]) === b.dataset.v)));
      w.querySelector('.exp-video').style.display = st.fmt === 'video' ? '' : 'none';
      const W = even(P.width * scaleOf()), H = even(P.height * scaleOf());
      info.textContent = `${W}×${H} · ${st.fps} fps · ${mbps()} Mbps · ≈ ${sizeMB()} MB (${P.duration.toFixed(1)} s)`;
    };
    w.querySelectorAll('.exp-chips').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      st[g.dataset.k] = g.dataset.k === 'res' || g.dataset.k === 'fps' ? +b.dataset.v : b.dataset.v; upd();
    }));
    upd();
  } });
  if (res) { try { localStorage.setItem('motionframe.exportPrefs', JSON.stringify({ res: res.res, fps: res.fps, q: res.q })); } catch { /* ok */ } }
  if (res) Object.assign(res, { scale: res.res / short, bitrate: rate(res.res / short, res.fps, res.q) });
  if (!res) return null;
  if (res.fmt === 'png') await exportPNG(store);
  else if (res.fmt === 'video') {
    if (res.scale > 1) {
      const fit = await fitExportScale(store.project, res.scale, res.fps, res.bitrate);
      if (fit < res.scale - 1e-3) toast(`Este aparelho grava no máximo ${even(store.project.width * fit)}×${even(store.project.height * fit)} — exportando nesse tamanho (o maior possível).`, 'info', 6000);
      res.scale = fit;
    }
    const ok = await exportMP4(store, { scale: res.scale, bitrate: res.bitrate, fpsOverride: res.fps });
    if (!ok) await exportRealtime(store, res);
  }
  return res.fmt;
}
