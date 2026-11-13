// "Estimate Parameters" (como o botão do plugin Topaz Video AI): mede o quadro atual do clipe — ruído, blocos de
// compressão, desfoque e serrilhado — e sugere Fix Compression, Improve Detail, Sharpen, Reduce Noise, Dehalo e
// Anti-Alias/Deblur. A Topaz usa uma rede (prap); aqui são medidas clássicas de qualidade de imagem.

/** Recebe ImageData (de preferência perto do tamanho original do vídeo) e devolve valores 0–100 (AA −100…100). */
export function estimateFromImage(img) {
  const { width: W, height: H, data } = img;
  const Y = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) Y[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const at = (x, y) => Y[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const grads = [], laps = [];
  let hf = 0, lf = 0, nHF = 0, flat = 0, lowArea = 0, blockB = 0, blockI = 0, nb = 0, ni = 0, jag = 0, nj = 0;
  for (let y = 2; y < H - 2; y += 1) {
    for (let x = 2; x < W - 2; x += 1) {
      const c = at(x, y);
      const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
      const g = Math.hypot(gx, gy);
      const b3 = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) + c) / 5;
      const b9 = (at(x - 2, y) + at(x + 2, y) + at(x, y - 2) + at(x, y + 2) + b3 * 5) / 9;
      if ((x + y) % 2 === 0) { grads.push(g); laps.push(Math.abs(4 * c - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1))); }
      hf += Math.abs(c - b3); lf += Math.abs(b3 - b9); nHF++;
      if (g < 6) { lowArea++; if (g < 0.9) flat++; }
      // grade de 8 px (blocos de H.264/JPEG): degrau na borda do bloco vs. dentro
      const d = Math.abs(at(x + 1, y) - c);
      if (g < 20) { if (x % 8 === 7) { blockB += d; nb++; } else { blockI += d; ni++; } }
      // serrilhado: borda forte com sinais alternados na diagonal
      if (g > 40) { const s1 = Math.sign(at(x + 1, y + 1) - c), s2 = Math.sign(c - at(x - 1, y - 1)); if (s1 !== s2) jag++; nj++; }
    }
  }
  grads.sort((a, b) => a - b); laps.sort((a, b) => a - b);
  const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))] || 0;
  // ruído: Laplaciano nas áreas mais lisas (20% com menor gradiente)
  const flatLaps = [];
  const gThr = pct(grads, 0.2);
  for (let i = 0; i < grads.length; i++) if (grads[i] <= gThr) flatLaps.push(laps[i]);
  flatLaps.sort((a, b) => a - b);
  const sigma = pct(flatLaps, 0.5) / 2.2;
  const ratio = hf / Math.max(1e-3, lf); // pouco detalhe fino em relação ao médio = imagem mole
  const block = nb && ni ? blockB / nb / Math.max(0.05, blockI / ni) : 1;
  const plateau = lowArea ? flat / lowArea : 0; // áreas "achatadas" típicas de compressão forte
  const jaggy = nj ? jag / nj : 0;
  const clamp = (v, a = 0, b = 100) => Math.round(Math.max(a, Math.min(b, v)));
  const n = clamp(sigma * 14);
  const c = clamp((block - 1) * 140 + plateau * 60 + n * 0.25);
  const softness = clamp((1.15 - ratio) * 120);
  const d = clamp(20 + softness * 0.6 + c * 0.15);
  const s = clamp(10 + softness * 0.35);
  const h = clamp(15 + s * 0.3);
  const a = clamp(jaggy > 0.45 ? -(jaggy - 0.45) * 200 : softness * 0.4, -100, 100);
  return { c, d, s, n, h, a, stats: { sigma: +sigma.toFixed(2), block: +block.toFixed(2), ratio: +ratio.toFixed(2), plateau: +plateau.toFixed(2), jaggy: +jaggy.toFixed(2) } };
}
