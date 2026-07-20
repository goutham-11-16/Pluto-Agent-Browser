const { app, BrowserWindow, BrowserView, ipcMain, session, Menu, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');

/* ── Pre-flight: kill any process holding port 9222 before Electron binds ── */
/* This prevents the "bind() error: Only one usage of each socket address"    */
/* that causes 30-60 second CDP connection timeouts when stale Chrome/Electron */
/* processes hold the port from previous runs.                                 */
try {
  if (process.platform === 'win32') {
    // Find PID holding port 9222 and kill it
    const out = execSync('netstat -ano | findstr :9222 | findstr LISTEN', { encoding: 'utf8', timeout: 3000 }).trim();
    if (out) {
      const lines = out.split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1]);
        if (pid && pid !== process.pid) pids.add(pid);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 }); } catch {}
      }
      if (pids.size > 0) console.log(`[startup] Killed ${pids.size} stale process(es) on port 9222`);
    }
  }
} catch {
  // No process on 9222 — this is the normal/expected case
}

/* ── Configure remote debugging port for agent connectivity ── */
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-allow-origins', '*');

/* ── State ──────────────────────────────────────────────────── */
let mainWindow         = null;
let backendProc        = null;
let activePopupWin     = null;
let adBlockerEngine    = null;

let tabs               = [];      // { id, view, title, url, favicon }
let activeTabId        = null;
let nextTabId          = 1;

let sidebarOpen        = true;
let sidebarWidth       = 380;
let verticalTabsOpen   = false;
let verticalTabsWidth  = 48; // 48 collapsed, 220 expanded

let shieldsEnabled     = true;
let tabShieldStats     = {}; // tabId -> { trackers, bandwidth }

let agentRunning       = false;
let agentGlowEnabled   = false;

const HEADER_HEIGHT    = 87;  // tab-strip-row(40) + navigation-bar-row(47)
const STATUSBAR_HEIGHT = 26;
const BACKEND_PORT     = 18420;

/* ── High-Performance Ghostery / EasyList Adblocking Engine ── */
async function setupShieldsEngine() {
  try {
    console.log('[shields] Initializing full EasyList + EasyPrivacy + uBlock adblocking engine...');
    adBlockerEngine = await ElectronBlocker.fromPrebuiltFull(fetch);
    
    if (shieldsEnabled) {
      adBlockerEngine.enableBlockingInSession(session.defaultSession);
      console.log('[shields] Adblocker engine active on default session.');
    }

    adBlockerEngine.on('request-blocked', (req) => {
      console.log('[shields] Blocked ad/tracker:', req.url);
      const activeTab = getActiveTab();
      if (activeTab) {
        if (!tabShieldStats[activeTab.id]) {
          tabShieldStats[activeTab.id] = { trackers: 0, bandwidth: 0 };
        }
        tabShieldStats[activeTab.id].trackers += 1;
        tabShieldStats[activeTab.id].bandwidth += 45 * 1024;
        sendTabUpdate(activeTab);
      }
    });
  } catch (err) {
    console.error('[shields] Error initializing adblocking engine:', err);
  }
}

/* ── Backend ────────────────────────────────────────────────── */
function startBackend() {
  const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (res) => {
    if (res.statusCode === 200) {
      console.log(`[shell] Backend is already running and healthy on port ${BACKEND_PORT}.`);
    } else {
      spawnBackendProcess();
    }
  });

  req.on('error', () => {
    spawnBackendProcess();
  });
}

