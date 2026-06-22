# Session Tabs — Feature Reference

Browser-style tab bar for managing multiple LLM conversations in Odysseus. Built for mobile PWA usage.

---

## Core Features

### Tab Bar
- Scrollable row of session tabs at the top of the chat view
- Appears automatically when at least one session is open
- Horizontal scroll with momentum on mobile
- Overflow scroll indicators (gradient fades) appear at left/right edges when tabs extend past viewport

### Tab Switching
- Tap any tab to switch to that session
- Active tab is highlighted with accent color
- Previous tab's DOM is cached (scroll position + innerHTML) and restored on switch-back — no re-fetch needed

### Close Button
- "×" button on each tab (hidden on pinned tabs)
- When closing the active tab, switches to the next remaining tab
- When the last tab closes, shows the welcome screen

### "+" Button
- Touch-sized button (32×32px) on the right edge of the tab bar
- Creates a new session instantly without opening the sidebar

---

## Mobile Interactions

### Touch Drag-to-Reorder
- Touch and drag a tab horizontally to rearrange its position
- A ghost copy follows your finger during the drag
- Tab snaps into its new position on release
- Reorder is persisted to localStorage

### Long-Press Context Menu
- Hold a tab for ~400ms to open a popup menu
- Haptic vibration feedback on supported devices
- Also works via right-click on desktop
- Actions:
  - **Pin tab / Unpin tab** — Toggle pinned state
  - **Close tab** — Close this tab and switch to the next
  - **Close other tabs** — Close every tab except this one
  - **Close tabs to the right** — Close all tabs to the right of this one
- Menu auto-positions to stay within screen bounds (flips above if near bottom edge)

---

## Pinned Tabs

- Pin/unpin from the long-press context menu
- Pinned tabs:
  - Show a 📌 indicator
  - Always appear first (left side) in the tab bar
  - Have no close button
  - Auto-restore on every page load (persisted to localStorage under key `odysseus-pinned-tabs`)
- Unpinned tabs also persist and restore if they still exist on the server

---

## Visual Indicators

| Indicator | Appearance | Meaning |
|-----------|-----------|---------|
| Streaming dot | Pulsing accent-colored dot | Session is currently streaming a response |
| Completed dot | Static accent-colored dot | Stream finished (resets on next message) |
| Unread badge | Pulsing accent dot | Background stream completed while viewing a different tab |

Unread badges clear automatically when you tap the tab.

---

## Persistence

### localStorage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `odysseus-pinned-tabs` | `string[]` | Array of pinned session IDs (persisted as JSON) |
| `odysseus-open-tabs` | `{tabs, active}` | Object with `tabs` (array of session IDs) and `active` (current active ID) |

The open-tabs key stores both the ordered list and the active tab in a single JSON object — there is no separate `tab_order` key.

### Startup Flow

On page load, `restoreTabs()` is called after sessions are fetched from the server:

1. Pinned tabs are restored from localStorage (always)
2. Previously-open unpinned tabs are restored if they still exist server-side
3. The first available tab is auto-selected
4. DOM cache is empty on fresh load (messages are fetched normally on first view)

---

## DOM Cache

Each session's chat history is cached in-memory after first render:

- **`cacheDom(sessionId)`** — Saves `innerHTML` + `scrollTop` of `#chat-history`
- **`restoreDom(sessionId)`** — Restores cached content and re-runs syntax highlighting
- **`invalidateDom(sessionId)`** — Drops the cache (called after new messages arrive)
- **`hasCachedDom(sessionId)`** — Returns whether a cached snapshot exists

This means switching between open tabs is instant — no network request, no re-render.

---

## Architecture

### State

