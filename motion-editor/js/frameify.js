// Importador de presets do Frameify (.frameify = JSON com "effects", cada um com effectId FX-xxx, parâmetros com
// keyframes e, no Looks, a cadeia de "tools"). Cada código vira o efeito/ferramenta equivalente do MotionFrame.
// A tabela de códigos foi montada comparando presets .frameify com os mesmos .ffx originais.
import { encodeCube } from './fx/lut.js';
import { looksToolEffect } from './import-map.js';

const val = (p, k, d = 0) => (p[k] && typeof p[k] === 'object' && 'value' in p[k] ? p[k].value : d);
/** Parâmetro animável: valor fixo ou keyframes (com as alças de curva do Frameify). conv converte cada valor. */
function anim(p, k, d = 0, conv = (x) => x) {
  const q = p[k];
  if (!q || typeof q !== 'object') return conv(d);
  const keys = (q.keyframes || []).filter((x) => Number.isFinite(x.time));
  if (!keys.length) return conv(q.value ?? d);
  return {
    keys: keys.map((x) => {
      const e = { t: x.time, v: conv(x.value) };
      if (x.easing === 'hold') e.ease = 'hold';
      else if (x.easing === 'bezier' && Array.isArray(x.handles) && x.handles.length === 4) { e.ease = 'curve'; e.curve = x.handles.map(Number); }
      else e.ease = 'linear';
      return e;
    }).sort((a, b) => a.t - b.t),
  };
}
const rgb255 = (p, r, g, b) => [val(p, r, 255) / 255, val(p, g, 255) / 255, val(p, b, 255) / 255, 1];
const wrap = (v) => Math.min(3, Math.max(1, (v | 0) + 1)); // Frameify: 0 Não, 1 Repetir, 2 Espelhar
const HUE_KEYS = [['red', 'Red'], ['orange', 'Orange'], ['yellow', 'Yellow'], ['green', 'Green'], ['cyan', 'Aqua'], ['blue', 'Blue'], ['purple', 'Purple'], ['magenta', 'Magenta']];

/** Tabela 1D (curvas) ou 3D (LUT) do Frameify → efeito Curves (17 pontos por canal) ou LUT 3D. */
function tableEffect(table, str) {
  try {
    const bin = atob(table.data);
    const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const f = new Float32Array(u8.buffer, 0, Math.floor(u8.length / 4));
    if (table.dimensions === 1) {
      const n = table.size, ch = Math.max(1, Math.round(f.length / n));
      const pick = (c) => Array.from({ length: 17 }, (_, i) => f[Math.round((i / 16) * (n - 1)) * ch + Math.min(c, ch - 1)]);
      const master = Array.from({ length: 17 }, (_, i) => i / 16);
      return { type: 'curves', label: table.label || 'Look Table (curva)', params: { lut: [...master, ...pick(0), ...pick(1), ...pick(2)] }, str };
    }
    const size = table.size;
    if (f.length < size * size * size * 3) return null;
    // no Frameify o azul varia mais rápido (índice = (r·n + g)·n + b); no .cube é o vermelho → transpõe
    const data = new Float32Array(size * size * size * 3);
    for (let r = 0; r < size; r++) for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) for (let c = 0; c < 3; c++) {
      data[((b * size + g) * size + r) * 3 + c] = f[((r * size + g) * size + b) * 3 + c];
    }
    const enc = encodeCube({ size, data });
    return { type: 'lut3d', label: table.label || 'Look Table (LUT)', params: { amount: str, lut: enc.b64, lutSize: enc.size } };
  } catch { return null; }
}

/** Uma ferramenta do Looks reescrita como valores crus do Looks (reaproveita a conversão calibrada do .ffx). */
const viaLooks = (id, values) => ({ looks: { id, enabled: true, values } });

