// "Animar logo": separa uma logo (PNG/JPG) em peças — cada parte do símbolo e cada letra — e monta um projeto de
// motion design com elas (símbolo montando, letras subindo, subtítulo fechando o espaçamento, anel desenhando,
// explosão de linhas, brilho passando, push de câmera). Tudo vira camadas editáveis.
import { LAYER_FACTORIES, createProject } from './state.js';
import { uid } from './util.js';
import { putMedia } from './idb.js';

// ---------------------------------------------------------------- separar em peças
/** img: HTMLImageElement/ImageBitmap/canvas. Retorna { W, H, bg:[r,g,b], pieces:[{ x, y, w, h, canvas, area, color, line }] } */
export function splitLogo(img, { maxSide = 1600 } = {}) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.round(img.width * k), H = Math.round(img.height * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
  const src = g.getImageData(0, 0, W, H).data;
  // fundo: mediana da borda (ou transparente)
  const border = [];
  for (let x = 0; x < W; x += 3) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 3) border.push(y * W, y * W + W - 1);
  const transparentBg = border.filter((i) => src[i * 4 + 3] < 20).length > border.length * 0.6;
  const med = (ch) => { const v = border.map((i) => src[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  // alfa de cada pixel: distância do fundo (antisserrilhado preservado)
  const N = W * H, alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = src[i * 4 + 3] / 255;
    if (transparentBg) { alpha[i] = a; continue; }
    const d = Math.max(Math.abs(src[i * 4] - bg[0]), Math.abs(src[i * 4 + 1] - bg[1]), Math.abs(src[i * 4 + 2] - bg[2]));
    alpha[i] = a * Math.min(1, Math.max(0, (d - 14) / 46));
  }
  // componentes conectados (8 vizinhos) na máscara alpha > 0,4
  const lab = new Int32Array(N).fill(-1); const comps = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0 || alpha[s] <= 0.4) continue;
    const id = comps.length; let sp = 0; stack[sp++] = s; lab[s] = id;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0, cr = 0, cg = 0, cb = 0;
    while (sp) {
      const p = stack[--sp], x = p % W, y = (p / W) | 0;
      area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      cr += src[p * 4]; cg += src[p * 4 + 1]; cb += src[p * 4 + 2];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx; if (lab[q] < 0 && alpha[q] > 0.4) { lab[q] = id; stack[sp++] = q; }
      }
    }
    comps.push({ ids: [id], x0, y0, x1, y1, area, color: [cr / area, cg / area, cb / area] });
  }
  // descarta sujeira; junta acentos/cedilhas/pingos à letra mais próxima (Á, Ç, Ã, i, j)
  const big = comps.filter((q) => q.area > 40);
  const medArea = big.map((q) => q.area).sort((a, b) => a - b)[big.length >> 1] || 1;
  const main = [], small = [];
  for (const q of big) (q.area < medArea * 0.18 ? small : main).push(q);
  for (const s of small) {
    let best = null, bd = Infinity;
    for (const m of main) {
      // acento inclinado (Á) pode sair um pouco para o lado da letra: aceita até meia largura de distância
      const ox = Math.min(s.x1, m.x1) - Math.max(s.x0, m.x0);
      if (ox < -(s.x1 - s.x0) * 0.5) continue;
      const gap = s.y1 < m.y0 ? m.y0 - s.y1 : s.y0 > m.y1 ? s.y0 - m.y1 : 0;
      if (gap > (m.y1 - m.y0) * 0.9) continue;
      const dist = gap + Math.max(0, -ox);
      if (dist < bd) { bd = dist; best = m; }
    }
    if (best) { best.ids.push(...s.ids); best.x0 = Math.min(best.x0, s.x0); best.y0 = Math.min(best.y0, s.y0); best.x1 = Math.max(best.x1, s.x1); best.y1 = Math.max(best.y1, s.y1); best.area += s.area; }
    else if (s.area > 120) main.push(s);
  }
  // linhas (símbolo, título, subtítulo…): agrupa por sobreposição vertical
  main.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const lines = [];
  for (const q of main) {
    const cy = (q.y0 + q.y1) / 2;
    const L = lines.find((l) => cy >= l.y0 && cy <= l.y1);
    if (L) { L.items.push(q); L.y0 = Math.min(L.y0, q.y0); L.y1 = Math.max(L.y1, q.y1); } else lines.push({ y0: q.y0, y1: q.y1, items: [q] });
  }
  lines.sort((a, b) => a.y0 - b.y0);
  // linhas que se sobrepõem na vertical são a mesma (o losango do símbolo desce abaixo das outras peças)
  for (let i = 0; i + 1 < lines.length;) {
    const L = lines[i], M = lines[i + 1];
    const ov = Math.min(L.y1, M.y1) - Math.max(L.y0, M.y0);
    if (ov > 0) { L.items.push(...M.items); L.y0 = Math.min(L.y0, M.y0); L.y1 = Math.max(L.y1, M.y1); lines.splice(i + 1, 1); } else i++;
  }
  // linha baixinha com 1–2 peças entre linhas maiores = acentos (Á, Ã, Ç): cada um vai para a letra mais próxima
  for (let i = 0; i < lines.length;) {
    const L = lines[i], h = L.y1 - L.y0;
    const nb = [lines[i + 1], lines[i - 1]].filter(Boolean).filter((M) => h < (M.y1 - M.y0) * 0.5);
    if (L.items.length <= 2 && nb.length) {
      for (const q of L.items) {
        let best = null, bd = Infinity;
        for (const M of nb) for (const m of M.items) {
          const dx = Math.max(0, m.x0 - q.x1, q.x0 - m.x1), dy = Math.max(0, m.y0 - q.y1, q.y0 - m.y1), d = dx * 2 + dy;
          if (d < bd) { bd = d; best = m; }
        }
        if (best) { best.ids.push(...q.ids); best.x0 = Math.min(best.x0, q.x0); best.y0 = Math.min(best.y0, q.y0); best.x1 = Math.max(best.x1, q.x1); best.y1 = Math.max(best.y1, q.y1); best.area += q.area; }
      }
      lines.splice(i, 1);
    } else i++;
  }
  // recorta cada peça com alfa e cor sem o fundo (des-contaminação das bordas)
  const pieces = [];
  lines.forEach((L, li) => {
    L.items.sort((a, b) => a.x0 - b.x0);
    for (const q of L.items) {
      const pad = 2, x0 = Math.max(0, q.x0 - pad), y0 = Math.max(0, q.y0 - pad), x1 = Math.min(W - 1, q.x1 + pad), y1 = Math.min(H - 1, q.y1 + pad);
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const pc = document.createElement('canvas'); pc.width = w; pc.height = h;
      const pg = pc.getContext('2d'); const out = pg.createImageData(w, h);
      const ids = new Set(q.ids);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = (y0 + y) * W + (x0 + x); let a = alpha[p];
        if (a <= 0) continue;
        // bordas antisserrilhadas (fora da máscara dura) pertencem à peça mais próxima: aceita se algum vizinho é desta peça
        if (!ids.has(lab[p])) {
          let near = false;
          for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x0 + x + dx, ny = y0 + y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && ids.has(lab[ny * W + nx])) { near = true; break; } }
          if (!near) continue;
        }
        const o = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) out.data[o + ch] = transparentBg ? src[p * 4 + ch] : Math.max(0, Math.min(255, (src[p * 4 + ch] - bg[ch] * (1 - a)) / Math.max(a, 0.05)));
        out.data[o + 3] = Math.round(a * 255);
      }
      pg.putImageData(out, 0, 0);
      pieces.push({ x: x0, y: y0, w, h, canvas: pc, area: q.area, color: q.color, line: li });
    }
  });
  return { W, H, bg, transparentBg, pieces, lines: lines.length };
}

