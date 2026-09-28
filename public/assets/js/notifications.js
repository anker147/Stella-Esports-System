(function () {
  'use strict';

  const elements = {
    toggle: document.getElementById('notificationToggle'),
    badge: document.getElementById('notificationBadge'),
    panel: document.getElementById('notificationPanel'),
    list: document.getElementById('notificationList'),
    empty: document.getElementById('notificationEmpty'),
    sentinel: document.getElementById('notificationLoadSentinel'),
    status: document.getElementById('notificationStatus'),
    readAll: document.getElementById('notificationReadAll'),
    filters: [...document.querySelectorAll('[data-notification-filter]')],
    banner: document.getElementById('urgentNotificationBanner'),
    bannerTitle: document.getElementById('urgentNotificationTitle'),
    bannerSummary: document.getElementById('urgentNotificationSummary'),
    bannerDismiss: document.getElementById('urgentNotificationDismiss')
  };
  if (!elements.toggle || !elements.panel) return;

  const state = {
    notifications: [],
    unreadCount: 0,
    urgentUnreadCount: 0,
    nextOffset: null,
    loading: false,
    filter: 'all',
    expandedId: null,
    open: false,
    eventSource: null,
    bannerTimer: 0,
    shownUrgentIds: new Set()
  };

  const typeLabels = {
    message: text('notify.typeMessage', '通讯消息'),
    urgent: text('notify.typeUrgent', '加急消息'),
    friend_request: text('notify.typeFriendRequest', '好友申请'),
    version: text('notify.typeVersion', '版本更新'),
    announcement: text('notify.typeAnnouncement', '系统通知')
  };

  const iconNames = {
    message: 'message-square-text',
    urgent: 'triangle-alert',
    friend_request: 'user-round-plus',
    version: 'file-text',
    announcement: 'megaphone'
  };

  function api(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function formatTime(value) {
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }

  function filteredNotifications() {
    if (state.filter === 'unread') return state.notifications.filter(item => item.unread);
    if (state.filter === 'urgent') return state.notifications.filter(item => item.urgent);
    return state.notifications;
  }

  function renderBell() {
    elements.badge.hidden = state.unreadCount < 1;
    elements.badge.textContent = state.unreadCount > 99 ? '99+' : String(state.unreadCount);
    elements.toggle.classList.toggle('has-urgent', state.urgentUnreadCount > 0);
    const label = state.urgentUnreadCount
      ? text('notify.titleUnreadUrgent', '通知中心，{count} 条未读，其中 {urgent} 条加急', { count: state.unreadCount, urgent: state.urgentUnreadCount })
      : text('notify.titleUnread', '通知中心，{count} 条未读', { count: state.unreadCount });
    elements.toggle.setAttribute('aria-label', label);
    elements.readAll.disabled = state.unreadCount < 1;
  }

  function createNotificationItem(notification) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'notification-item';
    item.classList.toggle('is-unread', notification.unread);
    item.classList.toggle('is-urgent', notification.urgent);
    item.dataset.notificationId = notification.id;
    item.setAttribute('aria-expanded', String(state.expandedId === notification.id));

    const icon = document.createElement('span');
    icon.className = 'notification-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24" data-icon="${iconNames[notification.type] || iconNames.announcement}" aria-hidden="true"></svg>`;

    const copy = document.createElement('span');
    copy.className = 'notification-item-copy';
    const heading = document.createElement('span');
    heading.className = 'notification-item-heading';
    const title = document.createElement('strong');
    title.textContent = notification.title;
    const time = document.createElement('time');
    time.dateTime = new Date(notification.createdAt).toISOString();
    time.textContent = formatTime(notification.createdAt);
    heading.append(title, time);
    const summary = document.createElement('span');
    summary.className = 'notification-item-summary';
    summary.textContent = notification.summary || notification.body || text('notify.viewDetailFallback', '查看通知详情');
    const meta = document.createElement('span');
    meta.className = 'notification-item-meta';
    const type = document.createElement('span');
    type.className = notification.urgent ? 'notification-urgent-label' : 'notification-type-label';
    type.textContent = notification.urgent ? text('notify.urgentTag', '加急') : (typeLabels[notification.type] || text('notify.typeFallback', '通知'));
    const actor = document.createElement('span');
    actor.textContent = notification.createdByDisplayName || (notification.type === 'version' ? text('notify.systemUpdateActor', '系统更新') : text('notify.systemActor', '系统'));
    meta.append(type, actor);
    copy.append(heading, summary, meta);
    item.append(icon, copy);

    if (state.expandedId === notification.id && notification.body) {
      const body = document.createElement('span');
      body.className = 'notification-item-body';
      body.textContent = notification.body;
      item.append(body);
    }
    item.addEventListener('click', () => activateNotification(notification));
    return item;
  }

  function renderList() {
    const items = filteredNotifications();
    elements.list.replaceChildren(...items.map(createNotificationItem));
    elements.empty.hidden = items.length > 0 || state.loading;
    renderBell();
  }

  function applyPayload(payload, append = false) {
    const incoming = payload.notifications || [];
    if (append) {
      const known = new Set(state.notifications.map(item => item.id));
      state.notifications.push(...incoming.filter(item => !known.has(item.id)));
    } else {
      state.notifications = incoming;
    }
    state.unreadCount = Number(payload.unreadCount || 0);
    state.urgentUnreadCount = Number(payload.urgentUnreadCount || 0);
    state.nextOffset = payload.nextOffset;
    renderList();
  }

  async function loadNotifications({ force = false, append = false } = {}) {
    if (state.loading || (append && state.nextOffset == null)) return;
    state.loading = true;
    elements.status.textContent = append ? text('notify.loadingOlder', '正在读取更早的通知…') : text('notify.syncing', '正在同步通知…');
    try {
      const offset = append ? state.nextOffset : 0;
      const payload = await api(`/api/notifications?offset=${offset}&limit=30`, { force });
      applyPayload(payload, append);
      elements.status.textContent = '';
      if (!append) showInitialUrgent(payload.notifications || []);
    } catch (error) {
      elements.status.textContent = text('notify.loadFailed', '通知读取失败：{message}', { message: error.message });
    } finally {
      state.loading = false;
      elements.empty.hidden = filteredNotifications().length > 0;
    }
  }

  function setOpen(open) {
    state.open = open;
    document.body.classList.toggle('notification-panel-open', open);
    elements.toggle.setAttribute('aria-expanded', String(open));
    elements.panel.hidden = !open;
    elements.panel.classList.toggle('is-open', open);
    if (open) {
      const userToggle = document.getElementById('headerUserToggle');
      if (userToggle?.getAttribute('aria-expanded') === 'true') userToggle.click();
      loadNotifications({ force: true });
      window.setTimeout(() => elements.filters.find(item => item.getAttribute('aria-selected') === 'true')?.focus(), 0);
    }
  }

  function dismissBanner() {
    window.clearTimeout(state.bannerTimer);
    elements.banner.classList.remove('is-visible');
    elements.banner.hidden = true;
    document.body.classList.remove('urgent-notification-visible');
  }

  function showUrgent(notification) {
    if (!notification?.urgent || !notification.unread) return;
    if (state.shownUrgentIds.has(notification.id)) return;
    state.shownUrgentIds.add(notification.id);
    elements.bannerTitle.textContent = notification.title;
    elements.bannerSummary.textContent = notification.summary || notification.body || text('notify.bannerFallback', '请尽快查看通知中心');
    elements.banner.hidden = false;
    document.body.classList.add('urgent-notification-visible');
    elements.banner.classList.add('is-visible');
    window.clearTimeout(state.bannerTimer);
    state.bannerTimer = window.setTimeout(dismissBanner, 5000);
  }

  function showInitialUrgent(notifications) {
    showUrgent(notifications.find(item => item.urgent && item.unread));
  }

  async function markRead(notification) {
    if (!notification.unread) return;
    notification.unread = false;
    state.unreadCount = Math.max(0, state.unreadCount - 1);
    if (notification.urgent) state.urgentUnreadCount = Math.max(0, state.urgentUnreadCount - 1);
    renderList();
    try {
      const payload = await api(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST' });
      state.unreadCount = payload.unreadCount;
      state.urgentUnreadCount = payload.urgentUnreadCount;
      renderBell();
    } catch {
      loadNotifications({ force: true });
    }
  }

  function navigate(page) {
    const button = document.querySelector(`[data-page="${CSS.escape(page)}"]`);
    if (button && !button.hidden) button.click();
  }

  async function activateNotification(notification) {
    await markRead(notification);
    if (notification.type === 'message' || notification.type === 'urgent') {
      setOpen(false);
      navigate('channels');
      window.dispatchEvent(new CustomEvent('stella:open-channel', {
        detail: { channelId: notification.targetValue, messageId: Number(notification.sourceId) || null }
      }));
      return;
    }
    if (notification.type === 'friend_request') {
      setOpen(false);
      navigate('friends');
      return;
    }
    if (notification.type === 'version') {
      setOpen(false);
      navigate('updates');
      return;
    }
    state.expandedId = state.expandedId === notification.id ? null : notification.id;
    renderList();
  }

  async function readAll() {
    if (!state.unreadCount) return;
    elements.readAll.disabled = true;
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
      state.notifications.forEach(item => { item.unread = false; });
      state.unreadCount = 0;
      state.urgentUnreadCount = 0;
      renderList();
    } catch (error) {
      elements.status.textContent = text('notify.actionFailed', '操作失败：{message}', { message: error.message });
    }
  }

  function startEvents() {
    state.eventSource?.close();
    if (!window.EventSource) return;
    const source = new EventSource('/api/notifications/events');
    state.eventSource = source;
    let everErrored = false;
    source.onerror = () => { everErrored = true; };
    // 断线重连成功后全量补拉一次，弥合断线窗口内错过的通知
    source.onopen = () => {
      if (!everErrored) return;
      everErrored = false;
      loadNotifications({ force: true }).catch(() => {});
    };
    source.addEventListener('notification', async event => {
      let detail = {};
      try { detail = JSON.parse(event.data || '{}'); } catch {}
      const before = new Set(state.notifications.filter(item => item.urgent && item.unread).map(item => item.id));
      await loadNotifications({ force: true });
      if (detail.urgent && detail.notificationId) {
        const notification = state.notifications.find(item => item.id === detail.notificationId);
        if (notification && !before.has(notification.id)) showUrgent(notification);
      }
    });
  }

  elements.toggle.addEventListener('click', () => setOpen(!state.open));
  elements.readAll.addEventListener('click', readAll);
  elements.bannerDismiss.addEventListener('click', dismissBanner);
  elements.filters.forEach(button => button.addEventListener('click', () => {
    state.filter = button.dataset.notificationFilter;
    elements.filters.forEach(item => item.setAttribute('aria-selected', String(item === button)));
    renderList();
  }));
  document.addEventListener('pointerdown', event => {
    if (!state.open) return;
    if (event.target.closest('.header-notification-center')) return;
    setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.open) return;
    setOpen(false);
    elements.toggle.focus();
  });

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) loadNotifications({ append: true });
  }, { rootMargin: '160px 0px' });
  observer.observe(elements.sentinel);

  document.addEventListener('DOMContentLoaded', () => {
    const ready = window.ProfileCenter?.ready || Promise.resolve();
    ready.finally(() => {
      loadNotifications();
      startEvents();
    });
  }, { once: true });
  window.addEventListener('stella:identity-change', () => loadNotifications({ force: true }));
  window.NotificationCenter = { refresh: () => loadNotifications({ force: true }), open: () => setOpen(true) };
})();
