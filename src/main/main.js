const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
  globalShortcut,
} = require('electron');

const { StateStore } = require('../backend/store');
const { PetEngine } = require('../backend/petEngine');
const { createBackendServer } = require('../backend/server');

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let engine = null;
let backendServer = null;
let backendInfo = null;
let isQuitting = false;

const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'figma', 'cat6_sit_0.png');

function applyLoginItemSetting(enabled) {
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
      });
    }
  } catch {
    // Non-fatal in unpackaged dev mode
  }
}

function getOverlayWorkArea() {
  const display = screen.getPrimaryDisplay();
  return display.workArea;
}

function showRoomWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  updateTrayMenu();
}

function showDesktopOverlay() {
  const snapshot = engine.getSnapshot();
  if (!snapshot.settings.showCatOnDesktop) {
    return;
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
  const workArea = getOverlayWorkArea();
  overlayWindow.setBounds(workArea);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.showInactive();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  updateTrayMenu();
}

function handleRoomCloseRequest() {
  const snapshot = engine.getSnapshot();
  if (snapshot.settings.showCatOnDesktop) {
    showDesktopOverlay();
  } else {
    isQuitting = true;
    app.quit();
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    transparent: false,
    backgroundColor: '#2c2118',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'room', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      handleRoomCloseRequest();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  const workArea = getOverlayWorkArea();
  overlayWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed() || !engine) return;
  const snapshot = engine.getSnapshot();
  const roamingLabel = snapshot.overlay.roaming ? 'Pause Roaming' : 'Continue Roaming';

  const template = [
    {
      label: 'Open room',
      click: () => showRoomWindow(),
    },
    {
      label: 'Pet cat',
      click: () => {
        engine.performAction('pet', { source: 'overlay' });
      },
    },
    {
      label: roamingLabel,
      click: () => {
        engine.toggleOverlayRoaming();
        updateTrayMenu();
      },
    },
  ];

  if (snapshot.settings.showCatOnDesktop) {
    template.push({
      label: 'Send cat to desktop',
      click: () => showDesktopOverlay(),
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Quit Cozy Cat',
      click: () => {
        if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
          overlayWindow.setIgnoreMouseEvents(false);
          overlayWindow.focus();
          overlayWindow.webContents.send('cozy:overlay-command', { command: 'open-quit-confirm' });
        } else {
          isQuitting = true;
          app.quit();
        }
      },
    }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Cozy Cat');
  tray.on('click', () => showRoomWindow());
  updateTrayMenu();
}

function registerIpc() {
  ipcMain.handle('cozy:get-config', () => ({
    baseUrl: backendInfo.baseUrl,
    wsUrl: backendInfo.wsUrl,
    workArea: getOverlayWorkArea(),
  }));

  ipcMain.on('cozy:drag-window', (event, { dx, dy }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  ipcMain.on('cozy:close-room', () => {
    handleRoomCloseRequest();
  });

  ipcMain.on('cozy:minimize-room', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('cozy:open-room', () => {
    showRoomWindow();
  });

  ipcMain.on('cozy:send-to-desktop', () => {
    engine.updateSettings({ showCatOnDesktop: true });
    showDesktopOverlay();
  });

  ipcMain.on('cozy:quit-app', () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.on('cozy:overlay-interactive', (_event, interactive) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (interactive) {
      overlayWindow.setIgnoreMouseEvents(false);
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.on('cozy:focus-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.focus();
    }
  });
}

async function bootstrap() {
  const store = new StateStore();
  engine = new PetEngine({
    store,
    startupHandler: applyLoginItemSetting,
  });
  engine.start();

  engine.on('state:update', () => updateTrayMenu());

  backendServer = createBackendServer({
    engine,
    port: 0,
    onOpenRoom: () => showRoomWindow(),
    onSendToDesktop: () => {
      engine.updateSettings({ showCatOnDesktop: true });
      showDesktopOverlay();
    },
    onQuitApp: () => {
      isQuitting = true;
      app.quit();
    },
  });

  backendInfo = await backendServer.start();

  registerIpc();
  createMainWindow();
  createOverlayWindow();
  createTray();

  screen.on('display-metrics-changed', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setBounds(getOverlayWorkArea());
    }
  });

  // Global accessibility shortcut to summon the cat's desktop menu
  try {
    globalShortcut.register('Alt+Shift+C', () => {
      if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        overlayWindow.setIgnoreMouseEvents(false);
        overlayWindow.focus();
        overlayWindow.webContents.send('cozy:overlay-command', { command: 'toggle-menu' });
      } else {
        showRoomWindow();
      }
    });
  } catch {
    // Non-fatal
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showRoomWindow();
  });

  app.whenReady().then(bootstrap);

  app.on('before-quit', async () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    if (engine) engine.stop();
    if (backendServer) await backendServer.stop();
  });

  app.on('window-all-closed', (e) => {
    if (!isQuitting) {
      e.preventDefault();
    }
  });
}
