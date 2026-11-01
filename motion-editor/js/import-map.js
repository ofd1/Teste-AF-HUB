// Identificação de efeitos do After Effects (nativos e plugins de terceiros) e conversão para os
// efeitos do app. Cada regra:
//   { vendor, plugin, to, match?: [matchNames exatos], test?: RegExp (matchName + nome), map?: { chave: { i, n, conv } },
//     set?: { chave: valor } (valores fixos), post?: (params, raw) => void }
// map.i = índice do parâmetro (sufixo -000N), map.n = nomes (minúsculos) — nomes têm prioridade.
// Quando um parâmetro não está no map, tenta-se casar pelo rótulo do parâmetro do app.

import { EFFECT_MAP } from './effects.js';

const pct = (v) => (Math.abs(v) <= 1 ? v * 100 : v);
const to255 = (v) => (v <= 1 ? v * 255 : v);

const ADOBE = 'Adobe (nativo)';

// Índices do popup "Blending Mode" do AE (com separadores "(-") → modos do efeito Gradiente de 4 cores
const AE_BLEND = { 1: 1, 2: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 11: 9, 12: 10, 14: 11, 15: 12, 16: 13, 17: 14 };

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Converte as ferramentas do Magic Bullet Looks (decodificadas do .ffx) para o efeito "Looks" do app.
 * Os valores vêm do arquivo; a correspondência ferramenta → parâmetro é uma aproximação.
 */
export function looksFromTools(tools, strength = 100) {
  const p = {
    strength, exposure: 0, temperature: 0, tint: 0, filter: [1, 1, 1, 1], filterDensity: 0,
    liftR: 0, liftG: 0, liftB: 0, gammaR: 1, gammaG: 1, gammaB: 1, gainR: 1, gainG: 1, gainB: 1,
    hue: 0, saturation: 100, contrast: 0, mojo: 0, mojoCool: 50, mojoSkin: 50, punch: 0, bleach: 0, fade: 0,
    vignette: 0, vignetteSize: 50, diffusion: 0, diffusionRadius: 60, diffusionThreshold: 60, chroma: 0,
    spotExposure: 0, spotColor: [1, 1, 1, 1], spotCenter: [0.5, 0.5], spotSize: 50, spotSoft: 50, spotAspect: 1, spotInvert: false,
    optDensity: 0, optSize: 50, optHighlights: 50, optGlow: 0, edgeCenter: [0.5, 0.5], edgeAspect: 1,
    gradExposure: 0, gradAngle: 0, gradOffset: 0, gradSoft: 0.5, gradColor: [1, 1, 1, 1],
    edgeBlur: 0, edgeSize: 100, edgeSoft: 50,
    anamSize: 0, anamBoost: 1, anamThreshold: 70, hazeExposure: -99, hazeSoftness: 60, hazeSpill: 50, lensDistort: 0, lensFlatten: 0,
  };
  const HSL = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
  for (const k of HSL) { p[`hsl${k}H`] = 0; p[`hsl${k}S`] = 0; p[`hsl${k}L`] = 0; }
  let curve = [];
  const used = [], ignored = [];
  for (const t of tools) {
    const v = t.values;
    if (!t.enabled) { ignored.push(`${t.id} (desligada)`); continue; }
    switch (t.id) {
      case 'expo': p.exposure += v[0] || 0; break;
      case 'fltr':
        if (Math.min(v[0], v[1], v[2]) < 0.995) { p.filter = [v[0], v[1], v[2], 1]; p.filterDensity = 100; } else { ignored.push('fltr (neutro)'); continue; }
        break;
      case 'vign': p.vignette = Math.max(p.vignette, (v[5] || 0) * 0.8); p.vignetteSize = clampN(60 - ((v[2] || 1) - 1) * 50, 15, 85); break;
      case 'lenv': p.vignette = Math.max(p.vignette, (v[0] || 0) * 0.6); break;
      // Optical Diffusion (manual do Looks): Density, Size, Falloff, Glow, Highlights Only, Luster, Color…
      case 'odif': p.optDensity = clampN(Math.max(p.optDensity, v[0] || 0), 0, 100); p.optSize = clampN(v[1] ?? 50, 1, 500); p.optGlow += v[3] || 0; p.optHighlights = clampN(v[4] ?? 50, 0, 100); break;
      case 'diff':
        if (v[0] <= 1) { p.diffusion += v[0] * 75; p.diffusionRadius = Math.max(p.diffusionRadius, (v[1] || 5) * 12); } else { p.diffusion += (v[3] || 50) * 0.2; p.diffusionRadius = Math.max(p.diffusionRadius, v[0] * 0.4); }
        break;
      case 'chab': p.chroma += Math.abs(v[0] || 0) * 4; break;
      case 'husa': p.hue += v[0] || 0; p.saturation *= (v[1] ?? 100) / 100; break;
      case 'mjo2':
        // Mojo II: [Mojo, tuning, …, Punch, Bleach, Cool It, Warm Skin, …]
        // manual: Mojo esquenta realces e esfria sombras; Punch (contraste + saturação); Bleach; Cool/Warm; Strength (último)
        {
          const k = (v[11] ?? 100) / 100;
          p.mojo = Math.max(p.mojo, (v[0] || 0) * k);
          p.punch += (v[3] || 0) * 0.45 * k;
          p.bleach += (v[4] || 0) * 0.5 * k;
          if (v[5] > 0) p.mojoCool = clampN(v[5] * 2, 0, 100);
          if (v[6] > 0) p.mojoSkin = clampN(v[6] * 2, 0, 100);
          p.temperature += (v[7] || 0) * 10 * k;
        }
        break;
      // Haze/Flare (manual: Spillage, Softness, …, Exposure, …, cor): luz que vaza dentro da lente + leve névoa
      case 'haze':
        p.hazeSpill = clampN(v[0] ?? 50, 0, 100); p.hazeSoftness = clampN(v[1] ?? 60, 0, 100);
        p.hazeExposure = clampN(v[3] ?? -1, -10, 4); p.hazeTint = [v[8] ?? 1, v[9] ?? 1, v[10] ?? 1, 1];
        p.fade += (v[2] || 0) * 0.08;
        break;
      // Anamorphic Flare (manual: Size, Boost, Threshold, …, cor)
      case 'anam': p.anamSize = clampN(v[0] || 0, 0, 1000); p.anamBoost = clampN(v[1] ?? 1, 0, 5); p.anamThreshold = clampN((v[2] ?? 0.7) * 100, 0, 100); break;
      // Lens Distortion (manual: Distortion, Flatten)
      case 'lnsd': p.lensDistort = clampN(v[0] || 0, -100, 100); p.lensFlatten = clampN(v[1] || 0, 0, 100); break;
      case 'csta': {
        // Colorista: [?, força, exposição, lift RGB, gamma RGB, gain RGB, ?, HSL de 8 cores (matiz/sat/lum) …, temperatura (216), tint (217)]
        p.liftR += ((v[3] ?? 1) - 1) * 0.6; p.liftG += ((v[4] ?? 1) - 1) * 0.6; p.liftB += ((v[5] ?? 1) - 1) * 0.6;
        p.gammaR *= v[6] ?? 1; p.gammaG *= v[7] ?? 1; p.gammaB *= v[8] ?? 1;
        p.gainR *= v[9] ?? 1; p.gainG *= v[10] ?? 1; p.gainB *= v[11] ?? 1;
        p.exposure += (v[2] || 0) * 0.25;
        HSL.forEach((k, i) => {
          p[`hsl${k}H`] += v[13 + i * 3] || 0;
          p[`hsl${k}S`] += v[14 + i * 3] || 0;
          p[`hsl${k}L`] += v[15 + i * 3] || 0;
        });
        p.temperature += v[216] || 0;
        p.tint += v[217] || 0;
        break;
      }
      case 'crv2': {
        // curva: [força, …, (36) canal, (37) nº de pontos, depois pares (entrada, ajuste)]
        const n = Math.min(4, Math.round(v[37] || 0));
        for (let i = 0; i < n; i++) curve.push([v[38 + i * 2], v[39 + i * 2]]);
        break;
      }
      case 'cmix': if ((v[0] ?? 100) > 0) p.saturation *= (v[1] ?? 100) / 100; break;
      case 'duto': p.mojo = Math.max(p.mojo, (v[3] || 0) * 2); break;
      // Two Strip (Technicolor de 2 tiras): laranja/ciano forte, pele quente — não dessatura
      case '2stp': p.mojo = Math.max(p.mojo, (v[0] || 0) * 0.6); p.mojoSkin = Math.max(p.mojoSkin, 70); p.saturation *= 1 + (v[0] || 0) / 500; break;
      case 'logc': p.fade += 8; p.contrast -= 8; break;
      case 'spex':
        // Spot Exposure: [exposição, deslocamento x %, deslocamento y %, ?, ?, ?, tamanho %, filtro de cor RGB (7-9), suavidade (10)]
        // a cor age como filtro da luz (ex.: +1.3 stops com cinza 0.465 ≈ leve clareada no centro)
        // manual do Looks: Stops, Centro X/Y (% a partir do centro), Proporção, Raio, Spread, Falloff, Color Balance, …, Inverter
        p.spotExposure += v[0] || 0;
        p.spotCenter = [clampN(0.5 + (v[1] || 0) / 100, 0, 1), clampN(0.5 - (v[2] || 0) / 100, 0, 1)];
        p.spotAspect = clampN(v[3] ?? 1, 0.1, 4);
        p.spotSize = clampN((v[4] ?? 0.5) * 100, 0, 400);
        p.spotSoft = clampN((v[5] ?? 0.5) * 100, 1, 400);
        p.spotColor = [v[7] ?? 1, v[8] ?? 1, v[9] ?? 1, 1];
        p.spotInvert = !!v[11];
        break;
      case 'grex':
        // Gradient Exposure: [exposição, ?, ângulo, ?, deslocamento %, suavidade, ?, cor RGB (7-9)]
        if (!v[0]) { ignored.push('grex (exposição 0)'); continue; }
        p.gradExposure += v[0];
        p.gradAngle = v[2] || 0; p.gradOffset = clampN((v[4] || 0) / 100, -1, 1); p.gradSoft = clampN(v[5] ?? 0.5, 0.01, 2);
        p.gradColor = [v[7] ?? 1, v[8] ?? 1, v[9] ?? 1, 1];
        break;
      case 'edgs':
        // Edge Softness: [desfoque, ?, ?, ?, tamanho da área nítida, suavidade, proporção]
        // manual do Looks: Blur Size, (qualidade), Centro X/Y (%), Raio, Spread, Proporção
        p.edgeBlur = Math.max(p.edgeBlur, v[0] || 0);
        p.edgeCenter = [clampN(0.5 + (v[2] || 0) / 100, 0, 1), clampN(0.5 - (v[3] || 0) / 100, 0, 1)];
        p.edgeSize = clampN((v[4] ?? 1) * 100, 0, 400);
        p.edgeSoft = clampN((v[5] ?? 0.5) * 100, 1, 400);
        p.edgeAspect = clampN(v[6] ?? 1, 0.1, 4);
        break;
      default: ignored.push(t.id); continue;
    }
    used.push(t.id);
  }
  curve = curve.filter(([x]) => x > 0 && x < 1).sort((a, b) => a[0] - b[0]).slice(0, 4);
  curve.forEach(([x, y], i) => { p[`curve${i + 1}x`] = x; p[`curve${i + 1}y`] = clampN(y, -0.5, 0.5); });
  for (const k of HSL) for (const c of 'HSL') p[`hsl${k}${c}`] = clampN(p[`hsl${k}${c}`], -100, 100);
  p.exposure = clampN(p.exposure, -3, 3); p.saturation = clampN(p.saturation, 0, 300); p.contrast = clampN(p.contrast, -100, 100);
  p.temperature = clampN(p.temperature, -100, 100); p.tint = clampN(p.tint, -100, 100);
  p.mojo = clampN(p.mojo, 0, 100); p.punch = clampN(p.punch, 0, 100); p.bleach = clampN(p.bleach, 0, 100);
  p.fade = clampN(p.fade, 0, 60); p.vignette = clampN(p.vignette, 0, 100); p.diffusion = clampN(p.diffusion, 0, 150);
  p.diffusionRadius = clampN(p.diffusionRadius, 1, 300); p.chroma = clampN(p.chroma, 0, 20); p.optGlow = clampN(p.optGlow, 0, 200);
  p.spotExposure = clampN(p.spotExposure, -4, 4); p.gradExposure = clampN(p.gradExposure, -4, 4); p.edgeBlur = clampN(p.edgeBlur, 0, 100);
  return { params: p, used, ignored };
}

