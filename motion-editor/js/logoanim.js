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

// ---------------------------------------------------------------- estilos de animação automática
// Cada estilo diz como cada peça entra (posição/escala/rotação/opacidade/efeitos) e quais enfeites o projeto ganha.
export const LOGO_STYLES = [
  { id: 'montar', name: 'Montar + anel', desc: 'Peças do símbolo voam e encaixam, anel desenhando, explosão de linhas, letras sobem.' },
  { id: 'pop', name: 'Pop elástico', desc: 'Cada peça estoura do centro com elástico, em onda do meio para fora, com círculos.' },
  { id: 'glitch', name: 'Glitch digital', desc: 'Peças piscam em ordem aleatória com RGB split e blocos de glitch até estabilizar.' },
  { id: 'deslizar', name: 'Corporativo (deslizar)', desc: 'Linha a linha subindo com curva expo, limpo e elegante, com linha de acento.' },
  { id: 'particulas', name: 'Partículas reunindo', desc: 'Peças espalhadas pela tela se juntam girando, com motion blur.' },
  { id: 'impacto', name: 'Impacto (carimbo)', desc: 'A logo bate na tela vinda da câmera: flash, tremida, poeira e explosão.' },
  { id: 'luz', name: 'Revelar com luz', desc: 'Uma faixa de luz passa e cada peça acende quando ela chega.' },
  { id: 'flip', name: 'Flip de cartões', desc: 'Peças viram como cartões, da esquerda para a direita.' },
  { id: 'queda', name: 'Cair e quicar', desc: 'Peças caem de cima e quicam no lugar, em ordem aleatória.' },
  { id: 'tunel', name: 'Zoom túnel', desc: 'Peças vêm de trás da câmera, enormes e desfocadas, e pousam.' },
  { id: 'digitar', name: 'Digitar (montagem)', desc: 'Peças aparecem uma a uma com um pequeno pop, como digitando.' },
];

function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; }

/**
 * Monta o projeto. split = splitLogo(...). opts: { name, style, size:[w,h], fps, duration, background:'logo'|'dark'|'gradient',
 * pieceMedia:[{mediaId,src}] (opcional, já salvos), saveMedia(blob)→Promise<{mediaId,src}> }
 */
