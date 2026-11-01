// Registro de efeitos nativos do editor + mapeamento para match names do After Effects.
// Cada efeito: { type, label, category, params[], ffx?, pad?(p,env), render?(src,p,env), transform?(p,env) }
// Cores: [r,g,b,a] 0..1. Ângulos em graus. Valores em pixels são multiplicados por env.scale.

let canvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
export function setCanvasFactory(fn) { canvasFactory = fn; }

export function makeCanvas(w, h) {
  return canvasFactory(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

const rgba = (c, aMul = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c[3] ?? 1) * aMul})`;
const rad = (d) => (d * Math.PI) / 180;
const blank = (src) => { const c = makeCanvas(src.width, src.height); return [c, c.getContext('2d')]; };

function filtered(src, filter) {
  const [c, x] = blank(src);
  x.filter = filter;
  x.drawImage(src, 0, 0);
  return c;
}

function pixelOp(src, fn) {
  const x = src.getContext('2d', { willReadFrequently: true });
  const img = x.getImageData(0, 0, src.width, src.height);
  fn(img.data, src.width, src.height);
  x.putImageData(img, 0, 0);
  return src;
}

// Pseudo-aleatório determinístico (para shake/ruído reproduzíveis no export)
function hash(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i + seed * 101.3) * (1 - u) + hash(i + 1 + seed * 101.3) * u) * 2 - 1;
}

export const EFFECTS = [
  {
    type: 'blur', label: 'Desfoque gaussiano', category: 'Desfoque',
    params: [{ key: 'radius', label: 'Intensidade', kind: 'number', min: 0, max: 200, step: 0.5, default: 10 }],
    ffx: {
      matchNames: ['ADBE Gaussian Blur 2', 'ADBE Gaussian Blur', 'ADBE Fast Blur', 'ADBE Box Blur2', 'ADBE Box Blur', 'ADBE Camera Lens Blur'],
      map: { radius: { index: 1, names: ['blurriness', 'blur radius', 'radius', 'desfoque'] } },
    },
    pad: (p) => p.radius * 2.5,
    render: (src, p, env) => (p.radius > 0 ? filtered(src, `blur(${p.radius * env.scale}px)`) : src),
  },
  {
    type: 'dirBlur', label: 'Desfoque direcional', category: 'Desfoque',
    params: [
      { key: 'angle', label: 'Direção', kind: 'angle', default: 0 },
      { key: 'length', label: 'Comprimento', kind: 'number', min: 0, max: 300, step: 1, default: 20 },
    ],
    ffx: { matchNames: ['ADBE Motion Blur'], map: { angle: { index: 1, names: ['direction'] }, length: { index: 2, names: ['blur length', 'length'] } } },
    pad: (p) => p.length,
    render: (src, p, env) => {
      if (p.length <= 0) return src;
      const [c, x] = blank(src);
      const steps = Math.min(24, Math.max(4, Math.round(p.length / 3)));
      const dx = Math.sin(rad(p.angle)) * p.length * env.scale;
      const dy = -Math.cos(rad(p.angle)) * p.length * env.scale;
      x.globalAlpha = 1 / steps * 1.6;
      for (let i = 0; i < steps; i++) {
        const f = i / (steps - 1) - 0.5;
        x.drawImage(src, dx * f, dy * f);
      }
      return c;
    },
  },
  {
    type: 'glow', label: 'Brilho (Glow)', category: 'Estilizar',
    params: [
      { key: 'threshold', label: 'Limiar', kind: 'number', min: 0, max: 100, step: 1, default: 40 },
      { key: 'radius', label: 'Raio', kind: 'number', min: 0, max: 200, step: 1, default: 25 },
      { key: 'intensity', label: 'Intensidade', kind: 'number', min: 0, max: 6, step: 0.05, default: 1.2 },
      { key: 'color', label: 'Cor', kind: 'color', default: [1, 1, 1, 1] },
      { key: 'useColor', label: 'Usar cor', kind: 'bool', default: false },
    ],
    ffx: {
      matchNames: ['ADBE Glo2', 'ADBE Glow'],
      keywords: ['glow', 'brilho', 'neon', 'bloom'],
      map: {
        threshold: { index: 2, names: ['glow threshold', 'threshold'] },
        radius: { index: 3, names: ['glow radius', 'radius'] },
        intensity: { index: 4, names: ['glow intensity', 'intensity', 'exposure'] },
        color: { index: 9, names: ['color a', 'glow color', 'color', 'tint'] },
      },
    },
    pad: (p) => p.radius * 2.5,
    render: (src, p, env) => {
      if (p.intensity <= 0 || p.radius <= 0) return src;
      const t = p.threshold / 100;
      const [g, gx] = blank(src);
      gx.filter = `brightness(${1 - t * 0.6}) contrast(${1 + t * 2}) blur(${p.radius * env.scale}px)`;
      gx.drawImage(src, 0, 0);
      gx.filter = 'none';
      if (p.useColor) {
        gx.globalCompositeOperation = 'source-in';
        gx.fillStyle = rgba(p.color);
        gx.fillRect(0, 0, g.width, g.height);
      }
      const [c, x] = blank(src);
      x.drawImage(src, 0, 0);
      x.globalCompositeOperation = 'lighter';
      let k = p.intensity;
      while (k > 0) { x.globalAlpha = Math.min(1, k); x.drawImage(g, 0, 0); k -= 1; }
      return c;
    },
  },
  {
    type: 'dropShadow', label: 'Sombra projetada', category: 'Perspectiva',
    params: [
      { key: 'color', label: 'Cor', kind: 'color', default: [0, 0, 0, 1] },
      { key: 'opacity', label: 'Opacidade %', kind: 'number', min: 0, max: 100, step: 1, default: 50 },
      { key: 'angle', label: 'Direção', kind: 'angle', default: 135 },
      { key: 'distance', label: 'Distância', kind: 'number', min: 0, max: 300, step: 1, default: 12 },
      { key: 'softness', label: 'Suavidade', kind: 'number', min: 0, max: 200, step: 1, default: 12 },
    ],
    ffx: {
      matchNames: ['ADBE Drop Shadow'],
      keywords: ['shadow', 'sombra'],
      map: {
        color: { index: 1, names: ['shadow color', 'color'] },
        opacity: { index: 2, names: ['opacity'], fromAE: (v) => (v > 100 ? v / 2.55 : v) },
        angle: { index: 3, names: ['direction', 'angle'] },
        distance: { index: 4, names: ['distance'] },
        softness: { index: 5, names: ['softness', 'blur'] },
      },
    },
    pad: (p) => p.distance + p.softness * 2,
    render: (src, p, env) => {
      const [c, x] = blank(src);
      // AE: 0° = para cima, sentido horário
      x.shadowColor = rgba(p.color, p.opacity / 100);
      x.shadowBlur = p.softness * env.scale;
      x.shadowOffsetX = Math.sin(rad(p.angle)) * p.distance * env.scale;
      x.shadowOffsetY = -Math.cos(rad(p.angle)) * p.distance * env.scale;
      x.drawImage(src, 0, 0);
      return c;
    },
  },
  {
    type: 'fill', label: 'Preenchimento', category: 'Gerar',
    params: [
      { key: 'color', label: 'Cor', kind: 'color', default: [1, 0.2, 0.4, 1] },
      { key: 'opacity', label: 'Opacidade %', kind: 'number', min: 0, max: 100, step: 1, default: 100 },
    ],
    ffx: {
      matchNames: ['ADBE Fill'],
      map: {
        color: { index: 3, names: ['color'] },
        opacity: { index: 7, names: ['opacity'], fromAE: (v) => (v <= 1 ? v * 100 : v) },
      },
    },
    render: (src, p) => {
      const [c, x] = blank(src);
      x.drawImage(src, 0, 0);
      x.globalCompositeOperation = 'source-atop';
      x.globalAlpha = p.opacity / 100;
      x.fillStyle = rgba(p.color);
      x.fillRect(0, 0, c.width, c.height);
      return c;
    },
  },
  {
    type: 'tint', label: 'Tingir', category: 'Cor',
    params: [
      { key: 'black', label: 'Mapear preto para', kind: 'color', default: [0, 0, 0, 1] },
      { key: 'white', label: 'Mapear branco para', kind: 'color', default: [1, 1, 1, 1] },
      { key: 'amount', label: 'Quantidade %', kind: 'number', min: 0, max: 100, step: 1, default: 100 },
    ],
    ffx: {
      matchNames: ['ADBE Tint'],
      keywords: ['tint', 'duotone'],
      map: {
        black: { index: 1, names: ['map black to', 'black'] },
        white: { index: 2, names: ['map white to', 'white'] },
        amount: { index: 3, names: ['amount to tint', 'amount'] },
      },
    },
    render: (src, p) => pixelOp(src, (d) => {
      const a = p.amount / 100;
      const [br, bg, bb] = p.black, [wr, wg, wb] = p.white;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        d[i] += ((br + (wr - br) * l) * 255 - d[i]) * a;
        d[i + 1] += ((bg + (wg - bg) * l) * 255 - d[i + 1]) * a;
        d[i + 2] += ((bb + (wb - bb) * l) * 255 - d[i + 2]) * a;
      }
    }),
  },
  {
    type: 'hueSat', label: 'Matiz / Saturação', category: 'Cor',
    params: [
      { key: 'hue', label: 'Matiz', kind: 'angle', default: 0 },
      { key: 'saturation', label: 'Saturação', kind: 'number', min: -100, max: 100, step: 1, default: 0 },
      { key: 'lightness', label: 'Luminosidade', kind: 'number', min: -100, max: 100, step: 1, default: 0 },
    ],
    ffx: {
      matchNames: ['ADBE HUE SATURATION', 'ADBE Color Balance (HLS)'],
      map: {
        hue: { index: 1, names: ['master hue', 'hue'] },
        saturation: { index: 3, names: ['master saturation', 'saturation'] },
        lightness: { index: 2, names: ['master lightness', 'lightness'] },
      },
    },
    render: (src, p) => filtered(src, `hue-rotate(${p.hue}deg) saturate(${1 + p.saturation / 100}) brightness(${1 + p.lightness / 100})`),
  },
  {
    type: 'brightnessContrast', label: 'Brilho e contraste', category: 'Cor',
    params: [
      { key: 'brightness', label: 'Brilho', kind: 'number', min: -150, max: 150, step: 1, default: 0 },
      { key: 'contrast', label: 'Contraste', kind: 'number', min: -100, max: 100, step: 1, default: 0 },
    ],
    ffx: {
      matchNames: ['ADBE Brightness & Contrast 2', 'ADBE Brightness & Contrast'],
      map: { brightness: { index: 1, names: ['brightness'] }, contrast: { index: 2, names: ['contrast'] } },
    },
    render: (src, p) => filtered(src, `brightness(${1 + p.brightness / 150}) contrast(${1 + p.contrast / 100})`),
  },
  {
    type: 'blackWhite', label: 'Preto e branco', category: 'Cor',
    params: [{ key: 'amount', label: 'Quantidade %', kind: 'number', min: 0, max: 100, step: 1, default: 100 }],
    ffx: { matchNames: ['ADBE Black&White', 'ADBE Black & White'], keywords: ['black & white', 'grayscale', 'monochrome'], map: {} },
    render: (src, p) => filtered(src, `grayscale(${p.amount / 100})`),
  },
  {
    type: 'invert', label: 'Inverter', category: 'Canal',
    params: [{ key: 'amount', label: 'Mesclar com original %', kind: 'number', min: 0, max: 100, step: 1, default: 0 }],
    ffx: { matchNames: ['ADBE Invert'], map: { amount: { index: 2, names: ['blend with original'] } } },
    render: (src, p) => filtered(src, `invert(${1 - p.amount / 100})`),
  },
  {
    type: 'mosaic', label: 'Mosaico', category: 'Estilizar',
    params: [
      { key: 'hBlocks', label: 'Blocos horizontais', kind: 'number', min: 1, max: 200, step: 1, default: 20 },
      { key: 'vBlocks', label: 'Blocos verticais', kind: 'number', min: 1, max: 200, step: 1, default: 20 },
    ],
    ffx: { matchNames: ['ADBE Mosaic'], keywords: ['pixelate', 'mosaic'], map: { hBlocks: { index: 1, names: ['horizontal blocks'] }, vBlocks: { index: 2, names: ['vertical blocks'] } } },
    render: (src, p) => {
      const small = makeCanvas(Math.max(1, p.hBlocks), Math.max(1, p.vBlocks));
      const sx = small.getContext('2d');
      sx.drawImage(src, 0, 0, small.width, small.height);
      const [c, x] = blank(src);
      x.imageSmoothingEnabled = false;
      x.drawImage(small, 0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(src, 0, 0);
      return c;
    },
  },
  {
    type: 'vignette', label: 'Vinheta', category: 'Estilizar',
    params: [
      { key: 'amount', label: 'Quantidade %', kind: 'number', min: 0, max: 100, step: 1, default: 60 },
      { key: 'size', label: 'Tamanho %', kind: 'number', min: 0, max: 100, step: 1, default: 50 },
      { key: 'color', label: 'Cor', kind: 'color', default: [0, 0, 0, 1] },
    ],
    ffx: { matchNames: ['CC Vignette'], keywords: ['vignette', 'vinheta'], map: { amount: { index: 1, names: ['amount'] } } },
    render: (src, p, env) => {
      const [c, x] = blank(src);
      x.drawImage(src, 0, 0);
      const w = c.width - env.pad * 2, h = c.height - env.pad * 2;
      const r = Math.hypot(w, h) / 2;
      const g = x.createRadialGradient(c.width / 2, c.height / 2, r * (p.size / 100) * 0.9, c.width / 2, c.height / 2, r);
      g.addColorStop(0, rgba(p.color, 0));
      g.addColorStop(1, rgba(p.color, p.amount / 100));
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = g;
      x.fillRect(0, 0, c.width, c.height);
      return c;
    },
  },
  {
    type: 'rgbSplit', label: 'Aberração cromática (RGB)', category: 'Estilizar',
    params: [
      { key: 'amount', label: 'Deslocamento', kind: 'number', min: 0, max: 100, step: 0.5, default: 6 },
      { key: 'angle', label: 'Ângulo', kind: 'angle', default: 90 },
    ],
    ffx: { matchNames: [], keywords: ['chromatic', 'rgb split', 'channel shift', 'aberration', 'glitch'], map: { amount: { index: 1, names: ['amount', 'offset', 'shift'] } } },
    pad: (p) => p.amount,
    render: (src, p, env) => {
      if (p.amount <= 0) return src;
      const dx = Math.sin(rad(p.angle)) * p.amount * env.scale;
      const dy = -Math.cos(rad(p.angle)) * p.amount * env.scale;
      const channel = (color, ox, oy) => {
        const [c, x] = blank(src);
        x.drawImage(src, ox, oy);
        x.globalCompositeOperation = 'multiply';
        x.fillStyle = color;
        x.fillRect(0, 0, c.width, c.height);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(src, ox, oy);
        return c;
      };
      const [c, x] = blank(src);
      x.globalCompositeOperation = 'lighter';
      x.drawImage(channel('#f00', -dx, -dy), 0, 0);
      x.drawImage(channel('#0f0', 0, 0), 0, 0);
      x.drawImage(channel('#00f', dx, dy), 0, 0);
      return c;
    },
  },
  {
    type: 'noise', label: 'Ruído / Grão', category: 'Ruído',
    params: [
      { key: 'amount', label: 'Quantidade %', kind: 'number', min: 0, max: 100, step: 1, default: 20 },
      { key: 'animated', label: 'Animado', kind: 'bool', default: true },
    ],
    ffx: { matchNames: ['ADBE Noise', 'ADBE Add Grain', 'ADBE Noise2'], keywords: ['noise', 'grain', 'ruído'], map: { amount: { index: 1, names: ['amount of noise', 'intensity', 'amount'] } } },
    render: (src, p, env) => pixelOp(src, (d) => {
      const amt = (p.amount / 100) * 255;
      let seed = p.animated ? Math.floor(env.t * 24) * 7919 + 1 : 1;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        seed = (seed * 16807) % 2147483647;
        const n = ((seed / 2147483647) - 0.5) * amt;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    }),
  },
  {
    type: 'ramp', label: 'Gradiente', category: 'Gerar',
    params: [
      { key: 'start', label: 'Cor inicial', kind: 'color', default: [1, 0.3, 0.5, 1] },
      { key: 'end', label: 'Cor final', kind: 'color', default: [0.2, 0.4, 1, 1] },
      { key: 'angle', label: 'Ângulo', kind: 'angle', default: 180 },
      { key: 'blend', label: 'Mesclar com original %', kind: 'number', min: 0, max: 100, step: 1, default: 0 },
    ],
    ffx: {
      matchNames: ['ADBE Ramp', 'ADBE 4ColorGradient'],
      keywords: ['gradient', 'ramp'],
      map: { start: { index: 2, names: ['start color'] }, end: { index: 4, names: ['end color'] }, blend: { index: 7, names: ['blend with original'] } },
    },
    render: (src, p) => {
      const [c, x] = blank(src);
      x.drawImage(src, 0, 0);
      const cx = c.width / 2, cy = c.height / 2, r = Math.hypot(cx, cy);
      const dx = Math.sin(rad(p.angle)) * r, dy = -Math.cos(rad(p.angle)) * r;
      const g = x.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      g.addColorStop(0, rgba(p.start));
      g.addColorStop(1, rgba(p.end));
      x.globalCompositeOperation = 'source-atop';
      x.globalAlpha = 1 - p.blend / 100;
      x.fillStyle = g;
      x.fillRect(0, 0, c.width, c.height);
      return c;
    },
  },
  {
    type: 'shake', label: 'Tremor (Shake / Wiggle)', category: 'Movimento',
    params: [
      { key: 'frequency', label: 'Frequência (Hz)', kind: 'number', min: 0, max: 30, step: 0.5, default: 8 },
      { key: 'amount', label: 'Amplitude (px)', kind: 'number', min: 0, max: 300, step: 1, default: 15 },
      { key: 'rotation', label: 'Rotação (°)', kind: 'number', min: 0, max: 45, step: 0.5, default: 2 },
      { key: 'seed', label: 'Semente', kind: 'number', min: 0, max: 999, step: 1, default: 1 },
    ],
    ffx: { matchNames: [], keywords: ['shake', 'wiggle', 'tremor', 'camera shake'], map: { frequency: { names: ['frequency', 'freq'] }, amount: { names: ['amplitude', 'amount', 'magnitude', 'intensity'] } } },
    transform: (p, env) => {
      const f = env.t * p.frequency;
      return {
        dx: noise1(f, p.seed) * p.amount,
        dy: noise1(f, p.seed + 17) * p.amount,
        rot: noise1(f, p.seed + 33) * p.rotation,
      };
    },
  },
  {
    type: 'transform', label: 'Transformar (efeito)', category: 'Distorcer',
    params: [
      { key: 'offset', label: 'Deslocamento', kind: 'point', default: [0, 0] },
      { key: 'scale', label: 'Escala %', kind: 'number', min: 0, max: 1000, step: 1, default: 100 },
      { key: 'rotation', label: 'Rotação', kind: 'angle', default: 0 },
      { key: 'opacity', label: 'Opacidade %', kind: 'number', min: 0, max: 100, step: 1, default: 100 },
    ],
    ffx: {
      matchNames: ['ADBE Geometry2', 'ADBE Geometry'],
      map: {
        scale: { index: 3, names: ['uniform scale', 'scale height', 'scale'] },
        rotation: { index: 8, names: ['rotation'] },
        opacity: { index: 9, names: ['opacity'] },
      },
    },
    transform: (p) => ({ dx: p.offset[0], dy: p.offset[1], scale: p.scale / 100, rot: p.rotation, opacity: p.opacity / 100 }),
  },
];

export const EFFECT_MAP = Object.fromEntries(EFFECTS.map((e) => [e.type, e]));

/** Efeito para parâmetros importados que não têm renderização equivalente. */
export const GENERIC_EFFECT = { type: 'generic', label: 'Controles importados', category: 'Importado', params: [] };

export function getEffectDef(type) {
  return EFFECT_MAP[type] || GENERIC_EFFECT;
}

/** Encontra o efeito nativo equivalente a um match name/nome do AE. */
export function matchEffect(matchName, displayName = '') {
  for (const e of EFFECTS) {
    if (e.ffx?.matchNames.some((m) => m.toLowerCase() === (matchName || '').toLowerCase())) return { def: e, exact: true };
  }
  const hay = `${matchName} ${displayName}`.toLowerCase();
  for (const e of EFFECTS) {
    if (e.ffx?.keywords?.some((k) => hay.includes(k))) return { def: e, exact: false };
  }
  for (const e of EFFECTS) {
    if (hay.includes(e.type.toLowerCase())) return { def: e, exact: false };
  }
  if (hay.includes('blur')) return { def: EFFECT_MAP.blur, exact: false };
  return null;
}
