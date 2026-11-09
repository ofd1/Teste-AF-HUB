// Cópia otimizada (proxy) de vídeos pesados, feita no próprio aparelho com WebCodecs:
// lê o MP4/MOV em pedaços (nunca o arquivo inteiro), decodifica no hardware, reduz para 1080p respeitando a
// rotação do iPhone, recodifica em H.264 e copia o áudio AAC original sem recompressão.
// Um vídeo 4K de 5 min / 1,6 GB vira ~1080p / ~250 MB — o Safari do iPhone deixa de travar ao editar.
import { boxes, child, txt, ascFromEsds } from './mp4audio.js';

const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Lê o moov (índice) do arquivo sem carregar o resto. */
async function readMoov(blob) {
  const rd = async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer());
  let off = 0;
  while (off + 8 <= blob.size) {
    const h = await rd(off, 16); const dv = new DataView(h.buffer);
    let size = dv.getUint32(0); const type = txt(h, 4); let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = blob.size - off;
    if (size < 8) return null;
    if (type === 'moov') return size > 200 * 1024 * 1024 ? null : rd(off + hdr, size - hdr);
    off += size;
  }
  return null;
}

/** Tabela de amostras de uma trilha (offsets, tamanhos, tempos em unidades da trilha, keyframes). */
function sampleTable(m, stbl) {
  const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
  const stsz = child(m, stbl, 'stsz'), stsc = child(m, stbl, 'stsc'), stco = child(m, stbl, 'stco') || child(m, stbl, 'co64');
  const stts = child(m, stbl, 'stts'), ctts = child(m, stbl, 'ctts'), stss = child(m, stbl, 'stss');
  const uni = dv.getUint32(stsz.start + 4), n = dv.getUint32(stsz.start + 8);
  const size = new Uint32Array(n); for (let i = 0; i < n; i++) size[i] = uni || dv.getUint32(stsz.start + 12 + i * 4);
  const offset = new Float64Array(n);
  const nChunks = dv.getUint32(stco.start + 4), is64 = stco.type === 'co64';
  const nRuns = dv.getUint32(stsc.start + 4), runs = [];
  for (let i = 0; i < nRuns; i++) runs.push([dv.getUint32(stsc.start + 8 + i * 12) - 1, dv.getUint32(stsc.start + 12 + i * 12)]);
  for (let c = 0, s = 0; c < nChunks && s < n; c++) {
    let per = runs[0][1]; for (const [first, k] of runs) { if (first <= c) per = k; else break; }
    let o = is64 ? Number(dv.getBigUint64(stco.start + 8 + c * 8)) : dv.getUint32(stco.start + 8 + c * 4);
    for (let k = 0; k < per && s < n; k++, s++) { offset[s] = o; o += size[s]; }
  }
  const dts = new Float64Array(n), dur = new Float64Array(n);
  for (let i = 0, e = 0, t = 0; e < dv.getUint32(stts.start + 4); e++) {
    const cnt = dv.getUint32(stts.start + 8 + e * 8), d = dv.getUint32(stts.start + 12 + e * 8);
    for (let k = 0; k < cnt && i < n; k++, i++) { dts[i] = t; dur[i] = d; t += d; }
  }
  const cto = new Float64Array(n);
  if (ctts) {
    const ver = m[ctts.start];
    for (let i = 0, e = 0; e < dv.getUint32(ctts.start + 4); e++) {
      const cnt = dv.getUint32(ctts.start + 8 + e * 8); const v = ver === 1 ? dv.getInt32(ctts.start + 12 + e * 8) : dv.getUint32(ctts.start + 12 + e * 8);
      for (let k = 0; k < cnt && i < n; k++, i++) cto[i] = v;
    }
  }
  let key = null;
  if (stss) { key = new Uint8Array(n); for (let e = 0; e < dv.getUint32(stss.start + 4); e++) key[dv.getUint32(stss.start + 8 + e * 4) - 1] = 1; }
  return { n, size, offset, dts, dur, cto, key };
}

/** Codec string do WebCodecs a partir do avcC / hvcC. */
function codecString(type, cfg) {
  if (type === 'avc1' || type === 'avc3') return `avc1.${hex2(cfg[1])}${hex2(cfg[2])}${hex2(cfg[3])}`;
  // hvcC: [1]=profile_space(2) tier(1) profile_idc(5) · [2..5]=compat flags · [6..11]=constraints · [12]=level
  const ps = cfg[1] >> 6, tier = (cfg[1] >> 5) & 1, prof = cfg[1] & 31;
  let comp = ((cfg[2] << 24) | (cfg[3] << 16) | (cfg[4] << 8) | cfg[5]) >>> 0, rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (comp & 1); comp >>>= 1; }
  const cons = [...cfg.subarray(6, 12)]; while (cons.length && !cons[cons.length - 1]) cons.pop();
  return `${type}.${['', 'A', 'B', 'C'][ps]}${prof}.${(rev >>> 0).toString(16)}.${tier ? 'H' : 'L'}${cfg[12]}${cons.map((b) => `.${b.toString(16).toUpperCase()}`).join('')}`;
}

