/* ═══════════════════════════════════════════════════════════════
   PLUTO — Browser Shell Controller
   Shields, Rewards, Wallet, Vertical Tabs, Navigation & Shortcuts
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /* ── DOM References ──────────────────────────────────────── */
  const tabstrip        = $('#tabstrip');
  const btnNewTab       = $('#btn-new-tab');
  const addressInput    = $('#address-input');
  const lockIcon        = $('#lock-icon');

  const btnBack         = $('#btn-back');
  const btnForward      = $('#btn-forward');
  const btnReload       = $('#btn-reload');
  const btnHome         = $('#btn-home');
  const btnSettings     = $('#btn-settings');
  const btnSidebar      = $('#btn-sidebar');

  const btnMinimize     = $('#btn-minimize');
  const btnMaximize     = $('#btn-maximize');
  const btnClose        = $('#btn-close');

  /* Popups & Action Buttons */
  const btnShields      = $('#btn-pluto-shields');
  const btnRewards      = $('#btn-pluto-rewards');
  const btnWallet       = $('#btn-pluto-wallet');
  const btnExtensions   = $('#btn-extensions');
  const btnMoreActions  = $('#btn-more-actions');

  const btnToggleVtabs  = $('#btn-toggle-vtabs');
  const menuVtabsToggle = $('#menu-vtabs-toggle');
  const tabstripV       = $('#tabstrip-vertical');
  const vtabList        = $('#vtab-list');
  const btnVtabNew      = $('#btn-vtab-new');

  /* ── State ───────────────────────────────────────────────── */
  let tabsList = [];
  let currentActiveId = null;
  let isVerticalTabs = false;
  /* ── Focus Omnibox Listener ───────────────────────────────── */
  if (window.plutoAPI && window.plutoAPI.onFocusOmnibox) {
    window.plutoAPI.onFocusOmnibox(() => {
      if (addressInput) {
        addressInput.focus();
        addressInput.select();
      }
    });
  }

  /* ── Tab Rendering (Horizontal & Vertical) ────────────────── */
  function renderTabs(list) {
    tabsList = list;
    
    /* 1. Horizontal Tabstrip Render */
    tabstrip.querySelectorAll('.tab').forEach(el => el.remove());

    /* 2. Vertical Tabstrip Render */
    if (vtabList) vtabList.innerHTML = '';

    list.forEach(tab => {
      /* Horizontal Tab */
      const el = document.createElement('div');
      el.className = `tab ${tab.active ? 'active' : ''}`;
      el.dataset.id = tab.id;

      const favicon = tab.favicon
        ? `<img class="tab-favicon" src="${escapeAttr(tab.favicon)}" alt="">`
        : `<div class="tab-favicon-placeholder"></div>`;

      el.innerHTML = `
        ${favicon}
        <span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
        <button class="tab-close" data-close="${tab.id}" title="Close Tab">
          <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) return;
        plutoAPI.switchTab(tab.id);
      });

      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        plutoAPI.closeTab(tab.id);
      });

      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          plutoAPI.closeTab(tab.id);
        }
      });

      tabstrip.insertBefore(el, btnNewTab);

      /* Vertical Tab */
      if (vtabList) {
        const vel = document.createElement('div');
        vel.className = `tab ${tab.active ? 'active' : ''}`;
        vel.style.width = '100%';
        vel.dataset.id = tab.id;
        vel.innerHTML = `
          ${favicon}
          <span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
          <button class="tab-close" title="Close Tab">
            <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        `;
        vel.addEventListener('click', (e) => {
          if (e.target.closest('.tab-close')) return;
          plutoAPI.switchTab(tab.id);
        });
        vel.querySelector('.tab-close').addEventListener('click', (e) => {
          e.stopPropagation();
          plutoAPI.closeTab(tab.id);
        });
        vtabList.appendChild(vel);
      }

      if (tab.active) currentActiveId = tab.id;
    });
  }

  /* ── Address Bar Update ──────────────── */
  function updateAddressBar(info) {
    if (!info.active) return;

    const url = info.url || '';
    if (document.activeElement !== addressInput) {
      addressInput.value = prettifyUrl(url);
    }

    /* Lock Icon */
    if (url.startsWith('https://')) {
      lockIcon.style.fill = 'var(--pluto-color-lime)';
      lockIcon.style.display = '';
    } else if (url.startsWith('http://')) {
      lockIcon.style.fill = 'var(--pluto-text-tertiary)';
      lockIcon.style.display = '';
    } else {
      lockIcon.style.display = 'none';
    }

    /* Update Active Tab Title & Favicon in Tabstrip */
    const activeTabEl = tabstrip.querySelector(`.tab[data-id="${info.id}"]`);
    if (activeTabEl && info.title) {
      const titleEl = activeTabEl.querySelector('.tab-title');
      if (titleEl) titleEl.textContent = info.title;
      if (info.favicon) {
        let favEl = activeTabEl.querySelector('.tab-favicon');
        if (!favEl) {
          const ph = activeTabEl.querySelector('.tab-favicon-placeholder');
          if (ph) ph.remove();
          favEl = document.createElement('img');
          favEl.className = 'tab-favicon';
          activeTabEl.insertBefore(favEl, titleEl);
        }
        favEl.src = info.favicon;
      }
    }

    /* Shields Badge Simulation */
    const badgeEl = $('#shields-badge');
    if (badgeEl) {
      const count = (info.shieldsStats && info.shieldsStats.trackers) ? info.shieldsStats.trackers : Math.floor(Math.abs(hashCode(url)) % 45) + 6;
      badgeEl.textContent = count;
    }

    btnBack.classList.toggle('disabled', !info.canGoBack);
    btnForward.classList.toggle('disabled', !info.canGoForward);
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  /* ── Navigation Handlers ─────────────────────────────────── */
  btnBack.addEventListener('click', () => plutoAPI.goBack());
  btnForward.addEventListener('click', () => plutoAPI.goForward());
  btnReload.addEventListener('click', () => plutoAPI.reload());
  btnHome.addEventListener('click', () => plutoAPI.navigateTo('pluto://newtab'));
  btnNewTab.addEventListener('click', () => plutoAPI.createTab());
  if (btnVtabNew) btnVtabNew.addEventListener('click', () => plutoAPI.createTab());

  /* Omnibox Address Submit */
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = addressInput.value.trim();
      if (!input) return;

      let url = input;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        if (/^[\w-]+(\.[\w-]+)+/.test(url) && !url.includes(' ')) {
          url = 'https://' + url;
        } else {
          url = 'https://www.google.com/search?q=' + encodeURIComponent(input);
        }
      }
      plutoAPI.navigateTo(url);
      addressInput.blur();
    }
  });

  addressInput.addEventListener('focus', () => {
    setTimeout(() => addressInput.select(), 50);
  });

  /* Bookmark Star Toggle */
  const btnBookmarkStar = $('#btn-bookmark-star');
  if (btnBookmarkStar) {
    btnBookmarkStar.addEventListener('click', () => {
      btnBookmarkStar.classList.toggle('bookmarked');
    });
  }

  /* ── Settings Button ─────────────────────────────────────── */
  btnSettings.addEventListener('click', () => {
    plutoAPI.navigateTo('pluto://settings');
  });

  /* ── Vertical Tabs Toggle Logic ──────────────────────────── */
  function toggleVerticalTabs() {
    isVerticalTabs = !isVerticalTabs;
    if (tabstripV) tabstripV.classList.toggle('hidden', !isVerticalTabs);
    if (btnToggleVtabs) btnToggleVtabs.classList.toggle('active', isVerticalTabs);
    if (tabstrip) tabstrip.style.display = isVerticalTabs ? 'none' : 'flex';
    plutoAPI.setVerticalTabs(isVerticalTabs, 48);
  }

  if (btnToggleVtabs) btnToggleVtabs.addEventListener('click', toggleVerticalTabs);
  if (menuVtabsToggle) menuVtabsToggle.addEventListener('click', toggleVerticalTabs);

  /* Hover Expansion for Vertical Tabs */
  if (tabstripV) {
    tabstripV.addEventListener('mouseenter', () => {
      if (isVerticalTabs) plutoAPI.setVerticalTabs(true, 220);
    });
    tabstripV.addEventListener('mouseleave', () => {
      if (isVerticalTabs) plutoAPI.setVerticalTabs(true, 48);
    });
  }

  /* ── Native Floating Popups Trigger Handlers ────────────────── */
  function getButtonBounds(btn, width = 340, height = 420) {
    const r = btn.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2 - width / 2),
      y: Math.round(r.bottom + 6),
      width: width,
      height: height,
    };
  }

  if (btnShields) {
    btnShields.addEventListener('click', (e) => {
      e.stopPropagation();
      plutoAPI.openPopup('shields', getButtonBounds(btnShields, 340, 420));
    });
  }

  if (btnRewards) {
    btnRewards.addEventListener('click', (e) => {
      e.stopPropagation();
      plutoAPI.openPopup('rewards', getButtonBounds(btnRewards, 320, 240));
    });
  }

  if (btnWallet) {
    btnWallet.addEventListener('click', (e) => {
      e.stopPropagation();
      plutoAPI.openPopup('wallet', getButtonBounds(btnWallet, 320, 340));
    });
  }

  if (btnExtensions) {
    btnExtensions.addEventListener('click', (e) => {
      e.stopPropagation();
      plutoAPI.openPopup('extensions', getButtonBounds(btnExtensions, 280, 160));
    });
  }

  if (btnMoreActions) {
    btnMoreActions.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = btnMoreActions.getBoundingClientRect();
      plutoAPI.openPopup('menu', {
        x: Math.round(r.right - 260),
        y: Math.round(r.bottom + 6),
        width: 260,
        height: 380,
      });
    });
  }

  /* ── AI Sidebar Toggle & Resizing ────────────────────────── */
  const sidebarToggleHandle = $('#sidebar-toggle-handle');
  const sidebarEl = $('#sidebar');
  const sidebarResizeEl = $('#sidebar-resize');

  const toggleSidebarFunc = async () => {
    const isOpen = await plutoAPI.toggleSidebar();
    btnSidebar.classList.toggle('active', isOpen);
    sidebarEl.classList.toggle('collapsed', !isOpen);
    if (sidebarToggleHandle) {
      const icon = sidebarToggleHandle.querySelector('svg');
      if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  };

  btnSidebar.addEventListener('click', toggleSidebarFunc);
  if (sidebarToggleHandle) sidebarToggleHandle.addEventListener('click', toggleSidebarFunc);

  /* Draggable Sidebar Resizer */
  if (sidebarResizeEl && sidebarEl) {
    let isResizing = false;
    sidebarResizeEl.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(280, Math.min(600, window.innerWidth - e.clientX));
      sidebarEl.style.width = `${newWidth}px`;
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
      plutoAPI.resizeSidebar(newWidth);
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
      }
    });
  }

  /* ── CodeChef Auto-detect Listener ───────────────────────── */
  if (plutoAPI.onCodeChefDetected) {
    plutoAPI.onCodeChefDetected((isDetected) => {
      const card = $('#codechef-suggestion');
      if (card) card.classList.toggle('hidden', !isDetected);
    });
  }

  const btnCodeChefSolve = $('#btn-run-codechef-auto');
  if (btnCodeChefSolve) {
    btnCodeChefSolve.addEventListener('click', () => {
      const chatInput = $('#chat-input');
      const sendBtn = $('#btn-send');
      if (chatInput && sendBtn) {
        chatInput.value = '/codechef Solve current learning module including MCQs, coding challenges, and submit solutions';
        sendBtn.click();
      }
    });
  }

  /* Window Controls */
  btnMinimize.addEventListener('click', () => plutoAPI.minimize());
  btnMaximize.addEventListener('click', () => plutoAPI.maximize());
  btnClose.addEventListener('click', () => plutoAPI.close());

  /* Keyboard Shortcuts */
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 't') { e.preventDefault(); plutoAPI.createTab(); }
    if (ctrl && e.key === 'w') { e.preventDefault(); if (currentActiveId) plutoAPI.closeTab(currentActiveId); }
    if (ctrl && e.key === 'l') { e.preventDefault(); addressInput.focus(); }
    if (e.key === 'F5')        { e.preventDefault(); plutoAPI.reload(); }
    if (ctrl && e.key === 'r') { e.preventDefault(); plutoAPI.reload(); }
    if (ctrl && e.key === 'h') { e.preventDefault(); plutoAPI.navigateTo('pluto://history'); }

    if (ctrl && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (tabsList[idx]) plutoAPI.switchTab(tabsList[idx].id);
    }
  });

  /* IPC Listeners */
  plutoAPI.onTabsUpdated(renderTabs);
  plutoAPI.onTabUpdated(updateAddressBar);

  /* Helpers */
  function prettifyUrl(url) {
    try {
      if (url.includes('newtab.html') || url === 'pluto://newtab') {
        return '';
      }
      const u = new URL(url);
      return u.protocol === 'file:' ? url : u.host + u.pathname + u.search + u.hash;
    } catch {
      return url;
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
