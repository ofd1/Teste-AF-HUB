// Exportação: MP4 quadro a quadro (WebCodecs + mp4-muxer, com áudio) e fallback em tempo real (MediaRecorder).
import { renderFrame } from './renderer.js';
import { prepare, pauseAll } from './media.js';
import { renderMix, stopAudio } from './audio.js';
import { modal, toast } from './ui.js';
import { saveFile, keepAwake } from './platform.js';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

async function pickVideoCodec(width, height, bitrate, fps) {
  if (!window.VideoEncoder) return null;
  const candidates = [
    ['avc', 'avc1.640034'], ['avc', 'avc1.640033'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.42e034'],
    ['vp9', 'vp09.00.51.08'], ['vp9', 'vp09.00.41.08'], ['av1', 'av01.0.08M.08'],
  ];
  for (const [mux, codec] of candidates) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const config = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration: hw };
      if (codec.startsWith('avc')) config.avc = { format: 'avc' };
      try {
        const s = await VideoEncoder.isConfigSupported(config);
        if (s.supported) return { mux, config: s.config };
      } catch { /* tenta o próximo */ }
    }
  }
  return null;
}

async function pickAudioCodec(sampleRate) {
  if (!window.AudioEncoder) return null;
  for (const [mux, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    const config = { codec, sampleRate, numberOfChannels: 2, bitrate: 192000 };
    try {
      const s = await AudioEncoder.isConfigSupported(config);
      if (s.supported) return { mux, config: s.config };
    } catch { /* próximo */ }
  }
  return null;
}

function progressModal(title, detail) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal"><header><h2>${title}</h2></header><div class="modal-body">
    <div class="progress"><div class="bar"></div></div><p class="muted small prog-text">${detail}</p>
    </div><footer><button class="danger">Cancelar</button></footer></div>`;
  document.body.appendChild(wrap);
  const state = { cancelled: false };
  wrap.querySelector('button').onclick = () => { state.cancelled = true; };
  state.set = (f, text) => {
    wrap.querySelector('.bar').style.width = `${Math.round(f * 100)}%`;
    if (text) wrap.querySelector('.prog-text').textContent = text;
  };
  state.close = () => wrap.remove();
  return state;
}

/** Exporta MP4 quadro a quadro (preciso: respeita velocidade/Twixtor, motion blur e frame blending). */
export async function exportMP4(store, { scale = 1, bitrate = 16, fpsOverride } = {}) {
  const { project } = store;
  const fps = fpsOverride || project.fps;
  const width = even(project.width * scale), height = even(project.height * scale);
  const video = await pickVideoCodec(width, height, bitrate * 1e6, fps);
  if (!video) return false;
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');

  const ui = progressModal('Exportando vídeo…', `${width}×${height} · ${fps} fps · ${video.config.codec}`);
  store.exporting = true;
  stopAudio();
  pauseAll();
  keepAwake(true);
  try {
    const sampleRate = 48000;
    ui.set(0, 'Mixando áudio…');
    const mix = await renderMix(project, sampleRate).catch(() => null);
    const audio = mix ? await pickAudioCodec(sampleRate) : null;

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
    for (let i = 0; i < total; i++) {
      if (ui.cancelled || failure) break;
      const t = i / fps;
      await prepare(project, t, { exact: true });
      renderFrame(ctx, project, t, width / project.width, { final: true });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 3 === 0) {
        const el = (performance.now() - t0) / 1000;
        const eta = (el / (i + 1)) * (total - i - 1);
        ui.set((i + 1) / total, `Quadro ${i + 1}/${total} · faltam ~${Math.ceil(eta)}s`);
      }
    }
    if (failure) throw failure;
    if (ui.cancelled) { venc.close(); toast('Exportação cancelada.'); return true; }
    await venc.flush();

    if (audio && mix) {
      ui.set(1, 'Codificando áudio…');
      let aerr = null;
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { aerr = e; } });
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
      await aenc.flush();
      if (aerr) console.warn('áudio falhou', aerr);
    }
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    ui.close();
    await saveFile(`edit-${Date.now()}.mp4`, blob);
    toast(`Vídeo exportado (${(blob.size / 1e6).toFixed(1)} MB${audio ? ', com áudio' : mix ? ', sem áudio: codec indisponível' : ''}).`, 'ok', 5000);
    return true;
  } catch (e) {
    console.error(e);
    toast(`Falha na exportação: ${e.message}`, 'error', 6000);
    return true;
  } finally {
    ui.close();
    store.exporting = false;
    keepAwake(false);
  }
}

/** Fallback: grava em tempo real via MediaRecorder (sem áudio). */
export async function exportRealtime(store, { scale = 1, bitrate = 12 } = {}) {
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  const mime = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  if (!mime) { toast('Este aparelho não suporta exportação de vídeo no navegador.', 'error'); return; }
  const { project } = store;
  const c = document.createElement('canvas');
  c.width = even(project.width * scale); c.height = even(project.height * scale);
  const ctx = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(project.fps), { mimeType: mime, videoBitsPerSecond: bitrate * 1e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ui = progressModal('Gravando (tempo real)…', 'Este navegador não tem WebCodecs: gravação em tempo real, sem áudio.');
  store.exporting = true;
  rec.start(250);
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
  pauseAll();
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  store.exporting = false;
  ui.close();
  if (ui.cancelled) return;
  const size = chunks.reduce((n, x) => n + x.size, 0);
  if (!size) { toast('O navegador não gerou dados de vídeo. Tente 50% de resolução.', 'error'); return; }
  await saveFile(`edit-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, new Blob(chunks, { type: mime.split(';')[0] }));
}

export async function exportPNG(store) {
  const { project } = store;
  const c = document.createElement('canvas');
  c.width = project.width; c.height = project.height;
  await prepare(project, store.time, { exact: true });
  renderFrame(c.getContext('2d'), project, store.time, 1, { final: true });
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await saveFile(`frame-${store.time.toFixed(2)}s.png`, blob);
}

export async function exportDialog(store) {
  const res = await modal('Exportar', `
    <label class="row"><span>Formato</span><select data-f="fmt"><option value="video">Vídeo MP4</option><option value="png">Quadro atual (PNG)</option><option value="project">Projeto (.json)</option></select></label>
    <label class="row"><span>Resolução</span><select data-f="scale"><option value="1">100% (${store.project.width}×${store.project.height})</option><option value="0.6667">66%</option><option value="0.5">50%</option></select></label>
    <label class="row"><span>FPS</span><select data-f="fps">${[24, 25, 30, 50, 60].map((f) => `<option ${f === store.project.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    <label class="row"><span>Qualidade (Mbps)</span><input type="number" data-f="bitrate" value="16" min="2" max="80"></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Exportar', primary: true, value: (w) => ({ fmt: w.querySelector('[data-f="fmt"]').value, scale: +w.querySelector('[data-f="scale"]').value, fps: +w.querySelector('[data-f="fps"]').value, bitrate: +w.querySelector('[data-f="bitrate"]').value }) }]);
  if (!res) return null;
  if (res.fmt === 'png') await exportPNG(store);
  else if (res.fmt === 'video') {
    const ok = await exportMP4(store, { scale: res.scale, bitrate: res.bitrate, fpsOverride: res.fps });
    if (!ok) await exportRealtime(store, res);
  }
  return res.fmt;
}
