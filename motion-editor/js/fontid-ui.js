// Janela "Identificar fonte": escolha a imagem (ou use a camada de imagem selecionada), arraste para marcar o texto,
// digite o que está escrito e toque Identificar. Resultado: as fontes mais parecidas com prévia, % de semelhança e
// o ajuste (peso, espaçamento, largura) — "Usar" aplica no texto selecionado ou cria um texto novo.
import { modal, pickFiles } from './ui.js';
import { identifyFont, applyFontResult } from './fontid.js';
import { LAYER_FACTORIES } from './state.js';
import { escapeHtml } from './util.js';

export async function fontIdDialog(store, { toast } = {}) {
  const sel = store.layer();
  let img = null;
  if (sel?.type === 'image' && sel.props.src) { img = new Image(); img.src = sel.props.src; try { await img.decode(); } catch { img = null; } }
  if (!img) {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    img = await createImageBitmap(f);
  }
  let rect = { x: 0, y: 0, w: img.width, h: img.height };
  let results = null;
  const body = `
    <p class="muted small" style="margin:0 0 6px">Arraste sobre a imagem para marcar só o texto (uma linha). Depois digite exatamente o que está escrito, com acentos.</p>
    <div style="position:relative;touch-action:none"><canvas data-f="cv" style="width:100%;border-radius:8px;background:#111;display:block"></canvas></div>
    <div style="display:flex;gap:6px;margin:8px 0"><input data-f="txt" type="text" placeholder="Texto da imagem (ex.: FUNDIÇÃO)" style="flex:1"><button class="primary" data-f="go">Identificar</button></div>
    <div data-f="st" class="muted small"></div>
    <div data-f="res" style="display:flex;flex-direction:column;gap:6px;margin-top:6px"></div>`;
  await modal('Identificar fonte', body, [{ label: 'Fechar', value: null }], { wide: true, onMount: (w, close) => {
    const cv = w.querySelector('[data-f="cv"]'), st = w.querySelector('[data-f="st"]'), box = w.querySelector('[data-f="res"]'), txt = w.querySelector('[data-f="txt"]');
    const k = Math.min(1, 900 / img.width); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    const g = cv.getContext('2d');
    const draw = () => {
      g.drawImage(img, 0, 0, cv.width, cv.height);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, rect.x, rect.y, rect.w, rect.h, rect.x * k, rect.y * k, rect.w * k, rect.h * k);
      g.strokeStyle = '#2d8cf0'; g.lineWidth = 2; g.strokeRect(rect.x * k, rect.y * k, rect.w * k, rect.h * k);
    };
    draw();
    let p0 = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * img.width, ((e.clientY - r.top) / r.height) * img.height]; };
    cv.addEventListener('pointerdown', (e) => { p0 = pt(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!p0) return; const p = pt(e); rect = { x: Math.max(0, Math.min(p0[0], p[0])), y: Math.max(0, Math.min(p0[1], p[1])), w: Math.abs(p[0] - p0[0]), h: Math.abs(p[1] - p0[1]) }; draw(); });
    cv.addEventListener('pointerup', () => { p0 = null; if (rect.w < 8 || rect.h < 8) rect = { x: 0, y: 0, w: img.width, h: img.height }; draw(); });
    if (sel?.type === 'text') txt.value = sel.props.text.split('\n')[0];
    w.querySelector('[data-f="go"]').addEventListener('click', async () => {
      const text = txt.value.trim();
      if (!text) { st.textContent = 'Digite o texto que aparece na imagem.'; return; }
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(rect.w)); c.height = Math.max(1, Math.round(rect.h));
      c.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
      box.innerHTML = '';
      try {
        results = await identifyFont(c, text, { onProgress: (f) => { st.textContent = `Comparando com ~130 fontes… ${Math.round(f * 100)}%`; } });
      } catch (e) { st.textContent = `Não deu: ${e.message}`; return; }
      const top = results.slice(0, 8);
      const best = top[0]?.score || 0;
      st.innerHTML = best >= 0.8 ? 'Achei uma fonte muito parecida.' : best >= 0.65 ? 'Estas são as mais parecidas do catálogo.'
        : '<b>Nenhuma fonte do catálogo bate bem</b> — provavelmente é um lettering personalizado (feito à mão para a logo). As abaixo são as aproximações mais próximas.';
      box.innerHTML = top.map((r, i) => `<div style="display:flex;gap:8px;align-items:center;background:#1c1c24;border-radius:8px;padding:6px 8px">
        <canvas data-pv="${i}" width="420" height="70" style="flex:1;min-width:0;height:44px"></canvas>
        <div style="font-size:12px;line-height:1.3;width:118px"><b>${escapeHtml(r.family)}</b><br>peso ${r.weight} · ${Math.round(r.score * 100)}%<br><span class="muted">${r.tracking ? `espaço ${r.tracking > 0 ? '+' : ''}${Math.round(r.tracking * 1000)}` : ''}${Math.abs(r.stretch - 1) > 0.03 ? ` larg. ${Math.round(r.stretch * 100)}%` : ''}</span></div>
        <button data-use="${i}">Usar</button></div>`).join('');
      top.forEach((r, i) => {
        const pc = box.querySelector(`[data-pv="${i}"]`), pg = pc.getContext('2d');
        pg.fillStyle = '#fff'; pg.textBaseline = 'middle';
        let fs = 48; pg.font = `${r.weight} ${fs}px "${r.family}"`;
        const tw = pg.measureText(text).width * r.stretch + r.tracking * fs * text.length;
        if (tw > 400) { fs = (fs * 400) / tw; pg.font = `${r.weight} ${fs}px "${r.family}"`; }
        pg.save(); pg.translate(8, 35); pg.scale(r.stretch, 1);
        let x = 0; for (const ch of text) { pg.fillText(ch, x, 0); x += pg.measureText(ch).width + r.tracking * fs; }
        pg.restore();
      });
      box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
        const r = top[+b.dataset.use];
        let L = store.layer();
        if (!L || L.type !== 'text') {
          L = LAYER_FACTORIES.text(store.project); L.props.text = text; L.inPoint = store.time; L.outPoint = Math.min(store.project.duration, store.time + 3);
          store.addLayer(L);
        }
        applyFontResult(L, r);
        store.commit('structure');
        toast?.(`Fonte “${r.family}” (peso ${r.weight}) aplicada em “${L.name}”.`, 'ok', 3500);
        close(null);
      }));
    });
  } });
}
