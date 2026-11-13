// Animadores de texto do After Effects (Text Animators): cada animador tem propriedades (opacidade, posição, escala,
// rotação, desfoque, tracking) e seletores (Range, Wiggly) que dizem quanto de cada caractere é afetado (0..1).
// O texto passa a ser desenhado caractere a caractere quando a camada tem animadores.
import { valueAt } from './anim.js';

const v = (p, t, d) => (p == null ? d : valueAt(p, t));

function mixCss(base, c, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(base).trim());
  const b = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [255, 255, 255];
  const r = [0, 1, 2].map((k) => Math.round(b[k] + ((c[k] ?? 1) * 255 - b[k]) * a));
  return `rgb(${r[0]},${r[1]},${r[2]})`;
}
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; }

/** Unidades do seletor: 1 caracteres, 2 caracteres sem espaço, 3 palavras, 4 linhas. */
function unitsOf(chars, based) {
  const key = based === 3 ? 'word' : based === 4 ? 'line' : based === 2 ? 'ns' : 'ci';
  const n = Math.max(1, ...chars.map((c) => (c[key] ?? -1) + 1));
  return { key, n };
}

function shapeAmount(shape, a, b, c0, c1, smooth) {
  // a..b = faixa selecionada (0..1); c0..c1 = faixa da unidade
  const mid = (c0 + c1) / 2, w = Math.max(1e-6, c1 - c0);
  if (b <= a) return 0;
  switch (shape) {
    case 2: return mid < a ? 0 : mid > b ? 1 : (mid - a) / (b - a); // rampa para cima
    case 3: return mid < a ? 1 : mid > b ? 0 : 1 - (mid - a) / (b - a); // rampa para baixo
    case 4: { if (mid < a || mid > b) return 0; const x = (mid - a) / (b - a); return 1 - Math.abs(x * 2 - 1); } // triângulo
    case 5: { if (mid < a || mid > b) return 0; const x = (mid - a) / (b - a) * 2 - 1; return Math.sqrt(Math.max(0, 1 - x * x)); } // redondo
    case 6: { if (mid < a || mid > b) return 0; const x = (mid - a) / (b - a); return 0.5 - 0.5 * Math.cos(x * Math.PI * 2); } // suave
    default: { // quadrado: cobertura da unidade dentro da faixa (suavizada)
      const cov = Math.max(0, Math.min(c1, b) - Math.max(c0, a)) / w;
      return smooth > 0 ? cov : cov >= 0.5 ? 1 : 0;
    }
  }
}

