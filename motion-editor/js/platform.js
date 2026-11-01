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

/**
 * Salva/compartilha um arquivo.
 * - App nativo: grava no cache e abre a folha de compartilhamento (Salvar na galeria, TikTok, Instagram…).
 * - Celular (navegador/PWA): Web Share com arquivo quando suportado.
 * - Desktop: download.
 */
export async function saveFile(name, blob) {
  const plugins = Cap()?.Plugins;
  if (isNative() && plugins?.Filesystem && plugins?.Share) {
    const data = await blobToBase64(blob);
    const res = await plugins.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
    await plugins.Share.share({ title: name, files: [res.uri], url: res.uri });
    return 'shared';
  }
  if (isMobile() && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return 'downloaded';
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
