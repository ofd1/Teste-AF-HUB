// Exportador de presets .ffx (After Effects).
// Cada efeito do MotionFrame que tem um efeito equivalente no AE (nativo ou plugin: Twitch, Sapphire, BCC…) vira esse
// efeito no .ffx, com os valores e keyframes da camada. Para ficar no formato exato do AE, o bloco de cada efeito vem de
// um molde tirado de .ffx reais (js/ffx-templates.js) e só os valores são trocados. Efeitos sem molde usam um bloco
// montado do zero (pode não abrir em todas as versões do AE); efeitos só do MotionFrame não têm como ir para o AE.
import { IMPORT_RULES } from './import-map.js';
import { getEffectDef } from './effects.js';
import { valueAt } from './anim.js';
import { parseFFX } from './ffx.js';
import { ffxToPreset } from './presets.js';

const enc = new TextEncoder();
const pad4 = (n) => String(n).padStart(4, '0');

// ---------------------------------------------------------------- RIFX (big-endian) em árvore
function parseTree(d, o = 0, end = d.length) {
  const out = [];
  while (o + 8 <= end) {
    const id = String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
    const n = ((d[o + 4] << 24) | (d[o + 5] << 16) | (d[o + 6] << 8) | d[o + 7]) >>> 0;
    if (id === 'LIST') {
      const type = String.fromCharCode(d[o + 8], d[o + 9], d[o + 10], d[o + 11]);
      out.push({ id, type, kids: parseTree(d, o + 12, o + 8 + n) });
    } else out.push({ id, data: d.slice(o + 8, o + 8 + n) });
    o += 8 + n + (n & 1);
  }
  return out;
}
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; }
function cat(parts) { const len = parts.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(len); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
function ser(node) {
  const payload = node.id === 'LIST' ? cat([enc.encode(node.type), ...node.kids.map(ser)]) : node.data;
  const parts = [enc.encode(node.id), u32(payload.length), payload];
  if (payload.length & 1) parts.push(new Uint8Array(1));
  return cat(parts);
}
const leaf = (id, data) => ({ id, data });
// nomes (tdsn) no formato do AE: um bloco "Utf8" dentro do tdsn
const tdsnOf = (name) => leaf('tdsn', ser(leaf('Utf8', enc.encode(name))));
const LIST = (type, kids) => ({ id: 'LIST', type, kids });
const str = (s, len) => { const b = new Uint8Array(len); b.set(enc.encode(s).subarray(0, len - 1)); return b; };
const cstr = (b) => { let s = ''; for (let i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]); return s; };
const f64s = (vals, n) => { const b = new Uint8Array(Math.max(vals.length, n) * 8); const dv = new DataView(b.buffer); vals.forEach((v, i) => dv.setFloat64(i * 8, v)); return b; };
const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

// ---------------------------------------------------------------- valores
function invertConv(conv, target, kind) {
  if (!conv) return target;
  if (kind === 'bool') return target ? 1 : 0;
  if (typeof target !== 'number') return target;
  // conv costuma ser linear/monótona: resolve conv(x) = alvo numericamente
  const f = (x) => { const y = conv(x); return typeof y === 'number' ? y : NaN; };
  const a = f(0), b = f(1);
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > 1e-12) {
    let x = (target - a) / (b - a);
    for (let i = 0; i < 30; i++) { const y = f(x), y2 = f(x + 1e-4); const dy = (y2 - y) / 1e-4; if (!Number.isFinite(dy) || Math.abs(dy) < 1e-12) break; const nx = x - (y - target) / dy; if (Math.abs(nx - x) < 1e-9) { x = nx; break; } x = nx; }
    if (Number.isFinite(x) && Math.abs(f(x) - target) <= Math.max(1e-3, Math.abs(target) * 1e-3)) return x;
  }
  return null; // não deu para inverter: mantém o valor do molde
}
/** valor do app → números do AE (cdat) */
function toAE(v, kind, colorScale) {
  if (kind === 'color') { const [r, g, b] = v || [1, 1, 1]; return [colorScale, r * colorScale, g * colorScale, b * colorScale]; }
  if (kind === 'bool') return [v ? 1 : 0];
  if (Array.isArray(v)) return v.slice(0, 3);
  return [+v || 0];
}

