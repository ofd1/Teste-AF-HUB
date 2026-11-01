// Copia os arquivos do app para www/ (pasta usada pelo Capacitor para Android/iOS).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'presets']) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}
console.log('www/ pronto');
