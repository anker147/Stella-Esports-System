(function () {
  const pageCopy = {
    countdown: { title: t('page.countdown.title'), description: t('page.countdown.desc') },
    bp: { title: t('page.bp.title'), description: t('page.bp.desc') },
    bracket: { title: t('page.bracket.title'), description: t('page.bracket.desc') },
    materials: { title: t('page.materials.title'), description: t('page.materials.desc') },
    logs: { title: t('page.logs.title'), description: t('page.logs.desc') },
    updates: { title: t('page.updates.title'), description: t('page.updates.desc') }
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
    return document.body.classList.contains('sidebar-collapsed');
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
  document.querySelectorAll('[data-soon]').forEach(button => {
    button.insertAdjacentHTML('beforeend', SOON_MARK);
  });

  document.querySelectorAll('[data-soon]').forEach(button => {
    button.addEventListener('click', () => showToast(t('nav.soonToast', { label: t(button.dataset.soon) })));
  });

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => {
      const page = button.dataset.page;
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
      document.getElementById('pageTitle').textContent = pageCopy[page].title;
      document.getElementById('pageDescription').textContent = pageCopy[page].description;
      document.querySelectorAll('[data-nav-group]').forEach(group => {
        group.classList.toggle('has-active', Boolean(group.querySelector('[data-page].active')));
      });
    });
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/';
  });

  const initialPage = new URLSearchParams(window.location.search).get('page');
  const activeButton = (initialPage && pageCopy[initialPage])
    ? document.querySelector(`[data-page="${initialPage}"]`)
    : document.querySelector('[data-page].active');
  if (activeButton) {
    const activeGroup = activeButton.closest('[data-nav-group]');
    if (activeGroup) {
      activeGroup.dataset.open = 'true';
      navState.openGroups[activeGroup.dataset.navGroup] = true;
      saveNavState();
    }
    if (initialPage && pageCopy[initialPage]) activeButton.click();
  }
  document.querySelectorAll('[data-nav-group]').forEach(group => {
    group.classList.toggle('has-active', Boolean(group.querySelector('[data-page].active')));
  });
  if (navState.collapsed) setSidebarCollapsed(true, false);

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
    previewDigits: document.getElementById('previewDigits'),
    modeChip: document.getElementById('modeChip'),
    targetAt: document.getElementById('targetAt'),
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

  function absoluteUrl(path) {
    return new URL(path, window.location.origin).href;
  }

  function setStatus(text) {
    elements.connectionStatus.textContent = text;
  }

  function addLog(text) {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
    elements.logList.prepend(item);
    while (elements.logList.children.length > 10) {
      elements.logList.lastElementChild.remove();
    }
  }

  async function jsonRequest(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t('common.requestFailed', { status: response.status }));
    return payload;
  }

  function renderBpTimerSettings(config) {
    bpTimerConfig = config;
    const animationInput = elements.bpAnimationStyle.querySelector(`[value="${CSS.escape(config.animationStyle)}"]`);
    if (animationInput) animationInput.checked = true;
    elements.bpTimerSettings.replaceChildren(...config.phases.map((phase, index) => {
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
      return label;
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
      addLog(t('cd.savedLog', { mode: selectedAnimation === 'classic' ? t('cd.animClassicName') : t('cd.animLuminanceName') }));
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
    elements.hubUrl.value = absoluteUrl('/hub/countdown');
  }

  function render() {
    if (!state) return;
    const remaining = window.CountdownHub.currentRemaining(state);
    elements.previewDigits.textContent = window.CountdownHub.formatClock(remaining);
    elements.modeChip.textContent = state.mode === 'target' ? t('cd.modeTarget') : t('cd.modeDuration');
  }

  function applyState(nextState) {
    state = nextState;
    render();
  }

  function connectEvents() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/hubs/${hubId}/events`);
    eventSource.addEventListener('state', event => {
      applyState(JSON.parse(event.data));
      setStatus(t('header.hubOnline'));
    });
    eventSource.onerror = () => setStatus(t('header.reconnecting'));
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
    const response = await fetch(`/api/hubs/${hubId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action)
    });
    applyState(await response.json());
    addLog(logText);
  }

  function targetLocalToIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  elements.newHub.addEventListener('click', createHub);
  elements.copyHub.addEventListener('click', async () => {
    await navigator.clipboard.writeText(elements.hubUrl.value);
    addLog(t('cd.copiedLog'));
  });
  elements.applyTarget.addEventListener('click', () => {
    const targetAt = targetLocalToIso(elements.targetAt.value);
    if (!targetAt) return;
    sendAction({ type: 'set-target', targetAt }, t('cd.appliedTargetLog'));
  });
  elements.applyDuration.addEventListener('click', () => {
    const minutes = window.CountdownHub.clamp(elements.minutes.value, 0, 99);
    const seconds = window.CountdownHub.clamp(elements.seconds.value, 0, 59);
    elements.minutes.value = minutes;
    elements.seconds.value = seconds;
    sendAction({ type: 'set-duration', minutes, seconds }, t('cd.appliedDurationLog', { minutes, seconds }));
  });
  elements.start.addEventListener('click', () => sendAction({ type: 'start' }, t('cd.startLog')));
  elements.pause.addEventListener('click', () => sendAction({ type: 'pause' }, t('cd.pauseLog')));
  elements.reset.addEventListener('click', () => sendAction({ type: 'reset' }, t('cd.resetLog')));
  elements.saveBpTimerSettings.addEventListener('click', saveBpTimerSettings);
  document.querySelector('[data-page="countdown"]').addEventListener('click', loadBpTimerSettings);

  renderTimer = setInterval(render, 200);
  window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
    if (renderTimer) clearInterval(renderTimer);
  });

  connect().catch(error => {
    setStatus(t('header.connectFailed'));
    addLog(error.message);
  });
  loadBpTimerSettings();
})();
