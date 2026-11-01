import { parseFFX, retimeFFX } from './ffx.js';
import { BUILTIN_PRESETS, ffxToPreset, applyPreset, layerToPreset, serializePreset, parsePresetJSON } from './presets.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { escapeHtml, download } from './util.js';

const STORE_KEY = 'motionframe.presets.v1';
const CAT_ORDER = ['Importado (FFX)', 'Meus presets', 'Entrada', 'Saída', 'Ênfase', 'Look'];
const STATUS = {
  native: ['ok', 'Nativo'],
  approx: ['approx', 'Aproximado'],
  unsupported: ['warn', 'Sem equivalente'],
};

export class Library {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.user = storage.get(STORE_KEY, []);
    this.filter = '';
    this.render();
  }

  save() {
    if (!storage.set(STORE_KEY, this.user)) toast('Não foi possível salvar a biblioteca no navegador (armazenamento cheio/bloqueado).', 'warn');
  }

  all() { return [...this.user, ...BUILTIN_PRESETS]; }

  render() {
    const q = this.filter.toLowerCase();
    const items = this.all().filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    const cats = [...new Set([...CAT_ORDER, ...items.map((p) => p.category)])].filter((c) => items.some((p) => p.category === c));
    this.root.innerHTML = `
      <div class="lib-tools">
        <button class="primary" data-act="import">⤒ Importar .ffx / preset</button>
        <button data-act="save-layer" title="Salvar a animação e os efeitos da camada selecionada">★ Salvar camada como preset</button>
        <button data-act="samples" title="Carrega os .ffx de exemplo da pasta samples/">Exemplos .ffx</button>
        <input type="search" placeholder="Buscar presets…" value="${escapeHtml(this.filter)}" data-fid="lib-search">
      </div>
      <div class="drop-hint">Arraste arquivos <b>.ffx</b> (After Effects) ou <b>.json</b> para qualquer lugar da janela.</div>
      ${cats.map((c) => `
        <h4 class="lib-cat">${escapeHtml(c)}</h4>
        <div class="lib-grid">${items.filter((p) => p.category === c).map((p) => this.card(p)).join('')}</div>`).join('')}
      ${items.length ? '' : '<div class="empty-note">Nenhum preset encontrado.</div>'}`;
    this.bind();
  }

  card(p) {
    const fx = (p.effects || []).length;
    const tr = Object.keys(p.transform || {}).length;
    const meta = [tr ? `${tr} anim.` : '', fx ? `${fx} fx` : '', p.duration ? `${p.duration.toFixed(2)}s` : ''].filter(Boolean).join(' · ');
    const removable = p.source !== 'builtin';
    return `<div class="preset ${p.source}" data-id="${p.id}" title="Clique para aplicar à camada selecionada">
      <div class="preset-thumb">${thumbFor(p)}</div>
      <div class="preset-name">${escapeHtml(p.name)}</div>
      <div class="preset-meta">${meta || '&nbsp;'}</div>
      <div class="preset-actions">
        ${p.report ? '<button data-pact="info" title="Relatório de importação">ⓘ</button>' : ''}
        <button data-pact="export" title="Exportar como .json">⤓</button>
        ${removable ? '<button data-pact="del" title="Remover" class="danger">🗑</button>' : ''}
      </div>
    </div>`;
  }

  bind() {
    const r = this.root;
    r.querySelector('[data-act="import"]').addEventListener('click', async () => {
      const files = await pickFiles('.ffx,.json,application/json');
      if (files.length) this.importFiles(files);
    });
    r.querySelector('[data-act="save-layer"]').addEventListener('click', () => this.saveLayer());
    r.querySelector('[data-act="samples"]').addEventListener('click', () => this.loadSamples());
    const search = r.querySelector('input[type="search"]');
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.render();
      const s = this.root.querySelector('input[type="search"]');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    });
    r.querySelectorAll('.preset').forEach((el) => {
      const p = this.all().find((x) => x.id === el.dataset.id);
      el.addEventListener('click', (e) => {
        const act = e.target.closest('[data-pact]')?.dataset.pact;
        if (act === 'info') return this.showReport(p);
        if (act === 'export') return download(`${slug(p.name)}.preset.json`, serializePreset(p), 'application/json');
        if (act === 'del') {
          this.user = this.user.filter((x) => x.id !== p.id);
          this.save();
          return this.render();
        }
        this.apply(p);
      });
    });
  }

  apply(p) {
    const layer = this.store.layer();
    if (!layer) { toast('Selecione uma camada antes de aplicar o preset.', 'warn'); return; }
    const t0 = applyPreset(layer, p, this.store.time);
    this.store.commit();
    toast(`“${p.name}” aplicado em ${layer.name} (${t0.toFixed(2)}s)`, 'ok');
  }

  async saveLayer() {
    const layer = this.store.layer();
    if (!layer) { toast('Selecione uma camada.', 'warn'); return; }
    const name = prompt('Nome do preset', `${layer.name} preset`);
    if (!name) return;
    const p = layerToPreset(layer, name);
    if (!Object.keys(p.transform).length && !p.effects.length) { toast('A camada não tem animações nem efeitos.', 'warn'); return; }
    this.user.unshift(p);
    this.save();
    this.render();
    toast('Preset salvo na biblioteca.', 'ok');
  }

  async loadSamples() {
    const names = ['blur-glow-sombra.ffx', 'animacao-pop-tint.ffx', 'pseudo-controles.ffx'];
    const files = [];
    for (const n of names) {
      try {
        const res = await fetch(`samples/${n}`);
        if (res.ok) files.push(new File([await res.arrayBuffer()], n));
      } catch { /* offline / file:// */ }
    }
    if (!files.length) { toast('Não foi possível carregar samples/ (abra o app via servidor HTTP).', 'warn'); return; }
    this.importFiles(files);
  }

  async importFiles(files) {
    const imported = [];
    const errors = [];
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) {
          imported.push(...parsePresetJSON(await f.text()));
        } else if (/\.ffx$/i.test(f.name)) {
          const buf = await f.arrayBuffer();
          const parsed = parseFFX(buf, { fps: this.store.project.fps, fileName: f.name });
          const preset = ffxToPreset(parsed);
          preset.fileName = f.name;
          preset._parsed = parsed;
          imported.push(preset);
        } else {
          errors.push(`${f.name}: formato não suportado`);
        }
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    if (errors.length) toast(errors.join('\n'), 'error', 6000);
    if (!imported.length) return;

    if (imported.length === 1 && imported[0]._parsed) {
      await this.showReport(imported[0], true);
      return;
    }
    for (const p of imported) this.addToLibrary(p);
    this.render();
    toast(`${imported.length} preset(s) importado(s).`, 'ok');
  }

  addToLibrary(p) {
    const clean = { ...p };
    delete clean._parsed;
    if (clean.report) clean.report = { ...clean.report, tree: undefined };
    this.user.unshift(clean);
    this.save();
  }

  async showReport(p, isNew = false) {
    const rep = p.report;
    if (!rep) return;
    const body = (preset) => {
      const r = preset.report;
      const effRows = r.effects.map((e) => {
        const [cls, label] = STATUS[e.status];
        return `<tr><td><b>${escapeHtml(e.name)}</b><br><code>${escapeHtml(e.matchName)}</code></td>
          <td><span class="badge ${cls}">${label}</span>${e.mappedTo ? `<br>→ ${escapeHtml(e.mappedTo)}` : ''}</td>
          <td class="small">${e.mapped?.length ? e.mapped.map(escapeHtml).join('<br>') : e.params.map((x) => `${escapeHtml(x.name || '?')} = ${fmtVal(x.value)}${x.keys ? ` (${x.keys} kf)` : ''}`).join('<br>') || '—'}</td></tr>`;
      }).join('');
      const propRows = r.properties.map((x) => {
        const [cls, label] = STATUS[x.status];
        return `<tr><td><b>${escapeHtml(x.name)}</b><br><code>${escapeHtml(x.matchName)}</code></td><td><span class="badge ${cls}">${label}</span></td><td class="small">${x.keys ? `${x.keys} keyframes` : 'estático'}</td></tr>`;
      }).join('');
      return `
        <div class="report">
          <div class="report-head">
            <div><b>${escapeHtml(preset.name)}</b> ${preset.fileName ? `<span class="muted">(${escapeHtml(preset.fileName)})</span>` : ''}<br><span class="muted">Formato: ${escapeHtml(r.format || '?')} · duração ${(preset.duration || 0).toFixed(2)}s</span></div>
            ${preset._parsed ? `<label class="row inline"><span>Tempo dos keyframes em</span><select data-fps>${[24, 25, 30, 50, 60].map((f) => `<option value="${f}" ${f === (preset._fps || this.store.project.fps) ? 'selected' : ''}>${f} fps</option>`).join('')}</select></label>` : ''}
          </div>
          ${r.effects.length ? `<h4>Efeitos</h4><table><tr><th>Efeito do AE</th><th>Status</th><th>Parâmetros</th></tr>${effRows}</table>` : ''}
          ${r.properties.length ? `<h4>Propriedades animadas</h4><table><tr><th>Propriedade</th><th>Status</th><th>Dados</th></tr>${propRows}</table>` : ''}
          ${!r.effects.length && !r.properties.length ? '<p class="warn-text">Nenhum efeito ou propriedade encontrado neste arquivo.</p>' : ''}
          ${r.warnings.length ? `<h4>Avisos</h4><ul class="warnings">${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
          ${preset._parsed?.tree?.length ? `<details><summary>Estrutura RIFX (debug)</summary><pre>${escapeHtml(preset._parsed.tree.slice(0, 600).join('\n'))}</pre></details>` : ''}
          ${r.matchNames?.length ? `<details><summary>Match names encontrados (${r.matchNames.length})</summary><pre>${escapeHtml(r.matchNames.join('\n'))}</pre></details>` : ''}
        </div>`;
    };
    let current = p;
    const buttons = isNew
      ? [{ label: 'Cancelar', value: null }, { label: 'Salvar na biblioteca', value: 'save' }, { label: 'Aplicar e salvar', value: 'apply', primary: true }]
      : [{ label: 'Fechar', value: null }, { label: 'Aplicar à camada', value: 'apply', primary: true }];
    const result = await modal('Importação de preset do After Effects', body(current), buttons, {
      wide: true,
      onMount: (wrap) => {
        const hook = () => wrap.querySelector('[data-fps]')?.addEventListener('change', (e) => {
          const fps = +e.target.value;
          retimeFFX(current._parsed, fps);
          const np = ffxToPreset(current._parsed);
          np.fileName = current.fileName; np._parsed = current._parsed; np._fps = fps; np.id = current.id;
          current = np;
          wrap.querySelector('.modal-body').innerHTML = body(current);
          hook();
        });
        hook();
      },
    });
    if (result === 'save' || (result === 'apply' && isNew)) {
      this.addToLibrary(current);
      this.render();
    }
    if (result === 'apply') this.apply(current);
  }
}

function fmtVal(v) {
  if (!v || !v.length) return '—';
  return v.map((x) => +x.toFixed(3)).join(', ');
}

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'preset';
}

function thumbFor(p) {
  const types = (p.effects || []).map((e) => e.type);
  const tr = Object.keys(p.transform || {});
  let anim = 'fade';
  if (tr.includes('position')) anim = 'slide';
  if (tr.includes('scale')) anim = 'pop';
  if (tr.includes('rotation')) anim = 'spin';
  if (types.includes('shake')) anim = 'shake';
  let style = '';
  if (types.includes('glow')) style = 'glow';
  else if (types.includes('blur')) style = 'blur';
  else if (types.includes('rgbSplit')) style = 'rgb';
  else if (types.includes('blackWhite') || types.includes('tint')) style = 'mono';
  else if (types.includes('generic')) style = 'ae';
  return `<span class="thumb-dot a-${anim} s-${style}">${p.source === 'ffx' ? 'AE' : 'Aa'}</span>`;
}