const MAP = {
  // ---------------------------------------------------------------- ferramentas do Looks (dentro do FX-302)
  'FX-310': (p, s) => ({ type: 'lkExposure', label: 'Exposure', params: { str: s, stops: anim(p, 'exposure'), con: val(p, 'contrast') / 100, pivot: val(p, 'pivot', 50), gamma: val(p, 'gamma', 1) } }),
  'FX-311': (p, s) => ({ type: 'lkSaturation', label: 'Saturation', params: { str: s, sat: anim(p, 'saturation', 100), vib: val(p, 'vibrance') / 100 } }),
  'FX-385': (p, s) => ({ type: 'lkLooksLight', label: 'Looks Light', params: { str: s, r: val(p, 'stopsR'), g: val(p, 'stopsG'), b: val(p, 'stopsB'), encoded: val(p, 'space') === 1 } }),
  'FX-346': (p) => viaLooks('mjo2', [val(p, 'mojo'), val(p, 'tint'), val(p, 'punch'), val(p, 'bleach'), val(p, 'fade'), val(p, 'blueSqueeze'), val(p, 'skinSqueeze'), val(p, 'exposure'), val(p, 'coolWarm'), val(p, 'greenMagenta'), val(p, 'skinYellowPink'), 100]),
  'FX-376': (p) => viaLooks('haze', [val(p, 'spillage'), val(p, 'softness'), val(p, 'reach'), val(p, 'exposure'), 0, 0, 0, 0, val(p, 'tintR', 1), val(p, 'tintG', 1), val(p, 'tintB', 1)]),
  'FX-336': (p, s) => ({ type: 'lkDiffusion', label: 'Glow / Diffusion', params: { str: s, amount: anim(p, 'intensity', 40), radius: val(p, 'radius', 60), threshold: val(p, 'threshold', 60) } }),
  'FX-344': (p, s) => ({ type: 'lkChroma', label: 'Chromatic Aberration', params: { str: s, amount: Math.abs(val(p, 'redCyan')) + Math.abs(val(p, 'greenMagenta')) + Math.abs(val(p, 'blueYellow')) } }),
  'FX-315': (p, s) => ({ type: 'lkSpotExposure', label: 'Spot Exposure', params: { str: s * val(p, 'spotStrength', 100) / 100, stops: val(p, 'spotExposure'), center: [val(p, 'spotX', 50) / 100, val(p, 'spotY', 50) / 100], size: val(p, 'spotRadius', 100), soft: val(p, 'spotSoftness', 50), invert: !!val(p, 'spotInvert') } }),
  'FX-316': (p, s) => ({ type: 'lkGradient', label: 'Grad Exposure', params: { str: s * val(p, 'gradTint', 100) / 100, stops: val(p, 'gradExposure'), color: [val(p, 'gradTintR', 1), val(p, 'gradTintG', 1), val(p, 'gradTintB', 1), 1], p1: [val(p, 'gradX1', 50) / 100, 1 - val(p, 'gradY1', 100) / 100], p2: [val(p, 'gradX2', 50) / 100, 1 - val(p, 'gradY2', 50) / 100], soft: val(p, 'gradFalloff', 50) / 100 } }),
  'FX-317': (p) => viaLooks('lenv', [val(p, 'lensVignetteSize', 50), val(p, 'lensVignette', 50), 50, val(p, 'lensVignetteShape'), 0, 1, 0]),
  'FX-320': (p) => viaLooks('vign', [0, 0, val(p, 'vignetteSize', 100) / 100, val(p, 'vignetteSoftness', 100) / 100, val(p, 'vignetteFalloff', 50) / 100, val(p, 'vignette', 50), 0, val(p, 'vignetteR'), val(p, 'vignetteG'), val(p, 'vignetteB'), val(p, 'vignetteAspect', 100) / 100]),
  'FX-342': (p, s) => ({ type: 'lkEdgeSoftness', label: 'Edge Softness', params: { str: s, blur: val(p, 'blurSize', 4), size: val(p, 'edgeRadius', 100), soft: val(p, 'edgeSpread', 50), center: [val(p, 'edgeX', 50) / 100, val(p, 'edgeY', 50) / 100] } }),
  'FX-314': (p, s) => ({ type: 'looks', label: 'Lift / Gamma / Gain', params: { strength: s, liftR: val(p, 'liftR') / 100, liftG: val(p, 'liftG') / 100, liftB: val(p, 'liftB') / 100, gammaR: val(p, 'gammaR', 1), gammaG: val(p, 'gammaG', 1), gammaB: val(p, 'gammaB', 1), gainR: val(p, 'gainR', 100) / 100, gainG: val(p, 'gainG', 100) / 100, gainB: val(p, 'gainB', 100) / 100 } }),
  'FX-016': (p, s) => ({ type: 'lkChannelMixer', label: 'Channel Mixer', params: { str: s, ...Object.fromEntries(['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'].map((k) => [k, val(p, k, k[0] === k[1] ? 100 : 0) / 100])) } }),
  'FX-343': (p, s) => ({ type: 'lkColorRanges', label: 'HSL por cor', params: { str: s, ...Object.fromEntries(HUE_KEYS.flatMap(([f, k]) => [[`h${k}`, val(p, `${f}Hue`)], [`s${k}`, val(p, `${f}Saturation`)], [`l${k}`, val(p, `${f}Lightness`)]])) } }),
  'FX-345': (p, s) => ({ type: 'lkAnamorphic', label: 'Streaks / Anamorphic', params: { str: s, size: val(p, 'streakLength', 300), boost: val(p, 'intensity', 100) / 100, threshold: val(p, 'threshold', 70), color: rgb255(p, 'tintR', 'tintG', 'tintB') } }),
  'FX-386': (p, s) => ({ type: 'lkBleachBypass', label: 'Bleach Bypass', params: { str: s, amount: val(p, 'silver', 50), desat: 40 } }),
  'FX-393': (p) => viaLooks('logc', [val(p, 'contrast', 1), val(p, 'midpoint', 0.5), val(p, 'brightness', 0.5), val(p, 'blackPoint'), val(p, 'whitePoint', 1), val(p, 'log')]),
  'FX-071': (p, s) => ({ type: 'lkSpotExposure', label: 'Spot', params: { str: s * val(p, 'strength', 45) / 100, stops: 0.5, center: [val(p, 'centerX', 50) / 100, val(p, 'centerY', 50) / 100], size: val(p, 'radius', 45) * 2, soft: val(p, 'softness', 70), invert: false } }),
  // ---------------------------------------------------------------- efeitos do AE / plugins
  'FX-001': (p) => ({ type: 'brightnessContrast', label: 'Brightness & Contrast', params: { brightness: anim(p, 'brightness'), contrast: anim(p, 'contrast') } }),
  'FX-002': (p) => ({ type: 'exposure', label: 'Exposure', params: { exposure: anim(p, 'stops'), offset: val(p, 'offset'), gamma: val(p, 'gammaCorrection', 1) } }),
  'FX-008': (p) => ({ type: 'hueSat', label: 'Hue/Saturation', params: { hue: val(p, 'hue'), saturation: anim(p, 'saturation'), lightness: val(p, 'lightness') } }),
  'FX-031': (p) => {
    const pts = (c) => [0, 1, 2, 3, 4].map((i) => val(p, `${c}${i}`, i * 25) / 100);
    const to17 = (y) => Array.from({ length: 17 }, (_, i) => { const x = (i / 16) * 4, a = Math.floor(Math.min(3, x)); return y[a] + (y[a + 1] - y[a]) * (x - a); });
    return { type: 'curves', label: 'Curves', params: { lut: [...to17([0, 0.25, 0.5, 0.75, 1]), ...to17(pts('r')), ...to17(pts('g')), ...to17(pts('b'))] } };
  },
  'FX-048': (p) => ({ type: 'sharpen', label: 'Unsharp Mask', params: { amount: anim(p, 'amount', 50), radius: val(p, 'radius', 1), threshold: val(p, 'threshold') } }),
  'FX-334': (p) => ({ type: 'sSharpen', label: 'S_Sharpen', params: { amp: anim(p, 'amplitude', 1), width: val(p, 'width', 2), detail: val(p, 'detailSize', 2), tiny: val(p, 'tiny', 1), small: val(p, 'small', 1), medium: val(p, 'medium', 1), large: val(p, 'large', 1), edgeThr: val(p, 'threshold'), luma: val(p, 'luma', 1), chroma: val(p, 'chroma', 1), opacity: 2 } }),
  'FX-331': (p) => {
    const L = Math.max(0.01, val(p, 'aLights', 1) * val(p, 'destinationLights', 1)), D = val(p, 'aDarks') + val(p, 'destinationDarks');
    const q = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    if (D < 0) q.inBlack = Math.min(254, (-D / L) * 255); else q.outBlack = Math.min(254, D * 255);
    if (L >= 1) q.inWhite = Math.max(q.inBlack + 1, Math.min(255, 255 / L)); else q.outWhite = Math.max(q.outBlack + 1, L * 255);
    return { type: 'levels', label: 'S_MathOps', params: q };
  },
  'FX-332': (p) => ({ type: 'blurMoCurves', label: 'S_BlurMoCurves', params: { center: [val(p, 'centerX', 50) / 100, val(p, 'centerY', 50) / 100], zDist: anim(p, 'zDist', 1), rotate: anim(p, 'rotate'), shiftX: anim(p, 'shiftX'), shiftY: anim(p, 'shiftY'), shutter: val(p, 'shutterDuration', 1 / 30) * 30, samples: 24, wrap: wrap(val(p, 'wrapX')), wrapY: wrap(val(p, 'wrapY')) } }),
  'FX-333': (p) => ({ type: 'flicker', label: 'S_Flicker', params: { amount: val(p, 'amplitude', 1) * val(p, 'randomLumaAmplitude', 0.5) * 100, frequency: Math.min(60, val(p, 'randomFrequency', 10)), colorAmount: val(p, 'randomColorAmplitude') * 100, brightness: val(p, 'brightness', 1), seed: val(p, 'seed') } }),
  'FX-335': (p) => ({ type: 'filmLook', label: 'S_FilmDamage', params: { grain: Math.min(100, val(p, 'grain') * 30), scratch: 0, vignette: 0, flicker: Math.min(100, val(p, 'flicker') * 100), warmth: 0, fade: 0 } }),
  'FX-337': (p) => ({ type: 'fourColor', label: '4-Color Gradient', params: { p1: [val(p, 'x1') / 100, val(p, 'y1') / 100], c1: rgb255(p, 'c1R', 'c1G', 'c1B'), p2: [val(p, 'x2') / 100, val(p, 'y2') / 100], c2: rgb255(p, 'c2R', 'c2G', 'c2B'), p3: [val(p, 'x3') / 100, val(p, 'y3') / 100], c3: rgb255(p, 'c3R', 'c3G', 'c3B'), p4: [val(p, 'x4') / 100, val(p, 'y4') / 100], c4: rgb255(p, 'c4R', 'c4G', 'c4B'), blend: val(p, 'blend', 100), opacity: val(p, 'opacity', 100), mode: val(p, 'blendMode') + 2 } }),
  'FX-338': (p) => ({
    type: 'twitch', label: 'Twitch', params: {
      amount: anim(p, 'amount', 60), speed: val(p, 'speed', 40), seed: val(p, 'seed', 1), blur: !!val(p, 'blur'), blurAmt: val(p, 'blurAmount', 50), color: !!val(p, 'colorize'), colorAmt: val(p, 'colorAmount', 50),
      colorize: rgb255(p, 'tintR', 'tintG', 'tintB'), light: !!val(p, 'light'), lightAmt: val(p, 'lightAmount', 50), scale: !!val(p, 'scale'), scaleAmt: val(p, 'scaleAmount', 50),
      slide: !!val(p, 'slide'), slideAmt: val(p, 'slideAmount', 50), slideDir: 4, slideAngle: val(p, 'slideDirection'), slideRgb: val(p, 'rgbSplit', 10), border: (val(p, 'border') | 0) + 1, lightMode: (val(p, 'lightMode') | 0) + 1,
    },
  }),
  'FX-330': (p) => ({
    type: 'shake', label: 'S_Shake', params: {
      sapphire: true, amount: anim(p, 'amplitude', 1, (v) => v * 100), frequency: val(p, 'frequency', 10), ampX: val(p, 'xRandomAmplitude', 100), ampY: val(p, 'yRandomAmplitude', 100),
      rotation: val(p, 'tiltRandomAmplitude'), zoom: val(p, 'zRandomAmplitude') * 100, stillness: val(p, 'stillness') / 100, twitchFreq: val(p, 'twitchFrequency', 2), drift: val(p, 'drift'),
      centerBias: val(p, 'centerBias'), seed: val(p, 'seed', 1), shutter: val(p, 'motionBlur') ? val(p, 'motionBlurLength', 0.5) * 30 : 0, wrap: wrap(val(p, 'wrapX', 2)),
    },
  }),
  'FX-301': (p) => ({ type: 'motionTile', label: 'Motion Tile', params: { outW: val(p, 'outputWidth', 100), outH: val(p, 'outputHeight', 100), mirror: !!val(p, 'mirrorEdges') } }),
  'FX-038': (p) => ({ type: 'dirBlur', label: 'Directional Blur', params: { length: anim(p, 'length'), angle: val(p, 'angle') } }),
  'FX-035': (p) => ({ type: 'blur', label: 'Blur', params: { radius: anim(p, 'amount') } }),
  'FX-339': (p) => ({ type: 'looks', label: 'S_HueSatBright', params: { hue: val(p, 'hue'), saturation: val(p, 'saturation', 100), exposure: Math.log2(Math.max(0.01, val(p, 'brightness', 100) / 100)) } }),
};

