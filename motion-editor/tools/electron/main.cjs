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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ffx': 'application/octet-stream', '.cube': 'text/plain', '.onnx': 'application/octet-stream' };

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
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
  });
  app.on('window-all-closed', () => app.quit());
}
