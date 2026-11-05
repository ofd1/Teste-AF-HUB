// Ícones de linha do MotionFrame (desenho próprio: traço fino arredondado, 24×24, cor do texto).
// ico('nome') devolve o <svg>; ico() também aceita os símbolos antigos (emoji) e troca pelo ícone equivalente.
const P = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
  start: '<path d="M6 5v14"/><path d="M18 6l-9 6 9 6z"/>',
  end: '<path d="M18 5v14"/><path d="M6 6l9 6-9 6z"/>',
  key: '<path d="M12 4l7 8-7 8-7-8z"/>',
  keys: '<path d="M8 6l5 6-5 6-5-6z"/><path d="M16 6l5 6-5 6-5-6z"/>',
  stretch: '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  marker: '<path d="M6 4h12v9l-6 6-6-6z"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  text: '<path d="M5 6V4.5h14V6"/><path d="M12 4.5V20"/><path d="M9 20h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  presets: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
  adjust: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 000 16z" fill="currentColor" stroke="none"/>',
  group: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
  ungroup: '<rect x="3.5" y="3.5" width="10" height="10" rx="2"/><rect x="10.5" y="10.5" width="10" height="10" rx="2"/>',
  import: '<path d="M12 15V3"/><path d="M7.5 7.5L12 3l4.5 4.5"/><path d="M4 14v4.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V14"/>',
  export: '<path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 14v4.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  effects: '<path d="M4 20L14.5 9.5"/><path d="M13 8l3 3"/><path d="M17.5 3v3M16 4.5h3M20 9v2.5M18.75 10.25h2.5M10 3.5v2M9 4.5h2"/>',
  props: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  graph: '<path d="M4 4v16h16"/><path d="M6 17c5 0 5-10 12-11"/>',
  split: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5L20 17M8 15.5L20 7"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 6A9.8 9.8 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-2.7 3.4M6.3 7.4A15.6 15.6 0 002.5 12S6 18.5 12 18.5a9 9 0 004.2-1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5L18 7"/><path d="M9 7V4.5h6V7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 014.5 6H9l2 2.5h8.5A1.5 1.5 0 0121 10v8.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5z"/>',
  speed: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M10 3h4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  freeze: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5"/>',
  reverse: '<path d="M4 9h14l-3.5-3.5"/><path d="M20 15H6l3.5 3.5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  cut: '<path d="M8 4l8 16M16 4L8 20"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
  solid: '<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="currentColor" stroke="none" opacity=".85"/>',
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  null: '<rect x="5" y="5" width="14" height="14" rx="1" stroke-dasharray="2.5 2"/><path d="M12 9v6M9 12h6"/>',
  tracker: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="2.5"/>',
  sequence: '<rect x="3" y="5" width="7" height="5" rx="1"/><rect x="8.5" y="10" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/>',
  max: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  paste: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 11h6M9 15h4"/>',
  save: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
  account: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  font: '<path d="M4 19l6-14h1l6 14"/><path d="M6.5 14h8"/><path d="M17 19h4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14.5h10"/>',
  xml: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/><path d="M13.5 5l-3 14"/>',
  bgremove: '<path d="M8 4l8 16M16 4L8 20"/><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2.5 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  wave: '<path d="M3 12c2.5-5 4.5-5 6 0s3.5 5 6 0 3.5-5 6 0"/>',
  blur: '<circle cx="12" cy="12" r="8" stroke-dasharray="2 2.5"/><circle cx="12" cy="12" r="3.5"/>',
  distort: '<path d="M4 7c4-3 12 3 16 0M4 12c4-3 12 3 16 0M4 17c4-3 12 3 16 0"/>',
  color: '<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  transition: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/><path d="M9 12h6M13 10l2 2-2 2"/>',
  lens: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 4v4"/>',
  matte: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 16l12-12M8 20L20 8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z"/>',
  minimize: '<path d="M6 9l6 6 6-6"/>',
};
// símbolos antigos → ícone
const GLYPH = {
  '⌂': 'home', '☰': 'props', '↶': 'undo', '↷': 'redo', '▶': 'play', '❚❚': 'pause', '⏮': 'start', '⏭': 'end', '◆': 'key', '◆◆': 'keys', '⟷': 'stretch', '▾': 'marker',
  '🎞': 'media', '♪': 'audio', 'T': 'text', '＋': 'plus', '★': 'presets', '◐': 'adjust', '⊞': 'group', '⊟': 'ungroup', '⤒': 'import', '⤓': 'export', '⚙': 'settings',
  '✦': 'effects', '📈': 'graph', '✂': 'split', '✂︎': 'bgremove', '⧉': 'dup', '▲': 'up', '▼': 'down', '👁': 'eye', '◌': 'eyeOff', '🗑': 'trash', '✕': 'close', '◀': 'back',
  '📂': 'folder', '⏱': 'speed', '✨': 'sparkle', '❄': 'freeze', '⇆': 'reverse', '🔊': 'sound', '🎯': 'target', '▭': 'rect', '◯': 'ellipse', '■': 'solid', '🎥': 'camera',
  '✛': 'null', '⌖': 'tracker', '⇶': 'sequence', '⛶': 'max', '?': 'help', '⎘': 'copy', '📋': 'paste', '🔑': 'account', '⬇': 'download', 'ⓘ': 'info', '🔗': 'link', '🔤': 'font',
  '↑': 'up', '↓': 'down', '⌨': 'keyboard', '⇄': 'xml', '🌐': 'globe', '✚': 'plus', '📂 ': 'folder', '💾': 'export', '❓': 'help', '🔁': 'reverse',
};
export function ico(name, cls = '') {
  const key = P[name] ? name : GLYPH[name];
  if (!key) return name; // texto comum (ex.: "Ae")
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[key]}</svg>`;
}
/** Troca, dentro de um elemento, os símbolos antigos no início dos botões pelo ícone. */
export function iconize(root) {
  if (!root) return;
  root.querySelectorAll('button, .ti, [data-dock], .tp-tools b').forEach((el) => {
    if (el.querySelector('svg.ico')) return;
    if (el.dataset?.cmd === 'menu') { el.innerHTML = ico('menu'); return; }
    const first = el.firstChild;
    if (!first || first.nodeType !== 3) return;
    const txt = first.textContent;
    const m = txt.match(/^\s*([^\s\w.,()]{1,3})\s?/u) || txt.match(/^\s*(T)\s+/);
    if (!m || !GLYPH[m[1]]) { if (GLYPH[txt.trim()]) { first.textContent = ''; el.insertAdjacentHTML('afterbegin', ico(txt.trim())); } return; }
    first.textContent = txt.slice(m[0].length);
    el.insertAdjacentHTML('afterbegin', ico(m[1]) + (first.textContent.trim() ? ' ' : ''));
  });
}
