// Tela "Configurações da composição" no estilo do After Effects (Composition Settings):
// abas Básico / Avançado, predefinições, largura/altura com proporção travada, taxa de quadros,
// resolução, código de tempo inicial, duração em timecode, cor de fundo e âncora para redimensionar.
import { escapeHtml } from './util.js';

export const COMP_PRESETS = [
  { id: 'tiktok30', label: 'TikTok / Reels / Shorts 1080×1920 30', w: 1080, h: 1920, fps: 30 },
  { id: 'tiktok60', label: 'TikTok / Reels / Shorts 1080×1920 60', w: 1080, h: 1920, fps: 60 },
  { id: 'story720', label: 'Vertical 720×1280 30', w: 720, h: 1280, fps: 30 },
  { id: 'ig45', label: 'Instagram Retrato 1080×1350 30', w: 1080, h: 1350, fps: 30 },
  { id: 'square', label: 'Quadrado 1080×1080 30', w: 1080, h: 1080, fps: 30 },
  { id: 'hd30', label: 'HDTV 1080 30', w: 1920, h: 1080, fps: 30 },
  { id: 'hd25', label: 'HDTV 1080 25', w: 1920, h: 1080, fps: 25 },
  { id: 'hd24', label: 'HDTV 1080 24', w: 1920, h: 1080, fps: 24 },
  { id: 'hd60', label: 'HDTV 1080 60', w: 1920, h: 1080, fps: 60 },
  { id: 'hd720', label: 'HDV/HDTV 720 30', w: 1280, h: 720, fps: 30 },
  { id: 'uhd', label: 'UHD 4K 3840×2160 30', w: 3840, h: 2160, fps: 30 },
  { id: 'uhdv', label: 'UHD 4K vertical 2160×3840 30', w: 2160, h: 3840, fps: 30 },
];
const FPS = [24, 25, 30, 48, 50, 60];
const RES = [['auto', 'Auto (cheia parado, ½ tocando)'], ['1', 'Cheia'], ['0.5', 'Metade'], ['0.33', 'Um terço']];
const BG = [['#000000', 'Preto'], ['#ffffff', 'Branco'], ['#808080', 'Cinza'], ['#00ff00', 'Verde (chroma)']];

