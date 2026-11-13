// Janela "Animar logo": escolha o estilo (com prévia animada da SUA logo), o formato, a duração e o fundo.
import { modal } from './ui.js';
import { splitLogo, buildLogoAnimation, LOGO_STYLES } from './logoanim.js';
import { renderFrame } from './renderer.js';
import { getImage } from './media.js';

const FORMATS = [['1:1', [1080, 1080]], ['9:16', [1080, 1920]], ['16:9', [1920, 1080]], ['4:5', [1080, 1350]]];
const DURS = [4, 6, 8];
const BGS = [['logo', 'Cor da logo'], ['dark', 'Escuro'], ['gradient', 'Degradê']];

/** Retorna o projeto pronto (ou null se cancelar). saveMedia: como guardar as peças no aparelho. */
export async function logoAnimDialog(img, name, saveMedia) {
  const sp = splitLogo(img);
  if (!sp.pieces.length) throw new Error('não achei a logo na imagem (fundo e logo da mesma cor?)');
  // peças só na memória para a prévia (rápido); no "Criar" elas são guardadas de verdade
  const blobs = [], previewMedia = [];
  for (const q of sp.pieces) {
    const b = await new Promise((r) => q.canvas.toBlob(r, 'image/png'));
    blobs.push(b); const src = URL.createObjectURL(b); previewMedia.push({ mediaId: null, src });
    const g = getImage(src); await new Promise((r) => { if (g.complete && g.naturalWidth) r(); else { g.onload = r; g.onerror = r; } });
  }
  const st = { style: 'montar', fmt: '1:1', dur: 6, bg: 'logo' };
  let raf = 0, P = null, building = 0;
  const chips = (k, list) => `<div class="exp-chips" data-k="${k}" style="flex-wrap:wrap">${list.map(([v, l]) => `<button data-v="${v}" class="${String(st[k]) === String(v) ? 'on' : ''}"${k === 'style' ? ' style="flex:0 0 auto;padding:8px 10px"' : ''}>${l}</button>`).join('')}</div>`;
  const res = await modal('Animar logo', `
    <p class="muted small" style="margin:0 0 6px">Separei a logo em <b>${sp.pieces.length} peças</b> (${sp.lines} linha(s)). Escolha o estilo — a prévia já usa a sua logo.</p>
    <div style="background:#000;border-radius:10px;overflow:hidden;display:flex;justify-content:center"><canvas data-f="pv" width="320" height="320" style="max-width:100%;max-height:42vh"></canvas></div>
    <p class="muted small" data-f="desc" style="min-height:2.6em;margin:6px 0"></p>
    <div class="exp-row"><span>Estilo</span>${chips('style', LOGO_STYLES.map((s) => [s.id, s.name]))}</div>
    <div class="exp-row"><span>Formato</span>${chips('fmt', FORMATS.map(([f]) => [f, f]))}</div>
    <div class="exp-row"><span>Duração</span>${chips('dur', DURS.map((d) => [d, `${d} s`]))}</div>
    <div class="exp-row"><span>Fundo</span>${chips('bg', BGS)}</div>`,
  [{ label: 'Cancelar', value: null }, { label: 'Criar projeto', primary: true, value: () => ({ ...st }) }], { wide: true, onMount: (w) => {
    const cv = w.querySelector('[data-f="pv"]'), desc = w.querySelector('[data-f="desc"]');
    const rebuild = async () => {
      const my = ++building;
      const size = FORMATS.find((f) => f[0] === st.fmt)[1];
      const p = await buildLogoAnimation(sp, { style: st.style, size, duration: st.dur, background: st.bg, pieceMedia: previewMedia });
      if (my !== building) return;
      P = p; const k = Math.min(320 / size[0], 320 / size[1]); cv.width = Math.round(size[0] * k); cv.height = Math.round(size[1] * k); cv._k = k;
      desc.textContent = LOGO_STYLES.find((s) => s.id === st.style).desc;
    };
    const t0 = performance.now();
    const loop = () => {
      if (!cv.isConnected) return;
      if (P) { const t = ((performance.now() - t0) / 1000) % P.duration; try { renderFrame(cv.getContext('2d'), P, t, cv._k, {}); } catch { /* segue */ } }
      raf = requestAnimationFrame(loop);
    };
    w.querySelectorAll('.exp-chips').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      st[g.dataset.k] = g.dataset.k === 'dur' ? +b.dataset.v : b.dataset.v;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      rebuild();
    }));
    rebuild(); loop();
  } });
  cancelAnimationFrame(raf);
  if (!res) { previewMedia.forEach((m) => URL.revokeObjectURL(m.src)); return null; }
  // guarda as peças no aparelho e monta o projeto final
  const media = [];
  for (const b of blobs) media.push(await saveMedia(b));
  return buildLogoAnimation(sp, { style: res.style, size: FORMATS.find((f) => f[0] === res.fmt)[1], duration: res.dur, background: res.bg, pieceMedia: media, name: `${name} · ${LOGO_STYLES.find((s) => s.id === res.style).name}` });
}