export async function buildLogoAnimation(split, opts = {}) {
  const style = opts.style || 'montar';
  const [PW, PH] = opts.size || [1080, 1080];
  const P = createProject(PW, PH);
  const bgHex = split.transparentBg ? '#101014' : hex(split.bg);
  Object.assign(P, { id: uid('prj'), name: opts.name || 'Logo animada', fps: opts.fps || 30, duration: opts.duration || 6, background: opts.background === 'dark' ? '#0c0c10' : bgHex });
  const fit = Math.min((PW * 0.78) / split.W, (PH * 0.6) / split.H, (Math.min(PW, PH) * 0.9) / Math.max(split.W, split.H));
  const ox = (PW - split.W * fit) / 2, oy = (PH - split.H * fit) / 2;
  const save = opts.saveMedia || (async (blob) => { const id = uid('m'); await putMedia(id, blob); return { mediaId: id, src: URL.createObjectURL(blob) }; });
  const D = P.duration;
  const R = rng(7);
  // qual linha é o símbolo: a de cor mais saturada (ou a primeira)
  const lineIds = [...new Set(split.pieces.map((p) => p.line))];
  const lineSat = lineIds.map((li) => { const ps = split.pieces.filter((p) => p.line === li); return ps.reduce((s2, p) => s2 + sat(p.color) * p.area, 0) / ps.reduce((s2, p) => s2 + p.area, 0); });
  const emblemLine = lineIds.length > 1 && Math.max(...lineSat) > 0.25 ? lineIds[lineSat.indexOf(Math.max(...lineSat))] : lineIds.length > 1 ? lineIds[0] : -1;
  const emb = split.pieces.filter((p) => p.line === emblemLine);
  const accentRGB = (() => { const e = emb.length ? emb : split.pieces; const a = e.reduce((s2, p) => s2 + p.area, 0); return e.reduce((s2, p) => s2.map((v, i) => v + p.color[i] * p.area), [0, 0, 0]).map((v) => v / a); })();
  const ac = (sat(accentRGB) > 0.2 ? accentRGB : [255, 255, 255]).map((v) => v / 255);
  const bbox = (ps) => ps.length ? [Math.min(...ps.map((p) => p.x)), Math.min(...ps.map((p) => p.y)), Math.max(...ps.map((p) => p.x + p.w)), Math.max(...ps.map((p) => p.y + p.h))] : [0, 0, split.W, split.H];
  const eb = bbox(emb.length ? emb : split.pieces), lb = bbox(split.pieces);
  const ecx = ox + ((eb[0] + eb[2]) / 2) * fit, ecy = oy + ((eb[1] + eb[3]) / 2) * fit;
  const eSize = Math.max(eb[2] - eb[0], eb[3] - eb[1]) * fit;
  const lcx = ox + ((lb[0] + lb[2]) / 2) * fit, lcy = oy + ((lb[1] + lb[3]) / 2) * fit;
  const textLines = lineIds.filter((li) => li !== emblemLine);
  const order = [...split.pieces].sort((a, b) => (a.line === emblemLine ? -1 : 0) - (b.line === emblemLine ? -1 : 0) || a.line - b.line || a.x - b.x);
  const N = split.pieces.length;
  const maxDist = Math.max(1, ...split.pieces.map((p) => Math.hypot(ox + (p.x + p.w / 2) * fit - lcx, oy + (p.y + p.h / 2) * fit - lcy)));
  const S = (v) => [fit * v, fit * v];

  const pieceLayers = [];
  for (let k = 0; k < split.pieces.length; k++) {
    const p = split.pieces[k];
    let m = opts.pieceMedia?.[k];
    if (!m) { const blob = await new Promise((r) => p.canvas.toBlob(r, 'image/png')); m = await save(blob); }
    const isE = p.line === emblemLine;
    const l = LAYER_FACTORIES.image(P, m.src, p.w, p.h, isE ? 'Símbolo' : 'Letra');
    l.props.mediaId = m.mediaId; l.props.fileName = `${l.name}.png`;
    const cx = ox + (p.x + p.w / 2) * fit, cy = oy + (p.y + p.h / 2) * fit;
    const gi = order.indexOf(p), li = isE ? -1 : textLines.indexOf(p.line), row = split.pieces.filter((q) => q.line === p.line), j = row.indexOf(p);
    const ei = emb.indexOf(p);
    const dist = Math.hypot(cx - lcx, cy - lcy) / maxDist;
    l.transform.position = A([cx, cy]); l.transform.scale = A(S(100));
    l.inPoint = 0; l.outPoint = D;
    l.name = isE ? `Símbolo ${ei + 1}` : `Linha ${li + 1} · ${j + 1}`;
    const T = (t0, dur, ease = 'expoOut') => ({ t0, t1: t0 + dur, ease });
    switch (style) {
      case 'pop': {
        const { t0, t1 } = T(0.3 + dist * 0.9, 0.9);
        l.transform.scale = KF([[t0, S(0), 'elastic'], [t1, S(100)]]);
        l.transform.rotation = KF([[t0, (R() - 0.5) * 50, 'elastic'], [t1, 0]]);
        break;
      }
      case 'glitch': {
        const t0 = 0.25 + R() * 1.3, k1 = t0 + 0.05, k2 = t0 + 0.12, k3 = t0 + 0.2;
        l.transform.opacity = KF([[t0, 0, 'hold'], [k1, 100, 'hold'], [k2, 0, 'hold'], [k3, 100, 'hold']]);
        l.transform.position = KF([[t0, [cx + (R() - 0.5) * PW * 0.12, cy], 'hold'], [k2, [cx + (R() - 0.5) * PW * 0.05, cy], 'hold'], [k3, [cx, cy]]]);
        break;
      }
      case 'deslizar': {
        const t0 = 0.35 + (isE ? 0 : 0.45 + li * 0.35) + (isE ? ei * 0.06 : j * 0.025);
        l.transform.position = KF([[t0, [cx, cy + p.h * fit * 0.8], 'expoOut'], [t0 + 0.9, [cx, cy]]]);
        l.transform.opacity = KF([[t0, 0, 'easeOut'], [t0 + 0.35, 100]]);
        break;
      }
      case 'particulas': {
        const sx = R() * PW, sy = R() * PH, t0 = 0.2 + R() * 0.5, t1 = t0 + 1.3 + R() * 0.3;
        l.transform.position = KF([[t0, [sx, sy], 'expoInOut'], [t1, [cx, cy]]]);
        l.transform.rotation = KF([[t0, (R() - 0.5) * 720, 'expoInOut'], [t1, 0]]);
        l.transform.scale = KF([[t0, S(25), 'expoInOut'], [t1, S(100)]]);
        l.transform.opacity = KF([[0, 0], [t0 + 0.2, 100]]);
        l.effects.push(fx('motionBlur', { amount: 110, samples: 12 }));
        break;
      }
      case 'impacto': break; // anima o grupo inteiro (abaixo)
      case 'luz': {
        const t0 = 0.5 + (cx / PW) * 1.4;
        l.transform.opacity = KF([[t0 - 0.1, 0, 'easeOut'], [t0 + 0.25, 100]]);
        l.effects.push(fx('exposure', { exposure: { keys: [{ t: t0 - 0.1, v: 2.5, ease: 'expoOut' }, { t: t0 + 0.8, v: 0, ease: 'linear' }] } }));
        break;
      }
      case 'flip': {
        const t0 = 0.3 + ((cx - ox) / Math.max(1, split.W * fit)) * 1.0 + (isE ? 0 : 0.25);
        l.transform.scale = KF([[t0, [0, fit * 100], 'expoOut'], [t0 + 0.7, S(100)]]);
        l.transform.opacity = KF([[t0, 0, 'linear'], [t0 + 0.08, 100]]);
        break;
      }
      case 'queda': {
        const t0 = 0.2 + R() * 1.1;
        l.transform.position = KF([[t0, [cx, cy - PH * 0.75], 'bounce'], [t0 + 1.0, [cx, cy]]]);
        l.transform.rotation = KF([[t0, (R() - 0.5) * 40, 'bounce'], [t0 + 1.0, 0]]);
        break;
      }
      case 'tunel': {
        const t0 = 0.2 + gi * (1.4 / Math.max(1, N)), t1 = t0 + 0.9;
        l.transform.scale = KF([[t0, S(900), 'expoOut'], [t1, S(100)]]);
        l.transform.position = KF([[t0, [lcx + (cx - lcx) * 4, lcy + (cy - lcy) * 4], 'expoOut'], [t1, [cx, cy]]]);
        l.transform.opacity = KF([[t0, 0, 'linear'], [t0 + 0.2, 100]]);
        l.effects.push(fx('blur', { radius: { keys: [{ t: t0, v: 40, ease: 'expoOut' }, { t: t1, v: 0, ease: 'linear' }] } }));
        break;
      }
      case 'digitar': {
        const t0 = 0.3 + gi * Math.min(0.12, 2.2 / Math.max(1, N));
        l.transform.scale = KF([[t0, S(0), 'back'], [t0 + 0.28, S(100)]]);
        l.transform.opacity = KF([[t0, 0, 'hold'], [t0 + 0.01, 100]]);
        break;
      }
      default: { // montar
        if (isE) {
          const dx = cx - ecx, dy = cy - ecy, n = Math.hypot(dx, dy) || 1;
          const t0 = 0.25 + ei * 0.12, t1 = t0 + 0.9;
          l.transform.position = KF([[t0, [cx + (dx / n) * PW * 0.45, cy + (dy / n) * PW * 0.45], 'expoOut'], [t1, [cx, cy]]]);
          l.transform.rotation = KF([[t0, (ei % 2 ? 1 : -1) * 120, 'expoOut'], [t1, 0]]);
          l.transform.scale = KF([[t0, S(40), 'expoOut'], [t1, S(100)]]);
          l.transform.opacity = KF([[t0, 0], [t0 + 0.15, 100]]);
          l.effects.push(fx('motionBlur', { amount: 120, samples: 12 }));
        } else {
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
        }
      }
    }
    pieceLayers.push(l);
  }
  // grupo: push de câmera lento e saída no fim
  const group = LAYER_FACTORIES.group(P, pieceLayers.reverse());
  group.name = 'Logo'; group.inPoint = 0; group.outPoint = D;
  group.transform.scale = KF([[0, [100, 100], 'linear'], [D - 0.6, [104, 104], 'expoIn'], [D, [118, 118]]]);
  group.transform.opacity = KF([[D - 0.45, 100, 'easeIn'], [D, 0]]);
  const layers = [group];
  const sweep = (t0, t1, w = 70) => group.effects.push(fx('lightSweep', { width: w, intensity: 0.9, direction: 25, center: { keys: [{ t: t0, v: [-0.3, 0.5], ease: 'expoInOut' }, { t: t1, v: [1.3, 0.5], ease: 'linear' }] } }));
  const shapeL = (name, items, t0, t1, pos = [ecx, ecy]) => { const l = LAYER_FACTORIES.shape(P, items); l.name = name; l.props.width = PW; l.props.height = PH; l.inPoint = t0; l.outPoint = t1; l.transform.position = A(pos); layers.unshift(l); return l; };
  const grp = (items, tr = {}) => ({ t: 'group', items, tr: { position: A([0, 0]), scale: A([100, 100]), rotation: A(0), opacity: A(100), anchor: A([0, 0]), ...tr } });
  const stroke = (c, w) => ({ t: 'stroke', color: A(c), width: A(w), opacity: A(100), cap: 2, join: 2 });
  const line = (a, b) => ({ t: 'path', path: { shapes: [{ closed: false, pts: [a, a, a, b, b, b] }], times: [] } });
  const burst = (t0, Rr, n = 12) => {
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
      items.push(grp([line([c * Rr * 1.05, s2 * Rr * 1.05], [c * Rr * 1.45, s2 * Rr * 1.45]), { t: 'trim', start: KF([[t0 + 0.2, 0, 'expoInOut'], [t0 + 0.7, 100]]), end: KF([[t0, 0, 'expoOut'], [t0 + 0.35, 100]]), offset: A(0) }, stroke(i % 2 ? ac : [1, 1, 1], Math.max(3, PW * 0.005))]));
    }
    return shapeL('Explosão', items, t0, t0 + 0.9);
  };
  const waves = (t0, Rr) => shapeL('Ondas', [0, 1, 2].map((k) => grp([{ t: 'ellipse', size: A([Rr, Rr]), position: A([0, 0]) }, stroke(k === 1 ? ac : [1, 1, 1], Math.max(2, PW * 0.004))], {
    scale: KF([[t0 + k * 0.15, [0, 0], 'expoOut'], [t0 + 0.9 + k * 0.15, [180 + k * 70, 180 + k * 70]]]), opacity: KF([[t0 + 0.4 + k * 0.15, 100, 'easeIn'], [t0 + 1.0 + k * 0.15, 0]]),
  })), t0, t0 + 1.5);
  switch (style) {
    case 'pop': waves(0.3, eSize * 0.6); sweep(2.3, 3.4); break;
    case 'glitch':
      group.effects.push(fx('rgbSplit', { amount: { keys: [{ t: 0.2, v: 40, ease: 'expoOut' }, { t: 1.9, v: 0, ease: 'linear' }, { t: 3.4, v: 0, ease: 'hold' }, { t: 3.45, v: 30, ease: 'expoOut' }, { t: 3.7, v: 0, ease: 'linear' }] } }));
      group.effects.push(fx('glitch', { amount: { keys: [{ t: 0.2, v: 90, ease: 'expoOut' }, { t: 1.9, v: 0, ease: 'linear' }, { t: 3.4, v: 0, ease: 'hold' }, { t: 3.45, v: 70, ease: 'expoOut' }, { t: 3.7, v: 0, ease: 'linear' }] } }));
      break;
    case 'deslizar': {
      const y = oy + lb[3] * fit + PH * 0.04, half = (lb[2] - lb[0]) * fit * 0.5;
      shapeL('Linha de acento', [grp([line([-half, 0], [half, 0]), { t: 'trim', start: A(0), end: KF([[1.2, 0, 'expoInOut'], [2.2, 100]]), offset: A(0) }, stroke(ac, Math.max(3, PW * 0.005))])], 1.2, D, [lcx, y]);
      sweep(2.6, 3.8, 50);
      break;
    }
    case 'particulas': waves(1.75, eSize * 0.7); sweep(2.4, 3.6); break;
    case 'impacto': {
      const tI = 0.55;
      group.transform.scale = KF([[0.15, [320, 320], 'expoIn'], [tI, [100, 100], 'easeOut'], [D - 0.6, [104, 104], 'expoIn'], [D, [118, 118]]]);
      group.transform.opacity = KF([[0.15, 0, 'linear'], [0.3, 100, 'linear'], [D - 0.45, 100, 'easeIn'], [D, 0]]);
      const sh = []; for (let i = 0; i <= 8; i++) sh.push([tI + i * 0.035, [PW / 2 + (i < 8 ? (R() - 0.5) * PW * 0.04 * (1 - i / 8) : 0), PH / 2 + (i < 8 ? (R() - 0.5) * PH * 0.04 * (1 - i / 8) : 0)]]);
      group.transform.position = KF(sh);
      group.effects.push(fx('motionBlur', { amount: 150, samples: 16 }));
      const fl = LAYER_FACTORIES.solid(P); fl.name = 'Flash'; fl.props.fill = '#ffffff'; fl.inPoint = tI; fl.outPoint = tI + 0.5; fl.transform.opacity = KF([[tI, 80, 'expoOut'], [tI + 0.45, 0]]); layers.unshift(fl);
      waves(tI, eSize * 0.9); burst(tI, eSize * 0.7, 16);
      sweep(2.2, 3.3);
      break;
    }
    case 'luz': {
      const bar = LAYER_FACTORIES.rect(P); bar.name = 'Faixa de luz'; bar.props.width = Math.round(PW * 0.06); bar.props.height = Math.round(PH * 1.6); bar.props.radius = 0; bar.props.fill = '#ffffff';
      bar.inPoint = 0.3; bar.outPoint = 2.3; bar.transform.rotation = A(20); bar.transform.position = KF([[0.35, [-PW * 0.1, PH / 2], 'linear'], [2.1, [PW * 1.1, PH / 2]]]);
      bar.transform.opacity = A(28); bar.effects.push(fx('blur', { radius: 40 })); bar.blend = 'screen';
      layers.unshift(bar);
      break;
    }
    case 'flip': sweep(2.0, 3.1); break;
    case 'queda': burst(1.4, eSize * 0.65); break;
    case 'tunel': sweep(2.2, 3.3); waves(1.6, eSize * 0.7); break;
    case 'digitar': sweep(0.3 + N * Math.min(0.12, 2.2 / Math.max(1, N)) + 0.3, 0.3 + N * Math.min(0.12, 2.2 / Math.max(1, N)) + 1.4); break;
    default: { // montar
      if (emb.length) {
        const Rr = eSize * 0.78;
        shapeL('Anel', [grp([{ t: 'ellipse', size: A([Rr * 2, Rr * 2]), position: A([0, 0]) }, { t: 'trim', start: KF([[1.0, 0, 'expoInOut'], [2.2, 100]]), end: KF([[0.6, 0, 'expoOut'], [1.6, 100]]), offset: KF([[0.6, -90, 'expoOut'], [2.2, 60]]) }, stroke(ac, Math.max(3, PW * 0.006))])], 0, 2.4);
        burst(1.25, Rr);
      }
      sweep(2.6, 3.8);
    }
  }
  const glow = LAYER_FACTORIES.adjustment(P); glow.name = 'Glow'; glow.inPoint = 0; glow.outPoint = D;
  glow.effects.push(fx('glow', { threshold: 60, radius: 26, intensity: 0.55 }));
  layers.unshift(glow);
  // fundo: cor da logo (ou escuro) com vinheta; degradê opcional
  const bg = LAYER_FACTORIES.solid(P); bg.name = 'Fundo'; bg.props.fill = P.background; bg.inPoint = 0; bg.outPoint = D;
  if (opts.background === 'gradient') bg.effects.push(fx('ramp', { start: [ac[0] * 0.35, ac[1] * 0.35, ac[2] * 0.35, 1], end: [0.02, 0.02, 0.03, 1], angle: 180, radial: true }));
  bg.effects.push(fx('vignette', { amount: 40 }));
  layers.push(bg);
  P.layers = layers;
  return P;
}
