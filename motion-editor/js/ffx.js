// Interpretador de presets .ffx do After Effects.
//
// Estrutura (RIFX big-endian, form type 'FaFX'):
//   head
//   LIST besc
//     beso
//     LIST tdsp      -> caminho do alvo: tdmn "ADBE Effect Parade", tdmn "<matchName>", tdsn "<nome>"
//     LIST sspc      -> instância de efeito
//       fnam
//       LIST parT    -> definições: parn, (tdmn "<mn>-0001", pard)...
//       LIST tdgp    -> valores: tdsb, tdsn, (tdmn "<mn>-0001", LIST tdbs{tdsb,tdsn,tdb4,cdat,LIST list{lhd3,ldat}})...
//                        tdmn "ADBE Group End"
// Presets de animação podem conter grupos tdgp aninhados (ex.: "ADBE Transform Group",
// "ADBE Effect Parade") com o mesmo padrão tdmn + LIST.
//
// O parser é genérico e tolerante: percorre toda a árvore, e também faz uma varredura
// bruta de chunks 'tdmn' para listar match names mesmo em arquivos com estrutura inesperada.

import { RiffReader, dumpTree } from './riff.js';

export const PARAM_TYPES = {
  0x00: 'layer',
  0x02: 'slider',
  0x03: 'angle',
  0x04: 'checkbox',
  0x05: 'color',
  0x06: 'point',
  0x07: 'popup',
  0x0a: 'slider',
  0x0d: 'group',
  0x0f: 'custom',
  0x12: 'point3d',
};

const STRUCTURAL = new Set([
  'ADBE Group End',
  'ADBE End of path sentinel',
  'ADBE Effect Parade',
  'ADBE Root Vectors Group',
]);

export function parseFFX(buffer, opts = {}) {
  const fps = opts.fps || 30;
  const r = new RiffReader(buffer);
  const result = {
    format: '',
    name: opts.fileName ? opts.fileName.replace(/\.ffx$/i, '') : 'Preset FFX',
    effects: [],
    properties: [], // propriedades fora de efeitos (transform, texto, etc.)
    matchNames: [],
    warnings: [],
    tree: [],
  };

  let root;
  try {
    root = r.parse();
    result.format = `${root.id}/${root.listType}`;
    if (root.listType !== 'FaFX') result.warnings.push(`Form type "${root.listType}" (esperado "FaFX"). Tentando interpretar mesmo assim.`);
    if (root.truncated) result.warnings.push('Arquivo parece truncado; dados finais podem estar faltando.');
    result.tree = dumpTree(r, root);
  } catch (e) {
    result.warnings.push(`Falha ao ler estrutura RIFX: ${e.message}`);
  }

  const ctx = { r, fps, result, targetPath: [], groupPath: [] };
  if (root) walk(root.children, ctx);

  // Varredura bruta de match names (fallback).
  result.matchNames = scanMatchNames(r);
  if (!result.effects.length && !result.properties.length) {
    const effectLike = result.matchNames.filter((m) => !STRUCTURAL.has(m) && !/-\d{4}$/.test(m));
    for (const mn of effectLike) {
      result.effects.push({ matchName: mn, name: mn, params: [], fromScan: true });
    }
    if (effectLike.length) result.warnings.push('Estrutura não reconhecida; efeitos detectados por varredura (sem valores).');
  }
  return result;
}

function walk(children, ctx, group = null) {
  const { r } = ctx;
  let pending = null;
  for (const c of children) {
    if (c.id === 'tdmn') {
      pending = r.cstr(c.offset, c.size);
      continue;
    }
    if (c.id === 'tdsn' && !group && !pending) {
      continue;
    }
    if (c.id !== 'LIST' || !c.children) continue;

    switch (c.listType) {
      case 'tdsp': {
        const path = [];
        let label = null;
        collectPath(c.children, ctx, path, (l) => { if (!label) label = l; });
        if (path.length) ctx.targetPath = path;
        if (label && ctx.result.name === 'Preset FFX') ctx.result.name = label;
        if (label) ctx.targetLabel = label;
        break;
      }
      case 'sspc': {
        let mn = pending && !STRUCTURAL.has(pending) && !/-\d{4}$/.test(pending) ? pending : null;
        if (!mn) mn = [...ctx.targetPath].reverse().find((m) => !STRUCTURAL.has(m)) || 'Desconhecido';
        const fx = parseEffect(c, mn, ctx);
        if (!fx.name || fx.name === mn) fx.name = ctx.targetLabel && ctx.targetPath.includes(mn) ? ctx.targetLabel : fx.name || mn;
        ctx.result.effects.push(fx);
        break;
      }
      case 'tdgp': {
        ctx.groupPath.push(pending || '?');
        walk(c.children, ctx, pending || '?');
        ctx.groupPath.pop();
        break;
      }
      case 'tdbs': {
        const prop = parseProperty(c, pending || '?', null, ctx);
        prop.groupPath = ctx.groupPath.slice();
        ctx.result.properties.push(prop);
        break;
      }
      default:
        walk(c.children, ctx, group);
    }
    pending = null;
  }
}

