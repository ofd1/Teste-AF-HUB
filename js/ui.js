export function toast(msg, kind = 'info', ms = 3200) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  while (host.children.length >= 2) host.firstChild.remove(); // no máximo 2 avisos na tela
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Abre um modal. buttons: [{ label, value, primary?, danger? }]. Retorna Promise<value|null>. */
export function modal(title, bodyHtml, buttons = [{ label: 'Fechar', value: null }], { wide = false, onMount } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <header><h2></h2><button class="x" aria-label="Fechar">✕</button></header>
      <div class="modal-body">${bodyHtml}</div>
      <footer>${buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${b.label}</button>`).join('')}</footer>
    </div>`;
    wrap.querySelector('h2').textContent = title;
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector('.x').addEventListener('click', () => close(null));
    wrap.querySelectorAll('footer button').forEach((b) => b.addEventListener('click', () => {
      const btn = buttons[+b.dataset.i];
      close(typeof btn.value === 'function' ? btn.value(wrap) : btn.value);
    }));
    document.body.appendChild(wrap);
    onMount?.(wrap, close);
  });
}

export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};
