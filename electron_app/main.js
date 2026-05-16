const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

let win;

app.disableHardwareAcceleration();

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 380,
    height: 500,
    x: screenWidth - 400,
    y: screenHeight - 520,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile('overlay.html');

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
