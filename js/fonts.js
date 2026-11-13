// Fontes do usuário: .ttf/.otf/.woff/.woff2 carregadas com FontFace, guardadas no IndexedDB (chave "__font:…",
// protegida da limpeza de mídia) e listadas no seletor de fonte do texto. Projetos .aep que pedem uma fonte
// com o mesmo nome passam a usá-la automaticamente.
import { putMedia, getMedia } from './idb.js';
import { storage, modal } from './ui.js';

const KEY = 'motionframe.fonts';
const loaded = new Set();
const listeners = new Set();

export const BUILTIN_FONTS = ['Inter, system-ui, sans-serif', 'Impact, "Arial Black", sans-serif', '"Arial Black", sans-serif', 'Georgia, serif', '"Courier New", monospace', '"Trebuchet MS", sans-serif', '"Brush Script MT", cursive'];

export function userFonts() { return storage.get(KEY, []); }
export function fontList() { return [...BUILTIN_FONTS, ...userFonts().map((f) => `"${f.family}", sans-serif`)]; }
export function onFontsChange(fn) { listeners.add(fn); }

function familyFromFile(name) {
  return name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[-_]+(regular|book|normal)$/i, '').replace(/[_]+/g, ' ').trim() || 'Fonte';
}

async function activate(family, buf) {
  if (loaded.has(family)) return true;
  try {
    const ff = new FontFace(family, buf);
    await ff.load();
    document.fonts.add(ff);
    loaded.add(family);
    return true;
  } catch { return false; }
}

// importa arquivos de fonte; devolve { ok:[famílias], bad:[nomes] }
export async function importFonts(files) {
  const ok = [], bad = [];
  const list = userFonts();
  for (const f of files) {
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) { bad.push(f.name); continue; }
    const family = familyFromFile(f.name);
    const buf = await f.arrayBuffer();
    if (!(await activate(family, buf))) { bad.push(f.name); continue; }
    await putMedia(`__font:${family}`, new Blob([buf]));
    if (!list.some((x) => x.family === family)) list.push({ family, file: f.name });
    ok.push(family);
  }
  storage.set(KEY, list);
  listeners.forEach((fn) => fn());
  return { ok, bad };
}

export async function removeFont(family) {
  storage.set(KEY, userFonts().filter((x) => x.family !== family));
  listeners.forEach((fn) => fn());
}

// carrega as fontes salvas ao abrir o app
export async function loadSavedFonts() {
  for (const { family } of userFonts()) {
    const b = await getMedia(`__font:${family}`);
    if (b) await activate(family, await b.arrayBuffer());
  }
  listeners.forEach((fn) => fn());
}

export const isFontFile = (name) => /\.(ttf|otf|woff2?)$/i.test(name);

// ---------------------------------------------------------------- busca de fontes
// Google Fonts populares em edits (carregadas na hora pelo fonts.googleapis.com quando escolhidas)
export const GOOGLE_FONTS = ['Anton', 'Bebas Neue', 'Montserrat', 'Poppins', 'Oswald', 'Roboto', 'Roboto Condensed', 'Inter', 'Open Sans', 'Lato', 'Raleway', 'Archivo Black', 'Archivo Narrow',
  'Barlow', 'Barlow Condensed', 'Rubik', 'Work Sans', 'Nunito', 'Kanit', 'Fjalla One', 'Teko', 'Russo One', 'Black Ops One', 'Bangers', 'Permanent Marker', 'Rock Salt', 'Pacifico',
  'Lobster', 'Righteous', 'Bungee', 'Bungee Inline', 'Monoton', 'Orbitron', 'Audiowide', 'Michroma', 'Exo 2', 'Syncopate', 'Unbounded', 'Space Grotesk', 'Space Mono', 'DM Sans',
  'DM Serif Display', 'Playfair Display', 'Cinzel', 'Cormorant Garamond', 'Libre Baskerville', 'Merriweather', 'Abril Fatface', 'Alfa Slab One', 'Ultra', 'Staatliches', 'Chakra Petch',
  'Rajdhani', 'Saira Condensed', 'Big Shoulders Display', 'League Spartan', 'League Gothic', 'Six Caps', 'Antonio', 'Sora', 'Manrope', 'Outfit', 'Lexend', 'Urbanist', 'Plus Jakarta Sans',
  'Krona One', 'Syne', 'Familjen Grotesk', 'Bricolage Grotesque', 'Dela Gothic One', 'Rubik Mono One', 'Rubik Glitch', 'Rubik Wet Paint', 'Creepster', 'Nosifer', 'Metal Mania',
  'UnifrakturMaguntia', 'Pirata One', 'Grenze Gotisch', 'Press Start 2P', 'VT323', 'Silkscreen', 'Major Mono Display', 'Share Tech Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Caveat',
  'Dancing Script', 'Great Vibes', 'Satisfy', 'Sacramento', 'Allura', 'Yellowtail', 'Kaushan Script', 'Marck Script', 'Shadows Into Light', 'Gloria Hallelujah', 'Indie Flower', 'Amatic SC',
  'Bowlby One', 'Passion One', 'Luckiest Guy', 'Titan One', 'Fredoka', 'Baloo 2', 'Chewy', 'Sigmar', 'Climate Crisis', 'Tilt Warp', 'Tilt Prism', 'Bodoni Moda', 'Fraunces', 'Gloock', 'Instrument Serif',
  // largas/geométricas (logos e mograph)
  'Lexend Zetta', 'Lexend Exa', 'Lexend Mega', 'Montserrat Alternates', 'Tomorrow', 'Goldman', 'Anybody', 'Zen Dots', 'Wallpoet', 'Kanit', 'Prompt', 'Saira', 'Saira Expanded', 'Archivo', 'Red Hat Display', 'Jost', 'Figtree', 'Gabarito', 'Onest', 'Albert Sans', 'Mulish', 'Quicksand', 'Comfortaa', 'Nunito Sans', 'Josefin Sans', 'Bai Jamjuree', 'Darker Grotesque', 'Epilogue', 'Hanken Grotesk', 'Schibsted Grotesk', 'Instrument Sans', 'Geologica', 'Golos Text', 'Rethink Sans', 'Readex Pro', 'Russo One'];
