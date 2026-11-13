// Tela "Criar efeito": empilha efeitos, ajusta os valores, marca quais controles aparecem no efeito final e vê a prévia.
import { EFFECT_MAP, CATEGORIES } from './effects.js';
import { buildable, defFromRecipe, saveCustomEffect, deleteCustomEffect, exportRecipe, MY_CAT } from './custom-fx.js';
import { modal, toast } from './ui.js';
import { escapeHtml } from './util.js';
import { fxMatch } from './i18n.js';

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round((c?.[i] ?? 1) * 255).toString(16).padStart(2, '0')).join('');
const unhex = (h, a = 1) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).concat([a]);
// controles que já aparecem em todo efeito ou que não fazem sentido na tela de montagem
const SKIP = new Set(['fxOpacity']);

/**
 * Abre o criador. opts.recipe = editar um efeito próprio; opts.layer = camada para a prévia (e para "usar os efeitos desta camada");
 * opts.render(ctx, layerClone, t) desenha a prévia. Devolve a receita salva (ou null).
 */
export async function createEffectDialog({ recipe = null, layer = null, renderPreview = null } = {}) {
  const r = recipe ? clone(recipe) : { name: '', steps: [] };
  let adding = !r.steps.length, q = '', cat = 'Todos';
  const fromLayer = () => (layer?.effects || []).filter((fx) => fx.enabled && EFFECT_MAP[fx.type] && !EFFECT_MAP[fx.type].custom && (EFFECT_MAP[fx.type].render || EFFECT_MAP[fx.type].transform))
    .map((fx) => ({ type: fx.type, values: Object.fromEntries(Object.entries(fx.params).map(([k, p]) => [k, clone(p.value)])), expose: [] }));

  const paramRow = (si, pd) => {
    const s = r.steps[si];
    const v = s.values?.[pd.key] !== undefined ? s.values[pd.key] : pd.default;
    const on = (s.expose || []).includes(pd.key);
    let input;
    if (pd.kind === 'bool') input = `<input type="checkbox" data-v="${si}|${pd.key}" ${v ? 'checked' : ''}>`;
    else if (pd.kind === 'color') input = `<input type="color" data-v="${si}|${pd.key}" value="${hex(v)}">`;
    else if (pd.kind === 'select') input = `<select data-v="${si}|${pd.key}">${pd.options.map((o, i) => `<option value="${i + 1}" ${+v === i + 1 ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
    else if (pd.kind === 'number' || pd.kind === 'angle' || pd.kind == null) {
      const mn = pd.min ?? (pd.kind === 'angle' ? -360 : -1000), mx = pd.max ?? (pd.kind === 'angle' ? 360 : 1000);
      input = `<input type="range" data-v="${si}|${pd.key}" min="${mn}" max="${mx}" step="${pd.step || 0.01}" value="${+v || 0}"><output>${+(+v || 0).toFixed(2)}</output>`;
    } else return ''; // posição/ponto/texto: ficam no padrão e podem ser expostos para ajustar na camada
    return `<div class="cfx-row"><label class="cfx-l">${escapeHtml(pd.label)}</label><span class="cfx-in">${input}</span>
      <label class="cfx-ex" title="Mostrar este controle no efeito pronto (dá para animar com keyframes)"><input type="checkbox" data-x="${si}|${pd.key}" ${on ? 'checked' : ''}> controle</label></div>`;
  };
  const posRows = (si) => EFFECT_MAP[r.steps[si].type].params.filter((pd) => !SKIP.has(pd.key) && !['number', 'angle', 'bool', 'color', 'select', undefined].includes(pd.kind) && pd.kind !== 'hidden')
    .map((pd) => `<div class="cfx-row"><label class="cfx-l">${escapeHtml(pd.label)}</label><span class="cfx-in muted small">ajuste na prévia depois</span>
      <label class="cfx-ex"><input type="checkbox" data-x="${si}|${pd.key}" ${(r.steps[si].expose || []).includes(pd.key) ? 'checked' : ''}> controle</label></div>`).join('');

  const html = () => {
    const list = adding ? buildable().filter((d) => (cat === 'Todos' || d.category === cat) && fxMatch(d, q)).slice(0, 120) : [];
    return `
    <div class="cfx">
      <div class="cfx-top">
        <input class="cfx-name" placeholder="Nome do efeito (ex.: Meu Glow Tremido)" value="${escapeHtml(r.name)}" maxlength="40">
        <canvas class="cfx-pv" width="320" height="180"></canvas>
      </div>
      <p class="muted small" style="margin:6px 0">Empilhe efeitos (de cima para baixo), ajuste os valores e marque <b>controle</b> no que quiser mexer depois.
        O efeito pronto aparece em Efeitos › ${MY_CAT}.</p>
      ${r.steps.map((s, i) => { const d = EFFECT_MAP[s.type]; if (!d) return '';
        return `<div class="cfx-step"><header><b>${i + 1}. ${escapeHtml(d.label)}</b><span>
          <button data-up="${i}" ${i ? '' : 'disabled'} title="Subir">↑</button><button data-down="${i}" ${i < r.steps.length - 1 ? '' : 'disabled'} title="Descer">↓</button><button data-rm="${i}" title="Tirar">✕</button></span></header>
          ${d.params.filter((pd) => !SKIP.has(pd.key) && pd.kind !== 'hidden').map((pd) => paramRow(i, pd)).join('')}${posRows(i)}</div>`; }).join('')}
      ${adding ? `<div class="cfx-add">
          <input type="search" class="cfx-q" placeholder="Buscar efeito para adicionar…" value="${escapeHtml(q)}">
          <div class="chips">${['Todos', ...CATEGORIES.filter((c) => c !== MY_CAT)].map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>
          <div class="cfx-list">${list.map((d) => `<button data-add="${d.type}">${escapeHtml(d.label)}<small class="muted"> ${escapeHtml(d.category)}</small></button>`).join('')}</div>
        </div>` : `<div class="cfx-actions"><button class="primary" data-addmode>＋ Adicionar efeito</button>
          ${fromLayer().length && !r.steps.length ? '' : ''}</div>`}
      ${fromLayer().length ? `<button class="cfx-from" data-from>⤵ Usar os ${fromLayer().length} efeito(s) da camada selecionada</button>` : ''}
    </div>`;
  };

  let wrapEl = null, raf = 0;
  const preview = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const c = wrapEl?.querySelector('.cfx-pv'); if (!c || !renderPreview) return;
      const g = c.getContext('2d');
      try {
        const tmp = { ...r, type: '__cfx_preview', name: r.name || 'prévia' };
        const def = defFromRecipe(tmp);
        EFFECT_MAP.__cfx_preview = def;
        renderPreview(g, c, r.steps.length ? def : null);
      } catch (e) { console.warn('prévia do efeito', e); }
    });
  };
  const rerender = () => {
    const body = wrapEl.querySelector('.modal-body'), st = body.scrollTop;
    body.innerHTML = html(); bind(); body.scrollTop = st; preview();
  };
  const bind = () => {
    const w = wrapEl;
    w.querySelector('.cfx-name').addEventListener('input', (e) => { r.name = e.target.value; });
    w.querySelectorAll('[data-v]').forEach((el) => el.addEventListener('input', () => {
      const [si, k] = el.dataset.v.split('|'); const s = r.steps[+si]; s.values = s.values || {};
      const pd = EFFECT_MAP[s.type].params.find((x) => x.key === k);
      s.values[k] = el.type === 'checkbox' ? el.checked : el.type === 'color' ? unhex(el.value, (s.values[k] || pd.default || [])[3] ?? 1) : +el.value;
      const o = el.parentElement.querySelector('output'); if (o) o.textContent = +(+el.value).toFixed(2);
      preview();
    }));
    w.querySelectorAll('[data-x]').forEach((el) => el.addEventListener('change', () => {
      const [si, k] = el.dataset.x.split('|'); const s = r.steps[+si];
      s.expose = (s.expose || []).filter((x) => x !== k); if (el.checked) s.expose.push(k);
    }));
    w.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { r.steps.splice(+b.dataset.rm, 1); rerender(); }));
    w.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.up; [r.steps[i - 1], r.steps[i]] = [r.steps[i], r.steps[i - 1]]; rerender(); }));
    w.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.down; [r.steps[i + 1], r.steps[i]] = [r.steps[i], r.steps[i + 1]]; rerender(); }));
    w.querySelector('[data-addmode]')?.addEventListener('click', () => { adding = true; rerender(); w.querySelector('.cfx-q')?.focus(); });
    w.querySelector('[data-from]')?.addEventListener('click', () => { r.steps.push(...fromLayer()); if (!r.name && layer) r.name = `${layer.name} FX`.slice(0, 40); adding = false; rerender(); });
    const qs = w.querySelector('.cfx-q');
    qs?.addEventListener('input', () => { q = qs.value; rerender(); const n = w.querySelector('.cfx-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    w.querySelectorAll('.cfx-add [data-cat]').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; rerender(); }));
    w.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const d = EFFECT_MAP[b.dataset.add];
      // já vem com os 2 primeiros controles numéricos marcados (dá para desmarcar)
      const expose = d.params.filter((pd) => pd.kind === 'number' && !SKIP.has(pd.key)).slice(0, 2).map((pd) => pd.key);
      r.steps.push({ type: d.type, values: {}, expose }); adding = false; q = ''; rerender();
    }));
  };

  const buttons = [
    ...(recipe ? [{ label: 'Apagar', danger: true, value: 'delete' }, { label: 'Exportar .mfx', value: 'export' }] : []),
    { label: 'Cancelar', value: null },
    { label: recipe ? 'Salvar' : 'Criar efeito', primary: true, value: 'save' },
  ];
  for (;;) {
    const res = await modal(recipe ? `Editar “${recipe.name}”` : 'Criar efeito', html(), buttons, { wide: true, onMount: (w) => { wrapEl = w; w.classList.add('cfx-modal'); bind(); preview(); } });
    delete EFFECT_MAP.__cfx_preview;
    if (res === 'delete') { deleteCustomEffect(recipe.type); toast(`“${recipe.name}” apagado.`, 'ok'); return null; }
    if (res === 'export') return { export: exportRecipe(recipe), name: recipe.name };
    if (res !== 'save') return null;
    if (!r.steps.length) { toast('Adicione pelo menos um efeito.', 'warn'); continue; }
    if (!r.name.trim()) r.name = `Efeito ${new Date().toLocaleDateString()}`;
    r.name = r.name.trim();
    const saved = saveCustomEffect(r);
    toast(`Efeito “${saved.name}” ${recipe ? 'salvo' : 'criado'} em Efeitos › ${MY_CAT} ✓`, 'ok', 4000);
    return saved;
  }
}
