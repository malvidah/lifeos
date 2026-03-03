const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

const APP_URL  = 'https://daylab.me';
const PROTOCOL = 'dayloop';

app.setAsDefaultProtocolClient(PROTOCOL);

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0D0C10',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  win.loadURL(APP_URL);
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(PROTOCOL + '://')) {
      event.preventDefault();
      win.loadURL(APP_URL + url.slice(PROTOCOL.length + 2));
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (win && url.startsWith(PROTOCOL + '://')) {
    win.loadURL(APP_URL + url.slice(PROTOCOL.length + 2));
    win.focus();
  }
});

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': 'DayLab/1.0 Electron' } });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
