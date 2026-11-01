// Gera presets/manifest.json a partir dos arquivos em presets/free/<Categoria>/.
// Uso: coloque arquivos .ffx (After Effects) ou .json (presets do app) em presets/free/<Categoria>/
// e rode `npm run presets`. Uma imagem com o mesmo nome (.png/.jpg/.webp/.gif) vira a miniatura.
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const freeDir = join(root, 'presets', 'free');
const THUMBS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const pretty = (s) => s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const presets = [];
for (const file of existsSync(freeDir) ? walk(freeDir) : []) {
  const ext = extname(file).toLowerCase();
  if (ext !== '.ffx' && ext !== '.json') continue;
  const rel = relative(root, file).split(sep).join('/');
  const parts = relative(freeDir, file).split(sep);
  const category = parts.length > 1 ? pretty(parts.slice(0, -1).join(' / ')) : 'Geral';
  const base = basename(file, ext);
  const thumb = THUMBS.map((t) => join(dirname(file), base + t)).find((t) => existsSync(t));
  presets.push({ name: pretty(base), category, file: rel, ...(thumb ? { thumb: relative(root, thumb).split(sep).join('/') } : {}) });
}
writeFileSync(join(root, 'presets', 'manifest.json'), `${JSON.stringify({ generated: new Date().toISOString(), count: presets.length, presets }, null, 2)}\n`);
console.log(`${presets.length} preset(s) no manifest.`);
