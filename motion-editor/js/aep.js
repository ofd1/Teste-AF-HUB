import { exprWorks } from './expr.js';
// Leitor de projetos do After Effects (.aep): pastas, composições, camadas (tempo, tipo, transformação com
// keyframes, efeitos), sólidos e arquivos de mídia (caminho original). Formato RIFX ("Egg!").
// Estrutura conferida com projetos reais e com a documentação dos parsers abertos (aep_parser / aftereffects-aep-parser).
import { RiffReader } from './riff.js';
import { parseFXChildren, parsePropertyChunk } from './ffx.js';
import { parseCOS, textFromCOS } from './cos.js';

const kids = (c) => c.children || [];
const findList = (cs, t) => cs.find((c) => c.id === 'LIST' && c.listType === t);
const findChunk = (cs, id) => cs.find((c) => c.id === id);

function text(r, c) {
  if (!c || !c.size) return '';
  return r.cstr(c.offset, c.size);
}

/** cdta (composição): o layout mudou 4 bytes entre versões do AE — escolhe o que dá valores plausíveis. */
function readComp(r, c) {
  const o = c.offset, n = c.size;
  const ok = (w, h) => w >= 4 && h >= 4 && w <= 30000 && h <= 30000;
  const at = (k) => (k + 2 <= n ? r.u16(o + k) : 0);
  const v = {};
  // AE recente (aep_parser): time_scale @5, duração @44/48, cor @52, largura/altura @140/142, fps @156 (+fração @158)
  if (n >= 160 && ok(at(140), at(142))) {
    v.width = at(140); v.height = at(142);
    const dd = r.u32(o + 44), dv = r.u32(o + 48);
    v.duration = dv ? dd / dv : 0;
    v.bg = [r.u8(o + 52), r.u8(o + 53), r.u8(o + 54)];
    v.fps = at(156) + at(158) / 65536;
    v.timeScale = at(5) || 1;
  }
  // AE mais antigo (aftereffects-aep-parser): fps = dividendo@8 / divisor@4, duração @40/44, cor @48, tamanho @136/138
  const fpsA = r.u32(o + 4) ? r.u32(o + 8) / r.u32(o + 4) : 0;
  if (!v.width || !(v.fps > 0.5 && v.fps < 1000)) {
    if (ok(at(136), at(138))) {
      v.width = at(136); v.height = at(138);
      const dd = r.u32(o + 40), dv = r.u32(o + 44);
      v.duration = dv ? dd / dv : 0;
      v.bg = [r.u8(o + 48), r.u8(o + 49), r.u8(o + 50)];
      v.fps = fpsA || at(152) || 30;
      v.timeScale = at(5) || 1;
    }
  }
  if (!(v.fps > 0.5 && v.fps < 1000)) v.fps = fpsA > 0.5 && fpsA < 1000 ? fpsA : 30;
  if (!(v.duration > 0) || v.duration > 36000) v.duration = 10;
  return v;
}

/** sspc dentro de 'Pin ' (mídia): tamanho, duração e fps do arquivo. */
function readSspc(r, c) {
  const o = c.offset;
  const w = r.u16(o + 32), h = r.u16(o + 36);
  const dd = r.u32(o + 38), dv = r.u32(o + 42);
  const fps = r.u32(o + 56) + (c.size >= 62 ? r.u16(o + 60) / 65536 : 0);
  return { width: w, height: h, duration: dv ? dd / dv : 0, fps: fps > 0.5 && fps < 1000 ? fps : 0 };
}

function readFootage(r, item, cs) {
  const pin = findList(cs, 'Pin ');
  if (!pin) return;
  const pcs = kids(pin);
  const sspc = findChunk(pcs, 'sspc');
  if (sspc) Object.assign(item, readSspc(r, sspc));
  const opti = findChunk(pcs, 'opti');
  if (opti) {
    const type = r.fourcc(opti.offset).replace(/\0/g, '');
    if (type === 'Soli') {
      item.kind = 'solid';
      // cor: 4 floats (a, r, g, b) depois de 4 bytes; nome com 256 bytes
      const f = (k) => r.f32(opti.offset + 10 + k * 4);
      const vals = [f(0), f(1), f(2), f(3)];
      item.color = vals.slice(1, 4).every((x) => x >= 0 && x <= 1.0001) ? vals.slice(1, 4) : vals.slice(0, 3);
      const nm = r.cstr(opti.offset + 26, Math.min(256, opti.size - 26));
      if (nm) item.name = nm;
    } else if (!type || r.u16(opti.offset + 4) === 2) {
      item.kind = 'placeholder';
    } else item.kind = 'file';
  }
  // caminho do arquivo: Als2 → alas (JSON com "fullpath") ou StVc (sequência)
  const als2 = findList(pcs, 'Als2');
  const alas = als2 && findChunk(kids(als2), 'alas');
  if (alas) {
    const s = text(r, alas);
    try { const j = JSON.parse(s); if (j.fullpath) item.path = j.fullpath; } catch { const m = /[A-Za-z]:\\[^\0"]+|\/[^\0"]+\.\w{2,5}/.exec(s); if (m) item.path = m[0]; }
  }
  const stvc = findList(pcs, 'StVc');
  if (stvc) { const names = kids(stvc).filter((x) => x.id === 'Utf8').map((x) => text(r, x)).filter(Boolean); if (names.length) item.path = (item.path ? item.path.replace(/[\\/]+$/, '') + '/' : '') + names[0]; }
  if (item.path) item.fileName = item.path.split(/[\\/]/).pop();
  if (!item.kind) item.kind = item.path ? 'file' : 'placeholder';
}

