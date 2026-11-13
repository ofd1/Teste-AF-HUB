// Transições recriadas das edits de referência (Neymar / futebol), para a aba Transições.
// Cada transição tem a SAÍDA (fim do clipe que sai, "A") e a ENTRADA (começo do clipe que entra, "B") — como nas
// edits, o corte é seco e o efeito acontece dos dois lados dele (sem sobrepor os clipes).
// Formato das chaves: [u (0..1 da metade), valor, curva]. Os efeitos usados têm equivalente no After Effects
// (S_BlurMoCurves, Exposure, Tint, Fill, S_Glow, BCC, Twitch, Shatter, Deep Glow…) para exportar em .ffx.

const k = (...list) => list; // [[u, v, ease], ...]
const MAG = [1, 0.1, 0.85, 1], RED = [1, 0.08, 0.12, 1], BLUE = [0.1, 0.3, 1, 1];

// [id, nome, edit de origem, duração total (s), proporção A (0..1), efeitos A, efeitos B, transform A, transform B]
const LIST = [
  ['luz-verde-zoom', 'Luz verde + zoom', 'Edit 1 · 0:01', 0.7, 0.35,
    [['exposure', { exposure: k([0, 0], [1, -3, 'easeIn']) }]],
    [['blurMoCurves', { zDist: k([0, 0.55], [1, 1, 'expoOut']), shutter: 2, samples: 20 }], ['sGlow', { brightness: k([0, 7], [1, 0, 'easeOut']), color: [0.35, 1, 0.25, 1], threshold: 0.35, width: 1.2 }]]],
  ['giro-blur', 'Giro com blur', 'Edit 1 · 0:01', 0.4, 0.45,
    [['blurMoCurves', { rotate: k([0, 0], [1, -80, 'easeIn']), zDist: k([0, 1], [1, 0.85, 'easeIn']), shutter: 2.5, samples: 24 }]],
    [['blurMoCurves', { rotate: k([0, 70], [1, 0, 'expoOut']), zDist: k([0, 0.8], [1, 1, 'expoOut']), shutter: 2.5, samples: 24 }]]],
  ['espelho-esticado', 'Espelho esticado (zoom out)', 'Edit 1 · 0:02', 0.45, 0.4,
    [['blurMoCurves', { zDist: k([0, 1], [1, 0.5, 'easeIn']), shutter: 3, samples: 24, wrap: 3, wrapY: 3 }]],
    [['blurMoCurves', { zDist: k([0, 0.35], [1, 1, 'expoOut']), shutter: 3, samples: 24, wrap: 3, wrapY: 3 }]]],
  ['mergulho-preto', 'Mergulho no preto + brilho', 'Edit 1 · 0:02', 0.6, 0.55,
    [['exposure', { exposure: k([0, 0], [1, -4.5, 'easeIn']) }], ['sGlow', { brightness: k([0, 0], [1, 4]), threshold: 0.75, width: 0.8 }]],
    [['exposure', { exposure: k([0, -3], [1, 0, 'easeOut']) }], ['sGlow', { brightness: k([0, 3], [1, 0]), threshold: 0.7, width: 0.8 }]]],
  ['estouro-branco', 'Estouro branco (silhueta)', 'Edit 1 · 0:03', 0.45, 0.4,
    [['exposure', { exposure: k([0, 0], [1, 4, 'easeIn']) }], ['sGlow', { brightness: k([0, 0], [1, 8]), threshold: 0.45, width: 1 }]],
    [['exposure', { exposure: k([0, 3.5], [1, 0, 'expoOut']) }]]],
  ['iris-circulo', 'Íris (círculo abrindo)', 'Edit 1 · 0:04', 0.5, 0.25,
    [['exposure', { exposure: k([0, 0], [1, 3, 'easeIn']) }]],
    [['pkWipe', { mode: 3, pct: k([0, 100], [1, 0, 'easeOut']), soft: 6, invert: true }]]],
  ['onda-magenta', 'Onda magenta', 'Edit 1 · 0:04', 0.45, 0.5,
    [['fill', { color: MAG, opacity: k([0, 0], [1, 85, 'easeIn']) }], ['pkWipe', { mode: 8, pct: k([0, 0], [1, 40]), freq: 14, invert: true, soft: 10 }]],
    [['fill', { color: RED, opacity: k([0, 70], [1, 0, 'easeOut']) }]]],
  ['cortina-v', 'Cortina em V', 'Edit 1 · 0:05', 0.45, 0.3,
    [['exposure', { exposure: k([0, 0], [1, -2]) }]],
    [['pkWipe', { mode: 10, pct: k([0, 100], [1, 0, 'easeOut']), soft: 3, angle: 90 }]]],
  ['flash-vermelho-glitch', 'Flash vermelho glitch', 'Edit 2 · 0:08', 0.5, 0.4,
    [['tint', { black: [0.25, 0, 0, 1], white: [1, 0.25, 0.25, 1], amount: k([0, 0], [1, 100, 'easeIn']) }]],
    [['tint', { black: [0.25, 0, 0, 1], white: [1, 0.25, 0.25, 1], amount: k([0, 100], [1, 0, 'easeOut']) }], ['twitch', { amount: k([0, 160], [1, 0]), speed: 80, blur: false, light: true, lightAmt: 60, color: true, colorAmt: 80, slide: true, slideAmt: 80, slideDir: 2 }]]],
  ['zoom-streak', 'Zoom streak (soco)', 'Edit 2 · 0:10', 0.4, 0.45,
    [['blurMoCurves', { zDist: k([0, 1], [1, 0.4, 'easeIn']), shutter: 3, samples: 24 }]],
    [['blurMoCurves', { zDist: k([0, 2.2], [1, 1, 'expoOut']), shutter: 3, samples: 24 }], ['exposure', { exposure: k([0, 2], [1, 0, 'easeOut']) }]]],
  ['zoom-blur-luz', 'Zoom blur com luz', 'Edit 2 · 0:11', 0.5, 0.5,
    [['radialBlur', { mode: 1, amount: k([0, 0], [1, 80, 'easeIn']) }], ['exposure', { exposure: k([0, 0], [1, 1.5]) }]],
    [['radialBlur', { mode: 1, amount: k([0, 80], [1, 0, 'easeOut']) }], ['exposure', { exposure: k([0, 1.5], [1, 0]) }]]],
  ['iris-escura', 'Íris escura (blur)', 'Edit 2 · 0:12', 0.5, 0.35,
    [['blurMoCurves', { zDist: k([0, 1], [1, 0.8]), shutter: 2.5 }], ['exposure', { exposure: k([0, 0], [1, 1.5]) }]],
    [['pkWipe', { mode: 3, pct: k([0, 100], [1, 0, 'easeOut']), soft: 1.5, border: 3, borderColor: [0.05, 0.05, 0.1, 1], invert: true }]]],
  ['whip-diagonal', 'Whip diagonal', 'Edit 2 · 0:12', 0.36, 0.45,
    [['blurMoCurves', { shiftX: k([0, 0], [1, -900, 'easeIn']), shiftY: k([0, 0], [1, 500, 'easeIn']), rotate: k([0, 0], [1, -25, 'easeIn']), shutter: 2.5, samples: 24 }]],
    [['blurMoCurves', { shiftX: k([0, 900], [1, 0, 'expoOut']), shiftY: k([0, -500], [1, 0, 'expoOut']), rotate: k([0, 25], [1, 0, 'expoOut']), shutter: 2.5, samples: 24 }]]],
  ['espelho-flip', 'Espelho (flip) + amarelo', 'Edit 3 · 0:08', 0.5, 0.4,
    [], [['tint', { black: [0.2, 0.15, 0, 1], white: [1, 0.95, 0.2, 1], amount: k([0, 100], [1, 0, 'easeOut']) }], ['exposure', { exposure: k([0, 1], [1, 0]) }]],
    { scale: ['abs', k([0, [100, 100], 'hold'], [0.5, [-100, 100], 'hold'], [1, [-100, 100]])] }],
  ['flash-amarelo', 'Flash amarelo (duotone)', 'Edit 3 · 0:08', 0.4, 0.35,
    [['tint', { black: [0.2, 0.15, 0, 1], white: [1, 0.95, 0.2, 1], amount: k([0, 0], [1, 100, 'easeIn']) }]],
    [['tint', { black: [0.2, 0.15, 0, 1], white: [1, 0.95, 0.2, 1], amount: k([0, 100], [1, 0, 'easeOut']) }]]],
  ['smear-lateral', 'Smear lateral', 'Edit 3 · 0:09', 0.4, 0.5,
    [['bccDirBlur', { amount: k([0, 0], [1, 220, 'easeIn']), angle: 90 }], ['blurMoCurves', { shiftX: k([0, 0], [1, -300, 'easeIn']), shutter: 1.5 }]],
    [['bccDirBlur', { amount: k([0, 220], [1, 0, 'easeOut']), angle: 90 }], ['blurMoCurves', { shiftX: k([0, 300], [1, 0, 'expoOut']), shutter: 1.5 }]]],
  ['flash-duotone-roxo', 'Flash duotone roxo/ciano', 'Edit 3 · 0:09', 0.55, 0.5,
    [['tint', { black: [0.45, 0.08, 0.7, 1], white: [0.4, 1, 0.85, 1], amount: k([0, 0], [0.15, 100, 'hold'], [1, 100]) }]],
    [['tint', { black: [0.45, 0.08, 0.7, 1], white: [0.4, 1, 0.85, 1], amount: k([0, 100], [1, 0, 'easeOut']) }], ['bccDirBlur', { amount: k([0, 160], [1, 0, 'easeOut']), angle: 90 }]]],
  ['desfoque-foco', 'Desfoque (focus pull)', 'Edit 3 · 0:06', 0.5, 0.45,
    [['bccLensBlur', { irisScale: k([0, 0], [1, 30, 'easeIn']) }]],
    [['bccLensBlur', { irisScale: k([0, 30], [1, 0, 'easeOut']) }]]],
  ['flash-piscante', 'Flash branco piscante', 'Edit 4 · 0:12', 0.5, 0.2,
    [['exposure', { exposure: k([0, 0], [1, 3]) }]],
    [['exposure', { exposure: k([0, 3, 'hold'], [0.25, 0.3, 'hold'], [0.5, 2.5, 'hold'], [0.75, 0.2], [1, 0]) }]]],
  ['explosao-luz', 'Explosão de luz', 'Edit 4 · 0:10', 0.6, 0.5,
    [['deepGlow', { radius: 320, exposure: k([0, 0], [1, 6, 'easeIn']), threshold: 40 }]],
    [['deepGlow', { radius: 320, exposure: k([0, 6], [1, 0, 'easeOut']), threshold: 40 }]]],
  ['flash-cores', 'Flash colorido (vermelho/azul)', 'Edit 4 · 0:15', 0.5, 0.3,
    [['fill', { color: RED, opacity: k([0, 0], [1, 70]) }]],
    [['fill', { color: k([0, BLUE, 'hold'], [0.3, RED, 'hold'], [0.6, BLUE, 'hold'], [1, BLUE]), opacity: k([0, 75], [1, 0, 'easeOut']) }]]],
  ['cacos-vidro', 'Cacos de vidro (shatter)', 'Edit 5 · 0:08', 0.6, 0.6,
    [['shatter', { start: 0, render: 1, pattern: 1, repetitions: 18, strength: 9, radius: 1.2, gravity: 0.5, spin: 1, zPush: 1.6 }]],
    [['blurMoCurves', { zDist: k([0, 0.75], [1, 1, 'expoOut']), shutter: 2 }]]],
  ['smear-vermelho', 'Smear vermelho', 'Edit 5 · 0:09', 0.4, 0.5,
    [['bccDirBlur', { amount: k([0, 0], [1, 260, 'easeIn']), angle: 90 }], ['tint', { black: [0.3, 0, 0.02, 1], white: [1, 0.3, 0.3, 1], amount: k([0, 0], [1, 80]) }]],
    [['bccDirBlur', { amount: k([0, 260], [1, 0, 'easeOut']), angle: 90 }], ['tint', { black: [0.3, 0, 0.02, 1], white: [1, 0.3, 0.3, 1], amount: k([0, 80], [1, 0]) }]]],
  ['queima-luz', 'Queima de luz (film burn)', 'Edit 5 · 0:09', 0.6, 0.5,
    [['exposure', { exposure: k([0, 0], [1, -2.5]) }], ['lightLeak', { intensity: k([0, 0], [1, 2.2]), hue: 0.06, speed: 2, mode: 2 }]],
    [['exposure', { exposure: k([0, -1.5], [1, 0]) }], ['lightLeak', { intensity: k([0, 2.2], [1, 0]), hue: 0.06, speed: 2, mode: 2 }]]],
  ['moldura-branca', 'Flash branco seco', 'Edit 5 · 0:10', 0.3, 0.4,
    [['exposure', { exposure: k([0, 0], [1, 5, 'easeIn']) }]],
    [['exposure', { exposure: k([0, 5, 'hold'], [0.2, 5], [1, 0, 'easeOut']) }]]],
  ['flash-azul', 'Flash azul', 'Edit 5 · 0:11', 0.4, 0.3,
    [['tint', { black: [0, 0.02, 0.2, 1], white: [0.3, 0.55, 1, 1], amount: k([0, 0], [1, 100]) }]],
    [['tint', { black: [0, 0.02, 0.2, 1], white: [0.3, 0.55, 1, 1], amount: k([0, 100], [1, 0, 'easeOut']) }]]],
  ['tinta-vermelha', 'Tinta vermelha', 'Edit 6 · 0:07', 0.7, 0.4,
    [['fill', { color: RED, opacity: k([0, 0], [1, 90, 'easeIn']) }]],
    [['pkWipe', { mode: 14, pct: k([0, 100], [1, 0, 'easeOut']), soft: 4, freq: 6, border: 4, borderColor: [1, 0.1, 0.1, 1], invert: true }], ['fill', { color: RED, opacity: k([0, 50], [1, 0]) }]]],
  ['matte-grunge', 'Máscara grunge (fumaça)', 'Edit 6 · 0:08', 0.9, 0.3,
    [['exposure', { exposure: k([0, 0], [1, -2]) }]],
    [['texturedWipe', { animation: 1, amount: k([0, 100], [1, 0, 'easeOut']), softness: 35, blur: 12, texture: 2, texInt: 70, fscale: 90 }]]],
];