// ---------------------------------------------------------------- projeto animado
const A = (v) => ({ value: v, keys: [] });
const KF = (list) => ({ value: list[0][1], keys: list.map(([t, v, ease]) => ({ t: +t.toFixed(4), v, ease: ease || 'linear' })) });
const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function fx(type, params) {
  const out = { id: uid('fx'), type, enabled: true, params: {} };
  for (const [k, v] of Object.entries(params)) out.params[k] = v && typeof v === 'object' && Array.isArray(v.keys) ? { value: v.keys[0].v, keys: v.keys } : { value: v, keys: [] };
  return out;
}

/**
 * Monta o projeto. split = splitLogo(...). opts: { name, size:[w,h], fps, duration, saveMedia(blob)→Promise<{mediaId,src}> }
 * A primeira linha colorida (o símbolo) monta voando do centro; linhas de texto entram letra a letra.
 */
export async function buildLogoAnimation(split, opts = {}) {
  const [PW, PH] = opts.size || [1080, 1080];
  const P = createProject(PW, PH);
  Object.assign(P, { id: uid('prj'), name: opts.name || 'Logo animada', fps: opts.fps || 30, duration: opts.duration || 6, background: split.transparentBg ? '#101014' : hex(split.bg) });
  const fit = Math.min((PW * 0.78) / split.W, (PH * 0.78) / split.H);
  const ox = (PW - split.W * fit) / 2, oy = (PH - split.H * fit) / 2;
  const save = opts.saveMedia || (async (blob) => { const id = uid('m'); await putMedia(id, blob); return { mediaId: id, src: URL.createObjectURL(blob) }; });
  const D = P.duration;
  // qual linha é o símbolo: a de cor mais saturada (ou a primeira)
  const lineIds = [...new Set(split.pieces.map((p) => p.line))];
  const lineSat = lineIds.map((li) => { const ps = split.pieces.filter((p) => p.line === li); return ps.reduce((s, p) => s + sat(p.color) * p.area, 0) / ps.reduce((s, p) => s + p.area, 0); });
  const emblemLine = lineIds.length > 1 && Math.max(...lineSat) > 0.25 ? lineIds[lineSat.indexOf(Math.max(...lineSat))] : lineIds.length > 1 ? lineIds[0] : -1;
  const accent = (() => { const e = split.pieces.filter((p) => p.line === emblemLine); return e.length ? e.reduce((s, p) => s.map((v, i) => v + p.color[i] * p.area), [0, 0, 0]).map((v) => v / e.reduce((s, p) => s + p.area, 0)) : [255, 255, 255]; })();
  const emb = split.pieces.filter((p) => p.line === emblemLine);
  const ecx = emb.length ? ox + (Math.min(...emb.map((p) => p.x)) + Math.max(...emb.map((p) => p.x + p.w))) / 2 * fit : PW / 2;
  const ecy = emb.length ? oy + (Math.min(...emb.map((p) => p.y)) + Math.max(...emb.map((p) => p.y + p.h))) / 2 * fit : PH / 2;
  const er = emb.length ? Math.max(...emb.map((p) => Math.max(p.x + p.w - p.x, 1))) : 0;
  const eSize = emb.length ? Math.max(Math.max(...emb.map((p) => p.x + p.w)) - Math.min(...emb.map((p) => p.x)), Math.max(...emb.map((p) => p.y + p.h)) - Math.min(...emb.map((p) => p.y))) * fit : PW * 0.3;

  const pieceLayers = [];
  const textLines = lineIds.filter((li) => li !== emblemLine);
  for (const p of split.pieces) {
    const blob = await new Promise((r) => p.canvas.toBlob(r, 'image/png'));
    const m = await save(blob);
    const l = LAYER_FACTORIES.image(P, m.src, p.w, p.h, p.line === emblemLine ? 'Símbolo' : 'Letra');
    l.props.mediaId = m.mediaId; l.props.fileName = `${l.name}.png`;
    const cx = ox + (p.x + p.w / 2) * fit, cy = oy + (p.y + p.h / 2) * fit;
    l.transform.scale = A([fit * 100, fit * 100]);
    l.inPoint = 0; l.outPoint = D;
    if (p.line === emblemLine) {
      // símbolo: cada peça vem de fora (na direção do centro → peça), girando, e encaixa com curva expo
      const i = emb.indexOf(p), dx = cx - ecx, dy = cy - ecy, n = Math.hypot(dx, dy) || 1;
      const t0 = 0.25 + i * 0.12, t1 = t0 + 0.9;
      l.transform.position = KF([[t0, [cx + (dx / n) * PW * 0.45, cy + (dy / n) * PW * 0.45], 'expoOut'], [t1, [cx, cy]]]);
      l.transform.rotation = KF([[t0, (i % 2 ? 1 : -1) * 120, 'expoOut'], [t1, 0]]);
      l.transform.scale = KF([[t0, [fit * 40, fit * 40], 'expoOut'], [t1, [fit * 100, fit * 100]]]);
      l.transform.opacity = KF([[t0, 0], [t0 + 0.15, 100]]);
      l.effects.push(fx('motionBlur', { amount: 120, samples: 12 }));
      l.name = `Símbolo ${i + 1}`;
    } else {
      // texto: letras sobem com desfoque (título) ou fecham o espaçamento (linhas seguintes)
      const li = textLines.indexOf(p.line), row = split.pieces.filter((q) => q.line === p.line), j = row.indexOf(p);
      const base = 1.35 + li * 0.55, t0 = base + j * (li === 0 ? 0.06 : 0.035);
      if (li === 0) {
        l.transform.position = KF([[t0, [cx, cy + p.h * fit * 0.9], 'expoOut'], [t0 + 0.7, [cx, cy]]]);
        l.transform.opacity = KF([[t0, 0], [t0 + 0.25, 100]]);
        l.effects.push(fx('blur', { radius: { keys: [{ t: t0, v: 18, ease: 'expoOut' }, { t: t0 + 0.6, v: 0, ease: 'linear' }] } }));
      } else {
        const spread = (cx - PW / 2) * 0.9;
        l.transform.position = KF([[t0, [cx + spread, cy], 'expoOut'], [t0 + 1.0, [cx, cy]]]);
        l.transform.opacity = KF([[t0, 0, 'easeOut'], [t0 + 0.5, 100]]);
      }
      l.name = `Linha ${li + 1} · ${j + 1}`;
    }
    pieceLayers.push(l);
  }
  // grupo com push de câmera lento (escala 100 → 104) e saída no fim
  const group = LAYER_FACTORIES.group(P, pieceLayers.reverse());
  group.name = 'Logo'; group.inPoint = 0; group.outPoint = D;
  group.transform.scale = KF([[0, [100, 100], 'linear'], [D - 0.6, [104, 104], 'expoIn'], [D, [118, 118]]]);
  group.transform.opacity = KF([[D - 0.45, 100, 'easeIn'], [D, 0]]);
  const layers = [group];
  const ac = accent.map((v) => v / 255);
  if (emb.length) {
    // anel desenhando em volta do símbolo + explosão de linhas quando as peças encaixam
    const R = eSize * 0.78;
    const ring = LAYER_FACTORIES.shape(P, [{ t: 'group', items: [{ t: 'ellipse', size: A([R * 2, R * 2]), position: A([0, 0]) }, { t: 'trim', start: KF([[1.0, 0, 'expoInOut'], [2.2, 100]]), end: KF([[0.6, 0, 'expoOut'], [1.6, 100]]), offset: KF([[0.6, -90, 'expoOut'], [2.2, 60]]) }, { t: 'stroke', color: A(ac), width: A(Math.max(3, PW * 0.006)), opacity: A(100), cap: 2, join: 2 }], tr: { position: A([0, 0]), scale: A([100, 100]), rotation: A(0), opacity: A(100), anchor: A([0, 0]) } }]);
    ring.name = 'Anel'; ring.props.width = PW; ring.props.height = PH; ring.inPoint = 0; ring.outPoint = 2.4; ring.transform.position = A([ecx, ecy]);
    const n = 12, items = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), r0 = R * 1.05, r1 = R * 1.45;
      const v0 = [c * r0, s * r0], v1 = [c * r1, s * r1];
      items.push({ t: 'group', items: [{ t: 'path', path: { shapes: [{ closed: false, pts: [v0, v0, v0, v1, v1, v1] }], times: [] } }, { t: 'trim', start: KF([[1.45, 0, 'expoInOut'], [1.95, 100]]), end: KF([[1.25, 0, 'expoOut'], [1.6, 100]]), offset: A(0) }, { t: 'stroke', color: A(i % 2 ? ac : [1, 1, 1]), width: A(Math.max(3, PW * 0.005)), opacity: A(100), cap: 2, join: 2 }], tr: { position: A([0, 0]), scale: A([100, 100]), rotation: A(0), opacity: A(100), anchor: A([0, 0]) } });
    }
    const burst = LAYER_FACTORIES.shape(P, items);
    burst.name = 'Explosão'; burst.props.width = PW; burst.props.height = PH; burst.inPoint = 1.2; burst.outPoint = 2.1; burst.transform.position = A([ecx, ecy]);
    layers.unshift(ring, burst);
  }
  // brilho passando sobre tudo (camada de ajuste) quando o texto termina de entrar
  // (no grupo da logo: o brilho só aparece sobre a logo, não no fundo)
  group.effects.push(fx('lightSweep', { width: 70, intensity: 0.9, direction: 25, center: { keys: [{ t: 2.6, v: [-0.3, 0.5], ease: 'expoInOut' }, { t: 3.8, v: [1.3, 0.5], ease: 'linear' }] } }));
  const glow = LAYER_FACTORIES.adjustment(P); glow.name = 'Glow'; glow.inPoint = 0; glow.outPoint = D;
  glow.effects.push(fx('glow', { threshold: 60, radius: 26, intensity: 0.55 }));
  layers.unshift(glow);
  // fundo: cor da logo com vinheta
  const bg = LAYER_FACTORIES.solid(P); bg.name = 'Fundo'; bg.props.fill = P.background; bg.inPoint = 0; bg.outPoint = D;
  bg.effects.push(fx('vignette', { amount: 40 }));
  layers.push(bg);
  P.layers = layers;
  return P;
}
