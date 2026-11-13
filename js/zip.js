// Leitor de ZIP mínimo (sem bibliotecas): lê o diretório central e descompacta com DecompressionStream('deflate-raw').
// Usado para abrir projetos .amproj do Alight Motion (e mods como Gold Motion / Alemon), que são ZIP com o XML + mídias.
export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 66000);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const dvT = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dvT.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arquivo não é ZIP');
  const count = dvT.getUint16(eocd + 10, true), cdSize = dvT.getUint32(eocd + 12, true), cdOff = dvT.getUint32(eocd + 16, true);
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const dec = new TextDecoder();
  const out = new Map();
  for (let i = 0, p = 0; i < count && p + 46 <= cd.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    out.set(name, { method, csize, usize, lho });
  }
  return {
    names: [...out.keys()],
    /** Conteúdo de um arquivo do ZIP (Blob). */
    async get(name, type = '') {
      const e = out.get(name); if (!e) return null;
      const h = new DataView(await blob.slice(e.lho, e.lho + 30).arrayBuffer());
      const start = e.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = blob.slice(start, start + e.csize);
      if (e.method === 0) return new Blob([raw], { type });
      if (e.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error(`não consigo descompactar ${name}`);
      const res = new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw')));
      return new Blob([await res.arrayBuffer()], { type });
    },
  };
}
