// Projetos (como no Alight Motion): vários projetos salvos no aparelho, tela inicial com a lista,
// criar/abrir/duplicar/renomear/excluir/exportar e configurações do app.
import { storage, modal, toast } from './ui.js';
import { escapeHtml, uid } from './util.js';
import { flatLayers } from './state.js';
import { putMedia, getMedia, deleteMedia } from './idb.js';

const INDEX = 'motionframe.projects.v1';
const KEY = (id) => `motionframe.project.${id}`;
const SETTINGS = 'motionframe.settings.v1';

export const DEFAULT_SETTINGS = { compPreset: 'tiktok30', quality: 'auto', autosaveThumb: true, showTips: true, confirmDelete: true };
export function getSettings() { return { ...DEFAULT_SETTINGS, ...storage.get(SETTINGS, {}) }; }
export function setSettings(s) { storage.set(SETTINGS, s); }

export function listProjects() { return storage.get(INDEX, []).sort((a, b) => b.updated - a.updated); }
function saveIndex(list) { storage.set(INDEX, list); }

/** Projeto salvo (sem os blob: das mídias — elas ficam no IndexedDB pelo mediaId). */
function serializable(p) {
  const strip = (l) => ({ ...l, props: { ...l.props, src: l.props.mediaId ? null : l.props.src, ...(l.type === 'group' ? { layers: (l.props.layers || []).map(strip) } : {}) } });
  return { ...p, layers: p.layers.map(strip) };
}

export function saveProjectData(p, thumb) {
  if (!p.id) p.id = uid('prj');
  const data = serializable(p);
  if (!storage.set(KEY(p.id), data)) {
    // projeto grande (ex.: .aep com muitos keyframes): vai para o IndexedDB, que tem muito mais espaço
    putMedia(`__prj_${p.id}`, JSON.stringify(data)).then((ok) => { if (!ok) toast('Pouco espaço no aparelho para salvar o projeto.', 'warn'); });
    // resumo no índice: guarda a lista de mídias usadas, senão a limpeza achava que ninguém usava esses vídeos e os apagava
    const mediaIds = [...new Set(flatLayers(p.layers).map((l) => l.props?.mediaId).filter(Boolean))];
    storage.set(KEY(p.id), { idb: true, id: p.id, name: p.name, width: p.width, height: p.height, fps: p.fps, duration: p.duration, layers: [], mediaIds });
  }
  const list = storage.get(INDEX, []);
  const i = list.findIndex((x) => x.id === p.id);
  const entry = { id: p.id, name: p.name || 'Sem nome', updated: Date.now(), w: p.width, h: p.height, fps: p.fps, dur: p.duration, layers: flatLayers(p.layers).length, thumb: thumb ?? list[i]?.thumb ?? null };
  if (i >= 0) list[i] = entry; else list.push(entry);
  saveIndex(list);
  return true;
}

export function loadProjectData(id) { return storage.get(KEY(id), null); }
/** Igual ao loadProjectData, mas busca no IndexedDB quando o projeto é grande demais para o localStorage. */
export async function loadProjectDataAsync(id) {
  const d = loadProjectData(id);
  if (d?.idb) {
    try { const raw = await getMedia(`__prj_${id}`); if (raw) return JSON.parse(typeof raw === 'string' ? raw : await raw.text()); } catch { /* ok */ }
    return null; // nunca abre o resumo vazio (o salvamento automático apagaria a edição)
  }
  return d;
}

export function deleteProject(id) {
  try { localStorage.removeItem(KEY(id)); } catch { /* ok */ }
  deleteMedia(`__prj_${id}`);
  saveIndex(storage.get(INDEX, []).filter((x) => x.id !== id));
}

/** Todas as mídias usadas por algum projeto (para não apagar arquivos de outros projetos). */
export async function allMediaIds() {
  const ids = new Set();
  for (const e of storage.get(INDEX, [])) {
    const p = await loadProjectDataAsync(e.id);
    if (!p) { const stub = loadProjectData(e.id); if (stub?.idb && !stub.mediaIds) return null; for (const m of stub?.mediaIds || []) ids.add(m); continue; } // sem como saber: não limpa nada
    for (const l of flatLayers(p.layers || [])) if (l.props?.mediaId) ids.add(l.props.mediaId);
  }
  return ids;
}

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Tela inicial. hooks: open(id), create(), importProject(), importAE(), presets(), settings() */
export class HomeScreen {
  constructor(hooks) {
    this.hooks = hooks;
    this.el = document.createElement('div');
    this.el.className = 'home';
    document.body.appendChild(this.el);
  }

  get visible() { return !this.el.hidden; }
  show() { this.render(); this.el.hidden = false; document.body.classList.add('at-home'); }
  hide() { this.el.hidden = true; document.body.classList.remove('at-home'); }