/** ldta (camada): tempos, flags, fonte, tipo e pai. */
function readLayer(r, c) {
  const o = c.offset;
  const frac = (a, b) => { const d = r.u32(o + b); return d ? r.i32(o + a) / d : 0; };
  const start = frac(12, 16), inP = frac(20, 24), outP = frac(28, 32);
  const b38 = r.u8(o + 38), b39 = r.u8(o + 39), b37 = r.u8(o + 37);
  const stretchDiv = c.size > 112 ? r.u16(o + 110) : 0;
  return {
    id: r.u32(o),
    startTime: start, inPoint: start + inP, outPoint: start + outP,
    stretch: stretchDiv ? r.i16(o + 10) / stretchDiv : 1,
    guide: !!(b37 & 0x02),
    nullLayer: !!(b38 & 0x80), solo: !!(b38 & 0x08), threeD: !!(b38 & 0x04), adjustment: !!(b38 & 0x02),
    shy: !!(b39 & 0x40), effectsOn: !!(b39 & 0x04), audio: !!(b39 & 0x02), enabled: !!(b39 & 0x01),
    sourceId: r.u32(o + 40),
    blend: c.size > 100 ? r.u8(o + 99) : 0,
    layerType: c.size > 131 ? r.u8(o + 131) : 0, // 0 mídia/sólido/comp, 1 luz, 2 câmera, 3 texto, 4 forma
    parentId: c.size > 135 ? r.u32(o + 132) : 0,
    trackMatte: c.size > 107 ? r.u8(o + 107) : 0, // 1 alfa, 2 alfa invertido, 3 luma, 4 luma invertida (usa a camada de cima)
  };
}

function walkItems(r, cs, out, folder = '') {
  for (const c of cs) {
    if (c.id !== 'LIST') continue;
    if (c.listType === 'Item') {
      const ics = kids(c);
      const idta = findChunk(ics, 'idta');
      if (!idta) continue;
      const type = r.u16(idta.offset), id = r.u32(idta.offset + 16);
      const item = { id, type: type === 4 ? 'comp' : type === 7 ? 'footage' : type === 1 ? 'folder' : 'other', name: text(r, findChunk(ics, 'Utf8')), folder };
      if (item.type === 'comp') {
        const cdta = findChunk(ics, 'cdta');
        if (cdta) Object.assign(item, readComp(r, cdta));
        item.layers = [];
        for (const l of ics.filter((x) => x.id === 'LIST' && (x.listType === 'Layr' || x.listType === 'SLay'))) {
          const lcs = kids(l), ldta = findChunk(lcs, 'ldta');
          if (!ldta) continue;
          const layer = { ...readLayer(r, ldta), name: text(r, findChunk(lcs, 'Utf8')), _chunks: lcs, camera: l.listType === 'SLay' };
          item.layers.push(layer);
        }
      } else if (item.type === 'footage') readFootage(r, item, ics);
      out.push(item);
      if (item.type === 'folder') { const sf = findList(ics, 'Sfdr'); if (sf) walkItems(r, kids(sf), out, item.name); }
    } else if (c.listType === 'Fold' || c.listType === 'Sfdr') walkItems(r, kids(c), out, folder);
  }
}

function findDeep(cs, pred) { for (const c of cs || []) { if (pred(c)) return c; const f = findDeep(c.children, pred); if (f) return f; } return null; }

/** Caminho (Bézier) de uma forma ou máscara: 'shap' = cabeçalho com a caixa + pontos normalizados (vértice, alça de saída, alça de entrada do próximo). */
function readShap(r, shap, mask) {
  const cs = kids(shap);
  const shph = findChunk(cs, 'shph'), list = findList(cs, 'list');
  const ldat = list && findChunk(kids(list), 'ldat');
  if (!shph || !ldat) return null;
  const o = shph.offset;
  const open = !!(r.u8(o + 3) & 0x08);
  const x0 = r.f32(o + 4), y0 = r.f32(o + 8), x1 = r.f32(o + 12), y1 = r.f32(o + 16);
  const pts = [];
  for (let k = 0; k + 8 <= ldat.size; k += 8) {
    const nx = r.f32(ldat.offset + k), ny = r.f32(ldat.offset + k + 4);
    pts.push([x0 + nx * (x1 - x0), y0 + ny * (y1 - y0)]);
  }
  return { closed: !open, pts, normalized: mask && Math.abs(x1 - x0) <= 1.0001 && Math.abs(y1 - y0) <= 1.0001 };
}

