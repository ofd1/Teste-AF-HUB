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

export const IMPORT_RULES = [
  // ---------------------------------------------------------------- plugins de terceiros
  { vendor: 'RE:Vision', plugin: 'Twixtor', to: 'twixtor', test: /twixtor/i,
    map: { speed: { n: ['speed %', 'speed'] }, frameBlend: { n: ['frame interp', 'frame interpolation', 'frame blending'], conv: (v) => v >= 2 } } },
  { vendor: 'RE:Vision', plugin: 'ReelSmart Motion Blur', to: 'motionBlur', test: /reelsmart|\brsmb\b|motion ?blur ?pro/i,
    map: { amount: { n: ['blur amount', 'motion blur amount'], conv: (v) => (v <= 4 ? v * 200 : v) } } },
  { vendor: 'Plugin Everything', plugin: 'Deep Glow', to: 'deepGlow', test: /deep ?glow|\bpedg\b/i,
    map: { radius: { n: ['radius'] }, exposure: { n: ['exposure', 'intensity'] }, threshold: { n: ['threshold'], conv: pct }, tint: { n: ['tint color', 'color'] }, useTint: { n: ['tint', 'enable tint'] }, aspect: { n: ['aspect ratio', 'aspect'] } } },
  { vendor: 'Video Copilot', plugin: 'Twitch', to: 'twitch', test: /twitch/i,
    map: {
      amount: { n: ['amount'] }, speed: { n: ['speed'] }, seed: { n: ['random seed', 'seed'] },
      blur: { n: ['blur', 'enable blur'] }, color: { n: ['color', 'enable color'] }, light: { n: ['light', 'enable light'] }, scale: { n: ['scale', 'enable scale'] }, slide: { n: ['slide', 'enable slide'] },
      blurAmt: { n: ['blur amount', 'max blur'] }, colorAmt: { n: ['color amount', 'rgb offset'] }, lightAmt: { n: ['light amount', 'exposure'] }, scaleAmt: { n: ['scale amount'] }, slideAmt: { n: ['slide amount', 'slide distance'] },
    } },
  { vendor: 'Video Copilot', plugin: 'Optical Flares', to: 'lensFlare', test: /optical ?flares?/i, map: { brightness: { n: ['brightness'] }, size: { n: ['scale', 'size'] } } },
  { vendor: 'Video Copilot', plugin: 'Saber', to: 'deepGlow', test: /\bsaber\b/i, map: { exposure: { n: ['glow intensity'] }, radius: { n: ['glow spread', 'glow size'], conv: (v) => v * 100 }, tint: { n: ['glow color'] } }, set: { useTint: true } },
  { vendor: 'Video Copilot', plugin: 'Heat Distortion', to: 'turbulentDisplace', test: /heat ?distort/i },
  { vendor: 'Red Giant', plugin: 'Shine', to: 'lightRays', test: /\bshine\b/i, map: { length: { n: ['ray length'], conv: (v) => Math.min(100, v * 10) }, intensity: { n: ['boost light'] } } },
  { vendor: 'Red Giant', plugin: 'Starglow', to: 'deepGlow', test: /starglow/i, map: { radius: { n: ['streak length'], conv: (v) => v * 3 }, exposure: { n: ['boost light'] }, threshold: { n: ['threshold'], conv: (v) => v / 2.55 } } },
  { vendor: 'Red Giant', plugin: 'Magic Bullet Looks / Colorista / Mojo', to: 'colorGrade', test: /magic ?bullet|\blooks\b|colorista|\bmojo\b/i },
  { vendor: 'Red Giant', plugin: 'Universe Glow', to: 'deepGlow', test: /uni\.? ?glow|universe.*glow/i },
  { vendor: 'Red Giant', plugin: 'Universe Shake', to: 'shake', test: /uni\.?.*shake|universe.*shake/i },
  { vendor: 'Red Giant', plugin: 'Universe Glitch', to: 'glitch', test: /uni\.?.*(glitch|damage)|universe.*glitch/i },
  { vendor: 'Red Giant', plugin: 'Universe VHS', to: 'vhs', test: /uni\.?.*vhs|universe.*vhs/i },
  { vendor: 'Red Giant', plugin: 'Universe Chromatic', to: 'rgbSplit', test: /uni\.?.*(chromatic|rgb)|universe.*chromatic/i },
  { vendor: 'Red Giant', plugin: 'Universe Light Leaks', to: 'lightLeak', test: /uni\.?.*leak|universe.*leak/i },
  { vendor: 'FilmConvert', plugin: 'FilmConvert', to: 'filmLook', test: /filmconvert/i },

  // Sapphire (Boris FX)
  { vendor: 'Sapphire', plugin: 'S_Glow', to: 'deepGlow', test: /s_glow/i,
    map: { radius: { n: ['width'], conv: (v) => (v < 5 ? v * 500 : v) }, exposure: { n: ['brightness'] }, threshold: { n: ['threshold'], conv: pct }, tint: { n: ['color'] } }, set: { useTint: false } },
  { vendor: 'Sapphire', plugin: 'S_Shake', to: 'shake', test: /s_shake|s_camerashake/i,
    map: { amount: { n: ['amplitude', 'shake amp', 'amp'], conv: (v) => (v < 5 ? v * 100 : v) }, frequency: { n: ['frequency', 'shake freq', 'freq'] }, rotation: { n: ['rotate amp', 'rotation'] }, seed: { n: ['seed'] } } },
  { vendor: 'Sapphire', plugin: 'S_BlurMoCurves', to: 'dirBlur', test: /s_blurmo|s_blurmotion|s_blurdirectional/i, map: { length: { n: ['length', 'blur length'], conv: (v) => (v < 5 ? v * 200 : v) }, angle: { n: ['angle', 'direction'] } } },
  { vendor: 'Sapphire', plugin: 'S_ZoomBlur', to: 'radialBlur', test: /s_zoomblur|s_blurzoom|s_radialblur/i, set: { mode: 1 } },
  { vendor: 'Sapphire', plugin: 'S_Blur', to: 'blur', test: /s_blur/i, map: { radius: { n: ['width', 'blur amount'], conv: (v) => (v < 5 ? v * 100 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_WarpChroma', to: 'rgbSplit', test: /s_warpchroma|s_chroma/i, set: { mode: 2 }, map: { amount: { n: ['amount', 'shift'], conv: (v) => (v < 5 ? v * 60 : v) } } },
  { vendor: 'Sapphire', plugin: 'S_LensFlare', to: 'lensFlare', test: /s_lensflare|s_flare/i },
  { vendor: 'Sapphire', plugin: 'S_Rays', to: 'lightRays', test: /s_rays/i },
  { vendor: 'Sapphire', plugin: 'S_FilmEffect / S_FilmDamage', to: 'filmLook', test: /s_film/i },
  { vendor: 'Sapphire', plugin: 'S_DigitalDamage', to: 'glitch', test: /s_digitaldamage|s_glitch|s_damage/i },
  { vendor: 'Sapphire', plugin: 'S_TVDamage', to: 'vhs', test: /s_tv|s_retro/i },
  { vendor: 'Sapphire', plugin: 'S_Vignette', to: 'vignette', test: /s_vignette/i },
  { vendor: 'Sapphire', plugin: 'S_Kaleido', to: 'kaleida', test: /s_kaleid/i },
  { vendor: 'Sapphire', plugin: 'S_Distort', to: 'turbulentDisplace', test: /s_distort|s_warp/i },
  { vendor: 'Sapphire', plugin: 'S_HueSatBright', to: 'hueSat', test: /s_huesat/i },
  { vendor: 'Sapphire', plugin: 'S_Mosaic', to: 'mosaic', test: /s_mosaic/i },
  { vendor: 'Sapphire', plugin: 'S_Flicker', to: 'strobe', test: /s_flicker/i, set: { mode: 3, blend: 30 } },

  // BCC (Boris Continuum)
  { vendor: 'BCC', plugin: 'BCC Glow / Film Glow', to: 'deepGlow', test: /bcc.*glow/i, map: { radius: { n: ['glow radius', 'radius'] }, exposure: { n: ['glow intensity', 'intensity'], conv: (v) => (v > 10 ? v / 100 : v) } } },
  { vendor: 'BCC', plugin: 'BCC Lens Flare', to: 'lensFlare', test: /bcc.*flare/i },
  { vendor: 'BCC', plugin: 'BCC Light Leaks', to: 'lightLeak', test: /bcc.*leak/i },
  { vendor: 'BCC', plugin: 'BCC Prism', to: 'prism', test: /bcc.*prism/i, map: { amount: { n: ['prism amount', 'amount'] } } },
  { vendor: 'BCC', plugin: 'BCC Glitch / Damaged TV', to: 'glitch', test: /bcc.*(glitch|datamosh|damage)/i },
  { vendor: 'BCC', plugin: 'BCC VHS', to: 'vhs', test: /bcc.*vhs/i },
  { vendor: 'BCC', plugin: 'BCC Chromatic Aberration', to: 'rgbSplit', test: /bcc.*(chromatic|rgb)/i },
  { vendor: 'BCC', plugin: 'BCC Wiggle / Shake', to: 'shake', test: /bcc.*(shake|wiggle|jitter)/i },
  { vendor: 'BCC', plugin: 'BCC Rays', to: 'lightRays', test: /bcc.*rays/i },
  { vendor: 'BCC', plugin: 'BCC Radial / Zoom Blur', to: 'radialBlur', test: /bcc.*(radial|zoom|spin).*blur/i },
  { vendor: 'BCC', plugin: 'BCC Directional Blur', to: 'dirBlur', test: /bcc.*(directional|motion).*blur/i },
  { vendor: 'BCC', plugin: 'BCC Blur', to: 'blur', test: /bcc.*blur/i, map: { radius: { n: ['blur radius', 'blur amount', 'amount'] } } },
  { vendor: 'BCC', plugin: 'BCC Film', to: 'filmLook', test: /bcc.*film/i },
  { vendor: 'BCC', plugin: 'BCC Vignette', to: 'vignette', test: /bcc.*vignette/i },
  { vendor: 'BCC', plugin: 'BCC Kaleido', to: 'kaleida', test: /bcc.*kaleid/i },
  { vendor: 'BCC', plugin: 'BCC Twirl', to: 'twirl', test: /bcc.*twirl/i },
  { vendor: 'BCC', plugin: 'BCC Wave', to: 'waveWarp', test: /bcc.*wave/i },
  { vendor: 'BCC', plugin: 'BCC Pixelate / Mosaic', to: 'mosaic', test: /bcc.*(pixel|mosaic)/i },
  { vendor: 'BCC', plugin: 'BCC Flicker / Strobe', to: 'strobe', test: /bcc.*(flicker|strobe)/i },

  // ---------------------------------------------------------------- nativos do After Effects
  { vendor: ADOBE, plugin: 'Gaussian / Fast / Box Blur', to: 'blur', match: ['ADBE Gaussian Blur 2', 'ADBE Gaussian Blur', 'ADBE Fast Blur', 'ADBE Box Blur2', 'ADBE Box Blur', 'ADBE Camera Lens Blur', 'ADBE Compound Blur'],
    map: { radius: { i: 1, n: ['blurriness', 'blur radius', 'radius'] }, dims: { i: 2, n: ['blur dimensions'] } } },
  { vendor: ADOBE, plugin: 'Directional Blur', to: 'dirBlur', match: ['ADBE Motion Blur'], map: { angle: { i: 1, n: ['direction'] }, length: { i: 2, n: ['blur length'] } } },
  { vendor: ADOBE, plugin: 'Radial Blur', to: 'radialBlur', match: ['ADBE Radial Blur'], map: { amount: { i: 1, n: ['amount'] }, mode: { i: 3, n: ['type'], conv: (v) => (v === 2 ? 1 : 2) } } },
  { vendor: 'Cycore (CC)', plugin: 'CC Radial Blur', to: 'radialBlur', match: ['CC Radial Blur', 'CC Radial Fast Blur'], map: { amount: { n: ['amount'] }, mode: { n: ['type'], conv: (v) => (v === 4 ? 2 : 1) } } },
  { vendor: ADOBE, plugin: 'Pixel Motion Blur / CC Force Motion Blur', to: 'motionBlur', match: ['ADBE Pixel Motion Blur', 'CC Force Motion Blur'], map: { amount: { n: ['shutter angle'], conv: (v) => (v / 180) * 100 }, samples: { n: ['shutter samples', 'motion blur levels'] } } },
  { vendor: ADOBE, plugin: 'Glow', to: 'glow', match: ['ADBE Glo2', 'ADBE Glow'],
    map: { threshold: { i: 2, n: ['glow threshold'], conv: pct }, radius: { i: 3, n: ['glow radius'] }, intensity: { i: 4, n: ['glow intensity'] }, color: { i: 9, n: ['color a'] } } },
  { vendor: ADOBE, plugin: 'Exposure', to: 'exposure', match: ['ADBE Exposure2'], map: { exposure: { n: ['exposure'] }, offset: { n: ['offset'] }, gamma: { n: ['gamma correction', 'gamma'] } } },
  { vendor: ADOBE, plugin: 'Brightness & Contrast', to: 'brightnessContrast', match: ['ADBE Brightness & Contrast 2', 'ADBE Brightness & Contrast'], map: { brightness: { i: 1, n: ['brightness'] }, contrast: { i: 2, n: ['contrast'] } } },
  { vendor: ADOBE, plugin: 'Hue/Saturation', to: 'hueSat', match: ['ADBE HUE SATURATION', 'ADBE Color Balance (HLS)'],
    map: { hue: { n: ['master hue', 'hue'] }, saturation: { n: ['master saturation', 'saturation', 'colorize saturation'] }, lightness: { n: ['master lightness', 'lightness'] }, colorize: { n: ['colorize'] } } },
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
  { vendor: ADOBE, plugin: 'Motion Tile', to: 'motionTile', match: ['ADBE Tile'], map: { outW: { n: ['output width'] }, outH: { n: ['output height'] }, mirror: { n: ['mirror edges'] } } },
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
  for (const n of mapping?.n || []) {
    const hit = params.find((p) => normalize(p.name).includes(normalize(n)));
    if (hit) return hit;
  }
  if (mapping?.i != null) return params.find((p) => p.index === mapping.i) || null;
  return null;
}
