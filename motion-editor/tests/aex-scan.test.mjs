import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAex, parsePiPL, aexEquivalents } from '../js/aex-scan.js';
import { matchEffect } from '../js/import-map.js';

// PE x64 mínimo e inofensivo (sem código), só com uma seção .rsrc contendo um recurso "PIPL" — nunca é executado.
function fakeAex({ name, category, matchName }) {
  const le = (n, v) => { const a = new Uint8Array(n); new DataView(a.buffer).setUint32(0, v, true); return a; };
  const pstr = (s) => { const a = new Uint8Array((s.length + 1 + 3) & ~3); a[0] = s.length; for (let i = 0; i < s.length; i++) a[1 + i] = s.charCodeAt(i); return a; };
  const cc = (s) => (s.charCodeAt(0) << 24 | s.charCodeAt(1) << 16 | s.charCodeAt(2) << 8 | s.charCodeAt(3)) >>> 0;
  const props = [['kind', le(4, cc('eFKT'))], ['name', pstr(name)], ['catg', pstr(category)], ['eMNA', pstr(matchName)]];
  const parts = [new Uint8Array([1, 0, 0, 0, 0, 0]), le(4, props.length)];
  for (const [k, d] of props) parts.push(le(4, cc('8BIM')), le(4, cc(k)), le(4, 0), le(4, d.length), d);
  const pipl = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { pipl.set(p, o); o += p.length; }
  const file = new Uint8Array(0x400 + 0x200 + pipl.length + 16); const dv = new DataView(file.buffer);
  file[0] = 0x4d; file[1] = 0x5a; dv.setUint32(0x3c, 0x80, true); dv.setUint32(0x80, 0x4550, true);
  const coff = 0x84; dv.setUint16(coff, 0x8664, true); dv.setUint16(coff + 2, 1, true); dv.setUint16(coff + 16, 240, true);
  const opt = coff + 20; dv.setUint16(opt, 0x20b, true); dv.setUint32(opt + 108, 16, true);
  dv.setUint32(opt + 112 + 16, 0x1000, true); dv.setUint32(opt + 112 + 20, 0x200 + pipl.length, true); // diretório de recursos
  const sec = opt + 240; '.rsrc'.split('').forEach((c, i) => { file[sec + i] = c.charCodeAt(0); });
  dv.setUint32(sec + 8, 0x200 + pipl.length, true); dv.setUint32(sec + 12, 0x1000, true); dv.setUint32(sec + 16, 0x200 + pipl.length, true); dv.setUint32(sec + 20, 0x400, true);
  const R = 0x400; // raiz → tipo "PIPL" (nome) → id 16000 → idioma → dados
  dv.setUint16(R + 12, 1, true); dv.setUint32(R + 16, 0x80000000 | 0x100, true); dv.setUint32(R + 20, 0x80000000 | 0x18, true);
  dv.setUint16(R + 0x100, 4, true); 'PIPL'.split('').forEach((c, i) => dv.setUint16(R + 0x102 + i * 2, c.charCodeAt(0), true));
  dv.setUint16(R + 0x18 + 14, 1, true); dv.setUint32(R + 0x18 + 16, 16000, true); dv.setUint32(R + 0x18 + 20, 0x80000000 | 0x30, true);
  dv.setUint16(R + 0x30 + 14, 1, true); dv.setUint32(R + 0x30 + 16, 1033, true); dv.setUint32(R + 0x30 + 20, 0x48, true);
  dv.setUint32(R + 0x48, 0x1200, true); dv.setUint32(R + 0x48 + 4, pipl.length, true);
  file.set(pipl, R + 0x200);
  return file.buffer;
}

test('lê cabeçalho PE e o PiPL sem executar nada', () => {
  const r = scanAex(fakeAex({ name: 'Twitch', category: 'Video Copilot', matchName: 'Videocopilot Twitch' }), 'C:/Plugins/Twitch.aex');
  assert.equal(r.valid_pe, true); assert.equal(r.architecture, 'x64'); assert.equal(r.is_64_bit, true);
  assert.deepEqual(r.sections.map((s) => s.name), ['.rsrc']);
  assert.equal(r.pipl.length, 1);
  assert.deepEqual({ ...r.pipl[0], entryPoints: undefined }, { kind: 'eFKT', name: 'Twitch', category: 'Video Copilot', matchName: 'Videocopilot Twitch', version: '', entryPoints: undefined });
  assert.equal(r.likely_after_effects_plugin, true);
  assert.equal(aexEquivalents(r, matchEffect)[0].effect, 'twitch');
});

test('Topaz e Looks pelo PiPL; arquivo sem PiPL usa o nome do arquivo', () => {
  const t = scanAex(fakeAex({ name: 'Enhance ', category: 'Topaz Video AI', matchName: 'Enhance AI ' }), 'Topaz_Video_AI.aex');
  assert.equal(aexEquivalents(t, matchEffect)[0].effect, 'topaz');
  const l = scanAex(fakeAex({ name: 'Looks', category: 'RG Magic Bullet', matchName: 'MB LookSuite3' }), 'Looks3_64.aex');
  assert.equal(aexEquivalents(l, matchEffect)[0].effect, 'looks');
  assert.equal(aexEquivalents({ path: 'DeepGlow2.aex', pipl: [] }, matchEffect)[0].effect, 'deepGlow');
});

test('arquivo que não é plugin não quebra', () => {
  const r = scanAex(new Uint8Array([1, 2, 3]).buffer, 'x.aex');
  assert.equal(r.valid_pe, false); assert.match(r.error, /MZ/);
  assert.equal(parsePiPL(new Uint8Array(10)).name, '');
});
