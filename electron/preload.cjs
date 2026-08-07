// Bridge between the game (renderer) and Electron/Steam (main).
// Kept intentionally tiny — the game must keep working in a plain browser.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('JOB_SHELL', {
  isElectron: true,
  platform: process.platform,
  // future: steam lobby invites, achievements, rich presence…
});
