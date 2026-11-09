// Gera js/ffx-templates.js: para cada efeito (matchName) achado em .ffx reais do After Effects, guarda o bloco
// "sspc" (definição + valores dos parâmetros, exatamente como o AE grava). O exportador de .ffx usa esses moldes e
// só troca os valores — assim o After Effects abre o arquivo. Não guarda o Magic Bullet Looks (dados do look).
// Uso: node tools/ffx-templates.mjs <pastas ou arquivos .ffx...>
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const add = (p) => { const s = statSync(p); if (s.isDirectory()) for (const f of readdirSync(p)) add(join(p, f)); else if (/\.ffx$/i.test(p)) files.push(p); };
process.argv.slice(2).forEach(add);

const SKIP = /^(MB |ADBE Effect Built In)|LookSuite|Magic Bullet|Colorista|Universe|Deep Glow|Element|Optical Flares/i;
const out = {};
const MAXB = +(process.env.MAXB || 60000); // blocos maiores (ex.: Twixtor) com MAXB=200000
const id = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const cstr = (d, o, n) => { let s = ''; for (let i = 0; i < n && d[o + i]; i++) s += String.fromCharCode(d[o + i]); return s; };
let lhd3 = null;

for (const f of files) {
  const d = new Uint8Array(readFileSync(f));
  if (id(d, 0) !== 'RIFX') continue;
  if (!lhd3) { const i = Buffer.from(d).indexOf('lhd3'); if (i > 0 && u32(d, i + 4) === 52) lhd3 = Buffer.from(d.slice(i + 8, i + 60)).toString('base64'); }
  // dentro de cada besc: caminhos (tdsp com tdmn do efeito), depois os sspc na mesma ordem
  const walk = (o, end) => {
    while (o + 8 <= end) {
      const cid = id(d, o), n = u32(d, o + 4);
      if (cid === 'LIST' && id(d, o + 8) === 'besc') {
        const names = [], blocks = [];
        let p = o + 12; const e = o + 8 + n;
        while (p + 8 <= e) {
          const c = id(d, p), m = u32(d, p + 4);
          if (c === 'LIST' && id(d, p + 8) === 'tdsp') {
            const s = Buffer.from(d.slice(p, p + 8 + m));
            const tdmns = []; let q = 0; while ((q = s.indexOf('tdmn', q)) >= 0) { tdmns.push(cstr(s, q + 8, 40)); q += 4; }
            const mn = tdmns.filter((x) => x !== 'ADBE Effect Parade')[0];
            if (mn && mn !== 'ADBE End of path sentinel') names.push(mn);
          }
          if (c === 'LIST' && id(d, p + 8) === 'sspc') blocks.push(d.slice(p, p + 8 + m + (m & 1)));
          p += 8 + m + (m & 1);
        }
        names.forEach((mn, i) => { if (blocks[i] && !SKIP.test(mn) && blocks[i].length < MAXB && !out[mn]) out[mn] = Buffer.from(blocks[i]).toString('base64'); });
      }
      o += 8 + n + (n & 1);
    }
  };
  walk(12, d.length);
}
// ---- limpeza: nada de animação nem expressão dos presets originais nos moldes (só a estrutura do efeito)
const enc = new TextEncoder();
function tree(d, o = 0, end = d.length) {
  const out = [];
  while (o + 8 <= end) {
    const cid = id(d, o), n = u32(d, o + 4);
    if (cid === 'LIST') out.push({ id: cid, type: id(d, o + 8), kids: tree(d, o + 12, o + 8 + n) });
    else out.push({ id: cid, data: d.slice(o + 8, o + 8 + n) });
    o += 8 + n + (n & 1);
  }
  return out;
}
function ser(node) {
  const payload = node.id === 'LIST' ? Buffer.concat([Buffer.from(node.type), ...node.kids.map(ser)]) : Buffer.from(node.data);
  const h = Buffer.alloc(8); h.write(node.id, 0, 'latin1'); h.writeUInt32BE(payload.length, 4);
  return Buffer.concat([h, payload, ...(payload.length & 1 ? [Buffer.alloc(1)] : [])]);
}
function clean(node) {
  if (node.id !== 'LIST') return node;
  if (node.type === 'tdbs') {
    const lst = node.kids.find((k) => k.type === 'list');
    node.kids = node.kids.filter((k) => k.id !== 'Utf8'); // expressões
    if (lst) {
      const t4 = node.kids.find((k) => k.id === 'tdb4');
      const dims = t4 ? ((t4.data[2] << 8) | t4.data[3]) || 1 : 1;
      const ld = lst.kids.find((k) => k.id === 'ldat')?.data;
      const vals = new Array(Math.max(5, dims)).fill(0);
      if (ld && ld.length >= 8 + 8 * dims) { const dv = new DataView(ld.buffer, ld.byteOffset, ld.byteLength); const off = dims === 4 ? 48 : 8; for (let j = 0; j < dims && off + j * 8 + 8 <= ld.length; j++) vals[j] = dv.getFloat64(off + j * 8); }
      const cd = new Uint8Array(vals.length * 8); const cv = new DataView(cd.buffer); vals.forEach((v, j) => cv.setFloat64(j * 8, Number.isFinite(v) ? v : 0));
      const i = node.kids.indexOf(lst);
      node.kids.splice(i, 1, { id: 'cdat', data: cd });
      if (t4) { t4.data = t4.data.slice(); t4.data[4] = 0; t4.data[5] = 1; }
    }
  }
  node.kids = node.kids.map(clean);
  return node;
}
// MERGE=1: mantém os moldes que já existem e só acrescenta os novos
const fresh = new Set(Object.keys(out));
if (process.env.MERGE) {
  const prev = await import(new URL('../js/ffx-templates.js', import.meta.url));
  for (const [k, v] of Object.entries(prev.TEMPLATES)) { out[k] = v; fresh.delete(k); } // moldes antigos (já limpos) ficam como estão
  if (!lhd3 && prev.LHD3 && prev.LHD3 !== 'null') lhd3 = prev.LHD3;
}
for (const mn of Object.keys(out)) {
  if (!fresh.has(mn)) continue; // moldes antigos já estão limpos
  const [root] = tree(new Uint8Array(Buffer.from(out[mn], 'base64')));
  out[mn] = ser(clean(root)).toString('base64');
}
void enc;
const body = `// Gerado por tools/ffx-templates.mjs — moldes de efeitos do After Effects (bloco sspc) para o exportador de .ffx.\nexport const LHD3 = '${lhd3}';\nexport const TEMPLATES = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n"')};\n`;
writeFileSync(new URL('../js/ffx-templates.js', import.meta.url), body);
console.log(Object.keys(out).length, 'efeitos:', Object.keys(out).join(', '));
console.log('tamanho', (body.length / 1024).toFixed(0), 'KB');
