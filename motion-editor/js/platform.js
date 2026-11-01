// Integração com a plataforma: app nativo (Capacitor — Android/iOS), PWA e navegador.
const Cap = () => window.Capacitor;

export const isNative = () => !!Cap()?.isNativePlatform?.();
export const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent));

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

async function shareNative(name, blob) {
  const { Filesystem, Share } = Cap().Plugins;
  const data = await blobToBase64(blob);
  const res = await Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
  await Share.share({ title: name, files: [res.uri], url: res.uri, dialogTitle: 'Salvar ou compartilhar' });
}

/**
 * Salva/compartilha um arquivo.
 * O iPhone/Android só abrem a folha "Salvar vídeo / Salvar em Arquivos / TikTok…" a partir de um toque do usuário;
 * depois de uma exportação longa esse toque "expira". Por isso mostramos uma tela final com o botão Salvar,
 * que chama a folha de compartilhamento dentro do próprio toque.
 */
export function saveFile(name, blob) {
  const plugins = Cap()?.Plugins;
  const native = isNative() && plugins?.Filesystem && plugins?.Share;
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const canShare = !native && !!navigator.canShare && (() => { try { return navigator.canShare({ files: [file] }); } catch { return false; } })();
  if (!native && !canShare && !isMobile()) { download(name, blob); return Promise.resolve('downloaded'); }
  const isVideo = /^video\//.test(file.type), isImage = /^image\//.test(file.type);
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal save-sheet" role="dialog" aria-modal="true">
      <header><h2>Pronto! ✓</h2><button class="x" aria-label="Fechar">✕</button></header>
      <div class="modal-body">
        ${isVideo ? `<video src="${url}" playsinline muted loop autoplay controls class="save-preview"></video>` : isImage ? `<img src="${url}" class="save-preview" alt="">` : ''}
        <p class="muted small">${(blob.size / 1e6).toFixed(1)} MB · ${name}</p>
        <button class="primary wide big" data-a="share">⬆︎ Salvar / Compartilhar</button>
        <p class="muted small">Abre as opções do aparelho: <b>${isVideo ? 'Salvar vídeo (Fotos)' : isImage ? 'Salvar imagem (Fotos)' : 'Salvar'}</b>, <b>Salvar em Arquivos</b>, TikTok, Instagram, WhatsApp, AirDrop…</p>
        <button class="wide" data-a="download">⤓ Baixar arquivo</button>
      </div></div>`;
    const done = (v) => { wrap.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); resolve(v); };
    wrap.querySelector('.x').addEventListener('click', () => done('closed'));
    wrap.querySelector('[data-a="download"]').addEventListener('click', () => { download(name, blob); });
    wrap.querySelector('[data-a="share"]').addEventListener('click', async () => {
      try {
        if (native) await shareNative(name, blob);
        else if (canShare) await navigator.share({ files: [file], title: name });
        else { download(name, blob); return; }
        done('shared');
      } catch (e) {
        if (e?.name !== 'AbortError') download(name, blob);
      }
    });
    document.body.appendChild(wrap);
  });
}

/** Mantém a tela ligada durante a exportação (quando suportado). */
export async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock) keepAwake.lock = await navigator.wakeLock.request('screen');
    else if (!on && keepAwake.lock) { await keepAwake.lock.release(); keepAwake.lock = null; }
  } catch { /* ignorado */ }
}

export function registerServiceWorker() {
  if (isNative() || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
