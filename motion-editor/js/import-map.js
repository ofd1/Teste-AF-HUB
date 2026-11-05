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
const HSL_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
const HSL_KEYS = HSL_NAMES.flatMap((k) => ['H', 'S', 'L'].map((c) => `hsl${k}${c}`));

export function looksFromTools(tools, strength = 100) {
  const p = {
    strength, exposure: 0, temperature: 0, tint: 0, filter: [1, 1, 1, 1], filterDensity: 0,
    liftR: 0, liftG: 0, liftB: 0, gammaR: 1, gammaG: 1, gammaB: 1, gainR: 1, gainG: 1, gainB: 1,
    hue: 0, saturation: 100, contrast: 0, mojo: 0, mojoCool: 50, mojoSkin: 50, punch: 0, bleach: 0, fade: 0,
    vignette: 0, vignetteSize: 50, diffusion: 0, diffusionRadius: 60, diffusionThreshold: 60, chroma: 0,
    spotExposure: 0, spotColor: [1, 1, 1, 1], spotCenter: [0.5, 0.5], spotSize: 50, spotSoft: 50, spotAspect: 1, spotInvert: false,
    optDensity: 0, optSize: 50, optHighlights: 50, optGlow: 0, edgeCenter: [0.5, 0.5], edgeAspect: 1,
    mixR: [1, 0, 0], mixG: [0, 1, 0], mixB: [0, 0, 1], mixAmt: 0,
    gradExposure: 0, gradAngle: 0, gradOffset: 0, gradSoft: 0.5, gradColor: [1, 1, 1, 1],
    edgeBlur: 0, edgeSize: 100, edgeSoft: 50,
    anamSize: 0, anamBoost: 1, anamThreshold: 70, hazeExposure: -99, hazeSoftness: 60, hazeSpill: 50, lensDistort: 0, lensFlatten: 0,
  };
  const HSL = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
  for (const k of HSL) { p[`hsl${k}H`] = 0; p[`hsl${k}S`] = 0; p[`hsl${k}L`] = 0; }
  let curve = [];
  const used = [], ignored = [], extra = [];
  for (const t of tools) {
    const v = t.values;
    if (!t.enabled) { ignored.push(`${t.id} (desligada)`); continue; }
    switch (t.id) {
      case 'expo': p.exposure += v[0] || 0; break;
      // Contrast (painel do Looks): [Contrast, Pivot, Exposure Compensation] — ex.: -0.035 / 0.2 / 0
      case 'cntr': case 'cont': case 'ctst': case 'cnst': case 'ctrs': case 'contr':
        p.lkContrast = clampN((p.lkContrast || 0) + (v[0] || 0), -1, 2); p.lkPivot = clampN((v[1] ?? 0.18) ** (1 / 2.2), 0, 1); /* pivô do Looks é em luz linear */ p.lkComp = clampN(v[2] || 0, -2, 2); break;
      // Color Blend / filtro (Looks): [R, G, B, Exposure Compensation] — ganhos por canal em luz linear
      case 'fltr': {
        const ec = 2 ** (v[3] || 0);
        if ([0, 1, 2].every((i) => Math.abs((v[i] ?? 1) - 1) < 0.005) && !v[3]) { ignored.push('fltr (neutro)'); continue; }
        ['R', 'G', 'B'].forEach((c, i) => { p[`gain${c}`] *= Math.max(0, (v[i] ?? 1) * ec) ** (1 / 2.2); });
        break;
      }
      // Vignette (Looks): [Center X, Center Y, Size, Softness, Falloff, Amount, Exposure Comp., R, G, B, Aspect]
      case 'vign': p.vignette = Math.max(p.vignette, clampN(v[5] ?? 0, 0, 100) * 0.8); p.vignetteSize = clampN(60 - ((v[2] ?? 1) - 1) * 50, 15, 85); p.exposure += v[6] || 0; break;
      // Gradient (Looks): [X1, Y1, X2, Y2, Falloff, Tint %, Exposure Comp., R, G, B] — tinge em degradê
      case 'grad': {
        const a = clampN((v[5] ?? 0) / 100, 0, 1);
        if (!a) { ignored.push('grad (neutro)'); continue; }
        p.gradTwoPoint = true;
        p.gradP1 = [0.5 + (v[0] || 0) / 100, 0.5 - (v[1] || 0) / 100];
        p.gradP2 = [0.5 + (v[2] || 0) / 100, 0.5 - (v[3] || 0) / 100];
        p.gradSoft = clampN(v[4] ?? 0.5, 0.01, 2);
        p.gradColor = [0, 1, 2].map((i) => 1 + ((v[7 + i] ?? 1) - 1) * a).concat(1);
        p.exposure += v[6] || 0;
        break;
      }
      // Lift-Gamma-Gain: [?, Strength, Exposure, Lift RGB (1 = neutro), Gamma RGB, Gain RGB]
      case 'lgg2': case 'lggn': {
        const k = (v[1] ?? 100) / 100;
        ['R', 'G', 'B'].forEach((c, i) => {
          p[`lift${c}`] += ((v[3 + i] ?? 1) - 1) * k;
          p[`gamma${c}`] *= 1 + ((v[6 + i] ?? 1) - 1) * k;
          p[`gain${c}`] *= 1 + ((v[9 + i] ?? 1) - 1) * k;
        });
        p.exposure += (v[2] || 0) * k;
        break;
      }
      // 3-Way Color Corrector: [?, ?, ?, Saturation, Lift RGB, Gamma RGB, Gain RGB]
      case '3wcc':
        ['R', 'G', 'B'].forEach((c, i) => { p[`lift${c}`] += (v[4 + i] ?? 1) - 1; p[`gamma${c}`] *= v[7 + i] ?? 1; p[`gain${c}`] *= v[10 + i] ?? 1; });
        if (v[3] !== undefined) p.saturation *= clampN(v[3], 0, 300) / 100;
        break;
      // Black & White: pesos R, G, B do mono
      case 'mono': { const w = [v[0] ?? 0.3, v[1] ?? 0.59, v[2] ?? 0.11]; p.mixR = w; p.mixG = w.slice(); p.mixB = w.slice(); p.mixAmt = 1; break; }
      // Film Grain: [?, Amount] → efeito de grão separado
      case 'fgrn': if ((v[1] || 0) > 0) extra.push({ type: 'noise', label: 'Looks · Film Grain', params: { amount: clampN((v[1] || 0) * 8, 0, 100), size: 1.2, animated: true, color: false } }); break;
      // Pop / Clarity: contraste local → nitidez de raio largo
      case 'popt': if (v[0]) extra.push({ type: 'sharpen', label: 'Looks · Pop', params: { amount: clampN(Math.abs(v[0]), 0, 500), radius: clampN((v[1] ?? 100) / 33, 1, 20), threshold: 0, lumaOnly: true } }); break;
      case 'pop2': if (v[0]) extra.push({ type: 'sharpen', label: 'Looks · Pop', params: { amount: clampN(Math.abs(v[0]), 0, 500), radius: Math.max(1, (v[1] ?? 100) / 25), threshold: 0, lumaOnly: true } }); break;
      case 'Clar': case 'clar': if (v[0]) extra.push({ type: 'sharpen', label: 'Looks · Clarity', params: { amount: clampN(Math.abs(v[0]) * 20, 0, 500), radius: 6, threshold: 0, lumaOnly: true } }); break;
      // Bleach Bypass (negativo / cópia): [Silver %, Exposure Compensation] → menos cor e mais contraste
      case 'blby': case 'nbby': {
        const sv = clampN((v[0] ?? 100) / 100, 0, 1);
        p.saturation *= 1 - sv * 0.55; p.contrast += sv * 22; p.exposure += v[1] || 0;
        break;
      }
      // Lightflex: [Flash (stops), Exposure, R, G, B] — "flash" de luz colorida que levanta as sombras
      case 'flex': {
        const f = 2 ** (v[0] ?? -4);
        ['R', 'G', 'B'].forEach((c, i) => { p[`lift${c}`] += clampN(f * Math.max(0, v[2 + i] ?? 1) * 0.35, 0, 0.3); });
        p.exposure += v[1] || 0;
        break;
      }
      // Telecine Net: [?, Density, Exposure Compensation]
      case 'tele': p.exposure += v[2] || 0; p.fade += clampN((v[1] || 0) * 20, 0, 20); break;
      // Film Print: [Stock, Temperature, Tint, Exposure, Contrast, Saturation, Skin Tone, Vintage, Grain, Strength]
      case 'filp': {
        const k = (v[9] ?? 100) / 100;
        p.temperature += (v[1] || 0) * k; p.tint += (v[2] || 0) * k; p.exposure += (v[3] || 0) * k;
        p.contrast += (v[4] || 0) * k; p.saturation *= 1 + ((v[5] ?? 100) / 100 - 1) * k; p.fade += (v[7] || 0) * 0.3 * k;
        p.mojoSkin = clampN(p.mojoSkin + (v[6] || 0) * 0.3, 0, 100);
        if ((v[8] || 0) > 0) extra.push({ type: 'noise', label: 'Looks · Film Print grain', params: { amount: clampN(v[8] * 0.22, 0, 40), size: 1.2, animated: true, color: false } });
        break;
      }
      // Film Negative: [Film Stock, Temperature, Tint, Exposure, Contrast, Saturation, Vintage/Modern, Grain, Strength]
      case 'filn': {
        const k = (v[8] ?? 100) / 100;
        p.temperature += (v[1] || 0) * k; p.tint += (v[2] || 0) * k; p.exposure += (v[3] || 0) * k;
        p.contrast += (v[4] || 0) * k; p.saturation *= 1 + ((v[5] ?? 100) / 100 - 1) * k; p.fade += (v[6] || 0) * 0.3 * k;
        if ((v[7] || 0) > 0) extra.push({ type: 'noise', label: 'Looks · Film Negative grain', params: { amount: clampN(v[7] * 0.22, 0, 40), size: 1.2, animated: true, color: false } });
        break;
      }
      // Auto Shoulder só age em valores acima do branco: sem efeito em 8 bits
      case 'ashl': break;
      // Shoulder: [Rolloff Start, Brightest Value, Strength] — comprime os realces a partir de Rolloff Start
      case 'shol': { const st = clampN(v[0] ?? 0.8, 0.05, 1), k = (v[2] ?? 100) / 100; if (st < 0.98) for (const c of ['R', 'G', 'B']) p[`gain${c}`] *= 1 - (1 - st) * 0.35 * k; p.contrast -= (1 - st) * 12 * k; break; }
      // Renoiser: [Sharpen, Sharpen Edges Only, Grain Amount, Size, Texture, Log, Mono, …]
      case 'reno':
        if ((v[2] || 0) > 0) extra.push({ type: 'noise', label: 'Looks · Renoiser', params: { amount: clampN((v[2] || 0) * 0.3, 0, 60), size: clampN(1 + (v[3] ?? 50) / 50, 1, 4), animated: true, color: !v[6] } });
        if ((v[0] || 0) > 0) extra.push({ type: 'sharpen', label: 'Looks · Renoiser sharpen', params: { amount: clampN(v[0], 0, 500), radius: 1.5, threshold: 0, lumaOnly: true } });
        break;
      // Cosmo (pele): [Skin Color, Skin Squeeze, Skin Soften, …] — aproxima a cor da pele e suaviza
      case 'cosm': p.mojoSkin = clampN(p.mojoSkin + (v[1] || 0) * 0.3, 0, 100); break;
      // Color Contrast: [Pivot, Exposure Compensation, R, G, B] — contraste por canal em volta do pivô
      case 'ccon': {
        const piv = clampN(v[0] ?? 0.18, 0.001, 1) ** (1 / 2.2);
        ['R', 'G', 'B'].forEach((c, i) => { const g = v[2 + i] ?? 1; p[`gamma${c}`] *= g > 0 ? 1 / Math.sqrt(g) : 1; p[`gain${c}`] *= 1 + (g - 1) * 0.35; p[`lift${c}`] -= (g - 1) * piv * 0.15; });
        p.exposure += v[1] || 0;
        break;
      }
      // Spot Fill (luz de preenchimento num círculo): [Fill, Center X, Center Y, Radius, Spread, Falloff, Strength, R, G, B, Aspect]
      case 'ssfl':
        p.spotExposure += (v[0] || 0) / 100 * ((v[6] ?? 100) / 100);
        p.spotCenter = [clampN(0.5 + (v[1] || 0) / 100, 0, 1), clampN(0.5 - (v[2] || 0) / 100, 0, 1)];
        p.spotSize = clampN((v[3] ?? 1) * 100, 0, 400); p.spotSoft = clampN((v[4] ?? 0.5) * 100, 1, 400); p.spotAspect = clampN(v[10] ?? 1, 0.1, 4);
        p.spotColor = [v[7] ?? 1, v[8] ?? 1, v[9] ?? 1, 1];
        break;
      // Shadow Fill: [Fill, R, G, B] — levanta as sombras com uma cor
      case 'shfl': ['R', 'G', 'B'].forEach((c, i) => { p[`lift${c}`] += (v[0] || 0) / 100 * 0.25 * (v[1 + i] ?? 1); }); break;
      // 3-Strip (Technicolor de 3 tiras): cores densas e saturadas
      case '3stp': p.saturation *= 1 + (v[0] || 0) / 100 * 0.8; p.contrast += (v[0] || 0) * 0.15; p.exposure += v[1] || 0; break;
      // Mojo (versão 1): [Mojo, Tint, Balance, Warm It, Punch It, Bleach It, Skin Color, Skin Squeeze, …, Strength]
      case 'mojo': { const k = (v[10] ?? 100) / 100; p.mojo = Math.max(p.mojo, (v[0] || 0) * k); p.mojoTint = ((v[1] ?? 50) - 50) * 2 * k; p.punch += (v[4] || 0) * k; p.bleach += (v[5] || 0) * k; p.temperature += (v[3] || 0) * 0.3 * k; break; }
      // Source Space / ajuste de entrada: [Source, Exposure, Contrast, Saturation, White, Black]
      case 'sspc': p.exposure += v[1] || 0; p.contrast += (v[2] || 0) * 30; p.saturation *= (v[3] ?? 100) / 100; break;
      // Shutter Streak e Star: brilhos de realce → Anamorphic Flare do Looks
      case 'strk': p.anamSize = Math.max(p.anamSize, clampN(v[0] || 0, 0, 1000)); p.anamBoost = clampN(2 ** (v[1] || 0), 0, 5); break;
      case 'star': extra.push({ type: 'starGlow', label: 'Looks · Star', params: { threshold: clampN((v[1] ?? 0.5) * 100, 0, 100), amount: clampN(2 ** (v[3] || 0) * 2, 0, 10), angle: v[4] ?? 45 } }); break;
      // Lens Vignette (Looks3.aex): [Vignette (tamanho), Amount, Highlights, Center X, Center Y, Aspect, Anamorphic]
      case 'lenv': p.vignette = Math.max(p.vignette, (v[1] ?? 50) * 0.35); p.vignetteSize = clampN(75 - (v[0] ?? 50) * 0.5, 15, 85); break;
      // Optical Diffusion (manual do Looks): Density, Size, Falloff, Glow, Highlights Only, Luster, Color…
      // Optical Diffusion: [Density/Amount, Size, …, R, G, B (6-8)] — no Looks vira brilho nos realces (medido em renders
      // do AE: raio ≈ Size/2, intensidade ≈ Amount × 1,5 %, limiar ≈ 30 %) além de um leve amaciamento
      case 'odif':
        // Optical Diffusion → Glow/Diffusion com os mesmos números que o Frameify usa para este preset:
        // intensidade = 1,5 × Density, raio = Size ÷ 2, limiar 30 (galego: 34 / 260,6 → 51 / 130,3)
        if ((v[0] || 0) > 0) {
          p.diffusion = Math.max(p.diffusion, (v[0] || 0) * 1.5);
          p.diffusionRadius = Math.max(p.diffusionRadius === 60 ? 0 : p.diffusionRadius, (v[1] ?? 50) / 2);
          p.diffusionThreshold = 30;
        }
        break;
      case 'diff':
        // Diffusion (Looks3.aex): [Size, Grade, Glow, Highlights Only, Highlight Bias, Exposure Comp., R, G, B]
        // escala medida em renders do AE: raio ≈ 2,29 × Size px, intensidade ≈ 22,75 × Grade × Glow/100 %,
        // limiar ≈ 78,75 + 0,625 × (Highlights Only − 75) − 8,1 × Bias. Size < 2 só levanta os realces (compensação).
        if (v[0] >= 2 && v.length >= 9) {
          p.diffusion = Math.max(p.diffusion, 22.75 * (v[1] ?? 1) * ((v[2] ?? 100) / 100));
          p.diffusionRadius = Math.max(p.diffusionRadius, 2.29 * v[0]);
          p.diffusionThreshold = clampN(78.75 + 0.625 * ((v[3] ?? 75) - 75) - 8.1 * (v[4] || 0), 0, 100);
          p.exposure += v[5] || 0;
        } else if (v[0] < 2) p.exposure += v[5] || 0; // Diffusion tão pequeno só levanta os realces (o Frameify usa a compensação inteira)
        break;
      // Chromatic Aberration: [Red/Cyan, Green/Magenta, Blue/Yellow]
      // ajustado aos pares .ffx/.frameify (galego [−1,06, 0, 1] → 6,1; ftb [0,73, 0, −0,5] → 3,9)
      case 'chab': p.chroma += (Math.abs(v[0] || 0) + (Math.abs(v[1] || 0) + Math.abs(v[2] || 0)) * 0.48) * 4; break;
      // Hue/Saturation (Looks): [Hue, Saturation %, pesos de luma] — valor direto, como o Frameify (galego 65 → 65%)
      case 'husa': { const f = (v[1] ?? 100) / 100; p.hue += v[0] || 0; p.saturation *= f; break; }
      case 'mjo2':
        // Mojo II (ordem real, tirada do Looks3.aex): [Mojo, Tint, Punch, Bleach, Fade, Blue Squeeze, Skin Squeeze,
        // Exposure, Cool/Warm, Green/Magenta, Skin Yellow/Pink, Strength]
        // ex.: Vampy CC = Bleach 85 + Cool/Warm −40 (fria) + Exposure +0,3 → cor apagada e azulada
        {
          const k = (v[11] ?? 100) / 100;
          p.mojo = Math.max(p.mojo, (v[0] || 0) * k);
          p.punch += (v[2] || 0) * k;
          p.bleach += (v[3] || 0) * k;
          p.fade += (v[4] || 0) * 0.5 * k; // Fade It: levanta os pretos
          if (v[5] > 0) p.mojoCool = clampN(50 + v[5], 0, 100);
          if (v[6] > 0) p.mojoSkin = clampN(50 + v[6], 0, 100);
          p.exposure += (v[7] || 0) * k;
          p.temperature -= (v[8] || 0) * 0.35 * k; // Cool/Warm do Mojo II: negativo = quente (como o Warm/Cool do Looks)
          p.tint -= (v[9] || 0) * 0.5 * k; // Green/Magenta positivo deixa esverdeado no AE (ZAZ Dark: cinza-esverdeado)
          p.mojoTint = (v[1] || 0) * k;
        }
        break;
      // Haze/Flare (manual: Spillage, Softness, …, Exposure, …, cor): luz que vaza dentro da lente + leve névoa
      case 'haze':
        p.hazeSpill = clampN(v[0] ?? 50, 0, 100); p.hazeSoftness = clampN(v[1] ?? 60, 0, 100);
        // Haze/Flare (nomes dos .rgx): [Spillage, Softness, Reach, Exposure, Reflection Exposure, Reflection, Matte Box Size, Matte Box Shade, Tint RGB]
        p.hazeExposure = clampN(v[3] ?? -1, -10, 4); p.hazeTint = [v[8] ?? 1, v[9] ?? 1, v[10] ?? 1, 1]; p.hazeReach = clampN(v[2] ?? 50, 0, 100);
        break;
      // Anamorphic Flare (manual: Size, Boost, Threshold, …, cor)
      // Anamorphic Flare (Looks3.aex): [Size, Threshold, Threshold Softness, Boost, Reflection, Reflection Boost, …]
      case 'anam': p.anamSize = clampN(v[0] || 0, 0, 1000); p.anamThreshold = clampN(((v[1] ?? 0.7) - (v[2] || 0) * 0.5) * 100, 0, 100); p.anamBoost = clampN(v[3] ?? 1, 0, 5); break;
      // Lens Distortion (manual: Distortion, Flatten)
      case 'lnsd': p.lensDistort = clampN(v[0] || 0, -100, 100); p.lensFlatten = clampN(v[1] || 0, 0, 100); break;
      case 'csta': {
        // Colorista: [?, Strength, Exposure, Lift RGB, Gamma RGB, Gain RGB, Saturation, HSL de 8 cores…, Sat×Lum, Sat×Sat,
        // Temperature (216), Tint (217), Contrast (218)] — tudo pesado pelo Strength
        const k = clampN((v[1] ?? 100) / 100, 0, 1);
        ['R', 'G', 'B'].forEach((c, i) => {
          p[`lift${c}`] += ((v[3 + i] ?? 1) - 1) * 0.6 * k;
          p[`gamma${c}`] *= 1 + ((v[6 + i] ?? 1) - 1) * k;
          p[`gain${c}`] *= 1 + ((v[9 + i] ?? 1) - 1) * k;
        });
        p.exposure += (v[2] || 0) * 0.25 * k;
        if (v[12] !== undefined) p.saturation *= 1 + (clampN(v[12], 0, 300) / 100 - 1) * k;
        HSL.forEach((c, i) => {
          p[`hsl${c}H`] += (v[13 + i] || 0) * k;
          p[`hsl${c}S`] += (v[21 + i] || 0) * k;
          p[`hsl${c}L`] += (v[29 + i] || 0) * k;
        });
        // curvas Sat × Lum (202-208) e Sat × Sat (209-215), confirmadas nos presets .rgx
        if (v.length > 215 && v.slice(202, 216).some((x) => Math.abs(x || 0) > 1e-4)) {
          p.satLum = (p.satLum || [0, 0, 0, 0, 0, 0, 0]).map((x, i) => clampN(x + (v[202 + i] || 0) * k, -1, 2));
          p.satSat = (p.satSat || [0, 0, 0, 0, 0, 0, 0]).map((x, i) => clampN(x + (v[209 + i] || 0) * k, -1, 2));
        }
        p.temperature += (v[216] || 0) * k;
        p.tint += (v[217] || 0) * k;
        p.contrast += (v[218] || 0) * 30 * k;
        break;
      }
      case 'crv2': case 'curv': {
        // Curves (ordem dos Looks do MBL): por canal (1 = RGB, 2 = R, 3 = G, 4 = B): Contrast, Shadows, Midtones,
        // Highlights, Point 1-5; depois Gamma Space (36) e os pontos livres (37 = quantidade, 38… pares entrada/ajuste)
        // v[0] = Contrast da curva. Calibrado com a tabela que o Frameify gera para a mesma ferramenta (Look Table
        // de 1024 pontos): 0,932 → curva em S ≈ 58% de um smoothstep (0,25→0,19; 0,75→0,82) = contraste ~48 aqui
        p.contrast += (v[0] || 0) * 52;
        const ch = ['', 'R', 'G', 'B'];
        for (let c = 0; c < 4; c++) {
          const b = c * 9, sh = v[b + 1] || 0, mi = v[b + 2] || 0, hi = v[b + 3] || 0;
          const keys = c === 0 ? ['R', 'G', 'B'] : [ch[c]];
          for (const k of keys) { p[`lift${k}`] += sh * 0.25; p[`gamma${k}`] *= 1 + mi * 0.6; p[`gain${k}`] *= 1 + hi * 0.35; }
          if (c > 0 && v[b] && v[b] !== 0) for (const k of keys) p[`gain${k}`] *= 1 + v[b] * 0.1;
        }
        const n = Math.min(4, Math.round(v[37] || 0));
        for (let i = 0; i < n; i++) curve.push([v[38 + i * 2], v[39 + i * 2] || 0]);
        if (!n) for (let i = 0; i < 5; i++) if (Math.abs(v[4 + i] || 0) > 1e-4) curve.push([(i + 1) / 6, v[4 + i]]);
        break;
      }
      // Channel Mixer: [Normalize, Strength, Monochrome, —, RGB R/G/B (pesos do mono), Red R/G/B, Green R/G/B, Blue R/G/B]
      case 'cmix': {
        const norm = (v[0] ?? 100) / 100;
        // Normalize: cada linha passa a somar 1 subtraindo a diferença igualmente dos três canais (não dividindo pela soma —
        // dividir invertia linhas como [−1, −0,5, 0] e apagava o azul)
        const row = (a, b, c, def) => { const r = [v[a] ?? def[0], v[b] ?? def[1], v[c] ?? def[2]]; const d = (r[0] + r[1] + r[2] - 1) / 3; return r.map((x) => x - d * norm); };
        if (v[2] >= 0.5) { const w = row(4, 5, 6, [0.213, 0.715, 0.072]); p.mixR = w; p.mixG = w.slice(); p.mixB = w.slice(); }
        else { p.mixR = row(7, 8, 9, [1, 0, 0]); p.mixG = row(10, 11, 12, [0, 1, 0]); p.mixB = row(13, 14, 15, [0, 0, 1]); }
        p.mixAmt = clampN((v[1] ?? 100) / 100, 0, 1);
        break;
      }
      // Saturation: [Saturation %, Exposure Compensation]
      // (a compensação de exposição do Saturation compensa o escurecimento do Looks em luz linear; aqui não escurece)
      case 'satu': p.saturation *= (v[0] ?? 100) / 100; break;
      // Warm/Cool: [Warm/Cool (−1..1), Tint, Exposure Compensation]
      // (em stops por canal, luz linear: R = −W−T+E, G = T+E, B = W+E — Warm/Cool negativo esquenta)
      case 'wmcl': { const w = v[0] || 0, t = v[1] || 0, e = v[2] || 0; [-w - t + e, t + e, w + e].forEach((st, i) => { p[`gain${'RGB'[i]}`] *= 2 ** (st / 2.2); }); break; }
      // Shadows/Highlights: [Shadows 0..1 (abre as sombras), Highlights −1..0 (segura os realces)]
      case 'shad': for (const k of ['R', 'G', 'B']) { p[`lift${k}`] += (v[0] || 0) * 0.12; p[`gain${k}`] *= 1 + (v[1] || 0) * 0.15; } break;
      // HSL Colors: [Master Hue, Master Sat, Master Lum, Hue R..M, Sat R..M, Lum R..M]
      case 'rhsl':
        p.hue += v[0] || 0; p.saturation *= 1 + (v[1] || 0) / 100; p.exposure += (v[2] || 0) / 100;
        HSL.forEach((k, i) => { p[`hsl${k}H`] += v[3 + i] || 0; p[`hsl${k}S`] += v[11 + i] || 0; p[`hsl${k}L`] += v[19 + i] || 0; });
        break;
      // 4-Way Color: [Exposure, Contrast, Strength, Highlight RGB+Sat, Midtone RGB+Sat, Shadow RGB+Sat, Master RGB+Sat, …] (cores: 0,5 = neutro)
      // 4-Way Color (nomes confirmados nos presets .rgx do Looks): [Exposure, Contrast, Strength,
      // Highlight R G B Sat, Midtone R G B Sat, Shadow R G B Sat, Master R G B Sat, Midpoint, Width, …] — cores: 0,5 = neutro
      case '4way': {
        const k = (v[2] ?? 100) / 100, o = (i) => ((v[i] ?? 0.5) - 0.5) * 2 * k;
        p.exposure += (v[0] || 0) * k; p.contrast += (v[1] || 0) * k;
        ['R', 'G', 'B'].forEach((c, i) => {
          p[`gain${c}`] *= 1 + o(3 + i) * 0.5 + o(15 + i) * 0.5;
          p[`gamma${c}`] *= 1 + o(7 + i) * 0.6 + o(15 + i) * 0.3;
          p[`lift${c}`] += o(11 + i) * 0.25 + o(15 + i) * 0.1;
        });
        p.saturation *= 1 + (((v[6] ?? 100) + (v[10] ?? 100) + (v[14] ?? 100)) / 3 / 100 - 1) * k * 0.7 + ((v[18] ?? 100) / 100 - 1) * k;
        break;
      }

      // Duotone: [Highlight RGB, Highlight Tint, Shadow RGB, Shadow Tint, Balance]
      case 'duto': ['R', 'G', 'B'].forEach((c, i) => { p[`gain${c}`] *= 1 + ((v[i] ?? 1) - 1) * ((v[3] || 0) / 100) * 0.6; p[`lift${c}`] += ((v[4 + i] ?? 1) - 1) * ((v[7] || 0) / 100) * 0.25; }); break;
      // Two Strip (Technicolor de 2 tiras): laranja/ciano forte, pele quente — não dessatura
      // Two Strip (Technicolor de 2 tiras): laranja/ciano forte, pele quente (mantido: mais perto dos prints de referência)
      // Two Strip (Technicolor de 2 tiras): [Strength %, Exposure]. Só existem os registros vermelho e verde: o azul vira
      // a média de verde+azul → pele rosada/natural, azuis e verdes viram ciano (não é um Mojo laranja)
      case '2stp': p.twoStrip = clampN((p.twoStrip || 0) + (v[0] || 0), 0, 100); p.exposure += v[1] || 0; break;
      // S Curve: [Contrast (1 = neutro), Midpoint, Brightness (0,5 = neutro), Black Point, White Point, Log]
      case 'logc':
        p.contrast += clampN(((v[0] ?? 1) - 1) * 25, -60, 80);
        p.exposure += Math.log2(Math.max(0.05, (v[2] ?? 0.5) / 0.5)) * 0.5;
        p.fade += (v[3] || 0) * 60;
        break;
      case 'spex':
        // Spot Exposure (Looks3.aex): [Stops, Center X, Center Y, Radius, Spread, Falloff, Strength, R, G, B, Aspect, Invert]
        p.spotExposure += (v[0] || 0) * ((v[6] ?? 100) / 100);
        p.spotCenter = [clampN(0.5 + (v[1] || 0) / 100, 0, 1), clampN(0.5 - (v[2] || 0) / 100, 0, 1)];
        p.spotSize = clampN((v[3] ?? 1) * 100, 0, 400);
        p.spotSoft = clampN(Math.max(0.05, v[4] ?? 0.5) * 100, 1, 400);
        p.spotColor = [v[7] ?? 1, v[8] ?? 1, v[9] ?? 1, 1];
        p.spotAspect = clampN(v[10] ?? 1, 0.1, 4);
        p.spotInvert = !!v[11];
        break;
      case 'grex':
        // Grad Exposure (painel do Looks): [Stops, X1 %, Y1 %, X2 %, Y2 %, Falloff, Strength, Color Balance RGB (7-9)]
        // Pontos em % a partir do centro (Y para cima). Stops 0 com cor preta = escurece em degradê (filtro ND).
        {
          const col = [v[7] ?? 1, v[8] ?? 1, v[9] ?? 1]; // cor preta = filtro ND em degradê (escurece o topo, como no AE)
          if (!v[0] && col.every((c) => Math.abs(c - 1) < 0.005)) { ignored.push('grex (neutro)'); continue; }
          p.gradTwoPoint = true;
          p.gradExposure = clampN((p.gradTwoPoint && p.gradExposure ? p.gradExposure : 0) + (v[0] || 0), -4, 4);
          p.gradP1 = [0.5 + (v[1] || 0) / 100, 0.5 - (v[2] || 0) / 100];
          p.gradP2 = [0.5 + (v[3] || 0) / 100, 0.5 - (v[4] || 0) / 100];
          p.gradSoft = clampN(v[5] ?? 0.5, 0.01, 2);
          p.gradColor = [...col.map((c) => clampN(c, 0, 4)), 1];
        }
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
  p.diffusionRadius = clampN(p.diffusionRadius, 1, 600); p.chroma = clampN(p.chroma, 0, 20); p.optGlow = clampN(p.optGlow, 0, 200);
  p.spotExposure = clampN(p.spotExposure, -4, 4); p.gradExposure = clampN(p.gradExposure, -4, 4); p.edgeBlur = clampN(p.edgeBlur, 0, 100);
  return { params: p, used, ignored, extra };
}

// Nomes das ferramentas do Magic Bullet Looks (id interno → nome no Looks)
const LOOKS_TOOL_NAMES = {
  expo: 'Exposure', cntr: 'Contrast', cont: 'Contrast', fltr: 'Color Filter', vign: 'Vignette', grad: 'Gradient', lgg2: 'Lift-Gamma-Gain', lggn: 'Lift-Gamma-Gain',
  '3wcc': '3-Way Color', mono: 'Black & White', fgrn: 'Film Grain', popt: 'Pop', pop2: 'Pop', Clar: 'Clarity', clar: 'Clarity', blby: 'Bleach Bypass', nbby: 'Bleach Bypass',
  flex: 'Lightflex', tele: 'Telecine Net', filp: 'Film Print', filn: 'Film Negative', ashl: 'Shoulder', shol: 'Shoulder', reno: 'Renoiser', cosm: 'Cosmetic Cleanup',
  ccon: 'Color Contrast', ssfl: 'Shutter Streak', shfl: 'Shutter Streak', '3stp': '3-Strip Process', mojo: 'Mojo', sspc: 'Spot Exposure', strk: 'Streaks', star: 'Star',
  lenv: 'Lens Vignette', odif: 'Optical Diffusion', diff: 'Diffusion', chab: 'Chromatic Aberration', husa: 'Hue/Saturation', mjo2: 'Mojo II', haze: 'Haze/Flare',
  anam: 'Anamorphic Flare', lnsd: 'Lens Distortion', csta: 'Colorista', crv2: 'Curves (Look Table)', curv: 'Curves', cmix: 'Channel Mixer', satu: 'Saturation',
  wmcl: 'Warm/Cool', shad: 'Shadows & Highlights', rhsl: 'Ranged HSL', '4way': '4-Way Color', duto: 'Duotone', '2stp': 'Two Strip', logc: 'S Curve', spex: 'Spot Exposure',
  grex: 'Grad Exposure', edgs: 'Edge Softness',
};
const LOOKS_BASE = looksFromTools([], 100).params;
const sameV = (a, b) => (Array.isArray(a) ? a.every((x, i) => Math.abs(x - b[i]) < 1e-6) : typeof a === 'number' ? Math.abs(a - b) < 1e-6 : a === b);
const only = (changed, keys) => changed.every((k) => keys.includes(k));
/**
 * Uma ferramenta do Looks → o efeito de ferramenta do MotionFrame (mesma ordem e valores do arquivo).
 * Quando a ferramenta mexe em algo que a ferramenta dedicada não tem, vira um "Looks › nome" só com os valores dela.
 */
export function looksToolEffect(t, strength) {
  const { params: q, extra } = looksFromTools([t], strength);
  const changed = Object.keys(q).filter((k) => k !== 'strength' && (LOOKS_BASE[k] === undefined ? !(typeof q[k] === 'number' && (q[k] === 0 || q[k] === -1)) : !sameV(q[k], LOOKS_BASE[k])));
  const name = LOOKS_TOOL_NAMES[t.id] || t.id;
  const str = strength;
  let e = null;
  if (!changed.length) e = null;
  else if (only(changed, ['saturation'])) e = { type: 'lkSaturation', params: { str, sat: q.saturation, vib: 0 } };
  else if (only(changed, ['saturation', 'hue'])) e = { type: 'lkHLS', params: { str, hue: q.hue, light: 0, sat: q.saturation / 100 - 1 } };
  else if (only(changed, ['exposure'])) e = { type: 'lkExposure', params: { str, stops: q.exposure, con: 0, pivot: 50, gamma: 1 } };
  else if (only(changed, ['vignette', 'vignetteSize'])) e = { type: 'lkLensVignette', params: { str, amount: q.vignette, size: q.vignetteSize } };
  else if (only(changed, ['diffusion', 'diffusionRadius', 'diffusionThreshold'])) e = { type: 'lkDiffusion', params: { str, amount: q.diffusion, radius: q.diffusionRadius, threshold: q.diffusionThreshold } };
  else if (only(changed, ['chroma'])) e = { type: 'lkChroma', params: { str, amount: q.chroma } };
  else if (only(changed, ['edgeBlur', 'edgeSize', 'edgeSoft', 'edgeCenter', 'edgeAspect'])) e = { type: 'lkEdgeSoftness', params: { str, blur: q.edgeBlur, size: q.edgeSize, soft: q.edgeSoft, center: q.edgeCenter } };
  else if (only(changed, ['hazeExposure', 'hazeSpill', 'hazeSoftness', 'hazeReach', 'hazeTint'])) e = { type: 'lkHaze', params: { str, exposure: q.hazeExposure, spill: q.hazeSpill, soft: q.hazeSoftness, reach: q.hazeReach ?? 50, tint: q.hazeTint || [1, 0.92, 0.82, 1] } };
  else if (only(changed, ['anamSize', 'anamBoost', 'anamThreshold'])) e = { type: 'lkAnamorphic', params: { str, size: q.anamSize, boost: q.anamBoost, threshold: q.anamThreshold, color: [0.35, 0.6, 1, 1] } };
  else if (only(changed, ['spotExposure', 'spotCenter', 'spotSize', 'spotSoft', 'spotInvert'])) e = { type: 'lkSpotExposure', params: { str, stops: q.spotExposure, center: q.spotCenter, size: q.spotSize, soft: q.spotSoft, invert: q.spotInvert } };
  else if (only(changed, ['gradTwoPoint', 'gradExposure', 'gradColor', 'gradP1', 'gradP2', 'gradSoft'])) e = { type: 'lkGradient', params: { str, stops: q.gradExposure, color: q.gradColor, p1: q.gradP1 || [0.5, 0], p2: q.gradP2 || [0.5, 0.5], soft: q.gradSoft } };
  else if (only(changed, ['temperature', 'tint'])) e = { type: 'lkTempTint', params: { str, temp: q.temperature, tint: q.tint } };
  else if (only(changed, ['mixR', 'mixG', 'mixB', 'mixAmt'])) e = { type: 'lkChannelMixer', params: { str: str * q.mixAmt, rr: q.mixR[0], rg: q.mixR[1], rb: q.mixR[2], gr: q.mixG[0], gg: q.mixG[1], gb: q.mixG[2], br: q.mixB[0], bg: q.mixB[1], bb: q.mixB[2] } };
  else if (only(changed, ['mojo', 'mojoCool', 'mojoSkin', 'punch', 'bleach', 'fade', 'mojoTint', 'exposure', 'temperature', 'tint'])) e = { type: 'lkMojo', params: { str, mojo: q.mojo, cool: q.mojoCool, skin: q.mojoSkin, punch: q.punch, bleach: q.bleach, fade: q.fade * 2, mtint: q.mojoTint || 0, exposure: q.exposure, temp: q.temperature, tint: q.tint } };
  else if (only(changed, HSL_KEYS)) e = { type: 'lkColorRanges', params: { str, ...Object.fromEntries(HSL_NAMES.flatMap((k) => [[`h${k}`, q[`hsl${k}H`]], [`s${k}`, q[`hsl${k}S`]], [`l${k}`, q[`hsl${k}L`]]])) } };
  else {
    // ferramenta que mexe em várias coisas (Mojo II com exposição/temperatura, Curves, Colorista…): Looks só com os valores dela
    const keep = { strength: str };
    for (const k of changed) keep[k] = q[k];
    e = { type: 'looks', params: keep };
  }
  const out = [];
  if (e) out.push({ ...e, label: `${name}`, note: `Looks › ${name}` });
  return [...out, ...extra];
}

function looksExpand(fx, raw) {
  const strength = raw('strength') ?? 100;
  const tools = (fx.looksTools || []).filter((t) => t.enabled);
  if (!tools.length) return [];
  // cada ferramenta do Looks vira um efeito, na ordem do Looks (Subject → Matte → Lens → Camera → Post)
  return tools.flatMap((t) => looksToolEffect(t, strength));
}

export const IMPORT_RULES = [
  // efeitos que apareceram nos projetos do usuário (lumus wm, not sure who i am…)
  { vendor: 'BCC', plugin: 'BCC Hue-Sat-Lightness', to: 'hueSat', test: /bcc.*hue.?sat/i, map: { hue: { n: ['hue', 'master hue'] }, saturation: { n: ['saturation', 'master saturation'] }, lightness: { n: ['lightness', 'master lightness'] } } },
  { vendor: 'Omino', plugin: 'Omino Diffusion', to: 'glow', test: /omino_diffusion/i, map: { radius: { n: ['radius', 'blur radius'] } }, set: { threshold: 40, intensity: 0.6 } },
  { vendor: 'Crossphere', plugin: 'Crossphere Bokeh', to: 'bokeh', test: /crossphere/i },
  { vendor: 'Sapphire', plugin: 'S_ScanLines', to: 'vhs', test: /s_scanlines/i, set: { amount: 100, lines: 60, noise: 0, chroma: 0, jitter: 0 } },
  { vendor: 'Adobe', plugin: 'Linear Color Key', to: 'keylight', test: /linear color key/i },
  { vendor: 'BCC', plugin: 'BCC Grunge', to: 'filmDamage', test: /bcc.*grunge/i, set: { scratches: 20, dust: 40, flicker: 10, jitter: 0, grain: 30, sepia: 0 } },
  { vendor: 'Red Giant Universe', plugin: 'Electrify', to: 'zap', test: /electrify/i },
  { vendor: 'BCC', plugin: 'BCC LED', to: 'halftone', test: /bcc\d*led/i },
  // ---------------------------------------------------------------- plugins de terceiros
  // ---- regras ajustadas com presets reais de edit (sonhei, ftb, galego, ZAZ…)
  { vendor: 'RE:Vision', plugin: 'Twixtor', to: 'twixtor', test: /twixtor/i,
    map: { speed: { i: 5, n: ['speed %', 'speed'] }, frameBlend: { i: 1, n: ['frame interp', 'frame interpolation'], conv: (v) => v >= 2 } } },
  { vendor: 'Red Giant', plugin: 'Magic Bullet Looks', to: 'looks', test: /^MB Look|magic ?bullet ?looks/i, expand: looksExpand },
  { vendor: 'Red Giant', plugin: 'Magic Bullet Colorista / Mojo', to: 'colorGrade', test: /colorista|\bmojo\b/i },
  // Topaz Video AI (plugin do AE, categoria "Topaz Video AI"): efeitos "Enhance" e "Frame Interpolation".
  // Layout lido do próprio plugin: AI Model (Select Model|Proteus|Iris|Nyx|Artemis|Themis|Dione Robust|Dione Robust Dehalo),
  // Input Quality (LQ|MQ|HQ ou LQ|MQ), Output Resolution (Original|2x|4x ou Original|2x), Parameters (Auto|Relative to auto|
  // Manual) e os sliders — cada slider existe duas vezes (absoluto e "relativo ao auto"); o plugin guarda 0–1.
  { vendor: 'Topaz Labs', plugin: 'Topaz Video AI – Frame Interpolation', to: 'topazFI', test: /AEFrameInterpolation|topaz.*frame ?interp|\btvai\b.*interp/i,
    expand: (fx) => {
      const g = (n) => fx.params.find((q) => (q.name || '').toLowerCase().trim() === n)?.value?.[0];
      const slow = g('slowmo') ?? g('slow motion');
      return [{ type: 'topazFI', label: 'Topaz Frame Interpolation', note: 'Slowmo, Model, Remove Duplicate Frames e Sensitivity convertidos', params: {
        slowmo: slow != null ? Math.max(1, Math.min(6, Math.round(slow))) : 2,
        fiModel: g('model') != null ? Math.max(1, Math.min(5, Math.round(g('model')) - 1 || 1)) : 1,
        removeDup: !!(g('remove duplicates frames') ?? g('remove duplicate frames')),
        sensitivity: (() => { const v = g('sensitivity'); return v == null ? 10 : v <= 1 ? v * 100 : v; })(),
      } }];
    } },
  { vendor: 'Topaz Labs', plugin: 'Topaz Video AI – Enhance', to: 'topaz', test: /\bAE_Enhance\b|topaz.*(video ai|enhance)|\btvai\b/i,
    expand: (fx) => {
      const seen = {}, P = {};
      const pct01 = (v) => (Math.abs(v) <= 1.0001 ? v * 100 : v);
      const SL = { 'fix compression': 'compression', 'improve detail': 'details', 'improve details': 'details', sharpen: 'sharpen', 'reduce noise': 'noise', 'reduce large grain': 'largeGrain', dehalo: 'dehalo', 'anti-alias/deblur': 'aa' };
      for (const q of fx.params) {
        const n = (q.name || '').toLowerCase().trim(), v = q.value?.[0];
        if (v == null || typeof v !== 'number') continue;
        seen[n] = (seen[n] || 0) + 1;
        if (n === 'ai model') P.model = Math.max(1, Math.min(7, Math.round(v) - 1 || 1)); // 1 = "Select Model"
        else if (n === 'input quality' && seen[n] === 1) P.inputQuality = Math.max(1, Math.min(3, Math.round(v)));
        else if ((n === 'output resolution' || n === 'scale factor') && seen[n] === 1) P.upscale = Math.max(1, Math.min(3, Math.round(v)));
        else if (n === 'parameters' || n === 'parameter mode') P.paramMode = Math.max(1, Math.min(3, Math.round(v)));
        else if (SL[n]) P[(seen[n] === 1 ? '' : 'ra_') + SL[n]] = Math.round(pct01(v));
        else if (n === 'recover original details' || n === 'recover details') P.recoverOriginal = Math.round(pct01(v));
        else if (n === 'nyx recover details') P.nyxRecover = Math.round(pct01(v));
        else if (n === 'add noise') P.addNoise = Math.min(10, v <= 0.1001 ? v * 100 : v);
        else if (n === 'amount') P.grainAmount = Math.min(10, v <= 0.1001 ? v * 100 : v);
        else if (n === 'size') P.grainSize = Math.max(1, Math.min(5, v));
      }
      if (P.model === undefined) P.model = 1;
      return [{ type: 'topaz', label: 'Topaz Video AI – Enhance', note: `modelo ${P.model}, parâmetros ${['Auto', 'Relative to auto', 'Manual'][(P.paramMode || 1) - 1]}`, params: P }];
    } },
  // Twitch: Amount = intensidade, Speed = frequência (%); quantidades por tipo; Slide com RGB Split e Motion Blur; Time
  { vendor: 'Video Copilot', plugin: 'Twitch', to: 'twitch', test: /twitch/i,
    map: {
      amount: { i: 2, n: ['amount'] }, speed: { i: 1, n: ['speed'] }, seed: { n: ['seed', 'random seed'] },
      blur: { i: 7, n: ['blur', 'enable blur'] }, color: { i: 4, n: ['color', 'enable color'] }, light: { i: 5, n: ['light', 'enable light'] }, scale: { i: 6, n: ['scale', 'enable scale'] }, slide: { i: 8, n: ['slide', 'enable slide'] }, time: { i: 9, n: ['time'] },
      blurAmt: { n: ['blur amount'] }, colorAmt: { n: ['color amount'] }, colorize: { n: ['colorize'] }, lightAmt: { n: ['light amount'] },
      scaleAmt: { n: ['scale amount'] }, slideAmt: { n: ['slide amount'] }, slideAngle: { n: ['slide direction'] },
      slideRgb: { n: ['slide rgb split'] }, slideBlur: { n: ['slide motion blur'] }, timeAmt: { n: ['time amount'] },
      border: { n: ['border'] }, lightMode: { n: ['light behaviour'] }, blurBoost: { n: ['blur boost'] }, scaleOrigin: { n: ['scale origin'] }, timeDir: { n: ['time direction'] },
    },
    // Slide Direction do Twitch é um ÂNGULO (pode ser animado: -67°, -192°, -540°…), não um menu
    post: (p) => { p.slideDir = p.slideAngle !== undefined ? 4 : 1; } },
  // S_Shake: deslocamento = Amplitude (mestre) × X/Y Rand Amp (px); motion blur, wrap e rajadas (Stillness) do próprio plugin
  // recriações novas (antes das regras genéricas de s_film / s_glow / bcc.*film / bcc.*glow)
  { vendor: 'Sapphire / BCC', plugin: 'S_FilmDamage / BCC Film Damage', to: 'filmDamage', test: /s_filmdamage|bcc.*(film ?damage|old ?film)/i,
    // S_FilmDamage: a parte de cor (grão, vinheta, pretos, flicker) continua no Film Look calibrado;
    // riscos, poeira, cabelos e tremor viram o Film Damage
    expand: (fx, raw) => {
      const out = [{ type: 'filmLook', label: fx.name, params: { grain: Math.min(100, (raw('grain amp') || 0) * 30), scratch: 0, vignette: Math.min(100, (raw('vignette darkness') || 0) * 100), flicker: Math.min(100, ((raw('flicker amp') ?? raw('flicker')) || 0) * 100), warmth: 0, fade: Math.min(60, Math.max(0, -(raw('offset darks') || 0)) * 20) } }];
      const scr = (raw('scratches') ?? raw('scratch amount') ?? 0), dust = (raw('dust density') ?? raw('dust') ?? 0) + (raw('hairs') || 0) * 0.5, shk = raw('shake amplitude') || 0;
      if (scr > 0 || dust > 0 || shk > 0) out.push({ type: 'filmDamage', label: `${fx.name} (danos)`, params: { scratches: Math.min(100, scr * 50), dust: Math.min(100, dust * 25), flicker: 0, jitter: Math.min(40, shk * 10), grain: 0, sepia: 0, fps: 24, seed: (raw('seed') || 1) % 100 } });
      return out;
    } },
  { vendor: 'Sapphire / BCC', plugin: 'S_Bokeh / BCC Bokeh', to: 'bokeh', test: /s_bokeh|bcc.*bokeh/i, map: { radius: { n: ['bokeh size', 'size', 'radius'] }, threshold: { n: ['threshold'], conv: (v) => (v <= 1 ? v * 100 : v) } } },
  { vendor: 'Sapphire / BCC', plugin: 'S_Zap / BCC Lightning', to: 'zap', test: /s_zap|bcc.*lightning/i, map: { width: { n: ['width', 'core width'] }, glow: { n: ['glow brightness', 'glow'] }, color: { n: ['color', 'glow color'] } } },
  { vendor: 'Sapphire', plugin: 'S_Aurora', to: 'aurora', test: /s_aurora/i, map: { intensity: { n: ['brightness'] }, speed: { n: ['speed'] } } },
  { vendor: 'Sapphire / BCC', plugin: 'S_GlowEdges / BCC Glow Edges', to: 'glowEdges', test: /s_glowedges|bcc.*(glow ?edges|edge ?glow)/i, map: { width: { n: ['glow width', 'width'], conv: (v) => (v < 5 ? v * 40 : v) }, amount: { n: ['brightness', 'glow intensity'] } } },
  { vendor: 'BCC / Sapphire', plugin: 'BCC Cartoon Look', to: 'cartoon', test: /cartoon/i },
  { vendor: 'Sapphire / BCC / Red Giant', plugin: 'Unmult', to: 'unmult', test: /unmult/i },
  { vendor: 'Sapphire / BCC', plugin: 'S_Clouds / BCC Fast Fog', to: 'clouds', test: /s_clouds|bcc.*fog/i, map: { density: { n: ['density', 'amount'] }, speed: { n: ['speed'] } } },
  { vendor: 'Sapphire / BCC', plugin: 'S_Sparkles / BCC Sparkles', to: 'sparkles', test: /s_sparkles|bcc.*sparkl/i, map: { amount: { n: ['brightness'] }, threshold: { n: ['threshold'], conv: (v) => (v <= 1 ? v * 100 : v) } } },
  { vendor: 'Video Copilot', plugin: 'Element 3D', to: 'element3d', test: /element ?3d|vc ?element/i },
  // efeitos do projeto vini_centa (.aep)
  { vendor: 'Sapphire', plugin: 'S_Hotspots', to: 'hotspots', test: /s_hotspots/i, map: { threshold: { n: ['threshold'] }, blur: { n: ['blur input'], conv: (v) => (v < 2 ? v * 20 : v) }, saturation: { n: ['saturation'] }, brightness: { n: ['brightness'] }, addColor: { n: ['threshold add color'] } } },
  { vendor: 'Adobe', plugin: 'Minimax', to: 'minimax', match: ['ADBE Minimax'], map: { operation: { n: ['operation'], conv: (v) => (v === 2 || v === 3 ? 2 : 1) }, radius: { n: ['radius'] }, direction: { n: ['direction'], conv: (v) => Math.min(3, Math.max(1, Math.round(v))) } } },
  { vendor: 'Adobe', plugin: 'CC Jaws', to: 'ccJaws', test: /^cc jaws/i, map: { completion: { n: ['completion'] }, height: { n: ['height'] }, width: { n: ['width'] } } },
  { vendor: 'Adobe', plugin: 'Card Wipe', to: 'cardWipe', test: /cardwipe|card wipe/i, map: { completion: { n: ['transition completion'] }, width: { n: ['transition width'] }, rows: { n: ['rows'] }, columns: { n: ['columns'] }, axis: { n: ['flip axis'], conv: (v) => (v >= 2 ? 2 : 1) }, order: { n: ['flip order'], conv: (v) => (v <= 2 ? 1 : v <= 4 ? 2 : 3) } } },
  { vendor: 'Cinema Spice', plugin: 'Polytrace', to: 'polytrace', test: /polytrace/i, map: { threshold: { n: ['threshold'] }, size: { n: ['size'] } } },
  { vendor: 'Sapphire', plugin: 'S_AutoPaint', to: 'autoPaint', test: /s_autopaint/i, map: { frequency: { n: ['frequency'] } } },
  { vendor: 'Sapphire', plugin: 'S_ReverseClip', to: 'twixtor', test: /s_reverseclip/i, set: { speed: -100 } },
  // Magic Bullet Film (matchName genérico "Magic_Bullet_Suite_Magic_Bullet"): Negative Stock, Color Temperature, Exposure, Grain, Strength
  { vendor: 'Red Giant', plugin: 'Magic Bullet Film', to: 'looks', test: /magic_bullet_suite_magic_bullet|magic ?bullet ?film/i,
    expand: (fx, raw) => {
      const k = (raw('strength') ?? 100);
      const { params, extra } = looksFromTools([{ id: 'filp', enabled: true, values: [raw('negative stock') || 0, (raw('color temperature') || 0), raw('tint') || 0, raw('exposure') || 0, raw('contrast') || 0, raw('saturation') ?? 100, 0, 0, 0, 100] }], k);
      const out = [{ type: 'looks', label: fx.name || 'Magic Bullet Film', params }, ...extra];
      const g = raw('grain') || 0;
      if (g > 0) out.push({ type: 'noise', label: 'Magic Bullet Film · grão', params: { amount: Math.min(60, g * 0.3 * k / 100), size: 1.3, animated: true, color: false } });
      return out;
    } },
  { vendor: 'Sapphire', plugin: 'S_Shake', to: 'shake', test: /s_shake|s_camerashake/i,
    map: {
      amount: { n: ['amplitude', 'shake amp', 'amp'], conv: (v) => (v < 20 ? v * 100 : v) }, frequency: { n: ['frequency', 'shake freq', 'freq'], conv: (v) => (v > 60 ? Math.min(40, v / 250) : v) },
      ampX: { n: ['x rand amp'] }, ampY: { n: ['y rand amp'] }, rotation: { n: ['tilt rand amp', 'rotate amp'] }, zoom: { n: ['z rand amp'], conv: (v) => v * 100 },
      style: { i: 1, n: ['style'] }, centerBias: { n: ['center bias'] },
      stillness: { n: ['stillness'] }, twitchFreq: { n: ['twitch frequency'] }, drift: { n: ['drift'], conv: (v) => v * 0.3 }, seed: { n: ['seed'] },
      shutter: { n: ['mo blur length'] }, wrap: { n: ['wrap x'], conv: (v) => Math.min(3, Math.max(1, v)) },
    },
    post: (p, raw) => { p.sapphire = true; p.drift = (raw('drift') ?? 0); if (!raw('motion blur')) p.shutter = 0; if (p.ampX === undefined) p.ampX = 100; if (p.ampY === undefined) p.ampY = 100; } },
  { vendor: 'Sapphire', plugin: 'S_BlurMoCurves', to: 'blurMoCurves', test: /s_blurmocurves/i,
    map: { center: { n: ['center xy'] }, zDist: { n: ['z dist'] }, rotate: { n: ['rotate'] }, shiftX: { n: ['shift x'] }, shiftY: { n: ['shift y'] }, shutter: { n: ['shutter duration'] }, wrap: { n: ['wrap x'], conv: (v) => Math.min(3, Math.max(1, v)) }, wrapY: { n: ['wrap y'], conv: (v) => Math.min(3, Math.max(1, v)) } } },
  // S_Sharpen: nitidez em faixas de detalhe + Sharpen Width (contraste local largo); Opacity pode passar de 1 (amplifica)
  { vendor: 'Sapphire', plugin: 'S_Sharpen', to: 'sSharpen', test: /s_sharpen/i,
    map: {
      amp: { n: ['sharpen amp'] }, width: { n: ['sharpen width'] }, detail: { n: ['small detail size'] },
      tiny: { n: ['scale tiny details'] }, small: { n: ['scale small details'] }, medium: { n: ['scale medium details'] }, large: { n: ['scale large details'] },
      edgeThr: { n: ['edge threshold'] }, luma: { n: ['sharpen luma'] }, chroma: { n: ['sharpen chroma'] }, opacity: { n: ['opacity'] },
    } },
  { vendor: 'Sapphire', plugin: 'S_HueSatBright', to: 'looks', test: /s_huesat/i,
    expand: (fx, raw) => [{ type: 'looks', label: 'S_HueSatBright', params: { hue: (raw('hue shift') || 0) * 360, saturation: (raw('saturation') ?? 1) * 100, exposure: Math.log2(Math.max(0.01, raw('brightness') ?? 1)) } }] },
  // S_MathOps: A × Lights + Darks direto no valor da imagem (não em luz linear) → Níveis
  { vendor: 'Sapphire', plugin: 'S_MathOps', to: 'levels', test: /s_mathops/i,
    expand: (fx, raw) => {
      const L = Math.max(0.01, (raw('a lights') ?? 1) * (raw('dest lights') ?? 1)), D = (raw('a darks') || 0) + (raw('dest darks') || 0);
      const p = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
      if (D < 0) p.inBlack = Math.min(254, (-D / L) * 255); else p.outBlack = Math.min(254, D * 255);
      if (L >= 1) p.inWhite = Math.max(p.inBlack + 1, Math.min(255, 255 / L)); else p.outWhite = Math.max(p.outBlack + 1, L * 255);
      return [{ type: 'levels', label: 'S_MathOps', params: p }];
    } },
  { vendor: 'Sapphire', plugin: 'S_FilmDamage / S_FilmEffect', to: 'filmLook', test: /s_film/i,
    expand: (fx, raw) => [{ type: 'filmLook', label: fx.name, params: { grain: Math.min(100, (raw('grain amp') || 0) * 30), scratch: Math.min(100, (raw('dust density') || 0) * 10 + (raw('scratch density') || 0) * 10), vignette: Math.min(100, (raw('vignette darkness') || 0) * 100), flicker: Math.min(100, ((raw('flicker amp') ?? raw('flicker')) || 0) * 100), warmth: 0, fade: Math.min(60, Math.max(0, -(raw('offset darks') || 0)) * 20) } }] }, // S_FilmEffect: Vignette Darkness, Offset Darks; S_FilmDamage: Flicker
  { vendor: 'Sapphire', plugin: 'S_Flicker', to: 'flicker', test: /s_flicker/i,
    map: { amount: { n: ['amplitude'], conv: (v) => v * 100 }, frequency: { n: ['rand freq'], conv: (v) => Math.min(60, v) }, colorAmount: { n: ['rand color amp'], conv: (v) => v * 100 }, brightness: { n: ['brightness'] } },
    // S_Flicker: a variação de brilho é Amplitude × Rand Luma Amp (Amplitude é o mestre), não só Amplitude
    post: (p, raw) => { const a = raw('amplitude') ?? 1, l = raw('rand luma amp') ?? 0.5, c = raw('rand color amp') ?? 0; p.amount = a * l * 100; p.colorAmount = l > 0 ? Math.min(100, (c / l) * 100) : 0; } },
  { vendor: 'BCC', plugin: 'BCC Directional Blur', to: 'dirBlur', test: /bcc.*(directional|motion).*blur/i,
    map: { length: { i: 2, n: ['blur amount'], conv: (v) => v }, angle: { i: 3, n: ['angle'] } } },
  { vendor: 'BCC', plugin: 'BCC Brightness-Contrast', to: 'brightnessContrast', test: /bcc.*bright(ness)?[- ]?contrast/i,
    map: { brightness: { n: ['brightness'] }, contrast: { n: ['contrast'] } } },
  { vendor: 'BCC', plugin: 'BCC Unsharp Mask', to: 'sharpen', test: /bcc.*(unsharp|sharpen)/i,
    // BCC Unsharp Mask: Amount em múltiplos (1 = 100%); Radius em px (desfoque grande = contraste local)
    map: { radius: { n: ['radius'], conv: (v) => v * 0.25 }, amount: { n: ['amount'], conv: (v) => (v <= 20 ? v * 4 : v) }, threshold: { n: ['threshold'] } } }, // mesma leitura do Frameify (Amount 6 → 24%, Radius 12 → 3)
  { vendor: 'RE:Vision', plugin: 'ReelSmart Motion Blur', to: 'motionBlur', test: /reelsmart|\brsmb\b|motion ?blur ?pro/i,
    map: { amount: { n: ['blur amount', 'motion blur amount'], conv: (v) => (v <= 4 ? v * 200 : v) } } },
  { vendor: 'Plugin Everything', plugin: 'Deep Glow', to: 'deepGlow', test: /deep ?glow|\bpedg\b/i,
    map: { radius: { i: 1, n: ['radius'] }, exposure: { i: 2, n: ['exposure', 'intensity'] }, threshold: { i: 4, n: ['threshold'], conv: pct }, tint: { i: 38, n: ['tint color'] }, useTint: { i: 37, n: ['enable tint'] }, aspect: { i: 10, n: ['aspect ratio', 'aspect'] } },
    post: (p, raw) => { if (p.useTint === undefined) p.useTint = false; } },
  { vendor: 'Video Copilot', plugin: 'Optical Flares', to: 'lensFlare', test: /optical ?flares?/i, map: { brightness: { n: ['brightness'] }, size: { n: ['scale', 'size'] } } },
  { vendor: 'Video Copilot', plugin: 'Saber', to: 'deepGlow', test: /\bsaber\b/i, map: { exposure: { n: ['glow intensity'] }, radius: { n: ['glow spread', 'glow size'], conv: (v) => v * 100 }, tint: { n: ['glow color'] } }, set: { useTint: true } },
  { vendor: 'Video Copilot', plugin: 'Heat Distortion', to: 'turbulentDisplace', test: /heat ?distort/i },
  { vendor: 'Red Giant', plugin: 'Shine', to: 'lightRays', test: /\bshine\b/i, map: { length: { n: ['ray length'], conv: (v) => Math.min(100, v * 10) }, intensity: { n: ['boost light'] } } },
  // DRAGOY Tracery: todos os controles do plugin (Key Color, Threshold, caixas, texto, marcadores, linhas, setas)
  { vendor: 'DRAGOY / aescripts', plugin: 'Tracery', to: 'tracery', test: /tracery/i,
    map: {
      trackColor: { n: ['key color'] }, threshold: { n: ['threshold'] }, blurStrength: { n: ['blur strength'] }, quality: { n: ['detection quality'] },
      showMask: { n: ['show mask'] }, alphaOnly: { n: ['alpha layer'] },
      boxes: { n: ['enable bounding boxes'] }, boxColor: { n: ['border color'] }, lineWidth: { n: ['border thickness'] }, boxFill: { n: ['fill color'] },
      boxFillOpacity: { n: ['fill opacity'], conv: (v) => (v <= 1 ? v * 100 : v) }, gaps: { n: ['enable gaps'] }, gapSize: { n: ['gap size'] },
      labels: { n: ['enable text'] }, textColor: { n: ['text color'] }, fontScale: { n: ['font scale'] }, textOffset: { n: ['text vertical offset'] },
      crosshair: { n: ['enable markers'] }, markerType: { n: ['marker type'] }, markerColor: { n: ['marker color'] }, markerSize: { n: ['marker size'] },
      connect: { n: ['enable connection lines'] }, connType: { n: ['connection type'] }, color: { n: ['line color'] },
      lineOpacity: { n: ['line opacity'], conv: (v) => (v <= 1 ? v * 100 : v) }, curvature: { n: ['curvature'] },
      dashed: { n: ['enable dashed lines'] }, dashLen: { n: ['dash length'] }, gapLen: { n: ['gap length'] },
      arrows: { n: ['enable arrows'] }, arrowSize: { n: ['arrow size'] }, arrowAngle: { n: ['arrow angle'] }, arrowPos: { n: ['arrow position'] }, arrowFilled: { n: ['filled arrows'] },
    },
    // há dois "Line Thickness" (marcador e linha): o 1º é do marcador, o 2º da linha de conexão
    post: (p, raw, fx) => {
      const lt = (fx?.params || []).filter((q) => /^line thickness$/i.test((q.name || '').trim())).map((q) => q.value?.[0]);
      if (lt[0] != null) p.markerThickness = lt[0];
      if (lt[1] != null) p.connWidth = Math.max(0.25, lt[1] * 2);
      p.track = 3; if (p.fill === undefined) p.fill = 1;
    } },
  { vendor: 'Cinema Spice', plugin: 'Glitchify', to: 'glitchify', test: /glitchify/i, map: { amount: { n: ['amount', 'glitch amount'] }, speed: { n: ['speed', 'frequency'] } } },
  { vendor: 'aescripts', plugin: 'Datamosh 2', to: 'datamosh', test: /datamosh|pixel ?encoder/i },
  { vendor: 'Video Copilot', plugin: 'VC Reflect', to: 'reflect', test: /vc ?reflect|^reflect$/i, map: { opacity: { n: ['opacity', 'reflection opacity'] } } },
  { vendor: 'aescripts', plugin: 'Quick Chromatic Aberration 2', to: 'qca', test: /quick ?chromatic|qca/i, map: { amount: { n: ['aberration amount', 'amount'], conv: (v) => Math.min(60, v) } } },
  { vendor: 'Sapphire', plugin: 'S_Halftone', to: 'halftone', test: /s_halftone|halftone/i, map: { cell: { n: ['dot size', 'scale', 'grid spacing'] }, angle: { n: ['angle', 'rotate'] } } },
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
    // S_Glow (sapphire_ae.dll): Brightness 2 = padrão, Width 0,4 (¼ da largura do quadro), Threshold 0,5, Combine Screen
    map: { radius: { n: ['width'], conv: (v) => (v < 5 ? v * 500 : v) }, exposure: { n: ['brightness'], conv: (v) => v * 0.6 }, threshold: { n: ['threshold'], conv: pct }, tint: { n: ['color'] } }, set: { useTint: false },
    // Color do S_Glow MULTIPLICA o brilho do glow: cor escura = glow fraco (e tingido); branca = glow normal
    post: (p) => {
      const c = p.tint || [1, 1, 1, 1], l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      if (l < 0.97) { p.exposure *= Math.max(0.05, l); p.useTint = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) > 0.04; p.tint = [c[0] / Math.max(l, 0.05), c[1] / Math.max(l, 0.05), c[2] / Math.max(l, 0.05), 1].map((x, i) => (i < 3 ? Math.min(1, x * 0.6) : 1)); }
    } },
  { vendor: 'Sapphire', plugin: 'S_ZoomBlur', to: 'radialBlur', test: /s_zoomblur|s_blurzoom|s_radialblur/i, set: { mode: 1 },
    map: { amount: { n: ['zoom amount', 'blur amount', 'amount', 'length'], conv: (v) => (v <= 2 ? v * 100 : v) }, center: { n: ['center', 'center xy'] } } },
  { vendor: 'Sapphire', plugin: 'S_Blur', to: 'blur', test: /s_blur/i, map: { radius: { n: ['width', 'blur amount'], conv: (v) => (v < 5 ? v * 100 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_WarpChroma', to: 'rgbSplit', test: /s_warpchroma|s_chroma/i, set: { mode: 2 }, map: { amount: { n: ['amount', 'shift'], conv: (v) => (v < 5 ? v * 60 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_LensFlare', to: 'lensFlare', test: /s_lensflare|s_flare/i,
    map: { position: { n: ['flare pos', 'flare position', 'position', 'center'] }, brightness: { n: ['brightness'], conv: (v) => (v <= 5 ? v * 100 : v) }, size: { n: ['scale', 'flare scale', 'size'], conv: (v) => (v <= 5 ? v * 220 : v) }, color: { n: ['color', 'flare color'] } } },
  { vendor: 'Sapphire', plugin: 'S_Rays', to: 'lightRays', test: /s_rays/i,
    map: { center: { n: ['center', 'center xy', 'rays center'] }, length: { n: ['ray length', 'rays length', 'length'], conv: (v) => (v <= 2 ? v * 60 : v) }, intensity: { n: ['rays brightness', 'brightness', 'rays bright'], conv: (v) => Math.min(10, v * 0.35) /* Rays Brightness 8 = padrão do Sapphire */ }, threshold: { n: ['threshold'], conv: (v) => (v <= 1 ? v * 100 : v) }, color: { n: ['rays color', 'color'] } } },
  { vendor: 'Sapphire', plugin: 'S_DigitalDamage', to: 'glitch', test: /s_digitaldamage|s_glitch|s_damage/i,
    // S_DigitalDamage (sapphire_ae.dll): Intensity (1 = padrão), Damage Size, Shift Amount, *Blink Freq, Seed
    map: { amount: { n: ['intensity', 'amount', 'damage amount', 'block amount'], conv: (v) => Math.min(100, v * 40) }, block: { n: ['damage size', 'block size', 'blocks size'], conv: (v) => (v <= 5 ? v * 24 : v) }, shift: { n: ['shift amount'], conv: (v) => (v <= 1 ? v * 80 : v) }, speed: { n: ['shift blink freq', 'frequency', 'speed'] }, seed: { n: ['seed'] } } },
  { vendor: 'Sapphire', plugin: 'S_TVDamage', to: 'vhs', test: /s_tv|s_retro/i, map: { amount: { n: ['amount', 'mix'], conv: (v) => (v <= 1 ? v * 100 : v) }, noise: { n: ['noise amp', 'noise'], conv: (v) => (v <= 1 ? v * 60 : v) } } },
  // S_Vignette (sapphire_ae.dll): Opacity (força), Radius 0,9, Edge Softness 1, Rel Height 0,75 (elipse do quadro), Color
  { vendor: 'Sapphire', plugin: 'S_Vignette', to: 'vignette', test: /s_vignette/i, map: { amount: { n: ['opacity', 'amount', 'vignette amount', 'darken'], conv: (v) => (v <= 1 ? v * 100 : v) }, size: { n: ['radius', 'size'], conv: (v) => (v <= 2 ? v * 60 : v) }, feather: { n: ['edge softness', 'softness', 'feather'], conv: (v) => (v <= 1 ? v * 100 : v) }, color: { n: ['color'] } }, set: { round: false } },
  { vendor: 'Sapphire', plugin: 'S_Kaleido', to: 'kaleida', test: /s_kaleid/i },
  { vendor: 'Sapphire', plugin: 'S_WipeLine', to: 'wipeLine', test: /s_wipeline/i,
    map: { pct: { n: ['wipe percent'] }, angle: { n: ['angle'] }, dir: { n: ['transition dir'] }, noiseAmp: { n: ['noise amp'] }, noiseFreq: { n: ['noise freq'] }, noiseSpeed: { n: ['noise speed'] },
      borderW: { n: ['border width'] }, borderColor: { n: ['border color'] }, borderOp: { n: ['border opacity'] }, glow: { n: ['border glow'] }, glowW: { n: ['glow width'] }, glowColor: { n: ['glow color'] } } },
  { vendor: 'Sapphire', plugin: 'S_EdgeDetect', to: 'edgeDetect', test: /s_edgedetect/i,
    map: { threshold: { n: ['threshold'] }, bright: { n: ['brightness'] }, wr: { n: ['weight red'] }, wg: { n: ['weight green'] }, wb: { n: ['weight blue'] } } },
  { vendor: 'BCC', plugin: 'BCC Textured Wipe', to: 'texturedWipe', test: /bcc.*textured ?wipe/i, map: { amount: { n: ['wipe amount'] }, softness: { n: ['softness'] } } },
  { vendor: 'BCC', plugin: 'BCC ML Depth Estimation', to: 'depthMap', test: /bcc.*depth ?estim|mldepth/i,
    map: { far: { n: ['level far'] }, near: { n: ['level near'] }, gamma: { n: ['gamma'], conv: (v) => (v > 0 ? v : 1) }, bright: { n: ['brightness'], conv: (v) => v / 100 }, contrast: { n: ['contrast'], conv: (v) => v / 100 } } },
  { vendor: 'Sapphire', plugin: 'S_WarpFishEye', to: 'fishEye', test: /s_warpfisheye|fish ?eye/i,
    map: { amount: { n: ['amount'] }, center: { n: ['center'] }, wrapX: { n: ['wrap x'], conv: (v) => Math.min(3, Math.max(1, v)) }, wrapY: { n: ['wrap y'], conv: (v) => Math.min(3, Math.max(1, v)) } } },
  { vendor: 'Sapphire', plugin: 'S_TimeWarpRGB', to: 'timeWarpRGB', test: /s_timewarprgb/i, map: { red: { n: ['red shift frames'] }, blue: { n: ['blue shift frames'] } } },
  { vendor: 'Sapphire', plugin: 'S_Invert', to: 'invert', test: /\bs_invert\b/i },
  { vendor: 'Cycore (CC)', plugin: 'CC Wide Time', to: 'wideTime', test: /cc wide ?time/i, map: { forward: { n: ['forward steps'] }, backward: { n: ['backward steps'] }, nativeBlur: { n: ['native motion blur'], conv: (v) => !!v } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Ball Action', to: 'ballAction', test: /cc ball action/i,
    map: { scatter: { n: ['scatter'] }, spacing: { n: ['grid spacing'] }, size: { n: ['ball size'] }, rotation: { n: ['rotation'] }, twist: { n: ['twist angle'] }, seed: { n: ['instability state'] } } },
  { vendor: 'Sapphire', plugin: 'S_Distort', to: 'turbulentDisplace', test: /s_distort|s_warp/i },
  { vendor: 'Sapphire', plugin: 'S_Mosaic', to: 'mosaic', test: /s_mosaic/i },

  // BCC (Boris Continuum)
  { vendor: 'BCC', plugin: 'BCC Glow / Film Glow', to: 'deepGlow', test: /bcc.*glow/i, map: { radius: { n: ['glow radius', 'radius'] }, exposure: { n: ['glow intensity', 'intensity'], conv: (v) => (v > 10 ? v / 40 : v) }, threshold: { n: ['glow threshold', 'threshold'] }, tint: { n: ['glow color'] } },
    post: (p, raw) => { p.useTint = (raw('glow desaturation') ?? 100) < 60; p.knee = 70; } }, // BCC Film Glow (limiar bem suave, sem recorte): Intensity 15 ≈ brilho suave; Desaturation 100 = glow branco
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
    map: { hue: { i: 4, n: ['master hue'] }, saturation: { i: 5, n: ['master saturation'] }, lightness: { i: 6, n: ['master lightness'] }, colorize: { i: 7, n: ['colorize'] } },
    // o AE guarda o Master de verdade no bloco "Channel Range" (inteiros: matiz, saturação, luminosidade, depois as faixas)
    post: (p, raw, fx) => {
      const cr = fx?.params?.find((q) => q.arbInts && /channel range/i.test(q.name || ''))?.arbInts;
      if (!cr || cr.length < 3) return;
      if (!p.hue) p.hue = cr[0];
      if (!p.saturation) p.saturation = cr[1];
      if (!p.lightness) p.lightness = cr[2];
    } },
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
  { vendor: ADOBE, plugin: 'Curves', to: 'curves', match: ['ADBE CurvesCustom', 'ADBE Curves'],
    expand: (fx) => [{ type: 'curves', label: fx.name && !/^-_0_/.test(fx.name) ? fx.name : 'Curves', params: fx.curveLUT ? { lut: fx.curveLUT } : {}, note: fx.curveLUT ? 'curva exata (RGB + canais)' : 'curva não encontrada' }] },
  { vendor: ADOBE, plugin: 'Tritone', to: 'tritone', match: ['ADBE Tritone'], map: { highlights: { n: ['highlights'] }, midtones: { n: ['midtones'] }, shadows: { n: ['shadows'] }, mix: { n: ['blend with original'], conv: (v) => 100 - v } } },
  { vendor: ADOBE, plugin: 'CC Toner', to: 'tritone', match: ['CC Toner'], map: { highlights: { n: ['highlights'] }, midtones: { n: ['midtones'] }, shadows: { n: ['shadows'] }, mix: { n: ['blend w. original'], conv: (v) => 100 - v } } },
  { vendor: ADOBE, plugin: 'CC Light Sweep', to: 'lightSweep', match: ['CC Light Sweep'], map: { center: { n: ['center'] }, direction: { n: ['direction'] }, shape: { n: ['shape'] }, width: { n: ['width'] }, intensity: { n: ['sweep intensity'], conv: (v) => v / 50 }, color: { n: ['light color'] } } },
  { vendor: ADOBE, plugin: 'Camera Lens Blur', to: 'lensBlur', match: ['ADBE Camera Lens Blur', 'ADBE Lens Blur'], map: { radius: { n: ['blur radius', 'iris radius'] } } },
  { vendor: ADOBE, plugin: 'Shatter', to: 'shatter', match: ['APC Shatter', 'ADBE Shatter'],
    map: {
      render: { i: 4 },
      // padrões do AE: 3 Tijolos, 8 Vidro, 9 Hexágonos, 10 Quebra-cabeça (Jigsaw), 11 Octógonos e quadrados, 15 Tábuas, 18 Quadrados, 21/22 Triângulos
      pattern: { i: 6, conv: (v) => ({ 3: 4, 9: 5, 10: 6, 11: 10, 15: 9, 18: 2, 14: 2, 13: 2, 19: 3, 21: 3, 22: 3, 20: 3, 17: 3 })[Math.round(v)] || 1 },
      depth: { n: ['extrusion depth'], conv: (v) => Math.min(30, Math.max(0, v * 10)) },
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
  { vendor: ADOBE, plugin: 'Luma Key', to: 'lumaKey', match: ['ADBE Luma Key'], map: { type: { i: 1, n: ['key type'] }, threshold: { i: 2, n: ['threshold'] }, tolerance: { i: 3, n: ['tolerance'] }, feather: { i: 5, n: ['edge feather'] } } },
  { vendor: ADOBE, plugin: 'Bevel Alpha', to: 'bevelAlpha', match: ['ADBE Bevel Alpha'], map: { thickness: { i: 1, n: ['edge thickness'] }, angle: { i: 2, n: ['light angle'] }, color: { i: 3, n: ['light color'] }, intensity: { i: 4, n: ['light intensity'] } } },
  { vendor: ADOBE, plugin: 'Crop Edges', to: 'cropEdges', match: ['ADBE CM CropEdges'], map: { amount: { i: 1, n: ['crop amount (per edge)', 'crop amount'] } } },
  { vendor: ADOBE, plugin: 'Color Key', to: 'colorKey', match: ['ADBE Color Key'], map: { key: { i: 1, n: ['key color'] }, tolerance: { i: 2, n: ['color tolerance'] }, feather: { i: 4, n: ['edge feather'] } } },
  { vendor: ADOBE, plugin: 'Change To Color', to: 'changeToColor', match: ['ADBE Change To Color'],
    map: { from: { i: 1, n: ['from'] }, to: { i: 2, n: ['to'] }, change: { i: 3, n: ['change'] }, hueTol: { n: ['hue'] }, lumTol: { n: ['lightness'] }, satTol: { n: ['saturation'] }, softness: { n: ['softness'] } } },
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
// controles de expressão, pseudo-efeitos, áudio e pintura não são efeitos visuais: viram controles genéricos
// (antes um Slider chamado "Blur" casava pelo nome e virava desfoque)
const NON_VISUAL = /^(ADBE (Slider|Point3D|Point|Angle|Checkbox|Color|Layer|Dropdown) Control|ADBE Aud BT|ADBE AudSpect|ADBE Paint|Pseudo\/)/i;

export function matchEffect(matchName, displayName = '') {
  if (NON_VISUAL.test(matchName || '')) return null;
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
