// Gera o pacote de atualização automática (publicado junto do site):
//   www/version.json  → { version, date, apk, exe, update }
//   www/app-update.zip → arquivos do editor (sem vendor/, que quase nunca muda) para o app de desktop se atualizar sozinho
import fs from 'node:fs';
import path from 'node:path';
import { makeZip } from '../js/zip-write.js';
const root = path.resolve('www');
const ver = (fs.readFileSync('js/projects.js', 'utf8').match(/APP_VERSION = '(v\d+)'/) || [])[1];
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const rel = path.relative(root, p).split(path.sep).join('/'); if (fs.statSync(p).isDirectory()) { if (!/^(vendor|tools|downloads)$/.test(rel)) walk(p); } else if (!/^(app-update\.zip|version\.json)$/.test(rel)) files.push({ name: rel, data: fs.readFileSync(p) }); } };
walk(root);
fs.writeFileSync(path.join(root, 'app-update.zip'), makeZip(files));
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: ver, date: new Date().toISOString(), update: 'app-update.zip', apk: 'downloads/MotionFrame.apk', exe: 'downloads/MotionFrame.exe' }, null, 1));
console.log('atualização', ver, files.length, 'arquivos');