/** Árvore de propriedades (grupos, valores com keyframes, caminhos e dados de máscara). */
function propTree(r, cs, fps) {
  const out = [];
  let mn = null;
  for (const c of cs || []) {
    if (c.id === 'tdmn') { mn = r.cstr(c.offset, c.size); continue; }
    if (c.id === 'LIST' && c.listType === 'tdgp' && !mn) { out.push(...propTree(r, kids(c), fps)); continue; } // grupo raiz da camada
    if (c.id !== 'LIST' || !mn) continue;
    if (c.listType === 'tdgp') {
      const ccs = kids(c);
      const node = { mn, children: propTree(r, ccs, fps) };
      const mkif = findChunk(ccs, 'mkif');
      if (mkif) node.mask = { inverted: r.u8(mkif.offset) === 1, mode: r.u16(mkif.offset + 6) };
      const nm = findChunk(ccs, 'tdsn') || findList(ccs, 'tdsn');
      if (nm) node.name = nm.children ? text(r, findChunk(nm.children, 'Utf8')) : (r.fourcc(nm.offset) === 'Utf8' ? r.cstr(nm.offset + 8, nm.size - 8) : '');
      out.push(node);
    } else if (c.listType === 'tdbs') {
      out.push({ mn, prop: parsePropertyChunk(r, c, mn, fps) });
    } else if (c.listType === 'om-s') {
      // caminho: um 'shap' por keyframe (os tempos estão no tdbs)
      const ccs = kids(c);
      const tdbs = findList(ccs, 'tdbs');
      const timing = tdbs ? parsePropertyChunk(r, tdbs, mn, fps) : null;
      const omks = findList(ccs, 'omks');
      const shapes = omks ? kids(omks).filter((x) => x.id === 'LIST' && x.listType === 'shap').map((x) => readShap(r, x, mn === 'ADBE Mask Shape')).filter(Boolean) : [];
      out.push({ mn, path: { shapes, times: (timing?.keyframes || []).map((k) => k.t), eases: (timing?.keyframes || []) } });
    }
    mn = null;
  }
  return out;
}

/** Abre um .aep e devolve { comps, footage, warnings }. Os efeitos de cada camada são lidos sob demanda. */
export function parseAEP(buffer) {
  const r = new RiffReader(buffer);
  const root = r.parse();
  if (root.listType !== 'Egg!') throw new Error('Não é um projeto do After Effects (.aep).');
  const items = [];
  walkItems(r, root.children, items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const comps = items.filter((i) => i.type === 'comp');
  for (const comp of comps) {
    for (const l of comp.layers) {
      const src = byId.get(l.sourceId);
      l.source = src ? { id: src.id, type: src.type, kind: src.kind, name: src.name } : null;
      // efeitos + transformação (keyframes em quadros × time scale da composição, relativos ao início da camada)
      const fx = parseFXChildren(r, l._chunks, (comp.fps || 30) * (comp.timeScale || 1));
      l.effects = fx.effects;
      l.properties = fx.properties;
      const fps = (comp.fps || 30) * (comp.timeScale || 1);
      const tree = propTree(r, l._chunks, fps);
      l.shapes = tree.find((n) => n.mn === 'ADBE Root Vectors Group')?.children || null;
      l.masks = (tree.find((n) => n.mn === 'ADBE Mask Parade')?.children || []).filter((n) => n.mn === 'ADBE Mask Atom');
      l.textAnimators = (tree.find((n) => n.mn === 'ADBE Text Properties')?.children || []).find((n) => n.mn === 'ADBE Text Animators')?.children || [];
      l.textMore = (tree.find((n) => n.mn === 'ADBE Text Properties')?.children || []).find((n) => n.mn === 'ADBE Text More Options') || null;
      const btdk = findDeep(l._chunks, (c) => c.id === 'LIST' && c.listType === 'btdk');
      if (btdk) { try { l.text = textFromCOS(parseCOS(r.bytes.subarray(btdk.offset + 4, btdk.offset + btdk.size))); } catch { /* texto ilegível */ } }
      delete l._chunks;
    }
    // composições usadas dentro de outras (pré-composições)
    comp.usedIn = comps.filter((c) => c !== comp && c.layers.some((l) => l.sourceId === comp.id)).map((c) => c.id);
  }
  return { comps, items, byId, footage: items.filter((i) => i.type === 'footage') };
}

// ---------------------------------------------------------------------------------------------
// Conversão para um projeto do MotionFrame
import { createProject, LAYER_FACTORIES } from './state.js';
import { anim } from './anim.js';
import { ffxToPreset, ffxEase, createEffectInstance } from './presets.js';

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|psd|heic|avif|svg|ai|exr)$/i;
const AUD_EXT = /\.(mp3|wav|aiff?|m4a|aac|ogg|flac)$/i;
const hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

/** Composições candidatas: as que não são usadas dentro de outra primeiro, com mais camadas. */
export function mainComps(parsed) {
  return parsed.comps.slice().sort((a, b) => (a.usedIn.length - b.usedIn.length) || (b.layers.length - a.layers.length));
}

function propOf(l, mn) { return l.properties.find((p) => p.matchName === mn && (p.groupPath || []).includes('ADBE Transform Group')) || l.properties.find((p) => p.matchName === mn); }

