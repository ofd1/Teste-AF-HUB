// Rede neural pequena (4 camadas convolucionais) treinada com pares reais "original → Topaz Iris" do usuário.
// Roda na GPU: cada camada vira passadas de shader com os pesos embutidos no código (sem limite de uniforms do iPhone).
// Ativações ocultas ficam em texturas de 16 bits (half-float); sem half-float, são guardadas escaladas em 8 bits.
import { PRELUDE } from '../gl.js';

const SC = 8; // escala das ativações quando a textura é de 8 bits

const f = (x) => { const s = (+x).toPrecision(7); return s.includes('.') || s.includes('e') ? s : `${s}.0`; };

/** Gera o shader de uma passada: 4 canais de saída a partir de todas as texturas de entrada. */
function passShader(layer, nIn, outGroup, { relu, residual, scaleIn, scaleOut }) {
  const { w, b, dil } = layer; // w[co][ci][ky][kx]
  const cin = w[0].length;
  const lines = [];
  for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
    const off = `vec2(${f((kx - 1) * dil)}, ${f((ky - 1) * dil)}) * u_texel`;
    for (let t = 0; t < nIn; t++) {
      const m = [];
      // mat4 em GLSL é por colunas: coluna = canal de entrada, linha = canal de saída
      for (let ci = 0; ci < 4; ci++) for (let r = 0; r < 4; r++) {
        const co = outGroup * 4 + r, cc = t * 4 + ci;
        m.push(co < w.length && cc < cin ? f(w[co][cc][ky][kx]) : '0.0');
      }
      if (m.every((v) => v === '0.0')) continue;
      lines.push(`  o += mat4(${m.join(',')}) * rd${t}(v_uv + ${off});`);
    }
  }
  const bias = [0, 1, 2, 3].map((r) => (outGroup * 4 + r < w.length ? f(b[outGroup * 4 + r]) : '0.0'));
  const samplers = Array.from({ length: nIn }, (_, t) => `uniform sampler2D u_in${t};\nvec4 rd${t}(vec2 p) { ${t === 0 && scaleIn === 'rgb' ? 'vec4 c = unpre(texture2D(u_in0, p)); return vec4(c.rgb, 0.0);' : `return texture2D(u_in${t}, p) * ${f(scaleIn)};`} }`).join('\n');
  const tail = residual
    ? '  vec4 src = unpre(texture2D(u_in0, v_uv));\n  vec3 r = src.rgb + o.rgb * u_mix;\n  gl_FragColor = pre(vec4(clamp(r, 0.0, 1.0), src.a));'
    : `  ${relu ? 'o = max(o, 0.0);' : ''}\n  gl_FragColor = o / ${f(scaleOut)};`;
  return `// @noclamp\n${PRELUDE}\n${samplers}\nuniform float u_mix;\nvoid main() {\n  vec4 o = vec4(${bias.join(',')});\n${lines.join('\n')}\n${tail}\n}`;
}

/** Monta os shaders das camadas ocultas (todas menos a última). Guarda em cache por rede. */
const cache = new WeakMap();
function build(net, half) {
  const key = half ? 'h' : 'b';
  let c = cache.get(net);
  if (!c) { c = {}; cache.set(net, c); }
  if (c[key]) return c[key];
  const sc = half ? 1 : SC;
  const L = net.layers;
  c[key] = L.slice(0, -1).map((layer, li) => {
    const nIn = li === 0 ? 1 : Math.ceil(L[li - 1].w.length / 4);
    const groups = Math.ceil(layer.w.length / 4);
    return Array.from({ length: groups }, (_, g) => passShader(layer, nIn, g, { relu: true, residual: false, scaleIn: li === 0 ? 'rgb' : sc, scaleOut: sc }));
  });
  return c[key];
}

/** Aplica a rede à textura `src` (na escala em que foi treinada). mix = quanto do resíduo aplicar. */
export function runNet(gl, net, src, mix = 1) {
  let acts = [src];
  for (const layer of build(net, !!gl.htype)) {
    const ins = Object.fromEntries(acts.map((t, i) => [`u_in${i}`, t]));
    acts = layer.map((fs) => gl.pass(fs, { u_tex: acts[0], ...ins }));
  }
  const ins = Object.fromEntries(acts.map((t, i) => [`u_in${i}`, t]));
  return gl.pass(lastShader(net, gl), { u_tex: src, u_img: src, u_mix: mix, ...ins });
}

// última camada com a imagem original separada (u_img) das ativações (u_in0..)
const lastCache = new WeakMap();
function lastShader(net, gl) {
  const half = !!gl.htype;
  let c = lastCache.get(net);
  if (!c) { c = {}; lastCache.set(net, c); }
  if (c[half]) return c[half];
  const layer = net.layers[net.layers.length - 1];
  const nIn = Math.ceil(net.layers[net.layers.length - 2].w.length / 4);
  let fs = passShader(layer, nIn, 0, { relu: false, residual: false, scaleIn: half ? 1 : SC, scaleOut: 1 });
  fs = fs.replace('uniform float u_mix;', 'uniform float u_mix; uniform sampler2D u_img;')
    .replace(/gl_FragColor = o \/ 1\.0+;/, 'vec4 src = unpre(texture2D(u_img, v_uv));\n  gl_FragColor = pre(vec4(clamp(src.rgb + o.rgb * u_mix, 0.0, 1.0), src.a));');
  c[half] = fs;
  return fs;
}
