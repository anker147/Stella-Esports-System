(function () {
  'use strict';

  const card = document.getElementById('obsConnectionCard');
  if (!card) return;

  const urlInput = document.getElementById('obsUrl');
  const passwordInput = document.getElementById('obsPassword');
  const connectButton = document.getElementById('obsConnect');
  const statusLine = document.getElementById('obsConnectionStatus');

  function setStatus(text, tone) {
    if (!statusLine) return;
    statusLine.textContent = text;
    statusLine.classList.toggle('is-error', tone === 'error');
    statusLine.classList.toggle('is-ok', tone === 'ok');
  }

  async function refreshStatus() {
    try {
      const response = await fetch('/api/obs/status');
      const payload = await response.json().catch(() => ({}));
      if (payload.connected) setStatus(t('obs.statusConnected'), 'ok');
      else if (payload.connecting) setStatus(t('obs.statusConnecting'));
      else setStatus(t('obs.statusDisconnected'), 'error');
    } catch {
      setStatus(t('obs.statusReadFailed'), 'error');
    }
  }

  connectButton.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { setStatus(t('obs.statusNeedUrl'), 'error'); return; }
    localStorage.setItem('zfb.obsUrl', url);
    connectButton.disabled = true;
    setStatus(t('obs.statusConnecting'));
    try {
      const response = await fetch('/api/obs/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, password: passwordInput.value })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('obs.statusConnectFailed'));
      setStatus(t('obs.statusConnected'), 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      connectButton.disabled = false;
    }
  });

  urlInput.value = localStorage.getItem('zfb.obsUrl') || urlInput.value;
  refreshStatus();
  window.setInterval(refreshStatus, 10000);
})();
