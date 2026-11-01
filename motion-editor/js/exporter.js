import { renderFrame, syncVideos } from './renderer.js';
import { download } from './util.js';
import { modal, toast } from './ui.js';

function pickMime() {
  // VP8 primeiro: o encoder VP9 por software falha em resoluções altas (ex.: 1080×1920) em vários ambientes.
  const types = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

export function exportPNG(store) {
  const { project } = store;
  const c = document.createElement('canvas');
  c.width = project.width; c.height = project.height;
  renderFrame(c.getContext('2d'), project, store.time, 1);
  c.toBlob((b) => download(`frame-${store.time.toFixed(2)}s.png`, b), 'image/png');
}

/** Exporta vídeo em tempo real com MediaRecorder (canvas.captureStream). */
export async function exportVideo(store, { scale = 1, bitrate = 12 } = {}) {
  const mime = pickMime();
  if (!mime) { toast('Este navegador não suporta MediaRecorder para exportar vídeo.', 'error'); return; }
  const { project } = store;
  const c = document.createElement('canvas');
  c.width = Math.round(project.width * scale);
  c.height = Math.round(project.height * scale);
  const ctx = c.getContext('2d');
  const stream = c.captureStream(project.fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate * 1e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let cancelled = false;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal"><header><h2>Exportando vídeo…</h2></header><div class="modal-body">
    <div class="progress"><div class="bar"></div></div><p class="muted small">Renderização em tempo real (${c.width}×${c.height}, ${project.fps} fps, ${mime.split(';')[0]}). Mantenha esta aba visível.</p>
    </div><footer><button class="danger">Cancelar</button></footer></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('button').onclick = () => { cancelled = true; };
  const bar = wrap.querySelector('.bar');

  const wasPlaying = store.playing;
  store.playing = false;
  store.exporting = true;
  rec.start(250);
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (cancelled || t >= project.duration) { resolve(); return; }
      syncVideos(project, t, true);
      renderFrame(ctx, project, t, scale);
      bar.style.width = `${(t / project.duration) * 100}%`;
      requestAnimationFrame(tick);
    };
    tick();
  });
  syncVideos(project, store.time, false);
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  store.exporting = false;
  store.playing = wasPlaying;
  wrap.remove();
  if (cancelled) { toast('Exportação cancelada.'); return; }
  const size = chunks.reduce((n, c) => n + c.size, 0);
  if (!size) { toast('O navegador não gerou dados de vídeo. Tente exportar em 50% de resolução.', 'error', 6000); return; }
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  download(`motionframe-${Date.now()}.${ext}`, new Blob(chunks, { type: mime.split(';')[0] }));
  toast('Vídeo exportado!', 'ok');
}

export async function exportDialog(store) {
  const res = await modal('Exportar', `
    <label class="row"><span>Formato</span><select data-f="fmt"><option value="video">Vídeo (WebM/MP4)</option><option value="png">Quadro atual (PNG)</option><option value="project">Projeto (.json)</option></select></label>
    <label class="row"><span>Resolução</span><select data-f="scale"><option value="1">100%</option><option value="0.5">50%</option></select></label>
    <label class="row"><span>Bitrate (Mbps)</span><input type="number" data-f="bitrate" value="12" min="1" max="60"></label>`,
  [{ label: 'Cancelar', value: null }, { label: 'Exportar', primary: true, value: (w) => ({ fmt: w.querySelector('[data-f="fmt"]').value, scale: +w.querySelector('[data-f="scale"]').value, bitrate: +w.querySelector('[data-f="bitrate"]').value }) }]);
  if (!res) return null;
  if (res.fmt === 'png') exportPNG(store);
  else if (res.fmt === 'video') await exportVideo(store, res);
  return res.fmt;
}