const conv = (keys, d) => keys.map(([u, v, ease]) => ({ t: +(u * d).toFixed(4), v, ease: ease || 'easeInOut' }));
const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'number' && v[0].length >= 2 && !(v.length === 4 && v.every((x) => typeof x === 'number'));
const fxList = (list, d) => list.map(([type, params]) => ({ type, params: Object.fromEntries(Object.entries(params).map(([p, v]) => [p, isKeys(v) ? { keys: conv(v, d) } : v])) }));
const trList = (tr, d) => Object.fromEntries(Object.entries(tr || {}).map(([p, [mode, keys]]) => [p, { mode, keys: conv(keys, d) }]));

/** Transições das edits: { id, name, src, dur, make(d) → { a: preset da saída, b: preset da entrada } }. */
export const EDIT_TRANSITIONS = LIST.map(([id, name, src, dur, ra, A, B, TA, TB]) => ({
  id: `et:${id}`, slug: id, name, src, dur, cat: 'Das edits', kind: 'trans',
  make: (d = dur) => {
    const da = Math.max(0.05, d * ra), db = Math.max(0.05, d * (1 - ra));
    return {
      a: { name: `${name} (saída)`, anchor: 'end', duration: da, transform: trList(TA, da), effects: fxList(A, da) },
      b: B.length || TB ? { name: `${name} (entrada)`, anchor: 'playhead', duration: db, transform: trList(TB, db), effects: fxList(B, db) } : null,
    };
  },
}));