const pad2 = (n) => String(n).padStart(2, '0');
/** segundos → H:MM:SS:FF */
export function toTimecode(sec, fps) {
  const total = Math.round(sec * fps);
  const f = total % fps, s = Math.floor(total / fps);
  return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}:${pad2(f)}`;
}
/** H:MM:SS:FF (ou SS:FF, ou segundos com ponto) → segundos */
export function fromTimecode(str, fps) {
  const s = String(str).trim();
  if (/^\d+([.,]\d+)?$/.test(s)) return parseFloat(s.replace(',', '.'));
  const parts = s.split(/[:;]/).map((x) => parseInt(x, 10) || 0);
  while (parts.length < 4) parts.unshift(0);
  const [h, m, sec, f] = parts.slice(-4);
  return h * 3600 + m * 60 + sec + f / fps;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const ratio = (w, h) => { const g = gcd(Math.round(w), Math.round(h)) || 1; return `${Math.round(w) / g}:${Math.round(h) / g}`; };

/**
 * Abre a tela. mode: 'new' (nova composição) ou 'edit'. Retorna Promise<settings|null>.
 * settings = { name, width, height, fps, duration, background, startTC, resolution, anchor:[ax,ay] (0..1), scaleLayers }
 */
export function compDialog({ mode = 'new', project = null, hasContent = false, resolution = 'auto' } = {}) {
  const p = project || { name: 'Comp 1', width: 1080, height: 1920, fps: 30, duration: 10, background: '#000000', startTC: 0 };
  const name = mode === 'new' ? 'Comp 1' : p.name || 'Meu edit';
  const preset = COMP_PRESETS.find((x) => x.w === p.width && x.h === p.height && x.fps === p.fps);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal comp-dlg" role="dialog" aria-modal="true">
      <header><h2>${mode === 'new' ? 'Nova composição' : 'Configurações da composição'}</h2><button class="x" aria-label="Fechar">✕</button></header>
      <div class="modal-body">
        <label class="cd-name"><span>Nome da composição:</span><input type="text" data-f="name" value="${escapeHtml(name)}"></label>
        <div class="cd-tabs"><button class="on" data-tab="basic">Básico</button><button data-tab="adv">Avançado</button></div>
        <div class="cd-pane" data-pane="basic">
          <label class="cd-row"><span>Predefinição:</span><select data-f="preset">
            <option value="custom" ${preset ? '' : 'selected'}>Personalizado</option>
            ${COMP_PRESETS.map((x) => `<option value="${x.id}" ${preset?.id === x.id ? 'selected' : ''}>${escapeHtml(x.label)}</option>`).join('')}
          </select></label>
          <div class="cd-row cd-size">
            <span>Largura:</span><input type="number" inputmode="numeric" data-f="w" value="${p.width}" min="16" max="8192"><em>px</em>
            <span>Altura:</span><input type="number" inputmode="numeric" data-f="h" value="${p.height}" min="16" max="8192"><em>px</em>
          </div>
          <label class="cd-check"><input type="checkbox" data-f="lock" checked> <span>Travar proporção em <b data-ratio>${ratio(p.width, p.height)}</b></span></label>
          <label class="cd-row"><span>Proporção de pixel:</span><select disabled><option>Pixels quadrados</option></select><em data-ar>Proporção do quadro: ${ratio(p.width, p.height)}</em></label>
          <label class="cd-row"><span>Taxa de quadros:</span><select data-f="fps">${FPS.map((f) => `<option ${f === p.fps ? 'selected' : ''}>${f}</option>`).join('')}</select><em>quadros por segundo</em></label>
          <label class="cd-row"><span>Resolução:</span><select data-f="res">${RES.map(([v, l]) => `<option value="${v}" ${v === String(resolution) ? 'selected' : ''}>${l}</option>`).join('')}</select><em data-resinfo></em></label>
          <label class="cd-row"><span>Código de tempo inicial:</span><input type="text" data-f="start" value="${toTimecode(p.startTC || 0, p.fps)}"><em>é ${toTimecode(p.startTC || 0, p.fps)} Base ${p.fps}</em></label>
          <label class="cd-row"><span>Duração:</span><input type="text" data-f="dur" value="${toTimecode(p.duration, p.fps)}"><em data-durinfo>é ${toTimecode(p.duration, p.fps)} Base ${p.fps}</em></label>
          <label class="cd-row"><span>Cor de fundo:</span><input type="color" data-f="bg" value="${p.background || '#000000'}"><em data-bgname></em></label>
        </div>
        <div class="cd-pane" data-pane="adv" hidden>
          <div class="cd-row"><span>Âncora:</span>
            <div class="cd-anchor">${[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => `<button data-ax="${x}" data-ay="${y}" class="${x === 0.5 && y === 0.5 ? 'on' : ''}" aria-label="Âncora"></button>`)).join('')}</div>
            <em>Ao mudar o tamanho, as camadas ficam presas a este ponto (como no AE).</em>
          </div>
          <label class="cd-check"><input type="checkbox" data-f="scaleLayers"> <span>Escalar as camadas junto com o novo tamanho</span></label>
          <p class="muted small">Renderizador: WebGL (efeitos na GPU) · Motion blur: ângulo do obturador 180° · Exportação MP4 H.264 + AAC.</p>
        </div>
        ${mode === 'new' && hasContent ? '<p class="warn-text small">O projeto atual será substituído (salve antes, se precisar).</p>' : ''}
      </div>
      <footer><button data-a="cancel">Cancelar</button><button class="primary" data-a="ok">OK</button></footer>
    </div>`;
    const $ = (s) => wrap.querySelector(s);
    const W = $('[data-f="w"]'), H = $('[data-f="h"]'), FPSel = $('[data-f="fps"]'), lock = $('[data-f="lock"]');
    let aspect = p.width / p.height;
    let anchor = [0.5, 0.5];
    const refresh = () => {
      const w = +W.value || 1, h = +H.value || 1, fps = +FPSel.value;
      $('[data-ratio]').textContent = ratio(w, h);
      $('[data-ar]').textContent = `Proporção do quadro: ${ratio(w, h)}`;
      const r = $('[data-f="res"]').value;
      const q = r === 'auto' ? 1 : +r;
      $('[data-resinfo]').textContent = `${Math.round(w * q)} × ${Math.round(h * q)}, ${((w * q * h * q * 4) / 1048576).toFixed(1)} MB por quadro`;
      const d = fromTimecode($('[data-f="dur"]').value, fps);
      $('[data-durinfo]').textContent = `é ${toTimecode(d, fps)} Base ${fps}`;
      const bg = $('[data-f="bg"]').value.toLowerCase();
      $('[data-bgname]').textContent = BG.find(([c]) => c === bg)?.[1] || bg;
      const match = COMP_PRESETS.find((x) => x.w === w && x.h === h && x.fps === fps);
      $('[data-f="preset"]').value = match ? match.id : 'custom';
    };
    W.addEventListener('input', () => { if (lock.checked) H.value = Math.round(+W.value / aspect); refresh(); });
    H.addEventListener('input', () => { if (lock.checked) W.value = Math.round(+H.value * aspect); refresh(); });
    lock.addEventListener('change', () => { aspect = (+W.value || 1) / (+H.value || 1); });
    for (const s of ['[data-f="fps"]', '[data-f="res"]', '[data-f="dur"]', '[data-f="bg"]']) $(s).addEventListener('input', refresh);
    $('[data-f="dur"]').addEventListener('change', () => { $('[data-f="dur"]').value = toTimecode(fromTimecode($('[data-f="dur"]').value, +FPSel.value), +FPSel.value); refresh(); });
    $('[data-f="preset"]').addEventListener('change', (e) => {
      const x = COMP_PRESETS.find((c) => c.id === e.target.value);
      if (!x) return;
      W.value = x.w; H.value = x.h; FPSel.value = x.fps; aspect = x.w / x.h;
      refresh();
    });
    wrap.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      wrap.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      wrap.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== b.dataset.tab; });
    }));
    wrap.querySelectorAll('[data-ax]').forEach((b) => b.addEventListener('click', () => {
      wrap.querySelectorAll('[data-ax]').forEach((x) => x.classList.toggle('on', x === b));
      anchor = [+b.dataset.ax, +b.dataset.ay];
    }));
    const close = (v) => { wrap.remove(); resolve(v); };
    $('.x').addEventListener('click', () => close(null));
    $('[data-a="cancel"]').addEventListener('click', () => close(null));
    $('[data-a="ok"]').addEventListener('click', () => {
      const fps = +FPSel.value;
      close({
        name: $('[data-f="name"]').value.trim() || 'Comp 1',
        width: Math.max(16, Math.min(8192, Math.round(+W.value || p.width))),
        height: Math.max(16, Math.min(8192, Math.round(+H.value || p.height))),
        fps,
        duration: Math.max(1 / fps, Math.min(3600, fromTimecode($('[data-f="dur"]').value, fps) || p.duration)),
        startTC: Math.max(0, fromTimecode($('[data-f="start"]').value, fps) || 0),
        background: $('[data-f="bg"]').value,
        resolution: $('[data-f="res"]').value,
        anchor,
        scaleLayers: $('[data-f="scaleLayers"]').checked,
      });
    });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(null); });
    document.body.appendChild(wrap);
    refresh();
  });
}
