import { srcBlob, getImage } from './media.js';
import { flatLayers } from './state.js';

// ---- Cliente do Worker de renderização (render-worker.js), usado pela EXPORTAÇÃO e pela PRÉ-RENDERIZAÇÃO da prévia:
// o motor roda fora da tela principal — a interface não trava e o .exe não mostra "não está respondendo". Camadas/efeitos que dependem da página (texto com fontes, Remover fundo, Element 3D,
// Tracery) continuam na tela principal; se o Worker falhar em qualquer quadro, a exportação segue sem ele.
const WK_LAYERS = new Set(['video', 'image', 'shape', 'solid', 'rect', 'ellipse', 'adjustment', 'group', 'audio', 'null', 'camera']);
const WK_BAD_FX = new Set(['bgRemove', 'element3d', 'tracery']);
export function workerEligible(project) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof VideoDecoder === 'undefined' || !('transferToImageBitmap' in OffscreenCanvas.prototype)) return false;
  for (const l of flatLayers(project.layers)) {
    if (!WK_LAYERS.has(l.type)) return false;
    if ((l.effects || []).some((f) => f.enabled !== false && WK_BAD_FX.has(f.type))) return false;
  }
  return true;
}
export function startRenderWorker(project, width, height, scale, opts = {}) {
  if (!workerEligible(project)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let w, ready = false;
    try { w = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' }); } catch { resolve(null); return; }
    const waits = new Map();
    const failAll = (msg) => { for (const x of waits.values()) x.rej(new Error(msg)); waits.clear(); };
    const api = {
      req(i, t) {
        return new Promise((res, rej) => {
          const to = setTimeout(() => { waits.delete(i); rej(new Error('quadro demorou demais no Worker')); }, 90000);
          waits.set(i, { res: (b) => { clearTimeout(to); res(b); }, rej: (e) => { clearTimeout(to); rej(e); } });
          w.postMessage({ type: 'frame', i, t });
        });
      },
      end() { try { w.postMessage({ type: 'end' }); } catch { /* ok */ } setTimeout(() => w.terminate(), 3000); },
      kill() { failAll('Worker encerrado'); try { w.terminate(); } catch { /* ok */ } },
    };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { ready = true; resolve(api); }
      else if (m.type === 'frame') { const x = waits.get(m.i); waits.delete(m.i); if (x) { m.bm.ready = m.ready !== false; x.res(m.bm); } else m.bm?.close?.(); }
      else if (m.type === 'error') {
        if (!ready) { try { w.terminate(); } catch { /* ok */ } resolve(null); return; }
        const x = waits.get(m.i); waits.delete(m.i); x?.rej(new Error(m.message));
      }
    };
    w.onerror = (e) => { e.preventDefault?.(); if (!ready) resolve(null); failAll(e.message || 'erro no Worker'); try { w.terminate(); } catch { /* ok */ } };
    setTimeout(() => { if (!ready) { try { w.terminate(); } catch { /* ok */ } resolve(null); } }, 20000);
    (async () => {
      const media = { images: {}, blobs: {} }, transfer = [];
      for (const l of flatLayers(project.layers)) {
        const src = l.props?.src;
        if (!src) continue;
        if (l.type === 'video' && !media.blobs[src]) media.blobs[src] = await srcBlob(src);
        if (l.type === 'image' && !media.images[src]) {
          const img = getImage(src);
          try { await img.decode?.(); } catch { /* usa o que tiver */ }
          const bm = await createImageBitmap(img);
          media.images[src] = bm; transfer.push(bm);
        }
      }
      w.postMessage({ type: 'init', project, width, height, scale, media, mode: opts.mode || 'export' }, transfer);
    })().catch(() => { try { w.terminate(); } catch { /* ok */ } resolve(null); });
  });
}
