(function () {
  'use strict';

  const elements = {
    toggle: document.getElementById('systemAccessOpen'),
    switchLabel: document.getElementById('systemAccessSwitchLabel'),
    state: document.getElementById('systemAccessState'),
    status: document.getElementById('systemManagementStatus')
  };
  let loaded = false;
  let currentOpen = true;

  async function requestJson(options) {
    return window.StellaDataCache.json('/api/admin/system-access', options);
  }

  function setStatus(message, type = '') {
    elements.status.textContent = message;
    elements.status.className = `system-management-status ${type}`.trim();
  }

  function render(open) {
    currentOpen = Boolean(open);
    elements.toggle.checked = currentOpen;
    elements.switchLabel.textContent = t(currentOpen
      ? 'systemManagement.switchOpen' : 'systemManagement.switchClosed');
    elements.state.textContent = t(currentOpen
      ? 'systemManagement.stateOpen' : 'systemManagement.stateClosed');
    elements.state.className = `system-access-state ${currentOpen ? 'is-open' : 'is-closed'}`;
  }

  async function load() {
    if (loaded) return;
    elements.toggle.disabled = true;
    setStatus(t('systemManagement.loading'), 'pending');
    try {
      const policy = await requestJson();
      render(policy.open);
      loaded = true;
      setStatus('');
    } catch (error) {
      setStatus(t('systemManagement.loadFailed', { error: error.message }), 'error');
    } finally {
      elements.toggle.disabled = false;
    }
  }

  elements.toggle.addEventListener('change', async () => {
    const previous = currentOpen;
    const next = elements.toggle.checked;
    elements.toggle.disabled = true;
    setStatus(t('systemManagement.saving'), 'pending');
    try {
      const policy = await requestJson({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open: next })
      });
      render(policy.open);
      setStatus(t(policy.open
        ? 'systemManagement.opened' : 'systemManagement.closed'), 'success');
    } catch (error) {
      render(previous);
      setStatus(t('systemManagement.saveFailed', { error: error.message }), 'error');
    } finally {
      elements.toggle.disabled = false;
    }
  });

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'systemManagement') load();
  });

  window.SystemManagement = { load };
})();
