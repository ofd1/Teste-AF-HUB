// "Scene Setup" do Element 3D (como a janela do plugin no After Effects): importar modelo OBJ/GLB e textura,
// escolher objeto, presets de material, extrusão/chanfro, ambiente e luz — com prévia ao vivo e girar arrastando.
import { modal, pickFiles, toast } from './ui.js';
import { valueAt, setValue } from './anim.js';
import { renderFrame } from './renderer.js';
import { importModelFiles, modelInfo, getModel } from './model3d.js';
import { escapeHtml } from './util.js';
import { getEffectDef } from './effects.js';

const OBJECTS = ['Texto 3D', 'Cubo', 'Esfera', 'Toro', 'Cilindro', 'Cápsula', 'Logo / PNG da camada', 'Modelo importado'];
const MATS = [['Plástico', '#d8dce4'], ['Cromo', 'linear-gradient(160deg,#fff,#777 45%,#eee 55%,#333)'], ['Ouro', 'linear-gradient(160deg,#fff3c0,#c58a1d 50%,#ffe08a 60%,#5a3a05)'],
  ['Metal escovado', 'linear-gradient(160deg,#ccc,#8a8f96 50%,#bbb)'], ['Vidro fumê', 'linear-gradient(160deg,#556,#111 50%,#334)'], ['Fosco', '#9aa0a8'], ['Neon', 'radial-gradient(#fff,#29e7ff 45%,#0a3a55)']];

