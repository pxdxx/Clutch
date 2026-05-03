const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  clipboard,
  ipcMain,
  dialog,
  screen,
  shell,
  desktopCapturer,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    quickShortcut: 'CommandOrControl+Shift+1',
    annotateShortcut: 'CommandOrControl+Shift+2',
    openAtLogin: false,
  },
});

function applyOpenAtLogin(enabled) {
  const want = !!enabled;
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setLoginItemSettings({
        openAtLogin: want,
        path: process.execPath,
        args: [path.resolve(process.argv[1])],
        name: 'Clutch',
      });
    } else {
      app.setLoginItemSettings({ openAtLogin: false, name: 'Clutch' });
    }
  } else {
    app.setLoginItemSettings({
      openAtLogin: want,
      path: process.execPath,
      name: 'Clutch',
    });
  }
}

let tray = null;
let settingsWindow = null;
let overlayWindow = null;
let overlayHtmlReady = false;
let overlayActive = false;
let isQuitting = false;

const ICONS_DIR = path.join(__dirname, 'icons');
const ICONS_ICO = path.join(ICONS_DIR, 'ico', 'clutch.ico');
const ICONS_PNG = path.join(ICONS_DIR, 'png');
const PNG_SIZES = ['512', '192', '96', '48', '32', '16'];

function firstExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveAppIconPath() {
  const pngCandidates = PNG_SIZES.map((s) => path.join(ICONS_PNG, `clutch-icon-${s}.png`));
  if (process.platform === 'win32' && fs.existsSync(ICONS_ICO)) return ICONS_ICO;
  const png = firstExisting(pngCandidates);
  if (png) return png;
  if (fs.existsSync(ICONS_ICO)) return ICONS_ICO;
  return null;
}

function loadAppIconNativeImage() {
  const p = resolveAppIconPath();
  if (!p) return null;
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? null : img;
}

function trayImageFromPng() {
  const p16 = path.join(ICONS_PNG, 'clutch-icon-16.png');
  const p32 = path.join(ICONS_PNG, 'clutch-icon-32.png');
  if (process.platform === 'darwin' && fs.existsSync(p32)) {
    const img = nativeImage.createFromPath(p32);
    if (!img.isEmpty()) return img.resize({ width: 22, height: 22 });
  }
  if (fs.existsSync(p16)) {
    const img = nativeImage.createFromPath(p16);
    if (!img.isEmpty()) return img;
  }
  if (fs.existsSync(p32)) {
    const img = nativeImage.createFromPath(p32);
    if (!img.isEmpty()) return img;
  }
  return null;
}

function getTrayImage() {
  const fromPng = trayImageFromPng();
  if (fromPng) return fromPng;

  const branded = loadAppIconNativeImage();
  if (branded) {
    const traySize = process.platform === 'darwin' ? 22 : 16;
    const { width, height } = branded.getSize();
    if (width > traySize * 2 || height > traySize * 2) {
      return branded.resize({ width: traySize, height: traySize });
    }
    return branded;
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABuklEQVR4nO2WvUoDQRSFv0VFRQsRLCwUBC2sFBBBsLAQLC0EwcJCEARBsLAQLAQRC0GwEASxsBBEsBBEsPhT5s5ms5vdZJPdzYFhmJ2559w7d+4M/KcHqgF1oAHUgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqQB2oA3WgDtSBOlAH6kAdqAN1oA7UgTpQB+pAHagDdaAO1IE6UAfqwF8PPgGShlBJfH0pgQAAAABJRU5ErkJggg=='
  );
}

function broadcastSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:updated', store.store);
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const quick = store.get('quickShortcut');
  const annotate = store.get('annotateShortcut');
  if (quick) { try { globalShortcut.register(quick, () => startCapture('quick')); } catch (_) {} }
  if (annotate) { try { globalShortcut.register(annotate, () => startCapture('annotate')); } catch (_) {} }
}