  render() {
    const list = listProjects();
    this.el.innerHTML = `
      <header class="home-top">
        <div class="home-logo"><span class="logo-mark">◆</span> MotionFrame</div>
        <button class="icon" data-h="settings" aria-label="Configurações">⚙</button>
      </header>
      <div class="home-body">
        <button class="home-new" data-h="create"><span class="plus">＋</span><span><b>Novo projeto</b><br><span class="muted small">Formato, FPS e duração como no After Effects</span></span></button>
        <div class="home-actions">
          <button data-h="importProject"><span>📂</span>Importar projeto</button>
          <button data-h="importAE"><span>Ae</span>Importar do After Effects</button>
          <button data-h="presets"><span>★</span>Meus presets</button>
          <button data-h="plugins"><span>⤒</span>Plugins (.aex)</button>
        </div>
        <h3 class="home-h">Projetos <span class="muted small">${list.length}</span></h3>
        ${list.length ? `<div class="home-grid">${list.map((p) => `
          <div class="proj-card" data-id="${p.id}">
            <button class="proj-thumb" data-h="open" data-id="${p.id}" style="aspect-ratio:${p.w}/${p.h}">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="muted">sem prévia</span>'}<span class="proj-dur">${fmtDur(p.dur || 0)}</span></button>
            <div class="proj-info">
              <div class="proj-name">${escapeHtml(p.name)}</div>
              <div class="muted small">${p.w}×${p.h} · ${p.fps}fps · ${fmtDate(p.updated)}</div>
            </div>
            <button class="icon proj-more" data-h="more" data-id="${p.id}" aria-label="Opções">⋯</button>
          </div>`).join('')}</div>` : '<div class="home-empty">Nenhum projeto ainda. Toque em <b>＋ Novo projeto</b> para começar.</div>'}
      </div>`;
    this.el.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.h, b.dataset.id)));
  }

  async action(h, id) {
    if (h === 'more') return this.more(id);
    await this.hooks[h]?.(id);
  }

  async more(id) {
    const e = listProjects().find((x) => x.id === id);
    if (!e) return;
    const res = await modal(e.name, `<div class="menu-list">
      <button data-m="open">▶ Abrir</button>
      <button data-m="rename">✎ Renomear</button>
      <button data-m="dup">⧉ Duplicar</button>
      <button data-m="export">⤓ Exportar projeto (.json)</button>
      <button data-m="del" class="danger">🗑 Excluir</button></div>`, [{ label: 'Fechar', value: null }], {
      onMount: (w, close) => w.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => close(b.dataset.m))),
    });
    const p = loadProjectData(id);
    if (res === 'open') this.hooks.open(id);
    else if (res === 'rename') {
      const name = await modal('Renomear', `<input type="text" data-f="n" value="${escapeHtml(e.name)}" style="width:100%">`, [{ label: 'Cancelar', value: null }, { label: 'OK', primary: true, value: (w) => w.querySelector('[data-f="n"]').value.trim() }]);
      if (name && p) { p.name = name; saveProjectData(p, e.thumb); }
    } else if (res === 'dup' && p) {
      const copy = { ...structuredClone(p), id: uid('prj'), name: `${p.name || 'Projeto'} (cópia)` };
      saveProjectData(copy, e.thumb);
    } else if (res === 'export' && p) this.hooks.exportJSON?.(p);
    else if (res === 'del') {
      const ok = await modal('Excluir projeto', `<p>Excluir “${escapeHtml(e.name)}”? Isso não pode ser desfeito.</p>`, [{ label: 'Cancelar', value: false }, { label: 'Excluir', danger: true, value: true }]);
      if (ok) { deleteProject(id); toast('Projeto excluído.', 'ok'); this.hooks.afterDelete?.(); }
    }
    this.render();
  }
}

/** Configurações do app. */
export async function settingsDialog(presets) {
  const s = getSettings();
  const res = await modal('Configurações', `
    <label class="row"><span>Formato padrão de novo projeto</span><select data-f="compPreset">${presets.map((p) => `<option value="${p.id}" ${p.id === s.compPreset ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}</select></label>
    <label class="row"><span>Qualidade da prévia</span><select data-f="quality"><option value="auto" ${s.quality === 'auto' ? 'selected' : ''}>Auto (cheia parado, ½ tocando)</option><option value="1" ${s.quality === '1' ? 'selected' : ''}>Cheia (mais nítida, mais pesada)</option><option value="0.5" ${s.quality === '0.5' ? 'selected' : ''}>Metade (mais leve)</option></select></label>
    <label class="row"><span>Miniaturas dos projetos</span><label class="switch"><input type="checkbox" data-f="autosaveThumb" ${s.autosaveThumb ? 'checked' : ''}><i></i></label></label>
    <label class="row"><span>Mostrar dicas na barra</span><label class="switch"><input type="checkbox" data-f="showTips" ${s.showTips ? 'checked' : ''}><i></i></label></label>
    <p class="muted small">Projetos e mídias ficam salvos só neste aparelho (nada é enviado para servidores). Exporte o projeto (.json) para levar para outro aparelho.</p>
    <button class="wide" data-f="help">❓ Como usar</button>
    <button class="wide danger" data-f="clear">Limpar cache de quadros</button>`,
  [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: (w) => ({
    compPreset: w.querySelector('[data-f="compPreset"]').value, quality: w.querySelector('[data-f="quality"]').value,
    autosaveThumb: w.querySelector('[data-f="autosaveThumb"]').checked, showTips: w.querySelector('[data-f="showTips"]').checked,
  }) }], {
    onMount: (w, close) => {
      w.querySelector('[data-f="help"]').addEventListener('click', () => close({ help: true }));
      w.querySelector('[data-f="clear"]').addEventListener('click', () => close({ clear: true }));
    },
  });
  if (res && !res.help && !res.clear) setSettings({ ...s, ...res });
  return res;
}
