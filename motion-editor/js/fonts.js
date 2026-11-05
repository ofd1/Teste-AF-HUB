// Fontes do usuário: .ttf/.otf/.woff/.woff2 carregadas com FontFace, guardadas no IndexedDB (chave "__font:…",
// protegida da limpeza de mídia) e listadas no seletor de fonte do texto. Projetos .aep que pedem uma fonte
// com o mesmo nome passam a usá-la automaticamente.
import { putMedia, getMedia } from './idb.js';
import { storage } from './ui.js';

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
