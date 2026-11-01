// Biblioteca de presets: nativos, pacote FREE (presets/manifest.json), importados (.ffx/.json) e do usuário.
import { parseFFX, retimeFFX } from './ffx.js';
import { BUILTIN_PRESETS, ffxToPreset, applyPreset, layerToPreset, serializePreset, parsePresetJSON } from './presets.js';
import { LAYER_FACTORIES } from './state.js';
import { sourceTimeRaw } from './timing.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { escapeHtml } from './util.js';
import { saveFile } from './platform.js';

const STORE_KEY = 'motionframe.presets.v1';
const CAT_ORDER = ['Importado (FFX)', 'Meus presets', 'Shakes', 'Transições', 'Velocity', 'Glows', 'CC / Cor', 'Looks', 'Entradas', 'Saídas'];
const STATUS = {
  native: ['ok', 'Nativo AE'],
  plugin: ['plugin', 'Plugin reconhecido'],
  approx: ['approx', 'Aproximado'],
  unsupported: ['warn', 'Sem equivalente'],
};

export class Library {
  constructor(root, store, hooks = {}) {
    this.root = root;
    this.store = store;
    this.hooks = hooks;
    this.user = storage.get(STORE_KEY, []);
    this.free = [];
    this.filter = '';
    this.cat = 'Todos';
    this.render();
    this.loadFreePack();
  }

