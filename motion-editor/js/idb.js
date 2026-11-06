// Armazena arquivos de mídia importados no IndexedDB para o projeto sobreviver ao fechar o app.
const DB = 'motionframe-media';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('media');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('media', mode);
    const r = fn(t.objectStore('media'));
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
  });
}

// Gravações em andamento: quem lê a mesma mídia (abrir o projeto logo depois de importar) espera a gravação terminar.
const pending = new Map();

export function putMedia(id, blob) {
  const p = (async () => { try { await tx('readwrite', (s) => s.put(blob, id)); return true; } catch { return false; } })();
  pending.set(id, p);
  p.finally(() => { if (pending.get(id) === p) pending.delete(id); });
  return p;
}

export async function getMedia(id) {
  if (pending.has(id)) await pending.get(id);
  try { return await tx('readonly', (s) => s.get(id)); } catch { return null; }
}

/** Espera todas as gravações pendentes (antes de sair do projeto / abrir outro). */
export async function flushMedia() { while (pending.size) await Promise.all([...pending.values()]); }
export const pendingMediaCount = () => pending.size;

/** Pede ao navegador para não apagar os dados do app quando faltar espaço (Android/Chrome, iOS 16+). */
export async function ensurePersistentStorage() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist(); return true; } catch { return false; }
}

export async function pruneMedia(keepIds) {
  try {
    const d = await db();
    const t = d.transaction('media', 'readwrite');
    const s = t.objectStore('media');
    const req = s.getAllKeys();
    req.onsuccess = () => { for (const k of req.result) if (!keepIds.has(k) && !String(k).startsWith('__')) s.delete(k); }; // '__…' = dados do app (biblioteca)
  } catch { /* ignorado */ }
}

export async function deleteMedia(id) {
  try { await tx('readwrite', (s) => s.delete(id)); return true; } catch { return false; }
}

/** Chaves guardadas que começam com o prefixo (ex.: '__bak_'). */
export async function listKeys(prefix = '') {
  try {
    const d = await db();
    return await new Promise((res) => {
      const req = d.transaction('media', 'readonly').objectStore('media').getAllKeys();
      req.onsuccess = () => res(req.result.map(String).filter((k) => k.startsWith(prefix)));
      req.onerror = () => res([]);
    });
  } catch { return []; }
}
