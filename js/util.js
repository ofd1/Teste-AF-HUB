let counter = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function hexToRgba(hex, a = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

export function rgbaToHex(c) {
  const to = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
}

export function rgbaCss(c, aMul = 1) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c[3] ?? 1) * aMul})`;
}

export function formatTime(t, fps) {
  const s = Math.floor(t);
  const f = Math.round((t - s) * fps);
  const mm = Math.floor(s / 60);
  return `${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.min(f, fps - 1)).padStart(2, '0')}`;
}

/** Tempo simples (como nos apps de celular): 0:03.5 · 1:12.0 */
export function formatSimple(t) {
  const s = Math.max(0, t), m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
/** Interface simples ligada? (classe no <body>, trocada nas configurações) */
export const isSimpleUI = () => typeof document !== 'undefined' && document.body.classList.contains('ui-simple');

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
