(function () {
  const hubId = window.location.pathname.split('/').filter(Boolean).pop();
  const time = document.getElementById('time');
  let state = null;
  let timer = null;

  function render() {
    if (!state) return;
    window.CountdownHub.renderImages(time, window.CountdownHub.currentRemaining(state));
  }

  const events = new EventSource(`/api/hubs/${hubId}/events`);
  events.addEventListener('state', event => {
    state = JSON.parse(event.data);
    render();
  });

  timer = setInterval(render, 200);
  window.addEventListener('beforeunload', () => {
    events.close();
    if (timer) clearInterval(timer);
  });
})();