const gLoaded = new Set();
const famOf = (css) => String(css || '').split(',')[0].trim().replace(/^["']|["']$/g, '');

/** Garante que a fonte (Google ou do usuário) esteja carregada antes de desenhar o texto. */
export function ensureFont(css) {
  const fam = famOf(css);
  if (!fam || gLoaded.has(fam) || !GOOGLE_FONTS.includes(fam) || typeof document === 'undefined') return Promise.resolve(false);
  gLoaded.add(fam);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@300;400;600;700;800;900&display=swap`;
  document.head.appendChild(l);
  return new Promise((res) => { l.onload = () => document.fonts.load(`700 40px "${fam}"`).then(() => { listeners.forEach((fn) => fn()); res(true); }, () => res(false)); l.onerror = () => res(false); });
}

let localCache = null;
/** Fontes instaladas no PC (Chrome/Edge no computador; o navegador pede permissão). */
export async function systemFonts() {
  if (localCache) return localCache;
  if (typeof window === 'undefined' || !window.queryLocalFonts) return [];
  try { localCache = [...new Set((await window.queryLocalFonts()).map((f) => f.family))].sort((a, b) => a.localeCompare(b)); } catch { localCache = []; }
  return localCache;
}

/** Janela de busca de fontes: devolve o valor CSS da fonte escolhida (ou null). */
export async function pickFont(current = '') {
  const curFam = famOf(current);
  const all = () => [
    ...BUILTIN_FONTS.map((css) => ({ fam: famOf(css), css, src: 'App' })),
    ...userFonts().map((f) => ({ fam: f.family, css: `"${f.family}", sans-serif`, src: 'Importada' })),
    ...(localCache || []).map((fam) => ({ fam, css: `"${fam}", sans-serif`, src: 'Neste PC' })),
    ...GOOGLE_FONTS.map((fam) => ({ fam, css: `"${fam}", sans-serif`, src: 'Google Fonts' })),
  ];
  const previewLoaded = new Set();
  const preview = (fam) => {
    if (previewLoaded.has(fam) || gLoaded.has(fam) || !GOOGLE_FONTS.includes(fam)) return;
    previewLoaded.add(fam);
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}&text=${encodeURIComponent(fam)}&display=swap`;
    document.head.appendChild(l);
  };
  return modal('Fontes', `<input type="search" class="font-q" placeholder="Pesquisar fonte (ex.: Anton, Bebas, script…)" autofocus>
    <div class="font-filters">${['Todas', 'App', 'Importada', 'Neste PC', 'Google Fonts'].map((x, i) => `<button data-src="${x}" class="${i ? '' : 'on'}">${x}</button>`).join('')}
      ${typeof window !== 'undefined' && window.queryLocalFonts ? '<button data-sys class="sys">🖥 Ver fontes do PC</button>' : ''}</div>
    <div class="font-list"></div>
    <p class="muted small">Importe .ttf/.otf em ☰ Menu › Importar fontes (ou arraste o arquivo). Google Fonts precisam de internet na primeira vez.</p>`,
  [{ label: 'Cancelar', value: null }], {
    onMount: (w, close) => {
      const q = w.querySelector('.font-q'), list = w.querySelector('.font-list');
      let src = 'Todas';
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const items = all().filter((x) => (src === 'Todas' || x.src === src) && (!term || x.fam.toLowerCase().includes(term))).slice(0, 200);
        list.innerHTML = items.map((x) => `<button class="font-item ${x.fam === curFam ? 'cur' : ''}" data-css='${x.css.replace(/'/g, '&#39;')}'><span style='font-family:${x.css.replace(/'/g, '&#39;')}'>${x.fam}</span><em>${x.src}</em></button>`).join('') || '<p class="muted">Nenhuma fonte com esse nome.</p>';
        items.slice(0, 60).forEach((x) => preview(x.fam));
        list.querySelectorAll('.font-item').forEach((b) => b.addEventListener('click', () => close(b.dataset.css)));
      };
      q.addEventListener('input', draw);
      w.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { src = b.dataset.src; w.querySelectorAll('[data-src]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
      w.querySelector('[data-sys]')?.addEventListener('click', async (e) => { e.target.textContent = 'Lendo fontes…'; await systemFonts(); e.target.remove(); src = 'Neste PC'; w.querySelectorAll('[data-src]').forEach((x) => x.classList.toggle('on', x.dataset.src === src)); draw(); });
      draw();
      setTimeout(() => q.focus(), 50);
    },
  });
}
