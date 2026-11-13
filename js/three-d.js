// Camadas 3D e câmera (como no After Effects): x para a direita, y para baixo, z para dentro da tela.
// Matriz da camada = T(posição xyz) · Orientação · Rx · Ry · Rz · S · T(−âncora); a câmera projeta com
// tela = centro + X·zoom / Z (zoom em px, como o "Zoom" da câmera do AE).
import { valueAt } from './anim.js';

const V = (p, t, d) => (p == null ? d : valueAt(p, t) ?? d);

// ---- matrizes 4×4 (coluna-maior, como no WebGL)
export const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const RX = (d) => { const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const RY = (d) => { const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const RZ = (d) => { const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
export const apply = (m, p) => {
  const x = p[0], y = p[1], z = p[2] ?? 0;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
};
export function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return I4();
  det = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}

/** Rotações extras de uma camada 3D: orientação (xyz) e rotação X/Y; Z é a rotação normal. */
function rot3(tr, t, rz) {
  const o = V(tr.orientation, t, [0, 0, 0]);
  return mul(mul(mul(RX(o[0] || 0), RY(o[1] || 0)), RZ(o[2] || 0)), mul(mul(RX(V(tr.rotX, t, 0)), RY(V(tr.rotY, t, 0))), RZ(rz)));
}

/**
 * Matriz local de uma camada (conteúdo com origem no canto superior esquerdo → espaço do pai).
 * m = layerTransform (posição/escala/rotação já com efeitos de movimento); size = tamanho do conteúdo.
 */
export function localMatrix(layer, m, size, t) {
  const tr = layer.transform;
  const z = layer.threeD ? V(tr.posZ, t, 0) : 0;
  const R = layer.threeD ? rot3(tr, t, m.rot) : RZ(m.rot);
  const sz = layer.threeD ? V(tr.scaleZ, t, 100) / 100 : 1;
  return mul(mul(mul(T(m.x, m.y, z), R), S(m.sx, m.sy, sz)), T(-(size.w / 2 + m.anchor[0]), -(size.h / 2 + m.anchor[1]), -(layer.threeD ? V(tr.anchorZ, t, 0) : 0)));
}

/** Zoom padrão do AE (câmera de 50 mm, filme de 36 mm na horizontal). */
export const defaultZoom = (W) => (W * 50) / 36;

/**
 * Câmera ativa: matriz de visão (mundo → câmera), zoom e profundidade de campo.
 * worldOf(layer) devolve a matriz de mundo do pai (para câmeras com pai — ex.: Null de órbita).
 */
export function cameraFor(cam, W, H, t, parentWorld) {
  if (!cam) {
    const zoom = defaultZoom(W);
    return { view: invert(T(W / 2, H / 2, -zoom)), zoom, dof: false, W, H };
  }
  const tr = cam.transform;
  const p = V(tr.position, t, [W / 2, H / 2]);
  const z = V(tr.posZ, t, -defaultZoom(W));
  let R = rot3(tr, t, V(tr.rotation, t, 0));
  if (cam.props?.twoNode !== false) {
    // câmera de dois nós: aponta para o Ponto de Interesse
    const poi = V(tr.poi, t, [W / 2, H / 2]), pz = V(tr.poiZ, t, 0);
    let f = [poi[0] - p[0], poi[1] - p[1], pz - z];
    const fl = Math.hypot(...f) || 1; f = f.map((x) => x / fl);
    let x = [f[2], 0, -f[0]]; // cross((0,1,0), f)
    const xl = Math.hypot(...x);
    x = xl < 1e-6 ? [1, 0, 0] : x.map((v) => v / xl);
    const y = [f[1] * x[2] - f[2] * x[1], f[2] * x[0] - f[0] * x[2], f[0] * x[1] - f[1] * x[0]];
    const look = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, f[0], f[1], f[2], 0, 0, 0, 0, 1];
    R = mul(look, R);
  }
  let world = mul(T(p[0], p[1], z), R);
  if (parentWorld) world = mul(parentWorld, world);
  return {
    view: invert(world), world, zoom: Math.max(1, V(tr.zoom, t, defaultZoom(W))), W, H,
    dof: !!cam.props?.dof, focus: V(tr.focusDist, t, defaultZoom(W)), aperture: V(tr.aperture, t, 25), blurLevel: V(tr.blurLevel, t, 100),
  };
}

/** Projeta um ponto do mundo: { x, y } na composição e Z (distância à frente da câmera). */
export function project(cam, wp) {
  const c = apply(cam.view, wp);
  const Z = c[2];
  return { x: cam.W / 2 + (c[0] * cam.zoom) / Z, y: cam.H / 2 + (c[1] * cam.zoom) / Z, Z, c };
}

/** Desfoque da profundidade de campo (px na composição) para um ponto a distância Z da câmera. */
export function dofBlur(cam, Z) {
  if (!cam.dof) return 0;
  // círculo de confusão ~ abertura × |Z − foco| / Z (como uma lente fina); Blur Level escala
  return Math.min(80, ((cam.aperture * Math.abs(Z - cam.focus)) / Math.max(1, Z)) * (cam.blurLevel / 100) * 0.5);
}

/** Liga/desliga a camada 3D (cria as propriedades Z e rotação X/Y se ainda não existirem). */
export function setThreeD(layer, on, makeAnim) {
  layer.threeD = !!on;
  if (!on) return;
  const tr = layer.transform;
  for (const [k, v] of [['posZ', 0], ['rotX', 0], ['rotY', 0]]) if (!tr[k]) tr[k] = makeAnim(v);
}

/** Movimentos de câmera prontos (mograph): keyframes a partir de t0 por `dur` segundos. */
export function cameraMove(cam, kind, t0, dur, W, H, makeKey) {
  const tr = cam.transform, z0 = valueAt(tr.posZ, t0) ?? -defaultZoom(W), p0 = valueAt(tr.position, t0) ?? [W / 2, H / 2];
  const set = (prop, keys) => { tr[prop].keys = (tr[prop].keys || []).filter((k) => k.t < t0 - 1e-4 || k.t > t0 + dur + 1e-4).concat(keys.map(([dt, v]) => makeKey(t0 + dt, v))).sort((a, b) => a.t - b.t); };
  const r = Math.abs(z0);
  switch (kind) {
    case 'push': set('posZ', [[0, z0], [dur, z0 * 0.45]]); break; // aproxima
    case 'pull': set('posZ', [[0, z0 * 0.45], [dur, z0]]); break; // afasta
    case 'orbit': { // gira em volta do ponto de interesse
      const poi = valueAt(tr.poi, t0) ?? [W / 2, H / 2], n = 8, keysX = [], keysZ = [];
      for (let i = 0; i <= n; i++) { const a = (-0.5 + i / n) * Math.PI * 0.9; keysX.push([(dur * i) / n, [Math.round(poi[0] + Math.sin(a) * r), p0[1]]]); keysZ.push([(dur * i) / n, Math.round(-Math.cos(a) * r)]); }
      set('position', keysX); set('posZ', keysZ); break;
    }
    case 'dolly': set('position', [[0, [p0[0] - W * 0.35, p0[1]]], [dur, [p0[0] + W * 0.35, p0[1]]]]); if (cam.props) cam.props.twoNode = false; break; // trilho lateral
    case 'crane': set('position', [[0, [p0[0], p0[1] + H * 0.35]], [dur, [p0[0], p0[1] - H * 0.35]]]); break; // sobe olhando para o centro
    case 'roll': set('rotation', [[0, -12], [dur, 12]]); break;
    default: break;
  }
}
