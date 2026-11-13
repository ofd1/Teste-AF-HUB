// MotionFrame para Windows — app de desktop de verdade (Electron): janela própria com o motor Chromium embutido.
// Não abre o navegador. O editor roda num servidor local só dentro do app (127.0.0.1), com mais memória para
// o JavaScript, GPU liberada e recuperação automática se a tela do editor travar ou cair.
const { app, BrowserWindow, dialog, shell, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// memória: o padrão do Chromium é ~4 GB por aba; vídeos e efeitos pesados passavam disso e a tela caía
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.setAppUserModelId('app.motionframe.desktop');

const PORT = 47830; // porta fixa = projetos, mídias e acesso ficam guardados entre aberturas
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'www') : path.join(__dirname, 'www');
// atualização automática: arquivos novos do editor ficam em <dados do usuário>/www-live e têm prioridade sobre os do .exe
const LIVE = path.join(app.getPath('userData'), 'www-live');
const REMOTE = process.env.MF_UPDATE_URL || 'https://ofd1.github.io/Teste-AF-HUB/';
const vnum = (v) => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;
const readVer = (dir) => { try { return (fs.readFileSync(path.join(dir, 'js', 'projects.js'), 'utf8').match(/APP_VERSION = '(v\d+)'/) || [])[1] || null; } catch { return null; } };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ffx': 'application/octet-stream', '.cube': 'text/plain', '.onnx': 'application/octet-stream' };

// registro das quedas (para diagnosticar): <dados do usuário>/quedas.log
function logCrash(msg) { try { fs.appendFileSync(path.join(app.getPath('userData'), 'quedas.log'), `${new Date().toISOString()} ${msg}\n`); } catch { /* ok */ } }
// a GPU caiu (driver/memória de vídeo): o Chromium recria sozinho; só registra
app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') logCrash(`${d.type}: ${d.reason} (código ${d.exitCode})`); });

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      // versão baixada (se for mais nova que a do .exe) primeiro; o que não veio na atualização (vendor/) sai do .exe
      const useLive = liveOk && fs.existsSync(path.join(LIVE, p));
      const base = useLive ? LIVE : ROOT;
      const file = path.normalize(path.join(base, p));
      if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size, 'Cache-Control': 'no-cache',
        });
        fs.createReadStream(file).pipe(res);
      });
    });
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

let liveOk = vnum(readVer(LIVE)) > vnum(readVer(ROOT));

// .zip mínimo (store/deflate) → pasta
function unzipTo(buf, dir) {
  const zlib = require('zlib');
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip inválido');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8'); p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.includes('..')) continue;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(start, start + csize);
    const out = path.join(dir, name); fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 8 ? zlib.inflateRawSync(raw) : raw);
  }
}
async function checkUpdate() {
  try {
    const info = await (await fetch(`${REMOTE}version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    const cur = liveOk ? readVer(LIVE) : readVer(ROOT);
    if (vnum(info.version) <= vnum(cur)) return;
    const buf = Buffer.from(await (await fetch(REMOTE + info.update + `?v=${info.version}`)).arrayBuffer());
    const tmp = LIVE + '-next';
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    unzipTo(buf, tmp);
    if (vnum(readVer(tmp)) !== vnum(info.version)) throw new Error('pacote incompleto');
    fs.rmSync(LIVE, { recursive: true, force: true }); fs.renameSync(tmp, LIVE); liveOk = true;
    if (!win || win.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(win, { type: 'info', buttons: ['Atualizar agora', 'Depois'], defaultId: 0, title: 'MotionFrame', message: `MotionFrame ${info.label || info.version} baixado.`, detail: 'O editor recarrega com a versão nova (seu projeto já está salvo).' });
    if (response === 0) win.webContents.reloadIgnoringCache();
  } catch (e) { console.warn('atualização:', e.message); }
}

let win = null, crashes = [];
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#0c0820', title: 'MotionFrame', autoHideMenuBar: true, show: false,
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    webPreferences: { backgroundThrottling: false, spellcheck: false, contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(`http://127.0.0.1:${PORT}/index.html`);
  // links externos abrem no navegador do sistema, não dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(`http://127.0.0.1:${PORT}`)) shell.openExternal(url); return { action: 'deny' }; });
  // a tela do editor caiu (falta de memória/GPU): reabre sozinha. O projeto é salvo automaticamente pelo editor.
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    logCrash(`editor: ${d.reason} (código ${d.exitCode})`);
    const now = Date.now(); crashes = crashes.filter((t) => now - t < 60000); crashes.push(now);
    if (crashes.length > 3) {
      dialog.showMessageBox(win, { type: 'error', title: 'MotionFrame', message: 'O editor caiu várias vezes seguidas.', detail: `Motivo: ${d.reason}. Feche e abra o MotionFrame de novo. Se continuar, diminua a qualidade da prévia em Configurações.` });
      return;
    }
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 400);
  });
  win.webContents.on('unresponsive', () => {
    dialog.showMessageBox(win, { type: 'warning', buttons: ['Esperar', 'Recarregar'], defaultId: 0, title: 'MotionFrame', message: 'O editor está demorando para responder (efeito pesado ou exportação).' })
      .then(({ response }) => { if (response === 1 && !win.isDestroyed()) win.webContents.reload(); });
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    // salvar exportação: pergunta onde salvar (como um programa normal)
    session.defaultSession.on('will-download', (_e, item) => { item.setSaveDialogOptions({ title: 'Salvar', defaultPath: path.join(app.getPath('videos'), item.getFilename()) }); });
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true)); // câmera/microfone/arquivos do próprio editor
    try { await serve(); } catch (e) { dialog.showErrorBox('MotionFrame', `Não consegui iniciar o editor (porta ${PORT} ocupada?).\n${e.message}`); app.quit(); return; }
    createWindow();
    setTimeout(checkUpdate, 5000);
    setInterval(checkUpdate, 60 * 60 * 1000);
  });
  app.on('window-all-closed', () => app.quit());
}
