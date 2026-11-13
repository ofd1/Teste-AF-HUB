// Modelos 3D importados para o Element 3D: OBJ (+ MTL), GLB e glTF embutido.
// O arquivo fica no IndexedDB (como os vídeos) e o efeito guarda só o id. Aqui ele vira uma malha
// intercalada [posição xyz, normal xyz, uv] já centralizada e normalizada (maior lado = 1).
import { putMedia, getMedia } from './idb.js';
import { uid } from './util.js';

const MAX_TRIS = 400000;
const models = new Map(); // id → { status, geom, texUrl, name, tris, error }
let listener = () => {};
export function setModelListener(fn) { listener = fn; }

/** Malha pronta para desenhar (ou null enquanto carrega — dispara o carregamento). */
export function getModel(id) {
  if (!id) return null;
  let m = models.get(id);
  if (!m) {
    m = { status: 'loading' };
    models.set(id, m);
    getMedia(id).then(async (blob) => {
      if (!blob) { m.status = 'missing'; listener(); return; }
      Object.assign(m, await parseModelBlob(blob, blob.name || ''), { status: 'ready' });
      listener();
    }).catch((e) => { m.status = 'error'; m.error = String(e?.message || e); listener(); });
  }
  return m.status === 'ready' ? m : null;
}
export function modelInfo(id) { return models.get(id) || null; }

/** Importa arquivos escolhidos pelo usuário (modelo + texturas/MTL opcionais). → { modelId, texId, info } */
export async function importModelFiles(files) {
  const list = [...files];
  const mf = list.find((f) => /\.(obj|glb|gltf)$/i.test(f.name));
  const img = list.find((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name));
  let modelId = null, texId = null, info = null;
  if (mf) {
    const mtl = list.find((f) => /\.mtl$/i.test(f.name));
    const blob = new Blob([mf], { type: mf.type || 'model/' + mf.name.split('.').pop() });
    const parsed = await parseModelBlob(blob, mf.name, mtl ? await mtl.text() : null);
    modelId = uid('m3d');
    const stored = new File([mf], mf.name, { type: blob.type });
    putMedia(modelId, stored);
    models.set(modelId, { ...parsed, status: 'ready' });
    info = parsed;
    if (parsed.texBlob && !img) { texId = uid('tex'); putMedia(texId, parsed.texBlob); }
  }
  if (img) { texId = uid('tex'); putMedia(texId, img); }
  return { modelId, texId, info };
}

// --------------------------------------------------------------- texturas
const texUrls = new Map(); // texId → objectURL (ou null enquanto carrega)
export function textureUrl(id) {
  if (!id) return null;
  if (texUrls.has(id)) return texUrls.get(id);
  texUrls.set(id, null);
  getMedia(id).then((b) => { if (b) { texUrls.set(id, URL.createObjectURL(b)); listener(); } }).catch(() => {});
  return null;
}

// --------------------------------------------------------------- leitura
async function parseModelBlob(blob, name = '', mtlText = null) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isGLB = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46; // "glTF"
  if (isGLB) return parseGLB(await blob.arrayBuffer(), name);
  const text = await blob.text();
  if (ext === 'gltf' || text.trimStart().startsWith('{')) return parseGLTF(JSON.parse(text), null, name);
  return parseOBJ(text, name, mtlText);
}

/** Normaliza a malha (centro na origem, maior lado = 1) e calcula normais faltando. tri = [ax,ay,az, …9] */
function finish(pos, nrm, uv, name, extra = {}) {
  const n = pos.length / 3;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2), s = 1 / Math.max(1e-9, mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const data = new Float32Array(n * 8);
  for (let t = 0; t < n; t += 3) {
    // normal da face (para quando o arquivo não traz normais)
    const p = (i, k) => pos[(t + i) * 3 + k];
    const e1 = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)], e2 = [p(2, 0) - p(0, 0), p(2, 1) - p(0, 1), p(2, 2) - p(0, 2)];
    let fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = Math.hypot(...fn) || 1; fn = fn.map((v) => v / L);
    for (let i = 0; i < 3; i++) {
      const o = (t + i) * 8, vi = t + i;
      for (let k = 0; k < 3; k++) data[o + k] = (pos[vi * 3 + k] - c[k]) * s;
      const hasN = nrm && (nrm[vi * 3] || nrm[vi * 3 + 1] || nrm[vi * 3 + 2]);
      for (let k = 0; k < 3; k++) data[o + 3 + k] = hasN ? nrm[vi * 3 + k] : fn[k];
      data[o + 6] = uv ? uv[vi * 2] : 0; data[o + 7] = uv ? uv[vi * 2 + 1] : 0;
    }
  }
  return { name, geom: data, tris: n / 3, size: [(mx[0] - mn[0]) * s, (mx[1] - mn[1]) * s, (mx[2] - mn[2]) * s], hasUV: !!uv, ...extra };
}

