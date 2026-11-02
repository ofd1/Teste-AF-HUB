// Presets: formato próprio (JSON), biblioteca nativa, conversão de .ffx e aplicação em camadas.
//
// Preset = {
//   id, name, category, source: 'builtin'|'ffx'|'user'|'free', anchor: 'playhead'|'end', duration,
//   transform: { position|scale|rotation|opacity: { mode:'abs'|'rel', value?, keys?:[{t,v,ease,inInf?,outInf?}] } },
//   effects: [{ type, label?, matchName?, defs?, params: { key: value | { keys:[...] } } }],
//   report?: {...}   // relatório de importação FFX
// }

import { anim, valueAt, sortKeys } from './anim.js';
import { EFFECT_MAP, getEffectDef } from './effects.js';
import { matchEffect, findParam } from './import-map.js';
import { uid } from './util.js';

export const PRESET_FORMAT = 'motionframe-preset@1';

const k = (t, v, ease = 'easeInOut') => ({ t, v, ease });
// curva "velocity" (influência alta) — a rampa clássica de edits
const kv = (t, v, inf = 0.85) => ({ t, v, ease: 'bezier', outInf: inf, inInf: inf });

export const BUILTIN_PRESETS = [
  // ---- Shakes (motion blur e bordas espelhadas já vêm no próprio Shake, como no S_Shake)
  { name: 'Shake impacto', category: 'Shakes', anchorStart: true, duration: 0.5, effects: [{ type: 'shake', params: { mode: 2, impactAt: 0, decay: 0.45, frequency: 16, amount: 75, rotation: 4, zoom: 7, shutter: 1.5 } }] },
  { name: 'Shake batida forte (impacto)', category: 'Shakes', anchorStart: true, duration: 0.7, effects: [{ type: 'shake', params: { mode: 2, impactAt: 0, decay: 0.7, frequency: 22, amount: 130, rotation: 6, zoom: 12, shutter: 2.2, complexity: 3 } }, { type: 'exposure', params: { exposure: { keys: [k(0, 0.9, 'easeOut'), k(0.25, 0)] } } }] },
  { name: 'Shake cinematográfico (câmera na mão)', category: 'Shakes', effects: [{ type: 'shake', params: { frequency: 1.6, amount: 18, rotation: 0.9, zoom: 1.5, complexity: 4, shutter: 0.6 } }] },
  { name: 'Shake contínuo', category: 'Shakes', effects: [{ type: 'shake', params: { frequency: 9, amount: 22, rotation: 1.5, zoom: 2, shutter: 1 } }] },
  { name: 'Shake suave (câmera na mão)', category: 'Shakes', effects: [{ type: 'shake', params: { frequency: 2.5, amount: 14, rotation: 0.8, zoom: 1, complexity: 3, shutter: 0.5 } }] },
  { name: 'Shake horizontal + RGB', category: 'Shakes', effects: [{ type: 'shake', params: { frequency: 18, amount: { keys: [k(0, 60, 'easeOut'), k(0.35, 0)] }, rotation: 0, axis: 2, shutter: 2 } }, { type: 'rgbSplit', params: { amount: { keys: [k(0, 25, 'easeOut'), k(0.35, 0)] } } }] },
  { name: 'Shake forte com blur (ZAZ)', category: 'Shakes', effects: [{ type: 'shake', params: { frequency: 12, amount: { keys: [k(0, 95, 'easeOut'), k(0.55, 0)] }, rotation: { keys: [k(0, 3.5, 'easeOut'), k(0.55, 0)] }, zoom: { keys: [k(0, 8, 'easeOut'), k(0.55, 0)] }, shutter: 2, samples: 16 } }] },
  { name: 'Twitch impacto', category: 'Shakes', effects: [{ type: 'twitch', params: { amount: 85, speed: 14, slide: true, slideAmt: 40 } }] },
  { name: 'Twitch flash (ftb)', category: 'Shakes', effects: [{ type: 'twitch', params: { amount: 100, speed: 8, blur: true, blurAmt: 40, color: true, colorAmt: 18, light: true, lightAmt: 90, scale: true, scaleAmt: 22 } }] },
  // ---- Inspirados nas 3 edits de referência (ftb, sonhei, ZAZ)
  { name: 'Shatter branco (silhueta)', category: 'Edits (referência)', anchorStart: true, needsLayer: true, duration: 2.2, effects: [{ type: 'shatter', params: { start: 0.4, fill: true, fillColor: [1, 1, 1, 1], pattern: 1, repetitions: 34, radius: 1.1, strength: 6, randomness: 0.5, zPush: 1.1, gravity: 0.6, spin: 0.6, life: 1.6, shutter: 1.5 } }, { type: 'deepGlow', params: { radius: 90, exposure: 0.5, threshold: 70 } }] },
  { name: 'Shatter explosão (ZAZ)', category: 'Edits (referência)', anchorStart: true, duration: 1.6, effects: [{ type: 'shatter', params: { start: 0, render: 3, keepOriginal: true, fill: true, fillColor: [0.92, 0.96, 1, 1], opacity: 70, pattern: 1, repetitions: 30, radius: 0.75, strength: 9, randomness: 0.7, zPush: 1.8, gravity: 0.4, spin: 0.9, life: 0.9, shutter: 2.5, samples: 10 } }, { type: 'blurMoCurves', params: { zDist: { keys: [kv(0, 0.82), kv(0.35, 1)] }, shutter: 1.5 } }] },
  { name: 'Zoom shake transição (sonhei)', category: 'Edits (referência)', effects: [{ type: 'blurMoCurves', params: { zDist: { keys: [kv(0, 1), kv(0.16, 0.62), kv(0.4, 1)] }, rotate: { keys: [kv(0, 0), kv(0.16, 6), kv(0.4, 0)] }, shutter: 1.5, samples: 24 } }, { type: 'shake', params: { frequency: 14, amount: { keys: [k(0.1, 60, 'easeOut'), k(0.5, 0)] }, rotation: 2, shutter: 1.5 } }, { type: 'exposure', params: { exposure: { keys: [k(0.12, 0.8, 'easeOut'), k(0.35, 0)] } } }] },
  { name: 'Time slice (faixas)', category: 'Edits (referência)', effects: [{ type: 'timeSlice', params: { slices: 16, delay: { keys: [k(0, 0), k(0.2, 3), k(0.6, 0)] }, stretch: { keys: [k(0, 0), k(0.2, 40), k(0.6, 0)] }, order: 2 } }] },
  { name: 'Time slice esticado (sonhei)', category: 'Edits (referência)', effects: [{ type: 'timeSlice', params: { slices: 24, delay: 2, stretch: 80, offset: 30, order: 3, levels: 10 } }, { type: 'dirBlur', params: { length: 25, angle: 0 } }] },
  { name: 'CC escuro azul (ftb)', category: 'Edits (referência)', effects: [{ type: 'looks', params: { exposure: -0.35, contrast: 28, saturation: 85, mojo: 40, mojoCool: 70, temperature: -10, fade: 6, vignette: 45, edgeBlur: 3, edgeSize: 120, diffusion: 25, diffusionThreshold: 70 } }, { type: 'sharpen', params: { amount: 60, radius: 1.5 } }] },
  { name: 'CC vivo (sonhei)', category: 'Edits (referência)', effects: [{ type: 'looks', params: { contrast: 32, saturation: 128, punch: 28, diffusion: 45, diffusionRadius: 80, diffusionThreshold: 65, edgeBlur: 2, vignette: 20 } }, { type: 'sharpen', params: { amount: 90, radius: 1.2 } }] },
  { name: 'CC noturno (ZAZ)', category: 'Edits (referência)', effects: [{ type: 'looks', params: { exposure: -0.15, temperature: -15, contrast: 38, saturation: 112, mojo: 55, punch: 15, vignette: 55, vignetteSize: 45, diffusion: 30, edgeBlur: 4, edgeSize: 110 } }, { type: 'sharpen', params: { amount: 80, radius: 1.3 } }] },
  { name: 'Flash branco + blur (ftb)', category: 'Edits (referência)', effects: [{ type: 'exposure', params: { exposure: { keys: [k(0, 3, 'easeOut'), k(0.3, 0)] } } }, { type: 'blur', params: { radius: { keys: [k(0, 60, 'easeOut'), k(0.3, 0)] } } }] },
  { name: 'Velocity + motion blur (Twixtor)', category: 'Edits (referência)', effects: [{ type: 'twixtor', params: { speed: { keys: [kv(0, 280), kv(0.45, 20), kv(1.2, 20), kv(1.6, 280)] }, motionBlur: 120 } }] },
  // ---- Transições
  { name: 'Zoom punch (in)', category: 'Transições', transform: { scale: { mode: 'abs', keys: [kv(0, [100, 100]), kv(0.35, [165, 165])] } }, effects: [{ type: 'radialBlur', params: { amount: { keys: [k(0, 0, 'easeIn'), k(0.25, 45, 'easeOut'), k(0.35, 0)] } } }, { type: 'motionBlur', params: { amount: 150 } }] },
  { name: 'Zoom out (entrada)', category: 'Transições', transform: { scale: { mode: 'abs', keys: [kv(0, [180, 180]), kv(0.4, [100, 100])] } }, effects: [{ type: 'radialBlur', params: { amount: { keys: [k(0, 50, 'easeOut'), k(0.4, 0)] } } }, { type: 'motionTile', params: { outW: 200, outH: 200 } }] },
  { name: 'Whip pan (esquerda)', category: 'Transições', transform: { position: { mode: 'rel', keys: [kv(0, [1400, 0], 0.9), kv(0.35, [0, 0], 0.9)] } }, effects: [{ type: 'motionBlur', params: { amount: 250, samples: 16 } }, { type: 'motionTile', params: { outW: 300, outH: 100 } }] },
  { name: 'Giro 360 (spin)', category: 'Transições', transform: { rotation: { mode: 'rel', keys: [kv(0, -360), kv(0.5, 0)] }, scale: { mode: 'abs', keys: [kv(0, [150, 150]), kv(0.5, [100, 100])] } }, effects: [{ type: 'motionBlur', params: { amount: 200, samples: 20 } }, { type: 'motionTile', params: { outW: 250, outH: 250 } }] },
  { name: 'Flash branco', category: 'Transições', effects: [{ type: 'exposure', params: { exposure: { keys: [k(0, 3.5, 'easeOut'), k(0.35, 0)] } } }] },
  { name: 'Flash + glow', category: 'Transições', effects: [{ type: 'exposure', params: { exposure: { keys: [k(0, 2, 'easeOut'), k(0.3, 0)] } } }, { type: 'deepGlow', params: { radius: 200, exposure: { keys: [k(0, 3, 'easeOut'), k(0.4, 0.3)] } } }] },
  { name: 'Glitch transição', category: 'Transições', effects: [{ type: 'glitch', params: { amount: { keys: [k(0, 80, 'hold'), k(0.1, 40, 'hold'), k(0.2, 90, 'hold'), k(0.3, 0)] }, rgb: 14 } }, { type: 'rgbSplit', params: { amount: { keys: [k(0, 20, 'easeOut'), k(0.3, 0)] } } }] },
  { name: 'Blur in', category: 'Transições', transform: { opacity: { mode: 'abs', keys: [k(0, 0, 'easeOut'), k(0.4, 100)] } }, effects: [{ type: 'blur', params: { radius: { keys: [k(0, 80, 'easeOut'), k(0.5, 0)] } } }] },
  { name: 'Wipe linear', category: 'Transições', effects: [{ type: 'linearWipe', params: { completion: { keys: [kv(0, 100), kv(0.5, 0)] }, feather: 120 } }] },
  { name: 'Dissolver em blocos', category: 'Transições', effects: [{ type: 'blockDissolve', params: { completion: { keys: [k(0, 100, 'linear'), k(0.5, 0)] }, block: 40 } }] },
  // ---- Velocity
  { name: 'Velocity rampa (rápido-lento-rápido)', category: 'Velocity', effects: [{ type: 'twixtor', params: { speed: { keys: [kv(0, 250), kv(0.6, 15), kv(1.4, 15), kv(2, 250)] } } }] },
  { name: 'Slow motion 30%', category: 'Velocity', effects: [{ type: 'twixtor', params: { speed: 30 } }] },
  { name: 'Speed up → slow (impacto)', category: 'Velocity', effects: [{ type: 'twixtor', params: { speed: { keys: [kv(0, 300), kv(0.5, 10)] } } }] },
  { name: 'Stutter 8 fps', category: 'Velocity', effects: [{ type: 'posterizeTime', params: { fps: 8 } }] },
  { name: 'Echo rastro', category: 'Velocity', effects: [{ type: 'echo', params: { time: -0.05, count: 6, decay: 0.65 } }] },
  // ---- Glows
  { name: 'Deep Glow jogador', category: 'Glows', effects: [{ type: 'deepGlow', params: { radius: 160, exposure: 1.1, threshold: 45 } }] },
  { name: 'Deep Glow quente', category: 'Glows', effects: [{ type: 'deepGlow', params: { radius: 260, exposure: 1.4, threshold: 35, useTint: true, tint: [1, 0.55, 0.15, 1] } }] },
  { name: 'Glow neon azul', category: 'Glows', effects: [{ type: 'glow', params: { threshold: 20, radius: 40, intensity: 2, useColor: true, color: [0.2, 0.8, 1, 1] } }, { type: 'deepGlow', params: { radius: 120, exposure: 0.6, useTint: true, tint: [0.2, 0.5, 1, 1] } }] },
  { name: 'Glow pulsante', category: 'Glows', effects: [{ type: 'deepGlow', params: { radius: 150, exposure: { keys: [k(0, 0.4), k(0.5, 2.2), k(1, 0.4)] } } }] },
  { name: 'Raios de luz', category: 'Glows', effects: [{ type: 'lightRays', params: { intensity: 2.5, length: 45, threshold: 40 } }] },
  { name: 'Lens flare', category: 'Glows', effects: [{ type: 'lensFlare', params: { position: [0.2, 0.2], brightness: 110 } }] },
  // ---- CC (correção de cor)
  { name: 'CC frio (noturno)', category: 'CC / Cor', effects: [{ type: 'colorGrade', params: { temperature: -35, tint: 5, contrast: 25, shadows: -20, saturation: -10, vibrance: 20 } }] },
  { name: 'CC quente (dourado)', category: 'CC / Cor', effects: [{ type: 'colorGrade', params: { temperature: 40, contrast: 20, highlights: 15, saturation: 10 } }] },
  { name: 'CC contraste alto', category: 'CC / Cor', effects: [{ type: 'colorGrade', params: { contrast: 55, blacks: 20, whites: 15, vibrance: 30 } }] },
  { name: 'P&B dramático', category: 'CC / Cor', effects: [{ type: 'blackWhite', params: {} }, { type: 'colorGrade', params: { contrast: 60, blacks: 25 } }, { type: 'vignette', params: { amount: 70 } }] },
  { name: 'Teal & Orange', category: 'CC / Cor', effects: [{ type: 'tint', params: { black: [0.05, 0.25, 0.32, 1], white: [1, 0.78, 0.55, 1], amount: 35 } }, { type: 'colorGrade', params: { contrast: 25, saturation: 15 } }] },
  // ---- Looks
  { name: 'VHS', category: 'Looks', effects: [{ type: 'vhs', params: {} }, { type: 'noise', params: { amount: 10 } }] },
  { name: 'Film vintage', category: 'Looks', effects: [{ type: 'filmLook', params: {} }] },
  { name: 'Light leaks', category: 'Looks', effects: [{ type: 'lightLeak', params: { intensity: 0.9, speed: 0.6 } }] },
  { name: 'Prisma RGB', category: 'Looks', effects: [{ type: 'prism', params: { mode: 2, amount: 25 } }] },
  { name: 'Pixelar', category: 'Looks', effects: [{ type: 'mosaic', params: { hBlocks: { keys: [k(0, 4, 'easeIn'), k(0.8, 160)] }, vBlocks: { keys: [k(0, 4, 'easeIn'), k(0.8, 160)] } } }] },
  // ---- Texto / entradas e saídas
  { name: 'Fade In', category: 'Entradas', transform: { opacity: { mode: 'abs', keys: [k(0, 0, 'easeOut'), k(0.5, 100)] } } },
  { name: 'Subir (Slide Up)', category: 'Entradas', transform: { position: { mode: 'rel', keys: [k(0, [0, 220], 'back'), k(0.7, [0, 0])] }, opacity: { mode: 'abs', keys: [k(0, 0, 'linear'), k(0.3, 100)] } } },
  { name: 'Pop', category: 'Entradas', transform: { scale: { mode: 'abs', keys: [k(0, [0, 0], 'back'), k(0.45, [100, 100])] }, opacity: { mode: 'abs', keys: [k(0, 0, 'linear'), k(0.15, 100)] } } },
  { name: 'Zoom In', category: 'Entradas', transform: { scale: { mode: 'abs', keys: [k(0, [300, 300], 'easeOut'), k(0.6, [100, 100])] }, opacity: { mode: 'abs', keys: [k(0, 0, 'linear'), k(0.3, 100)] } } },
  { name: 'Quicar', category: 'Entradas', transform: { position: { mode: 'rel', keys: [k(0, [0, -700], 'bounce'), k(1, [0, 0])] } } },
  { name: 'Pulsar', category: 'Entradas', transform: { scale: { mode: 'abs', keys: [k(0, [100, 100]), k(0.25, [115, 115]), k(0.5, [100, 100]), k(0.75, [115, 115]), k(1, [100, 100])] } } },
  { name: 'Fade Out', category: 'Saídas', anchor: 'end', transform: { opacity: { mode: 'abs', keys: [k(0, 100, 'easeIn'), k(0.5, 0)] } } },
  { name: 'Encolher', category: 'Saídas', anchor: 'end', transform: { scale: { mode: 'abs', keys: [k(0, [100, 100], 'easeIn'), k(0.4, [0, 0])] } } },
].map((p, i) => ({ id: `builtin_${i}`, source: 'builtin', anchor: 'playhead', ...p, duration: p.duration ?? presetDuration(p) }));

