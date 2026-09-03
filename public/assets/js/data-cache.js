(function () {
  'use strict';

  const entries = new Map();
  const MAX_ENTRIES = 32;
  const DEFAULT_TTL_MS = 30 * 1000;
  const routeTtl = [
    ['/api/update-log', 10 * 60 * 1000],
    ['/api/bp/bootstrap', 2 * 60 * 1000],
    ['/api/character-stats', 30 * 1000],
    ['/api/materials', 60 * 1000],
    ['/api/logs', 20 * 1000],
    ['/api/friends', 20 * 1000],
    ['/api/communications/bootstrap', 10 * 1000],
    ['/api/notifications', 5 * 1000],
    ['/api/admin/notifications', 10 * 1000],
    ['/api/admin/accounts', 20 * 1000],
    ['/api/admin/permissions', 15 * 1000],
    ['/api/admin/system-access', 15 * 1000],
    ['/api/operations/', 30 * 1000],
    ['/api/bp/timer-config', 60 * 1000]
  ];

  function normalizedUrl(input) {
    const url = new URL(input, window.location.origin);
    url.searchParams.sort();
    return `${url.pathname}${url.search}`;
  }

  function ttlFor(url) {
    return routeTtl.find(([prefix]) => url.startsWith(prefix))?.[1] || DEFAULT_TTL_MS;
  }

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function trim() {
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  }

  function invalidate(prefix) {
    const normalized = normalizedUrl(prefix);
    for (const key of entries.keys()) {
      if (key.startsWith(normalized)) entries.delete(key);
    }
  }

  function invalidateRelated(url) {
    const pathname = new URL(url, window.location.origin).pathname;
    if (pathname.startsWith('/api/friends') || pathname.startsWith('/api/users')) invalidate('/api/friends');
    if (pathname.startsWith('/api/communications')) invalidate('/api/communications');
    if (pathname.startsWith('/api/notifications')) invalidate('/api/notifications');
    if (pathname.startsWith('/api/admin/notifications')) {
      invalidate('/api/admin/notifications');
      invalidate('/api/notifications');
    }
    if (pathname.startsWith('/api/admin/accounts')) invalidate('/api/admin/accounts');
    if (pathname.startsWith('/api/admin/characters')) {
      invalidate('/api/character-stats');
      invalidate('/api/bp/bootstrap');
      invalidate('/api/logs');
    }
    if (pathname.startsWith('/api/admin/permissions')) {
      invalidate('/api/admin/permissions');
      invalidate('/api/profile');
    }
    if (pathname.startsWith('/api/admin/system-access')) invalidate('/api/admin/system-access');
    if (pathname.startsWith('/api/admin/system-access')) invalidate('/api/operations/settings');
    if (pathname.startsWith('/api/events')) {
      invalidate('/api/events');
      invalidate('/api/operations/events');
      invalidate('/api/operations/schedule');
    }
    if (pathname.startsWith('/api/materials')) {
      invalidate('/api/materials');
      invalidate('/api/operations/resources');
    }
    if (pathname.startsWith('/api/bp')) {
      invalidate('/api/bp/bootstrap');
      invalidate('/api/bp/sessions');
      invalidate('/api/character-stats');
      invalidate('/api/logs');
      invalidate('/api/operations/events');
      invalidate('/api/events');
      invalidate('/api/operations/schedule');
      invalidate('/api/operations/teams');
      invalidate('/api/operations/players');
      invalidate('/api/operations/matches');
    }
    if (pathname.startsWith('/api/profile')) {
      invalidate('/api/profile');
      invalidate('/api/friends');
      invalidate('/api/admin/accounts');
      invalidate('/api/operations/personal');
    }
  }

  async function requestJson(input, options = {}) {
    const { force = false, ttlMs, ...fetchOptions } = options;
    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const key = normalizedUrl(input);
    if (method === 'GET' && !force) {
      const cached = entries.get(key);
      if (cached?.value !== undefined && Date.now() - cached.storedAt < (ttlMs || ttlFor(key))) {
        entries.delete(key);
        entries.set(key, cached);
        return clone(cached.value);
      }
      if (cached?.promise) return cached.promise.then(clone);
    }

    const pending = fetch(input, fetchOptions).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
      if (method === 'GET') {
        entries.delete(key);
        entries.set(key, { value: payload, storedAt: Date.now() });
        trim();
      } else {
        invalidateRelated(input);
      }
      return payload;
    });
    if (method === 'GET') entries.set(key, { promise: pending, storedAt: Date.now() });
    try {
      return clone(await pending);
    } catch (error) {
      if (entries.get(key)?.promise === pending) entries.delete(key);
      throw error;
    }
  }

  function prefetch(url, options) {
    if (document.visibilityState === 'hidden') return Promise.resolve(null);
    return requestJson(url, options).catch(() => null);
  }

  function pageResources(page, category) {
    const resources = {
      personalCenter: ['/api/operations/personal'],
      events: ['/api/events?filter=all'],
      schedule: ['/api/operations/schedule?limit=60&offset=0'],
      teams: ['/api/operations/teams?limit=60&offset=0'],
      players: ['/api/operations/players?limit=60&offset=0'],
      resourceMonitor: ['/api/operations/resources'],
      matchRecords: ['/api/operations/matches?limit=60&offset=0'],
      dataConfig: ['/api/operations/dataConfig'],
      terminalStatus: ['/api/operations/terminal'],
      systemSettings: ['/api/operations/settings'],
      riskResponse: ['/api/operations/alerts'],
      countdown: ['/api/bp/timer-config'],
      bp: ['/api/bp/bootstrap'],
      characterStats: ['/api/character-stats?division=all'],
      materials: ['/api/materials?offset=0&limit=80'],
      friends: ['/api/friends'],
      addFriend: ['/api/friends'],
      channels: ['/api/communications/bootstrap'],
      systemManagement: ['/api/admin/system-access'],
      accounts: ['/api/admin/accounts'],
      permissions: ['/api/admin/permissions'],
      notificationManagement: ['/api/admin/notifications?offset=0&limit=30'],
      updates: ['/api/update-log']
    };
    if (page === 'logs') {
      return [`/api/logs?category=${category || 'event'}&offset=0&limit=50`];
    }
    return resources[page] || [];
  }

  function prefetchPage(page, category) {
    return Promise.all(pageResources(page, category).map(url => prefetch(url)));
  }

  function idle(callback, timeout = 1500) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout });
    } else {
      window.setTimeout(callback, Math.min(timeout, 500));
    }
  }

  function runQueue(queue, index = 0) {
    if (index >= queue.length || document.visibilityState === 'hidden') return;
    idle(() => {
      prefetch(queue[index]).finally(() => runQueue(queue, index + 1));
    });
  }

  function bindPrediction() {
    document.querySelectorAll('[data-page]').forEach(button => {
      const predict = () => prefetchPage(button.dataset.page, button.dataset.logCategory);
      button.addEventListener('pointerenter', predict, { passive: true });
      button.addEventListener('focus', predict, { passive: true });
    });
    window.addEventListener('stella:page-change', event => {
      const page = event.detail?.page;
      const active = document.querySelector(`[data-page="${CSS.escape(page || '')}"].active`);
      prefetchPage(page, active?.dataset.logCategory);
      const related = {
        personalCenter: ['/api/operations/schedule?limit=60&offset=0'],
        events: ['/api/operations/schedule?limit=60&offset=0', '/api/operations/teams?limit=60&offset=0'],
        schedule: ['/api/operations/matches?limit=60&offset=0'],
        teams: ['/api/operations/players?limit=60&offset=0'],
        players: ['/api/operations/teams?limit=60&offset=0'],
        resourceMonitor: ['/api/materials?offset=0&limit=80'],
        matchRecords: ['/api/character-stats?division=all'],
        dataConfig: ['/api/operations/terminal'],
        terminalStatus: ['/api/operations/settings'],
        systemSettings: ['/api/admin/system-access'],
        riskResponse: ['/api/logs?category=account&offset=0&limit=50'],
        bp: ['/api/logs?category=event&offset=0&limit=50'],
        characterStats: [
          '/api/character-stats?division=pc',
          '/api/character-stats?division=pe',
          '/api/bp/bootstrap'
        ],
        materials: ['/api/bp/bootstrap'],
        friends: ['/api/profile'],
        channels: ['/api/friends'],
        systemManagement: ['/api/admin/accounts'],
        permissions: ['/api/admin/accounts', '/api/logs?category=account&offset=0&limit=50'],
        notificationManagement: ['/api/admin/accounts', '/api/logs?category=account&offset=0&limit=50'],
        accounts: ['/api/logs?category=account&offset=0&limit=50'],
        logs: ['/api/update-log']
      };
      runQueue(related[page] || []);
    });
  }

  function start(profile) {
    const permissions = new Set(profile?.permissions || []);
    const first = ['/api/operations/personal', ...pageResources(profile?.home?.defaultPage)];
    if (permissions.has('logs.event.view')) first.push('/api/logs?category=event&offset=0&limit=50');
    if (permissions.has('logs.account.view')) first.push('/api/logs?category=account&offset=0&limit=50');
    for (const url of new Set(first)) prefetch(url);

    const queue = ['/api/notifications?offset=0&limit=30', '/api/update-log'];
    if (permissions.has('countdown.operate')) queue.push('/api/bp/timer-config');
    if (permissions.has('bp.view')) queue.push('/api/bp/bootstrap');
    if (permissions.has('operations.view')) queue.push(
      '/api/events?filter=all',
      '/api/operations/schedule?limit=60&offset=0',
      '/api/operations/teams?limit=60&offset=0'
    );
    if (permissions.has('characterStats.view')) queue.push('/api/character-stats?division=all');
    if (permissions.has('materials.view')) queue.push('/api/materials?offset=0&limit=80');
    if (permissions.has('materials.view')) queue.push('/api/operations/resources');
    if (permissions.has('communication.use')) queue.push('/api/friends', '/api/communications/bootstrap');
    if (profile?.identity?.systemManagement) {
      if (permissions.has('system.manage')) queue.push('/api/admin/system-access');
      if (permissions.has('system.manage')) queue.push('/api/operations/terminal', '/api/operations/alerts');
      if (permissions.has('accounts.manage')) queue.push('/api/admin/accounts');
      if (permissions.has('permissions.manage')) queue.push('/api/admin/permissions');
      if (permissions.has('notifications.publish')) queue.push('/api/admin/notifications?offset=0&limit=30');
    }
    if (!navigator.connection?.saveData) {
      if (permissions.has('materials.view')) queue.push('/api/materials?offset=80&limit=80');
    }
    runQueue([...new Set(queue)]);
  }

  window.StellaDataCache = { json: requestJson, prefetch, prefetchPage, invalidate };
  document.addEventListener('DOMContentLoaded', () => {
    bindPrediction();
    const ready = window.ProfileCenter?.ready || Promise.resolve(null);
    ready.then(start).catch(() => start(null));
    window.addEventListener('stella:identity-change', event => start(event.detail));
  }, { once: true });
})();