/** Propriedade do AE (valor fixo ou keyframes) → propriedade animada do MotionFrame. */
function toAnim(p, fix, fallback, t0) {
  if (!p) return anim(fallback);
  let a;
  if (p.keyframes?.length) {
    const keys = p.keyframes.map((kf, i, arr) => ({ t: +(t0 + kf.t).toFixed(4), v: fix(kf.v), ...ffxEase(kf, arr[i + 1]) }));
    a = anim(keys[0].v, keys);
  } else a = anim(p.value?.length ? fix(p.value) : fallback);
  // expressões comuns (wiggle, loopOut, time…) passam a funcionar; as que dependem de outras camadas ficam de fora
  if (p.expression && exprWorks(p.expression, a.value)) a.expr = p.expression;
  return a;
}

/** Posição com dimensões separadas (Position_0 / Position_1) → uma posição [x, y] com keyframes combinados. */
function mergedPosition(px, py, fallback, t0) {
  const ax = toAnim(px, (v) => v[0], fallback[0], t0), ay = toAnim(py, (v) => v[0], fallback[1], t0);
  const times = [...new Set([...ax.keys, ...ay.keys].map((k) => k.t))].sort((a, b) => a - b);
  const val = (a, t) => { if (!a.keys.length) return a.value; let k = a.keys[0]; for (const x of a.keys) if (x.t <= t) k = x; return k.v; };
  if (!times.length) return anim([ax.value, ay.value]);
  return anim([val(ax, times[0]), val(ay, times[0])], times.map((t) => ({ t, v: [val(ax, t), val(ay, t)], ease: 'linear' })));
}

function applyTransform(layer, l, srcW, srcH, comp, t0, cw = srcW, ch = srcH, pixelAnchor = false) {
  const tr = layer.transform;
  const pos = propOf(l, 'ADBE Position'), p0 = propOf(l, 'ADBE Position_0'), p1 = propOf(l, 'ADBE Position_1');
  const center = [comp.width / 2, comp.height / 2];
  const separated = (p0?.keyframes?.length || p1?.keyframes?.length) && !pos?.keyframes?.length;
  tr.position = separated ? mergedPosition(p0, p1, pos?.value?.length ? [pos.value[0], pos.value[1]] : center, t0)
    : toAnim(pos, (v) => [v[0] ?? center[0], v[1] ?? center[1]], center, t0);
  // ponto de ancoragem: no .aep é uma fração do tamanho da camada (0,5 = centro); o MotionFrame conta do centro em px
  const ap = propOf(l, 'ADBE Anchor Point');
  const vals = ap ? [...(ap.value || []), ...(ap.keyframes || []).flatMap((k) => k.v)] : [];
  const norm = !pixelAnchor && vals.length && vals.every((x) => Math.abs(x) <= 4);
  // (cw, ch) = tamanho da tela da camada no MotionFrame (uma pré-comp usa a tela do projeto)
  tr.anchor = toAnim(ap, (v) => (norm ? [(v[0] ?? 0.5) * srcW - cw / 2, (v[1] ?? 0.5) * srcH - ch / 2] : [(v[0] ?? srcW / 2) - cw / 2, (v[1] ?? srcH / 2) - ch / 2]), [srcW / 2 - cw / 2, srcH / 2 - ch / 2], t0);
  // escala e opacidade ficam como fração no .aep (0,56 = 56%)
  tr.scale = toAnim(propOf(l, 'ADBE Scale'), (v) => [(v[0] ?? 1) * 100, (v[1] ?? v[0] ?? 1) * 100], [100, 100], t0);
  tr.rotation = toAnim(propOf(l, 'ADBE Rotate Z'), (v) => v[0] || 0, 0, t0);
  tr.opacity = toAnim(propOf(l, 'ADBE Opacity'), (v) => (v[0] ?? 1) * 100, 100, t0);
}

const BLENDS = { 2: 'source-over', 3: 'lighter', 4: 'multiply', 5: 'screen', 6: 'overlay', 7: 'soft-light', 8: 'hard-light', 9: 'darken', 10: 'lighten', 11: 'difference', 13: 'color-dodge', 14: 'color-burn', 15: 'exclusion', 16: 'hue', 17: 'saturation', 18: 'color', 19: 'luminosity' };

