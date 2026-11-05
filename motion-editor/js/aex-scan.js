// Scanner de plugins .aex (After Effects) — análise ESTÁTICA, só lê os bytes do arquivo.
// Porte para JS do "AEX Scanner 1.0" (C++) + leitura do recurso PiPL (nome, categoria, match name, versão).
// Nunca carrega nem executa o plugin: um .aex é um DLL do Windows que só roda dentro do After Effects.
// Serve para o app saber quais plugins você tem e qual efeito do MotionFrame corresponde a cada um.

const MARKERS = ['AEEffect', 'AEGP', 'EffectMain', 'PluginDataEntryFunction', 'PluginDataEntryFunction2', 'PF_Cmd_GLOBAL_SETUP', 'After Effects', 'Adobe', 'PiPL'];
const MACHINES = { 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'ARM64', 0x1c0: 'ARM', 0x1c4: 'ARMv7' };

/** Lê um .aex (ArrayBuffer) e devolve o relatório. Não lança erro: problemas vão em `error`. */
export function scanAex(buf, path = '') {
  const b = new Uint8Array(buf), dv = new DataView(buf instanceof ArrayBuffer ? buf : b.buffer, b.byteOffset, b.byteLength);
  const r = { path, readable: true, valid_pe: false, has_aex_extension: /\.aex$/i.test(path), likely_after_effects_plugin: false, error: '', file_size: b.length,
    machine: 0, architecture: '', is_64_bit: false, pe_timestamp: 0, subsystem: 0, sections: [], imported_dlls: [], exported_symbols: [], adobe_markers: [], pipl: [] };
  const u16 = (o) => (o + 2 <= b.length ? dv.getUint16(o, true) : null), u32 = (o) => (o + 4 <= b.length ? dv.getUint32(o, true) : null);
  const cstr = (o, max = 512) => { let s = ''; for (let i = o; i < b.length && i < o + max && b[i]; i++) s += String.fromCharCode(b[i]); return s; };
  const fail = (m) => { r.error = m; return r; };
  if (!b.length) return fail('Arquivo vazio (download/cópia incompleta)');
  if (b.length < 64 || b[0] !== 0x4d || b[1] !== 0x5a) return fail('Não é um executável do Windows (sem cabeçalho MZ)');
  const pe = u32(0x3c);
  if (pe == null || u32(pe) !== 0x4550) return fail('Assinatura PE inválida');
  const coff = pe + 4;
  r.machine = u16(coff); r.architecture = MACHINES[r.machine] || `0x${r.machine.toString(16)}`;
  const nsec = u16(coff + 2); r.pe_timestamp = u32(coff + 4); const optSize = u16(coff + 16); const opt = coff + 20;
  const magic = u16(opt);
  if (magic !== 0x10b && magic !== 0x20b) return fail('Formato de cabeçalho PE não suportado');
  r.is_64_bit = magic === 0x20b; r.subsystem = u16(opt + 68); r.valid_pe = true;
  const ddCount = u32(opt + (r.is_64_bit ? 108 : 92)) || 0, dd = opt + (r.is_64_bit ? 112 : 96);
  const dir = (i) => (i < ddCount ? { rva: u32(dd + i * 8), size: u32(dd + i * 8 + 4) } : { rva: 0, size: 0 });
  const secTab = opt + optSize;
  for (let i = 0; i < nsec; i++) {
    const s = secTab + i * 40; if (s + 40 > b.length) break;
    r.sections.push({ name: cstr(s, 8), virtual_size: u32(s + 8), virtual_address: u32(s + 12), raw_size: u32(s + 16), raw_offset: u32(s + 20), characteristics: u32(s + 36) });
  }
  const off = (rva) => { for (const s of r.sections) if (rva >= s.virtual_address && rva < s.virtual_address + Math.max(s.virtual_size, s.raw_size)) return rva - s.virtual_address + s.raw_offset; return null; };
  try { // exportações
    const e = dir(0), eo = e.rva ? off(e.rva) : null;
    if (eo != null) { const n = u32(eo + 24), names = off(u32(eo + 32)); for (let i = 0; names != null && i < Math.min(n, 4096); i++) { const no = off(u32(names + i * 4)); if (no != null) r.exported_symbols.push(cstr(no)); } }
  } catch { /* tabela corrompida: segue */ }
  try { // importações
    const im = dir(1); let io = im.rva ? off(im.rva) : null;
    for (let k = 0; io != null && k < 512; k++, io += 20) { const nameRva = u32(io + 12); if (!nameRva) break; const no = off(nameRva); if (no != null) r.imported_dlls.push(cstr(no)); }
  } catch { /* idem */ }
  r.imported_dlls.sort(); r.exported_symbols.sort();
  try { r.pipl = readPiPL(b, dv, dir(2), off); } catch (e) { r.error = `PiPL: ${e.message}`; }
  // marcadores (heurística, como no scanner original)
  const hay = new TextDecoder('latin1').decode(b.length > 64 * 1024 * 1024 ? b.subarray(0, 64 * 1024 * 1024) : b);
  for (const m of MARKERS) if (hay.includes(m)) r.adobe_markers.push(m);
  r.likely_after_effects_plugin = r.pipl.length > 0 || r.adobe_markers.some((m) => m === 'AEEffect' || m === 'AEGP' || m === 'PiPL') ||
    r.exported_symbols.some((s) => /^(EffectMain|PluginDataEntryFunction2?|EntryPointFunc)$/.test(s));
  return r;
}

