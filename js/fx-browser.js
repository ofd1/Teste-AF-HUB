// Navegador de efeitos (grade com busca e categorias) + aba "Meus plugins (.aex)".
import { EFFECTS, CATEGORIES, getEffectDef } from './effects.js';
import { escapeHtml } from './util.js';
import { ico } from './icons.js';
import { fxMatch } from './i18n.js';
import { installedPlugins, allPlugins, importAexFiles, removePlugin, clearPlugins } from './plugins-installed.js';
import { toast, modal } from './ui.js';
import { PANEL_PLUGINS } from './composer.js';
import { MY_CAT } from './custom-fx.js';

const ICON = {
  'Looks · Subject': 'adjust', 'Looks · Matte': 'matte', 'Looks · Lens': 'lens', 'Looks · Camera': 'camera', 'Looks · Post': 'sparkle',
  'Luz e brilho': 'sun', Movimento: 'wave', Tempo: 'speed', Desfoque: 'blur', Estilizar: 'effects', Distorção: 'distort', Cor: 'color', '3D': 'cube', Transições: 'transition', 'Fundos animados': 'sparkle',
};
const MINE = 'Meus plugins';

/** Escolhe arquivos .aex ou uma pasta inteira (o navegador lista tudo o que há dentro). */
function pickAex(folder) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    if (folder) { input.webkitdirectory = true; input.setAttribute('webkitdirectory', ''); } else input.accept = '.aex,application/octet-stream';
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

export class FxBrowser {
  constructor(root, onPick) {
    this.root = root;
    this.onPick = onPick;
    this.cat = 'Todos';
    this.q = '';
    this.busy = null;
    window.addEventListener('aex-plugins-changed', () => this.render());
    window.addEventListener('custom-fx-changed', () => this.render());
    this.render();
  }

  /** Importa .aex: lê, instala e mostra o resumo. Usado pelo botão da aba e por arrastar/abrir arquivos. */
  async importAex(files) {
    if (this.busy) { toast('Ainda lendo os plugins anteriores…', 'warn'); return null; }
    const n = [...files].filter((f) => /\.aex$/i.test(f.name)).length;
    if (!n) { toast('Nenhum arquivo .aex encontrado aí.', 'warn'); return null; }
    this.cat = MINE; this.busy = { done: 0, total: n, file: '' }; this.render();
    let res;
    try {
      res = await importAexFiles(files, (done, total, file) => { this.busy = { done, total, file }; this.updateProgress(); });
    } finally { this.busy = null; }
    this.render();
    const items = res.reports.flatMap((r) => r.motionframe || []);
    const ok = items.filter((m) => m.effect).length, util = items.filter((m) => m.kind === 'utility').length, bad = res.reports.filter((r) => !r.valid_pe).length;
    toast(`${n} arquivo(s) lido(s): ${ok} efeito(s) instalado(s) em Efeitos › ${MINE}` + (util ? `, ${util} utilitário(s) sem efeito visual` : '') + (bad ? `, ${bad} não eram plugins válidos` : '') + '.', 'ok', 7000);
    return res;
  }

  updateProgress() {
    const el = this.root.querySelector('.aex-progress');
    if (!el || !this.busy) return;
    const { done, total, file } = this.busy;
    el.querySelector('i').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    el.querySelector('span').textContent = `Lendo plugins ${done}/${total}${file ? ` · ${file}` : ''}`;
  }

  pluginTiles(list) {
    return list.map((p) => {
      // efeitos de tempo (Twixtor, RSMB, Echo, Time Remap…) não têm "render" de imagem, mas funcionam: contam como aplicáveis
      const def = p.effect ? getEffectDef(p.effect) : null;
      const usable = !!def && def.type !== 'generic';
      if (!usable && PANEL_PLUGINS.test(`${p.name} ${p.matchName} ${p.file}`)) {
        // plugin de painel (Animation Composer, AEJuice…): abre o painel Composer do MotionFrame
        return `<button class="fx-tile" data-panel="1" title="${escapeHtml(p.file)}"><span class="fx-ico">${ico('composer')}</span><span class="fx-name">${escapeHtml(p.name)}</span><span class="fx-plugin">painel · abre o Composer (animações prontas)</span></button>`;
      }
      return `<button class="fx-tile ${usable ? '' : 'disabled'}" ${usable ? `data-plugin="${escapeHtml(p.id)}"` : 'disabled'} title="${escapeHtml(`${p.file} · ${p.matchName || p.name}`)}">
        <span class="fx-ico">${ico(ICON[getEffectDef(p.effect)?.category] || 'presets')}</span>
        <span class="fx-name">${escapeHtml(p.name)}</span>
        <span class="fx-plugin">${usable ? `${escapeHtml(p.category || 'plugin')} · via ${escapeHtml(p.effectLabel || getEffectDef(p.effect).label)}` : '<span class="muted">utilitário – não mexe na imagem</span>'}</span>
      </button>`;
    }).join('');
  }

