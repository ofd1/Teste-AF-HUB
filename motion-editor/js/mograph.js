// Pacote de motion design (nicho "MoGraph"): o que os pacotes mais usados no After Effects trazem
// (Animation Composer, Motion Bro, Flow, Typemonkey, logo reveals) recriado com as peças do MotionFrame:
//  • tipografia cinética: revelar por linha, elástico por letra, decode (letras embaralhadas), tracking cinematográfico,
//    cascata, onda, cor varrendo, quique por letra…
//  • entradas/saídas de motion design: curvas expo (pouso longo), elástico, overshoot, squash & stretch, slide com
//    motion blur, flip de cartão;
//  • elementos de mograph em camadas de forma com Trim Paths: linhas desenhando, anel desenhando, explosão de linhas,
//    sublinhado, caixa de destaque, ondas, pontos;
//  • logo reveal aplicado na camada da logo (brilho passando, elástico + anel, glitch, desfoque com zoom);
//  • projeto de demonstração de uma logo inteira feita só com essas peças.
import { LAYER_FACTORIES, createProject } from './state.js';
import { uid } from './util.js';

const A = (v) => ({ value: v, keys: [] });
const KF = (list) => ({ value: list[0][1], keys: list.map(([t, v, ease]) => ({ t: +t.toFixed(4), v, ease: ease || 'linear' })) });
const K2 = (t0, v0, t1, v1, ease = 'expoOut') => KF([[t0, v0, ease], [t1, v1]]);
const sel = (o) => ({ type: 'range', based: 1, shape: 1, smooth: 100, start: A(0), end: A(100), ...o });

// ---------------------------------------------------------------- tipografia cinética (animadores de texto)
// mk(d, fs) → lista de animadores com tempos a partir de 0 (o Composer desloca para o início do texto)
export const MO_TEXT = [
  ['Revelar por linha (máscara)', (d, fs) => [{ props: { position: A([0, fs * 1.1]), opacity: A(0) }, selectors: [sel({ based: 4, shape: 1, smooth: 100, start: K2(0, 0, d, 100, 'expoOut') })] }]],
  ['Subir palavra (expo)', (d, fs) => [{ props: { position: A([0, fs * 0.9]), opacity: A(0) }, selectors: [sel({ based: 3, shape: 1, start: K2(0, 0, d, 100, 'expoOut') })] }]],
  ['Elástico por letra', (d) => [{ props: { scale: A([0, 0]) }, selectors: [sel({ shape: 1, start: K2(0, 0, d, 100, 'elastic') })] }]],
  ['Decodificar (letras embaralhadas)', (d) => [
    { props: { scramble: A(100), fillColor: A([0.45, 0.85, 1]) }, selectors: [sel({ smooth: 0, start: K2(0, 0, d, 100, 'linear') })] },
    { props: { opacity: A(0) }, selectors: [sel({ smooth: 0, start: K2(0, 0, d * 0.35, 100, 'linear') })] },
  ]],
  ['Tracking cinematográfico', (d) => [{ props: { tracking: K2(0, 420, d, 0, 'expoOut'), opacity: K2(0, 0, d * 0.5, 100, 'easeOut'), blur: K2(0, [18, 18], d * 0.7, [0, 0], 'expoOut') }, selectors: [] }]],
  ['Cascata (girar e cair)', (d, fs) => [{ props: { rotation: A(-70), position: A([0, -fs * 0.8]), opacity: A(0) }, selectors: [sel({ shape: 1, start: K2(0, 0, d, 100, 'back') })] }]],
  ['Quique por letra', (d, fs) => [{ props: { position: A([0, -fs * 1.4]), opacity: A(0) }, selectors: [sel({ shape: 1, start: K2(0, 0, d, 100, 'bounce') })] }]],
  ['Onda de escala (contínua)', (d) => [{ props: { scale: A([150, 150]) }, selectors: [sel({ shape: 4, smooth: 100, start: A(-30), end: A(30), offset: KF([[0, -40], [d * 2, 140]]) })] }]],
  ['Cor varrendo', (d) => [{ props: { fillColor: A([1, 0.78, 0.2]) }, selectors: [sel({ shape: 1, start: A(0), end: K2(0, 0, d, 100, 'expoOut') })] }]],
  ['Desfoque direcional por palavra', (d, fs) => [{ props: { position: A([fs * 1.5, 0]), blur: A([30, 4]), opacity: A(0) }, selectors: [sel({ based: 3, shape: 1, start: K2(0, 0, d, 100, 'expoOut') })] }]],
  ['Esticar e pousar', (d) => [{ props: { scale: A([100, 260]), opacity: A(0) }, selectors: [sel({ shape: 1, start: K2(0, 0, d, 100, 'expoOut') })] }]],
  ['Glitch de texto', (d, fs) => [
    { props: { scramble: A(60), position: A([fs * 0.15, 0]) }, selectors: [{ type: 'wiggly', based: 1, mode: 1, max: A(100), min: A(-100), freq: A(9), correlation: A(10), amount: K2(0, 100, d, 0, 'expoOut') }] },
  ]],
];

