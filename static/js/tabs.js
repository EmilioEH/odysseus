// ============================================
// Session Tabs — browser-style tab bar for open LLM sessions
// ============================================
//
// Mobile-optimized enhancements:
//   - "+" button to create new sessions from the tab bar
//   - Touch drag-to-reorder (touchstart/touchmove/touchend)
//   - Long-press context menu (close, close others, close right, pin)
//   - Pinned tabs that auto-open on load
//   - Unread badge for completed background streams
//   - Overflow scroll indicators when tabs exceed viewport

import Storage from './storage.js';

/** @type {Map<string, {name: string}>} sessionId → tab meta */
let _openTabs = new Map();
let _activeTabId = null;

/** DOM cache: sessionId → { innerHTML, scrollTop } */
const _domCache = new Map();

// ── Pinned tabs ──
const _PINNED_KEY = 'odysseus-pinned-tabs';
let _pinnedTabs = new Set();

function _loadPinned() {
  try {
    const arr = Storage.getJSON(_PINNED_KEY, []);
    _pinnedTabs = new Set(arr);
  } catch (_) { _pinnedTabs = new Set(); }
}

function _savePinned() {
  try { Storage.setJSON(_PINNED_KEY, Array.from(_pinnedTabs)); } catch (_) {}
}

export function isPinned(sessionId) {
  return _pinnedTabs.has(sessionId);
}

export function togglePin(sessionId) {
  if (_pinnedTabs.has(sessionId)) {
    _pinnedTabs.delete(sessionId);
  } else {
    _pinnedTabs.add(sessionId);
  }
  _savePinned();
  renderTabBar();
}

// ── Unread tracking ──
let _unreadTabIds = new Set();

export function setUnread(sessionId, unread) {
  if (unread) _unreadTabIds.add(sessionId);
  else _unreadTabIds.delete(sessionId);
  renderTabBar();
}

// ── DOM Cache helpers ──

export function cacheDom(sessionId) {
  if (!sessionId) return;
  const box = document.getElementById('chat-history');
  if (!box) return;
  _domCache.set(sessionId, {
    innerHTML: box.innerHTML,
    scrollTop: box.scrollTop,
  });
}

export function restoreDom(sessionId) {
  const cached = _domCache.get(sessionId);
  if (!cached) return false;
  const box = document.getElementById('chat-history');
  if (!box) return false;
  box.innerHTML = cached.innerHTML;
  requestAnimationFrame(() => { box.scrollTop = cached.scrollTop; });
  if (window.hljs) {
    try {
      box.querySelectorAll('pre code:not(.hljs)').forEach(block => {
        window.hljs.highlightElement(block);
      });
    } catch (_) {}
  }
  return true;
}

export function hasCachedDom(sessionId) {
  return _domCache.has(sessionId);
}

export function invalidateDom(sessionId) {
  _domCache.delete(sessionId);
}

// ── Tab state management ──

export function openTab(sessionId, name) {
  if (!sessionId) return;
  if (!_openTabs.has(sessionId)) {
    _openTabs.set(sessionId, { name: name || 'Chat' });
    _persistOpenTabs();
  } else if (name) {
    _openTabs.get(sessionId).name = name;
  }
  _activeTabId = sessionId;
  // Clear unread when activating a tab
  _unreadTabIds.delete(sessionId);
  renderTabBar();
}

export function closeTab(sessionId) {
  _openTabs.delete(sessionId);
  _domCache.delete(sessionId);
  _unreadTabIds.delete(sessionId);
  _pinnedTabs.delete(sessionId);
  _savePinned();
  _persistOpenTabs();
  if (_activeTabId === sessionId) {
    const remaining = Array.from(_openTabs.keys());
    _activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    renderTabBar();
    return _activeTabId;
  }
  renderTabBar();
  return null;
}

export function activateTab(sessionId) {
  if (!_openTabs.has(sessionId)) return;
  _activeTabId = sessionId;
  _unreadTabIds.delete(sessionId);
  renderTabBar();
}

export function getActiveTabId() {
  return _activeTabId;
}

export function getOpenTabIds() {
  return Array.from(_openTabs.keys());
}