  render() {
    const mine = allPlugins();
    const q = this.q.trim().toLowerCase();
    const plugHits = (p) => !q || `${p.name} ${p.matchName} ${p.category} ${p.file}`.toLowerCase().includes(q);
    let body;
    if (this.cat === MINE) {
      const list = mine.filter(plugHits);
      const groups = [...new Set(list.map((p) => p.category || 'Outros'))];
      body = `
        <div class="aex-bar">
          <button class="primary" data-aex="files">${ico('import')} Importar .aex</button>
          <button data-aex="folder">${ico('folder')} Importar pasta de plugins</button>
          ${mine.length ? '<button data-aex="clear" class="danger">Remover todos</button>' : ''}
        </div>
        ${this.busy ? '<div class="aex-progress" style="margin:8px 0"><div style="height:6px;background:#0003;border-radius:3px;overflow:hidden"><i style="display:block;height:100%;width:0;background:var(--accent,#2d8cf0)"></i></div><span class="muted" style="font-size:12px"></span></div>' : ''}
        <p class="muted" style="font-size:12px;margin:6px 0 10px">O MotionFrame lê o plugin (nome e match name — o arquivo não é executado; plugins do AE só rodam dentro do After Effects)
        e cria o efeito com a recriação equivalente já configurada. Presets .ffx que usam esses plugins também abrem com eles.
        Pastas grandes (Sapphire, Continuum) levam alguns segundos.</p>
        <p class="muted" style="font-size:12px;margin:0 0 8px">${mine.length} plugins: ${mine.filter((p) => p.pack).length} do seu pacote (já instalados) + ${mine.filter((p) => !p.pack).length} importados por você.</p>
        ${list.length ? groups.map((g) => { const items = list.filter((p) => (p.category || 'Outros') === g); const open = q || this.openGroups?.has(g) || groups.length === 1;
          return `<details class="aex-group" data-g="${escapeHtml(g)}" ${open ? 'open' : ''} style="margin:6px 0"><summary style="cursor:pointer;font-weight:600;padding:6px 0">${escapeHtml(g)} <small class="muted">(${items.length})</small></summary>
          <div class="fx-grid">${open ? this.pluginTiles(items) : ''}</div></details>`; }).join('') : `<div class="empty-note">${mine.length ? 'Nenhum plugin com esse nome.' : 'Nenhum plugin instalado ainda. Importe os .aex (ou a pasta Plug-ins do After Effects).'}</div>`}`;
    } else {
      const list = EFFECTS.filter((e) => (this.cat === 'Todos' || (this.cat === 'Plugins' ? e.plugin : e.category === this.cat)) && fxMatch(e, this.q));
      const plugs = this.cat === 'Todos' && q ? mine.filter((p) => p.effect && plugHits(p)).slice(0, 24) : [];
      const myBar = this.cat === MY_CAT ? `<div class="aex-bar"><button class="primary" data-cfx="new">✦ Criar efeito</button><button data-cfx="import">${ico('import')} Importar .mfx</button></div>
        <p class="muted" style="font-size:12px;margin:6px 0 10px">Junte vários efeitos num só, escolha os controles e use em qualquer camada. Toque e segure (ou clique com o botão direito) num efeito seu para editar, exportar ou apagar.</p>` : '';
      body = `${myBar}${plugs.length ? `<div class="fx-group-title" style="margin:4px 0;font-weight:600">${MINE}</div><div class="fx-grid">${this.pluginTiles(plugs)}</div><div class="fx-group-title" style="margin:10px 0 4px;font-weight:600">Efeitos</div>` : ''}
        <div class="fx-grid">${list.map((e) => `
        <button class="fx-tile" data-type="${e.type}">
          <span class="fx-ico">${ico(ICON[e.category] || 'effects')}</span>
          <span class="fx-name">${escapeHtml(e.label)}</span>
          ${e.custom ? `<span class="fx-plugin">seu efeito · ${e.recipe.steps.length} etapa(s)</span>` : e.plugin ? `<span class="fx-plugin">estilo ${escapeHtml(e.plugin.split(' / ')[0])}</span>` : `<span class="fx-plugin muted">${e.category}</span>`}
        </button>`).join('')}</div>
      ${list.length || plugs.length ? '' : `<div class="empty-note">${this.cat === MY_CAT ? 'Você ainda não criou efeitos. Toque em ✦ Criar efeito.' : 'Nenhum efeito encontrado.'}</div>`}`;
    }
    this.root.innerHTML = `
      <div class="fx-topbar"><button class="fx-create" data-cfx="new">✦ Criar efeito</button><button class="chip ${this.cat === MY_CAT ? 'on' : ''}" data-cat="${MY_CAT}">★ ${MY_CAT}${EFFECTS.some((e) => e.custom) ? ` · ${EFFECTS.filter((e) => e.custom).length}` : ''}</button></div>
      <input type="search" class="fx-search" placeholder="Buscar efeito ou plugin (ex.: glow, twixtor, S_WipeStar)…" value="${escapeHtml(this.q)}">
      <div class="chips">${['Todos', MINE, 'Plugins', ...CATEGORIES.filter((c) => c !== MY_CAT)].map((c) => `<button class="chip ${c === this.cat ? 'on' : ''}" data-cat="${c}">${c === 'Plugins' ? `${ico('presets')} Plugins (recriados)` : c === MINE ? `${ico('import')} ${MINE} (.aex)${mine.length ? ` · ${mine.filter((p) => p.effect).length}` : ''}` : c}</button>`).join('')}</div>
      ${body}`;
    this.updateProgress();
    const s = this.root.querySelector('.fx-search');
    s.addEventListener('input', () => { this.q = s.value; this.render(); const n = this.root.querySelector('.fx-search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    this.root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat; this.render(); }));
    this.root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => this.onPick(b.dataset.type)));
    this.root.querySelectorAll('[data-cfx]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('custom-fx', { detail: { action: b.dataset.cfx } }))));
    this.root.querySelectorAll('[data-type]').forEach((b) => {
      const d = getEffectDef(b.dataset.type); if (!d.custom) return;
      const edit = (e) => { e?.preventDefault(); window.dispatchEvent(new CustomEvent('custom-fx', { detail: { action: 'edit', type: d.type } })); };
      b.addEventListener('contextmenu', edit);
      let tm = 0; b.addEventListener('pointerdown', () => { tm = setTimeout(() => { tm = -1; edit(); }, 600); });
      b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
      b.addEventListener('click', (e) => { if (tm === -1) { e.stopImmediatePropagation(); tm = 0; } }, true);
    });
    this.root.querySelectorAll('[data-plugin]').forEach((b) => b.addEventListener('click', () => {
      const p = allPlugins().find((x) => x.id === b.dataset.plugin);
      if (p) this.onPick(p.effect, { label: p.name, params: p.set, plugin: p });
    }));
    // grupos recolhíveis: as miniaturas só são montadas quando o grupo abre (são ~800 plugins)
    this.root.querySelectorAll('details.aex-group').forEach((d) => d.addEventListener('toggle', () => {
      this.openGroups = this.openGroups || new Set();
      if (d.open) { this.openGroups.add(d.dataset.g); if (!d.querySelector('.fx-tile')) this.render(); } else this.openGroups.delete(d.dataset.g);
    }));
    this.root.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-composer'))));
    this.root.querySelectorAll('[data-plugin]').forEach((b) => b.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const p = installedPlugins().find((x) => x.id === b.dataset.plugin); // só os importados por você podem ser removidos
      if (p && await modal('Remover plugin', `<p>Remover <b>${escapeHtml(p.name)}</b> da aba ${MINE}?</p>`, [{ label: 'Remover', value: 1, danger: true }, { label: 'Cancelar', value: null }])) removePlugin(p.id);
    }));
    this.root.querySelector('[data-aex="files"]')?.addEventListener('click', async () => { const f = await pickAex(false); if (f.length) this.importAex(f); });
    this.root.querySelector('[data-aex="folder"]')?.addEventListener('click', async () => { const f = await pickAex(true); if (f.length) this.importAex(f); });
    this.root.querySelector('[data-aex="clear"]')?.addEventListener('click', async () => {
      if (await modal('Remover todos os plugins', '<p>Tirar todos os plugins da aba? (Os efeitos já aplicados nos projetos continuam funcionando.)</p>', [{ label: 'Remover todos', value: 1, danger: true }, { label: 'Cancelar', value: null }])) clearPlugins();
    });
  }
}