function collectPath(children, ctx, path, onLabel) {
  for (const c of children) {
    if (c.id === 'tdmn') {
      const s = ctx.r.cstr(c.offset, c.size);
      if (s && s !== 'ADBE End of path sentinel') path.push(s);
    } else if (c.id === 'tdsn') {
      onLabel(readName(ctx.r, c));
    } else if (c.id === 'LIST' && c.children) {
      if (c.listType === 'tdsn') onLabel(readName(ctx.r, c));
      else collectPath(c.children, ctx, path, onLabel);
    }
  }
}

function readName(r, c) {
  if (c.children) {
    const utf = c.children.find((x) => x.id === 'Utf8');
    return utf ? r.cstr(utf.offset, utf.size) : '';
  }
  return r.cstr(c.offset, c.size);
}

function parseEffect(sspc, matchName, ctx) {
  const { r } = ctx;
  const fx = { matchName, name: '', params: [] };
  const defs = new Map();

  const fnam = sspc.children.find((c) => c.id === 'fnam' || (c.id === 'LIST' && c.listType === 'fnam'));
  if (fnam) {
    const n = readName(r, fnam);
    if (n) fx.name = n;
  }

  const parT = sspc.children.find((c) => c.id === 'LIST' && c.listType === 'parT');
  if (parT) {
    let pm = null;
    let last = null;
    for (const c of parT.children) {
      if (c.id === 'tdmn') pm = r.cstr(c.offset, c.size);
      else if (c.id === 'pard' && pm) {
        const typeCode = r.u8(c.offset + 15);
        last = { matchName: pm, typeCode, type: PARAM_TYPES[typeCode] || `0x${typeCode.toString(16)}`, name: r.cstr(c.offset + 16, 32) };
        if (last.type === 'slider' && c.size >= 140) {
          // limites do slider (float32) — usados só como metadados
          try {
            last.min = r.f32(c.offset + 104);
            last.max = r.f32(c.offset + 108);
          } catch { /* ignore */ }
        }
        defs.set(pm, last);
        pm = null;
      } else if (c.id === 'pdnm' && last) {
        last.options = r.cstr(c.offset, c.size).split('|');
      }
    }
  }

  const tdgp = sspc.children.find((c) => c.id === 'LIST' && c.listType === 'tdgp');
  if (tdgp) {
    let pm = null;
    for (const c of tdgp.children) {
      if (c.id === 'tdmn') { pm = r.cstr(c.offset, c.size); continue; }
      if (c.id === 'tdsn' && !fx.name) fx.name = readName(r, c);
      if (c.id === 'LIST' && c.listType === 'tdbs' && pm) {
        const def = defs.get(pm);
        const p = parseProperty(c, pm, def, ctx);
        p.index = paramIndex(pm);
        if (def) {
          p.type = def.type;
          p.name = p.name || def.name;
          if (def.options) p.options = def.options;
        }
        if (p.type !== 'group' && p.type !== 'custom' && !(p.index === 0 && !p.value.length)) fx.params.push(p);
        pm = null;
      } else if (c.id === 'LIST' && c.listType === 'tdgp') {
        // grupo de parâmetros aninhado: achata
        flattenGroup(c, defs, fx, ctx);
        pm = null;
      }
    }
  }

  // definições sem valores (ex.: só parT)
  if (!fx.params.length && defs.size) {
    for (const d of defs.values()) {
      if (d.type === 'group' || paramIndex(d.matchName) === 0) continue;
      fx.params.push({ matchName: d.matchName, index: paramIndex(d.matchName), name: d.name, type: d.type, value: [], keyframes: [] });
    }
  }
  return fx;
}

function flattenGroup(tdgp, defs, fx, ctx) {
  const { r } = ctx;
  let pm = null;
  for (const c of tdgp.children) {
    if (c.id === 'tdmn') pm = r.cstr(c.offset, c.size);
    else if (c.id === 'LIST' && c.listType === 'tdbs' && pm) {
      const def = defs.get(pm);
      const p = parseProperty(c, pm, def, ctx);
      p.index = paramIndex(pm);
      if (def) { p.type = def.type; p.name = p.name || def.name; }
      fx.params.push(p);
      pm = null;
    } else if (c.id === 'LIST' && c.listType === 'tdgp') flattenGroup(c, defs, fx, ctx);
  }
}

export function paramIndex(mn) {
  const m = /-(\d{4})$/.exec(mn || '');
  return m ? parseInt(m[1], 10) : -1;
}

