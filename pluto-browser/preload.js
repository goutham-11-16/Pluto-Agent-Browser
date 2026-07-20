const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plutoAPI', {
  /* Tab Management */
  createTab:    (url)  => ipcRenderer.invoke('tab:create', url),
  closeTab:     (id)   => ipcRenderer.invoke('tab:close', id),
  switchTab:    (id)   => ipcRenderer.invoke('tab:switch', id),
  navigateTo:   (url)  => ipcRenderer.invoke('tab:navigate', url),
  getActiveUrl: ()     => ipcRenderer.invoke('tab:get-active-url'),
  getPageContent: ()   => ipcRenderer.invoke('tab:get-page-content'),

  /* Floating Popups & Layout */
  openPopup:       (type, bounds) => ipcRenderer.invoke('popup:open', type, bounds),
  setVerticalTabs: (open, width)  => ipcRenderer.invoke('vtabs:set', open, width),
  resizeSidebar:   (width)       => ipcRenderer.invoke('sidebar:resize', width),

  /* Pluto Shields Adblock Engine */
  toggleShields:   (enabled)     => ipcRenderer.invoke('shields:toggle', enabled),
  getShieldsStats: ()            => ipcRenderer.invoke('shields:get-stats'),

  /* Navigation */
  goBack:    () => ipcRenderer.invoke('nav:back'),
  goForward: () => ipcRenderer.invoke('nav:forward'),
  reload:    () => ipcRenderer.invoke('nav:reload'),
  stop:      () => ipcRenderer.invoke('nav:stop'),

  /* Sidebar */
  toggleSidebar: () => ipcRenderer.invoke('sidebar:toggle'),
  getSidebarState: () => ipcRenderer.invoke('sidebar:state'),
  setAgentState: (isRunning, glowEnabled) => ipcRenderer.invoke('agent:state', isRunning, glowEnabled),

  /* Window Controls & Private Windows */
  createNewWindow: () => ipcRenderer.invoke('window:create-new'),
  createIncognitoWindow: () => ipcRenderer.invoke('window:create-incognito'),
  toggleVerticalTabs: () => ipcRenderer.invoke('vtabs:toggle'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close:    () => ipcRenderer.invoke('window:close'),

  /* Backend & Skills */
  getBackendPort: () => ipcRenderer.invoke('app:get-backend-port'),
  getSkills:      () => ipcRenderer.invoke('app:get-skills'),

  /* History API & Autocomplete */
  getHistory:        () => ipcRenderer.invoke('history:get'),
  searchHistory:     (query) => ipcRenderer.invoke('history:search', query),
  deleteHistoryItem: (idOrUrl) => ipcRenderer.invoke('history:delete', idOrUrl),
  clearHistory:      () => ipcRenderer.invoke('history:clear'),
  showAutocomplete:  (query, bounds) => ipcRenderer.invoke('autocomplete:show', { query, bounds }),
  closeAutocomplete: () => ipcRenderer.invoke('autocomplete:close'),
  onAutocompleteData:(cb) => ipcRenderer.on('autocomplete:update', (_e, data) => cb(data)),

  /* Event Listeners */
  onTabsUpdated: (cb) => {
    ipcRenderer.on('tabs:list', (_e, list) => cb(list));
  },
  onTabUpdated: (cb) => {
    ipcRenderer.on('tab:updated', (_e, info) => cb(info));
  },
  onCodeChefDetected: (cb) => {
    ipcRenderer.on('codechef:detected', (_e, isDetected) => cb(isDetected));
  },
  onFocusOmnibox: (cb) => {
    ipcRenderer.on('focus-omnibox', () => cb());
  },
  onTabLoading: (cb) => {
    ipcRenderer.on('tab:loading', (_e, info) => cb(info));
  },
});
