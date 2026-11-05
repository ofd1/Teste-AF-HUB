// Tela de exportação para .ffx (usada no painel de efeitos e na biblioteca de presets).
import { effectsToFFX } from './ffx-export.js';
import { createEffectInstance } from './presets.js';
import { saveFile } from './platform.js';
import { modal, toast } from './ui.js';
import { escapeHtml } from './util.js';

const slug = (s) => String(s || 'preset').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'preset';

/** effects: instâncias da camada ou efeitos de um preset ({ type, params }). */
export async function exportFFX(effects, name, fps = 30) {
  const inst = effects.map((e) => (e.id && e.params && Object.values(e.params).every((p) => p && typeof p === 'object' && 'value' in p) ? e : createEffectInstance(e.type, e.params || {})));
  let res;
  try { res = await effectsToFFX(inst, { fps, name }); } catch (err) { toast(`Não deu para gerar o .ffx: ${err.message}`, 'error'); return; }
  const { bytes, report } = res;
  const li = (arr) => arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const go = await modal('Exportar preset .ffx (After Effects)', `
    ${report.ok.length ? `<p><b>✔ Vão para o After Effects:</b></p><ul class="small">${li(report.ok)}</ul>` : ''}
    ${report.approx.length ? `<p><b>⚠ Sem molde do AE (teste antes de usar):</b></p><ul class="small">${li(report.approx)}</ul>` : ''}
    ${report.skipped.length ? `<p><b>✕ Só existem no MotionFrame (ficam de fora):</b></p><ul class="small">${li(report.skipped)}</ul>` : ''}
    ${bytes ? '<p class="muted small">No After Effects: selecione a camada › Animation › Apply Animation Preset… e escolha o arquivo. Os plugins (Twitch, Sapphire, BCC…) precisam estar instalados no seu PC.</p>' : '<p>Nenhum destes efeitos tem equivalente no After Effects.</p>'}`,
  [{ label: 'Cancelar', value: false }, ...(bytes ? [{ label: 'Salvar .ffx', primary: true, value: true }] : [])]);
  if (!go || !bytes) return;
  await saveFile(`${slug(name)}.ffx`, new Blob([bytes], { type: 'application/octet-stream' }));
}
