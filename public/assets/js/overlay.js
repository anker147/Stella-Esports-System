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

  async function refreshWhenAssetsChange() {
    try {
      const response = await fetch(window.location.href, { cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!response.ok) return;
      const html = await response.text();
      const nextVersion = html.match(/countdown\.js\?v=([^"']+)/)?.[1];
      const loadedVersion = [...document.scripts]
        .map(script => script.src.match(/countdown\.js\?v=([^&]+)/)?.[1])
        .find(Boolean);
      if (nextVersion && loadedVersion && nextVersion !== loadedVersion) window.location.reload();
    } catch {}
  }

  const events = new EventSource(`/api/hubs/${hubId}/events`);
  events.addEventListener('state', event => {
    state = JSON.parse(event.data);
    render();
  });

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