/** Percorre o diretório de recursos e lê cada recurso do tipo "PIPL" (Adobe Plug-in Property List). */
function readPiPL(b, dv, rsrc, off) {
  const base = rsrc.rva ? off(rsrc.rva) : null;
  if (base == null) return [];
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
  const entries = (o) => { const n = u16(o + 12) + u16(o + 14), out = []; for (let i = 0; i < Math.min(n, 4096); i++) { const e = o + 16 + i * 8; out.push({ name: u32(e), data: u32(e + 4) }); } return out; };
  const resName = (n) => { if (!(n & 0x80000000)) return n; const o = base + (n & 0x7fffffff), len = u16(o); let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(u16(o + 2 + i * 2)); return s; };
  const leaves = (o, depth = 0) => entries(o).flatMap((e) => (e.data & 0x80000000 ? (depth < 3 ? leaves(base + (e.data & 0x7fffffff), depth + 1) : []) : [base + e.data]));
  const out = [];
  for (const t of entries(base)) {
    if (!(t.data & 0x80000000) || String(resName(t.name)).toUpperCase() !== 'PIPL') continue;
    for (const leaf of leaves(base + (t.data & 0x7fffffff))) {
      const o = off(u32(leaf)), size = u32(leaf + 4);
      if (o != null && o + size <= b.length) out.push(parsePiPL(b.subarray(o, o + size)));
    }
  }
  return out;
}

const fourcc = (v) => String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const pstr = (d, o) => { const n = d[o] || 0; let s = ''; for (let i = 0; i < n && o + 1 + i < d.length; i++) s += String.fromCharCode(d[o + 1 + i]); return s.replace(/\0[\s\S]*$/, '').trimEnd(); };

/** PiPL: int16 versão, int32 reservado, int32 nº de propriedades; cada uma: vendor, chave, id, tamanho, dados (alinhado a 4). */
export function parsePiPL(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const p = { kind: '', name: '', category: '', matchName: '', version: '', entryPoints: [] };
  const count = dv.getUint32(6, true);
  let o = 10;
  for (let i = 0; i < Math.min(count, 256) && o + 16 <= d.length; i++) {
    const key = fourcc(dv.getUint32(o + 4, true)), len = dv.getUint32(o + 12, true), at = o + 16;
    if (key === 'kind') p.kind = fourcc(dv.getUint32(at, true));
    else if (key === 'name') p.name = pstr(d, at);
    else if (key === 'catg') p.category = pstr(d, at);
    else if (key === 'eMNA') p.matchName = pstr(d, at);
    else if (key === 'eVER') { const v = dv.getUint32(at, true); p.version = `${(v >>> 19) & 15}.${(v >>> 15) & 15}`; }
    else if (/^(8664|wx86|mi32|mach)$/.test(key)) { let s = ''; for (let k = at; k < at + len && d[k]; k++) s += String.fromCharCode(d[k]); p.entryPoints.push(s); }
    o = at + ((len + 3) & ~3);
  }
  return p;
}

/** Efeito do MotionFrame equivalente ao plugin (pelo match name do PiPL, categoria, nome ou nome do arquivo). */
export function aexEquivalents(r, matchEffect, utility = null) {
  const file = (r.path.split(/[\\/]/).pop() || '').replace(/\.aex$/i, '');
  const items = r.pipl.length ? r.pipl : [{ name: file, category: '', matchName: '' }];
  return items.map((p) => {
    if (utility && utility.test(`${p.matchName} ${p.name} ${file}`)) return { name: (p.name || file).trim(), category: p.category, matchName: (p.matchName || '').trim(), effect: null, label: null, kind: 'utility' };
    const m = matchEffect(p.matchName, `${p.category} ${p.name} ${file}`.trim()) || matchEffect('', file);
    return { name: (p.name || file).trim(), category: p.category, matchName: (p.matchName || '').trim(), effect: m?.def?.type || null, label: m?.def?.label || null, kind: m?.kind || null };
  });
}

/** JSON no mesmo formato do scanner C++ (+ pipl e equivalente no MotionFrame). */
export const reportsToJSON = (reports) => JSON.stringify(reports, null, 2);
