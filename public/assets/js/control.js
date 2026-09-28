(function () {
  const pageCopy = {
    personalCenter: { titleKey: 'page.personalCenter.title', descriptionKey: 'page.personalCenter.desc' },
    events: { titleKey: 'page.events.title', descriptionKey: 'page.events.desc' },
    schedule: { titleKey: 'page.schedule.title', descriptionKey: 'page.schedule.desc' },
    teams: { titleKey: 'page.teams.title', descriptionKey: 'page.teams.desc' },
    players: { titleKey: 'page.players.title', descriptionKey: 'page.players.desc' },
    resourceMonitor: { titleKey: 'page.resourceMonitor.title', descriptionKey: 'page.resourceMonitor.desc' },
    matchRecords: { titleKey: 'page.matchRecords.title', descriptionKey: 'page.matchRecords.desc' },
    dataConfig: { titleKey: 'page.dataConfig.title', descriptionKey: 'page.dataConfig.desc' },
    terminalStatus: { titleKey: 'page.terminalStatus.title', descriptionKey: 'page.terminalStatus.desc' },
    systemSettings: { titleKey: 'page.systemSettings.title', descriptionKey: 'page.systemSettings.desc' },
    hudCenter: { titleKey: 'page.hudCenter.title', descriptionKey: 'page.hudCenter.desc' },
    riskResponse: { titleKey: 'page.riskResponse.title', descriptionKey: 'page.riskResponse.desc' },
    countdown: { titleKey: 'page.countdown.title', descriptionKey: 'page.countdown.desc' },
    bp: { titleKey: 'page.bp.title', descriptionKey: 'page.bp.desc' },
    characterStats: { titleKey: 'page.characterStats.title', descriptionKey: 'page.characterStats.desc' },
    bracket: { titleKey: 'page.bracket.title', descriptionKey: 'page.bracket.desc' },
    materials: { titleKey: 'page.materials.title', descriptionKey: 'page.materials.desc' },
    profile: { titleKey: 'page.profile.title', descriptionKey: 'page.profile.desc' },
    friends: { titleKey: 'page.friends.title', descriptionKey: 'page.friends.desc' },
    addFriend: { titleKey: 'page.addFriend.title', descriptionKey: 'page.addFriend.desc' },
    channels: { titleKey: 'page.channels.title', descriptionKey: 'page.channels.desc' },
    systemManagement: { titleKey: 'page.systemManagement.title', descriptionKey: 'page.systemManagement.desc' },
    accounts: { titleKey: 'page.accounts.title', descriptionKey: 'page.accounts.desc' },
    permissions: { titleKey: 'page.permissions.title', descriptionKey: 'page.permissions.desc' },
    notificationManagement: { titleKey: 'page.notificationManagement.title', descriptionKey: 'page.notificationManagement.desc' },
    logs: { titleKey: 'page.logs.title', descriptionKey: 'page.logs.desc' },
    updates: { titleKey: 'page.updates.title', descriptionKey: 'page.updates.desc' }
  };

  const NAV_STATE_KEY = 'zfb.nav-state';
  const navState = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(NAV_STATE_KEY));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  })();
  if (!navState.openGroups || typeof navState.openGroups !== 'object') navState.openGroups = {};

  function saveNavState() {
    try {
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify(navState));
    } catch {}
  }

  const toast = document.createElement('div');
  toast.className = 'nav-toast';
  document.body.appendChild(toast);
  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function isSidebarCollapsed() {
    return document.body.classList.contains('sidebar-collapsed')
      || window.matchMedia('(max-width: 900px)').matches;
  }

  function setSidebarCollapsed(collapsed, persist = true) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const toggleButton = document.getElementById('sidebarToggle');
    toggleButton.title = collapsed ? t('nav.expand') : t('nav.collapse');
    toggleButton.setAttribute('aria-label', toggleButton.title);
    closeNavFlyout();
    clearFlyoutTimers();
    if (persist) {
      navState.collapsed = collapsed;
      saveNavState();
    }
  }

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    setSidebarCollapsed(!isSidebarCollapsed());
  });

  document.querySelector('.sidebar').addEventListener('dblclick', event => {
    if (event.target.closest('.sidebar-collapse')) return;
    if (isSidebarCollapsed()) setSidebarCollapsed(false);
  });

  const flyout = document.createElement('div');
  flyout.className = 'nav-flyout';
  document.body.appendChild(flyout);
  let flyoutToggle = null;
  let hoverToggle = null;
  let pointerInFlyout = false;
  let flyoutHoverTimer = 0;
  let flyoutCloseTimer = 0;
  let flyoutSwitchTimer = 0;

  function clearFlyoutTimers() {
    clearTimeout(flyoutHoverTimer);
    clearTimeout(flyoutCloseTimer);
    clearTimeout(flyoutSwitchTimer);
    flyoutHoverTimer = 0;
    flyoutCloseTimer = 0;
    flyoutSwitchTimer = 0;
  }

  function closeNavFlyout() {
    clearTimeout(flyoutSwitchTimer);
    if (!flyoutToggle) return;
    flyoutToggle.classList.remove('flyout-open');
    flyoutToggle = null;
    flyout.classList.remove('show');
  }

  function openNavFlyout(group, toggle) {
    clearFlyoutTimers();
    if (flyoutToggle === toggle) return;
    const fill = () => {
      flyoutToggle = toggle;
      toggle.classList.add('flyout-open');
      flyout.replaceChildren(...Array.from(group.querySelectorAll('.nav-group-items .nav-btn')).map(button => {
        const clone = button.cloneNode(true);
        clone.addEventListener('click', () => {
          button.click();
          closeNavFlyout();
        });
        return clone;
      }));
      const rect = toggle.getBoundingClientRect();
      flyout.style.left = 'var(--nav-flyout-left)';
      flyout.style.top = `${Math.round(rect.top)}px`;
      flyout.classList.add('show');
      const flyoutRect = flyout.getBoundingClientRect();
      flyout.style.top = `${Math.round(Math.max(12, Math.min(rect.top, window.innerHeight - flyoutRect.height - 12)))}px`;
    };
    if (flyout.classList.contains('show')) {
      // 切换父级：先播放收起动画，再展开新子菜单
      if (flyoutToggle) flyoutToggle.classList.remove('flyout-open');
      flyoutToggle = null;
      flyout.classList.remove('show');
      flyoutSwitchTimer = setTimeout(() => {
        flyoutSwitchTimer = 0;
        if (!flyout.classList.contains('show') && hoverToggle === toggle) fill();
      }, 200);
    } else {
      fill();
    }
  }

  document.addEventListener('click', event => {
    if (flyoutToggle && !flyout.contains(event.target) && !flyoutToggle.contains(event.target)) {
      closeNavFlyout();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeNavFlyout();
  });
  flyout.addEventListener('mouseenter', () => {
    pointerInFlyout = true;
    clearTimeout(flyoutCloseTimer);
  });
  flyout.addEventListener('mouseleave', () => {
    pointerInFlyout = false;
    clearTimeout(flyoutCloseTimer);
    flyoutCloseTimer = setTimeout(() => {
      flyoutCloseTimer = 0;
      if (!pointerInFlyout && hoverToggle !== flyoutToggle) closeNavFlyout();
    }, 220);
  });

  document.querySelectorAll('[data-nav-group]').forEach(group => {
    const key = group.dataset.navGroup;
    const toggle = group.querySelector('.nav-group-toggle');
    group.dataset.open = navState.openGroups[key] ? 'true' : 'false';
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      if (isSidebarCollapsed()) {
        if (flyoutToggle === toggle) closeNavFlyout();
        else openNavFlyout(group, toggle);
        return;
      }
      const open = group.dataset.open !== 'true';
      group.dataset.open = String(open);
      navState.openGroups[key] = open;
      saveNavState();
    });
    toggle.addEventListener('mouseenter', () => {
      if (!isSidebarCollapsed()) return;
      hoverToggle = toggle;
      if (flyoutToggle === toggle) {
        clearTimeout(flyoutCloseTimer);
        return;
      }
      clearTimeout(flyoutHoverTimer);
      clearTimeout(flyoutCloseTimer);
      flyoutHoverTimer = setTimeout(() => {
        flyoutHoverTimer = 0;
        if (isSidebarCollapsed() && hoverToggle === toggle) openNavFlyout(group, toggle);
      }, 250);
    });
    toggle.addEventListener('mouseleave', () => {
      if (hoverToggle === toggle) hoverToggle = null;
      clearTimeout(flyoutHoverTimer);
      if (flyoutToggle === toggle && !pointerInFlyout) {
        clearTimeout(flyoutCloseTimer);
        flyoutCloseTimer = setTimeout(() => {
          flyoutCloseTimer = 0;
          if (!pointerInFlyout && hoverToggle !== flyoutToggle) closeNavFlyout();
        }, 220);
      }
    });
  });

  const SOON_MARK = '<svg class="nav-soon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.4L14.4 13H1.6L8 2.4z"/><path d="M8 6.9v2.7M8 11.4v.01"/></svg>';
  const DEVELOPMENT_MARK = '<span class="nav-development" aria-hidden="true"></span>';
  document.querySelectorAll('[data-soon]').forEach(button => {
    button.insertAdjacentHTML('beforeend', SOON_MARK);
  });
  document.querySelectorAll('[data-development]').forEach(button => {
    button.insertAdjacentHTML('beforeend', DEVELOPMENT_MARK);
  });

  document.querySelectorAll('[data-soon]').forEach(button => {
    button.addEventListener('click', () => showToast(t('nav.soonToast', { label: t(button.dataset.soon) })));
  });

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.hasAttribute('data-requires-developer') && !document.body.classList.contains('auth-developer')) return;
      const page = button.dataset.page;
      if (!window.dispatchEvent(new CustomEvent('stella:before-page-change', {
        cancelable: true,
        detail: { page }
      }))) return;
      document.body.classList.toggle('updates-mode', page === 'updates');
      if (page === 'bp') {
        try {
          window.moveTo(0, 0);
          window.resizeTo(window.screen.availWidth, window.screen.availHeight);
        } catch {}
        fetch('/api/window/maximize', { method: 'POST' }).catch(() => {});
      }
      document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-page-panel]').forEach(panel => {
        const active = panel.dataset.pagePanel === page;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
      document.getElementById('pageTitle').textContent = t(pageCopy[page].titleKey);
      document.getElementById('pageDescription').textContent = t(pageCopy[page].descriptionKey);
      const activeGroup = button.closest('[data-nav-group]');
      if (activeGroup && !isSidebarCollapsed()) {
        activeGroup.dataset.open = 'true';
        navState.openGroups[activeGroup.dataset.navGroup] = true;
        saveNavState();
      }
      document.querySelectorAll('[data-nav-group]').forEach(group => {
        group.classList.toggle('has-active', Boolean(group.querySelector('[data-page].active')));
        group.classList.toggle('has-development-active', Boolean(group.querySelector('[data-development].active')));
      });
      window.dispatchEvent(new CustomEvent('stella:page-change', { detail: { page } }));
    });
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/';
  });

  const DEFAULT_PAGE = 'personalCenter';
  const initialPage = new URLSearchParams(window.location.search).get('page');
  if (window.location.search || window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  const activeButton = (initialPage && pageCopy[initialPage])
    ? document.querySelector(`[data-page="${initialPage}"]`)
    : document.querySelector(`[data-page="${DEFAULT_PAGE}"]`);
  function activateInitialButton(button) {
    if (!button) return;
    if (button.hasAttribute('data-requires-developer') && !document.body.classList.contains('auth-developer')) return;
    const activeGroup = button.closest('[data-nav-group]');
    if (activeGroup) {
      activeGroup.dataset.open = 'true';
      navState.openGroups[activeGroup.dataset.navGroup] = true;
      saveNavState();
    }
    button.click();
  }
  if (activeButton?.hasAttribute('data-requires-developer') && window.ProfileCenter?.ready) {
    window.ProfileCenter.ready.then(profile => {
      if (profile.identity?.systemManagement) activateInitialButton(activeButton);
    }).catch(() => {});
  } else if (activeButton) {
    activateInitialButton(activeButton);
  }
  window.Text.ready.then(() => {
    const activePageButton = document.querySelector('[data-page].active');
    if (activePageButton && pageCopy[activePageButton.dataset.page]) {
      document.getElementById('pageTitle').textContent = t(pageCopy[activePageButton.dataset.page].titleKey);
      document.getElementById('pageDescription').textContent = t(pageCopy[activePageButton.dataset.page].descriptionKey);
    }
  }).catch(() => {});
  document.querySelectorAll('[data-nav-group]').forEach(group => {
    group.classList.toggle('has-active', Boolean(group.querySelector('[data-page].active')));
    group.classList.toggle('has-development-active', Boolean(group.querySelector('[data-development].active')));
  });
  if (navState.collapsed) setSidebarCollapsed(true, false);
  if (!initialPage && window.ProfileCenter?.ready) {
    window.ProfileCenter.ready.then(profile => {
      const preferred = pageCopy[profile.home.defaultPage]
        ? document.querySelector(`[data-page="${profile.home.defaultPage}"]`)
        : null;
      if (preferred && !preferred.classList.contains('active')) preferred.click();
    }).catch(() => {});
  }

  const params = new URLSearchParams(window.location.search);
  let hubId = 'countdown';
  let state = null;
  let eventSource = null;
  let renderTimer = null;

  const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    hubUrl: document.getElementById('hubUrl'),
    copyHub: document.getElementById('copyHub'),
    newHub: document.getElementById('newHub'),
    hubCopyStatus: document.getElementById('hubCopyStatus'),
    previewDigits: document.getElementById('previewDigits'),
    modeChip: document.getElementById('modeChip'),
    targetAt: document.getElementById('targetAt'),
    hours: document.getElementById('hours'),
    minutes: document.getElementById('minutes'),
    seconds: document.getElementById('seconds'),
    applyTarget: document.getElementById('applyTarget'),
    applyDuration: document.getElementById('applyDuration'),
    start: document.getElementById('start'),
    pause: document.getElementById('pause'),
    reset: document.getElementById('reset'),
    logList: document.getElementById('logList'),
    bpAnimationStyle: document.getElementById('bpAnimationStyle'),
    bpTimerSettings: document.getElementById('bpTimerSettings'),
    bpTimerSettingsStatus: document.getElementById('bpTimerSettingsStatus'),
    saveBpTimerSettings: document.getElementById('saveBpTimerSettings')
  };

  let bpTimerConfig = null;
  let countdownLogCursor = null;
  let countdownLogsLoading = false;
  let countdownLogsComplete = false;
  const renderedCountdownLogIds = new Set();
  let lastCountdownLogId = 0;

  function absoluteUrl(path) {
    return new URL(path, window.location.origin).href;
  }

  function setStatus(text) {
    elements.connectionStatus.textContent = text;
    elements.connectionStatus.classList.toggle('status-online', text === t('header.hubOnline'));
    elements.connectionStatus.classList.toggle('status-error', text === t('header.connectFailed'));
    elements.connectionStatus.classList.toggle('status-pending', text !== t('header.hubOnline') && text !== t('header.connectFailed'));
  }

  function formatCountdownLogTimestamp(value = Date.now()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '----/--/-- --:--:--';
    const parts = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(date).reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  function addLog(entry, options = {}) {
    const persisted = entry && typeof entry === 'object';
    const id = persisted ? String(entry.id) : null;
    if (id && renderedCountdownLogIds.has(id)) return;
    const item = document.createElement('div');
    item.className = 'log-item';
    if (persisted) {
      renderedCountdownLogIds.add(id);
      lastCountdownLogId = Math.max(lastCountdownLogId, Number(entry.id) || 0);
      item.dataset.logId = id;
      item.classList.toggle('error', !entry.success);
      const actor = entry.actorName && entry.actorName !== '系统' ? `  ${entry.actorName} · ` : '  ';
      item.textContent = `${formatCountdownLogTimestamp(entry.timestamp)}${actor}${entry.action}${entry.error ? `：${entry.error}` : ''}`;
    } else {
      item.textContent = `${formatCountdownLogTimestamp()}  ${entry}`;
    }
    if (options.append) elements.logList.append(item);
    else elements.logList.prepend(item);
  }

  async function loadCountdownLogs(reset = false) {
    if (countdownLogsLoading || (!reset && countdownLogsComplete)) return;
    if (reset) {
      countdownLogCursor = null;
      countdownLogsComplete = false;
      renderedCountdownLogIds.clear();
      elements.logList.replaceChildren();
    }
    countdownLogsLoading = true;
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (countdownLogCursor) params.set('cursor', countdownLogCursor);
      const response = await fetch(`/api/hubs/${hubId}/logs?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法读取计时日志');
      payload.logs.forEach(log => addLog(log, { append: true }));
      countdownLogCursor = payload.nextCursor;
      countdownLogsComplete = !payload.hasMore;
    } catch (error) {
      addLog(error.message);
    } finally {
      countdownLogsLoading = false;
    }
  }

  async function jsonRequest(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function renderBpTimerSettings(config) {
    bpTimerConfig = config;
    const animationInput = elements.bpAnimationStyle.querySelector(`[value="${CSS.escape(config.animationStyle)}"]`);
    if (animationInput) animationInput.checked = true;
    const groups = [
      { role: 'escape', titleKey: 'cd.escapeTimerGroup', descriptionKey: 'cd.escapeTimerGroupDesc' },
      { role: 'hunter', titleKey: 'cd.hunterTimerGroup', descriptionKey: 'cd.hunterTimerGroupDesc' }
    ];
    elements.bpTimerSettings.replaceChildren(...groups.map(group => {
      const section = document.createElement('section');
      section.className = `bp-timer-group bp-timer-group-${group.role}`;
      const header = document.createElement('header');
      const title = document.createElement('h3');
      title.textContent = group.title;
      const description = document.createElement('p');
      description.textContent = group.description;
      header.append(title, description);
      const list = document.createElement('div');
      list.className = 'bp-timer-group-list';
      config.phases.filter(phase => phase.role === group.role).forEach(phase => {
        const index = config.phases.findIndex(item => item.id === phase.id);
        const label = document.createElement('label');
        label.className = 'bp-timer-setting';
        const number = document.createElement('span');
        number.textContent = String(index + 1).padStart(2, '0');
        const copy = document.createElement('span');
        copy.textContent = phase.label;
        const input = document.createElement('input');
        input.className = 'input';
        input.type = 'number';
        input.min = '1';
        input.max = '300';
        input.step = '1';
        input.value = config.phaseDurations[phase.id];
        input.dataset.phaseId = phase.id;
        input.setAttribute('aria-label', t('cd.phaseSecondsAria', { label: phase.label }));
        const unit = document.createElement('small');
        unit.textContent = t('common.secondsUnit');
        label.append(number, copy, input, unit);
        list.append(label);
      });
      section.append(header, list);
      return section;
    }));
  }

  async function loadBpTimerSettings() {
    try {
      renderBpTimerSettings(await jsonRequest('/api/bp/timer-config'));
      elements.bpTimerSettingsStatus.textContent = '';
      elements.bpTimerSettingsStatus.className = '';
    } catch (error) {
      elements.bpTimerSettingsStatus.textContent = error.message;
      elements.bpTimerSettingsStatus.className = 'error';
    }
  }

  async function saveBpTimerSettings() {
    const values = {};
    elements.bpTimerSettings.querySelectorAll('[data-phase-id]').forEach(input => {
      values[input.dataset.phaseId] = Number(input.value);
    });
    const selectedAnimation = elements.bpAnimationStyle.querySelector('input:checked')?.value;
    elements.saveBpTimerSettings.disabled = true;
    elements.bpTimerSettingsStatus.textContent = t('cd.saving');
    elements.bpTimerSettingsStatus.className = '';
    try {
      const next = await jsonRequest('/api/bp/timer-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phaseDurations: values, animationStyle: selectedAnimation })
      });
      renderBpTimerSettings(next);
      elements.bpTimerSettingsStatus.textContent = t('cd.saved');
      elements.bpTimerSettingsStatus.className = 'success';
      if (next.eventLog) addLog(next.eventLog);
    } catch (error) {
      elements.bpTimerSettingsStatus.textContent = error.message;
      elements.bpTimerSettingsStatus.className = 'error';
    } finally {
      elements.saveBpTimerSettings.disabled = false;
    }
  }

  async function createHub() {
    const response = await fetch('/api/hubs', { method: 'POST' });
    const payload = await response.json();
    hubId = payload.id;
    updateHubUrl();
    addLog(t('cd.hubConfirmedLog'));
  }

  function updateHubUrl() {
    if (elements.hubUrl) elements.hubUrl.value = absoluteUrl('/hub/countdown');
  }

  function render() {
    if (!state) return;
    const remaining = window.CountdownHub.currentRemaining(state);
    const value = window.CountdownHub.formatClock(remaining);
    elements.previewDigits.textContent = value;
    const available = Math.max(1, elements.previewDigits.clientWidth - 32);
    const fontSize = Math.max(30, Math.min(86, available / Math.max(1, value.length * 0.62)));
    elements.previewDigits.style.fontSize = `${fontSize}px`;
    elements.modeChip.textContent = state.mode === 'target' ? t('cd.modeTarget') : t('cd.modeDuration');
  }

  function applyState(nextState) {
    state = nextState;
    render();
  }

  function connectEvents() {
    if (eventSource) eventSource.close();
    let everErrored = false;
    eventSource = new EventSource(`/api/hubs/${hubId}/events`);
    eventSource.addEventListener('state', event => {
      applyState(JSON.parse(event.data));
      setStatus(t('header.hubOnline'));
    });
    eventSource.addEventListener('event-log', event => addLog(JSON.parse(event.data)));
    eventSource.onerror = () => {
      everErrored = true;
      setStatus(t('header.reconnecting'));
    };
    // 断线重连成功后补拉全量状态弥合错过推送，并按增量补齐断线窗口内的操作日志
    eventSource.onopen = async () => {
      if (!everErrored) return;
      everErrored = false;
      setStatus(t('header.hubOnline'));
      try {
        const response = await fetch(`/api/hubs/${hubId}/state`, { cache: 'no-store' });
        if (response.ok) applyState(await response.json());
      } catch {}
      if (lastCountdownLogId > 0) {
        try {
          const response = await fetch(`/api/hubs/${hubId}/logs?after=${lastCountdownLogId}`, { cache: 'no-store' });
          const payload = await response.json();
          if (response.ok && Array.isArray(payload.logs)) payload.logs.forEach(log => addLog(log, { append: true }));
        } catch {}
      }
    };
  }

  async function connect() {
    if (!hubId) {
      await createHub();
      return;
    }
    updateHubUrl();
    const response = await fetch(`/api/hubs/${hubId}/state`);
    applyState(await response.json());
    connectEvents();
    setStatus(t('header.hubOnline'));
  }

  async function sendAction(action, logText) {
    try {
      const response = await fetch(`/api/hubs/${hubId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || logText);
      const { eventLog, ...nextState } = payload;
      applyState(nextState);
      if (eventLog) addLog(eventLog);
    } catch (error) {
      addLog(error.message);
    }
  }

  function targetLocalToIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  if (elements.newHub) elements.newHub.addEventListener('click', createHub);
  if (elements.copyHub) elements.copyHub.addEventListener('click', async () => {
    elements.hubCopyStatus.textContent = '';
    elements.hubCopyStatus.classList.remove('is-error');
    try {
      await navigator.clipboard.writeText(elements.hubUrl.value);
      elements.hubCopyStatus.textContent = t('cd.copiedLog');
      addLog(t('cd.copiedLog'));
    } catch {
      elements.hubCopyStatus.textContent = t('cd.copyFailed');
      elements.hubCopyStatus.classList.add('is-error');
    }
  });
  elements.applyTarget.addEventListener('click', () => {
    const targetAt = targetLocalToIso(elements.targetAt.value);
    if (!targetAt) return;
    sendAction({ type: 'set-target', targetAt }, t('cd.appliedTargetLog'));
  });
  elements.applyDuration.addEventListener('click', () => {
    const hours = window.CountdownHub.nonNegativeInteger(elements.hours.value);
    const minutes = window.CountdownHub.clamp(elements.minutes.value, 0, 59);
    const seconds = window.CountdownHub.clamp(elements.seconds.value, 0, 59);
    elements.hours.value = hours;
    elements.minutes.value = minutes;
    elements.seconds.value = seconds;
    sendAction({ type: 'set-duration', hours, minutes, seconds }, t('cd.appliedDurationLog', { hours, minutes, seconds }));
  });
  elements.start.addEventListener('click', () => sendAction({ type: 'start' }, t('cd.startLog')));
  elements.pause.addEventListener('click', () => sendAction({ type: 'pause' }, t('cd.pauseLog')));
  elements.reset.addEventListener('click', () => {
    elements.targetAt.value = '';
    elements.hours.value = 0;
    elements.minutes.value = 0;
    elements.seconds.value = 0;
    sendAction({ type: 'reset' }, t('cd.resetLog'));
  });
  elements.saveBpTimerSettings.addEventListener('click', saveBpTimerSettings);
  document.querySelector('[data-page="countdown"]').addEventListener('click', loadBpTimerSettings);
  elements.logList.addEventListener('scroll', () => {
    const remaining = elements.logList.scrollHeight - elements.logList.scrollTop - elements.logList.clientHeight;
    if (remaining < 80) loadCountdownLogs();
  });

  renderTimer = setInterval(render, 200);
  window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
    if (renderTimer) clearInterval(renderTimer);
  });

  connect().catch(error => {
    setStatus(t('header.connectFailed'));
    addLog(error.message);
  });
  loadCountdownLogs(true);
  loadBpTimerSettings();
})();
