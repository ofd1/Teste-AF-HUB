// Leitor sequencial de vídeo para a EXPORTAÇÃO (WebCodecs): em vez de "pular" o <video> para cada quadro e esperar a
// confirmação (50–150 ms por quadro no celular), lê o MP4/MOV em ordem e decodifica no hardware, como um player.
// Só volta ao keyframe anterior quando a edição pede um quadro para trás (reverse, Twixtor, Time Remap).
// Se o formato não for suportado, quem chama cai na busca normal.
import { probeMp4 } from './proxy.js';

const KEEP = 6; // quadros decodificados guardados (A/B do frame blending, câmera lenta reaproveita)

export class SeqReader {
  static async open(blob, { soft = false, size = null } = {}) {
    if (typeof VideoDecoder === 'undefined') return null;
    const info = await probeMp4(blob).catch(() => null);
    if (!info?.video) return null;
    const v = info.video;
    const cfg = { codec: v.codec, description: v.description, ...(soft ? { hardwareAcceleration: 'prefer-software' } : {}) };
    try { if (!(await VideoDecoder.isConfigSupported(cfg)).supported) return null; } catch { return null; }
    const r = new SeqReader(blob, v, cfg);
    // size: [largura, altura] já na orientação final — quadros reduzidos na hora e liberados ao sair da lista
    // (cache da prévia; a exportação não passa size e continua com os quadros inteiros)
    r.size = size;
    return r;
  }

