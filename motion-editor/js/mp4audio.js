// Extrai só a trilha de áudio AAC de um MP4/MOV sem carregar o vídeo inteiro na memória.
// Lê o índice (moov) e depois apenas os trechos de áudio do arquivo (Blob.slice), montando um stream ADTS
// pequeno (~1–2 MB por minuto) que o decodeAudioData entende. Isso evita o crash do Safari no iPhone com
// vídeos grandes (antes o arquivo inteiro era lido para a RAM só para tirar o som).
// Retorna: Uint8Array (ADTS) · false (o arquivo não tem trilha de áudio) · null (formato não suportado).

const txt = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function boxes(buf, start, end) {
  const out = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o); const type = txt(buf, o + 4); let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o + hdr, end: o + size });
    o += size;
  }
  return out;
}
const child = (buf, box, type) => boxes(buf, box.start, box.end).find((b) => b.type === type);

/** AudioSpecificConfig dentro do esds (descritor 0x05). */
function ascFromEsds(buf, s, e) {
  let o = s + 4; // versão + flags
  const readLen = () => { let n = 0; for (let i = 0; i < 4; i++) { const c = buf[o++]; n = (n << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return n; };
  while (o < e) {
    const tag = buf[o++]; const len = readLen();
    if (tag === 0x03) { o += 3; continue; }                 // ES_Descriptor: ES_ID(2) + flags(1)
    if (tag === 0x04) { o += 13; continue; }                // DecoderConfigDescriptor
    if (tag === 0x05) return buf.subarray(o, o + len);      // DecoderSpecificInfo = AudioSpecificConfig
    o += len;
  }
  return null;
}

export async function extractAudioADTS(blob) {
  const rd = async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer());
  // 1) acha o moov sem ler o resto (ele pode estar no fim do arquivo)
  let off = 0, moov = null;
  while (off + 8 <= blob.size) {
    const h = await rd(off, 16); const dv = new DataView(h.buffer);
    let size = dv.getUint32(0); const type = txt(h, 4); let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = blob.size - off;
    if (size < 8) return null;
    if (type === 'moov') { if (size > 200 * 1024 * 1024) return null; moov = await rd(off + hdr, size - hdr); break; }
    off += size;
  }
  if (!moov) return null;
  const top = { start: 0, end: moov.length };
  // 2) trilha de som
  for (const trak of boxes(moov, 0, moov.length).filter((b) => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia'); if (!mdia) continue;
    const hdlr = child(moov, mdia, 'hdlr'); if (!hdlr || txt(moov, hdlr.start + 8) !== 'soun') continue;
    const stbl = child(moov, child(moov, mdia, 'minf') || top, 'stbl'); if (!stbl) return null;
    const stsd = child(moov, stbl, 'stsd'); if (!stsd) return null;
    const entry = boxes(moov, stsd.start + 8, stsd.end)[0];
    if (!entry || entry.type !== 'mp4a') return null; // só AAC (o que iPhone/Android gravam)
    let ver = (moov[entry.start + 8] << 8) | moov[entry.start + 9];
    const sub = entry.start + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
    const esds = boxes(moov, sub, entry.end).find((b) => b.type === 'esds')
      || boxes(moov, sub, entry.end).flatMap((b) => (b.type === 'wave' ? boxes(moov, b.start, b.end) : [])).find((b) => b.type === 'esds');
    if (!esds) return null;
    const asc = ascFromEsds(moov, esds.start, esds.end); if (!asc || asc.length < 2) return null;
    let aot = asc[0] >> 3; const fi = ((asc[0] & 7) << 1) | (asc[1] >> 7); const ch = (asc[1] >> 3) & 15;
    if (aot === 5 || aot === 29) aot = 2; // HE-AAC: o ADTS leva o núcleo LC (o SBR é implícito)
    if (aot < 1 || aot > 4 || fi > 12) return null;
    // tamanhos, chunks e offsets das amostras
    const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
    const stsz = child(moov, stbl, 'stsz'), stsc = child(moov, stbl, 'stsc'), stco = child(moov, stbl, 'stco') || child(moov, stbl, 'co64');
    if (!stsz || !stsc || !stco) return null;
    const uni = dv.getUint32(stsz.start + 4), count = dv.getUint32(stsz.start + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = uni || dv.getUint32(stsz.start + 12 + i * 4);
    const nChunks = dv.getUint32(stco.start + 4), is64 = stco.type === 'co64';
    const chunkOff = (i) => (is64 ? Number(dv.getBigUint64(stco.start + 8 + i * 8)) : dv.getUint32(stco.start + 8 + i * 4));
    const nRuns = dv.getUint32(stsc.start + 4);
    const runs = []; for (let i = 0; i < nRuns; i++) runs.push([dv.getUint32(stsc.start + 8 + i * 12) - 1, dv.getUint32(stsc.start + 12 + i * 12)]);
    let total = 0; for (let i = 0; i < count; i++) total += sizes[i] + 7;
    const out = new Uint8Array(total);
    // plano de leitura: (offset, nº de amostras, bytes) por chunk — lido em lotes paralelos
    const plan = [];
    for (let c = 0, ss = 0; c < nChunks && ss < count; c++) {
      let per = runs[0][1]; for (const [first, n] of runs) { if (first <= c) per = n; else break; }
      per = Math.min(per, count - ss);
      let bytes = 0; for (let k = 0; k < per; k++) bytes += sizes[ss + k];
      plan.push([chunkOff(c), per, bytes]); ss += per;
    }
    let s = 0, w = 0;
    for (let i0 = 0; i0 < plan.length; i0 += 64) {
      const batch = plan.slice(i0, i0 + 64);
      const datas = await Promise.all(batch.map(([o, , n]) => rd(o, n)));
      for (let bi = 0; bi < batch.length; bi++) {
      const per = batch[bi][1], data = datas[bi];
      let p = 0;
      for (let k = 0; k < per && s < count; k++, s++) {
        const len = sizes[s] + 7;
        out[w] = 0xff; out[w + 1] = 0xf1;
        out[w + 2] = ((aot - 1) << 6) | (fi << 2) | (ch >> 2);
        out[w + 3] = ((ch & 3) << 6) | (len >> 11);
        out[w + 4] = (len >> 3) & 0xff; out[w + 5] = ((len & 7) << 5) | 0x1f; out[w + 6] = 0xfc;
        out.set(data.subarray(p, p + sizes[s]), w + 7);
        p += sizes[s]; w += len;
      }
      }
    }
    return out.subarray(0, w);
  }
  return false; // nenhuma trilha de som
}
