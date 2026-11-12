// "Criar efeito": o usuário monta um efeito próprio empilhando efeitos do MotionFrame (com os valores que quiser)
// e escolhe quais controles aparecem. Fica salvo em Efeitos › Meus efeitos, funciona como qualquer outro efeito
// (keyframes nos controles expostos, copiar/colar, presets) e pode ser exportado/importado como arquivo .mfx.
import { EFFECTS, EFFECT_MAP, CATEGORIES } from './effects.js';

export const MY_CAT = 'Meus efeitos';
const KEY = 'motionframe.customFx';
const ls = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* armazenamento cheio/bloqueado */ } },
};

/** Efeitos que podem entrar num efeito próprio (os que mexem na imagem ou no movimento da camada). */
export const buildable = () => EFFECTS.filter((d) => (d.render || d.transform) && !d.custom && !d.channelTime && d.type !== 'generic');

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const pkey = (i, k) => `s${i}_${k}`;

/** Definição de efeito a partir da receita salva. */
export function defFromRecipe(r) {
  const steps = r.steps.filter((s) => EFFECT_MAP[s.type]);
  const params = [];
  steps.forEach((s, i) => {
    const d = EFFECT_MAP[s.type];
    for (const k of s.expose || []) {
      const pd = d.params.find((x) => x.key === k); if (!pd) continue;
      const lab = s.labels?.[k] || (steps.length > 1 ? `${pd.label} · ${d.label.replace(/\s*\(.*\)$/, '')}` : pd.label);
      params.push({ ...pd, key: pkey(i, k), label: lab, default: s.values?.[k] !== undefined ? clone(s.values[k]) : clone(pd.default) });
    }
  });
  params.push({ key: 'fxOpacity', label: 'Opacidade do efeito %', kind: 'number', default: 100, min: 0, max: 100, step: 1 });
  // valores de cada etapa no instante: padrão do efeito ← valores da receita ← controles expostos (animáveis)
  const stepParams = (i, p) => {
    const d = EFFECT_MAP[steps[i].type], out = {};
    for (const pd of d.params) out[pd.key] = clone(pd.default);
    Object.assign(out, clone(steps[i].values || {}));
    for (const k of steps[i].expose || []) if (p[pkey(i, k)] !== undefined) out[k] = p[pkey(i, k)];
    return out;
  };
  const hasRender = steps.some((s) => EFFECT_MAP[s.type].render);
  const hasTransform = steps.some((s) => EFFECT_MAP[s.type].transform);
  const def = {
    type: r.type, label: r.name, category: MY_CAT, custom: true, recipe: r,
    description: r.description || `Efeito criado por você: ${steps.map((s) => EFFECT_MAP[s.type].label).join(' → ')}.`,
    params,
    pad: (p, ctx) => steps.reduce((n, s, i) => n + (EFFECT_MAP[s.type].pad ? Math.max(0, EFFECT_MAP[s.type].pad(stepParams(i, p), ctx) || 0) : 0), 0),
  };
  if (hasRender) {
    def.render = (src, p, env) => {
      const { gl } = env;
      let tex = src;
      steps.forEach((s, i) => {
        const d = EFFECT_MAP[s.type]; if (!d.render) return;
        const sp = stepParams(i, p);
        const paramsAt = (tt) => stepParams(i, env.paramsAt ? env.paramsAt(tt) : p);
        const input = tex;
        try {
          tex = d.render(input, sp, { ...env, paramsAt }, d.usesPrev ? stepParams(i, env.paramsAt ? env.paramsAt(env.t - (sp.shutter ?? 1) / (env.fps || 30)) : p) : null) || input;
          const op = sp.fxOpacity ?? 100;
          if (op < 99.95 && tex !== input) tex = gl.mix(input, tex, Math.max(0, op) / 100);
          if (tex !== input && input !== src && !d.keepInput) gl.release(input);
        } catch (e) { console.warn('etapa do efeito falhou', s.type, e); tex = input; }
      });
      return tex;
    };
  }
  if (hasTransform) {
    def.transform = (p, ctx) => {
      const o = { dx: 0, dy: 0, rot: 0, scale: 1, opacity: 1 };
      steps.forEach((s, i) => {
        const d = EFFECT_MAP[s.type]; if (!d.transform) return;
        const r2 = d.transform(stepParams(i, p), ctx) || {};
        o.dx += r2.dx || 0; o.dy += r2.dy || 0; o.rot += r2.rot || 0; o.scale *= r2.scale ?? 1; o.opacity *= r2.opacity ?? 1;
      });
      return o;
    };
  }
  return def;
}

function register(r) {
  const def = defFromRecipe(r);
  const i = EFFECTS.findIndex((d) => d.type === r.type);
  if (i >= 0) EFFECTS[i] = def; else EFFECTS.push(def);
  EFFECT_MAP[r.type] = def;
  return def;
}

export function customRecipes() { return ls.get(); }

/** Registra os efeitos próprios salvos (chamado na abertura do app, antes de abrir projetos). */
export function loadCustomEffects() {
  if (!CATEGORIES.includes(MY_CAT)) CATEGORIES.splice(0, 0, MY_CAT);
  for (const r of ls.get()) { try { register(r); } catch (e) { console.warn('efeito próprio inválido', r?.name, e); } }
}

export function saveCustomEffect(r) {
  if (!r.type) r.type = `cfx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const all = ls.get().filter((x) => x.type !== r.type);
  all.push(r); ls.set(all);
  register(r);
  window.dispatchEvent(new CustomEvent('custom-fx-changed'));
  return r;
}

export function deleteCustomEffect(type) {
  ls.set(ls.get().filter((x) => x.type !== type));
  // fica registrado até recarregar (projetos abertos que já usam continuam renderizando)
  const i = EFFECTS.findIndex((d) => d.type === type); if (i >= 0) EFFECTS.splice(i, 1);
  window.dispatchEvent(new CustomEvent('custom-fx-changed'));
}

/** Arquivo .mfx para compartilhar (receita + nome). */
export function exportRecipe(r) { return new Blob([JSON.stringify({ motionframeEffect: 1, ...r }, null, 1)], { type: 'application/json' }); }
export async function importRecipe(file) {
  const r = JSON.parse(await file.text());
  if (!r.motionframeEffect || !Array.isArray(r.steps)) throw new Error('não é um efeito do MotionFrame (.mfx)');
  delete r.motionframeEffect;
  const missing = r.steps.filter((s) => !EFFECT_MAP[s.type]).map((s) => s.type);
  if (missing.length === r.steps.length) throw new Error('usa efeitos que esta versão não tem');
  r.type = undefined; // novo id (não sobrescreve um efeito existente)
  return saveCustomEffect(r);
}

/** Projetos guardam a receita junto do efeito: abrem em outro aparelho mesmo sem o efeito salvo lá. */
export function ensureRecipesFromProject(project) {
  const walk = (ls2) => { for (const l of ls2 || []) { for (const fx of l.effects || []) if (fx.recipe && !EFFECT_MAP[fx.type]) register(fx.recipe); walk(l.props?.layers); } };
  walk(project?.layers);
}