  constructor(blob, v, cfg) {
    this.blob = blob; this.v = v; this.cfg = cfg;
    const T = v.table, n = T.n;
    // tempo de apresentação de cada amostra (s), começando em 0 (como o <video>, que aplica a lista de edição)
    const pts = new Float64Array(n);
    let mn = Infinity;
    for (let i = 0; i < n; i++) { pts[i] = (T.dts[i] + T.cto[i]) / v.timescale; if (pts[i] < mn) mn = pts[i]; }
    for (let i = 0; i < n; i++) pts[i] -= mn;
    this.pts = pts;
    this.disp = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[a] - pts[b]); // ordem de exibição
    this.frames = new Map(); // amostra → canvas
    this.dec = null; this.fed = 0; this.waiters = [];
    this.rot = v.rotation || 0;
  }

  /** Amostra mostrada no instante t (a última com pts ≤ t). */
  sampleAt(t) {
    const d = this.disp, p = this.pts;
    let lo = 0, hi = d.length - 1, ans = d[0];
    while (lo <= hi) { const m = (lo + hi) >> 1; if (p[d[m]] <= t + 1e-4) { ans = d[m]; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  keyBefore(i) { const k = this.v.table.key; if (!k) return 0; for (let j = i; j >= 0; j--) if (k[j]) return j; return 0; }

  reset(from) {
    try { this.dec?.close(); } catch { /* fechado */ }
    this.dec = new VideoDecoder({
      output: (fr) => this.onFrame(fr),
      error: (e) => { this.err = e; this.waiters.splice(0).forEach((w) => w()); },
    });
    this.dec.configure(this.cfg);
    this.err = null; this.fed = from; this.base = from; this.lastOut = null;
  }

  onFrame(fr) {
    // quadro decodificado → canvas na orientação certa (vídeo vertical do iPhone vem girado no arquivo)
    const i = this.byTs.get(fr.timestamp);
    const w = fr.displayWidth, h = fr.displayHeight, r = this.rot;
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1); // Worker
    const side = r === 90 || r === 270;
    const ow = side ? h : w, oh = side ? w : h;
    c.width = this.size ? this.size[0] : ow; c.height = this.size ? this.size[1] : oh;
    const g = c.getContext('2d');
    const k = c.width / ow, kh = c.height / oh;
    g.translate(c.width / 2, c.height / 2); g.rotate((r * Math.PI) / 180);
    g.drawImage(fr, (-w / 2) * (side ? kh : k), (-h / 2) * (side ? k : kh), w * (side ? kh : k), h * (side ? k : kh));
    fr.close();
    if (i != null) {
      this.lastOut = Math.max(this.lastOut ?? -1, this.pts[i]);
      this.frames.set(i, c);
      // só esquece (não apaga o canvas: a exportação pode ainda estar usando esse quadro como A/B)
      while (this.frames.size > KEEP) {
        const k0 = this.frames.keys().next().value, old = this.frames.get(k0);
        this.frames.delete(k0);
        if (this.size && old) { old.width = 0; old.height = 0; } // cache: devolve a memória na hora (iPhone)
        else if (old) this.onEvict?.(old); // exportação: quem usa o quadro decide quando liberar
      }
    }
    this.waiters.splice(0).forEach((w2) => w2());
  }

  async feed(upto) {
    const T = this.v.table;
    if (!this.byTs) { this.byTs = new Map(); for (let i = 0; i < T.n; i++) this.byTs.set(Math.round(this.pts[i] * 1e6), i); }
    while (this.fed <= upto && this.fed < T.n) {
      // lê várias amostras seguidas de uma vez (menos leituras do arquivo)
      const a = this.fed, b = Math.min(T.n - 1, upto, a + 15);
      const o0 = T.offset[a], o1 = T.offset[b] + T.size[b];
      const contiguous = o1 - o0 < 64e6 && Array.from({ length: b - a }, (_, k) => T.offset[a + k + 1] >= T.offset[a + k]).every(Boolean);
      const buf = contiguous ? new Uint8Array(await this.blob.slice(o0, o1).arrayBuffer()) : null;
      for (let i = a; i <= b; i++) {
        const data = buf ? buf.subarray(T.offset[i] - o0, T.offset[i] - o0 + T.size[i]) : new Uint8Array(await this.blob.slice(T.offset[i], T.offset[i] + T.size[i]).arrayBuffer());
        const isKey = T.key ? !!T.key[i] : true;
        this.dec.decode(new EncodedVideoChunk({ type: isKey || i === this.base ? 'key' : 'delta', timestamp: Math.round(this.pts[i] * 1e6), duration: Math.round((T.dur[i] / this.v.timescale) * 1e6), data }));
      }
      this.fed = b + 1;
      while (this.dec.decodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    }
  }

  /** Canvas do quadro mostrado em t (s, tempo do arquivo). */
  async frameAt(t) {
    const i = this.sampleAt(Math.max(0, t));
    if (this.frames.has(i)) return this.frames.get(i);
    // pedido para trás (ou muito à frente): recomeça no keyframe anterior em vez de decodificar tudo
    // recomeça só se: ainda não começou, deu erro, o quadro é anterior ao trecho decodificado, está muito à frente,
    // ou já saiu do decodificador e foi descartado (pedido para trás)
    const passed = this.lastOut != null && this.pts[i] < this.lastOut - 1e-6;
    if (!this.dec || this.err || i < this.base || i >= this.fed + 90 || passed) this.reset(this.keyBefore(i));
    const T = this.v.table, deadline = performance.now() + 4000;
    // B-frames: o quadro sai alguns pacotes depois → alimenta um pouco à frente
    let ahead = Math.min(T.n - 1, i + 4);
    await this.feed(ahead);
    while (!this.frames.has(i) && !this.err && performance.now() < deadline) {
      if (this.fed >= T.n) { await this.dec.flush().catch(() => {}); break; }
      await Promise.race([new Promise((r) => this.waiters.push(r)), new Promise((r) => setTimeout(r, 40))]);
      if (!this.frames.has(i) && this.dec.decodeQueueSize === 0) { ahead = Math.min(T.n - 1, ahead + 4); await this.feed(ahead); }
    }
    return this.frames.get(i) || null;
  }

  close() { try { this.dec?.close(); } catch { /* ok */ } this.frames.clear(); }
}