function spawnBackendProcess() {
  let py = process.platform === 'win32' ? 'python' : 'python3';
  
  const winVenv = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  const nixVenv = path.join(__dirname, '..', '.venv', 'bin', 'python');
  
  if (process.platform === 'win32' && fs.existsSync(winVenv)) {
    py = winVenv;
  } else if (process.platform !== 'win32' && fs.existsSync(nixVenv)) {
    py = nixVenv;
  }

  console.log(`[shell] Spawning backend using python interpreter: ${py}`);
  const serverPath = path.join(__dirname, 'backend', 'server.py');
  backendProc = spawn(py, ['-u', serverPath], {
    env: { ...process.env, PLUTO_PORT: String(BACKEND_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProc.stdout.on('data', d => console.log('[backend]', d.toString().trim()));
  backendProc.stderr.on('data', d => console.error('[backend]', d.toString().trim()));
  backendProc.on('close', code => console.log('[backend] exited', code));
}

/* ── Window ─────────────────────────────────────────────────── */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#18191E',
    icon: path.join(__dirname, 'renderer', 'assets', 'Pluto.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize',     () => layoutViews());
  mainWindow.on('maximize',   () => layoutViews());
  mainWindow.on('unmaximize', () => layoutViews());
  mainWindow.on('move',       () => closeActivePopup());
  mainWindow.on('closed',     () => { mainWindow = null; });

  Menu.setApplicationMenu(null);
  setupShortcuts(mainWindow.webContents);
}

/* ── Keyboard Shortcuts Engine ───────────────────────────────── */
function switchRelativeTab(direction) {
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex(t => t.id === activeTabId);
  if (currentIndex === -1) return;
  let nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  switchTab(tabs[nextIndex].id);
}

function setupShortcuts(contents) {
  if (!contents) return;
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const isCtrl = input.control || input.meta;
    const isShift = input.shift;
    const isAlt = input.alt;
    const key = (input.key || '').toLowerCase();

    // Ctrl + T: New Tab
    if (isCtrl && !isShift && key === 't') {
      event.preventDefault();
      createTab('pluto://newtab');
    }
    // Ctrl + W: Close Active Tab
    else if (isCtrl && !isShift && key === 'w') {
      event.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }
    // Ctrl + R / F5: Reload Tab
    else if ((isCtrl && key === 'r') || key === 'f5') {
      event.preventDefault();
      const tab = getActiveTab();
      if (tab) tab.view.webContents.reload();
    }
    // Ctrl + L / Alt + D: Focus Omnibox
    else if ((isCtrl && key === 'l') || (isAlt && key === 'd')) {
      event.preventDefault();
      if (mainWindow) mainWindow.webContents.send('focus-omnibox');
    }
    // Ctrl + Tab / Ctrl + PageDown: Next Tab
    else if ((isCtrl && key === 'tab' && !isShift) || (isCtrl && key === 'pagedown')) {
      event.preventDefault();
      switchRelativeTab(1);
    }
    // Ctrl + Shift + Tab / Ctrl + PageUp: Previous Tab
    else if ((isCtrl && key === 'tab' && isShift) || (isCtrl && key === 'pageup')) {
      event.preventDefault();
      switchRelativeTab(-1);
    }
    // Ctrl + 1-9: Jump to Tab N
    else if (isCtrl && input.code && input.code.startsWith('Digit')) {
      const num = parseInt(input.code.replace('Digit', ''), 10);
      if (num >= 1 && num <= 9) {
        event.preventDefault();
        const index = num === 9 ? tabs.length - 1 : num - 1;
        if (tabs[index]) switchTab(tabs[index].id);
      }
    }
    // Ctrl + , : Settings
    else if (isCtrl && key === ',') {
      event.preventDefault();
      createTab('pluto://settings');
    }
    // F12 / Ctrl + Shift + I: DevTools
    else if (key === 'f12' || (isCtrl && isShift && key === 'i')) {
      event.preventDefault();
      const tab = getActiveTab();
      if (tab) tab.view.webContents.toggleDevTools();
    }
    // Alt + Left: Go Back
    else if (isAlt && key === 'arrowleft') {
      event.preventDefault();
      const tab = getActiveTab();
      if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
    }
    // Alt + Right: Go Forward
    else if (isAlt && key === 'arrowright') {
      event.preventDefault();
      const tab = getActiveTab();
      if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
    }
  });
}

/* ── View Layout (Dynamic Pixel-Snapping) ───────────────────── */
function layoutViews() {
  if (!mainWindow) return;
  const [winW, winH] = mainWindow.getContentSize();
  const sw = sidebarOpen ? sidebarWidth : 0;
  const vtw = verticalTabsOpen ? verticalTabsWidth : 0;

  let x = vtw;
  let y = HEADER_HEIGHT;
  let w = Math.max(winW - sw - vtw, 100);
  let h = Math.max(winH - HEADER_HEIGHT - STATUSBAR_HEIGHT, 100);

  // If the agent is running and glow feedback is enabled, shrink BrowserView slightly (3px)
  // to expose the underlying container's breathing blue gradient glow.
  if (agentRunning && agentGlowEnabled) {
    x += 3;
    y += 3;
    w -= 6;
    h -= 6;
  }

  tabs.forEach(tab => {
    if (tab.id === activeTabId) {
      tab.view.setBounds({ x, y, width: w, height: h });
      tab.view.setAutoResize({ width: false, height: false });
    }
  });
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

/* ── Floating Popup Windows (Renders 100% OVER BrowserViews) ── */
function closeActivePopup() {
  if (activePopupWin && !activePopupWin.isDestroyed()) {
    activePopupWin.close();
    activePopupWin = null;
  }
}

function openPopup(type, bounds) {
  closeActivePopup();

  const popupFile = path.join(__dirname, 'renderer', 'popups', `${type}.html`);
  if (!fs.existsSync(popupFile)) return;

  const width = bounds.width || 340;
  const height = bounds.height || 420;
  
  const [winX, winY] = mainWindow.getPosition();
  const posX = Math.min(winX + bounds.x, winX + mainWindow.getBounds().width - width - 12);
  const posY = winY + bounds.y;

  activePopupWin = new BrowserWindow({
    width: width,
    height: height,
    x: posX,
    y: posY,
    parent: mainWindow,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  activePopupWin.loadFile(popupFile);
  activePopupWin.once('ready-to-show', () => activePopupWin.show());
  activePopupWin.on('blur', () => closeActivePopup());
}

/* ── Tab Management ─────────────────────────────────────────── */
function createTab(url = 'pluto://newtab') {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload-webview.js'),
    },
  });

  setupShortcuts(view.webContents);

  const isInternal = url.startsWith('pluto://');
  if (isInternal) {
    const page = url.replace('pluto://', '');
    view.webContents.loadFile(path.join(__dirname, 'renderer', 'pages', `${page}.html`));
  } else {
    view.webContents.loadURL(url);
  }

  /* Track navigation */
  view.webContents.on('did-navigate', (_e, navUrl) => {
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      tab.url = navUrl;
      sendTabUpdate(tab);
      sendTabList();
      checkCodeChef(navUrl);
    }
  });

  view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      tab.url = navUrl;
      sendTabUpdate(tab);
      sendTabList();
      checkCodeChef(navUrl);
    }
  });

  view.webContents.on('page-title-updated', (_e, title) => {
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      tab.title = title;
      sendTabUpdate(tab);
      sendTabList();
    }
  });

  view.webContents.on('page-favicon-updated', (_e, favicons) => {
    const tab = tabs.find(t => t.id === id);
    if (tab && favicons.length) {
      tab.favicon = favicons[0];
      sendTabUpdate(tab);
      sendTabList();
    }
  });

  /* Handle new-window requests */
  view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    createTab(openUrl);
    switchTab(nextTabId - 1);
    return { action: 'deny' };
  });

  const tabInfo = { id, view, title: isInternal ? 'New Tab' : url, url, favicon: null };
  tabs.push(tabInfo);
  tabShieldStats[id] = { trackers: 0, bandwidth: 0 };
  mainWindow.addBrowserView(view);

  switchTab(id);
  sendTabList();
  return id;
}

