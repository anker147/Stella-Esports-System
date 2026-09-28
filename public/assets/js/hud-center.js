// hud-center.js：HUB 卡开关（控 OBS 源显隐 + 本地记忆）+ 卡片弹窗（实时 iframe 预览 + 按卡定制右栏）
(function () {
  'use strict';

  function text(key, fallback, params) {
    const translated = window.t ? window.t(key, params) : key;
    return translated === key ? fallback : translated;
  }

  function node(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = String(content);
    return el;
  }

  const HUBS = {
    bp: {
      titleKey: 'hud.cardBpTitle', title: 'BP 呈现',
      descKey: 'hud.cardBpDesc', desc: '动态 BP 舞台画面，同步比分与选角。',
      path: '/hub/bp'
    },
    countdown: {
      titleKey: 'hud.cardCountdownTitle', title: '倒计时',
      descKey: 'hud.cardCountdownDesc', desc: '透明倒计时画面，计时中心实时联动。',
      path: '/hub/countdown'
    }
  };

  const state = {
    obsConnected: false,
    enabled: { bp: false, countdown: false },
    applying: false
  };

  const dialog = document.getElementById('hudHubDialog');
  const dialogFrame = dialog.querySelector('[data-hub-dialog-frame]');
  const dialogNote = dialog.querySelector('[data-hub-dialog-note]');
  const dialogTitle = dialog.querySelector('[data-hub-dialog-title]');
  const dialogDesc = dialog.querySelector('[data-hub-dialog-desc]');
  const dialogLogo = dialog.querySelector('[data-hub-dialog-logo]');
  const dialogControls = dialog.querySelector('[data-hub-dialog-controls]');
  let activeHubId = null;
  let countdownState = null;

  function logoSvg(hubId, gray) {
    const wrap = node('span', 'hub-card-logo' + (gray ? ' is-gray' : ''));
    wrap.setAttribute('aria-hidden', 'true');
    const source = document.querySelector(`[data-hub-logo="${hubId}"] svg`);
    if (source) wrap.append(source.cloneNode(true));
    return wrap;
  }

  async function api(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || text('hud.requestFailed', '请求失败'));
    return payload;
  }

  function setCardState(hubId, payload) {
    const line = document.querySelector(`[data-hub-state="${hubId}"]`);
    if (!line) return;
    if (!state.obsConnected) {
      line.textContent = text('hud.stateOffline', 'OBS 未连接 · 开关状态已记忆');
      line.classList.remove('is-live', 'is-off');
      return;
    }
    if (payload && payload.sceneName) {
      line.textContent = text('hud.stateLive', '已启用 · OBS 场景「{scene}」', { scene: payload.sceneName });
      line.classList.add('is-live');
      line.classList.remove('is-off');
    } else {
      line.textContent = text('hud.stateReady', '就绪 · 开关启用后推送到 OBS');
      line.classList.remove('is-live');
      line.classList.add('is-off');
    }
  }

  function applySwitch(hubId, enabled, disabled) {
    const input = document.querySelector(`[data-hub-switch="${hubId}"]`);
    if (!input) return;
    input.checked = enabled;
    input.disabled = Boolean(disabled);
    state.enabled[hubId] = enabled;
  }

  async function refreshStatus() {
    try {
      const payload = await api('/api/hubs/obs/status');
      state.obsConnected = Boolean(payload.connected);
      for (const hubId of ['bp', 'countdown']) {
        const source = payload.sources?.[hubId] || {};
        applySwitch(hubId, Boolean(source.enabled), state.applying);
        setCardState(hubId, source);
      }
    } catch {
      state.obsConnected = false;
      for (const hubId of ['bp', 'countdown']) {
        applySwitch(hubId, state.enabled[hubId], state.applying);
        setCardState(hubId, null);
      }
    }
  }

  async function toggleHub(hubId, enabled) {
    if (state.applying) return false;
    state.applying = true;
    for (const other of ['bp', 'countdown']) {
      const input = document.querySelector(`[data-hub-switch="${other}"]`);
      if (input) input.disabled = true;
    }
    try {
      const payload = await api(`/api/hubs/${hubId}/obs-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      applySwitch(hubId, payload.enabled, false);
      setCardState(hubId, payload.applied ? { sceneName: payload.sceneName } : null);
      if (!payload.applied && payload.error) {
        await window.StellaDialog?.alert?.({
          title: text('hud.toggleFailedTitle', '未能同步到 OBS'),
          message: payload.error,
          tone: 'warning'
        });
      }
      await refreshStatus();
      return true;
    } catch (error) {
      applySwitch(hubId, !enabled, false);
      await window.StellaDialog?.alert?.({
        title: text('hud.toggleFailedTitle', '未能同步到 OBS'),
        message: error.message,
        tone: 'danger'
      });
      return false;
    } finally {
      state.applying = false;
      for (const other of ['bp', 'countdown']) {
        const input = document.querySelector(`[data-hub-switch="${other}"]`);
        if (input) input.disabled = false;
      }
    }
  }

  // ---------- 弹窗 ----------

  function buildLinkRow(label, value) {
    const wrap = node('div', 'hud-link-block');
    wrap.append(node('span', 'hud-link-label', label));
    const row = node('div', 'link-row');
    const input = node('input', 'input mono');
    input.readOnly = true;
    input.value = value;
    input.setAttribute('aria-label', label);
    const copy = node('button', 'btn btn-primary', text('hud.copy', '复制'));
    copy.type = 'button';
    const status = node('span', 'hud-copy-status');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = text('hud.copied', '已复制');
      } catch {
        status.textContent = text('hud.copyFailed', '复制失败');
        status.classList.add('is-error');
      }
    });
    row.append(input, copy);
    wrap.append(row, status);
    return wrap;
  }

  function buildCountdownControls() {
    const wrap = node('div', 'hud-quick-controls');
    const note = node('p', 'hud-side-note', text('hud.quickNote', '与计时中心实时同步，此处只做快捷控制。'));
    wrap.append(note);
    const grid = node('div', 'hud-quick-grid');
    const makeButton = (label, className, action, logKey, logText) => {
      const button = node('button', 'btn ' + className, label);
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api(`/api/hubs/countdown/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: action })
          });
          button.classList.add('is-done');
          setTimeout(() => button.classList.remove('is-done'), 600);
        } catch (error) {
          await window.StellaDialog?.alert?.({
            title: text('hud.quickFailedTitle', '操作失败'),
            message: error.message,
            tone: 'danger'
          });
        } finally {
          button.disabled = false;
        }
      });
      grid.append(button);
    };
    makeButton(text('cd.start', '开始'), 'btn-primary', 'start');
    makeButton(text('cd.pause', '暂停'), 'btn-secondary', 'pause');
    makeButton(text('cd.reset', '重置'), 'btn-secondary', 'reset');
    wrap.append(grid);
    const clock = node('p', 'hud-countdown-clock', '--:--');
    clock.dataset.hubQuickClock = '';
    wrap.append(clock);
    return wrap;
  }

  let quickClockTimer = 0;

  function startQuickClock() {
    stopQuickClock();
    const clock = dialogControls.querySelector('[data-hub-quick-clock]');
    if (!clock) return;
    const render = () => {
      if (!countdownState) return;
      const remaining = window.CountdownHub?.currentRemaining
        ? window.CountdownHub.currentRemaining(countdownState)
        : countdownState.remainingSeconds || 0;
      clock.textContent = window.CountdownHub?.formatClock
        ? window.CountdownHub.formatClock(remaining)
        : String(Math.max(0, remaining)) + 's';
    };
    render();
    quickClockTimer = window.setInterval(render, 500);
  }

  function stopQuickClock() {
    if (quickClockTimer) {
      clearInterval(quickClockTimer);
      quickClockTimer = 0;
    }
  }

  async function openDialog(hubId) {
    const hub = HUBS[hubId];
    if (!hub) return;
    activeHubId = hubId;
    dialogLogo.replaceChildren(logoSvg(hubId, false));
    dialogTitle.textContent = text(hub.titleKey, hub.title);
    dialogDesc.textContent = text(hub.descKey, hub.desc);
    dialogControls.replaceChildren();
    dialogFrame.hidden = true;
    dialogNote.hidden = false;
    dialogNote.textContent = text('hud.previewLoading', '预览载入中…');

    const controls = node('div');
    const url = new URL(hub.path, window.location.origin).toString();
    controls.append(buildLinkRow(text('hud.hubLinkLabel', 'OBS 浏览器源链接'), url));
    if (hubId === 'bp') {
      const syncButton = node('button', 'btn btn-accent hud-sync-button', text('hud.syncToObs', '同步到 OBS'));
      syncButton.type = 'button';
      syncButton.addEventListener('click', async () => {
        syncButton.disabled = true;
        try {
          await api('/api/obs/bp-overlay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          syncButton.textContent = text('hud.syncDone', '已同步');
        } catch (error) {
          syncButton.textContent = text('hud.syncRetry', '重试同步');
          await window.StellaDialog?.alert?.({
            title: text('hud.syncFailedTitle', '同步失败'),
            message: error.message,
            tone: 'danger'
          });
        } finally {
          setTimeout(() => { syncButton.disabled = false; }, 800);
        }
      });
      controls.append(syncButton);
      const note = node('p', 'hud-side-note', text('hud.bpNote', '链接指向本服务的 BP 呈现页，OBS 源「BP动态底板」随动态 BP 自动刷新。'));
      controls.append(note);
    } else {
      controls.append(buildCountdownControls());
    }
    dialogControls.append(controls);

    dialog.showModal();
    const previewSuffix = hubId === 'bp' ? '?preview=1&v=' + Date.now() : '?v=' + Date.now();
    dialogFrame.src = hub.path + previewSuffix;
    dialogFrame.hidden = false;
    dialogNote.hidden = true;
    if (hubId === 'countdown') {
      try {
        countdownState = await api('/api/hubs/countdown/state');
        startQuickClock();
      } catch {}
    }
  }

  function closeDialog() {
    stopQuickClock();
    dialogFrame.src = 'about:blank';
    dialogFrame.hidden = true;
    dialogNote.hidden = true;
    activeHubId = null;
    dialog.close();
  }

  // ---------- 绑定 ----------

  document.querySelectorAll('[data-hub-switch]').forEach(input => {
    input.addEventListener('change', () => {
      toggleHub(input.dataset.hubSwitch, input.checked);
    });
  });
  document.querySelectorAll('[data-hub-card]').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('.hub-card-switch')) return;
      if (card.classList.contains('is-placeholder')) return;
      openDialog(card.dataset.hubCard);
    });
  });
  dialog.querySelector('[data-hub-dialog-close]').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('close', () => {
    stopQuickClock();
    dialogFrame.src = 'about:blank';
  });

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'hudCenter') refreshStatus();
  });
  if (!document.getElementById('hudCenterPage')?.hidden) refreshStatus();
  window.HudCenter = { refreshStatus, openDialog, closeDialog };
})();