/** Text Animators do AE → { props: {opacity, position, scale, rotation, blur, tracking}, selectors: [...] } com keyframes. */
function convTextAnimators(list, t0) {
  const find = (n, mn) => { if (!n) return null; if (n.mn === mn) return n; for (const c of n.children || []) { const f = find(c, mn); if (f) return f; } return null; };
  const pa = (node, fix, def) => (node?.prop ? toAnim(node.prop, fix, def, t0) : null);
  const n1 = (v) => v[0];
  const out = [];
  for (const an of list) {
    const P = (an.children || []).find((c) => c.mn === 'ADBE Text Animator Properties');
    const S = (an.children || []).find((c) => c.mn === 'ADBE Text Selectors');
    const props = {};
    const g = (mn) => find(P, mn);
    if (g('ADBE Text Opacity')) props.opacity = pa(g('ADBE Text Opacity'), n1, 100);
    if (g('ADBE Text Position 3D')) props.position = pa(g('ADBE Text Position 3D'), (v) => [v[0] || 0, v[1] || 0], [0, 0]);
    if (g('ADBE Text Scale 3D')) props.scale = pa(g('ADBE Text Scale 3D'), (v) => [v[0] ?? 100, v[1] ?? v[0] ?? 100], [100, 100]);
    if (g('ADBE Text Rotation')) props.rotation = pa(g('ADBE Text Rotation'), n1, 0);
    if (g('ADBE Text Blur')) props.blur = pa(g('ADBE Text Blur'), (v) => [v[0] || 0, v[1] ?? v[0] ?? 0], [0, 0]);
    if (g('ADBE Text Tracking Amount')) props.tracking = pa(g('ADBE Text Tracking Amount'), n1, 0);
    if (!Object.keys(props).length) continue;
    const selectors = [];
    for (const sNode of S?.children || []) {
      const q = (mn) => find(sNode, mn);
      const num = (mn, def) => (q(mn)?.prop ? toAnim(q(mn).prop, n1, def, t0) : null);
      const fixed = (mn, def) => { const pr = q(mn)?.prop; return pr?.value?.length ? pr.value[0] : pr?.keyframes?.[0]?.v?.[0] ?? def; };
      if (sNode.mn === 'ADBE Text Wiggly Selector') {
        selectors.push({ type: 'wiggly', mode: fixed('ADBE Text Selector Mode', 3), max: num('ADBE Text Wiggly Max Amount', 100) || num('ADBE Text Selector Max Amount', 100), min: num('ADBE Text Wiggly Min Amount', -100),
          freq: num('ADBE Text Temporal Freq', 2), correlation: num('ADBE Text Character Correlation', 50), tphase: num('ADBE Text Temporal Phase', 0), sphase: num('ADBE Text Spatial Phase', 0), based: fixed('ADBE Text Range Type2', 1) });
      } else if (sNode.mn === 'ADBE Text Expressible Selector') {
        selectors.push({ type: 'expr', based: fixed('ADBE Text Range Type2', 1) });
      } else {
        selectors.push({ type: 'range', start: num('ADBE Text Percent Start', 0), end: num('ADBE Text Percent End', 100), offset: num('ADBE Text Percent Offset', 0),
          amount: num('ADBE Text Selector Max Amount', 100), shape: fixed('ADBE Text Range Shape', 1), smooth: num('ADBE Text Selector Smoothness', 100),
          based: fixed('ADBE Text Range Type2', 1), mode: fixed('ADBE Text Selector Mode', 1), randomize: !!fixed('ADBE Text Randomize Order', 0), seed: fixed('ADBE Text Random Seed', 0) });
      }
    }
    if (!selectors.length) selectors.push({ type: 'range' });
    out.push({ name: an.name || 'Animator', props, selectors });
  }
  return out;
}

/** Camada 3D do AE: Z da posição, Orientação e Rotação X/Y. */
function apply3D(layer, l, t0) {
  const tr = layer.transform;
  layer.threeD = true;
  const pos = propOf(l, 'ADBE Position'), pz = propOf(l, 'ADBE Position_2');
  tr.posZ = pz?.keyframes?.length && !pos?.keyframes?.length ? toAnim(pz, (v) => v[0] || 0, 0, t0) : toAnim(pos, (v) => v[2] || 0, 0, t0);
  tr.rotX = toAnim(propOf(l, 'ADBE Rotate X'), (v) => v[0] || 0, 0, t0);
  tr.rotY = toAnim(propOf(l, 'ADBE Rotate Y'), (v) => v[0] || 0, 0, t0);
  const o = propOf(l, 'ADBE Orientation');
  if (o) tr.orientation = toAnim(o, (v) => [v[0] || 0, v[1] || 0, v[2] || 0], [0, 0, 0], t0);
}

