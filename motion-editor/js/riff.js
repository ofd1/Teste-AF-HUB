// Parser genérico de RIFF / RIFX (RIFX = big-endian, usado por .ffx e .aep do After Effects).
// Produz uma árvore de chunks: { id, size, offset, children?, listType? }.

const RAW_LISTS = new Set(['btdk']); // LISTs que contêm dados brutos, não sub-chunks

export class RiffReader {
  constructor(buffer) {
    this.buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    this.dv = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.le = false;
  }

  fourcc(off) {
    if (off + 4 > this.bytes.length) return '';
    return String.fromCharCode(this.bytes[off], this.bytes[off + 1], this.bytes[off + 2], this.bytes[off + 3]);
  }
  u8(off) { return this.dv.getUint8(off); }
  u16(off) { return this.dv.getUint16(off, this.le); }
  u32(off) { return this.dv.getUint32(off, this.le); }
  i16(off) { return this.dv.getInt16(off, this.le); }
  i32(off) { return this.dv.getInt32(off, this.le); }
  f32(off) { return this.dv.getFloat32(off, this.le); }
  f64(off) { return this.dv.getFloat64(off, this.le); }

  /** Lê string terminada em NUL (latin1/utf8) dentro de [off, off+max). */
  cstr(off, max) {
    const end = Math.min(off + max, this.bytes.length);
    let i = off;
    while (i < end && this.bytes[i] !== 0) i++;
    return decodeText(this.bytes.subarray(off, i));
  }

  parse() {
    const magic = this.fourcc(0);
    if (magic !== 'RIFX' && magic !== 'RIFF') {
      throw new Error(`Arquivo não é RIFF/RIFX (assinatura "${magic}")`);
    }
    this.le = magic === 'RIFF';
    const size = this.u32(4);
    const formType = this.fourcc(8);
    const end = Math.min(8 + size, this.bytes.length);
    const root = { id: magic, listType: formType, offset: 12, size: end - 12, children: [] };
    root.children = this.parseChunks(12, end);
    root.truncated = 8 + size > this.bytes.length;
    return root;
  }

  parseChunks(start, end) {
    const out = [];
    let pos = start;
    while (pos + 8 <= end) {
      const id = this.fourcc(pos);
      if (!/^[\x20-\x7e]{4}$/.test(id)) break; // lixo / padding
      let size = this.u32(pos + 4);
      const dataStart = pos + 8;
      if (dataStart + size > end) size = end - dataStart; // tolera arquivos truncados
      const chunk = { id, offset: dataStart, size };
      if (id === 'LIST' && size >= 4) {
        chunk.listType = this.fourcc(dataStart);
        if (!RAW_LISTS.has(chunk.listType)) {
          chunk.children = this.parseChunks(dataStart + 4, dataStart + size);
        }
      }
      out.push(chunk);
      pos = dataStart + size + (size & 1);
    }
    return out;
  }
}

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

/** Representação textual da árvore (para o inspetor de debug). */
export function dumpTree(reader, node, depth = 0, lines = []) {
  const pad = '  '.repeat(depth);
  if (node.children) {
    lines.push(`${pad}${node.id} '${node.listType}' (${node.size} bytes)`);
    for (const c of node.children) dumpTree(reader, c, depth + 1, lines);
  } else {
    let preview = '';
    if (node.id === 'tdmn' || node.id === 'tdsn' || node.id === 'Utf8' || node.id === 'pdnm') {
      preview = ` "${reader.cstr(node.offset, node.size)}"`;
    } else if (node.id === 'cdat') {
      const n = Math.min(Math.floor(node.size / 8), 6);
      const vals = [];
      for (let i = 0; i < n; i++) vals.push(+reader.f64(node.offset + i * 8).toFixed(4));
      preview = ` [${vals.join(', ')}]`;
    } else if (node.id === 'pard') {
      preview = ` tipo=0x${reader.u8(node.offset + 15).toString(16)} "${reader.cstr(node.offset + 16, 32)}"`;
    }
    lines.push(`${pad}${node.id} (${node.size})${preview}`);
  }
  return lines;
}