export function hasTab(sessionId) {
  return _openTabs.has(sessionId);
}

export function getTabCount() {
  return _openTabs.size;
}

export function cycleTab(direction) {
  const ids = Array.from(_openTabs.keys());
  if (ids.length < 2) return null;
  const idx = ids.indexOf(_activeTabId);
  let nextIdx;
  if (direction === 'next') {
    nextIdx = (idx + 1) % ids.length;
  } else {
    nextIdx = (idx - 1 + ids.length) % ids.length;
  }
  return ids[nextIdx];
}

// ── Streaming/completed indicator state ──
let _streamingTabIds = new Set();
let _completedTabIds = new Set();

export function setStreamingTabIds(ids) {
  _streamingTabIds = new Set(ids);
  renderTabBar();
}

export function setCompletedTabIds(ids) {
  _completedTabIds = new Set(ids);
  // Mark as unread if not currently active
  ids.forEach(sid => {
    if (sid !== _activeTabId) _unreadTabIds.add(sid);
  });
  renderTabBar();
}

// ── Context menu (long-press on mobile) ──

let _contextMenuEl = null;

function _showContextMenu(sessionId, anchorEl) {
  _hideContextMenu();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.cssText = 'position:fixed;z-index:10001;';

  const isPin = _pinnedTabs.has(sessionId);
  const items = [
    { label: isPin ? 'Unpin tab' : 'Pin tab', icon: '📌', action: () => { togglePin(sessionId); } },
    { separator: true },
    { label: 'Close tab', action: () => {
      const switchTo = closeTab(sessionId);
      if (switchTo && window.sessionModule) window.sessionModule.selectSession(switchTo);
      else if (!switchTo) _showWelcome();
    }},
    { label: 'Close other tabs', action: () => {
      const ids = Array.from(_openTabs.keys()).filter(id => id !== sessionId);
      ids.forEach(id => { _openTabs.delete(id); _domCache.delete(id); _unreadTabIds.delete(id); });
      _activeTabId = sessionId;
      _persistOpenTabs();
      renderTabBar();
    }},
    { label: 'Close tabs to the right', action: () => {
      const ids = Array.from(_openTabs.keys());
      const idx = ids.indexOf(sessionId);
      const toClose = ids.slice(idx + 1);
      toClose.forEach(id => { _openTabs.delete(id); _domCache.delete(id); _unreadTabIds.delete(id); });
      if (!_openTabs.has(_activeTabId)) _activeTabId = sessionId;
      _persistOpenTabs();
      renderTabBar();
    }},
  ];

  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:color-mix(in srgb,var(--fg) 10%,transparent);margin:4px 8px;';
      menu.appendChild(sep);
      return;
    }
    const row = document.createElement('div');
    row.className = 'tab-context-item';
    row.style.cssText = 'padding:10px 16px;cursor:pointer;font-size:13px;color:var(--fg);display:flex;align-items:center;gap:8px;white-space:nowrap;transition:background 0.1s;';
    if (item.icon) {
      const ic = document.createElement('span');
      ic.textContent = item.icon;
      ic.style.fontSize = '14px';
      row.appendChild(ic);
    }
    row.appendChild(document.createTextNode(item.label));
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _hideContextMenu();
      item.action();
    });
    row.addEventListener('touchstart', () => {
      row.style.background = 'color-mix(in srgb,var(--fg) 8%,transparent)';
    }, { passive: true });
    row.addEventListener('touchend', () => {
      row.style.background = '';
    }, { passive: true });
    menu.appendChild(row);
  });

  // Position near the anchor
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.minWidth = '170px';
  menu.style.background = 'color-mix(in srgb,var(--panel) 95%,var(--bg))';
  menu.style.border = '1px solid color-mix(in srgb,var(--fg) 12%,transparent)';
  menu.style.borderRadius = '8px';
  menu.style.boxShadow = '0 4px 20px rgba(0,0,0,0.25)';
  menu.style.overflow = 'hidden';
  // Clamp to screen
  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (left < 8) left = 8;
  menu.style.left = left + 'px';
  // If overflows bottom, show above
  if (rect.bottom + 4 + menuRect.height > window.innerHeight - 8) {
    menu.style.top = (rect.top - menuRect.height - 4) + 'px';
  }

  _contextMenuEl = menu;
  // Dismiss on tap outside
  setTimeout(() => {
    document.addEventListener('touchstart', _dismissContextMenu, { once: true });
    document.addEventListener('mousedown', _dismissContextMenu, { once: true });
  }, 50);
}