export function parseOBJ(text, name = 'modelo.obj', mtlText = null) {
  const V = [], VT = [], VN = [];
  const pos = [], nrm = [], uv = [];
  let hasVT = false;
  const idx = (s, len) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === 'v') V.push(+parts[1], +parts[2], +parts[3]);
    else if (tag === 'vt') VT.push(+parts[1], +(parts[2] ?? 0));
    else if (tag === 'vn') VN.push(+parts[1], +parts[2], +parts[3]);
    else if (tag === 'f') {
      const vs = parts.slice(1).map((p) => p.split('/'));
      for (let i = 1; i + 1 < vs.length; i++) {
        for (const w of [vs[0], vs[i], vs[i + 1]]) {
          const a = idx(w[0], V.length / 3);
          pos.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2]);
          if (w[1]) { const b = idx(w[1], VT.length / 2); uv.push(VT[b * 2] ?? 0, 1 - (VT[b * 2 + 1] ?? 0)); hasVT = true; } else uv.push(0, 0);
          if (w[2]) { const c = idx(w[2], VN.length / 3); nrm.push(VN[c * 3] ?? 0, VN[c * 3 + 1] ?? 0, VN[c * 3 + 2] ?? 0); } else nrm.push(0, 0, 0);
        }
        if (pos.length / 9 >= MAX_TRIS) break;
      }
    }
  }
  if (!pos.length) throw new Error('OBJ sem faces');
  let color = null;
  const kd = mtlText?.match(/^\s*Kd\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/m);
  if (kd) color = [+kd[1], +kd[2], +kd[3]];
  return finish(pos, nrm, hasVT ? uv : null, name, { color });
}

// --------------------------------------------------------------- glTF / GLB
function parseGLB(buf, name) {
  const dv = new DataView(buf);
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB inválido');
  return parseGLTF(json, bin, name);
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGLTF(json, bin, name) {
  const buffers = (json.buffers || []).map((b, i) => {
    if (!b.uri) return i === 0 ? bin : null;
    const m = b.uri.match(/^data:.*?;base64,(.*)$/);
    if (!m) throw new Error('glTF com arquivos externos: exporte como .glb (tudo num arquivo só)');
    const s = atob(m[1]); const u = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k);
    return u.buffer;
  });
  const view = (bvi) => { const bv = json.bufferViews[bvi]; return { buf: buffers[bv.buffer], off: bv.byteOffset || 0, len: bv.byteLength, stride: bv.byteStride || 0 }; };
  const read = (ai) => {
    const a = json.accessors[ai];
    const nc = NCOMP[a.type], [T, sz] = COMP[a.componentType];
    const out = new Float32Array(a.count * nc);
    if (a.bufferView == null) return out;
    const v = view(a.bufferView);
    const stride = v.stride || nc * sz;
    const dv = new DataView(v.buf, v.off + (a.byteOffset || 0));
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] || 1 : 1;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) out[i * nc + k] = dv[get](i * stride + k * sz, true) / norm;
    void T;
    return out;
  };
  const mul = (A, B) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [tx, ty, tz] = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
      (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
      (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const pos = [], nrm = [], uv = [];
  let hasUV = false, matIndex = null;
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const M = mul(parent, trs(n));
    if (n.mesh != null) {
      for (const pr of json.meshes[n.mesh].primitives || []) {
        if (pr.mode != null && pr.mode !== 4) continue; // só triângulos
        const P = read(pr.attributes.POSITION), N = pr.attributes.NORMAL != null ? read(pr.attributes.NORMAL) : null, T = pr.attributes.TEXCOORD_0 != null ? read(pr.attributes.TEXCOORD_0) : null;
        if (T) hasUV = true;
        if (matIndex == null && pr.material != null) matIndex = pr.material;
        const I = pr.indices != null ? read(pr.indices) : null;
        const cnt = I ? I.length : P.length / 3;
        for (let k = 0; k < cnt; k++) {
          const i = I ? I[k] : k;
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
          pos.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
          if (N) { const a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2]; const nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c; const L = Math.hypot(nx, ny, nz) || 1; nrm.push(nx / L, ny / L, nz / L); } else nrm.push(0, 0, 0);
          uv.push(T ? T[i * 2] : 0, T ? T[i * 2 + 1] : 0);
          if (pos.length / 9 >= MAX_TRIS) return;
        }
      }
    }
    for (const c of n.children || []) visit(c, M);
  };
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene || 0];
  const roots = scene?.nodes || (json.nodes || []).map((_, i) => i);
  roots.forEach((r) => visit(r, I4));
  if (!pos.length) throw new Error('modelo sem triângulos');
  // material: cor base + textura embutida
  let color = null, texBlob = null;
  const mat = json.materials?.[matIndex ?? 0];
  const pbr = mat?.pbrMetallicRoughness;
  if (pbr?.baseColorFactor) color = pbr.baseColorFactor.slice(0, 3);
  const ti = pbr?.baseColorTexture?.index;
  if (ti != null) {
    const img = json.images?.[json.textures?.[ti]?.source];
    if (img?.bufferView != null) { const v = view(img.bufferView); texBlob = new Blob([new Uint8Array(v.buf, v.off, v.len)], { type: img.mimeType || 'image/png' }); }
    else if (img?.uri?.startsWith('data:')) texBlob = dataUrlBlob(img.uri);
  }
  return finish(pos, nrm, hasUV ? uv : null, name, { color, texBlob });
}

function dataUrlBlob(u) {
  const [h, d] = u.split(','); const s = atob(d); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return new Blob([a], { type: h.slice(5).split(';')[0] });
}
