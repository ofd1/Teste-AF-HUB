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

export async function putMedia(id, blob) {
  try { await tx('readwrite', (s) => s.put(blob, id)); return true; } catch { return false; }
}

export async function getMedia(id) {
  try { return await tx('readonly', (s) => s.get(id)); } catch { return null; }
}

export async function pruneMedia(keepIds) {
  try {
    const d = await db();
    const t = d.transaction('media', 'readwrite');
    const s = t.objectStore('media');
    const req = s.getAllKeys();
    req.onsuccess = () => { for (const k of req.result) if (!keepIds.has(k)) s.delete(k); };
  } catch { /* ignorado */ }
}