function parseProperty(tdbs, matchName, def, ctx) {
  const { r } = ctx;
  const p = { matchName, name: '', type: def?.type || '', dims: 0, value: [], keyframes: [], expression: null };
  let cdat = null;
  let list = null;
  for (const c of tdbs.children) {
    if (c.id === 'tdsn' || (c.id === 'LIST' && c.listType === 'tdsn')) p.name = readName(r, c);
    else if (c.id === 'tdb4' && c.size >= 4) p.dims = r.u16(c.offset + 2);
    else if (c.id === 'cdat') cdat = c;
    else if (c.id === 'LIST' && c.listType === 'list') list = c;
    else if (c.id === 'Utf8') {
      const s = r.cstr(c.offset, c.size);
      if (s.trim()) p.expression = s;
    }
  }
  if (!p.type && p.dims === 4) p.type = 'color';
  const dims = p.dims || (p.type === 'color' ? 4 : 1);
  if (cdat) {
    const n = Math.min(dims, Math.floor(cdat.size / 8));
    for (let i = 0; i < n; i++) p.value.push(r.f64(cdat.offset + i * 8));
  }
  if (list) {
    try {
      p.keyframes = parseKeyframes(list, p, ctx);
    } catch (e) {
      ctx.result.warnings.push(`Keyframes de "${p.name || matchName}" não puderam ser lidos (${e.message}); usando valor estático.`);
      p.keyframes = [];
    }
  }
  if (p.expression) {
    ctx.result.warnings.push(`Expressão em "${p.name || matchName}" foi preservada como texto, mas não é executada.`);
  }
  return p;
}

// Keyframes: LIST list { lhd3 (cabeçalho), ldat (itens) }.
// Item: [0]=?, [1..2]=tempo (u16), [3..4]=?, [5]=interpolação (1 linear, 2 bézier, 3 hold), [6]=label, [7]=flags,
// seguido de dados dependentes do tipo.
function parseKeyframes(list, p, ctx) {
  const { r } = ctx;
  const lhd3 = list.children.find((c) => c.id === 'lhd3');
  const ldat = list.children.find((c) => c.id === 'ldat');
  if (!lhd3 || !ldat || !ldat.size) return [];

  let count = lhd3.size >= 12 ? r.u16(lhd3.offset + 10) : 0;
  if (!count || ldat.size % count !== 0) {
    const c32 = lhd3.size >= 12 ? r.u32(lhd3.offset + 8) : 0;
    if (c32 && ldat.size % c32 === 0) count = c32;
  }
  if (!count || ldat.size % count !== 0) throw new Error('cabeçalho inválido');
  const item = ldat.size / count;
  const dims = p.dims || (p.type === 'color' ? 4 : 1);

  let layout;
  if (p.type === 'color' || dims === 4) layout = { valueOff: 8 + 8 + 32, n: 4, inf: [8 + 8 + 8, 8 + 8 + 24] };
  else if (item === 8 + 40 * dims) layout = { valueOff: 8, n: dims, inf: [8 + 16 * dims, 8 + 32 * dims] };
  else if (item === 8 + 8 + 32 + 24 * dims) layout = { valueOff: 48, n: dims, inf: [24, 40] }; // posição espacial
  else if ((item - 8) % 40 === 0) layout = { valueOff: 8, n: (item - 8) / 40, inf: [8 + 16 * ((item - 8) / 40), 8 + 32 * ((item - 8) / 40)] };
  else throw new Error(`tamanho de item ${item} desconhecido`);

  const keys = [];
  for (let k = 0; k < count; k++) {
    const base = ldat.offset + k * item;
    const raw = r.u16(base + 1);
    const interp = r.u8(base + 5);
    const v = [];
    for (let i = 0; i < layout.n; i++) {
      const off = base + layout.valueOff + i * 8;
      if (off + 8 > ldat.offset + ldat.size) break;
      v.push(r.f64(off));
    }
    const inInf = r.f64(base + layout.inf[0]);
    const outInf = r.f64(base + layout.inf[1]);
    keys.push({ raw, t: raw / ctx.fps, v, interp, inInf: normInf(inInf), outInf: normInf(outInf) });
  }
  // validação de plausibilidade
  const ok = keys.every((k) => k.v.length && k.v.every((x) => Number.isFinite(x) && Math.abs(x) < 1e7));
  const sorted = keys.every((k, i) => i === 0 || k.raw >= keys[i - 1].raw);
  if (!ok || !sorted) throw new Error('valores implausíveis');
  const t0 = keys[0].raw;
  for (const k of keys) k.t = (k.raw - t0) / ctx.fps;
  return keys;
}

function normInf(x) {
  if (!Number.isFinite(x) || x <= 0) return 0.333;
  return x > 1 ? Math.min(1, x / 100) : x;
}

export function scanMatchNames(r) {
  const out = [];
  const b = r.bytes;
  for (let i = 0; i + 8 < b.length; i++) {
    if (b[i] === 0x74 && b[i + 1] === 0x64 && b[i + 2] === 0x6d && b[i + 3] === 0x6e) { // 'tdmn'
      const size = (b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7];
      if (size > 0 && size <= 64) {
        const s = r.cstr(i + 8, size);
        if (s && /^[\x20-\x7e]+$/.test(s) && !out.includes(s)) out.push(s);
      }
    }
  }
  return out;
}

/** Re-calcula tempos dos keyframes com outro fps (sem reler o arquivo). */
export function retimeFFX(parsed, fps) {
  const fix = (p) => {
    if (!p.keyframes?.length) return;
    const t0 = p.keyframes[0].raw;
    for (const k of p.keyframes) k.t = (k.raw - t0) / fps;
  };
  parsed.effects.forEach((fx) => fx.params.forEach(fix));
  parsed.properties.forEach(fix);
}
