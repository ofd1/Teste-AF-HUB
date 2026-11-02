// Acesso ao app por token preso ao aparelho (sem servidor).
// - Cada aparelho tem um "código do aparelho" aleatório (guardado no navegador).
// - O dono gera, no gerador de tokens, um token assinado (ECDSA P-256) para aquele código.
// - O app só confere a assinatura com a chave PÚBLICA abaixo: ninguém consegue criar tokens sem a chave
//   secreta (que fica só no gerador), e um token só funciona no aparelho para o qual foi gerado.
const PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHKSj63y743yDxCe5TIGdBUBQGg1v+tF5cJMLdy4jGcQfq0LFLlTU1i3fZTMboT1ghIqfMUeQIBHt7A1E3bZh/w==';
const K_DEV = 'motionframe.device', K_TOK = 'motionframe.token';
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base32 de Crockford (sem I, L, O, U)

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* armazenamento bloqueado */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};

// cópia de segurança no IndexedDB (se o localStorage for limpo, o código do aparelho não muda)
function idb(op, key, val) {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('motionframe-access', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => res(null);
      r.onsuccess = () => {
        const tx = r.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
        const st = tx.objectStore('kv');
        const q = op === 'get' ? st.get(key) : st.put(val, key);
        q.onsuccess = () => res(op === 'get' ? q.result ?? null : true);
        q.onerror = () => res(null);
      };
    } catch { res(null); }
  });
}

/** Normaliza um código (maiúsculas, sem espaços/traços). */
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^MF/, '');

export function formatCode(raw) { return `MF-${raw.match(/.{1,4}/g).join('-')}`; }

/** Código deste aparelho (cria na primeira vez). */
export async function deviceCode() {
  let raw = ls.get(K_DEV) || (await idb('get', K_DEV));
  if (!raw || !/^[0-9A-Z]{16}$/.test(raw)) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    raw = [...b].map((x) => ALPHA[x % 32]).join('');
  }
  ls.set(K_DEV, raw);
  idb('put', K_DEV, raw);
  return raw;
}

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Confere um token: assinatura válida, para este aparelho e dentro da validade. Retorna { ok, name, exp, reason }. */
export async function checkToken(token, code) {
  try {
    const t = String(token || '').trim().replace(/\s+/g, '');
    const [p, sig] = t.split('.');
    if (!p || !sig) return { ok: false, reason: 'token incompleto' };
    const key = await crypto.subtle.importKey('spki', b64u(PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u(sig), new TextEncoder().encode(p));
    if (!good) return { ok: false, reason: 'token inválido' };
    const data = JSON.parse(new TextDecoder().decode(b64u(p)));
    if (normCode(data.d) !== normCode(code)) return { ok: false, reason: 'este token é de outro aparelho' };
    if (data.e && Date.now() / 1000 > data.e) return { ok: false, reason: 'token vencido' };
    return { ok: true, name: data.n || '', exp: data.e || 0 };
  } catch (e) { return { ok: false, reason: 'token inválido' }; }
}

/** Já tem acesso neste aparelho? */
export async function currentAccess() {
  const code = await deviceCode();
  const tok = ls.get(K_TOK) || (await idb('get', K_TOK));
  if (!tok) return { ok: false, code };
  const r = await checkToken(tok, code);
  if (r.ok) { ls.set(K_TOK, tok); idb('put', K_TOK, tok); }
  return { ...r, code };
}

export function logout() { ls.del(K_TOK); idb('put', K_TOK, ''); }

/** Tela "Acessar app": mostra o código do aparelho e pede o token. Resolve quando o acesso é liberado. */
export function accessScreen(code, reason) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'access-gate';
    el.innerHTML = `
      <div class="access-card">
        <h1>Motion<span>Frame</span></h1>
        <p class="muted">Para usar o app, peça um <b>token de acesso</b> enviando o código abaixo. O token só funciona neste aparelho.</p>
        <label class="access-lbl">Código deste aparelho</label>
        <div class="access-code"><code>${formatCode(code)}</code><button data-a="copy">Copiar</button></div>
        <label class="access-lbl" for="accTok">Token de acesso</label>
        <textarea id="accTok" rows="3" placeholder="Cole aqui o token que você recebeu" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <p class="access-err" ${reason ? '' : 'hidden'}>${reason || ''}</p>
        <button class="primary access-go" data-a="go">Acessar app</button>
        <p class="muted small">Se você limpar os dados do navegador ou usar outro aparelho, o código muda e é preciso um token novo.</p>
      </div>`;
    document.body.appendChild(el);
    const err = el.querySelector('.access-err');
    el.querySelector('[data-a="copy"]').onclick = async () => {
      try { await navigator.clipboard.writeText(formatCode(code)); el.querySelector('[data-a="copy"]').textContent = 'Copiado ✓'; } catch { /* sem área de transferência */ }
    };
    el.querySelector('[data-a="go"]').onclick = async () => {
      const tok = el.querySelector('#accTok').value;
      const r = await checkToken(tok, code);
      if (!r.ok) { err.hidden = false; err.textContent = `Não deu: ${r.reason}.`; return; }
      ls.set(K_TOK, tok.trim().replace(/\s+/g, ''));
      await idb('put', K_TOK, tok.trim().replace(/\s+/g, ''));
      el.remove();
      resolve(r);
    };
  });
}
