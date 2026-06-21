// ============================================
// Session Tabs — browser-style tab bar for open LLM sessions
// ============================================
//
// Each "open tab" caches the rendered chat-history DOM so switching
// between already-open sessions is instant (no server round-trip).

import Storage from './storage.js';
import uiModule from './ui.js';

/** @type {Map<string, {name: string}>} sessionId → tab meta */
let _openTabs = new Map();  // insertion order = tab display order
let _activeTabId = null;

/** DOM cache: sessionId → { innerHTML, scrollTop } */
const _domCache = new Map();

// ── DOM Cache helpers ──

/** Snapshot the current chat-history DOM into the cache for a session. */
export function cacheDom(sessionId) {
  if (!sessionId) return;
  const box = document.getElementById('chat-history');
  if (!box) return;
  _domCache.set(sessionId, {
    innerHTML: box.innerHTML,
    scrollTop: box.scrollTop,
  });
}

/** Restore cached DOM for a session into chat-history. Returns true if cache hit. */
export function restoreDom(sessionId) {
  const cached = _domCache.get(sessionId);
  if (!cached) return false;
  const box = document.getElementById('chat-history');
  if (!box) return false;
  box.innerHTML = cached.innerHTML;
  // Defer scroll restore so layout can settle
  requestAnimationFrame(() => { box.scrollTop = cached.scrollTop; });
  // Re-highlight code blocks
  if (window.hljs) {
    try {
      box.querySelectorAll('pre code:not(.hljs)').forEach(block => {
        window.hljs.highlightElement(block);
      });
    } catch (_) {}
  }
  return true;
}

/** Check if a session has cached DOM. */
export function hasCachedDom(sessionId) {
  return _domCache.has(sessionId);
}

/** Drop cached DOM for a session (e.g. after delete). */
export function invalidateDom(sessionId) {
  _domCache.delete(sessionId);
}

// ── Tab state management ──

/** Open a tab for a session (or just activate it if already open). */
export function openTab(sessionId, name) {
  if (!sessionId) return;
  if (!_openTabs.has(sessionId)) {
    _openTabs.set(sessionId, { name: name || 'Chat' });
    _persistOpenTabs();
  } else if (name) {
    // Update name if provided (session was renamed)
    _openTabs.get(sessionId).name = name;
  }
  _activeTabId = sessionId;
  renderTabBar();
}

/** Close a tab. Does NOT delete the session — just removes from tab bar. */
export function closeTab(sessionId) {
  _openTabs.delete(sessionId);
  _domCache.delete(sessionId);
  _persistOpenTabs();
  // If we closed the active tab, activate the nearest remaining tab
  if (_activeTabId === sessionId) {
    const remaining = Array.from(_openTabs.keys());
    _activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    renderTabBar();
    // Return the session to switch to (or null for welcome screen)
    return _activeTabId;
  }
  renderTabBar();
  return null; // no session switch needed
}

/** Activate a tab (called when user clicks a tab or uses keyboard). */
export function activateTab(sessionId) {
  if (!_openTabs.has(sessionId)) return;
  _activeTabId = sessionId;
  renderTabBar();
}

/** Get the active tab session ID. */
export function getActiveTabId() {
  return _activeTabId;
}

/** Get all open tab session IDs in order. */
export function getOpenTabIds() {
  return Array.from(_openTabs.keys());
}

/** Check if a session has an open tab. */
export function hasTab(sessionId) {
  return _openTabs.has(sessionId);
}

/** Get the tab count. */
export function getTabCount() {
  return _openTabs.size;
}

/** Cycle to the next/previous tab. Returns the session ID to switch to, or null. */
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
  renderTabBar();
}

// ── Tab bar rendering ──

/** Full re-render of the tab bar. */
export function renderTabBar() {
  const bar = document.getElementById('session-tab-bar');
  if (!bar) return;
  const container = document.getElementById('chat-container');

  // Hide tab bar entirely when fewer than 2 sessions are open
  if (_openTabs.size < 2) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    if (container) container.classList.remove('has-tabs');
    return;
  }

  bar.style.display = '';
  if (container) container.classList.add('has-tabs');

  bar.innerHTML = '';

  for (const [sid, meta] of _openTabs) {
    const tab = document.createElement('div');
    tab.className = 'session-tab';
    if (sid === _activeTabId) tab.classList.add('active');
    if (_streamingTabIds.has(sid)) tab.classList.add('streaming');
    if (_completedTabIds.has(sid)) tab.classList.add('completed');
    tab.dataset.sessionId = sid;

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

    // Completed indicator dot
    if (_completedTabIds.has(sid) && !_streamingTabIds.has(sid)) {
      const dot = document.createElement('span');
      dot.className = 'tab-complete-dot';
      tab.appendChild(dot);
    }

    // Close button
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
      } else if (!switchTo && window.sessionModule) {
        // No tabs left — show welcome screen
        window.sessionModule.setCurrentSessionId(null);
        Storage.remove('lastSessionId');
        const chatHistory = document.getElementById('chat-history');
        if (chatHistory) chatHistory.innerHTML = '';
        const metaEl = document.getElementById('current-meta');
        if (metaEl) metaEl.textContent = 'Odysseus Chat';
        if (window.chatModule && window.chatModule.showWelcomeScreen) {
          window.chatModule.showWelcomeScreen();
        }
      }
    });
    tab.appendChild(closeBtn);

    // Click to activate tab
    tab.addEventListener('click', () => {
      if (sid === _activeTabId) return;
      if (window.sessionModule) window.sessionModule.selectSession(sid);
    });

    bar.appendChild(tab);
  }
}

// ── Persistence (survives page refresh — stores open tab IDs) ──
const _TABS_STORAGE_KEY = 'odysseus-open-tabs';

function _persistOpenTabs() {
  try {
    Storage.setJSON(_TABS_STORAGE_KEY, {
      tabs: Array.from(_openTabs.keys()),
      active: _activeTabId,
    });
  } catch (_) {}
}

/** Restore open tabs from storage. Called once on startup. */
export function restoreTabs() {
  try {
    const saved = Storage.getJSON(_TABS_STORAGE_KEY, null);
    if (!saved || !saved.tabs || !Array.isArray(saved.tabs)) return { tabIds: [], activeId: null };
    return { tabIds: saved.tabs, activeId: saved.active };
  } catch (_) {
    return { tabIds: [], activeId: null };
  }
}

/** Update a tab's name (when session is renamed). */
export function updateTabName(sessionId, newName) {
  const meta = _openTabs.get(sessionId);
  if (meta) {
    meta.name = newName;
    _persistOpenTabs();
    renderTabBar();
  }
}

/** Remove a session from tabs (when session is deleted). */
export function removeSessionFromTabs(sessionId) {
  closeTab(sessionId);
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
  renderTabBar,
  restoreTabs,
  updateTabName,
  removeSessionFromTabs,
};

export default tabsModule;
