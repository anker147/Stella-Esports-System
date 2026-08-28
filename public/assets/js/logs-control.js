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

  const actionLabels = {
    'session-created': '创建记录', 'bp-started': '开始 BP', 'slot-updated': '更新槽位',
    'slot-cleared': '清空槽位', 'phase-completed': '阶段完成', 'phase-started': '进入阶段',
    'timer-expired': '计时结束', 'bp-completed': 'BP 完成', 'bp-manually-completed': '手动结束 BP', 'revision-restored': '恢复版本',
    'replay-created': '创建重赛', 'output-mode-updated': '切换文本模式',
    'result-updated': '记录战果', 'result-image-updated': '上传赛果图片', 'session-reset': '重置正赛',
    'forfeit-declared': '弃赛结算', 'forfeit-revoked': '撤回弃赛'
  };

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
    elements.summary.textContent = `显示 ${visible.length} 条，共 ${logs.length} 条`;
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
    if (!response.ok) throw new Error(payload.error || '日志加载失败');
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
