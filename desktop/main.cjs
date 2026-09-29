/**
 * PINGO for Windows.
 *
 * A window onto the live app, not a copy of it: every web deploy reaches the
 * desktop the moment it ships, with no installer to rebuild. What this file
 * adds is what a browser tab cannot be - its own window, taskbar icon, Start
 * menu entry and `pingo://` link.
 *
 * ## Google sign-in goes through the real browser
 *
 * Google refuses to sign anybody in inside an embedded window. So the sign-in
 * page is opened in the default browser instead; Google and Supabase send it
 * back to /auth/google?code=..., and that page - finding no sign-in of its own
 * to finish - hands the code to `pingo://auth`. Windows passes that link here,
 * and loading /auth/google?code=... in this window finishes the sign-in with
 * the PKCE verifier this window stored when it started. See index.html.
 */
const { app, BrowserWindow, shell, session, Menu } = require('electron');
const path = require('node:path');

const APP = 'https://pingochat.pages.dev';
const AUTHORIZE = 'https://gpijpmepzowwhvgkriqu.supabase.co/auth/v1/authorize';

let win;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Registered by the installer too; this covers a copy that was just unzipped.
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient('pingo', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('pingo');
  }

  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith('pingo://'));
    if (link) openLink(link);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Without this Windows names notifications "electron.app.PINGO".
    app.setAppUserModelId('chat.pingo.desktop');
    Menu.setApplicationMenu(null);
    allowWhatTheAppNeeds();
    createWindow();
    const link = process.argv.find((arg) => arg.startsWith('pingo://'));
    if (link) openLink(link);
  });

  app.on('window-all-closed', () => app.quit());
}

/** `pingo://auth?code=...` finishes a sign-in; any other `pingo://x/y` opens /x/y. */
function openLink(link) {
  if (!win) return;
  let url;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  const route = url.host === 'auth' ? '/auth/google' : `/${url.host}${url.pathname}`.replace(/\/+$/, '') || '/chats';
  win.loadURL(`${APP}${route}${url.search}`);
}

function isApp(url) {
  return url === APP || url.startsWith(`${APP}/`);
}

function openOutside(url) {
  if (/^(https?|mailto|tel):/i.test(url)) void shell.openExternal(url);
}

/**
 * Camera, microphone, notifications and the clipboard - for PINGO's own pages
 * only. Everything else a page might ask for is refused.
 */
function allowWhatTheAppNeeds() {
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isApp(contents.getURL()) && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    return Boolean(contents && isApp(contents.getURL()) && allowed.has(permission));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'PINGO',
    backgroundColor: '#FBFBFE',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  const contents = win.webContents;

  // New windows (a link with target=_blank) open in the browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(AUTHORIZE)) {
      openOutside(url);
      return { action: 'deny' };
    }
    if (!isApp(url)) openOutside(url);
    return { action: 'deny' };
  });

  // Leaving PINGO - including for Google's sign-in - happens in the browser.
  const keepInside = (event, url) => {
    if (isApp(url)) return;
    event.preventDefault();
    openOutside(url);
  };
  contents.on('will-navigate', keepInside);
  contents.on('will-redirect', keepInside);

  // No connection on the very first launch: say so, and try again.
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    const page = `<!doctype html><meta charset="utf-8"><title>PINGO</title>
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#FBFBFE;font:15px system-ui;color:#555">
      <div style="text-align:center"><b style="font-size:20px;color:#222">PINGO needs the internet</b>
      <p>Trying again in a moment…</p></div>
      <script>setTimeout(() => location.replace(${JSON.stringify(url || APP + '/chats')}), 5000)</script>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  });

  void win.loadURL(`${APP}/chats`);
}