function keysOf(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.keys) ? v.keys : [];
}

export function presetDuration(p) {
  let d = 0;
  for (const tr of Object.values(p.transform || {})) for (const kk of keysOf(tr)) d = Math.max(d, kk.t);
  for (const fx of p.effects || []) for (const v of Object.values(fx.params || {})) for (const kk of keysOf(v)) d = Math.max(d, kk.t);
  return d;
}

// ------------------------------------------------------------------ FFX → preset

const TRANSFORM_MAP = {
  'ADBE Position': { prop: 'position', mode: 'rel' },
  'ADBE Position_0': { prop: 'position', mode: 'rel', dim: 0 },
  'ADBE Position_1': { prop: 'position', mode: 'rel', dim: 1 },
  'ADBE Scale': { prop: 'scale', mode: 'abs' },
  'ADBE Rotate Z': { prop: 'rotation', mode: 'abs' },
  'ADBE Rotate Z Plus': { prop: 'rotation', mode: 'abs' },
  'ADBE Opacity': { prop: 'opacity', mode: 'abs' },
};

export function ffxEase(kf, next) {
  if (kf.interp === 3) return { ease: 'hold' };
  if (kf.interp === 2) {
    const e = { ease: 'bezier', outInf: kf.outInf, inInf: kf.inInf };
    // Velocidades das alças do AE → altura das alças normalizada (0 = valor inicial, 1 = final).
    // É isso que faz o gráfico "passar do ponto e voltar" (ex.: Shift Y que vai para um lado e chicoteia para o outro).
    if (next && kf.v?.length === 1 && next.v?.length === 1 && Number.isFinite(kf.outSpeed) && Number.isFinite(next.inSpeed)) {
      const dv = next.v[0] - kf.v[0], dt = next.t - kf.t;
      if (Math.abs(dv) > 1e-9 && dt > 0) {
        const y1 = (kf.outSpeed * (kf.outInf ?? 0.333) * dt) / dv, y2 = 1 - (next.inSpeed * (next.inInf ?? 0.333) * dt) / dv;
        const lim = (y) => Math.max(-8, Math.min(9, y));
        if (Math.abs(y1) > 1e-4 || Math.abs(y2 - 1) > 1e-4) e.bz = [lim(y1), lim(y2)];
      }
    }
    return e;
  }
  return { ease: 'linear' };
}