// ---------------------------------------------------------------- keyframes (LIST list { lhd3, ldat })
function keyList(keys, dims, fps, lhd3Tpl) {
  const item = 8 + 40 * dims;
  const data = new Uint8Array(item * keys.length), dv = new DataView(data.buffer);
  const t0 = keys[0].t;
  keys.forEach((k, i) => {
    const o = i * item;
    const raw = Math.max(0, Math.round((k.t - t0) * fps));
    dv.setUint16(o + 1, raw);
    const interp = k.ease === 'hold' ? 3 : k.ease === 'linear' ? 1 : 2;
    dv.setUint8(o + 4, interp); dv.setUint8(o + 5, interp);
    const vals = Array.isArray(k.v) ? k.v : [k.v];
    for (let j = 0; j < dims; j++) {
      dv.setFloat64(o + 8 + j * 8, vals[j] ?? 0);
      dv.setFloat64(o + 8 + 8 * dims + j * 8, 0); // velocidade de entrada
      dv.setFloat64(o + 8 + 16 * dims + j * 8, interp === 2 ? (k.inInf ?? 0.3333) : 0.1667);
      dv.setFloat64(o + 8 + 24 * dims + j * 8, 0); // velocidade de saída
      dv.setFloat64(o + 8 + 32 * dims + j * 8, interp === 2 ? (k.outInf ?? 0.3333) : 0.1667);
    }
  });
  const h = lhd3Tpl ? lhd3Tpl.slice() : new Uint8Array(52);
  const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  hv.setUint16(10, keys.length); hv.setUint32(16, item);
  return LIST('list', [leaf('lhd3', h), leaf('ldat', data)]);
}

/** Troca o valor (ou os keyframes) de um LIST tdbs do molde. */
function patchTdbs(tdbs, aeVals, aeKeys, fps, lhd3) {
  const wasAnimated = tdbs.kids.some((k) => k.id === 'LIST' && k.type === 'list');
  const kids = tdbs.kids.filter((k) => !(k.id === 'LIST' && k.type === 'list') && k.id !== 'cdat');
  const tdb4 = kids.find((k) => k.id === 'tdb4');
  const at = tdb4 ? kids.indexOf(tdb4) + 1 : kids.length;
  // só mexe na marca de "animado" do tdb4 quando muda de estático ↔ animado (como o AE grava)
  if (tdb4 && wasAnimated !== !!aeKeys) { tdb4.data = tdb4.data.slice(); tdb4.data[4] = 0; tdb4.data[5] = aeKeys ? 0 : 1; }
  const dims = tdb4 ? (tdb4.data[2] << 8) | tdb4.data[3] : aeVals.length;
  if (aeKeys) kids.splice(at, 0, keyList(aeKeys, Math.max(1, Math.min(dims || 1, 3)), fps, lhd3));
  else kids.splice(at, 0, leaf('cdat', f64s(aeVals, Math.max(5, aeVals.length))));
  tdbs.kids = kids;
}

// ---------------------------------------------------------------- bloco montado do zero (sem molde)
const TYPE_CODE = { number: 0x0a, angle: 0x03, bool: 0x04, color: 0x05, point: 0x06, select: 0x07 };
function syntheticSspc(mn, label, params) {
  const pard = (type, name) => { const b = new Uint8Array(148); b[15] = type; b.set(str(name, 32), 16); return leaf('pard', b); };
  const tdbsOf = (name, dims, vals) => { const t4 = new Uint8Array(124); const dv = new DataView(t4.buffer); dv.setUint16(0, 0xdb99); dv.setUint16(2, dims); t4[5] = 1; return LIST('tdbs', [leaf('tdsb', u32(1)), tdsnOf(name), leaf('tdb4', t4), leaf('cdat', f64s(vals, 5))]); };
  const defs = [leaf('parn', u32(params.length + 1)), leaf('tdmn', str(`${mn}-0000`, 40)), pard(0x0d, '')];
  const vals = [leaf('tdsb', u32(1)), tdsnOf(label), leaf('tdmn', str(`${mn}-0000`, 40)), tdbsOf('', 1, [])];
  params.forEach((p, i) => {
    const pm = `${mn}-${pad4(i + 1)}`;
    defs.push(leaf('tdmn', str(pm, 40)), pard(TYPE_CODE[p.kind] ?? 0x0a, p.name));
    vals.push(leaf('tdmn', str(pm, 40)), tdbsOf(p.name, p.kind === 'color' ? 4 : p.kind === 'point' ? 2 : 1, p.vals));
  });
  vals.push(leaf('tdmn', str('ADBE Group End', 40)));
  return LIST('sspc', [leaf('fnam', new Uint8Array(48)), LIST('parT', defs), LIST('tdgp', vals)]);
}