function looksExpand(fx, raw) {
  const strength = raw('strength') ?? 100;
  const { params, used, ignored } = looksFromTools(fx.looksTools || [], strength);
  return [{ type: 'looks', label: fx.name || 'Looks', params, note: `ferramentas: ${used.join(', ') || '—'}${ignored.length ? `; ignoradas: ${ignored.join(', ')}` : ''}` }];
}

export const IMPORT_RULES = [
  // ---------------------------------------------------------------- plugins de terceiros
  // ---- regras ajustadas com presets reais de edit (sonhei, ftb, galego, ZAZ…)
  { vendor: 'RE:Vision', plugin: 'Twixtor', to: 'twixtor', test: /twixtor/i,
    map: { speed: { i: 5, n: ['speed %', 'speed'] }, frameBlend: { i: 1, n: ['frame interp', 'frame interpolation'], conv: (v) => v >= 2 } } },
  { vendor: 'Red Giant', plugin: 'Magic Bullet Looks', to: 'looks', test: /^MB Look|magic ?bullet ?looks/i, expand: looksExpand },
  { vendor: 'Red Giant', plugin: 'Magic Bullet Colorista / Mojo', to: 'colorGrade', test: /colorista|\bmojo\b/i },
  // Twitch: Amount = intensidade, Speed = frequência (%); quantidades por tipo; Slide com RGB Split e Motion Blur; Time
  { vendor: 'Video Copilot', plugin: 'Twitch', to: 'twitch', test: /twitch/i,
    map: {
      amount: { i: 2, n: ['amount'] }, speed: { i: 1, n: ['speed'] }, seed: { n: ['seed', 'random seed'] },
      blur: { i: 7, n: ['blur', 'enable blur'] }, color: { i: 4, n: ['color', 'enable color'] }, light: { i: 5, n: ['light', 'enable light'] }, scale: { i: 6, n: ['scale', 'enable scale'] }, slide: { i: 8, n: ['slide', 'enable slide'] }, time: { i: 9, n: ['time'] },
      blurAmt: { n: ['blur amount'] }, colorAmt: { n: ['color amount'] }, colorize: { n: ['colorize'] }, lightAmt: { n: ['light amount'] },
      scaleAmt: { n: ['scale amount'] }, slideAmt: { n: ['slide amount'] }, slideDir: { n: ['slide direction'], conv: (v) => Math.min(3, Math.max(1, v + 1)) },
      slideRgb: { n: ['slide rgb split'] }, slideBlur: { n: ['slide motion blur'] }, timeAmt: { n: ['time amount'] },
    } },
  // S_Shake: deslocamento = Amplitude (mestre) × X/Y Rand Amp (px); motion blur, wrap e rajadas (Stillness) do próprio plugin
  { vendor: 'Sapphire', plugin: 'S_Shake', to: 'shake', test: /s_shake|s_camerashake/i,
    map: {
      amount: { n: ['amplitude', 'shake amp', 'amp'], conv: (v) => (v < 20 ? v * 100 : v) }, frequency: { n: ['frequency', 'shake freq', 'freq'], conv: (v) => (v > 60 ? Math.min(40, v / 250) : v) },
      ampX: { n: ['x rand amp'] }, ampY: { n: ['y rand amp'] }, rotation: { n: ['tilt rand amp', 'rotate amp'], conv: (v) => v * 0.1 }, zoom: { n: ['z rand amp'], conv: (v) => v * 0.2 },
      stillness: { n: ['stillness'] }, twitchFreq: { n: ['twitch frequency'] }, drift: { n: ['drift'], conv: (v) => v * 0.3 }, seed: { n: ['seed'] },
      shutter: { n: ['mo blur length'] }, wrap: { n: ['wrap x'], conv: (v) => Math.min(3, Math.max(1, v)) },
    },
    post: (p, raw) => { if (!raw('motion blur')) p.shutter = 0; if (p.ampX === undefined) p.ampX = 100; if (p.ampY === undefined) p.ampY = 100; } },
  { vendor: 'Sapphire', plugin: 'S_BlurMoCurves', to: 'blurMoCurves', test: /s_blurmocurves/i,
    map: { center: { n: ['center xy'] }, zDist: { n: ['z dist'] }, rotate: { n: ['rotate'] }, shiftX: { n: ['shift x'] }, shiftY: { n: ['shift y'] }, shutter: { n: ['shutter duration'] }, wrap: { n: ['wrap x'], conv: (v) => Math.min(3, Math.max(1, v)) }, wrapY: { n: ['wrap y'], conv: (v) => Math.min(3, Math.max(1, v)) } } },
  { vendor: 'Sapphire', plugin: 'S_Sharpen', to: 'sharpen', test: /s_sharpen/i,
    map: { amount: { n: ['sharpen amp'], conv: (v) => v * 60 }, radius: { n: ['small detail size'], conv: (v) => v * 0.8 } } },
  { vendor: 'Sapphire', plugin: 'S_HueSatBright', to: 'looks', test: /s_huesat/i,
    expand: (fx, raw) => [{ type: 'looks', label: 'S_HueSatBright', params: { hue: (raw('hue shift') || 0) * 360, saturation: (raw('saturation') ?? 1) * 100, exposure: Math.log2(Math.max(0.01, raw('brightness') ?? 1)) } }] },
  { vendor: 'Sapphire', plugin: 'S_MathOps', to: 'exposure', test: /s_mathops/i,
    expand: (fx, raw) => [{ type: 'exposure', label: 'S_MathOps', params: { offset: (raw('a darks') || 0) + (raw('dest darks') || 0), exposure: Math.log2(Math.max(0.01, (raw('a lights') ?? 1) * (raw('dest lights') ?? 1))) } }] },
  { vendor: 'Sapphire', plugin: 'S_FilmDamage / S_FilmEffect', to: 'filmLook', test: /s_film/i,
    expand: (fx, raw) => [{ type: 'filmLook', label: fx.name, params: { grain: Math.min(100, (raw('grain amp') || 0) * 30), scratch: Math.min(100, (raw('dust density') || 0) * 10 + (raw('scratch density') || 0) * 10), vignette: 0, flicker: Math.min(100, (raw('flicker amp') || 0) * 100), warmth: 0, fade: 0 } }] },
  { vendor: 'Sapphire', plugin: 'S_Flicker', to: 'flicker', test: /s_flicker/i,
    map: { amount: { n: ['amplitude'], conv: (v) => v * 100 }, frequency: { n: ['rand freq'], conv: (v) => Math.min(60, v) }, colorAmount: { n: ['rand color amp'], conv: (v) => v * 100 }, brightness: { n: ['brightness'] } } },
  { vendor: 'BCC', plugin: 'BCC Directional Blur', to: 'dirBlur', test: /bcc.*(directional|motion).*blur/i,
    map: { length: { i: 2, n: ['blur amount'], conv: (v) => v * 1.5 }, angle: { i: 3, n: ['angle'] } } },
  { vendor: 'BCC', plugin: 'BCC Unsharp Mask', to: 'sharpen', test: /bcc.*(unsharp|sharpen)/i,
    map: { radius: { n: ['radius'], conv: (v) => v * 0.25 }, amount: { n: ['amount'], conv: (v) => (v <= 5 ? v * 100 : v) }, threshold: { n: ['threshold'] } } },
  { vendor: 'RE:Vision', plugin: 'ReelSmart Motion Blur', to: 'motionBlur', test: /reelsmart|\brsmb\b|motion ?blur ?pro/i,
    map: { amount: { n: ['blur amount', 'motion blur amount'], conv: (v) => (v <= 4 ? v * 200 : v) } } },
  { vendor: 'Plugin Everything', plugin: 'Deep Glow', to: 'deepGlow', test: /deep ?glow|\bpedg\b/i,
    map: { radius: { i: 1, n: ['radius'] }, exposure: { i: 2, n: ['exposure', 'intensity'] }, threshold: { i: 4, n: ['threshold'], conv: pct }, tint: { i: 38, n: ['tint color'] }, useTint: { i: 37, n: ['enable tint'] }, aspect: { i: 10, n: ['aspect ratio', 'aspect'] } },
    post: (p, raw) => { if (p.useTint === undefined) p.useTint = false; } },
  { vendor: 'Video Copilot', plugin: 'Optical Flares', to: 'lensFlare', test: /optical ?flares?/i, map: { brightness: { n: ['brightness'] }, size: { n: ['scale', 'size'] } } },
  { vendor: 'Video Copilot', plugin: 'Saber', to: 'deepGlow', test: /\bsaber\b/i, map: { exposure: { n: ['glow intensity'] }, radius: { n: ['glow spread', 'glow size'], conv: (v) => v * 100 }, tint: { n: ['glow color'] } }, set: { useTint: true } },
  { vendor: 'Video Copilot', plugin: 'Heat Distortion', to: 'turbulentDisplace', test: /heat ?distort/i },
  { vendor: 'Red Giant', plugin: 'Shine', to: 'lightRays', test: /\bshine\b/i, map: { length: { n: ['ray length'], conv: (v) => Math.min(100, v * 10) }, intensity: { n: ['boost light'] } } },
  { vendor: 'aescripts', plugin: 'Tracery', to: 'tracery', test: /tracery/i },
  { vendor: 'Cinema Spice', plugin: 'Glitchify', to: 'glitchify', test: /glitchify/i, map: { amount: { n: ['amount', 'glitch amount'] }, speed: { n: ['speed', 'frequency'] } } },
  { vendor: 'aescripts', plugin: 'Datamosh 2', to: 'datamosh', test: /datamosh|pixel ?encoder/i },
  { vendor: 'Video Copilot', plugin: 'VC Reflect', to: 'reflect', test: /vc ?reflect|^reflect$/i, map: { opacity: { n: ['opacity', 'reflection opacity'] } } },
  { vendor: 'aescripts', plugin: 'Quick Chromatic Aberration 2', to: 'qca', test: /quick ?chromatic|qca/i, map: { amount: { n: ['aberration amount', 'amount'], conv: (v) => Math.min(60, v) } } },
  { vendor: 'Sapphire', plugin: 'S_Halftone', to: 'halftone', test: /s_halftone|halftone|cc ball action/i, map: { cell: { n: ['dot size', 'scale', 'grid spacing'] }, angle: { n: ['angle', 'rotate'] } } },
  { vendor: 'Red Giant', plugin: 'Universe Holomatrix', to: 'holomatrix', test: /holomatrix/i },
  { vendor: 'Red Giant', plugin: 'Starglow', to: 'starGlow', test: /starglow/i, map: { length: { n: ['streak length'], conv: (v) => v * 3 }, amount: { n: ['boost light'], conv: (v) => Math.max(0.3, v) }, threshold: { n: ['threshold'], conv: (v) => v / 2.55 } } },
  { vendor: 'Sapphire', plugin: 'S_Glint', to: 'starGlow', test: /s_glint/i, map: { length: { n: ['length', 'rays length'], conv: (v) => v * 100 }, amount: { n: ['brightness'] }, threshold: { n: ['threshold'], conv: (v) => v * 100 }, angle: { n: ['rotate'] } } },
  { vendor: 'Pixel Sorter', plugin: 'Pixel Sorter', to: 'pixelSort', test: /pixel ?sort/i, map: { angle: { n: ['angle', 'direction'] }, length: { n: ['length', 'sort length'] }, low: { n: ['threshold low', 'lower threshold', 'threshold'] }, high: { n: ['threshold high', 'upper threshold'] } } },
  { vendor: 'Sapphire', plugin: 'S_RackDefocus', to: 'lensBlur', test: /s_rackdefocus|s_defocus/i, map: { radius: { n: ['defocus', 'blur amount'], conv: (v) => v * 3 } } },
  { vendor: 'Red Giant', plugin: 'Universe Glow', to: 'deepGlow', test: /uni\.? ?glow|universe.*glow/i },
  { vendor: 'Red Giant', plugin: 'Universe Shake', to: 'shake', test: /uni\.?.*shake|universe.*shake/i },
  { vendor: 'Red Giant', plugin: 'Universe Glitch', to: 'glitch', test: /uni\.?.*(glitch|damage)|universe.*glitch/i },
  { vendor: 'Red Giant', plugin: 'Universe VHS', to: 'vhs', test: /uni\.?.*vhs|universe.*vhs/i },
  { vendor: 'Red Giant', plugin: 'Universe Chromatic', to: 'rgbSplit', test: /uni\.?.*(chromatic|rgb)|universe.*chromatic/i },
  { vendor: 'Red Giant', plugin: 'Universe Light Leaks', to: 'lightLeak', test: /uni\.?.*leak|universe.*leak/i },
  { vendor: 'FilmConvert', plugin: 'FilmConvert', to: 'filmLook', test: /filmconvert/i },

  // Sapphire (Boris FX)
  { vendor: 'Sapphire', plugin: 'S_GlowRainbow', to: 'glowRainbow', test: /s_glowrainbow|s_glowrings/i, map: { radius: { n: ['width'], conv: (v) => (v < 5 ? v * 500 : v) }, amount: { n: ['brightness'] }, threshold: { n: ['threshold'], conv: pct } } },
  { vendor: 'Sapphire', plugin: 'S_EdgeRays', to: 'edgeRays', test: /s_edgerays/i, map: { center: { n: ['center', 'rays center'] }, length: { n: ['rays length', 'length'], conv: (v) => (v <= 2 ? v * 60 : v) }, amount: { n: ['rays bright', 'brightness'] } } },
  { vendor: 'Sapphire', plugin: 'S_Swish3D / S_SwishPan', to: 'swish', test: /s_swish|s_swishpan|s_wipeblur|s_blurmotion/i, map: { distance: { n: ['swish distance', 'distance', 'shift'] }, angle: { n: ['swish angle', 'angle', 'direction'] } } },
  { vendor: 'Sapphire', plugin: 'S_JpegDamage', to: 'jpegDamage', test: /s_jpeg|jpeg ?glitch/i, map: { amount: { n: ['amount', 'damage'], conv: (v) => (v <= 1 ? v * 100 : v) }, block: { n: ['block size'] } } },
  { vendor: 'Sapphire', plugin: 'S_Streaks', to: 'streaks', test: /s_streaks/i, map: { length: { n: ['streak length', 'length'], conv: (v) => (v <= 2 ? v * 200 : v) }, amount: { n: ['brightness'] }, angle: { n: ['angle', 'streak angle'] } } },
  { vendor: 'Sapphire', plugin: 'S_Feedback', to: 'feedback', test: /s_feedback/i, map: { zoom: { n: ['zoom', 'scale'] }, rotate: { n: ['rotate'] }, count: { n: ['iterations', 'repeats'] } } },
  { vendor: 'Sapphire', plugin: 'S_Glow', to: 'deepGlow', test: /s_glow/i,
    map: { radius: { n: ['width'], conv: (v) => (v < 5 ? v * 500 : v) }, exposure: { n: ['brightness'] }, threshold: { n: ['threshold'], conv: pct }, tint: { n: ['color'] } }, set: { useTint: false } },
  { vendor: 'Sapphire', plugin: 'S_ZoomBlur', to: 'radialBlur', test: /s_zoomblur|s_blurzoom|s_radialblur/i, set: { mode: 1 },
    map: { amount: { n: ['zoom amount', 'blur amount', 'amount', 'length'], conv: (v) => (v <= 2 ? v * 100 : v) }, center: { n: ['center', 'center xy'] } } },
  { vendor: 'Sapphire', plugin: 'S_Blur', to: 'blur', test: /s_blur/i, map: { radius: { n: ['width', 'blur amount'], conv: (v) => (v < 5 ? v * 100 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_WarpChroma', to: 'rgbSplit', test: /s_warpchroma|s_chroma/i, set: { mode: 2 }, map: { amount: { n: ['amount', 'shift'], conv: (v) => (v < 5 ? v * 60 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_LensFlare', to: 'lensFlare', test: /s_lensflare|s_flare/i,
    map: { position: { n: ['flare pos', 'flare position', 'position', 'center'] }, brightness: { n: ['brightness'], conv: (v) => (v <= 5 ? v * 100 : v) }, size: { n: ['scale', 'flare scale', 'size'], conv: (v) => (v <= 5 ? v * 220 : v) }, color: { n: ['color', 'flare color'] } } },
  { vendor: 'Sapphire', plugin: 'S_Rays', to: 'lightRays', test: /s_rays/i,
    map: { center: { n: ['center', 'center xy', 'rays center'] }, length: { n: ['ray length', 'rays length', 'length'], conv: (v) => (v <= 2 ? v * 60 : v) }, intensity: { n: ['brightness', 'rays bright'], conv: (v) => v * 2 }, threshold: { n: ['threshold'], conv: (v) => (v <= 1 ? v * 100 : v) }, color: { n: ['rays color', 'color'] } } },
  { vendor: 'Sapphire', plugin: 'S_DigitalDamage', to: 'glitch', test: /s_digitaldamage|s_glitch|s_damage/i,
    map: { amount: { n: ['amount', 'damage amount', 'block amount'], conv: (v) => (v <= 1 ? v * 100 : v) }, block: { n: ['block size', 'blocks size'], conv: (v) => (v <= 1 ? v * 60 : v) }, speed: { n: ['frequency', 'speed'] }, seed: { n: ['seed'] } } },
  { vendor: 'Sapphire', plugin: 'S_TVDamage', to: 'vhs', test: /s_tv|s_retro/i, map: { amount: { n: ['amount', 'mix'], conv: (v) => (v <= 1 ? v * 100 : v) }, noise: { n: ['noise amp', 'noise'], conv: (v) => (v <= 1 ? v * 60 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_Vignette', to: 'vignette', test: /s_vignette/i, map: { amount: { n: ['amount', 'vignette amount', 'darken'], conv: (v) => (v <= 1 ? v * 100 : v) }, size: { n: ['radius', 'size'], conv: (v) => (v <= 2 ? v * 60 : v) }, feather: { n: ['softness', 'feather'], conv: (v) => (v <= 1 ? v * 100 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_Kaleido', to: 'kaleida', test: /s_kaleid/i },
  { vendor: 'Sapphire', plugin: 'S_Distort', to: 'turbulentDisplace', test: /s_distort|s_warp/i },
  { vendor: 'Sapphire', plugin: 'S_Mosaic', to: 'mosaic', test: /s_mosaic/i },

  // BCC (Boris Continuum)
  { vendor: 'BCC', plugin: 'BCC Glow / Film Glow', to: 'deepGlow', test: /bcc.*glow/i, map: { radius: { n: ['glow radius', 'radius'] }, exposure: { n: ['glow intensity', 'intensity'], conv: (v) => (v > 10 ? v / 100 : v) } } },
  { vendor: 'BCC', plugin: 'BCC Lens Flare', to: 'lensFlare', test: /bcc.*flare/i },
  { vendor: 'BCC', plugin: 'BCC Light Leaks', to: 'lightLeak', test: /bcc.*leak/i },
  { vendor: 'BCC', plugin: 'BCC Prism', to: 'prism', test: /bcc.*prism/i, map: { amount: { n: ['prism amount', 'amount'] } } },
  { vendor: 'BCC', plugin: 'BCC Glitch / Damaged TV', to: 'glitch', test: /bcc.*(glitch|datamosh|damage)/i },
  { vendor: 'BCC', plugin: 'BCC VHS', to: 'vhs', test: /bcc.*vhs/i },
  { vendor: 'BCC', plugin: 'BCC Chromatic Aberration', to: 'rgbSplit', test: /bcc.*(chromatic|rgb)/i },
  { vendor: 'BCC', plugin: 'BCC Camera Shake / Wiggle', to: 'shake', test: /bcc.*(shake|wiggle|jitter)/i,
    map: { amount: { n: ['amplitude', 'shake amount', 'amount', 'magnitude'], conv: (v) => (v <= 5 ? v * 60 : v) }, frequency: { n: ['frequency', 'speed', 'shake speed'], conv: (v) => (v > 60 ? v / 10 : v) }, rotation: { n: ['rotation', 'roll', 'rotate amount'] }, zoom: { n: ['zoom', 'scale amount'] }, shutter: { n: ['motion blur', 'blur amount'], conv: (v) => (v > 4 ? v / 100 : v) }, seed: { n: ['random seed', 'seed'] } }, set: { stillness: 0 } },
  { vendor: 'BCC', plugin: 'BCC Rays', to: 'lightRays', test: /bcc.*rays/i,
    map: { center: { n: ['source center', 'center', 'rays center'] }, length: { n: ['ray length', 'length', 'rays length'], conv: (v) => Math.min(100, v > 100 ? v / 10 : v) }, intensity: { n: ['ray intensity', 'intensity', 'brightness'], conv: (v) => (v > 10 ? v / 50 : v) }, threshold: { n: ['threshold'] } } },
  { vendor: 'BCC', plugin: 'BCC Radial / Zoom Blur', to: 'radialBlur', test: /bcc.*(radial|zoom|spin).*blur/i,
    map: { amount: { n: ['blur amount', 'amount'], conv: (v) => Math.min(100, v) }, center: { n: ['center'] } }, post: (p, raw) => { p.mode = /spin/i.test(raw('effect presets & docs') ?? '') ? 2 : 1; } },
  { vendor: 'BCC', plugin: 'BCC Lens Blur', to: 'lensBlur', test: /bcc.*lens ?blur/i, map: { radius: { n: ['iris scale', 'blur amount', 'radius'], conv: (v) => v * 2 }, highlights: { n: ['highlight boost'], conv: (v) => Math.min(5, v / 5) } } },
  { vendor: 'BCC', plugin: 'BCC Cross Glow', to: 'crossGlow', test: /bcc.*cross ?glow/i, map: { length: { n: ['ray length', 'glow length', 'length'] }, amount: { n: ['glow intensity', 'intensity'], conv: (v) => (v > 10 ? v / 50 : v) }, threshold: { n: ['threshold'] }, angle: { n: ['angle', 'rotation'] } } },
  { vendor: 'BCC', plugin: 'BCC Rays Streaky', to: 'raysStreaky', test: /bcc.*streak/i, map: { center: { n: ['source center', 'center'] }, length: { n: ['ray length', 'length'] }, intensity: { n: ['ray intensity', 'intensity'], conv: (v) => (v > 10 ? v / 50 : v) } } },
  { vendor: 'BCC', plugin: 'BCC Light Wrap', to: 'lightWrap', test: /bcc.*light ?wrap/i },
  { vendor: 'BCC', plugin: 'BCC Blur', to: 'blur', test: /bcc.*blur/i, map: { radius: { n: ['blur radius', 'blur amount', 'amount'] } } },
  { vendor: 'BCC', plugin: 'BCC Film', to: 'filmLook', test: /bcc.*film/i },
  { vendor: 'BCC', plugin: 'BCC Vignette', to: 'vignette', test: /bcc.*vignette/i },
  { vendor: 'BCC', plugin: 'BCC Kaleido', to: 'kaleida', test: /bcc.*kaleid/i },
  { vendor: 'BCC', plugin: 'BCC Twirl', to: 'twirl', test: /bcc.*twirl/i },
  { vendor: 'BCC', plugin: 'BCC Wave', to: 'waveWarp', test: /bcc.*wave/i },
  { vendor: 'BCC', plugin: 'BCC Pixelate / Mosaic', to: 'mosaic', test: /bcc.*(pixel|mosaic)/i },
  { vendor: 'BCC', plugin: 'BCC Flicker / Strobe', to: 'strobe', test: /bcc.*(flicker|strobe)/i },

  // ---------------------------------------------------------------- nativos do After Effects
  { vendor: ADOBE, plugin: 'Exposure', to: 'exposure', match: ['ADBE Exposure2'], map: { exposure: { i: 3, n: ['exposure'] }, offset: { i: 4, n: ['offset'] }, gamma: { i: 5, n: ['gamma correction', 'gamma'] } } },
  { vendor: ADOBE, plugin: 'Hue/Saturation', to: 'hueSat', match: ['ADBE HUE SATURATION'],
    map: { hue: { i: 4, n: ['master hue'] }, saturation: { i: 5, n: ['master saturation'] }, lightness: { i: 6, n: ['master lightness'] }, colorize: { i: 7, n: ['colorize'] } } },
  { vendor: ADOBE, plugin: 'Color Balance (HLS)', to: 'hueSat', match: ['ADBE Color Balance (HLS)'], map: { hue: { i: 1, n: ['hue'] }, lightness: { i: 2, n: ['lightness'] }, saturation: { i: 3, n: ['saturation'] } } },
  { vendor: ADOBE, plugin: 'Motion Tile', to: 'motionTile', match: ['ADBE Tile'], map: { outW: { i: 4, n: ['output width'] }, outH: { i: 5, n: ['output height'] }, mirror: { i: 6, n: ['mirror edges'] } } },
  { vendor: ADOBE, plugin: '4-Color Gradient', to: 'fourColor', match: ['ADBE 4ColorGradient'],
    map: { p1: { i: 1 }, c1: { i: 2 }, p2: { i: 3 }, c2: { i: 4 }, p3: { i: 5 }, c3: { i: 6 }, p4: { i: 7 }, c4: { i: 8 }, blend: { i: 9 }, opacity: { i: 13 }, mode: { i: 14, conv: (v) => AE_BLEND[v] ?? 2 } } },
  { vendor: ADOBE, plugin: 'Unsharp Mask', to: 'sharpen', match: ['ADBE Unsharp Mask2', 'ADBE Unsharp Mask'], map: { amount: { i: 1 }, radius: { i: 2 }, threshold: { i: 3 } } },
  { vendor: ADOBE, plugin: 'Sharpen', to: 'sharpen', match: ['ADBE Sharpen'], map: { amount: { i: 1, conv: (v) => v * 2 } }, set: { radius: 1 } },
  // Shatter do AE (matchName 'APC Shatter'; parâmetros por índice porque Força 1 e 2 têm os mesmos nomes)
  { vendor: ADOBE, plugin: 'Keylight', to: 'keylight', match: ['Keylight 906'], map: { key: { n: ['screen colour', 'screen color'] }, tolerance: { n: ['clip black'], conv: (v) => Math.max(5, 30 - v * 0.2) } } },
  { vendor: ADOBE, plugin: 'Ripple', to: 'ripple', match: ['ADBE Ripple'], map: { center: { n: ['center of ripple'] }, amplitude: { n: ['wave height'] }, wavelength: { n: ['wave width'] }, speed: { n: ['wave speed'] }, radius: { n: ['radius'], conv: (v) => v * 10 } } },
  { vendor: ADOBE, plugin: 'CC Ripple Pulse', to: 'ripple', match: ['CC Ripple Pulse'], map: { center: { n: ['center'] }, amplitude: { n: ['amplitude'], conv: (v) => v * 0.3 } } },
  { vendor: ADOBE, plugin: 'Polar Coordinates', to: 'polar', match: ['ADBE Polar Coordinates'], map: { amount: { i: 1, n: ['interpolation'] }, mode: { i: 2, n: ['type of conversion'] } } },
  { vendor: ADOBE, plugin: 'Offset', to: 'offset', match: ['ADBE Offset'], map: { blend: { n: ['blend with original'] } } },
  { vendor: ADOBE, plugin: 'Fractal Noise', to: 'fractalNoise', match: ['ADBE Fractal Noise'], map: { contrast: { n: ['contrast'], conv: (v) => v / 100 }, brightness: { n: ['brightness'], conv: (v) => v / 100 }, complexity: { n: ['complexity'] }, evolution: { n: ['evolution'], conv: (v) => v / 90 }, scale: { n: ['scale'] }, opacity: { n: ['opacity'] } } },
  { vendor: ADOBE, plugin: 'Curves', to: 'curves', match: ['ADBE CurvesCustom', 'ADBE Curves'] },
  { vendor: ADOBE, plugin: 'Tritone', to: 'tritone', match: ['ADBE Tritone'], map: { highlights: { n: ['highlights'] }, midtones: { n: ['midtones'] }, shadows: { n: ['shadows'] }, mix: { n: ['blend with original'], conv: (v) => 100 - v } } },
  { vendor: ADOBE, plugin: 'CC Toner', to: 'tritone', match: ['CC Toner'], map: { highlights: { n: ['highlights'] }, midtones: { n: ['midtones'] }, shadows: { n: ['shadows'] }, mix: { n: ['blend w. original'], conv: (v) => 100 - v } } },
  { vendor: ADOBE, plugin: 'CC Light Sweep', to: 'lightSweep', match: ['CC Light Sweep'], map: { center: { n: ['center'] }, direction: { n: ['direction'] }, shape: { n: ['shape'] }, width: { n: ['width'] }, intensity: { n: ['sweep intensity'], conv: (v) => v / 50 }, color: { n: ['light color'] } } },
  { vendor: ADOBE, plugin: 'Camera Lens Blur', to: 'lensBlur', match: ['ADBE Camera Lens Blur', 'ADBE Lens Blur'], map: { radius: { n: ['blur radius', 'iris radius'] } } },
  { vendor: ADOBE, plugin: 'Shatter', to: 'shatter', match: ['APC Shatter', 'ADBE Shatter'],
    map: {
      render: { i: 4 },
      // padrões do AE: 3 Tijolos, 8 Vidro, 15 Pranchas, 18 Quadrados, 14 Quadrados sobrepostos, 21/22 Triângulos → vidro/quadrados/triângulos/tijolos
      pattern: { i: 6, conv: (v) => ({ 3: 4, 15: 4, 18: 2, 14: 2, 13: 2, 19: 3, 21: 3, 22: 3, 20: 3, 17: 3 })[Math.round(v)] || 1 },
      repetitions: { i: 10, conv: (v) => Math.min(80, Math.max(3, v * 1.6)) },
      force: { i: 24 }, forceDepth: { i: 26 }, radius: { i: 28, conv: (v) => v * 0.65 }, strength: { i: 30 },
      force2: { i: 32 }, force2Depth: { i: 34 }, radius2: { i: 36, conv: (v) => v * 0.65 }, strength2: { i: 38 },
      spin: { i: 40 }, tumble: { i: 42 }, randomness: { i: 44, conv: (v) => v * 1.5 }, viscosity: { i: 46 }, massVariance: { i: 48 },
      gravity: { i: 50, conv: (v) => v * 0.5 }, gravityDir: { i: 52 }, gravityIncl: { i: 54 },
      fillColor: { i: 56 }, opacity: { i: 58, conv: (v) => (v <= 1 ? v * 100 : v) }, frontMode: { i: 60, conv: (v) => (v >= 4 ? v - 3 : v) },
      cameraDist: { i: 82, conv: (v) => Math.max(0.6, v * 1.1) },
      shade: { i: 112, conv: (v) => Math.min(100, v * 100) }, ambient: { i: 110, conv: (v) => Math.min(100, v * 100) }, specular: { i: 114, conv: (v) => v * 100 },
    },
    // Força 2 só conta se tiver intensidade; no AE a simulação começa no início da camada
    post: (p, raw) => { p.force2On = Math.abs(p.strength2 ?? 0) > 0.01; p.zPush = 0.25; if (p.fill === undefined) p.fill = false; },
  },
  { vendor: 'Sapphire / BCC', plugin: 'Time Slice', to: 'timeSlice', test: /time ?slice|s_timeslice|slit ?scan/i },
  { vendor: ADOBE, plugin: 'Warp', to: 'warp', match: ['ADBE WRPMESH'], map: { style: { i: 1 }, axis: { i: 2 }, bend: { i: 3 }, hDist: { i: 4 }, vDist: { i: 5 } } },
  { vendor: ADOBE, plugin: 'Photo Filter', to: 'photoFilter', match: ['ADBE Photo Filter'], map: { color: { n: ['color'] }, density: { n: ['density'] }, preserve: { n: ['preserve luminosity'] } } },
  { vendor: ADOBE, plugin: 'Gaussian / Fast / Box Blur', to: 'blur', match: ['ADBE Gaussian Blur 2', 'ADBE Gaussian Blur', 'ADBE Fast Blur', 'ADBE Box Blur2', 'ADBE Box Blur', 'ADBE Camera Lens Blur', 'ADBE Compound Blur'],
    map: { radius: { i: 1, n: ['blurriness', 'blur radius', 'radius'] }, dims: { i: 2, n: ['blur dimensions'] } } },
  { vendor: ADOBE, plugin: 'Directional Blur', to: 'dirBlur', match: ['ADBE Motion Blur'], map: { angle: { i: 1, n: ['direction'] }, length: { i: 2, n: ['blur length'] } } },
  { vendor: ADOBE, plugin: 'Radial Blur', to: 'radialBlur', match: ['ADBE Radial Blur'], map: { amount: { i: 1, n: ['amount'] }, mode: { i: 3, n: ['type'], conv: (v) => (v === 2 ? 1 : 2) } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Radial Blur', to: 'radialBlur', match: ['CC Radial Blur', 'CC Radial Fast Blur'], map: { amount: { n: ['amount'] }, mode: { n: ['type'], conv: (v) => (v === 4 ? 2 : 1) } } },
  { vendor: ADOBE, plugin: 'Pixel Motion Blur / CC Force Motion Blur', to: 'motionBlur', match: ['ADBE Pixel Motion Blur', 'CC Force Motion Blur'], map: { amount: { n: ['shutter angle'], conv: (v) => (v / 180) * 100 }, samples: { n: ['shutter samples', 'motion blur levels'] } } },
  { vendor: ADOBE, plugin: 'Glow', to: 'glow', match: ['ADBE Glo2', 'ADBE Glow'],
    map: { threshold: { i: 2, n: ['glow threshold'], conv: pct }, radius: { i: 3, n: ['glow radius'] }, intensity: { i: 4, n: ['glow intensity'] }, color: { i: 9, n: ['color a'] } } },
  { vendor: ADOBE, plugin: 'Brightness & Contrast', to: 'brightnessContrast', match: ['ADBE Brightness & Contrast 2', 'ADBE Brightness & Contrast'], map: { brightness: { i: 1, n: ['brightness'] }, contrast: { i: 2, n: ['contrast'] } } },
  { vendor: ADOBE, plugin: 'Levels', to: 'levels', match: ['ADBE Easy Levels2', 'ADBE Pro Levels2', 'ADBE Easy Levels'],
    map: { inBlack: { n: ['input black'], conv: to255 }, inWhite: { n: ['input white'], conv: to255 }, gamma: { n: ['gamma'] }, outBlack: { n: ['output black'], conv: to255 }, outWhite: { n: ['output white'], conv: to255 } } },
  { vendor: ADOBE, plugin: 'Lumetri Color', to: 'colorGrade', match: ['ADBE Lumetri'],
    map: { temperature: { n: ['temperature'] }, tint: { n: ['tint'] }, exposure: { n: ['exposure'] }, contrast: { n: ['contrast'] }, highlights: { n: ['highlights'] }, shadows: { n: ['shadows'] }, whites: { n: ['whites'] }, blacks: { n: ['blacks'] }, saturation: { n: ['saturation'], conv: (v) => v - 100 }, vibrance: { n: ['vibrance'] }, fade: { n: ['faded film'] } } },
  { vendor: ADOBE, plugin: 'Vibrance', to: 'vibrance', match: ['ADBE Vibrance'], map: { vibrance: { n: ['vibrance'] }, saturation: { n: ['saturation'] } } },
  { vendor: ADOBE, plugin: 'Tint', to: 'tint', match: ['ADBE Tint'], map: { black: { i: 1, n: ['map black to'] }, white: { i: 2, n: ['map white to'] }, amount: { i: 3, n: ['amount to tint'] } } },
  { vendor: ADOBE, plugin: 'Black & White', to: 'blackWhite', match: ['ADBE Black&White', 'ADBE Black & White'] },
  { vendor: ADOBE, plugin: 'Invert', to: 'invert', match: ['ADBE Invert'], map: { blend: { i: 2, n: ['blend with original'] } } },
  { vendor: ADOBE, plugin: 'Fill', to: 'fill', match: ['ADBE Fill'], map: { color: { n: ['color'] }, opacity: { n: ['opacity'], conv: pct } } },
  { vendor: ADOBE, plugin: 'Gradient Ramp', to: 'ramp', match: ['ADBE Ramp'],
    map: { start: { i: 2, n: ['start color'] }, end: { i: 4, n: ['end color'] }, radial: { i: 5, n: ['ramp shape'], conv: (v) => v === 2 }, blend: { i: 7, n: ['blend with original'] } } },
  { vendor: ADOBE, plugin: 'Posterize', to: 'posterize', match: ['ADBE Posterize'], map: { levels: { n: ['level'] } } },
  { vendor: ADOBE, plugin: 'Threshold', to: 'threshold', match: ['ADBE Threshold2', 'ADBE Threshold'], map: { level: { n: ['level'] } } },
  { vendor: ADOBE, plugin: 'Wave Warp', to: 'waveWarp', match: ['ADBE Wave Warp'],
    map: { waveType: { i: 1, n: ['wave type'], conv: (v) => Math.min(4, Math.max(1, v)) }, height: { i: 2, n: ['wave height'] }, width: { i: 3, n: ['wave width'] }, direction: { i: 4, n: ['direction'] }, speed: { i: 5, n: ['wave speed'] }, phase: { n: ['phase'] } } },
  { vendor: ADOBE, plugin: 'Turbulent Displace', to: 'turbulentDisplace', match: ['ADBE Turbulent Displace'],
    map: { amount: { n: ['amount'] }, size: { n: ['size'] }, complexity: { n: ['complexity'] }, evolution: { n: ['evolution'] } }, set: { evoSpeed: 0 } },
  { vendor: ADOBE, plugin: 'Bulge', to: 'bulge', match: ['ADBE Bulge'], map: { radius: { n: ['horizontal radius'] }, strength: { n: ['bulge height'], conv: (v) => Math.max(-1, Math.min(1, v / 2)) } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Lens', to: 'bulge', match: ['CC Lens'], map: { radius: { n: ['size'], conv: (v) => v * 8 }, strength: { n: ['convergence'], conv: (v) => Math.max(-1, Math.min(1, v / 100)) } } },
  { vendor: ADOBE, plugin: 'Twirl', to: 'twirl', match: ['ADBE Twirl'], map: { angle: { n: ['angle'] }, radius: { n: ['twirl radius'], conv: (v) => v * 10 } } },
  { vendor: ADOBE, plugin: 'Optics Compensation', to: 'optics', match: ['ADBE Optics Compensation'], map: { fov: { n: ['field of view (fov)', 'field of view'] }, reverse: { n: ['reverse lens distortion'] } } },
  { vendor: ADOBE, plugin: 'Mirror', to: 'mirror', match: ['ADBE Mirror'], map: { angle: { n: ['reflection angle'] } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Kaleida', to: 'kaleida', match: ['CC Kaleida'], map: { rotation: { n: ['rotation'] } } },
  { vendor: ADOBE, plugin: 'Drop Shadow', to: 'dropShadow', match: ['ADBE Drop Shadow'],
    map: { color: { i: 1, n: ['shadow color'] }, opacity: { i: 2, n: ['opacity'], conv: (v) => (v > 100 ? v / 2.55 : v) }, angle: { i: 3, n: ['direction'] }, distance: { i: 4, n: ['distance'] }, softness: { i: 5, n: ['softness'] }, only: { i: 6, n: ['shadow only'] } } },
  { vendor: ADOBE, plugin: 'Mosaic', to: 'mosaic', match: ['ADBE Mosaic'], map: { hBlocks: { i: 1, n: ['horizontal blocks'] }, vBlocks: { i: 2, n: ['vertical blocks'] } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Vignette', to: 'vignette', match: ['CC Vignette'], map: { amount: { n: ['amount'] } } },
  { vendor: ADOBE, plugin: 'Noise / Add Grain', to: 'noise', match: ['ADBE Noise', 'ADBE Add Grain', 'ADBE Noise2', 'ADBE Match Grain'], map: { amount: { n: ['amount of noise', 'intensity', 'amount'], conv: pct } } },
  { vendor: ADOBE, plugin: 'Find Edges', to: 'findEdges', match: ['ADBE Find Edges'], map: { invert: { n: ['invert'] }, blend: { n: ['blend with original'] } } },
  { vendor: ADOBE, plugin: 'Strobe Light', to: 'strobe', match: ['ADBE Strobe Light'],
    map: { color: { n: ['strobe color'] } },
    post: (out, raw) => {
      const period = raw('strobe period (secs)');
      const dur = raw('strobe duration (secs)');
      if (period > 0) out.frequency = 1 / period;
      if (period > 0 && dur > 0) out.duration = Math.min(100, (dur / period) * 100);
      const blend = raw('blend with original');
      if (blend != null) out.blend = 100 - blend;
    } },
  { vendor: ADOBE, plugin: 'Echo', to: 'echo', match: ['ADBE Echo'],
    map: { time: { n: ['echo time (seconds)', 'echo time'] }, count: { n: ['number of echoes'] }, start: { n: ['starting intensity'] }, decay: { n: ['decay'] } } },
  { vendor: ADOBE, plugin: 'Posterize Time', to: 'posterizeTime', match: ['ADBE Posterize Time'], map: { fps: { n: ['frame rate'] } } },
  { vendor: ADOBE, plugin: 'Timewarp', to: 'twixtor', match: ['ADBE Timewarp'], map: { speed: { n: ['speed'] } } },
  { vendor: ADOBE, plugin: 'Transform', to: 'transform', match: ['ADBE Geometry2', 'ADBE Geometry'],
    map: { scale: { i: 3, n: ['uniform scale', 'scale height', 'scale'] }, rotation: { i: 8, n: ['rotation'] }, opacity: { i: 9, n: ['opacity'] } } },
  { vendor: ADOBE, plugin: 'Linear Wipe', to: 'linearWipe', match: ['ADBE Linear Wipe'], map: { completion: { n: ['transition completion'] }, angle: { n: ['wipe angle'] }, feather: { n: ['feather'] } } },
  { vendor: ADOBE, plugin: 'Radial Wipe', to: 'radialWipe', match: ['ADBE Radial Wipe'], map: { completion: { n: ['transition completion'] }, start: { n: ['start angle'] }, direction: { n: ['wipe'], conv: (v) => (v === 2 ? 2 : 1) }, feather: { n: ['feather'], conv: (v) => v / 10 } } },
  { vendor: ADOBE, plugin: 'Venetian Blinds', to: 'blinds', match: ['ADBE Venetian Blinds'], map: { completion: { n: ['transition completion'] }, direction: { n: ['direction'] }, width: { n: ['width'] } } },
  { vendor: ADOBE, plugin: 'Block Dissolve', to: 'blockDissolve', match: ['ADBE Block Dissolve'], map: { completion: { n: ['transition completion'] }, block: { n: ['block width'] } } },
  { vendor: ADOBE, plugin: 'Lens Flare', to: 'lensFlare', match: ['ADBE Lens Flare'], map: { brightness: { n: ['flare brightness'] } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Light Rays / Light Burst', to: 'lightRays', match: ['CC Light Rays', 'CC Light Burst 2.5'], map: { intensity: { n: ['intensity'], conv: (v) => v / 50 }, length: { n: ['radius', 'ray length'], conv: (v) => Math.min(100, v / 2) }, color: { n: ['color'] } } },

  // ---------------------------------------------------------------- palavras-chave (aproximação)
  ...[
    [/glow|bloom/i, 'glow'], [/shake|wiggle|jitter/i, 'shake'], [/chromatic|rgb ?split|channel ?shift|aberration/i, 'rgbSplit'],
    [/glitch|datamosh/i, 'glitch'], [/flare/i, 'lensFlare'], [/radial ?blur|zoom ?blur|spin ?blur/i, 'radialBlur'], [/motion ?blur/i, 'motionBlur'],
    [/blur/i, 'blur'], [/vhs|retro/i, 'vhs'], [/vignette/i, 'vignette'], [/grain|noise/i, 'noise'], [/tint|duotone/i, 'tint'],
    [/shadow/i, 'dropShadow'], [/stroke|outline/i, 'outline'], [/tile/i, 'motionTile'], [/strobe|flash|flicker/i, 'strobe'],
    [/prism/i, 'prism'], [/rays|shine/i, 'lightRays'], [/wave/i, 'waveWarp'], [/leak/i, 'lightLeak'], [/twirl|swirl/i, 'twirl'],
    [/kaleid/i, 'kaleida'], [/mirror/i, 'mirror'], [/pixel|mosaic/i, 'mosaic'], [/exposure/i, 'exposure'], [/curves|levels/i, 'levels'],
    [/color ?grade|lut|look/i, 'colorGrade'], [/speed|velocity|time ?remap/i, 'twixtor'], [/echo|trail/i, 'echo'],
  ].map(([test, to]) => ({ vendor: 'Desconhecido', plugin: 'por palavra-chave', to, test, keyword: true })),
];

const normalize = (s) => (s || '').toLowerCase().trim();

/**
 * Identifica um efeito do AE. Retorna { rule, def, kind } com kind:
 * 'native' (match name nativo da Adobe/CC), 'plugin' (plugin de terceiro reconhecido) ou 'approx' (palavra-chave).
 */
export function matchEffect(matchName, displayName = '') {
  const mn = normalize(matchName);
  for (const rule of IMPORT_RULES) {
    if (rule.match?.some((m) => normalize(m) === mn)) return { rule, def: EFFECT_MAP[rule.to], kind: 'native' };
  }
  const hay = `${matchName || ''} ${displayName || ''}`;
  for (const rule of IMPORT_RULES) {
    if (rule.test && rule.test.test(hay) && EFFECT_MAP[rule.to]) return { rule, def: EFFECT_MAP[rule.to], kind: rule.keyword ? 'approx' : 'plugin' };
  }
  return null;
}

/** Encontra o parâmetro do .ffx correspondente a uma entrada do map (nome exato > nome contido > índice). */
export function findParam(params, mapping, fallbackNames = []) {
  const names = [...(mapping?.n || []), ...fallbackNames].map(normalize).filter(Boolean);
  for (const n of names) {
    const hit = params.find((p) => normalize(p.name) === n);
    if (hit) return hit;
  }
  // índice antes de nome parcial: funciona com After Effects em outros idiomas (ex.: alemão)
  if (mapping?.i != null) {
    const hit = params.find((p) => p.index === mapping.i);
    if (hit) return hit;
  }
  for (const n of mapping?.n || []) {
    const hit = params.find((p) => normalize(p.name).includes(normalize(n)));
    if (hit) return hit;
  }
  return null;
}