/** Shakes vistos nas edits (impacto curto com motion blur, giro de câmera, tremor contínuo). */
export const EDIT_SHAKES = [
  { slug: 'shake-impacto', name: 'Shake impacto (edit)', duration: 0.45, anchorStart: true, effects: [{ type: 'shake', params: { mode: 2, impactAt: 0, decay: 0.4, frequency: 16, amount: 120, rotation: 5, zoom: 8, shutter: 1.6, samples: 16, complexity: 2 } }] },
  { slug: 'shake-giro', name: 'Shake com giro de câmera', duration: 0.8, anchorStart: true, effects: [{ type: 'shake', params: { mode: 2, impactAt: 0, decay: 0.7, frequency: 8, amount: 60, rotation: 14, zoom: 10, shutter: 2, samples: 20, complexity: 2 } }] },
  { slug: 'shake-continuo', name: 'Shake contínuo leve (edit)', duration: 2, effects: [{ type: 'shake', params: { frequency: 6, amount: 22, rotation: 1.2, zoom: 2, shutter: 1, complexity: 3 } }] },
  { slug: 'shake-sapphire', name: 'S_Shake twitchy (edit)', duration: 1, effects: [{ type: 'shake', params: { sapphire: true, style: 2, frequency: 3, amount: 120, rotation: 4, zoom: 6, stillness: 0.6, twitchFreq: 4, shutter: 1.4, samples: 16 } }] },
];