  async loadFreePack() {
    try {
      const res = await fetch('presets/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      this.free = (data.presets || []).map((p, i) => ({
        id: `free_${i}`, source: 'free', name: p.name, category: p.category ? `FREE · ${p.category}` : 'FREE', file: p.file, thumb: p.thumb, lazy: true,
      }));
      this.render();
    } catch { /* sem pacote free */ }
  }

  save() {
    if (!storage.set(STORE_KEY, this.user)) toast('Não foi possível salvar a biblioteca neste aparelho (armazenamento cheio).', 'warn');
  }

  all() { return [...this.user, ...this.free, ...BUILTIN_PRESETS]; }

  categories(items) {
    const cats = [...new Set(items.map((p) => p.category))];
    return cats.sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      const fa = a.startsWith('FREE'), fb = b.startsWith('FREE');
      if (fa !== fb) return fa ? -1 : 1;
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }

  render() {
    const q = this.filter.toLowerCase();
    const all = this.all();
    const cats = this.categories(all);
    const items = all.filter((p) => (this.cat === 'Todos' || p.category === this.cat) && (!q || `${p.name} ${p.category}`.toLowerCase().includes(q)));
    this.root.innerHTML = `
      <div class="lib-tools">
        <button class="primary" data-act="import">⤒ Importar .ffx / preset</button>
        <button data-act="save-layer">★ Salvar camada como preset</button>
      </div>
      <input type="search" class="lib-search" placeholder="Buscar presets…" value="${escapeHtml(this.filter)}">
      <div class="chips">${['Todos', ...cats].map((c) => `<button class="chip ${c === this.cat ? 'on' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>
      ${this.cat === 'Todos' ? this.categories(items).map((c) => `<h4 class="lib-cat">${escapeHtml(c)}</h4><div class="lib-grid">${items.filter((p) => p.category === c).map((p) => this.card(p)).join('')}</div>`).join('') : `<div class="lib-grid">${items.map((p) => this.card(p)).join('')}</div>`}
      ${items.length ? '' : '<div class="empty-note">Nenhum preset encontrado.</div>'}
      <p class="muted small">Dica: arraste arquivos .ffx para a janela, ou use “Importar”. Presets só com efeitos podem ser aplicados sem camada selecionada — o app cria uma camada de ajuste.</p>`;
    this.bind();
  }

  card(p) {
    const fx = (p.effects || []).length;
    const tr = Object.keys(p.transform || {}).length;
    const meta = p.lazy ? (p.file?.endsWith('.ffx') ? '.ffx' : 'preset') : [tr ? `${tr} anim.` : '', fx ? `${fx} fx` : '', p.duration ? `${p.duration.toFixed(2)}s` : ''].filter(Boolean).join(' · ');
    return `<div class="preset ${p.source}" data-id="${p.id}" role="button" tabindex="0">
      <div class="preset-thumb">${p.thumb ? `<img src="${escapeHtml(p.thumb)}" alt="" loading="lazy">` : thumbFor(p)}</div>
      <div class="preset-name">${escapeHtml(p.name)}</div>
      <div class="preset-meta">${meta || '&nbsp;'}</div>
      <div class="preset-actions">
        ${p.report ? '<button data-pact="info" aria-label="Relatório">ⓘ</button>' : ''}
        ${!p.lazy ? '<button data-pact="export" aria-label="Exportar">⤓</button>' : ''}
        ${p.source === 'user' || p.source === 'ffx' ? '<button data-pact="del" class="danger" aria-label="Remover">🗑</button>' : ''}
      </div>
    </div>`;
  }

  bind() {
    const r = this.root;
    r.querySelector('[data-act="import"]').addEventListener('click', async () => {
      const files = await pickFiles('.ffx,.json,application/json,application/octet-stream');
      if (files.length) this.importFiles(files);
    });
    r.querySelector('[data-act="save-layer"]').addEventListener('click', () => this.saveLayer());
    const search = r.querySelector('.lib-search');
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.render();
      const s = this.root.querySelector('.lib-search');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    });
    r.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat; this.render(); }));
    r.querySelectorAll('.preset').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const p = this.all().find((x) => x.id === el.dataset.id);
        const act = e.target.closest('[data-pact]')?.dataset.pact;
        if (act === 'info') return this.showReport(p);
        if (act === 'export') return saveFile(`${slug(p.name)}.preset.json`, new Blob([serializePreset(p)], { type: 'application/json' }));
        if (act === 'del') {
          this.user = this.user.filter((x) => x.id !== p.id);
          this.save();
          return this.render();
        }
        this.apply(await this.resolve(p));
      });
    });
  }

  /** Carrega presets do pacote FREE sob demanda. */
  async resolve(p) {
    if (!p?.lazy) return p;
    try {
      const res = await fetch(p.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let preset;
      if (p.file.toLowerCase().endsWith('.ffx')) {
        preset = ffxToPreset(parseFFX(await res.arrayBuffer(), { fps: this.store.project.fps, fileName: p.file.split('/').pop() }));
      } else {
        [preset] = parsePresetJSON(await res.text());
      }
      Object.assign(preset, { name: p.name, category: p.category, source: 'free', id: p.id });
      const i = this.free.indexOf(p);
      if (i >= 0) this.free[i] = preset;
      return preset;
    } catch (e) {
      toast(`Falha ao carregar preset: ${e.message}`, 'error');
      return null;
    }
  }

  apply(p) {
    if (!p) return;
    let layer = this.store.layer();
    const hasSpeed = (p.effects || []).some((e) => e.type === 'twixtor');
    if (hasSpeed && layer?.type !== 'video') {
      // Velocidade/Twixtor só faz sentido no vídeo: usa o clipe de vídeo sob o playhead
      const t = this.store.time;
      const v = this.store.project.layers.find((l) => l.type === 'video' && l.visible && t >= l.inPoint && t < l.outPoint);
      if (!v) { toast('Este preset muda a velocidade do vídeo: coloque o playhead sobre um clipe de vídeo.', 'warn', 5000); return; }
      layer = v;
      this.store.selectedLayerId = v.id;
    }
    if (!layer) {
      if (Object.keys(p.transform || {}).length) { toast('Selecione uma camada antes de aplicar este preset.', 'warn'); return; }
      layer = LAYER_FACTORIES.adjustment(this.store.project);
      layer.name = `Ajuste · ${p.name}`;
      if ((p.duration || 0) < 0.01) {
        // CC / look estático: vale para o vídeo inteiro
        layer.inPoint = 0;
        layer.outPoint = this.store.project.duration;
      } else {
        layer.inPoint = this.store.time;
        layer.outPoint = Math.min(this.store.project.duration, this.store.time + (p.duration || 0) + 0.5);
      }
      this.store.project.layers.unshift(layer);
      this.store.selectedLayerId = layer.id;
    }
    const t0 = applyPreset(layer, p, this.store.time);
    this.store.commit('structure');
    toast(`“${p.name}” aplicado em ${layer.name} (${t0.toFixed(2)}s)`, 'ok');
    if (hasSpeed && layer.type === 'video') {
      // como no AE: o reverse volta no tempo a partir do ponto aplicado e precisa de vídeo antes dele
      let min = Infinity;
      const end = Math.min(layer.outPoint, t0 + (p.duration || 0));
      for (let t = t0; t <= end; t += 1 / this.store.project.fps) min = Math.min(min, sourceTimeRaw(layer, t));
      if (min < -0.04) toast(`O reverse volta ${(-min).toFixed(2)}s antes do início do vídeo e vai congelar no 1º quadro. Aplique mais adiante no clipe (no momento do lance).`, 'warn', 7000);
    }
    this.hooks.onApplied?.(layer, p);
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

  async importFiles(files) {
    const imported = [];
    const errors = [];
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) imported.push(...parsePresetJSON(await f.text()));
        else if (/\.ffx$/i.test(f.name)) {
          const parsed = parseFFX(await f.arrayBuffer(), { fps: this.store.project.fps, fileName: f.name });
          const preset = ffxToPreset(parsed);
          preset.fileName = f.name;
          preset._parsed = parsed;
          imported.push(preset);
        } else errors.push(`${f.name}: formato não suportado`);
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    if (errors.length) toast(errors.join('\n'), 'error', 6000);
    if (!imported.length) return;
    if (imported.length === 1 && imported[0]._parsed) { await this.showReport(imported[0], true); return; }
    for (const p of imported) this.addToLibrary(p);
    this.cat = 'Todos';
    this.render();
    const plugins = [...new Set(imported.flatMap((p) => p.report?.plugins || []))];
    toast(`${imported.length} preset(s) importado(s).${plugins.length ? `\nPlugins reconhecidos: ${plugins.join(', ')}` : ''}`, 'ok', 5000);
  }

  addToLibrary(p) {
    const clean = { ...p };
    delete clean._parsed;
    delete clean._fps;
    this.user.unshift(clean);
    this.save();
  }

  async showReport(p, isNew = false) {
    if (!p?.report) return;
    const body = (preset) => {
      const r = preset.report;
      const effRows = r.effects.map((e) => {
        const [cls, label] = STATUS[e.status] || STATUS.unsupported;
        return `<tr><td><b>${escapeHtml(e.name)}</b><br><code>${escapeHtml(e.matchName)}</code></td>
          <td><span class="badge ${cls}">${label}</span>${e.plugin ? `<br><span class="small">${escapeHtml(e.vendor)} · ${escapeHtml(e.plugin)}</span>` : ''}${e.mappedTo ? `<br>→ <b>${escapeHtml(e.mappedTo)}</b>` : ''}</td>
          <td class="small">${e.mapped?.length ? e.mapped.map(escapeHtml).join('<br>') : e.params.map((x) => `${escapeHtml(x.name || '?')} = ${fmtVal(x.value)}${x.keys ? ` (${x.keys} kf)` : ''}`).join('<br>') || '—'}</td></tr>`;
      }).join('');
      const propRows = r.properties.map((x) => {
        const [cls, label] = STATUS[x.status] || STATUS.unsupported;
        return `<tr><td><b>${escapeHtml(x.name)}</b><br><code>${escapeHtml(x.matchName)}</code></td><td><span class="badge ${cls}">${label}</span></td><td class="small">${x.keys ? `${x.keys} keyframes` : 'estático'}</td></tr>`;
      }).join('');
      return `<div class="report">
        <div class="report-head">
          <div><b>${escapeHtml(preset.name)}</b> ${preset.fileName ? `<span class="muted">(${escapeHtml(preset.fileName)})</span>` : ''}<br><span class="muted small">${escapeHtml(r.format || '?')} · ${(preset.duration || 0).toFixed(2)}s</span></div>
          ${preset._parsed ? `<label class="row inline"><span>Keyframes em</span><select data-fps>${[24, 25, 30, 50, 60].map((f) => `<option value="${f}" ${f === (preset._fps || this.store.project.fps) ? 'selected' : ''}>${f} fps</option>`).join('')}</select></label>` : ''}
        </div>
        ${r.plugins?.length ? `<p class="plugin-note">Plugins de terceiros identificados e convertidos: <b>${r.plugins.map(escapeHtml).join(', ')}</b></p>` : ''}
        ${r.effects.length ? `<div class="table-wrap"><table><tr><th>Efeito no AE</th><th>Conversão</th><th>Parâmetros</th></tr>${effRows}</table></div>` : ''}
        ${r.properties.length ? `<h4>Propriedades animadas</h4><div class="table-wrap"><table><tr><th>Propriedade</th><th>Status</th><th>Dados</th></tr>${propRows}</table></div>` : ''}
        ${!r.effects.length && !r.properties.length ? '<p class="warn-text">Nenhum efeito ou propriedade encontrado neste arquivo.</p>' : ''}
        ${r.warnings.length ? `<h4>Avisos</h4><ul class="warnings">${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
        ${preset._parsed?.tree?.length ? `<details><summary>Estrutura RIFX (debug)</summary><pre>${escapeHtml(preset._parsed.tree.slice(0, 600).join('\n'))}</pre></details>` : ''}
      </div>`;
    };
    let current = p;
    const buttons = isNew
      ? [{ label: 'Cancelar', value: null }, { label: 'Salvar na biblioteca', value: 'save' }, { label: 'Aplicar e salvar', value: 'apply', primary: true }]
      : [{ label: 'Fechar', value: null }, { label: 'Aplicar', value: 'apply', primary: true }];
    const result = await modal('Importação do After Effects', body(current), buttons, {
      wide: true,
      onMount: (wrap) => {
        const hook = () => wrap.querySelector('[data-fps]')?.addEventListener('change', (e) => {
          const fps = +e.target.value;
          retimeFFX(current._parsed, fps);
          const np = ffxToPreset(current._parsed);
          Object.assign(np, { fileName: current.fileName, _parsed: current._parsed, _fps: fps, id: current.id });
          current = np;
          wrap.querySelector('.modal-body').innerHTML = body(current);
          hook();
        });
        hook();
      },
    });
    if (result === 'save' || (result === 'apply' && isNew)) { this.addToLibrary(current); this.render(); }
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
  if (types.includes('shake') || types.includes('twitch')) anim = 'shake';
  let style = '';
  if (types.includes('deepGlow') || types.includes('glow') || types.includes('lightRays')) style = 'glow';
  else if (types.includes('blur') || types.includes('radialBlur') || types.includes('motionBlur')) style = 'blur';
  else if (types.includes('rgbSplit') || types.includes('glitch') || types.includes('prism')) style = 'rgb';
  else if (types.includes('blackWhite') || types.includes('tint') || types.includes('colorGrade')) style = 'mono';
  else if (types.includes('twixtor') || types.includes('posterizeTime')) style = 'speed';
  else if (types.includes('generic') || p.source === 'free') style = 'ae';
  const label = p.source === 'ffx' || p.file?.endsWith('.ffx') ? 'AE' : p.source === 'free' ? 'FREE' : 'Aa';
  return `<span class="thumb-dot a-${anim} s-${style}">${label}</span>`;
}