function convertValue(raw, kind, conv) {
  if (!raw || !raw.length) return undefined;
  let v;
  switch (kind) {
    case 'color': {
      const [a, r, g, b] = raw.length >= 4 ? raw : [1, raw[0], raw[1], raw[2]];
      const s = Math.max(a, r, g, b) > 1 ? 255 : 1;
      v = [r / s, g / s, b / s, 1];
      break;
    }
    case 'bool': v = raw[0] >= 0.5; break;
    case 'point': v = [raw[0] || 0, raw[1] || 0]; break;
    case 'pos': // o AE guarda pontos como fração da camada (0..1); valores fora disso não são confiáveis
      if (raw.length < 2 || Math.abs(raw[0]) > 3 || Math.abs(raw[1]) > 3) return undefined;
      v = [raw[0], raw[1]];
      break;
    case 'select': v = Math.max(1, Math.round(raw[0])); break;
    default: v = raw[0];
  }
  if (conv) v = conv(kind === 'bool' ? raw[0] : v);
  if (kind === 'bool') v = !!v && v !== 0;
  return v;
}

function convertProp(src, kind, conv) {
  if (src.keyframes?.length) {
    const keys = src.keyframes.map((kf, i, a) => ({ t: kf.t, v: convertValue(kf.v, kind, conv), ...ffxEase(kf, a[i + 1]) })).filter((x) => x.v !== undefined);
    return keys.length ? { keys } : undefined;
  }
  return convertValue(src.value, kind, conv);
}