/** Câmera do AE: posição xyz, Ponto de Interesse (= "Anchor Point" da câmera), rotações e opções (zoom, DOF). */
function convCamera(l, comp, proj, offset) {
  const t0 = offset + l.startTime;
  const cam = LAYER_FACTORIES.camera(proj);
  cam.name = l.name || 'Câmera';
  cam.inPoint = Math.max(0, +(offset + l.inPoint).toFixed(4));
  cam.outPoint = Math.min(proj.duration, +(offset + l.outPoint).toFixed(4));
  if (cam.outPoint <= cam.inPoint) return null;
  cam.visible = l.enabled !== false;
  const tr = cam.transform, W = comp.width, H = comp.height, z0 = -(W * 50) / 36;
  const pos = propOf(l, 'ADBE Position'), p0 = propOf(l, 'ADBE Position_0'), p1 = propOf(l, 'ADBE Position_1'), p2 = propOf(l, 'ADBE Position_2');
  const separated = (p0?.keyframes?.length || p1?.keyframes?.length || p2?.keyframes?.length) && !pos?.keyframes?.length;
  tr.position = separated ? mergedPosition(p0, p1, pos?.value?.length ? [pos.value[0], pos.value[1]] : [W / 2, H / 2], t0)
    : toAnim(pos, (v) => [v[0] ?? W / 2, v[1] ?? H / 2], [W / 2, H / 2], t0);
  tr.posZ = separated && p2 ? toAnim(p2, (v) => v[0] ?? z0, pos?.value?.[2] ?? z0, t0) : toAnim(pos, (v) => v[2] ?? z0, z0, t0);
  const poi = propOf(l, 'ADBE Anchor Point');
  tr.poi = toAnim(poi, (v) => [v[0] ?? W / 2, v[1] ?? H / 2], [W / 2, H / 2], t0);
  tr.poiZ = toAnim(poi, (v) => v[2] ?? 0, 0, t0);
  cam.props.twoNode = !!poi; // sem Ponto de Interesse salvo = câmera de um nó
  tr.rotX = toAnim(propOf(l, 'ADBE Rotate X'), (v) => v[0] || 0, 0, t0);
  tr.rotY = toAnim(propOf(l, 'ADBE Rotate Y'), (v) => v[0] || 0, 0, t0);
  tr.rotation = toAnim(propOf(l, 'ADBE Rotate Z'), (v) => v[0] || 0, 0, t0);
  const o = propOf(l, 'ADBE Orientation');
  if (o) tr.orientation = toAnim(o, (v) => [v[0] || 0, v[1] || 0, v[2] || 0], [0, 0, 0], t0);
  const zoom = propOf(l, 'ADBE Camera Zoom');
  if (zoom) tr.zoom = toAnim(zoom, (v) => v[0] || -z0, -z0, t0);
  const fd = propOf(l, 'ADBE Camera Focus Distance');
  if (fd) tr.focusDist = toAnim(fd, (v) => v[0] || -z0, -z0, t0);
  const ap = propOf(l, 'ADBE Camera Aperture');
  if (ap) tr.aperture = toAnim(ap, (v) => v[0] ?? 25, 25, t0);
  const dof = propOf(l, 'ADBE Camera Depth of Field');
  cam.props.dof = !!(dof && (dof.value?.[0] ?? 0));
  cam._aeId = l.id; cam._aeParent = l.parentId || 0;
  return cam;
}