// ---------------------------------------------------------------- entradas/saídas de motion design
// [nome, transform, efeitos] no mesmo formato das entradas do Composer (u = 0..1)
export const MO_INOUT = (W, H) => [
  ['Expo slide ←', { position: ['rel', [[0, [W * 0.55, 0], 'expoOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0, 'linear'], [0.25, 100]]] }, [['motionBlur', { amount: 100, samples: 14 }]]],
  ['Expo slide ↑', { position: ['rel', [[0, [0, H * 0.35], 'expoOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0, 'linear'], [0.25, 100]]] }, [['motionBlur', { amount: 100, samples: 14 }]]],
  ['Elástico (overshoot)', { scale: ['abs', [[0, [0, 0], 'elastic'], [1, [100, 100]]]] }],
  ['Squash & stretch', { scale: ['abs', [[0, [40, 160], 'expoOut'], [0.45, [118, 86], 'easeInOut'], [0.75, [94, 106], 'easeInOut'], [1, [100, 100]]]], opacity: ['abs', [[0, 0, 'linear'], [0.15, 100]]] }],
  ['Flip de cartão', { scale: ['abs', [[0, [0, 100], 'expoOut'], [1, [100, 100]]]], rotation: ['abs', [[0, -8, 'expoOut'], [1, 0]]] }],
  ['Zoom punch', { scale: ['abs', [[0, [240, 240], 'expoOut'], [1, [100, 100]]]], opacity: ['abs', [[0, 0, 'linear'], [0.2, 100]]] }, [['radialBlur', { amount: [[0, 60, 'expoOut'], [0.7, 0]] }]]],
  ['Swing (pendurado)', { rotation: ['abs', [[0, 75, 'elastic'], [1, 0]]], opacity: ['abs', [[0, 0, 'linear'], [0.2, 100]]] }],
  ['Rodar e pousar', { rotation: ['abs', [[0, 200, 'expoOut'], [1, 0]]], scale: ['abs', [[0, [20, 20], 'expoOut'], [1, [100, 100]]]] }, [['motionBlur', { amount: 120, samples: 16 }]]],
  ['Desfoque + escala (suave)', { scale: ['abs', [[0, [120, 120], 'expoOut'], [1, [100, 100]]]], opacity: ['abs', [[0, 0, 'easeOut'], [0.6, 100]]] }, [['blur', { radius: [[0, 40, 'expoOut'], [1, 0]] }]]],
  ['Whip in (lateral rápido)', { position: ['rel', [[0, [-W * 1.1, 0], 'expoOut'], [1, [0, 0]]]] }, [['dirBlur', { angle: 90, length: [[0, 180, 'expoOut'], [0.8, 0]] }]]],
];

// ---------------------------------------------------------------- elementos de mograph (camadas de forma)
const poly = (vs) => ({ t: 'path', path: { shapes: [{ closed: false, pts: vs.flatMap((v) => [v, v, v]) }], times: [] } });
const it = {
  rect: (size, pos = [0, 0], round = 0) => ({ t: 'rect', size: A(size), position: A(pos), round: A(round) }),
  ellipse: (size, pos = [0, 0]) => ({ t: 'ellipse', size: A(size), position: A(pos) }),
  star: (points, outer, inner, kind = 1, rot = 0) => ({ t: 'star', points: A(points), outer: A(outer), inner: A(inner), kind, rotation: A(rot), position: A([0, 0]) }),
  // caminho aberto reto: cada vértice é [ponto, alça de saída, alça de entrada]
  line: (x0, y0, x1, y1) => poly([[x0, y0], [x1, y1]]),
  fill: (c, op = 100) => ({ t: 'fill', color: A(c), opacity: A(op) }),
  stroke: (c, w, cap = 2) => ({ t: 'stroke', color: A(c), width: A(w), opacity: A(100), cap, join: 2 }),
  trim: (start, end, offset = A(0)) => ({ t: 'trim', start, end, offset }),
  group: (items, tr = {}) => ({ t: 'group', items, tr: { position: A([0, 0]), scale: A([100, 100]), rotation: A(0), opacity: A(100), anchor: A([0, 0]), ...tr } }),
};
const WHITE = [1, 1, 1], ACCENT = [0.49, 0.36, 1], WARM = [1, 0.78, 0.2], CYAN = [0.3, 0.85, 1];
/** "Desenhar e apagar" (Trim Paths): End 0→100 e depois Start 0→100. */
const drawErase = (d, e1 = 0.55, s0 = 0.45) => it.trim(KF([[d * s0, 0, 'expoInOut'], [d, 100]]), KF([[0, 0, 'expoOut'], [d * e1, 100]]));
const drawOnly = (d) => it.trim(A(0), KF([[0, 0, 'expoOut'], [d, 100]]));

export const MO_ELEMENTS = [
  ['Anel desenhando', (P, d) => shapeLayer(P, [it.group([it.ellipse([P.width * 0.42, P.width * 0.42]), drawErase(d), it.stroke(WHITE, P.width * 0.012)], { rotation: KF([[0, -90, 'expoOut'], [d, 90]]) })])],
  ['Explosão de linhas (burst)', (P, d) => {
    const n = 10, r0 = P.width * 0.08, r1 = P.width * 0.26, items = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      items.push(it.group([it.line(c * r0, s * r0, c * r1, s * r1), drawErase(d * 0.8, 0.5, 0.3), it.stroke(i % 2 ? WARM : WHITE, P.width * 0.01)]));
    }
    return shapeLayer(P, items);
  }],
  ['Sublinhado desenhando', (P, d) => shapeLayer(P, [it.group([it.line(-P.width * 0.32, P.height * 0.08, P.width * 0.32, P.height * 0.08), drawOnly(d), it.stroke(WARM, P.width * 0.012)])])],
  ['Caixa de destaque', (P, d) => shapeLayer(P, [it.group([it.rect([P.width * 0.7, P.width * 0.22], [0, 0], 18), it.trim(A(0), KF([[0, 0, 'expoInOut'], [d, 100]]), A(45)), it.stroke(ACCENT, P.width * 0.008)])])],
  ['Círculos em onda', (P, d) => shapeLayer(P, [0, 1, 2].map((k) => it.group([it.ellipse([P.width * 0.2, P.width * 0.2]), it.stroke(k === 1 ? CYAN : WHITE, P.width * 0.006)], {
    scale: KF([[d * k * 0.18, [0, 0], 'expoOut'], [d * (0.6 + k * 0.18), [100 + k * 70, 100 + k * 70]]]),
    opacity: KF([[d * (0.3 + k * 0.18), 100, 'easeIn'], [d * (0.75 + k * 0.08), 0]]),
  })))],
  ['Estrela pop', (P, d) => shapeLayer(P, [it.group([it.star(5, P.width * 0.09, P.width * 0.04), it.fill(WARM)], { scale: KF([[0, [0, 0], 'elastic'], [d * 0.7, [100, 100], 'expoIn'], [d, [0, 0]]]), rotation: KF([[0, -90, 'expoOut'], [d, 40]]) })])],
  ['Linhas de velocidade', (P, d) => shapeLayer(P, [-1, 0, 1].map((k) => it.group([it.line(-P.width * 0.45, k * P.height * 0.05, P.width * 0.45, k * P.height * 0.05), drawErase(d * (0.8 + Math.abs(k) * 0.15), 0.45, 0.35), it.stroke(WHITE, P.width * 0.005)])))],
  ['Pontos saltando', (P, d) => shapeLayer(P, [-1, 0, 1].map((k) => it.group([it.ellipse([P.width * 0.04, P.width * 0.04], [k * P.width * 0.07, 0]), it.fill(k ? WHITE : ACCENT)], {
    position: KF([[d * (0.1 + (k + 1) * 0.1), [0, 0], 'easeOut'], [d * (0.3 + (k + 1) * 0.1), [0, -P.height * 0.05], 'easeIn'], [d * (0.5 + (k + 1) * 0.1), [0, 0]]]),
  })))],
  ['Moldura (cantos)', (P, d) => {
    const w = P.width * 0.38, h = P.height * 0.2, c = P.width * 0.06, items = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) items.push(it.group([poly([[sx * w, sy * (h - c)], [sx * w, sy * h], [sx * (w - c), sy * h]]), drawOnly(d * 0.6), it.stroke(WHITE, P.width * 0.008)], { scale: KF([[0, [130, 130], 'expoOut'], [d, [100, 100]]]) }));
    return shapeLayer(P, items);
  }],
];
// ---------------------------------------------------------------- mais mograph (Repetidor, templates com texto, padrões)
const rep = (copies, o = {}) => ({ t: 'repeater', copies: typeof copies === 'object' ? copies : A(copies), offset: A(0), position: A(o.position || [0, 0]), scale: A(o.scale || [100, 100]), rotation: A(o.rotation || 0), anchor: A([0, 0]), startOpacity: A(o.o0 ?? 100), endOpacity: A(o.o1 ?? 100) });
const PALETTE = [[1, 0.78, 0.2], [0.49, 0.36, 1], [0.3, 0.85, 1], [1, 0.36, 0.5], [0.4, 1, 0.6], [1, 1, 1]];
function textLayer(P, text, fs, weight = 800, color = '#ffffff') { const t = LAYER_FACTORIES.text(P); Object.assign(t.props, { text, fontSize: fs, fontWeight: weight, color }); return t; }
MO_ELEMENTS.push(
  ['Radar (anéis repetidos)', (P, d) => shapeLayer(P, [it.group([it.ellipse([P.width * 0.12, P.width * 0.12]), it.stroke(CYAN, P.width * 0.004), rep(6, { scale: [135, 135], o0: 100, o1: 0 })], {
    scale: KF([[0, [0, 0], 'expoOut'], [d * 0.5, [100, 100], 'easeInOut'], [d, [140, 140]]]), opacity: KF([[d * 0.6, 100, 'easeIn'], [d, 0]]) })])],
  ['Espiral de quadrados', (P, d) => shapeLayer(P, [it.group([it.rect([P.width * 0.42, P.width * 0.42], [0, 0], 8), it.stroke(WHITE, P.width * 0.004), rep(14, { scale: [90, 90], rotation: 12, o0: 100, o1: 15 })], {
    rotation: KF([[0, -120, 'expoOut'], [d, 40]]), scale: KF([[0, [0, 0], 'expoOut'], [d * 0.6, [100, 100], 'expoIn'], [d, [0, 0]]]) })])],
  ['Grade de pontos', (P, d) => shapeLayer(P, [it.group([it.group([{ t: 'ellipse', size: KF([[0, [0, 0], 'elastic'], [d * 0.6, [P.width * 0.025, P.width * 0.025]], [d, [0, 0]]]), position: A([0, 0]) }, it.fill(WHITE), rep(8, { position: [P.width * 0.07, 0] })], { position: A([-P.width * 0.245, 0]) }), rep(6, { position: [0, P.width * 0.07] })], { position: A([0, -P.width * 0.175]) })])],
  ['Equalizador (barras)', (P, d) => {
    const n = 9, bw = P.width * 0.035, items = [];
    for (let i = 0; i < n; i++) {
      const ks = []; for (let k = 0; k <= 8; k++) ks.push([(d * k) / 8, [bw, P.height * (0.05 + 0.25 * Math.abs(Math.sin(i * 1.7 + k * 2.3)))], 'easeInOut']);
      items.push(it.group([{ t: 'rect', size: KF(ks), position: A([(i - (n - 1) / 2) * bw * 1.6, 0]), round: A(bw / 2) }, it.fill(PALETTE[i % 3])]));
    }
    return shapeLayer(P, items);
  }],
  ['Confete', (P, d) => {
    const items = []; let s2 = 3;
    const r = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    for (let i = 0; i < 40; i++) {
      const x0 = (r() - 0.5) * P.width * 0.2, x1 = (r() - 0.5) * P.width * 1.1, y1 = P.height * (0.2 + r() * 0.5), sz = P.width * (0.012 + r() * 0.012);
      items.push(it.group([i % 2 ? it.rect([sz, sz * 0.5]) : it.ellipse([sz, sz]), it.fill(PALETTE[i % PALETTE.length])], {
        position: KF([[0, [x0, 0], 'expoOut'], [d * 0.35, [x1 * 0.7, -P.height * (0.2 + r() * 0.25)], 'easeIn'], [d, [x1, y1]]]),
        rotation: KF([[0, 0, 'linear'], [d, (r() - 0.5) * 1080]]), opacity: KF([[d * 0.75, 100, 'easeIn'], [d, 0]]),
      }));
    }
    return shapeLayer(P, items);
  }],
  ['Transição de círculos (cobre a tela)', (P, d) => {
    const R = Math.hypot(P.width, P.height) * 1.05, items = [];
    [ACCENT, WARM, [0.07, 0.07, 0.09]].forEach((c, k) => items.unshift(it.group([it.ellipse([R, R]), it.fill(c)], { scale: KF([[k * d * 0.08, [0, 0], 'expoInOut'], [d * 0.5 + k * d * 0.05, [100, 100], 'expoInOut'], [d * 0.6 + k * d * 0.05, [100, 100], 'expoInOut'], [d, [0, 0]]]) })));
    return shapeLayer(P, items.reverse());
  }],
  ['Hexágono desenhando', (P, d) => shapeLayer(P, [it.group([it.star(6, P.width * 0.16, 0, 2, 0), drawErase(d, 0.55, 0.5), it.stroke(WHITE, P.width * 0.008), rep(3, { scale: [125, 125], o0: 100, o1: 35 })], { rotation: KF([[0, -30, 'expoOut'], [d, 30]]) })])],
  ['Brilho de 4 pontas', (P, d) => shapeLayer(P, [-1, 0, 1].map((k) => it.group([it.star(4, P.width * (k ? 0.03 : 0.06), P.width * (k ? 0.006 : 0.012)), it.fill(WHITE)], {
    position: A([k * P.width * 0.12, k * k * -P.width * 0.05]),
    scale: KF([[d * (0.1 + (k + 1) * 0.12), [0, 0], 'back'], [d * (0.4 + (k + 1) * 0.12), [100, 100], 'expoIn'], [d, [0, 0]]]), rotation: KF([[0, 0], [d, 90]]) })))],
  ['Seta (callout)', (P, d) => {
    const L = P.width * 0.28;
    return shapeLayer(P, [it.group([poly([[-L, L * 0.4], [0, 0], [L, 0]]), drawOnly(d * 0.6), it.stroke(WHITE, P.width * 0.006)]),
      it.group([it.ellipse([P.width * 0.03, P.width * 0.03], [-L, L * 0.4]), it.fill(WARM)], { scale: KF([[0, [0, 0], 'elastic'], [d * 0.5, [100, 100]]]), anchor: A([-L, L * 0.4]), position: A([-L, L * 0.4]) })]);
  }],
  ['Barra de progresso', (P, d) => {
    const w = P.width * 0.6, h = P.width * 0.03;
    return shapeLayer(P, [it.group([it.rect([w, h], [0, 0], h / 2), it.fill([1, 1, 1], 18)]),
      it.group([it.rect([w, h], [w / 2, 0], h / 2), it.fill(ACCENT)], { position: A([-w / 2, 0]), scale: KF([[d * 0.1, [0, 100], 'expoInOut'], [d * 0.9, [100, 100]]]) })]);
  }],
);
// templates de motion design com texto + formas (o Composer adiciona todas as camadas)
MO_ELEMENTS.push(
  ['Lower third (nome e cargo)', (P, d) => {
    const x = P.width * 0.08, y = P.height * 0.78, fs = Math.round(P.width * 0.055);
    const bar = shapeLayer(P, [it.group([poly([[0, 0], [P.width * 0.55, 0]]), it.trim(KF([[d * 0.75, 0, 'expoIn'], [d, 100]]), KF([[0, 0, 'expoOut'], [d * 0.25, 100]])), it.stroke(WARM, P.width * 0.006)])]);
    bar.transform.position = A([x, y]); bar.name = 'Lower third · linha';
    const box = shapeLayer(P, [it.group([it.rect([P.width * 0.55, fs * 2.6], [P.width * 0.275, -fs * 1.3]), it.fill([0.07, 0.07, 0.1], 85)], { scale: KF([[d * 0.05, [0, 100], 'expoOut'], [d * 0.3, [100, 100]], [d * 0.78, [100, 100], 'expoIn'], [d, [0, 100]]]) })]);
    box.transform.position = A([x, y]); box.name = 'Lower third · caixa';
    const t1 = textLayer(P, 'NOME SOBRENOME', fs, 800); t1.props.align = 'left';
    t1.transform.position = KF([[d * 0.12, [x + P.width * 0.3, y - fs * 1.75], 'expoOut'], [d * 0.4, [x + P.width * 0.28, y - fs * 1.75]]]);
    t1.transform.opacity = KF([[d * 0.12, 0], [d * 0.3, 100], [d * 0.75, 100, 'easeIn'], [d * 0.9, 0]]);
    const t2 = textLayer(P, 'Cargo · Empresa', Math.round(fs * 0.55), 500, '#ffc83d'); t2.props.align = 'left';
    t2.transform.position = KF([[d * 0.2, [x + P.width * 0.3, y - fs * 0.7], 'expoOut'], [d * 0.48, [x + P.width * 0.28, y - fs * 0.7]]]);
    t2.transform.opacity = KF([[d * 0.2, 0], [d * 0.38, 100], [d * 0.75, 100, 'easeIn'], [d * 0.9, 0]]);
    return [t1, t2, box, bar];
  }],
  ['Caixa revelando título', (P, d) => {
    const fs = Math.round(P.width * 0.09), w = P.width * 0.7;
    const t = textLayer(P, 'SEU TÍTULO', fs, 900);
    t.transform.opacity = KF([[d * 0.3, 0, 'hold'], [d * 0.31, 100]]);
    const box = shapeLayer(P, [it.group([it.rect([w, fs * 1.4], [w / 2, 0]), it.fill(ACCENT)], { position: A([-w / 2, 0]), scale: KF([[0, [0, 100], 'expoInOut'], [d * 0.3, [100, 100]]]) }),
      it.group([it.rect([w, fs * 1.4], [-w / 2, 0]), it.fill(ACCENT)], { position: A([w / 2, 0]), scale: KF([[d * 0.3, [0, 100], 'hold'], [d * 0.31, [100, 100], 'expoInOut'], [d * 0.62, [0, 100]]]) })]);
    box.name = 'Caixa';
    // a 1ª caixa cresce da esquerda; no meio troca pela 2ª, que encolhe para a direita revelando o texto
    box.props.shapes[0].tr.opacity = KF([[d * 0.3, 100, 'hold'], [d * 0.31, 0]]);
    return [box, t];
  }],
);
function shapeLayer(P, shapes) {
  const l = LAYER_FACTORIES.shape(P, shapes);
  l.props.width = P.width; l.props.height = P.height;
  return l;
}
/** Desloca os keyframes das formas (o Composer põe o elemento no cursor). */
export function shiftShapeKeys(items, dt) {
  for (const x of items || []) {
    for (const v of Object.values(x)) if (v && typeof v === 'object' && Array.isArray(v.keys)) for (const k of v.keys) k.t = +(k.t + dt).toFixed(4);
    if (x.tr) for (const v of Object.values(x.tr)) if (v && Array.isArray(v.keys)) for (const k of v.keys) k.t = +(k.t + dt).toFixed(4);
    if (x.items) shiftShapeKeys(x.items, dt);
  }
}

// ---------------------------------------------------------------- logo reveal (na camada da logo selecionada)
export const MO_LOGO = (W) => [
  ['Elástico + brilho passando', { scale: ['abs', [[0, [0, 0], 'elastic'], [0.55, [100, 100]]]] }, [['lightSweep', { width: 50, intensity: 1.1, center: [[0.35, [-0.3, 0.5], 'expoInOut'], [1, [1.3, 0.5]]] }]]],
  ['Desfoque + zoom (premium)', { scale: ['abs', [[0, [140, 140], 'expoOut'], [1, [100, 100]]]], opacity: ['abs', [[0, 0, 'easeOut'], [0.5, 100]]] }, [['blur', { radius: [[0, 60, 'expoOut'], [0.8, 0]] }], ['glow', { threshold: 40, radius: 40, intensity: [[0, 2.5, 'expoOut'], [1, 0.6]] }]]],
  ['Glitch reveal', { opacity: ['abs', [[0, 0, 'linear'], [0.1, 100]]] }, [['rgbSplit', { amount: [[0, 60, 'expoOut'], [0.7, 0]] }], ['glitch', { amount: [[0, 90, 'expoOut'], [0.7, 0]] }]]],
  ['Slide com motion blur', { position: ['rel', [[0, [-W * 0.6, 0], 'expoOut'], [1, [0, 0]]]], opacity: ['abs', [[0, 0, 'linear'], [0.2, 100]]] }, [['motionBlur', { amount: 140, samples: 16 }]]],
  ['Flash de luz', { scale: ['abs', [[0, [90, 90], 'expoOut'], [1, [100, 100]]]] }, [['exposure', { exposure: [[0, 3, 'expoOut'], [0.8, 0]] }], ['glow', { threshold: 30, radius: 60, intensity: [[0, 3, 'expoOut'], [1, 0.4]] }]]],
];

// ---------------------------------------------------------------- projeto de demonstração: logo animada
/** Logo "MotionFrame" (formas + texto) animada só com as peças deste pacote. 1080×1080, 30 fps, 6 s. */
export function buildLogoDemoProject() {
  const P = createProject(1080, 1080);
  Object.assign(P, { id: uid('prj'), name: 'Demo · Logo animada (MoGraph)', fps: 30, duration: 6, background: '#0d0d14' });
  const W = P.width, cx = W / 2, cy = W / 2 - 60;
  const layers = [];
  const add = (l, t0, t1) => { l.inPoint = t0; l.outPoint = t1; layers.unshift(l); return l; };
  const at = (l, x, y) => { l.transform.position = A([x, y]); return l; };

  // fundo com degradê sutil + vinheta
  const bg = add(LAYER_FACTORIES.solid(P), 0, 6); bg.name = 'Fundo'; bg.props.fill = '#0d0d14';
  bg.effects.push(fx('ramp', { start: [0.12, 0.08, 0.22, 1], end: [0.03, 0.03, 0.06, 1], angle: 180, radial: true }), fx('vignette', { amount: 45 }));

  // 1) anel desenhando (0 → 1,2 s) e depois girando lento
  const ring = add(shapeLayer(P, [it.group([it.ellipse([380, 380]), it.trim(A(0), KF([[0.15, 0, 'expoInOut'], [1.2, 100]]), KF([[0.15, -90, 'expoInOut'], [6, 30]])), it.stroke(WHITE, 14)])]), 0, 6);
  ring.name = 'Anel'; at(ring, cx, cy);
  ring.transform.scale = KF([[5.2, [100, 100], 'expoIn'], [5.8, [0, 0]]]);
  // 2) segundo anel (acento) desenhando no sentido contrário
  const ring2 = add(shapeLayer(P, [it.group([it.ellipse([440, 440]), it.trim(KF([[0.5, 0, 'expoInOut'], [1.6, 62]]), KF([[0.3, 0, 'expoInOut'], [1.4, 100]]), A(120)), it.stroke(ACCENT, 6)])]), 0, 6);
  ring2.name = 'Anel acento'; at(ring2, cx, cy);
  ring2.transform.scale = KF([[5.1, [100, 100], 'expoIn'], [5.7, [0, 0]]]);
  // 3) "play" (triângulo) entrando com elástico
  const play = add(shapeLayer(P, [it.group([it.star(3, 120, 60, 2, 90), it.fill(WARM)])]), 0.9, 6);
  play.name = 'Play'; at(play, cx + 12, cy);
  play.transform.scale = KF([[0.9, [0, 0], 'elastic'], [1.9, [100, 100]], [5.0, [100, 100], 'backIn'], [5.4, [0, 0]]]);
  play.transform.rotation = KF([[0.9, -120, 'expoOut'], [1.9, 0]]);
  play.effects.push(fx('lightSweep', { width: 45, intensity: 1, center: { keys: [{ t: 2.2, v: [-0.3, 0.5], ease: 'expoInOut' }, { t: 3.0, v: [1.3, 0.5], ease: 'linear' }] } }));
  // 4) explosão de linhas quando o play pousa
  const burst = add(MO_ELEMENTS.find((x) => x[0].startsWith('Explosão'))[1](P, 0.9), 1.25, 2.3);
  burst.name = 'Burst'; at(burst, cx, cy); shiftShapeKeys(burst.props.shapes, 1.25);
  // 5) ondas de círculos
  const waves = add(MO_ELEMENTS.find((x) => x[0].startsWith('Círculos'))[1](P, 1.2), 1.3, 2.6);
  waves.name = 'Ondas'; at(waves, cx, cy); shiftShapeKeys(waves.props.shapes, 1.3);

  // 6) nome com tracking cinematográfico + decode
  const name = add(LAYER_FACTORIES.text(P), 1.6, 6); name.name = 'Nome';
  Object.assign(name.props, { text: 'MOTIONFRAME', fontSize: 104, fontWeight: 900, letterSpacing: 6, color: '#ffffff' });
  at(name, cx, cy + 330);
  name.props.animators = [
    ...MO_TEXT.find((x) => x[0] === 'Tracking cinematográfico')[1](1.1, 104),
    ...MO_TEXT.find((x) => x[0].startsWith('Decodificar'))[1](1.0, 104),
  ].map((an) => shiftAnimTimes(an, 1.6));
  name.transform.opacity = KF([[5.0, 100, 'easeIn'], [5.5, 0]]);
  // 7) sublinhado desenhando sob o nome
  const ul = add(MO_ELEMENTS.find((x) => x[0].startsWith('Sublinhado'))[1](P, 0.8), 2.5, 6); ul.name = 'Sublinhado';
  ul.props.shapes = [it.group([it.line(-260, 0, 260, 0), it.trim(KF([[4.9, 0, 'expoIn'], [5.4, 100]]), KF([[2.5, 0, 'expoOut'], [3.3, 100]])), it.stroke(WARM, 8)])];
  at(ul, cx, cy + 410);
  // 8) slogan subindo por palavra
  const tag = add(LAYER_FACTORIES.text(P), 3.0, 6); tag.name = 'Slogan';
  Object.assign(tag.props, { text: 'motion design no celular', fontSize: 44, fontWeight: 500, color: '#b9b4d6' });
  at(tag, cx, cy + 470);
  tag.props.animators = MO_TEXT.find((x) => x[0].startsWith('Subir palavra'))[1](0.8, 44).map((an) => shiftAnimTimes(an, 3.0));
  tag.transform.opacity = KF([[4.9, 100, 'easeIn'], [5.3, 0]]);
  // 9) estrelinhas e brilho geral
  const star = add(MO_ELEMENTS.find((x) => x[0] === 'Estrela pop')[1](P, 0.9), 3.4, 4.4); star.name = 'Estrela'; at(star, cx + 300, cy - 230); shiftShapeKeys(star.props.shapes, 3.4);
  // 10) flash final e escurecer
  const flash = add(LAYER_FACTORIES.solid(P), 5.35, 6); flash.name = 'Flash final'; flash.props.fill = '#ffffff';
  flash.transform.opacity = KF([[5.35, 0, 'expoIn'], [5.5, 70, 'expoOut'], [6, 0]]);
  // ajuste com glow suave em tudo
  const adj = add(LAYER_FACTORIES.adjustment(P), 0, 6); adj.name = 'Glow geral';
  adj.effects.push(fx('glow', { threshold: 55, radius: 30, intensity: 0.7 }));
  P.layers = layers;
  return P;
}
function fx(type, params) {
  const out = { id: uid('fx'), type, enabled: true, params: {} };
  for (const [k, v] of Object.entries(params)) out.params[k] = v && typeof v === 'object' && Array.isArray(v.keys) ? { value: v.keys[0].v, keys: v.keys } : { value: v, keys: [] };
  return out;
}
function shiftAnimTimes(an, t0) {
  const sh = (p) => (p && p.keys ? { ...p, keys: p.keys.map((k) => ({ ...k, t: +(k.t + t0).toFixed(4) })) } : p);
  return { ...an, props: Object.fromEntries(Object.entries(an.props).map(([k, v]) => [k, sh(v)])), selectors: (an.selectors || []).map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, sh(v)]))) };
}