function checkCodeChef(url) {
  if (!mainWindow) return;
  const isCodeChef = url.includes('codechef.com');
  mainWindow.webContents.send('codechef:detected', isCodeChef);
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);
  delete tabShieldStats[id];

  if (tabs.length === 0) {
    createTab();
  } else if (activeTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[newIdx].id);
  }
  sendTabList();
}

function switchTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  tabs.forEach(t => {
    if (t.id === id) {
      mainWindow.setTopBrowserView(t.view);
    }
  });
  activeTabId = id;
  layoutViews();
  sendTabUpdate(tab);
  sendTabList();
}

/* ── IPC → Renderer Updates ─────────────────────────────────── */
function sendTabList() {
  if (!mainWindow) return;
  const list = tabs.map(t => ({
    id: t.id,
    title: t.title || 'Loading...',
    url: t.url,
    favicon: t.favicon,
    active: t.id === activeTabId,
  }));
  mainWindow.webContents.send('tabs:list', list);
}

function sendTabUpdate(tab) {
  if (!mainWindow) return;
  const canGoBack = tab.view.webContents.navigationHistory ? tab.view.webContents.navigationHistory.canGoBack() : tab.view.webContents.canGoBack();
  const canGoForward = tab.view.webContents.navigationHistory ? tab.view.webContents.navigationHistory.canGoForward() : tab.view.webContents.canGoForward();
  const stats = tabShieldStats[tab.id] || { trackers: 0, bandwidth: 0 };

  mainWindow.webContents.send('tab:updated', {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
    active: tab.id === activeTabId,
    canGoBack: canGoBack,
    canGoForward: canGoForward,
    shieldsStats: stats,
  });
}