const kindFromFfx = (t) => ({ color: 'color', angle: 'angle', checkbox: 'bool', point: 'point', point3d: 'point', popup: 'select' }[t] || 'number');

/**
 * Preset do Magic Bullet Looks salvo como .rgx (JSON do Looks 4/5): lista de ferramentas com os parâmetros na mesma
 * ordem dos dados do .ffx/.aep → vira o mesmo efeito Looks. Ferramentas desligadas (isBypassed) são ignoradas.
 */
export function rgxToParsed(json, fileName = 'Look') {
  const blocks = json?.content?.blocks || [];
  const head = blocks.find((b) => /preset\.header$/.test(b.block_type_id))?.values || {};
  const tc = blocks.find((b) => /toolchain$/.test(b.block_type_id))?.values || {};
  let chain = tc.tools;
  // preset do Colorista V (param_streams): vira a ferramenta Colorista do Looks (mesmas rodas, HSL e curvas de saturação)
  if (!Array.isArray(chain) && Array.isArray(tc.param_streams)) {
    const g = (n) => tc.param_streams.find((q) => q.name === n)?.value;
    const fl = (n, len) => { const f = g(n)?.floats || []; return Array.from({ length: len }, (_, i) => f[i] ?? 0); };
    const v = new Array(228).fill(0);
    const tw = g('three-way')?.floats || [1, 1, 1, 1, 1, 1, 1, 1, 1];
    v[1] = g('strength') ?? 100; v[2] = g('exposure') || 0;
    for (let i = 0; i < 9; i++) v[3 + i] = tw[i] ?? 1;
    v[12] = 100 + (g('saturation') || 0);
    fl('hsl', 24).forEach((x, i) => { v[13 + i] = x; });
    fl('saturation-eq', 14).forEach((x, i) => { v[202 + i] = x; });
    v[216] = g('temperature') || 0; v[217] = g('tint') || 0; v[218] = (g('contrast') || 0) / 100;
    chain = [{ toolId: 'csta', parameters: v.map((value) => ({ value })) }];
    if (g('pop')) chain.push({ toolId: 'popt', parameters: [{ value: g('pop') }, { value: 100 }] });
    if (g('vignette')) chain.push({ toolId: 'lenv', parameters: [{ value: 50 }, { value: g('vignette') }] });
  }
  if (!Array.isArray(chain)) throw new Error('arquivo .rgx sem a lista de ferramentas do Looks');
  const tools = chain.map((t) => ({ id: t.toolId, enabled: !t.isBypassed, category: t.category, values: (t.parameters || []).map((q) => (Number.isFinite(q.value) ? q.value : 0)) }));
  // Colorista no .rgx tem um parâmetro a menos no início do que no .ffx (força fica no índice 1 nos dois): mantém como está
  const name = json?.naming?.name || fileName.replace(/\.rgx$/i, '');
  return {
    format: 'Magic Bullet Looks (.rgx)', name, warnings: [], matchNames: ['MB Looks'], properties: [],
    effects: [{ matchName: 'MB Looks', name, looksTools: tools, params: [{ name: 'Strength', type: 'number', value: [(head.strength ?? 1) * 100], keyframes: [] }] }],
  };
}