/** Quanto (0..1, pode ser negativo) cada caractere é afetado pelos seletores de um animador. */
function selectorAmounts(an, chars, t) {
  let acc = null;
  for (const s of an.selectors || []) {
    const { key, n } = unitsOf(chars, s.based || 1);
    let order = Array.from({ length: n }, (_, i) => i);
    if (s.randomize) {
      const seed = s.seed || 0;
      order = order.map((i) => [hash(i * 13.7 + seed * 3.1), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const inv = new Array(n); order.forEach((u, i) => { inv[u] = i; }); order = inv;
    }
    const amt = v(s.amount, t, 100) / 100;
    let vals;
    if (s.type === 'wiggly') {
      const mx = v(s.max, t, 100) / 100, mn = v(s.min, t, -100) / 100, f = v(s.freq, t, 2), cor = v(s.correlation, t, 50) / 100;
      const tp = v(s.tphase, t, 0) / 360, sp = v(s.sphase, t, 0) / 360;
      vals = chars.map((c) => { const u = c[key] ?? 0; const nz = noise1(t * f + tp + (1 - cor) * u * 7.31 + sp); return mn + (mx - mn) * (nz * 0.5 + 0.5); });
    } else if (s.type === 'expr') {
      vals = chars.map(() => 0); // seletor de expressão: o código não é executado (segurança) → sem efeito
    } else {
      const off = v(s.offset, t, 0) / 100;
      let a = v(s.start, t, 0) / 100 + off, b = v(s.end, t, 100) / 100 + off;
      if (a > b) [a, b] = [b, a];
      vals = chars.map((c) => {
        const u = c[key];
        if (u == null) return 0;
        const k = order[u] ?? u;
        return shapeAmount(s.shape || 1, a, b, k / n, (k + 1) / n, v(s.smooth, t, 100)) * amt;
      });
    }
    if (acc == null) acc = s.type === 'wiggly' && (s.mode || 3) === 3 ? vals.map(() => 1) : vals.map(() => 0);
    const mode = s.mode || (s.type === 'wiggly' ? 3 : 1);
    acc = acc.map((x, i) => {
      const y = vals[i];
      switch (mode) {
        case 2: return x - y; case 3: return x * y; case 4: return Math.min(x, y); case 5: return Math.max(x, y); case 6: return Math.abs(x - y);
        default: return x + y;
      }
    });
  }
  return (acc || chars.map(() => 1)).map((x) => Math.max(-1, Math.min(1, x)));
}

/** Folga extra de desenho (px) que os animadores podem precisar (posição, desfoque, escala). */
export function animatorPad(p) {
  let pad = 0;
  for (const an of p.animators || []) {
    const pr = an.props || {};
    const pos = pr.position ? Math.max(...[pr.position.value, ...(pr.position.keys || []).map((k) => k.v)].flat().map(Math.abs)) : 0;
    const bl = pr.blur ? Math.max(...[pr.blur.value, ...(pr.blur.keys || []).map((k) => k.v)].flat().map(Math.abs)) : 0;
    const sc = pr.scale ? Math.max(...[pr.scale.value, ...(pr.scale.keys || []).map((k) => k.v)].flat().map(Math.abs)) : 100;
    pad = Math.max(pad, pos + bl * 2 + (sc > 100 ? p.fontSize * (sc / 100 - 1) : 0));
  }
  return Math.min(4000, pad);
}

/** Desenha o texto com animadores. Mesma diagramação do desenho normal (linhas, alinhamento, contorno). */
export function drawAnimatedText(ctx, p, w, h, t, font) {
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lines = String(p.text).split('\n');
  const lh = p.fontSize * p.lineHeight, ls = p.letterSpacing || 0;
  // lista de caracteres com índices (caractere, sem espaço, palavra, linha)
  const chars = [];
  let ci = 0, ns = 0, word = -1;
  lines.forEach((line, li) => {
    let inWord = false;
    for (const ch of line) {
      const sp = /\s/.test(ch);
      if (!sp && !inWord) word++;
      inWord = !sp;
      chars.push({ ch, line: li, ci: ci++, ns: sp ? null : ns++, word: sp ? null : word });
    }
  });
  const ams = (p.animators || []).map((an) => ({ an, s: selectorAmounts(an, chars, t) }));
  // tracking por caractere (1/1000 em)
  const track = chars.map((_, i) => ams.reduce((sum, { an, s }) => sum + (an.props?.tracking ? (v(an.props.tracking, t, 0) / 1000) * p.fontSize * s[i] : 0), 0));
  let k = 0;
  lines.forEach((line, li) => {
    const glyphs = [...line];
    const adv = glyphs.map((g, gi) => ctx.measureText(g).width + ls + track[k + gi]);
    const lw = adv.reduce((a, b) => a + b, 0);
    let x = p.align === 'left' ? 4 + (p.strokeWidth || 0) : p.align === 'right' ? w - 4 - (p.strokeWidth || 0) - lw : (w - lw) / 2;
    const y = h / 2 + (li - (lines.length - 1) / 2) * lh;
    glyphs.forEach((g, gi) => {
      const i = k + gi, cw = adv[gi];
      let op = 1, dx = 0, dy = 0, sx = 1, sy = 1, rot = 0, blur = 0, scr = 0, col = null, colA = 0;
      for (const { an, s } of ams) {
        const pr = an.props || {}, a = s[i];
        if (!a) continue;
        if (pr.opacity) op *= 1 + (v(pr.opacity, t, 100) / 100 - 1) * a;
        if (pr.position) { const q = v(pr.position, t, [0, 0]); dx += q[0] * a; dy += q[1] * a; }
        if (pr.scale) { const q = v(pr.scale, t, [100, 100]); sx *= 1 + (q[0] / 100 - 1) * a; sy *= 1 + ((q[1] ?? q[0]) / 100 - 1) * a; }
        if (pr.rotation) rot += v(pr.rotation, t, 0) * a;
        if (pr.blur) { const q = v(pr.blur, t, [0, 0]); blur += Math.max(Math.abs(q[0]), Math.abs(q[1] ?? q[0])) * Math.abs(a); }
        if (pr.scramble) scr = Math.max(scr, (v(pr.scramble, t, 0) / 100) * Math.abs(a)); // letras trocadas (decode)
        if (pr.fillColor) { col = v(pr.fillColor, t, [1, 1, 1]); colA = Math.max(colA, Math.min(1, Math.abs(a))); }
      }
      op = Math.max(0, Math.min(1, op));
      if (op > 0.002 && g.trim()) {
        ctx.save();
        ctx.globalAlpha *= op;
        ctx.translate(x + cw / 2 + dx, y + dy);
        if (rot) ctx.rotate((rot * Math.PI) / 180);
        if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
        if (blur > 0.3 && 'filter' in ctx) ctx.filter = `blur(${blur.toFixed(1)}px)`;
        ctx.textAlign = 'center';
        let gg = g;
        if (scr > 0.01 && hash(i * 7.3 + Math.floor(t * 24) * 1.7) < scr) {
          const set = /[a-z]/.test(g) ? 'abcdefghijklmnopqrstuvwxyz0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*+=';
          gg = set[Math.floor(hash(i * 3.1 + Math.floor(t * 24) * 9.7) * set.length)];
        }
        if (p.strokeWidth > 0) { ctx.lineJoin = 'round'; ctx.strokeStyle = p.strokeColor; ctx.lineWidth = p.strokeWidth * 2; ctx.strokeText(gg, 0, 0); }
        ctx.fillStyle = col && colA > 0 ? mixCss(p.color, col, colA) : p.color;
        ctx.fillText(gg, 0, 0);
        ctx.restore();
      }
      x += cw;
    });
    k += glyphs.length;
  });
}