| Variable | Type | Purpose |
|----------|------|---------|
| `_openTabs` | `Map<string, {name}>` | All open sessions and their display names |
| `_activeTabId` | `string\|null` | Currently visible session |
| `_pinnedTabs` | `Set<string>` | Pinned session IDs (persisted) |
| `_unreadTabIds` | `Set<string>` | Sessions with unread badges |
| `_streamingTabIds` | `Set<string>` | Sessions currently streaming |
| `_completedTabIds` | `Set<string>` | Sessions that just completed a stream |
| `_domCache` | `Map<string, {innerHTML, scrollTop}>` | Cached chat DOM per session |
| `_dragState` | `object\|null` | Current touch-drag state |

### Exported Functions

```javascript
// Tab lifecycle
openTab(sessionId, name)          // Open or activate a tab
closeTab(sessionId)               // Close a tab, returns next active id
activateTab(sessionId)            // Switch to a tab
getActiveTabId()                  // Get current active session id
getOpenTabIds()                   // Array of all open session ids
hasTab(sessionId)                 // Check if tab is open
getTabCount()                     // Number of open tabs
cycleTab(direction)               // 'next' or 'prev' tab id

// Pinned tabs
isPinned(sessionId)               // Check if session is pinned
togglePin(sessionId)              // Toggle pinned state

// Unread tracking
setUnread(sessionId, unread)      // Set/clear unread badge
setStreamingTabIds(ids)           // Update streaming indicators
setCompletedTabIds(ids)           // Update completed indicators (also sets unread)

// DOM cache
cacheDom(sessionId)               // Snapshot current chat DOM
restoreDom(sessionId)             // Restore cached DOM
hasCachedDom(sessionId)           // Check if cache exists
invalidateDom(sessionId)          // Drop cache

// Persistence
restoreTabs()                     // Restore pinned + open tabs on startup
updateTabName(sessionId, name)    // Rename a tab
removeSessionFromTabs(sessionId)  // Remove from all tracking sets

// Rendering
renderTabBar()                    // Rebuild the tab bar DOM
```

---

## CSS Classes

| Class | Element | Purpose |
|-------|---------|---------|
| `.session-tab-bar` | Container | Tab bar wrapper |
| `.session-tab` | Individual tab | Each tab button |
| `.session-tab.active` | Active tab | Highlighted current tab |
| `.session-tab.pinned` | Pinned tab | Pinned styling (no close button) |
| `.session-tab.streaming` | Streaming tab | Has pulsing dot |
| `.session-tab.completed` | Completed tab | Has static dot |
| `.session-tab.unread` | Unread tab | Has unread badge |
| `.session-tab-label` | Tab label | Text inside tab |
| `.session-tab-close` | Close button | The "×" |
| `.tab-new-btn` | "+" button | New session button |
| `.tab-context-menu` | Context menu | Long-press popup |
| `.tab-context-item` | Menu item | Row inside context menu |
| `.scroll-left` | Left fade | Overflow indicator (left edge of bar) |
| `.scroll-right` | Right fade | Overflow indicator (right edge of bar) |
| `.tab-drag-ghost` | Drag ghost | Floating clone during drag |

---

## Mobile vs Desktop

| Feature | Mobile (PWA) | Desktop |
|---------|-------------|---------|
| Long-press context menu | Touch hold (400ms) + haptic | Right-click |
| Drag-to-reorder | Touch drag | Not implemented (use context menu) |
| Tab close button | Always visible | Visible on hover |
| "+" button | Always visible | Always visible |
| Overflow scroll | Touch scroll | Mouse scroll |

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Tabs not restoring on reload | localStorage cleared or corrupted | Check browser storage settings |
| Pinned tab disappeared | Session deleted server-side | Re-pin after opening it again |
| Drag ghost stuck on screen | Touch event interrupted | Tap anywhere to dismiss |
| Context menu won't dismiss | Tap outside the menu | Should auto-dismiss; report if persistent |
| Unread badge won't clear | Tab was closed before badge cleared | Badge clears on next session list refresh |
| Tab bar not scrolling | CSS overflow issue | Check `.session-tab-bar` has `overflow-x: auto` |
