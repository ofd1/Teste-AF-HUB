// Navegador de efeitos (grade com busca e categorias).
import { EFFECTS, CATEGORIES } from './effects.js';
import { escapeHtml } from './util.js';

const ICON = {
  'Luz e brilho': '✺', Movimento: '〰', Tempo: '⏱', Desfoque: '◌', Estilizar: '✦', Distorção: '≋', Cor: '◑', '3D': '⬢', Transições: '⇋',
};

export class FxBrowser {
  constructor(root, onPick) {
    this.root = root;
    this.onPick = onPick;
    this.cat = 'Todos';
    this.q = '';
    this.render();
  }

  render() {
    const q = this.q.toLowerCase();
    const list = EFFECTS.filter((e) => (this.cat === 'Todos' || (this.cat === 'Plugins' ? e.plugin : e.category === this.cat))
      && (!q || `${e.label} ${e.plugin || ''} ${e.category}`.toLowerCase().includes(q)));
    this.root.innerHTML = `
      <input type="search" class="fx-search" placeholder="Buscar efeito (ex.: glow, twixtor, shake)…" value="${escapeHtml(this.q)}">
      <div class="chips">${['Todos', 'Plugins', ...CATEGORIES].map((c) => `<button class="chip ${c === this.cat ? 'on' : ''}" data-cat="${c}">${c === 'Plugins' ? '★ Plugins' : c}</button>`).join('')}</div>
      <div class="fx-grid">${list.map((e) => `
        <button class="fx-tile" data-type="${e.type}">
          <span class="fx-ico">${ICON[e.category] || '•'}</span>
          <span class="fx-name">${escapeHtml(e.label)}</span>
          ${e.plugin ? `<span class="fx-plugin">estilo ${escapeHtml(e.plugin.split(' / ')[0])}</span>` : `<span class="fx-plugin muted">${e.category}</span>`}
        </button>`).join('')}</div>
      ${list.length ? '' : '<div class="empty-note">Nenhum efeito encontrado.</div>'}`;
    const s = this.root.querySelector('.fx-search');
    s.addEventListener('input', () => { this.q = s.value; this.render(); const n = this.root.querySelector('.fx-search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    this.root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat; this.render(); }));
    this.root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => this.onPick(b.dataset.type)));
  }
}