/** Informações das trilhas de vídeo e áudio do arquivo. */
export async function probeMp4(blob) {
  const m = await readMoov(blob);
  if (!m) return null;
  const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
  const out = {};
  for (const trak of boxes(m, 0, m.length).filter((b) => b.type === 'trak')) {
    const mdia = child(m, trak, 'mdia'), hdlr = mdia && child(m, mdia, 'hdlr'); if (!hdlr) continue;
    const kind = txt(m, hdlr.start + 8);
    const mdhd = child(m, mdia, 'mdhd'); const timescale = dv.getUint32(mdhd.start + (m[mdhd.start] === 1 ? 20 : 12));
    const stbl = child(m, child(m, mdia, 'minf'), 'stbl'); const stsd = child(m, stbl, 'stsd');
    const entry = boxes(m, stsd.start + 8, stsd.end)[0]; if (!entry) continue;
    if (kind === 'vide' && !out.video) {
      const cfgBox = boxes(m, entry.start + 78, entry.end).find((b) => b.type === 'avcC' || b.type === 'hvcC');
      if (!cfgBox) continue;
      const description = m.slice(cfgBox.start, cfgBox.end);
      // rotação gravada pelo celular (matriz do tkhd)
      const tkhd = child(m, trak, 'tkhd'); const mo = tkhd.start + (m[tkhd.start] === 1 ? 52 : 40);
      const a = dv.getInt32(mo) / 65536, b = dv.getInt32(mo + 4) / 65536;
      const rotation = (Math.round(Math.atan2(b, a) * 180 / Math.PI) + 360) % 360;
      out.video = { codec: codecString(entry.type, description), description, width: dv.getUint16(entry.start + 24), height: dv.getUint16(entry.start + 26), timescale, rotation, table: sampleTable(m, stbl) };
    } else if (kind === 'soun' && !out.audio && entry.type === 'mp4a') {
      const sub = entry.start + 28 + (((m[entry.start + 8] << 8) | m[entry.start + 9]) === 1 ? 16 : 0);
      const esds = boxes(m, sub, entry.end).find((b) => b.type === 'esds') || boxes(m, sub, entry.end).flatMap((b) => (b.type === 'wave' ? boxes(m, b.start, b.end) : [])).find((b) => b.type === 'esds');
      const asc = esds && ascFromEsds(m, esds.start, esds.end);
      if (!asc) continue;
      const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const sampleRate = rates[((asc[0] & 7) << 1) | (asc[1] >> 7)] || timescale, channels = (asc[1] >> 3) & 15 || 2;
      out.audio = { asc: asc.slice(), sampleRate, channels, timescale, table: sampleTable(m, stbl) };
    }
  }
  return out.video ? out : null;
}

/** O vídeo é pesado o bastante para valer a cópia otimizada? */
export function needsProxy(file, w, h) {
  return file.size > 300 * 1024 * 1024 || Math.max(w, h) > 2000;
}

export async function proxySupported(info) {
  if (!window.VideoDecoder || !window.VideoEncoder || !info?.video) return false;
  try { return (await VideoDecoder.isConfigSupported({ codec: info.video.codec, description: info.video.description })).supported; } catch { return false; }
}

/**
 * Gera o proxy. onProgress(0..1). Retorna um File (MP4 H.264 1080p + áudio original) ou lança erro.
 * maxSide: o lado menor do resultado (1080 = Full HD).
 */
