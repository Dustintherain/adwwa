import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable local file access for WebAssembly .wasm fetching
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'DEAD ARCHIVE: SURVIVOR PROTOCOL - VALVE ENGINE STYLE',
    backgroundColor: '#0a0b0e',
    show: false,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer]: ${message}`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[Renderer Load Failed]: ${errorCode} - ${errorDescription}`);
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html')).catch(() => {
      // Fallback for direct dev run if not built
      mainWindow.loadURL('http://localhost:5173');
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

// === TEMP SMOKE TEST ===
if (process.env.SMOKE_TEST) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => mainWindow.webContents.executeJavaScript(c);
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      await wait(3500);
      const menuImg = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, '../shots/verify_menu_gun.png'), menuImg.toPNG());
      console.log('[SMOKE] Saved shots/verify_menu_gun.png');

      await js("document.getElementById('btn-campaign').click()");
      await wait(600);
      await js("document.getElementById('btn-start-campaign').click()");
      await wait(3000);

      // Press V to switch to third person
      await js("window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyV', bubbles:true}))");
      await wait(1500);

      const tpImg = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, '../shots/verify_tp_gun.png'), tpImg.toPNG());
      console.log('[SMOKE] Saved shots/verify_tp_gun.png');

      console.log('[SMOKE] SUCCESS');
      app.quit();
    } catch (e) {
      console.error('[SMOKE ERROR]', e);
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