function buildLayers(parsed, comp, proj, ctx, offset = 0, depth = 0) {
  const out = [];
  for (const l of comp.layers) {
    if (l.camera) continue; // câmeras de vista internas do AE (Front, Left, Top…): não fazem parte do render
    if (l.layerType === 2) { // câmera do AE → câmera 3D do MotionFrame
      const cam = convCamera(l, comp, proj, offset);
      if (cam) out.push(cam);
      continue;
    }
    if (l.layerType === 1 || l.guide) continue; // luzes e guias não aparecem no render
    const src = parsed.byId.get(l.sourceId);
    const W = src?.width || comp.width, H = src?.height || comp.height;
    let layer;
    if (l.adjustment) layer = LAYER_FACTORIES.adjustment(proj);
    else if (l.nullLayer) { layer = LAYER_FACTORIES.null(proj); layer.props.width = W; layer.props.height = H; }
    else if (l.layerType === 3) {
      layer = LAYER_FACTORIES.text(proj);
      const tx = l.text;
      layer.props.text = tx?.text || l.name || 'Texto';
      if (tx) {
        if (tx.size > 0) layer.props.fontSize = tx.size;
        if (tx.font) layer.props.fontFamily = `"${tx.font}", "${tx.font.replace(/[-_]?(Bold|Regular|Black|Heavy|Medium|Light|Italic|Roman|Semibold|SemiBold|ExtraBold)+$/i, '')}", Inter, system-ui, sans-serif`;
        layer.props.fontWeight = /black|heavy|extrabold/i.test(tx.font) ? 900 : /bold/i.test(tx.font) ? 700 : /semibold|medium/i.test(tx.font) ? 600 : /light|thin/i.test(tx.font) ? 300 : 400;
        if (tx.color) layer.props.color = hex(tx.color.map((x) => x * 255));
        layer.props.align = tx.justify === 1 ? 'right' : tx.justify === 2 ? 'center' : 'left';
        layer.props.letterSpacing = (tx.tracking || 0) * (layer.props.fontSize / 1000);
        layer.props.lineHeight = 1.2;
      }
      layer.props.aeBaseline = true; // âncora na linha de base, como no AE
      const anims = convTextAnimators(l.textAnimators || [], offset + l.startTime);
      if (anims.length) layer.props.animators = anims;
    } else if (l.layerType === 4) {
      layer = LAYER_FACTORIES.shape(proj, convShapes(l.shapes || [], offset + l.startTime));
      layer.props.width = comp.width; layer.props.height = comp.height;
    }
    else if (src?.type === 'comp') {
      if (depth > 6) continue;
      const kidsLayers = buildLayers(parsed, src, proj, ctx, offset + l.startTime, depth + 1);
      layer = LAYER_FACTORIES.group(proj, kidsLayers);
      layer.name = l.name || src.name;
    } else if (src?.kind === 'solid') {
      layer = LAYER_FACTORIES.solid(proj);
      layer.props.width = W; layer.props.height = H; layer.props.fill = hex((src.color || [0.5, 0.5, 0.5]).map((x) => x * 255));
    } else if (src?.type === 'footage') {
      // mídia do AE: vira um espaço reservado até o arquivo ser escolhido no aparelho
      const file = src.fileName || src.name || 'mídia';
      const kind = AUD_EXT.test(file) ? 'audio' : IMG_EXT.test(file) ? 'image' : 'video';
      layer = LAYER_FACTORIES.solid(proj);
      layer.props.width = W; layer.props.height = H; layer.props.fill = '#26262e';
      layer.props.aeMedia = { file, path: src.path || '', kind, width: W, height: H, fps: src.fps || 0, sourceStart: Math.max(0, (l.inPoint - l.startTime) / (l.stretch || 1)), speed: 1 / (l.stretch || 1) };
      if (kind === 'audio') layer.props.width = layer.props.height = 2;
      ctx.media.add(file);
    } else continue;
    if (!layer.name || /^(Texto|Sólido|Ajuste|Grupo|Formas|Null)$/.test(layer.name)) layer.name = l.name || src?.name || layer.name;
    if (layer.props.aeMedia) layer.name = `⚠ ${layer.name}`;
    layer.inPoint = Math.max(0, +(offset + l.inPoint).toFixed(4));
    layer.outPoint = Math.min(proj.duration, +(offset + l.outPoint).toFixed(4));
    if (layer.outPoint <= layer.inPoint) continue;
    layer.visible = l.enabled !== false;
    layer.blend = BLENDS[l.blend] || 'source-over';
    const isGroup = layer.type === 'group';
    const pixelAnchor = layer.type === 'shape' || layer.type === 'text';
    const cW = isGroup ? proj.width : layer.type === 'shape' ? comp.width : W, cH = isGroup ? proj.height : layer.type === 'shape' ? comp.height : H;
    applyTransform(layer, l, layer.type === 'shape' ? comp.width : W, layer.type === 'shape' ? comp.height : H, comp, offset + l.startTime, cW, cH, pixelAnchor);
    if (layer.type === 'shape') layer.transform.anchor = toAnim(propOf(l, 'ADBE Anchor Point'), (v) => [v[0] || 0, v[1] || 0], [0, 0], offset + l.startTime);
    if (layer.type === 'text') layer.transform.anchor = toAnim(propOf(l, 'ADBE Anchor Point'), (v) => [v[0] || 0, v[1] || 0], [0, 0], offset + l.startTime);
    // máscaras da camada (caminho em px da camada; no .aep podem vir normalizadas 0..1)
    if (l.masks?.length) layer.masks = l.masks.map((mk) => convMask(mk, W, H, offset + l.startTime)).filter(Boolean);
    if (l.threeD) apply3D(layer, l, offset + l.startTime);
    layer._aeId = l.id; layer._aeParent = l.parentId || 0;
    if (l.trackMatte) layer.trackMatte = l.trackMatte;
    // efeitos (mesma conversão dos presets .ffx: Sapphire, BCC, Looks, Twitch, Deep Glow…)
    if (l.effects.length) {
      const pre = ffxToPreset({ name: l.name, format: 'AEP', effects: l.effects, properties: [], warnings: [], matchNames: [] });
      for (const fx of pre.effects) layer.effects.push(createEffectInstance(fx.type, fx.params, offset + l.startTime, { ...(fx.label ? { label: fx.label } : {}), ...(fx.matchName ? { matchName: fx.matchName } : {}), ...(fx.defs ? { defs: fx.defs } : {}) }));
      for (const e of pre.report.effects) if (e.status === 'unsupported') ctx.unsupported.add(e.name || e.matchName);
    }
    out.push(layer);
  }
  // parentesco: o id da camada no AE → id da camada no MotionFrame (mesma composição)
  const byAe = new Map(out.map((x) => [x._aeId, x]));
  for (const x of out) {
    const p = x._aeParent && byAe.get(x._aeParent);
    if (p && p !== x) x.parent = p.id;
    delete x._aeId; delete x._aeParent;
  }
  return out;
}

