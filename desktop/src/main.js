const { app, BrowserWindow, shell, protocol, session } = require('electron');
const path = require('path');

// Replace with your live URL (e.g. 'https://dayloop.app')
const APP_URL = 'https://lifeos-malvidah.vercel.app';

// Custom protocol so OAuth can redirect back into the app
// Supabase callback: dayloop://auth/callback?code=...
const PROTOCOL = 'dayloop';

app.setAsDefaultProtocolClient(PROTOCOL);

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',   // native traffic lights, no title text
    vibrancy: 'under-window',       // macOS blur behind window content
    visualEffectState: 'active',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#00000000',   // transparent so vibrancy shows
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // wait for ready-to-show to avoid flash
  });

  win.loadURL(APP_URL);

  // Show only once fully loaded — no white flash
  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in the system browser, not in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Handle OAuth redirect back into the app
  // Supabase redirects to dayloop://auth/callback?code=...
  // We translate that into a page load inside the app window
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(PROTOCOL + '://')) {
      event.preventDefault();
      const translated = APP_URL + url.slice(PROTOCOL.length + 2); // strip 'dayloop:/'
      win.loadURL(translated);
    }
  });
}

// macOS: handle protocol redirect from OS when app is already open
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (win && url.startsWith(PROTOCOL + '://')) {
    const translated = APP_URL + url.slice(PROTOCOL.length + 2);
    win.loadURL(translated);
    win.focus();
  }
});

app.whenReady().then(() => {
  // Allow the app to use cookies from the web app (needed for Supabase auth)
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': 'DayLoop/1.0 Electron' } });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