export function ffxToPreset(parsed) {
  const preset = {
    id: uid('ffx'), name: parsed.name || 'Preset FFX', category: 'Importado (FFX)', source: 'ffx', anchor: 'playhead',
    transform: {}, effects: [],
    report: { format: parsed.format, effects: [], properties: [], warnings: parsed.warnings.slice(), matchNames: parsed.matchNames },
  };

  for (const fx of parsed.effects) {
    const m = matchEffect(fx.matchName, fx.name);
    const rep = {
      matchName: fx.matchName, name: fx.name || fx.matchName, status: 'unsupported', mapped: [],
      params: fx.params.map((p) => ({ name: p.name, type: p.type, value: p.value, keys: p.keyframes.length })),
    };
    const raw = (name) => fx.params.find((p) => (p.name || '').toLowerCase().trim() === name)?.value?.[0] ?? null;
    if (m && m.rule.expand) {
      // regra que gera um ou mais efeitos a partir do efeito original (ex.: Magic Bullet Looks)
      const list = m.rule.expand(fx, raw);
      for (const e of list) preset.effects.push({ type: e.type, label: e.label, matchName: fx.matchName, params: e.params });
      rep.status = m.kind;
      rep.vendor = m.rule.vendor;
      rep.plugin = m.rule.plugin;
      rep.mappedTo = list.map((e) => getEffectDef(e.type).label).join(' + ');
      rep.mapped = list.map((e) => e.note).filter(Boolean);
      if (!rep.mapped.length) rep.mapped = ['valores convertidos'];
    } else if (m) {
      const { def, rule } = m;
      const inst = { type: def.type, label: fx.name && fx.name !== fx.matchName ? fx.name : undefined, matchName: fx.matchName, params: {} };
      const used = new Set();
      for (const pd of def.params) {
        const mapping = rule.map?.[pd.key];
        const src = findParam(fx.params.filter((p) => !used.has(p)), mapping, mapping ? [] : [pd.label, pd.key]);
        if (!src) continue;
        const v = convertProp(src, pd.kind, mapping?.conv);
        if (v === undefined) continue;
        used.add(src);
        inst.params[pd.key] = v;
        rep.mapped.push(`${src.name || src.matchName} → ${pd.label}${src.keyframes.length ? ` (${src.keyframes.length} keyframes)` : ''}`);
      }
      Object.assign(inst.params, rule.set || {});
      if (rule.post) rule.post(inst.params, raw, fx);
      if (def.type === 'glow' && inst.params.color !== undefined) inst.params.useColor = true;
      if (def.type === 'deepGlow' && inst.params.tint !== undefined && inst.params.useTint === undefined) inst.params.useTint = true;
      rep.status = m.kind;
      rep.vendor = rule.vendor;
      rep.plugin = rule.plugin;
      rep.mappedTo = def.label;
      preset.effects.push(inst);
      for (const e of rule.extra?.(raw) || []) {
        preset.effects.push({ type: e.type, matchName: fx.matchName, params: e.params });
        rep.mappedTo += ` + ${getEffectDef(e.type).label}`;
      }
    } else {
      const defs = [];
      const params = {};
      fx.params.forEach((p, i) => {
        const key = `p${p.index >= 0 ? p.index : i}`;
        const kind = kindFromFfx(p.type);
        const d = { key, label: p.name || p.matchName, kind, default: kind === 'color' ? [1, 1, 1, 1] : kind === 'bool' ? false : kind === 'point' ? [0, 0] : kind === 'select' ? 1 : 0 };
        if (kind === 'select') d.options = p.options || ['1', '2', '3', '4', '5'];
        if (p.min !== undefined && Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min) { d.min = p.min; d.max = p.max; }
        defs.push(d);
        const v = convertProp(p, d.kind);
        if (v !== undefined) params[key] = v;
      });
      preset.effects.push({ type: 'generic', label: fx.name || fx.matchName, matchName: fx.matchName, defs, params });
    }
    preset.report.effects.push(rep);
  }

  const posDims = {};
  for (const p of parsed.properties) {
    if (p.matchName === 'ADBE Time Remapping') {
      // Time Remap do AE (propriedade da camada) → efeito Time Remap com os mesmos keyframes
      const v = convertProp(p, 'number');
      if (v !== undefined) {
        preset.effects.unshift({ type: 'timeRemap', matchName: p.matchName, params: { time: v, frameBlend: true } });
        preset.report.properties.push({ matchName: p.matchName, name: p.name || 'Time Remap', keys: p.keyframes.length, status: 'native' });
      }
      continue;
    }
    const map = TRANSFORM_MAP[p.matchName];
    const rep = { matchName: p.matchName, name: p.name || p.matchName, keys: p.keyframes.length, status: map ? 'native' : 'unsupported' };
    preset.report.properties.push(rep);
    if (!map) continue;
    if (map.dim !== undefined) { posDims[map.dim] = p; continue; }
    preset.transform[map.prop] = transformFromFfx(map, p);
  }
  if (posDims[0] || posDims[1]) preset.transform.position = mergeSeparated(posDims[0], posDims[1]);

  const plugins = preset.report.effects.filter((e) => e.status === 'plugin').map((e) => e.plugin);
  if (plugins.length) preset.report.plugins = [...new Set(plugins)];
  preset.duration = presetDuration(preset);
  return preset;
}