// ---------------------------------------------------------------- regra do AE para um efeito do app
let TPL = null;
async function templates() { if (!TPL) TPL = await import('./ffx-templates.js'); return TPL; }

function rulesFor(type) { return IMPORT_RULES.filter((r) => r.to === type && !r.expand); }
function pickTarget(type, tpl) {
  const rules = rulesFor(type);
  for (const r of rules) for (const mn of r.match || []) if (tpl.TEMPLATES[mn]) return { rule: r, mn, tpl: true };
  for (const r of rules) for (const mn of Object.keys(tpl.TEMPLATES)) if (r.test && r.test.test(mn)) return { rule: r, mn, tpl: true };
  for (const r of rules) if (r.match?.length && r.vendor?.startsWith('Adobe')) return { rule: r, mn: r.match[0], tpl: false };
  return null;
}

function wrapFile(paths, blocks) {
  const allPaths = [...paths, LIST('tdsp', [leaf('tdot', u32(0xffffffff)), leaf('tdpl', u32(1)), LIST('tdsi', [leaf('tdix', u32(0xffffffff)), leaf('tdmn', str('ADBE End of path sentinel', 40))])])];
  const besc = LIST('besc', [leaf('beso', new Uint8Array(56)), ...allPaths, ...blocks]);
  const head = leaf('head', new Uint8Array([0, 0, 0, 3, 0, 0, 0, 0x44, 0, 0, 0, 1, 1, 0, 0, 0]));
  const body = cat([enc.encode('FaFX'), ser(head), ser(besc)]);
  return cat([enc.encode('RIFX'), u32(body.length), body]);
}
const pathOf = (mn, i, label) => [LIST('tdsp', [leaf('tdot', u32(0xffffffff)), leaf('tdpl', u32(2)),
  LIST('tdsi', [leaf('tdix', u32(0xffffffff)), leaf('tdmn', str('ADBE Effect Parade', 40))]),
  LIST('tdsi', [leaf('tdix', u32(i)), leaf('tdmn', str(mn, 40))])]), tdsnOf(label)];
function readBack(mn, label, sspc, type) {
  try {
    const bytes = wrapFile(pathOf(mn, 0, label), [sspc]);
    const pre = ffxToPreset(parseFFX(bytes.buffer, { fps: 30 }));
    const e = pre.effects.find((x) => x.type === type);
    return e ? e.params : null;
  } catch { return null; }
}