// ---------------------------------------------------------------- .ffx para o After Effects
const README = `MotionFrame — transições e shakes recriados das edits (After Effects)

Cada transição tem 2 arquivos:
  • "... - 1 SAIDA.ffx": aplique no clipe que SAI. Coloque o indicador de tempo (CTI) um pouco antes do corte
    (a duração está no nome, ex.: 0.20s = 6 quadros a 30 fps) e dê dois cliques no preset.
  • "... - 2 ENTRADA.ffx": aplique no clipe que ENTRA, com o CTI exatamente no corte.
Os keyframes são colocados a partir do CTI (como todo preset do AE).

Plugins usados (os mesmos das edits): Sapphire (S_BlurMoCurves, S_Glow, S_Shake), BCC (Directional Blur, Lens Blur),
Video Copilot Twitch, Deep Glow e efeitos nativos (Exposure, Tint, Fill, Shatter).
Alguns efeitos só existem no MotionFrame (máscaras de íris/cunha/tinta, light leak, wipe grunge, espelho): eles aparecem
na lista "fora do .ffx" de cada transição — use o equivalente do AE indicado.
Desfoque (focus pull): no BCC Lens Blur, anime o Iris Scale de 30 até 0 (saída: 0 → 30) — o molde não leva esse keyframe.
Reverse: no AE é feito na camada (Time > Time-Reverse Layer ou Time Remap), não dá para ir num .ffx de efeito.
`;
const AE_HINT = { 'Transição – wipe': 'máscara animada (círculo/cunha) ou CC Radial ScaleWipe', 'Light Leaks': 'overlay de light leak ou Optical Flares', 'Textured Wipe': 'BCC Textured Wipe (o mesmo nome)', 'Espelhar': 'Escala X = -100 na camada' };

