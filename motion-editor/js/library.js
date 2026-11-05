// Biblioteca de presets: nativos, pacote FREE (presets/manifest.json), importados (.ffx/.json) e do usuário.
import { parseFFX, retimeFFX } from './ffx.js';
import { parseCube, encodeCube, haldPixels, haldToCube, haldIsNeutral, HALD_SIZE } from './fx/lut.js';
import { frameifyToPreset } from './frameify.js';
import { BUILTIN_PRESETS, rgxToParsed, ffxToPreset, applyPreset, layerToPreset, serializePreset, parsePresetJSON } from './presets.js';
import { LAYER_FACTORIES } from './state.js';
import { sourceTimeRaw } from './timing.js';
import { modal, toast, pickFiles, storage } from './ui.js';
import { escapeHtml } from './util.js';
import { saveFile } from './platform.js';
import { exportFFX } from './ffx-export-ui.js';
import { scanAex, aexEquivalents, reportsToJSON } from './aex-scan.js';
import { matchEffect } from './import-map.js';
import { UTILITY_PLUGINS } from './import-map-pk.js';
import { putMedia, getMedia } from './idb.js';

const STORE_KEY = 'motionframe.presets.v1';
const CAT_ORDER = ['Importado (FFX)', 'Importado (Frameify)', 'Meus presets', 'Shakes', 'Shatter 3D', 'Transições', 'Velocity', 'Glows', 'CC / Cor', 'Looks', 'Entradas', 'Saídas'];
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
    this.loadStored();
    this.fit = storage.get('motionframe.presetFit', false);
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

  /** A biblioteca fica no IndexedDB (centenas de MB), não no localStorage (~5 MB, enchia com presets grandes). */
  async loadStored() {
    try {
      const raw = await getMedia('__library__');
      const fromDb = raw ? JSON.parse(typeof raw === 'string' ? raw : await raw.text()) : null;
      if (Array.isArray(fromDb)) {
        const ids = new Set(fromDb.map((p) => p.id));
        this.user = [...fromDb, ...this.user.filter((p) => !ids.has(p.id))];
      }
      if (this.user.length) await this.save(true);
      try { localStorage.removeItem(STORE_KEY); } catch { /* ok */ } // libera o espaço antigo para os projetos
      this.render();
    } catch { /* sem IndexedDB: fica no localStorage */ }
  }

  async save(quiet = false) {
    // relatório enxuto (sem a lista de parâmetros brutos de cada efeito) para ocupar pouco espaço
    const slim = this.user.map((p) => (p.report ? { ...p, report: { ...p.report, effects: (p.report.effects || []).map(({ params, ...e }) => e), matchNames: undefined } } : p));
    const ok = await putMedia('__library__', JSON.stringify(slim));
    if (!ok && !storage.set(STORE_KEY, slim) && !quiet) toast('Não foi possível salvar a biblioteca neste aparelho (armazenamento cheio).', 'warn');
  }

  all() { return [...this.user, ...this.free]; } // só os seus presets (importados/salvos) — sem presets prontos

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
        <button class="primary" data-act="import">⤒ Importar .ffx / .rgx / .cube / preset</button>
        <button data-act="save-layer">★ Salvar camada como preset</button>
        <button data-act="capture">◐ Capturar CC do After Effects (Looks, Colorista…)</button>
        <button data-act="aex">⤒ Importar plugins (.aex)</button>
      </div>
      <label class="fit-toggle ${this.fit ? 'on' : ''}">
        <span class="switch"><input type="checkbox" data-act="fit" ${this.fit ? 'checked' : ''}><i></i></span>
        <span><b>⇔ Sincronizar com a duração da camada</b><br><span class="muted small">Os keyframes do preset são esticados/encolhidos para começar no início e terminar no fim da camada selecionada.</span></span>
      </label>
      <input type="search" class="lib-search" placeholder="Buscar presets…" value="${escapeHtml(this.filter)}">
      <div class="chips">${['Todos', ...cats].map((c) => `<button class="chip ${c === this.cat ? 'on' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>
      ${this.cat === 'Todos' ? this.categories(items).map((c) => `<h4 class="lib-cat">${escapeHtml(c)}</h4><div class="lib-grid">${items.filter((p) => p.category === c).map((p) => this.card(p)).join('')}</div>`).join('') : `<div class="lib-grid">${items.map((p) => this.card(p)).join('')}</div>`}
      ${items.length ? '' : all.length ? '<div class="empty-note">Nenhum preset encontrado.</div>' : '<div class="empty-note lib-empty"><b>Sua biblioteca está vazia.</b><br>Importe arquivos <b>.ffx</b> do After Effects (botão acima ou arraste para a tela) ou salve os efeitos de uma camada com <b>★ Salvar camada como preset</b>.</div>'}
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
      const files = await pickFiles('.ffx,.aep,.rgx,.cube,.png,.aex,.json,application/json,application/octet-stream');
      if (files.length) this.importFiles(files);
    });
    r.querySelector('[data-act="save-layer"]').addEventListener('click', () => this.saveLayer());
    r.querySelector('[data-act="capture"]').addEventListener('click', () => this.captureAE());
    r.querySelector('[data-act="aex"]').addEventListener('click', async () => { const f = await pickFiles('.aex,.plugin,application/octet-stream', true); if (f.length) (this.hooks.importAex ? this.hooks.importAex(f) : this.scanPlugins(f)); });
    r.querySelector('[data-act="fit"]').addEventListener('change', (e) => { this.fit = e.target.checked; storage.set('motionframe.presetFit', this.fit); this.render(); });
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
        if (act === 'export') {
          const fmt = await modal(`Exportar “${escapeHtml(p.name)}”`, '<p>Em qual formato?</p>', [{ label: 'Cancelar', value: null }, { label: 'MotionFrame (.json)', value: 'json' }, { label: 'After Effects (.ffx)', primary: true, value: 'ffx' }]);
          if (fmt === 'json') return saveFile(`${slug(p.name)}.preset.json`, new Blob([serializePreset(p)], { type: 'application/json' }));
          if (fmt === 'ffx') { const full = await this.resolve(p); return exportFFX(full.effects || [], p.name); }
          return;
        }
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
    // várias camadas selecionadas: aplica o preset em cada uma
    const many = this.store.selectedLayers?.() || [];
    if (many.length > 1) {
      for (const l of many) applyPreset(l, p, this.store.time, { fit: this.fit && l.type !== 'adjustment' && (p.duration || 0) > 0.01 });
      this.store.commit('structure');
      toast(`“${p.name}” aplicado em ${many.length} camadas.`, 'ok');
      this.hooks.onApplied?.(many[0], p);
      return;
    }
    let layer = this.store.layer();
    const hasSpeed = (p.effects || []).some((e) => e.type === 'twixtor');
    const needsVideo = hasSpeed || (p.effects || []).some((e) => e.type === 'timeSlice');
    if (p.needsLayer && !layer) { toast('Selecione a camada (ex.: o recorte/silhueta do jogador) antes de aplicar este preset.', 'warn', 5000); return; }
    if (needsVideo && layer?.type !== 'video') {
      // Velocidade/Twixtor e Time Slice só fazem sentido no vídeo: usa o clipe de vídeo sob o playhead
      const t = this.store.time;
      const v = this.store.project.layers.find((l) => l.type === 'video' && l.visible && t >= l.inPoint && t < l.outPoint);
      if (!v) { toast(hasSpeed ? 'Este preset muda a velocidade do vídeo: coloque o playhead sobre um clipe de vídeo.' : 'Este preset precisa de um clipe de vídeo: coloque o playhead sobre o clipe.', 'warn', 5000); return; }
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
    const canFit = this.fit && layer.type !== 'adjustment' && (p.duration || 0) > 0.01;
    const t0 = applyPreset(layer, p, this.store.time, { fit: canFit });
    this.store.commit('structure');
    toast(canFit ? `“${p.name}” sincronizado com ${layer.name}: ${(layer.outPoint - layer.inPoint).toFixed(2)}s (era ${p.duration.toFixed(2)}s)` : `“${p.name}” aplicado em ${layer.name} (${t0.toFixed(2)}s)`, 'ok');
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
    if (!layer) { toast('Selecione a camada que tem os efeitos/animações que você quer salvar.', 'warn'); return; }
    const cats = [...new Set(this.user.map((p) => p.category).filter(Boolean))];
    const res = await modal('Salvar como preset', `
      <p class="muted small">Salva os efeitos e as animações (keyframes) de “${escapeHtml(layer.name)}” para usar em qualquer camada.</p>
      <label class="row"><span>Nome</span><input type="text" data-f="name" value="${escapeHtml(`${layer.name} preset`)}"></label>
      <label class="row"><span>Categoria</span><input type="text" data-f="cat" list="presetCats" value="Meus presets"><datalist id="presetCats">${cats.map((c) => `<option value="${escapeHtml(c)}">`).join('')}</datalist></label>
      <label class="row"><span>Incluir animação</span><label class="switch"><input type="checkbox" data-f="anim" checked><i></i></label></label>
      <label class="row"><span>Incluir efeitos</span><label class="switch"><input type="checkbox" data-f="fx" checked><i></i></label></label>`,
    [{ label: 'Cancelar', value: null }, { label: 'Salvar', primary: true, value: (w) => ({ name: w.querySelector('[data-f="name"]').value.trim(), cat: w.querySelector('[data-f="cat"]').value.trim(), anim: w.querySelector('[data-f="anim"]').checked, fx: w.querySelector('[data-f="fx"]').checked }) }]);
    if (!res || !res.name) return;
    const p = layerToPreset(layer, res.name);
    if (!res.anim) p.transform = {};
    if (!res.fx) p.effects = [];
    p.category = res.cat || 'Meus presets';
    if (!Object.keys(p.transform).length && !p.effects.length) { toast('A camada não tem animações nem efeitos.', 'warn'); return; }
    this.user.unshift(p);
    this.save();
    this.cat = 'Todos';
    this.render();
    toast(`Preset “${p.name}” salvo em ${p.category}.`, 'ok');
  }

  /** Captura de cor do AE: baixa a imagem de captura (HALD) e importa a versão com a CC aplicada como LUT 3D exata. */
  async captureAE() {
    const v = await modal('Capturar CC do After Effects', `
      <p>Usa o <b>seu</b> Looks / Colorista / Lumetri / qualquer plugin de cor de verdade: o AE aplica a CC numa imagem com
      todas as cores e o MotionFrame lê o resultado como uma LUT 3D — a cor fica <b>idêntica</b> à do plugin.</p>
      <ol>
        <li>Baixe a <b>imagem de captura</b> (512×512 px).</li>
        <li>No AE: arraste a imagem para “Nova composição” (tem que ficar 512×512, sem escalar). Em Project Settings deixe
          <i>Working Space: None</i> (sem gerenciamento de cor).</li>
        <li>Aplique a CC na imagem (o mesmo Looks/Colorista/efeitos de cor que você usa). Para o Looks, desligue as ferramentas
          que <b>não</b> são de cor: Vignette, Diffusion, Haze, Edge Softness, Spot/Grad Exposure, Grain, Chromatic Aberration — elas
          dependem da posição na imagem e não entram numa LUT (adicione essas pelos efeitos do MotionFrame).</li>
        <li>Composição › Salvar quadro como › Arquivo… → <b>PNG</b>, RGB, 8 bits (ou 16). Não mude o tamanho.</li>
        <li>Volte aqui e toque em <b>Importar captura</b>. Vira um preset na categoria “Capturado do AE”.</li>
      </ol>`, [{ label: 'Baixar imagem de captura', value: 'dl' }, { label: 'Importar captura', value: 'imp', primary: true }, { label: 'Fechar', value: null }]);
    if (v === 'dl') {
      const c = document.createElement('canvas'); c.width = HALD_SIZE; c.height = HALD_SIZE;
      c.getContext('2d').putImageData(new ImageData(haldPixels(), HALD_SIZE, HALD_SIZE), 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      await saveFile('motionframe-captura-AE.png', blob);
      toast('Imagem salva. Aplique a CC nela no AE, exporte em PNG e volte em “Capturar CC” › Importar captura.', 'ok', 6000);
    } else if (v === 'imp') {
      const files = await pickFiles('image/png,.png,.tif,.tiff,image/*');
      for (const f of files) {
        try { this.addToLibrary(await this.captureFromImage(f)); } catch (e) { toast(`${f.name}: ${e.message}`, 'error', 7000); continue; }
        this.cat = 'Capturado do AE'; this.render(); toast(`CC “${f.name}” capturada. Está em Presets › Capturado do AE.`, 'ok', 5000);
      }
    }
  }

  /** Lê os .aex (só os bytes — nunca executa) e mostra qual efeito do MotionFrame corresponde a cada plugin. */
  async scanPlugins(files) {
    const reports = [];
    for (const f of files) {
      const r = f.size > 512 * 1024 * 1024 ? { path: f.name, error: 'arquivo grande demais', pipl: [] } : scanAex(await f.arrayBuffer(), f.name);
      r.motionframe = r.error && !r.valid_pe ? [] : aexEquivalents(r, matchEffect, UTILITY_PLUGINS);
      reports.push(r);
    }
    const rows = reports.map((r) => {
      if (!r.valid_pe) return `<tr><td>${escapeHtml(r.path)}</td><td colspan="3" class="muted">${escapeHtml(r.error || 'não é um plugin')}</td></tr>`;
      return r.motionframe.map((m) => `<tr><td><b>${escapeHtml(m.name)}</b><br><small class="muted">${escapeHtml(r.path)} · ${r.architecture}${m.category ? ` · ${escapeHtml(m.category)}` : ''}</small></td>
        <td><small>${escapeHtml(m.matchName || '—')}</small></td>
        <td>${m.effect ? `✔ ${escapeHtml(m.label)}${m.kind === 'approx' ? ' <small class="muted">(aproximado)</small>' : ''}` : (m.kind === 'utility' ? '<span class="muted">utilitário (não mexe na imagem)</span>' : '<span class="muted">sem equivalente ainda</span>')}</td></tr>`).join('');
    }).join('');
    const ok = reports.reduce((n, r) => n + (r.motionframe || []).filter((m) => m.effect || m.kind === 'utility').length, 0), tot = reports.reduce((n, r) => n + Math.max(1, (r.motionframe || []).length), 0);
    const v = await modal('Meus plugins do After Effects', `
      <p>${ok} de ${tot} plugin(s) têm efeito equivalente no MotionFrame — presets .ffx que usam esses plugins já abrem com eles.
      <small class="muted">Leitura estática: o app só lê o cabeçalho do arquivo (nome, categoria, match name); plugins do AE não rodam fora do After Effects.
      Para a <b>cor exata</b> de um plugin de cor, use “Capturar CC do After Effects”.</small></p>
      <div style="max-height:55vh;overflow:auto"><table class="aex-table" style="width:100%;border-collapse:collapse"><tr><th align="left">Plugin</th><th align="left">Match name</th><th align="left">No MotionFrame</th></tr>${rows}</table></div>`,
      [{ label: 'Exportar relatório (.json)', value: 'json' }, { label: 'Fechar', value: null, primary: true }], { wide: true });
    if (v === 'json') await saveFile('plugins-aex.json', new Blob([reportsToJSON(reports)], { type: 'application/json' }));
  }

  async captureFromImage(f) {
    const bmp = await createImageBitmap(f, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const cube = haldToCube(px, bmp.width, bmp.height);
    if (haldIsNeutral(px)) throw new Error('essa é a imagem de captura sem nenhuma CC aplicada — aplique a CC no AE e exporte o quadro.');
    const enc = encodeCube(cube);
    const name = f.name.replace(/\.(png|tiff?)$/i, '').replace(/^motionframe-captura-AE[-_ ]?/i, '') || 'CC capturada';
    return { id: `cap_${Date.now().toString(36)}`, name, category: 'Capturado do AE', source: 'user', anchor: 'playhead', transform: {},
      effects: [{ type: 'lut3d', label: `CC capturada · ${name}`, params: { amount: 100, lut: enc.b64, lutSize: enc.size } }] };
  }

  async importFiles(files) {
    const imported = [];
    const errors = [];
    const aex = [];
    for (const f of files) {
      try {
        // projeto do After Effects: abre como projeto (não vira um preset gigante)
        if (/\.aepx?$/i.test(f.name)) { if (this.hooks.openAEP) { await this.hooks.openAEP(f); continue; } }
        if (/\.json$/i.test(f.name)) imported.push(...parsePresetJSON(await f.text()));
        else if (/\.ffx$/i.test(f.name)) {
          const parsed = parseFFX(await f.arrayBuffer(), { fps: this.store.project.fps, fileName: f.name });
          const preset = ffxToPreset(parsed);
          preset.fileName = f.name;
          preset._parsed = parsed;
          imported.push(preset);
        } else if (/\.aex$/i.test(f.name)) {
          aex.push(f);
        } else if (/\.png$/i.test(f.name)) {
          imported.push(await this.captureFromImage(f));
        } else if (/\.cube$/i.test(f.name)) {
          const enc = encodeCube(parseCube(await f.text()));
          const name = f.name.replace(/\.cube$/i, '');
          imported.push({ id: `lut_${Date.now().toString(36)}_${imported.length}`, name, category: 'LUTs (.cube)', source: 'user', anchor: 'playhead', transform: {},
            effects: [{ type: 'lut3d', label: `LUT · ${name}`, params: { amount: 100, lut: enc.b64, lutSize: enc.size } }] });
        } else if (/\.frameify$/i.test(f.name)) {
          // preset do Frameify: cada efeito/ferramenta vira o equivalente do MotionFrame (com keyframes)
          const pre = frameifyToPreset(await f.text(), f.name);
          imported.push({ id: `fy_${Date.now().toString(36)}_${imported.length}`, name: pre.name, category: pre.category, source: 'user', anchor: 'playhead', transform: {}, effects: pre.effects, fileName: f.name });
          if (pre.report.unknown.length) errors.push(`${f.name}: ${pre.report.unknown.length} efeito(s) do Frameify sem equivalente (${pre.report.unknown.join(', ')})`);
        } else if (/\.rgx$/i.test(f.name)) {
          const parsed = rgxToParsed(JSON.parse(await f.text()), f.name);
          const preset = ffxToPreset(parsed);
          preset.fileName = f.name; preset.category = 'Looks (.rgx)';
          imported.push(preset);
        } else errors.push(`${f.name}: formato não suportado`);
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    if (errors.length) toast(errors.join('\n'), 'error', 6000);
    if (aex.length) await (this.hooks.importAex ? this.hooks.importAex(aex) : this.scanPlugins(aex));
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