function _dismissContextMenu(e) {
  if (_contextMenuEl && !_contextMenuEl.contains(e.target)) {
    _hideContextMenu();
  } else if (_contextMenuEl) {
    // If tapped inside, also dismiss after the click handler fires
    setTimeout(_hideContextMenu, 100);
  }
}

function _hideContextMenu() {
  if (_contextMenuEl) {
    _contextMenuEl.remove();
    _contextMenuEl = null;
  }
}

// ── Touch drag-to-reorder ──

let _dragState = null;

function _initTouchDrag(tabEl, sessionId) {
  let pressTimer = null;
  let isDragging = false;
  let startX = 0, startY = 0;
  let longPressed = false;

  const LONG_PRESS_MS = 400;
  const DRAG_THRESHOLD = 8;

  function _onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    longPressed = false;
    isDragging = false;

    pressTimer = setTimeout(() => {
      longPressed = true;
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(30);
      _showContextMenu(sessionId, tabEl);
    }, LONG_PRESS_MS);
  }

  function _onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!longPressed && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      clearTimeout(pressTimer);
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal drag — start reordering
        isDragging = true;
        _startDragReorder(tabEl, sessionId, touch.clientX);
      }
    }

    if (isDragging) {
      e.preventDefault();
      _moveDragReorder(touch.clientX);
    }
  }

  function _onTouchEnd() {
    clearTimeout(pressTimer);
    if (isDragging) {
      _endDragReorder(sessionId);
    }
    isDragging = false;
  }

  tabEl.addEventListener('touchstart', _onTouchStart, { passive: true });
  tabEl.addEventListener('touchmove', _onTouchMove, { passive: false });
  tabEl.addEventListener('touchend', _onTouchEnd, { passive: true });
  tabEl.addEventListener('touchcancel', _onTouchEnd, { passive: true });
}