/** Monta o .ffx. effects: instâncias da camada. Devolve { bytes, report: { ok:[], approx:[], skipped:[] } }. */
export async function effectsToFFX(effects, { fps = 30, name = 'MotionFrame' } = {}) {
  const tpl = await templates();
  const lhd3 = tpl.LHD3 && tpl.LHD3 !== 'null' ? b64(tpl.LHD3) : null;
  const paths = [], blocks = [];
  const report = { ok: [], approx: [], skipped: [] };
  let idx = 0;
  for (const fx of effects) {
    if (fx.enabled === false) continue;
    const def = getEffectDef(fx.type);
    const label = fx.label || def?.label || fx.type;
    const target = def ? pickTarget(fx.type, tpl) : null;
    if (!target) { report.skipped.push(label); continue; }
    const { rule, mn } = target;
    let sspc;
    let mapped = 0;
    const valueOf = (pd) => {
      const p = fx.params[pd.key];
      return p && Array.isArray(p.keys) && p.keys.length ? { keys: p.keys } : { value: p ? valueAt(p, 0) : pd.default };
    };
    if (target.tpl) {
      [sspc] = parseTree(b64(tpl.TEMPLATES[mn]));
      const parT = sspc.kids.find((k) => k.type === 'parT'), tdgp = sspc.kids.find((k) => k.type === 'tdgp');
      // nomes dos parâmetros no molde (pard) por índice
      const names = {};
      for (let i = 0; i < parT.kids.length; i++) {
        const k = parT.kids[i];
        if (k.id === 'tdmn') { const m = cstr(k.data).match(/-(\d{4})$/); const pd = parT.kids[i + 1]; if (m && pd?.id === 'pard') names[+m[1]] = cstr(pd.data.slice(16, 48)).toLowerCase().trim(); }
      }
      const tdbsAt = (n) => { for (let i = 0; i < tdgp.kids.length - 1; i++) if (tdgp.kids[i].id === 'tdmn' && cstr(tdgp.kids[i].data) === `${mn}-${pad4(n)}` && tdgp.kids[i + 1].type === 'tdbs') return tdgp.kids[i + 1]; return null; };
      const used = new Set(), writes = [];
      for (const pd of def.params) {
        if (pd.kind === 'hidden') continue;
        const m = rule.map?.[pd.key];
        let n = m?.i;
        const cand = [...(m?.n || []), ...(m ? [] : [pd.label, pd.key])].map((x) => String(x).toLowerCase().trim());
        if (!n || !names[n]) n = +Object.keys(names).find((i) => !used.has(+i) && cand.includes(names[i])) || n;
        if (!n || used.has(n)) continue;
        const tb = tdbsAt(n);
        if (!tb) continue;
        const cd = tb.kids.find((k) => k.id === 'cdat');
        const colorScale = cd && pd.kind === 'color' && new DataView(cd.data.buffer, cd.data.byteOffset).getFloat64(0) > 1 ? 255 : 1;
        const val = valueOf(pd);
        // inv: conversão de volta explícita (popups como o Frame Interp do Twixtor, valores com limite)
        const conv = (x) => { const y = m?.inv ? m.inv(x) : invertConv(m?.conv, x, pd.kind); return y === null ? null : toAE(y, m?.inv ? 'number' : pd.kind === 'bool' ? 'bool' : pd.kind, colorScale); };
        if (val.keys && pd.kind !== 'color') {
          const ks = val.keys.map((k) => ({ ...k, v: conv(k.v) })).filter((k) => k.v);
          if (ks.length !== val.keys.length) continue;
          patchTdbs(tb, null, ks.map((k) => ({ ...k, v: k.v })), fps, lhd3);
        } else {
          const v = conv(val.keys ? valueAt({ value: pd.default, keys: val.keys }, 0) : val.value);
          if (!v) continue;
          patchTdbs(tb, v, null, fps, lhd3);
          if (pd.kind === 'number' || pd.kind === 'angle') writes.push({ pd, tb, ae: v, want: val.value });
        }
        used.add(n); mapped++;
      }
      // conferência: lê o bloco de volta com o importador e corrige valores que a regra transforma (ex.: escalas no post)
      for (let pass = 0; pass < 2 && writes.length; pass++) {
        const back = readBack(mn, label, sspc, fx.type);
        if (!back) break;
        let fixed = 0;
        for (const w of writes) {
          const got = back[w.pd.key];
          if (typeof got !== 'number' || typeof w.want !== 'number') continue;
          if (Math.abs(got - w.want) <= Math.max(1e-3, Math.abs(w.want) * 1e-3)) continue;
          if (Math.abs(got) < 1e-9 || Math.abs(w.ae[0]) < 1e-12) continue;
          w.ae = [w.ae[0] * (w.want / got)]; patchTdbs(w.tb, w.ae, null, fps, lhd3); fixed++;
        }
        if (!fixed) break;
      }
      report.ok.push(`${label} → ${mn} (${mapped} parâmetros)`);
    } else {
      // sem molde: bloco montado do zero com os parâmetros do mapa de importação
      const ps = [];
      for (const pd of def.params) {
        const m = rule.map?.[pd.key];
        if (!m?.i) continue;
        const val = valueOf(pd);
        const v = invertConv(m.conv, val.keys ? valueAt({ value: pd.default, keys: val.keys }, 0) : val.value, pd.kind);
        if (v === null) continue;
        ps[m.i - 1] = { name: (m.n?.[0] || pd.label), kind: pd.kind, vals: toAE(v, pd.kind, 1) };
      }
      for (let i = 0; i < ps.length; i++) if (!ps[i]) ps[i] = { name: `p${i + 1}`, kind: 'number', vals: [0] };
      sspc = syntheticSspc(mn, label, ps);
      report.approx.push(`${label} → ${mn} (sem molde do AE: pode não abrir)`);
    }
    paths.push(...pathOf(mn, idx++, label));
    blocks.push(sspc);
  }
  if (!blocks.length) return { bytes: null, report };
  void name;
  return { bytes: wrapFile(paths, blocks), report };
}