// ---------------------------------------------------------------- formas e máscaras
const child = (n, mn) => (n.children || []).find((c) => c.mn === mn);
const cprop = (n, mn) => child(n, mn)?.prop;
const colorFix = (v) => (v.length >= 4 ? (Math.max(v[1], v[2], v[3]) > 1.0001 ? [v[1] / 255, v[2] / 255, v[3] / 255] : [v[1], v[2], v[3]]) : v.slice(0, 3));
const pctFix = (v) => (v[0] ?? 100);
const scaleFix = (v) => { const a = [v[0] ?? 100, v[1] ?? v[0] ?? 100]; return Math.abs(a[0]) <= 4 && Math.abs(a[1]) <= 4 ? a.map((x) => x * 100) : a; };
const xy = (v) => [v[0] || 0, v[1] || 0];
function pathAnim(node, t0) {
  const pth = node?.path;
  if (!pth?.shapes?.length) return null;
  return { shapes: pth.shapes, times: pth.times.map((t) => +(t0 + t).toFixed(4)) };
}
function convShapes(nodes, t0) {
  const items = [];
  for (const n of nodes) {
    switch (n.mn) {
      case 'ADBE Vector Group': {
        const tr = child(n, 'ADBE Vector Transform Group');
        items.push({ t: 'group', items: convShapes(child(n, 'ADBE Vectors Group')?.children || [], t0), tr: tr ? {
          anchor: toAnim(cprop(tr, 'ADBE Vector Anchor'), xy, [0, 0], t0), position: toAnim(cprop(tr, 'ADBE Vector Position'), xy, [0, 0], t0),
          scale: toAnim(cprop(tr, 'ADBE Vector Scale'), scaleFix, [100, 100], t0), rotation: toAnim(cprop(tr, 'ADBE Vector Rotation'), (v) => v[0] || 0, 0, t0),
          opacity: toAnim(cprop(tr, 'ADBE Vector Group Opacity'), (v) => (Math.abs(v[0]) <= 1 && v[0] !== 0 ? v[0] * 100 : v[0] ?? 100), 100, t0),
        } : {} });
        break;
      }
      case 'ADBE Vector Shape - Rect': items.push({ t: 'rect', size: toAnim(cprop(n, 'ADBE Vector Rect Size'), xy, [100, 100], t0), position: toAnim(cprop(n, 'ADBE Vector Rect Position'), xy, [0, 0], t0), round: toAnim(cprop(n, 'ADBE Vector Rect Roundness'), (v) => v[0] || 0, 0, t0) }); break;
      case 'ADBE Vector Shape - Ellipse': items.push({ t: 'ellipse', size: toAnim(cprop(n, 'ADBE Vector Ellipse Size'), xy, [100, 100], t0), position: toAnim(cprop(n, 'ADBE Vector Ellipse Position'), xy, [0, 0], t0) }); break;
      case 'ADBE Vector Shape - Star': items.push({ t: 'star', kind: cprop(n, 'ADBE Vector Star Type')?.value?.[0] || 1, points: toAnim(cprop(n, 'ADBE Vector Star Points'), (v) => v[0] || 5, 5, t0), position: toAnim(cprop(n, 'ADBE Vector Star Position'), xy, [0, 0], t0), rotation: toAnim(cprop(n, 'ADBE Vector Star Rotation'), (v) => v[0] || 0, 0, t0), outer: toAnim(cprop(n, 'ADBE Vector Star Outer Radius'), (v) => v[0] ?? 100, 100, t0), inner: toAnim(cprop(n, 'ADBE Vector Star Inner Radius'), (v) => v[0] ?? 50, 50, t0) }); break;
      case 'ADBE Vector Shape - Group': { const p = pathAnim(child(n, 'ADBE Vector Shape'), t0); if (p) items.push({ t: 'path', path: p }); break; }
      case 'ADBE Vector Graphic - Fill': items.push({ t: 'fill', color: toAnim(cprop(n, 'ADBE Vector Fill Color'), colorFix, [1, 0, 0], t0), opacity: toAnim(cprop(n, 'ADBE Vector Fill Opacity'), pctFix, 100, t0), rule: cprop(n, 'ADBE Vector Fill Rule')?.value?.[0] || 1 }); break;
      case 'ADBE Vector Graphic - Stroke': items.push({ t: 'stroke', color: toAnim(cprop(n, 'ADBE Vector Stroke Color'), colorFix, [1, 1, 1], t0), opacity: toAnim(cprop(n, 'ADBE Vector Stroke Opacity'), pctFix, 100, t0), width: toAnim(cprop(n, 'ADBE Vector Stroke Width'), (v) => v[0] ?? 2, 2, t0), cap: cprop(n, 'ADBE Vector Stroke Line Cap')?.value?.[0] || 1, join: cprop(n, 'ADBE Vector Stroke Line Join')?.value?.[0] || 1 }); break;
      default: if (n.children && /Vectors Group/.test(n.mn)) items.push(...convShapes(n.children, t0));
    }
  }
  return items;
}
function convMask(mk, W, H, t0) {
  const pathNode = child(mk, 'ADBE Mask Shape');
  const path = pathAnim(pathNode, t0);
  if (!path) return null;
  // máscara normalizada (0..1) → px da camada
  path.shapes = path.shapes.map((sh) => (sh.normalized ? { ...sh, pts: sh.pts.map(([x, y]) => [x * W, y * H]) } : sh));
  const op = cprop(mk, 'ADBE Mask Opacity');
  return {
    path, mode: mk.mask?.mode ?? 1, inverted: !!mk.mask?.inverted,
    feather: toAnim(cprop(mk, 'ADBE Mask Feather'), xy, [0, 0], t0),
    opacity: toAnim(op, (v) => (op && Math.max(...(op.keyframes?.length ? op.keyframes.flatMap((k) => k.v) : op.value || [1])) <= 1 ? (v[0] ?? 1) * 100 : v[0] ?? 100), 100, t0),
  };
}

/** Converte a composição `compId` (ou a principal) num projeto do MotionFrame. */
export function aepToProject(parsed, compId, name = 'Projeto do AE') {
  const comp = parsed.comps.find((c) => c.id === compId) || mainComps(parsed)[0];
  if (!comp) throw new Error('O projeto não tem composições.');
  const proj = createProject(comp.width, comp.height);
  proj.name = name;
  proj.fps = Math.round(comp.fps * 1000) / 1000;
  proj.duration = Math.max(0.1, Math.min(3600, +comp.duration.toFixed(3)));
  proj.background = hex(comp.bg || [0, 0, 0]);
  const ctx = { media: new Set(), notes: new Set(), unsupported: new Set() };
  proj.layers = buildLayers(parsed, comp, proj, ctx);
  return { project: proj, comp, media: [...ctx.media], notes: [...ctx.notes], unsupported: [...ctx.unsupported] };
}
