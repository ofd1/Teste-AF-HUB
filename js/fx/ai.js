// Efeitos com IA no aparelho: Remover fundo (vídeo e foto).
import { frag, num, bool, sel, col, rgb } from './common.js';
import { personMask, BG_MODELS } from '../bgremove.js';

// máscara refinada pelas cores da imagem (bilateral conjunta): contorno do jogador mais preciso que a máscara do modelo
const BG = frag(`
uniform sampler2D u_mask, u_bgtex; uniform float u_th, u_feather, u_choke, u_inv, u_mode, u_show; uniform vec3 u_bgcol; uniform vec2 u_mtexel;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 ci = c.rgb / max(c.a, 1e-4);
  float acc = 0.0, ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 uv = v_uv + o * u_mtexel * 0.75;
    vec4 s = texture2D(u_tex, uv);
    vec3 d = s.rgb / max(s.a, 1e-4) - ci;
    float w = exp(-dot(d, d) * 12.0) * exp(-dot(o, o) * 0.25);
    acc += texture2D(u_mask, uv).r * w; ws += w;
  }
  float m = acc / max(ws, 1e-4);
  m = smoothstep(u_th - u_feather - u_choke, u_th + u_feather - u_choke, m);
  if (u_inv > 0.5) m = 1.0 - m;
  if (u_show > 0.5) { gl_FragColor = vec4(vec3(m), 1.0) * c.a; return; }
  vec4 fg = c * m;
  vec4 bg = vec4(0.0);
  if (u_mode > 1.5 && u_mode < 2.5) bg = vec4(u_bgcol, 1.0) * c.a;          // cor
  else if (u_mode > 2.5) bg = texture2D(u_bgtex, v_uv);                     // fundo desfocado (modo retrato)
  gl_FragColor = fg + bg * (1.0 - fg.a);
}`);

export default [
  {
    type: 'bgRemove', label: 'Remover fundo (IA)', category: 'Estilizar', plugin: 'Rotobrush / Roto Brush',
    description: 'Recorta a pessoa do vídeo ou da foto automaticamente, quadro a quadro, no próprio aparelho (nada é enviado para a internet). Na 1ª vez baixa o modelo (~3 MB). Use “Fundo: Desfocado” para o efeito retrato ou coloque outra camada embaixo.',
    params: [
      sel('model', 'Modelo', [BG_MODELS[1].label, BG_MODELS[2].label], 1),
      sel('background', 'Fundo', ['Transparente', 'Cor', 'Desfocado (retrato)'], 1), col('bgColor', 'Cor do fundo', [0, 1, 0, 1]), num('bgBlur', 'Desfoque do fundo', 30, 0, 200),
      num('threshold', 'Limiar %', 50, 1, 99), num('feather', 'Suavizar borda %', 12, 0, 50), num('choke', 'Encolher / expandir', 0, -30, 30),
      num('smooth', 'Estabilidade no tempo %', 40, 0, 90), bool('invert', 'Inverter (remover a pessoa)', false), bool('showMask', 'Ver máscara', false),
    ],
    render: (src, p, env) => {
      const { gl } = env;
      if (!env.srcCanvas) return src;
      const mc = personMask(env.srcCanvas, { model: p.model, key: `${env.layer?.id}|${env.t.toFixed(4)}`, layerKey: env.layer?.id, t: env.t, smooth: p.smooth / 100, fps: env.fps });
      if (!mc) return src; // modelo carregando: mostra o original e redesenha quando ficar pronto
      const mt = gl.upload(mc);
      const bgt = p.background === 3 ? gl.blur(src, Math.max(0.5, p.bgBlur * env.scale)) : src;
      return gl.pass(BG, {
        u_tex: src, u_mask: mt, u_bgtex: bgt, u_th: p.threshold / 100, u_feather: p.feather / 100, u_choke: p.choke / 100,
        u_inv: p.invert, u_mode: p.background, u_show: p.showMask, u_bgcol: rgb(p.bgColor), u_mtexel: [1 / src.w, 1 / src.h],
      });
    },
  },
];
