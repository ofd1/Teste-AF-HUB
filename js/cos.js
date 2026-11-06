// Leitor do formato "COS" (parecido com PDF) usado pelo After Effects para documentos de texto (chunk 'btdk').
// << /chave valor >> = dicionário, [ … ] = lista, ( … ) = string (UTF-16BE com BOM FEFF), /nome, números, true/false.

export function parseCOS(bytes) {
  let i = 0;
  const n = bytes.length;
  const ws = () => { while (i < n && (bytes[i] <= 32)) i++; };
  const str = () => {
    i++; // (
    const out = [];
    let depth = 1;
    while (i < n) {
      let c = bytes[i++];
      if (c === 0x5c) { // escape
        const e = bytes[i++];
        if (e === 0x6e) c = 10; else if (e === 0x72) c = 13; else if (e === 0x74) c = 9; else c = e;
        out.push(c); continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29 && --depth === 0) break;
      out.push(c);
    }
    if (out[0] === 0xfe && out[1] === 0xff) {
      let s = '';
      for (let k = 2; k + 1 < out.length; k += 2) s += String.fromCharCode((out[k] << 8) | out[k + 1]);
      return s;
    }
    return String.fromCharCode(...out);
  };
  const token = () => {
    const s = i;
    while (i < n && bytes[i] > 32 && !'<>[]()/'.includes(String.fromCharCode(bytes[i]))) i++;
    return String.fromCharCode(...bytes.subarray(s, i));
  };
  const value = () => {
    ws();
    const c = bytes[i];
    if (c === 0x3c && bytes[i + 1] === 0x3c) { // <<
      i += 2;
      const d = {};
      for (;;) {
        ws();
        if (i >= n) return d;
        if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { i += 2; return d; }
        if (bytes[i] !== 0x2f) { i++; continue; }
        i++;
        const key = token();
        d[key] = value();
      }
    }
    if (c === 0x5b) { // [
      i++;
      const a = [];
      for (;;) {
        ws();
        if (i >= n) return a;
        if (bytes[i] === 0x5d) { i++; return a; }
        a.push(value());
      }
    }
    if (c === 0x28) return str();
    if (c === 0x2f) { i++; return '/' + token(); }
    const t = token();
    if (t === '') { i++; return null; }
    if (t === 'true') return true;
    if (t === 'false') return false;
    const num = Number(t);
    return Number.isFinite(num) ? num : t;
  };
  // o documento é uma sequência de pares /chave valor no nível de cima
  const root = {};
  while (i < n) {
    ws();
    if (bytes[i] === 0x2f) { i++; const k = token(); root[k] = value(); } else if (i < n) i++;
  }
  return root;
}

const g = (o, ...keys) => { for (const k of keys) { if (o == null) return undefined; o = o[k]; } return o; };

/** Texto, fonte, tamanho, cor e alinhamento do primeiro documento de texto. */
export function textFromCOS(cos) {
  const fonts = (g(cos, '0', '1', '0') || []).map((f) => g(f, '0', '0', '0')).filter(Boolean);
  const docs = g(cos, '1', '1') || [];
  const doc = docs[0];
  if (!doc) return null;
  const text = String(g(doc, '0', '0') ?? '').replace(/\r/g, '\n').replace(/\n$/, '');
  const ch = g(doc, '0', '6', '0', 0, '0', '0', '6') || {};
  const para = g(doc, '0', '5', '0', 0, '0', '0', '5') || {};
  const fill = g(ch, '53', '0', '1');
  const stroke = g(ch, '54', '0', '1');
  const fontName = fonts[ch['0'] ?? 0] || fonts[0] || '';
  return {
    text,
    font: fontName,
    size: Number(ch['1']) || 0,
    tracking: Number(ch['5']) || 0,
    color: Array.isArray(fill) && fill.length >= 4 ? fill.slice(1, 4) : Array.isArray(fill) ? fill.slice(0, 3) : null,
    strokeColor: Array.isArray(stroke) && stroke.length >= 4 ? stroke.slice(1, 4) : null,
    strokeWidth: Number(ch['63']) || 0,
    applyStroke: ch['57'] === true || ch['58'] === false,
    justify: Number(para['0']) || 0, // 0 esquerda, 1 direita, 2 centro
  };
}