/** Converte uma ferramenta/efeito do Frameify. Devolve { effects, unknown }. */
function convert(e, str, out, unknown) {
  if (e.enabled === false) return;
  const p = e.parameters || {};
  const mix = val(p, 'mix', 100);
  if (e.effectId === 'FX-302') { // Looks: as ferramentas herdam o Mix do Looks
    for (const t of e.tools || []) convert(t, (mix * str) / 100, out, unknown);
    return;
  }
  if (e.effectId === 'FX-384') { // Look Table (curva ou LUT embutida)
    const fx = e.table && tableEffect(e.table, (mix * str) / 100);
    if (fx) out.push({ type: fx.type, label: fx.label, params: fx.params });
    return;
  }
  const f = MAP[e.effectId];
  if (!f) { unknown.push(e.effectId); return; }
  const s = (mix * str) / 100;
  const r = f(p, s);
  if (r.looks) {
    // ferramenta reconstruída como Looks cru → mesma conversão (e ferramenta dedicada) da importação de .ffx
    for (const x of looksToolEffect(r.looks, s)) out.push({ type: x.type, label: x.label, params: x.params });
    return;
  }
  out.push(r);
}

/** .frameify (texto JSON) → preset do MotionFrame { name, effects, report }. */
export function frameifyToPreset(text, fileName = 'Frameify') {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  if (j.format !== 'frameify-preset' || !Array.isArray(j.effects)) throw new Error('não é um preset do Frameify');
  const effects = [], unknown = [];
  for (const e of j.effects) convert(e, 100, effects, unknown);
  return {
    name: j.metadata?.name || fileName.replace(/\.frameify$/i, ''),
    category: 'Importado (Frameify)',
    effects,
    report: { source: 'Frameify', effects: effects.length, unknown },
  };
}