function transformFromFfx(map, p) {
  const fix = (v) => {
    if (map.prop === 'position') return [v[0] || 0, v[1] || 0];
    if (map.prop === 'scale') return [v[0] ?? 100, v[1] ?? v[0] ?? 100];
    return v[0];
  };
  if (p.keyframes.length) {
    let keys = p.keyframes.map((kf, i, a) => ({ t: kf.t, v: fix(kf.v), ...ffxEase(kf, a[i + 1]) }));
    if (map.mode === 'rel') {
      const base = keys[keys.length - 1].v;
      keys = keys.map((kk) => ({ ...kk, v: kk.v.map((x, i) => x - base[i]) }));
    }
    return { mode: map.mode, keys };
  }
  if (map.mode === 'rel') return { mode: 'rel', value: [0, 0] };
  return { mode: 'abs', value: fix(p.value) };
}

function mergeSeparated(px, py) {
  const toProp = (p) => {
    if (!p) return { value: 0, keys: [] };
    if (!p.keyframes.length) return { value: p.value[0] || 0, keys: [] };
    const last = p.keyframes[p.keyframes.length - 1].v[0];
    return { value: 0, keys: p.keyframes.map((kf) => ({ t: kf.t, v: kf.v[0] - last, ...ffxEase(kf, p.keyframes[p.keyframes.indexOf(kf) + 1]) })) };
  };
  const ax = toProp(px), ay = toProp(py);
  const times = [...new Set([...ax.keys, ...ay.keys].map((x) => x.t))].sort((a, b) => a - b);
  if (!times.length) return { mode: 'rel', value: [0, 0] };
  return {
    mode: 'rel',
    keys: times.map((t) => {
      const src = ax.keys.find((x) => x.t === t) || ay.keys.find((x) => x.t === t);
      return { t, v: [ax.keys.length ? valueAt(ax, t) : 0, ay.keys.length ? valueAt(ay, t) : 0], ease: src.ease, inInf: src.inInf, outInf: src.outInf };
    }),
  };
}