/** Gera os .ffx (zip) das transições/shakes. deps: { effectsToFFX, LAYER_FACTORIES, createProject, applyPreset }. */
export async function buildFFXPack(items, deps, { dur = null, shakes = true } = {}) {
  const { effectsToFFX, LAYER_FACTORIES, createProject, applyPreset } = deps;
  const files = [{ name: 'LEIA-ME.txt', data: README }];
  const notes = [];
  const P = createProject(1080, 1920); P.fps = 30;
  const toFFX = async (preset, label) => {
    const L = LAYER_FACTORIES.solid(P); L.inPoint = 0; L.outPoint = (preset.duration || 1) + 0.001;
    applyPreset(L, preset, 0);
    const { bytes, report } = await effectsToFFX(L.effects, { fps: 30, name: label });
    const fora = [...report.skipped, ...(Object.keys(preset.transform || {}).length ? ['Espelhar (transform)'] : [])];
    return { bytes, fora };
  };
  let n = 0;
  for (const it of items) {
    n++;
    const d = dur ?? it.dur;
    const { a, b } = it.make(d);
    const base = `${String(n).padStart(2, '0')} ${it.name.replace(/[\\/:*?"<>|]/g, '-')}`;
    const fora = [];
    for (const [part, tag] of [[a, '1 SAIDA'], [b, '2 ENTRADA']]) {
      if (!part) continue;
      const r = await toFFX(part, `${it.name} ${tag}`);
      if (r.bytes) files.push({ name: `transicoes/${base} - ${tag} (${part.duration.toFixed(2)}s).ffx`, data: r.bytes });
      fora.push(...r.fora);
    }
    if (fora.length) notes.push(`${base}: fora do .ffx → ${[...new Set(fora)].map((f) => { const t = Object.keys(AE_HINT).find((k) => f.includes(k)); return t ? `${f} (no AE: ${AE_HINT[t]})` : f; }).join('; ')}`);
  }
  if (shakes) for (const s of EDIT_SHAKES) {
    const r = await toFFX(s, s.name);
    if (r.bytes) files.push({ name: `shakes/${s.name.replace(/[\\/:*?"<>|]/g, '-')}.ffx`, data: r.bytes });
  }
  if (notes.length) files[0].data += `\nO que ficou fora de cada .ffx:\n${notes.map((x) => `  • ${x}`).join('\n')}\n`;
  return files;
}