function _startDragReorder(tabEl, sessionId, startX) {
  const bar = document.getElementById('session-tab-bar');
  if (!bar) return;
  const rect = tabEl.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();

  // Create a visual clone as the drag ghost
  const ghost = tabEl.cloneNode(true);
  ghost.className = 'session-tab tab-drag-ghost';
  ghost.style.cssText = `
    position:fixed; z-index:10001; pointer-events:none;
    left:${rect.left}px; top:${rect.top}px;
    width:${rect.width}px; height:${rect.height}px;
    opacity:0.85; transform:scale(1.05);
    transition:none; box-shadow:0 4px 16px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(ghost);

  tabEl.style.opacity = '0.2';

  _dragState = {
    tabEl, ghost, sessionId, startX,
    tabRect: rect, barRect,
    originalOrder: Array.from(_openTabs.keys()),
    offsetX: startX - rect.left,
  };
}

function _moveDragReorder(clientX) {
  if (!_dragState) return;
  const { ghost, offsetX, barRect } = _dragState;
  ghost.style.left = (clientX - offsetX) + 'px';

  // Find which tab we're over
  const bar = document.getElementById('session-tab-bar');
  if (!bar) return;
  const tabs = Array.from(bar.querySelectorAll('.session-tab'));
  let insertBefore = null;
  for (const tab of tabs) {
    const r = tab.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) {
      insertBefore = tab;
      break;
    }
  }

  // Visual insertion indicator
  tabs.forEach(t => { t.style.transform = ''; });
  if (insertBefore && insertBefore !== _dragState.tabEl) {
    // Nudge the target tab to make room
    insertBefore.style.transform = 'translateX(4px)';
  }
}

function _endDragReorder(sessionId) {
  if (!_dragState) return;
  const { ghost, tabEl, originalOrder, startX } = _dragState;

  ghost.remove();
  tabEl.style.opacity = '';

  // Determine new position based on final ghost position
  const bar = document.getElementById('session-tab-bar');
  if (!bar) { _dragState = null; return; }
  const tabs = Array.from(bar.querySelectorAll('.session-tab'));
  tabs.forEach(t => { t.style.transform = ''; });

  // Find drop target
  const ghostLeft = parseFloat(ghost.style.left) + _dragState.offsetX;
  let newIdx = originalOrder.length - 1;
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    if (ghostLeft < r.left + r.width / 2) {
      newIdx = i;
      break;
    }
  }

  // Reorder
  const ids = Array.from(_openTabs.keys());
  const oldIdx = ids.indexOf(sessionId);
  if (oldIdx !== -1 && oldIdx !== newIdx) {
    ids.splice(oldIdx, 1);
    ids.splice(newIdx, 0, sessionId);
    const newMap = new Map();
    ids.forEach(id => newMap.set(id, _openTabs.get(id)));
    _openTabs = newMap;
    _persistOpenTabs();
    renderTabBar();
  }

  _dragState = null;
}

// ── Overflow scroll indicators ──

function _updateScrollIndicators() {
  const bar = document.getElementById('session-tab-bar');
  if (!bar) return;
  const showLeft = bar.scrollLeft > 4;
  const showRight = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4;
  bar.classList.toggle('scroll-left', showLeft);
  bar.classList.toggle('scroll-right', showRight);
}

// ── New tab button handler ──

function _onNewTabClick() {
  // Delegate to the session module's new-session logic
  if (window.sessionModule) {
    const mod = window.sessionModule;
    // Use the same logic as the sidebar "+" — create a new session
    const name = new Date().toLocaleTimeString();
    const fd = new FormData();
    fd.append('name', name);
    fetch('/api/session', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(data => {
        if (data && data.id) {
          mod.loadSessions().then(() => {
            mod.selectSession(data.id);
          });
        }
      })
      .catch(err => console.error('[tabs] new session error:', err));
  }
}

// ── Tab bar rendering ──

export function renderTabBar() {
  const bar = document.getElementById('session-tab-bar');
  if (!bar) return;
  const container = document.getElementById('chat-container');

  // Hide tab bar entirely when 0 sessions open
  if (_openTabs.size < 1) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    if (container) container.classList.remove('has-tabs');
    return;
  }

  bar.style.display = '';
  if (container) container.classList.add('has-tabs');

  bar.innerHTML = '';

  // Pinned tabs first (sorted), then unpinned
  const entries = Array.from(_openTabs.entries());
  const pinned = entries.filter(([sid]) => _pinnedTabs.has(sid));
  const unpinned = entries.filter(([sid]) => !_pinnedTabs.has(sid));
  const sorted = [...pinned, ...unpinned];

  for (const [sid, meta] of sorted) {
    const tab = document.createElement('div');
    tab.className = 'session-tab';
    if (sid === _activeTabId) tab.classList.add('active');
    if (_streamingTabIds.has(sid)) tab.classList.add('streaming');
    if (_completedTabIds.has(sid)) tab.classList.add('completed');
    if (_pinnedTabs.has(sid)) tab.classList.add('pinned');
    if (_unreadTabIds.has(sid)) tab.classList.add('unread');
    tab.dataset.sessionId = sid;

    // Pin icon for pinned tabs
    if (_pinnedTabs.has(sid)) {
      const pinIcon = document.createElement('span');
      pinIcon.className = 'tab-pin-icon';
      pinIcon.textContent = '📌';
      pinIcon.style.cssText = 'font-size:10px;line-height:1;';
      tab.appendChild(pinIcon);
    }

    // Tab label
    const label = document.createElement('span');
    label.className = 'session-tab-label';
    label.textContent = meta.name || 'Chat';
    label.title = meta.name || 'Chat';
    tab.appendChild(label);

    // Streaming dot
    if (_streamingTabIds.has(sid)) {
      const dot = document.createElement('span');
      dot.className = 'tab-stream-dot';
      tab.appendChild(dot);
    }

    // Completed indicator dot (only if not streaming)
    if (_completedTabIds.has(sid) && !_streamingTabIds.has(sid)) {
      const dot = document.createElement('span');
      dot.className = 'tab-complete-dot';
      tab.appendChild(dot);
    }

    // Unread badge
    if (_unreadTabIds.has(sid) && sid !== _activeTabId) {
      const badge = document.createElement('span');
      badge.className = 'tab-unread-badge';
      tab.appendChild(badge);
    }

    // Close button (hidden on pinned tabs)
    if (!_pinnedTabs.has(sid)) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'session-tab-close';
      closeBtn.title = 'Close tab';
      closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const switchTo = closeTab(sid);
        if (switchTo && window.sessionModule) {
          window.sessionModule.selectSession(switchTo);
        } else if (!switchTo) {
          _showWelcome();
        }
      });
      tab.appendChild(closeBtn);
    }

    // Click to activate tab
    tab.addEventListener('click', () => {
      if (sid === _activeTabId) return;
      if (window.sessionModule) window.sessionModule.selectSession(sid);
    });

    // Touch drag + long press
    _initTouchDrag(tab, sid);

    // Desktop right-click context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showContextMenu(sid, tab);
    });

    bar.appendChild(tab);
  }

  // "+" new tab button
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'tab-new-btn';
  newBtn.title = 'New session';
  newBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  newBtn.addEventListener('click', _onNewTabClick);
  bar.appendChild(newBtn);

  // Scroll indicator updates
  requestAnimationFrame(() => {
    _updateScrollIndicators();
    // Scroll active tab into view
    const activeTab = bar.querySelector('.session-tab.active');
    if (activeTab) {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
}

function _showWelcome() {
  window.sessionModule?.setCurrentSessionId(null);
  Storage.remove('lastSessionId');
  const ch = document.getElementById('chat-history');
  if (ch) ch.innerHTML = '';
  const cm = document.getElementById('current-meta');
  if (cm) cm.textContent = 'Odysseus Chat';
  if (window.chatModule && window.chatModule.showWelcomeScreen) {
    window.chatModule.showWelcomeScreen();
  }
}

// ── Persistence ──
const _TABS_STORAGE_KEY = 'odysseus-open-tabs';

function _persistOpenTabs() {
  try {
    Storage.setJSON(_TABS_STORAGE_KEY, {
      tabs: Array.from(_openTabs.keys()),
      active: _activeTabId,
    });
  } catch (_) {}
}

export function restoreTabs() {
  _loadPinned();
  try {
    const saved = Storage.getJSON(_TABS_STORAGE_KEY, null);
    if (!saved || !saved.tabs || !Array.isArray(saved.tabs)) return { tabIds: [], activeId: null };
    // Include pinned tabs in the restore list even if not in the saved tabs
    const allIds = [...new Set([...saved.tabs, ..._pinnedTabs])];
    return { tabIds: allIds, activeId: saved.active };
  } catch (_) {
    return { tabIds: [..._pinnedTabs], activeId: null };
  }
}

export function updateTabName(sessionId, newName) {
  const meta = _openTabs.get(sessionId);
  if (meta) {
    meta.name = newName;
    _persistOpenTabs();
    renderTabBar();
  }
}

export function removeSessionFromTabs(sessionId) {
  closeTab(sessionId);
}

// ── Scroll listener for overflow indicators ──
function _initScrollListener() {
  const bar = document.getElementById('session-tab-bar');
  if (!bar) return;
  bar.addEventListener('scroll', _updateScrollIndicators, { passive: true });
  // Also update on resize
  window.addEventListener('resize', _updateScrollIndicators, { passive: true });
}

// Call once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initScrollListener);
} else {
  _initScrollListener();
}

// ── Module export ──
const tabsModule = {
  openTab,
  closeTab,
  activateTab,
  getActiveTabId,
  getOpenTabIds,
  hasTab,
  getTabCount,
  cycleTab,
  cacheDom,
  restoreDom,
  hasCachedDom,
  invalidateDom,
  setStreamingTabIds,
  setCompletedTabIds,
  setUnread,
  isPinned,
  togglePin,
  renderTabBar,
  restoreTabs,
  updateTabName,
  removeSessionFromTabs,
};

export default tabsModule;