// ------------------------------------------------------------------ aplicar preset

function toAnimProp(v, t0, fallback) {
  if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.keys)) {
    const keys = v.keys.map((kk) => ({ ...kk, t: +(t0 + kk.t).toFixed(4) }));
    return anim(keys[0]?.v ?? fallback, keys);
  }
  return anim(v === undefined ? fallback : v);
}

export function createEffectInstance(type, params = {}, t0 = 0, extra = {}) {
  const def = type === 'generic' ? { params: extra.defs || [] } : getEffectDef(type);
  const inst = { id: uid('fx'), type, enabled: true, params: {}, ...extra };
  for (const pd of def.params) inst.params[pd.key] = toAnimProp(params[pd.key], t0, pd.default);
  return inst;
}

/** Reescala os tempos dos keyframes de um preset (k = nova duração / duração original). */
export function stretchPreset(preset, k) {
  const sk = (v) => (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.keys) ? { ...v, keys: v.keys.map((kk) => ({ ...kk, t: kk.t * k })) } : v);
  return {
    ...preset,
    duration: (preset.duration || presetDuration(preset)) * k,
    transform: Object.fromEntries(Object.entries(preset.transform || {}).map(([n, tr]) => [n, sk(tr)])),
    effects: (preset.effects || []).map((fx) => ({ ...fx, params: Object.fromEntries(Object.entries(fx.params || {}).map(([n, v]) => [n, sk(v)])) })),
  };
}