function createSettingsWindow(opts = { show: true }) {
  const shouldShow = opts.show !== false;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (shouldShow) { settingsWindow.show(); settingsWindow.focus(); }
    return;
  }
  const winIcon = resolveAppIconPath();
  settingsWindow = new BrowserWindow({
    width: 440, height: 356, resizable: false,
    show: false, backgroundColor: '#111113', autoHideMenuBar: true,
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWindow.on('close', (e) => { if (!isQuitting) { e.preventDefault(); settingsWindow.hide(); } });
  settingsWindow.once('ready-to-show', () => { if (shouldShow) { settingsWindow.show(); settingsWindow.focus(); } });
}

function createOverlayWindow() {
  const winIcon = resolveAppIconPath();
  overlayWindow = new BrowserWindow({
    width: 8, height: 8,
    x: -32000, y: -32000,
    frame: false, transparent: false,
    skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, closable: false,
    alwaysOnTop: true, focusable: true,
    show: false, backgroundColor: '#000000',
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.webContents.on('did-finish-load', () => { overlayHtmlReady = true; });
  overlayWindow.on('closed', () => { overlayWindow = null; overlayHtmlReady = false; overlayActive = false; });
}

async function startCapture(mode) {
  if (overlayActive) return;
  overlayActive = true;

  try {
    if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
    if (!overlayHtmlReady) {
      await new Promise((resolve) => {
        const check = () => { if (overlayHtmlReady) return resolve(); setTimeout(check, 30); };
        check();
      });
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.bounds;
    const sf = display.scaleFactor || 1;
    const physW = Math.round(width * sf);
    const physH = Math.round(height * sf);

    overlayWindow.setBounds({ x, y, width, height });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physW, height: physH },
      fetchWindowIcons: false,
    });

    const source = sources.find((s) => s.display_id === String(display.id))
      || sources.find((s) => s.display_id === '')
      || sources[0];

    if (!source) { hideOverlay(); return; }

    const thumbnail = source.thumbnail;
    const { width: imgW, height: imgH } = thumbnail.getSize();
    const dataUrl = thumbnail.toDataURL();

    overlayWindow.webContents.send('overlay:setup', {
      dataUrl, mode, imgW, imgH, windowW: width, windowH: height,
    });
  } catch (e) {
    console.error('[capture] failed:', e);
    hideOverlay();
  }
}

function hideOverlay() {
  overlayActive = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
    overlayWindow.setBounds({ x: -32000, y: -32000, width: 8, height: 8 });
    overlayWindow.webContents.send('overlay:reset');
  }
}

ipcMain.on('overlay:ready', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
  }
});

ipcMain.handle('overlay:done', async (_e, { dataUrl, action }) => {
  hideOverlay();
  const ni = nativeImage.createFromDataURL(dataUrl);
  if (action === 'copy') {
    clipboard.writeImage(ni);
  } else if (action === 'save') {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Сохранить скриншот',
      defaultPath: path.join(app.getPath('pictures'), `screenshot-${Date.now()}.png`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (!canceled && filePath) fs.writeFileSync(filePath, ni.toPNG());
  }
  return { ok: true };
});

ipcMain.on('overlay:cancel', () => hideOverlay());

ipcMain.handle('settings:get', () => store.store);
ipcMain.handle('settings:set', (_e, partial) => {
  if (partial.quickShortcut !== undefined) store.set('quickShortcut', partial.quickShortcut);
  if (partial.annotateShortcut !== undefined) store.set('annotateShortcut', partial.annotateShortcut);
  if (partial.openAtLogin !== undefined) {
    store.set('openAtLogin', !!partial.openAtLogin);
    applyOpenAtLogin(store.get('openAtLogin'));
  }
  registerShortcuts();
  broadcastSettings();
  return store.store;
});

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Настройки', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.clutch.screenshot');
  }
  if (process.platform === 'darwin') {
    const dockIcon = resolveAppIconPath();
    if (dockIcon) app.dock.setIcon(dockIcon);
  }

  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => {
    cb(perm === 'media' || perm === 'display-capture');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => {
    return perm === 'media' || perm === 'display-capture';
  });

  applyOpenAtLogin(store.get('openAtLogin'));

  registerShortcuts();
  tray = new Tray(getTrayImage());
  tray.setToolTip('Clutch');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => createSettingsWindow({ show: true }));

  createSettingsWindow({ show: false });
  createOverlayWindow();

  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});

  app.on('activate', () => createSettingsWindow({ show: true }));
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