export async function makeProxy(file, { onProgress, signal, shortSide = 1080, bitrate = 8e6 } = {}) {
  const info = await probeMp4(file);
  if (!info) throw new Error('formato não suportado (só MP4/MOV)');
  const v = info.video, T = v.table;
  const rot = v.rotation % 180 !== 0;
  const srcW = rot ? v.height : v.width, srcH = rot ? v.width : v.height;
  const k = Math.min(1, shortSide / Math.min(srcW, srcH));
  const W = Math.max(2, Math.round(srcW * k / 2) * 2), H = Math.max(2, Math.round(srcH * k / 2) * 2);
  const fps = Math.max(1, Math.min(120, Math.round(T.n / ((T.dts[T.n - 1] + T.dur[T.n - 1]) / v.timescale))));

  const { Muxer, StreamTarget } = await import('./vendor/mp4-muxer.mjs');
  // saída em pedaços (posição → bytes): sem um ArrayBuffer gigante; os poucos "remendos" de cabeçalho são aplicados no fim
  const parts = []; let end = 0; const patches = [];
  const target = new StreamTarget({ onData: (data, position) => {
    if (position >= end) { if (position > end) { parts.push(new Uint8Array(position - end)); end = position; } parts.push(data.slice()); end += data.byteLength; return; }
    const inside = Math.min(data.byteLength, end - position);
    patches.push([position, data.slice(0, inside)]);
    if (inside < data.byteLength) { parts.push(data.slice(inside)); end += data.byteLength - inside; }
  } });
  const encCfg = await (async () => {
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033']) {
      const c = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' }, hardwareAcceleration: 'prefer-hardware' };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch { /* próximo */ }
      delete c.hardwareAcceleration;
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch { /* próximo */ }
    }
    throw new Error('o aparelho não tem codificador H.264');
  })();
  const muxer = new Muxer({ target, fastStart: false, firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    ...(info.audio ? { audio: { codec: 'aac', numberOfChannels: info.audio.channels, sampleRate: info.audio.sampleRate } } : {}) });

  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  enc.configure(encCfg);
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d');
  let framesOut = 0;
  const keyEvery = fps * 2;
  const dec = new VideoDecoder({
    output: (frame) => {
      try {
        cx.save();
        cx.translate(W / 2, H / 2); cx.rotate((v.rotation * Math.PI) / 180);
        const dw = rot ? H : W, dh = rot ? W : H;
        cx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
        cx.restore();
        const vf = new VideoFrame(cv, { timestamp: frame.timestamp, duration: frame.duration || Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: framesOut % keyEvery === 0 });
        vf.close();
        framesOut++;
      } finally { frame.close(); }
    },
    error: (e) => { failure = e; },
  });
  let decCfg = { codec: v.codec, description: v.description, hardwareAcceleration: 'prefer-hardware' };
  try { if (!(await VideoDecoder.isConfigSupported(decCfg)).supported) delete decCfg.hardwareAcceleration; } catch { delete decCfg.hardwareAcceleration; }
  dec.configure(decCfg);

  const ts = (x) => Math.round((x / v.timescale) * 1e6);
  const BATCH = 24;
  for (let i0 = 0; i0 < T.n; i0 += BATCH) {
    if (signal?.aborted) { try { dec.close(); enc.close(); } catch { /* ok */ } throw new Error('cancelado'); }
    if (failure) throw failure;
    const idx = []; for (let i = i0; i < Math.min(T.n, i0 + BATCH); i++) idx.push(i);
    const datas = await Promise.all(idx.map((i) => file.slice(T.offset[i], T.offset[i] + T.size[i]).arrayBuffer()));
    if (failure || dec.state !== 'configured') throw failure || new Error('decodificador fechou');
    idx.forEach((i, j) => dec.state === 'configured' && dec.decode(new EncodedVideoChunk({ type: !T.key || T.key[i] ? 'key' : 'delta', timestamp: ts(T.dts[i] + T.cto[i]), duration: ts(T.dur[i]), data: datas[j] })));
    // não deixa as filas crescerem (memória do iPhone)
    while ((dec.decodeQueueSize > 12 || enc.encodeQueueSize > 8) && !failure) await new Promise((r) => setTimeout(r, 4));
    onProgress?.(Math.min(0.97, (i0 + BATCH) / T.n));
  }
  await dec.flush(); await enc.flush();
  if (failure) throw failure;
  dec.close(); enc.close();

  // áudio: copia as amostras AAC originais (sem recompressão)
  if (info.audio) {
    const A = info.audio.table, meta = { decoderConfig: { codec: 'mp4a.40.2', sampleRate: info.audio.sampleRate, numberOfChannels: info.audio.channels, description: info.audio.asc } };
    for (let i0 = 0; i0 < A.n; i0 += 256) {
      const idx = []; for (let i = i0; i < Math.min(A.n, i0 + 256); i++) idx.push(i);
      const datas = await Promise.all(idx.map((i) => file.slice(A.offset[i], A.offset[i] + A.size[i]).arrayBuffer()));
      idx.forEach((i, j) => muxer.addAudioChunkRaw(new Uint8Array(datas[j]), 'key', (A.dts[i] / info.audio.timescale) * 1e6, (A.dur[i] / info.audio.timescale) * 1e6, i === 0 ? meta : undefined));
    }
  }
  muxer.finalize();
  // aplica os remendos (tamanho do mdat etc.) nos pedaços já gravados
  for (const [pos, data] of patches) {
    let base = 0;
    for (const p of parts) {
      if (pos < base + p.byteLength && pos + data.byteLength > base) {
        for (let j = 0; j < data.byteLength; j++) { const q = pos + j - base; if (q >= 0 && q < p.byteLength) p[q] = data[j]; }
      }
      base += p.byteLength;
    }
  }
  onProgress?.(1);
  const name = file.name.replace(/\.[^.]+$/, '') + '_1080p.mp4';
  return new File(parts, name, { type: 'video/mp4' });
}