/**
 * Aplica o preset. opts.fit = true: sincroniza os keyframes com a duração da camada
 * (o preset começa no início da camada e termina no fim dela).
 */
export function applyPreset(layer, preset, playhead, opts = {}) {
  const d0 = preset.duration || presetDuration(preset);
  if (opts.fit && d0 > 0.01) {
    preset = { ...stretchPreset(preset, (layer.outPoint - layer.inPoint) / d0), anchor: 'playhead' };
    playhead = layer.inPoint;
  }
  const dur = preset.duration || presetDuration(preset);
  const t0 = preset.anchor === 'end' ? Math.max(layer.inPoint, layer.outPoint - dur) : playhead;

  for (const [prop, tr] of Object.entries(preset.transform || {})) {
    const target = layer.transform[prop];
    if (!target) continue;
    const base = valueAt(target, t0);
    if (tr.keys?.length) {
      const span = [t0 - 1e-4, t0 + dur + 1e-4];
      target.keys = target.keys.filter((kk) => kk.t < span[0] || kk.t > span[1]);
      for (const kk of tr.keys) {
        let v = kk.v;
        if (tr.mode === 'rel') v = Array.isArray(v) ? v.map((x, i) => x + base[i]) : v + base;
        target.keys.push({ t: +(t0 + kk.t).toFixed(4), v: Array.isArray(v) ? v.slice() : v, ease: kk.ease || 'linear', inInf: kk.inInf, outInf: kk.outInf, ...(kk.bz ? { bz: kk.bz.slice() } : {}) });
      }
      sortKeys(target);
    } else if (tr.value !== undefined && tr.mode === 'abs') {
      if (target.keys.length) target.keys = [];
      target.value = Array.isArray(tr.value) ? tr.value.slice() : tr.value;
    }
  }

  for (const fx of preset.effects || []) {
    if (fx.type !== 'generic' && !EFFECT_MAP[fx.type]) continue;
    const ak = getEffectDef(fx.type).anchorParam;
    const params = preset.anchorStart && ak && fx.params && ak in fx.params ? { ...fx.params, [ak]: +(t0 - layer.inPoint + fx.params[ak]).toFixed(4) } : fx.params;
    layer.effects.push(createEffectInstance(fx.type, params, t0, {
      ...(fx.label ? { label: fx.label } : {}),
      ...(fx.matchName ? { matchName: fx.matchName } : {}),
      ...(fx.defs ? { defs: fx.defs } : {}),
    }));
  }
  return t0;
}

/** Converte a animação/efeitos de uma camada em preset reutilizável. */
export function layerToPreset(layer, name) {
  let t0 = Infinity;
  const scan = (p) => p.keys.forEach((kk) => { t0 = Math.min(t0, kk.t); });
  Object.values(layer.transform).forEach(scan);
  layer.effects.forEach((fx) => Object.values(fx.params).forEach(scan));
  if (!Number.isFinite(t0)) t0 = 0;

  const rel = (keys) => keys.map((kk) => ({ ...kk, t: +(kk.t - t0).toFixed(4) }));
  const transform = {};
  for (const [prop, p] of Object.entries(layer.transform)) {
    if (!p.keys.length || prop === 'anchor') continue;
    if (prop === 'position') {
      const last = p.keys[p.keys.length - 1].v;
      transform.position = { mode: 'rel', keys: rel(p.keys).map((kk) => ({ ...kk, v: kk.v.map((x, i) => x - last[i]) })) };
    } else transform[prop] = { mode: 'abs', keys: rel(p.keys) };
  }
  const effects = layer.effects.map((fx) => ({
    type: fx.type,
    ...(fx.label ? { label: fx.label } : {}),
    ...(fx.matchName ? { matchName: fx.matchName } : {}),
    ...(fx.defs ? { defs: fx.defs } : {}),
    params: Object.fromEntries(Object.entries(fx.params).map(([key, p]) => [key, p.keys.length ? { keys: rel(p.keys) } : p.value])),
  }));
  const preset = { id: uid('user'), name, category: 'Meus presets', source: 'user', anchor: 'playhead', transform, effects };
  preset.duration = presetDuration(preset);
  return preset;
}

export function serializePreset(p) {
  const clean = { ...p };
  delete clean._parsed;
  return JSON.stringify({ format: PRESET_FORMAT, preset: clean }, null, 2);
}

export function parsePresetJSON(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.presets || [data.preset || data];
  return list.map((p) => {
    if (!p || typeof p !== 'object' || !p.name) throw new Error('JSON não é um preset válido');
    return { ...p, id: uid('user'), source: p.source === 'ffx' ? 'ffx' : 'user', category: p.category || 'Meus presets', duration: presetDuration(p) };
  });
}
