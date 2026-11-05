// Plugins .aex instalados no MotionFrame. Ao importar um .aex (ou a pasta de plugins inteira), o app lê o arquivo
// (só os bytes: nome, categoria e match name do PiPL — nunca executa), e cada plugin vira um efeito funcional na aba
// "Meus plugins": com o nome do plugin, usando a recriação do MotionFrame já ajustada (modo e valores) para ele.
import { scanAex, aexEquivalents } from './aex-scan.js';
import { matchEffect } from './import-map.js';
import { UTILITY_PLUGINS } from './import-map-pk.js';
import { storage } from './ui.js';

const KEY = 'motionframe.aexPlugins';
const MAX_BYTES = 512 * 1024 * 1024;
let cache = null;

export function installedPlugins() { if (!cache) cache = storage.get(KEY, []); return cache; }
const save = () => { storage.set(KEY, cache); window.dispatchEvent(new CustomEvent('aex-plugins-changed')); };
const pluginId = (e) => `${(e.matchName || e.name).toLowerCase().replace(/\s+/g, ' ').trim()}|${e.category || ''}`;

/** Lê e instala os .aex. onProgress(feitos, total, nomeDoArquivo). Devolve { reports, added, updated, skipped }. */
export async function importAexFiles(files, onProgress = () => {}) {
  const list = [...files].filter((f) => /\.aex$/i.test(f.name));
  const reports = []; let added = 0, updated = 0; const all = installedPlugins();
  const byId = new Map(all.map((p) => [p.id, p]));
  for (let i = 0; i < list.length; i++) {
    const f = list[i]; const path = f.webkitRelativePath || f.name;
    onProgress(i, list.length, f.name);
    if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0)); // deixa a interface respirar
    let r;
    try { r = f.size > MAX_BYTES ? { path, valid_pe: false, error: 'arquivo grande demais', pipl: [] } : scanAex(await f.arrayBuffer(), path); } catch (e) { r = { path, valid_pe: false, error: e.message, pipl: [] }; }
    r.motionframe = r.valid_pe ? aexEquivalents(r, matchEffect, UTILITY_PLUGINS) : [];
    reports.push(r);
    for (const m of r.motionframe) {
      const entry = { id: '', name: m.name, matchName: m.matchName, category: m.category || (path.split('/').slice(-2, -1)[0] || ''), file: f.name, arch: r.architecture,
        effect: m.effect, effectLabel: m.label, kind: m.kind, set: m.set || {}, installedAt: Date.now() };
      entry.id = pluginId(entry);
      if (byId.has(entry.id)) { Object.assign(byId.get(entry.id), entry); updated++; } else { byId.set(entry.id, entry); all.push(entry); added++; }
    }
  }
  onProgress(list.length, list.length, '');
  all.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  save();
  return { reports, added, updated, skipped: files.length - list.length };
}

export function removePlugin(id) { cache = installedPlugins().filter((p) => p.id !== id); save(); }
export function clearPlugins() { cache = []; save(); }
