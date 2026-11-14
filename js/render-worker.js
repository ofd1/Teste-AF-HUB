// Worker de renderização da EXPORTAÇÃO: o mesmo motor (renderer.js + efeitos WebGL) rodando fora da tela principal,
// numa OffscreenCanvas. A interface continua respondendo (barra de progresso, botões) mesmo em quadros pesados, e o
// .exe não mostra mais "o editor não está respondendo". Os vídeos são lidos pelo leitor sequencial (WebCodecs) e as
// imagens chegam como ImageBitmap. Qualquer erro é avisado e a exportação continua na tela principal.
import { renderFrame } from './renderer.js';
import { prepare, setWorkerMedia, setExporting } from './media.js';
import { getGL, glLost } from './gl.js';

let P = null, canvas = null, ctx = null, scale = 1;

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      P = m.project; scale = m.scale;
      setWorkerMedia(m.media || {});
      setExporting(true);
      canvas = new OffscreenCanvas(m.width, m.height);
      ctx = canvas.getContext('2d', { alpha: false });
      if (!getGL()) throw new Error('WebGL indisponível no Worker');
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'frame') {
      await prepare(P, m.t, { exact: true });
      renderFrame(ctx, P, m.t, scale, { final: true });
      for (let retry = 0; retry < 3 && glLost(); retry++) { // GPU caiu: recria o contexto e refaz o quadro
        await new Promise((r) => setTimeout(r, 250));
        getGL();
        renderFrame(ctx, P, m.t, scale, { final: true });
      }
      const bm = canvas.transferToImageBitmap();
      self.postMessage({ type: 'frame', i: m.i, bm }, [bm]);
    } else if (m.type === 'end') {
      setExporting(false);
      self.close();
    }
  } catch (e) {
    self.postMessage({ type: 'error', i: m.i, message: String(e?.message || e) });
  }
};
