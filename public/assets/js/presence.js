(function () {
  'use strict';

  const HEARTBEAT_INTERVAL_MS = 20 * 1000;
  const TAB_TTL_MS = 45 * 1000;
  const TAB_STORAGE_KEY = 'stella.presence.tabs';
  const AUTH_NOTICE_KEY = 'stella.auth.notice';
  const tabId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let lastActivityAt = Date.now();
  let heartbeatPending = false;
  let sessionCheckPending = false;
  let sessionEvents = null;

  function readTabs() {
    try {
      const value = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeTabs(tabs) {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs));
    } catch {}
  }

  function activeTabs(excludeCurrent = false) {
    const now = Date.now();
    const tabs = readTabs();
    for (const [id, timestamp] of Object.entries(tabs)) {
      if (!Number.isFinite(timestamp) || now - timestamp > TAB_TTL_MS || (excludeCurrent && id === tabId)) {
        delete tabs[id];
      }
    }
    writeTabs(tabs);
    return tabs;
  }

  function registerTab() {
    const tabs = activeTabs();
    tabs[tabId] = Date.now();
    writeTabs(tabs);
  }

  function unregisterTab() {
    const tabs = activeTabs(true);
    writeTabs(tabs);
    return Object.keys(tabs).length;
  }

  function publish(snapshot) {
    window.ProfileCenter?.updatePresence?.(snapshot);
  }

  function returnToLogin(reason) {
    sessionEvents?.close();
    try {
      sessionStorage.setItem(AUTH_NOTICE_KEY, reason);
    } catch {}
    window.location.replace('/');
  }

  async function verifySession() {
    if (sessionCheckPending) return;
    sessionCheckPending = true;
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const session = await response.json();
      if (!session.authenticated) returnToLogin('session-revoked');
    } catch {} finally {
      sessionCheckPending = false;
    }
  }

  function connectSessionEvents() {
    if (!window.EventSource) return;
    sessionEvents = new EventSource('/api/session/events');
    sessionEvents.addEventListener('session-revoked', event => {
      let reason = 'session-revoked';
      try {
        reason = JSON.parse(event.data).reason || reason;
      } catch {}
      returnToLogin(reason);
    });
    sessionEvents.addEventListener('error', verifySession);
  }

  function recordInteraction(event) {
    if (!event.isTrusted || (event.type === 'keydown' && event.repeat)) return;
    lastActivityAt = Date.now();
  }

  async function heartbeat() {
    if (heartbeatPending) return;
    heartbeatPending = true;
    registerTab();
    try {
      const response = await fetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastActivityAt
        }),
        keepalive: true
      });
      if (!response.ok) throw new Error(`Heartbeat failed: ${response.status}`);
      publish(await response.json());
    } catch {} finally {
      heartbeatPending = false;
    }
  }

  async function setWorking(active, contextId = 'adjudication') {
    const response = await fetch('/api/presence/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: Boolean(active), contextId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Presence update failed: ${response.status}`);
    publish(payload);
    return payload;
  }

  function disconnect() {
    if (unregisterTab() > 0) return;
    const body = new Blob(['{}'], { type: 'application/json' });
    if (!navigator.sendBeacon?.('/api/presence/disconnect', body)) {
      fetch('/api/presence/disconnect', { method: 'POST', body: '{}', keepalive: true }).catch(() => {});
    }
  }

  document.addEventListener('pointerdown', recordInteraction, { capture: true, passive: true });
  document.addEventListener('keydown', recordInteraction, { capture: true });
  document.addEventListener('input', recordInteraction, { capture: true });
  document.addEventListener('change', recordInteraction, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') heartbeat();
  });
  window.addEventListener('pageshow', heartbeat);
  window.addEventListener('pagehide', disconnect);

  registerTab();
  connectSessionEvents();
  heartbeat();
  window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  window.PresenceHeartbeat = { heartbeat, setWorking };
})();
