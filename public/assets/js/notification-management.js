(function () {
  'use strict';

  const elements = {
    page: document.getElementById('notificationManagementPage'),
    form: document.getElementById('notificationPublishForm'),
    identity: document.getElementById('notificationTargetIdentity'),
    account: document.getElementById('notificationTargetAccount'),
    targetControls: [...document.querySelectorAll('[data-notification-target-control]')],
    title: document.getElementById('notificationPublishTitle'),
    summary: document.getElementById('notificationPublishSummary'),
    body: document.getElementById('notificationPublishBody'),
    urgent: document.getElementById('notificationPublishUrgent'),
    submit: document.getElementById('notificationPublishSubmit'),
    publishStatus: document.getElementById('notificationPublishStatus'),
    history: document.getElementById('notificationHistoryList'),
    historyEmpty: document.getElementById('notificationHistoryEmpty'),
    historyStatus: document.getElementById('notificationHistoryStatus'),
    historySentinel: document.getElementById('notificationHistorySentinel'),
    refresh: document.getElementById('notificationHistoryRefresh'),
    titleCount: document.getElementById('notificationPublishTitleCount'),
    summaryCount: document.getElementById('notificationPublishSummaryCount'),
    bodyCount: document.getElementById('notificationPublishBodyCount')
  };
  if (!elements.page || !elements.form) return;

  const state = {
    initialized: false,
    loading: false,
    loadingMore: false,
    notifications: [],
    nextOffset: null,
    accounts: [],
    identities: []
  };

  function api(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function formatTime(value) {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  function targetLabel(notification) {
    if (notification.targetKind === 'all') return '全部账号';
    if (notification.targetKind === 'identity') {
      return state.identities.find(item => item.key === notification.targetValue)?.label || notification.targetValue || '指定身份';
    }
    if (notification.targetKind === 'account') {
      const account = state.accounts.find(item => item.id === notification.targetValue);
      return account?.displayName || '指定账号';
    }
    return '系统分发';
  }

  function renderOptions() {
    elements.identity.replaceChildren(...state.identities.map(identity => {
      const option = document.createElement('option');
      option.value = identity.key;
      option.textContent = identity.label;
      return option;
    }));
    elements.account.replaceChildren(...state.accounts.filter(account => account.status === 'active').map(account => {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = `${account.displayName} (${account.account})`;
      return option;
    }));
  }

  function createHistoryItem(notification) {
    const item = document.createElement('article');
    item.className = 'notification-history-item';
    const title = document.createElement('strong');
    title.textContent = notification.title;
    const time = document.createElement('time');
    time.dateTime = new Date(notification.createdAt).toISOString();
    time.textContent = formatTime(notification.createdAt);
    const summary = document.createElement('p');
    summary.textContent = notification.summary || notification.body || '未填写摘要';
    const meta = document.createElement('div');
    meta.className = 'notification-history-meta';
    if (notification.urgent) {
      const urgent = document.createElement('small');
      urgent.className = 'notification-history-urgent';
      urgent.textContent = '加急';
      meta.append(urgent);
    }
    const target = document.createElement('small');
    target.textContent = targetLabel(notification);
    const reads = document.createElement('small');
    reads.textContent = `${notification.readCount} / ${notification.recipientCount} 已读`;
    meta.append(target, reads);
    item.append(title, time, summary, meta);
    return item;
  }

  function renderHistory() {
    elements.history.replaceChildren(...state.notifications.map(createHistoryItem));
    elements.historyEmpty.hidden = state.notifications.length > 0 || state.loading;
  }

  function applyPayload(payload, append) {
    state.accounts = payload.accounts || state.accounts;
    state.identities = payload.identities || state.identities;
    if (append) {
      const known = new Set(state.notifications.map(item => item.id));
      state.notifications.push(...(payload.notifications || []).filter(item => !known.has(item.id)));
    } else {
      state.notifications = payload.notifications || [];
    }
    state.nextOffset = payload.nextOffset;
    renderOptions();
    renderHistory();
  }

  async function load({ force = false, append = false } = {}) {
    if ((append && (state.loadingMore || state.nextOffset == null)) || (!append && state.loading)) return;
    if (append) state.loadingMore = true;
    else state.loading = true;
    elements.historyStatus.textContent = append ? '正在读取更早的发布记录…' : '正在读取发布记录…';
    try {
      const offset = append ? state.nextOffset : 0;
      const payload = await api(`/api/admin/notifications?offset=${offset}&limit=30`, { force });
      applyPayload(payload, append);
      state.initialized = true;
      elements.historyStatus.textContent = '';
    } catch (error) {
      elements.historyStatus.textContent = `发布记录读取失败：${error.message}`;
    } finally {
      state.loading = false;
      state.loadingMore = false;
      elements.historyEmpty.hidden = state.notifications.length > 0;
    }
  }

  function selectedTargetKind() {
    return elements.form.elements.notificationTargetKind.value || 'all';
  }

  const targetOrder = { all: 0, identity: 1, account: 2 };
  let lastTargetIndex = null;

  function updateTargetControls() {
    const kind = selectedTargetKind();
    const index = targetOrder[kind] ?? 0;
    // 方向感知：标记切换方向供表单入场动画选择落入/升入
    if (lastTargetIndex != null && index !== lastTargetIndex) {
      elements.form.dataset.targetDir = index > lastTargetIndex ? 'forward' : 'backward';
    }
    lastTargetIndex = index;
    elements.form.dataset.targetKind = kind;
    elements.targetControls.forEach(control => {
      const active = control.dataset.notificationTargetControl === kind;
      control.hidden = !active;
      control.querySelector('select').disabled = !active;
    });
  }

  function updateCounts() {
    elements.titleCount.textContent = String(Array.from(elements.title.value).length);
    elements.summaryCount.textContent = String(Array.from(elements.summary.value).length);
    elements.bodyCount.textContent = String(Array.from(elements.body.value).length);
  }

  async function publish(event) {
    event.preventDefault();
    const kind = selectedTargetKind();
    const value = kind === 'identity' ? elements.identity.value : (kind === 'account' ? elements.account.value : null);
    elements.submit.disabled = true;
    elements.publishStatus.textContent = '正在发布通知…';
    try {
      const payload = await api('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: elements.title.value,
          summary: elements.summary.value,
          body: elements.body.value,
          urgent: elements.urgent.checked,
          target: { kind, value }
        })
      });
      elements.publishStatus.textContent = `通知已发送给 ${payload.recipientCount} 个账号`;
      elements.title.value = '';
      elements.summary.value = '';
      elements.body.value = '';
      elements.urgent.checked = false;
      updateCounts();
      await load({ force: true });
      window.NotificationCenter?.refresh();
    } catch (error) {
      elements.publishStatus.textContent = `发布失败：${error.message}`;
    } finally {
      elements.submit.disabled = false;
    }
  }

  elements.form.addEventListener('change', event => {
    if (event.target.name === 'notificationTargetKind') updateTargetControls();
  });
  elements.form.addEventListener('input', updateCounts);
  elements.form.addEventListener('submit', publish);
  elements.refresh.addEventListener('click', () => load({ force: true }));
  updateTargetControls();
  updateCounts();

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !elements.page.hidden) load({ append: true });
  }, { rootMargin: '220px 0px' });
  observer.observe(elements.historySentinel);

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page !== 'notificationManagement') return;
    load({ force: state.initialized });
  });
  window.addEventListener('stella:identity-change', () => {
    state.initialized = false;
    state.notifications = [];
  });

  document.addEventListener('DOMContentLoaded', () => {
    const ready = window.ProfileCenter?.ready;
    if (!ready) return;
    ready.then(profile => {
      if ((profile.permissions || []).includes('notifications.publish')) load();
    }).catch(() => {});
  }, { once: true });
})();
