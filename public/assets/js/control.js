(function () {
  const pageCopy = {
    countdown: {
      title: '计时中心',
      description: '生成透明 OBS Browser Source 链接，并从这里控制倒计时。'
    },
    bp: {
      title: 'BP 控制台',
      description: '按比赛、BO3 局数和房间管理 BP，并通过唯一中转源串行同步到 OBS。'
    },
    bracket: {
      title: '晋级榜推送',
      description: '保存带时间标识的晋级榜图片，并同步推送到 OBS。'
    },
    materials: {
      title: '素材中心',
      description: '索引并管理本机文件与文件夹。'
    },
    logs: {
      title: '日志面板',
      description: '查看 BP 历史与本次服务运行期间的 OBS 操作记录。'
    },
    updates: {
      title: '更新日志',
      description: '查看系统版本与历次功能变更。'
    }
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
    toggleButton.title = collapsed ? '展开侧边栏' : '收起侧边栏';
    toggleButton.setAttribute('aria-label', toggleButton.title);
    closeNavFlyout();
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

  function closeNavFlyout() {
    if (!flyoutToggle) return;
    flyoutToggle.classList.remove('flyout-open');
    flyoutToggle = null;
    flyout.classList.remove('show');
  }

  function openNavFlyout(group, toggle) {
    if (flyoutToggle === toggle) {
      closeNavFlyout();
      return;
    }
    if (flyoutToggle) flyoutToggle.classList.remove('flyout-open');
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
  }

  document.addEventListener('click', event => {
    if (flyoutToggle && !flyout.contains(event.target) && !flyoutToggle.contains(event.target)) {
      closeNavFlyout();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeNavFlyout();
  });

  document.querySelectorAll('[data-nav-group]').forEach(group => {
    const key = group.dataset.navGroup;
    const toggle = group.querySelector('.nav-group-toggle');
    group.dataset.open = navState.openGroups[key] ? 'true' : 'false';
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      if (isSidebarCollapsed()) {
        openNavFlyout(group, toggle);
        return;
      }
      const open = group.dataset.open !== 'true';
      group.dataset.open = String(open);
      navState.openGroups[key] = open;
      saveNavState();
    });
  });

  const SOON_MARK = '<svg class="nav-soon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.4L14.4 13H1.6L8 2.4z"/><path d="M8 6.9v2.7M8 11.4v.01"/></svg>';
  document.querySelectorAll('[data-soon]').forEach(button => {
    button.insertAdjacentHTML('beforeend', SOON_MARK);
  });

  document.querySelectorAll('[data-soon]').forEach(button => {
    button.addEventListener('click', () => showToast(`「${button.dataset.soon}」功能建设中`));
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
    if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
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
      input.setAttribute('aria-label', `${phase.label}倒计时秒数`);
      const unit = document.createElement('small');
      unit.textContent = '秒';
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
    elements.bpTimerSettingsStatus.textContent = '正在保存...';
    elements.bpTimerSettingsStatus.className = '';
    try {
      const next = await jsonRequest('/api/bp/timer-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phaseDurations: values, animationStyle: selectedAnimation })
      });
      renderBpTimerSettings(next);
      elements.bpTimerSettingsStatus.textContent = '已保存，计时从下一阶段生效，动画从下一次入场生效';
      elements.bpTimerSettingsStatus.className = 'success';
      addLog(`已更新 BP 七阶段倒计时与${selectedAnimation === 'classic' ? '经典' : '亮度'}展开动画`);
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
    addLog('固定 HUB 链接已确认');
  }

  function updateHubUrl() {
    elements.hubUrl.value = absoluteUrl('/hub/countdown');
  }

  function render() {
    if (!state) return;
    const remaining = window.CountdownHub.currentRemaining(state);
    elements.previewDigits.textContent = window.CountdownHub.formatClock(remaining);
    elements.modeChip.textContent = state.mode === 'target' ? '指定时间' : '指定倒计时';
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
      setStatus('HUB 在线');
    });
    eventSource.onerror = () => setStatus('正在重连');
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
    setStatus('HUB 在线');
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
    addLog('已复制透明 HUB 链接');
  });
  elements.applyTarget.addEventListener('click', () => {
    const targetAt = targetLocalToIso(elements.targetAt.value);
    if (!targetAt) return;
    sendAction({ type: 'set-target', targetAt }, '已应用目标时间并开始倒计时');
  });
  elements.applyDuration.addEventListener('click', () => {
    const minutes = window.CountdownHub.clamp(elements.minutes.value, 0, 99);
    const seconds = window.CountdownHub.clamp(elements.seconds.value, 0, 59);
    elements.minutes.value = minutes;
    elements.seconds.value = seconds;
    sendAction({ type: 'set-duration', minutes, seconds }, `已应用 ${minutes}分${seconds}秒并开始倒计时`);
  });
  elements.start.addEventListener('click', () => sendAction({ type: 'start' }, '开始倒计时'));
  elements.pause.addEventListener('click', () => sendAction({ type: 'pause' }, '暂停倒计时'));
  elements.reset.addEventListener('click', () => sendAction({ type: 'reset' }, '重置倒计时'));
  elements.saveBpTimerSettings.addEventListener('click', saveBpTimerSettings);
  document.querySelector('[data-page="countdown"]').addEventListener('click', loadBpTimerSettings);

  renderTimer = setInterval(render, 200);
  window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
    if (renderTimer) clearInterval(renderTimer);
  });

  connect().catch(error => {
    setStatus('连接失败');
    addLog(error.message);
  });
  loadBpTimerSettings();
})();
