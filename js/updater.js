// Verificador de versão nova (site/PWA e APK). O app de desktop se atualiza sozinho pelo processo principal.
import { APP_VERSION } from './projects.js';
const REMOTE = 'https://ofd1.github.io/Teste-AF-HUB/';
const num = (v) => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;

export async function checkForUpdate({ onNew } = {}) {
  if (/Electron/i.test(navigator.userAgent)) return null; // desktop: o próprio .exe baixa e aplica
  try {
    const r = await fetch(`${REMOTE}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const info = await r.json();
    if (num(info.version) > num(APP_VERSION)) { onNew?.(info); return info; }
  } catch { /* sem internet */ }
  return null;
}

/** Mostra a faixa "Nova versão" com o botão certo para cada plataforma. */
export function showUpdateBanner(info) {
  if (document.getElementById('updBanner')) return;
  const apk = !!window.Capacitor?.isNativePlatform?.();
  const el = document.createElement('div');
  el.id = 'updBanner'; el.className = 'upd-banner';
  el.innerHTML = `<span>✨ <b>MotionFrame ${info.label || info.version}</b> disponível</span><button class="primary">${apk ? 'Baixar APK' : 'Atualizar agora'}</button><button class="x" aria-label="Depois">✕</button>`;
  el.querySelector('.primary').addEventListener('click', async () => {
    if (apk) { window.open(REMOTE + info.apk, '_system'); return; }
    try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* ok */ }
    location.reload();
  });
  el.querySelector('.x').addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}