export function openSceneSetup(store, layer, fx, project) {
  for (const pd of getEffectDef('element3d')?.params || []) if (!fx.params[pd.key]) fx.params[pd.key] = { value: pd.default, keys: [] };
  const P = (k) => fx.params[k];
  const get = (k) => valueAt(P(k), store.time);
  const set = (k, v) => { if (!P(k)) return; setValue(P(k), store.time, v); store.commit(); draw(); };
  let root = null, raf = 0;

  const body = () => {
    const obj = get('object') | 0 || 1, info = modelInfo(get('modelId'));
    const rng = (k, label, min, max, step, mul = 1) => `<label class="e3-rng">${label}<input type="range" data-k="${k}" data-mul="${mul}" min="${min}" max="${max}" step="${step}" value="${(get(k) ?? 0) * mul}"><output>${+((get(k) ?? 0)).toFixed(3)}</output></label>`;
    return `<div class="e3">
      <div class="e3-bar">
        <button class="primary" data-a="import">⤒ Importar modelo (OBJ / GLB)</button>
        <button data-a="tex">🖼 Importar textura</button>
        <button data-a="extrude" title="Extruda o texto ou o PNG/logo da camada">⬚ Extrudar</button>
      </div>
      <div class="e3-main">
        <div class="e3-scene">
          <b class="small muted">CENA</b>
          ${OBJECTS.map((o, i) => `<button class="e3-obj ${obj === i + 1 ? 'on' : ''}" data-obj="${i + 1}">${escapeHtml(o)}${i === 7 && info?.tris ? `<small>${escapeHtml(info.name || '')} · ${info.tris.toLocaleString('pt-BR')} tri.</small>` : ''}</button>`).join('')}
        </div>
        <div class="e3-view"><canvas></canvas><span class="small muted">Arraste para girar · role/pinça para tamanho</span></div>
        <div class="e3-edit">
          <b class="small muted">MATERIAL</b>
          <div class="e3-mats">${MATS.map(([n, bg], i) => `<button class="e3-mat ${(get('material') | 0) === i + 1 ? 'on' : ''}" data-mat="${i + 1}" title="${n}"><i style="background:${bg}"></i><span>${n}</span></button>`).join('')}</div>
          <label class="e3-rng">Cor <input type="color" data-col="color" value="${hex(get('color'))}"></label>
          <label class="e3-rng">Textura <select data-k="texMode">${['Só a cor', 'Textura importada', 'Clipe / vídeo da camada'].map((o, i) => `<option value="${i + 1}" ${(get('texMode') | 0 || 1) === i + 1 ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
          ${rng('gloss', 'Brilho %', 0, 100, 1)}${rng('reflect', 'Reflexo %', 0, 200, 1)}
          <b class="small muted">GEOMETRIA</b>
          ${obj === 1 ? `<label class="e3-rng">Texto <input type="text" data-txt="text" value="${escapeHtml(get('text') ?? '')}"></label>` : ''}
          ${rng('extrude', 'Extrusão', 0, 3, 0.01)}${rng('bevel', 'Chanfro', 0, 0.25, 0.005)}${rng('objSize', 'Tamanho (px)', 10, 3000, 1)}
          <b class="small muted">AMBIENTE E LUZ</b>
          <label class="e3-rng">Reflexo de <select data-k="envMode"><option value="1" ${(get('envMode') | 0) !== 2 ? 'selected' : ''}>Estúdio</option><option value="2" ${(get('envMode') | 0) === 2 ? 'selected' : ''}>A própria camada</option></select></label>
          ${rng('lightInt', 'Luz', 0, 5, 0.05)}${rng('ambient', 'Ambiente %', 0, 100, 1)}${rng('rim', 'Rim light %', 0, 300, 1)}
          ${rng('spinY', 'Giro automático °/s', -360, 360, 1)}
        </div>
      </div>
    </div>`;
  };

  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const c = root?.querySelector('.e3-view canvas'); if (!c) return;
      const W = c.clientWidth || 320, sc = Math.min(W / project.width, 420 / project.height);
      c.width = Math.round(project.width * sc); c.height = Math.round(project.height * sc);
      try { renderFrame(c.getContext('2d'), project, store.time, sc, {}); } catch { /* prévia */ }
    });
  }

  function mount(wrap) {
    root = wrap.querySelector('.modal-body');
    root.innerHTML = body();
    bind();
    draw();
  }
  function rerender() { root.innerHTML = body(); bind(); draw(); }

  function bind() {
    root.querySelectorAll('[data-obj]').forEach((b) => b.addEventListener('click', () => {
      const o = +b.dataset.obj;
      if (o === 8 && !get('modelId')) { importModel(); return; }
      set('object', o); rerender();
    }));
    root.querySelectorAll('[data-mat]').forEach((b) => b.addEventListener('click', () => { set('material', +b.dataset.mat); rerender(); }));
    root.querySelectorAll('input[type=range][data-k]').forEach((r) => r.addEventListener('input', () => { set(r.dataset.k, +r.value / +r.dataset.mul); r.nextElementSibling.textContent = (+r.value).toFixed(2).replace(/\.00$/, ''); }));
    root.querySelectorAll('select[data-k]').forEach((s) => s.addEventListener('change', () => { set(s.dataset.k, +s.value); if (s.dataset.k === 'texMode' && +s.value === 2 && !get('texId')) importTex(); }));
    root.querySelector('[data-col]')?.addEventListener('input', (e) => { const h = e.target.value; set('color', [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1]); });
    root.querySelector('[data-txt]')?.addEventListener('input', (e) => set('text', e.target.value));
    root.querySelector('[data-a="import"]').addEventListener('click', importModel);
    root.querySelector('[data-a="tex"]').addEventListener('click', importTex);
    root.querySelector('[data-a="extrude"]').addEventListener('click', () => { set('object', layer.type === 'text' || (get('object') | 0) !== 1 ? 1 : 7); rerender(); });
    // girar arrastando na prévia (como o orbit da Scene Setup)
    const cv = root.querySelector('.e3-view canvas');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, rx: get('rotX') ?? 0, ry: get('rotY') ?? 0 }; });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; setValue(P('rotY'), store.time, drag.ry + (e.clientX - drag.x) * 0.6); setValue(P('rotX'), store.time, drag.rx - (e.clientY - drag.y) * 0.6); draw(); });
    cv.addEventListener('pointerup', () => { if (drag) { drag = null; store.commit(); } });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); set('objSize', Math.max(10, (get('objSize') ?? 500) * (e.deltaY < 0 ? 1.08 : 0.93))); }, { passive: false });
  }

  async function importModel() {
    const files = await pickFiles('.obj,.glb,.gltf,.mtl,image/*', true);
    if (!files?.length) return;
    try {
      const r = await importModelFiles(files);
      if (!r.modelId && !r.texId) { toast('Escolha um arquivo .obj, .glb ou .gltf (pode junto com a textura .png/.jpg).', 'warn', 5000); return; }
      if (r.modelId) { set('modelId', r.modelId); set('object', 8); }
      if (r.texId) { set('texId', r.texId); set('texMode', 2); }
      else if (r.info?.color && r.modelId) set('color', [...r.info.color, 1]);
      getModel(r.modelId);
      toast(r.info ? `Modelo “${r.info.name}” importado (${r.info.tris.toLocaleString('pt-BR')} triângulos)${r.texId ? ' com textura' : ''} ✓` : 'Textura importada ✓', 'ok', 4000);
      rerender();
    } catch (e) { toast(`Não consegui ler o modelo: ${e.message || e}`, 'error', 6000); }
  }
  async function importTex() {
    const files = await pickFiles('image/*', false);
    if (!files?.length) return;
    const r = await importModelFiles(files);
    if (r.texId) { set('texId', r.texId); set('texMode', 2); toast('Textura aplicada ✓', 'ok'); rerender(); }
  }

  return modal('Element 3D · Scene Setup', '', [{ label: 'OK', value: true, primary: true }], { wide: true, onMount: mount }).then(() => { cancelAnimationFrame(raf); store.commit(); });
}

function hex(c) {
  const v = Array.isArray(c) ? c : [0.85, 0.87, 0.9];
  return '#' + v.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}
