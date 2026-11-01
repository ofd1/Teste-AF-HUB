// Gera arquivos .ffx sintéticos com o mesmo layout RIFX usado pelo After Effects
// (FaFX > besc > tdsp/sspc > parT/tdgp). Usado nos testes e para gerar /samples.

const enc = new TextEncoder();

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function f64s(vals, minLen = 0) {
  const n = Math.max(vals.length, minLen);
  const b = new Uint8Array(n * 8);
  const dv = new DataView(b.buffer);
  vals.forEach((v, i) => dv.setFloat64(i * 8, v));
  return b;
}
function fixedStr(s, len) { const b = new Uint8Array(len); b.set(enc.encode(s).subarray(0, len - 1)); return b; }

export function chunk(id, payload) {
  const parts = [enc.encode(id), u32(payload.length), payload];
  if (payload.length & 1) parts.push(new Uint8Array(1));
  return concat(parts);
}
export function list(type, children) { return chunk('LIST', concat([enc.encode(type), ...children])); }
export const tdmn = (s) => chunk('tdmn', fixedStr(s, 40));
export const tdsn = (s) => chunk('tdsn', concat([enc.encode(s), new Uint8Array(1)]));

const TYPE_CODES = { layer: 0x00, angle: 0x03, checkbox: 0x04, color: 0x05, point: 0x06, popup: 0x07, slider: 0x0a, group: 0x0d, point3d: 0x12 };

export function pard(type, name) {
  const b = new Uint8Array(148);
  b[15] = TYPE_CODES[type] ?? 0x0a;
  b.set(fixedStr(name, 32), 16);
  return chunk('pard', b);
}

function tdb4(dims) {
  const b = new Uint8Array(124);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, 0xdb99);
  dv.setUint16(2, dims);
  return chunk('tdb4', b);
}

function dimsOf(p) {
  if (p.type === 'color') return 4;
  if (p.type === 'point') return 2;
  if (p.type === 'point3d') return 3;
  return p.dims || 1;
}

/** keys: [{ frame, v:[...], interp: 1|2|3, inf? }] */
function keyframeList(dims, keys, color) {
  const item = color ? 8 + 8 + 32 + 32 + 32 : 8 + 40 * dims;
  const data = new Uint8Array(item * keys.length);
  const dv = new DataView(data.buffer);
  keys.forEach((k, i) => {
    const o = i * item;
    dv.setUint16(o + 1, k.frame);
    dv.setUint8(o + 5, k.interp ?? 1);
    const inf = k.inf ?? 0.33333;
    if (color) {
      dv.setFloat64(o + 24, inf);
      dv.setFloat64(o + 40, inf);
      k.v.forEach((v, j) => dv.setFloat64(o + 48 + j * 8, v));
    } else {
      k.v.forEach((v, j) => dv.setFloat64(o + 8 + j * 8, v));
      for (let j = 0; j < dims; j++) {
        dv.setFloat64(o + 8 + 16 * dims + j * 8, inf);
        dv.setFloat64(o + 8 + 32 * dims + j * 8, inf);
      }
    }
  });
  const lhd3 = new Uint8Array(32);
  const hv = new DataView(lhd3.buffer);
  hv.setUint16(10, keys.length);
  hv.setUint16(18, item);
  return list('list', [chunk('lhd3', lhd3), chunk('ldat', data)]);
}

function tdbs(p) {
  const dims = dimsOf(p);
  const parts = [chunk('tdsb', u32(1)), tdsn(p.name), tdb4(dims), chunk('cdat', f64s(p.values, p.type === 'color' ? 12 : 5))];
  if (p.keys?.length) parts.push(keyframeList(dims, p.keys, p.type === 'color'));
  if (p.expression) parts.push(chunk('Utf8', enc.encode(p.expression)));
  return list('tdbs', parts);
}

const pad4 = (n) => String(n).padStart(4, '0');

/** Bloco 'besc' de um efeito. params: [{ name, type, values, keys? }] */
export function effectBlock(matchName, label, params) {
  const path = list('tdsp', [
    chunk('tdot', u32(0xffffffff)), chunk('tdpl', u32(2)),
    list('tdsi', [chunk('tdix', u32(0xffffffff))]), tdmn('ADBE Effect Parade'),
    list('tdsi', [chunk('tdix', u32(0))]), tdmn(matchName), tdsn(label),
    list('tdsp', [chunk('tdot', u32(0xffffffff)), chunk('tdpl', u32(1)), list('tdsi', [chunk('tdix', u32(0xffffffff))]), tdmn('ADBE End of path sentinel')]),
  ]);
  const defs = [chunk('parn', u32(params.length + 1)), tdmn(`${matchName}-0000`), pard('group', '')];
  const vals = [chunk('tdsb', u32(1)), tdsn(label), tdmn(`${matchName}-0000`), tdbs({ name: '', type: 'group', values: [] })];
  params.forEach((p, i) => {
    const mn = `${matchName}-${pad4(i + 1)}`;
    defs.push(tdmn(mn), pard(p.type, p.name));
    if (p.options) defs.push(chunk('pdnm', concat([enc.encode(p.options.join('|')), new Uint8Array(1)])));
    vals.push(tdmn(mn), tdbs(p));
  });
  vals.push(tdmn('ADBE Group End'));
  const sspc = list('sspc', [chunk('fnam', new Uint8Array(48)), list('parT', defs), list('tdgp', vals)]);
  return list('besc', [chunk('beso', new Uint8Array(56)), path, sspc]);
}

/** Grupo de propriedades (ex.: ADBE Transform Group) para presets de animação. */
export function groupBlock(matchName, props) {
  const parts = [chunk('tdsb', u32(1))];
  for (const p of props) parts.push(tdmn(p.matchName), tdbs(p));
  parts.push(tdmn('ADBE Group End'));
  return concat([tdmn(matchName), list('tdgp', parts)]);
}

export function ffxFile(blocks) {
  const head = chunk('head', new Uint8Array([0, 0, 0, 3, 0, 0, 0, 0x44, 0, 0, 0, 1, 1, 0, 0, 0]));
  const body = concat([enc.encode('FaFX'), head, ...blocks]);
  return concat([enc.encode('RIFX'), u32(body.length), body]);
}
