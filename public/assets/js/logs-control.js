(function () {
  const elements = {
    search: document.getElementById('logsSearch'),
    category: document.getElementById('logsCategory'),
    refresh: document.getElementById('logsRefresh'),
    export: document.getElementById('logsExport'),
    summary: document.getElementById('logsSummary'),
    body: document.getElementById('logsTableBody')
  };
  let logs = [];
  const beijingTime = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  const actionLabels = {};
  for (const [key, value] of Object.entries(window.UI_TEXT)) {
    if (key.startsWith('bp.logActions.')) actionLabels[key.slice('bp.logActions.'.length)] = value;
  }

  function filteredLogs() {
    const query = elements.search.value.trim().toLocaleLowerCase();
    const category = elements.category.value;
    return logs.filter(item => {
      if (category !== 'all' && item.category !== category) return false;
      if (!query) return true;
      return JSON.stringify(item).toLocaleLowerCase().includes(query);
    });
  }

  function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    cell.className = className;
    row.appendChild(cell);
  }

  function render() {
    const visible = filteredLogs();
    elements.summary.textContent = t('lg.summary', { visible: visible.length, total: logs.length });
    elements.body.replaceChildren(...visible.slice(0, 1000).map(item => {
      const row = document.createElement('tr');
      appendCell(row, beijingTime(item.timestamp), 'log-time');
      appendCell(row, item.category === 'obs' ? 'OBS' : 'BP', `log-category ${item.category}`);
      appendCell(row, actionLabels[item.action] || item.label || item.action || '-', 'log-action');
      appendCell(row, item.sessionId || '-', 'log-session');
      appendCell(row, item.error || JSON.stringify(item.details || {}), 'log-details');
      return row;
    }));
  }

  async function load() {
    const response = await fetch('/api/logs');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t('lg.loadFailed'));
    logs = payload.logs;
    render();
  }

  elements.search.addEventListener('input', render);
  elements.category.addEventListener('change', render);
  elements.refresh.addEventListener('click', () => load().catch(error => { elements.summary.textContent = error.message; }));
  elements.export.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(filteredLogs(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zfb-logs-${new Date().toISOString().replaceAll(':', '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  document.querySelector('[data-page="logs"]').addEventListener('click', () => load().catch(error => { elements.summary.textContent = error.message; }));

  load().catch(error => { elements.summary.textContent = error.message; });
})();
