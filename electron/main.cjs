// ============ Electron shell for the Steam build ============
// Dev:   npx electron electron/main.cjs   (after `npm run build`, loads dist/)
// Pack:  see STEAM.md — electron-builder targets win (nsis) + mac (dmg/zip)
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Steam integration (uncomment once steamworks.js is installed & steam_appid.txt exists)
// let steamworks = null;
// try {
//   steamworks = require('steamworks.js');
//   const client = steamworks.init(480); // replace 480 with your real AppID
//   console.log('[steam] logged in as', client.localplayer.getName());
// } catch (e) { console.warn('[steam] not available:', e.message); }

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0b0e14',
    fullscreenable: true,
    autoHideMenuBar: true,
    title: 'J.O.B — Just Obey Business',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.removeMenu();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
