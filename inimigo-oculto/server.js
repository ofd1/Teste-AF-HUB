// Inimigo Oculto — servidor sem dependências (Node >= 18)
// Guarda o estado em data/state.json: sorteio e sessões.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080; // Discloud exige 8080 em 0.0.0.0
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const PARTICIPANTES = {
  'Gabriel': 'G@bB',
  'Heitor': 'H@bB',
  'Danilo': 'D@fF27',
  'Arthur': 'Apln@',
  'Kaik': 'kaikiegO',
  'Isaak': 'pokemGO@',
  'Renzo': 'R@Faa',
  'Joao Victor': 'JoaoV1cky',
  'Salgado': 'Jlsgd12',
};
const NOMES = Object.keys(PARTICIPANTES);

// ---------- estado ----------
function gerarSorteio() {
  // Um único ciclo aleatório: ninguém tira a si mesmo e todos são tirados.
  const ordem = [...NOMES];
  for (let i = ordem.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }
  const alvo = {};
  ordem.forEach((n, i) => { alvo[n] = ordem[(i + 1) % ordem.length]; });
  return alvo;
}

function estadoNovo() {
  const pessoas = {};
  for (const n of NOMES) pessoas[n] = { token: null, sorteou: false };
  return { alvo: gerarSorteio(), pessoas };
}

function carregar() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const n of NOMES) if (!s.pessoas[n]) s.pessoas[n] = { token: null, sorteou: false };
    return s;
  } catch {
    const s = estadoNovo();
    salvar(s);
    return s;
  }
}

function salvar(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

let estado = carregar();

// ---------- helpers ----------
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function lerBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100_000) { reject(new Error('grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('json')); } });
  });
}

function quemE(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  return NOMES.find((n) => estado.pessoas[n].token && safeEq(estado.pessoas[n].token, token)) || null;
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function painel(nome) {
  const p = estado.pessoas[nome];
  const out = { nome, sorteou: p.sorteou };
  if (p.sorteou) out.inimigo = estado.alvo[nome];
  return out;
}

// ---------- tentativas de login (anti força bruta simples) ----------
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.n >= 10 && Date.now() - t.desde < 10 * 60 * 1000;
}
function falhou(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde > 10 * 60 * 1000) tentativas.set(ip, { n: 1, desde: Date.now() });
  else t.n++;
}

// ---------- rotas ----------
async function api(req, res, url) {
  const ip = req.socket.remoteAddress;

  if (req.method === 'GET' && url.pathname === '/api/participantes') {
    return json(res, 200, NOMES.map((n) => ({ nome: n, emUso: !!estado.pessoas[n].token })));
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' });
    const { nome, senha } = await lerBody(req);
    if (!NOMES.includes(nome) || !safeEq(PARTICIPANTES[nome], senha || '')) {
      falhou(ip);
      return json(res, 401, { erro: 'Senha incorreta.' });
    }
    const p = estado.pessoas[nome];
    if (p.token) {
      return json(res, 409, { erro: `A conta de ${nome} já foi acessada em outro aparelho. Só é possível entrar por lá.` });
    }
    p.token = crypto.randomBytes(32).toString('hex');
    salvar(estado);
    return json(res, 200, { token: p.token, ...painel(nome) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/liberar') {
    // Libera uma conta para entrar de novo (ex.: a pessoa trocou de celular).
    if (!ADMIN_KEY || !safeEq(req.headers['x-admin-key'] || '', ADMIN_KEY)) return json(res, 403, { erro: 'Proibido' });
    const { nome } = await lerBody(req);
    if (!NOMES.includes(nome)) return json(res, 404, { erro: 'Nome não encontrado' });
    estado.pessoas[nome].token = null;
    salvar(estado);
    return json(res, 200, { ok: true });
  }

  const nome = quemE(req);
  if (!nome) return json(res, 401, { erro: 'Não autenticado' });

  if (req.method === 'GET' && url.pathname === '/api/eu') return json(res, 200, painel(nome));

  if (req.method === 'POST' && url.pathname === '/api/sortear') {
    estado.pessoas[nome].sorteou = true; // o par já está definido; só revela
    salvar(estado);
    return json(res, 200, painel(nome));
  }

  return json(res, 404, { erro: 'Rota não encontrada' });
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const PAGINAS = { '/': 'index.html', '/sorteio': 'index.html' };

function estatico(req, res, url) {
  const rota = url.pathname.replace(/\/+$/, '') || '/';
  let arquivo = PAGINAS[rota] ? path.join(PUBLIC_DIR, PAGINAS[rota])
    : path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!arquivo.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return estatico(req, res, url);
  } catch (e) {
    return json(res, 400, { erro: 'Requisição inválida' });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`Inimigo Oculto rodando na porta ${PORT}`));
