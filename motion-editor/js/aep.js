// Leitor de projetos do After Effects (.aep): pastas, composições, camadas (tempo, tipo, transformação com
// keyframes, efeitos), sólidos e arquivos de mídia (caminho original). Formato RIFX ("Egg!").
// Estrutura conferida com projetos reais e com a documentação dos parsers abertos (aep_parser / aftereffects-aep-parser).
import { RiffReader } from './riff.js';
import { parseFXChildren } from './ffx.js';

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
  if (p.keyframes?.length) {
    const keys = p.keyframes.map((kf, i, a) => ({ t: +(t0 + kf.t).toFixed(4), v: fix(kf.v), ...ffxEase(kf, a[i + 1]) }));
    return anim(keys[0].v, keys);
  }
  return anim(p.value?.length ? fix(p.value) : fallback);
}

/** Posição com dimensões separadas (Position_0 / Position_1) → uma posição [x, y] com keyframes combinados. */
function mergedPosition(px, py, fallback, t0) {
  const ax = toAnim(px, (v) => v[0], fallback[0], t0), ay = toAnim(py, (v) => v[0], fallback[1], t0);
  const times = [...new Set([...ax.keys, ...ay.keys].map((k) => k.t))].sort((a, b) => a - b);
  const val = (a, t) => { if (!a.keys.length) return a.value; let k = a.keys[0]; for (const x of a.keys) if (x.t <= t) k = x; return k.v; };
  if (!times.length) return anim([ax.value, ay.value]);
  return anim([val(ax, times[0]), val(ay, times[0])], times.map((t) => ({ t, v: [val(ax, t), val(ay, t)], ease: 'linear' })));
}

function applyTransform(layer, l, srcW, srcH, comp, t0, cw = srcW, ch = srcH) {
  const tr = layer.transform;
  const pos = propOf(l, 'ADBE Position'), p0 = propOf(l, 'ADBE Position_0'), p1 = propOf(l, 'ADBE Position_1');
  const center = [comp.width / 2, comp.height / 2];
  const separated = (p0?.keyframes?.length || p1?.keyframes?.length) && !pos?.keyframes?.length;
  tr.position = separated ? mergedPosition(p0, p1, pos?.value?.length ? [pos.value[0], pos.value[1]] : center, t0)
    : toAnim(pos, (v) => [v[0] ?? center[0], v[1] ?? center[1]], center, t0);
  // ponto de ancoragem: no .aep é uma fração do tamanho da camada (0,5 = centro); o MotionFrame conta do centro em px
  const ap = propOf(l, 'ADBE Anchor Point');
  const vals = ap ? [...(ap.value || []), ...(ap.keyframes || []).flatMap((k) => k.v)] : [];
  const norm = vals.length && vals.every((x) => Math.abs(x) <= 4);
  // (cw, ch) = tamanho da tela da camada no MotionFrame (uma pré-comp usa a tela do projeto)
  tr.anchor = toAnim(ap, (v) => (norm ? [(v[0] ?? 0.5) * srcW - cw / 2, (v[1] ?? 0.5) * srcH - ch / 2] : [(v[0] ?? srcW / 2) - cw / 2, (v[1] ?? srcH / 2) - ch / 2]), [srcW / 2 - cw / 2, srcH / 2 - ch / 2], t0);
  // escala e opacidade ficam como fração no .aep (0,56 = 56%)
  tr.scale = toAnim(propOf(l, 'ADBE Scale'), (v) => [(v[0] ?? 1) * 100, (v[1] ?? v[0] ?? 1) * 100], [100, 100], t0);
  tr.rotation = toAnim(propOf(l, 'ADBE Rotate Z'), (v) => v[0] || 0, 0, t0);
  tr.opacity = toAnim(propOf(l, 'ADBE Opacity'), (v) => (v[0] ?? 1) * 100, 100, t0);
}

const BLENDS = { 2: 'source-over', 3: 'lighter', 4: 'multiply', 5: 'screen', 6: 'overlay', 7: 'soft-light', 8: 'hard-light', 9: 'darken', 10: 'lighten', 11: 'difference', 13: 'color-dodge', 14: 'color-burn', 15: 'exclusion', 16: 'hue', 17: 'saturation', 18: 'color', 19: 'luminosity' };

function buildLayers(parsed, comp, proj, ctx, offset = 0, depth = 0) {
  const out = [];
  for (const l of comp.layers) {
    if (l.camera || l.layerType === 1 || l.layerType === 2 || l.guide) continue; // câmeras, luzes e guias não aparecem no render
    const src = parsed.byId.get(l.sourceId);
    const W = src?.width || comp.width, H = src?.height || comp.height;
    let layer;
    if (l.adjustment) layer = LAYER_FACTORIES.adjustment(proj);
    else if (l.nullLayer) { ctx.notes.add('Camadas Null foram ignoradas (o MotionFrame não tem parentesco de camadas).'); continue; }
    else if (l.layerType === 3) { layer = LAYER_FACTORIES.text(proj); layer.props.text = l.name || 'Texto'; ctx.notes.add('Textos vêm com o nome da camada (a fonte e o conteúdo exato do AE não são lidos).'); }
    else if (l.layerType === 4) { ctx.notes.add('Camadas de forma (Shape) ainda não são importadas.'); continue; }
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
    if (!layer.name || /^(Texto|Sólido|Ajuste|Grupo)$/.test(layer.name)) layer.name = l.name || src?.name || layer.name;
    if (layer.props.aeMedia) layer.name = `⚠ ${layer.name}`;
    layer.inPoint = Math.max(0, +(offset + l.inPoint).toFixed(4));
    layer.outPoint = Math.min(proj.duration, +(offset + l.outPoint).toFixed(4));
    if (layer.outPoint <= layer.inPoint) continue;
    layer.visible = l.enabled !== false;
    layer.blend = BLENDS[l.blend] || 'source-over';
    const isGroup = layer.type === 'group';
    applyTransform(layer, l, W, H, comp, offset + l.startTime, isGroup ? proj.width : W, isGroup ? proj.height : H);
    // efeitos (mesma conversão dos presets .ffx: Sapphire, BCC, Looks, Twitch, Deep Glow…)
    if (l.effects.length) {
      const pre = ffxToPreset({ name: l.name, format: 'AEP', effects: l.effects, properties: [], warnings: [], matchNames: [] });
      for (const fx of pre.effects) layer.effects.push(createEffectInstance(fx.type, fx.params, offset + l.startTime, { ...(fx.label ? { label: fx.label } : {}), ...(fx.matchName ? { matchName: fx.matchName } : {}), ...(fx.defs ? { defs: fx.defs } : {}) }));
      for (const e of pre.report.effects) if (e.status === 'unsupported') ctx.unsupported.add(e.name || e.matchName);
    }
    out.push(layer);
  }
  return out;
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
