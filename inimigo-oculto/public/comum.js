// Código compartilhado pelos dois sites (desejos e sorteio).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkSeguro = (u) => /^https?:\/\//i.test(u || '') ? u : '';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let token = null;
try { token = localStorage.getItem('io_token'); } catch {}

async function api(metodo, rota, corpo) {
  const r = await fetch(rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dados.erro || 'Erro'), { status: r.status, dados });
  return dados;
}

function neve() {
  const box = document.createElement('div'); box.className = 'neve'; document.body.prepend(box);
  for (let i = 0; i < 30; i++) {
    const f = document.createElement('i');
    f.textContent = '❄';
    f.style.left = Math.random() * 100 + 'vw';
    f.style.fontSize = 8 + Math.random() * 14 + 'px';
    f.style.animationDuration = 6 + Math.random() * 10 + 's';
    f.style.animationDelay = -Math.random() * 16 + 's';
    box.appendChild(f);
  }
}

// Retorna o painel do usuário logado, ou mostra a tela de login e espera.
async function entrar(app, cabecalho, subtitulo) {
  if (token) {
    try { return await api('GET', '/api/eu'); }
    catch (e) { if (e.status === 401) { token = null; try { localStorage.removeItem('io_token'); } catch {} } else throw e; }
  }
  return new Promise(async (resolve) => {
    app.innerHTML = cabecalho + `<p class="sub">${subtitulo}</p>
      <div class="card">
        <h2>Quem é você?</h2>
        <div class="nomes" id="nomes">Carregando…</div>
        <form class="senha" id="formSenha">
          <input type="password" id="senha" placeholder="Sua senha" autocomplete="current-password" required>
          <button class="btn" type="submit">Entrar</button>
        </form>
        <p class="erro" id="erro"></p>
      </div>`;
    let escolhido = null;
    try {
      const lista = await api('GET', '/api/participantes');
      $('#nomes').innerHTML = lista.map((p) =>
        `<button type="button" data-nome="${esc(p.nome)}">${esc(p.nome)}${p.emUso ? '<small>🔒 já entrou</small>' : ''}</button>`).join('');
    } catch { $('#nomes').textContent = 'Não foi possível carregar.'; }
    $('#nomes').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      escolhido = b.dataset.nome;
      document.querySelectorAll('#nomes button').forEach((x) => x.classList.toggle('sel', x === b));
      $('#formSenha').classList.add('on'); $('#erro').textContent = ''; $('#senha').focus();
    });
    $('#formSenha').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/login', { nome: escolhido, senha: $('#senha').value });
        token = r.token; try { localStorage.setItem('io_token', token); } catch {}
        delete r.token; resolve(r);
      } catch (err) { $('#erro').textContent = err.message; }
    });
  });
}

function confete() {
  const cores = document.body.classList.contains('tema-inimigo') ? ['#b3001b', '#3bff6e', '#7d2bd1', '#111111', '#ff4d4d'] : ['#c8102e', '#f2c14e', '#1f7a4d', '#ffffff', '#4aa3ff'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('div');
    c.className = 'confete';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = cores[i % cores.length];
    c.style.animationDelay = Math.random() * 0.6 + 's';
    c.style.animationDuration = 2 + Math.random() * 1.5 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4500);
  }
}
