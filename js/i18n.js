// Idioma da interface (Português / English). A tradução é feita na tela (textos, dicas e campos), então vale para
// painéis e janelas criados depois. A busca de efeitos entende os dois idiomas sempre (ex.: "desfoque" ou "blur").
import { storage } from './ui.js';

const KEY = 'motionframe.lang';
export const getLang = () => storage.get(KEY, 'pt');
export function setLang(l) { storage.set(KEY, l); location.reload(); }

// nomes em inglês (como no After Effects) dos efeitos que têm nome em português
export const EN_FX = {
  blur: 'Gaussian Blur', dirBlur: 'Directional Blur', radialBlur: 'Radial / Zoom Blur', motionBlur: 'Motion Blur (RSMB style)', lightRays: 'Light Rays',
  exposure: 'Exposure', brightnessContrast: 'Brightness & Contrast', hueSat: 'Hue/Saturation', levels: 'Levels', vibrance: 'Vibrance', tint: 'Tint',
  blackWhite: 'Black & White', invert: 'Invert', fill: 'Fill', ramp: 'Gradient Ramp', posterize: 'Posterize', threshold: 'Threshold', looks: 'Looks (full CC)',
  sharpen: 'Sharpen', fourColor: '4-Color Gradient', warp: 'Warp', flicker: 'Flicker', photoFilter: 'Photo Filter', liftGammaGain: 'Colorista (3-Way)',
  bulge: 'Bulge / CC Lens', twirl: 'Twirl', optics: 'Optics Compensation', mirror: 'Mirror', kaleida: 'CC Kaleida', dropShadow: 'Drop Shadow', outline: 'Stroke',
  mosaic: 'Mosaic / Pixelate', vignette: 'Vignette', noise: 'Noise / Grain', rgbSplit: 'Chromatic Aberration (RGB Split)', prism: 'Prism', glitch: 'Digital Glitch',
  vhs: 'VHS / Retro', findEdges: 'Find Edges', linearWipe: 'Linear Wipe', radialWipe: 'Radial Wipe', blinds: 'Venetian Blinds', blockDissolve: 'Block Dissolve',
  shake: 'Shake (camera shake)', blurMoCurves: 'Zoom Motion Blur (BlurMoCurves)', transform: 'Transform', twixtor: 'Speed (Twixtor style)', posterizeTime: 'Posterize Time',
  echo: 'Echo', shatter: 'Shatter', timeSlice: 'Time Slice', bgRemove: 'Remove Background (AI)', timeRemap: 'Time Remap', keylight: 'Keylight (chroma key)',
  starGlow: 'Starglow / S_Glint', lensBlur: 'Camera Lens Blur (bokeh)', curves: 'Curves', tritone: 'Tritone / CC Toner', ripple: 'Ripple', offset: 'Offset',
  stabilize: 'Stabilize (Topaz style)', reflect: 'VC Reflect', halftone: 'S_Halftone', unmult: 'Unmult', clouds: 'Clouds / Fog', autoPaint: 'AutoPaint',
  bevelAlpha: 'Bevel Alpha', cropEdges: 'Crop Edges', colorKey: 'Color Key', changeToColor: 'Change To Color', fishEye: 'Fish Eye (S_WarpFishEye)',
  ballAction: 'Ball Action', timeWarpRGB: 'Time Warp RGB', sSharpen: 'S_Sharpen', zap: 'Zap (lightning)',
};
// palavras que a busca entende nos dois idiomas
const SYN = [
  ['desfoque', 'blur'], ['borrão', 'blur'], ['brilho', 'glow brightness'], ['luz', 'light glow'], ['tremor', 'shake'], ['tremer', 'shake'], ['câmera', 'camera'],
  ['cor', 'color colour'], ['nitidez', 'sharpen sharp'], ['contraste', 'contrast'], ['saturação', 'saturation'], ['matiz', 'hue'], ['exposição', 'exposure'],
  ['ruído', 'noise grain'], ['grão', 'grain'], ['velocidade', 'speed twixtor'], ['câmera lenta', 'slow motion'], ['espelho', 'mirror'], ['distorção', 'distort warp'],
  ['onda', 'wave ripple'], ['transição', 'transition wipe'], ['sombra', 'shadow'], ['contorno', 'stroke outline'], ['vinheta', 'vignette'], ['gradiente', 'gradient ramp'],
  ['raios', 'rays'], ['estrelas', 'star glint'], ['chave', 'key keying'], ['fundo', 'background'], ['tempo', 'time'], ['zoom', 'zoom'], ['girar', 'rotate twirl spin'],
  ['inverter', 'invert reverse'], ['preto e branco', 'black white'], ['tingir', 'tint'], ['curvas', 'curves'], ['níveis', 'levels'], ['estabilizar', 'stabilize warp stabilizer'],
  ['falha', 'glitch'], ['estilhaçar', 'shatter'], ['pixelar', 'pixelate mosaic'], ['lente', 'lens optics'], ['difusão', 'diffusion'], ['realce', 'highlight'],
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Texto pesquisável de um efeito: nome, plugin, categoria, nome em inglês e sinônimos nos dois idiomas. */
export function fxHaystack(e) {
  let h = norm(`${e.label} ${e.plugin || ''} ${e.category} ${e.type} ${EN_FX[e.type] || ''}`);
  for (const [pt, en] of SYN) { const p = norm(pt); if (h.includes(p)) h += ` ${en}`; if (en.split(' ').some((w) => h.includes(w))) h += ` ${p}`; }
  return h;
}
export const fxMatch = (e, q) => { const t = norm(q).trim(); return !t || t.split(/\s+/).every((w) => fxHaystack(e).includes(w)); };

// textos da interface (português → inglês)
const UI = {
  'Meu edit': 'My edit', Exportar: 'Export', Fechar: 'Close', Efeitos: 'Effects', Presets: 'Presets', Propriedades: 'Properties', Keyframes: 'Keyframes', Tracker: 'Tracker', Topaz: 'Topaz',
  'Calibrar CC': 'Match CC', 'Keyframes / gráfico': 'Keyframes / graph', Dividir: 'Split', Duplicar: 'Duplicate', 'Pré-compor': 'Pre-compose', Subir: 'Move up', Descer: 'Move down',
  Ocultar: 'Hide', Mostrar: 'Show', Excluir: 'Delete', 'Vídeo / Foto': 'Video / Photo', Música: 'Music', Texto: 'Text', 'Mais camadas': 'More layers', 'Ajuste (CC)': 'Adjustment (CC)',
  Agrupar: 'Group', 'Importar .ffx': 'Import .ffx', Composição: 'Composition', Velocidade: 'Speed', 'Congelar quadro': 'Freeze frame', 'Inverter (reverse)': 'Reverse', Som: 'Sound',
  'Tirar fundo': 'Remove BG', Desagrupar: 'Ungroup', 'Abrir grupo': 'Open group', 'Sair do grupo': 'Exit group', 'Limpar seleção': 'Clear selection', Sequenciar: 'Sequence',
  'Preset em todas': 'Preset on all', Keyframe: 'Keyframe', 'Todos keys': 'All keys', 'Esticar keys': 'Stretch keys', Marcador: 'Marker',
  'Efeitos da camada': 'Layer effects', 'Adicionar efeito': 'Add effect', 'Keyframes e gráfico': 'Keyframes & graph', 'Adicionar camada': 'Add layer',
  '＋ Adicionar efeito': '＋ Add effect', 'Adicionar efeito ': 'Add effect ', 'Copiar efeitos': 'Copy effects', 'Colar efeitos': 'Paste effects', 'Salvar preset': 'Save preset', 'Exportar .ffx': 'Export .ffx',
  'Comece seu edit': 'Start your edit', '1. Importe o clipe · 2. Aplique um preset ou efeitos · 3. Exportar': '1. Import the clip · 2. Apply a preset or effects · 3. Export',
  'Importar vídeo / foto': 'Import video / photo', 'Presets prontos': 'Ready-made presets', 'Abrir .ffx / .aep / XML': 'Open .ffx / .aep / XML',
  'Selecione uma camada na timeline.': 'Select a layer in the timeline.', 'Meus projetos': 'My projects', 'Conta e acesso': 'Account & access',
  'Baixar o app (PC Windows / Android)': 'Download the app (Windows PC / Android)', 'Como usar (passo a passo)': 'How to use (step by step)', 'Nova composição (projeto)': 'New composition (project)',
  'Abrir projeto (.json)': 'Open project (.json)', 'Salvar projeto (.json)': 'Save project (.json)', 'Configurações da composição': 'Composition settings',
  'Importar preset .ffx do After Effects': 'Import After Effects .ffx preset', 'Ae Abrir projeto .aep do After Effects': 'Ae Open After Effects .aep project',
  'Importar XML (Premiere / Final Cut / DaVinci)': 'Import XML (Alight Motion / Premiere / Final Cut / DaVinci)', 'Importar XML (Alight Motion / Premiere / Final Cut / DaVinci)': 'Import XML (Alight Motion / Premiere / Final Cut / DaVinci)',
  'Importar fontes (.ttf / .otf / .woff)': 'Import fonts (.ttf / .otf / .woff)', 'Atalhos de teclado (After Effects)': 'Keyboard shortcuts (After Effects)', 'Sobre os efeitos e plugins': 'About effects & plugins',
  Menu: 'Menu', Cancelar: 'Cancel', Salvar: 'Save', Aplicar: 'Apply', Nome: 'Name', Largura: 'Width', Altura: 'Height', Cor: 'Color', 'Pai (parent)': 'Parent',
  'Camada 3D (câmera)': '3D Layer (camera)', 'Entrada (s)': 'In point (s)', 'Saída (s)': 'Out point (s)', Modo: 'Mode', 'Opacidade %': 'Opacity %', Posição: 'Position',
  'Escala %': 'Scale %', Rotação: 'Rotation', Ancoragem: 'Anchor point', Fonte: 'Font', Peso: 'Weight', Tamanho: 'Size', Alinhamento: 'Alignment',
  'Buscar efeito (ex.: glow, twixtor, shake)…': 'Search effect (e.g. glow, twixtor, shake, blur)…', Todos: 'All', 'Luz e brilho': 'Light & glow', Movimento: 'Motion', Tempo: 'Time',
  Desfoque: 'Blur', Estilizar: 'Stylize', Distorção: 'Distort', '3D': '3D', Transições: 'Transitions', 'Vídeo / Imagem': 'Video / Image', 'Áudio / Música': 'Audio / Music',
  'Camada de ajuste': 'Adjustment layer', Retângulo: 'Rectangle', Elipse: 'Ellipse', 'Sólido / cor': 'Solid / color', 'Câmera 3D': '3D Camera', 'Null (pai/controle)': 'Null (parent/control)',
  'Pesquisar fonte (ex.: Anton, Bebas, script…)': 'Search font (e.g. Anton, Bebas, script…)', Fontes: 'Fonts', 'Importada': 'Imported', 'Neste PC': 'On this PC',
  'Recriação estilo': 'Recreation, style', 'Ajustes da camada': 'Layer settings', 'Adicionar camada ': 'Add layer ', 'Topaz (melhorar vídeo)': 'Topaz (enhance video)', 'Idioma / Language': 'Idioma / Language', 'Desfazer': 'Undo', 'Refazer': 'Redo',
};
export const UI_EN = UI;

let dict = null;
function buildDict(effects) {
  dict = new Map(Object.entries(UI));
  for (const e of effects || []) if (EN_FX[e.type]) dict.set(e.label, EN_FX[e.type]);
}
/** Traduz os textos de um trecho da tela (só quando a interface está em inglês). */
export function translateDOM(root, effects) {
  if (getLang() !== 'en' || !root) return;
  if (!dict) buildDict(effects);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (tw.nextNode()) nodes.push(tw.currentNode);
  for (const n of nodes) {
    const raw = n.textContent, t = raw.trim();
    if (!t || t.length > 120) continue;
    const en = dict.get(t) || (/^estilo /.test(t) ? t.replace(/^estilo /, 'style ') : null) || (/^Comece tocando em/.test(t) ? 'Start by tapping ' : null);
    if (en && en !== t) n.textContent = raw.replace(t, en);
  }
  const els = root.querySelectorAll ? [root, ...root.querySelectorAll('[title],[placeholder],[aria-label]')] : [];
  for (const el of els) for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute?.(a); if (v && dict.get(v.trim())) el.setAttribute(a, dict.get(v.trim())); }
}