/* ── IPC Handlers ───────────────────────────────────────────── */
ipcMain.handle('tab:create',   (_e, url)  => createTab(url));
ipcMain.handle('tab:close',    (_e, id)   => closeTab(id));
ipcMain.handle('tab:switch',   (_e, id)   => switchTab(id));
ipcMain.handle('tab:navigate', (_e, url) => {
  const tab = getActiveTab();
  if (!tab) return;
  if (url.startsWith('pluto://')) {
    const page = url.replace('pluto://', '');
    tab.view.webContents.loadFile(path.join(__dirname, 'renderer', 'pages', `${page}.html`));
  } else if (!/^https?:\/\//i.test(url) && !url.includes('://')) {
    tab.view.webContents.loadURL(`https://www.google.com/search?q=${encodeURIComponent(url)}`);
  } else {
    tab.view.webContents.loadURL(url);
  }
});

ipcMain.handle('popup:open', (_e, type, bounds) => openPopup(type, bounds));

ipcMain.handle('vtabs:set', (_e, open, width) => {
  verticalTabsOpen = open;
  if (width) verticalTabsWidth = width;
  layoutViews();
});

ipcMain.handle('sidebar:resize', (_e, width) => {
  sidebarWidth = width;
  layoutViews();
});

ipcMain.handle('shields:toggle', (_e, enabled) => {
  if (enabled !== undefined) shieldsEnabled = enabled;
  else shieldsEnabled = !shieldsEnabled;
  
  if (adBlockerEngine) {
    if (shieldsEnabled) adBlockerEngine.enableBlockingInSession(session.defaultSession);
    else adBlockerEngine.disableBlockingInSession(session.defaultSession);
  }
  return shieldsEnabled;
});

ipcMain.handle('shields:get-stats', () => {
  const tab = getActiveTab();
  if (!tab) return { trackers: 0, bandwidth: 0 };
  return tabShieldStats[tab.id] || { trackers: 0, bandwidth: 0 };
});

ipcMain.handle('nav:back',    () => { const t = getActiveTab(); t?.view.webContents.goBack(); });
ipcMain.handle('nav:forward', () => { const t = getActiveTab(); t?.view.webContents.goForward(); });
ipcMain.handle('nav:reload',  () => { const t = getActiveTab(); t?.view.webContents.reload(); });
ipcMain.handle('nav:stop',    () => { const t = getActiveTab(); t?.view.webContents.stop(); });

ipcMain.handle('sidebar:toggle', () => {
  sidebarOpen = !sidebarOpen;
  layoutViews();
  return sidebarOpen;
});

ipcMain.handle('sidebar:state', () => sidebarOpen);
ipcMain.handle('agent:state', (_e, isRunning, glowEnabled) => {
  agentRunning = isRunning;
  agentGlowEnabled = glowEnabled;
  layoutViews();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());

ipcMain.handle('app:get-backend-port', () => BACKEND_PORT);

ipcMain.handle('app:get-skills', async () => {
  try {
    const skillsDir = path.join(__dirname, '..', '.agents', 'skills');
    if (!fs.existsSync(skillsDir)) return [];
    const folders = fs.readdirSync(skillsDir);
    const skills = [];
    for (const f of folders) {
      const skillPath = path.join(skillsDir, f, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, 'utf8');
        let name = '/' + f;
        let description = 'Custom skill module';
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match) {
          const lines = match[1].split('\n');
          for (const l of lines) {
            if (l.trim().startsWith('name:')) {
              name = l.split('name:')[1].trim();
            }
            if (l.trim().startsWith('description:')) {
              description = l.split('description:')[1].trim().replace(/^['"]|['"]$/g, '');
            }
          }
        }
        skills.push({ name, description });
      }
    }
    return skills;
  } catch (e) {
    console.error('[skills scan error]', e);
    return [];
  }
});

ipcMain.handle('tab:get-active-url', () => {
  const tab = getActiveTab();
  return tab ? tab.url : '';
});

ipcMain.handle('tab:get-page-content', async () => {
  const tab = getActiveTab();
  if (!tab) return '';
  try {
    return await tab.view.webContents.executeJavaScript(
      `document.body.innerText.substring(0, 8000)`
    );
  } catch { return ''; }
});

/* ── App Lifecycle ──────────────────────────────────────────── */
app.whenReady().then(() => {
  startBackend();
  setupShieldsEngine();
  createWindow();
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    createTab();
  });
});

app.on('window-all-closed', () => {
  if (backendProc) backendProc.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (backendProc) backendProc.kill();
});
