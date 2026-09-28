(function () {
  const hubId = window.location.pathname.split('/').filter(Boolean).pop();
  const time = document.getElementById('time');
  let state = null;
  let timer = null;
  let assetVersionTimer = null;

  function render() {
    if (!state) return;
    window.CountdownHub.renderImages(time, window.CountdownHub.currentRemaining(state));
  }

  let knownVersion = null;

  // 用轻量版本探针替代整页 HTML 轮询：版本变化才整页刷新
  async function refreshWhenAssetsChange() {
    try {
      const response = await fetch('/api/system/health', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (typeof payload.version !== 'string' || !payload.version) return;
      if (knownVersion === null) {
        knownVersion = payload.version;
        return;
      }
      if (payload.version !== knownVersion) window.location.reload();
    } catch {}
  }

  const events = new EventSource(`/api/hubs/${hubId}/events`);
  let everErrored = false;
  events.addEventListener('state', event => {
    state = JSON.parse(event.data);
    render();
  });
  events.onerror = () => { everErrored = true; };
  // 断线重连成功后补拉一次全量状态，避免 OBS 源冻结在旧帧
  events.onopen = async () => {
    if (!everErrored) return;
    everErrored = false;
    try {
      const response = await fetch(`/api/hubs/${hubId}/state`, { cache: 'no-store' });
      if (response.ok) {
        state = await response.json();
        render();
      }
    } catch {}
  };

  timer = setInterval(render, 200);
  assetVersionTimer = setInterval(refreshWhenAssetsChange, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshWhenAssetsChange();
  });
  window.addEventListener('beforeunload', () => {
    events.close();
    if (timer) clearInterval(timer);
    if (assetVersionTimer) clearInterval(assetVersionTimer);
  });
})();
